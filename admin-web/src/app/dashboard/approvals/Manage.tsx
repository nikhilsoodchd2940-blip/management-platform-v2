'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useGroupHierarchy, type GroupNode } from '@/lib/useGroupHierarchy';
import { reviewRegistration as reviewRegistrationFn, reviewPhoneUpdateRequest as reviewPhoneUpdateRequestFn } from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { useMembershipsByUser } from '@/lib/useMemberships';

interface PhoneUpdateRequest {
  id: string;
  memberId: string;
  requestedPhone: string;
  note?: string;
}

interface PendingMember {
  id: string;
  displayName: string;
  phone: string;
  memberId: string;
  photoUrl: string;
  email?: string;
}


/**
 * Separate from the Members roster on purpose: this is a queue to work
 * through (registered, waiting on a decision), not a browsable list —
 * mixing the two made the Members page noisier than it needed to be.
 * Shows every group a member is already linked to (full Country / City
 * / Group path), since the whole point of reviewing here is deciding
 * whether those group assignments look right before approving.
 */
export default function ApprovalsManage() {
  const { byId } = useGroupHierarchy();
  const { t } = useLocale();
  const a = t.approvals;

  const [pending, setPending] = useState<PendingMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [enlargedPhotoUrl, setEnlargedPhotoUrl] = useState<string | null>(null);

  const [phoneRequests, setPhoneRequests] = useState<PhoneUpdateRequest[]>([]);
  const [phoneReviewBusyId, setPhoneReviewBusyId] = useState<string | null>(null);
  const [phoneReviewError, setPhoneReviewError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'phoneUpdateRequests'), where('status', '==', 'pending')), (snap) => {
      setPhoneRequests(
        snap.docs.map((d) => ({
          id: d.id,
          memberId: (d.data().memberId as string) || '',
          requestedPhone: (d.data().requestedPhone as string) || '',
          note: (d.data().note as string) || undefined,
        }))
      );
    });
  }, []);

  async function handleReviewPhoneRequest(requestId: string, decision: 'approved' | 'rejected') {
    setPhoneReviewError(null);
    setPhoneReviewBusyId(requestId);
    try {
      await reviewPhoneUpdateRequestFn({ requestId, decision });
    } catch (err) {
      setPhoneReviewError(err instanceof Error ? err.message : a.updateRequestFailed);
    } finally {
      setPhoneReviewBusyId(null);
    }
  }

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'users'), where('registrationStatus', '==', 'pending_approval')),
      (snap) => {
        setPending(
          snap.docs.map((d) => ({
            id: d.id,
            displayName: (d.data().displayName as string) || '',
            phone: (d.data().phone as string) || '',
            memberId: (d.data().memberId as string) || '',
            photoUrl: (d.data().photoUrl as string) || '',
            email: (d.data().email as string) || undefined,
          }))
        );
        setLoading(false);
      }
    );
  }, []);

  const pendingIds = useMemo(() => pending.map((m) => m.id), [pending]);
  const membershipsByUser = useMembershipsByUser(pendingIds);

  function pathLabel(groupId: string): string {
    const parts: string[] = [];
    let current: GroupNode | undefined = byId[groupId];
    while (current) {
      parts.unshift(current.name);
      current = current.parentGroupId ? byId[current.parentGroupId] : undefined;
    }
    return parts.length > 0 ? parts.join(' / ') : groupId;
  }

  async function handleReview(userId: string, decision: 'approved' | 'rejected') {
    let reason: string | undefined;
    if (decision === 'rejected') {
      const input = window.prompt(a.rejectPrompt);
      if (input === null) return; // admin cancelled
      reason = input.trim() || undefined;
    }
    setReviewError(null);
    setReviewBusyId(userId);
    try {
      await reviewRegistrationFn({ userId, decision, reason });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : a.updateRegistrationFailed);
    } finally {
      setReviewBusyId(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.25rem' }}>{a.title}</h1>

      {phoneRequests.length > 0 && (
        <div className="card" style={{ marginBottom: '1.25rem', borderColor: 'var(--warn)' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>
            {a.phoneRequestsTitle}{' '}
            <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>({phoneRequests.length})</span>
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '-0.5rem' }}>
            {a.phoneRequestsHelp}
          </p>
          {phoneReviewError && <p className="error-text">{phoneReviewError}</p>}
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>{a.colMemberId}</th>
                <th>{a.colRequestedPhone}</th>
                <th>{a.colNote}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {phoneRequests.map((r) => (
                <tr key={r.id}>
                  <td>{r.memberId}</td>
                  <td>{r.requestedPhone}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>{r.note || '—'}</td>
                  <td style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-primary"
                      disabled={phoneReviewBusyId === r.id}
                      onClick={() => handleReviewPhoneRequest(r.id, 'approved')}
                    >
                      {a.approve}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={phoneReviewBusyId === r.id}
                      onClick={() => handleReviewPhoneRequest(r.id, 'rejected')}
                    >
                      {a.reject}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <p style={{ color: 'var(--ink-soft)', marginTop: 0, fontSize: '0.9rem' }}>
        {a.intro}
      </p>

      <div className="card">
        {reviewError && <p className="error-text">{reviewError}</p>}

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
        ) : pending.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)' }}>{a.nothingPending}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pending.map((m) => {
              const memberships = membershipsByUser[m.id] ?? [];
              return (
                <div
                  key={m.id}
                  className="approval-row"
                  style={{
                    padding: '1rem',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                  }}
                >
                  <div>
                    {m.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset
                      <img
                        src={m.photoUrl}
                        alt={m.displayName || a.noName}
                        onClick={() => setEnlargedPhotoUrl(m.photoUrl)}
                        style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }}
                        title={a.clickToEnlarge}
                      />
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          background: 'var(--line)',
                          color: 'var(--ink-soft)',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.8rem',
                        }}
                      >
                        —
                      </span>
                    )}
                  </div>

                  <div>
                    <strong style={{ fontSize: '1.05rem' }}>{m.displayName || a.noName}</strong>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '0.15rem' }}>
                      {a.memberIdLabel} {m.memberId || '—'} &nbsp;·&nbsp; {a.phoneLabel} {m.phone}
                      {m.email && <> &nbsp;·&nbsp; {a.emailLabel} {m.email}</>}
                    </div>

                    <div style={{ marginTop: '0.6rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: '0.3rem' }}>
                        {a.registeredKurels} {memberships.length > 1 && a.multiKurels}
                      </div>
                      {memberships.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: 0 }}>
                          {a.noKurel}
                        </p>
                      ) : (
                        <div className="group-chip-list">
                          {memberships.map((ms) => (
                            <div key={ms.groupId} className="group-chip">
                              <span className="group-chip-path">{pathLabel(ms.groupId)}</span>
                              <span className={ms.role === 'host' ? 'badge badge-host' : 'badge badge-member'}>
                                {ms.role === 'host' ? a.roleHost : a.roleMember}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <button
                      className="btn btn-primary"
                      disabled={reviewBusyId === m.id}
                      onClick={() => handleReview(m.id, 'approved')}
                    >
                      {a.approve}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={reviewBusyId === m.id}
                      onClick={() => handleReview(m.id, 'rejected')}
                    >
                      {a.reject}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {enlargedPhotoUrl && (
        <div
          onClick={() => setEnlargedPhotoUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            cursor: 'zoom-out',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset */}
          <img
            src={enlargedPhotoUrl}
            alt={a.photoAlt}
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
          />
        </div>
      )}
    </div>
  );
}

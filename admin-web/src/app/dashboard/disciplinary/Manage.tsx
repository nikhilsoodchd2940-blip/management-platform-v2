'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { collection, limit as fsLimit, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import {
  openDisciplinaryCase as openCaseFn,
  requestDisciplinaryHearing as requestHearingFn,
  castDisciplinaryVote as castVoteFn,
  resolveDisciplinaryCase as resolveCaseFn,
} from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';

type Status = 'open' | 'hearing_requested' | 'vote_required' | 'escalated' | 'resolved';

interface Vote {
  voterId: string;
  voterName: string;
  decision: 'reinstate' | 'uphold';
  at?: { seconds: number };
}
interface HistoryEntry {
  action: string;
  actorName: string;
  note?: string;
  at?: { seconds: number };
}
interface CaseRow {
  id: string;
  memberId: string;
  memberName: string;
  groupId: string;
  reason: string;
  description: string;
  status: Status;
  votes: Vote[];
  resolution?: 'reinstated' | 'upheld';
  history: HistoryEntry[];
  openedAt?: { seconds: number };
}

function statusPill(s: Status, label: string) {
  if (s === 'resolved') return <span className="status">{label}</span>;
  if (s === 'vote_required') return <span className="status blue">{label}</span>;
  return <span className="status gold">{label}</span>;
}

const LIST_CAP = 300;

/**
 * Disciplinary council — simplified from the original 5-step circuit
 * (report → investigation → hearing → vote → decision) to
 * open → hearing (optional) → votes accumulate → an admin explicitly
 * resolves. See the module doc comment on DisciplinaryCaseDoc
 * (types/models.ts) for why resolution isn't auto-decided from the tally.
 */
export default function DisciplinaryManage() {
  const { t: tr, formatDate } = useLocale();
  const d18 = tr.disciplinary;
  const STATUS_LABELS = d18.statuses;
  const HISTORY_LABELS: Record<string, string> = d18.historyActions;
  const fmt = (ts?: { seconds: number }) => formatDate(ts, true);
  const { user } = useAuth();
  const { byId, locationOf, activeLeafGroups: leafGroups } = useGroupHierarchy();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    return onSnapshot(query(collection(db, 'disciplinaryCases'), orderBy('openedAt', 'desc'), fsLimit(LIST_CAP)), (snap) => {
      setCases(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CaseRow, 'id'>) })));
      setLoading(false);
    });
  }, []);

  // ---- Open-case form ----
  const [groupId, setGroupId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleOpen(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!groupId || !memberId.trim() || !memberName.trim() || !reason.trim()) {
      setFormError(d18.allRequired);
      return;
    }
    setSubmitting(true);
    try {
      await openCaseFn({
        groupId,
        memberId: memberId.trim(),
        memberName: memberName.trim(),
        reason: reason.trim(),
        description: description.trim(),
        actorName: user?.email ?? 'Admin',
      });
      setMemberId('');
      setMemberName('');
      setReason('');
      setDescription('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : d18.openFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function act(fn: () => Promise<unknown>, id: string) {
    setError(null);
    setBusyId(id);
    try {
      await fn();
      setNotes((prev) => ({ ...prev, [id]: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : d18.saveFailed);
    } finally {
      setBusyId(null);
    }
  }

  const visible = cases.filter((c) => !statusFilter || c.status === statusFilter);
  const alreadyVoted = (c: CaseRow) => c.votes.some((v) => v.voterId === user?.uid);

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>{d18.title}</h1>
          <p>{d18.subtitle}</p>
        </div>
      </div>

      <section className="card filters" style={{ gridTemplateColumns: '1fr' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{d18.allStatuses}</option>
          {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </section>

      {error && <p className="error-text">{error}</p>}

      <div className="workspace">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>{d18.cases}</h2>
              <p>{d18.shown(visible.length)}</p>
            </div>
          </div>
          {loading ? (
            <p>{tr.common.loading}</p>
          ) : visible.length === 0 ? (
            <p className="empty" style={{ display: 'block' }}>
              {d18.empty}
            </p>
          ) : (
            <div className="members">
              {visible.map((c) => {
                const open = openId === c.id;
                const { city, country } = locationOf(c.groupId);
                return (
                  <div key={c.id} className="kurel" style={{ padding: 0 }}>
                    <button
                      type="button"
                      className="member-row"
                      style={{ gridTemplateColumns: '1fr auto', border: 0, background: 'transparent' }}
                      onClick={() => setOpenId(open ? null : c.id)}
                    >
                      <div>
                        <strong>{c.memberName}</strong>
                        <span>{c.reason}</span>
                        <span>
                          {byId[c.groupId]?.name ?? '—'} · {city?.name ?? '—'} · {country?.name ?? '—'}
                        </span>
                      </div>
                      {c.status === 'resolved' ? (
                        <span className={c.resolution === 'reinstated' ? 'status' : 'status red'}>
                          {c.resolution === 'reinstated' ? d18.reinstated : d18.upheld}
                        </span>
                      ) : (
                        statusPill(c.status, STATUS_LABELS[c.status])
                      )}
                    </button>

                    {open && (
                      <div style={{ padding: '0 0.75rem 0.85rem' }}>
                        {c.description && <p style={{ fontSize: '0.82rem' }}>{c.description}</p>}

                        <div className="section-title">
                          <h3>
                            {d18.votes(c.votes.length, c.votes.filter((v) => v.decision === 'reinstate').length, c.votes.filter((v) => v.decision === 'uphold').length)}
                          </h3>
                        </div>

                        <div className="section-title">
                          <h3>{d18.history}</h3>
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '0.75rem' }}>
                          {c.history.map((h, i) => (
                            <div key={i} className="activity">
                              <div className="activity-head">
                                <strong>{HISTORY_LABELS[h.action] ?? h.action}</strong>
                                <small>{fmt(h.at)}</small>
                              </div>
                              <span>{d18.by} {h.actorName}</span>
                              {h.note && <span>“{h.note}”</span>}
                            </div>
                          ))}
                        </div>

                        {c.status !== 'resolved' && (
                          <>
                            <input
                              placeholder={d18.notePlaceholder}
                              value={notes[c.id] ?? ''}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--line)', borderRadius: 10, marginBottom: '0.5rem' }}
                            />
                            <div className="actions">
                              {c.status === 'open' && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busyId === c.id}
                                  onClick={() => act(() => requestHearingFn({ caseId: c.id, note: notes[c.id]?.trim() || undefined, actorName: user?.email ?? 'Admin' }), c.id)}
                                >
                                  {d18.requestHearing}
                                </button>
                              )}
                              {!alreadyVoted(c) && (
                                <>
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={busyId === c.id}
                                    onClick={() => act(() => castVoteFn({ caseId: c.id, decision: 'reinstate', voterName: user?.email ?? 'Admin' }), c.id)}
                                  >
                                    {d18.voteReinstate}
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    style={{ color: 'var(--danger)' }}
                                    disabled={busyId === c.id}
                                    onClick={() => act(() => castVoteFn({ caseId: c.id, decision: 'uphold', voterName: user?.email ?? 'Admin' }), c.id)}
                                  >
                                    {d18.voteUphold}
                                  </button>
                                </>
                              )}
                            </div>
                            {c.status === 'escalated' && (
                            <div className="actions" style={{ marginTop: '0.5rem' }}>
                              <button
                                type="button"
                                className="primary"
                                disabled={busyId === c.id}
                                onClick={() => act(() => resolveCaseFn({ caseId: c.id, resolution: 'reinstated', note: notes[c.id]?.trim() || undefined, actorName: user?.email ?? 'Admin' }), c.id)}
                              >
                                {d18.resolveReinstate}
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                style={{ color: 'var(--danger)' }}
                                disabled={busyId === c.id}
                                onClick={() => act(() => resolveCaseFn({ caseId: c.id, resolution: 'upheld', note: notes[c.id]?.trim() || undefined, actorName: user?.email ?? 'Admin' }), c.id)}
                              >
                                {d18.resolveUphold}
                              </button>
                            </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <form onSubmit={handleOpen} className="card" style={{ alignSelf: 'start' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{d18.openCase}</h2>
          <div className="field">
            <label htmlFor="dc-group">{d18.kurelLabel}</label>
            <select id="dc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{d18.selectPlaceholder}</option>
              {leafGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dc-member-id">{d18.memberIdLabel}</label>
            <input id="dc-member-id" required value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder={d18.memberIdPlaceholder} />
          </div>
          <div className="field">
            <label htmlFor="dc-member-name">{d18.memberNameLabel}</label>
            <input id="dc-member-name" required value={memberName} onChange={(e) => setMemberName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dc-reason">{d18.reasonLabel}</label>
            <input id="dc-reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dc-desc">{d18.descriptionLabel}</label>
            <input id="dc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {formError && <p className="error-text">{formError}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? d18.submitting : d18.submit}
          </button>
        </form>
      </div>
    </div>
  );
}

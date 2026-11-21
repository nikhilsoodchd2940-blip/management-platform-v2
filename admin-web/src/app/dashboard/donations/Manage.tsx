'use client';

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { collection, doc, getDoc, getAggregateFromServer, sum, limit, orderBy, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import {
  closeFinancialProgram as closeProgramFn,
  recordContribution as recordContributionFn,
  reviewContribution as reviewContributionFn,
  type ContributionMethod,
} from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { formatMoney } from '@/lib/money';
import { tx } from '@/lib/i18n/tr';

interface DonationRow {
  id: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded';
  refundedCents?: number;
  failureMessage?: string;
  paidAt?: { seconds: number };
  createdAt: { seconds: number };
}

interface ProgramRow {
  id: string;
  name: string;
  goalAmountCents: number;
  scopeAllGroups: boolean;
  groupIds?: string[];
  status: 'open' | 'closed';
}

interface ContributionRow {
  notes?: string;
  id: string;
  programId: string;
  groupId: string;
  userId: string;
  userName: string;
  method: ContributionMethod;
  amountCents: number;
  proofUrl?: string;
  status: 'pending_review' | 'validated' | 'rejected';
  createdAt?: { seconds: number };
}

const PAGE_SIZE = 50;

export default function FinanceManage() {
  const { t, formatDate, intlLocale } = useLocale();
  const f18 = t.donations;
  const METHOD_LABELS: Record<ContributionMethod, string> = f18.methods;
  const { activeLeafGroups: leafGroups } = useGroupHierarchy();

  // ---- Existing Stripe donations (unchanged) ----
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [totalSucceededCents, setTotalSucceededCents] = useState<number | null>(null);

  useEffect(() => {
    getAggregateFromServer(query(collection(db, 'donations'), where('status', '==', 'succeeded')), {
      totalCents: sum('amountCents'),
    }).then((snap) => setTotalSucceededCents(snap.data().totalCents));
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'donations'), orderBy('createdAt', 'desc'), limit(pageSize)), (snap) => {
      setDonations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DonationRow, 'id'>) })));
      setLoading(false);
    });
  }, [pageSize]);

  useEffect(() => {
    donations.forEach(async (d) => {
      if (names[d.userId]) return;
      const snap = await getDoc(doc(db, 'users', d.userId));
      const name = snap.data()?.displayName as string | undefined;
      if (name) setNames((prev) => ({ ...prev, [d.userId]: name }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donations]);

  // ---- Financial Programs + Contributions (new) ----
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [contributions, setContributions] = useState<ContributionRow[]>([]);
  const [financeError, setFinanceError] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'financialPrograms'), (snap) =>
      setPrograms(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProgramRow, 'id'>) })))
    );
    const u2 = onSnapshot(query(collection(db, 'contributions'), orderBy('createdAt', 'desc')), (snap) =>
      setContributions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContributionRow, 'id'>) })))
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [contribGroupId, setContribGroupId] = useState('');
  const [contribUserId, setContribUserId] = useState('');
  const [contribUserName, setContribUserName] = useState('');
  const [contribMethod, setContribMethod] = useState<ContributionMethod>('wave');
  const [contribAmount, setContribAmount] = useState('');
  const [contribProof, setContribProof] = useState<File | null>(null);
  const [contribNotes, setContribNotes] = useState('');
  const [recording, setRecording] = useState(false);

  async function handleRecordContribution(e: FormEvent) {
    e.preventDefault();
    setFinanceError(null);
    if (!selectedProgramId || !contribGroupId || !contribUserId.trim() || !contribUserName.trim() || !contribAmount.trim()) {
      setFinanceError(f18.allRequired);
      return;
    }
    if (contribMethod !== 'cash' && !contribProof) {
      setFinanceError(f18.proofRequired);
      return;
    }
    setRecording(true);
    try {
      let proofUrl: string | undefined;
      if (contribProof) {
        const path = `contributionProofs/${contribUserId.trim()}/${Date.now()}_${contribProof.name}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, contribProof, { contentType: contribProof.type || 'image/jpeg' });
        proofUrl = await getDownloadURL(ref);
      }
      await recordContributionFn({
        programId: selectedProgramId,
        groupId: contribGroupId,
        userId: contribUserId.trim(),
        userName: contribUserName.trim(),
        method: contribMethod,
        amountCents: Math.round(Number(contribAmount) * 100),
        proofUrl,
        notes: contribNotes.trim() || undefined,
      });
      setContribNotes('');
      setContribUserId('');
      setContribUserName('');
      setContribAmount('');
      setContribProof(null);
    } catch (err) {
      setFinanceError(err instanceof Error ? err.message : f18.recordFailed);
    } finally {
      setRecording(false);
    }
  }

  const programTotals = (programId: string) =>
    contributions.filter((c) => c.programId === programId && c.status === 'validated').reduce((sum, c) => sum + c.amountCents, 0);

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>{f18.title}</h1>
          <p>{f18.subtitle}</p>
        </div>
      </div>

      {financeError && <p className="error-text">{financeError}</p>}

      <section className="card command">
        <div className="command-stats cols-3" style={{ marginTop: 0 }}>
          <div>
            <span>{f18.statValidatedStripe}</span>
            <strong>{totalSucceededCents !== null ? formatMoney(totalSucceededCents, 'USD', intlLocale) : '…'}</strong>
          </div>
          <div>
            <span>{f18.statOpenPrograms}</span>
            <strong>{programs.filter((p) => p.status === 'open').length}</strong>
          </div>
          <div>
            <span>{f18.statPendingContributions}</span>
            <strong>{contributions.filter((c) => c.status === 'pending_review').length}</strong>
          </div>
        </div>
      </section>

      <div className="workspace">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>{f18.programsTitle}</h2>
              <p>{f18.total(programs.length)}</p>
            </div>
          </div>
          {programs.length === 0 ? (
            <p className="empty" style={{ display: 'block' }}>
              {f18.noPrograms}
            </p>
          ) : (
            <div className="capacity-list">
              {programs.map((p) => {
                const raised = programTotals(p.id);
                const pct = Math.min(100, Math.round((raised / p.goalAmountCents) * 100));
                return (
                  <div key={p.id} className="capacity-row">
                    <div className="capacity-head">
                      <div>
                        <strong>{p.name}</strong>
                        <span>
                          {p.scopeAllGroups ? f18.allKurels : f18.kurelsTargeted(p.groupIds?.length ?? 0)} · {p.status === 'open' ? f18.open : f18.closed}
                        </span>
                      </div>
                      <b>
                        {formatMoney(raised, undefined, intlLocale)} / {formatMoney(p.goalAmountCents, undefined, intlLocale)}
                      </b>
                    </div>
                    <div className="capacity">
                      <i style={{ '--p': `${pct}%` } as CSSProperties} />
                    </div>
                    {p.status === 'open' && (
                      <button type="button" className="secondary" style={{ marginTop: 8, fontSize: '0.72rem', padding: '6px 10px' }} onClick={() => closeProgramFn({ programId: p.id })}>
                        {f18.closeProgram}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="section-title">
            <h3>{f18.recentContributions}</h3>
          </div>
          {contributions.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{f18.noContributions}</p>
          ) : (
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>{f18.colMember}</th>
                  <th>{f18.colProgram}</th>
                  <th>{f18.colMethod}</th>
                  <th>{f18.colAmount}</th>
                  <th>{f18.colStatus}</th>
                  <th>{f18.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {contributions.slice(0, 20).map((c) => (
                  <tr key={c.id}>
                    <td>{c.userName}</td>
                    <td>{programs.find((p) => p.id === c.programId)?.name ?? '—'}</td>
                    <td>
                      {METHOD_LABELS[c.method]}
                      {c.notes && <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{tx("Note:")} {c.notes}</div>}
                      {c.proofUrl && (
                        <>
                          {' · '}
                          <a href={c.proofUrl} target="_blank" rel="noreferrer">
                            {f18.proof}
                          </a>
                        </>
                      )}
                    </td>
                    <td>{formatMoney(c.amountCents, undefined, intlLocale)}</td>
                    <td>
                      {c.status === 'validated' ? (
                        <span className="status">{f18.validated}</span>
                      ) : c.status === 'rejected' ? (
                        <span className="status red">{f18.rejected}</span>
                      ) : (
                        <span className="status gold">{f18.pending}</span>
                      )}
                    </td>
                    <td>
                      {c.status === 'pending_review' && (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button type="button" className="btn btn-secondary" onClick={() => reviewContributionFn({ contributionId: c.id, decision: 'validate' })}>
                            {f18.validate}
                          </button>
                          <button type="button" className="btn btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => reviewContributionFn({ contributionId: c.id, decision: 'reject' })}>
                            {f18.reject}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <form onSubmit={handleRecordContribution} className="card">
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{f18.recordContribution}</h2>
            <div className="field">
              <label htmlFor="ct-program">{f18.colProgram}</label>
              <select id="ct-program" value={selectedProgramId} onChange={(e) => setSelectedProgramId(e.target.value)}>
                <option value="">{f18.selectPlaceholder}</option>
                {programs.filter((p) => p.status === 'open').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ct-group">{f18.kurelLabel}</label>
              <select id="ct-group" value={contribGroupId} onChange={(e) => setContribGroupId(e.target.value)}>
                <option value="">{f18.selectPlaceholder}</option>
                {leafGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ct-userid">{f18.memberIdLabel}</label>
              <input id="ct-userid" required value={contribUserId} onChange={(e) => setContribUserId(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ct-username">{f18.memberNameLabel}</label>
              <input id="ct-username" required value={contribUserName} onChange={(e) => setContribUserName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ct-method">{f18.methodLabel}</label>
              <select id="ct-method" value={contribMethod} onChange={(e) => setContribMethod(e.target.value as ContributionMethod)}>
                {(Object.keys(METHOD_LABELS) as ContributionMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ct-amount">{f18.amountLabel}</label>
              <input id="ct-amount" type="number" min={0.01} step="0.01" required value={contribAmount} onChange={(e) => setContribAmount(e.target.value)} />
            </div>
            {contribMethod !== 'cash' && (
              <div className="field">
                <label htmlFor="ct-proof">{f18.proofLabel}</label>
                <input id="ct-proof" type="file" accept="image/*" onChange={(e) => setContribProof(e.target.files?.[0] ?? null)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="ct-notes">{tx("Notes")}</label>
              <textarea id="ct-notes" rows={3} maxLength={1000} value={contribNotes} onChange={(e) => setContribNotes(e.target.value)} placeholder={tx("Anything useful about this payment (reference, who paid on behalf, remarks)")} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={recording} style={{ width: '100%' }}>
              {recording ? f18.recording : f18.record}
            </button>
          </form>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: '1.5rem' }}>
        <h3>{f18.cardDonations}</h3>
      </div>
      <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', marginTop: 0 }}>
        {f18.readOnlyNote}
      </p>
      <div className="card">
        {loading ? (
          <p>{t.common.loading}</p>
        ) : donations.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)' }}>{f18.noDonations}</p>
        ) : (
          <>
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>{f18.colDonor}</th>
                  <th>{f18.colAmount}</th>
                  <th>{f18.colStatus}</th>
                  <th>{f18.colDate}</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr key={d.id}>
                    <td>{names[d.userId] ?? '…'}</td>
                    <td>
                      {formatMoney(d.amountCents, d.currency, intlLocale)}
                    </td>
                    <td>
                      <span className={`fx2-pill ${d.status === 'succeeded' ? 'ok' : d.status === 'failed' || d.status === 'canceled' ? 'bad' : d.status === 'refunded' ? 'info' : 'warn'}`}>
                        {{ pending: f18.donationPending, processing: 'Processing', succeeded: f18.donationSucceeded, failed: f18.donationFailed, canceled: 'Canceled', refunded: 'Refunded' }[d.status]}
                      </span>
                      {d.status === 'refunded' && d.refundedCents ? <div style={{ fontSize: '0.78rem' }}>{formatMoney(d.refundedCents, d.currency, intlLocale)} {tx("refunded")}</div> : null}
                      {d.status === 'failed' && d.failureMessage ? <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{d.failureMessage}</div> : null}
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>{formatDate(d.createdAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {donations.length === pageSize && (
              <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => setPageSize((p) => p + PAGE_SIZE)}>
                {f18.loadMore}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

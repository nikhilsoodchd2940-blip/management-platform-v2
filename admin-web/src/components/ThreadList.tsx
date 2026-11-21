'use client';

import { useMemo, useState } from 'react';
import { escalateSupervisorThread, resolveSupervisorThread, sendSupervisorMessage, LEVEL_NAME, type SupervisionLevel, type SupervisorThread } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

const when = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const KIND: Record<string, string> = { question: 'Question', urgent: 'Urgent problem', request: 'Request' };
const CHAIN: { id: 'manager' | 'main' | 'admin'; label: string }[] = [{ id: 'manager', label: 'Site manager' }, { id: 'main', label: 'Main supervisor' }, { id: 'admin', label: 'Administration' }];

/**
 * Reports and their answers, for every level. Staff see their own reports; managers and the main supervisor
 * also see what is waiting for them; the administration sees everything. Anyone who has to deal with a report
 * can answer, hand it up one level or mark it as dealt with.
 */
export default function ThreadList({ eventId, threads, onChanged, empty, isAdmin }: { eventId: string; threads: SupervisorThread[]; onChanged: () => void; empty?: string; isAdmin?: boolean }) {
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [showDone, setShowDone] = useState(false);

  const waiting = useMemo(() => threads.filter((t) => t.canAct && t.status === 'open' && (!isAdmin || t.handler === 'admin')), [threads, isAdmin]);
  const mine = useMemo(() => threads.filter((t) => t.mine && t.status === 'open' && !waiting.includes(t)), [threads, waiting]);
  const other = useMemo(() => threads.filter((t) => t.status === 'open' && !t.mine && !waiting.includes(t)), [threads, waiting]);
  const done = useMemo(() => threads.filter((t) => t.status === 'resolved'), [threads]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); notify(ok, 'success'); onChanged(); } catch (e) { notify(e instanceof Error ? e.message : 'Something went wrong', 'error'); } finally { setBusy(''); }
  }
  const send = (t: SupervisorThread) => {
    const text = (reply[t.threadId] ?? '').trim();
    if (text.length < 2) return;
    void run(`s${t.threadId}`, async () => { await sendSupervisorMessage({ eventId, threadId: t.threadId, text }); setReply((r) => ({ ...r, [t.threadId]: '' })); }, 'Reply sent');
  };
  const next = (h: SupervisorThread['handler']) => (h === 'manager' ? 'the main supervisor' : 'the administration');

  const card = (t: SupervisorThread) => {
    const at = CHAIN.findIndex((c) => c.id === t.handler);
    return (
      <article key={t.threadId} className={`th ${t.kind}${t.status === 'resolved' ? ' done' : ''}`}>
        <header>
          <span className={`th-pill ${t.kind}`}>{KIND[t.kind] ?? t.kind}</span>
          <div className="th-who"><b>{t.mine ? tx("Your report") : t.ownerName}</b><small>{LEVEL_NAME[t.ownerLevel as SupervisionLevel] ?? ''}{t.place ? ` · ${t.place}` : ''}{t.about ? ` · about ${t.about}` : ''}</small></div>
          <em className={t.status === 'resolved' ? 'done' : t.mine ? 'wait' : 'ask'}>{t.status === 'resolved' ? tx("Dealt with") : t.handler === 'admin' && t.mine ? tx("With the administration") : `With: ${t.handlerLabel}`}</em>
        </header>
        <ol className="th-chain" aria-label={tx("Where this report is")}>
          <li className="done">{LEVEL_NAME[t.ownerLevel as SupervisionLevel] ?? tx("Author")}</li>
          {CHAIN.map((c, i) => <li key={c.id} className={i < at ? 'done' : i === at ? 'now' : ''}>{c.label}</li>)}
        </ol>
        <div className="th-msgs">
          {t.messages.map((m) => m.system
            ? <p key={m.id} className="th-sys">{m.text} <small>{when(m.atMs)}</small></p>
            : <div key={m.id} className={`th-msg${m.fromRole === 'supervisor' ? ' from-owner' : ' from-head'}`}><small>{m.fromName}{m.fromLevel && m.fromLevel !== 'member' ? ` · ${LEVEL_NAME[m.fromLevel as SupervisionLevel] ?? ''}` : ''} · {when(m.atMs)}</small><p>{m.text}</p></div>)}
        </div>
        {t.status !== 'resolved' && (t.canAct || t.mine) && (
          <div className="th-reply">
            <input value={reply[t.threadId] ?? ''} onChange={(e) => setReply((r) => ({ ...r, [t.threadId]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && send(t)} placeholder={t.canAct ? tx("Write your answer…") : tx("Add a message…")} maxLength={1500} aria-label={tx("Reply")} />
            <button type="button" className="btn btn-primary" disabled={busy === `s${t.threadId}` || (reply[t.threadId] ?? '').trim().length < 2} onClick={() => send(t)}>{tx("Send")}</button>
          </div>
        )}
        {(t.canAct || t.canEscalate) && (
          <div className="th-acts">
            {t.canEscalate && t.status !== 'resolved' && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => confirm(`Send this report up to ${next(t.handler)}?`) && void run(`e${t.threadId}`, () => escalateSupervisorThread({ eventId, threadId: t.threadId }), 'Sent up')}>{tx("Send up to")} {next(t.handler)}</button>}
            {t.canAct && (t.status === 'resolved'
              ? <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run(`r${t.threadId}`, () => resolveSupervisorThread({ threadId: t.threadId, resolved: false }), 'Reopened')}>{tx("Reopen")}</button>
              : <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run(`r${t.threadId}`, () => resolveSupervisorThread({ threadId: t.threadId }), 'Marked as dealt with')}>{tx("Mark as dealt with")}</button>)}
          </div>
        )}
      </article>
    );
  };

  if (threads.length === 0) return <p className="th-empty">{empty ?? tx("No reports yet.")}</p>;
  return (
    <div className="th-wrap">
      {waiting.length > 0 && <section><h3>{tx("Waiting for your answer")} <span className="th-n hot">{waiting.length}</span></h3>{waiting.map(card)}</section>}
      {mine.length > 0 && <section><h3>{tx("Your reports")} <span className="th-n">{mine.length}</span></h3>{mine.map(card)}</section>}
      {other.length > 0 && <section><h3>{isAdmin ? tx("Still with supervisors") : tx("Other open reports")} <span className="th-n">{other.length}</span></h3>{other.map(card)}</section>}
      {done.length > 0 && (
        <section>
          <button type="button" className="th-toggle" onClick={() => setShowDone((v) => !v)}>{tx("Dealt with (")}{done.length}) {showDone ? '▾' : '▸'}</button>
          {showDone && done.map(card)}
        </section>
      )}
    </div>
  );
}

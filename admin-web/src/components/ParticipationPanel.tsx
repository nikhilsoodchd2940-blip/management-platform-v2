'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { decideWithdrawal, getEventParticipation, reviewParticipantList, setEventDeadlines, type EventParticipation, type ListStatus, type ParticipationGroup } from '@/lib/functions';
import { Avatar } from '@/components/MemberPicker';
import DateTimePicker from '@/components/DateTimePicker';
import ReasonBox from '@/components/ReasonBox';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

export const LIST_LABEL: Record<ListStatus, string> = { requested: 'Pending list', submitted: 'In review', approved: 'Approved', rejected: 'Refused, new list needed', withdrawal_pending: 'Wants to withdraw', withdrawn: 'Withdrawn' };
const AUDIO_LABEL = { none: 'No books yet', draft: 'Books in preparation', submitted: 'Books to review', approved: 'Books approved' } as const;
const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** "in 2 d 3 h" or "5 h late". */
export function left(ms: number, now: number) {
  const diff = Math.abs(ms - now);
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000);
  const t = d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
  return ms >= now ? `in ${t}` : `${t} late`;
}
const toLocal = (ms: number | null) => { if (!ms) return ''; const d = new Date(ms); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

type Filter = 'all' | 'action' | 'waiting' | 'approved' | 'late';

/**
 * Member lists of one event, group by group: who sent, who is late, what to approve. Supervisors and the administration
 * approve or refuse a list and remove people (with a reason); the administration decides on withdrawals and sets the deadlines.
 */
export default function ParticipationPanel({ eventId }: { eventId: string }) {
  const [d, setD] = useState<EventParticipation | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState('');
  const [roster, setRoster] = useState<EventParticipation['roster']>();
  const [ask, setAsk] = useState<{ kind: 'reject' | 'remove' | 'refuse'; groupId: string; userId?: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<{ list: string; audio: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = (await getEventParticipation({ eventId, ...(open ? { groupId: open } : {}) })).data;
      setD(r); setRoster(r.roster); setErr('');
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErr(!m || /^(internal|not-found|unavailable)$/i.test(m.trim()) ? tx("The service did not answer. The latest Firebase functions may not be deployed yet.") : m);
    }
  }, [eventId, open]);
  useEffect(() => { void load(); const h = window.setInterval(() => void load(), 10000); return () => window.clearInterval(h); }, [load]);

  async function run(key: string, f: () => Promise<unknown>, done: string) {
    setBusy(key);
    try { await f(); notify(done, 'success'); setAsk(null); await load(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(''); }
  }

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.groups ?? []).filter((g) => (!t || g.groupName.toLowerCase().includes(t)) && (
      filter === 'all' ? true : filter === 'action' ? g.status === 'submitted' || g.status === 'withdrawal_pending'
        : filter === 'waiting' ? g.status === 'requested' || g.status === 'rejected' : filter === 'approved' ? g.status === 'approved' : g.listOverdue || g.audioOverdue));
  }, [d, q, filter]);

  if (err && !d) return <div className="at-error" role="alert"><span aria-hidden>⚠</span><div><b>{tx("Member lists could not be loaded")}</b><p>{err}</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Try again")}</button></div>;
  if (!d) return <p className="fx3-note">{tx("Loading the member lists…")}</p>;
  const t = d.totals;
  const tile = (label: string, n: number, cls: string, f?: Filter) => <button type="button" className={`mls-tile ${cls}${f && filter === f ? ' on' : ''}`} onClick={() => f && setFilter(filter === f ? 'all' : f)}><b>{n}</b><span>{label}</span></button>;
  const dl = (label: string, ms: number | null) => (
    <div className={`ddl-card${ms && ms < d.nowMs ? ' over' : ''}`}>
      <span>{label}</span>
      <b>{ms ? when(ms) : tx("No deadline")}</b>
      {ms ? <small>{left(ms, d.nowMs)}</small> : <small>{tx("Not set")}</small>}
    </div>
  );

  return (
    <div className="mls">
      <div className="ddl-row">
        {dl('Member list due', d.deadlines.memberListMs)}
        {dl('Book choice due', d.deadlines.audioMs)}
        {d.canDecide && !edit && <button type="button" className="btn btn-secondary" onClick={() => setEdit({ list: toLocal(d.deadlines.memberListMs), audio: toLocal(d.deadlines.audioMs) })}>{tx("Change the deadlines")}</button>}
      </div>
      {edit && (
        <div className="ddl-edit">
          <div className="field"><label>{tx("Member list due")}</label><DateTimePicker value={edit.list} onChange={(v) => setEdit({ ...edit, list: v })} placeholder={tx("No deadline")} /></div>
          <div className="field"><label>{tx("Book choice due")}</label><DateTimePicker value={edit.audio} onChange={(v) => setEdit({ ...edit, audio: v })} placeholder={tx("No deadline")} /></div>
          <div className="ddl-btns">
            <button type="button" className="btn btn-primary" disabled={busy === 'dl'} onClick={() => void run('dl', async () => { await setEventDeadlines({ eventId, memberListMs: edit.list ? new Date(edit.list).getTime() : null, audioMs: edit.audio ? new Date(edit.audio).getTime() : null }); setEdit(null); }, 'Deadlines saved')}>{busy === 'dl' ? tx("Saving…") : tx("Save")}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>{tx("Cancel")}</button>
          </div>
          <small>{tx("Times are in your own time zone. Leave a field empty to remove that deadline.")}</small>
        </div>
      )}

      <div className="mls-tiles">
        {tile('Waiting for a list', t.waiting + t.rejected, 'w', 'waiting')}
        {tile('In review', t.toReview + t.withdrawals, 'r', 'action')}
        {tile('Approved', t.approved, 'a', 'approved')}
        {tile('Late', t.listOverdue + t.audioOverdue, 'x', 'late')}
      </div>

      <div className="mls-bar">
        <input type="search" placeholder={tx("Search a group")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search a group")} />
        <div className="mls-chips">
          {([['all', 'All'], ['action', 'Needs my answer'], ['waiting', 'Waiting'], ['approved', 'Approved'], ['late', 'Late']] as const).map(([k, l]) => <button type="button" key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>

      {rows.length === 0 && <p className="fx3-note">{d.groups.length === 0 ? tx("No group has a request for this event yet.") : tx("No group matches this filter.")}</p>}
      <div className="mls-list">
        {rows.map((g) => <GroupCard key={g.groupId} g={g} d={d} open={open === g.groupId} roster={open === g.groupId ? roster : undefined} ask={ask?.groupId === g.groupId ? ask : null} busy={busy}
          onToggle={() => { setOpen(open === g.groupId ? '' : g.groupId); setRoster(undefined); setAsk(null); }} setAsk={setAsk}
          onApprove={() => void run(`a${g.groupId}`, () => reviewParticipantList({ eventId, groupId: g.groupId, action: 'approve' }), 'List approved')}
          onReject={(reason) => void run(`r${g.groupId}`, () => reviewParticipantList({ eventId, groupId: g.groupId, action: 'reject', reason }), 'List refused')}
          onRemove={(userId, reason) => void run(`m${userId}`, () => reviewParticipantList({ eventId, groupId: g.groupId, action: 'remove', userId, reason }), 'Member removed')}
          onWithdraw={(approve, note) => void run(`w${g.groupId}`, () => decideWithdrawal({ eventId, groupId: g.groupId, approve, note }), approve ? 'Withdrawal approved' : 'Withdrawal refused')} />)}
      </div>
    </div>
  );
}

function GroupCard({ g, d, open, roster, ask, busy, onToggle, setAsk, onApprove, onReject, onRemove, onWithdraw }: {
  g: ParticipationGroup; d: EventParticipation; open: boolean; roster?: EventParticipation['roster']; ask: { kind: 'reject' | 'remove' | 'refuse'; groupId: string; userId?: string } | null; busy: string;
  onToggle: () => void; setAsk: (a: { kind: 'reject' | 'remove' | 'refuse'; groupId: string; userId?: string } | null) => void;
  onApprove: () => void; onReject: (r: string) => void; onRemove: (u: string, r: string) => void; onWithdraw: (approve: boolean, note: string) => void;
}) {
  const needs = g.status === 'submitted' || g.status === 'withdrawal_pending';
  return (
    <article className={`mls-card s-${g.status}${needs ? ' needs' : ''}`}>
      <button type="button" className="mls-head ph" aria-expanded={open} onClick={onToggle}>
        <span className="ph-id">
          <b>{g.groupName}</b>
          {(g.preview?.length ?? 0) > 0 && <span className="mls-faces">{g.preview!.map((m) => <Avatar key={m.userId} name={m.name} photoUrl={m.photoUrl} size={26} />)}{g.memberCount > g.preview!.length && <i>+{g.memberCount - g.preview!.length}</i>}</span>}
        </span>
        <span className={`ph-box l-${g.status}${g.listOverdue ? ' over' : ''}`}>
          <small>{tx("Member list")}</small>
          <strong>{LIST_LABEL[g.status]}</strong>
          <em>{g.status === 'requested' || g.status === 'rejected' ? (d.deadlines.memberListMs ? `Due ${left(d.deadlines.memberListMs, d.nowMs)}` : tx("No deadline")) : `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}${g.submittedAtMs ? ` · sent ${when(g.submittedAtMs)}` : ''}${g.late ? ' · after the deadline' : ''}`}</em>
        </span>
        <span className={`ph-box a-${g.audio.state}${g.audioOverdue ? ' over' : ''}`}>
          <small>{tx("Performance books")}</small>
          <strong>{g.audio.slots === 0 ? tx("No performance yet") : g.audioOverdue ? tx("Not chosen, late") : AUDIO_LABEL[g.audio.state]}</strong>
          <em>{g.audio.slots === 0 ? tx("No slot given to this group") : g.audio.items > 0 ? `${g.audio.items} book${g.audio.items === 1 ? '' : 's'} chosen` : d.deadlines.audioMs ? `Due ${left(d.deadlines.audioMs, d.nowMs)}` : tx("No deadline")}</em>
        </span>
        <span className="mls-view">{open ? tx("Hide members") : tx("View members")} <span aria-hidden>{open ? '▴' : '▾'}</span></span>
      </button>

      {open && (
        <div className="mls-body">
          {g.status === 'withdrawal_pending' && g.withdrawal && (
            <div className="mls-wd">
              <b>{g.withdrawal.byName} {tx("asks to withdraw this group")}</b>
              <p>“{g.withdrawal.reason}”</p>
              {d.canDecide ? (ask?.kind === 'refuse' ? <ReasonBox label={tx("Why is the withdrawal refused?")} confirm="Refuse the withdrawal" busy={busy === `w${g.groupId}`} onConfirm={(r) => onWithdraw(false, r)} onCancel={() => setAsk(null)} /> : (
                <div className="mls-btns"><button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => onWithdraw(true, '')}>{tx("Approve the withdrawal")}</button><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setAsk({ kind: 'refuse', groupId: g.groupId })}>{tx("Refuse")}</button></div>
              )) : <small>{tx("Only the administration can decide on a withdrawal.")}</small>}
            </div>
          )}
          {g.withdrawal?.decision && <p className="mls-note">{tx("Withdrawal")} {g.withdrawal.decision === 'approved' ? tx("approved") : tx("refused")} {tx("by")} {g.withdrawal.decidedByName}{g.withdrawal.note ? `: ${g.withdrawal.note}` : ''}.</p>}
          {g.status === 'rejected' && g.rejectReason && <p className="mls-note bad">{tx("Refused:")} {g.rejectReason}</p>}

          {(g.status === 'submitted' || g.status === 'approved') && d.canReview && (
            <div className="mls-btns top">
              {g.status === 'submitted' && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={onApprove}>{busy === `a${g.groupId}` ? tx("Saving…") : tx("Approve the list")}</button>}
              {ask?.kind !== 'reject' && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setAsk({ kind: 'reject', groupId: g.groupId })}>{tx("Refuse the list")}</button>}
            </div>
          )}
          {ask?.kind === 'reject' && <ReasonBox label={tx("Why is the list refused? The Group Manager will read it.")} confirm="Refuse the list" busy={busy === `r${g.groupId}`} onConfirm={onReject} onCancel={() => setAsk(null)} />}

          {g.status === 'requested' && <p className="mls-note">{tx("The Group Manager has not sent the list yet. A reminder is sent automatically before and after the deadline.")}</p>}

          {roster ? (
            <ul className="mls-roster">
              {roster.map((m) => (
                <li key={m.userId} className={m.included ? 'in' : 'out'}>
                  <Avatar name={m.name} photoUrl={m.photoUrl} size={30} />
                  <span className="mls-n"><b>{m.name}</b><small className={m.substitute ? 'sub' : 'perm'}>{m.substitute ? tx("Substitute") : tx("Permanent")}</small></span>
                  {g.status === 'requested' || g.status === 'rejected' ? <em>{tx("Not sent")}</em> : m.included ? (
                    d.canReview && g.status !== 'withdrawn' ? <button type="button" className="mls-rm" disabled={!!busy} onClick={() => setAsk({ kind: 'remove', groupId: g.groupId, userId: m.userId })}>{tx("Remove")}</button> : <em className="ok">{tx("On the list")}</em>
                  ) : <em>{tx("Not on the list")}</em>}
                  {ask?.kind === 'remove' && ask.userId === m.userId && (
                    <div className="mls-rowask"><ReasonBox label={`Why is ${m.name} removed? They and the Group Manager will be told.`} confirm="Remove" busy={busy === `m${m.userId}`} onConfirm={(r) => onRemove(m.userId, r)} onCancel={() => setAsk(null)} /></div>
                  )}
                </li>
              ))}
              {roster.length === 0 && <li className="none">{tx("This group has no active member.")}</li>}
            </ul>
          ) : <p className="fx3-note">{tx("Loading the members…")}</p>}

          {g.removed.length > 0 && (
            <div className="mls-removed"><b>{tx("Removed from the list")}</b>{g.removed.map((r, i) => <p key={i}>{r.name}: {r.reason} <small>({r.byName})</small></p>)}</div>
          )}
          {g.history.length > 0 && (
            <details className="mls-hist"><summary>{tx("History")}</summary>
              <ul>{g.history.map((h, i) => <li key={i}><time>{when(h.atMs)}</time><b>{h.action.replace(/_/g, ' ')}</b><span>{h.by}{h.detail ? `: ${h.detail}` : ''}</span></li>)}</ul>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

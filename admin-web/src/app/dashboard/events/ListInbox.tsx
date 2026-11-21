'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { decideWithdrawal, getEventParticipation, reviewParticipantList, type EventParticipation, type InboxList } from '@/lib/functions';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import ReasonBox from '@/components/ReasonBox';
import { notify } from '@/lib/notify';
import { loadListInbox } from '@/lib/listInbox';
import { tx, dateLocale } from '@/lib/i18n/tr';

const stamp = (ms: number | null) => (ms ? new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** For the administration: the member lists sent by the groups, from every event, waiting for an answer. Open one to see the members, then approve or refuse it. */
export default function ListInbox() {
  const [items, setItems] = useState<InboxList[] | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<InboxList | null>(null);
  const [q, setQ] = useState('');
  const [ev, setEv] = useState('');
  const [lim, setLim] = useState(12);
  const load = useCallback(() => { loadListInbox().then((r) => { setItems(r.items); setCanDecide(r.canDecide); setErr(''); }).catch((e) => { setErr(e instanceof Error ? e.message : tx("Could not load")); setItems((x) => x ?? []); }); }, []);
  useEffect(() => { load(); const h = window.setInterval(load, 15000); return () => window.clearInterval(h); }, [load]);
  const events = useMemo(() => Array.from(new Map((items ?? []).map((i) => [i.eventId, i.title])).entries()), [items]);
  const shown = useMemo(() => (items ?? []).filter((i) => (!ev || i.eventId === ev) && (!q.trim() || `${i.groupName} ${i.title}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, q, ev]);
  const list = items ?? [];
  return (
    <section className="card pa li">
      <div className="li-head">
        <div><h2>{tx("Member lists waiting for your approval")} {list.length > 0 && <span className="pa-count">{list.length}</span>}</h2><p>{tx("Lists of members sent by the group managers. Open one to see who is on it, then approve it or refuse it with a reason that goes to the group manager.")}</p></div>
      </div>
      {err ? <p className="fx2-empty" role="alert">{tx("The member lists could not be loaded:")} {err}. Try again in a moment.</p> : items === null ? <p>{tx("Loading…")}</p> : list.length === 0 ? <p className="fx2-empty">{tx("Nothing is waiting. New lists appear here and in your notifications.")}</p> : <>
      {(list.length > 8 || events.length > 1) && (
        <div className="li-bar">
          <input type="search" placeholder={tx("Search a group or an event")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search")} />
          {events.length > 1 && <select value={ev} onChange={(e) => setEv(e.target.value)} aria-label={tx("Event")}><option value="">{tx("All events (")}{events.length})</option>{events.map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select>}
        </div>
      )}
      <div className="li-grid">
        {shown.slice(0, lim).map((i) => (
          <article key={`${i.eventId}_${i.groupId}`} className={`li-card${i.status === 'withdrawal_pending' ? ' wd' : ''}`}>
            <header><div><b>{i.groupName}</b><small>{i.title}</small></div><span className={`li-st ${i.status}`}>{i.status === 'withdrawal_pending' ? tx("Wants to withdraw") : i.late ? tx("Sent late") : tx("In review")}</span></header>
            <div className="li-info"><div><small>{tx("Members")}</small><b>{i.memberCount}</b></div><div><small>{tx("Sent")}</small><b>{stamp(i.submittedAtMs) || '—'}</b></div><div><small>{tx("By")}</small><b>{i.submittedByName || '—'}</b></div></div>
            <button type="button" className="mm-btn" onClick={() => setOpen(i)}>{i.status === 'withdrawal_pending' ? tx("See the request") : tx("View the members and answer")}</button>
          </article>
        ))}
        {shown.length === 0 && <p className="fx3-note">{tx("Nothing matches.")}</p>}
      </div>
      {shown.length > lim && <button type="button" className="li-more" onClick={() => setLim(lim + 24)}>{tx("Show")} {Math.min(24, shown.length - lim)} {tx("more of")} {shown.length - lim}</button>}
      </>}
      {open && <ListDialog item={open} canDecide={canDecide} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} />}
    </section>
  );
}

function ListDialog({ item, canDecide, onClose, onDone }: { item: InboxList; canDecide: boolean; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<EventParticipation | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'' | 'reject' | 'refuse'>('');
  useEffect(() => { getEventParticipation({ eventId: item.eventId, groupId: item.groupId }).then((r) => setD(r.data)).catch((e) => setErr(e instanceof Error ? e.message : tx("Could not load the members"))); }, [item.eventId, item.groupId]);
  const on = (d?.roster ?? []).filter((m) => m.included);
  const out = (d?.roster ?? []).filter((m) => !m.included);
  const withdrawal = item.status === 'withdrawal_pending';
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); try { await fn(); notify(ok, 'success'); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : tx("Could not save")); setBusy(false); } }
  const row = (m: NonNullable<EventParticipation['roster']>[number]) => (
    <li key={m.userId}><Avatar name={m.name} photoUrl={m.photoUrl} size={30} /><span className="mls-n"><b><PersonLink userId={m.userId}>{m.name}</PersonLink></b><small className={m.substitute ? 'sub' : 'perm'}>{m.substitute ? tx("Substitute") : tx("Permanent")}</small></span></li>
  );
  return createPortal(
    <div className="mls-modal" role="dialog" aria-modal="true" aria-label={tx("Member list")} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mls-sheet">
        <header><div><h3>{item.groupName}</h3><p>{item.title} · {item.memberCount} {tx("member")}{item.memberCount === 1 ? '' : 's'} {tx("on the list")}</p></div><button type="button" className="mls-x" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        {withdrawal && <p className="mls-note">{tx("The group asks to withdraw: “")}{item.withdrawalReason}”</p>}
        <div className="li-cols">
          <section><h4>{tx("On the list")} <em>{on.length}</em></h4><ul className="mls-pick li-pick">{!d && !err && <li className="none">{tx("Loading…")}</li>}{on.map(row)}{d && on.length === 0 && <li className="none">{tx("Nobody.")}</li>}</ul></section>
          {out.length > 0 && <section><h4>{tx("Left out")} <em>{out.length}</em></h4><ul className="mls-pick li-pick off">{out.map(row)}</ul></section>}
        </div>
        {err && <p className="mls-note bad">{err}</p>}
        {ask ? <div className="li-ask"><ReasonBox label={ask === 'refuse' ? tx("Why is the withdrawal refused?") : tx("Why is the list refused? The Group Manager will read it.")} confirm={ask === 'refuse' ? 'Refuse the withdrawal' : 'Refuse the list'} busy={busy} onCancel={() => setAsk('')}
          onConfirm={(r) => void run(() => ask === 'refuse' ? decideWithdrawal({ eventId: item.eventId, groupId: item.groupId, approve: false, note: r }) : reviewParticipantList({ eventId: item.eventId, groupId: item.groupId, action: 'reject', reason: r }), 'Answer sent')} /></div> : (
          <footer>
            <span />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAsk(withdrawal ? 'refuse' : 'reject')}>{withdrawal ? tx("Refuse") : tx("Refuse the list")}</button>
            {withdrawal ? (canDecide ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => decideWithdrawal({ eventId: item.eventId, groupId: item.groupId, approve: true, note: '' }), 'Withdrawal approved')}>{tx("Approve the withdrawal")}</button> : <small>{tx("Only the administration decides.")}</small>)
              : <button type="button" className="btn btn-primary" disabled={busy || !d} onClick={() => void run(() => reviewParticipantList({ eventId: item.eventId, groupId: item.groupId, action: 'approve' }), 'List approved')}>{busy ? tx("Saving…") : tx("Approve the list")}</button>}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getEventParticipation, getMyParticipation, requestWithdrawal, submitParticipantList, type EventParticipation, type ListStatus, type MyListItem } from '@/lib/functions';
import { Avatar } from '@/components/MemberPicker';
import ReasonBox from '@/components/ReasonBox';
import { LIST_LABEL, left } from '@/components/ParticipationPanel';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

const dateOf = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });

type Filter = 'all' | 'todo' | 'review' | 'done';
const TODO = (s: ListStatus) => s === 'requested' || s === 'rejected';

/** Urgency of a deadline: red under 3 hours or late, amber under a day. */
function urgency(ms: number | null, now: number): 'late' | 'soon' | 'day' | 'ok' | 'none' {
  if (!ms) return 'none';
  const d = ms - now;
  return d <= 0 ? 'late' : d < 3 * 3600000 ? 'soon' : d < 86400000 ? 'day' : 'ok';
}

/** For a Group Manager: the events that ask for the member list of their group, grouped by event, with the deadline, the progress and the answer of the reviewers. */
export default function MyMemberLists() {
  const [items, setItems] = useState<MyListItem[] | null>(null);
  const [err, setErr] = useState('');
  const [choose, setChoose] = useState<MyListItem | null>(null);
  const [leave, setLeave] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [lim, setLim] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try { setItems((await getMyParticipation({})).data.items); setErr(''); setNow(Date.now()); } catch (e) { setErr(e instanceof Error && e.message && !/^internal$/i.test(e.message) ? e.message : tx("The member lists could not be loaded. The latest Firebase functions may not be deployed yet.")); }
  }, []);
  useEffect(() => { void load(); const h = window.setInterval(() => void load(), 20000); return () => window.clearInterval(h); }, [load]);

  const events = useMemo(() => {
    const t = q.trim().toLowerCase();
    const keep = (i: MyListItem) => (!t || `${i.groupName} ${i.title}`.toLowerCase().includes(t)) && (filter === 'all' ? true : filter === 'todo' ? TODO(i.status) : filter === 'review' ? i.status === 'submitted' || i.status === 'withdrawal_pending' : i.status === 'approved' || i.status === 'withdrawn');
    const m = new Map<string, { eventId: string; title: string; startMs: number; deadlineMs: number | null; audioDeadlineMs: number | null; all: MyListItem[]; rows: MyListItem[] }>();
    (items ?? []).forEach((i) => {
      const e = m.get(i.eventId) ?? { eventId: i.eventId, title: i.title, startMs: i.startMs, deadlineMs: i.deadlineMs, audioDeadlineMs: i.audioDeadlineMs, all: [], rows: [] };
      e.all.push(i); if (keep(i)) e.rows.push(i); m.set(i.eventId, e);
    });
    return [...m.values()].filter((e) => e.rows.length > 0).sort((a, b) => a.startMs - b.startMs);
  }, [items, q, filter]);

  if (err && !items) return <section className="card mls-mine"><div className="at-error"><span aria-hidden>⚠</span><div><b>{tx("Member lists")}</b><p>{err}</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Try again")}</button></div></section>;
  if (!items || items.length === 0) return null;
  const n = (f: (i: MyListItem) => boolean) => items.filter(f).length;
  const todo = n((i) => TODO(i.status));
  const tiles: { k: Filter; label: string; v: number; cls: string }[] = [
    { k: 'todo', label: tx("Pending list"), v: todo, cls: 'w' },
    { k: 'review', label: tx("In review"), v: n((i) => i.status === 'submitted' || i.status === 'withdrawal_pending'), cls: 'r' },
    { k: 'done', label: tx("Approved"), v: n((i) => i.status === 'approved' || i.status === 'withdrawn'), cls: 'a' },
  ];
  const key = (i: MyListItem) => `${i.eventId}_${i.groupId}`;

  return (
    <section className="card mls-mine">
      <div className="mls-mine-head">
        <div><h2>{tx("Member lists for your groups")}</h2><p>{tx("Choose who takes part in each event. Supervisors review your list and you are told the answer.")}</p></div>
        {todo > 0 && <span className="mls-badge">{todo} {tx("pending")}</span>}
      </div>

      <div className="mlm-tools">
        <div className="mlm-tiles">
          {tiles.map((t) => <button type="button" key={t.k} className={`mlm-tile ${t.cls}${filter === t.k ? ' on' : ''}`} onClick={() => setFilter(filter === t.k ? 'all' : t.k)}><b>{t.v}</b><span>{t.label}</span></button>)}
        </div>
        {items.length > 6 && <input className="mlm-search" type="search" placeholder={tx("Search a group or an event")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search")} />}
      </div>

      {events.length === 0 && <p className="fx3-note">{tx("Nothing matches this filter.")}</p>}
      <div className="mlm-events">
        {events.map((e) => {
          const done = e.all.filter((i) => i.status === 'approved' || i.status === 'withdrawn').length;
          const sent = e.all.filter((i) => !TODO(i.status)).length;
          const pct = Math.round((sent / e.all.length) * 100);
          const open = shut[e.eventId] === undefined ? e.all.some((i) => TODO(i.status) || i.status === 'submitted') : !shut[e.eventId];
          const du = urgency(e.deadlineMs, now);
          const d = new Date(e.startMs);
          return (
            <article key={e.eventId} className="mlm-ev">
              <button type="button" className="mlm-evhead" aria-expanded={open} onClick={() => setShut({ ...shut, [e.eventId]: open })}>
                <span className="mlm-date"><b>{d.toLocaleDateString(dateLocale(), { day: '2-digit' })}</b><small>{d.toLocaleDateString(dateLocale(), { month: 'short' }).toUpperCase()}</small></span>
                <span className="mlm-evname">
                  <em className="mlm-evk">{tx("Event")}</em>
                  <b>{e.title}</b>
                  <small>{dateOf(e.startMs)} · {sent} {tx("of")} {e.all.length} {tx("group")}{e.all.length === 1 ? '' : 's'} {tx("sent ·")} {done} {tx("approved")}</small>
                  <span className="mlm-prog" aria-label={`${pct}% sent`}><i style={{ width: `${pct}%` }} /></span>
                </span>
                <span className="mlm-dls">
                  {e.deadlineMs && e.all.some((i) => TODO(i.status)) && <span className={`mlm-dl ${du}`}>{tx("List")} {left(e.deadlineMs, now)}</span>}
                  {e.audioDeadlineMs && <span className={`mlm-dl ${urgency(e.audioDeadlineMs, now)}`}>{tx("Books")} {left(e.audioDeadlineMs, now)}</span>}
                </span>
                <span className="mls-chev" aria-hidden>{open ? '▴' : '▾'}</span>
              </button>

              {open && (
                <ul className="mlm-rows mlm-grid">
                  {e.rows.slice(0, lim[e.eventId] ?? 12).map((i) => {
                    const canSend = i.status === 'requested' || i.status === 'rejected' || i.status === 'submitted';
                    const canLeave = ['requested', 'rejected', 'submitted', 'approved'].includes(i.status);
                    return (
                      <li key={key(i)} className={`s-${i.status}`}>
                        <span className="mlm-g"><b>{i.groupName}</b><small>{i.memberCount > 0 ? `${i.memberCount} member${i.memberCount === 1 ? '' : 's'} on the list` : tx("No list sent yet")}</small></span>
                        <span className={`mls-pill s-${i.status}`}>{LIST_LABEL[i.status as ListStatus]}</span>
                        {leave === key(i) ? null : (
                          <span className="mlm-acts">
                            {canSend && <button type="button" className="mlm-go" onClick={() => setChoose(i)}>{i.status === 'submitted' ? tx("Change") : i.status === 'rejected' ? tx("Send a new list") : tx("Choose members")}</button>}
                            {canLeave && <button type="button" className="mlm-link" onClick={() => setLeave(key(i))}>{tx("Withdraw")}</button>}
                          </span>
                        )}
                        {(i.status === 'rejected' && i.rejectReason) && <p className="mls-note bad mlm-wide">{tx("Refused:")} {i.rejectReason}</p>}
                        {i.removed.map((r, k) => <p key={k} className="mls-note mlm-wide">{r.name} {tx("was removed:")} {r.reason}</p>)}
                        {i.withdrawal?.decision === 'rejected' && <p className="mls-note mlm-wide">{tx("Your withdrawal was refused")}{i.withdrawal.note ? `: ${i.withdrawal.note}` : ''}.</p>}
                        {i.status === 'withdrawal_pending' && <p className="mls-note mlm-wide">{tx("Your request to withdraw is waiting for the administration.")}</p>}
                        {leave === key(i) && (
                          <div className="mlm-wide"><ReasonBox min={5} label={tx("Why does the group withdraw from this event?")} confirm="Send the request" busy={busy}
                            onCancel={() => setLeave('')}
                            onConfirm={async (reason) => { setBusy(true); try { await requestWithdrawal({ eventId: i.eventId, groupId: i.groupId, reason }); notify('Withdrawal request sent', 'success'); setLeave(''); await load(); } catch (er) { notify(er instanceof Error ? er.message : 'Could not send', 'error'); } finally { setBusy(false); } }} /></div>
                        )}
                      </li>
                    );
                  })}
                  {e.rows.length > (lim[e.eventId] ?? 12) && <li className="mlm-moreli"><button type="button" onClick={() => setLim({ ...lim, [e.eventId]: (lim[e.eventId] ?? 12) + 24 })}>{tx("Show")} {Math.min(24, e.rows.length - (lim[e.eventId] ?? 12))} {tx("more of")} {e.rows.length - (lim[e.eventId] ?? 12)} {tx("groups")}</button></li>}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      {choose && <Chooser item={choose} onClose={() => setChoose(null)} onDone={() => { setChoose(null); void load(); }} />}
    </section>
  );
}

function Chooser({ item, onClose, onDone }: { item: MyListItem; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<EventParticipation | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    getEventParticipation({ eventId: item.eventId, groupId: item.groupId }).then((r) => {
      setD(r.data);
      const r0 = r.data.roster ?? [];
      const had = r0.filter((m) => m.included).map((m) => m.userId);
      setPick(new Set(had.length ? had : r0.filter((m) => !m.substitute).map((m) => m.userId)));
    }).catch((e) => setErr(e instanceof Error ? e.message : tx("Could not load the members")));
  }, [item.eventId, item.groupId]);

  const roster = useMemo(() => (d?.roster ?? []).filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase())), [d, q]);
  const all = d?.roster ?? [];
  const toggle = (id: string) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function send() {
    setBusy(true); setErr('');
    try { const r = await submitParticipantList({ eventId: item.eventId, groupId: item.groupId, memberIds: [...pick] }); notify(r.data.late ? 'List sent, after the deadline' : 'List sent for review', 'success'); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : tx("Could not send the list")); setBusy(false); }
  }

  return createPortal(
    <div className="mls-modal" role="dialog" aria-modal="true" aria-label={tx("Choose the members")} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mls-sheet">
        <header><div><h3>{item.groupName}</h3><p>{item.title} · {dateOf(item.startMs)}</p></div><button type="button" className="mls-x" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="mls-sheet-bar">
          <input type="search" placeholder={tx("Search a member")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" onClick={() => setPick(new Set(all.map((m) => m.userId)))}>{tx("All")}</button>
          <button type="button" onClick={() => setPick(new Set(all.filter((m) => !m.substitute).map((m) => m.userId)))}>{tx("Permanent only")}</button>
          <button type="button" onClick={() => setPick(new Set())}>{tx("None")}</button>
        </div>
        <ul className="mls-pick">
          {!d && !err && <li className="none">{tx("Loading the members…")}</li>}
          {roster.map((m) => (
            <li key={m.userId}>
              <label className={pick.has(m.userId) ? 'on' : ''}>
                <input type="checkbox" checked={pick.has(m.userId)} onChange={() => toggle(m.userId)} />
                <Avatar name={m.name} photoUrl={m.photoUrl} size={30} />
                <span className="mls-n"><b>{m.name}</b><small className={m.substitute ? 'sub' : 'perm'}>{m.substitute ? tx("Substitute") : tx("Permanent")}</small></span>
              </label>
            </li>
          ))}
          {d && roster.length === 0 && <li className="none">{tx("No member found.")}</li>}
        </ul>
        {err && <p className="mls-note bad">{err}</p>}
        <footer>
          <span><b>{pick.size}</b> {tx("of")} {all.length} {tx("chosen")}</span>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{tx("Cancel")}</button>
          <button type="button" className="btn btn-primary" disabled={busy || pick.size === 0} onClick={() => void send()}>{busy ? tx("Sending…") : tx("Send the list")}</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

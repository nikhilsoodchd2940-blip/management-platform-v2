'use client';

import { limit as fsLimit, where, Timestamp } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { formatDuration, formatInZone } from '@/lib/timeZones';
import { ResourcePicker } from './BookPicker';
import { SELECTION_LABEL, type Selection, type Slot } from './planParts';
import { tx } from '@/lib/i18n/tr';

/** What a Group Admin sees first: their group's performance slots and what to do for each one. */
export default function MyPerformances({ titleOf, cancelledIds }: { titleOf: (eventId: string) => string; cancelledIds: string[] }) {
  const { byId } = useGroupHierarchy();
  const { scope } = useMyScope();
  const since = useMemo(() => Timestamp.fromMillis(Math.floor(Date.now() / 86400000) * 86400000 - 7 * 86400000), []);
  // The slots of the groups this account manages, asked for by group (no index needed), then filtered by date here.
  const myIds = (scope?.groupIds ?? []).slice(0, 30);
  const allSlots = useCollection<Slot>('eventSlots', [where('groupId', 'in', myIds.length ? myIds : ['none'])], `mine-${myIds.join(',')}`);
  const sinceMs = tsMs(since);
  const slots = allSlots === null ? null : allSlots.filter((s) => tsMs(s.endAt) >= sinceMs);
  const sels = useCollection<Selection>('performanceSelections', [fsLimit(500)], 'mine-sel');
  const myGroupIds = myIds;
  const invited = useCollection<{ title?: string; status?: string; subGroupIds?: string[]; startAt?: unknown }>('events', [where('subGroupIds', 'array-contains-any', myGroupIds.length ? myGroupIds : ['none']), where('status', '==', 'published')], `inv-${myGroupIds.join(',')}`);
  const mine = (slots ?? []).filter((s) => !cancelledIds.includes(s.eventId)).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt));

  const [q, setQ] = useState('');
  const [state, setState] = useState<'all' | 'todo' | 'waiting' | 'approved'>('todo');
  const [when, setWhen] = useState<'upcoming' | 'today' | 'week' | 'past' | 'all'>('upcoming');
  const [fEvent, setFEvent] = useState('');
  const [fGroup, setFGroup] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState<Slot | null>(null);
  const [more, setMore] = useState<Record<string, number>>({});

  const stateOf = (id: string): 'todo' | 'waiting' | 'approved' => {
    const st = sels?.find((x) => x.id === id)?.status;
    return st === 'approved' ? 'approved' : st === 'submitted' ? 'waiting' : 'todo';
  };
  const nowMs = Date.now();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const inWhen = (s: Slot) => {
    const t = tsMs(s.startAt);
    if (when === 'all') return true;
    if (when === 'past') return tsMs(s.endAt) < nowMs;
    if (when === 'upcoming') return tsMs(s.endAt) >= nowMs;
    if (when === 'today') return t >= dayStart.getTime() && t < dayStart.getTime() + 86400000;
    return t >= dayStart.getTime() && t < dayStart.getTime() + 7 * 86400000;
  };
  const term = q.trim().toLowerCase();
  const base = mine.filter((s) => inWhen(s) && (!fEvent || s.eventId === fEvent) && (!fGroup || s.groupId === fGroup) && (!term || s.groupName.toLowerCase().includes(term) || (titleOf(s.eventId) || '').toLowerCase().includes(term) || (byId[s.cityId]?.name ?? '').toLowerCase().includes(term)));
  const count = { all: base.length, todo: base.filter((s) => stateOf(s.id) === 'todo').length, waiting: base.filter((s) => stateOf(s.id) === 'waiting').length, approved: base.filter((s) => stateOf(s.id) === 'approved').length };
  const shown = base.filter((s) => state === 'all' || stateOf(s.id) === state);
  const events = Array.from(new Set(mine.map((s) => s.eventId)));
  const groupsOf = Array.from(new Map(mine.map((s) => [s.groupId, s.groupName])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const byEvent = Array.from(shown.reduce((m, s) => m.set(s.eventId, [...(m.get(s.eventId) ?? []), s]), new Map<string, Slot[]>()).entries());
  const filtered = !!(q || fEvent || fGroup || when !== 'upcoming' || state !== 'todo');
  const reset = () => { setQ(''); setFEvent(''); setFGroup(''); setWhen('upcoming'); setState('todo'); };

  return (
    <section className="card" style={{ margin: '1rem 0' }}>
      <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{tx("Your group's performances")}</h2>
      <p style={{ fontSize: '0.84rem', color: '#5b6776', margin: '0.2rem 0 0.6rem' }}>{tx("For each slot: choose the books you will perform (it must fit the time allowed), then submit it. The Super Admin approves or rejects it, and you are told the reason if it is rejected.")}</p>
      {slots === null ? <p>{tx("Loading…")}</p> : mine.length === 0 ? (
        <div className="fx2-empty">
          {(scope?.groupIds ?? []).length === 0 ? (
            <p>{tx("Your account is not assigned to any group yet. Ask the Super Admin to assign your group in Role & Access Management.")}</p>
          ) : (
            <>
              {(invited ?? []).filter((e) => !cancelledIds.includes(e.id)).length > 0 ? (
                <>
                  <p>{tx("Your group is invited to")} {(invited ?? []).filter((e) => !cancelledIds.includes(e.id)).map((e) => `“${e.title ?? 'an event'}”`).join(', ')}{tx(", but its performance time has not been set yet. You will be notified as soon as the Super Admin gives it a slot.")}</p>
                </>
              ) : (
                <p>{tx("No performance slot has been given to your group yet. You will be notified when one is.")}</p>
              )}
              <p style={{ fontSize: '0.82rem' }}>{tx("Your account manages:")} <strong>{(scope?.groupIds ?? []).map((g) => byId[g]?.name ?? g).join(', ')}</strong>.{' '}
                </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mp-filters">
            <input type="search" placeholder={tx("Search a group, an event or a city")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search")} />
            <select value={fEvent} onChange={(e) => setFEvent(e.target.value)} aria-label={tx("Event")}><option value="">{tx("All events")}</option>{events.map((id) => <option key={id} value={id}>{titleOf(id) || tx("Event")}</option>)}</select>
            {groupsOf.length > 1 && <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} aria-label={tx("Group")}><option value="">{tx("All my groups")}</option>{groupsOf.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
            <select value={when} onChange={(e) => setWhen(e.target.value as typeof when)} aria-label={tx("When")}><option value="upcoming">{tx("Not finished yet")}</option><option value="today">{tx("Today")}</option><option value="week">{tx("Next 7 days")}</option><option value="past">{tx("Already finished")}</option><option value="all">{tx("Any date")}</option></select>
          </div>
          <div className="mp-chips" role="tablist" aria-label={tx("What to do")}>
            {([['todo', 'Books to choose'], ['waiting', 'Waiting for approval'], ['approved', 'Approved'], ['all', 'All']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={state === k} className={`${state === k ? 'on' : ''} ${k}`} onClick={() => setState(k)}>{label} <em>{count[k]}</em></button>
            ))}
            {filtered && <button type="button" className="mp-reset" onClick={reset}>{tx("Reset filters")}</button>}
          </div>

          {shown.length === 0 ? (
            <p className="fx2-empty">{state === 'todo' && !q && !fEvent && !fGroup ? tx("Nothing to choose here. Every performance in this list has its books.") : tx("No performance matches these filters.")}</p>
          ) : byEvent.map(([eid, list]) => {
            const isOpen = open[eid] !== false;
            const lim = more[eid] ?? 15;
            const todoN = list.filter((s) => stateOf(s.id) === 'todo').length;
            return (
              <section key={eid} className="mp-ev">
                <button type="button" className="mp-evh" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [eid]: !isOpen }))}>
                  <b>{titleOf(eid) || tx("Event")}</b>
                  <span>{list.length} {tx("performance")}{list.length === 1 ? '' : 's'}{todoN ? ` · ${todoN} to choose` : tx(" · all chosen")}</span>
                  <i aria-hidden="true">{isOpen ? '▾' : '▸'}</i>
                </button>
                {isOpen && (
                  <div className="mp-rows">
                    {list.slice(0, lim).map((s) => {
                      const sel = sels?.find((x) => x.id === s.id);
                      const st = SELECTION_LABEL[sel?.status ?? 'none'];
                      const todo = !sel || sel.status === 'rejected' || sel.status === 'needs_revision' || sel.status === 'draft';
                      return (
                        <article key={s.id} className={`mp-row ${stateOf(s.id)}`}>
                          <div className="mp-when"><b>{formatInZone(tsMs(s.startAt), s.timeZone)}</b><small>{formatDuration(s.allocatedSeconds)} {tx("allowed")}</small></div>
                          <div className="mp-grp"><b>{s.groupName}</b><small>{byId[s.cityId]?.name ?? ''}</small></div>
                          <div className="mp-sel"><span className={`fx2-pill ${st.cls}`}>{st.text}</span>{sel?.reason && <small className="mp-why">{tx("Reason:")} {sel.reason}</small>}</div>
                          <button type="button" className={`fx2-btn${todo ? ' primary' : ''}`} onClick={() => setPicking(s)}>{todo ? tx("Choose books") : tx("Change books")}</button>
                        </article>
                      );
                    })}
                    {list.length > lim && <button type="button" className="mp-more" onClick={() => setMore((m) => ({ ...m, [eid]: lim + 30 }))}>{tx("Show")} {Math.min(30, list.length - lim)} {tx("more of")} {list.length - lim}</button>}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
      {picking && <ResourcePicker slot={picking} current={sels?.find((x) => x.id === picking.id)} onClose={() => setPicking(null)} />}
    </section>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { where } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { formatInZone } from '@/lib/timeZones';
import type { Slot } from './planParts';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { useUserProfiles } from '@/lib/useUserNames';
import { tiersOf } from './tiers';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface PlanSite { id: string; name: string; address?: string; lat?: number; lng?: number; groupIds?: string[]; supervisorName?: string }
interface PlanShift {
  id: string;
  label: string;
  startAt?: { toMillis?: () => number };
  endAt?: { toMillis?: () => number };
  siteId?: string;
  siteIds?: string[];
  supervisors: { userId: string; name: string; role: 'main' | 'member' }[];
}

const hm = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cleanLabel = (s: string) => s.replace(/\s*·?\s*\d{1,2}:\d{2}\s*to\s*\d{1,2}:\d{2}\s*$/, '').trim();

/** The groups of one place: a few chips, and for a long list a searchable scrolling dropdown (a place can hold hundreds of groups). */
function PlaceGroups({ ids, name }: { ids: string[]; name: (id: string) => string }) {
  const [q, setQ] = useState('');
  if (ids.length === 0) return <i className="edp-none">{tx("No group yet. Open Edit event, then Places, to choose which groups perform here.")}</i>;
  const SHOW = 4;
  const term = q.trim().toLowerCase();
  const list = ids.map((g) => ({ g, n: name(g) })).filter((x) => !term || x.n.toLowerCase().includes(term));
  return (
    <>
      <div className="edp-chips">{ids.slice(0, SHOW).map((g) => <span key={g}>{name(g)}</span>)}{ids.length > SHOW && <span className="edp-plus">+{ids.length - SHOW} {tx("more")}</span>}</div>
      {ids.length > SHOW && (
        <details className="edp-more">
          <summary>{tx("See all")} {ids.length} {tx("groups")}</summary>
          <label className="edp-find"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search a group")} aria-label={tx("Search a group of this place")} /></label>
          <ul className="edp-glist">
            {list.length === 0 ? <li className="none">{tx("No group matches.")}</li> : list.map((x) => <li key={x.g}>{x.n}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/** Everything about one event on one screen: every place with its groups and supervisors, then every day with its shifts and group slots. */
export default function EventDayPlanner({ eventId, startMs, endMs, sites, shifts, groupIds, groupName, cityName, onChangeSupervision, part }: {
  part?: 'places' | 'days';
  eventId: string;
  startMs: number;
  endMs: number;
  sites: PlanSite[];
  shifts: PlanShift[];
  groupIds: string[];
  groupName: (id: string) => string;
  cityName: (id: string) => string;
  /** Opens the supervisor editor. Not given to people who cannot change supervision. */
  onChangeSupervision?: () => void;
}) {
  const faces = useUserProfiles(shifts.flatMap((sh) => sh.supervisors.map((p) => p.userId)));
  const slots = useCollection<Slot>('eventSlots', [where('eventId', '==', eventId)], eventId);

  const siteName = (id?: string) => sites.find((s) => s.id === id)?.name ?? '';
  const shiftSites = (sh: PlanShift) => (sh.siteIds?.length ? sh.siteIds : sh.siteId ? [sh.siteId] : []);

  const tiers = useMemo(() => tiersOf(shifts, sites.map((x) => x.id)), [shifts, sites]);
  const heads = useMemo(() => { const m = new Map<string, string>(); shifts.forEach((sh) => sh.supervisors.forEach((p) => { if (tiers.get(p.userId) === 'head') m.set(p.userId, p.name); })); return [...m.entries()]; }, [shifts, tiers]);
  const places = useMemo(() => sites.map((s) => {
    // A shift that names no place covers every place, so its supervisors count for each one.
    const mine = shifts.filter((sh) => { const ids = shiftSites(sh); return ids.length === 0 || ids.includes(s.id); });
    const mgrs = new Map<string, string>();
    const team = new Map<string, string>();
    mine.forEach((sh) => sh.supervisors.forEach((p) => {
      const t = tiers.get(p.userId);
      if (t === 'manager') mgrs.set(p.userId, p.name);
      else if (t === 'staff') team.set(p.userId, p.name);
    }));
    return { site: s, mgrs: [...mgrs.entries()], team: [...team.entries()], count: mine.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sites, shifts, tiers]);
  const unplaced = shifts.filter((sh) => shiftSites(sh).length === 0);

  const days = useMemo(() => {
    type Row = { at: number; end: number; kind: 'shift' | 'slot'; title: string; sub: string; mains?: [string, string][]; team?: [string, string][] };
    const m = new Map<string, Row[]>();
    const add = (ms: number, r: Row) => { const k = dayKey(ms); m.set(k, [...(m.get(k) ?? []), r]); };
    shifts.forEach((sh) => {
      const a = sh.startAt?.toMillis?.() ?? 0, b = sh.endAt?.toMillis?.() ?? 0;
      if (!a) return;
      const where2 = shiftSites(sh).map(siteName).filter(Boolean).join(', ');
      const mains = sh.supervisors.filter((p) => p.role === 'main').map((p) => [p.userId, p.name] as [string, string]);
      const team = sh.supervisors.filter((p) => p.role === 'member').map((p) => [p.userId, p.name] as [string, string]);
      add(a, { at: a, end: b, kind: 'shift', title: cleanLabel(sh.label) || tx("Shift"), sub: where2 || tx("All places"), mains, team });
    });
    (slots ?? []).filter((s) => groupIds.includes(s.groupId)).forEach((s) => {
      const a = tsMs(s.startAt), b = tsMs(s.endAt);
      add(a, { at: a, end: b, kind: 'slot', title: s.groupName || groupName(s.groupId), sub: `${cityName(s.groupId) || 'City'} · local ${formatInZone(a, s.timeZone, false)} to ${formatInZone(b, s.timeZone, false)}` });
    });
    // Every calendar day of the event, even the empty ones.
    const keys = new Set(m.keys());
    if (startMs && endMs >= startMs) {
      const d = new Date(startMs); d.setHours(12, 0, 0, 0);
      let n = 0;
      while (d.getTime() <= endMs + 86400000 && dayKey(d.getTime()) <= dayKey(endMs) && n < 400) { keys.add(dayKey(d.getTime())); d.setDate(d.getDate() + 1); n += 1; }
    }
    return [...keys].sort().map((k) => ({ key: k, rows: (m.get(k) ?? []).sort((a, b) => a.at - b.at || (a.kind === 'shift' ? -1 : 1)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, slots, startMs, endMs, sites, groupIds]);

  const slotDays = days.map((d, i) => (d.rows.some((r) => r.kind === 'slot') ? i + 1 : 0)).filter(Boolean);

  // One day is shown at a time, so thirty days are thirty small buttons, never thirty long blocks.
  const todayKey = dayKey(Date.now());
  const [pick, setPick] = useState('');
  const current = days.find((d) => d.key === pick) ?? days.find((d) => d.key === todayKey) ?? days[0];
  const idx = current ? days.indexOf(current) : 0;
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('button.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current?.key]);
  const sh = current?.rows.filter((r) => r.kind === 'shift') ?? [];
  const sl = current?.rows.filter((r) => r.kind === 'slot') ?? [];
  const shortDay = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const [find, setFind] = useState('');
  const term = find.trim().toLowerCase();
  const slShown = sl.filter((r) => !term || r.title.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term));

  return (
    <div className="edp">
      {part !== 'days' && <>
      <div className="edp-head"><h3>{tx("Places")}</h3><span>{sites.length} {tx("place")}{sites.length === 1 ? '' : 's'}</span></div>
      <div className="edp-boss">
        <span className="edp-role head">{tx("Main event supervisor")}</span>
        {heads.length ? <div className="edp-bossppl">{heads.map(([id, n]) => <PersonLink key={id} userId={id}><Avatar name={n} photoUrl={faces[id]?.photoUrl} size={44} /><b>{n}</b><small>{tx("Oversees every place")}</small></PersonLink>)}</div> : <i className="edp-none">{tx("Not appointed yet")}</i>}
      </div>
      <div className="edp-places">
        {places.length === 0 && <p className="edp-empty">{tx("No place has been set for this event.")}</p>}
        {places.map((p, i) => {
          const gs = p.site.groupIds ?? [];
          const row = (list: [string, string][], none: string) => (list.length ? <div className="edp-rows">{list.map(([id, n]) => <PersonLink key={id} userId={id}><Avatar name={n} photoUrl={faces[id]?.photoUrl} size={34} /><b>{n}</b></PersonLink>)}</div> : <i className="edp-none">{none}</i>);
          return (
            <div className="edp-place" key={p.site.id}>
              <div className="edp-ph"><b className="edp-n">{i + 1}</b><div><strong>{p.site.name}</strong>{p.site.address && <small>{p.site.address}</small>}</div><em className="edp-cnt">{p.count} {tx("shift")}{p.count === 1 ? '' : 's'}</em></div>
              <div className="edp-blk"><span className="edp-role manager">{tx("Site manager")}</span><small className="edp-duty">{tx("Looks after the place and its staff")}</small>{row(p.mgrs, 'No site manager yet')}</div>
              <div className="edp-blk"><span className="edp-role staff">{tx("Site staff")} <em>{p.team.length}</em></span><small className="edp-duty">{tx("Run the group performances")}</small>{row(p.team, 'No staff yet')}</div>
              <div className="edp-blk"><span className="edp-role grp">{tx("Groups")} <em>{gs.length}</em></span><PlaceGroups ids={gs} name={groupName} /></div>
            </div>
          );
        })}
        {unplaced.length > 0 && <p className="edp-empty edp-all">{unplaced.length} {tx("shift")}{unplaced.length === 1 ? tx(" covers") : tx("s cover")} {tx("every place.")}</p>}
      </div>
      </>}

      {part !== 'places' && <>
      <div className="edp-head">
        <h3>{tx("Day by day")}</h3>
        <div className="edp-headr">
          {onChangeSupervision && <button type="button" className="edp-change" onClick={onChangeSupervision}>{tx("Change the supervisors")}</button>}
          <span>{days.length} {tx("day")}{days.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      {slotDays.length > 0 && slotDays.length < days.length && days.length <= 7 && (
        <p className="edp-note">{tx("The groups are scheduled on")} {slotDays.length === 1 ? `Day ${slotDays[0]}` : `Days ${slotDays.join(', ')}`} {tx("only. Open the event plan to place groups on the other days.")}</p>
      )}
      {current && (
        <div className="edp-view">
          <div className="edp-nav">
            <button type="button" className="edp-arrow" disabled={idx === 0} onClick={() => setPick(days[idx - 1].key)} aria-label={tx("Previous day")}>‹</button>
            <div className="edp-strip" ref={strip}>
              {days.map((d, i) => {
                const n = d.rows.length;
                return (
                  <button type="button" key={d.key} className={`${d.key === current.key ? 'on' : ''}${n === 0 ? ' empty' : ''}`} onClick={() => setPick(d.key)}>
                    <b>{tx("Day")} {i + 1}</b><small>{shortDay(d.key)}</small><i>{n || '–'}</i>
                  </button>
                );
              })}
            </div>
            <button type="button" className="edp-arrow" disabled={idx === days.length - 1} onClick={() => setPick(days[idx + 1].key)} aria-label={tx("Next day")}>›</button>
          </div>
          <div className="edp-dayh"><b>{tx("Day")} {idx + 1}</b><span>{new Date(`${current.key}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>

          <section className="edp-sec sup">
            <h4>{tx("Supervision")} <em>{sh.length} {tx("shift")}{sh.length === 1 ? '' : 's'}</em></h4>
            {sh.length === 0 ? <p className="edp-line">{tx("No supervision shift this day.")}</p> : (
              <div className="edp-cards sups">
                {sh.map((r, k) => (
                  <div className="edp-card" key={k}>
                    <time>{hm(r.at)} <i>{tx("to")}</i> {r.end ? hm(r.end) : '—'}</time>
                    <strong>{r.sub}</strong>
                    <span className="edp-ppl">{r.mains?.length ? r.mains.map(([id, n]) => <PersonLink key={id} userId={id} as="em"><Avatar name={n} photoUrl={faces[id]?.photoUrl} size={20} />{n}</PersonLink>) : <i className="edp-none">{tx("No supervisor")}</i>}</span>
                    {!!r.team?.length && <span className="edp-ppl team">{r.team.map(([id, n]) => <PersonLink key={id} userId={id} as="em"><Avatar name={n} photoUrl={faces[id]?.photoUrl} size={20} />{n} <small className="edp-tag staff">{tx("Staff")}</small></PersonLink>)}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="edp-sec slot">
            <h4>{tx("Group schedule")} <em>{sl.length} {tx("group")}{sl.length === 1 ? '' : 's'}{sl.length > 0 ? ` · ${hm(sl[0].at)} to ${hm(Math.max(...sl.map((r) => r.end || r.at)))}` : ''}</em></h4>
            {sl.length === 0 ? <p className="edp-line">{tx("No group is scheduled this day.")}</p> : (
              <>
                {sl.length > 8 && (
                  <div className="edp-tools">
                    <label className="edp-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx("Search a group or a city")} aria-label={tx("Search a group or a city")} />{find && <button type="button" aria-label={tx("Clear the search")} onClick={() => setFind('')}>×</button>}</label>
                    <span>{slShown.length} {tx("of")} {sl.length}</span>
                  </div>
                )}
                <div className="edp-table" role="table">
                  <div className="edp-trow head" role="row"><span>{tx("Time")}</span><span>{tx("Group")}</span><span>{tx("City and local time")}</span></div>
                  {slShown.length === 0 && <p className="edp-line">{tx("No group matches “")}{find}”.</p>}
                  {slShown.map((r, k) => (
                    <div className="edp-trow" role="row" key={k}>
                      <time>{hm(r.at)} <i>{tx("to")}</i> {r.end ? hm(r.end) : '—'}</time>
                      <strong>{r.title}</strong>
                      <span>{r.sub}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      </>}
    </div>
  );
}

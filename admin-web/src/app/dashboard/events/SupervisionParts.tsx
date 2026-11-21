'use client';

import { useMemo, useState } from 'react';
import MemberPicker, { Avatar, type PickedMember } from '@/components/MemberPicker';
import { ViewProfile } from '@/components/MemberProfile';
import type { ShiftDraft, ShiftPerson, SiteDraft } from './eventPlanTypes';
import { longDate } from './eventPlanTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

const dayShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Compact text for a list of days: "Day 1-3, Day 6". */
function rangeText(idx: number[]): string {
  const s = [...idx].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j += 1;
    out.push(j > i ? `Days ${s[i] + 1}–${s[j] + 1}` : `Day ${s[i] + 1}`);
    i = j + 1;
  }
  return out.join(', ');
}

/**
 * Supervision by part of the event. Choose WHEN (the whole event, or only some days, optionally some places)
 * and WHO (supervisors and staff), then add them to those shifts. Repeat for the next part with other people.
 * The same person can cover the whole event, and different people can cover different parts.
 */
export default function SupervisionParts({
  shifts,
  setShifts,
  sites,
  eventDays,
  performing = [],
}: {
  shifts: ShiftDraft[];
  setShifts: (s: ShiftDraft[]) => void;
  sites: SiteDraft[];
  eventDays: string[];
  performing?: string[];
}) {
  const days = useMemo(() => {
    const set = new Set(shifts.map((s) => s.startAt.slice(0, 10)));
    const base = eventDays.length ? eventDays : [];
    return Array.from(new Set([...base, ...set])).sort();
  }, [shifts, eventDays]);
  const [scope, setScope] = useState<'all' | 'days'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [placeIds, setPlaceIds] = useState<string[]>([]);
  const [role, setRole] = useState<'main' | 'member'>('main');
  const [ids, setIds] = useState<string[]>([]);
  const [people, setPeople] = useState<PickedMember[]>([]);
  const [done, setDone] = useState('');

  const target = shifts.filter((s) => {
    if (scope === 'days' && !picked.includes(s.startAt.slice(0, 10))) return false;
    if (placeIds.length && s.siteIds.length && !s.siteIds.some((x) => placeIds.includes(x))) return false;
    return true;
  });

  const toggleDay = (d: string) => { setDone(''); setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d])); };
  const pickRange = (from: number, to: number) => { setDone(''); setScope('days'); setPicked(days.slice(from, to)); };

  const apply = (mode: 'add' | 'replace') => {
    if (!ids.length || !target.length) return;
    const tid = new Set(target.map((t) => t.id));
    const info = new Map(people.map((p) => [p.id, p]));
    setShifts(shifts.map((sh) => {
      if (!tid.has(sh.id)) return sh;
      // A person has one role per shift: the new role replaces the old one.
      let list = sh.people.filter((p) => !ids.includes(p.userId));
      if (mode === 'replace') list = list.filter((p) => p.role !== role);
      const added: ShiftPerson[] = ids.map((id) => {
        const old = sh.people.find((p) => p.userId === id && p.role === role);
        return old ?? { userId: id, name: info.get(id)?.name ?? id, photoUrl: info.get(id)?.photoUrl, role };
      });
      return { ...sh, people: [...list, ...added] };
    }));
    setDone(`${ids.length} ${role === 'main' ? (ids.length === 1 ? 'supervisor' : 'supervisors') : 'staff'} added to ${target.length} shift${target.length === 1 ? '' : 's'}.`);
    setIds([]);
    setPeople([]);
  };

  const removeEverywhere = (userId: string) => setShifts(shifts.map((sh) => ({ ...sh, people: sh.people.filter((p) => p.userId !== userId).map((p) => (p.leaderId === userId ? { ...p, leaderId: undefined } : p)) })));

  // Who covers what, built from the shifts themselves.
  const cover = useMemo(() => {
    const m = new Map<string, { p: ShiftPerson; days: Set<number>; shifts: number }>();
    for (const sh of shifts) {
      const di = days.indexOf(sh.startAt.slice(0, 10));
      for (const p of sh.people) {
        const c = m.get(p.userId) ?? { p, days: new Set<number>(), shifts: 0 };
        c.shifts += 1;
        if (di >= 0) c.days.add(di);
        if (p.role === 'main') c.p = p;
        m.set(p.userId, c);
      }
    }
    return [...m.values()].sort((a, b) => Number(b.p.role === 'main') - Number(a.p.role === 'main') || b.shifts - a.shifts);
  }, [shifts, days]);

  const allDays = days.length;
  if (shifts.length === 0) return null;

  return (
    <section className="spt" aria-label={tx("Supervision by part of the event")}>
      <header className="spt-h">
        <span className="spt-ic" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18M8 15h3" /></svg>
        </span>
        <div>
          <h4>{tx("Supervisors by part of the event")}</h4>
          <p>{tx("Pick the part, pick the people, then add them. The same people can cover the whole event, or different people can cover different days.")}</p>
        </div>
      </header>

      <div className="spt-grid">
        <div className="spt-step">
          <h5><span>1</span> {tx("When")}</h5>
          <div className="spt-seg" role="radiogroup" aria-label={tx("Part of the event")}>
            <button type="button" role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => { setScope('all'); setDone(''); }}>{tx("Whole event")}<small>{allDays} {tx("day")}{allDays === 1 ? '' : 's'}</small></button>
            <button type="button" role="radio" aria-checked={scope === 'days'} className={scope === 'days' ? 'on' : ''} onClick={() => { setScope('days'); setDone(''); }}>{tx("Only some days")}<small>{picked.length ? `${picked.length} chosen` : tx("choose below")}</small></button>
          </div>
          {scope === 'days' && (
            <>
              <div className="spt-quick">
                <button type="button" onClick={() => pickRange(0, days.length)}>{tx("All days")}</button>
                {days.length > 3 && <button type="button" onClick={() => pickRange(0, Math.ceil(days.length / 2))}>{tx("First half")}</button>}
                {days.length > 3 && <button type="button" onClick={() => pickRange(Math.ceil(days.length / 2), days.length)}>{tx("Second half")}</button>}
                <button type="button" onClick={() => { setPicked([]); setDone(''); }}>{tx("Clear")}</button>
              </div>
              <div className="spt-days">
                {days.map((d, i) => (
                  <button type="button" key={d} className={picked.includes(d) ? 'on' : ''} aria-pressed={picked.includes(d)} onClick={() => toggleDay(d)} title={longDate(d)}>
                    <b>{tx("Day")} {i + 1}</b><small>{dayShort(d)}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {sites.length > 1 && (
            <div className="spt-places">
              <span>{tx("Place")} <small>{tx("(none ticked = every place)")}</small></span>
              {sites.map((s) => (
                <label key={s.id}><input type="checkbox" checked={placeIds.includes(s.id)} onChange={(e) => { setDone(''); setPlaceIds(e.target.checked ? [...placeIds, s.id] : placeIds.filter((x) => x !== s.id)); }} />{s.name || tx("Place")}</label>
              ))}
            </div>
          )}
          <p className={`spt-count${target.length ? '' : ' zero'}`}>{target.length ? <>{tx("This part has")} <b>{target.length}</b> {tx("shift")}{target.length === 1 ? '' : 's'}.</> : tx("No shift matches. Choose at least one day.")}</p>
        </div>

        <div className="spt-step">
          <h5><span>2</span> {tx("Who")}</h5>
          <div className="spt-seg" role="radiogroup" aria-label={tx("Role")}>
            <button type="button" role="radio" aria-checked={role === 'main'} className={role === 'main' ? 'on' : ''} onClick={() => { setRole('main'); setIds([]); setPeople([]); }}>{tx("Supervisors")}<small>{tx("main or site manager")}</small></button>
            <button type="button" role="radio" aria-checked={role === 'member'} className={role === 'member' ? 'on' : ''} onClick={() => { setRole('member'); setIds([]); setPeople([]); }}>{tx("Site staff")}<small>{tx("work under a manager")}</small></button>
          </div>
          <MemberPicker
            key={role}
            multiple
            value={ids}
            selected={people}
            disabledIds={performing}
            disabledReason={Object.fromEntries(performing.map((id) => [id, 'Performing in this event']))}
            onChange={(v, p) => { setDone(''); setIds(v); setPeople(p); }}
          />
          <div className="spt-act">
            <button type="button" className="btn btn-primary" disabled={!ids.length || !target.length} onClick={() => apply('add')}>{tx("Add to")} {scope === 'all' ? tx("the whole event") : `${target.length} shift${target.length === 1 ? '' : 's'}`}</button>
            <button type="button" className="btn btn-secondary" disabled={!ids.length || !target.length} onClick={() => apply('replace')} title={tx("Remove the current people of this role from these shifts first")}>{tx("Replace the current")} {role === 'main' ? tx("supervisors") : tx("staff")}</button>
          </div>
          {done && <p className="spt-ok" role="status">✓ {done}</p>}
        </div>
      </div>

      <div className="spt-cover">
        <h5>{tx("Who covers what")} <small>{cover.length ? `${cover.length} ${cover.length === 1 ? 'person' : 'people'}` : ''}</small></h5>
        {cover.length === 0 ? <p className="spt-none">{tx("Nobody is assigned yet. Your choices appear here.")}</p> : (
          <ul>
            {cover.map((c) => {
              const whole = c.days.size >= allDays && allDays > 0;
              return (
                <li key={c.p.userId}>
                  <Avatar name={c.p.name} photoUrl={c.p.photoUrl} size={34} />
                  <span className="spt-who"><b>{c.p.name} <ViewProfile userId={c.p.userId} /></b><small>{c.p.role === 'main' ? tx("Supervisor") : tx("Site staff")} · {c.shifts} {tx("shift")}{c.shifts === 1 ? '' : 's'}</small></span>
                  <span className={`spt-pill${whole ? ' all' : ''}`}>{whole ? tx("Whole event") : rangeText([...c.days])}</span>
                  <button type="button" className="spt-rm" onClick={() => removeEverywhere(c.p.userId)} aria-label={`Remove ${c.p.name} from every shift`} title={tx("Remove from every shift")}>{tx("Remove")}</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

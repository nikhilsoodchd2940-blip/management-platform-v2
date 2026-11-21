'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import DateTimePicker from '@/components/DateTimePicker';
import TimeSelect from '@/components/TimeSelect';
import MemberPicker, { Avatar, type PickedMember } from '@/components/MemberPicker';
import { ViewProfile } from '@/components/MemberProfile';
import SupervisionParts from './SupervisionParts';
import TeamSetup, { TIER_LABEL, TIER_RIGHTS, tierOf } from './TeamSetup';
import { RIGHTS, hoursLabel, longDate, type ShiftDraft, type ShiftPerson, type SiteDraft } from './eventPlanTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

const uid = () => Math.random().toString(36).slice(2, 9);
const hm = (local: string) => local.slice(11, 16);

/**
 * Supervision shifts in two simple moves: 1) create the shifts (same length, for every day, and for
 * every place if there are several), 2) open a shift and choose who supervises. Advanced options
 * (places, groups, rights, who works under whom) are folded away.
 */
export default function SupervisionStep({
  shifts,
  setShifts,
  sites,
  startAt,
  endAt,
  eventDays,
  dayTimes,
  kurelIds,
  groups,
  minutesBetween,
  performances,
  toMs,
  allowPerformers = false,
}: {
  shifts: ShiftDraft[];
  setShifts: (s: ShiftDraft[]) => void;
  sites: SiteDraft[];
  startAt: string;
  endAt: string;
  eventDays: string[];
  dayTimes: Record<string, { start: string; end: string }>;
  kurelIds: string[];
  /** The groups of the event, to give a shift to some of them only. */
  groups: { id: string; name: string }[];
  /** Minutes between two local date-times, in the event's time zone. */
  minutesBetween: (a: string, b: string) => number;
  /** The group performances already planned, to warn when a supervisor performs during his own shift. */
  performances?: { id: string; groupId: string; groupName: string; startMs: number; endMs: number }[];
  /** Turns a shift's local date-time into milliseconds (same reading as when the shifts are saved). */
  toMs?: (local: string) => number;
  /** Event for a whole main group: members who perform may also be appointed as supervisors. */
  allowPerformers?: boolean;
}) {
  // People who perform in the kurels of this event cannot also be staff supervisors: they are on stage.
  const [performing, setPerforming] = useState<Set<string>>(new Set());
  useEffect(() => {
    let off = false;
    (async () => {
      const ids = new Set<string>();
      for (let n = 0; n < kurelIds.length; n += 30) {
        const snap = await getDocs(query(collection(db, 'groupMemberships'), where('groupId', 'in', kurelIds.slice(n, n + 30)), where('status', '==', 'active')));
        snap.docs.forEach((d) => ids.add(d.data().userId as string));
      }
      if (!off) setPerforming(ids);
    })().catch(() => undefined);
    return () => { off = true; };
  }, [kurelIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const busyReason = (extra: ShiftPerson[], why: string) => ({ ids: [...extra.map((p) => p.userId), ...(allowPerformers ? [] : performing)], reasons: { ...Object.fromEntries((allowPerformers ? [] : [...performing]).map((u) => [u, 'Performing in this event'])), ...Object.fromEntries(extra.map((p) => [p.userId, why])) } });
  const [hours, setHours] = useState('');
  const [chip, setChip] = useState('');
  const [perPlace, setPerPlace] = useState(true);
  const [open, setOpen] = useState('');
  const [undo, setUndo] = useState<ShiftDraft[] | null>(null);
  const remove = (ids: string[]) => { setUndo(shifts); setShifts(shifts.filter((x) => !ids.includes(x.id))); setOpen(''); };

  const update = (id: string, patch: Partial<ShiftDraft>) => setShifts(shifts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addMinutes = (local: string, mins: number) => {
    const d = new Date(`${local.slice(0, 16)}:00Z`);
    d.setUTCMinutes(d.getUTCMinutes() + mins);
    return d.toISOString().slice(0, 16);
  };
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name || 'Place';
  const placeLabel = (sh: ShiftDraft) => (sh.siteIds.length === 0 ? (sites.length > 1 ? 'All places' : '') : sh.siteIds.map(siteName).join(' + '));

  /** Every day runs from the start of the event hours to their end (breaks between sessions do not matter for supervision). */
  const windows = (): [string, string][] => {
    if (eventDays.length > 1) return eventDays.map((d) => [`${d}T${dayTimes[d]?.start ?? hm(startAt)}`, `${d}T${dayTimes[d]?.end ?? hm(endAt)}`] as [string, string]);
    return [[startAt, endAt]];
  };

  /** "4, 6, 5" gives shifts of 4 h, then 6 h, then 5 h (the last length repeats). One number gives equal shifts. */
  function lengths(text: string = hours): number[] {
    return text.split(/[,;\s]+/).map((x) => Math.round(Number(x.replace(',', '.')) * 60)).filter((m) => m >= 15);
  }

  function addToDay(list: ShiftDraft[]) {
    const last = [...list].sort((a, b) => a.endAt.localeCompare(b.endAt))[list.length - 1];
    const mins = lengths()[0] ?? 60;
    const s = last.endAt;
    const sh: ShiftDraft = { id: uid(), label: `Shift ${shifts.length + 1}`, startAt: s, endAt: addMinutes(s, mins), siteIds: [...last.siteIds], groupIds: [], people: [] };
    setShifts([...shifts, sh]);
    setOpen(sh.id);
  }

  function generate(text: string = hours) {
    const whole = text === 'day';
    const lens = whole ? [60] : lengths(text);
    if (!lens.length) return;
    const targets: (SiteDraft | null)[] = perPlace && sites.length > 1 ? sites : [null];
    const out: ShiftDraft[] = [];
    for (const [ws, we] of windows()) {
      for (const site of targets) {
        let cur = ws;
        let n = 0;
        while (minutesBetween(cur, we) > 0 && out.length < 300) {
          const left = minutesBetween(cur, we);
          const want = whole ? left : lens[Math.min(n, lens.length - 1)];
          // The first shift of a day always has the length you chose; later ones fill what is left of the day.
          const len = n === 0 ? want : Math.min(want, left);
          const end = addMinutes(cur, len);
          n += 1;
          out.push({ id: uid(), label: `${site ? `${site.name} · ` : ''}${hm(cur)} to ${hm(end)}`, startAt: cur, endAt: end, siteIds: site ? [site.id] : [], groupIds: [], people: [] });
          cur = end;
          if (n > 40) break;
        }
      }
    }
    out.sort((a, b) => a.startAt.localeCompare(b.startAt) || (a.siteIds[0] ?? '').localeCompare(b.siteIds[0] ?? ''));
    if (shifts.length) setUndo(shifts);
    setShifts(out);
    setOpen('');
  }

  const setRole = (sh: ShiftDraft, role: ShiftPerson['role'], ids: string[], picked: PickedMember[]) => {
    const keep = sh.people.filter((p) => p.role !== role);
    const old = new Map(sh.people.filter((p) => p.role === role).map((p) => [p.userId, p]));
    const added: ShiftPerson[] = ids.map((id) => {
      const o = old.get(id);
      if (o) return o;
      const p = picked.find((x) => x.id === id);
      return { userId: id, name: p?.name ?? id, photoUrl: p?.photoUrl, role };
    });
    update(sh.id, { people: [...keep, ...added] });
  };

  /** Gives the people of this shift to every other shift of the same place. */
  function copyToSamePlace(sh: ShiftDraft) {
    const key = sh.siteIds.join(',');
    setShifts(shifts.map((x) => (x.id !== sh.id && x.siteIds.join(',') === key ? { ...x, people: sh.people.map((p) => ({ ...p })) } : x)));
  }

  function copyToAll(sh: ShiftDraft) {
    setShifts(shifts.map((x) => (x.id === sh.id ? x : { ...x, people: sh.people.map((p) => ({ ...p })) })));
  }
  function copyFrom(from: ShiftDraft, to: ShiftDraft) {
    setShifts(shifts.map((x) => (x.id === to.id ? { ...x, people: from.people.map((p) => ({ ...p })) } : x)));
  }

  // ---- a supervisor who also performs with his own group during his shift
  const supIds = useMemo(() => Array.from(new Set(shifts.flatMap((s) => s.people.map((p) => p.userId)))).sort(), [shifts]);
  const supKey = supIds.join(',');
  const [memberOf, setMemberOf] = useState<Record<string, string[]>>({});
  const [kept, setKept] = useState<string[]>([]);
  const hasPerf = (performances?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasPerf || supIds.length === 0) { setMemberOf({}); return; }
    let off = false;
    (async () => {
      const out: Record<string, string[]> = {};
      for (let i = 0; i < supIds.length; i += 30) {
        const snap = await getDocs(query(collection(db, 'groupMemberships'), where('userId', 'in', supIds.slice(i, i + 30)), where('status', '==', 'active')));
        snap.docs.forEach((d) => { const x = d.data() as { userId: string; groupId: string }; (out[x.userId] ??= []).push(x.groupId); });
      }
      if (!off) setMemberOf(out);
    })().catch(() => undefined);
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey, hasPerf]);
  const clashes = (() => {
    if (!performances?.length || !toMs) return [];
    const out: { key: string; shift: ShiftDraft; person: ShiftPerson; perf: NonNullable<typeof performances>[number]; a: number; b: number }[] = [];
    for (const sh of shifts) {
      const a = toMs(sh.startAt), b = toMs(sh.endAt);
      for (const p of sh.people) {
        const gs = memberOf[p.userId];
        if (!gs) continue;
        for (const perf of performances) {
          if (gs.includes(perf.groupId) && perf.startMs < b && perf.endMs > a) out.push({ key: `${sh.id}|${p.userId}|${perf.id}`, shift: sh, person: p, perf, a, b });
        }
      }
    }
    return out.filter((c) => !kept.includes(c.key));
  })();
  const when = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  function dropFromShift(shiftId: string, userId: string) {
    setShifts(shifts.map((x) => (x.id === shiftId ? { ...x, people: x.people.filter((p) => p.userId !== userId).map((p) => (p.leaderId === userId ? { ...p, leaderId: undefined } : p)) } : x)));
  }

  const byDay = useMemo(() => {
    const m = new Map<string, ShiftDraft[]>();
    [...shifts].sort((a, b) => a.startAt.localeCompare(b.startAt)).forEach((s) => {
      const d = s.startAt.slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), s]);
    });
    return [...m.entries()];
  }, [shifts]);
  const ready = shifts.filter((s) => s.people.some((p) => p.role === 'main')).length;

  return (
    <>
      {clashes.length > 0 && (
        <div className="sv-clash" role="alert">
          <div className="sv-clash-h"><b>{clashes.length} {tx("supervisor")}{clashes.length === 1 ? '' : 's'} {tx("also perform")}{clashes.length === 1 ? 's' : ''} {tx("during the shift")}</b><span>{tx("A supervisor cannot watch the event while his own kurel is on stage. Remove him from the shift, change the shift or the performance time, or keep it on purpose.")}</span></div>
          <div className="sv-clash-list">
            {clashes.map((c) => (
              <div className="sv-clash-row" key={c.key}>
                <Avatar name={c.person.name} photoUrl={c.person.photoUrl} size={30} />
                <div className="sv-clash-t"><b>{c.person.name} <ViewProfile userId={c.person.userId} /></b><span>{TIER_LABEL[tierOf(shifts, sites, c.person.userId)]} · {c.shift.label} · {when(c.a)} {tx("to")} {clock(c.b)}</span><em>{c.perf.groupName} {tx("performs")} {when(c.perf.startMs)} {tx("to")} {clock(c.perf.endMs)}</em></div>
                <div className="sv-clash-a">
                  <button type="button" onClick={() => dropFromShift(c.shift.id, c.person.userId)}>{tx("Remove from this shift")}</button>
                  <button type="button" className="ghost" onClick={() => setKept([...kept, c.key])}>{tx("Keep anyway")}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="sv-quick">
        <h4>{tx("How long is each shift?")}</h4>
        <div className="sv-chips" role="group" aria-label={tx("Length of a shift")}>
          {[['4', '4 hours'], ['6', '6 hours'], ['8', '8 hours'], ['12', '12 hours'], ['day', 'Whole day']].map(([h, label]) => (
            <button type="button" key={h} className={chip === h ? 'on' : ''} onClick={() => { setChip(h); if (h !== 'day') setHours(h); generate(h); }}>{label}</button>
          ))}
          <button type="button" className={chip === 'other' ? 'on' : ''} onClick={() => setChip('other')}>{tx("Other")}</button>
        </div>
        {chip === 'other' && (
          <div className="sv-other">
            <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={tx("Hours, for example 5   or   4, 6, 5")} aria-label={tx("Hours of a shift")} />
            <button type="button" className="btn btn-primary" onClick={() => generate()}>{tx("Create the shifts")}</button>
          </div>
        )}
        {sites.length > 1 && (
          <label className="sv-check"><input type="checkbox" checked={perPlace} onChange={(e) => { setPerPlace(e.target.checked); }} /> {tx("A separate shift for each place")}</label>
        )}
        <small>
          {tx("The first shift starts when the event starts (")}{hm(startAt)}{tx(") and the next ones follow it")}{eventDays.length > 1 ? tx(", day by day") : ''}. Type “4, 6” in Other for shifts of different lengths. You can change any shift afterwards.
        </small>
      </div>

      {undo && (
        <div className="sv-undo" role="status">
          <span>{tx("Shifts changed.")}</span>
          <button type="button" onClick={() => { setShifts(undo); setUndo(null); }}>{tx("Undo")}</button>
          <button type="button" aria-label={tx("Close")} onClick={() => setUndo(null)}>×</button>
        </div>
      )}

      {shifts.length > 0 && (
        <p className={`sv-progress${ready === shifts.length ? ' done' : ''}`}>
          <span>{ready} {tx("of")} {shifts.length} {tx("shifts have a main supervisor. Choose the people below. Tap a shift only to give it different people.")}</span>
          <button type="button" className="sv-x" onClick={() => remove(shifts.map((x) => x.id))}>{tx("Delete all shifts")}</button>
        </p>
      )}

      <SupervisionParts shifts={shifts} setShifts={setShifts} sites={sites} eventDays={eventDays} performing={allowPerformers ? [] : [...performing]} />

      <TeamSetup shifts={shifts} setShifts={setShifts} sites={sites} performing={allowPerformers ? [] : [...performing]} />

      {byDay.map(([day, list], di) => (
        <details key={day} className="sv-day" open={di < 3 || list.some((x) => x.id === open)}>
          <summary><h4><span>{longDate(day)} <em>{list.length} {tx("shift")}{list.length === 1 ? '' : 's'} · {list.filter((x) => x.people.some((p) => p.role === 'main')).length} {tx("with a supervisor")}</em></span><span className="sv-dayacts"><button type="button" className="gp-btn" onClick={() => addToDay(list)}>{tx("+ Add a shift")}</button><button type="button" className="sv-x" onClick={() => remove(list.map((x) => x.id))}>{tx("Delete this day’s shifts")}</button></span></h4></summary>
          {list.map((sh) => {
            const mains = sh.people.filter((p) => p.role === 'main');
            const team = sh.people.filter((p) => p.role === 'member');
            const isOpen = open === sh.id;
            const len = minutesBetween(sh.startAt, sh.endAt);
            return (
              <div key={sh.id} className={`sv-row2${isOpen ? ' open' : ''}${mains.length ? ' ready' : ''}`}>
                <div className="sv-rowtop">
                <button type="button" className="sv-line" onClick={() => setOpen(isOpen ? '' : sh.id)} aria-expanded={isOpen}>
                  <span className="sv-time">{hm(sh.startAt)}<small>{tx("to")} {hm(sh.endAt)}</small></span>
                  <span className="sv-what">
                    <b>{placeLabel(sh) || sh.label}</b>
                    <small>{len > 0 ? hoursLabel(len) : tx("check the times")}</small>
                  </span>
                  <span className="sv-who2">
                    {sh.people.length === 0 ? <em className="sv-none">{tx("+ Choose people")}</em> : (
                      <>
                        {sh.people.slice(0, 4).map((p) => <Avatar key={p.userId} name={p.name} photoUrl={p.photoUrl} size={28} />)}
                        <span>{(() => {
                          const hs = mains.filter((p) => tierOf(shifts, sites, p.userId) === 'head').map((p) => p.name);
                          const ms = mains.filter((p) => tierOf(shifts, sites, p.userId) === 'manager').map((p) => p.name);
                          return [hs.length ? `Head: ${hs.join(', ')}` : '', ms.length ? `Manager: ${ms.join(', ')}` : '', team.length ? `${team.length} staff` : ''].filter(Boolean).join(' · ') || 'No main supervisor';
                        })()}</span>
                      </>
                    )}
                  </span>
                  <span className="sv-arrow" aria-hidden>{isOpen ? '▴' : '▾'}</span>
                </button>
                <button type="button" className={`sv-edit${isOpen ? ' on' : ''}`} onClick={() => setOpen(isOpen ? '' : sh.id)} aria-label={tx("Edit this shift")} title={tx("Change the hours, the day or the supervisors")}>{isOpen ? tx("Close") : tx("Edit")}</button>
                <button type="button" className="sv-x" onClick={() => remove([sh.id])} aria-label={tx("Delete this shift")} title={tx("Delete this shift")}>🗑</button>
                </div>

                {isOpen && (
                  <div className="sv-open">
                    {shifts.length > 1 && (sh.people.length > 0 || shifts.some((x) => x.id !== sh.id && x.people.length > 0)) && (
                      <div className="sv-same">
                        {sh.people.length > 0 ? (
                          <>
                            <button type="button" className="btn btn-primary" onClick={() => copyToAll(sh)}>{tx("Use the same people for every shift")}</button>
                            {sh.siteIds.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => copyToSamePlace(sh)}>{tx("Only for this place")}</button>}
                          </>
                        ) : (
                          <label>
                            <span>{tx("Copy the people of another shift")}</span>
                            <select value="" onChange={(e) => { const f = shifts.find((x) => x.id === e.target.value); if (f) copyFrom(f, sh); }}>
                              <option value="">{tx("Choose a shift…")}</option>
                              {shifts.filter((x) => x.id !== sh.id && x.people.length > 0).map((x) => <option key={x.id} value={x.id}>{placeLabel(x) || x.label} · {hm(x.startAt)} {tx("to")} {hm(x.endAt)} ({x.people.length} {x.people.length === 1 ? tx("person") : tx("people")})</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                    <div className="sv-pick">
                      <h5>{tx("Main event supervisor or site manager of this shift")}</h5>
                      <p className="sv-note">{tx("You can choose anyone in the organisation: search a name or pick any kurel. Members who perform in this event are not offered, because they will be on stage.")}</p>
                      <MemberPicker
                        multiple
                        value={mains.map((p) => p.userId)}
                        selected={mains.map((p) => ({ id: p.userId, name: p.name, phone: '', memberId: '', photoUrl: p.photoUrl }))}
                        disabledIds={busyReason(team, 'In the team').ids}
                        disabledReason={busyReason(team, 'In the team').reasons}
                        onChange={(ids, picked) => setRole(sh, 'main', ids, picked)}
                      />
                    </div>
                    <details className="sv-pick" open={team.length > 0}>
                      <summary><b>{tx("Site staff")}</b> <small>{tx("(optional, they work under the site manager)")}</small></summary>
                      <MemberPicker
                        multiple
                        value={team.map((p) => p.userId)}
                        selected={team.map((p) => ({ id: p.userId, name: p.name, phone: '', memberId: '', photoUrl: p.photoUrl }))}
                        disabledIds={busyReason(mains, 'Main supervisor').ids}
                        disabledReason={busyReason(mains, 'Main supervisor').reasons}
                        onChange={(ids, picked) => setRole(sh, 'member', ids, picked)}
                      />
                      {mains.length > 1 && team.length > 0 && (
                        <div className="sv-rights">
                          {team.map((p) => (
                            <div key={p.userId} className="sv-rrow">
                              <span className="sv-who"><Avatar name={p.name} photoUrl={p.photoUrl} size={24} /><b>{p.name}</b><ViewProfile userId={p.userId} /></span>
                              <select aria-label={`Main supervisor of ${p.name}`} value={p.leaderId ?? ''} onChange={(e) => update(sh.id, { people: sh.people.map((x) => (x.userId === p.userId ? { ...x, leaderId: e.target.value || undefined } : x)) })}>
                                <option value="">{tx("Works with all main supervisors")}</option>
                                {mains.map((m) => <option key={m.userId} value={m.userId}>{tx("Under")} {m.name}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </details>

                    <details className="sv-pick sv-timebox">
                      <summary><b>{tx("Change the hours")}</b> <small>{hm(sh.startAt)} {tx("to")} {hm(sh.endAt)} · {len > 0 ? hoursLabel(len) : tx("check the times")}</small></summary>
                      <div className="sv-when">
                        {eventDays.length > 1 && (
                          <label><span>{tx("Day")}</span>
                            <select value={sh.startAt.slice(0, 10)} onChange={(e) => { const d = e.target.value; const start = `${d}T${hm(sh.startAt)}`; update(sh.id, { startAt: start, endAt: addMinutes(start, Math.max(15, len)) }); }}>
                              {!eventDays.includes(sh.startAt.slice(0, 10)) && <option value={sh.startAt.slice(0, 10)}>{longDate(sh.startAt.slice(0, 10))}</option>}
                              {eventDays.map((d, i) => <option key={d} value={d}>{`Day ${i + 1} · ${longDate(d)}`}</option>)}
                            </select>
                          </label>
                        )}
                        <label><span>{tx("Starts")}</span><TimeSelect value={hm(sh.startAt)} label={tx("Shift starts")} onChange={(v) => update(sh.id, { startAt: `${sh.startAt.slice(0, 10)}T${v}` })} /></label>
                        <label><span>{tx("Ends")}</span><TimeSelect value={hm(sh.endAt)} label={tx("Shift ends")} onChange={(v) => update(sh.id, { endAt: `${sh.endAt.slice(0, 10)}T${v}` })} /></label>
                        <label><span>{tx("Length (hours)")}</span><input type="number" min={0.25} step={0.25} value={len > 0 ? Number((len / 60).toFixed(2)) : ''} onChange={(e) => Number(e.target.value) > 0 && update(sh.id, { endAt: addMinutes(sh.startAt, Math.round(Number(e.target.value) * 60)) })} /></label>
                      </div>
                      {(minutesBetween(startAt, sh.startAt) < 0 || minutesBetween(sh.endAt, endAt) < 0) && <p className="sv-outside">{tx("This shift is outside the event hours (")}{hm(startAt)} {tx("to")} {hm(endAt)}{tx("). The event dates will be checked when you save.")}</p>}
                      {len <= 0 && <p className="sv-outside">{tx("The end must be after the start.")}</p>}
                    </details>

                    <details className="sv-more">
                      <summary>{tx("Advanced: dates, places, groups, permissions")}</summary>
                      <div className="sv-row">
                        <label><span>{tx("Starts")}</span><DateTimePicker value={sh.startAt} onChange={(v) => update(sh.id, { startAt: v })} /></label>
                        <label><span>{tx("Ends")}</span><DateTimePicker value={sh.endAt} min={sh.startAt} onChange={(v) => update(sh.id, { endAt: v })} /></label>
                      </div>
                      <label className="sv-name"><span>{tx("Name")}</span><input value={sh.label} onChange={(e) => update(sh.id, { label: e.target.value })} /></label>
                      {sites.length > 1 && (
                        <div className="sv-pick">
                          <h5>{tx("Places")} <small>{tx("(none ticked = every place)")}</small></h5>
                          <div className="pl-groups">
                            {sites.map((s) => (
                              <label key={s.id}><input type="checkbox" checked={sh.siteIds.includes(s.id)} onChange={(e) => update(sh.id, { siteIds: e.target.checked ? [...sh.siteIds, s.id] : sh.siteIds.filter((x) => x !== s.id) })} />{s.name || tx("Place")}</label>
                            ))}
                          </div>
                        </div>
                      )}
                      {groups.length > 1 && (
                        <div className="sv-pick">
                          <h5>{tx("Groups")} <small>{tx("(none ticked = all groups)")}</small></h5>
                          <div className="pl-groups">
                            {groups.map((g) => (
                              <label key={g.id}><input type="checkbox" checked={sh.groupIds.includes(g.id)} onChange={(e) => update(sh.id, { groupIds: e.target.checked ? [...sh.groupIds, g.id] : sh.groupIds.filter((x) => x !== g.id) })} />{g.name}</label>
                            ))}
                          </div>
                        </div>
                      )}
                      {sh.people.length > 0 && (
                        <div className="sv-pick">
                          <h5>{tx("What each person may do")} <small>{tx("(the main event supervisor can do everything, a site manager cannot cancel a performance, site staff cannot change the schedule)")}</small></h5>
                          <div className="sv-rights">
                            {sh.people.map((p) => {
                              const tr = tierOf(shifts, sites, p.userId);
                              const cur = p.can ?? TIER_RIGHTS[tr];
                              return (
                                <div key={p.userId} className="sv-rrow">
                                  <span className="sv-who"><Avatar name={p.name} photoUrl={p.photoUrl} size={24} /><b>{p.name}</b><small>{TIER_LABEL[tr]}</small><ViewProfile userId={p.userId} /></span>
                                  <span className="sv-rch">
                                    {RIGHTS.map((r) => (
                                      <label key={r.key}><input type="checkbox" checked={cur.includes(r.key)} onChange={(e) => update(sh.id, { people: sh.people.map((x) => (x.userId === p.userId ? { ...x, can: e.target.checked ? Array.from(new Set([...cur, r.key])) : cur.filter((k) => k !== r.key) } : x)) })} />{r.label}</label>
                                    ))}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </details>

                    <div className="sv-foot">
                      <button type="button" className="btn btn-secondary sv-del" onClick={() => remove([sh.id])}>{tx("Delete this shift")}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </details>
      ))}

      {shifts.length === 0 && <p className="fx3-note">{tx("No shift yet. Tap a length above. Shifts are optional: you can also do this later from the event page.")}</p>}
    </>
  );
}

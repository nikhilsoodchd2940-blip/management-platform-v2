'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { reviewLateArrival, type AttendanceGroup, type AttendanceState, type LiveStatus } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { Avatar } from '@/components/MemberPicker';
import { Tick } from '@/components/AttendancePanel';
import QuickActions from '@/components/QuickActions';
import type { ShiftLite, SiteLite, Slot } from './LiveBoard';
import { OVER_CAP_MS, effEnd, effStart, effStatus, isMissed } from './liveRules';
import { useAlarm } from './alarm';
import { tx, dateLocale } from '@/lib/i18n/tr';

const LABEL: Record<LiveStatus, string> = { upcoming: 'Upcoming', ready: 'Ready', in_progress: 'On stage', completed: 'Finished', delayed: 'Delayed', cancelled: 'Cancelled' };
const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—');
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const span = (min: number) => { const m = Math.abs(Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
const localHm = (ms: number, tz?: string) => { try { return tz ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)) : ''; } catch { return ''; } };

export interface Actions {
  start: (s: Slot) => void;
  finish: (s: Slot) => void;
  delay: (s: Slot) => void;
  cancel: (s: Slot) => void;
  move: (s: Slot) => void;
  correct: (s: Slot) => void;
  setStatus: (s: Slot, st: LiveStatus) => void;
  extend: (s: Slot, minutes: number) => void;
  bulkPerformed: (list: Slot[]) => void;
  /** Shows what an over-time performance pushes back, with the choice to shorten or move the next ones. */
  fixSchedule: (s: Slot) => void;
  /** Opens a box to give the performance any number of extra minutes. */
  extendCustom: (s: Slot) => void;
  /** Starts or stops one audio of a performance that is on stage. */
  audioStart: (s: Slot, index: number) => void;
  audioStop: (s: Slot, index: number) => void;
  /** Pause, resume, remark or rating of one audio. */
  audioDo: (s: Slot, index: number, action: 'start' | 'pause' | 'resume' | 'stop' | 'remark' | 'rate' | 'groupRemark', extra?: { remark?: string; rating?: number }) => void;
}

interface Props {
  slots: Slot[];
  now: number;
  /** Start, pause and end state per place ('_all' = whole event). A paused or ended place is frozen at that moment. */
  run?: Record<string, { state: 'running' | 'paused' | 'ended'; atMs: number }>;
  sites: SiteLite[];
  shifts: ShiftLite[];
  can: (r: string) => boolean;
  busy: string;
  act: Actions;
  /** Members who perform in several groups of the event (supervisor view); used to spot clashes. */
  members?: { name: string; groups: string[] }[];
  /** Attendance of the people of every group, refreshed by the board. */
  attendance?: { eventId: string; byGroup: Record<string, AttendanceGroup>; canDecide: boolean; reload: () => void };
  /** Supervisor view: quick actions shown inside the card of the group on stage. */
  quick?: { eventId: string; onOpen?: (n: number) => void };
}

/** The live board organised by what matters right now: needs attention, on stage, up next, later, finished. */
export default function LiveSections({ slots, now: realNow, run = {}, sites, shifts, can, busy, act, members = [], attendance, quick }: Props) {
  const [place, setPlace] = useState('');
  const [find, setFind] = useState('');
  const [only, setOnly] = useState('');
  const [open, setOpen] = useState<{ later: boolean; done: boolean }>({ later: false, done: false });
  const [more, setMore] = useState({ later: 20, done: 20, missed: 15, flat: 30 });

  const placeOf = useMemo(() => {
    const m = new Map<string, string>();
    sites.forEach((st) => (st.groupIds ?? []).forEach((g) => m.set(g, st.id)));
    return m;
  }, [sites]);
  const nowFor = useMemo(() => (s: Slot) => {
    const key = sites.length > 1 ? placeOf.get(s.groupId) ?? '_' : '_';
    const r = run[key] ?? run._all;
    return r && r.state !== 'running' ? Math.min(realNow, r.atMs) : realNow;
  }, [run, sites, placeOf, realNow]);
  const placeName = (s: Slot) => sites.find((x) => x.id === placeOf.get(s.groupId))?.name ?? '';

  // Status by the clock, in time order, so a group is held while the previous one at its place is still on stage.
  const { statusOf, heldBy } = useMemo(() => {
    const sorted = [...slots].sort((a, b) => a.startMs - b.startMs);
    const st = new Map<string, LiveStatus>();
    const hb = new Map<string, string>();
    for (const s of sorted) {
      const pid = placeOf.get(s.groupId) ?? '_';
      // a group forgotten on stage for over an hour past its end no longer holds the next ones
      const blocker = sorted.find((o) => o.id !== s.id && o.startMs < s.startMs && (placeOf.get(o.groupId) ?? '_') === pid && st.get(o.id) === 'in_progress' && nowFor(s) < effEnd(o) + OVER_CAP_MS);
      const held = !!blocker && s.status !== 'in_progress';
      const v = effStatus(s, nowFor(s), held);
      st.set(s.id, v);
      if (held && blocker && v !== 'in_progress' && v !== 'completed') hb.set(s.id, blocker.groupName);
    }
    return { statusOf: st, heldBy: hb };
  }, [slots, nowFor, placeOf]);

  const rows = useMemo(() => slots
    .map((s) => ({ s, st: statusOf.get(s.id) ?? effStatus(s, nowFor(s)) }))
    .filter((r) => (!place || placeOf.get(r.s.groupId) === place) && (!find.trim() || r.s.groupName.toLowerCase().includes(find.trim().toLowerCase()))),
  [slots, nowFor, place, find, placeOf, statusOf]);

  const onStage = rows.filter((r) => r.st === 'in_progress').sort((a, b) => effEnd(a.s) - effEnd(b.s));
  const missed = rows.filter((r) => isMissed(r.s, r.st, nowFor(r.s)) && !heldBy.has(r.s.id)).sort((a, b) => effStart(a.s) - effStart(b.s));
  const waitingAll = rows.filter((r) => (r.st === 'upcoming' || r.st === 'ready' || r.st === 'delayed') && (!isMissed(r.s, r.st, nowFor(r.s)) || heldBy.has(r.s.id))).sort((a, b) => effStart(a.s) - effStart(b.s));
  const done = rows.filter((r) => r.st === 'completed' || r.st === 'cancelled').sort((a, b) => b.s.endMs - a.s.endMs);
  // Each performance appears in one section only: on-stage ones (even over time) stay under "On stage now".
  const attention = rows.filter((r) => {
    if (!waitingAll.includes(r)) return false;
    return r.st === 'delayed' || r.s.atRisk || heldBy.has(r.s.id);
  }).sort((a, b) => effStart(a.s) - effStart(b.s));
  const waiting = waitingAll.filter((r) => !attention.includes(r));
  const overStage = onStage.filter((r) => nowFor(r.s) > effEnd(r.s)).length;

  // Every status at a glance: pick one to see all the groups in it.
  // "Delayed" = reported delayed, or its start time has passed and it is not on stage (held back, or never started).
  const keyOf = (r: { s: Slot; st: LiveStatus }) => (r.st === 'delayed' || ((r.st === 'upcoming' || r.st === 'ready') && nowFor(r.s) >= effStart(r.s)) ? 'delayed' : r.st === 'upcoming' || r.st === 'ready' ? 'coming' : r.st);
  const countOf = (k: string) => k === 'conflicts' ? clashList.length : rows.filter((r) => keyOf(r) === k).length;
  const flat = only ? rows.filter((r) => keyOf(r) === only).sort((a, b) => (only === 'completed' || only === 'cancelled' ? b.s.endMs - a.s.endMs : effStart(a.s) - effStart(b.s))) : [];

  // Clashes: two groups on stage at one place, and members who would be in two groups at the same time.
  type Clash = { key: string; kind: string; reason: string; first: Slot; second: Slot; firstOn: boolean; w1: [number, number]; w2: [number, number] };
  const clashList: Clash[] = (() => {
    const live = rows.filter((r) => r.st === 'in_progress' || (waitingAll.includes(r)));
    const win = (r: { s: Slot; st: LiveStatus }): [number, number] => r.st === 'in_progress' ? [effStart(r.s), Math.max(effEnd(r.s), nowFor(r.s))] : [effStart(r.s), effEnd(r.s)];
    const out: Clash[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const [a1, a2] = win(a), [b1, b2] = win(b);
        if (!(a1 < b2 && b1 < a2)) continue;
        const [f, sc] = a1 <= b1 ? [a, b] : [b, a];
        const samePlace = (placeOf.get(f.s.groupId) ?? '_') === (placeOf.get(sc.s.groupId) ?? '_') && f.st === 'in_progress' && sc.st === 'in_progress';
        const shared = members.filter((m) => m.groups.includes(f.s.groupName) && m.groups.includes(sc.s.groupName)).map((m) => m.name);
        const k = `${f.s.id}-${sc.s.id}`;
        if (seen.has(k) || (!samePlace && shared.length === 0)) continue;
        seen.add(k);
        out.push({
          key: k,
          kind: samePlace ? 'Two groups on stage at the same place' : 'Members in two groups at the same time',
          reason: samePlace ? 'Only one group can be on stage at a place. Finish the first one, or move the other.' : `${shared.slice(0, 4).join(', ')}${shared.length > 4 ? ` and ${shared.length - 4} more` : ''} cannot be in both groups at once.`,
          first: f.s, second: sc.s, firstOn: f.st === 'in_progress', w1: [a1, a2], w2: [b1, b2],
        });
      }
    }
    return out.slice(0, 60);
  })();
  const next = waiting.filter((r) => keyOf(r) === 'coming').slice(0, 3);
  const later = waiting.filter((r) => keyOf(r) === 'coming').slice(3);
  const lateRows = rows.filter((r) => keyOf(r) === 'delayed').sort((a, b) => effStart(a.s) - effStart(b.s));
  const total = slots.length;
  const finished = slots.filter((s) => (statusOf.get(s.id) ?? s.status) === 'completed').length;
  const cancelled = slots.filter((s) => s.status === 'cancelled').length;
  const pct = total ? Math.round(((finished + cancelled) / total) * 100) : 0;

  const FILTERS: [string, string][] = [['conflicts', 'Conflicts'], ['in_progress', 'On stage'], ['delayed', 'Late'], ['coming', 'Coming'], ['completed', 'Finished'], ['cancelled', 'Cancelled']];
  const conflictN = clashList.length;
  const lateN = lateRows.length;
  const alarm = useAlarm(clashList.map((c) => c.key), onStage.filter((r) => nowFor(r.s) > effEnd(r.s)).map((r) => r.s.id));

  function card(r: { s: Slot; st: LiveStatus }, flavour: 'stage' | 'next' | 'list' | 'done' | 'late') {
    const { s, st } = r;
    const now = nowFor(s);
    const b = busy === s.id;
    const waitingNow = (st === 'upcoming' || st === 'ready' || st === 'delayed') && (!isMissed(s, st, now) || heldBy.has(s.id));
    const over = st === 'in_progress' && now > effEnd(s);
    const isMiss = isMissed(s, st, now) && !heldBy.has(s.id);
    const autoClosed = st === 'completed' && s.auto && !s.actualStartMs;
    const holder = heldBy.get(s.id);
    const lateMin = waitingNow ? Math.max(0, Math.round((now - effStart(s)) / 60000)) : 0;
    const left = (effEnd(s) - now) / 60000;
    const until = (effStart(s) - now) / 60000;
    const pctRun = Math.min(100, Math.max(0, ((now - effStart(s)) / Math.max(1, effEnd(s) - effStart(s))) * 100));
    let tone = 'grey', headline = '', sub = '';
    if (st === 'in_progress') {
      if (over) {
        tone = 'red'; headline = `${span((now - effEnd(s)) / 60000)} over time`;
        const behind = waitingAll.filter((w) => (placeOf.get(w.s.groupId) ?? '_') === (placeOf.get(s.groupId) ?? '_') && w.s.startMs > s.startMs).length;
        sub = behind ? `${behind} group${behind === 1 ? ' is' : 's are'} waiting behind it` : '';
      } else { tone = 'green'; headline = left < 1 ? 'Less than 1 min left' : `${span(left)} left`; sub = `Started ${hm(s.actualStartMs ?? effStart(s))}`; }
    } else if (isMiss) { tone = 'red'; headline = 'Time passed, nobody marked it'; sub = 'Did this group perform?'; }
    else if (waitingNow) {
      if (lateMin >= 1) { tone = 'amber'; headline = `Late by ${span(lateMin)}`; sub = holder ? `Waiting for ${holder} to finish` : 'Not started yet'; }
      else { tone = 'blue'; headline = until < 1 ? 'Starts now' : `Starts in ${span(until)}`; }
    } else if (st === 'completed') { headline = autoClosed ? 'Closed by the clock. Please confirm.' : `Finished${s.actualEndMs ? ` at ${hm(s.actualEndMs)}` : ''}`; tone = autoClosed ? 'amber' : 'grey'; }
    else { headline = 'Cancelled'; }
    return (
      <article key={s.id} className={`lv-card t-${tone} f-${flavour}`}>
        <div className="lv-time"><small>{st === 'completed' ? tx("Planned") : tx("Starts")}</small><b>{hm(effStart(s))}</b><small>{tx("to")} {hm(effEnd(s))}</small></div>
        <div className="lv-main">
          <div className="lv-name"><b>{s.groupName}</b>{placeName(s) && <span className="lv-place">{placeName(s)}</span>}{s.cityName && <span className="lv-city">{s.cityName}</span>}<em className={`lv-chip c-${isMiss ? 'missed' : st}`}>{isMiss ? tx("Not marked") : autoClosed ? tx("Closed by clock") : LABEL[st]}</em></div>
          <p className={`lv-line t-${tone}`}><b>{headline}</b>{sub && <span>{sub}</span>}</p>
          {st === 'in_progress' && <div className="lv-barwrap"><div className="lv-bar" aria-hidden="true"><i style={{ width: `${pctRun}%` }} /></div><div className="lv-barl"><span>{tx("Started")} {hm(s.actualStartMs ?? effStart(s))}</span><span>{over ? tx("Over time") : `Ends ${hm(effEnd(s))}`}</span></div></div>}
          <dl className="lv-facts">
            <div><dt>{tx("Planned")}</dt><dd>{hm(s.originalStartMs ?? s.startMs)} {tx("to")} {hm((s.originalStartMs ?? s.startMs) + (s.endMs - s.startMs))}</dd></div>
            {s.originalStartMs && s.originalStartMs !== s.startMs && <div className="moved"><dt>{tx("Moved to")}</dt><dd>{hm(s.startMs)} {tx("to")} {hm(s.endMs)}</dd></div>}
            <div><dt>{tx("Time allowed")}</dt><dd>{span((s.endMs - s.startMs) / 60000)}{s.extendedMinutes ? ` (+${s.extendedMinutes} min given)` : ''}</dd></div>
            <div><dt>{tx("Real times")}</dt><dd>{s.actualStartMs ? `${hm(s.actualStartMs)} to ${s.actualEndMs ? hm(s.actualEndMs) : 'now'}` : tx("Not started")}</dd></div>
            <div className={s.actualStartMs ? (s.actualStartMs - (s.originalStartMs ?? s.startMs) > 5 * 60000 ? 'bad' : 'good') : lateMin > 0 ? 'bad' : ''}><dt>{tx("Timing")}</dt><dd>{s.actualStartMs ? (s.actualStartMs - (s.originalStartMs ?? s.startMs) > 60000 ? `Started ${span((s.actualStartMs - (s.originalStartMs ?? s.startMs)) / 60000)} late` : tx("Started on time")) : lateMin > 0 ? `${span(lateMin)} late` : tx("Not due yet")}</dd></div>
            {s.timeZone && localHm(s.startMs, s.timeZone) && <div><dt>{tx("Local time")}</dt><dd>{localHm(s.startMs, s.timeZone)} <small>{s.timeZone}</small></dd></div>}
          </dl>
          {flavour !== 'done' && <AudioBlock audio={s.audio} groupRemark={s.performanceRemark} allowedSec={(s.endMs - s.startMs) / 1000} runs={s.audioRuns} now={now} onStage={st === 'in_progress'} canNote={st === 'in_progress' || st === 'completed'} canStart={can('status')} busy={b} onDo={(i, a, x) => act.audioDo(s, i, a, x)} />}
          {quick && st === 'in_progress' && <div className="lv-quick"><QuickActions eventId={quick.eventId} onOpen={quick.onOpen} compact /></div>}
          {flavour !== 'done' && attendance && <AttendanceStrip g={attendance.byGroup[s.groupId]} live={st === 'in_progress' || st === 'ready'} canDecide={attendance.canDecide} eventId={attendance.eventId} reload={attendance.reload} />}
          {s.status === 'delayed' && <p className="lv-note warn">{tx("Delayed")} {s.delayMinutes} {tx("min:")} {s.delayReason}</p>}
          {s.atRisk && <p className="lv-note warn">{tx("At risk:")} {s.atRiskReason}</p>}
        </div>
        <div className="lv-acts">
          {isMiss && can('status') && <button type="button" className="btn btn-primary" disabled={b} onClick={() => act.correct(s)}>{tx("It performed")}</button>}
          {waitingNow && can('status') && <button type="button" className="btn btn-primary" disabled={b} onClick={() => act.start(s)}>{tx("Start now")}</button>}
          {st === 'in_progress' && can('status') && <button type="button" className={`btn ${over ? 'btn-danger' : 'btn-primary'}`} disabled={b} onClick={() => act.finish(s)}>{tx("Finish")}</button>}
          {st === 'in_progress' && can('delay') && [5, 10].map((m) => <button key={m} type="button" className="btn btn-secondary" disabled={b} title={`Give ${m} more minutes and see who it pushes back`} onClick={() => act.extend(s, m)}>+{m} {tx("min")}</button>)}
          {st === 'completed' && can('status') && <button type="button" className={`btn ${autoClosed ? 'btn-primary' : 'btn-secondary'}`} disabled={b} onClick={() => act.correct(s)}>{autoClosed ? tx("Confirm times") : tx("Correct times")}</button>}
          {st === 'cancelled' && can('status') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.setStatus(s, 'upcoming')}>{tx("Restore")}</button>}
          {(isMiss || waitingNow || st === 'in_progress' || autoClosed || (st === 'completed' && can('status'))) && (
            <details className="lv-more">
              <summary>{tx("More")}</summary>
              <div>
                {isMiss && can('status') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.start(s)}>{tx("Start now (late)")}</button>}
                {isMiss && can('cancel') && <button type="button" className="btn btn-secondary danger" disabled={b} onClick={() => act.cancel(s)}>{tx("It did not perform")}</button>}
                {waitingNow && can('delay') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.delay(s)}>{tx("Report a delay")}</button>}
                {waitingNow && can('adjust') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.move(s)}>{tx("Change times")}</button>}
                {st === 'in_progress' && can('delay') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.extend(s, 15)}>{tx("+15 min")}</button>}
                {st === 'in_progress' && can('delay') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.extendCustom(s)}>{tx("Other number of minutes…")}</button>}
                {over && can('adjust') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.fixSchedule(s)}>{tx("See who it pushes back")}</button>}
                {(waitingNow || st === 'in_progress') && can('cancel') && <button type="button" className="btn btn-secondary danger" disabled={b} onClick={() => act.cancel(s)}>{tx("Cancel this performance")}</button>}
                {autoClosed && can('cancel') && <button type="button" className="btn btn-secondary danger" disabled={b} onClick={() => act.cancel(s)}>{tx("It did not perform")}</button>}
                {st === 'completed' && !autoClosed && can('status') && <button type="button" className="btn btn-secondary" disabled={b} onClick={() => act.setStatus(s, 'in_progress')}>{tx("Back on stage")}</button>}
              </div>
            </details>
          )}
        </div>
      </article>
    );
  }

  function clashCard(c: Clash) {
    const second = rows.find((r) => r.s.id === c.second.id);
    const secondWaiting = !!second && second.st !== 'in_progress';
    const samePlace = c.kind.startsWith('Two groups');
    const side = (g: Slot, w: [number, number], on: boolean) => (
      <div className="lv-side"><b>{g.groupName}</b><small>{hm(w[0])} {tx("to")} {hm(w[1])}{on ? tx(" · on stage now") : tx(" · waiting")}</small></div>
    );
    return (
      <article key={c.key} className="lv-clash">
        <h4>{samePlace ? tx("Two groups are on stage at the same place") : tx("Members would be in two groups at the same time")}</h4>
        <div className="lv-vs">{side(c.first, c.w1, c.firstOn)}<span>AND</span>{side(c.second, c.w2, !secondWaiting)}</div>
        <p className="lv-todo"><b>{tx("What to do:")}</b> {samePlace ? tx("finish the group that is over, or delay or move the other one.") : `${c.reason} Delay or move one of the two groups.`}</p>
        <div className="lv-acts">
          {c.firstOn && can('status') && <button type="button" className="btn btn-danger" disabled={busy === c.first.id} onClick={() => act.finish(c.first)}>{tx("Finish")} {c.first.groupName}</button>}
          {!secondWaiting && can('status') && <button type="button" className="btn btn-secondary" disabled={busy === c.second.id} onClick={() => act.finish(c.second)}>{tx("Finish")} {c.second.groupName}</button>}
          {secondWaiting && can('delay') && <button type="button" className="btn btn-secondary" disabled={busy === c.second.id} onClick={() => act.delay(c.second)}>{tx("Delay")} {c.second.groupName}</button>}
          {secondWaiting && can('adjust') && <button type="button" className="btn btn-secondary" disabled={busy === c.second.id} onClick={() => act.move(c.second)}>{tx("Move")} {c.second.groupName}</button>}
          {!can('status') && !can('delay') && !can('adjust') && <small>{tx("You cannot change this. Report it from the Reports page.")}</small>}
        </div>
      </article>
    );
  }

  const laterDays: [string, typeof later][] = [];
  later.slice(0, more.later).forEach((r) => { const k = dayKey(r.s.startMs); const h = laterDays.find((d) => d[0] === k); if (h) h[1].push(r); else laterDays.push([k, [r]]); });
  const tone = conflictN ? 'red' : overStage || lateN ? 'amber' : 'green';
  const headline = conflictN ? `${conflictN} conflict${conflictN === 1 ? '' : 's'} to solve now` : overStage ? `${overStage} performance${overStage === 1 ? ' is' : 's are'} over time` : lateN ? `${lateN} group${lateN === 1 ? ' is' : 's are'} behind schedule` : 'Everything is on time';
  const subline = conflictN ? 'Two groups cannot perform at once. Use the buttons in the red box.' : overStage ? 'The next group at that place is waiting. Finish the performance, add minutes, or move the next ones.' : lateN ? 'These groups did not start at their planned time.' : 'Nothing needs your attention.';
  const tiles: [string, string, number, string][] = [
    ...(conflictN ? [['conflicts', 'Conflicts', conflictN, 'red'] as [string, string, number, string]] : []),
    ['in_progress', 'On stage', countOf('in_progress'), 'green'], ['delayed', 'Late', lateN, lateN ? 'amber' : 'grey'], ['coming', 'Coming', countOf('coming'), 'blue'], ['completed', 'Finished', countOf('completed'), 'grey'],
  ];

  return (
    <div className="ls lv">
      <section className={`lv-sum t-${tone}`}>
        <div className="lv-sum-h"><div><b>{headline}</b><span>{subline}</span></div><div className="lv-pct"><b>{pct}%</b><span>{finished + cancelled} {tx("of")} {total} {tx("done")}</span></div></div>
        <div className="lv-tiles">
          {tiles.map(([k, label, n, c]) => <button key={k} type="button" className={`c-${c}${only === k ? ' on' : ''}`} onClick={() => { setOnly(only === k ? '' : k); setMore((m) => ({ ...m, flat: 30 })); }}><b>{n}</b><span>{label}</span></button>)}
        </div>
      </section>

      {conflictN > 0 && (
        <section className="lv-alert" role="alert" aria-live="assertive">
          <header>
            <span className="lv-siren" aria-hidden="true">!</span>
            <div><b>{tx("CONFLICT:")} {conflictN} {tx("problem")}{conflictN === 1 ? '' : 's'} {tx("need")}{conflictN === 1 ? 's' : ''} {tx("you now")}</b><span>{tx("This will not solve itself. Choose one action below.")}</span></div>
            <div className="lv-sound">
              <button type="button" onClick={alarm.toggle} aria-pressed={alarm.on}>{alarm.on ? tx("Sound on") : tx("Sound off")}</button>
              {alarm.on && <button type="button" onClick={alarm.silence}>{alarm.silenced ? tx("Silenced for 5 min") : tx("Silence for 5 min")}</button>}
              {alarm.on && <button type="button" onClick={alarm.test}>{tx("Test sound")}</button>}
            </div>
          </header>
          {alarm.blocked && <p className="lv-blocked">{tx("Your browser is blocking the alarm sound. Click anywhere on this page, or press “Test sound”, to allow it.")}</p>}
          {clashList.slice(0, 3).map(clashCard)}
          {clashList.length > 3 && <button type="button" className="btn btn-secondary" onClick={() => setOnly('conflicts')}>{tx("See all")} {clashList.length} {tx("conflicts")}</button>}
        </section>
      )}

      {(sites.length > 1 || slots.length > 8) && (
        <div className="ls-filters">
          {sites.length > 1 && (
            <div className="ls-places">
              <button type="button" className={!place ? 'on' : ''} onClick={() => setPlace('')}>{tx("All places")}</button>
              {sites.map((st) => <button key={st.id} type="button" className={place === st.id ? 'on' : ''} onClick={() => setPlace(st.id)}>{st.name}</button>)}
            </div>
          )}
          {slots.length > 8 && <input className="ls-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx("Search a group")} aria-label={tx("Search a group")} />}
        </div>
      )}

      {total === 0 && <p className="fx3-note">{tx("No group has a performance slot yet. Add them in the event plan.")}</p>}

      {only === 'conflicts' ? (
        <section className="lv-sec">
          <h4>{tx("Conflicts")} <span>{conflictN}</span></h4>
          {conflictN === 0 ? <p className="ls-empty">{tx("No conflict right now.")}</p> : clashList.map(clashCard)}
          <button type="button" className="btn btn-secondary" onClick={() => setOnly('')}>{tx("Back to the overview")}</button>
        </section>
      ) : only ? (
        <section className="lv-sec">
          <h4>{FILTERS.find((f) => f[0] === only)?.[1]} <span>{flat.length}</span></h4>
          {flat.length === 0 ? <p className="ls-empty">{tx("No group in this list.")}</p> : flat.slice(0, more.flat).map((r) => card(r, only === 'completed' || only === 'cancelled' ? 'done' : only === 'in_progress' ? 'stage' : only === 'delayed' ? 'late' : 'list'))}
          {flat.length > more.flat && <button type="button" className="btn btn-secondary" onClick={() => setMore({ ...more, flat: more.flat + 30 })}>{tx("Show 30 more (")}{flat.length - more.flat} {tx("left)")}</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setOnly('')}>{tx("Back to the overview")}</button>
        </section>
      ) : (
      <>
        <section id="ls-stage" className="lv-sec">
          <h4>{tx("On stage now")} <span>{onStage.length}</span></h4>
          {onStage.length === 0 ? <p className="ls-empty">{tx("Nobody is performing right now.")}</p> : onStage.map((r) => card(r, 'stage'))}
        </section>

        {lateN > 0 && (
          <section id="ls-late" className="lv-sec warn">
            <h4>{tx("Late: should have started already")} <span>{lateN}</span></h4>
            {missed.length > 0 && can('status') && (
              <p className="lv-hint">{missed.length} {tx("of them have passed their whole slot and nobody marked them.")} <button type="button" className="btn btn-secondary" onClick={() => act.bulkPerformed(missed.map((m) => m.s))}>{tx("Mark all")} {missed.length} {tx("as performed as planned")}</button></p>
            )}
            {lateRows.slice(0, 5).map((r) => card(r, 'late'))}
            {lateN > 5 && <button type="button" className="btn btn-secondary" onClick={() => { setOnly('delayed'); setMore((m) => ({ ...m, flat: 30 })); }}>{tx("Show all")} {lateN} {tx("late groups")}</button>}
          </section>
        )}

        <section id="ls-next" className="lv-sec">
          <h4>{tx("Coming next")} <span>{countOf('coming')}</span></h4>
          {next.length === 0 ? <p className="ls-empty">{tx("No other performance is waiting.")}</p> : next.map((r) => card(r, 'next'))}
        </section>

        {later.length > 0 && (
          <section className="lv-sec">
            <button id="ls-later" type="button" className="ls-toggle" aria-expanded={open.later} onClick={() => setOpen({ ...open, later: !open.later })}>
              <b>{tx("Later")}</b><span>{later.length}</span><i>{open.later ? tx("Hide") : tx("Show")}</i>
            </button>
            {open.later && (
              <>
                {laterDays.map(([k, list]) => (
                  <div key={k} className="ls-day"><div className="ls-dayh">{dayLabel(list[0].s.startMs)}</div>{list.map((r) => card(r, 'list'))}</div>
                ))}
                {later.length > more.later && <button type="button" className="btn btn-secondary" onClick={() => setMore({ ...more, later: more.later + 30 })}>{tx("Show 30 more (")}{later.length - more.later} {tx("left)")}</button>}
              </>
            )}
          </section>
        )}

        {done.length > 0 && (
          <section className="lv-sec">
            <button id="ls-done" type="button" className="ls-toggle" aria-expanded={open.done} onClick={() => setOpen({ ...open, done: !open.done })}>
              <b>{tx("Finished and cancelled")}</b><span>{done.length}</span><i>{open.done ? tx("Hide") : tx("Show")}</i>
            </button>
            {open.done && (
              <>
                {done.slice(0, more.done).map((r) => card(r, 'done'))}
                {done.length > more.done && <button type="button" className="btn btn-secondary" onClick={() => setMore({ ...more, done: more.done + 30 })}>{tx("Show 30 more (")}{done.length - more.done} {tx("left)")}</button>}
              </>
            )}
          </section>
        )}
      </>
      )}
    </div>
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const AUDIO_STATE: Record<string, string> = { submitted: 'Waiting for approval', approved: '', rejected: 'Not approved', cancelled: '' };

const mmssLive = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const stars = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

/** Pop-up to write a remark over several lines. */
export function RemarkDialog({ title, subtitle, value, editable, onSave, onClose }: { title: string; subtitle?: string; value: string; editable: boolean; onSave: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="mls-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mls-sheet rd" role="dialog" aria-label={title}>
        <header><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="mls-x" onClick={onClose} aria-label={tx("Close")}>×</button></header>
        <div className="rd-body">
          <textarea autoFocus rows={9} maxLength={editable ? 1500 : undefined} readOnly={!editable} value={v} placeholder={tx("Write what you noticed: pronunciation, rhythm, discipline, what to correct… You can write several lines.")} onChange={(e) => setV(e.target.value)} />
          {editable && <small>{v.length} / 1500</small>}
        </div>
        <footer>
          {editable && value && <button type="button" className="btn btn-secondary danger" onClick={() => { onSave(''); onClose(); }}>{tx("Delete the remark")}</button>}
          <span />
          <button type="button" className="btn btn-secondary" onClick={onClose}>{editable ? tx("Cancel") : tx("Close")}</button>
          {editable && <button type="button" className="btn btn-primary" disabled={v.trim() === value.trim()} onClick={() => { onSave(v.trim()); onClose(); }}>{tx("Save the remark")}</button>}
        </footer>
      </div>
    </div>,
    document.body
  );
}

/** Short view of a remark; a click opens the pop-up where it can be read or written over several lines. */
function RemarkCell({ value, editable, title, onSave }: { value: string; editable: boolean; title: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!editable && !value) return <span className="pt-rem ro">—</span>;
  return (
    <>
      <button type="button" className={`pt-remb${value ? ' has' : ''}`} onClick={() => setOpen(true)} title={value || tx("Add a remark")}>
        {value ? <span>{value}</span> : <em>{tx("+ Add a remark")}</em>}
      </button>
      {open && <RemarkDialog title={tx("Remark")} subtitle={title} value={value} editable={editable} onSave={onSave} onClose={() => setOpen(false)} />}
    </>
  );
}

/** What this group performs, as a table: book, artist, duration, start, pause, end, timer left, remark and rating, with the overall rating of the group. */
function AudioBlock({ audio, groupRemark, allowedSec, runs, now, onStage, canNote, canStart, busy, onDo }: { audio?: Slot['audio']; groupRemark?: string; allowedSec: number; runs?: Slot['audioRuns']; now: number; onStage: boolean; canNote: boolean; canStart: boolean; busy: boolean; onDo: (i: number, action: 'start' | 'pause' | 'resume' | 'stop' | 'remark' | 'rate' | 'groupRemark', extra?: { remark?: string; rating?: number }) => void }) {
  if (!audio || audio.items.length === 0) return <div className="lv-audio none"><span aria-hidden="true">♪</span><div><b>{tx("No book chosen yet")}</b><small>{tx("The group has not picked what it will perform.")}</small></div></div>;
  const warn = AUDIO_STATE[audio.status];
  const total = audio.items.reduce((n, i) => n + i.seconds, 0);
  const over = total > allowedSec + 1;
  const nowPlaying = audio.items.findIndex((_, n) => runs?.[String(n)]?.startedMs && !runs[String(n)].endedMs);
  const rated = audio.items.map((_, n) => runs?.[String(n)]?.rating ?? 0).filter((x) => x > 0);
  const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
  const clock = (n: number, secs: number) => {
    const r = runs?.[String(n)];
    if (!r || !r.startedMs) return { text: mmss(secs), cls: '' };
    const stop = r.endedMs ?? r.pausedAtMs ?? now;
    const played = Math.max(0, (stop - r.startedMs - (r.pausedMs ?? 0)) / 1000);
    const left = secs - played;
    if (r.endedMs) return { text: left >= 0 ? `${mmssLive(played)} played` : `+${mmssLive(-left)} over`, cls: left < -5 ? 'over' : 'done' };
    return { text: left >= 0 ? mmssLive(left) : `+${mmssLive(-left)}`, cls: left < 0 ? 'over' : r.pausedAtMs ? 'hold' : 'on' };
  };
  return (
    <div className={`lv-audio pt${warn ? ' warn' : ''}`}>
      <div className="lv-audio-h"><span aria-hidden="true">♪</span><b>{tx("Performing (")}{audio.items.length})</b>{nowPlaying >= 0 && <em className="live">{tx("Now:")} {audio.items[nowPlaying].title}</em>}{warn && <em>{warn}</em>}</div>
      <div className="pt-wrap">
        <table className="pt-table">
          <thead><tr><th>#</th><th>{tx("Book")}</th><th>{tx("Artist name")}</th><th>{tx("Duration")}</th><th>{tx("Start")}</th><th>{tx("Pause")}</th><th>{tx("End")}</th><th>{tx("Timer left")}</th><th>{tx("Remarks")}</th><th>{tx("Rating")}</th></tr></thead>
          <tbody>
            {audio.items.map((i, n) => {
              const r = runs?.[String(n)];
              const started = !!r?.startedMs;
              const running = started && !r?.endedMs;
              const paused = running && !!r?.pausedAtMs;
              const c = clock(n, i.seconds);
              const act = onStage && canStart;
              return (
                <tr key={n} className={paused ? 'hold' : running ? 'run' : r?.endedMs ? 'done' : ''}>
                  <td><i>{n + 1}</i></td>
                  <td className="pt-b"><b>{i.title}</b>{i.type === 'book' && <small className="bk">{tx("Book")}</small>}</td>
                  <td>{i.artist || '—'}</td>
                  <td className="num">{mmss(i.seconds)}</td>
                  <td className="pt-act">{started && <span className="pt-t">{hmFull(r!.startedMs)}</span>}{act && !running && <button type="button" className="lv-ab" disabled={busy} onClick={() => onDo(n, 'start')}>{r?.endedMs ? tx("Again") : tx("Start")}</button>}{!started && !act && '—'}</td>
                  <td className="pt-act">{act && running ? (paused ? <button type="button" className="lv-ab" disabled={busy} onClick={() => onDo(n, 'resume')}>{tx("Resume")}</button> : <button type="button" className="lv-ab hold" disabled={busy} onClick={() => onDo(n, 'pause')}>{tx("Pause")}</button>) : (r?.pausedMs ? <small>{mmssLive(r.pausedMs / 1000)} {tx("paused")}</small> : '—')}</td>
                  <td className="pt-act">{r?.endedMs && <span className="pt-t">{hmFull(r.endedMs)}</span>}{act && running && <button type="button" className="lv-ab stop" disabled={busy} onClick={() => onDo(n, 'stop')}>{tx("End")}</button>}{!r?.endedMs && !(act && running) && '—'}</td>
                  <td className={`num tm ${c.cls}`}>{c.text}</td>
                  <td><RemarkCell title={i.title} value={r?.remark ?? ''} editable={canNote && canStart} onSave={(v) => onDo(n, 'remark', { remark: v })} /></td>
                  <td className="pt-stars">{canNote && canStart
                    ? [1, 2, 3, 4, 5].map((k) => <button type="button" key={k} className={(r?.rating ?? 0) >= k ? 'on' : ''} aria-label={`${k} of 5`} disabled={busy} onClick={() => onDo(n, 'rate', { rating: r?.rating === k ? 0 : k })}>★</button>)
                    : <span className="ro">{r?.rating ? stars(r.rating) : '—'}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pt-foot">
        <div className={`lv-audio-t${over ? ' over' : ''}`}>{tx("Total")} {mmss(total)} {tx("of")} {mmss(allowedSec)} {tx("allowed")}{over ? tx(" · too long") : ''}</div>
        <div className="pt-gr"><span>{tx("Remark on the whole performance")}</span><RemarkCell title={tx("The whole performance of the group")} value={groupRemark ?? ''} editable={canNote && canStart} onSave={(v) => onDo(-1, 'groupRemark', { remark: v })} /></div>
        <div className="pt-overall"><span>{tx("Overall rating of the group")}</span>{avg > 0 ? <><b>{(Math.round(avg * 10) / 10).toFixed(1)} / 5</b><em aria-hidden="true">{stars(avg)}</em><small>{rated.length} {tx("of")} {audio.items.length} {tx("rated")}</small></> : <small>{tx("Not rated yet")}</small>}</div>
      </div>
    </div>
  );
}
const hmFull = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const A_LABEL: Record<AttendanceState, string> = { PRESENT: 'Present', LATE: 'Late', LATE_APPROVED: 'Late, approved', PENDING: 'Waiting for approval', ABSENT: 'Absent', EXCUSED: 'Excused', NONE: 'No show' };

/** The members of the group and whether they are here, in real time. Problems are highlighted in red. */
function AttendanceStrip({ g, live, canDecide, eventId, reload }: { g?: AttendanceGroup; live: boolean; canDecide: boolean; eventId: string; reload: () => void }) {
  const [busy, setBusy] = useState('');
  if (!g || g.members.length === 0) return null;
  const c = g.counts;
  const problems = c.pending + c.absent + (live ? c.notYet : 0);
  async function decide(userId: string, approve: boolean) {
    setBusy(userId);
    try { await reviewLateArrival({ eventId, userId, approve }); notify(approve ? 'Late arrival approved' : 'Marked absent', 'success'); reload(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(''); }
  }
  const order: AttendanceState[] = ['PENDING', 'ABSENT', 'NONE', 'LATE', 'LATE_APPROVED', 'EXCUSED', 'PRESENT'];
  const list = [...g.members].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
  return (
    <details className={`lv-att${problems > 0 && live ? ' bad' : ''}`}>
      <summary>
        <span className="lv-att-h"><b>{tx("Members")}</b><small>{c.total} {tx("in the group")}</small></span>
        <span className="lv-att-c"><em className="p" title={tx("Present")}>{c.present}</em><em className="l" title={tx("Late")}>{c.late}</em><em className="a" title={tx("Late, approved")}>{c.lateApproved}</em><em className="w" title={tx("Waiting for approval")}>{c.pending}</em><em className="x" title={tx("Absent")}>{c.absent}</em><em className="n" title={tx("No show")}>{c.notYet}</em></span>
        {problems > 0 && live && <span className="lv-att-warn">{problems} {tx("need attention")}</span>}
      </summary>
      <ul>{list.map((m) => (
        <li key={m.userId} className={`s-${m.state}`}>
          <Avatar name={m.name} photoUrl={m.photoUrl} size={26} />
          <span className="nm">{m.name}<small className={m.substitute ? 'sub' : 'perm'}>{m.substitute ? tx("Substitute") : tx("Permanent")}</small></span>
          <span className="st"><Tick state={m.state} size={18} />{A_LABEL[m.state]}</span>
          {canDecide && m.state === 'PENDING' && <span className="ac"><button type="button" className="lv-ab" disabled={busy === m.userId} onClick={() => void decide(m.userId, true)}>{tx("Approve")}</button><button type="button" className="lv-ab stop" disabled={busy === m.userId} onClick={() => void decide(m.userId, false)}>{tx("Absent")}</button></span>}
        </li>
      ))}</ul>
    </details>
  );
}

'use client';

import { useEffect, useState } from 'react';
import TimeSelect, { timeLabel } from '@/components/TimeSelect';
import { longRange, type DayHours, type TimeSlotDraft } from './eventPlanTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const today = () => { const n = new Date(); return key(n.getFullYear(), n.getMonth(), n.getDate()); };
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'short', timeZone: 'UTC' });
const dayMonth = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMins = (m: number) => `${pad(Math.min(23, Math.floor(m / 60)))}:${pad(m >= 1439 ? 59 : m % 60)}`;
const gapLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/** One month as rows of seven days (Monday first). Empty cells are ''. */
function monthCells(y: number, m: number): string[] {
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  const count = new Date(y, m + 1, 0).getDate();
  const cells: string[] = Array(first).fill('');
  for (let d = 1; d <= count; d++) cells.push(key(y, m, d));
  while (cells.length % 7) cells.push('');
  return cells;
}

const PRESETS: { label: string; end: (s: string) => string }[] = [
  { label: '1 Day', end: (s) => s },
  { label: '3 Days', end: (s) => addDays(s, 2) },
  { label: '2 Weeks', end: (s) => addDays(s, 13) },
  { label: '1 Month', end: (s) => addDays(addMonths(s, 1), -1) },
  { label: '1 Year', end: (s) => addDays(addMonths(s, 12), -1) },
];

/** The list of sessions of one day: rows with a start and an end, a break between them, and a button to add one. */
function Sessions({ slots, onChange, label }: { slots: { id: string; start: string; end: string }[]; onChange: (v: { id: string; start: string; end: string }[]) => void; label: string }) {
  const update = (id: string, patch: Partial<TimeSlotDraft>) => onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const [shiftErr, setShiftErr] = useState('');
  const lastEnd = slots.length ? mins(slots[slots.length - 1].end) : 0;
  const dayFull = slots.length > 0 && lastEnd > 23 * 60 + 14;
  function add() {
    if (dayFull) { setShiftErr('The day ends at 11:59 PM, so another session cannot be added after the last one. Shorten the last session first.'); return; }
    const st = Math.min(lastEnd + 30, 23 * 60 + 29);
    setShiftErr('');
    onChange([...slots, { id: `s${Date.now()}${slots.length}`, start: fromMins(st), end: fromMins(Math.min(st + 90, 23 * 60 + 59)) }]);
  }
  /** Sets the break before session i: that session and every later one move, each keeping its own length. */
  function setBreak(i: number, minutes: number) {
    const b = Math.max(0, Math.min(600, Math.round(minutes) || 0));
    const delta = mins(slots[i - 1].end) + b - mins(slots[i].start);
    if (slots.some((s, k) => k >= i && (mins(s.end) + delta > 23 * 60 + 59 || mins(s.start) + delta < 0))) { setShiftErr('That break would push the last session past midnight. Use a shorter break.'); return; }
    setShiftErr('');
    onChange(slots.map((s, k) => (k < i ? s : { ...s, start: fromMins(mins(s.start) + delta), end: fromMins(mins(s.end) + delta) })));
  }
  const problems: string[] = shiftErr ? [shiftErr] : [];
  slots.forEach((s, i) => {
    if (mins(s.end) <= mins(s.start)) problems.push(`${label} ${i + 1} must end after it starts.`);
    if (i > 0 && mins(s.start) < mins(slots[i - 1].end)) problems.push(`${label} ${i + 1} starts before ${label.toLowerCase()} ${i} ends. Move it later.`);
  });
  return (
    <>
      <div className="ed2-slots">
        {slots.map((s, i) => (
          <div key={s.id}>
            {i > 0 && (
              <div className="ed2-brk">
                <span className="ed2-brkl">{tx("Break")}</span>
                <input type="number" min={0} max={600} step={5} aria-label={`Break before ${label.toLowerCase()} ${i + 1} in minutes`} value={Math.max(0, mins(s.start) - mins(slots[i - 1].end))} onChange={(e) => setBreak(i, Number(e.target.value))} />
                <span className="ed2-brkl">{tx("min")}</span>
                {[15, 30, 45, 60, 90].map((m) => <button type="button" key={m} className={mins(s.start) - mins(slots[i - 1].end) === m ? 'on' : ''} onClick={() => setBreak(i, m)}>{m}</button>)}
                <small>{mins(s.start) > mins(slots[i - 1].end) ? `${gapLabel(mins(s.start) - mins(slots[i - 1].end))} between the sessions` : tx("No break")}</small>
              </div>
            )}
            <div className="ed2-slot">
              <b>{label} {i + 1}</b>
              <TimeSelect value={s.start} label={`${label} ${i + 1} starts`} onChange={(v) => { setShiftErr(''); update(s.id, { start: v }); }} />
              <span>{tx("to")}</span>
              <TimeSelect value={s.end} label={`${label} ${i + 1} ends`} onChange={(v) => update(s.id, { end: v })} />
              {slots.length > 1 && <button type="button" className="sv-x" onClick={() => onChange(slots.filter((x) => x.id !== s.id))} aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}>{tx("Remove")}</button>}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="gp-btn ed2-add" onClick={add} disabled={dayFull} title={dayFull ? tx("The day ends at 11:59 PM") : undefined}>{tx("+ Add a break and another session")}</button>
      {dayFull && !shiftErr && <p className="ed2-help">{tx("The last session ends at")} {fromMins(lastEnd)}. The day ends at 11:59 PM, so no more sessions can be added.</p>}
      {problems.map((p) => <p key={p} className="error-text">{p}</p>)}
    </>
  );
}

/**
 * The dates and the daily hours of an event, in one block.
 * 1) How long: 1 Day, 3 Days, 2 Weeks, 1 Month, 1 Year, or click the first and the last day on the calendar.
 * 2) The sessions of every day: one or several (for example 9:00 to 10:30, then 1:30 to 3:00 pm).
 * The start of the event is the start of the first session, the end is the end of the last one.
 */
export default function EventDates({
  startAt,
  endAt,
  setStartAt,
  setEndAt,
  slots,
  setSlots,
  eventDays,
  dayTimes,
  setDayTimes,
  allowPast = false,
}: {
  startAt: string;
  endAt: string;
  setStartAt: (v: string) => void;
  setEndAt: (v: string) => void;
  slots: TimeSlotDraft[];
  setSlots: (v: TimeSlotDraft[]) => void;
  eventDays: string[];
  dayTimes: Record<string, DayHours>;
  setDayTimes: (v: Record<string, DayHours>) => void;
  /** Editing an event that already started: past days can be chosen. */
  allowPast?: boolean;
}) {
  const startDate = startAt.slice(0, 10);
  const endDate = endAt.slice(0, 10);
  const [view, setView] = useState(() => { const n = new Date(`${startAt.slice(0, 10) || today()}T12:00:00`); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [hover, setHover] = useState('');
  const [picking, setPicking] = useState(false);
  const min = allowPast ? '0000-01-01' : today();
  const todayYmd = today();

  // There is always at least one session. The first one starts like the old "start time", the last ends like the old "end time".
  useEffect(() => {
    if (slots.length === 0) setSlots([{ id: `s${Date.now()}`, start: allowPast ? (startAt.slice(11, 16) || '09:00') : '09:00', end: allowPast ? (endAt.slice(11, 16) || '17:00') : '17:00' }]);
  }, [slots.length, startAt, endAt, setSlots, allowPast]);

  const first = slots[0]?.start ?? '09:00';
  const lastEnd = slots[slots.length - 1]?.end ?? '17:00';
  useEffect(() => {
    if (startDate && startAt.slice(11, 16) !== first) setStartAt(`${startDate}T${first}`);
    if (endDate && endAt.slice(11, 16) !== lastEnd) setEndAt(`${endDate}T${lastEnd}`);
  }, [first, lastEnd, startDate, endDate, startAt, endAt, setStartAt, setEndAt]);

  const setRange = (s: string, e: string) => { setStartAt(`${s}T${first}`); setEndAt(`${e}T${lastEnd}`); };
  function clickDay(d: string) {
    if (d < min) return;
    if (picking && d >= startDate) { setRange(startDate, d); setPicking(false); setHover(''); return; }
    setRange(d, d);
    setPicking(true);
  }
  const shift = (v: { y: number; m: number }, by: number) => { const d = new Date(v.y, v.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() }; };
  const second = shift(view, 1);
  const last = picking && hover && hover >= startDate ? hover : endDate;
  const inRange = (d: string) => d >= startDate && d <= last;
  const dayCount = eventDays.length || 1;

  const monthName = (v: { y: number; m: number }) => `${MONTHS[v.m]} ${v.y}`;
  const month = (v: { y: number; m: number }) => (
    <div className="ed3-month">
      <h5>{monthName(v)}</h5>
      <div className="ed3-grid">
        {DOW.map((x) => <span key={x} className="ed3-dow">{x}</span>)}
        {monthCells(v.y, v.m).map((d, i) => d === '' ? <span key={i} /> : (
          <button
            key={d}
            type="button"
            disabled={d < min}
            className={`ed3-day${inRange(d) ? ' in' : ''}${d === startDate ? ' first' : ''}${d === last ? ' last' : ''}${d === todayYmd ? ' today' : ''}${(i % 7) > 4 ? ' we' : ''}`}
            onClick={() => clickDay(d)}
            onMouseEnter={() => picking && setHover(d)}
            aria-label={dayMonth(d)}
            aria-pressed={d === startDate || d === endDate}
          >{Number(d.slice(8))}</button>
        ))}
      </div>
    </div>
  );
  const nextMon = (() => { const d = new Date(`${todayYmd}T12:00:00Z`); const w = (d.getUTCDay() + 6) % 7; return addDays(todayYmd, 7 - w); })();
  const satThis = (() => { const d = new Date(`${todayYmd}T12:00:00Z`); const w = (d.getUTCDay() + 6) % 7; return addDays(todayYmd, (5 - w + 7) % 7); })();
  const quick = [
    { label: tx("Today"), s: todayYmd, e: todayYmd },
    { label: tx("Tomorrow"), s: addDays(todayYmd, 1), e: addDays(todayYmd, 1) },
    { label: tx("This weekend"), s: satThis, e: addDays(satThis, 1) },
    { label: tx("Next week"), s: nextMon, e: addDays(nextMon, 6) },
    { label: tx("Next month"), s: addMonths(todayYmd, 1), e: addMonths(todayYmd, 1) },
  ].filter((q) => q.s >= min);
  const goToday = () => { const n = new Date(); setView({ y: n.getFullYear(), m: n.getMonth() }); };

  return (
    <div className="ed3">
      <section className="ed3-cal">
        <div className="ed3-top">
          <button type="button" className="ed3-arrow" onClick={() => setView(shift(view, -1))} aria-label={tx("Previous month")}>‹</button>
          <b>{monthName(view)} <i>–</i> {monthName(second)}</b>
          <button type="button" className="ed3-arrow" onClick={() => setView(shift(view, 1))} aria-label={tx("Next month")}>›</button>
          <button type="button" className="ed3-today" onClick={goToday}>{tx("Today")}</button>
        </div>
        <div className="ed3-presets" role="group" aria-label={tx("Length of the event")}>
          {PRESETS.map((p) => {
            const on = startDate !== '' && p.end(startDate) === endDate;
            return <button type="button" key={p.label} className={on ? 'on' : ''} onClick={() => { setRange(startDate || todayYmd, p.end(startDate || todayYmd)); setPicking(false); }}>{p.label}</button>;
          })}
          <span className="ed3-hint">{picking ? tx("Now click the last day") : tx("Or click the first day, then the last")}</span>
        </div>
        <div className="ed3-months">{month(view)}{month(second)}</div>
      </section>

      <div className="ed3-mid">
        <div className="ed3-card">
          <h4>{tx("Sessions of each day")}</h4>
          <p className="ed2-help">{tx("One session is enough. If the event stops and restarts the same day, add another (for example 9:00 to 10:30, then 1:30 to 3:00 pm).")}</p>
          <Sessions slots={slots} onChange={setSlots} label={tx("Session")} />
        </div>
        {eventDays.length > 1 && (
          <details className="ed-days ed3-card">
            <summary>{tx("Different sessions on some days")} <small>{tx("(optional)")}</small></summary>
            <div className="ed-daylist">
              {eventDays.map((d) => {
                const own = dayTimes[d]?.slots;
                const cur = own ?? slots;
                const custom = !!own;
                const set = (next: TimeSlotDraft[]) => {
                  const clean = next.map((x, i) => ({ start: x.start, end: x.end, id: x.id ?? String(i) }));
                  const same = clean.length === slots.length && clean.every((x, i) => x.start === slots[i].start && x.end === slots[i].end);
                  const copy = { ...dayTimes };
                  if (same) delete copy[d];
                  else copy[d] = { start: clean[0].start, end: clean[clean.length - 1].end, slots: clean.map((x) => ({ start: x.start, end: x.end })) };
                  setDayTimes(copy);
                };
                return (
                  <details key={d} className={`ed-dayd${custom ? ' custom' : ''}`}>
                    <summary>
                      <span className="ed-dname"><b>{weekday(d)}</b> {dayMonth(d)}</span>
                      <span className="ed-dsum">{cur.map((x) => `${timeLabel(x.start)} – ${timeLabel(x.end)}`).join('  ·  ')}</span>
                      {custom && <em>{tx("Different")}</em>}
                    </summary>
                    <Sessions slots={cur.map((x, i) => ({ id: (x as TimeSlotDraft).id ?? `d${i}`, start: x.start, end: x.end }))} onChange={set} label={tx("Session")} />
                    {custom && <button type="button" className="gp-btn" onClick={() => { const copy = { ...dayTimes }; delete copy[d]; setDayTimes(copy); }}>{tx("Use the same sessions as every day")}</button>}
                  </details>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <aside className="ed3-side">
        <div className="ed3-sum">
          <small>{tx("Your event")}</small>
          <b>{startDate ? longRange(startDate, endDate) : tx("Choose the days")}</b>
          <span>{dayCount} {dayCount === 1 ? tx("day") : tx("days")}{startDate ? ` · ${weekday(startDate)}${endDate !== startDate ? ` to ${weekday(endDate)}` : ''}` : ''}</span>
        </div>
        <div className="ed3-card ed3-quick">
          <h4>{tx("Quick select")}</h4>
          <div>
            {quick.map((q) => <button type="button" key={q.label} onClick={() => { setRange(q.s, q.e); setPicking(false); const d = new Date(`${q.s}T12:00:00`); setView({ y: d.getFullYear(), m: d.getMonth() }); }}>{q.label}</button>)}
          </div>
        </div>
      </aside>
    </div>
  );
}

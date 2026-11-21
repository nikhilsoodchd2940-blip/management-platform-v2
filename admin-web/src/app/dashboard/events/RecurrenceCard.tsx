'use client';

import { useMemo } from 'react';
import DateTimePicker from '@/components/DateTimePicker';
import { tx, dateLocale } from '@/lib/i18n/tr';

export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FREQ: { k: Frequency; t: string; d: string }[] = [
  { k: 'daily', t: 'Every day', d: 'The same time each day' },
  { k: 'weekly', t: 'Every week', d: 'On the days you choose' },
  { k: 'biweekly', t: 'Every 2 weeks', d: 'One week on, one week off' },
  { k: 'monthly', t: 'Every month', d: 'Same date each month' },
];
const MAX = 90;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nice = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The dates the series will have, worked out like the server does (date only). */
export function seriesDates(start: string, f: Frequency, days: number[], mode: 'count' | 'date', count: number, until: string): string[] {
  if (!start) return [];
  const first = new Date(`${start}T12:00:00Z`);
  const cap = mode === 'count' ? Math.max(1, Math.min(MAX, count || 1)) : MAX;
  const stop = mode === 'date' && until ? new Date(`${until}T23:59:59Z`).getTime() : Infinity;
  if (mode === 'date' && !until) return [];
  const out: string[] = [];
  if (f === 'weekly' && days.length) {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const week = new Date(first);
    week.setUTCDate(week.getUTCDate() - week.getUTCDay());
    for (let w = 0; w < MAX * 2 && out.length < cap; w++) {
      for (const d of sorted) {
        const c = new Date(week);
        c.setUTCDate(c.getUTCDate() + d);
        if (c.getTime() < first.getTime()) continue;
        if (c.getTime() > stop) return out;
        out.push(ymd(c));
        if (out.length >= cap) break;
      }
      week.setUTCDate(week.getUTCDate() + 7);
    }
    return out;
  }
  for (let i = 0; i < MAX && out.length < cap; i++) {
    const c = new Date(first);
    if (f === 'daily') c.setUTCDate(c.getUTCDate() + i);
    else if (f === 'weekly') c.setUTCDate(c.getUTCDate() + 7 * i);
    else if (f === 'biweekly') c.setUTCDate(c.getUTCDate() + 14 * i);
    else c.setUTCMonth(c.getUTCMonth() + i);
    if (c.getTime() > stop) break;
    out.push(ymd(c));
  }
  return out;
}

/**
 * "Repeat this event": every choice is explained, and a live preview lists the real dates that will be created.
 */
export default function RecurrenceCard(p: {
  on: boolean;
  setOn: (v: boolean) => void;
  frequency: Frequency;
  setFrequency: (f: Frequency) => void;
  days: number[];
  toggleDay: (d: number) => void;
  endMode: 'count' | 'date';
  setEndMode: (m: 'count' | 'date') => void;
  count: string;
  setCount: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  startDate: string;
  dayLabels: string[];
}) {
  const n = parseInt(p.count, 10);
  const dates = useMemo(() => seriesDates(p.startDate, p.frequency, p.days, p.endMode, Number.isFinite(n) ? n : 0, p.endDate), [p.startDate, p.frequency, p.days, p.endMode, n, p.endDate]);
  const startDay = p.startDate ? new Date(`${p.startDate}T12:00:00Z`).getUTCDay() : -1;
  const bad = p.endMode === 'count' ? !(Number.isInteger(n) && n >= 1 && n <= MAX) : !!p.endDate && !!p.startDate && p.endDate <= p.startDate;
  const step = (by: number) => p.setCount(String(Math.max(1, Math.min(MAX, (Number.isFinite(n) ? n : 1) + by))));

  return (
    <section className={`rc${p.on ? ' on' : ''}`} id="ev-recurring">
      <header className="rc-h">
        <span className="rc-ic" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>
        </span>
        <div className="rc-t">
          <h4>{tx("Repeat this event")}</h4>
          <p>{p.on ? tx("One event is created for each date below, all with the same groups, place and times.") : tx("Turn on to create the same event again and again, for example every week.")}</p>
        </div>
        <label className="rc-sw">
          <input type="checkbox" role="switch" checked={p.on} onChange={(e) => p.setOn(e.target.checked)} aria-label={tx("Repeat this event")} />
          <i aria-hidden="true" /><span>{p.on ? tx("On") : tx("Off")}</span>
        </label>
      </header>

      {p.on && (
        <div className="rc-body">
          <div className="rc-col">
            <div className="rc-blk">
              <h5><span>1</span> {tx("How often?")}</h5>
              <div className="rc-freq" role="radiogroup" aria-label={tx("How often")}>
                {FREQ.map((f) => (
                  <button type="button" key={f.k} role="radio" aria-checked={p.frequency === f.k} className={p.frequency === f.k ? 'on' : ''} onClick={() => p.setFrequency(f.k)}>
                    <b>{f.t}</b><small>{f.d}</small>
                  </button>
                ))}
              </div>
            </div>

            {p.frequency === 'weekly' && (
              <div className="rc-blk">
                <h5><span>2</span> {tx("On which days?")} <small>{tx("optional")}</small></h5>
                <div className="rc-days" role="group" aria-label={tx("Days of the week")}>
                  {p.dayLabels.map((l, i) => (
                    <button type="button" key={l} aria-pressed={p.days.includes(i)} aria-label={FULL[i]} className={p.days.includes(i) ? 'on' : ''} onClick={() => p.toggleDay(i)}>{l}</button>
                  ))}
                </div>
                <p className="rc-hint">{p.days.length ? `Every ${p.days.map((d) => FULL[d]).join(', ')}.` : startDay >= 0 ? `Nothing chosen: it repeats every ${FULL[startDay]}, the weekday of the first day.` : tx("Nothing chosen: it repeats on the weekday of the first day.")}</p>
              </div>
            )}

            <div className="rc-blk">
              <h5><span>{p.frequency === 'weekly' ? 3 : 2}</span> {tx("When does it stop?")}</h5>
              <div className="rc-end" role="radiogroup" aria-label={tx("When it stops")}>
                <div className={`rc-opt${p.endMode === 'count' ? ' on' : ''}`}>
                  <label><input type="radio" name="rc-end" checked={p.endMode === 'count'} onChange={() => p.setEndMode('count')} /><span><b>{tx("After a number of times")}</b><small>{tx("Including the first one")}</small></span></label>
                  {p.endMode === 'count' && (
                    <div className="rc-step">
                      <button type="button" onClick={() => step(-1)} aria-label={tx("One fewer")} disabled={(Number.isFinite(n) ? n : 1) <= 1}>−</button>
                      <input type="number" min={1} max={MAX} value={p.count} onChange={(e) => p.setCount(e.target.value)} aria-label={tx("Number of times")} />
                      <button type="button" onClick={() => step(1)} aria-label={tx("One more")} disabled={(Number.isFinite(n) ? n : 1) >= MAX}>+</button>
                      <em>{tx("times")} <small>{tx("(1 to")} {MAX})</small></em>
                    </div>
                  )}
                </div>
                <div className={`rc-opt${p.endMode === 'date' ? ' on' : ''}`}>
                  <label><input type="radio" name="rc-end" checked={p.endMode === 'date'} onChange={() => p.setEndMode('date')} /><span><b>{tx("On a date")}</b><small>{tx("No event after this day")}</small></span></label>
                  {p.endMode === 'date' && <div className="rc-date"><DateTimePicker mode="date" value={p.endDate} onChange={p.setEndDate} min={p.startDate || undefined} placeholder={tx("Choose the last day")} /></div>}
                </div>
              </div>
              {bad && <p className="rc-err" role="alert">{p.endMode === 'count' ? `Enter a number from 1 to ${MAX}.` : tx("The last day must be after the first day.")}</p>}
            </div>
          </div>

          <aside className="rc-prev" aria-live="polite">
            <span className="rc-k">{tx("Preview")}</span>
            {!p.startDate ? (
              <p className="rc-none">{tx("Choose the first day of the event in the calendar above to see the dates.")}</p>
            ) : dates.length === 0 ? (
              <p className="rc-none">{p.endMode === 'date' && !p.endDate ? tx("Choose the last day to see the dates.") : tx("No date yet.")}</p>
            ) : (
              <>
                <div className="rc-big"><b>{dates.length}</b><span>{dates.length === 1 ? tx("event") : tx("events")} {tx("will be created")}</span></div>
                <ol>
                  {dates.slice(0, 5).map((d, i) => <li key={d}><i>{i + 1}</i>{nice(d)}</li>)}
                  {dates.length > 6 && <li className="more"><i>…</i>{dates.length - 6} {tx("more")}</li>}
                  {dates.length > 5 && <li><i>{dates.length}</i>{nice(dates[dates.length - 1])}</li>}
                </ol>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

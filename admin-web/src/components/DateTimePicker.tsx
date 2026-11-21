'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import WeatherCard from './WeatherCard';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Mode = 'datetime' | 'date' | 'time';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function split(value: string, mode: Mode): { date: string; time: string } {
  if (mode === 'time') return { date: '', time: value };
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}

/**
 * Date and time picker used across the admin panel: a clear button that shows
 * the chosen moment in words, and a popover with a calendar and quick time
 * choices. The value format is the same as the native inputs
 * (YYYY-MM-DDTHH:mm, YYYY-MM-DD or HH:mm), so callers do not change.
 */
export default function DateTimePicker({
  value,
  onChange,
  mode = 'datetime',
  required,
  id,
  placeholder,
  min,
  weatherAt,
}: {
  value: string;
  onChange: (v: string) => void;
  mode?: Mode;
  required?: boolean;
  id?: string;
  placeholder?: string;
  min?: string;
  /** When set, the weather of the chosen day at this place is shown next to the time choice. */
  weatherAt?: { lat: number | string; lng: number | string };
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { date, time } = split(value, mode);
  const base = date ? new Date(date + 'T00:00:00') : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const [h, mi] = time ? time.split(':').map(Number) : [NaN, NaN];

  useEffect(() => {
    if (open && date) {
      const d = new Date(date + 'T00:00:00');
      setView({ y: d.getFullYear(), m: d.getMonth() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const w = Math.min(mode === 'datetime' ? 560 : 330, window.innerWidth - 16);
      const hgt = pop.current?.offsetHeight ?? 380;
      let top = r.bottom + 6;
      if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const out: { d: Date; other: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(view.y, view.m, 1 - lead + i);
      out.push({ d, other: i < lead || i >= lead + days });
    }
    return out;
  }, [view]);

  function emit(nextDate: string, nextTime: string) {
    if (mode === 'date') return onChange(nextDate);
    if (mode === 'time') return onChange(nextTime);
    onChange(`${nextDate || ymd(new Date())}T${nextTime || '09:00'}`);
  }
  const setHour = (hh: number) => emit(date, `${pad(hh)}:${pad(Number.isNaN(mi) ? 0 : mi)}`);
  const setMin = (mm: number) => emit(date, `${pad(Number.isNaN(h) ? 9 : h)}:${pad(mm)}`);
  const quick = (t: string) => emit(date, t);
  const today = ymd(new Date());

  const label = (() => {
    if (!value) return '';
    const parts: string[] = [];
    if (mode !== 'time' && date) parts.push(new Date(date + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
    if (mode !== 'date' && time) parts.push(time);
    return parts.join(' · ');
  })();

  const showCal = mode !== 'time';
  const showTime = mode !== 'date';

  return (
    <div className="dtp">
      <button type="button" id={id} ref={btn} className={`dtp-btn${open ? ' open' : ''}${label ? '' : ' empty'}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <span className="dtp-ico" aria-hidden>{mode === 'time' ? '🕒' : '📅'}</span>
        <span className="dtp-text">{label || placeholder || (mode === 'time' ? tx("Choose a time") : mode === 'date' ? tx("Choose a date") : tx("Choose date and time"))}</span>
        <span className="dtp-caret" aria-hidden>▾</span>
      </button>
      {required && <input className="dtp-req" tabIndex={-1} aria-hidden required value={value} onChange={() => {}} />}
      {open &&
        createPortal(
          <div ref={pop} className={`dtp-pop${showCal && showTime ? ' wide' : ''}`} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} role="dialog">
            <div className="dtp-cols">
              {showCal && (
                <div className="dtp-cal">
                  <div className="dtp-nav">
                    <button type="button" onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))} aria-label={tx("Previous month")}>‹</button>
                    <strong>{MONTHS[view.m]} {view.y}</strong>
                    <button type="button" onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))} aria-label={tx("Next month")}>›</button>
                  </div>
                  <div className="dtp-grid dtp-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
                  <div className="dtp-grid">
                    {cells.map(({ d, other }) => {
                      const k = ymd(d);
                      const disabled = !!min && k < min.slice(0, 10);
                      return (
                        <button type="button" key={k} disabled={disabled} className={`dtp-day${other ? ' other' : ''}${k === date ? ' sel' : ''}${k === today ? ' today' : ''}`} onClick={() => { emit(k, time); if (mode === 'date') setOpen(false); }}>
                          {d.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {showTime && (
                <div className="dtp-time">
                  <div className="dtp-sub">{tx("Quick choice")}</div>
                  <div className="dtp-quick">
                    {['08:00', '09:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((t) => (
                      <button type="button" key={t} className={time === t ? 'sel' : ''} onClick={() => quick(t)}>{t}</button>
                    ))}
                  </div>
                  <div className="dtp-sub">{tx("Hour")}</div>
                  <div className="dtp-chips h">
                    {Array.from({ length: 24 }, (_, i) => (
                      <button type="button" key={i} className={i === h ? 'sel' : ''} onClick={() => setHour(i)}>{pad(i)}</button>
                    ))}
                  </div>
                  <div className="dtp-sub">{tx("Minutes")}</div>
                  <div className="dtp-chips m">
                    {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                      <button type="button" key={m} className={m === mi ? 'sel' : ''} onClick={() => setMin(m)}>{pad(m)}</button>
                    ))}
                  </div>
                  {weatherAt && date && <><div className="dtp-sub" style={{ marginTop: 12 }}>{tx("Weather that day")}</div><WeatherCard compact lat={weatherAt.lat} lng={weatherAt.lng} dateMs={new Date(date + 'T12:00:00').getTime()} /></>}
                </div>
              )}
            </div>
            <div className="dtp-foot">
              <button type="button" className="link" onClick={() => { onChange(''); setOpen(false); }}>{tx("Clear")}</button>
              {showCal && <button type="button" className="link" onClick={() => { const n = new Date(); emit(ymd(n), time || `${pad(n.getHours())}:${pad(Math.round(n.getMinutes() / 5) * 5 % 60)}`); setView({ y: n.getFullYear(), m: n.getMonth() }); }}>{tx("Today")}</button>}
              <span className="dtp-chosen">{label}</span>
              <button type="button" className="done" onClick={() => setOpen(false)}>{tx("Done")}</button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

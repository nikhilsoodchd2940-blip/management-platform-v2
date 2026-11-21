'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tx } from '@/lib/i18n/tr';

const pad = (n: number) => String(n).padStart(2, '0');

/** "13:30" to "1:30 PM". */
export function timeLabel(v: string): string {
  if (!/^\d{2}:\d{2}$/.test(v)) return 'Choose a time';
  const h = Number(v.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${v.slice(3)} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * A friendly time picker: one button that shows the time, and a small panel with the hour, the minutes and AM or PM.
 * The value is always "HH:mm" (24 hours), like a normal time input.
 */
export default function TimeSelect({ value, onChange, label, compact }: { value: string; onChange: (v: string) => void; label: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const valid = /^\d{2}:\d{2}$/.test(value);
  const h24 = valid ? Number(value.slice(0, 2)) : 9;
  const min = valid ? Number(value.slice(3)) : 0;
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const place = useCallback(() => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = 380;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top: r.bottom + h + 12 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 });
  }, []);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // The panel follows its button when the page moves; it closes only on a click outside, Escape or Done.
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, place]);

  const set = (h12v: number, m: number, isPm: boolean) => onChange(`${pad((h12v % 12) + (isPm ? 12 : 0))}:${pad(m)}`);

  return (
    <div className={`tsel${compact ? ' compact' : ''}`} ref={box}>
      <button type="button" className="tsel-btn" aria-label={label} aria-expanded={open} onClick={(e) => { e.preventDefault(); if (!open) place(); setOpen(!open); }} ref={btn}>
        <span>{timeLabel(value)}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      </button>
      {open && createPortal(
        <div className="tsel-pop" ref={popRef} role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left }} onClick={(e) => e.preventDefault()}>
          <div className="tsel-cols">
            <div>
              <h6>{tx("Hour")}</h6>
              <div className="tsel-grid h">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                  <button type="button" key={h} className={h === h12 ? 'on' : ''} onClick={() => set(h, min, pm)}>{h}</button>
                ))}
              </div>
            </div>
            <div>
              <h6>{tx("Minutes")}</h6>
              <div className="tsel-grid m">
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <button type="button" key={m} className={m === min ? 'on' : ''} onClick={() => set(h12, m, pm)}>{pad(m)}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="tsel-foot">
            <div className="tsel-ampm">
              <button type="button" className={!pm ? 'on' : ''} onClick={() => set(h12, min, false)}>AM</button>
              <button type="button" className={pm ? 'on' : ''} onClick={() => set(h12, min, true)}>PM</button>
            </div>
            <button type="button" className="tsel-done" onClick={() => setOpen(false)}>{tx("Done")}</button>
          </div>
          <label className="tsel-type"><span>{tx("Or type the time")}</span><input type="time" value={valid ? value : ''} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && onChange(e.target.value)} /></label>
        </div>,
        document.body
      )}
    </div>
  );
}

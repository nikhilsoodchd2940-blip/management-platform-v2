'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DAYS_FR, MONTHS_FR, frIso, isoOf } from '@/lib/finance';
import { tx } from '@/lib/i18n/tr';

/** A date field: "Choose a date" until a day is picked, then "13 novembre 2026". The calendar is in French, weeks start on Monday. Value is YYYY-MM-DD. */
export default function DatePicker({ label, value, onChange, min, max, placeholder = 'Choose a date' }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const today = isoOf(Date.now());
  const seed = value || (min && min > today ? min : today);
  const [view, setView] = useState(() => ({ y: Number(seed.slice(0, 4)), m: Number(seed.slice(5, 7)) - 1 }));
  const [box, setBox] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const up = window.innerHeight - r.bottom < 340 && r.top > 340;
    setBox({ left: Math.min(r.left, window.innerWidth - 300), top: up ? r.top - 6 : r.bottom + 6, up });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => isoOf(new Date(view.y, view.m, 1 - lead + i).getTime()));
  const off = (iso: string) => (!!min && iso < min) || (!!max && iso > max);

  return (
    <>
      <button ref={btn} type="button" className={`dp${value ? ' set' : ''}${open ? ' open' : ''}`} onClick={() => { if (!open) setView({ y: Number(seed.slice(0, 4)), m: Number(seed.slice(5, 7)) - 1 }); setOpen((o) => !o); }}>
        <span className="dd-cap">{label}</span>
        <span className="dd-val">{value ? frIso(value) : placeholder}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
      </button>
      {open && box && createPortal(
        <div ref={pop} className="dp-pop" style={{ left: box.left, ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }) }}>
          <div className="dp-head">
            <button type="button" aria-label={tx("Previous year")} onClick={() => go(-12)}>«</button>
            <button type="button" aria-label={tx("Previous month")} onClick={() => go(-1)}>‹</button>
            <b>{MONTHS_FR[view.m]} {view.y}</b>
            <button type="button" aria-label={tx("Next month")} onClick={() => go(1)}>›</button>
            <button type="button" aria-label={tx("Next year")} onClick={() => go(12)}>»</button>
          </div>
          <div className="dp-week">{DAYS_FR.map((d) => <i key={d}>{d}</i>)}</div>
          <div className="dp-days">
            {cells.map((iso) => (
              <button type="button" key={iso} disabled={off(iso)} className={`${Number(iso.slice(5, 7)) - 1 !== view.m ? 'out' : ''}${iso === value ? ' sel' : ''}${iso === today ? ' today' : ''}`} onClick={() => { onChange(iso); setOpen(false); }}>{Number(iso.slice(8))}</button>
            ))}
          </div>
          <div className="dp-foot">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}>{tx("Clear")}</button>
            <button type="button" disabled={off(today)} onClick={() => { onChange(today); setOpen(false); }}>{tx("Today")}</button>
            {max && <small>{tx("until")} {frIso(max)}</small>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

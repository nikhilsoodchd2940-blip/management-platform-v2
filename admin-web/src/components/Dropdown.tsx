'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tx } from '@/lib/i18n/tr';

export interface DropdownOption { value: string; label: string; hint?: string }

/** "LEVEL 1" reads better as "Level 1". Only shouts-in-capitals names are softened. */
export const nice = (s: string) => (s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()) : s);

/** A styled drop-down list: a small caption, the chosen value, and a rounded panel (with a search box when the list is long). */
export default function Dropdown({ label, value, onChange, options, allLabel, className = '' }: { label: string; value: string; onChange: (v: string) => void; options: DropdownOption[]; allLabel?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const all: DropdownOption[] = useMemo(() => (allLabel !== undefined ? [{ value: '', label: allLabel }, ...options] : options), [allLabel, options]);
  const shown = useMemo(() => all.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase())), [all, q]);
  const current = all.find((o) => o.value === value);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const room = window.innerHeight - r.bottom;
    setBox({ left: r.left, top: room < 300 && r.top > room ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 220), up: room < 300 && r.top > room });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => { setActive(Math.max(0, shown.findIndex((o) => o.value === value))); }, [open, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); btn.current?.focus(); };
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active].value); }
  };

  return (
    <>
      <button ref={btn} type="button" className={`dd${value ? ' set' : ''}${open ? ' open' : ''} ${className}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="dd-cap">{label}</span>
        <span className="dd-val">{current ? nice(current.label) : tx("Choose…")}</span>
        <svg viewBox="0 0 20 20" aria-hidden><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && box && createPortal(
        <div ref={pop} className="dd-pop" role="listbox" style={{ left: box.left, width: box.width, ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }) }} onKeyDown={onListKey}>
          {all.length > 8 && <input autoFocus className="dd-search" placeholder={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="dd-list" tabIndex={all.length > 8 ? -1 : 0} ref={(el) => { if (el && all.length <= 8) el.focus(); }}>
            {shown.map((o, i) => (
              <button type="button" key={o.value || '_all'} role="option" aria-selected={o.value === value} className={`${o.value === value ? 'on' : ''}${i === active ? ' hl' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}>
                <span><b>{nice(o.label)}</b>{o.hint && <small>{o.hint}</small>}</span>
                {o.value === value && <svg viewBox="0 0 20 20" aria-hidden><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            ))}
            {shown.length === 0 && <p>{tx("Nothing matches.")}</p>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

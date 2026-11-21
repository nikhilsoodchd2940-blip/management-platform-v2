'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { zoneStyle } from '@/lib/zoneColor';
import { tx } from '@/lib/i18n/tr';

/** Shared page parts: the green banner, clickable data tiles, coloured panels, sortable columns, chips, and a date field. */

export function Banner({ eyebrow, title, sub, children }: { eyebrow?: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="lm zp-head">
      <div className="lm-head">
        <div>{eyebrow && <span className="loc-eyebrow">{eyebrow}</span>}<h1>{title}</h1></div>
        {children && <div className="loc-actions">{children}</div>}
      </div>
      {sub && <p className="zp-sub">{sub}</p>}
    </div>
  );
}

export interface KpiItem { icon?: string; label: string; value: ReactNode; hint?: string; gold?: boolean; red?: boolean; active?: boolean; onClick?: () => void }

/** A row of data tiles. A tile with onClick is a button (it filters or sorts the list below). */
export function Kpis({ items }: { items: KpiItem[] }) {
  return (
    <div className="kt-kpis" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map((it) => {
        const cls = `kt-k${it.gold ? ' gold' : ''}${it.red ? ' red' : ''}${it.active ? ' on' : ''}`;
        const body = <>{it.icon && <i>{it.icon}</i>}<span>{it.label}</span><strong>{it.value}</strong>{it.hint && <small>{it.hint}</small>}</>;
        return it.onClick ? <button type="button" key={it.label} className={cls} onClick={it.onClick} aria-pressed={!!it.active}>{body}</button> : <div key={it.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

/** A bordered panel: the whole border carries the colour (tone picks one of the green / gold family). */
export function Panel({ title, count, sub, tone = 0, actions, children, className = '' }: { title?: ReactNode; count?: ReactNode; sub?: ReactNode; tone?: number; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`kt-panel ${className}`} style={zoneStyle(tone) as CSSProperties}>
      {(title || actions) && (
        <header>
          <div>{title && <h2>{title}{count !== undefined && <em>{count}</em>}</h2>}{sub && <p>{sub}</p>}</div>
          {actions && <div className="kt-actions">{actions}</div>}
        </header>
      )}
      <div className="kt-body">{children}</div>
    </section>
  );
}

export type Dir = 'asc' | 'desc';
/** Click a column header to sort by it; click again to reverse. */
export function useSort<T>(rows: T[], keys: Record<string, (r: T) => string | number>, initial?: { key: string; dir: Dir }) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(initial ?? null);
  const sorted = useMemo(() => {
    if (!sort || !keys[sort.key]) return rows;
    const f = keys[sort.key];
    return [...rows].sort((a, b) => {
      const x = f(a), y = f(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: string) => setSort((c) => (c?.key === key ? { key, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { sorted, sort, toggle, setSort };
}

export function Th({ k, sort, toggle, children, num }: { k: string; sort: { key: string; dir: Dir } | null; toggle: (k: string) => void; children: ReactNode; num?: boolean }) {
  const on = sort?.key === k;
  return (
    <th className={num ? 'num' : ''} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`kt-th${on ? ' on' : ''}`} onClick={() => toggle(k)}>{children}<i aria-hidden>{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</i></button>
    </th>
  );
}

export function Pill({ tone = '', children }: { tone?: '' | 'ok' | 'gold' | 'teal' | 'red' | 'info'; children: ReactNode }) {
  return <span className={`kt-pill ${tone}`}>{children}</span>;
}

/** Round filter chips with a count; the chosen one is filled. */
export function Chips({ items, value, onChange }: { items: { value: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="kt-chips">
      {items.map((c) => <button type="button" key={c.value} className={value === c.value ? 'on' : ''} onClick={() => onChange(value === c.value && c.value !== '' ? '' : c.value)}>{c.label}{c.count !== undefined && <em>{c.count}</em>}</button>)}
    </div>
  );
}

/** A date box styled like the drop-downs (small caption, big value). */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={`kt-date${value ? ' set' : ''}`}>
      <span>{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export const Clear = ({ onClick }: { onClick: () => void }) => <button type="button" className="loc-btn ghost kt-clear" onClick={onClick}>{tx("Clear filters")} ✕</button>;

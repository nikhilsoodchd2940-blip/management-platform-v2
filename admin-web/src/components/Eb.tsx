'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Search, X } from 'lucide-react';
import { useSort } from '@/components/kit';
import { tx, txf } from '@/lib/i18n/tr';

/** The shared look of the list screens: green banner, tinted tiles, filter bar, coloured and clickable table. */

export const EB_COLS = ['#1e9d66', '#1f78d1', '#e8832f', '#7c4cc4', '#1aa3b8', '#c2417a'] as const;
export const EB_SOFT = ['#e3f6ec', '#e4f0fc', '#fdebd9', '#efe8fa', '#e0f5f8', '#fbe4ee'] as const;

export function EbHero({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <section className="eb2-hero">
      <div className="eb2-ht">
        <span className="eb2-line" aria-hidden />
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="eb2-acts">{children}</div>}
    </section>
  );
}

export interface EbTile { label: string; value: ReactNode; icon: ReactNode; on?: boolean; onClick?: () => void; hint?: string }
const TILE_CLS = ['t1', 't2', 't3', 't4'];
export function EbTiles({ items }: { items: EbTile[] }) {
  return (
    <div className="eb2-tiles">
      {items.map((t, i) => (
        <button type="button" key={t.label} className={`${TILE_CLS[i % 4]}${t.on ? ' on' : ''}`} onClick={t.onClick} aria-pressed={!!t.on}>
          <span className="eb2-ti" aria-hidden>{t.icon}</span>
          <small>{t.label}</small><b>{t.value}</b>
          {t.hint && <em className="eb2-hint">{t.hint}</em>}
          <ChevronRight className="eb2-go" size={20} aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function EbSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="eb2-search"><Search size={18} aria-hidden /><input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />{value && <button type="button" aria-label={tx("Clear")} onClick={() => onChange('')}><X size={16} /></button>}</label>
  );
}

export function EbBar({ children, onClear, active }: { children: ReactNode; onClear: () => void; active: boolean }) {
  return (
    <div className="eb2-bar rh-bar">
      {children}
      <button type="button" className="eb2-clear" onClick={onClear} disabled={!active}><RotateCcw size={15} /> {tx("Clear all")}</button>
    </div>
  );
}

/** Round filter tabs with a count. */
export function EbTabs({ items, value, onChange }: { items: { value: string; label: string; count: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="eb2-tabs" role="tablist">
      {items.map((t) => <button type="button" role="tab" key={t.value} aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}<em>{t.count}</em></button>)}
    </div>
  );
}

/** A white panel with a green header (icon, title, count) and an optional note line. */
export function EbPanel({ icon, title, count, note, actions, children, footer, className = '', id }: { icon?: ReactNode; title: string; count?: ReactNode; note?: string; actions?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`eb2-panel ${className}`} id={id}>
      <header>{icon && <i aria-hidden>{icon}</i>}<h2>{title}</h2>{count !== undefined && <em>{count}</em>}{actions && <div className="eb2-pa">{actions}</div>}</header>
      {note && <p className="eb2-note">{note}</p>}
      <div className="eb2-pbody">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  );
}

export interface EbCol<T> {
  key: string;
  label: string;
  render: (r: T) => ReactNode;
  /** Makes the header sort by this value. */
  sort?: (r: T) => string | number;
  /** Makes every cell of the column a button. */
  onCell?: (r: T) => void;
  hint?: string;
  num?: boolean;
  stack?: boolean;
  width?: string;
  /** The last column of buttons: no sorting, right aligned. */
  actions?: boolean;
}

/** A table whose columns each carry their own colour (header, side borders), sort from the header, and click through from the cells. */
export function EbTable<T>({ rows, cols, rowKey, pageSize = 10, empty, loading, initialSort, rowClass }: { rows: T[]; cols: EbCol<T>[]; rowKey: (r: T) => string; pageSize?: number; empty: string; loading?: boolean; initialSort?: { key: string; dir: 'asc' | 'desc' }; rowClass?: (r: T) => string }) {
  const keys = useMemo(() => Object.fromEntries(cols.filter((c) => c.sort).map((c) => [c.key, c.sort as (r: T) => string | number])), [cols]);
  const { sorted, sort, toggle } = useSort(rows, keys, initialSort);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages);
  useEffect(() => { setPage(1); }, [rows.length]);
  const shown = sorted.slice((cur - 1) * pageSize, cur * pageSize);
  const style = (i: number) => ({ ['--c' as string]: EB_COLS[i % EB_COLS.length], ['--cb' as string]: EB_SOFT[i % EB_SOFT.length] }) as CSSProperties;
  return (
    <>
      {loading ? <p className="kt-empty">{tx("Loading…")}</p> : rows.length === 0 ? <p className="kt-empty">{empty}</p> : (
        <div className="eb2-scroll">
          <table className="eb3-table">
            <colgroup>{cols.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
            <thead>
              <tr>
                {cols.map((c, i) => {
                  const on = sort?.key === c.key;
                  return (
                    <th key={c.key} style={style(i)} className={c.num || c.actions ? 'num' : ''} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      {c.sort ? <button type="button" className={on ? 'on' : ''} onClick={() => toggle(c.key)}>{c.label}<i aria-hidden>{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</i></button> : <span>{c.label}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={rowKey(r)} className={rowClass?.(r) ?? ''}>
                  {cols.map((c, i) => (
                    <td key={c.key} style={style(i)} className={c.num || c.actions ? 'num' : ''}>
                      {c.onCell ? <button type="button" className={`eb2-cell${c.stack ? ' stack' : ''}`} title={c.hint} onClick={() => c.onCell?.(r)}>{c.render(r)}</button> : <div className={`eb2-cell static${c.stack ? ' stack' : ''}${c.actions ? ' acts' : ''}`}>{c.render(r)}</div>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="eb2-foot">
        <span>{txf("Showing {a} of {b} results", { a: shown.length, b: rows.length })}</span>
        {pages > 1 && (
          <nav aria-label={tx("Pages")}>
            <button type="button" aria-label={tx("Previous")} disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === cur ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
            <button type="button" aria-label={tx("Next")} disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRight size={16} /></button>
          </nav>
        )}
      </div>
    </>
  );
}

export function EbPill({ tone = 'ok', children }: { tone?: 'ok' | 'gold' | 'teal' | 'red' | 'info' | ''; children: ReactNode }) {
  return <span className={`kt-pill ${tone}`}>{children}</span>;
}

/** A dashed drop area that also opens the file chooser. */
export function EbDrop({ accept, multiple, onFiles, title, hint, picked }: { accept: string; multiple?: boolean; onFiles: (f: FileList) => void; title: string; hint?: string; picked?: string }) {
  const [over, setOver] = useState(false);
  const id = useMemo(() => `drop-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <label htmlFor={id} className={`eb2-drop${over ? ' on' : ''}${picked ? ' has' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}>
      <span className="eb2-drop-ic" aria-hidden>⬆</span>
      <b>{picked || title}</b>
      {hint && <small>{hint}</small>}
      <input id={id} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { if (e.target.files && e.target.files.length) onFiles(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

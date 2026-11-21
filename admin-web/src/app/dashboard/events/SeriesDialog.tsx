'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { tx, dateLocale } from '@/lib/i18n/tr';

export interface SeriesEvent { id: string; title: string; status: 'draft' | 'published' | 'cancelled'; startMs: number; endMs: number; groupIds: string[]; location: string }

const fmt = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** All the occurrences of a recurring series: open, edit or cancel each one, or act on the whole series. */
export default function SeriesDialog({
  events, readOnly, busy, onClose, onOpen, onEdit, onCancel, onPublishAll, onCancelAll, onDelete, onDeleteAll,
}: {
  events: SeriesEvent[];
  readOnly?: boolean;
  busy?: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onCancel: (id: string) => void;
  onPublishAll: () => void;
  onCancelAll: () => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0];
  const now = Date.now();
  const count = (s: string) => sorted.filter((e) => e.status === s).length;
  const next = sorted.find((e) => e.status !== 'cancelled' && e.endMs >= now);
  const phase = (e: SeriesEvent) => (e.status === 'cancelled' ? 'Cancelled' : e.status === 'draft' ? 'Draft' : e.endMs < now ? 'Finished' : e.startMs <= now ? 'In progress' : 'Upcoming');
  const allGroups = new Set(sorted.flatMap((e) => e.groupIds)).size;
  if (!first) return null;
  return createPortal(
    <div className="fx-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog ser" role="dialog" aria-modal="true" aria-label={first.title}>
        <header className="ser-head">
          <div><span className="ser-eyebrow">{tx("Recurring series")}</span><h2>{first.title}</h2><p>{sorted.length} {tx("occurrence")}{sorted.length === 1 ? '' : 's'} · {allGroups} {tx("group")}{allGroups === 1 ? '' : 's'}{first.location ? ` · ${first.location}` : ''}</p></div>
          <button type="button" className="fx-btn" onClick={onClose}>{tx("Close")}</button>
        </header>
        <div className="ser-stats">
          <div><span>{tx("Next")}</span><b>{next ? new Date(next.startMs).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '—'}</b></div>
          <div><span>{tx("Published")}</span><b>{count('published')}</b></div>
          <div><span>{tx("Drafts")}</span><b>{count('draft')}</b></div>
          <div><span>{tx("Cancelled")}</span><b>{count('cancelled')}</b></div>
        </div>
        {!readOnly && (
          <div className="ser-actions">
            <button type="button" className="fx-btn" disabled={busy || count('draft') === 0} onClick={onPublishAll}>{tx("Publish every draft")}</button>
            <button type="button" className="fx-btn ser-danger" disabled={busy || sorted.every((e) => e.status === 'cancelled')} onClick={onCancelAll}>{tx("Cancel the whole series")}</button>
            <button type="button" className="fx-btn ser-danger" disabled={busy || sorted.every((e) => e.status === 'published')} onClick={onDeleteAll}>{tx("Delete the series")}</button>
          </div>
        )}
        <div className="ser-list">
          {sorted.map((e, i) => (
            <div key={e.id} className={`ser-row s-${phase(e).toLowerCase().replace(' ', '-')}`}>
              <span className="ser-n">{i + 1}</span>
              <div className="ser-when"><strong>{fmt(e.startMs)}</strong><small>{tx("until")} {new Date(e.endMs).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })} · {e.groupIds.length} {tx("group")}{e.groupIds.length === 1 ? '' : 's'}</small></div>
              <span className={`ev-pill p-${phase(e).toLowerCase().replace(' ', '-')}`}>{phase(e)}</span>
              <div className="ser-btns">
                <button type="button" className="fx-btn" onClick={() => onOpen(e.id)}>{tx("Open")}</button>
                {!readOnly && e.status !== 'cancelled' && <button type="button" className="fx-btn" onClick={() => onEdit(e.id)}>{tx("Edit")}</button>}
                {!readOnly && e.status !== 'cancelled' && <button type="button" className="fx-btn ser-danger" onClick={() => onCancel(e.id)}>{tx("Cancel")}</button>}
                {!readOnly && e.status !== 'published' && <button type="button" className="fx-btn ser-danger" onClick={() => onDelete(e.id)}>{tx("Delete")}</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

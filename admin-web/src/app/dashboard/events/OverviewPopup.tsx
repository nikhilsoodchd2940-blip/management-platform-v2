'use client';

import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { tx } from '@/lib/i18n/tr';

export interface OverviewKurel { id: string; name: string; place: string }
export interface OverviewDay { label: string; from: string; to: string }
export interface OverviewMark { userId: string; name: string; status: string; site: string }
export interface OverviewPlace { id: string; name: string; supervisors: string; checked: number }

export type OverviewKind = 'kurels' | 'duration' | 'checked' | 'places';

interface Props {
  kind: OverviewKind;
  eventTitle: string;
  kurels: OverviewKurel[];
  days: OverviewDay[];
  durationLabel: string;
  checked: number;
  invited: number;
  marks: OverviewMark[] | null;
  places: OverviewPlace[];
  onClose: () => void;
}

const STATUS: Record<string, string> = { PRESENT: 'On time', LATE: 'Late', EXCUSED: 'Excused', UNEXCUSED: 'Absent', ABSENT: 'Absent' };

/** Pop-up with the details behind one Overview tile of an event. */
export default function OverviewPopup({ kind, eventTitle, kurels, days, durationLabel, checked, invited, marks, places, onClose }: Props) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const title = kind === 'kurels' ? 'Kurels invited' : kind === 'duration' ? 'Duration and schedule' : kind === 'checked' ? 'Who has checked in' : 'Places of the event';
  const sub = kind === 'kurels' ? `${kurels.length} kurel${kurels.length === 1 ? '' : 's'} take part` : kind === 'duration' ? durationLabel : kind === 'checked' ? `${checked} of ${invited} checked in` : `${places.length} place${places.length === 1 ? '' : 's'}`;
  const rate = invited ? Math.round((checked / invited) * 100) : 0;
  return createPortal(
    <div className="mls-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mls-sheet ovp" role="dialog" aria-label={title}>
        <header>
          <div><h3>{title}</h3><p>{eventTitle} · {sub}</p></div>
          <button type="button" className="mls-x" onClick={onClose} aria-label={tx("Close")}>×</button>
        </header>
        <div className="ovp-body">
          {kind === 'kurels' && (
            kurels.length === 0 ? <p className="ovp-none">{tx("No kurel is invited yet.")}</p> : kurels.map((k) => (
              <div className="ovp-row" key={k.id}><b>{k.name}</b><span>{k.place || '—'}</span></div>
            ))
          )}
          {kind === 'duration' && (
            days.length === 0 ? <p className="ovp-none">{tx("No schedule yet.")}</p> : days.map((d, i) => (
              <div className="ovp-row" key={i}><b>{d.label}</b><span>{d.from} {tx("to")} {d.to}</span></div>
            ))
          )}
          {kind === 'checked' && (
            <>
              <div className="ovp-bar"><i style={{ width: `${Math.min(100, rate)}%` }} /></div>
              <p className="ovp-rate">{rate}{tx("% of invited members have checked in")}</p>
              {marks === null ? <p className="ovp-none">{tx("Loading…")}</p> : marks.length === 0 ? <p className="ovp-none">{tx("Nobody has checked in yet.")}</p> : marks.map((m) => (
                <div className="ovp-row" key={m.userId}><b>{m.name}</b><span>{STATUS[m.status] ?? m.status}{m.site ? ` · ${m.site}` : ''}</span></div>
              ))}
            </>
          )}
          {kind === 'places' && (
            places.length === 0 ? <p className="ovp-none">{tx("No place is set for this event.")}</p> : places.map((p) => (
              <div className="ovp-row" key={p.id}><b>{p.name}</b><span>{p.supervisors || tx("No supervisor")} · {p.checked} {tx("checked in")}</span></div>
            ))
          )}
        </div>
        <footer><span /><button type="button" className="secondary" onClick={onClose}>{tx("Close")}</button></footer>
      </div>
    </div>,
    document.body
  );
}

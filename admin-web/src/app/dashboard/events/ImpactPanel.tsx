'use client';

import { useState } from 'react';
import { AlertTriangle, Clock, Send } from 'lucide-react';
import type { DelayImpact } from '@/lib/functions';
import { tx, dateLocale } from '@/lib/i18n/tr';

const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * What a delay or an overrun does to the rest of the programme: a summary, the choices the supervisor has
 * (move everything later, shorten the next performance, or report it to the person above), and the affected
 * performances as a short list. A person without the right to change the schedule can still report it.
 */
export default function ImpactPanel({ from, late, list, canAdjust, busy, reportTo, onApply, onReport, onClose }: {
  from: string; late?: boolean; list: DelayImpact[]; canAdjust: boolean; busy: boolean; reportTo: string;
  onApply: (mode: 'shift' | 'shorten') => void; onReport?: () => void; onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const firsts = list.filter((i) => i.first);
  const squeeze = firsts.length > 0 && firsts.every((i) => i.squeezeable);
  const maxShift = list.reduce((m, i) => Math.max(m, i.shiftMinutes), 0);
  const lastEnd = list.reduce((m, i) => Math.max(m, i.suggestedEndMs), 0);
  const people = new Set(list.flatMap((i) => i.sharedMembers)).size;
  const shown = all ? list : list.slice(0, 6);

  if (list.length === 0) {
    return (
      <div className="ip ip-ok">
        <div className="ip-head"><Clock size={20} /><div><b>{tx("The change for")} {from} {tx("affects nobody else")}</b><span>{tx("No other performance has to move.")}</span></div></div>
        <div className="ip-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>{tx("Close")}</button></div>
      </div>
    );
  }
  return (
    <div className="ip">
      <div className="ip-head">
        <AlertTriangle size={22} />
        <div>
          <b>{late ? `${from} finished late` : `${from} is delayed`}: {list.length} {tx("performance")}{list.length === 1 ? '' : 's'} {tx("pushed back")}</b>
          <span>{tx("Nothing has been changed yet. Choose what to do.")}</span>
        </div>
      </div>
      <div className="ip-stats">
        <div><b>{list.length}</b><span>{tx("groups affected")}</span></div>
        <div><b>{maxShift} {tx("min")}</b><span>{tx("longest wait")}</span></div>
        <div><b>{hm(lastEnd)}</b><span>{tx("new end of the day")}</span></div>
        {people > 0 && <div><b>{people}</b><span>{tx("members in two groups")}</span></div>}
      </div>

      <div className="ip-choices">
        {canAdjust && (
          <>
            <div className="ip-opt">
              <b>{tx("Move all of them later")}</b>
              <span>{tx("Every performance after this one moves back and keeps its full length. The day ends later.")}</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onApply('shift')}>{tx("Move")} {list.length} {tx("later and notify")}</button>
            </div>
            <div className="ip-opt">
              <b>{tx("Shorten the next one")}</b>
              <span>{squeeze ? tx("The next performance starts late but still ends on time, so nothing else moves.") : tx("The delay is too long to fit into the next slot.")}</span>
              <button type="button" className="btn btn-secondary" disabled={busy || !squeeze} onClick={() => onApply('shorten')}>
                {squeeze ? `Shorten ${firsts.map((i) => `${i.groupName} to ${Math.round((i.originalEndMs - i.suggestedStartMs) / 60000)} min`).join(', ')}` : tx("Too long to shorten")}
              </button>
            </div>
          </>
        )}
        {onReport && <div className="ip-opt">
          <b>{canAdjust ? tx("Let someone above decide") : tx("You cannot change the schedule")}</b>
          <span>{canAdjust ? `Send this to ${reportTo} with the details, and follow the answer in Reports and replies.` : `Report it to ${reportTo}. They are alerted at once and can change the schedule or send it higher.`}</span>
          <button type="button" className={canAdjust ? 'btn btn-secondary' : 'btn btn-primary'} onClick={onReport}><Send size={14} /> {tx("Report to")} {reportTo}</button>
        </div>}
      </div>

      <ol className="ip-list">
        {shown.map((i) => (
          <li key={i.slotId} className={i.first ? 'first' : ''}>
            <div><b>{i.groupName}</b>{i.first && <em>{tx("next")}</em>}<small>{i.reason}{i.sharedMembers.length ? ` · ${i.sharedMembers.join(', ')}` : ''}</small></div>
            <span className="ip-was">{hm(i.originalStartMs)}</span>
            <span className="ip-arrow" aria-hidden="true">→</span>
            <span className="ip-now">{hm(i.suggestedStartMs)}</span>
            <span className="ip-plus">+{i.shiftMinutes} {tx("min")}</span>
          </li>
        ))}
      </ol>
      <div className="ip-foot">
        {list.length > 6 && <button type="button" className="btn btn-secondary" onClick={() => setAll((v) => !v)}>{all ? tx("Show fewer") : `Show all ${list.length}`}</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose}>{tx("Close")}</button>
      </div>
    </div>
  );
}

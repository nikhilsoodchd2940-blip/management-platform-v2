'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { where } from 'firebase/firestore';
import { setEventShifts } from '@/lib/functions';
import { useCollection } from '@/lib/useCollection';
import type { Slot } from './planParts';
import { notify } from '@/lib/notify';
import SupervisionStep from './SupervisionStep';
import type { ShiftDraft, SiteDraft } from './eventPlanTypes';
import { tx } from '@/lib/i18n/tr';

export interface EditableShift {
  id: string;
  label: string;
  startAt?: { toMillis?: () => number };
  endAt?: { toMillis?: () => number };
  siteId?: string;
  siteIds?: string[];
  groupIds?: string[];
  supervisors: { userId: string; name: string; role: 'main' | 'member'; can?: string[]; leaderId?: string }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Changes the supervisors of an event that already exists: shifts, main supervisors, their teams and rights. */
export default function EditSupervision({
  eventId,
  title,
  startMs,
  endMs,
  sites,
  groups,
  shifts: initial,
  onClose,
}: {
  eventId: string;
  title: string;
  startMs: number;
  endMs: number;
  sites: { id: string; name: string; lat?: number; lng?: number; groupIds?: string[] }[];
  groups: { id: string; name: string }[];
  shifts: EditableShift[];
  onClose: () => void;
}) {
  const [shifts, setShifts] = useState<ShiftDraft[]>(() =>
    initial.map((sh) => ({
      id: sh.id,
      label: sh.label,
      startAt: toLocal(sh.startAt?.toMillis?.() ?? startMs),
      endAt: toLocal(sh.endAt?.toMillis?.() ?? endMs),
      siteIds: sh.siteIds ?? (sh.siteId ? [sh.siteId] : []),
      groupIds: sh.groupIds ?? [],
      people: sh.supervisors.map((p) => ({ userId: p.userId, name: p.name, role: p.role, can: p.can, leaderId: p.leaderId })),
    }))
  );
  const slots = useCollection<Slot>('eventSlots', [where('eventId', '==', eventId)], eventId);
  const performances = useMemo(() => (slots ?? []).map((s) => ({ id: s.id, groupId: s.groupId, groupName: s.groupName, startMs: s.startAt.toMillis(), endMs: s.endAt.toMillis() })), [slots]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startAt = toLocal(startMs);
  const endAt = toLocal(endMs);
  const siteDrafts: SiteDraft[] = useMemo(() => sites.map((s) => ({ id: s.id, name: s.name, address: '', lat: s.lat === undefined ? '' : String(s.lat), lng: s.lng === undefined ? '' : String(s.lng), groupIds: s.groupIds ?? [] })), [sites]);
  const eventDays = useMemo(() => {
    const out: string[] = [];
    const d = new Date(`${startAt.slice(0, 10)}T12:00:00Z`);
    const last = new Date(`${endAt.slice(0, 10)}T12:00:00Z`);
    while (d <= last && out.length < 60) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [startAt, endAt]);
  const minutesBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 16)}:00Z`) - Date.parse(`${a.slice(0, 16)}:00Z`)) / 60000);

  async function save() {
    setError('');
    for (const sh of shifts) {
      const a = new Date(sh.startAt).getTime();
      const b = new Date(sh.endAt).getTime();
      if (!(b > a)) return setError(`${sh.label}: the end must be after the start.`);
      if (a < startMs || b > endMs) return setError(`${sh.label} is outside the event dates.`);
      if (!sh.people.some((p) => p.role === 'main')) return setError(`${sh.label} needs a main supervisor, or delete the shift.`);
    }
    setBusy(true);
    try {
      const res = await setEventShifts({
        eventId,
        shifts: shifts.map((sh) => ({
          id: sh.id, label: sh.label.trim(), startMs: new Date(sh.startAt).getTime(), endMs: new Date(sh.endAt).getTime(), siteIds: sh.siteIds, groupIds: sh.groupIds,
          supervisors: sh.people.map((p) => ({ userId: p.userId, role: p.role, ...(p.can ? { can: p.can } : {}), ...(p.leaderId ? { leaderId: p.leaderId } : {}) })),
        })),
      });
      const crit = Number((res.data as { criticalConflicts?: number }).criticalConflicts ?? 0);
      notify(crit ? `Supervisors saved. ${crit} critical conflict${crit === 1 ? '' : 's'} found: see the history.` : 'Supervisors saved. Everyone new was notified.', crit ? 'info' : 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fx-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog" role="dialog" aria-modal="true" aria-label={tx("Change the supervisors")} style={{ width: 'min(980px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}>
        <h2>{tx("Supervisors —")} {title}</h2>
        <p className="fx-intro">{tx("Change the shifts, the main supervisors and their teams for this event. Only members of the groups taking part can be chosen. New supervisors are notified.")}</p>
        <SupervisionStep
          shifts={shifts}
          setShifts={setShifts}
          sites={siteDrafts}
          startAt={startAt}
          endAt={endAt}
          eventDays={eventDays}
          dayTimes={{}}
          kurelIds={groups.map((g) => g.id)}
          groups={groups}
          minutesBetween={minutesBetween}
          performances={performances}
          toMs={(local) => new Date(local).getTime()}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="fx-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{tx("Cancel")}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? tx("Saving…") : tx("Save the supervisors")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

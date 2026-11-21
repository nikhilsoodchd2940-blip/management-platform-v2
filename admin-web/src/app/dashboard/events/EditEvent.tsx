'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { updateEvent } from '@/lib/functions';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { notify } from '@/lib/notify';
import WeatherCard from '@/components/WeatherCard';
import MapPicker, { polygonRadius, type MapValue } from '@/components/MapPicker';
import EventDates from './EventDates';
import EventPlan from './EventPlan';
import PlacesEditor from './PlacesEditor';
import type { DayHours, TimeSlotDraft } from './eventPlanTypes';
import { tx } from '@/lib/i18n/tr';

interface Full {
  title: string;
  mainGroupId: string;
  subGroupIds: string[];
  startAt: Timestamp;
  endAt: Timestamp;
  status?: string;
  geofenceRadiusMeters: number;
  geofencePolygon?: { lat: number; lng: number }[];
  location: { lat: number; lng: number; address?: string };
  kind?: 'event' | 'rehearsal' | 'meeting' | 'special_program';
  purpose?: string;
  requirements?: string;
  expectedAttendees?: number;
  timeSlots?: { start: string; end: string }[];
  dailySchedule?: { date: string; start: string; end: string; slots?: { start: string; end: string }[] }[];
}

type Tab = 'basics' | 'dates' | 'groups' | 'place' | 'places' | 'schedule' | 'supervisors';
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'basics', label: 'Name', hint: 'Name and purpose' },
  { id: 'dates', label: 'Dates', hint: 'Days and hours' },
  { id: 'groups', label: 'Groups', hint: 'Who takes part' },
  { id: 'place', label: 'Check-in', hint: 'Pin and check-in area' },
  { id: 'places', label: 'Places', hint: 'Where each group performs' },
  { id: 'schedule', label: 'Schedule', hint: 'Group times' },
  { id: 'supervisors', label: 'Supervisors', hint: 'Shifts and teams' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const daysBetween = (a: string, b: string) => {
  const out: string[] = [];
  const s = Date.parse(`${a.slice(0, 10)}T12:00:00Z`);
  const e = Date.parse(`${b.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return out;
  for (let t = s; t <= e && out.length < 400; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/**
 * Changes anything about an event that exists (draft or published): name, dates and hours, groups, place,
 * the schedule of each group, and the supervisors. Name, dates, groups and place are saved together with
 * "Save changes". The schedule and the supervisors have their own save buttons.
 */
export default function EditEvent({ eventId, onClose, onSupervisors }: { eventId: string; onClose: () => void; onSupervisors?: (eventId: string) => void }) {
  const { activeLeafGroups, byId } = useGroupHierarchy();
  const [ev, setEv] = useState<Full | null>(null);
  const [tab, setTab] = useState<Tab>('basics');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [slots, setSlots] = useState<TimeSlotDraft[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<string, DayHours>>({});
  const [groups, setGroups] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [place, setPlace] = useState<MapValue>({ lat: '', lng: '', address: '', polygon: [] });
  const [radius, setRadius] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'events', eventId)).then((s) => {
      if (!s.exists()) return onClose();
      const d = s.data() as Full;
      setEv(d);
      setTitle(d.title);
      setPurpose(d.purpose ?? '');
      setStartAt(toLocal(d.startAt.toMillis()));
      setEndAt(toLocal(d.endAt.toMillis()));
      setSlots((d.timeSlots ?? []).map((t, i) => ({ id: `s${i}`, start: t.start, end: t.end })));
      const dt: Record<string, DayHours> = {};
      (d.dailySchedule ?? []).forEach((x) => { dt[x.date] = { start: x.start, end: x.end, ...(x.slots ? { slots: x.slots } : {}) }; });
      setDayTimes(dt);
      setGroups(d.subGroupIds ?? []);
      setPlace({ lat: String(d.location?.lat ?? ''), lng: String(d.location?.lng ?? ''), address: d.location?.address ?? '', polygon: d.geofencePolygon ?? [] });
      setRadius(String(d.geofenceRadiusMeters ?? 100));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const eventDays = useMemo(() => daysBetween(startAt, endAt), [startAt, endAt]);

  const underMain = useMemo(() => {
    const main = ev?.mainGroupId;
    const ok = (id: string): boolean => {
      let cur: (typeof byId)[string] | undefined = byId[id];
      let guard = 0;
      while (cur && guard++ < 12) {
        if (cur.type === 'main') return cur.id === main;
        cur = cur.parentGroupId ? byId[cur.parentGroupId] : undefined;
      }
      return false;
    };
    return activeLeafGroups.filter((g) => ok(g.id)).map((g) => ({ id: g.id, name: g.name, parent: byId[g.parentGroupId ?? '']?.name ?? 'Other' })).sort((a, b) => a.parent.localeCompare(b.parent) || a.name.localeCompare(b.name));
  }, [activeLeafGroups, byId, ev?.mainGroupId]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? underMain.filter((g) => g.name.toLowerCase().includes(q) || g.parent.toLowerCase().includes(q)) : underMain;
  }, [underMain, search]);
  const blocks = useMemo(() => {
    const m = new Map<string, typeof shown>();
    shown.forEach((g) => m.set(g.parent, [...(m.get(g.parent) ?? []), g]));
    return [...m.entries()];
  }, [shown]);

  if (!ev) return null;
  const touch = <T,>(set: (v: T) => void) => (v: T) => { setDirty(true); set(v); };
  const toggle = (id: string) => { setDirty(true); setGroups((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const removedCount = ev.subGroupIds.filter((g) => !groups.includes(g)).length;
  const addedCount = groups.filter((g) => !ev.subGroupIds.includes(g)).length;

  async function save() {
    setError('');
    if (!title.trim()) return setError(tx("Give the event a name (Name tab)."));
    if (!startAt || !endAt || endAt <= startAt) return setError(tx("The event must end after it starts (Dates tab)."));
    if (slots.some((t) => !t.start || !t.end || t.end <= t.start)) return setError(tx("Each session must end after it starts (Dates tab)."));
    if (groups.length === 0) return setError(tx("Choose at least one group (Groups tab)."));
    if (place.lat === '' || place.lng === '' || Number.isNaN(Number(place.lat))) return setError(tx("Place the pin on the map (Place tab)."));
    if (place.polygon.length > 0 && place.polygon.length < 3) return setError(tx("Draw at least 3 corners for the area, or clear it (Place tab)."));
    const hasArea = place.polygon.length >= 3;
    if (!hasArea && !(Number(radius) > 0)) return setError(tx("Enter the check-in radius (Place tab)."));
    if (removedCount > 0 && !confirm(`${removedCount} group${removedCount === 1 ? '' : 's'} will be taken out of the event. Their performance slots and book choices are removed with them, and their members are no longer invited. Continue?`)) return;
    setBusy(true);
    try {
      const r = await updateEvent({
        eventId,
        title: title.trim(),
        mainGroupId: ev!.mainGroupId,
        subGroupIds: groups,
        location: { lat: Number(place.lat), lng: Number(place.lng), address: place.address || undefined },
        geofenceRadiusMeters: hasArea ? polygonRadius(place.polygon) : Number(radius),
        ...(hasArea ? { geofencePolygon: place.polygon } : {}),
        startAtMs: new Date(startAt).getTime(),
        endAtMs: new Date(endAt).getTime(),
        kind: ev!.kind || undefined,
        purpose: purpose.trim() || undefined,
        requirements: ev!.requirements || undefined,
        expectedAttendees: typeof ev!.expectedAttendees === 'number' ? ev!.expectedAttendees : undefined,
        ...(slots.length > 1 ? { timeSlots: slots.map((t) => ({ start: t.start, end: t.end })) } : {}),
        ...(eventDays.length > 1 ? { dailySchedule: eventDays.filter((d) => dayTimes[d] && (dayTimes[d].start !== startAt.slice(11, 16) || dayTimes[d].end !== endAt.slice(11, 16) || (dayTimes[d].slots?.length ?? 0) > 1)).map((d) => ({ date: d, start: dayTimes[d].start, end: dayTimes[d].end, ...(dayTimes[d].slots && dayTimes[d].slots!.length > 1 ? { slots: dayTimes[d].slots } : {}) })) } : {}),
      });
      const out = r.data.slotsOutsideCount ?? 0;
      notify(out > 0 ? `Event updated. ${out} group time${out === 1 ? ' is' : 's are'} now outside the event hours: check the Schedule tab.` : 'Event updated', out > 0 ? 'info' : 'success');
      if (out > 0) { setDirty(false); setEv({ ...ev!, subGroupIds: groups }); setTab('schedule'); } else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  }

  const close = () => { if (!dirty || confirm(tx("Close without saving your changes?"))) onClose(); };

  return createPortal(
    <div className="fx-backdrop ee-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="fx-dialog ee" role="dialog" aria-modal="true" aria-label={tx("Edit event")}>
        <header className="ee-head">
          <div>
            <h2>{tx("Edit event")}</h2>
            <p>{ev.title}{ev.status === 'published' ? tx(" · published: changes reach the groups and members at once") : tx(" · draft")}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={close}>{tx("Close")}</button>
        </header>
        <nav className="ee-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              <b>{t.label}</b><small>{t.hint}</small>
            </button>
          ))}
        </nav>

        <div className="ee-body">
          {tab === 'basics' && (
            <div className="ee-pane">
              <label><span>{tx("Event name")}</span><input value={title} onChange={(e) => touch(setTitle)(e.target.value)} /></label>
              <label><span>{tx("Purpose (optional)")}</span><textarea rows={4} value={purpose} onChange={(e) => touch(setPurpose)(e.target.value)} /></label>
            </div>
          )}

          {tab === 'dates' && (
            <div className="ee-pane">
              <p className="fx-intro">{tx("If the start moves, every group time that has not started yet moves by the same amount. You can set different hours for single days, or several sessions a day.")}</p>
              <EventDates startAt={startAt} endAt={endAt} setStartAt={touch(setStartAt)} setEndAt={touch(setEndAt)} slots={slots} setSlots={touch(setSlots)} eventDays={eventDays} dayTimes={dayTimes} setDayTimes={touch(setDayTimes)} allowPast />
              <WeatherCard lat={place.lat} lng={place.lng} dateMs={new Date(startAt).getTime()} />
            </div>
          )}

          {tab === 'groups' && (
            <div className="ee-pane">
              <div className="gp-bar">
                <span><b>{groups.length}</b> {tx("groups take part")}{addedCount > 0 && <> · <b>{addedCount}</b> {tx("added")}</>}{removedCount > 0 && <> · <b>{removedCount}</b> {tx("removed")}</>}</span>
                <div>
                  <button type="button" className="gp-btn" onClick={() => { setDirty(true); setGroups((p) => [...new Set([...p, ...shown.map((g) => g.id)])]); }}>{tx("Select all shown")}</button>
                  <button type="button" className="gp-btn" onClick={() => { setDirty(true); setGroups((p) => p.filter((id) => !shown.some((g) => g.id === id))); }}>{tx("Unselect all shown")}</button>
                </div>
              </div>
              <input className="ee-search" placeholder={tx("Search a group or a city")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="gp-list">
                {blocks.length === 0 ? <p className="fx3-note">{tx("No group matches.")}</p> : blocks.map(([label, items]) => {
                  const nOn = items.filter((g) => groups.includes(g.id)).length;
                  const allOn = nOn === items.length;
                  return (
                    <section key={label} className="gp-city">
                      <header>
                        <strong>{label}</strong>
                        <span className="gp-count">{nOn} {tx("of")} {items.length}</span>
                        <button type="button" className="gp-btn" onClick={() => { setDirty(true); setGroups((p) => (allOn ? p.filter((id) => !items.some((g) => g.id === id)) : [...new Set([...p, ...items.map((g) => g.id)])])); }}>{allOn ? tx("Unselect all") : tx("Select all")}</button>
                      </header>
                      <div className="gp-grid">
                        {items.map((g) => {
                          const on = groups.includes(g.id);
                          return (
                            <button type="button" key={g.id} className={`gp-card${on ? ' on' : ''}`} onClick={() => toggle(g.id)} aria-pressed={on}>
                              <span className="gp-tick" aria-hidden>{on ? '✓' : ''}</span>
                              <span className="gp-name">{g.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
              {removedCount > 0 && <p className="rv-warn">{removedCount} {tx("group")}{removedCount === 1 ? '' : 's'} {tx("will be removed. Their performance slots go with them. Newly added groups have no slot: give them one in the Schedule tab.")}</p>}
              {addedCount > 0 && removedCount === 0 && <p className="rv-warn">{tx("Newly added groups have no performance time yet. Give them one in the Schedule tab after you save.")}</p>}
            </div>
          )}

          {tab === 'place' && (
            <div className="ee-pane">
              <p className="fx-intro">{tx("Move the pin or draw the check-in area. This is the main meeting point. Add more places, and choose which groups perform where, in the Places tab.")}</p>
              <MapPicker value={place} onChange={touch(setPlace)} radius={Number(radius) || undefined} />
              {place.polygon.length < 3 && (
                <label className="ee-radius"><span>{tx("Check-in radius (metres)")}</span>
                  <input type="number" min="1" value={radius} onChange={(e) => touch(setRadius)(e.target.value)} />
                </label>
              )}
            </div>
          )}

          {tab === 'places' && (
            <div className="ee-pane">
              {dirty && <p className="rv-warn">{tx("You have unsaved changes in the other tabs. Press “Save changes” first, so the groups you chose here are the right ones.")}</p>}
              <PlacesEditor eventId={eventId} groupIds={groups} />
            </div>
          )}

          {tab === 'schedule' && (
            <div className="ee-pane">
              {dirty && <p className="rv-warn">{tx("You have unsaved changes in the other tabs. Press “Save changes” first, so the schedule uses the new dates and groups.")}</p>}
              <EventPlan eventId={eventId} onChangeEvent={() => setTab('dates')} />
            </div>
          )}

          {tab === 'supervisors' && (
            <div className="ee-pane">
              {dirty && <p className="rv-warn">{tx("You have unsaved changes in the other tabs. Press “Save changes” first, so the shifts use the new dates and groups.")}</p>}
              <p className="fx-intro">{tx("Change the shifts, their hours, the main supervisors and their teams. Only members of the groups taking part can be chosen.")}</p>
              <button type="button" className="btn btn-primary" disabled={!onSupervisors} onClick={() => onSupervisors?.(eventId)}>{tx("Open the supervisors")}</button>
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}
        {(tab === 'basics' || tab === 'dates' || tab === 'groups' || tab === 'place') && (
          <div className="fx-actions ee-foot">
            <span className="ee-note">{dirty ? tx("You have unsaved changes.") : tx("No changes yet.")} {tx("Name, dates, groups and place are saved together.")}</span>
            <button type="button" className="btn btn-secondary" onClick={close}>{tx("Cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? tx("Saving…") : tx("Save changes")}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

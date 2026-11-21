'use client';

import PlaceSearch from '@/components/PlaceSearch';
import MapPicker, { polygonRadius } from '@/components/MapPicker';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import {
  createEvent as createEventFn,
  createEventSlots as createEventSlotsFn,
  cancelEvent as cancelEventFn,
  publishEvent as publishEventFn,
  publishEventSeries as publishEventSeriesFn,
  createRecurringEvent as createRecurringEventFn,
  cancelEventSeries as cancelEventSeriesFn,
  setEventSites as setEventSitesFn,
  setEventShifts as setEventShiftsFn,
} from '@/lib/functions';
import { zonedToUtcMs, DEFAULT_TIME_ZONE } from '@/lib/timeZones';
import { useCollection } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { notify } from '@/lib/notify';
import { useMyScope } from '@/lib/useMyScope';
import ProposeEvent from './ProposeEvent';
import EditSupervision from './EditSupervision';
import { PersonLink } from '@/components/MemberProfile';
import RecurrenceCard, { type Frequency } from './RecurrenceCard';
import SupervisionStep from './SupervisionStep';
import WizardShell, { WizSvg, type WizIcon } from '@/components/WizardShell';
import EventDates from './EventDates';
import TimeSelect, { timeLabel } from '@/components/TimeSelect';
import Dropdown from '@/components/Dropdown';
import { WeatherPlaces } from '@/components/WeatherCard';
import DateTimePicker from '@/components/DateTimePicker';
import ConflictPanel, { type ConflictActions, type ConflictDraft, type ConflictState } from './ConflictPanel';
import { TIER_LABEL, TIER_RIGHTS, tierOf } from './TeamSetup';
import { longRange, shortWhen, hoursLabel, type DayHours, type ShiftDraft, type SiteDraft, type TimeSlotDraft } from './eventPlanTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

// Minimal shape of the bits of the Google Maps Places JS API this file
// actually touches — avoids pulling in the @types/google.maps package
// for four fields. Loaded dynamically at runtime (see useGoogleMaps
// below), never bundled, so this is a type-only stand-in for `window.google`.
interface GoogleMapsPlace {
  formatted_address?: string;
  geometry?: { location?: { lat(): number; lng(): number } };
}
interface GoogleMapsNamespace {
  maps: {
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        opts?: Record<string, unknown>
      ) => { addListener(event: string, handler: () => void): void; getPlace(): GoogleMapsPlace };
    };
  };
}
declare global {
  interface Window {
    google?: GoogleMapsNamespace;
  }
}


interface GroupRow {
  id: string;
  name: string;
  type: 'main' | 'country' | 'city' | 'group';
  parentGroupId?: string;
  status: 'active' | 'archived';
  timeZone?: string;
  zoneId?: string;
  localZoneId?: string;
}

interface LocalZoneRow { name: string; cityId: string; active?: boolean }

interface EventRow {
  id: string;
  title: string;
  mainGroupId: string;
  subGroupIds: string[];
  status: 'draft' | 'published' | 'cancelled';
  startAt: { seconds: number };
  endAt: { seconds: number };
  seriesId?: string;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 16 Nov 2026, 16–17 Nov 2026, 28 Nov – 3 Dec 2026: short enough for the side menu. */
function shortSpan(a: string, b: string): string {
  if (!a) return '—';
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = (b || a).split('-').map(Number);
  if (a === b || !b) return `${ad} ${MON[am - 1]} ${ay}`;
  if (ay === by && am === bm) return `${ad}–${bd} ${MON[am - 1]} ${ay}`;
  if (ay === by) return `${ad} ${MON[am - 1]} – ${bd} ${MON[bm - 1]} ${ay}`;
  return `${ad} ${MON[am - 1]} ${ay} – ${bd} ${MON[bm - 1]} ${by}`;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const PAGE_SIZE = 50;
/** Value of a group's day when it performs on every day of the event. */
const EVERY_DAY = '*';
/** “Day 2 · Sun 8 Nov” */
const dayName = (d: string, i: number) => `Day ${i + 1} · ${new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;

export default function EventsManage({ onCreated }: { onCreated?: (eventId?: string) => void } = {}) {
  const lastCreated = useRef('');
  const { t } = useLocale();
  const myScope = useMyScope();
  const canApproveConflicts = !myScope.scope || myScope.scope.role === 'super_admin';
  const v18 = t.events;
  const DAY_LABELS = v18.days;
  const [rawGroups, setGroups] = useState<GroupRow[]>([]);
  const [rawEvents, setEvents] = useState<EventRow[]>([]);
  // Only current data: a place whose city or country was deleted or archived is never offered, and events lose groups that no longer exist.
  const groups = useMemo(() => {
    const by = new Map(rawGroups.map((g) => [g.id, g]));
    const live = (g: GroupRow) => {
      let p = g.parentGroupId ? by.get(g.parentGroupId) : undefined;
      if (g.parentGroupId && !p) return false;
      for (let i = 0; p && i < 6; i++) {
        if (p.status !== 'active') return false;
        p = p.parentGroupId ? by.get(p.parentGroupId) : undefined;
        if (!p) return true;
      }
      return true;
    };
    return rawGroups.filter(live);
  }, [rawGroups]);
  const events = useMemo(() => {
    const ids = new Set(groups.filter((g) => g.type === 'group' && g.status === 'active').map((g) => g.id));
    return rawEvents.map((ev) => ({ ...ev, subGroupIds: ev.subGroupIds.filter((id) => ids.has(id)), had: ev.subGroupIds.length })).filter((ev) => ev.subGroupIds.length > 0 || ev.had === 0);
  }, [rawEvents, groups]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [title, setTitle] = useState('');
  const [mainGroupId, setMainGroupId] = useState('');
  const [subGroupIds, setSubGroupIds] = useState<string[]>([]);
  const [subGroupFilterCountryId, setSubGroupFilterCountryId] = useState('');
  const [subGroupFilterCityId, setSubGroupFilterCityId] = useState('');
  const [subGroupFilterZoneId, setSubGroupFilterZoneId] = useState('');
  const [subGroupFilterLocalZoneId, setSubGroupFilterLocalZoneId] = useState('');
  const zoneRows = useZones();
  const localZoneRows = useCollection<LocalZoneRow>('localZones', []);
  const [auto, setAuto] = useState<{ day: string; time: string; minutes: string; gap: string; perDay: string; split: boolean; counts: Record<string, string> }>({ day: EVERY_DAY, time: '09:00', minutes: '30', gap: '5', perDay: '', split: false, counts: {} });
  const [autoOn, setAutoOn] = useState(false);
  const [autoMsg, setAutoMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [subGroupSearch, setSubGroupSearch] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('100');
  const [polygon, setPolygon] = useState<{ lat: number; lng: number }[]>([]);
  // Places: the first one is the pin / area above, more can be added. Every place is a site of the event.
  const [placeName, setPlaceName] = useState('');
  const [extraPlaces, setExtraPlaces] = useState<{ id: string; name: string; address: string; lat: string; lng: string }[]>([]);
  const [siteGroups, setSiteGroups] = useState<Record<string, string[]>>({});
  const [siteFilter, setSiteFilter] = useState({ city: '', text: '' });
  const [timeSlots, setTimeSlots] = useState<TimeSlotDraft[]>([]);
  const [shifts, setShifts] = useState<ShiftDraft[]>([]);
  const [mapsOpen, setMapsOpen] = useState<Record<string, boolean>>({ main: true });
  const [activePlace, setActivePlace] = useState('main');
  const [audience, setAudience] = useState<'main' | 'specific'>('main');
  const [activeSite, setActiveSite] = useState('');
  const [excluded, setExcluded] = useState<{ id: string; name: string }[]>([]);
  const [pane, setPane] = useState<'create' | 'list'>('create');
  const [dayTimes, setDayTimes] = useState<Record<string, DayHours>>({});
  const [conflictState, setConflictState] = useState<ConflictState>({ checked: false, critical: 0, approved: false });
  const [startAt, setStartAt] = useState(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [memberDeadline, setMemberDeadline] = useState('');
  const [audioDeadline, setAudioDeadline] = useState('');
  const [endAt, setEndAt] = useState(toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<'count' | 'date'>('count');
  const [occurrenceCount, setOccurrenceCount] = useState('4');
  const [endByDate, setEndByDate] = useState('');
  const [publishImmediately, setPublishImmediately] = useState(false);
  // Per-group schedule for a multi-day event: which day, what time (in the group's city) and how long.
  const [plan, setPlan] = useState<Record<string, { day: string; time: string; minutes: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  // The create wizard: 1 What, 2 When, 3 Where, 4 Who, 5 Event admins (supervisors and shifts), 6 Review and create, 7 done.
  const [step, setStep] = useState(1);
  const [purpose, setPurpose] = useState('');
  const [passed, setPassed] = useState<number[]>([]);
  const [created, setCreated] = useState<{ id: string; title: string; startMs: number; endMs: number; sites: { id: string; name: string; lat?: number; lng?: number; groupIds?: string[] }[]; groups: { id: string; name: string }[] } | null>(null);
  const [seriesMade, setSeriesMade] = useState(false);
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  // Which events show in the list: 'main' = org-wide events (spans more
  // than one leaf group — a specific group organizing its own thing
  // wouldn't do that), or 'group' = only events that include the one
  // leaf group picked in filterGroupId. No backend/schema change needed
  // for this — subGroupIds already carries exactly this information,
  // this is purely a client-side view of it.
  const [viewMode, setViewMode] = useState<'main' | 'group'>('main');
  const [filterGroupId, setFilterGroupId] = useState('');

  useEffect(() => {
    const unsubGroups = onSnapshot(query(collection(db, 'groups'), orderBy('name')), (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GroupRow, 'id'>) })));
    });
    const unsubEvents = onSnapshot(
      query(collection(db, 'events'), orderBy('startAt', 'desc'), limit(pageSize)),
      (snap) => {
        setEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventRow, 'id'>) })));
        setLoading(false);
      }
    );
    return () => {
      unsubGroups();
      unsubEvents();
    };
  }, [pageSize]);

  const mainGroups = groups.filter((g) => g.type === 'main' && g.status === 'active');

  const groupById = useMemo(() => {
    const map: Record<string, GroupRow> = {};
    groups.forEach((g) => (map[g.id] = g));
    return map;
  }, [groups]);

  // Full path from root, e.g. "xyz / USA / Houston / Houston A" — used
  // in the events table where the Main Group isn't otherwise implied.
  const fullPathLabel = useMemo(() => {
    const cache: Record<string, string> = {};
    function build(id: string): string {
      if (cache[id]) return cache[id];
      const node = groupById[id];
      if (!node) return id;
      const label = node.parentGroupId ? `${build(node.parentGroupId)} / ${node.name}` : node.name;
      cache[id] = label;
      return label;
    }
    return build;
  }, [groupById]);

  // Path relative to the currently-selected Main Group, e.g.
  // "USA / Houston / Houston A" — used in the create-event picker, where
  // repeating the Main Group's own name in every option would be noise.
  function relativePathLabel(id: string): string {
    const parts: string[] = [];
    let current: GroupRow | undefined = groupById[id];
    while (current && current.type !== 'main') {
      parts.unshift(current.name);
      current = current.parentGroupId ? groupById[current.parentGroupId] : undefined;
    }
    return parts.join(' / ');
  }

  // Every leaf 'group' whose ancestry (group -> city -> country -> main)
  // resolves up to the selected Main Group — walked client-side since
  // the full tree is already loaded, no extra Firestore reads needed.
  const availableSubGroups = useMemo(() => {
    function resolvesToMain(groupId: string): boolean {
      let current: GroupRow | undefined = groupById[groupId];
      while (current) {
        if (current.type === 'main') return current.id === mainGroupId;
        current = current.parentGroupId ? groupById[current.parentGroupId] : undefined;
      }
      return false;
    }
    return groups
      .filter((g) => g.type === 'group' && g.status === 'active' && resolvesToMain(g.id))
      .map((g) => ({ ...g, relativePath: relativePathLabel(g.id) }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }, [groups, groupById, mainGroupId]);

  function toggleSubGroup(id: string) {
    setSubGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Narrows the (potentially hundreds-long) Groups checklist down to a
  // manageable size — pick a Country/City to only see that area's
  // groups, and/or type to filter by name, instead of scrolling a flat
  // list of everything under the Main Group.
  const countriesUnderMain = useMemo(
    () =>
      groups
        .filter((g) => g.type === 'country' && g.status === 'active' && g.parentGroupId === mainGroupId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groups, mainGroupId]
  );

  function ancestorOfType(groupId: string, type: 'country' | 'city'): string | undefined {
    let current: GroupRow | undefined = groupById[groupId];
    while (current) {
      if (current.type === type) return current.id;
      current = current.parentGroupId ? groupById[current.parentGroupId] : undefined;
    }
    return undefined;
  }

  // Zones -> Cities -> Local zones narrow each other, so every list only
  // shows choices that still make sense with what is already picked.
  const zoneChoices = useMemo(
    () =>
      (zoneRows ?? [])
        .filter((z) => z.status !== 'archived')
        .filter((z) => (subGroupFilterCountryId ? z.countryId === subGroupFilterCountryId : countriesUnderMain.some((c) => c.id === z.countryId)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [zoneRows, subGroupFilterCountryId, countriesUnderMain]
  );
  const cityChoices = useMemo(
    () =>
      groups
        .filter((g) => g.type === 'city' && g.status === 'active')
        .filter((g) => (subGroupFilterCountryId ? g.parentGroupId === subGroupFilterCountryId : countriesUnderMain.some((c) => c.id === g.parentGroupId)))
        .filter((g) => !subGroupFilterZoneId || g.zoneId === subGroupFilterZoneId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groups, subGroupFilterCountryId, subGroupFilterZoneId, countriesUnderMain]
  );
  const localZoneChoices = useMemo(() => {
    const cityIds = new Set(cityChoices.map((c) => c.id));
    return (localZoneRows ?? [])
      .filter((z) => z.active !== false)
      .filter((z) => (subGroupFilterCityId ? z.cityId === subGroupFilterCityId : cityIds.has(z.cityId)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [localZoneRows, cityChoices, subGroupFilterCityId]);
  const localZoneName = (id?: string) => (id ? (localZoneRows ?? []).find((z) => z.id === id)?.name : undefined);

  const anyFilter = Boolean(subGroupFilterCountryId || subGroupFilterZoneId || subGroupFilterCityId || subGroupFilterLocalZoneId || subGroupSearch);
  function clearFilters() {
    setSubGroupFilterCountryId('');
    setSubGroupFilterZoneId('');
    setSubGroupFilterCityId('');
    setSubGroupFilterLocalZoneId('');
    setSubGroupSearch('');
  }

  const filteredSubGroups = useMemo(() => {
    const term = subGroupSearch.trim().toLowerCase();
    return availableSubGroups.filter((g) => {
      const city = ancestorOfType(g.id, 'city');
      if (subGroupFilterCountryId && ancestorOfType(g.id, 'country') !== subGroupFilterCountryId) return false;
      if (subGroupFilterZoneId && (!city || groupById[city]?.zoneId !== subGroupFilterZoneId)) return false;
      if (subGroupFilterCityId && city !== subGroupFilterCityId) return false;
      if (subGroupFilterLocalZoneId && g.localZoneId !== subGroupFilterLocalZoneId) return false;
      if (term && !g.relativePath.toLowerCase().includes(term)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ancestorOfType closes over groupById
  }, [availableSubGroups, subGroupFilterCountryId, subGroupFilterZoneId, subGroupFilterCityId, subGroupFilterLocalZoneId, subGroupSearch, groupById]);

  // Visible groups gathered under their city so a long list stays readable.
  const groupedByCity = useMemo(() => {
    const map = new Map<string, { cityId: string; label: string; items: typeof filteredSubGroups }>();
    for (const g of filteredSubGroups) {
      const cityId = ancestorOfType(g.id, 'city') ?? 'none';
      const label = cityId === 'none' ? 'Other' : g.relativePath.split(' / ').slice(0, -1).join(' / ') || groupById[cityId]?.name || 'Other';
      if (!map.has(cityId)) map.set(cityId, { cityId, label, items: [] });
      map.get(cityId)!.items.push(g);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ancestorOfType closes over groupById
  }, [filteredSubGroups, groupById]);

  // Every leaf group across ALL Main Groups, sorted by full path — used
  // for the "Group Events" filter dropdown (independent of whichever
  // Main Group happens to be selected in the create form on the right).
  const allLeafGroups = useMemo(
    () =>
      groups
        .filter((g) => g.type === 'group' && g.status === 'active')
        .map((g) => ({ ...g, path: fullPathLabel(g.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [groups, fullPathLabel]
  );

  const [listFilter, setListFilter] = useState<'active' | 'published' | 'draft' | 'past' | 'cancelled' | 'all'>('active');
  const [listSearch, setListSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<string>('');
  const filteredEvents = useMemo(() => {
    if (viewMode === 'main') return events.filter((ev) => ev.subGroupIds.length > 1);
    if (!filterGroupId) return [];
    return events.filter((ev) => ev.subGroupIds.includes(filterGroupId));
  }, [events, viewMode, filterGroupId]);
  const nowSec = Math.floor(Date.now() / 1000);
  const listKind = (ev: EventRow) => (ev.status === 'cancelled' ? 'cancelled' : ev.endAt.seconds < nowSec ? 'past' : ev.status);
  const listCounts = useMemo(() => {
    const c = { active: 0, published: 0, draft: 0, past: 0, cancelled: 0, all: filteredEvents.length };
    filteredEvents.forEach((ev) => {
      const k = listKind(ev);
      if (k === 'published') { c.published += 1; c.active += 1; }
      else if (k === 'draft') { c.draft += 1; c.active += 1; }
      else if (k === 'past') c.past += 1;
      else c.cancelled += 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents]);
  // Nothing active yet but older events exist: show them all instead of an empty list.
  const [autoAll, setAutoAll] = useState(false);
  useEffect(() => { if (!autoAll && filteredEvents.length > 0) { setAutoAll(true); if (listCounts.active === 0) setListFilter('all'); } }, [autoAll, filteredEvents.length, listCounts.active]);
  const shownEvents = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return filteredEvents
      .filter((ev) => {
        const k = listKind(ev);
        const ok = listFilter === 'all' || (listFilter === 'active' ? k === 'published' || k === 'draft' : k === listFilter);
        return ok && (!q || ev.title.toLowerCase().includes(q));
      })
      .sort((a, b) => (listFilter === 'past' || listFilter === 'cancelled' ? b.startAt.seconds - a.startAt.seconds : a.startAt.seconds - b.startAt.seconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents, listFilter, listSearch]);

  const startDate = startAt.slice(0, 10);
  const endDate = endAt.slice(0, 10);
  const allGroupsKey = availableSubGroups.map((g) => g.id).join(',');
  // With a single main group there is nothing to choose: it is selected for you.
  const onlyMainId = mainGroups.length === 1 ? mainGroups[0].id : '';
  useEffect(() => {
    if (onlyMainId && !mainGroupId) setMainGroupId(onlyMainId);
  }, [onlyMainId, mainGroupId]);
  useEffect(() => {
    if (audience === 'main' && mainGroupId) setSubGroupIds(allGroupsKey ? allGroupsKey.split(',') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, mainGroupId, allGroupsKey]);

  const eventDays = useMemo(() => {
    const out: string[] = [];
    if (!startDate || !endDate || endDate < startDate) return out;
    const d = new Date(`${startDate}T12:00:00Z`);
    const last = new Date(`${endDate}T12:00:00Z`);
    while (d <= last && out.length < 400) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [startDate, endDate]);
  const cityTzOfGroup = (groupId: string) => groupById[groupById[groupId]?.parentGroupId ?? '']?.timeZone || DEFAULT_TIME_ZONE;
  const planRows = subGroupIds.filter((g) => plan[g]?.day && plan[g]?.time && plan[g]?.minutes);
  /** A group set to “Every day” performs on each day of the event, at the same time. */
  const planSlots = planRows.flatMap((g) => (plan[g].day === EVERY_DAY ? eventDays : [plan[g].day]).map((day) => ({ g, day, time: plan[g].time, minutes: Number(plan[g].minutes) })));
  /** Event times are read in the first scheduled group's city so a slot cannot fall outside the event by a time-zone difference. */
  const planTz = planRows.length ? cityTzOfGroup(planRows[0]) : '';

  /** The hours the event runs on a given day (each day can have its own hours; otherwise the event's start and end times apply every day). */
  function dayWindow(day: string) {
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const s0 = dayTimes[day]?.start ?? startAt.slice(11, 16);
    const e0 = dayTimes[day]?.end ?? endAt.slice(11, 16);
    const ok = /^\d{2}:\d{2}$/.test(s0) && /^\d{2}:\d{2}$/.test(e0);
    const from = ok ? toMin(s0) : 0;
    let to = ok ? toMin(e0) : 24 * 60;
    if (to <= from) to = 24 * 60;
    return { from, to };
  }

  /**
   * Lines the selected groups up one after another (optionally N per day), always inside the hours of each day.
   * With several places, each place gets its own line-up starting at the same time (groups at different places can perform together).
   */
  function autoSchedule(a = auto, silent = false) {
    const fail = (msg: string) => { setAutoMsg({ kind: 'err', text: msg }); if (!silent) notify(msg, 'error'); };
    const mins = Number(a.minutes);
    const gap = Number(a.gap || 0);
    const per = a.perDay ? Number(a.perDay) : 0;
    if (!subGroupIds.length) return fail('Choose the groups in step 4 first.');
    if (!eventDays.length) return fail('Set the event dates first.');
    if (!(mins >= 1)) return fail('Enter the minutes each group gets.');
    if (!/^\d{2}:\d{2}$/.test(a.time)) return fail('Choose a start time.');
    const [h, m] = a.time.split(':').map(Number);
    const wanted = h * 60 + m;
    const pad = (n: number) => String(n).padStart(2, '0');
    const hm = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
    const startOf = (idx: number) => {
      const w = dayWindow(eventDays[idx] ?? eventDays[0]);
      return Math.min(Math.max(wanted, w.from), w.to);
    };
    if (a.split && eventDays.length > 1) {
      // The admin says how many groups perform on each day; the groups are taken in the order they were picked.
      const counts = eventDays.map((d) => Math.max(0, Math.floor(Number(a.counts[d] || 0))));
      const sum = counts.reduce((x, y) => x + y, 0);
      if (sum !== subGroupIds.length) return fail(`You placed ${sum} of ${subGroupIds.length} groups on the days. Make the numbers add up to ${subGroupIds.length}, or press “Share equally”.`);
      const nextSplit: Record<string, { day: string; time: string; minutes: string }> = {};
      let offset = 0;
      for (let di = 0; di < eventDays.length; di++) {
        const dayGroups = subGroupIds.slice(offset, offset + counts[di]);
        offset += counts[di];
        if (!dayGroups.length) continue;
        const w = dayWindow(eventDays[di]);
        const used = new Set<string>();
        let dl: string[][] = [dayGroups];
        if (sites.length > 1) {
          dl = sites.map((st) => dayGroups.filter((g) => st.groupIds.includes(g) && !used.has(g) && (used.add(g), true))).filter((l) => l.length > 0);
          const rest = dayGroups.filter((g) => !used.has(g));
          if (rest.length) dl.push(rest);
        }
        for (const lane of dl) {
          let cur = startOf(di);
          for (const g of lane) {
            if (cur + mins > w.to) {
              const room = Math.max(0, Math.floor((w.to - startOf(di) + gap) / (mins + gap)));
              return fail(`Day ${di + 1} has room for ${room} group${room === 1 ? '' : 's'} of ${mins} minutes (${hm(w.from)} to ${hm(w.to)}) but ${lane.length} are placed${dl.length > 1 ? ' at one place' : ''}. Move some groups to another day, or lower the minutes.`);
            }
            nextSplit[g] = { day: eventDays[di], time: hm(cur), minutes: String(mins) };
            cur += mins + gap;
          }
        }
      }
      setPlan(nextSplit);
      setAutoOn(true);
      const okSplit = `${subGroupIds.length} groups scheduled over ${counts.filter((c) => c > 0).length} day${counts.filter((c) => c > 0).length === 1 ? '' : 's'}. Check the times below.`;
      setAutoMsg({ kind: 'ok', text: okSplit });
      if (!silent) notify(okSplit, 'success');
      return;
    }
    const firstDay = a.day === EVERY_DAY ? 0 : Math.max(0, eventDays.indexOf(a.day || eventDays[0]));

    // One line-up per place (a single line-up when the event has one place).
    const placed = new Set<string>();
    let lanes: string[][] = [subGroupIds];
    if (sites.length > 1) {
      lanes = sites.map((st) => subGroupIds.filter((g) => st.groupIds.includes(g) && !placed.has(g) && (placed.add(g), true))).filter((l) => l.length > 0);
      const rest = subGroupIds.filter((g) => !placed.has(g));
      if (rest.length) lanes.push(rest);
    }
    const widest = Math.max(...lanes.map((l) => l.length));
    let every = a.day === EVERY_DAY && eventDays.length > 1;
    let spread = false;
    if (every) {
      const w0 = dayWindow(eventDays[0]);
      const need = widest * mins + (widest - 1) * gap;
      if (startOf(0) + need > w0.to) { every = false; spread = true; }
    }

    const next: Record<string, { day: string; time: string; minutes: string }> = {};
    for (const lane of lanes) {
      let dayIdx = every ? 0 : firstDay;
      let cur = startOf(dayIdx);
      let count = 0;
      for (const g of lane) {
        if (!every && per && count >= per) {
          dayIdx += 1;
          if (dayIdx < eventDays.length) cur = startOf(dayIdx);
          count = 0;
        }
        if (dayIdx >= eventDays.length) return fail(`Not enough event days: ${lane.length} groups${lanes.length > 1 ? ' at one place' : ''} with ${per} per day. Add days or raise “Groups per day”.`);
        let w = dayWindow(eventDays[dayIdx]);
        if (cur + mins > w.to) {
          // The day is full: carry on the next day (not possible when every group must perform every day, or the number per day is fixed).
          if (!every && !per && dayIdx + 1 < eventDays.length) {
            dayIdx += 1; cur = startOf(dayIdx); count = 0; w = dayWindow(eventDays[dayIdx]);
          }
          if (cur + mins > w.to) {
            let room = 0;
            for (let i = every ? 0 : firstDay; i < (every ? 1 : eventDays.length); i++) {
              const wi = dayWindow(eventDays[i]);
              room += Math.max(0, Math.floor((wi.to - startOf(i) + gap) / (mins + gap)));
            }
            const days = every ? 'each day' : `the ${eventDays.length - firstDay} day${eventDays.length - firstDay === 1 ? '' : 's'} from the first one`;
            return fail(`There is room for ${room} group${room === 1 ? '' : 's'} of ${mins} minutes in ${days} (${hm(w.from)} to ${hm(w.to)}), but ${lane.length} ${lanes.length > 1 ? 'are at this place' : 'were chosen'}. Lower the minutes or the break, add days, or add places in step 3 so groups can perform at the same time.`);
          }
        }
        next[g] = { day: every ? EVERY_DAY : eventDays[dayIdx], time: hm(cur), minutes: String(mins) };
        cur += mins + gap;
        count += 1;
      }
    }
    setPlan(next);
    setAutoOn(true);
    const usedDays = new Set(Object.values(next).map((x) => x.day)).size;
    const moved = wanted < dayWindow(eventDays[every ? 0 : firstDay]).from;
    if (moved) setAuto({ ...a, time: hm(startOf(every ? 0 : firstDay)) });
    const okText = spread
      ? `${subGroupIds.length} groups do not all fit in one day, so they were spread over ${usedDays} day${usedDays === 1 ? '' : 's'}, one after another${lanes.length > 1 ? ` at each of the ${lanes.length} places` : ''}. Check the times below.`
      : `${subGroupIds.length} group${subGroupIds.length === 1 ? '' : 's'} scheduled${lanes.length > 1 ? ` across ${lanes.length} places at the same time` : ''}${moved ? ` from ${hm(dayWindow(eventDays[every ? 0 : firstDay]).from)}, when the event starts` : ''}. Check the times below.`;
    setAutoMsg({ kind: spread || moved ? 'info' : 'ok', text: okText });
    if (!silent) notify(okText, 'success');
  }

  /** Splits the groups over the days: equally, or as many as fit in each day. */
  function shareGroups(how: 'equal' | 'fill') {
    const n = subGroupIds.length;
    const d = eventDays.length;
    const mins = Math.max(1, Number(auto.minutes) || 30);
    const gap = Number(auto.gap || 0);
    const lanesN = Math.max(1, sites.length);
    const counts: Record<string, string> = {};
    let left = n;
    eventDays.forEach((day, i) => {
      let c: number;
      if (how === 'equal') c = Math.floor(n / d) + (i < n % d ? 1 : 0);
      else {
        const w = dayWindow(day);
        const start = Math.min(Math.max(Number(auto.time.slice(0, 2)) * 60 + Number(auto.time.slice(3, 5)), w.from), w.to);
        c = Math.min(left, Math.max(0, Math.floor((w.to - start + gap) / (mins + gap))) * lanesN);
      }
      counts[day] = String(c);
      left -= c;
    });
    if (left > 0 && how === 'fill') counts[eventDays[eventDays.length - 1]] = String(Number(counts[eventDays[eventDays.length - 1]]) + left);
    changeAuto({ counts, split: true });
  }

  /** Changing a setting re-lines the groups up at once, once Auto-schedule has been used. */
  function changeAuto(patch: Partial<typeof auto>) {
    const next = { ...auto, ...patch };
    setAuto(next);
    if (autoOn) autoSchedule(next, true);
  }

  // ---- places (sites), time slots, supervisors
  const mainSiteName = placeName.trim() || address.split(',')[0].trim() || 'Main venue';
  const sites: SiteDraft[] = useMemo(() => {
    const all: Omit<SiteDraft, 'groupIds'>[] = [
      { id: 'site1', name: mainSiteName, address, lat, lng },
      ...extraPlaces.map((p, i) => ({ id: `site${i + 2}`, name: p.name.trim() || p.address.split(',')[0].trim() || `Place ${i + 2}`, address: p.address, lat: p.lat, lng: p.lng })),
    ];
    return all.map((p) => ({ ...p, groupIds: all.length === 1 ? subGroupIds : (siteGroups[p.id] ?? []).filter((g) => subGroupIds.includes(g)) }));
  }, [mainSiteName, address, lat, lng, extraPlaces, siteGroups, subGroupIds]);
  const eventTz = planTz;
  const localToMs = (local: string) => (eventTz ? zonedToUtcMs(local.slice(0, 10), local.slice(11, 16), eventTz) : new Date(local).getTime());
  const minutesBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 16)}:00Z`) - Date.parse(`${a.slice(0, 16)}:00Z`)) / 60000);
  const supervisorList = useMemo(() => {
    const seen = new Map<string, { userId: string; name: string; main: boolean }>();
    for (const sh of shifts) for (const p of sh.people) {
      const cur = seen.get(p.userId);
      if (!cur) seen.set(p.userId, { userId: p.userId, name: p.name, main: p.role === 'main' });
      else if (p.role === 'main') cur.main = true;
    }
    return [...seen.values()].sort((a, b) => Number(b.main) - Number(a.main));
  }, [shifts]);
  const eventMinutes = startAt && endAt ? minutesBetween(startAt, endAt) : 0;
  const durationText = eventDays.length > 1 ? `${eventDays.length} Days` : eventMinutes > 0 ? `1 Day (${hoursLabel(eventMinutes)})` : '—';
  const cityOptions = useMemo(() => {
    const ids = Array.from(new Set(subGroupIds.map((g) => ancestorOfType(g, 'city')).filter(Boolean) as string[]));
    return ids.map((id) => ({ id, name: groupById[id]?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ancestorOfType closes over groupById
  }, [subGroupIds, groupById]);
  const siteCandidates = subGroupIds.filter((g) => {
    if (siteFilter.city && ancestorOfType(g, 'city') !== siteFilter.city) return false;
    if (siteFilter.text && !(groupById[g]?.name ?? '').toLowerCase().includes(siteFilter.text.trim().toLowerCase())) return false;
    return true;
  });
  const setSiteMembers = (siteId: string, ids: string[]) => setSiteGroups((prev) => ({ ...prev, [siteId]: ids }));
  const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

  const conflictDraft: ConflictDraft | null = useMemo(() => {
    if (isRecurring || subGroupIds.length === 0 || !startAt || !endAt) return null;
    const a = localToMs(startAt);
    const b = localToMs(endAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
    return {
      startAtMs: a,
      endAtMs: b,
      subGroupIds,
      sites: sites.map((x) => ({ id: x.id, name: x.name, lat: x.lat ? Number(x.lat) : undefined, lng: x.lng ? Number(x.lng) : undefined, groupIds: x.groupIds })),
      slots: planRows.map((g) => { const day = plan[g].day === EVERY_DAY ? eventDays[0] : plan[g].day; const a = zonedToUtcMs(day, plan[g].time, cityTzOfGroup(g)); return { groupId: g, startMs: a, endMs: a + Number(plan[g].minutes) * 60000 }; }),
      excludedUserIds: excluded.map((m) => m.id),
      shifts: shifts.filter((x) => x.people.length > 0).map((x) => ({ id: x.id, label: x.label, startMs: localToMs(x.startAt), endMs: localToMs(x.endAt), siteIds: x.siteIds, supervisors: x.people.map((p) => ({ userId: p.userId })) })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers close over the values listed here
  }, [isRecurring, subGroupIds, startAt, endAt, sites, plan, shifts, eventTz, excluded]);

  const conflictActions: ConflictActions = {
    removeGroups: (ids) => {
      setSubGroupIds((prev) => prev.filter((x) => !ids.includes(x)));
      setPlan((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !ids.includes(k))));
      setSiteGroups((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.filter((x) => !ids.includes(x))])));
    },
    excludeMembers: (m) => setExcluded((prev) => [...prev, ...m.filter((x) => !prev.some((y) => y.id === x.id))]),
    restoreMembers: (ids) => setExcluded((prev) => prev.filter((x) => !ids.includes(x.id))),
    removeSupervisors: (userIds, shiftIds) => setShifts(shifts.map((s) => (!shiftIds || shiftIds.includes(s.id) ? { ...s, people: s.people.filter((p) => !userIds.includes(p.userId)) } : s))),
    excluded,
    groupName: (id) => groupById[id]?.name ?? id,
  };

  const STEPS = [
    { n: 1, label: tx("What"), what: title.trim() || 'Event details' },
    { n: 2, label: tx("When"), what: `${dayWord(eventDays.length || 1)}${timeSlots.length > 1 ? `, ${timeSlots.length} sessions` : ', date and time'}` },
    { n: 3, label: tx("Where"), what: `${sites.length} place${sites.length === 1 ? '' : 's'}` },
    { n: 4, label: tx("Who"), what: subGroupIds.length ? `${subGroupIds.length} group${subGroupIds.length === 1 ? '' : 's'}` : 'Audience' },
    { n: 5, label: tx("Supervision"), what: shifts.length ? `${shifts.length} shift${shifts.length === 1 ? '' : 's'}` : 'Supervisors and shifts' },
    { n: 6, label: tx("Review"), what: 'Check and create' },
  ];
  const PANEL: { t: string; s: string; i: WizIcon }[] = [
    { t: 'What is the event?', s: 'Name it and choose the organisation it belongs to.', i: 'doc' },
    { t: 'When is it?', s: 'Choose the days, then the sessions of each day.', i: 'clock' },
    { t: 'Where is it?', s: 'One place or several. Members check in inside the area or radius.', i: 'pin' },
    { t: 'Who is it for?', s: 'Select the groups that take part and give each its time slot.', i: 'users' },
    { t: 'Supervision', s: 'Create the shifts, then choose who supervises each one.', i: 'shield' },
    { t: 'Review and create', s: 'Check the summary and the conflicts, then create the event.', i: 'check' },
  ];
  const isDone = (n: number) => passed.includes(n);

  /** The checks of one step. Returns the message to show, or null when the step is complete. */
  function validateStep(n: number): string | null {
    if (n === 1) {
      if (!title.trim()) return 'Give the event a name.';
      if (!mainGroupId) return v18.errChooseMain;
    }
    if (n === 2) {
      const startMs = new Date(startAt).getTime();
      const endMs = new Date(endAt).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return v18.errEndAfterStart;
      if (timeSlots.some((t) => !t.start || !t.end || t.end <= t.start)) return 'Each session must end after it starts.';
      if (timeSlots.some((t, i) => i > 0 && t.start < timeSlots[i - 1].end)) return 'A session starts before the previous one ends. Move it later.';
      if (eventDays.length > 1 && eventDays.some((d) => dayTimes[d] && (dayTimes[d].end <= dayTimes[d].start || (dayTimes[d].slots ?? []).some((t, i, arr) => t.end <= t.start || (i > 0 && t.start < arr[i - 1].end))))) return 'Check the sessions of the days that have their own hours: each session must end after it starts and not overlap the previous one.';
      if (isRecurring) {
        if (endMode === 'count') { const c = parseInt(occurrenceCount, 10); if (!Number.isInteger(c) || c < 1 || c > 90) return v18.errOccurrences; }
        else { const ms = new Date(endByDate).getTime(); if (Number.isNaN(ms) || ms <= startMs) return v18.errEndDate; }
      } else {
        const listDl = memberDeadline ? localToMs(memberDeadline) : undefined;
        const audioDl = audioDeadline ? localToMs(audioDeadline) : undefined;
        if ((listDl !== undefined && !(listDl < startMs)) || (audioDl !== undefined && !(audioDl < startMs))) return 'The deadlines for the member list and the books must be before the event starts.';
      }
    }
    if (n === 3) {
      if (Number.isNaN(parseFloat(lat)) || Number.isNaN(parseFloat(lng))) return v18.errLatLng;
      if (polygon.length > 0 && polygon.length < 3) return 'Draw at least 3 corners for the area, or clear it.';
      if (polygon.length < 3) { const r = parseFloat(radius); if (Number.isNaN(r) || r <= 0) return v18.errRadius; }
      if (extraPlaces.some((q) => !q.lat || !q.lng)) return 'Choose the address of every extra place, or remove it.';
    }
    if (n === 4) {
      if (subGroupIds.length === 0) return v18.errChooseGroup;
      if (planRows.length > 0 && isRecurring) return 'Group schedules are for single events. Create the series first, or untick "Repeat" in When.';
      for (const g of planRows) if (!(Number(plan[g].minutes) >= 1)) return `Enter the time allowed for "${groupById[g]?.name}".`;
      const unplaced = sites.length > 1 ? subGroupIds.filter((g) => !sites.some((x) => x.groupIds.includes(g))).length : 0;
      if (unplaced > 0) return `${unplaced} group${unplaced === 1 ? ' is' : 's are'} not at any place yet. Pick a place and tap the groups that perform there, or use a quick button.`;
    }
    return null;
  }
  function goNext() {
    const err = validateStep(step);
    if (err) { setFormError(err); return; }
    setFormError(null);
    setPassed((p) => (p.includes(step) ? p : [...p, step]));
    if (step < 6) setStep(step + 1);
    if (typeof window !== 'undefined') document.getElementById('ev-wizard-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function goBack() {
    setFormError(null);
    if (step > 1) { setPassed((p) => p.filter((x) => x < step - 1)); setStep(step - 1); }
  }
  function goTo(n: number) {
    if (created) return;
    if (n < step) { setFormError(null); setPassed((p) => p.filter((x) => x < n)); setStep(n); }
  }
  function finishWizard() {
    setCreated(null);
    setSeriesMade(false);
    setPassed([]);
    setStep(1);
    setFormError(null);
    setPane('list');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    // Only the "Create event" button creates it. A stray button inside a step must never submit the form.
    const sub = (e.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLElement | null | undefined;
    if (!sub || sub.getAttribute('data-create') !== '1') return;
    if (step !== 6) return;
    setFormError(null);
    for (const n of [1, 2, 3, 4]) { const bad = validateStep(n); if (bad) { setFormError(bad); setStep(n); return; } }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radiusNum = parseFloat(radius);
    const useCityClock = planRows.length > 0 && planTz !== '';
    const startMs = useCityClock ? zonedToUtcMs(startAt.slice(0, 10), startAt.slice(11, 16), planTz) : new Date(startAt).getTime();
    const endMs = useCityClock ? zonedToUtcMs(endAt.slice(0, 10), endAt.slice(11, 16), planTz) : new Date(endAt).getTime();

    if (!mainGroupId) return setFormError(v18.errChooseMain);
    if (subGroupIds.length === 0) return setFormError(v18.errChooseGroup);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) return setFormError(v18.errLatLng);
    if (polygon.length > 0 && polygon.length < 3) return setFormError('Draw at least 3 corners for the area, or clear it.');
    const hasArea = polygon.length >= 3;
    if (!hasArea && (Number.isNaN(radiusNum) || radiusNum <= 0)) return setFormError(v18.errRadius);
    const radiusToSend = hasArea ? polygonRadius(polygon) : radiusNum;
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return setFormError(v18.errEndAfterStart);
    }

    if (planRows.length > 0 && isRecurring) return setFormError('Group schedules are for single events. Create the series first, or untick "Repeat".');
    for (const g of planRows) {
      if (!(Number(plan[g].minutes) >= 1)) return setFormError(`Enter the time allowed for "${groupById[g]?.name}".`);
    }

    if (timeSlots.some((t) => !t.start || !t.end || t.end <= t.start)) return setFormError('Each session must end after it starts (step 2).');
    if (timeSlots.some((t, i) => i > 0 && t.start < timeSlots[i - 1].end)) return setFormError('A session starts before the previous one ends (step 2). Move it later.');
    if (eventDays.length > 1 && eventDays.some((d) => dayTimes[d] && (dayTimes[d].end <= dayTimes[d].start || (dayTimes[d].slots ?? []).some((t, i, arr) => t.end <= t.start || (i > 0 && t.start < arr[i - 1].end))))) return setFormError('Check the sessions of the days that have their own hours (step 2): each session must end after it starts and not overlap the previous one.');
    if (isRecurring && shifts.length > 0) return setFormError('Supervision shifts are for single events. Remove the shifts, or untick "Repeat".');
    if (extraPlaces.some((p) => !p.lat || !p.lng)) return setFormError('Choose the address of every extra place in step 3, or remove it.');
    const shiftPayload = shifts.map((sh, i) => ({ sh, i, startMs: localToMs(sh.startAt), endMs: localToMs(sh.endAt) }));
    for (const { sh, i, startMs: a, endMs: b } of shiftPayload) {
      if (!(b > a)) return setFormError(`${sh.label || `Shift ${i + 1}`}: the end must be after the start (Supervision step).`);
      if (!sh.people.some((p) => p.role === 'main')) return setFormError(`${sh.label || `Shift ${i + 1}`} needs at least one main supervisor (Supervision step), or delete the shift.`);
    }
    for (let x = 0; x < shiftPayload.length; x++) {
      for (let y = x + 1; y < shiftPayload.length; y++) {
        const A = shiftPayload[x];
        const B = shiftPayload[y];
        if (A.startMs < B.endMs && B.startMs < A.endMs) {
          const dup = A.sh.people.find((p) => B.sh.people.some((q) => q.userId === p.userId));
          if (dup && !conflictState.approved) return setFormError(`${dup.name} is in two shifts at the same time (${A.sh.label} and ${B.sh.label}). Change one shift, or accept the conflicts in step 7.`);
        }
      }
    }

    if (!isRecurring && conflictState.critical > 0 && !conflictState.approved) return setFormError('There are critical conflicts (step 7). Solve them, or accept them if you are a senior administrator.');

    const unplaced = sites.length > 1 ? subGroupIds.filter((g) => !sites.some((x) => x.groupIds.includes(g))).length : 0;
    if (unplaced > 0) return setFormError(`${unplaced} group${unplaced === 1 ? ' is' : 's are'} not at any place yet. In the Places step, pick a place and tap the groups that perform there, or use a quick button.`);

    setSubmitting(true);
    try {
      if (isRecurring) {
        let occurrenceCountNum: number | undefined;
        let endByDateMs: number | undefined;
        if (endMode === 'count') {
          const count = parseInt(occurrenceCount, 10);
          if (!Number.isInteger(count) || count < 1 || count > 90) {
            setFormError(v18.errOccurrences);
            setSubmitting(false);
            return;
          }
          occurrenceCountNum = count;
        } else {
          const ms = new Date(endByDate).getTime();
          if (Number.isNaN(ms) || ms <= startMs) {
            setFormError(v18.errEndDate);
            setSubmitting(false);
            return;
          }
          endByDateMs = ms;
        }
        const res = await createRecurringEventFn({
          title,
          mainGroupId,
          subGroupIds,
          location: { lat: latNum, lng: lngNum, address: address || undefined },
          geofenceRadiusMeters: radiusToSend,
          ...(hasArea ? { geofencePolygon: polygon } : {}),
          startAtMs: startMs,
          endAtMs: endMs,
          frequency,
          daysOfWeek: frequency === 'weekly' && daysOfWeek.length > 0 ? daysOfWeek : undefined,
          occurrenceCount: occurrenceCountNum,
          endByDateMs,
          publish: publishImmediately,
        });
        notify(v18.createdSeries(res.data.eventIds.length, Boolean(res.data.published)), 'success');
        setSeriesMade(true);
      } else {
        // The event window must contain every group's slot. If a slot starts before (or ends after) the dates
        // typed in step 4, the window is widened to include it, so no slot is refused.
        let winStart = startMs;
        let winEnd = endMs;
        for (const ps of planSlots) {
          const sMs = zonedToUtcMs(ps.day, ps.time, cityTzOfGroup(ps.g));
          const eMs = sMs + ps.minutes * 60000;
          if (sMs < winStart) winStart = sMs;
          if (eMs > winEnd) winEnd = eMs;
        }
        for (const x of shiftPayload) {
          if (x.startMs < winStart) winStart = x.startMs;
          if (x.endMs > winEnd) winEnd = x.endMs;
        }
        if (winStart !== startMs || winEnd !== endMs) notify('The event dates were widened so every group slot and every supervision shift fits inside them.', 'info');
        const listDl = memberDeadline ? localToMs(memberDeadline) : undefined;
        const audioDl = audioDeadline ? localToMs(audioDeadline) : undefined;
        if ((listDl !== undefined && !(listDl < winStart)) || (audioDl !== undefined && !(audioDl < winStart))) {
          setFormError('The deadlines for the member list and the books must be before the event starts.');
          setSubmitting(false);
          return;
        }
        const res = await createEventFn({
          title,
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          mainGroupId,
          subGroupIds,
          ...(listDl !== undefined ? { memberListDeadlineMs: listDl } : {}),
          ...(audioDl !== undefined ? { audioDeadlineMs: audioDl } : {}),
          location: { lat: latNum, lng: lngNum, address: address || undefined },
          geofenceRadiusMeters: radiusToSend,
          ...(hasArea ? { geofencePolygon: polygon } : {}),
          startAtMs: winStart,
          endAtMs: winEnd,
          ...(timeSlots.length > 1 ? { timeSlots: timeSlots.map((t) => ({ start: t.start, end: t.end })) } : {}),
          ...(eventDays.length > 1 ? { dailySchedule: (eventDays.length <= 60 ? eventDays : eventDays.filter((d) => dayTimes[d] && (dayTimes[d].start !== startAt.slice(11, 16) || dayTimes[d].end !== endAt.slice(11, 16)))).map((d) => ({ date: d, start: dayTimes[d]?.start ?? startAt.slice(11, 16), end: dayTimes[d]?.end ?? endAt.slice(11, 16), ...(dayTimes[d]?.slots && dayTimes[d].slots!.length > 1 ? { slots: dayTimes[d].slots } : {}) })) } : {}),
          ...(excluded.length ? { excludedUserIds: excluded.map((m) => m.id) } : {}),
          ...(conflictState.critical > 0 && conflictState.approved ? { conflictsApproved: conflictState.critical } : {}),
          publish: publishImmediately,
        });
        // Tell the admin right away: the event exists now. The group schedules are saved after, a few at a time.
        notify(res.data.published ? v18.publishedWith(res.data.attendeeCount ?? 0) : `Event "${title}" created.`, 'success');
        const failed: string[] = [];
        let memberConflicts = 0;
        const eventId = res.data.eventId;
        lastCreated.current = eventId;
        const snap = { id: eventId, title, startMs: winStart, endMs: winEnd, sites: sites.map((x) => ({ id: x.id, name: x.name, lat: Number(x.lat), lng: Number(x.lng), groupIds: x.groupIds })), groups: subGroupIds.map((g) => ({ id: g, name: groupById[g]?.name ?? g })) };
        setCreated(snap);
        // The group schedule (one call for all groups) and the places then supervision shifts are saved at the same time.
        const saveSlots = async () => {
          if (!planSlots.length) return;
          try {
            const r = await createEventSlotsFn({
              eventId,
              slots: planSlots.map((q) => ({ groupId: q.g, startAtMs: zonedToUtcMs(q.day, q.time, cityTzOfGroup(q.g)), durationMinutes: q.minutes })),
            });
            memberConflicts = r.data.memberConflicts ?? 0;
            r.data.failed.slice(0, 20).forEach((f) => failed.push(`${groupById[f.groupId]?.name ?? f.groupId}: ${f.message}`));
            if (r.data.failedCount > 20) failed.push(`and ${r.data.failedCount - 20} more group slots`);
            notify(`${r.data.created} of ${planSlots.length} group slot${planSlots.length === 1 ? '' : 's'} scheduled`, r.data.failedCount ? 'info' : 'success');
          } catch (err) {
            failed.push(`Group schedule: ${err instanceof Error ? err.message : 'failed'}`);
          }
        };
        const savePlaces = async (): Promise<boolean> => {
          try {
            await setEventSitesFn({
              eventId,
              sites: sites.map((x) => ({ id: x.id, name: x.name, address: x.address || undefined, lat: Number(x.lat), lng: Number(x.lng), groupIds: x.groupIds })),
            });
          } catch (err) {
            failed.push(`Places: ${err instanceof Error ? err.message : 'failed'}`);
            return false;
          }
          return true;
        };
        const saveShifts = async () => {
          if (shiftPayload.length) {
            try {
              await setEventShiftsFn({
                eventId,
                allowPerformers: audience === 'main',
                shifts: shiftPayload.map(({ sh, startMs: a, endMs: b }) => ({ id: sh.id, label: sh.label.trim(), startMs: a, endMs: b, siteIds: sh.siteIds, groupIds: sh.groupIds, supervisors: sh.people.map((p) => ({ userId: p.userId, role: p.role, ...(p.can ? { can: p.can } : {}), ...(p.leaderId ? { leaderId: p.leaderId } : {}) })) })),
              });
              notify(`${shiftPayload.length} supervision shift${shiftPayload.length === 1 ? '' : 's'} saved`, 'success');
            } catch (err) {
              failed.push(`Supervision shifts: ${err instanceof Error ? err.message : 'failed'}`);
            }
          }
        };
        if (planSlots.length) notify(`Saving ${planSlots.length} group schedule${planSlots.length === 1 ? '' : 's'}…`, 'info');
        // The places come first (slots and shifts refer to them), then the group schedule and the supervision shifts are saved at the same time.
        await savePlaces();
        await Promise.all([saveSlots(), saveShifts()]);
        if (memberConflicts > 0) notify('Some members belong to two groups that perform at the same time. Their primary group was chosen by default. Review them on the event plan.', 'info');
        if (failed.length) {
          setFormError(`The event was created, but some parts were not saved. Fix them on the event page. ${failed.join(' | ')}`);
          setPlan({});
          setPassed([1, 2, 3, 4, 5, 6]);
          setStep(7);
          return;
        }
      }
      setPlan({});
      setTitle('');
      setPurpose('');
      setTimeSlots([]);
      setDayTimes({});
      setAudience('specific');
      setShifts([]);
      setExtraPlaces([]);
      setSiteGroups({});
      setPlaceName('');
      setSubGroupIds([]);
      setAddress('');
      setLat('');
      setLng('');
      setPolygon([]);
      setPassed([1, 2, 3, 4, 5, 6]);
      setStep(7);
      // Back to the Event planning homepage, with the new event selected (a series: its first date).
      if (onCreated) { const id = lastCreated.current; lastCreated.current = ''; finishWizard(); onCreated(id || undefined); }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : v18.createFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(eventId: string) {
    setBusyEventId(eventId);
    try {
      const res = await publishEventFn({ eventId });
      notify(v18.publishedWith(res.data.attendeeCount), 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : v18.publishFailed, 'error');
    } finally {
      setBusyEventId(null);
    }
  }

  async function handleCancel(eventId: string) {
    if (!confirm(v18.confirmCancel)) return;
    setBusyEventId(eventId);
    try {
      await cancelEventFn({ eventId });
    } finally {
      setBusyEventId(null);
    }
  }

  async function handleCancelSeries(seriesId: string) {
    if (!confirm(v18.confirmCancelSeries)) return;
    setBusyEventId(seriesId);
    try {
      const res = await cancelEventSeriesFn({ seriesId });
      notify(v18.cancelledSeries(res.data.cancelledCount), 'success');
    } finally {
      setBusyEventId(null);
    }
  }

  async function handlePublishSeries(seriesId: string) {
    if (!confirm(v18.confirmPublishSeries)) return;
    setBusyEventId(seriesId);
    try {
      const res = await publishEventSeriesFn({ seriesId });
      notify(v18.publishedSeries(res.data.publishedCount), 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : v18.publishSeriesFailed, 'error');
    } finally {
      setBusyEventId(null);
    }
  }

  function toggleDayOfWeek(day: number) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  if (myScope.scope?.role === 'group_manager') return <ProposeEvent />;

  return (
    <div>
      <div className="ev4-head">
      <h1>{v18.title}</h1>
      <div className="fx3-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={pane === 'create'} className={pane === 'create' ? 'on' : ''} onClick={() => setPane('create')}>{tx("Create an event")}</button>
        <button type="button" role="tab" aria-selected={pane === 'list'} className={pane === 'list' ? 'on' : ''} onClick={() => setPane('list')}>{tx("All events (publish, cancel, series)")}</button>
      </div>
      </div>

      <div className="split split-wide fx3-split">
        <div style={pane === 'list' ? undefined : { display: 'none' }}>
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: viewMode === 'group' ? '0.75rem' : 0 }}>
              <button
                type="button"
                className={viewMode === 'main' ? 'btn btn-primary' : 'btn btn-secondary'}
                onClick={() => setViewMode('main')}
              >
                {v18.viewMain}
              </button>
              <button
                type="button"
                className={viewMode === 'group' ? 'btn btn-primary' : 'btn btn-secondary'}
                onClick={() => setViewMode('group')}
              >
                {v18.viewGroup}
              </button>
            </div>
            {viewMode === 'main' ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: 0 }}>
                {v18.mainViewHelp}
              </p>
            ) : (
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="ev-filter-group">{v18.groupLabel}</label>
                <select id="ev-filter-group" value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)}>
                  <option value="">{v18.selectGroup}</option>
                  {allLeafGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.path}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

        <div className="card">
          {loading ? (
            <p>{t.common.loading}</p>
          ) : viewMode === 'group' && !filterGroupId ? (
            <p style={{ color: 'var(--ink-soft)' }}>{v18.selectGroupAbove}</p>
          ) : filteredEvents.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>
              {viewMode === 'main' ? v18.noOrgEvents : v18.noGroupEvents}
            </p>
          ) : (
            <>
              <div className="evl-bar">
                <div className="evl-chips" role="tablist">
                  {([['active', 'Active'], ['published', 'Published'], ['draft', 'Drafts'], ['past', 'Finished'], ['cancelled', 'Cancelled'], ['all', 'All']] as const).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={listFilter === k} className={`evl-chip${listFilter === k ? ' on' : ''} k-${k}`} onClick={() => setListFilter(k)}>
                      {label} <em>{listCounts[k]}</em>
                    </button>
                  ))}
                </div>
                <input type="search" className="evl-search" placeholder={tx("Search an event")} value={listSearch} onChange={(e) => setListSearch(e.target.value)} />
              </div>
              {shownEvents.length === 0 && <p className="fx3-note">{tx("No event in this filter.")}</p>}
              <div className="evl">
                {shownEvents.map((ev) => {
                  const k = listKind(ev);
                  const names = ev.subGroupIds.map((g) => groupById[g]?.name ?? g);
                  const open = openGroups === ev.id;
                  const sMs = ev.startAt.seconds * 1000;
                  const eMs = ev.endAt.seconds * 1000;
                  const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
                  return (
                    <article key={ev.id} className={`evl-row k-${k}`}>
                      <div className="evl-main">
                        <div className="evl-title">
                          <Link href={`/dashboard/events/${ev.id}`}>{ev.title}</Link>
                          <span className={`evl-badge k-${k}`}>{k === 'past' ? tx("Finished") : k === 'cancelled' ? tx("Cancelled") : k === 'draft' ? tx("Draft") : tx("Published")}</span>
                          {ev.seriesId && <span className="evl-badge k-series">{tx("Recurring")}</span>}
                        </div>
                        <div className="evl-meta">
                          <span>{longRange(ymd(sMs), ymd(eMs))}</span>
                          <span>{new Date(sMs).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })} {tx("to")} {new Date(eMs).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}</span>
                          <button type="button" className="evl-groups" onClick={() => setOpenGroups(open ? '' : ev.id)} aria-expanded={open}>
                            {names.length} {tx("group")}{names.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
                          </button>
                        </div>
                        {open && <p className="evl-names">{ev.subGroupIds.map(fullPathLabel).join(' · ')}</p>}
                      </div>
                      {k !== 'cancelled' && k !== 'past' && (
                        <div className="evl-actions">
                          {ev.status === 'draft' && <button className="btn btn-primary" disabled={busyEventId === ev.id} onClick={() => handlePublish(ev.id)}>{v18.publish}</button>}
                          <button className="btn btn-secondary" disabled={busyEventId === ev.id} onClick={() => handleCancel(ev.id)}>{v18.cancel}</button>
                          {ev.seriesId && <button className="btn btn-secondary" disabled={busyEventId === ev.seriesId} onClick={() => handlePublishSeries(ev.seriesId!)} title={v18.publishSeriesTitle}>{v18.publishSeries}</button>}
                          {ev.seriesId && <button className="btn btn-secondary" disabled={busyEventId === ev.seriesId} onClick={() => handleCancelSeries(ev.seriesId!)} title={v18.cancelSeriesTitle}>{v18.cancelSeries}</button>}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {events.length === pageSize && (
            <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => setPageSize((p) => p + PAGE_SIZE)}>
              {v18.loadMore}
            </button>
          )}
        </div>
        </div>

        <form onSubmit={handleCreate} className="wzs-form" style={pane === 'create' ? undefined : { display: 'none' }}>
          <WizardShell
            title={tx("Manage Events")}
            setup="Event Setup"
            subtitle={tx("Create, publish and manage your events")}
            steps={STEPS.map((st) => ({ n: st.n, label: st.label, sub: st.what, done: isDone(st.n) }))}
            current={step === 7 ? 6 : step}
            locked={step === 7}
            onStep={goTo}
            panelTitle={step === 7 ? 'Event created' : PANEL[step - 1].t}
            panelSub={step === 7 ? 'Everything was saved.' : PANEL[step - 1].s}
            panelIcon={step === 7 ? 'check' : PANEL[step - 1].i}
            onClose={step === 7 ? finishWizard : () => setPane('list')}
            recap={[
              { label: tx("Event"), value: title.trim() || '—' },
              { label: tx("When"), value: startAt && passed.includes(2) ? shortSpan(startDate, endDate) : '—' },
              { label: tx("Where"), value: address.trim() ? address.split(',')[0] : '—' },
              { label: tx("Groups"), value: subGroupIds.length ? String(subGroupIds.length) : '—' },
              { label: tx("Supervisors"), value: supervisorList.length ? String(supervisorList.length) : '—' },
            ]}
            footer={
              step < 7 ? (
                <>
                  <button type="button" className="wzs-btn" onClick={() => setPane('list')} disabled={submitting}>{tx("Cancel")}</button>
                  {formError ? <p className="wzs-err" role="alert">{formError}</p> : <span className="sp" />}
                  <button type="button" className="wzs-btn" onClick={goBack} disabled={step === 1 || submitting}>{tx("‹ Back")}</button>
                  {step < 6 ? (
                    <button key="nx" type="button" className="wzs-btn go" onClick={goNext}>{tx("Next:")} {STEPS[step].label} ›</button>
                  ) : (
                    <button key="mk" type="submit" data-create="1" className="wzs-btn go" disabled={submitting}>{submitting ? v18.creating : isRecurring ? v18.createSeries : v18.createEvent} ✓</button>
                  )}
                </>
              ) : <span className="sp" />
            }
          >
          <div className="fx3-main">
          <section className="fx3-step" id="ev-step-1" hidden={step !== 1}>
            <div className="fx3-head">
              <span className="fx3-num">1</span>
              <div><h3>{tx("What is the event?")}</h3><p>{tx("Name it and choose the organisation it belongs to.")}</p></div>
              <span className="fx3-tag req">{tx("Required")}</span>
            </div>
            <div className="ev4-two">
              <div className="ev4-col">
            <div className="field wz-name">
              <label htmlFor="e-title">{tx("Event name")}</label>
              <input id="e-title" autoFocus maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tx("e.g. Annual Gathering 2026")} /><span className="ev4-count">{title.length}/100</span>
            </div>
            <div className="aud" role="radiogroup" aria-label={tx("Who is the event for")}>
              <button type="button" role="radio" aria-checked={audience === 'main'} className={`aud-card${audience === 'main' ? ' on' : ''}`} onClick={() => setAudience('main')}>
                <span className="aud-dot" aria-hidden />
                <b>{tx("A main group")}</b>
                <small>{tx("Every group of one main group takes part. They are all chosen for you.")}</small>
              </button>
              <button type="button" role="radio" aria-checked={audience === 'specific'} className={`aud-card${audience === 'specific' ? ' on' : ''}`} onClick={() => { if (audience !== 'specific') { setAudience('specific'); setSubGroupIds([]); setPlan({}); } }}>
                <span className="aud-dot" aria-hidden />
                <b>{tx("Specific groups")}</b>
                <small>{tx("Only the groups you pick in Who take part.")}</small>
              </button>
            </div>
                <div className="field ev4-desc">
                  <label htmlFor="e-purpose">{tx("Event description")} <small>{tx("(optional)")}</small></label>
                  <textarea id="e-purpose" rows={4} maxLength={500} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={tx("A celebration of our journey together.")} />
                  <span className="ev4-count">{purpose.length}/500</span>
                </div>
              </div>
              <div className="ev4-col">
            {onlyMainId ? (
              <div className="field">
                <label>{tx("Main group")}</label>
                <div className="mg-fixed"><b>{mainGroups[0].name}</b><small>{tx("The only main group. It is already selected.")}</small></div>
                {audience === 'main' && mainGroupId && <small className="fx3-hint">{availableSubGroups.length} {tx("group")}{availableSubGroups.length === 1 ? '' : 's'} {tx("take part.")}</small>}
              </div>
            ) : (
            <div className="field">
              <label htmlFor="e-main">{audience === 'main' ? tx("Which main group?") : tx("Main group they belong to")}</label>
              <select
                id="e-main"
                required
                value={mainGroupId}
                onChange={(e) => {
                  setMainGroupId(e.target.value);
                  setSubGroupIds([]);
                  setPlan({});
                  clearFilters();
                }}
              >
                <option value="">{v18.selectPlaceholder}</option>
                {mainGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              {audience === 'main' && mainGroupId && <small className="fx3-hint">{availableSubGroups.length} {tx("group")}{availableSubGroups.length === 1 ? '' : 's'} {tx("take part.")}</small>}
            </div>
            )}
              <div className="ev4-stats">
                <div><b>{mainGroupId ? availableSubGroups.length : '—'}</b><span>{tx("groups available")}</span></div>
                <div><b>{mainGroupId ? countriesUnderMain.length : '—'}</b><span>{countriesUnderMain.length === 1 ? tx("country") : tx("countries")}</span></div>
                <div><b>{subGroupIds.length}</b><span>{tx("chosen so far")}</span></div>
              </div>
              </div>
            </div>
            <div className="ev4-road">
              {[
                { n: 2, t: 'When', d: 'Pick the days on a calendar, then the sessions of each day. Optional deadlines and weather.' },
                { n: 3, t: 'Where', d: 'One or several places, each with a pin and a check-in distance or drawn area.' },
                { n: 4, t: 'Who', d: 'Tick the groups by country, zone, city and local zone, then give each a time slot.' },
                { n: 5, t: 'Review', d: 'Conflicts are checked automatically. Publish at once or keep a draft.' },
              ].map((x) => (
                <div key={x.n}><span>{x.n}</span><b>{x.t}</b><small>{x.d}</small></div>
              ))}
            </div>
            {events.length > 0 && (
              <div className="ev4-recent">
                <h4>{tx("Latest events")} <small>{tx("(for reference, to avoid duplicates)")}</small></h4>
                <div>
                  {[...events].sort((a, b) => (b.startAt?.seconds ?? 0) - (a.startAt?.seconds ?? 0)).slice(0, 6).map((e) => (
                    <button type="button" key={e.id} onClick={() => setTitle((t) => t || e.title)} title={tx("Use this name")}>
                      <b>{e.title}</b>
                      <small>{e.startAt?.seconds ? new Date(e.startAt.seconds * 1000).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} · {e.subGroupIds?.length ?? 0} {tx("groups")}</small>
                      <em className={e.status}>{e.status === 'published' ? tx("Published") : e.status === 'draft' ? tx("Draft") : tx("Cancelled")}</em>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="fx3-step" id="ev-step-2" hidden={step !== 2}>
            <div className="fx3-head">
              <span className="fx3-num">2</span>
              <div><h3>{tx("When is it?")}</h3><p>{tx("Choose the days, then the sessions of each day.")}</p></div>
              <span className="fx3-tag req">{tx("Required")}</span>
            </div>
            <EventDates startAt={startAt} endAt={endAt} setStartAt={setStartAt} setEndAt={setEndAt} slots={timeSlots} setSlots={setTimeSlots} eventDays={eventDays} dayTimes={dayTimes} setDayTimes={setDayTimes} />
            <div className="ev4-row">
            {!isRecurring && (
              <details className="dl-box" open>
                <summary className="dl-head"><b>{tx("Deadlines for the groups")}</b><span className="fx3-tag opt">{tx("Optional")}</span></summary>
                <p>{tx("Every group’s manager gets a request to send the members who take part. Set the last moment for it, and for choosing the books. Reminders go out automatically.")}</p>
                <div className="dl-grid">
                  <div className="field"><label>{tx("Member list due")}</label><DateTimePicker value={memberDeadline} onChange={setMemberDeadline} placeholder={tx("No deadline")} /></div>
                  <div className="field"><label>{tx("Book choice due")}</label><DateTimePicker value={audioDeadline} onChange={setAudioDeadline} placeholder={tx("No deadline")} /></div>
                </div>
              </details>
            )}

            </div>

            <RecurrenceCard on={isRecurring} setOn={setIsRecurring} frequency={frequency} setFrequency={setFrequency} days={daysOfWeek} toggleDay={toggleDayOfWeek}
              endMode={endMode} setEndMode={setEndMode} count={occurrenceCount} setCount={setOccurrenceCount} endDate={endByDate} setEndDate={setEndByDate}
              startDate={startAt.slice(0, 10)} dayLabels={DAY_LABELS} />
          </section>
          <section className="fx3-step" id="ev-step-3" hidden={step !== 3}>
            <div className="fx3-head">
              <span className="fx3-num">3</span>
              <div><h3>{tx("Where is it?")}</h3><p>{tx("One place or several. Members can only check in inside the drawn area (or the radius around the pin).")}</p></div>
              <span className="fx3-tag req">{tx("Required")}</span>
            </div>
            {(() => {
              const ap = activePlace === 'main' || extraPlaces.some((x) => x.id === activePlace) ? activePlace : 'main';
              const isMain = ap === 'main';
              const ex = extraPlaces.find((x) => x.id === ap);
              const cur = isMain ? { name: placeName, address, lat, lng } : { name: ex?.name ?? '', address: ex?.address ?? '', lat: ex?.lat ?? '', lng: ex?.lng ?? '' };
              const patch = (v: Partial<{ name: string; address: string; lat: string; lng: string }>) => setExtraPlaces(extraPlaces.map((x) => (x.id === ap ? { ...x, ...v } : x)));
              const cards = [
                { id: 'main', n: 1, name: placeName.trim() || (address.trim() ? address.split(',')[0] : 'Main place'), addr: address, ok: Boolean(lat && lng) },
                ...extraPlaces.map((x, i) => ({ id: x.id, n: i + 2, name: x.name.trim() || (x.address.trim() ? x.address.split(',')[0] : `Place ${i + 2}`), addr: x.address, ok: Boolean(x.lat && x.lng) })),
              ];
              return (
                <div className="wh">
                  <aside className="wh-list">
                    {cards.map((x) => (
                      <button type="button" key={x.id} className={`wh-card${x.id === ap ? ' on' : ''}`} onClick={() => setActivePlace(x.id)}>
                        <span className="pc-n">{x.n}</span>
                        <span className="wh-t"><b>{x.name}</b><small>{x.addr || tx("No address yet")}</small></span>
                        <em className={x.ok ? 'ok' : ''}>{x.ok ? tx("Pinned") : tx("To pin")}</em>
                      </button>
                    ))}
                    <button type="button" className="wh-add" onClick={() => { const id = String(Date.now()); setExtraPlaces([...extraPlaces, { id, name: '', address: '', lat: '', lng: '' }]); setActivePlace(id); }}>{tx("+ Add another place")}</button>
                    <p className="wh-hint">{tx("Members can only check in inside the drawn area, or inside the distance around the pin.")}</p>
                  </aside>
                  <div className="wh-edit" key={ap}>
                    <div className="wh-top">
                      <div className="field">
                        <label htmlFor="e-placename">{tx("Name of this place")}</label>
                        <input id="e-placename" value={cur.name} onChange={(e) => (isMain ? setPlaceName(e.target.value) : patch({ name: e.target.value }))} placeholder={isMain ? (address.trim() ? address.split(',')[0] : tx("e.g. Main hall")) : tx("e.g. Second hall")} />
                      </div>
                      <div className="field">
                        <label>{tx("Find the address")}</label>
                        <PlaceSearch placeholder={tx("Type an address or a place")} onPick={(h) => { if (isMain) { setLat(h.lat.toFixed(6)); setLng(h.lng.toFixed(6)); setAddress(h.address); } else patch({ lat: h.lat.toFixed(6), lng: h.lng.toFixed(6), address: h.address }); }} />
                        {cur.address.trim() && <small className="fx3-hint">{tx("Selected:")} {cur.address}</small>}
                      </div>
                    </div>
                    <div className="wh-grid">
                      <div className="wh-map">
                        <MapPicker
                          hideSearch
                          noArea={!isMain}
                          height={360}
                          value={{ lat: cur.lat, lng: cur.lng, address: cur.address, polygon: isMain ? polygon : [] }}
                          radius={isMain ? Number(radius) || undefined : undefined}
                          onChange={(v) => { if (isMain) { setLat(v.lat); setLng(v.lng); setAddress(v.address); setPolygon(v.polygon); } else patch({ lat: v.lat, lng: v.lng, address: v.address || cur.address }); }}
                        />
                      </div>
                      <div className="wh-side">
                        {isMain && (polygon.length < 3 ? (
                          <div className="wh-box">
                            <b>{tx("Check-in distance around the pin")}</b>
                            <div className="wh-chips">
                              {['50', '100', '200', '500'].map((r) => <button type="button" key={r} className={radius === r ? 'on' : ''} onClick={() => setRadius(r)}>{r} m</button>)}
                              <label className="pc-other"><input aria-label={tx("Other distance in metres")} inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} /> m</label>
                            </div>
                          </div>
                        ) : <div className="wh-box"><b>{tx("Check-in area")}</b><small>{tx("The area you drew on the map is used for check-in.")}</small></div>)}
                        <div className="wh-box">
                          <b>{tx("Exact coordinates")} <small>{tx("(optional)")}</small></b>
                          <div className="pc-coords4">
                            <label><span>{tx("Latitude")}</span><input value={cur.lat} onChange={(e) => (isMain ? setLat(e.target.value) : patch({ lat: e.target.value }))} placeholder={tx("Pin the map or type")} /></label>
                            <label><span>{tx("Longitude")}</span><input value={cur.lng} onChange={(e) => (isMain ? setLng(e.target.value) : patch({ lng: e.target.value }))} placeholder={tx("Pin the map or type")} /></label>
                          </div>
                        </div>
                        <WeatherPlaces dateMs={new Date(startAt).getTime()} places={[{ id: ap, name: cur.name.trim() || 'This place', lat: cur.lat, lng: cur.lng }]} />
                        {!isMain && <button type="button" className="wzs-btn wh-rm" onClick={() => { setExtraPlaces(extraPlaces.filter((x) => x.id !== ap)); setActivePlace('main'); }}>{tx("Remove this place")}</button>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
          <section className="fx3-step" id="ev-step-4" hidden={step !== 4}>
            <div className="fx3-head">
              <span className="fx3-num">4</span>
              <div><h3>{tx("Groups taking part")}</h3><p>{tx("Narrow the list with the filters, then tick the groups. You can mix filters.")}</p></div>
              <span className="fx3-tag req">{tx("Required")}</span>
            </div>
            <p className="fx3-pick"><b>{tx("You are choosing:")}</b> {tx("which groups (kurels) will take part and receive a notification.")}{subGroupIds.length > 0 && <> <span className="fx3-chip">{subGroupIds.length} {tx("selected")}</span></>}</p>

            {!mainGroupId ? (
              <p className="fx3-note">{tx("Choose the main group in step 1 to see its groups.")}</p>
            ) : availableSubGroups.length === 0 ? (
              <p className="fx3-note">{v18.noGroupsUnderMain}</p>
            ) : (
              <>
                <div className="gp4">
                  <aside className="gp4-side">
                    <div className="gp4-filters">
                      <Dropdown label={tx("Country")} value={subGroupFilterCountryId} allLabel={v18.allCountries} options={countriesUnderMain.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => { setSubGroupFilterCountryId(v); setSubGroupFilterZoneId(''); setSubGroupFilterCityId(''); setSubGroupFilterLocalZoneId(''); }} />
                      <Dropdown label={tx("Zone")} value={subGroupFilterZoneId} allLabel="All zones" options={zoneChoices.map((z) => ({ value: z.id, label: z.name }))} onChange={(v) => { setSubGroupFilterZoneId(v); setSubGroupFilterCityId(''); setSubGroupFilterLocalZoneId(''); }} />
                      <Dropdown label={tx("City")} value={subGroupFilterCityId} allLabel={v18.allCities} options={cityChoices.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => { setSubGroupFilterCityId(v); setSubGroupFilterLocalZoneId(''); }} />
                      <Dropdown label={tx("Local zone")} value={subGroupFilterLocalZoneId} allLabel="All local zones" options={localZoneChoices.map((z) => ({ value: z.id, label: z.name }))} onChange={setSubGroupFilterLocalZoneId} />
                      <input className="gp4-search" value={subGroupSearch} onChange={(e) => setSubGroupSearch(e.target.value)} placeholder={v18.searchGroups} aria-label={tx("Search groups by name")} />
                    </div>
                    <div className="gp4-count">
                      <div className="gp4-ring" style={{ ['--p' as string]: `${availableSubGroups.length ? Math.round((subGroupIds.length / availableSubGroups.length) * 100) : 0}%` }}><b>{subGroupIds.length}</b></div>
                      <div><strong>{subGroupIds.length} {tx("of")} {availableSubGroups.length}</strong><span>{tx("groups chosen")}</span><small>{tx("Showing")} {filteredSubGroups.length}</small></div>
                    </div>
                    <div className="gp4-acts">
                      <button type="button" className="gp-btn on" disabled={filteredSubGroups.length === 0} onClick={() => setSubGroupIds((prev) => [...new Set([...prev, ...filteredSubGroups.map((g) => g.id)])])}>{tx("Select all shown")}</button>
                      <button type="button" className="gp-btn" disabled={subGroupIds.length === 0} onClick={() => { setSubGroupIds([]); setPlan({}); }}>{tx("Clear selection")}</button>
                      {anyFilter && <button type="button" className="gp-btn" onClick={clearFilters}>{tx("Reset filters")}</button>}
                    </div>
                    {subGroupIds.length > 0 && (
                      <div className="gp4-chosen">
                        {subGroupIds.slice(0, 10).map((id) => <button type="button" key={id} className="gp-tag" onClick={() => toggleSubGroup(id)} title={tx("Click to remove")}>{groupById[id]?.name ?? id} <span aria-hidden>×</span></button>)}
                        {subGroupIds.length > 10 && <em>+{subGroupIds.length - 10} {tx("more")}</em>}
                      </div>
                    )}
                  </aside>
                  <div className="gp4-main">
                <div className="gp-list">
                  {filteredSubGroups.length === 0 ? (
                    <p className="fx3-note">{v18.noGroupsMatch}</p>
                  ) : (
                    [...groupedByCity].sort((a, b) => b.items.length - a.items.length).map((block) => {
                      const nOn = block.items.filter((g) => subGroupIds.includes(g.id)).length;
                      const allOn = nOn === block.items.length;
                      return (
                        <section key={block.cityId} className="gp-city" style={{ gridColumn: `span ${block.items.length >= 9 ? 12 : block.items.length >= 3 ? 6 : 4}` }}>
                          <header>
                            <strong>{block.label}</strong>
                            <span className="gp-count">{nOn} {tx("of")} {block.items.length}</span>
                            <button type="button" className="gp-btn" onClick={() => setSubGroupIds((prev) => (allOn ? prev.filter((id) => !block.items.some((g) => g.id === id)) : [...new Set([...prev, ...block.items.map((g) => g.id)])]))}>
                              {allOn ? tx("Unselect all") : tx("Select all")}
                            </button>
                          </header>
                          <div className="gp-grid">
                            {block.items.map((g) => {
                              const on = subGroupIds.includes(g.id);
                              const lz = localZoneName(g.localZoneId);
                              return (
                                <button type="button" key={g.id} className={`gp-card${on ? ' on' : ''}`} onClick={() => toggleSubGroup(g.id)} aria-pressed={on}>
                                  <span className="gp-tick" aria-hidden>{on ? '✓' : ''}</span>
                                  <span className="gp-name">{g.name}{lz && <small>{lz}</small>}</span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })
                  )}
                </div>
                  </div>
                </div>
              </>
            )}
          </section>
          <section className="fx3-step" id="ev-step-5" hidden={step !== 4}>
            <div className="fx3-head">
              <span className="fx3-num">4</span>
              <div>
                <h3>{tx("Sites and group schedule")}</h3>
                <p>{tx("Give each group its own day, start time and minutes allowed. Each group will then choose its books to fit this time.")}</p>
              </div>
              <span className="fx3-tag opt">{tx("Optional")}</span>
            </div>
            <p className="fx3-pick"><b>{tx("You are choosing:")}</b> {tx("for every group, the day, the start time and the minutes it may perform. Its books must fit in those minutes.")}</p>


            {subGroupIds.length > 0 && !isRecurring && (
              sites.length === 1 ? (
                <p className="fx3-hint">{tx("All groups perform at")} <b>{sites[0].name}</b>. Add other places in step 3 to share the groups between several sites.</p>
              ) : (
                <div className="fx3-auto gpl">
                  <strong>{tx("Which groups go to which place?")}</strong>
                  <span className="fx3-hint">{tx("Pick a place, then tap the groups that perform there. A group can be at several places.")}</span>
                  <div className="gpl-quick">
                    <button type="button" className="gp-btn" onClick={() => setSiteGroups(Object.fromEntries(sites.map((x) => [x.id, subGroupIds])))}>{tx("All groups at every place")}</button>
                    <button type="button" className="gp-btn" onClick={() => {
                      const sorted = [...subGroupIds].sort((a, b) => (ancestorOfType(a, 'city') ?? '').localeCompare(ancestorOfType(b, 'city') ?? ''));
                      const per = Math.ceil(sorted.length / sites.length);
                      setSiteGroups(Object.fromEntries(sites.map((x, i) => [x.id, sorted.slice(i * per, (i + 1) * per)])));
                    }}>{tx("Share the groups between the places")}</button>
                    <button type="button" className="gp-btn" onClick={() => setSiteGroups({})}>{tx("Start again")}</button>
                  </div>
                  <div className="gpl-tabs" role="tablist">
                    {sites.map((site) => (
                      <button type="button" role="tab" key={site.id} aria-selected={(sites.find((x) => x.id === activeSite) ?? sites[0]).id === site.id} className={(sites.find((x) => x.id === activeSite) ?? sites[0]).id === site.id ? 'on' : ''} onClick={() => setActiveSite(site.id)}>
                        {site.name || tx("Place")} <em>{site.groupIds.length}</em>
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const site = sites.find((x) => x.id === activeSite) ?? sites[0];
                    return (
                      <div className="gpl-body">
                        <div className="gpl-tools">
                          <select aria-label={tx("City")} value={siteFilter.city} onChange={(e) => setSiteFilter({ ...siteFilter, city: e.target.value })}>
                            <option value="">{tx("All cities")}</option>
                            {cityOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <input aria-label={tx("Group name")} value={siteFilter.text} placeholder={tx("Search a group")} onChange={(e) => setSiteFilter({ ...siteFilter, text: e.target.value })} />
                          <button type="button" className="gp-btn" onClick={() => setSiteMembers(site.id, Array.from(new Set([...site.groupIds, ...siteCandidates])))}>{tx("Select all shown")}</button>
                          <button type="button" className="gp-btn" onClick={() => setSiteMembers(site.id, site.groupIds.filter((g) => !siteCandidates.includes(g)))}>{tx("Clear shown")}</button>
                        </div>
                        {siteCandidates.length === 0 && <p className="fx3-note">{tx("No selected group matches the search.")}</p>}
                        <div className="gp-grid">
                          {siteCandidates.map((g) => {
                            const on = site.groupIds.includes(g);
                            return (
                              <button type="button" key={g} className={`gp-card${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setSiteMembers(site.id, on ? site.groupIds.filter((x) => x !== g) : [...site.groupIds, g])}>
                                <span className="gp-tick" aria-hidden>{on ? '✓' : ''}</span>
                                <span className="gp-name">{groupById[g]?.name ?? g}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {subGroupIds.some((g) => !sites.some((x) => x.groupIds.includes(g))) && <p className="fx3-hint warn">{subGroupIds.filter((g) => !sites.some((x) => x.groupIds.includes(g))).length} {tx("group(s) are not at any place yet. Pick a place above and tap the groups, or use a quick button.")}</p>}
                </div>
              )
            )}
            {subGroupIds.length === 0 ? (
              <p className="fx3-note">{tx("Choose groups in step 4 first. You can also schedule them later on the event page (Event plan).")}</p>
            ) : isRecurring ? (
              <p className="fx3-note">{tx("Group schedules are for single or multi-day events. Untick “Repeat” in step 2 to use them.")}</p>
            ) : (
              <>
                <div className="fx3-auto">
                  <div className="fx3-autohead"><strong>Auto-schedule</strong><span>{tx("Groups perform one after another, in the order picked.")}</span></div>
                  {eventDays.length > 1 && (
                    <div className="fx3-automode" role="radiogroup" aria-label={tx("How to use the days")}>
                      <button type="button" role="radio" aria-checked={!auto.split} className={!auto.split ? 'on' : ''} onClick={() => changeAuto({ split: false })}>{tx("All groups on the same day(s)")}</button>
                      <button type="button" role="radio" aria-checked={auto.split} className={auto.split ? 'on' : ''} onClick={() => (auto.split ? undefined : shareGroups('equal'))}>{tx("Split the groups over the days")}</button>
                    </div>
                  )}
                  <div className="fx3-autogrid">
                    {!auto.split && (
                      <label><span>{tx("First day")}</span>
                        <select value={auto.day === EVERY_DAY && eventDays.length <= 1 ? eventDays[0] ?? '' : auto.day} onChange={(e) => changeAuto({ day: e.target.value })}>
                          {eventDays.length > 1 && <option value={EVERY_DAY}>{tx("Every day of the event (")}{eventDays.length} {tx("Days)")}</option>}
                          {eventDays.map((d, i) => <option key={d} value={d}>{dayName(d, i)}</option>)}
                        </select>
                      </label>
                    )}
                    <label><span>{tx("Start time")}</span><TimeSelect value={auto.time} label={tx("Start time")} onChange={(v) => changeAuto({ time: v })} /></label>
                    <label><span>{tx("Minutes each")}</span><input type="number" min={1} max={600} value={auto.minutes} onChange={(e) => changeAuto({ minutes: e.target.value })} /></label>
                    <label><span>{tx("Break (min)")}</span><input type="number" min={0} max={120} value={auto.gap} onChange={(e) => changeAuto({ gap: e.target.value })} /></label>
                    {!auto.split && <label><span>{tx("Groups per day")}</span><input type="number" min={1} placeholder={tx("All")} disabled={auto.day === EVERY_DAY} title={auto.day === EVERY_DAY ? tx("Every group performs every day") : ''} value={auto.perDay} onChange={(e) => changeAuto({ perDay: e.target.value })} /></label>}
                    <button type="button" className="btn btn-primary" onClick={() => autoSchedule()}>Auto-schedule</button>
                  </div>
                  {auto.split && eventDays.length > 1 && (() => {
                    const placedN = eventDays.reduce((t, d) => t + (Math.floor(Number(auto.counts[d] || 0)) || 0), 0);
                    return (
                      <div className="fx3-split">
                        <div className="fx3-splithead">
                          <b>{tx("How many groups on each day?")}</b>
                          <span className={placedN === subGroupIds.length ? 'ok' : 'bad'}>{placedN} {tx("of")} {subGroupIds.length} {tx("placed")}</span>
                          <button type="button" className="gp-btn" onClick={() => shareGroups('equal')}>{tx("Share equally")}</button>
                          <button type="button" className="gp-btn" onClick={() => shareGroups('fill')}>{tx("Fill each day first")}</button>
                        </div>
                        <div className="fx3-splitgrid">
                          {eventDays.map((d, i) => (
                            <label key={d}><span>{dayName(d, i)}</span><input type="number" min={0} max={subGroupIds.length} value={auto.counts[d] ?? '0'} onChange={(e) => changeAuto({ counts: { ...auto.counts, [d]: e.target.value } })} /></label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {planRows.length < subGroupIds.length && <p className="rv-warn">{subGroupIds.length - planRows.length} {tx("of")} {subGroupIds.length} {tx("groups still have no time. Press Auto-schedule so every group gets a slot. Without a slot, its group admin is told that no performance slot was given.")}</p>}
                  {autoMsg && <p className={`fx3-automsg ${autoMsg.kind}`} role="status">{autoMsg.text}</p>}
                </div>

                <div className="fx3-sched">
                  {subGroupIds.map((g) => {
                    const tz = cityTzOfGroup(g);
                    const row = plan[g] ?? { day: '', time: '', minutes: auto.minutes || '60' };
                    const set = (patch: Partial<typeof row>) => setPlan({ ...plan, [g]: { ...row, ...patch } });
                    const done = Boolean(row.day && row.time && row.minutes);
                    return (
                      <div key={g} className={done ? 'fx3-row done' : 'fx3-row'}>
                        <div className="fx3-rowhead">
                          <strong>{groupById[g]?.name ?? g}</strong>
                          <span className="fx3-tz">{`Time zone: ${tz}${groupById[groupById[g]?.parentGroupId ?? '']?.timeZone ? '' : ' (default, Senegal)'}`}</span>
                          <span className="fx3-state">{done ? tx("Ready") : tx("Not scheduled")}</span>
                        </div>
                        <div className="fx3-rowgrid">
                          <label className="fx3-lbl"><span>{tx("Day")}</span>
                            <select aria-label={`Day for ${groupById[g]?.name}`} value={row.day} onChange={(e) => set({ day: e.target.value })}>
                              <option value="">{tx("Choose a day…")}</option>
                              {eventDays.length > 1 && <option value={EVERY_DAY}>{tx("Every day (")}{eventDays.length} {tx("Days)")}</option>}
                              {eventDays.map((d, i) => <option key={d} value={d}>{dayName(d, i)}</option>)}
                            </select>
                          </label>
                          <label className="fx3-lbl"><span>{tx("Start time")}</span><TimeSelect value={row.time} label={tx("Start time")} onChange={(v) => set({ time: v })} /></label>
                          <label className="fx3-lbl"><span>{tx("Minutes allowed")}</span><input aria-label={tx("Time allowed in minutes")} type="number" min={1} max={600} placeholder="e.g. 20" value={row.minutes} onChange={(e) => set({ minutes: e.target.value })} /></label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="fx3-hint">
                  {tx("Times are read in each group’s own city time zone. Two groups cannot overlap in time.")}
                  {planTz ? ` The event start and end above are read in ${planTz}.` : ''}
                </p>
              </>
            )}
          </section>
          <section className="fx3-step" id="ev-step-sup" hidden={step !== 5}>
            <div className="sup4">
              <div className="sup4-main">
            {isRecurring ? <p className="fx3-note">{tx("Supervision shifts are for single or multi-day events. Untick “Repeat” in step 2 to use them.")}</p> : subGroupIds.length === 0 ? <p className="fx3-note">{tx("Choose the groups first, then assign the supervisors.")}</p> : (
              <div className="ev4-sup">
                <SupervisionStep
                  shifts={shifts}
                  setShifts={setShifts}
                  sites={sites}
                  startAt={startAt}
                  endAt={endAt}
                  eventDays={eventDays}
                  dayTimes={dayTimes}
                  kurelIds={subGroupIds}
                  groups={subGroupIds.map((g) => ({ id: g, name: groupById[g]?.name ?? g }))}
                  minutesBetween={minutesBetween}
                  toMs={localToMs}
                  allowPerformers={audience === 'main'}
                />
              </div>
            )}
              </div>
              <aside className="sup4-side">
                <div className="sup4-stats">
                  <div><b>{shifts.length}</b><span>{tx("shifts")}</span></div>
                  <div><b>{shifts.filter((x) => x.people.some((p) => p.role === 'main')).length}</b><span>{tx("with a supervisor")}</span></div>
                  <div><b>{supervisorList.length}</b><span>{tx("people")}</span></div>
                </div>
                {(['head', 'manager', 'staff'] as const).map((t) => (
                  <div key={t} className="sup4-role"><b>{TIER_LABEL[t]}</b><span>{t === 'head' ? tx("One person for the whole event. Sees everything and can do everything.") : t === 'manager' ? tx("Runs one place and reports to the main supervisor.") : tx("Works under a site manager on the ground.")}</span><em>{TIER_RIGHTS[t].join(' · ')}</em></div>
                ))}
                <p className="sup4-note">{tx("Only members of the groups taking part can be chosen.")} {audience === 'main' ? tx("As the event is for the whole main group, performers can also be appointed.") : tx("People who perform are on stage and cannot supervise.")} {tx("Supervision is optional: you can also do it later from the event page.")}</p>
              </aside>
            </div>
          </section>

          <section className="fx3-step" id="ev-step-7" hidden={step !== 6}>
            <div className="fx3-head">
              <span className="fx3-num">✓</span>
              <div><h3>{tx("Review and create")}</h3><p>{tx("Check the summary, choose whether to publish now, then create.")}</p></div>
            </div>

            <ul className="fx3-review">
              <li><span>{tx("Event name")}</span><b>{title.trim() || tx("Not named yet")}</b></li>
              <li><span>{tx("When")}</span><b>{startAt ? longRange(startDate, endDate) : '—'}</b></li>
              <li><span>{tx("Event duration")}</span><b>{durationText}</b></li>
              <li><span>{tx("Time slot")}</span>
                <div className="rv-sessions">
                  {(timeSlots.length ? timeSlots : [{ id: 'one', start: startAt.slice(11, 16), end: endAt.slice(11, 16) }]).map((t, i) => (
                    <div key={t.id}><b className="n">{tx("Session")} {i + 1}</b><span className="box">{timeLabel(t.start)}<i>{tx("to")}</i>{timeLabel(t.end)}</span></div>
                  ))}
                </div>
              </li>
              <li><span>{tx("Groups")}</span>
                {subGroupIds.length === 0 ? <b>{tx("None chosen")}</b> : (
                  <details className="rv-groups">
                    <summary>{tx("See the groups")}<em>{subGroupIds.length}</em></summary>
                    <div className="rv-chips">{subGroupIds.map((g) => <span key={g}>{groupById[g]?.name ?? g}</span>)}</div>
                  </details>
                )}
              </li>
              <li><span>{tx("Supervisor")}</span>{supervisorList.length ? <b className="rv-pl-names">{supervisorList.map((x) => <PersonLink key={x.userId} userId={x.userId}><u>{x.name}</u>{x.main ? tx(" (main)") : ''}</PersonLink>)}</b> : <b>{tx("None assigned yet")}</b>}</li>
              <li><span>{tx("Organisation")}</span><b>{mainGroupId ? (groupById[mainGroupId]?.name ?? mainGroupId) : tx("Not chosen")}</b></li>
              <li><span>{sites.length > 1 ? tx("Places") : tx("Place")}</span><b>{address.trim() ? sites.map((x) => x.name + (x.groupIds.length && sites.length > 1 ? ` (${x.groupIds.length} groups)` : '')).join(', ') + ` · check-in radius ${radius} m` : tx("No address")}</b></li>
              <li className={planRows.length < subGroupIds.length ? 'wide' : undefined}><span>{tx("Group slots")}</span><b>{planRows.length} {tx("of")} {subGroupIds.length} {tx("groups have a day, time and minutes")}</b>
                {planRows.length < subGroupIds.length && !isRecurring && <p className="rv-warn">{subGroupIds.length - planRows.length} {tx("group")}{subGroupIds.length - planRows.length === 1 ? '' : 's'} {tx("will be invited without a performance time. Their group admins will see “no performance slot yet” until you give one. Go back to step 5 and press Auto-schedule to give every group a time.")}</p>}
              </li>
              {eventDays.length > 1 && (() => {
                const rows = eventDays.map((d, i) => ({ d, i, s: dayTimes[d]?.start ?? startAt.slice(11, 16), e: dayTimes[d]?.end ?? endAt.slice(11, 16) }));
                const same = rows.every((r) => r.s === rows[0].s && r.e === rows[0].e);
                return (
                  <li className="wide rv-daily"><span>{tx("Daily times")}</span>
                    {same ? (
                      <div className="rv-same"><em className="rv-every">{tx("Every day")}</em><b>{rows[0].s} <i>{tx("to")}</i> {rows[0].e}</b><em className="rv-days">{rows.length} {tx("days")}</em></div>
                    ) : (
                      <div className="rv-daygrid">
                        {rows.map((r) => (
                          <div key={r.d}><small>{dayName(r.d, r.i)}</small><b>{r.s} – {r.e}</b></div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })()}
              <li><span>{tx("Members in several groups")}</span><b>{tx("See the conflicts section below")}</b></li>
              <li className="wide"><span>{tx("Supervision")}</span>
                {shifts.length === 0 ? <b>{tx("No shift")}</b> : (
                  <div className="rv-sup">
                    <p><b>{shifts.length}</b> {tx("shifts ·")} <b>{shifts.filter((x) => x.people.some((p) => p.role === 'main')).length}</b> {tx("with a supervisor")}{shifts.some((x) => !x.people.some((p) => p.role === 'main')) && <em> · {shifts.filter((x) => !x.people.some((p) => p.role === 'main')).length} {tx("still without")}</em>}</p>
                    {supervisorList.length > 0 && (
                      <div className="rv-people">
                        {supervisorList.map((x) => (
                          <span key={x.userId} className={x.main ? 'main' : ''}><PersonLink userId={x.userId}><u>{x.name}</u></PersonLink><small>{TIER_LABEL[tierOf(shifts, sites, x.userId)]} · {shifts.filter((sh) => sh.people.some((p) => p.userId === x.userId)).length} {tx("shifts")}</small></span>
                        ))}
                      </div>
                    )}
                    <details>
                      <summary>{tx("See every shift")}</summary>
                      <ul className="rv-shifts">
                        {[...shifts].sort((a, b) => a.startAt.localeCompare(b.startAt)).map((sh) => (
                          <li key={sh.id}>
                            <span>{shortWhen(sh.startAt)} {tx("to")} {shortWhen(sh.endAt).slice(-5)}</span>
                            <span>{sites.length > 1 ? (sh.siteIds.length ? sh.siteIds.map((id) => sites.find((x) => x.id === id)?.name ?? '').join(' + ') : tx("All places")) : ''}</span>
                            <span>{sh.people.filter((p) => p.role === 'main').length ? sh.people.filter((p) => p.role === 'main').map((p, k) => <span key={p.userId}>{k > 0 && ', '}<PersonLink userId={p.userId}><u>{p.name}</u></PersonLink></span>) : <em>{tx("no main supervisor")}</em>}{sh.people.some((p) => p.role === 'member') ? ` + ${sh.people.filter((p) => p.role === 'member').length}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </li>
              <li><span>{tx("Conflicts")}</span><b>{!conflictState.checked ? tx("Not checked yet") : conflictState.critical === 0 ? tx("No critical conflict") : conflictState.approved ? `${conflictState.critical} critical accepted` : `${conflictState.critical} critical to solve`}</b></li>
              <li className="rv-places"><span>{tx("Places and groups")}</span>
                <div className="rv-pl-list">
                  {sites.map((x) => (
                    <details key={x.id} className="rv-pl">
                      <summary><b>{x.name}</b><em>{x.groupIds.length} {tx("group")}{x.groupIds.length === 1 ? '' : 's'}</em></summary>
                      <div className="rv-chips">{x.groupIds.length === 0 ? <i>{tx("No group at this place")}</i> : x.groupIds.map((g) => <span key={g}>{groupById[g]?.name ?? g}</span>)}</div>
                    </details>
                  ))}
                </div>
              </li>
              <li><span>{tx("After creating")}</span><b>{publishImmediately ? tx("Published now: groups are notified") : tx("Saved as a draft: nobody is notified yet")}</b></li>
            </ul>

            <div className="fx3-summary">
              <button type="button" onClick={() => goTo(4)} title={tx("Change the groups")}><b>{subGroupIds.length}</b><span>{tx("groups")}</span></button>
              <button type="button" onClick={() => goTo(2)} title={tx("Change the days")}><b>{eventDays.length || 1}</b><span>{(eventDays.length || 1) === 1 ? tx("day") : tx("days")}</span></button>
              <button type="button" onClick={() => goTo(4)} title={tx("Change the group schedule")}><b>{planRows.length}/{subGroupIds.length}</b><span>{tx("scheduled")}</span></button>
              <button type="button" onClick={() => goTo(5)} title={tx("Change the supervision")}><b>{supervisorList.length}</b><span>{tx("supervisors")}</span></button>
              <button type="button" onClick={() => goTo(3)} title={tx("Change the places")}><b>{sites.length}</b><span>{sites.length === 1 ? tx("place") : tx("places")}</span></button>
            </div>

            <h4 className="fx3-subh">{tx("Conflicts")}</h4>
            <ConflictPanel draft={conflictDraft} canApprove={canApproveConflicts} onState={setConflictState} actions={conflictActions} />

            <label className="fx3-switch">
              <input type="checkbox" checked={publishImmediately} onChange={(e) => setPublishImmediately(e.target.checked)} />
              <span>{v18.publishImmediately}</span>
            </label>
            <p className="fx3-hint">{publishImmediately ? v18.publishImmediatelyOn : v18.publishImmediatelyOff}</p>

            {formError && <p className="error-text">{formError}</p>}

          </section>

          <section className="fx3-step" id="ev-step-8" hidden={step !== 7}>
            <div className="wzs-done">
              <span className="big"><WizSvg name="check" size={52} /></span>
              <h3>{seriesMade ? tx("Series created successfully!") : tx("Event created successfully!")}</h3>
              <p>{created ? <>{tx("Your event “")}{created.title}{tx("” has been created for")} {created.groups.length} {tx("group")}{created.groups.length === 1 ? '' : 's'}.</> : tx("Everything was saved.")}</p>
              {formError && <p className="error-text">{formError}</p>}
              <div className="row">
                <button type="button" className="wzs-btn go" onClick={finishWizard}>{tx("View events")}</button>
                <button type="button" className="wzs-btn" onClick={() => { const keep = pane; finishWizard(); setPane(keep); }}>{tx("Create another event")}</button>
                {created && <button type="button" className="wzs-btn" onClick={() => setAdminsOpen(true)}>{tx("Change supervision")}</button>}
              </div>
            </div>
          </section>

          </div>
          </WizardShell>
        </form>
        {adminsOpen && created && (
          <EditSupervision eventId={created.id} title={created.title} startMs={created.startMs} endMs={created.endMs} sites={created.sites} groups={created.groups} shifts={[]} onClose={() => setAdminsOpen(false)} />
        )}
      </div>
    </div>
  );
}

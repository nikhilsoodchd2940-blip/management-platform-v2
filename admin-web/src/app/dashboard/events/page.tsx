'use client';

import EventSummary from './EventSummary';
import AttendancePanel from '@/components/AttendancePanel';
import ParticipationPanel from '@/components/ParticipationPanel';
import QuickActions from '@/components/QuickActions';
import MyMemberLists from './MyMemberLists';
import ApprovalDesk from './ApprovalDesk';
import { useHashScroll } from '@/lib/useHashScroll';
import PublishCheck from './PublishCheck';
import EventRunControl from './EventRunControl';
import { PersonLink } from '@/components/MemberProfile';
import LiveBoard from './LiveBoard';
import SupervisorInbox from './SupervisorInbox';
import PerformanceReviews from './PerformanceReviews';
import EventDayPlanner from './EventDayPlanner';
import OverviewPopup, { type OverviewKind } from './OverviewPopup';
import { tiersOf, TIER_NAME } from './tiers';
import { Avatar } from '@/components/MemberPicker';
import { useUserProfiles } from '@/lib/useUserNames';
import EditSupervision from './EditSupervision';
import '../../px/planning-evenements.css';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, limit as fsLimit, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { cancelEvent, restoreEvent, publishEvent, setEventSites, analyzeEventConflicts, publishEventSeries, cancelEventSeries, deleteEvent, deleteEventSeries, setEventExclusions } from '@/lib/functions';
import WeatherCard, { WeatherPlaces } from '@/components/WeatherCard';
import SeriesDialog from './SeriesDialog';
import { useCollection } from '@/lib/useCollection';
import FormDialog from '@/components/FormDialog';
import { fmt, useCount } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import ManageToggle from '../../px/ManageToggle';
import EventsManage from './Manage';
import LiveMonitor from './LiveMonitor';
import MyPerformances from './MyPerformances';
import { useMyScope } from '@/lib/useMyScope';
import EditEvent from './EditEvent';
import { CxHead } from '@/components/Cx';
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, Clock, MapPin, Pencil, Users, UserCog } from 'lucide-react';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface EventRow {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'cancelled';
  startMs: number;
  endMs: number;
  groupIds: string[];
  seriesId?: string;
  location: string;
  lat?: number;
  lng?: number;
  sites: Site[];
  shifts: ShiftRow[];
  /** Start / pause / end pressed by a supervisor, per place. */
  run: string[];
}

interface ShiftRow {
  id: string;
  label: string;
  startAt?: { toMillis?: () => number };
  endAt?: { toMillis?: () => number };
  siteId?: string;
  siteIds?: string[];
  groupIds?: string[];
  supervisors: { userId: string; name: string; role: 'main' | 'member'; can?: string[]; leaderId?: string }[];
}

interface Site {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  supervisorId?: string;
  supervisorName?: string;
  agentIds?: string[];
  groupIds?: string[];
}

interface Conflict {
  userId: string;
  userName: string;
  otherEventId: string;
  otherTitle: string;
  kind: 'overlap' | 'insufficient_travel_time';
  gapMinutes?: number;
  neededMinutes?: number;
  distanceKm?: number;
}

/** 1 Day, 3 Days: the calendar days the event touches. */
function durationText(startMs: number, endMs: number) {
  const a = new Date(startMs), b = new Date(endMs);
  const days = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400000) + 1;
  return days === 1 ? '1 Day' : `${days} Days`;
}

/** Event planning and operations — the approved layout on Firebase data. */
export default function EventsPage() {
  const { byId, locationOf } = useGroupHierarchy();
  const myScope = useMyScope();
  const isGroupAdmin = myScope.scope?.role === 'group_manager';
  useHashScroll();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [manageSignal, setManageSignal] = useState(0);
  const [manageClose, setManageClose] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [seriesId, setSeriesId] = useState('');
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [siteDialog, setSiteDialog] = useState(false);
  const [editId, setEditId] = useState('');
  const [checkId, setCheckId] = useState('');
  const [conflicts, setConflicts] = useState<{ eventId: string; list: Conflict[]; checked: number } | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(h);
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'events'), orderBy('startAt', 'desc'), fsLimit(200)), (snap) =>
      setEvents(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            title: (x.title as string) ?? '',
            status: (x.status as EventRow['status']) ?? 'draft',
            startMs: (x.startAt as Timestamp)?.toMillis?.() ?? 0,
            endMs: (x.endAt as Timestamp)?.toMillis?.() ?? 0,
            groupIds: (x.subGroupIds as string[]) ?? [],
            seriesId: x.seriesId as string | undefined,
            location: (x.locationLabel as string) || (x.location as { address?: string } | undefined)?.address || '',
            lat: (x.location as { lat?: number } | undefined)?.lat,
            lng: (x.location as { lng?: number } | undefined)?.lng,
            sites: (x.sites as Site[] | undefined) ?? [],
            shifts: (x.shifts as ShiftRow[] | undefined) ?? [],
            run: Object.values((x.liveRun as Record<string, { state?: string }> | undefined) ?? {}).map((r) => r.state ?? ''),
          };
        })
      )
    );
  }, []);

  const phase = (e: EventRow) => (e.status === 'cancelled' ? 'Cancelled' : e.status === 'draft' ? 'Draft' : e.run.length > 0 && e.run.every((r) => r === 'ended') ? 'Finished' : e.run.some((r) => r === 'running' || r === 'paused') ? 'In progress' : e.endMs < now ? 'Finished' : e.startMs <= now ? 'In progress' : 'Upcoming');
  const live = events.filter((e) => phase(e) === 'In progress');
  const upcoming = events.filter((e) => phase(e) === 'Upcoming');
  const in30 = upcoming.filter((e) => e.startMs - now < 30 * 86400000).length;
  const sites = new Set(live.flatMap((e) => e.groupIds)).size;

  const ORDER = ['In progress', 'Upcoming', 'Draft', 'Finished', 'Cancelled'] as const;
  const TABS = ['All', ...ORDER] as const;
  const activeTab = statusFilter || 'All';
  const countOf = (t: string) => (t === 'All' ? events.length : events.filter((e) => phase(e) === t).length);
  // Same order everywhere: running first, then upcoming, drafts, finished and cancelled. Past ones newest first, the others soonest first.
  const rank = (e: EventRow) => ORDER.indexOf(phase(e) as (typeof ORDER)[number]);
  const newestFirst = (e: EventRow) => phase(e) === 'Finished' || phase(e) === 'Cancelled';
  const rows = events
    .filter((e) => (activeTab === 'All' || phase(e) === activeTab) && (!search.trim() || e.title.toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => rank(a) - rank(b) || (newestFirst(a) ? b.startMs - a.startMs : a.startMs - b.startMs));
  const selected = rows.find((e) => e.id === selectedId) ?? rows[0];

  const present = useCount('eventAttendees', selected ? [['eventId', '==', selected.id]] : [['eventId', '==', '__none__']]);
  const checked = useCount('attendance', selected ? [['eventId', '==', selected.id]] : [['eventId', '==', '__none__']]);

  const marksRaw = useCollection<{ userId: string; status: string; siteId?: string }>('attendance', selected ? [where('eventId', '==', selected.id)] : [where('eventId', '==', '__none__')], selected?.id ?? '');
  const marks = marksRaw ?? [];
  const primarySite = selected?.sites[0];
  const [editSup, setEditSup] = useState(false);
  const [ovp, setOvp] = useState<OverviewKind | ''>('');
  const markIds = useMemo(() => (ovp === 'checked' ? marks.map((m) => m.userId) : []), [ovp, marks]);
  const markFaces = useUserProfiles(markIds);
  const [tab, setTab] = useState<'overview' | 'schedule' | 'team' | 'conflicts' | 'live' | 'attendance' | 'lists' | 'requests' | 'reviews' | 'summary'>('overview');
  const [cfFind, setCfFind] = useState('');
  const [cfBusy, setCfBusy] = useState(false);
  const supIds = useMemo(() => (selected?.shifts ?? []).flatMap((sh) => sh.supervisors.map((p) => p.userId)), [selected?.shifts]);
  const [cfIds, setCfIds] = useState<string[]>([]);
  const faces = useUserProfiles(useMemo(() => [...supIds, ...cfIds], [supIds, cfIds]));
  /** Every main supervisor with his team, the places he covers and his shifts. */
  const tiers = useMemo(() => tiersOf(selected?.shifts ?? [], (selected?.sites ?? []).map((x) => x.id)), [selected?.shifts, selected?.sites]);
  const crews = useMemo(() => {
    const t = (v?: { toMillis?: () => number }) => v?.toMillis?.() ?? 0;
    const mains = new Map<string, { userId: string; name: string; team: Map<string, string>; places: Set<string>; shifts: { label: string; a: number; b: number; place: string }[] }>();
    const loose = new Map<string, string>();
    (selected?.shifts ?? []).forEach((sh) => {
      const place = (sh.siteIds?.length ? sh.siteIds : sh.siteId ? [sh.siteId] : []).map((id) => selected?.sites.find((x) => x.id === id)?.name ?? '').filter(Boolean).join(', ');
      const heads = sh.supervisors.filter((p) => p.role === 'main');
      heads.forEach((h) => {
        const c = mains.get(h.userId) ?? { userId: h.userId, name: h.name, team: new Map<string, string>(), places: new Set<string>(), shifts: [] };
        if (place) place.split(', ').forEach((x) => c.places.add(x));
        c.shifts.push({ label: sh.label.replace(/\s*·?\s*\d{1,2}:\d{2}\s*to\s*\d{1,2}:\d{2}\s*$/, ''), a: t(sh.startAt), b: t(sh.endAt), place });
        mains.set(h.userId, c);
      });
      const leaders = heads.filter((h) => tiers.get(h.userId) !== 'head');
      const owners = leaders.length ? leaders : heads;
      sh.supervisors.filter((p) => p.role === 'member').forEach((m) => {
        const owner = m.leaderId && mains.has(m.leaderId) ? m.leaderId : owners.length === 1 ? owners[0].userId : '';
        if (owner && mains.get(owner)) mains.get(owner)!.team.set(m.userId, m.name);
        else if (m.leaderId && heads.some((h) => h.userId === m.leaderId)) mains.get(m.leaderId)?.team.set(m.userId, m.name);
        else if (owners.length > 1) owners.forEach((h) => mains.get(h.userId)?.team.set(m.userId, m.name));
        else loose.set(m.userId, m.name);
      });
    });
    const rank = (id: string) => (tiers.get(id) === 'head' ? 0 : 1);
    return { mains: [...mains.values()].sort((a, b) => rank(a.userId) - rank(b.userId)), loose: [...loose.entries()] };
  }, [selected?.shifts, selected?.sites, tiers]);
  /** Supervisors of a place, read from the shifts that cover it (the old per-place field is only a fallback). */
  const placeSupervisors = (siteId: string, fallback?: string) => {
    const names = new Set<string>();
    (selected?.shifts ?? []).forEach((sh) => {
      const ids = sh.siteIds?.length ? sh.siteIds : sh.siteId ? [sh.siteId] : [];
      if (ids.length === 0 || ids.includes(siteId)) sh.supervisors.filter((p) => p.role === 'main').forEach((p) => names.add(p.name));
    });
    if (fallback) names.add(fallback);
    return [...names];
  };
  const locs = (selected?.groupIds ?? []).map((g) => locationOf(g));
  const sameCountry = locs.length > 0 && locs.every((l) => l.country?.id === locs[0].country?.id) ? locs[0].country?.id : undefined;
  const sameCity = locs.length > 0 && locs.every((l) => l.city?.id === locs[0].city?.id) ? locs[0].city?.id : undefined;
  const firstLoc = { country: { id: sameCountry }, city: { id: sameCity } };

  // Only what is true now: the result must belong to the event on screen, and an event that was cancelled
  // (or taken back to a draft) after the check no longer counts as a conflict.
  const isOver = (e: EventRow) => e.endMs < now || (e.run.length > 0 && e.run.every((r) => r === 'ended'));
  const mine = conflicts && selected && conflicts.eventId === selected.id ? conflicts : null;
  const cfList = (mine?.list ?? []).filter((c) => { const o = events.find((e) => e.id === c.otherEventId); return !o || (o.status === 'published' && !isOver(o)); });
  const focusId = selected?.id;
  useEffect(() => {
    // Opening the tab checks the event again, so what is shown is never an old answer.
    if (tab !== 'conflicts' || !focusId || selected?.status === 'cancelled' || (selected && isOver(selected))) return;
    if (conflicts?.eventId !== focusId) void runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, focusId]);

  async function runAnalysis() {
    if (!selected) return;
    setAnalysing(true);
    try {
      const res = await analyzeEventConflicts({ eventId: selected.id });
      const d = res.data as { conflicts: Conflict[]; checkedMembers: number };
      setConflicts({ eventId: selected.id, list: d.conflicts, checked: d.checkedMembers });
      setCfIds(Array.from(new Set(d.conflicts.map((c) => c.userId))));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not run the analysis', 'error');
    } finally {
      setAnalysing(false);
    }
  }

  /** Takes members out of one event (this one or the other one in the conflict), then checks again. */
  async function resolveConflict(targetId: string, targetTitle: string, userIds: string[], label: string) {
    const ids = Array.from(new Set(userIds));
    if (!ids.length) return;
    if (!confirm(`${label}\n\nThey will no longer be invited to "${targetTitle}" and their invitation is deleted. You can put them back from the event plan.`)) return;
    setCfBusy(true);
    try {
      await setEventExclusions({ eventId: targetId, remove: ids });
      notify(`${ids.length} member${ids.length === 1 ? '' : 's'} taken out of "${targetTitle}"`, 'success');
      await runAnalysis();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not take the members out', 'error');
    } finally {
      setCfBusy(false);
    }
  }

  const series = useMemo(() => {
    const m = new Map<string, EventRow[]>();
    events.forEach((e) => e.seriesId && m.set(e.seriesId, [...(m.get(e.seriesId) ?? []), e]));
    return [...m.values()];
  }, [events]);
  // The calendar lists only the series that still have an occurrence; a cancelled one is out of sight (it stays reachable from its events).
  const activeSeries = useMemo(() => series.map((s) => s.filter((x) => x.status !== 'cancelled')).filter((s) => s.length > 0), [series]);

  async function removeEvent(id: string, title: string) {
    if (!confirm(`Delete "${title}" for good? Its schedule, attendance list and history are deleted with it.`)) return;
    try { await deleteEvent({ eventId: id }); setSelectedId(''); notify('Event deleted', 'success'); } catch (err) { notify(err instanceof Error ? err.message : 'Could not delete the event', 'error'); }
  }
  async function removeSeries(sid: string) {
    if (!confirm(tx("Delete this series? Every draft and cancelled occurrence is deleted for good. Published occurrences stay: cancel them first."))) return;
    setSeriesBusy(true);
    try { const r = await deleteEventSeries({ seriesId: sid }); notify(`${r.data.deletedCount} occurrence(s) deleted${r.data.keptCount ? `, ${r.data.keptCount} still published (cancel them first)` : ''}`, 'success'); } catch (err) { notify(err instanceof Error ? err.message : 'Could not delete the series', 'error'); } finally { setSeriesBusy(false); }
  }
  async function stopSeries(sid: string) {
    if (!confirm(tx("Cancel every coming occurrence of this series?"))) return;
    setSeriesBusy(true);
    try { const r = await cancelEventSeries({ seriesId: sid }); notify(`${r.data.cancelledCount} occurrence(s) cancelled`, 'success'); } catch (err) { notify(err instanceof Error ? err.message : 'Could not cancel the series', 'error'); } finally { setSeriesBusy(false); }
  }

  async function act(kind: 'publish' | 'cancel' | 'restore', id: string) {
    try {
      if (kind === 'restore') {
        if (!confirm(tx("Bring this event back as a draft? Groups will have to choose their books again, and you will have to publish it again."))) return;
        await restoreEvent({ eventId: id });
        notify('The event is back as a draft', 'success');
      } else if (kind === 'publish') {
        const res = await publishEvent({ eventId: id });
        notify(`Published — ${res.data.attendeeCount ?? 0} attendee(s) added from current kurel membership.`, 'success');
      } else {
        if (!confirm(tx("Cancel this event?"))) return;
        await cancelEvent({ eventId: id });
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update the event', 'error');
    }
  }

  /** A banner opens the list it counts: the right tab, and the list scrolled into view. */
  function goTab(t: string) {
    setStatusFilter(t);
    setSearch('');
    setSelectedId('');
    window.setTimeout(() => document.getElementById('scheduled-events')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const day = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { day: '2-digit' });
  const mon = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { month: 'short' }).toUpperCase();

  return (
    <>
      <div className="px px-planning-evenements">
        <div className="content">
          <CxHead icon={<CalendarDays size={26} />} kicker={tx("Direction Conservatoire")} title={tx("Event planning and operations")} sub={tx("Prepare, run and document every event, even when it covers several sites.")}>
            <button type="button" className="cx-btn green" onClick={() => setManageSignal((n) => n + 1)}>{isGroupAdmin ? tx("Propose an event") : tx("Create an event")}</button>
          </CxHead>

          <section className="card command">
            <div className="command-head">
              <div>
                <h2>{tx("Global coordination center")}</h2>
                <p>{tx("Schedules, kurel membership and attendance are controlled before publication.")}</p>
              </div>
              <div className="command-tags">
                <button type="button" onClick={() => setManageSignal((n) => n + 1)} title={tx("Create an event with several places")}>{tx("Multiple sites")}</button>
                <button type="button" onClick={() => { const el = document.getElementById('recurring-series'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else setManageSignal((n) => n + 1); }} title={tx("Go to the recurring series")}>{tx("Recurring series")}</button>
                <Link href="/dashboard/reports" title={tx("Open the general event report")}>{tx("Instant report")}</Link>
              </div>
            </div>
            <div className="stats">
              <button type="button" className="stat stat-link" onClick={() => goTab('In progress')}><span>{tx("In progress")}</span><strong>{fmt(live.length)}</strong><small>{sites} {tx("active kurels")}</small><em>{tx("See them →")}</em></button>
              <button type="button" className="stat stat-link" onClick={() => goTab('Upcoming')}><span>{tx("Upcoming")}</span><strong>{fmt(upcoming.length)}</strong><small>{in30} {tx("in the next 30 days")}</small><em>{tx("See them →")}</em></button>
              <button type="button" className="stat stat-link" onClick={() => goTab('Draft')}><span>{tx("Drafts")}</span><strong>{fmt(events.filter((e) => e.status === 'draft').length)}</strong><small>{tx("To publish")}</small><em>{tx("See them →")}</em></button>
              <button type="button" className="stat stat-link" onClick={() => document.getElementById('recurring-series')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span>{tx("Series")}</span><strong>{fmt(activeSeries.length)}</strong><small>{tx("Recurring")}</small><em>{tx("See them →")}</em></button>
            </div>
          </section>

          {isGroupAdmin ? (
            <>
            <MyMemberLists />
            <MyPerformances titleOf={(id) => events.find((e) => e.id === id)?.title ?? ''} cancelledIds={events.filter((e) => e.status === 'cancelled').map((e) => e.id)} />
            </>
          ) : (
            <>
            <ApprovalDesk titleOf={(id) => events.find((e) => e.id === id)?.title ?? ''} />
            <LiveMonitor liveEventIds={live.map((e) => e.id)} titleOf={(id) => events.find((e) => e.id === id)?.title ?? ''} events={live.map((e) => ({ id: e.id, title: e.title, startMs: e.startMs, endMs: e.endMs, location: e.location, groupCount: e.groupIds.length }))} />
            </>
          )}

          <div className="main-grid">
            <section className="card panel" id="scheduled-events">
              <div className="ev-phead">
                <div><h2>{tx("Schedule Event")}</h2><p>{tx("Every event on the calendar: local, national and recurring.")}</p></div>
                <label className="ev-search">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  <input type="text" placeholder={tx("Search an event by name")} aria-label={tx("Search an event by name")} value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search && <button type="button" aria-label={tx("Clear the search")} onClick={() => setSearch('')}>×</button>}
                </label>
              </div>
              <div role="tablist" className="ev-tabs">
                {TABS.map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={activeTab === t} className={`ev-tab${activeTab === t ? ' on' : ''} t-${t.toLowerCase().replace(' ', '-')}`} onClick={() => { setStatusFilter(t === 'All' ? '' : t); setSelectedId(''); }}>
                    {t} <em>{countOf(t)}</em>
                  </button>
                ))}
              </div>
              <div className="ev-list">
                {rows.map((e, i) => {
                  const ph = phase(e);
                  const head = activeTab === 'All' && (i === 0 || phase(rows[i - 1]) !== ph);
                  const cls = ph.toLowerCase().replace(' ', '-');
                  return (
                    <div key={e.id}>
                      {head && <div className={`ev-group g-${cls}`}><span>{ph}</span><b>{countOf(ph)}</b></div>}
                      <article className={`ev-card p-${cls}${selected?.id === e.id ? ' active' : ''}`} onClick={() => setSelectedId(e.id)}>
                        <div className="ev-date"><b>{day(e.startMs)}</b><small>{mon(e.startMs)}</small></div>
                        <div className="ev-body">
                          <div className="ev-top"><strong>{e.title}</strong><span className={`ev-pill p-${cls}`}>{ph}</span></div>
                          <div className="ev-meta">
                            <span><Clock size={14} aria-hidden /> {new Date(e.startMs).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })} – {new Date(e.endMs).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="ev-gp"><Users size={14} aria-hidden /> {e.groupIds.length} {tx("group")}{e.groupIds.length === 1 ? '' : 's'}</span>
                            {e.seriesId && <button type="button" className="ev-series" onClick={(ev) => { ev.stopPropagation(); setSeriesId(e.seriesId as string); }}>{tx("↻ Recurring")}</button>}
                          </div>
                          {e.location && <div className="ev-place"><MapPin size={14} aria-hidden /> {e.location}</div>}
                        </div>
                      </article>
                    </div>
                  );
                })}
                {rows.length === 0 && <div className="empty" style={{ display: 'block' }}>{events.length === 0 ? tx("No events yet.") : tx("No event matches.")}</div>}
              </div>
              <button type="button" className="ev-all" onClick={() => { setStatusFilter(''); setSearch(''); document.querySelector('#scheduled-events .ev-list')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>{tx("View all events")} <ArrowRight size={16} aria-hidden /></button>
            </section>

            <article className="card detail ws">
              {selected ? (
                <>
                  <header className="ws-hero">
                    <div className="ws-title">
                      <span className="ws-kind">{selected.groupIds.length > 1 ? tx("Main group event") : tx("Group event")}{selected.seriesId ? tx(" · Recurring") : ''}</span>
                      <h2>{selected.title}</h2>
                      <p>{new Date(selected.startMs).toLocaleString(dateLocale(), { dateStyle: 'full', timeStyle: 'short' })} → {new Date(selected.endMs).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                    <span className={`ev-pill big p-${phase(selected).toLowerCase().replace(' ', '-')}`}>{phase(selected)}</span>
                  </header>
                  <div className="ws-actions">
                    <Link href={`/dashboard/events/${selected.id}`} className="ws-primary"><CalendarDays size={17} aria-hidden />{isGroupAdmin ? tx("Event plan") : tx("Event plan and attendance")}</Link>
                    {!isGroupAdmin && selected.status !== 'cancelled' && <button type="button" onClick={() => setEditId(selected.id)}><Pencil size={16} aria-hidden />{tx("Edit event")}</button>}
                    {!isGroupAdmin && selected.status !== 'cancelled' && <button type="button" onClick={() => setSiteDialog(true)}><UserCog size={16} aria-hidden />{tx("Assign a supervisor")}</button>}
                    {!isGroupAdmin && selected.status === 'cancelled' && <button type="button" onClick={() => act('restore', selected.id)}>{tx("Bring this event back")}</button>}
                    {!isGroupAdmin && selected.status === 'draft' && <button type="button" onClick={() => setCheckId(selected.id)}>{tx("Publish")}</button>}
                    {selected.seriesId && <button type="button" onClick={() => setSeriesId(selected.seriesId as string)}>{tx("See the series")}</button>}
                    {!isGroupAdmin && (
                      <details className="ws-more">
                        <summary>{tx("More")} <ChevronDown size={16} aria-hidden /></summary>
                        <div>
                          {selected.status !== 'cancelled' && <button type="button" className="danger" onClick={() => act('cancel', selected.id)}>{tx("Cancel this event")}</button>}
                          {selected.status !== 'published' && <button type="button" className="danger" onClick={() => removeEvent(selected.id, selected.title)}>{tx("Delete this event")}</button>}
                        </div>
                      </details>
                    )}
                  </div>
                  {selected.status === 'published' && !isGroupAdmin && <EventRunControl eventId={selected.id} />}
                  <nav className="ws-tabs" role="tablist" aria-label={tx("Event sections")}>
                    {([['overview', 'Overview'], ...(isGroupAdmin ? [] : [['lists', 'Member lists']] as const), ['schedule', 'Schedule'], ['team', 'Supervisors'], ['conflicts', 'Conflicts'], ['live', 'Live'], ['attendance', 'Attendance'], ...(isGroupAdmin ? [] : [['requests', 'Requests']] as const), ['reviews', 'Reviews'], ['summary', 'Summary']] as const).map(([k, label]) => (
                      <button type="button" role="tab" key={k} aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                        {label}
                        {k === 'conflicts' && cfList.length > 0 && <em className="bad">{cfList.length}</em>}
                        {k === 'team' && <em>{crews.mains.length}</em>}
                      </button>
                    ))}
                  </nav>
                  <div className="ws-body">
                    {tab === 'overview' && (
                      <>
                        <div className="ws-ovtop"><div className="ws-kpis">
                          <button type="button" className="ws-kpi" onClick={() => setOvp('kurels')}><span><Users size={20} aria-hidden />{tx("Groups")}</span><b>{selected.groupIds.length}</b><em>{tx("See details")}</em></button>
                          <button type="button" className="ws-kpi" onClick={() => setOvp('duration')}><span><Clock size={20} aria-hidden />{tx("Duration")}</span><b>{durationText(selected.startMs, selected.endMs)}</b><em>{tx("See details")}</em></button>
                          <button type="button" className="ws-kpi" onClick={() => setOvp('checked')}><span><CheckCircle2 size={20} aria-hidden />{tx("Checked in")}</span><b>{fmt(checked)} / {fmt(present)}</b><em>{tx("See details")}</em></button>
                          <button type="button" className="ws-kpi" onClick={() => setOvp('places')}><span><MapPin size={20} aria-hidden />{tx("Places")}</span><b>{selected.sites.length || 1}</b><em>{tx("See details")}</em></button>
                        </div>
                        <div className="ws-wx"><WeatherPlaces dateMs={selected.startMs} places={selected.sites.length ? selected.sites.map((x) => ({ id: x.id, name: x.name, lat: x.lat, lng: x.lng })) : [{ name: selected.location.split(',')[0] || selected.title, lat: selected.lat, lng: selected.lng }]} /></div></div>
                        <EventDayPlanner part="places" eventId={selected.id} startMs={selected.startMs} endMs={selected.endMs} sites={selected.sites} shifts={selected.shifts} groupIds={selected.groupIds} groupName={(g) => byId[g]?.name ?? g} cityName={(g) => locationOf(g).city?.name ?? ''} />
                      </>
                    )}
                    {tab === 'schedule' && (
                      <EventDayPlanner part="days" eventId={selected.id} startMs={selected.startMs} endMs={selected.endMs} sites={selected.sites} shifts={selected.shifts} groupIds={selected.groupIds} onChangeSupervision={!isGroupAdmin && selected.status !== 'cancelled' ? () => setEditSup(true) : undefined} groupName={(g) => byId[g]?.name ?? g} cityName={(g) => locationOf(g).city?.name ?? ''} />
                    )}
                    {tab === 'team' && (
                      <div className="lv-crews flat">
                        <div className="lv-crewh">
                          <div><h4>{tx("Supervisors and their teams")}</h4><p>{tx("Only members of the groups taking part can supervise. They sign in with their member phone number and code, and see only this event.")}</p></div>
                          <div className="lv-crewbtn"><span>{crews.mains.length} {tx("supervisor")}{crews.mains.length === 1 ? '' : 's'}</span>{!isGroupAdmin && selected.status !== 'cancelled' && <button type="button" className="btn btn-primary" onClick={() => setEditSup(true)}>{crews.mains.length || crews.loose.length ? tx("Change the supervisors") : tx("Appoint supervisors")}</button>}</div>
                        </div>
                        {crews.mains.length === 0 && crews.loose.length === 0 && <p className="lv-none2">{tx("No supervisor is appointed yet.")}</p>}
                        <div className="lv-crewgrid">
                          {crews.mains.map((c) => (
                            <div className="lv-crew" key={c.userId}>
                              <div className="lv-crewtop"><Avatar name={c.name} photoUrl={faces[c.userId]?.photoUrl} size={40} /><div><b>{c.name}</b><small><span className={`edp-role ${tiers.get(c.userId) ?? 'manager'}`}>{TIER_NAME[tiers.get(c.userId) ?? 'manager']}</span>{tiers.get(c.userId) !== 'head' && c.places.size ? ` ${[...c.places].join(', ')}` : ''}</small></div></div>
                              <div className="lv-team">
                                {c.team.size === 0 ? <em>{tiers.get(c.userId) === 'head' ? tx("Site managers appear in their own cards") : tx("No site staff")}</em> : [...c.team.entries()].map(([id, n]) => <span key={id}><Avatar name={n} photoUrl={faces[id]?.photoUrl} size={22} />{n}</span>)}
                              </div>
                              <details><summary>{c.shifts.length} {tx("shift")}{c.shifts.length === 1 ? '' : 's'}</summary>
                                <ul>{c.shifts.map((x, i) => <li key={i}>{new Date(x.a).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} {tx("to")} {new Date(x.b).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}{x.place ? ` · ${x.place}` : ''}</li>)}</ul>
                              </details>
                            </div>
                          ))}
                        </div>
                        {crews.loose.length > 0 && <div className="lv-team loose"><small>{tx("Team without a main supervisor:")}</small>{crews.loose.map(([id, n]) => <PersonLink key={id} userId={id}><Avatar name={n} photoUrl={faces[id]?.photoUrl} size={22} />{n}</PersonLink>)}</div>}
                      </div>
                    )}
                    {tab === 'conflicts' && (() => {
                      const list = cfList;
                      const overlaps = list.filter((c) => c.kind === 'overlap').length;
                      const shown = list.filter((c) => !cfFind.trim() || c.userName.toLowerCase().includes(cfFind.trim().toLowerCase()) || c.otherTitle.toLowerCase().includes(cfFind.trim().toLowerCase()));
                      return (
                        <div className="cf2">
                          <div className="cf2-bar">
                            <div><h3>{tx("Conflict control")}</h3><p>{tx("Checks overlaps and travel time (distance and a safety buffer) for members of several kurels.")}</p></div>
                            <button type="button" className="ws-primary" disabled={analysing} onClick={runAnalysis}>{analysing ? tx("Analysing…") : mine ? tx("Run it again") : tx("Run the analysis")}</button>
                          </div>
                          {selected.status === 'cancelled' || isOver(selected) ? <div className="cf2-empty ok"><b>{selected.status === 'cancelled' ? tx("This event is cancelled") : tx("This event is over")}</b><span>{selected.status === 'cancelled' ? tx("A cancelled event has no conflicts.") : tx("Conflicts only matter for events that have not finished.")}</span></div>
                            : !mine ? <div className="cf2-empty"><b>{analysing ? tx("Checking this event…") : tx("Not analysed yet")}</b><span>{analysing ? tx("Looking at every invited member against the other published events.") : tx("Press “Run the analysis” to check this event against the others.")}</span></div>
                            : list.length === 0 ? <div className="cf2-empty ok"><b>{tx("No conflict detected")}</b><span>{mine.checked} {tx("member")}{mine.checked === 1 ? '' : 's'} {tx("checked against the other published events.")}</span></div>
                            : (
                              <>
                                <div className="ws-kpis three">
                                  <div className="bad"><span>{tx("Overlapping schedules")}</span><b>{overlaps}</b></div>
                                  <div className="warn"><span>{tx("Not enough travel time")}</span><b>{list.length - overlaps}</b></div>
                                  <div><span>{tx("Members checked")}</span><b>{mine.checked}</b></div>
                                </div>
                                {list.length > 8 && <label className="lb-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={cfFind} onChange={(e) => setCfFind(e.target.value)} placeholder={tx("Search a member or an event")} aria-label={tx("Search a conflict")} />{cfFind && <button type="button" aria-label={tx("Clear")} onClick={() => setCfFind('')}>×</button>}</label>}
                                {!isGroupAdmin && shown.length > 0 && (() => {
                                  const others = Array.from(new Map(shown.map((c) => [c.otherEventId, c.otherTitle])).entries());
                                  return (
                                    <div className="cf2-bulk">
                                      <span>{tx("Solve all")} {shown.length} {tx("shown at once:")}</span>
                                      <button type="button" disabled={cfBusy} onClick={() => resolveConflict(selected.id, selected.title, shown.map((c) => c.userId), `Take these ${new Set(shown.map((c) => c.userId)).size} members out of "${selected.title}"?`)}>{tx("Take them all out of this event")}</button>
                                      {others.length <= 3 && others.map(([id, title]) => (
                                        <button type="button" key={id} disabled={cfBusy} onClick={() => resolveConflict(id, title, shown.filter((c) => c.otherEventId === id).map((c) => c.userId), `Take these members out of "${title}"?`)}>{tx("Take them all out of “")}{title}”</button>
                                      ))}
                                    </div>
                                  );
                                })()}
                                <div className="mm-grid2">
                                  {shown.map((c, i) => (
                                    <article className={`mm-card cf-card ${c.kind === 'overlap' ? 'bad' : 'warn'}`} key={i}>
                                      <header>
                                        <Avatar name={c.userName} photoUrl={faces[c.userId]?.photoUrl} size={52} />
                                        <div><b><PersonLink userId={c.userId}>{c.userName}</PersonLink></b><small>{tx("Two events for the same person")}</small></div>
                                        <span className={`mm-st ${c.kind === 'overlap' ? 'cf-bad' : 'next'}`}>{c.kind === 'overlap' ? tx("Overlapping schedules") : tx("Not enough travel time")}</span>
                                      </header>
                                      <div className="mm-now">
                                        <div className="on"><small>{tx("This event")}</small><b>{selected.title}</b><span>{tx("Where the member is booked now")}</span></div>
                                        <div className="nx"><small>{tx("Other event")}</small><b><a href={`/dashboard/events/${c.otherEventId}`} target="_blank" rel="noopener noreferrer">{c.otherTitle} ↗</a></b><span>{c.kind === 'overlap' ? tx("Runs at the same time") : `${c.gapMinutes} min between, ${c.neededMinutes} needed (${c.distanceKm} km)`}</span></div>
                                      </div>
                                      <footer className="mm-act">
                                        <PersonLink userId={c.userId}><span className="mm-btn">{tx("View profile")}</span></PersonLink>
                                        <a className="mm-btn" href={`/dashboard/events/${c.otherEventId}`} target="_blank" rel="noopener noreferrer">{tx("Open other event")}</a>
                                        {!isGroupAdmin && <button type="button" className="mm-btn warn" disabled={cfBusy} title={`Take ${c.userName} out of this event and keep them in "${c.otherTitle}"`} onClick={() => resolveConflict(selected.id, selected.title, [c.userId], `Take ${c.userName} out of "${selected.title}"?`)}>{tx("Remove from this event")}</button>}
                                        {!isGroupAdmin && <button type="button" className="mm-btn warn" disabled={cfBusy} title={`Keep ${c.userName} in this event and take them out of "${c.otherTitle}"`} onClick={() => resolveConflict(c.otherEventId, c.otherTitle, [c.userId], `Take ${c.userName} out of "${c.otherTitle}"?`)}>{tx("Remove from the other")}</button>}
                                      </footer>
                                    </article>
                                  ))}
                                  {shown.length === 0 && <p className="cf2-none">{tx("No conflict matches “")}{cfFind}”.</p>}
                                </div>
                              </>
                            )}
                        </div>
                      );
                    })()}
                    {tab === 'attendance' && <AttendancePanel eventId={selected.id} title={selected.title} />}
                    {tab === 'lists' && <ParticipationPanel eventId={selected.id} />}
                    {tab === 'requests' && <QuickActions eventId={selected.id} />}
                    {tab === 'reviews' && <PerformanceReviews eventId={selected.id} title={selected.title} />}
                    {tab === 'summary' && <EventSummary eventId={selected.id} title={selected.title} />}
                    {tab === 'live' && (
                      <>
                        <div className="ws-kpis">
                          <div><span>{tx("Members present")}</span><b>{fmt(checked)} / {fmt(present)}</b></div>
                          <div><span>{tx("Late")}</span><b>{marksRaw === null ? '—' : marks.filter((m) => m.status === 'LATE').length}</b></div>
                          <div><span>{tx("Excused / unexcused")}</span><b>{marksRaw === null ? '—' : `${marks.filter((m) => m.status === 'EXCUSED').length} / ${marks.filter((m) => m.status === 'UNEXCUSED').length}`}</b></div>
                          <div><span>{tx("Attendance rate")}</span><b>{present && checked !== null ? `${Math.round((checked / present) * 1000) / 10}%` : '—'}</b></div>
                        </div>
                        <div className="ws-sites">
                          {selected.sites.length === 0 && <p className="lv-none2">{tx("No place is set for this event.")}</p>}
                          {selected.sites.map((x) => {
                            const here = marks.filter((m) => m.siteId === x.id);
                            return (
                              <div className="ws-site" key={x.id}>
                                <div><strong>{x.name}</strong><span>{placeSupervisors(x.id, x.supervisorName).join(', ') || tx("No supervisor")}</span></div>
                                <em>{here.filter((m) => m.status === 'PRESENT' || m.status === 'LATE').length} {tx("present ·")} {here.filter((m) => m.status === 'LATE').length} {tx("late ·")} {here.filter((m) => m.status === 'EXCUSED' || m.status === 'UNEXCUSED').length} {tx("absent")}</em>
                              </div>
                            );
                          })}
                        </div>
                        <LiveBoard eventId={selected.id} sites={selected.sites} shifts={selected.shifts} />
                        <SupervisorInbox eventId={selected.id} />
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="detail-body"><p>{tx("No event to show.")}</p></div>
              )}
            </article>
          </div>

          <section className="card recurring" id="recurring-series">
            <div className="panel-head">
              <div><h2>{tx("Recurring events calendar")}</h2><p>{tx("Series generated from a scheduling rule.")}</p></div>
              <span className="status">{activeSeries.length} {tx("active series")}</span>
            </div>
            <div className="recurring-grid">
              {activeSeries.length === 0 && <div className="recurring-card"><span>{tx("No recurring series.")}</span></div>}
              {activeSeries.map((s) => {
                const upcomingOne = [...s].filter((x) => x.endMs >= now).sort((a, b) => a.startMs - b.startMs)[0];
                const sid = s[0].seriesId as string;
                return (
                  <div className="recurring-card ev-seriescard" key={sid} role="button" tabIndex={0} onClick={() => setSeriesId(sid)} onKeyDown={(e) => e.key === 'Enter' && setSeriesId(sid)}>
                    <strong>{s[0].title}</strong>
                    <span>{s.length} {tx("occurrence")}{s.length === 1 ? '' : 's'} · {s[0].groupIds.length} {tx("kurel")}{s[0].groupIds.length === 1 ? '' : 's'}</span>
                    <small>{upcomingOne ? `Next: ${new Date(upcomingOne.startMs).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}` : tx("No upcoming date")}</small>
                    <em>{tx("Open the series →")}</em>
                    {!isGroupAdmin && (
                      <div className="ev-seriesbtns">
                        <button type="button" disabled={seriesBusy} onClick={(e) => { e.stopPropagation(); stopSeries(sid); }}>{tx("Cancel series")}</button>
                        <button type="button" className="danger" disabled={seriesBusy} onClick={(e) => { e.stopPropagation(); removeSeries(sid); }}>{tx("Delete series")}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="report-grid">
            <article className="report"><strong>{tx("General event report")}</strong><span>{tx("Sites, schedules, attendance and consolidated results.")}</span><Link href="/dashboard/reports"><button type="button">{tx("Open")}</button></Link></article>
            <article className="report"><strong>{tx("Attendance by event")}</strong><span>{tx("Per-member check-in list.")}</span>{selected ? <Link href={`/dashboard/events/${selected.id}`}><button type="button">{tx("Consult")}</button></Link> : <button type="button" disabled>{tx("Consult")}</button>}</article>
          </div>
        </div>
      </div>

      {editSup && selected && (
        <EditSupervision
          eventId={selected.id}
          title={selected.title}
          startMs={selected.startMs}
          endMs={selected.endMs}
          sites={selected.sites}
          groups={selected.groupIds.map((g) => ({ id: g, name: byId[g]?.name ?? g }))}
          shifts={selected.shifts}
          onClose={() => setEditSup(false)}
        />
      )}
      {checkId && (() => { const ev = events.find((x) => x.id === checkId); return ev ? <PublishCheck event={ev} onClose={() => setCheckId('')} onPublish={() => { setCheckId(''); void act('publish', ev.id); }} /> : null; })()}
      {editId && <EditEvent eventId={editId} onClose={() => setEditId('')} onSupervisors={(id) => { setSelectedId(id); setEditId(''); setEditSup(true); }} />}
      {seriesId && (
        <SeriesDialog
          events={series.find((x) => x[0].seriesId === seriesId) ?? []}
          readOnly={isGroupAdmin}
          busy={seriesBusy}
          onClose={() => setSeriesId('')}
          onOpen={(id) => { setStatusFilter(''); setSearch(''); setSelectedId(id); setSeriesId(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onEdit={(id) => { setSeriesId(''); setEditId(id); }}
          onCancel={(id) => act('cancel', id)}
          onPublishAll={() => { setSeriesBusy(true); publishEventSeries({ seriesId }).then((r) => notify(`${r.data.publishedCount} occurrence(s) published`, 'success')).catch((e: Error) => notify(e.message, 'error')).finally(() => setSeriesBusy(false)); }}
          onDelete={(id) => { const t = events.find((x) => x.id === id)?.title ?? ''; removeEvent(id, t); }}
          onDeleteAll={() => removeSeries(seriesId)}
          onCancelAll={() => { if (!confirm(tx("Cancel every occurrence of this series?"))) return; setSeriesBusy(true); cancelEventSeries({ seriesId }).then((r) => notify(`${r.data.cancelledCount} occurrence(s) cancelled`, 'success')).catch((e: Error) => notify(e.message, 'error')).finally(() => setSeriesBusy(false)); }}
        />
      )}
      {siteDialog && selected && (
        <FormDialog
          title={`Assign a supervisor — ${selected.title}`}
          intro={`${new Date(selected.startMs).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })} · ${selected.groupIds.length} kurel(s). The event details are already filled in. Only senior administrators appoint site supervisors; the supervisor marks attendance and rates the performance on their site.`}
          header={<WeatherCard lat={primarySite?.lat ?? selected.lat} lng={primarySite?.lng ?? selected.lng} dateMs={selected.startMs} />}
          submitLabel={tx("Save the supervisor")}
          onClose={() => setSiteDialog(false)}
          fields={[
            { name: 'name', label: tx("Site name"), required: true, initial: primarySite?.name ?? (selected.location ? selected.location.split(',')[0] : selected.title) },
            { name: 'address', label: tx("Address"), initial: primarySite?.address ?? selected.location },
            { name: 'lat', label: tx("Latitude (for travel distances)"), type: 'number', initial: String(primarySite?.lat ?? selected.lat ?? '') },
            { name: 'lng', label: tx("Longitude"), type: 'number', initial: String(primarySite?.lng ?? selected.lng ?? '') },
            { name: 'supervisor', label: tx("Supervisor"), type: 'member', initial: primarySite?.supervisorId ?? '', area: { country: firstLoc.country?.id, city: firstLoc.city?.id }, hint: tx("The list starts in the country and city shared by all kurels of this event (all places when they differ). Leave empty to keep the current supervisor.") },
            { name: 'agents', label: tx("Agents"), type: 'members', initial: (primarySite?.agentIds ?? []).join(','), area: { country: firstLoc.country?.id, city: firstLoc.city?.id } },
            { name: 'groupIds', label: tx("Kurels programmed on this site"), type: 'checkboxes', initial: (primarySite?.groupIds?.length ? primarySite.groupIds : selected.groupIds).join(','), options: selected.groupIds.map((g) => ({ value: g, label: byId[g]?.name ?? g })) },
          ]}
          onSubmit={async (v) => {
            const supervisorId = v.supervisor || undefined;
            const agentIds = v.agents.split(',').map((x) => x.trim()).filter(Boolean);
            const existing = selected.sites.find((x) => x.name.toLowerCase() === v.name.trim().toLowerCase());
            const site = { ...(existing ?? {}), id: existing?.id ?? `site${selected.sites.length + 1}`, name: v.name.trim(), address: v.address || existing?.address, lat: v.lat ? Number(v.lat) : existing?.lat, lng: v.lng ? Number(v.lng) : existing?.lng, supervisorId: supervisorId ?? existing?.supervisorId, agentIds: agentIds.length ? agentIds : existing?.agentIds ?? [], groupIds: v.groupIds ? v.groupIds.split(',') : existing?.groupIds ?? [] };
            const sites = existing ? selected.sites.map((x) => (x.id === existing.id ? site : x)) : [...selected.sites, site];
            await setEventSites({ eventId: selected.id, sites });
            notify('Site saved', 'success');
          }}
        />
      )}
      {ovp && selected && (
        <OverviewPopup
          kind={ovp}
          eventTitle={selected.title}
          kurels={selected.groupIds.map((id) => { const l = locationOf(id); return { id, name: byId[id]?.name ?? id, place: [l.city?.name, l.country?.name].filter(Boolean).join(' · ') }; })}
          durationLabel={durationText(selected.startMs, selected.endMs)}
          days={(() => {
            const out: { label: string; from: string; to: string }[] = [];
            const f = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            out.push({ label: tx("Event"), from: f(selected.startMs), to: f(selected.endMs) });
            (selected.shifts ?? []).forEach((sh) => { const a = sh.startAt?.toMillis?.() ?? 0, b = sh.endAt?.toMillis?.() ?? 0; if (a && b) out.push({ label: sh.label.replace(/\s*·?\s*\d{1,2}:\d{2}\s*to\s*\d{1,2}:\d{2}\s*$/, '') || tx("Shift"), from: f(a), to: f(b) }); });
            return out;
          })()}
          checked={checked ?? 0}
          invited={present ?? 0}
          marks={marksRaw === null ? null : marks.map((m) => ({ userId: m.userId, name: markFaces[m.userId]?.name || '…', status: m.status, site: selected.sites.find((x) => x.id === m.siteId)?.name ?? '' }))}
          places={selected.sites.map((x) => ({ id: x.id, name: x.name, supervisors: placeSupervisors(x.id, x.supervisorName).join(', '), checked: marks.filter((m) => m.siteId === x.id).length }))}
          onClose={() => setOvp('')}
        />
      )}
      <ManageToggle title={tx("Manage events — create, publish, series")} openSignal={manageSignal} closeSignal={manageClose}>
        <EventsManage onCreated={(id) => { if (id) setSelectedId(id); setManageClose((n) => n + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      </ManageToggle>
    </>
  );
}

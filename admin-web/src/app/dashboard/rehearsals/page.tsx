'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, CalendarClock, List as ListIcon, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Mail, Plus, RefreshCw, RotateCcw, Users, XCircle } from 'lucide-react';
import { where, Timestamp } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { useEventAttendance } from '@/lib/useEventAttendance';
import { summarize, BUCKET_LABEL, type Bucket } from '@/lib/attendancePolicy';
import { dayKeyInZone, formatInZone, zonedToUtcMs, DEFAULT_TIME_ZONE } from '@/lib/timeZones';
import { createEvent } from '@/lib/functions';
import FormDialog from '@/components/FormDialog';
import Dropdown from '@/components/Dropdown';
import { PersonLink } from '@/components/MemberProfile';
import { Pill, DateField, useSort } from '@/components/kit';
import { notify } from '@/lib/notify';
import { tx, txf } from '@/lib/i18n/tr';

interface EventRow { title: string; kind?: string; subGroupIds: string[]; startAt: Timestamp; endAt: Timestamp; status: 'draft' | 'published' | 'cancelled'; location?: { address?: string } }
interface LZ { name: string; cityId: string }
interface Fence { name: string; cityId: string; shape: 'circle' | 'polygon'; center?: { lat: number; lng: number }; radiusMeters?: number; polygon?: { lat: number; lng: number }[]; active: boolean }


/** Rehearsal sessions across every city the signed-in admin may see, with member-level attendance. */
export default function RehearsalsPage() {
  const { byId, countries, cities, activeLeafGroups, groupsOf, mainGroups } = useGroupHierarchy();
  const { allows } = useMyScope();
  const rows = useCollection<EventRow>('events', [where('kind', '==', 'rehearsal')]);
  const zones = useZones();
  const localZones = useCollection<LZ>('localZones', []);
  const fences = useCollection<Fence>('geofences', [where('active', '==', true)]);

  const [country, setCountry] = useState('');
  const [zone, setZone] = useState('');
  const [city, setCity] = useState('');
  const [localZone, setLocalZone] = useState('');
  const [group, setGroup] = useState('');
  const [date, setDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Bucket>('');
  const [openId, setOpenId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [draftCity, setDraftCity] = useState('');

  const geoOf = (groupId: string) => {
    const g = byId[groupId];
    const c = g?.parentGroupId ? byId[g.parentGroupId] : undefined;
    return { groupId, cityId: c?.id, countryId: c?.parentGroupId, zoneId: c?.zoneId, tz: c?.timeZone || DEFAULT_TIME_ZONE, cityName: c?.name ?? '—', groupName: g?.name ?? groupId };
  };

  const sessions = useMemo(() => {
    return (rows ?? [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => {
        const geos = e.subGroupIds.map(geoOf);
        return { id: e.id, e, geos, tz: geos[0]?.tz ?? 'UTC', startMs: tsMs(e.startAt), endMs: tsMs(e.endAt) };
      })
      .filter((s) => s.geos.some((g) => allows(g)))
      .filter((s) => !country || s.geos.some((g) => g.countryId === country))
      .filter((s) => !zone || s.geos.some((g) => g.zoneId === zone))
      .filter((s) => !city || s.geos.some((g) => g.cityId === city))
      .filter((s) => !localZone || s.e.subGroupIds.some((g) => byId[g]?.localZoneId === localZone))
      .filter((s) => !group || s.e.subGroupIds.includes(group))
      .filter((s) => !date || dayKeyInZone(s.startMs, s.tz) === date)
      .sort((a, b) => b.startMs - a.startMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byId, country, zone, city, localZone, group, date, allows]);

  const att = useEventAttendance(useMemo(() => sessions.slice(0, 60).map((s) => s.id), [sessions]));
  const now = Date.now();
  const started = sessions.filter((s) => s.startMs <= now).slice(0, 60);
  const total = summarize(started.flatMap((s) => (att.attendees[s.id] ?? []).map((u) => att.bucket[`${s.id}_${u}`] ?? 'absent')));
  const openMembers = att.attendees[openId] ?? [];
  const profiles = useUserProfiles(openMembers);
  const names = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.name]));

  const cityOptions = cities.filter((c) => (!country || c.parentGroupId === country) && (!zone || c.zoneId === zone) && allows({ cityId: c.id, countryId: c.parentGroupId, zoneId: c.zoneId }));
  const countryZones = (zones ?? []).filter((z) => !country || z.countryId === country);
  const draftCityGroups = draftCity ? groupsOf(draftCity) : [];
  const draftFences = (fences ?? []).filter((f) => f.cityId === draftCity);

  const tone: Record<Bucket, 'ok' | 'gold' | 'teal' | 'red'> = { present: 'ok', late: 'gold', leave: 'teal', absent: 'red' };
  const data = sessions.map((s) => {
    const list = att.attendees[s.id] ?? [];
    const sum = summarize(list.map((u) => att.bucket[`${s.id}_${u}`] ?? 'absent'));
    return { ...s, list, sum, city: Array.from(new Set(s.geos.map((g) => g.cityName))).join(', '), groupsTxt: s.geos.map((g) => g.groupName).join(', ') };
  }).filter((s) => !statusFilter || (s.startMs <= now && s.sum[statusFilter] > 0));
  const { sorted, sort, toggle } = useSort(data, { title: (s) => s.e.title.toLowerCase(), city: (s) => s.city.toLowerCase(), groups: (s) => s.groupsTxt.toLowerCase(), time: (s) => s.startMs, rate: (s) => (s.sum.expected ? s.sum.present / s.sum.expected : -1) }, { key: 'time', dir: 'desc' });
  const filtering = !!(country || zone || city || localZone || group || date || statusFilter);
  const clear = () => { setCountry(''); setZone(''); setCity(''); setLocalZone(''); setGroup(''); setDate(''); setStatusFilter(''); };
  const tile = (b: Bucket) => () => setStatusFilter(statusFilter === b ? '' : b);

  const PAGE = 10;
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const cur = Math.min(page, pages);
  const pageRows = sorted.slice((cur - 1) * PAGE, cur * PAGE);
  useEffect(() => { setPage(1); }, [country, zone, city, localZone, group, date, statusFilter]);
  const tiles = [
    { cls: 't1', icon: <CheckCircle2 size={26} />, label: tx("Present"), value: att.loading ? '—' : `${total.present}/${total.expected}`, b: 'present' as Bucket },
    { cls: 't3', icon: <AlarmClock size={26} />, label: tx("Late (counted absent)"), value: att.loading ? '—' : total.late, b: 'late' as Bucket },
    { cls: 't2', icon: <Mail size={26} />, label: tx("Leave"), value: att.loading ? '—' : `${total.leave}/${total.expected}`, b: 'leave' as Bucket },
    { cls: 'tr', icon: <XCircle size={26} />, label: tx("Absent (includes late)"), value: att.loading ? '—' : `${total.absent}/${total.expected}`, b: 'absent' as Bucket },
  ];
  const COLS = ['#1e9d66', '#1f78d1', '#e8832f', '#7c4cc4', '#1aa3b8', '#0b6a43'];
  const COLB = ['#e3f6ec', '#e4f0fc', '#fdebd9', '#efe8fa', '#e0f5f8', '#e3f6ec'];
  const th = (i: number, k: string, label: string) => {
    const on = sort?.key === k;
    return (
      <th key={k} style={{ ['--cc' as string]: COLS[i], ['--cb' as string]: COLB[i] } as React.CSSProperties} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={i === 5 ? 'num' : ''}>
        {k ? <button type="button" className={on ? 'on' : ''} onClick={() => toggle(k)}>{label}<i aria-hidden>{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</i></button> : <span>{label}</span>}
      </th>
    );
  };

  return (
    <div className="eb2">
      <section className="eb2-hero">
        <div className="eb2-ht">
          <span className="eb2-line" aria-hidden />
          <h1>{tx("Rehearsals")}</h1>
          <p>{tx("Rehearsal sessions by country, zone, city and group. Times are shown in each city's own time zone.")}</p>
        </div>
        <div className="eb2-acts">
          <button type="button" className="ghost" onClick={att.refresh}><RefreshCw size={16} /> {tx("Refresh")}</button>
          <button type="button" className="gold" onClick={() => setCreating(true)}><Plus size={16} /> {tx("New rehearsal")}</button>
        </div>
      </section>

      <div className="eb2-tiles">
        {tiles.map((t) => (
          <button type="button" key={t.label} className={`${t.cls}${statusFilter === t.b ? ' on' : ''}`} onClick={tile(t.b)} aria-pressed={statusFilter === t.b}>
            <span className="eb2-ti" aria-hidden>{t.icon}</span>
            <small>{t.label}</small><b>{t.value}</b>
            <ChevronRight className="eb2-go" size={20} aria-hidden />
          </button>
        ))}
      </div>

      <div className="eb2-bar rh-bar">
        <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setZone(''); setCity(''); setGroup(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} className="eb2-dd" />
        <Dropdown label={tx("Zone")} value={zone} onChange={(v) => { setZone(v); setCity(''); setGroup(''); }} allLabel={tx("All zones")} options={countryZones.map((z) => ({ value: z.id, label: z.name }))} className="eb2-dd" />
        <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setGroup(''); }} allLabel={tx("All cities")} options={cityOptions.map((c) => ({ value: c.id, label: c.name }))} className="eb2-dd" />
        <Dropdown label={tx("Local zone")} value={localZone} onChange={setLocalZone} allLabel={tx("All local zones")} options={(localZones ?? []).filter((z) => !city || z.cityId === city).map((z) => ({ value: z.id, label: z.name }))} className="eb2-dd" />
        <Dropdown label={tx("Group")} value={group} onChange={setGroup} allLabel={tx("All groups")} options={activeLeafGroups.filter((g) => !city || g.parentGroupId === city).map((g) => ({ value: g.id, label: g.name }))} className="eb2-dd" />
        <DateField label={tx("Date")} value={date} onChange={setDate} />
        <Dropdown label={tx("Attendance status")} value={statusFilter} onChange={(v) => setStatusFilter(v as '' | Bucket)} allLabel={tx("Every attendance status")} options={[{ value: 'present', label: tx("Present") }, { value: 'late', label: tx("Late") }, { value: 'leave', label: tx("Leave") }, { value: 'absent', label: tx("Absent") }]} className="eb2-dd" />
        <button type="button" className="eb2-clear" onClick={clear} disabled={!filtering}><RotateCcw size={15} /> {tx("Clear all")}</button>
      </div>

      <section className="eb2-panel">
        <header><i aria-hidden><CalendarClock size={20} /></i><h2>{tx("Rehearsal Sessions")}</h2><em>{filtering ? tx("Filtered") + ` · ${sorted.length}` : sorted.length}</em><span className="rh-vt" role="group" aria-label={tx("View")}><button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><ListIcon size={16} /> {tx("List")}</button><button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}><CalendarDays size={16} /> {tx("Calendar")}</button></span></header>
        <p className="eb2-note">{tx("Counts cover sessions that have already started. A late member counts as absent but may sit and observe; Present + Leave + Absent always equals the expected total.")}</p>
        {view === 'list' && (rows === null ? <p className="kt-empty">{tx("Loading…")}</p> : sorted.length === 0 ? <p className="kt-empty">{tx("No rehearsal matches these filters.")}</p> : (
          <div className="eb2-scroll">
            <table className="eb2-table rh-table">
              <thead><tr>{th(0, 'title', tx("Session"))}{th(1, 'city', tx("City"))}{th(2, 'groups', tx("Groups"))}{th(3, 'time', tx("Local time"))}{th(4, 'rate', tx("Attendance"))}{th(5, '', tx("Members"))}</tr></thead>
              <tbody>
                {pageRows.map((s) => {
                  const isOpen = openId === s.id;
                  const flip = () => setOpenId(isOpen ? '' : s.id);
                  return (
                    <FragmentRow key={s.id}>
                      <tr className={isOpen ? 'open' : ''}>
                        <td className="c0"><button type="button" className="eb2-cell stack" title={tx("Show the members")} onClick={flip}><b>{s.e.title}</b><Pill tone={s.e.status === 'published' ? 'ok' : 'gold'}>{s.e.status === 'published' ? tx("Published") : tx("Draft")}</Pill></button></td>
                        <td className="c1"><button type="button" className="eb2-cell" title={tx("Show only this city")} disabled={!s.geos[0]?.cityId} onClick={() => { setCountry(''); setZone(''); setCity(s.geos[0]?.cityId ?? ''); setGroup(''); }}>{s.city}</button></td>
                        <td className="c2"><button type="button" className="eb2-cell" title={tx("Show only this group")} onClick={() => setGroup(s.geos[0]?.groupId ?? '')}>{s.groupsTxt}</button></td>
                        <td className="c3"><button type="button" className="eb2-cell stack" title={tx("Show only this day")} onClick={() => setDate(dayKeyInZone(s.startMs, s.tz))}><span>{formatInZone(s.startMs, s.tz)}</span><small>{tx("to")} {formatInZone(s.endMs, s.tz, false)}</small></button></td>
                        <td className="c4"><button type="button" className="eb2-cell" title={tx("Show the members")} onClick={flip}>{s.startMs > now ? <Pill>{tx("Not started")}</Pill> : att.loading ? '—' : <span className="kt-rate"><Pill tone="ok">{s.sum.present}/{s.sum.expected}</Pill><Pill tone="gold">{s.sum.late} {tx("Late")}</Pill><Pill tone="teal">{s.sum.leave} {tx("Leave")}</Pill></span>}</button></td>
                        <td className="c5 num"><button type="button" className="rh-btn" onClick={flip}><Users size={15} /> {isOpen ? tx("Hide members") : tx("Members")}</button></td>
                      </tr>
                      {isOpen && (
                        <tr className="kt-sub"><td colSpan={6}>
                          {s.list.length === 0 ? <p className="kt-empty">{tx("No member is expected yet. Publish the rehearsal to invite the groups' members.")}</p> : (
                            <div className="kt-people">
                              {s.list
                                .map((u) => ({ u, b: (s.startMs > now ? undefined : att.bucket[`${s.id}_${u}`] ?? 'absent') as Bucket | undefined }))
                                .filter((m) => !statusFilter || m.b === statusFilter)
                                .sort((x, y) => (names[x.u] || x.u).localeCompare(names[y.u] || y.u))
                                .map((m) => (
                                  <div className="kt-person" key={m.u}>
                                    <Avatar name={names[m.u] || m.u} photoUrl={profiles[m.u]?.photoUrl} size={32} />
                                    <PersonLink userId={m.u}><b>{names[m.u] || m.u}</b></PersonLink>
                                    {m.b ? <Pill tone={tone[m.b]}>{BUCKET_LABEL[m.b]}</Pill> : <Pill>{tx("Not started")}</Pill>}
                                  </div>
                                ))}
                            </div>
                          )}
                        </td></tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {view === 'calendar' ? (() => {
          const y = calMonth.getFullYear();
          const m = calMonth.getMonth();
          const first = (new Date(y, m, 1).getDay() + 6) % 7;
          const days = new Date(y, m + 1, 0).getDate();
          const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
          while (cells.length % 7) cells.push(null);
          const byDay: Record<number, typeof sorted> = {};
          sorted.forEach((s) => { const d = new Date(s.startMs); if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] ??= []).push(s); });
          return (
            <div className="rh-cal">
              <div className="rh-calh"><button type="button" aria-label={tx("Previous")} onClick={() => setCalMonth(new Date(y, m - 1, 1))}><ChevronLeft size={16} /></button><b>{calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button type="button" aria-label={tx("Next")} onClick={() => setCalMonth(new Date(y, m + 1, 1))}><ChevronRight size={16} /></button></div>
              <div className="rh-calg">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="h">{tx(d)}</span>)}
                {cells.map((d, i) => (
                  <div key={i} className={`c${d ? '' : ' x'}`}>
                    {d && <em>{d}</em>}
                    {d && (byDay[d] ?? []).slice(0, 3).map((s) => <button type="button" key={s.id} title={s.e.title} onClick={() => { setView('list'); setDate(dayKeyInZone(s.startMs, s.tz)); }}>{s.e.title}</button>)}
                    {d && (byDay[d] ?? []).length > 3 && <small>+{(byDay[d] ?? []).length - 3}</small>}
                  </div>
                ))}
              </div>
            </div>
          );
        })() : null}
        {view === 'list' && <footer>
          <span>{txf("Showing {a} of {b} results", { a: pageRows.length, b: sorted.length })}</span>
          {pages > 1 && (
            <nav aria-label={tx("Pages")}>
              <button type="button" aria-label={tx("Previous")} disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} /></button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === cur ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
              <button type="button" aria-label={tx("Next")} disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRight size={16} /></button>
            </nav>
          )}
        </footer>}
      </section>

      {creating && (
        <FormDialog
          title={tx("New rehearsal")}
          intro="Times are entered in the city's own time zone and stored as one exact moment, so every member sees the right local time."
          submitLabel={tx("Create and invite")}
          onClose={() => setCreating(false)}
          onValuesChange={(v) => setDraftCity(v.cityId ?? '')}
          fields={[
            { name: 'title', label: tx("Title"), required: true },
            { name: 'cityId', label: tx("City"), type: 'select', required: true, options: cityOptions.map((c) => ({ value: c.id, label: `${c.name}${c.timeZone ? '' : ' (default time zone: Senegal)'}` })) },
            { name: 'groupIds', label: tx("Groups taking part"), type: 'checkboxes', options: draftCityGroups.map((g) => ({ value: g.id, label: g.name })) },
            { name: 'date', label: tx("Date (city time)"), type: 'date', required: true },
            { name: 'start', label: tx("Start (city time)"), type: 'time', required: true },
            { name: 'end', label: tx("End (city time)"), type: 'time', required: true },
            { name: 'fenceId', label: tx("Geofence (sets the place and check-in radius)"), type: 'select', options: draftFences.map((f) => ({ value: f.name, label: f.name })), hint: tx("Optional. Otherwise enter the coordinates below.") },
            { name: 'lat', label: tx("Latitude"), type: 'number' },
            { name: 'lng', label: tx("Longitude"), type: 'number' },
            { name: 'radius', label: tx("Check-in radius (meters)"), type: 'number', initial: '150' },
            { name: 'purpose', label: tx("Purpose"), type: 'textarea' },
          ]}
          onSubmit={async (v) => {
            const cityNode = byId[v.cityId];
            if (!cityNode) throw new Error('Choose a city');
            const ids = (v.groupIds || '').split(',').filter(Boolean);
            if (ids.length === 0) throw new Error('Choose at least one group');
            const tz = cityNode.timeZone || DEFAULT_TIME_ZONE;
            const fence = (fences ?? []).find((f) => f.cityId === v.cityId && f.name === v.fenceId);
            const center = fence?.center ?? (fence?.polygon ? { lat: fence.polygon.reduce((n, p) => n + p.lat, 0) / fence.polygon.length, lng: fence.polygon.reduce((n, p) => n + p.lng, 0) / fence.polygon.length } : undefined);
            const lat = center?.lat ?? Number(v.lat);
            const lng = center?.lng ?? Number(v.lng);
            const radius = fence?.radiusMeters ?? Number(v.radius);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || v.lat === '' && !center) throw new Error('Choose a geofence or enter the coordinates');
            const startAtMs = zonedToUtcMs(v.date, v.start, tz);
            const endAtMs = zonedToUtcMs(v.date, v.end, tz);
            await createEvent({
              title: v.title.trim(),
              mainGroupId: mainGroups[0]?.id ?? '',
              subGroupIds: ids,
              location: { lat, lng, address: fence?.name },
              geofenceRadiusMeters: radius,
              startAtMs,
              endAtMs,
              kind: 'rehearsal',
              purpose: v.purpose || undefined,
              publish: true,
            });
            notify('Rehearsal created and members invited', 'success');
          }}
        />
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

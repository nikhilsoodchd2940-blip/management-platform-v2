'use client';

import { useEffect, useMemo, useState } from 'react';
import { limit as fsLimit, orderBy, Timestamp } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { useEventAttendance } from '@/lib/useEventAttendance';
import { summarize, BUCKET_LABEL, type Bucket } from '@/lib/attendancePolicy';
import { dayKeyInZone, formatInZone, DEFAULT_TIME_ZONE } from '@/lib/timeZones';
import Dropdown from '@/components/Dropdown';
import { PersonLink } from '@/components/MemberProfile';
import { Pill, Clear, DateField, useSort } from '@/components/kit';
import { CxCard, CxStats, CxTabs, CxDonut, CxLine, CxBar, CxInitials, CxPill } from '@/components/Cx';
import { CheckCircle2, Clock, Eye, LogIn, MoreVertical, Search, ListChecks, MapPin, BarChart3, Calendar, Users, XCircle, Target, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { tx } from '@/lib/i18n/tr';

interface EventRow { title: string; kind?: string; subGroupIds: string[]; startAt: Timestamp; status: string }
const tone: Record<Bucket, 'ok' | 'gold' | 'teal' | 'red'> = { present: 'ok', late: 'gold', leave: 'teal', absent: 'red' };

/** Events and rehearsals together, filtered by area, with the shared counting policy (see lib/attendancePolicy.ts). */
export interface AttendanceExtras { labels: string[]; values: number[]; events: number | null; week: number; today: number }
export default function AttendanceSummary({ focus = '', onFocus, extras }: { focus?: '' | Bucket; onFocus?: (b: '' | Bucket) => void; extras: AttendanceExtras }) {
  const { byId, countries, cities, activeLeafGroups } = useGroupHierarchy();
  const { allows } = useMyScope();
  const events = useCollection<EventRow>('events', [orderBy('startAt', 'desc'), fsLimit(200)]);
  const zones = useZones();
  const [country, setCountry] = useState('');
  const [zone, setZone] = useState('');
  const [city, setCity] = useState('');
  const [group, setGroup] = useState('');
  const [eventId, setEventId] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'session' | 'group' | 'location' | 'stats' | 'published'>('session');
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<'new' | 'old' | 'rate'>('new');

  const list = useMemo(() => {
    const geo = (gid: string) => {
      const g = byId[gid];
      const c = g?.parentGroupId ? byId[g.parentGroupId] : undefined;
      return { groupId: gid, cityId: c?.id, countryId: c?.parentGroupId, zoneId: c?.zoneId, tz: c?.timeZone || DEFAULT_TIME_ZONE, cityName: c?.name ?? '—' };
    };
    return (events ?? [])
      .filter((e) => e.status === 'published' && tsMs(e.startAt) <= Date.now())
      .map((e) => ({ id: e.id, e, geos: e.subGroupIds.map(geo), startMs: tsMs(e.startAt) }))
      .filter((s) => s.geos.some((g) => allows(g)))
      .filter((s) => !kind || (s.e.kind ?? 'event') === kind)
      .filter((s) => !country || s.geos.some((g) => g.countryId === country))
      .filter((s) => !zone || s.geos.some((g) => g.zoneId === zone))
      .filter((s) => !city || s.geos.some((g) => g.cityId === city))
      .filter((s) => !group || s.e.subGroupIds.includes(group))
      .filter((s) => !date || dayKeyInZone(s.startMs, s.geos[0]?.tz ?? 'UTC') === date)
      .filter((s) => !eventId || s.id === eventId)
      .filter((s) => { const t = q.trim().toLowerCase(); return !t || s.e.title.toLowerCase().includes(t) || s.geos.some((g) => (byId[g.groupId]?.name ?? '').toLowerCase().includes(t) || g.cityName.toLowerCase().includes(t)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, byId, kind, country, zone, city, group, date, eventId, allows, q]);

  const shown = list.slice(0, 60);
  const att = useEventAttendance(useMemo(() => shown.map((s) => s.id), [shown]));
  const bucketsOf = (id: string) => (att.attendees[id] ?? []).map((u) => att.bucket[`${id}_${u}`] ?? 'absent');
  const total = summarize(shown.flatMap((s) => bucketsOf(s.id)));
  const single = eventId ? shown[0] : undefined;
  const members = single ? att.attendees[single.id] ?? [] : [];
  const profiles = useUserProfiles(members);
  const names = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.name]));

  const rowsX = shown.map((s) => ({ ...s, sum: summarize(bucketsOf(s.id)), city: Array.from(new Set(s.geos.map((g) => g.cityName))).join(', ') }));
  const filteredRows = focus ? rowsX.filter((r) => r.sum[focus] > 0) : rowsX;
  const { sorted } = useSort(filteredRows, { title: (r) => r.e.title.toLowerCase(), type: (r) => r.e.kind ?? 'event', city: (r) => r.city.toLowerCase(), time: (r) => r.startMs, present: (r) => r.sum.present, late: (r) => r.sum.late, leave: (r) => r.sum.leave, absent: (r) => r.sum.absent }, { key: 'time', dir: 'desc' });
  const filtering = !!(country || zone || city || group || eventId || date || kind || focus || q);
  const clear = () => { setCountry(''); setZone(''); setCity(''); setGroup(''); setEventId(''); setDate(''); setKind(''); setQ(''); onFocus?.(''); };
  const setF = (b: Bucket) => onFocus?.(focus === b ? '' : b);

  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const rate = (r: { sum: { present: number; expected: number } }) => pct(r.sum.present, r.sum.expected);
  const ordered = useMemo(() => [...sorted].sort((a, b) => (order === 'new' ? b.startMs - a.startMs : order === 'old' ? a.startMs - b.startMs : rate(b) - rate(a))), [sorted, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const PER = 5;
  const pages = Math.max(1, Math.ceil(ordered.length / PER));
  const cur = Math.min(page, pages);
  const pageRows = ordered.slice((cur - 1) * PER, cur * PER);
  const byGroup = useMemo(() => {
    const m = new Map<string, { id: string; name: string; present: number; expected: number }>();
    rowsX.forEach((r) => { if (r.e.subGroupIds.length !== 1) return; const g = r.e.subGroupIds[0]; const c = m.get(g) ?? { id: g, name: byId[g]?.name ?? '—', present: 0, expected: 0 }; c.present += r.sum.present; c.expected += r.sum.expected; m.set(g, c); });
    return [...m.values()].filter((g) => g.expected > 0).sort((a, b) => pct(b.present, b.expected) - pct(a.present, a.expected));
  }, [rowsX, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCity = useMemo(() => {
    const m = new Map<string, { name: string; present: number; expected: number; n: number }>();
    rowsX.forEach((r) => { const c = m.get(r.city) ?? { name: r.city, present: 0, expected: 0, n: 0 }; c.present += r.sum.present; c.expected += r.sum.expected; c.n++; m.set(r.city, c); });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rowsX]);
  useEffect(() => {
    const h = () => {
      const lines = [['Session', 'Type', 'Location', 'Date', 'Expected', 'Present', 'Late', 'Leave', 'Absent', 'Rate %'], ...ordered.map((x) => [x.e.title, x.e.kind ?? 'event', x.city, formatInZone(x.startMs, x.geos[0]?.tz ?? 'UTC'), x.sum.expected, x.sum.present, x.sum.late, x.sum.leave, x.sum.absent, rate(x)])];
      const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'attendance-sessions.csv'; a.click(); URL.revokeObjectURL(url);
    };
    window.addEventListener('att-export-csv', h);
    return () => window.removeEventListener('att-export-csv', h);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const full = rowsX.filter((r) => r.sum.expected > 0 && r.sum.present === r.sum.expected).length;
  const overall = pct(total.present, total.expected);
  const dash = (v: number | string) => (att.loading ? '—' : v);

  return (
    <>
      <CxStats items={[
        { label: tx("Present"), value: dash(`${total.present} / ${total.expected}`), badge: att.loading ? undefined : `${pct(total.present, total.expected)}%`, icon: <CheckCircle2 size={24} />, tone: 'green', onClick: () => setF('present') },
        { label: tx("Late"), value: dash(total.late), badge: att.loading ? undefined : `${pct(total.late, total.expected)}%`, icon: <Clock size={24} />, tone: 'amber', onClick: () => setF('late') },
        { label: tx("Excused Absences"), value: dash(`${total.leave} / ${total.expected}`), badge: att.loading ? undefined : `${pct(total.leave, total.expected)}%`, icon: <LogIn size={24} />, tone: 'blue', onClick: () => setF('leave') },
        { label: tx("Unexcused Absences"), value: dash(`${total.absent} / ${total.expected}`), badge: att.loading ? undefined : `${pct(total.absent, total.expected)}%`, icon: <XCircle size={24} />, tone: 'red', onClick: () => setF('absent') },
      ]} />

      <section className="cx-filters at-filters">
        <label className="cx-search"><Search size={16} aria-hidden /><input type="search" placeholder={tx("Search session, event or group…")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setZone(''); setCity(''); setGroup(''); setEventId(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("Zone")} value={zone} onChange={(v) => { setZone(v); setCity(''); setGroup(''); setEventId(''); }} allLabel={tx("All zones")} options={(zones ?? []).filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }))} className="loc-dd" />
        <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setGroup(''); setEventId(''); }} allLabel={tx("All cities")} options={cities.filter((c) => (!country || c.parentGroupId === country) && (!zone || c.zoneId === zone)).map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("Group")} value={group} onChange={(v) => { setGroup(v); setEventId(''); }} allLabel={tx("All groups")} options={activeLeafGroups.filter((g) => !city || g.parentGroupId === city).map((g) => ({ value: g.id, label: g.name }))} className="loc-dd" />
        <Dropdown label={tx("Type")} value={kind} onChange={(v) => { setKind(v); setEventId(''); }} allLabel={tx("Events and rehearsals")} options={[{ value: 'event', label: tx("Events only") }, { value: 'rehearsal', label: tx("Rehearsals only") }]} className="loc-dd" />
        <Dropdown label={tx("Session")} value={eventId} onChange={setEventId} allLabel={tx("All sessions")} options={list.slice(0, 100).map((s) => ({ value: s.id, label: `${s.e.title} · ${formatInZone(s.startMs, s.geos[0]?.tz ?? 'UTC')}` }))} className="loc-dd" />
        <DateField label={tx("Date")} value={date} onChange={setDate} />
        {filtering && <Clear onClick={clear} />}
      </section>

      <div className="cx-grid cx-g3 at-top">
        <CxCard icon={<Users size={22} />} title={tx("Members")}>
          <div className="at-donut">
            <CxDonut size={150} big={att.loading ? '—' : total.expected} label={tx("Members")} slices={[{ value: total.present, color: '#1f9d63' }, { value: total.late, color: '#e0a21b' }, { value: total.leave, color: '#3b82f6' }, { value: Math.max(0, total.absent - total.late), color: '#d64535' }]} />
            <ul className="at-leg">
              <li><i style={{ background: '#1f9d63' }} />{tx("Present")}<b>{dash(total.present)}</b></li>
              <li><i style={{ background: '#e0a21b' }} />{tx("Late")}<b>{dash(total.late)}</b></li>
              <li><i style={{ background: '#3b82f6' }} />{tx("Leave (Excused)")}<b>{dash(total.leave)}</b></li>
              <li><i style={{ background: '#d64535' }} />{tx("Absent (Unexcused)")}<b>{dash(total.absent)}</b></li>
            </ul>
          </div>
        </CxCard>
        <CxCard icon={<BarChart3 size={22} />} title={tx("Attendance Trend (Last 7 Days)")}>
          <CxLine labels={extras.labels} values={extras.values} />
        </CxCard>
        <CxCard tone="amber" icon={<Calendar size={22} />} title={tx("Published Events")} sub={tx("Events that record attendance")}>
          <div className="at-pub">
            <CxDonut size={118} big={extras.events ?? '—'} label={tx("Events")} slices={[{ value: 1, color: '#1f9d63' }]} />
            <div><p><CheckCircle2 size={18} /><b>{extras.week}</b><span>{tx("Check-ins this week")}</span></p><p><Calendar size={18} /><b>{extras.today}</b><span>{tx("Check-ins today")}</span></p></div>
          </div>
        </CxCard>
      </div>

      <CxTabs value={tab} onChange={(v) => { setTab(v as typeof tab); setPage(1); }} items={[
        { value: 'session', label: tx("By Session"), icon: <ListChecks size={20} />, count: sorted.length },
        { value: 'group', label: tx("By Group"), icon: <Users size={20} /> },
        { value: 'location', label: tx("By Location"), icon: <MapPin size={20} /> },
        { value: 'stats', label: tx("Statistics"), icon: <BarChart3 size={20} /> },
        { value: 'published', label: tx("Published Events"), icon: <Calendar size={20} /> },
      ]} />

      {tab === 'session' && (
        <CxCard id="att-table" dark icon={<ListChecks size={22} />} title={<>{tx("Session Attendance")} <span className="cx-pill grey at-n">{sorted.length}</span></>} sub={tx("Members present compared with the total expected for events and rehearsal sessions.")}
          right={<Dropdown label={tx("Sort by")} value={order} onChange={(v) => setOrder((v || 'new') as typeof order)} allLabel={tx("Date (Newest)")} options={[{ value: 'old', label: tx("Date (Oldest)") }, { value: 'rate', label: tx("Rate (best first)") }]} className="loc-dd" />}>
          <p className="kt-note at-note">{tx("A late member counts as absent but may sit and observe. Present + Leave + Absent always equals Expected. Only sessions that have started are counted")}{list.length > 60 ? tx("; the 60 most recent are shown") : ''}.</p>
          {events === null ? <p className="kt-empty">{tx("Loading…")}</p> : sorted.length === 0 ? <p className="kt-empty">{tx("No session matches these filters.")}</p> : single ? (
            <div className="kt-people">
              {members.map((u) => ({ u, b: att.bucket[`${single.id}_${u}`] ?? 'absent' })).filter((m) => !focus || m.b === focus).sort((a, b) => (names[a.u] || a.u).localeCompare(names[b.u] || b.u)).map((m) => (
                <div className="kt-person" key={m.u}>
                  <Avatar name={names[m.u] || m.u} photoUrl={profiles[m.u]?.photoUrl} size={32} />
                  <PersonLink userId={m.u}><b>{names[m.u] || m.u}</b></PersonLink>
                  <Pill tone={tone[m.b]}>{BUCKET_LABEL[m.b]}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="cx-scroll">
                <table className="cx-table at-table">
                  <thead><tr className="at-h1"><th rowSpan={2}>{tx("Session")}</th><th rowSpan={2}>{tx("Type")}</th><th rowSpan={2}>{tx("Location")}</th><th rowSpan={2}>{tx("Date & time")}</th><th colSpan={4} className="at-grp">{tx("Attendance")}</th><th rowSpan={2}>{tx("Rate")}</th><th rowSpan={2}>{tx("Actions")}</th></tr><tr className="at-h2"><th>{tx("Present")}</th><th>{tx("Late")}</th><th>{tx("Leave")}</th><th>{tx("Absent")}</th></tr></thead>
                  <tbody>
                    {pageRows.map((s) => {
                      const r = rate(s);
                      return (
                        <tr key={s.id}>
                          <td><Link href={`/dashboard/events/${s.id}`} className="lnk"><strong>{s.e.title}</strong></Link></td>
                          <td><span className={`at-type ${(s.e.kind ?? 'event') === 'rehearsal' ? 'r' : 'e'}`}>{(s.e.kind ?? 'event') === 'rehearsal' ? tx("Rehearsal") : tx("Event")}</span></td>
                          <td><Link href="/dashboard/locations" className="at-loc lnk"><MapPin size={15} />{s.city}</Link></td>
                          <td><span className="at-loc"><Calendar size={15} />{formatInZone(s.startMs, s.geos[0]?.tz ?? 'UTC')}</span></td>
                          <td><span className="at-cell ok"><Users size={14} />{dash(`${s.sum.present}/${s.sum.expected}`)}</span></td>
                          <td><span className="at-cell gold"><Clock size={14} />{dash(s.sum.late)}</span></td>
                          <td><span className="at-cell blue">{dash(`${s.sum.leave}/${s.sum.expected}`)}</span></td>
                          <td><span className="at-cell red">{dash(`${s.sum.absent}/${s.sum.expected}`)}</span></td>
                          <td><CxPill tone={r >= 70 ? 'green' : r >= 30 ? 'amber' : 'red'}>{att.loading ? '—' : `${r}%`}</CxPill></td>
                          <td className="at-acts"><button type="button" className="cx-btn sm" title={tx("Members")} onClick={() => { setEventId(s.id); }}><Eye size={15} /></button><Link className="cx-btn sm at-kb" href={`/dashboard/events/${s.id}`} title={tx("Open the event plan")}><MoreVertical size={15} /></Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="cx-pager"><span>{tx("Showing")} {(cur - 1) * PER + 1}–{Math.min(cur * PER, ordered.length)} {tx("of")} {ordered.length} {tx("sessions")}</span>
                <div><button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>‹</button>{Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === cur ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}<button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>›</button></div></div>
            </>
          )}
        </CxCard>
      )}

      {tab === 'group' && (
        <CxCard dark icon={<Users size={22} />} title={tx("Attendance by Group")} sub={tx("Attendance rate and member count, for sessions of a single group.")}>
          {byGroup.length === 0 && <p className="kt-empty">{tx("No group has attendance yet.")}</p>}
          <ul className="at-groups">{byGroup.slice(0, 15).map((g, i) => { const r = pct(g.present, g.expected); return (
            <li key={g.id}><b>{i + 1}</b><CxInitials name={g.name} /><span><strong>{g.name}</strong><small>{g.expected} {tx("expected")}</small></span><CxBar pct={r} tone={r >= 70 ? 'green' : r >= 30 ? 'amber' : 'red'} thick /><em>{r}%</em></li>
          ); })}</ul>
        </CxCard>
      )}

      {tab === 'location' && (
        <CxCard dark icon={<MapPin size={22} />} title={tx("Attendance by location")} sub={tx("Sessions grouped by city.")}>
          {byCity.length === 0 && <p className="kt-empty">{tx("No session yet.")}</p>}
          <ul className="at-groups">{byCity.slice(0, 20).map((c, i) => { const r = pct(c.present, c.expected); return (
            <li key={c.name}><b>{i + 1}</b><span className="at-pin"><MapPin size={18} /></span><span><strong>{c.name}</strong><small>{c.n} {tx("sessions")}</small></span><CxBar pct={r} tone={r >= 70 ? 'green' : r >= 30 ? 'amber' : 'red'} thick /><em>{r}%</em></li>
          ); })}</ul>
        </CxCard>
      )}

      {tab === 'stats' && (
        <CxCard dark icon={<BarChart3 size={22} />} title={tx("Statistics")} sub={tx("Rates for the sessions that match the filters.")}>
          <div className="at-stats">
            <div><b>{rowsX.length}</b><span>{tx("Sessions")}</span></div>
            <div><b>{att.loading ? '—' : total.expected}</b><span>{tx("Members expected")}</span></div>
            <div><b>{att.loading ? '—' : `${overall}%`}</b><span>{tx("Overall rate")}</span></div>
            <div><b>{full}</b><span>{tx("Full attendance")}</span></div>
          </div>
          <CxLine labels={extras.labels} values={extras.values} />
        </CxCard>
      )}

      {tab === 'published' && (
        <CxCard dark icon={<Calendar size={22} />} title={tx("Published Events")} sub={tx("Events that record attendance")}>
          <ul className="at-groups">{rowsX.slice(0, 20).map((r) => (
            <li key={r.id}><span className="at-pin"><Calendar size={18} /></span><span><strong>{r.e.title}</strong><small>{formatInZone(r.startMs, r.geos[0]?.tz ?? 'UTC')} · {r.city}</small></span><CxBar pct={rate(r)} thick /><em>{r.sum.present}/{r.sum.expected}</em></li>
          ))}</ul>
        </CxCard>
      )}

      <div className="cx-grid cx-g32 at-bottom">
        <CxCard dark icon={<Users size={22} />} title={tx("Attendance by Group")} sub={tx("Attendance rate and member count (Top 5)")}>
          {byGroup.length === 0 && <p className="kt-empty">{tx("No group has attendance yet.")}</p>}
          <ul className="at-groups">{byGroup.slice(0, 5).map((g, i) => { const r = pct(g.present, g.expected); return (
            <li key={g.id}><b>{i + 1}</b><CxInitials name={g.name} /><span><strong>{g.name}</strong><small>{g.expected} {tx("expected")}</small></span><CxBar pct={r} tone={r >= 70 ? 'green' : r >= 30 ? 'amber' : 'red'} thick /><em>{r}%</em></li>
          ); })}</ul>
        </CxCard>
        <CxCard icon={<Target size={22} />} title={tx("Key Takeaways")}>
          <div className="at-take ok"><CheckCircle2 size={28} /><span><b>{tx("Full attendance")}</b><small>{full} {tx("sessions recorded full attendance.")}</small></span></div>
          <div className="at-take go"><ArrowUpRight size={28} /><span><b>{tx("Attendance rate")}</b><small>{overall}% {tx("overall")} ({total.present} {tx("of")} {total.expected} {tx("members")}).</small></span></div>
          <div className="at-take bad"><XCircle size={28} /><span><b>{tx("Absences")}</b><small>{pct(total.absent, total.expected)}% ({total.absent} {tx("members")}) – {tx("needs follow-up.")}</small></span></div>
        </CxCard>
      </div>
    </>
  );
}

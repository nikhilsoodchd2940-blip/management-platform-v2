'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { fmt } from '@/lib/liveStats';
import Dropdown from '@/components/Dropdown';
import type { GroupNode } from '@/lib/useGroupHierarchy';
import { bucketsOf, attStats, band, KurelPop, type Period, type EventRow, type AttRow } from './KurelHub';
import { tx } from '@/lib/i18n/tr';

type Level = 'kurel' | 'localzone' | 'city' | 'zone' | 'country';
type SortKey = 'name' | 'members' | 'rehearsals' | 'events' | 'rate' | 'progress' | 'finance' | 'social';
interface Loc { country?: GroupNode; city?: GroupNode }
interface Props {
  kurels: GroupNode[];
  cities: GroupNode[];
  countries: GroupNode[];
  locationOf: (id: string) => Loc;
  rosterOf: (id: string) => string[];
  membersOf: (id: string) => number;
  onOpenKurel: (id: string) => void;
}
interface Agg { key: string; label: string; sub: string; kurels: string[]; members: number; rehearsals: number; events: number; present: number; counted: number; progSum: number; progN: number; finSum: number; finN: number; social: number; filter: { country?: string; zone?: string; city?: string; lz?: string; kurel?: string } }

const pctOf = (sum: number, n: number) => (n ? Math.round(sum / n) : null);

/** One report for every kurel: members, activities, attendance, progress, finance and social news, filtered by country, zone or city and rolled up at the level you choose. */
export default function AllKurels({ kurels, cities, countries, locationOf, rosterOf, membersOf, onOpenKurel }: Props) {
  const zones = useZones();
  const [country, setCountry] = useState('');
  const [zone, setZone] = useState('');
  const [city, setCity] = useState('');
  const [lz, setLz] = useState('');
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<Level>('kurel');
  const [period, setPeriod] = useState<Period>('month');
  const [sort, setSort] = useState<SortKey>('rate');
  const [asc, setAsc] = useState(false);
  const [pop, setPop] = useState('');
  const [limit, setLimit] = useState(30);
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const lzRaw = useCollection<{ name: string; cityId: string }>('localZones', []);
  const events = useCollection<EventRow>('events', []);
  const welfare = useCollection<{ groupId: string; status: string }>('welfareRequests', []);
  const progress = useCollection<{ groupId: string; masteryPct: number; melodyPct: number; timingPct: number; directivesPct: number; submittedAt?: unknown }>('progressReports', []);
  const allocs = useCollection<{ groupId: string; programId: string; amountCents: number }>('programAllocations', []);
  const contribs = useCollection<{ groupId: string; programId: string; amountCents: number; status: string }>('contributions', []);

  const b = useMemo(() => bucketsOf(period, new Date()), [period]);
  const from = b.list[0].start;
  const to = b.list[b.list.length - 1].end;

  const [att, setAtt] = useState<AttRow[] | null>(null);
  useEffect(() => {
    let off = false;
    setAtt(null);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'attendance'), where('serverTimestamp', '>=', Timestamp.fromMillis(from)), where('serverTimestamp', '<', Timestamp.fromMillis(to))));
        if (off) return;
        setAtt(snap.docs.map((d) => { const x = d.data(); return { eventId: x.eventId as string, userId: x.userId as string, status: x.status as string, ms: tsMs(x.serverTimestamp) }; }));
      } catch { if (!off) setAtt([]); }
    })();
    return () => { off = true; };
  }, [from, to]);

  const cityZone = (cityId?: string) => (cityId ? cities.find((c) => c.id === cityId)?.zoneId ?? '' : '');
  const zoneName = (id: string) => (id ? zones?.find((z) => z.id === id)?.name ?? 'Zone' : 'No zone');

  // Everything per kurel, once.
  const perKurel = useMemo(() => {
    const evMap = new Map((events ?? []).map((e) => [e.id, e] as [string, EventRow]));
    const rosters = new Map<string, Set<string>>();
    kurels.forEach((g) => rosters.set(g.id, new Set(rosterOf(g.id))));
    const m = new Map<string, { rehearsals: number; events: number; rows: AttRow[]; social: number; prog: number | null; fin: number | null }>();
    kurels.forEach((g) => m.set(g.id, { rehearsals: 0, events: 0, rows: [], social: 0, prog: null, fin: null }));
    (events ?? []).forEach((e) => {
      const s = tsMs(e.startAt);
      if (e.status === 'cancelled' || s < from || s >= to) return;
      (e.subGroupIds ?? []).forEach((k) => { const x = m.get(k); if (x) { if (e.kind === 'rehearsal') x.rehearsals++; else x.events++; } });
    });
    (att ?? []).forEach((r) => {
      const ev = evMap.get(r.eventId);
      (ev?.subGroupIds ?? []).forEach((k) => { if (rosters.get(k)?.has(r.userId)) m.get(k)?.rows.push(r); });
    });
    (welfare ?? []).forEach((w) => { if (w.status !== 'closed') { const x = m.get(w.groupId); if (x) x.social++; } });
    const lastProg = new Map<string, { ms: number; v: number }>();
    (progress ?? []).forEach((p) => { const ms = tsMs(p.submittedAt); const cur = lastProg.get(p.groupId); if (!cur || ms > cur.ms) lastProg.set(p.groupId, { ms, v: Math.round((p.masteryPct + p.melodyPct + p.timingPct + p.directivesPct) / 4) }); });
    lastProg.forEach((v, k) => { const x = m.get(k); if (x) x.prog = v.v; });
    const paid = new Map<string, number>();
    (contribs ?? []).filter((c) => c.status === 'validated').forEach((c) => paid.set(`${c.groupId}|${c.programId}`, (paid.get(`${c.groupId}|${c.programId}`) ?? 0) + c.amountCents));
    const goals = new Map<string, number[]>();
    (allocs ?? []).forEach((a) => { if (!a.amountCents) return; goals.set(a.groupId, [...(goals.get(a.groupId) ?? []), Math.min(100, Math.round(((paid.get(`${a.groupId}|${a.programId}`) ?? 0) / a.amountCents) * 100))]); });
    goals.forEach((v, k) => { const x = m.get(k); if (x && v.length) x.fin = Math.round(v.reduce((n, y) => n + y, 0) / v.length); });
    return m;
  }, [kurels, events, att, welfare, progress, allocs, contribs, from, to, rosterOf]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return kurels.filter((g) => {
      const l = locationOf(g.id);
      if (country && l.country?.id !== country) return false;
      if (city && l.city?.id !== city) return false;
      if (lz && (g.localZoneId ?? '__none') !== lz) return false;
      if (zone && (zone === '__none' ? cityZone(l.city?.id) !== '' : cityZone(l.city?.id) !== zone)) return false;
      if (t && !`${g.name} ${l.city?.name ?? ''} ${l.country?.name ?? ''}`.toLowerCase().includes(t)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kurels, country, zone, city, lz, q, locationOf, cities]);

  const rows = useMemo(() => {
    const map = new Map<string, Agg>();
    filtered.forEach((g) => {
      const l = locationOf(g.id);
      const zid = cityZone(l.city?.id);
      const spec = level === 'kurel' ? { key: g.id, label: g.name, sub: [l.city?.name, l.country?.name].filter(Boolean).join(' · '), filter: { kurel: g.id } }
        : level === 'city' ? { key: l.city?.id ?? '-', label: l.city?.name ?? tx("No city"), sub: l.country?.name ?? '', filter: { city: l.city?.id, country: l.country?.id } }
        : level === 'localzone' ? { key: `${l.city?.id}|${g.localZoneId ?? ''}`, label: g.localZoneId ? (lzRaw ?? []).find((z) => z.id === g.localZoneId)?.name ?? tx("Local zone") : tx("No local zone"), sub: [l.city?.name, l.country?.name].filter(Boolean).join(' · '), filter: { lz: g.localZoneId ?? '__none', city: l.city?.id, country: l.country?.id } }
        : level === 'zone' ? { key: `${l.country?.id}|${zid}`, label: zoneName(zid), sub: l.country?.name ?? '', filter: { zone: zid || '__none', country: l.country?.id } }
        : { key: l.country?.id ?? '-', label: l.country?.name ?? tx("No country"), sub: '', filter: { country: l.country?.id } };
      const a = map.get(spec.key) ?? { ...spec, kurels: [], members: 0, rehearsals: 0, events: 0, present: 0, counted: 0, progSum: 0, progN: 0, finSum: 0, finN: 0, social: 0 };
      const d = perKurel.get(g.id);
      const s = attStats(d?.rows ?? []);
      a.kurels.push(g.id);
      a.members += membersOf(g.id);
      a.rehearsals += d?.rehearsals ?? 0;
      a.events += d?.events ?? 0;
      a.present += s.present;
      a.counted += s.counted;
      if (d?.prog != null) { a.progSum += d.prog; a.progN++; }
      if (d?.fin != null) { a.finSum += d.fin; a.finN++; }
      a.social += d?.social ?? 0;
      map.set(spec.key, a);
    });
    const val = (a: Agg): number | string => (sort === 'name' ? a.label.toLowerCase() : sort === 'members' ? a.members : sort === 'rehearsals' ? a.rehearsals : sort === 'events' ? a.events : sort === 'rate' ? (a.counted ? a.present / a.counted : -1) : sort === 'progress' ? (a.progN ? a.progSum / a.progN : -1) : sort === 'finance' ? (a.finN ? a.finSum / a.finN : -1) : a.social);
    return [...map.values()].sort((x, y) => { const p = val(x); const r = val(y); const c = typeof p === 'string' ? p.localeCompare(r as string) : (p as number) - (r as number); return asc ? c : -c; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, level, perKurel, sort, asc, zones, cities, lzRaw]);

  const tot = useMemo(() => rows.reduce((t, a) => ({ kurels: t.kurels + a.kurels.length, members: t.members + a.members, rehearsals: t.rehearsals + a.rehearsals, events: t.events + a.events, present: t.present + a.present, counted: t.counted + a.counted, progSum: t.progSum + a.progSum, progN: t.progN + a.progN, finSum: t.finSum + a.finSum, finN: t.finN + a.finN, social: t.social + a.social }), { kurels: 0, members: 0, rehearsals: 0, events: 0, present: 0, counted: 0, progSum: 0, progN: 0, finSum: 0, finN: 0, social: 0 }), [rows]);
  const rate = tot.counted ? Math.round((tot.present / tot.counted) * 100) : null;
  const loading = events === null || att === null || allocs === null;

  const zoneOptions = (zones ?? []).filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }));
  const cityOptions = cities.filter((c) => (!country || c.parentGroupId === country) && (!zone || (zone === '__none' ? !c.zoneId : c.zoneId === zone))).map((c) => ({ value: c.id, label: c.name }));
  const setSortBy = (k: SortKey) => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(k === 'name'); } };
  const drill = (a: Agg) => {
    if (level === 'kurel') { setPop(a.filter.kurel as string); return; }
    setCountry(a.filter.country ?? '');
    setZone(a.filter.zone ?? '');
    setCity(a.filter.city ?? '');
    setLz(a.filter.lz ?? '');
    setLimit(30);
    setLevel(level === 'country' ? 'zone' : level === 'zone' ? 'city' : level === 'city' ? 'localzone' : 'kurel');
  };
  const exportCsv = () => {
    const head = [level === 'kurel' ? 'Kurel' : level === 'localzone' ? 'Local city zone' : level === 'city' ? 'City' : level === 'zone' ? 'Zone' : 'Country', 'Where', 'Kurels', 'Members', 'Rehearsals', 'Events', 'Attendance %', 'Progress %', 'Finance %', 'Open social'];
    const lines = [head, ...rows.map((a) => [a.label, a.sub, String(a.kurels.length), String(a.members), String(a.rehearsals), String(a.events), String(a.counted ? Math.round((a.present / a.counted) * 100) : ''), String(pctOf(a.progSum, a.progN) ?? ''), String(pctOf(a.finSum, a.finN) ?? ''), String(a.social)])];
    const csv = lines.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const el = document.createElement('a');
    el.href = url; el.download = `kurel-report-${b.title.replace(/\s+/g, '-')}.csv`; el.click();
    URL.revokeObjectURL(url);
  };
  const bar = (v: number | null) => (v === null ? <span className="ak-none">—</span> : <span className="ak-pct"><b>{v}%</b><span className={`hb-bar ${band(v)}`}><i style={{ width: `${v}%` }} /></span></span>);
  const filtersOn = !!(country || zone || city || lz || q);
  const kpis: [SortKey, string, string, string, string][] = [
    ['name', 'g', fmt(tot.kurels), 'Kurels', `${fmt(rows.length)} ${level === 'kurel' ? 'rows' : level === 'localzone' ? 'local zones' : level === 'city' ? 'cities' : level === 'zone' ? 'zones' : 'countries'}`],
    ['members', 'b', fmt(tot.members), 'Members', tot.kurels ? `${Math.round(tot.members / tot.kurels)} per kurel` : ''],
    ['rehearsals', 'y', fmt(tot.rehearsals + tot.events), 'Activities', `${fmt(tot.rehearsals)} rehearsals · ${fmt(tot.events)} events`],
    ['rate', 'p', rate === null ? '—' : `${rate}%`, 'Attendance', `${b.title}`],
    ['finance', 't', tot.finN ? `${pctOf(tot.finSum, tot.finN)}%` : '—', 'Finance rating', `${tot.finN} kurel${tot.finN === 1 ? '' : 's'} with a goal`],
    ['social', 'r', fmt(tot.social), 'Open social', 'to follow up'],
  ];

  return (
    <div className="ak">
      <section className="ak-hero">
        <div className="ak-top">
          <div><span className="ak-eyebrow">{tx("Report ·")} {b.title}</span><h2>{tx("All kurels report")}</h2><p>{tx("Every kurel in one view. Narrow it by country, zone or city, and roll it up the way you need.")}</p></div>
          <div className="actions"><button type="button" className="ak-export" onClick={exportCsv} disabled={rows.length === 0}>{tx("Export this report")}</button></div>
        </div>
        <div className="ak-filters">
          <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Kurel, city or country")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setZone(''); setCity(''); setLz(''); }} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
          <Dropdown label={tx("Zone")} value={zone} onChange={(v) => { setZone(v); setCity(''); setLz(''); }} allLabel="All zones" options={[...zoneOptions, { value: '__none', label: tx("No zone yet") }]} />
          <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setLz(''); }} allLabel="All cities" options={cityOptions} />
          <Dropdown label={tx("Local city zone")} value={lz} onChange={setLz} allLabel="All local zones" options={[...(lzRaw ?? []).filter((z) => (!city || z.cityId === city) && cities.some((c) => c.id === z.cityId && (!country || c.parentGroupId === country))).map((z) => ({ value: z.id, label: z.name })), { value: '__none', label: tx("No local zone yet") }]} />
        </div>
        <div className="ak-bar">
          <div className="ak-grp"><span className="ak-lab">{tx("Group by")}</span>
            <div className="hb-seg">{([['country', 'Countries'], ['zone', 'Zones'], ['city', 'Cities'], ['localzone', 'Local city zones'], ['kurel', 'Kurels']] as [Level, string][]).map(([k, l]) => <button type="button" key={k} className={level === k ? 'on' : ''} onClick={() => { setLevel(k); setLimit(30); }}>{l}</button>)}</div></div>
          <div className="ak-grp"><span className="ak-lab">{tx("Period")}</span>
            <div className="hb-seg">{([['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']] as [Period, string][]).map(([k, l]) => <button type="button" key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div></div>
          <div className="ak-grp ak-sortg"><Dropdown label={tx("Sort by")} value={sort} onChange={(v) => setSort(v as SortKey)} options={([['rate', 'Attendance'], ['members', 'Members'], ['rehearsals', 'Rehearsals'], ['events', 'Events'], ['progress', 'Progress'], ['finance', 'Finance rating'], ['social', 'Open social'], ['name', 'Name']] as [SortKey, string][]).map(([value, label]) => ({ value, label }))} />
            <button type="button" className="ak-dir" onClick={() => setAsc(!asc)} title={tx("Reverse the order")}>{asc ? tx("↑ Lowest first") : tx("↓ Highest first")}</button></div>
          {filtersOn && <button type="button" className="hb-clear" onClick={() => { setCountry(''); setZone(''); setCity(''); setLz(''); setQ(''); }}>{tx("Clear filters")}</button>}
        </div>
      </section>

      <div className="ak-kpis">
        {kpis.map(([k, t, v, l, s]) => <button type="button" key={l} className={`${t}${sort === k ? ' on' : ''}`} onClick={() => { setSort(k); setAsc(false); }} title={tx("Sort the table by this")}><b>{v}</b><span>{l}</span><small>{s}</small></button>)}
      </div>

      <section className="ak-results">
        <header className="ak-rh"><h3>{level === 'kurel' ? tx("Kurels") : level === 'localzone' ? tx("Local city zones") : level === 'city' ? tx("Cities") : level === 'zone' ? tx("Zones") : tx("Countries")} <em>{rows.length}</em></h3><div className="hb-seg ak-view"><button type="button" className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}>{tx("Cards")}</button><button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>{tx("Table")}</button></div><span>{tx("Sorted by")} {({ rate: 'attendance', members: 'members', rehearsals: 'rehearsals', events: 'events', progress: 'progress', finance: 'finance rating', social: 'open social', name: 'name' } as Record<SortKey, string>)[sort]} · {level === 'kurel' ? tx("select a kurel to see all its details") : tx("select a card to see what is inside")}</span></header>
        {loading && <p className="hb-empty">{tx("Loading the figures…")}</p>}
        <div className="akc-grid" hidden={view !== 'cards'}>
          {!loading && rows.slice(0, limit).map((a, i) => {
            const att = a.counted ? Math.round((a.present / a.counted) * 100) : null;
            const prog = pctOf(a.progSum, a.progN);
            const fin = pctOf(a.finSum, a.finN);
            const col = att === null ? '#cfd8d3' : att >= 80 ? '#1f9d63' : att >= 50 ? '#d9a21b' : '#d64535';
            return (
              <button type="button" key={a.key} className={`akc ${att === null ? 'na' : att >= 80 ? 'good' : att >= 50 ? 'mid' : 'low'}`} onClick={() => drill(a)} title={level === 'kurel' ? tx("See every detail of this kurel") : tx("Show what is inside")}>
                <span className="akc-top">
                  <i className="akc-rank">{i + 1}</i>
                  <span className="akc-name"><b>{a.label}</b><small>{level === 'kurel' ? a.sub : `${a.kurels.length} kurel${a.kurels.length === 1 ? '' : 's'}${a.sub ? ` · ${a.sub}` : ''}`}</small></span>
                  {a.social > 0 && <em className="ak-soc" title={tx("Open social requests")}>{a.social} {tx("social")}</em>}
                </span>
                <span className="akc-mid">
                  <span className="akc-rw"><span className="akc-ring" style={{ background: `conic-gradient(${col} 0 ${att ?? 0}%, #e4ece8 ${att ?? 0}% 100%)` }}><span><b>{att === null ? '—' : `${att}%`}</b></span></span><small>{tx("Attendance")}</small></span>
                  <span className="akc-stats">
                    <span><b>{fmt(a.members)}</b>{tx("Members")}</span>
                    <span><b>{a.rehearsals}</b>{tx("Rehearsals")}</span>
                    <span><b>{a.events}</b>{tx("Events")}</span>
                  </span>
                </span>
                <span className="akc-bars">
                  <span><small>{tx("Progress")}</small>{prog === null ? <i className="ak-none">{tx("no report")}</i> : <><span className={`hb-bar ${band(prog)}`}><i style={{ width: `${prog}%` }} /></span><b>{prog}%</b></>}</span>
                  <span><small>{tx("Finance")}</small>{fin === null ? <i className="ak-none">{tx("no goal")}</i> : <><span className={`hb-bar ${band(fin)}`}><i style={{ width: `${fin}%` }} /></span><b>{fin}%</b></>}</span>
                </span>
              </button>
            );
          })}
        </div>
        {!loading && view === 'table' && rows.length > 0 && (
          <div className="akt">
            <div className="akt-row akt-head">
              {([['name', level === 'kurel' ? 'Kurel' : level === 'localzone' ? 'Local city zone' : level === 'city' ? 'City' : level === 'zone' ? 'Zone' : 'Country'], ['members', 'Members'], ['rehearsals', 'Rehearsals'], ['events', 'Events'], ['rate', 'Attendance'], ['progress', 'Progress'], ['finance', 'Finance'], ['social', 'Social']] as [SortKey, string][]).map(([k, l], i) => (
                <button type="button" key={k} className={`${i === 0 ? 'l' : i < 4 || i === 7 ? 'c' : 'l'}${sort === k ? ' on' : ''}`} onClick={() => setSortBy(k)}>{l}{sort === k ? (asc ? ' ↑' : ' ↓') : ''}</button>
              ))}
            </div>
            {rows.slice(0, limit).map((a, i) => {
              const att = a.counted ? Math.round((a.present / a.counted) * 100) : null;
              const prog = pctOf(a.progSum, a.progN);
              const fin = pctOf(a.finSum, a.finN);
              const cell = (v: number | null) => (v === null ? <span className="akt-none">—</span> : <span className="akt-bar"><b>{v}%</b><span className={`hb-bar ${band(v)}`}><i style={{ width: `${v}%` }} /></span></span>);
              return (
                <button type="button" key={a.key} className={`akt-row${i % 2 ? ' alt' : ''}`} onClick={() => drill(a)}>
                  <span className="akt-name"><b>{a.label}</b><small>{level === 'kurel' ? a.sub : `${a.kurels.length} kurel${a.kurels.length === 1 ? '' : 's'}${a.sub ? ` · ${a.sub}` : ''}`}</small></span>
                  <span className="akt-n">{fmt(a.members)}</span><span className="akt-n">{a.rehearsals}</span><span className="akt-n">{a.events}</span>
                  {cell(att)}{cell(prog)}{cell(fin)}
                  <span className="akt-n">{a.social ? <em className="ak-soc">{a.social}</em> : <i className="akt-none">0</i>}</span>
                </button>
              );
            })}
          </div>
        )}
        {!loading && rows.length === 0 && <p className="hb-empty">{tx("No kurel matches these filters.")}</p>}
        {!loading && rows.length > limit && <button type="button" className="ak-more" onClick={() => setLimit((n) => n + 30)}>{tx("Show 30 more ·")} {rows.length - limit} {tx("left")}</button>}
        <footer className="ak-foot"><span>{tx("Progress is the latest pedagogy report; finance is the average of each goal reached.")}</span><Link href="/dashboard/reports">{tx("More reports ›")}</Link></footer>
      </section>
      {pop && (() => { const g = kurels.find((x) => x.id === pop); if (!g) return null; const l = locationOf(g.id); return <KurelPop key={pop} id={pop} name={g.name} where={[l.city?.name, l.country?.name].filter(Boolean).join(' · ')} members={membersOf(pop)} rosterIds={rosterOf(pop)} onClose={() => setPop('')} onOpenPage={() => { setPop(''); onOpenKurel(pop); }} />; })()}
    </div>
  );
}

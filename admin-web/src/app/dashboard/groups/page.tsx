'use client';

import '../../px/kurels.css';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { setGroupLevel, setGroupSpecial, updateGroup, setGroupLocalZone, archiveGroup, assignMemberToGroups } from '@/lib/functions';
import { appointOffice } from '@/lib/office';
import { useCollection } from '@/lib/useCollection';
import FormDialog, { type DialogField } from '@/components/FormDialog';
import Dropdown from '@/components/Dropdown';
import { doc } from 'firebase/firestore';
import { fmt } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import Link from 'next/link';
import { useZones } from '@/lib/useZones';
import AllKurels from './AllKurels';
import { HubOverview, HubSection, HUB_TABS, useKurelHub, type HubTab } from './KurelHub';
import CreateKurel from './CreateKurel';
import { CxHead } from '@/components/Cx';
import { ChevronLeft, ChevronRight, Globe2, Layers, Search, Users } from 'lucide-react';
import { tx } from '@/lib/i18n/tr';

interface Counts {
  substitutes: number;
  members: number;
  hosts: number;
  hostIds: string[];
  roster: { userId: string; role: string; substitute: boolean }[];
}

interface Office {
  leaderId?: string;
  pedagogyPresidentId?: string;
  surveillantId?: string;
  choirMasterId?: string;
  socialId?: string;
  administrationId?: string;
  choirDeputyIds?: string[];
  surveillantDeputyId?: string;
  socialDeputyId?: string;
  administrationDeputyId?: string;
  committeeIds?: string[];
}

/** Kurel management — the approved layout on Firebase data. */
const ROLE_NAMES: Record<string, string> = { '1': 'Superviseur', '2': 'Maître de Chœurs', '3': 'Comité Pédagogique', '4': 'Surveillant Général', '5': 'Finance/Social', '6': 'Administration' };
const ROLE_FIELDS: Record<string, string[]> = { '1': ['leaderId'], '2': ['choirMasterId', 'choirDeputyIds'], '3': ['pedagogyPresidentId', 'committeeIds'], '4': ['surveillantId', 'surveillantDeputyId'], '5': ['socialId', 'socialDeputyId'], '6': ['administrationId', 'administrationDeputyId'] };

export default function KurelsPage() {
  const { activeLeafGroups, countries, cities, locationOf, byId } = useGroupHierarchy();
  const { levels, byId: levelById } = useLevels();
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [capacity, setCapacity] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [officeOpen, setOfficeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState<'' | 'existing'>('');
  const [officeFocus, setOfficeFocus] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterTab, setRosterTab] = useState<'perm' | 'sub'>('perm');
  const [editOpen, setEditOpen] = useState(false);
  const [office, setOffice] = useState<Office>({});
  const [teams, setTeams] = useState<Record<string, number>>({});
  const [kind, setKind] = useState('');
  const [dtab, setDtab] = useState<HubTab | 'members' | 'team' | 'settings'>('overview');
  const [createOpen, setCreateOpen] = useState(false);
  const [focus, setFocus] = useState<'' | 'noteam' | 'empty' | 'nolevel'>('');
  const [view, setView] = useState<'kurels' | 'report'>('kurels');
  const [geoOpen, setGeoOpen] = useState<'' | 'country' | 'city'>('');
  const [zone, setZone] = useState('');
  const [level, setLevel] = useState('');
  const [alertKey, setAlertKey] = useState('');
  const [alertQ, setAlertQ] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('kurel');
    if (id) { setSelectedId(id); setSearch(''); setCountry(''); setCity(''); setCapacity(''); setKind(''); setFocus(''); setZone(''); }
    const lv = qs.get('level');
    if (lv) { setLevel(lv); setSelectedId(''); window.setTimeout(() => document.getElementById('kurel-directory')?.scrollIntoView({ behavior: 'smooth' }), 300); }
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'groupMemberships'), where('status', '==', 'active')), (snap) => {
      const next: Record<string, Counts> = {};
      snap.docs.forEach((d) => {
        const x = d.data();
        const c = (next[x.groupId as string] ??= { substitutes: 0, members: 0, hosts: 0, hostIds: [], roster: [] });
        c.roster.push({ userId: x.userId as string, role: String(x.role ?? 'member'), substitute: x.substitute === true });
        if (x.role === 'host') {
          c.hosts++;
          c.hostIds.push(x.userId as string);
        } else if (x.substitute === true) c.substitutes++;
        else c.members++;
      });
      setCounts(next);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, 'kurelRoles'), (snap) => {
      const next: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as Office;
        next[d.id] = [x.leaderId, x.choirMasterId, x.pedagogyPresidentId, x.surveillantId, x.socialId, x.administrationId].filter(Boolean).length;
      });
      setTeams(next);
    });
  }, []);
  const teamFilled = (id: string) => teams[id] ?? 0;

  const total = (id: string) => (counts[id]?.members ?? 0) + (counts[id]?.hosts ?? 0);
  const capState = (g: { id: string; capacity?: number }) => {
    if (g.capacity === undefined) return 'none';
    const n = total(g.id);
    return n >= g.capacity ? 'full' : n >= g.capacity * 0.9 ? 'warning' : 'normal';
  };

  const rows = useMemo(
    () =>
      activeLeafGroups
        .filter((g) => {
          const loc = locationOf(g.id);
          const term = search.trim().toLowerCase();
          if (term && !`${g.name} ${loc.city?.name ?? ''} ${loc.country?.name ?? ''}`.toLowerCase().includes(term)) return false;
          if (country && loc.country?.id !== country) return false;
          if (city && loc.city?.id !== city) return false;
          if (zone && (loc.city?.zoneId ?? '') !== zone) return false;
          if (level && (level === '__none__' ? !!g.levelId : g.levelId !== level)) return false;
          if (capacity && capState(g) !== capacity) return false;
          if (focus === 'noteam' && teamFilled(g.id) >= 6) return false;
          if (focus === 'empty' && total(g.id) !== 0) return false;
          if (focus === 'nolevel' && g.levelId) return false;
          if (kind === 'special' && !g.special) return false;
          if (kind === 'regular' && g.special) return false;
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeLeafGroups, search, country, zone, city, level, capacity, kind, focus, counts, teams, locationOf]
  );
  // The chosen kurel stays chosen while the list is filtered, so the banner never jumps to another one.
  const DIR_N = 5;
  const [dirQ, setDirQ] = useState('');
  const [dirSort, setDirSort] = useState<'az' | 'za' | 'members' | 'fullest'>('az');
  const [dirPage, setDirPage] = useState(1);
  const dirRows = useMemo(() => {
    const t = dirQ.trim().toLowerCase();
    const list = rows.filter((g) => !t || `${g.name} ${locationOf(g.id).city?.name ?? ''} ${locationOf(g.id).country?.name ?? ''}`.toLowerCase().includes(t));
    const ratio = (g: (typeof rows)[number]) => (g.capacity ? total(g.id) / (g.capacity as number) : -1);
    return [...list].sort((a, b) => dirSort === 'za' ? b.name.localeCompare(a.name) : dirSort === 'members' ? total(b.id) - total(a.id) || a.name.localeCompare(b.name) : dirSort === 'fullest' ? ratio(b) - ratio(a) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dirQ, dirSort, counts, locationOf]);
  const dirPages = Math.max(1, Math.ceil(dirRows.length / DIR_N));
  const dirPageC = Math.min(dirPage, dirPages);
  const dirPageRows = dirRows.slice((dirPageC - 1) * DIR_N, dirPageC * DIR_N);
  const pageList = (cur: number, n: number) => (n <= 6 ? Array.from({ length: n }, (_, i) => i + 1) : [...new Set([1, 2, 3, cur - 1, cur, cur + 1, n].filter((x) => x >= 1 && x <= n))].sort((a, b) => a - b).reduce<number[]>((acc, x) => { if (acc.length && x - acc[acc.length - 1] > 1) acc.push(0); acc.push(x); return acc; }, []));

  const selected = activeLeafGroups.find((g) => g.id === selectedId) ?? dirRows[0];
  const zones = useZones();
  const selLoc = selected ? locationOf(selected.id) : {};
  const selCounts = selected ? counts[selected.id] : undefined;
  const selId = selected?.id;
  const rosterIds = useMemo(() => (selCounts?.roster ?? []).map((r) => r.userId), [selCounts]);
  const rosterProfiles = useUserProfiles(rosterIds);
  const hub = useKurelHub(selected?.id ?? '__none__', rosterIds);
  const openTab = (t: HubTab | 'team' | 'members') => { setDtab(t); document.getElementById('kurel-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  useEffect(() => {
    setOffice({});
    if (!selId) return;
    return onSnapshot(doc(db, 'kurelRoles', selId), (snap) => setOffice((snap.data() as Office | undefined) ?? {}));
  }, [selId]);
  const cityZones = useCollection<{ name: string; active?: boolean }>('localZones', [where('cityId', '==', selected?.parentGroupId || '__none__')], editOpen ? selected?.parentGroupId || '' : '');
  const teamArea = selected ? { country: selLoc.country?.id, city: selLoc.city?.id, kurel: selected.id } : undefined;
  const officeIds = useMemo(() => [office.leaderId, office.pedagogyPresidentId, office.surveillantId, office.choirMasterId, office.socialId, office.administrationId, office.surveillantDeputyId, office.socialDeputyId, office.administrationDeputyId, ...(office.choirDeputyIds ?? []), ...(office.committeeIds ?? [])].filter(Boolean) as string[], [office]);
  const officeProfiles = useUserProfiles(officeIds);
  const nameOf = (id?: string) => (id ? officeProfiles[id]?.name || '…' : '—');
  const selTeam = selected ? teamFilled(selected.id) : 0;

  const byCountry = useMemo(
    () =>
      countries
        .map((c) => ({ c, n: activeLeafGroups.filter((g) => locationOf(g.id).country?.id === c.id).length }))
        .sort((a, b) => b.n - a.n),
    [countries, activeLeafGroups, locationOf]
  );
  const maxCount = byCountry[0]?.n ?? 0;
  const topShare = activeLeafGroups.length ? Math.round(((byCountry[0]?.n ?? 0) / activeLeafGroups.length) * 100) : 0;

  const full = activeLeafGroups.filter((g) => capState(g) === 'full').length;
  const noHost = activeLeafGroups.filter((g) => teamFilled(g.id) < 6).length;
  const empty = activeLeafGroups.filter((g) => total(g.id) === 0).length;
  const noLevel = activeLeafGroups.filter((g) => !g.levelId).length;
  const alertCount = [full, noHost, empty, noLevel].filter((n) => n > 0).length;
  const totalMembers = activeLeafGroups.reduce((a, g) => a + (counts[g.id]?.members ?? 0), 0);
  const cityStats = useMemo(() => {
    const m = new Map<string, { id: string; name: string; countryId: string; n: number; members: number }>();
    for (const g of activeLeafGroups) { const l = locationOf(g.id); if (!l.city) continue; const e = m.get(l.city.id) ?? { id: l.city.id, name: l.city.name, countryId: l.country?.id ?? '', n: 0, members: 0 }; e.n += 1; e.members += counts[g.id]?.members ?? 0; m.set(l.city.id, e); }
    return Array.from(m.values()).sort((a, b) => b.n - a.n);
  }, [activeLeafGroups, locationOf, counts]);
  const membersByCountry = (id: string) => activeLeafGroups.reduce((a, g) => a + (locationOf(g.id).country?.id === id ? counts[g.id]?.members ?? 0 : 0), 0);
  const DONUT = ['#1f9d63', '#d9a521', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6'];
  const donut = (() => { let acc = 0; const tot = activeLeafGroups.length || 1; const parts = byCountry.filter((x) => x.n > 0).map((x, i) => { const from = acc; acc += (x.n / tot) * 100; return `${DONUT[i % DONUT.length]} ${from}% ${acc}%`; }); return parts.length ? `conic-gradient(${parts.join(',')})` : '#e5ece8'; })();
  const clearAll = () => { setSearch(''); setCountry(''); setZone(''); setCity(''); setCapacity(''); setKind(''); setFocus(''); };
  const pick = (id: string) => { setView('kurels'); setSelectedId(id); setDtab('overview'); };
  const toDirectory = () => window.setTimeout(() => document.getElementById('kurel-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  const rosterOf = (id: string) => (counts[id]?.roster ?? []).map((r) => r.userId);
  const showOnly = (f: '' | 'noteam' | 'empty' | 'nolevel', cap = '') => { setSearch(''); setKind(''); setFocus(f); setCapacity(cap); setView('kurels'); toDirectory(); };
  const alertList = [
    { key: 'full', tone: 'red', n: full, title: `${full} kurel${full > 1 ? 's' : ''} at maximum capacity`, text: 'No place is left for a new member. Raise the capacity or move members.', ids: activeLeafGroups.filter((g) => capState(g) === 'full'), act: () => showOnly('', 'full'), label: tx("Show these kurels") },
    { key: 'team', tone: 'amber', n: noHost, title: `${noHost} kurel${noHost > 1 ? 's' : ''} with an incomplete management team`, text: 'Fewer than the six roles are appointed. Open the kurel and press Appoint the team.', ids: activeLeafGroups.filter((g) => teamFilled(g.id) < 6), act: () => showOnly('noteam'), label: tx("Show these kurels") },
    { key: 'empty', tone: 'blue', n: empty, title: `${empty} empty kurel${empty > 1 ? 's' : ''}`, text: 'No member is assigned yet. Add members from the kurel page.', ids: activeLeafGroups.filter((g) => total(g.id) === 0), act: () => showOnly('empty'), label: tx("Show these kurels") },
    { key: 'level', tone: 'amber', n: noLevel, title: `${noLevel} kurel${noLevel > 1 ? 's' : ''} without a level`, text: 'Members of these kurels cannot access items restricted by level.', ids: activeLeafGroups.filter((g) => !g.levelId), act: () => showOnly('nolevel'), label: tx("Show these kurels") },
  ].filter((a) => a.n > 0);

  function exportStatus() {
    const lines = [['Kurel', 'City', 'Country', 'Level', 'Members', 'Team roles filled (of 6)', 'Special', 'Capacity'], ...rows.map((g) => {
      const loc = locationOf(g.id);
      return [g.name, loc.city?.name ?? '', loc.country?.name ?? '', g.levelId ? levelById[g.levelId]?.name ?? '' : '', String(counts[g.id]?.members ?? 0), String(teamFilled(g.id)), g.special ? 'Yes' : 'No', g.capacity !== undefined ? String(g.capacity) : ''];
    })];
    const csv = lines.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kurels.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function changeLevel(groupId: string, levelId: string) {
    if (!levelId) return;
    try {
      await setGroupLevel({ groupId, levelId });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not change the level', 'error');
    }
  }

  const PALETTES: [string, string][] = [['#0b6a43', '#1b8a5a'], ['#1f5fb0', '#3a82d6'], ['#6a3bb8', '#8f5fe0'], ['#b2315a', '#d9567f'], ['#0b7f86', '#25a8af'], ['#9a7208', '#c9a227']];
  const palette = (name: string) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [a, b] = PALETTES[h % PALETTES.length];
    return { ['--k1' as string]: a, ['--k2' as string]: b };
  };
  const code = (name: string) => {
    const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const skip = new Set(['kurel', 'de', 'du', 'la', 'le']);
    const main = words.filter((w) => !skip.has(w.toLowerCase()));
    const w = main.length ? main : words;
    if (w.length === 0) return '?';
    return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
  };
  const selTotal = selected ? total(selected.id) : 0;
  const stateLabel = (s: string) => (s === 'full' ? 'At capacity' : s === 'warning' ? 'Nearly full' : s === 'normal' ? 'Available' : 'No limit');

  return (
    <>
      <div className="px px-kurels">
        <div className="content">
          <CxHead icon={<Layers size={26} />} title={tx("Group Management")} sub={`${tx("Capacities, assignments, management teams and operations of the")} ${fmt(activeLeafGroups.length)} ${tx("groups.")}`}>
            <div className="hb-seg kv-switch" role="tablist"><button type="button" role="tab" aria-selected={view === 'kurels'} className={view === 'kurels' ? 'on' : ''} onClick={() => setView('kurels')}>{tx("Groups")}</button><button type="button" role="tab" aria-selected={view === 'report'} className={view === 'report' ? 'on' : ''} onClick={() => setView('report')}>{tx("All groups report")}</button></div>
            <button type="button" className="cx-btn" onClick={exportStatus}>{tx("Export the status")}</button>
            <button type="button" className="cx-btn green" onClick={() => setCreateOpen(true)}>{tx("Create a group")}</button>
          </CxHead>


          {view === 'report' && (
            <AllKurels kurels={activeLeafGroups} cities={cities} countries={countries} locationOf={locationOf} rosterOf={rosterOf} membersOf={total} onOpenKurel={(id) => { pick(id); toDirectory(); }} />
          )}

          {view === 'kurels' && (
          <>
          <section className="card command">
            <div className="command-head">
              <div>
                <h2><Globe2 size={22} /> {tx("Live worldwide view")}</h2>
                <p>{tx("Select a figure to see what is behind it.")}</p>
              </div>
            </div>
            <div className="stats">
              <button type="button" className="stat" onClick={() => { clearAll(); toDirectory(); }}><span>{tx("Groups")}</span><strong>{fmt(activeLeafGroups.length)}</strong><small>{tx("Show all of them ›")}</small></button>
              <button type="button" className="stat" onClick={() => setGeoOpen('country')}><span>{tx("Countries")}</span><strong>{fmt(countries.length)}</strong><small>{tx("Filter by country ›")}</small></button>
              <button type="button" className="stat" onClick={() => setGeoOpen('city')}><span>{tx("Cities")}</span><strong>{fmt(cities.length)}</strong><small>{tx("Filter by city ›")}</small></button>
              <Link href="/dashboard/members" className="stat"><span>{tx("Members")}</span><strong>{fmt(totalMembers)}</strong><small>{activeLeafGroups.length ? Math.round(totalMembers / activeLeafGroups.length) : 0} {tx("per kurel · open the list ›")}</small></Link>
              <button type="button" className={`stat${full ? ' warn' : ''}`} disabled={!full} onClick={() => { setAlertQ(''); setAlertKey('full'); }}><span>{tx("At capacity")}</span><strong>{fmt(full)}</strong><small>{full ? tx("See which ›") : tx("None")}</small></button>
              <button type="button" className={`stat${noLevel ? ' warn' : ''}`} disabled={!noLevel} onClick={() => { setAlertQ(''); setAlertKey('level'); }}><span>{tx("Without a level")}</span><strong>{fmt(noLevel)}</strong><small>{noLevel ? tx("See which ›") : tx("None")}</small></button>
            </div>
          </section>


          <section className="card filters">
            <input type="search" placeholder={tx("Search a group, city or country…")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Dropdown label={tx("Types")} value={kind} onChange={setKind} allLabel="All kurels" options={[{ value: 'special', label: tx("★ Special kurels") }, { value: 'regular', label: tx("Regular kurels") }]} />
            <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setZone(''); setCity(''); }} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("Zone")} value={zone} onChange={(v) => { setZone(v); setCity(''); }} allLabel="All zones" options={(zones ?? []).filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }))} />
            <Dropdown label={tx("City")} value={city} onChange={setCity} allLabel="All cities" options={cities.filter((c) => (!country || c.parentGroupId === country) && (!zone || c.zoneId === zone)).map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("Level")} value={level} onChange={setLevel} allLabel="All levels" options={[...levels.map((l) => ({ value: l.id, label: l.name })), { value: '__none__', label: tx("No level") }]} />
            <Dropdown label={tx("Capacity")} value={capacity} onChange={setCapacity} allLabel="All capacities" options={[{ value: 'normal', label: tx("Available") }, { value: 'warning', label: tx("Nearly full") }, { value: 'full', label: tx("At capacity") }]} />
          </section>

          {(focus || capacity) && <div className="kt-focus"><span>{tx("Showing only:")} <b>{focus === 'noteam' ? tx("kurels with an incomplete team") : focus === 'empty' ? tx("empty kurels") : focus === 'nolevel' ? tx("kurels without a level") : tx("kurels at capacity")}</b></span><button type="button" onClick={() => { setFocus(''); setCapacity(''); }}>{tx("Show all kurels")}</button></div>}
          <div className="workspace">
            <section className="card panel" id="kurel-directory">
              <div className="panel-head">
                <div><h2>{tx("Group Directory")}</h2><p>{rows.length} {tx("of")} {activeLeafGroups.length} {tx("groups · select one to open it")}</p></div>
              </div>
              <div className="gd-chips">
                {([['', tx("All groups"), activeLeafGroups.length, ''], ['full', tx("At capacity"), full, 'red'], ['normal', tx("Available"), activeLeafGroups.filter((g) => capState(g) === 'normal').length, 'green'], ['warning', tx("Nearly full"), activeLeafGroups.filter((g) => capState(g) === 'warning').length, 'amber']] as const).map(([k, l, n, tone]) => (
                  <button type="button" key={k} className={`${tone}${capacity === k ? ' on' : ''}`} onClick={() => setCapacity(k)}>{l} ({n})</button>
                ))}
              </div>
              <div className="gd2-tools">
                <label className="gd2-s"><Search size={16} aria-hidden /><input type="search" placeholder={tx("Search a group…")} value={dirQ} onChange={(e) => { setDirQ(e.target.value); setDirPage(1); }} aria-label={tx("Search")} /></label>
                <Dropdown label={tx("Sort")} value={dirSort} onChange={(v) => { setDirSort((v || 'az') as typeof dirSort); setDirPage(1); }} allLabel={tx("Name (A–Z)")} options={[{ value: 'za', label: tx("Name (Z–A)") }, { value: 'members', label: tx("Most members") }, { value: 'fullest', label: tx("Fullest first") }]} className="gd2-dd" />
              </div>
              <div className="gd2-h"><span>{tx("Group")}</span><span>{tx("Members")}</span><span>{tx("Structure")}</span><span>{tx("Status")}</span><span /></div>
              <div className="kurel-scroll"><div className="kurel-list">
                {dirPageRows.map((g) => {
                  const loc = locationOf(g.id);
                  const st = capState(g);
                  return (
                    <button type="button" key={g.id} className={`kurel-row gd2r${selected?.id === g.id ? ' active' : ''}`} onClick={() => setSelectedId(g.id)}>
                      <span className="gd2-g"><span className="kurel-code" style={palette(g.name)}>{code(g.name)}</span>
                      <span className="gd2-n"><strong>{g.name}{g.special && <span className="star" title={tx("Special group")}> ★</span>}</strong><small>{[loc.city?.name, loc.country?.name].filter(Boolean).join(' • ')}</small></span></span>
                      <span className="gd2-m"><Users size={16} aria-hidden /><b>{total(g.id)}</b></span>
                      <span className="gd2-st2"><Layers size={16} aria-hidden />{counts[g.id]?.substitutes ?? 0} {tx("sub")} • {teamFilled(g.id)}/6</span>
                      <span className={`gd-st ${st}`}>{stateLabel(st)}</span><span className="gd-go" aria-hidden><ChevronRight size={18} /></span>
                    </button>
                  );
                })}
                {rows.length === 0 && <div className="empty" style={{ display: 'block' }}>{tx("No group matches the criteria.")}</div>}
              </div>
              </div>
              <div className="gd2-pg"><span>{dirRows.length ? (dirPageC - 1) * DIR_N + 1 : 0}–{Math.min(dirPageC * DIR_N, dirRows.length)} {tx("of")} {dirRows.length} {tx("groups")}</span>
                {dirPages > 1 && <nav aria-label={tx("Pages")}>
                  <button type="button" aria-label={tx("Previous")} disabled={dirPageC <= 1} onClick={() => setDirPage(dirPageC - 1)}><ChevronLeft size={16} /></button>
                  {pageList(dirPageC, dirPages).map((n, i) => n === 0 ? <i key={`g${i}`}>…</i> : <button type="button" key={n} className={n === dirPageC ? 'on' : ''} onClick={() => setDirPage(n)}>{n}</button>)}
                  <button type="button" aria-label={tx("Next")} disabled={dirPageC >= dirPages} onClick={() => setDirPage(dirPageC + 1)}><ChevronRight size={16} /></button>
                </nav>}
              </div>
            </section>

            <article className="card detail" id="kurel-detail">
              {selected ? (
                <>
                  <div className="detail-hero kd-slim">
                    <span className="kd-ico" style={palette(selected.name)}>{code(selected.name)}</span>
                    <div className="detail-title kd-title">
                      <h2>{selected.name}{selected.special && <span className="star" title={tx("Special kurel")}> ★</span>}</h2>
                      <div className="kd-eyebrow"><i className="kd-lv">{levelById[selected.levelId ?? ''] ? levelById[selected.levelId as string].name : tx("No level")}</i><i className="kd-kind">{selected.special ? tx("★ Special kurel") : tx("Kurel")}</i><span className="kd-hint">{[selLoc.city?.name, selLoc.country?.name].filter(Boolean).join(' · ')}</span></div>
                    </div>
                    <div className="actions">
                      {selected.capacity !== undefined && (
                        <div className={`kd-cap ${capState(selected)}`} title={stateLabel(capState(selected))}>
                          <span className="kd-seats"><b>{selTotal}</b><b className="of">/ {selected.capacity}</b><small>{tx("seats")}</small></span>
                          <u><s style={{ width: `${Math.min(100, Math.round((selTotal / Math.max(1, selected.capacity)) * 100))}%` }} /></u>
                          <em>{stateLabel(capState(selected))}</em>
                        </div>
                      )}
                      <button type="button" className="secondary" onClick={() => setEditOpen(true)}>{tx("Edit the record")}</button>
                    </div>
                  </div>
                  <div className="detail-body">
                    <div className="dt-tabs" role="tablist">
                      {([['overview', 'Overview'], ['members', `Members (${selTotal + (selCounts?.substitutes ?? 0)})`], ['team', `Team (${selTeam}/6)`], ...HUB_TABS.filter(([k]) => k !== 'overview'), ['settings', 'Settings']] as [string, string][]).map(([k, l]) => <button type="button" role="tab" aria-selected={dtab === k} key={k} className={dtab === k ? 'on' : ''} onClick={() => setDtab(k as typeof dtab)}>{l}</button>)}
                    </div>
                    {dtab === 'overview' && <div className="dt-pane"><HubOverview hub={hub} open={(t) => setDtab(t)} kurelId={selected.id} kurelName={selected.name} /></div>}
                    {dtab !== 'overview' && dtab !== 'members' && dtab !== 'team' && dtab !== 'settings' && <div className="dt-pane"><HubSection tab={dtab} hub={hub} /></div>}
                    {dtab === 'members' && (<div className="dt-pane">
                    <div className="section-title"><h3>{tx("Members of this kurel")}</h3><div className="actions"><button type="button" className="primary" onClick={() => setAddOpen('existing')}>{tx("Add a member")}</button></div></div>
                    <div className="roster">
                      {(selCounts?.roster ?? []).length > 6 && <input type="search" className="roster-search" placeholder={tx("Search in this kurel")} value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} />}
                      {(selCounts?.roster ?? []).length === 0 && <div className="roster-empty">{tx("No member yet. Use “Add a member” to place someone in this kurel.")}</div>}
                      {(() => {
                        const all = [...(selCounts?.roster ?? [])]
                          .filter((r) => !rosterSearch.trim() || (rosterProfiles[r.userId]?.name ?? '').toLowerCase().includes(rosterSearch.trim().toLowerCase()))
                          .sort((x, y) => (x.role === 'host' ? 0 : 1) - (y.role === 'host' ? 0 : 1) || (rosterProfiles[x.userId]?.name ?? '').localeCompare(rosterProfiles[y.userId]?.name ?? ''));
                        const row = (r: (typeof all)[number]) => (
                          <div className="roster-row" key={r.userId}>
                            <PersonLink userId={r.userId} kurelId={selected.id}><span className="roster-who"><Avatar name={rosterProfiles[r.userId]?.name || '…'} photoUrl={rosterProfiles[r.userId]?.photoUrl} size={30} /><b>{rosterProfiles[r.userId]?.name || '…'}</b></span></PersonLink>
                            {r.role === 'host' && <span className="status gold">{tx("Host")}</span>}
                          </div>
                        );
                        const perm = all.filter((r) => !r.substitute || r.role === 'host');
                        const sub = all.filter((r) => r.substitute && r.role !== 'host');
                        return (
                          <div className="rs-tabs">
                            <div className="rs-sw" role="tablist">
                              <button type="button" role="tab" aria-selected={rosterTab === 'perm'} className={`perm${rosterTab === 'perm' ? ' on' : ''}`} onClick={() => setRosterTab('perm')}><b>{perm.length}</b><span>{tx("Permanent members")}</span></button>
                              <button type="button" role="tab" aria-selected={rosterTab === 'sub'} className={`sub${rosterTab === 'sub' ? ' on' : ''}`} onClick={() => setRosterTab('sub')}><b>{sub.length}</b><span>{tx("Substitute members")}</span></button>
                            </div>
                            <section className={`rs ${rosterTab}`}>
                              <h4><span>{rosterTab === 'perm' ? tx("Permanent members") : tx("Substitute members")}</span><em>{(rosterTab === 'perm' ? perm : sub).length}</em></h4>
                              <div className="roster-list">{(rosterTab === 'perm' ? perm : sub).map(row)}{(rosterTab === 'perm' ? perm : sub).length === 0 && <p className="rs-none">{rosterTab === 'perm' ? tx("No permanent member yet.") : tx("No substitute yet.")}</p>}</div>
                            </section>
                          </div>
                        );
                      })()}
                    </div>
                    </div>)}
                    {dtab === 'team' && (<div className="dt-pane">
                    <div className="section-title"><h3>{tx("Kurel management team")}</h3><button type="button" className="secondary" onClick={() => { setOfficeFocus(''); setOfficeOpen(true); }}>{tx("Appoint the whole team")}</button></div>
                    <div className="kt-grid">
                      {([
                        ['1', 'Superviseur', office.leaderId, 'Validates operations', []],
                        ['2', 'Maître de Chœurs', office.choirMasterId, 'Deputies', office.choirDeputyIds ?? []],
                        ['3', 'Comité Pédagogique', office.pedagogyPresidentId, 'President, with up to 8 members in all', (office.committeeIds ?? []).filter((i) => i !== office.pedagogyPresidentId)],
                        ['4', 'Surveillant Général', office.surveillantId, 'Discipline and attendance', office.surveillantDeputyId ? [office.surveillantDeputyId] : []],
                        ['5', 'Finance/Social', office.socialId, 'Collections and support', office.socialDeputyId ? [office.socialDeputyId] : []],
                        ['6', 'Administration', office.administrationId, 'Administration of the kurel', office.administrationDeputyId ? [office.administrationDeputyId] : []],
                      ] as [string, string, string | undefined, string, string[]][]).map(([n, role, id, what, others]) => (
                        <article className={`kt-card${id ? '' : ' vacant'}`} key={n}>
                          <header>
                            {id ? <Avatar name={nameOf(id)} photoUrl={officeProfiles[id]?.photoUrl} size={44} /> : <span className="kt-ph" aria-hidden>{n}</span>}
                            <div><b>{id ? <PersonLink userId={id}>{nameOf(id)}</PersonLink> : tx("Not appointed yet")}</b><small>{n} · {role}</small></div>
                            <span className={`kt-st ${id ? 'ok' : 'no'}`}>{id ? tx("Appointed") : tx("Vacant")}</span>
                          </header>
                          <div className="kt-box"><small>{tx("Role")}</small><span>{what}</span></div>
                          {(() => { const have = n === '3' ? others.length + (id ? 1 : 0) : others.length; const max = n === '2' ? 2 : n === '3' ? 8 : 1; return (
                            <div className="kt-box kt-count2"><small>{n === '2' ? tx("Deputies") : n === '3' ? tx("Committee members") : tx("Second member")}</small><b className={have >= max ? 'full' : have === 0 ? 'none' : ''}>{have}/{max}</b></div>
                          ); })()}
                          <footer><button type="button" className="kt-btn wide" onClick={() => { setOfficeFocus(n); setOfficeOpen(true); }}>{id ? tx("View / Change") : tx("Appoint")}</button></footer>
                        </article>
                      ))}
                    </div>
                    </div>)}
                    {dtab === 'settings' && (<div className="dt-pane">
                    <div className={`lv${selected.levelId ? '' : ' none'}`}>
                      <div className="lv-h"><div><small>{tx("Academic level")}</small><strong>{selected.levelId ? levelById[selected.levelId]?.name ?? '—' : tx("No level assigned")}</strong></div><span className={`kt-st ${selected.levelId ? 'ok' : 'no'}`}>{selected.levelId ? tx("Assigned") : tx("To assign")}</span></div>
                      <p>{tx("The books, materials and equipment this kurel can use depend on its level. Pick another one to change it, access updates at once.")}</p>
                      <div className="lv-pills" role="radiogroup" aria-label={tx("Academic level")}>
                        {levels.map((l) => <button type="button" role="radio" aria-checked={selected.levelId === l.id} key={l.id} className={selected.levelId === l.id ? 'on' : ''} onClick={() => selected.levelId !== l.id && changeLevel(selected.id, l.id)}>{l.name}</button>)}
                      </div>
                    </div>
                    <div className="operations">
                      <div className="operation"><span>{tx("Substitutes")}</span><strong>{selCounts?.substitutes ?? 0} / 5</strong><small>{tx("Seats beyond the regular headcount")}</small></div>
                    </div>
                    <div className="delegation">
                      <div><strong>{tx("Special kurel")}</strong><br /><span>{tx("A special kurel depends directly on the national direction; members must belong to a local kurel with good attendance.")}</span></div>
                      <button type="button" className="secondary" onClick={() => setGroupSpecial({ groupId: selected.id, special: !selected.special }).then(() => notify(selected.special ? 'Kurel is now a regular kurel' : 'Kurel marked as special', 'success')).catch((e: Error) => notify(e.message, 'error'))}>{selected.special ? tx("Make it a regular kurel") : tx("Mark as special")}</button>
                    </div>
                    </div>)}
                  </div>
                </>
              ) : (
                <div className="detail-body"><p>{tx("No kurel to show.")}</p></div>
              )}
            </article>
          </div>

          <div className="overview">
            <section className="card distribution">
              <div className="panel-head">
                <div><h2>{tx("Geographic distribution")}</h2><p>{tx("Where the kurels and their members are.")}</p></div>
                <span className="status">{activeLeafGroups.length} {tx("active")}</span>
              </div>
              <div className="gd-main">
                <div className="donut" style={{ background: donut }}>
                  <div className="donut-label"><strong>{topShare}%</strong><span>{byCountry[0]?.c.name ?? '—'}</span></div>
                </div>
                <div className="gd-list">
                  {byCountry.length === 0 && <p className="fx3-note">{tx("No country yet.")}</p>}
                  {byCountry.map(({ c, n }, i) => (
                    <button type="button" key={c.id} className={`gd-row${country === c.id ? ' on' : ''}`} onClick={() => { setCountry(country === c.id ? '' : c.id); setCity(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} title={tx("Show only the kurels of this country")}>
                      <i style={{ background: DONUT[i % DONUT.length] }} />
                      <span className="gd-n"><b>{c.name}</b><small>{n} {tx("kurel")}{n === 1 ? '' : 's'} · {fmt(membersByCountry(c.id))} {tx("members")}</small></span>
                      <span className="gd-bar"><u style={{ width: `${maxCount ? Math.round((n / maxCount) * 100) : 0}%`, background: DONUT[i % DONUT.length] }} /></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="gd-cities">
                <small>{tx("Biggest cities")}</small>
                <div>{cityStats.slice(0, 6).map((c) => <button type="button" key={c.id} onClick={() => { setCountry(c.countryId); setCity(c.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><b>{c.name}</b><span>{c.n} {tx("kurel")}{c.n === 1 ? '' : 's'} · {fmt(c.members)}</span></button>)}{cityStats.length === 0 && <span className="fx3-note">{tx("No city yet.")}</span>}</div>
              </div>
            </section>
            <section className="card alerts">
              <div className="panel-head">
                <div><h2>{tx("Operational alerts")}</h2><p>{tx("Points needing action, with the kurels concerned.")}</p></div>
                <span className={`status${alertCount ? ' red' : ''}`}>{alertCount} {tx("open")}</span>
              </div>
              <div className="al-list">
                {alertList.length === 0 && <div className="al ok"><b>{tx("No alert")}</b><span>{tx("Every kurel has a full team, members, a level and room left.")}</span></div>}
                {alertList.map((a) => (
                  <div className={`al ${a.tone}`} key={a.key}>
                    <div className="al-h"><b>{a.title}</b><em>{a.n}</em></div>
                    <span>{a.text}</span>
                    <div className="al-chips">{a.ids.slice(0, 60).map((g) => <button type="button" key={g.id} title={g.name} onClick={() => pick(g.id)}>{g.name}</button>)}{a.ids.length > 60 && <i>+{a.ids.length - 60} {tx("more")}</i>}</div>
                    <div className="al-act"><button type="button" onClick={() => { setAlertQ(''); setAlertKey(a.key); }}>{a.label}</button>{a.ids[0] && <button type="button" onClick={() => pick(a.ids[0].id)}>{tx("Open the first one")}</button>}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="card rule-board">
            <div className="rule"><b>{tx("Capacity")}</b><span>{tx("35 regular members by default (adjustable), plus up to 5 substitutes — enforced by the server.")}</span></div>
            <div className="rule"><b>{tx("Multiple kurels")}</b><span>{tx("A member may belong to at most 3 kurels, and only a senior administrator can assign a second one.")}</span></div>
            <div className="rule"><b>{tx("Single attachment")}</b><span>{tx("A kurel belongs to one city and one country.")}</span></div>
          </section>
          </>
          )}
        </div>
      </div>

      {editOpen && selected && (
        <FormDialog
          title={`Edit the kurel — ${selected.name}`}
          intro="Change the name, the capacity, the academic level or the local city zone of this kurel. To change its management team, use Appoint the team."
          submitLabel={tx("Save the changes")}
          onClose={() => setEditOpen(false)}
          fields={[
            { name: 'name', label: tx("Kurel name"), type: 'text', required: true, initial: selected.name },
            { name: 'capacity', label: tx("Capacity (leave empty for no limit)"), type: 'number', min: 1, initial: selected.capacity !== undefined ? String(selected.capacity) : '' },
            { name: 'levelId', label: tx("Academic level"), type: 'select', initial: selected.levelId ?? '', options: levels.map((l) => ({ value: l.id, label: l.name })) },
            { name: 'localZoneId', label: tx("Local city zone"), type: 'select', initial: selected.localZoneId ?? '', placeholder: tx("No local zone"), options: (cityZones ?? []).filter((z) => z.active !== false).map((z) => ({ value: z.id, label: z.name })) },
          ]}
          onSubmit={async (v) => {
            await updateGroup({ groupId: selected.id, name: v.name.trim(), capacity: v.capacity.trim() === '' ? null : Number(v.capacity) });
            if ((v.levelId || '') !== (selected.levelId ?? '') && v.levelId) await setGroupLevel({ groupId: selected.id, levelId: v.levelId });
            if ((v.localZoneId || '') !== (selected.localZoneId ?? '')) await setGroupLocalZone({ groupId: selected.id, localZoneId: v.localZoneId || '' });
            notify('Kurel updated', 'success');
            setEditOpen(false);
          }}
        >
          <button type="button" className="fx-btn" style={{ color: '#a02820', borderColor: '#e3a39d' }} onClick={() => { if (confirm(`Archive ${selected.name}? It disappears from every list.`)) archiveGroup({ groupId: selected.id }).then(() => { notify('Kurel archived', 'success'); setEditOpen(false); }).catch((e: Error) => notify(e.message, 'error')); }}>{tx("Archive this kurel")}</button>
        </FormDialog>
      )}
      {officeOpen && selected && (
        <FormDialog
          title={officeFocus ? `${ROLE_NAMES[officeFocus]} — ${selected.name}` : `Kurel management team — ${selected.name}`}
          intro="Choose the members of this kurel (or search the whole organisation by name; someone who is not yet in this kurel is added to it). One member can hold only one of the six roles: a person already chosen is greyed out in the other lists. Limits: Superviseur 1; Maître de Chœurs 1 and up to 2 deputies; Surveillant Général, Finance/Social and Administration 1 each with 1 optional second member; the pedagogical committee has at most 8 members (no minimum) and always includes its president. Only senior administrators can appoint."
          submitLabel={tx("Save the team")}
          onClose={() => setOfficeOpen(false)}
          fields={([
            { name: 'leaderId', exclusive: 'office', label: tx("1. Superviseur"), type: 'member', area: teamArea, initial: office.leaderId ?? '' },
            { name: 'choirMasterId', exclusive: 'office', label: tx("2. Maître de Chœurs"), type: 'member', area: teamArea, initial: office.choirMasterId ?? '' },
            { name: 'pedagogyPresidentId', exclusive: 'office', label: tx("3. Comité Pédagogique: president"), type: 'member', area: teamArea, initial: office.pedagogyPresidentId ?? '' },
            { name: 'surveillantId', exclusive: 'office', label: tx("4. Surveillant Général"), type: 'member', area: teamArea, initial: office.surveillantId ?? '' },
            { name: 'socialId', exclusive: 'office', label: tx("5. Finance/Social"), type: 'member', area: teamArea, initial: office.socialId ?? '' },
            { name: 'administrationId', exclusive: 'office', label: tx("6. Administration"), type: 'member', area: teamArea, initial: office.administrationId ?? '' },
            { name: 'surveillantDeputyId', exclusive: 'office', label: tx("4. Surveillant Général: second member (optional)"), type: 'member', area: teamArea, initial: office.surveillantDeputyId ?? '' },
            { name: 'socialDeputyId', exclusive: 'office', label: tx("5. Finance/Social: second member (optional)"), type: 'member', area: teamArea, initial: office.socialDeputyId ?? '' },
            { name: 'administrationDeputyId', exclusive: 'office', label: tx("6. Administration: second member (optional)"), type: 'member', area: teamArea, initial: office.administrationDeputyId ?? '' },
            { name: 'choirDeputyIds', exclusive: 'office', label: tx("Maître de Chœurs: deputies (max 2)"), type: 'members', area: teamArea, initial: (office.choirDeputyIds ?? []).join(',') },
            { name: 'committeeIds', exclusive: 'office', label: tx("Comité Pédagogique: other members (the president is added automatically, at most 8 in all)"), type: 'members', area: teamArea, initial: (office.committeeIds ?? []).filter((i) => i !== office.pedagogyPresidentId).join(',') },
          ] as DialogField[]).filter((f) => !officeFocus || ROLE_FIELDS[officeFocus].includes(f.name))}
          onSubmit={(vv) => {
            const base: Record<string, string> = { leaderId: office.leaderId ?? '', choirMasterId: office.choirMasterId ?? '', pedagogyPresidentId: office.pedagogyPresidentId ?? '', surveillantId: office.surveillantId ?? '', socialId: office.socialId ?? '', administrationId: office.administrationId ?? '', surveillantDeputyId: office.surveillantDeputyId ?? '', socialDeputyId: office.socialDeputyId ?? '', administrationDeputyId: office.administrationDeputyId ?? '', choirDeputyIds: (office.choirDeputyIds ?? []).join(','), committeeIds: (office.committeeIds ?? []).filter((i) => i !== office.pedagogyPresidentId).join(',') };
            const v = { ...base, ...vv };
            const seen = new Map<string, string>();
            for (const k of Object.keys(base)) for (const id of String(v[k] ?? '').split(',').filter(Boolean)) {
              if (seen.has(id) && seen.get(id) !== k) throw new Error(`${nameOf(id)} already holds another role in this team. One member can hold only one role.`);
              seen.set(id, k);
            }
            const deputies = v.choirDeputyIds ? v.choirDeputyIds.split(',').filter(Boolean) : [];
            const others = (v.committeeIds ? v.committeeIds.split(',').filter(Boolean) : []).filter((x) => x !== v.pedagogyPresidentId);
            const committee = others.length + (v.pedagogyPresidentId ? 1 : 0);
            if (deputies.length > 2) throw new Error(`The Maître de Chœurs can have at most 2 deputies (you chose ${deputies.length}).`);
            if (committee > 8) throw new Error(`The Comité Pédagogique can have at most 8 members including its president (you chose ${committee}). Remove ${committee - 8}.`);
            for (const [label, main, second] of [['Surveillant Général', v.surveillantId, v.surveillantDeputyId], ['Finance/Social', v.socialId, v.socialDeputyId], ['Administration', v.administrationId, v.administrationDeputyId]]) if (second && !main) throw new Error(`${label}: choose the main member before the second member.`);
            return appointOffice(selected.id, { surveillantDeputyId: v.surveillantDeputyId, socialDeputyId: v.socialDeputyId, administrationDeputyId: v.administrationDeputyId, leaderId: v.leaderId, pedagogyPresidentId: v.pedagogyPresidentId, surveillantId: v.surveillantId, choirMasterId: v.choirMasterId, socialId: v.socialId, administrationId: v.administrationId, choirDeputyIds: v.choirDeputyIds ? v.choirDeputyIds.split(',') : [], committeeIds: v.committeeIds ? v.committeeIds.split(',') : [] }).then(() => notify('Team saved', 'success'));
          }}
        />
      )}
      {addOpen === 'existing' && selected && (
        <FormDialog
          title={`Add a member to ${selected.name}`}
          intro="Search the whole organisation by name and choose the person to place in this kurel. Capacity and the three-kurel limit are checked by the server."
          submitLabel={tx("Add to this kurel")}
          onClose={() => setAddOpen('')}
          fields={[{ name: 'userId', label: tx("Member"), type: 'member', required: true, area: teamArea, initial: '' }]}
          onSubmit={async (v) => {
            await assignMemberToGroups({ userId: v.userId, groupIds: [selected.id], strict: true });
            notify('Member added to the kurel', 'success');
            setAddOpen('');
          }}
        />
      )}
      {createOpen && <CreateKurel onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); setSelectedId(id); setDtab('overview'); }} />}
      {geoOpen && typeof document !== 'undefined' && createPortal(
        <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && setGeoOpen('')}>
          <div className="fm" role="dialog" aria-modal="true" aria-label={geoOpen === 'country' ? tx("Countries") : tx("Cities")}>
            <header><div><h2>{geoOpen === 'country' ? tx("Countries") : tx("Cities")}</h2><p>{tx("Select one to list only its kurels.")}</p></div><button type="button" aria-label={tx("Close")} onClick={() => setGeoOpen('')}>×</button></header>
            <div className="fm-body">
              <ul className="al-pop">
                {(geoOpen === 'country'
                  ? byCountry.map(({ c, n }) => ({ id: c.id, name: c.name, sub: `${fmt(membersByCountry(c.id))} members`, n, countryId: c.id, cityId: '' }))
                  : cityStats.map((c) => ({ id: c.id, name: c.name, sub: `${byId[c.countryId]?.name ?? ''} · ${fmt(c.members)} members`, n: c.n, countryId: c.countryId, cityId: c.id }))
                ).map((x) => (
                  <li key={x.id}><button type="button" onClick={() => { clearAll(); setCountry(x.countryId); setCity(x.cityId); setGeoOpen(''); toDirectory(); }}>
                    <span><b>{x.name}</b><small>{x.sub}</small></span>
                    <span className="al-pop-n"><em>{x.n} {tx("kurel")}{x.n === 1 ? '' : 's'}</em></span>
                  </button></li>
                ))}
              </ul>
            </div>
            <footer><span className="fm-err" style={{ color: '#4a5c53' }}>{geoOpen === 'country' ? byCountry.length : cityStats.length} {tx("listed")}</span><button type="button" className="fm-go" onClick={() => setGeoOpen('')}>{tx("Close")}</button></footer>
          </div>
        </div>,
        document.body
      )}
      {(() => {
        const a = alertList.find((x) => x.key === alertKey);
        if (!a || typeof document === 'undefined') return null;
        const t = alertQ.trim().toLowerCase();
        const rows = a.ids.filter((g) => !t || `${g.name} ${locationOf(g.id).city?.name ?? ''} ${locationOf(g.id).country?.name ?? ''}`.toLowerCase().includes(t));
        return createPortal(
          <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && setAlertKey('')}>
            <div className="fm" role="dialog" aria-modal="true" aria-label={a.title}>
              <header><div><h2>{a.title}</h2><p>{a.text}</p></div><button type="button" aria-label={tx("Close")} onClick={() => setAlertKey('')}>×</button></header>
              <div className="fm-body">
                <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Kurel or city")} value={alertQ} onChange={(e) => setAlertQ(e.target.value)} /></label>
                <ul className="al-pop">
                  {rows.map((g) => { const l = locationOf(g.id); return (
                    <li key={g.id}><button type="button" onClick={() => { setAlertKey(''); pick(g.id); }}>
                      <span><b>{g.name}</b><small>{[l.city?.name, l.country?.name].filter(Boolean).join(', ') || '—'}</small></span>
                      <span className="al-pop-n"><em>{fmt(total(g.id))} {tx("members")}</em><em>{tx("Team")} {teamFilled(g.id)}/6</em></span>
                    </button></li>
                  ); })}
                  {rows.length === 0 && <li className="al-pop-none">{tx("No kurel matches.")}</li>}
                </ul>
              </div>
              <footer><span className="fm-err" style={{ color: '#4a5c53' }}>{rows.length} {tx("kurel")}{rows.length === 1 ? '' : 's'}</span><button type="button" className="fm-go" onClick={() => setAlertKey('')}>{tx("Close")}</button></footer>
            </div>
          </div>,
          document.body
        );
      })()}
    </>
  );
}

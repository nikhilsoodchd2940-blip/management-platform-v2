'use client';

import '../px/index.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, limit as fsLimit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { listBookSuggestions } from '@/lib/functions';
import { loadListInbox } from '@/lib/listInbox';
import { AttendanceDesk, DisciplinaryDesk, FinanceDesk, LocalZonesDesk, LogisticsDesk, OtherSections, RehearsalsDesk, WelfareDesk } from './DeskBlocks';
import { fmt, useCount } from '@/lib/liveStats';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import EventDesk from './EventDesk';
import CommandHero from '@/components/CommandHero';
import Dropdown from '@/components/Dropdown';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink, ViewProfile } from '@/components/MemberProfile';
import { tx } from '@/lib/i18n/tr';
import { CountryName } from '@/components/CountryFlag';
import { Check, ChevronRight, ClipboardList, Users, Globe2, BookOpen, Layers, UserPlus, CalendarCheck, Phone, Gavel, Hourglass, Inbox } from 'lucide-react';

interface EventRow {
  id: string;
  title: string;
  status: string;
  startMs: number;
  endMs: number;
  kind?: string;
  groupCount: number;
  recurring: boolean;
}


const FIVE_MIN = 5 * 60 * 1000;

export default function DashboardPage() {
  const router = useRouter();
  const { countries, cities, activeLeafGroups, locationOf } = useGroupHierarchy();

  // ---- queues that wait for a decision (server-side counts) ----
  const registered = useCount('users', [['registrationStatus', '==', 'approved']]);
  const pendingRegistrations = useCount('users', [['registrationStatus', '==', 'pending_approval']]);
  const [since, setSince] = useState(() => Date.now() - FIVE_MIN);
  useEffect(() => {
    const h = window.setInterval(() => setSince(Date.now() - FIVE_MIN), 60000);
    return () => window.clearInterval(h);
  }, []);
  const online = useCount('presence', [['lastActiveAt', '>=', Timestamp.fromMillis(since)]], 60000);
  const phoneRequests = useCount('phoneUpdateRequests', [['status', '==', 'pending']]);
  const eventRequests = useCount('eventRequests', [['status', '==', 'pending']]);
  const absenceRequests = useCount('absenceRequests', [['status', '==', 'pending']]);
  const openCases = useCount('disciplinaryCases', [['status', 'in', ['open', 'hearing_requested', 'vote_required', 'escalated']]]);
  // Counted the way the Events page lists them: only groups that still exist.
  const submittedBooks = useCollection<{ groupId: string }>('performanceSelections', [where('status', '==', 'submitted')]);
  const [listsWaiting, setListsWaiting] = useState<number | null | 'error'>(null);
  const [suggestionsWaiting, setSuggestionsWaiting] = useState<number | null>(null);
  const loadQueues = useCallback(() => {
    loadListInbox().then((r) => setListsWaiting(r.items.length)).catch(() => setListsWaiting('error'));
    listBookSuggestions({}).then((r) => setSuggestionsWaiting(r.data.canReview ? r.data.suggestions.filter((x) => x.status === 'pending').length : null)).catch(() => setSuggestionsWaiting(null));
  }, []);
  useEffect(() => { loadQueues(); const h = window.setInterval(loadQueues, 30000); return () => window.clearInterval(h); }, [loadQueues]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, []);

  // ---- group membership counts (capacity) ----
  const [headcount, setHeadcount] = useState<Record<string, number>>({});
  const [memberGroups, setMemberGroups] = useState<Record<string, string[]>>({});
  useEffect(() => {
    return onSnapshot(collection(db, 'groupMemberships'), (snap) => {
      const next: Record<string, number> = {};
      const per: Record<string, string[]> = {};
      snap.docs.forEach((d) => {
        if (d.data().status !== 'active') return;
        const gid = d.data().groupId as string;
        const uid = d.data().userId as string;
        next[gid] = (next[gid] ?? 0) + 1;
        if (uid) (per[uid] ??= []).includes(gid) || per[uid].push(gid);
      });
      setHeadcount(next);
      setMemberGroups(per);
    });
  }, []);
  const [cTab, setCTab] = useState<'country' | 'group' | 'multi'>('country');
  const [mgQ, setMgQ] = useState('');
  const [mgLimit, setMgLimit] = useState(20);

  // ---- events ----
  const [events, setEvents] = useState<EventRow[]>([]);
  useEffect(() => {
    return onSnapshot(query(collection(db, 'events'), orderBy('startAt', 'desc'), fsLimit(200)), (snap) => {
      setEvents(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            title: (x.title as string) ?? '',
            status: (x.status as string) ?? '',
            startMs: (x.startAt as Timestamp)?.toMillis?.() ?? 0,
            endMs: (x.endAt as Timestamp)?.toMillis?.() ?? 0,
            kind: ((x.subGroupIds as string[]) ?? []).length > 1 ? 'main_group' : 'group',
            groupCount: ((x.subGroupIds as string[]) ?? []).length,
            recurring: !!x.seriesId,
          };
        })
      );
    });
  }, []);

  const eventStats = useMemo(() => {
    const live = events.filter((e) => e.status === 'published');
    return {
      ongoing: live.filter((e) => e.startMs <= now && e.endMs >= now).length,
      upcoming: live.filter((e) => e.startMs > now).length,
      today: live.filter((e) => new Date(e.startMs).toDateString() === new Date(now).toDateString()).length,
      drafts: events.filter((e) => e.status === 'draft').length,
    };
  }, [events, now]);

  // ---- kurels: how full they are, and where the members are ----
  const kurels = useMemo(() => {
    const rows = activeLeafGroups.map((g) => ({ id: g.id, name: g.name, n: headcount[g.id] ?? 0, cap: g.capacity as number | undefined, levelId: g.levelId, country: locationOf(g.id).country?.name ?? 'Other' }));
    const state = (r: (typeof rows)[number]) => (r.cap === undefined ? 'none' : r.n >= r.cap ? 'full' : r.n >= r.cap * 0.9 ? 'warning' : 'normal');
    const count = { normal: 0, warning: 0, full: 0, none: 0 };
    rows.forEach((r) => { count[state(r)]++; });
    const ratio = (r: (typeof rows)[number]) => (r.cap ? r.n / r.cap : -1);
    const fullest = [...rows].sort((a, b) => ratio(b) - ratio(a) || b.n - a.n || a.name.localeCompare(b.name));
    const byCountry = new Map<string, { members: number; kurels: number }>();
    const leaf = new Map(rows.map((r) => [r.id, r.country]));
    const seen = new Map<string, Set<string>>();
    const everyone = new Set<string>();
    Object.entries(memberGroups).forEach(([uid, gs]) => gs.forEach((g) => { const ct = leaf.get(g); if (!ct) return; everyone.add(uid); (seen.get(ct) ?? seen.set(ct, new Set()).get(ct)!).add(uid); }));
    rows.forEach((r) => { const c = byCountry.get(r.country) ?? { members: 0, kurels: 0 }; c.members = seen.get(r.country)?.size ?? 0; c.kurels += 1; byCountry.set(r.country, c); });
    countries.forEach((c) => { if (!byCountry.has(c.name)) byCountry.set(c.name, { members: 0, kurels: 0 }); });
    const countryRows = Array.from(byCountry.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.members - a.members || b.kurels - a.kurels || a.name.localeCompare(b.name));
    return { total: rows.length, members: everyone.size, memberships: rows.reduce((n, r) => n + r.n, 0), noLevel: rows.filter((r) => !r.levelId).length, empty: rows.filter((r) => r.n === 0).length, count, fullest, countryRows };
  }, [activeLeafGroups, headcount, memberGroups, locationOf, countries]);
  const groupName = useMemo(() => Object.fromEntries(activeLeafGroups.map((g) => [g.id, g.name])) as Record<string, string>, [activeLeafGroups]);
  const multi = useMemo(() => Object.entries(memberGroups)
    .map(([id, gs]) => {
      const groups = gs.filter((g) => groupName[g]);
      const where = groups.map((g) => locationOf(g));
      return { id, groups, countries: [...new Set(where.map((w) => w.country?.name ?? 'Other'))], cities: [...new Set(where.map((w) => w.city?.name).filter(Boolean) as string[])] };
    })
    .filter((m) => m.groups.length >= 2)
    .sort((a, b) => b.countries.length - a.countries.length || b.groups.length - a.groups.length), [memberGroups, groupName, locationOf]);
  const [mgMode, setMgMode] = useState<'people' | 'pairs'>('people');
  const [mgKurel, setMgKurel] = useState('');
  const [mgCountry, setMgCountry] = useState('');
  const [mgTab, setMgTab] = useState<'all' | 'two' | 'three' | 'cross'>('all');
  const [mgPair, setMgPair] = useState<[string, string] | null>(null);
  const multiProfiles = useUserProfiles(multi.slice(0, 300).map((m) => m.id));
  const multiShown = useMemo(() => {
    const t = mgQ.trim().toLowerCase();
    return multi.filter((m) =>
      (!mgKurel || m.groups.includes(mgKurel)) && (!mgCountry || m.countries.includes(mgCountry)) && (mgTab === 'all' || (mgTab === 'two' ? m.groups.length === 2 : mgTab === 'three' ? m.groups.length >= 3 : m.countries.length > 1))
      && (!mgPair || (m.groups.includes(mgPair[0]) && m.groups.includes(mgPair[1])))
      && (!t || (multiProfiles[m.id]?.name ?? '').toLowerCase().includes(t) || m.groups.some((g) => (groupName[g] ?? '').toLowerCase().includes(t))));
  }, [multi, mgQ, mgKurel, mgCountry, mgTab, mgPair, multiProfiles, groupName]);
  const pairs = useMemo(() => {
    const c = new Map<string, number>();
    multi.forEach((m) => { const g = [...m.groups].sort(); for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) c.set(`${g[i]}|${g[j]}`, (c.get(`${g[i]}|${g[j]}`) ?? 0) + 1); });
    return [...c.entries()].map(([k, n]) => ({ a: k.split('|')[0], b: k.split('|')[1], n })).sort((x, y) => y.n - x.n);
  }, [multi]);
  const [pairN, setPairN] = useState(8);
  const multiKurels = useMemo(() => [...new Set(multi.flatMap((m) => m.groups))].map((g) => ({ value: g, label: groupName[g] })).sort((x, y) => x.label.localeCompare(y.label)), [multi, groupName]);
  const multiCountries = useMemo(() => [...new Set(multi.flatMap((m) => m.countries))].sort().map((c) => ({ value: c, label: c })), [multi]);
  const crossN = multi.filter((m) => m.countries.length > 1).length;
  const twoN = multi.filter((m) => m.groups.length === 2).length;
  const threeN = multi.filter((m) => m.groups.length >= 3).length;
  const mgFiltered = !!(mgKurel || mgCountry || mgPair || mgQ);
  const mgReset = () => { setMgKurel(''); setMgCountry(''); setMgPair(null); setMgQ(''); setMgLimit(20); };
  const cityCount = useMemo(() => countries.reduce((n, c) => n + cities.filter((x) => x.parentGroupId === c.id).length, 0), [countries, cities]);

  const dash = (n: number | null) => fmt(n);
  const liveIds = new Set(activeLeafGroups.map((g) => g.id));
  const booksToApprove = submittedBooks === null ? null : submittedBooks.filter((r) => liveIds.has(r.groupId)).length;
  const queue: { label: string; hint: string; n: number | null | 'error'; href: string; icon: React.ReactNode; soft?: boolean }[] = [
    { label: tx("Member List Approvals"), hint: tx("Submitted by group managers"), n: listsWaiting, href: '/dashboard/events#member-lists', icon: <Users size={22} /> },
    { label: tx("Performance Books Approvals"), hint: tx("Selected by the groups"), n: booksToApprove, href: '/dashboard/events#book-approvals', icon: <BookOpen size={22} /> },
    { label: tx("Suggested Books Approvals"), hint: tx("Not yet in the event books"), n: suggestionsWaiting, href: '/dashboard/events#book-suggestions', icon: <Layers size={22} /> },
    { label: tx("Registration Approvals"), hint: tx("New membership requests"), n: pendingRegistrations, href: '/dashboard/approvals#registrations', icon: <UserPlus size={22} /> },
    { label: tx("Event & Absence Requests"), hint: tx("Awaiting your response"), n: eventRequests === null && absenceRequests === null ? null : (eventRequests ?? 0) + (absenceRequests ?? 0), href: '/dashboard/requests#all-requests', icon: <CalendarCheck size={22} /> },
    { label: tx("Phone Number Updates"), hint: tx("Members changing their number"), n: phoneRequests, href: '/dashboard/approvals#phone-changes', icon: <Phone size={22} />, soft: true },
    { label: tx("Open Disciplinary Cases"), hint: tx("Not closed yet"), n: openCases, href: '/dashboard/disciplinary#cases', icon: <Gavel size={22} />, soft: true },
  ];
  const toDo = queue.reduce((n, q) => n + (typeof q.n === 'number' ? q.n : 0), 0);
  const pct = (n: number, d: number) => (d ? Math.max(2, Math.round((n / d) * 100)) : 0);
  const seg = (n: number) => `${kurels.total ? (n / kurels.total) * 100 : 0}%`;

  return (
    <div className="px px-index">
      <section className="view active" id="dashboard">
        <CommandHero title={tx("Global command center")} subtitle={tx("Executive view of the Conservatory’s operations, members and events.")} />

        <div className="dx-kpis">
          <button type="button" className="dx-kpi g" onClick={() => router.push('/dashboard/members?kurels=any')}><small>{tx("Members in kurels")}</small><b>{fmt(kurels.members)}</b><span>{`${fmt(kurels.memberships)} memberships in ${fmt(kurels.total)} kurels`}</span></button>
          <button type="button" className="dx-kpi y" onClick={() => router.push('/dashboard/groups')}><small>{tx("Active kurels")}</small><b>{fmt(kurels.total)}</b><span>{fmt(cityCount)} {tx("cities ·")} {countries.length} {countries.length === 1 ? tx("country") : tx("countries")}</span></button>
          <button type="button" className="dx-kpi b" onClick={() => router.push('/dashboard/events')}><small>{tx("Events today")}</small><b>{fmt(eventStats.today)}</b><span>{fmt(eventStats.ongoing)} {tx("in progress ·")} {fmt(eventStats.upcoming)} {tx("coming")}</span></button>
          <button type="button" className="dx-kpi p" onClick={() => router.push('/dashboard/members?online=1')}><small>{tx("Online now")}</small><b>{dash(online)}</b><span><i className="dx-dot" /> {tx("Live presence")}</span></button>
        </div>

        <div className={`dx-grid${cTab === 'multi' ? ' dx-tall' : ''}`}>
          <section className="card dx-card">
            <header><i className="dx-hi"><ClipboardList size={26} /></i><div><h2>{tx("Action Items")}</h2><p>{toDo > 0 ? `${toDo} item${toDo === 1 ? '' : 's'} waiting for your response` : tx("Everything is answered")}</p></div><span className={`dx-badge${toDo > 0 ? ' hot' : ''}`}>{toDo}</span></header>
            <ul className="dx-queue">
              {queue.map((q) => (
                <li key={q.label}>
                  <button type="button" className={`${typeof q.n === 'number' && q.n > 0 ? 'on' : q.n === 'error' ? 'err' : ''}${q.soft ? ' soft' : ''}`} onClick={() => router.push(q.href)}>
                    <i className="dx-qi" aria-hidden>{q.icon}</i>
                    <span><b>{q.label}</b><small>{q.hint}</small></span>
                    <em title={q.n === 'error' ? tx("Could not be loaded. Open the page to see why.") : undefined}>{q.n === null ? '…' : q.n === 'error' ? '!' : q.n > 0 ? q.n : <Check size={18} strokeWidth={3} />}</em>
                    {typeof q.n === 'number' && q.n > 0 && <ChevronRight size={18} className="dx-qg" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card dx-card">
            <header><i className="dx-hi"><Users size={26} /></i><div><h2>{tx("Groups")}</h2><p>{tx("All")} {kurels.total} {tx("groups, fullest first")}</p></div><button type="button" className="dx-more" onClick={() => router.push('/dashboard/groups')}>{tx("Open →")}</button></header>
            <div className="dx-stack" aria-hidden>
              <i className="ok" style={{ width: seg(kurels.count.normal) }} /><i className="warn" style={{ width: seg(kurels.count.warning) }} /><i className="full" style={{ width: seg(kurels.count.full) }} /><i className="none" style={{ width: seg(kurels.count.none) }} />
            </div>
            <div className="dx-legend">
              <span className="ok"><Users size={20} /><b>{kurels.count.normal}</b> {tx("Available")}</span><span className="warn"><Hourglass size={20} /><b>{kurels.count.warning}</b> {tx("Nearly Full")}</span><span className="full"><Users size={20} /><b>{kurels.count.full}</b> {tx("At Capacity")}</span><span className="none"><Layers size={20} /><b>{kurels.count.none}</b> {tx("No Limit")}</span>
            </div>
            <ul className="dx-bars">
              {kurels.fullest.map((k) => (
                <li key={k.id} className="dx-click" role="link" tabIndex={0} onClick={() => router.push('/dashboard/groups')}><span title={k.name}>{k.name}</span><u><s className={k.cap === undefined ? 'none' : k.n >= k.cap ? 'full' : k.n >= k.cap * 0.9 ? 'warn' : 'ok'} style={{ width: `${k.cap === undefined ? (k.n ? 100 : 0) : k.n ? pct(k.n, k.cap) : 0}%` }} /></u><em>{k.cap === undefined ? k.n : `${k.n}/${k.cap}`}<ChevronRight size={16} aria-hidden /></em></li>
              ))}
              {kurels.fullest.length === 0 && <li className="dx-none">{tx("No kurel yet.")}</li>}
            </ul>
            <footer><span><Layers size={18} /><b>{kurels.noLevel}</b> {tx("without a level")}</span><span><Inbox size={18} /><b>{kurels.empty}</b> {tx("empty")}</span></footer>
          </section>

          <section className="card dx-card dx-ct">
            <header><i className="dx-hi"><Globe2 size={26} /></i><div><h2>{cTab === 'multi' ? tx("Members in several groups") : tx("Members by Country")}</h2><p>{cTab !== 'multi' ? `All ${kurels.countryRows.length} countries, most members first` : `${multi.length} different member${multi.length === 1 ? ' is' : 's are'} in two or more kurels. Each is counted once.`}</p></div><button type="button" className="dx-more" onClick={() => { const cid = countries.find((c) => c.name === mgCountry)?.id; const q = new URLSearchParams(); if (cTab === 'multi') { q.set('kurels', mgTab === 'two' ? '2' : mgTab === 'three' ? '3' : mgTab === 'cross' ? 'cross' : 'multi'); if (mgPair) { q.set('kurel', mgPair[0]); q.set('also', mgPair[1]); } else if (mgKurel) q.set('kurel', mgKurel); if (cid) q.set('country', cid); } router.push(`/dashboard/members${q.toString() ? `?${q}` : ''}`); }}>{cTab === 'multi' ? tx("Open the list →") : tx("Open →")}</button></header>
            <div className="dx-tabs" role="tablist" aria-label={tx("View")}>
              <button type="button" role="tab" aria-selected={cTab === 'country'} className={cTab === 'country' ? 'on' : ''} onClick={() => setCTab('country')}><Users size={16} />{tx("By Country")}</button>
              <button type="button" role="tab" aria-selected={cTab === 'group'} className={cTab === 'group' ? 'on' : ''} onClick={() => setCTab('group')}><Users size={16} />{tx("By Group")}<em>{kurels.total}</em></button>
              <button type="button" role="tab" aria-selected={cTab === 'multi'} className={cTab === 'multi' ? 'on' : ''} onClick={() => setCTab('multi')}>{tx("In several groups")}<em>{multi.length}</em></button>
            </div>
            {cTab === 'group' ? (
              <ul className="dx-bars">
                {[...kurels.fullest].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((g) => (
                  <li key={g.id} className="dx-click" role="link" tabIndex={0} onClick={() => router.push('/dashboard/groups')}><span className="dx-cn">{g.name}<small>{g.country}</small></span><u><s className="ok" style={{ width: `${g.n ? pct(g.n, kurels.fullest.reduce((m, x) => Math.max(m, x.n), 1)) : 0}%` }} /></u><em>{g.n}</em></li>
                ))}
                {kurels.fullest.length === 0 && <li className="dx-none">{tx("No data yet.")}</li>}
              </ul>
            ) : cTab === 'country' ? (
              <>
                <ul className="dx-bars">
                  {kurels.countryRows.map((c) => (
                    <li key={c.name} className="dx-click" role="link" tabIndex={0} title={`Open the members of ${c.name}`} onClick={() => { const id = countries.find((x) => x.name === c.name)?.id; router.push(id ? `/dashboard/members?country=${id}` : '/dashboard/members'); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}><span className="dx-cn"><CountryName name={c.name} size={30} /><small>{c.kurels} {tx("group")}{c.kurels === 1 ? '' : 's'}</small></span><u><s className="ok" style={{ width: `${c.members ? pct(c.members, kurels.countryRows[0]?.members || 1) : 0}%` }} /></u><em>{c.members}</em></li>
                  ))}
                  {kurels.countryRows.length === 0 && <li className="dx-none">{tx("No data yet.")}</li>}
                </ul>
                <footer><span><Users size={20} /><b>{fmt(kurels.members)}</b> {tx("members")}</span><span><Globe2 size={20} /><b>{countries.length}</b> {countries.length === 1 ? tx("country") : tx("countries")}</span></footer>
              </>
            ) : (
              <div className="dx-mbody">
                <div className="dx-mtabs" role="tablist" aria-label={tx("Members in several groups")}>
                  {([['all', multi.length, 'In several groups', 'Every member with 2 or 3 kurels'], ['two', twoN, 'In 2 groups', 'Exactly two kurels'], ['three', threeN, 'In 3 groups', 'Three kurels'], ['cross', crossN, 'Across countries', 'Kurels in different countries']] as const).map(([k, n, l, d]) => (
                    <button key={k} type="button" role="tab" aria-selected={mgTab === k && mgMode === 'people'} className={`${mgTab === k && mgMode === 'people' ? 'on ' : ''}${k === 'cross' ? 'gold' : ''}`} title={d} onClick={() => { setMgTab(k); setMgMode('people'); setMgLimit(20); }}><b>{n}</b><span>{l}</span></button>
                  ))}
                </div>
                <p className="dx-sum"><b>{fmt(kurels.members)}</b> {tx("members =")} <b>{fmt(Math.max(0, kurels.members - multi.length))}</b> {tx("in one kurel +")} <b>{twoN}</b> {tx("in two +")} <b>{threeN}</b> {tx("in three or more. Together they hold")} <b>{fmt(kurels.memberships)}</b> {tx("memberships.")}</p>
                <div className="dx-mmode" role="tablist" aria-label={tx("Show")}>
                  <button type="button" role="tab" aria-selected={mgMode === 'people'} className={mgMode === 'people' ? 'on' : ''} onClick={() => setMgMode('people')}>{tx("Members")}</button>
                  <button type="button" role="tab" aria-selected={mgMode === 'pairs'} className={mgMode === 'pairs' ? 'on' : ''} onClick={() => setMgMode('pairs')}>{tx("Kurels that share members")}</button>
                </div>
                {mgMode === 'pairs' ? (
                  <ul className="dx-pairs">
                    {pairs.slice(0, pairN).map((p) => (
                      <li key={`${p.a}|${p.b}`}>
                        <button type="button" title={tx("Show these members")} onClick={() => { setMgPair([p.a, p.b]); setMgMode('people'); setMgLimit(20); }}>
                          <span><b>{groupName[p.a]}</b><i>+</i><b>{groupName[p.b]}</b></span>
                          <em>{p.n} <small>{tx("shared")}</small></em>
                        </button>
                      </li>
                    ))}
                    {pairs.length > pairN && <li className="dx-mm"><button type="button" className="pf-more" onClick={() => setPairN(pairN + 8)}>{tx("Show 8 more ·")} {pairs.length - pairN} {tx("left")}</button></li>}
                  </ul>
                ) : (
                  <>
                    <label className="dx-mfind"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={mgQ} onChange={(e) => { setMgQ(e.target.value); setMgLimit(20); }} placeholder={tx("Search a member or a kurel")} aria-label={tx("Search")} /></label>
                    <div className="dx-mf">
                      <Dropdown label={tx("Country")} value={mgCountry} onChange={(v) => { setMgCountry(v); setMgLimit(20); }} allLabel="All countries" options={multiCountries} />
                      <Dropdown label={tx("Kurel")} value={mgKurel} onChange={(v) => { setMgKurel(v); setMgLimit(20); }} allLabel="All kurels" options={multiKurels} />
                    </div>
                    <div className="dx-mc">
                      {mgPair && <button type="button" className="on" onClick={() => setMgPair(null)}>{groupName[mgPair[0]]} + {groupName[mgPair[1]]} ×</button>}
                      {mgFiltered && <button type="button" className="clr" onClick={mgReset}>{tx("Reset")}</button>}
                      <span className="dx-mn2">{multiShown.length} {tx("shown")}</span>
                    </div>
                    <ul className="dx-multi">
                      {multiShown.length === 0 && <li className="dx-none">{multi.length === 0 ? tx("Nobody belongs to more than one kurel.") : tx("No member matches these filters.")}</li>}
                      {multiShown.slice(0, mgLimit).map((m) => (
                        <li key={m.id}>
                          <Avatar name={multiProfiles[m.id]?.name ?? ''} photoUrl={multiProfiles[m.id]?.photoUrl} size={38} />
                          <span className="dx-mw"><PersonLink userId={m.id}><b>{multiProfiles[m.id]?.name || tx("Member")}</b></PersonLink>
                            <span className="dx-mk">{m.groups.slice(0, 4).map((g) => <u key={g}>{groupName[g]}</u>)}{m.groups.length > 4 && <u className="more">+{m.groups.length - 4}</u>}</span>
                            <small>{m.countries.length > 1 ? <b className="x">{m.countries.join(' + ')}</b> : m.cities.join(' · ') || m.countries[0]}</small></span>
                          <i className="dx-mn" title={`${m.groups.length} kurels`}>{m.groups.length}</i>
                          <ViewProfile userId={m.id} />
                        </li>
                      ))}
                      {multiShown.length > mgLimit && <li className="dx-mm"><button type="button" className="pf-more" onClick={() => setMgLimit(mgLimit + 20)}>{tx("Show 20 more ·")} {multiShown.length - mgLimit} {tx("left")}</button></li>}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <article className="card command-card dx-events">
          <div className="command-card-head">
            <div>
              <h2>{tx("Event planning")}</h2>
              <p>{tx("What is coming and what needs your action")}{eventStats.drafts > 0 ? ` · ${eventStats.drafts} draft${eventStats.drafts === 1 ? '' : 's'}` : ''}</p>
            </div>
            <button type="button" className="dx-more" onClick={() => router.push('/dashboard/events')}>{tx("Open events →")}</button>
          </div>
          <EventDesk events={events} now={now} />
        </article>
        <div className="dx-grid dk-row"><LocalZonesDesk /><RehearsalsDesk now={now} /><AttendanceDesk /></div>
        <div className="dx-grid dk-row"><WelfareDesk now={now} /><FinanceDesk /><LogisticsDesk /></div>
        <OtherSections now={now} registrations={pendingRegistrations} phoneChanges={phoneRequests} />
        <DisciplinaryDesk now={now} />
      </section>
    </div>
  );
}

'use client';

import '../../px/gestion-membres.css';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit as fsLimit, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { subscribeUsers } from '@/lib/scopedUsers';
import { fmt, useCount } from '@/lib/liveStats';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import { useMembershipsByUser } from '@/lib/useMemberships';
import ManageToggle from '../../px/ManageToggle';
import MembersManage from './Manage';
import AssignKurel from './AssignKurel';
import ChatDialog from './ChatDialog';
import Dropdown from '@/components/Dropdown';
import { MemberCollective } from './MemberCollective';
import { MemberTiles, MemberSection, useMemberHub, type MTab, type Tab } from './MemberHub';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useRouter } from 'next/navigation';
import { assignHostToGroups, setMembershipRole, setMemberStatus, setMemberTag, setPrimaryGroup, backfillDefaultPhotos, deleteMember, removeMemberFromGroup } from '@/lib/functions';
import { useMyScope } from '@/lib/useMyScope';
import { notify } from '@/lib/notify';
import AccessDialog from '@/components/AccessDialog';
import { DEFAULT_MEMBER_PHOTO } from '@/components/MemberPicker';
import { tx, dateLocale } from '@/lib/i18n/tr';
import { CxBanner } from '@/components/Cx';
import { Users, UserPlus, IdCard, MapPin, MessageCircle, MoreHorizontal, SlidersHorizontal, List, LayoutGrid, Download, Layers } from 'lucide-react';

interface MemberRow {
  id: string;
  displayName: string;
  phone: string;
  secondaryPhone?: string;
  email: string;
  memberId: string;
  photoUrl: string;
  status: string;
  registrationStatus: string;
  lastSeenMs: number;
  memberSince: string;
  primaryGroupId: string;
}

const PAGE = 100;
const ALL_WINDOW = 2000;
const ONLINE_MS = 5 * 60 * 1000;

/** Member management — the approved layout, populated from Firebase. */
const Ic = ({ d }: { d: string }) => <svg className="mm-ic" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export default function MembersPage() {
  const { byId, locationOf, countries, cities, activeLeafGroups } = useGroupHierarchy();
  const { byId: levelById } = useLevels();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(PAGE);
  const [search, setSearch] = useState('');
  const [roleFor, setRoleFor] = useState('');
  const [listView, setListView] = useState(true);
  const [chatFor, setChatFor] = useState<null | { id: string; name: string; photoUrl: string }>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<null | { id: string }>(null);
  const [presenceF, setPresenceF] = useState('');
  const [gmBusy, setGmBusy] = useState('');
  const [rmBusy, setRmBusy] = useState('');
  async function removeFromGroup(userId: string, groupId: string, groupName: string, who: string) {
    if (!window.confirm(`${tx("Remove")} ${who} ${tx("from")} ${groupName}?`)) return;
    setRmBusy(groupId);
    try { await removeMemberFromGroup({ userId, groupId }); notify('Member removed from the group', 'success'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not remove the member', 'error'); }
    finally { setRmBusy(''); }
  }
  const [term, setTerm] = useState('');
  const [country, setCountry] = useState('');
  const [zoneF, setZoneF] = useState('');
  const [cityF, setCityF] = useState('');
  const [kurelF, setKurelF] = useState('');
  const [localF, setLocalF] = useState('');
  const localZones = useCollection<{ name: string; cityId: string }>('localZones', [orderBy('name')]);
  const router = useRouter();
  const [delFor, setDelFor] = useState<null | { id: string; name: string; memberId: string }>(null);
  const [delText, setDelText] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [areaIds, setAreaIds] = useState<string[] | null>(null);
  const zoneRows = useZones();
  const [statusFilter, setStatusFilter] = useState('');
  const [kurelCount, setKurelCount] = useState('');
  const [alsoKurel, setAlsoKurel] = useState('');
  const [roleF, setRoleF] = useState('');
  const moreCount = [zoneF, localF, roleF, kurelCount, kurelF, statusFilter].filter(Boolean).length;
  const scopes = useCollection<{ role: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[]; groupIds?: string[] }>('adminScopes', []);
  const adminRoles = useCollection<{ isSuperAdmin?: boolean }>('adminRoles', []);
  const [profile, setProfile] = useState('');
  const [appF, setAppF] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [manageSignal, setManageSignal] = useState(0);
  const [manageView, setManageView] = useState<'add' | 'assign' | 'all'>('all');
  const [closeSignal, setCloseSignal] = useState(0);
  const [editRequest, setEditRequest] = useState({ id: '', n: 0 });
  const [addRequest, setAddRequest] = useState({ n: 0 });
  const [headcount, setHeadcount] = useState<Record<string, number>>({});
  const myScope = useMyScope();
  const [tagBusy, setTagBusy] = useState('');
  const canTag = (groupId: string) => (myScope.scope?.role === 'group_manager' ? (myScope.scope.groupIds ?? []).includes(groupId) : true);
  async function changeTag(userId: string, groupId: string, substitute: boolean) {
    setTagBusy(`${groupId}_${userId}`);
    try { await setMemberTag({ userId, groupId, substitute }); notify(substitute ? 'Now a substitute' : 'Now a permanent member', 'success'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not change the tag', 'error'); } finally { setTagBusy(''); }
  }
  async function toggleManager(userId: string, groupId: string, on: boolean) {
    setGmBusy(groupId);
    try {
      if (on) await assignHostToGroups({ userId, groupIds: [groupId] });
      else await setMembershipRole({ userId, groupId, role: 'member' });
      notify(on ? 'Now the Group Manager of this kurel' : 'No longer Group Manager', 'success');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not change the role', 'error'); }
    setGmBusy('');
  }
  const [now] = useState(() => Date.now());
  // A link from the dashboard can open the list already filtered (?country=…, ?kurel=…, ?kurels=multi|2|3).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('country')) setCountry(q.get('country')!);
    if (q.get('kurel')) setKurelF(q.get('kurel')!);
    if (q.get('kurels')) setKurelCount(q.get('kurels')!);
    if (q.get('also')) setAlsoKurel(q.get('also')!);
    if (q.get('online')) setPresenceF('online');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const registered = useCount('users', [['registrationStatus', '==', 'approved']]);
  const everyone = useCount('users', []);
  const active = useCount('users', [['status', '==', 'active']]);
  const pending = useCount('users', [['registrationStatus', '==', 'pending_approval']]);
  const substitutes = useCount('groupMemberships', [['status', '==', 'active'], ['substitute', '==', true]], 60000);
  const withPhoto = useCount('users', [['photoUrl', '>', '']], 60000);
  const incomplete = everyone !== null && withPhoto !== null ? Math.max(0, everyone - withPhoto) : null;

  useEffect(() => {
    const h = window.setTimeout(() => setTerm(search.trim().toLowerCase()), 300);
    return () => window.clearTimeout(h);
  }, [search]);
  useEffect(() => setPageSize(PAGE), [term]);

  // Zone / city / kurel chosen: list the people of that area (not just the first alphabetical page).
  const areaGroups = useMemo(
    () =>
      country || zoneF || cityF || localF || kurelF
        ? activeLeafGroups.filter((g) => {
            if (kurelF) return g.id === kurelF;
            const c = g.parentGroupId ? byId[g.parentGroupId] : undefined;
            if (!c) return false;
            if (country && c.parentGroupId !== country) return false;
            if (cityF && c.id !== cityF) return false;
            if (zoneF && c.zoneId !== zoneF) return false;
            if (localF && g.localZoneId !== localF) return false;
            return true;
          })
        : null,
    [country, zoneF, cityF, localF, kurelF, activeLeafGroups, byId]
  );
  const areaKey = areaGroups ? `g:${areaGroups.map((g) => g.id).join(',')}` : '';
  useEffect(() => {
    if (!areaGroups) {
      setAreaIds(null);
      return;
    }
    let cancelled = false;
    setAreaIds(null);
    (async () => {
      const uids = new Set<string>();
      const ids = areaGroups.map((g) => g.id);
      for (let i = 0; i < ids.length; i += 30) {
        const s = await getDocs(query(collection(db, 'groupMemberships'), where('groupId', 'in', ids.slice(i, i + 30)), where('status', '==', 'active')));
        s.docs.forEach((d) => uids.add(d.data().userId as string));
      }
      if (!cancelled) setAreaIds([...uids]);
    })().catch(() => !cancelled && setAreaIds([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey]);

  // Role, status, kurel-count and profile filters are applied on the loaded people, so they need a bigger window than one page.
  const clientFilter = !!(appF || presenceF || roleF || statusFilter || kurelCount || profile || alsoKurel);
  const loadSize = Math.max(pageSize, ALL_WINDOW); // the overview always counts everyone; the list below shows a page at a time
  useEffect(() => {
    if (areaGroups && areaIds === null) return;
    return subscribeUsers(
      { term, pageSize: loadSize, onlyIds: areaIds ?? undefined },
      (docs) => {
        setMembers(
          docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              displayName: (x.displayName as string) || '',
              phone: (x.phone as string) || '',
              secondaryPhone: (x.secondaryPhone as string) || '',
              email: (x.email as string) || '',
              memberId: (x.memberId as string) || '',
              photoUrl: (x.photoUrl as string) || '',
              status: (x.status as string) || 'active',
              registrationStatus: (x.registrationStatus as string) || 'not_registered',
              lastSeenMs: (x.lastSeenAt as Timestamp | undefined)?.toMillis?.() ?? 0,
              memberSince: (x.memberSince as string) || '',
              primaryGroupId: (x.primaryGroupId as string) || '',
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [loadSize, term, areaIds]);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'groupMemberships'), where('status', '==', 'active')), (snap) => {
      const next: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const gid = d.data().groupId as string;
        next[gid] = (next[gid] ?? 0) + 1;
      });
      setHeadcount(next);
    });
  }, []);

  const ids = useMemo(() => members.map((m) => m.id), [members]);
  const memberships = useMembershipsByUser(ids);

  const ROLE_NAMES: Record<string, string> = { super_admin: 'Super Admin', zone_admin: 'Zone Manager', city_manager: 'City Manager', city_zone_manager: 'City Zone Manager', group_manager: 'Group Admin', host: 'Group Manager', member: 'Member' };
  const rolesOf = (uid: string): string[] => {
    const out = new Set<string>();
    const sc = (scopes ?? []).find((x) => x.id === uid);
    if (sc && ROLE_NAMES[sc.role]) out.add(sc.role);
    if ((adminRoles ?? []).find((x) => x.id === uid)?.isSuperAdmin) out.add('super_admin');
    if ((memberships[uid] ?? []).some((k) => k.role === 'host')) out.add('host');
    if (out.size === 0) out.add('member');
    return [...out];
  };
  const rows = useMemo(() => {
    return members.filter((m) => {
      const ms = memberships[m.id] ?? [];
      if (roleF && !rolesOf(m.id).includes(roleF)) return false;
      if (statusFilter === 'active' && m.status !== 'active') return false;
      if (statusFilter === 'suspended' && m.status !== 'disabled') return false;
      if (kurelCount === 'any' ? ms.length < 1 : kurelCount === 'multi' ? ms.length < 2 : kurelCount === '3' ? ms.length < 3 : kurelCount === 'cross' ? new Set(ms.map((k) => locationOf(k.groupId).country?.id ?? '')).size < 2 : kurelCount && ms.length !== Number(kurelCount)) return false;
      if (alsoKurel && !ms.some((k) => k.groupId === alsoKurel)) return false;
      if (profile === 'complete' && !m.photoUrl) return false;
      if (profile === 'incomplete' && m.photoUrl) return false;
      if (appF === 'registered' && m.registrationStatus !== 'approved') return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, memberships, statusFilter, kurelCount, profile, appF, roleF, scopes, adminRoles]);

  const selected = rows.find((m) => m.id === selectedId);
  const primaryId = selected?.primaryGroupId || '';
  const selectedKurels = useMemo(() => {
    const list = selected ? [...(memberships[selected.id] ?? [])] : [];
    return list.sort((a, b) => (a.groupId === primaryId ? -1 : 0) - (b.groupId === primaryId ? -1 : 0));
  }, [selected, memberships, primaryId]);
  const historyRaw = useCollection<{ status: string; reason?: string; at: unknown }>('memberStatusHistory', [where('userId', '==', selected?.id ?? '__none__')], selected?.id ?? '');
  const history = [...(historyRaw ?? [])].sort((a, b) => tsMs(b.at) - tsMs(a.at)).slice(0, 5);
  async function changeStatus(next: 'active' | 'disabled') {
    if (!selected) return;
    const reason = next === 'disabled' ? window.prompt('Reason for suspending this member (kept in the status history)') : '';
    if (next === 'disabled' && reason === null) return;
    try {
      await setMemberStatus({ userId: selected.id, status: next, reason: reason ?? undefined });
      notify(next === 'active' ? 'Member reinstated' : 'Member suspended', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not change the status', 'error');
    }
  }

  // upcoming events of the selected member's kurels
  const [events, setEvents] = useState<{ id: string; title: string; startMs: number; groupId: string }[]>([]);
  const [mtab, setMtab] = useState<MTab | 'kurels' | 'activities' | 'status'>('overview');
  const hub = useMemberHub(selected?.id ?? '');
  const kurelKey = selectedKurels.map((k) => k.groupId).join(',');
  useEffect(() => {
    const g = kurelKey ? kurelKey.split(',').slice(0, 10) : [];
    if (g.length === 0) {
      setEvents([]);
      return;
    }
    return onSnapshot(query(collection(db, 'events'), where('subGroupIds', 'array-contains-any', g), fsLimit(50)), (snap) =>
      setEvents(
        snap.docs
          .filter((d) => d.data().status === 'published')
          .map((d) => ({ id: d.id, title: (d.data().title as string) ?? '', startMs: (d.data().startAt as Timestamp)?.toMillis?.() ?? 0, groupId: ((d.data().subGroupIds as string[]) ?? [])[0] }))
          .filter((e) => e.startMs >= now)
          .sort((a, b) => a.startMs - b.startMs)
          .slice(0, 12)
      )
    );
  }, [kurelKey, now]);

  function exportList() {
    const header = ['Member ID', 'Name', 'Phone', 'Status', 'Kurels'];
    const lines = rows.map((m) => [m.memberId, m.displayName, m.phone, m.status, (memberships[m.id] ?? []).map((k) => byId[k.groupId]?.name ?? '').join(' | ')]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const [presence, setPresence] = useState<Record<string, number>>({});
  useEffect(() => {
    return onSnapshot(query(collection(db, 'presence'), where('lastActiveAt', '>=', Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000)), orderBy('lastActiveAt', 'desc'), fsLimit(500)), (snap) => {
      const next: Record<string, number> = {};
      snap.docs.forEach((d) => (next[d.id] = (d.data().lastActiveAt as Timestamp)?.toMillis?.() ?? 0));
      setPresence(next);
    });
  }, []);
  const online = (m: MemberRow) => (presence[m.id] ?? 0) > 0 && now - presence[m.id] < ONLINE_MS;
  const [sortBy, setSortBy] = useState<'az' | 'za' | 'id'>('az');
  const shown = useMemo(() => {
    const blankLast = (x: string, y: string, dir: 1 | -1) => (!x && !y ? 0 : !x ? 1 : !y ? -1 : dir * x.localeCompare(y));
    const base = [...rows].sort((a, b) => (sortBy === 'id' ? blankLast(a.memberId || '', b.memberId || '', 1) : sortBy === 'za' ? blankLast(a.displayName || '', b.displayName || '', -1) : blankLast(a.displayName || '', b.displayName || '', 1)));
    if (!presenceF) return base;
    return base.filter((m) => {
      const age = now - (presence[m.id] ?? 0);
      return presenceF === 'online' ? (presence[m.id] ?? 0) > 0 && age < ONLINE_MS : presenceF === 'recent' ? (presence[m.id] ?? 0) > 0 && age < 30 * 60 * 1000 : !((presence[m.id] ?? 0) > 0 && age < ONLINE_MS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, presence, presenceF, sortBy]);
  // The first member is opened by default, and again whenever the current one drops out of the filtered list.
  useEffect(() => {
    if (loading || shown.length === 0) return;
    if (!shown.some((m) => m.id === selectedId)) setSelectedId(shown[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, loading, selectedId]);
  const statusLabel = (m: MemberRow) => (m.status === 'disabled' ? 'Suspended' : 'Active');
  const memberFor = (since: string) => {
    const y = new Date().getFullYear() - Number(since.slice(0, 4));
    return y <= 0 ? 'Joined this year' : `${y} year${y === 1 ? '' : 's'}`;
  };
  const ratio = (everyone && active !== null) ? Math.round((active / everyone) * 1000) / 10 : null;
  const unregistered = everyone !== null && registered !== null && pending !== null ? Math.max(0, everyone - registered - pending) : null;
  const appRatio = (everyone && registered !== null) ? Math.round((registered / everyone) * 1000) / 10 : null;

  /** Banner tiles: apply the matching filter and bring the member list into view. */
  function showList(f: { status?: string; profile?: string }) {
    setSearch(''); setCountry(''); setZoneF(''); setCityF(''); setLocalF(''); setKurelF(''); setRoleF(''); setKurelCount('');
    setStatusFilter(f.status ?? ''); setProfile(f.profile ?? '');
    window.setTimeout(() => document.getElementById('memberDirectory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  /** Data-strip tiles and bars: reset the filters, apply the chosen one and keep the list in view. */
  function applyTile(f: { status?: string; profile?: string; app?: string; presence?: string; kurelCount?: string; country?: string; city?: string; kurel?: string }) {
    setSearch(''); setCountry(f.country ?? ''); setZoneF(''); setCityF(f.city ?? ''); setLocalF(''); setKurelF(f.kurel ?? ''); setRoleF(''); setAlsoKurel('');
    setStatusFilter(f.status ?? ''); setProfile(f.profile ?? ''); setAppF(f.app ?? ''); setPresenceF(f.presence ?? ''); setKurelCount(f.kurelCount ?? '');
    window.setTimeout(() => document.getElementById('memberWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  async function confirmDelete() {
    if (!delFor) return;
    setDelBusy(true); setDelErr('');
    try {
      await deleteMember({ userId: delFor.id });
      notify(`${delFor.name} was deleted permanently`, 'success');
      setDelFor(null); setDelText(''); setSelectedId('');
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : 'Could not delete this member');
    } finally { setDelBusy(false); }
  }

  return (
    <>
      <div className="px px-gestion-membres">
        <div className="content">
          <CxBanner kicker="Direction du Conservatoire" title={tx("Member Management")} />

          <div className="mm-stripe">
            <button type="button" className="tot" onClick={() => showList({})}><Users size={30} /><span><b>{fmt(everyone)}</b><small>{tx("Total members")}</small></span></button>
            <button type="button" onClick={() => showList({ status: 'active' })}><i className="dot g" /><span><b>{fmt(active)}</b><small>{tx("Active")}</small></span></button>
            <button type="button" onClick={() => showList({ status: 'suspended' })}><i className="dot y" /><span><b>{everyone !== null && active !== null && pending !== null ? fmt(Math.max(0, everyone - active - pending)) : '—'}</b><small>{tx("Inactive")}</small></span></button>
            <button type="button" onClick={() => router.push('/dashboard/approvals')}><i className="dot r" /><span><b>{fmt(pending)}</b><small>{tx("Pending")}</small></span></button>
            <button type="button" className="cx-btn gold mm-add" onClick={() => { setManageView('add'); setEditRequest({ id: '', n: 0 }); setAddRequest((r) => ({ n: r.n + 1 })); setManageSignal((n) => n + 1); }}><UserPlus size={18} />{tx("Add Member")}</button>
          </div>

          <MemberCollective rows={shown.map((m) => ({ id: m.id, status: m.status, registered: m.registrationStatus === 'approved', hasPhoto: !!m.photoUrl, online: online(m), kurels: (memberships[m.id] ?? []).map((k) => k.groupId) }))} byId={byId} locationOf={locationOf} scoped={!!(appF || profile || presenceF || country || zoneF || cityF || localF || kurelF || roleF || statusFilter || kurelCount || search)} onCity={(id) => applyTile({ city: id })} onKurel={(id) => applyTile({ kurel: id })} onCountry={(id) => applyTile({ country: id })} onFilter={applyTile} />

          <section className="card filters">
            <input type="search" placeholder={tx("Search by name, ID, or phone number…")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setZoneF(''); setCityF(''); setLocalF(''); setKurelF(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("City")} value={cityF} onChange={(v) => { setCityF(v); setLocalF(''); setKurelF(''); }} allLabel={tx("All cities")} options={cities.filter((c) => (!country || c.parentGroupId === country) && (!zoneF || c.zoneId === zoneF)).map((c) => ({ value: c.id, label: c.name }))} />
            {(moreOpen || moreCount > 0) && (<>
            <Dropdown label={tx("Kurel")} value={kurelF} onChange={setKurelF} allLabel={tx("All kurels")} options={activeLeafGroups.filter((g) => { const c = g.parentGroupId ? byId[g.parentGroupId] : undefined; return !!c && (!cityF || c.id === cityF) && (!zoneF || c.zoneId === zoneF) && (!country || c.parentGroupId === country) && (!localF || g.localZoneId === localF); }).map((g) => ({ value: g.id, label: `${g.name} (${byId[g.parentGroupId ?? '']?.name ?? ''})` }))} />
            <Dropdown label={tx("Status")} value={statusFilter} onChange={setStatusFilter} allLabel={tx("All statuses")} options={[{ value: 'active', label: tx("Active") }, { value: 'suspended', label: tx("Suspended") }]} />
            <Dropdown label={tx("Zone")} value={zoneF} onChange={(v) => { setZoneF(v); setCityF(''); setLocalF(''); setKurelF(''); }} allLabel={tx("All zones")} options={(zoneRows ?? []).filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }))} />
            <Dropdown label={tx("Local zone")} value={localF} onChange={(v) => { setLocalF(v); setKurelF(''); }} allLabel={tx("All local zones")} options={(localZones ?? []).filter((z) => (cityF ? z.cityId === cityF : cities.some((c) => c.id === z.cityId && (!country || c.parentGroupId === country) && (!zoneF || c.zoneId === zoneF)))).map((z) => ({ value: (z as unknown as { id: string }).id, label: `${z.name}${cityF ? '' : ` · ${byId[z.cityId]?.name ?? ''}`}` }))} />
            <Dropdown label={tx("Role")} value={roleF} onChange={setRoleF} allLabel={tx("All roles")} options={Object.entries(ROLE_NAMES).map(([v, l]) => ({ value: v, label: l }))} />
            <Dropdown label={tx("Kurels per member")} value={kurelCount} onChange={setKurelCount} allLabel={tx("Any number of kurels")} options={[{ value: 'any', label: tx("In at least one kurel") }, { value: '0', label: tx("Without a kurel") }, { value: '1', label: tx("1 kurel") }, { value: 'multi', label: tx("2 kurels or more") }, { value: '2', label: tx("2 kurels") }, { value: '3', label: tx("3 kurels or more") }, { value: 'cross', label: tx("Kurels in different countries") }]} />
            </>)}
            {(appF || profile || presenceF || search || country || zoneF || cityF || localF || kurelF || roleF || statusFilter || kurelCount) && <button type="button" className="secondary mm-clear" onClick={() => { setSearch(''); setCountry(''); setZoneF(''); setCityF(''); setLocalF(''); setKurelF(''); setRoleF(''); setStatusFilter(''); setKurelCount(''); setAlsoKurel(''); setSelectedId(''); setPresenceF(''); setProfile(''); setAppF(''); }}>{tx("Clear all ✕")}</button>}
          </section>


          <div className="workspace" id="memberWorkspace">
            <section className="card panel" id="memberDirectory">
              {(presenceF || profile || appF || statusFilter) && !kurelCount && !alsoKurel && (
                <div className="ml-ctx" role="status">
                  <b>{tx("Showing")}</b>
                  <span>{presenceF === 'online' ? tx("Members online now") : profile === 'incomplete' ? tx("Members with an incomplete profile") : appF === 'registered' ? tx("Members registered in the app") : statusFilter === 'suspended' ? tx("Suspended members") : tx("Active members")}</span>
                  <button type="button" onClick={() => { setPresenceF(''); setProfile(''); setAppF(''); setStatusFilter(''); }}>{tx("Clear ✕")}</button>
                </div>
              )}
              {(kurelCount || alsoKurel) && (
                <div className="ml-ctx" role="status">
                  <b>{tx("Showing")}</b>
                  <span>{kurelCount === 'multi' ? tx("Members in 2 or more kurels") : kurelCount === '2' ? tx("Members in exactly 2 kurels") : kurelCount === '3' ? tx("Members in 3 kurels") : kurelCount === 'cross' ? tx("Members whose kurels are in different countries") : kurelCount === '1' ? tx("Members in 1 kurel") : ''}{alsoKurel ? `${kurelCount ? ' · ' : ''}also in ${byId[alsoKurel]?.name ?? 'another kurel'}` : ''}{kurelF ? ` · ${byId[kurelF]?.name ?? ''}` : ''}{country ? ` · ${byId[country]?.name ?? ''}` : ''}</span>
                  <button type="button" onClick={() => { setKurelCount(''); setAlsoKurel(''); setKurelF(''); setCountry(''); }}>{tx("Clear ✕")}</button>
                </div>
              )}
              <div className="panel-head">
                <div>
                  <h2>{tx("Member List")}</h2>
                  <p>{shown.length} {tx("member")}{shown.length === 1 ? '' : 's'} {tx("shown")}</p>
                </div>
                <div className="mm-ph"><span className="status">{tx("Live data")}</span><button type="button" className={`mm-fbtn${moreOpen || moreCount > 0 ? ' on' : ''}`} onClick={() => setMoreOpen((v) => !v)}><SlidersHorizontal size={15} />{tx("Filters")}</button><Dropdown label={tx("Sort")} value={sortBy} onChange={(v) => setSortBy((v || 'az') as 'az' | 'za' | 'id')} options={[{ value: 'az', label: tx("Name (A–Z)") }, { value: 'za', label: tx("Name (Z–A)") }, { value: 'id', label: tx("Member ID") }]} className="mm-sort" /><details className="mm-kb2"><summary aria-label={tx("More actions")}><MoreHorizontal size={17} /></summary><div className="mm-kbm"><button type="button" onClick={exportList}><Download size={15} />{tx("Export the list")}</button><button type="button" onClick={() => setAssignOpen({ id: selected?.id ?? '' })}><Layers size={15} />{tx("Assign to a kurel")}</button><button type="button" onClick={() => router.push('/dashboard/approvals')} title={tx("Review the registrations waiting for approval")}><UserPlus size={15} />{tx("Pending approvals")} <b>{fmt(pending)}</b></button></div></details><span className="mm-vt" role="group" aria-label={tx("View")}><button type="button" className={listView ? 'on' : ''} aria-pressed={listView} onClick={() => setListView(true)}><List size={17} /></button><button type="button" className={!listView ? 'on' : ''} aria-pressed={!listView} onClick={() => setListView(false)}><LayoutGrid size={17} /></button></span></div>
              </div>
              <div className={`members${listView ? '' : ' grid'}`}>
                {(loading || (!!areaGroups && areaIds === null)) && <div className="empty" style={{ display: 'block' }}>{tx("Loading…")}</div>}
                {shown.slice(0, pageSize).map((m) => {
                  const ms = memberships[m.id] ?? [];
                  const city = ms[0] ? locationOf(ms[0].groupId).city?.name : undefined;
                  return (
                    <div role="button" tabIndex={0} key={m.id} className={`member-row mr${selected?.id === m.id ? ' active' : ''}${m.status === 'disabled' ? ' off' : ''}`} onClick={() => setSelectedId(m.id)} onKeyDown={(e) => e.key === 'Enter' && setSelectedId(m.id)}>
                      <span className="photo"><img alt="" src={m.photoUrl || DEFAULT_MEMBER_PHOTO} /><i className={`mr-dot${online(m) ? ' on' : ''}`} title={online(m) ? tx("Online") : tx("Offline")} /></span>
                      <div>
                        <strong>{m.displayName || tx("(no name)")}</strong>
                        <span className="mr-sub"><IdCard size={15} />{m.memberId || '—'}{city ? <><i className="sep">|</i><MapPin size={14} />{city}</> : null}</span>
                        <span className="mr-chips">
                          {ms.slice(0, 2).map((k) => <em key={k.groupId} className={k.role === 'host' ? 'gm' : ''}>{byId[k.groupId]?.name ?? '—'}</em>)}
                          {ms.length > 2 && <em className="more">+{ms.length - 2}</em>}
                          {ms.length === 0 && <em className="none">{tx("No kurel")}</em>}
                        </span>
                      </div>
                      <div className="mr-side">
                        <small className={m.status === 'disabled' ? 'bad' : 'ok'}><i />{statusLabel(m)}</small>
                        {m.status !== 'disabled' && <button type="button" className="mr-chat" title={tx("Chat with this member")} onClick={(e) => { e.stopPropagation(); setChatFor({ id: m.id, name: m.displayName || '', photoUrl: m.photoUrl }); }}><MessageCircle size={18} /></button>}
                        <button type="button" className="mr-chat mr-more" title={tx("Open the profile")} onClick={(e) => { e.stopPropagation(); setSelectedId(m.id); document.querySelector('.px-gestion-membres .detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><MoreHorizontal size={18} /></button>
                      </div>
                    </div>
                  );
                })}
                {!loading && !(areaGroups && areaIds === null) && shown.length === 0 && <div className="empty" style={{ display: 'block' }}>{tx("No member matches the filters.")}</div>}
                {shown.length > pageSize && (
                  <button type="button" className="secondary" style={{ margin: '10px auto', display: 'block' }} onClick={() => setPageSize((n) => n + PAGE)}>
                    {tx("Load more")}
                  </button>
                )}
              </div>
            </section>

            <article className="card detail">
              {selected ? (
                <>
                  <div className="profile-hero mm-hero">
                      <button type="button" className="mm-btn danger mm-del" onClick={() => { setDelFor({ id: selected.id, name: selected.displayName || 'this member', memberId: selected.memberId || '' }); setDelText(''); setDelErr(''); }}><Ic d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />{tx("Delete permanently")}</button>
                    <div className="profile-main">
                      <div className="photo-large"><img alt="" src={selected.photoUrl || DEFAULT_MEMBER_PHOTO} /></div>
                      <i className="mm-vline" aria-hidden />
                      <div className="mm-who">
                        <span className="mm-eyebrow">{tx("Member profile")}</span>
                        <strong className="mm-name">{selected.displayName || tx("(no name)")}</strong>
                        <small className="mm-id">{selected.memberId || '—'}</small>
                        <span className={`mm-reg ${selected.registrationStatus === 'approved' ? 'ok' : ''}`}>{tx("Registration")}: {selected.registrationStatus === 'approved' ? tx("verified") : selected.registrationStatus.replace('_', ' ')}</span>
                        <div className="mm-roles">
                          {rolesOf(selected.id).map((r) => <span key={r} className={`mm-role r-${r}`}>{ROLE_NAMES[r]}</span>)}
                        </div>
                      </div>
                    </div>
                    <div className="mm-statrow">
                      <span className={`mm-sp st${selected.status === 'disabled' ? ' bad' : ''}`}>{statusLabel(selected)}</span>
                      <span className={`mm-sp net${online(selected) ? ' live' : ''}`}>{online(selected) ? tx("Online") : tx("Offline")}</span>
                      {(() => { const ks = memberships[selected.id] ?? []; const sub = ks.filter((k) => k.substitute).length; return (<><span className="mm-sp">{ks.length - sub} {tx("Permanent")}</span><span className="mm-sp">{sub} {tx("Substitute")}</span></>); })()}
                    </div>
                    <div className="actions mm-acts">
                      <button type="button" className="mm-btn light" onClick={() => { setManageView('assign'); setAddRequest({ n: 0 }); setEditRequest((r) => ({ id: selected.id, n: r.n + 1 })); setManageSignal((n) => n + 1); }}><Ic d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />{tx("Edit the profile")}</button>
                      <button type="button" className="mm-btn light" onClick={() => setAssignOpen({ id: selected.id })}><Ic d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8" />{tx("Assign to a kurel")}</button>
                      <button type="button" className="mm-btn light" onClick={() => setRoleFor(selected.id)}><Ic d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" />{tx("Role and access")}</button>
                      {selected.status !== 'disabled' && <button type="button" className="mm-btn light" onClick={() => setChatFor({ id: selected.id, name: selected.displayName || '', photoUrl: selected.photoUrl })}><Ic d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />{tx("Chat")}</button>}
                    </div>
                  </div>

                  <div className="detail-body">
                    <div className="dt-tabs mt-tabs" role="tablist">
                      {([['overview', tx("Overview")], ['kurels', `${tx("Kurels")} (${selectedKurels.length})`], ['activities', `${tx("Activities")} (${events.length})`], ['attendance', tx("Attendance")], ['social', tx("Social")], ['finance', tx("Finance")], ['tasks', tx("Tasks")], ['meetings', tx("Meetings")], ['conduct', tx("Conduct")], ['status', tx("Status")]] as [MTab | 'kurels' | 'activities' | 'status', string][]).map(([k, l]) => (
                        <button type="button" role="tab" aria-selected={mtab === k} key={k} className={mtab === k ? 'on' : ''} onClick={() => setMtab(k)}>{l}</button>
                      ))}
                    </div>
                    {mtab === 'overview' && <div className="dt-pane">
                    <div className="mm-tiles">
                      <div className="mm-tile t-green"><span>{tx("Member since")}</span><strong>{selected.memberSince ? selected.memberSince.slice(0, 4) : tx("Not set yet")}</strong>{selected.memberSince && <em>{memberFor(selected.memberSince)}</em>}</div>
                      <div className="mm-tile t-blue"><span>{tx("Phone")}</span><strong>{selected.phone || '—'}</strong></div>
                      <div className="mm-tile t-blue"><span>{tx("Secondary phone")}</span><strong>{selected.secondaryPhone || '—'}</strong></div>
                      <div className="mm-tile t-purple"><span>{tx("Email")}</span><strong>{selected.email || '—'}</strong></div>
                      <div className="mm-tile t-teal"><span>{tx("Last seen")}</span><strong>{presence[selected.id] ? new Date(presence[selected.id]).toLocaleString(dateLocale()) : '—'}</strong></div>
                      <div className="mm-tile t-rose"><span>{tx("Main group")}</span><strong>{byId[primaryId]?.name ?? (selectedKurels[0] ? byId[selectedKurels[0].groupId]?.name : undefined) ?? tx("No group yet")}</strong><em>{(() => { const gid = primaryId || selectedKurels[0]?.groupId; const l = gid ? locationOf(gid) : null; return l ? [l.city?.name, l.country?.name].filter(Boolean).join(' · ') : ''; })()}</em></div>
                    </div>
                    
                    <MemberTiles hub={hub} open={(t) => setMtab(t)} />
                    </div>}
                    {mtab === 'kurels' && <div className="dt-pane">
                    <div className="section-title mm-title">
                      <h3>{tx("Member’s groups")}</h3>
                      <span className="mm-count">{selectedKurels.length} {tx("group")}{selectedKurels.length === 1 ? '' : 's'}</span>
                    </div>
                    {selectedKurels.length > 1 && !primaryId && <div className="mm-empty" style={{ textAlign: 'left' }}>{tx("No primary group is set yet. Press “Make primary” on the group this member belongs to first.")}</div>}
                    {selectedKurels.length === 0 ? <div className="mm-empty">{tx("Not linked to any group yet. Use “Assign to a kurel” at the top.")}</div> : (
                      <div className="mm-groups">
                        {selectedKurels.map((k, i) => {
                          const g = byId[k.groupId];
                          const n = headcount[k.groupId] ?? 0;
                          const pct = g?.capacity ? Math.min(100, Math.round((n / g.capacity) * 100)) : 0;
                          const loc = locationOf(k.groupId);
                          return (
                            <div className={`mm-group c${i % 3}${k.groupId === primaryId ? ' primary' : ''}`} key={k.groupId}>
                              <div className="mm-group-top"><span className="mm-group-n">{i + 1}</span>{k.groupId === primaryId && <span className="mm-primary">{tx("★ Primary group")}</span>}<span className={`mm-role ${k.role === 'host' ? 'r-host' : 'r-member'}`}>{k.role === 'host' ? tx("Host") : tx("Member")}</span></div>
                              <strong>{g?.name ?? k.groupId}</strong>
                              <span className="mm-place">{[loc.city?.name, loc.country?.name].filter(Boolean).join(' · ') || '—'}</span>
                              <span className="mm-level">{tx("Level:")} {g?.levelId && levelById[g.levelId] ? levelById[g.levelId].name : tx("not assigned")}</span>
                              <div className="capacity"><i style={{ ['--p' as string]: `${pct}%` }}></i></div>
                              <small>{n} {tx("member")}{n === 1 ? '' : 's'}{g?.capacity ? ` of ${g.capacity}` : ''}</small>
                              <div className="mm-tagrow"><span className={`mm-tagchip ${k.substitute ? 'sub' : 'perm'}`}>{k.substitute ? tx("Substitute") : tx("Permanent")}</span>{canTag(k.groupId) && <button type="button" className="mm-gm" disabled={gmBusy === k.groupId} onClick={() => void toggleManager(selected.id, k.groupId, k.role !== 'host')}>{k.role === 'host' ? tx("Remove Group Manager") : tx("Make Group Manager")}</button>}{canTag(k.groupId) && <button type="button" disabled={tagBusy === `${k.groupId}_${selected.id}`} onClick={() => void changeTag(selected.id, k.groupId, !k.substitute)}>{k.substitute ? tx("Make permanent") : tx("Make substitute")}</button>}{canTag(k.groupId) && <button type="button" className="mm-rm" disabled={rmBusy === k.groupId} onClick={() => void removeFromGroup(selected.id, k.groupId, g?.name ?? k.groupId, selected.displayName || tx("this member"))}>{tx("Remove from group")}</button>}</div>
                              {selectedKurels.length > 1 && k.groupId !== primaryId && <button type="button" className="mm-mkprimary" onClick={() => setPrimaryGroup({ userId: selected.id, groupId: k.groupId }).then(() => notify('Primary group updated', 'success')).catch((e: Error) => notify(e.message, 'error'))}>{tx("Make primary")}</button>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    </div>}
                    {mtab === 'activities' && <div className="dt-pane">
                      <div className="section-title mm-title"><h3>{tx("Upcoming events of the member’s kurels")}</h3><span className="mm-count">{events.length}</span></div>
                      <div className="ma-list">
                        {events.length === 0 && <div className="mm-empty">{tx("No upcoming published event for this member’s kurels.")}</div>}
                        {events.map((e) => (<div className="ma-row" key={e.id}><div><strong>{e.title}</strong><small>{byId[e.groupId]?.name ?? ''}</small></div><span className="ma-amt">{new Date(e.startMs).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>))}
                      </div>
                    </div>}
                    {(['attendance', 'social', 'finance', 'tasks', 'meetings', 'conduct'] as const).includes(mtab as never) && <div className="dt-pane"><MemberSection tab={mtab as Tab} hub={hub} /></div>}
                    {mtab === 'status' && <div className="dt-pane">
                    <div className="section-title mm-title"><h3>{tx("Status history")}</h3></div>
                    <div className="mm-history">
                      {history.length === 0 && <div className="mm-empty">{tx("No status change recorded.")}</div>}
                      {history.map((h) => (
                        <div className={`mm-hist ${h.status === 'active' ? 'on' : 'off'}`} key={h.id}>
                          <strong>{h.status === 'active' ? tx("Reinstated") : tx("Suspended")}</strong>
                          <span>{tsMs(h.at) ? new Date(tsMs(h.at)).toLocaleString(dateLocale()) : ''}</span>
                          {h.reason && <em>{h.reason}</em>}
                        </div>
                      ))}
                    </div>

                    <div className={`mm-danger${selected.status === 'disabled' ? ' suspended' : ''}`}>
                      <div>
                        <h3>{tx("Status and restrictions")}</h3>
                        <p>{tx("General status:")} <b>{statusLabel(selected)}</b> {tx("· Access to activities:")} <b>{selected.status === 'disabled' ? tx("Blocked") : tx("Allowed")}</b></p>
                      </div>
                      <button type="button" className={`mm-btn ${selected.status === 'disabled' ? 'ok' : 'bad'}`} onClick={() => changeStatus(selected.status === 'disabled' ? 'active' : 'disabled')}>{selected.status === 'disabled' ? tx("Reinstate the member") : tx("Suspend the member")}</button>
                    </div>
                    </div>}
                  </div>
                </>
              ) : (
                <div className="detail-body mm-pick"><strong>{loading ? tx("Loading…") : tx("Select a member")}</strong><p>{tx("Pick someone in the list to see everything about them: kurels, attendance, social, finance, tasks, meetings and conduct.")}</p></div>
              )}
            </article>
          </div>


          <section className="card permission">
            <h2>{tx("Rights by role")}</h2>
            <p>{tx("Authorised administrators can create records, change statuses and complete assignments, including membership of several kurels.")}</p>
            <div className="permissions">
              <div className="permission-item"><strong>{tx("Authorised administrator")}</strong><span>{tx("Creation, access, status and assignments.")}</span></div>
              <div className="permission-item"><strong>{tx("Kurel host")}</strong><span>{tx("Views their kurel’s members.")}</span></div>
            </div>
          </section>
        </div>
      </div>

      {delFor && (
        <div className="mm-delbg" onClick={() => !delBusy && setDelFor(null)}>
          <div className="mm-del" onClick={(e) => e.stopPropagation()}>
            <h3>{tx("Delete")} {delFor.name} {tx("permanently?")}</h3>
            <p>{tx("The profile, role assignments, notifications and kurel links are removed for good. This cannot be undone. Use this for duplicates or unwanted records; to pause someone, suspend them instead.")}</p>
            <label>{tx("Type")} <b>{delFor.memberId || delFor.name}</b> {tx("to confirm")}
              <input value={delText} onChange={(e) => setDelText(e.target.value)} autoFocus />
            </label>
            {delErr && <div className="mm-delerr">{delErr}</div>}
            <div className="mm-delact">
              <button type="button" className="mm-btn light" disabled={delBusy} onClick={() => setDelFor(null)}>{tx("Cancel")}</button>
              <button type="button" className="mm-btn danger" disabled={delBusy || delText.trim().toLowerCase() !== (delFor.memberId || delFor.name).trim().toLowerCase()} onClick={confirmDelete}>{delBusy ? tx("Deleting…") : tx("Delete permanently")}</button>
            </div>
          </div>
        </div>
      )}
      {roleFor && selected && roleFor === selected.id && <AccessDialog userId={roleFor} name={selected.displayName || ''} onClose={() => setRoleFor('')} />}
      {chatFor && <ChatDialog userId={chatFor.id} name={chatFor.name} photoUrl={chatFor.photoUrl} onClose={() => setChatFor(null)} />}
      {assignOpen && <AssignKurel members={members.map((m) => ({ id: m.id, name: m.displayName, memberId: m.memberId, photoUrl: m.photoUrl, kurels: (memberships[m.id] ?? []).map((k) => k.groupId) }))} headcount={headcount} initialId={assignOpen.id} onClose={() => setAssignOpen(null)} />}
      <ManageToggle hideButton title={tx("Manage members — add, import, edit, assign")} openSignal={manageSignal} closeSignal={closeSignal}>
        <MembersManage onAssign={() => setAssignOpen({ id: selected?.id ?? '' })} onExport={exportList} view={manageView} openEdit={editRequest} openAdd={addRequest} onEditDone={() => { setEditRequest({ id: '', n: 0 }); setCloseSignal((n) => n + 1); }} />
      </ManageToggle>
    </>
  );
}

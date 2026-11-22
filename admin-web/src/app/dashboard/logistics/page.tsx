'use client';

import '../../px/outils-de-gestion.css';
import { useEffect, useMemo, useState } from 'react';
import { collection, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { reviewResourceRequest } from '@/lib/functions';
import { fmt } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import ManageToggle from '../../px/ManageToggle';
import LogisticsManage from './Manage';
import { CxBanner } from '@/components/Cx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, Building2, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, History, MapPin, Package, Plus, Search, Truck, Users, AlertTriangle, BarChart3, Layers } from 'lucide-react';
import { where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import Dropdown from '@/components/Dropdown';
import { CxBar, CxCard, CxPill, CxStats, CxTabs } from '@/components/Cx';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Category = 'music_equipment' | 'books' | 'instruments' | 'furniture' | 'transportation' | 'food' | 'other';
interface Item {
  id: string;
  name: string;
  category: Category;
  levelId?: string;
  quantity?: number;
  total?: number;
  inUse?: number;
  status: 'active' | 'retired';
}
interface Req {
  id: string;
  groupId: string;
  items: string;
  category: Category;
  quantity?: number;
  purpose?: string;
  neededMs: number;
  stage: string;
  delivery?: string;
  history: { action: string; actorName: string; comment?: string }[];
}

const CATEGORY: Record<Category, string> = {
  music_equipment: 'Music equipment',
  books: 'Books',
  instruments: 'Instruments',
  furniture: 'Furniture',
  transportation: 'Transportation',
  food: 'Food / refreshments',
  other: 'Other supplies',
};
const STAGE: Record<string, string> = {
  admin_review: 'Awaiting Admin',
  zone_manager_review: 'Awaiting Zone lead',
  top_management_review: 'Awaiting Leadership',
  approved: 'Approved',
  rejected: 'Rejected',
};
const abbr = (s: string) => s.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '—';

/** Logistics management — the approved layout on Firebase data (equipment catalog + requests). */
export default function LogisticsPage() {
  const { byId, countries } = useGroupHierarchy();
  const { byId: levelById } = useLevels();
  const [items, setItems] = useState<Item[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [manageSignal, setManageSignal] = useState(0);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'equipment'), orderBy('name')), (snap) =>
      setItems(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? '',
          category: d.data().category as Category,
          levelId: (d.data().levelId as string) || undefined,
          quantity: typeof d.data().quantityAvailable === 'number' ? (d.data().quantityAvailable as number) : undefined,
          total: typeof d.data().quantityTotal === 'number' ? (d.data().quantityTotal as number) : undefined,
          inUse: typeof d.data().quantityInUse === 'number' ? (d.data().quantityInUse as number) : undefined,
          status: (d.data().status as 'active' | 'retired') ?? 'active',
        }))
      )
    );
    const u2 = onSnapshot(query(collection(db, 'resourceRequests'), orderBy('createdAt', 'desc'), fsLimit(300)), (snap) =>
      setRequests(
        snap.docs.map((d) => ({
          id: d.id,
          groupId: d.data().groupId as string,
          items: (d.data().itemsDescription as string) ?? '',
          category: d.data().category as Category,
          quantity: d.data().quantity as number | undefined,
          purpose: d.data().purpose as string | undefined,
          neededMs: (d.data().neededAt as Timestamp | undefined)?.toMillis?.() ?? 0,
          stage: (d.data().stage as string) ?? 'admin_review',
          delivery: d.data().deliveryLocation as string | undefined,
          history: ((d.data().history as Req['history']) ?? []),
        }))
      )
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const byCategory = useMemo(() => {
    const m = new Map<Category, { items: number; qty: number }>();
    items.filter((i) => i.status === 'active').forEach((i) => {
      const cur = m.get(i.category) ?? { items: 0, qty: 0 };
      m.set(i.category, { items: cur.items + 1, qty: cur.qty + (i.quantity ?? 0) });
    });
    return [...m.entries()].sort((a, b) => b[1].items - a[1].items).slice(0, 6);
  }, [items]);

  const pending = requests.filter((r) => r.stage.endsWith('_review'));
  const approved = requests.filter((r) => r.stage === 'approved');
  const rejected = requests.filter((r) => r.stage === 'rejected');
  const selected = requests.find((r) => r.id === selectedId) ?? requests[0];

  const rows = items.filter((i) => {
    if (type && i.category !== type) return false;
    if (state === 'retired' && i.status !== 'retired') return false;
    if (state === 'active' && i.status !== 'active') return false;
    if (state === 'low' && !(i.quantity !== undefined && i.quantity <= 2)) return false;
    const term = search.trim().toLowerCase();
    return !term || i.name.toLowerCase().includes(term);
  });
  const low = items.filter((i) => i.status === 'active' && i.quantity !== undefined && i.quantity <= 2);
  const noLevel = items.filter((i) => !i.levelId).length;

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await reviewResourceRequest({ requestId: id, decision });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not record the decision', 'error');
    } finally {
      setBusy(false);
    }
  }


  const router = useRouter();
  const [tab, setTab] = useState('inventory');
  const [reqTab, setReqTab] = useState('pending');
  const [fCountry, setFCountry] = useState('');
  const [fCity, setFCity] = useState('');
  const [fZone, setFZone] = useState('');
  const [fLocal, setFLocal] = useState('');
  const [fCat, setFCat] = useState('');
  const [fState, setFState] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [roomSel, setRoomSel] = useState('');
  const { cities, locationOf } = useGroupHierarchy();
  const zonesRaw = useZones();
  const localZones = useCollection<{ name: string; cityId: string }>('localZones', []);
  const tasks = useCollection<{ status: string; itemsDescription?: string; groupId?: string; assignedToName?: string; resourceRequestId?: string; completedAt?: Timestamp; returnDueAt?: Timestamp }>('logisticsTasks', []);
  const rehearsals = useCollection<{ title: string; startAt: Timestamp; endAt: Timestamp; status: string; location?: { address?: string }; subGroupIds?: string[] }>('events', [where('kind', '==', 'rehearsal')], 'rh');
  const countryOpts = countries.map((c) => ({ value: c.id, label: c.name }));
  const cityOpts = cities.filter((c) => (!fCountry || c.parentGroupId === fCountry) && (!fZone || c.zoneId === fZone)).map((c) => ({ value: c.id, label: c.name }));
  const zoneOpts = (zonesRaw ?? []).filter((z) => !fCountry || z.countryId === fCountry).map((z) => ({ value: z.id, label: z.name }));
  const localOpts = (localZones ?? []).filter((z) => (!fCity || z.cityId === fCity) && (!fCountry || cities.find((c) => c.id === z.cityId)?.parentGroupId === fCountry) && (!fZone || cities.find((c) => c.id === z.cityId)?.zoneId === fZone)).map((z) => ({ value: z.id, label: z.name }));
  const cityInScope = (cityId?: string) => {
    const c = cities.find((x) => x.id === cityId);
    if (!c) return !fCountry && !fCity && !fZone;
    return (!fCity || c.id === fCity) && (!fCountry || c.parentGroupId === fCountry) && (!fZone || c.zoneId === fZone);
  };
  const inScope = (groupId: string) => {
    if (!fCountry && !fCity && !fZone && !fLocal) return true;
    const g = byId[groupId]; if (!g) return false;
    if (fLocal && g.localZoneId !== fLocal) return false;
    return cityInScope(locationOf(groupId).city?.id);
  };
  const scopedReq = requests.filter((r) => inScope(r.groupId));
  const totalQty = items.filter((i) => i.status === 'active').reduce((a, i) => a + (i.quantity ?? 0), 0);
  const activeAssign = (tasks ?? []).filter((t) => ['assigned', 'preparing', 'dispatched'].includes(t.status));
  const delivered = (tasks ?? []).filter((t) => t.status === 'delivered');
  const returned = (tasks ?? []).filter((t) => t.status === 'completed');
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 864e5;
  const roomsAll = (localZones ?? []).filter((z) => (!fLocal || z.id === fLocal) && cityInScope(z.cityId));
  const roomNames = roomsAll.map((z) => z.id);
  const roomName = (id: string) => roomsAll.find((z) => z.id === id)?.name ?? '';
  const todayBy = (room: string) => (rehearsals ?? []).find((r) => r.status !== 'cancelled' && r.startAt.toMillis() < dayEnd && r.endAt.toMillis() >= dayStart.getTime() && (r.subGroupIds ?? []).some((g) => byId[g]?.localZoneId === room));
  const booked = roomNames.filter((n) => todayBy(n)).length;
  const hm = (t: Timestamp) => new Date(t.toMillis()).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  const catRows = (Object.keys(CATEGORY) as Category[]).map((c) => {
    const list = items.filter((i) => i.status === 'active' && i.category === c);
    return { c, n: list.length, qty: list.reduce((a, i) => a + (i.quantity ?? 0), 0), used: list.reduce((a, i) => a + (i.inUse ?? 0), 0), low: list.filter((i) => i.quantity !== undefined && i.quantity <= 2).length };
  }).sort((a, b) => b.n - a.n).slice(0, 5);
  const nowMs = Date.now();
  const overdue = (tasks ?? []).filter((t) => t.status === 'delivered' && t.returnDueAt && t.returnDueAt.toMillis() < nowMs && !t.completedAt).length;
  const reqByCat = (Object.keys(CATEGORY) as Category[]).map((c) => ({ c, n: scopedReq.filter((r) => r.category === c).length })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  const reqShown = reqTab === 'pending' ? scopedReq.filter((r) => r.stage.endsWith('_review')) : reqTab === 'approved' ? scopedReq.filter((r) => r.stage === 'approved') : reqTab === 'delivered' ? scopedReq.filter((r) => delivered.some((t) => t.resourceRequestId === r.id)) : scopedReq.filter((r) => returned.some((t) => t.resourceRequestId === r.id));
  const invRows = rows.filter((i) => (!fCat || i.category === fCat));
  const stateOf = (i: Item) => (i.status === 'retired' ? 'retired' : i.quantity !== undefined && i.quantity <= 2 ? 'low' : 'ok');
  const fmtD = (ms: number) => (ms ? new Date(ms).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

  const steps = (r: Req) => {
    const done = r.stage === 'approved' || r.stage === 'rejected';
    return [
      { t: 'Request recorded', s: 'Need, quantity, kurel, dates and justification', st: 'Completed', cls: '' },
      { t: 'Admin review', s: 'Stock, condition and level eligibility check', st: r.stage === 'admin_review' ? 'In progress' : 'Completed', cls: r.stage === 'admin_review' ? 'pending' : '' },
      { t: 'Zone lead / Leadership', s: 'Local reservation, transfer or escalation', st: r.stage === 'zone_manager_review' || r.stage === 'top_management_review' ? 'In progress' : done ? 'Completed' : 'Upcoming', cls: r.stage === 'admin_review' ? 'locked' : r.stage.includes('review') ? 'pending' : '' },
      { t: 'Handover and responsibility', s: 'Delivery task created after final approval', st: r.stage === 'approved' ? 'Completed' : 'Upcoming', cls: r.stage === 'approved' ? '' : 'locked' },
    ];
  };

  return (
    <>
      <div className="px px-lg">
        <div className="cx-page lg">
          <CxBanner icon={<Truck size={26} />} kicker={tx("Logistics")} title={tx("Logistics management")} sub={tx("Inventory, room booking, requests, assignments and delivery follow-up.")}>
            <button type="button" className="cx-btn gold" onClick={() => setManageSignal((n) => n + 1)}><Plus size={16} />{tx("Request equipment")}</button>
            <button type="button" className="cx-btn ghost-light" onClick={() => router.push('/dashboard/rehearsals')}><CalendarDays size={16} />{tx("Book a room")}</button>
            <button type="button" className="cx-btn ghost-light" onClick={() => setManageSignal((n) => n + 1)}><Truck size={16} />{tx("Delivery tasks")}</button>
          </CxBanner>
          <CxTabs value={tab} onChange={(v) => { setTab(v); if (v === 'requests') setReqTab('pending'); document.getElementById('lg-' + v)?.scrollIntoView({ behavior: 'smooth' }); }} items={[
            { value: 'inventory', label: tx("Inventory"), icon: <Package size={14} /> },
            { value: 'requests', label: tx("Requests"), icon: <ClipboardList size={14} />, count: pending.length },
            { value: 'rooms', label: tx("Room booking"), icon: <CalendarDays size={14} /> },
            { value: 'history', label: tx("History"), icon: <History size={14} /> },
          ]} />
          <CxStats items={[
            { label: tx("Sites tracked"), value: (localZones ?? []).length, sub: `${countries.length} ${tx("countries")} · ${cities.length} ${tx("cities")} · ${(zonesRaw ?? []).length} ${tx("zones")}`, icon: <MapPin size={18} />, tone: 'green', onClick: () => router.push('/dashboard/locations') },
            { label: tx("Total inventory items"), value: fmt(totalQty), sub: tx("Across all sites"), icon: <Package size={18} />, tone: 'amber', onClick: () => router.push('/dashboard/equipment') },
            { label: tx("Open requests"), value: fmt(scopedReq.filter((r) => r.stage.endsWith("_review")).length), sub: tx("Awaiting approval or delivery"), icon: <ClipboardList size={18} />, tone: 'violet', onClick: () => router.push('/dashboard/resource-requests') },
            { label: tx("Rooms available today"), value: `${Math.max(roomNames.length - booked, 0)} / ${roomNames.length}`, sub: tx("Rehearsal rooms"), icon: <CalendarDays size={18} />, tone: 'blue', onClick: () => router.push('/dashboard/rehearsals') },
            { label: tx("Active assignments"), value: fmt(activeAssign.length), sub: tx("Items currently in use"), icon: <Users size={18} />, tone: 'teal', onClick: () => setManageSignal((n) => n + 1) },
          ]} />

          <div className="cx-filters lg-filters">
            <div className="lg-loc"><MapPin size={20} /><div><b>{tx("Location")}</b><small>{tx("view requests by place")}</small></div></div>
            <Dropdown label={tx("Country")} value={fCountry} onChange={(v) => { setFCountry(v); setFZone(''); setFCity(''); setFLocal(''); }} allLabel={tx("All countries")} options={countryOpts} />
            <Dropdown label={tx("City")} value={fCity} onChange={(v) => { setFCity(v); setFLocal(''); }} allLabel={tx("All cities")} options={cityOpts} />
            <Dropdown label={tx("Zone")} value={fZone} onChange={(v) => { setFZone(v); setFCity(''); setFLocal(''); }} allLabel={tx("All zones")} options={zoneOpts} />
            <Dropdown label={tx("Local zone / Site")} value={fLocal} onChange={setFLocal} allLabel={tx("All sites")} options={localOpts} />
            <Dropdown label={tx("Category")} value={fCat} onChange={setFCat} allLabel={tx("All categories")} options={(Object.keys(CATEGORY) as Category[]).map((c) => ({ value: c, label: tx(CATEGORY[c]) }))} />
            <Dropdown label={tx("Availability status")} value={state} onChange={setState} allLabel={tx("All statuses")} options={[{ value: 'active', label: tx("Available") }, { value: 'low', label: tx("Low stock") }, { value: 'retired', label: tx("Retired") }]} />
            <label className="cx-search"><Search size={16} /><input type="search" placeholder={tx("Search item, room, group...")} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          </div>

          <CxCard icon={<Layers size={18} />} title={tx("Inventory by category")} sub={fLocal ? localOpts.find((o) => o.value === fLocal)?.label : fCity ? cities.find((c) => c.id === fCity)?.name : fZone ? zoneOpts.find((o) => o.value === fZone)?.label : fCountry ? countries.find((c) => c.id === fCountry)?.name : tx("Whole world")} right={<button type="button" className="cx-btn sm ghost" onClick={() => router.push('/dashboard/equipment')}>{tx("View full inventory")} <ChevronRight size={14} /></button>}>
            <div className="lg-cats">
              {catRows.map((r) => (
                <button type="button" key={r.c} className={`lg-cat${fCat === r.c ? ' on' : ''}`} onClick={() => setFCat(fCat === r.c ? '' : r.c)}>
                  <i><Boxes size={20} /></i><span>{tx(CATEGORY[r.c])}</span><b>{fmt(r.qty || r.n)}</b>
                  <small>{fmt(r.qty)} {tx("available")} · {fmt(r.used)} {tx("in use")}{r.low > 0 && <em> · {tx("Low stock")}</em>}</small>
                </button>
              ))}
              <button type="button" className="lg-cat" onClick={() => router.push('/dashboard/rehearsals')}>
                <i><CalendarDays size={20} /></i><span>{tx("Rooms")}</span><b>{fmt(roomNames.length)}</b>
                <small>{fmt(Math.max(roomNames.length - booked, 0))} {tx("available today")} · {fmt(booked)} {tx("booked")}</small>
              </button>
            </div>
          </CxCard>

          <div className="cx-grid cx-g32 lg-main">
            <CxCard id="lg-inventory" dark icon={<Package size={18} />} title={tx("Site inventory")} sub={`${invRows.length} ${tx("items shown")}`} right={<button type="button" className="cx-btn sm ghost-light" onClick={() => router.push('/dashboard/equipment')}>{tx("Manage")}</button>}>
              <div className="cx-scroll"><table className="cx-table lg-table">
                <thead><tr><th>{tx("Item name")}</th><th>{tx("Category")}</th><th>{tx("Qty total")}</th><th>{tx("Available now")}</th><th>{tx("Assigned / In use")}</th><th>{tx("Level / Scope")}</th><th>{tx("Status")}</th><th>{tx("Action")}</th></tr></thead>
                <tbody>
                  {invRows.length === 0 && <tr><td colSpan={8} className="cx-empty">{tx("No equipment yet.")}</td></tr>}
                  {invRows.slice(0, 12).map((i) => (
                    <tr key={i.id}>
                      <td className="lg-lnk" onClick={() => router.push('/dashboard/equipment')}><span className="lg-ico"><Package size={15} /></span><b>{i.name}</b></td>
                      <td className="lg-lnk" onClick={() => setFCat(i.category)}>{tx(CATEGORY[i.category] ?? i.category)}</td>
                      <td className="lg-lnk" onClick={() => router.push('/dashboard/equipment')}>{i.total ?? (i.quantity !== undefined && i.inUse !== undefined ? i.quantity + i.inUse : '—')}</td>
                      <td className="lg-lnk" onClick={() => router.push('/dashboard/equipment')}>{i.quantity ?? '—'}</td>
                      <td className="lg-lnk" onClick={() => router.push('/dashboard/equipment')}>{i.inUse ?? '—'}</td>
                      <td className="lg-lnk" onClick={() => router.push('/dashboard/levels')}>{i.levelId && levelById[i.levelId] ? <span className="lg-chip">{levelById[i.levelId].name}</span> : <span className="lg-chip">{tx("No level")}</span>}</td>
                      <td className="lg-lnk" onClick={() => setState(stateOf(i) === 'retired' ? 'retired' : stateOf(i) === 'low' ? 'low' : 'active')}>{stateOf(i) === 'retired' ? <CxPill tone="red" dot>{tx("Retired")}</CxPill> : stateOf(i) === 'low' ? <CxPill tone="amber" dot>{tx("Low stock")}</CxPill> : <CxPill tone="green" dot>{tx("Available")}</CxPill>}</td>
                      <td><button type="button" className="cx-btn sm" onClick={() => setManageSignal((n) => n + 1)}>{tx("Assign")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </CxCard>

            <CxCard id="lg-requests" dark icon={<ClipboardList size={18} />} title={tx("Requests & room bookings")} sub={tx("Requests, approvals, deliveries and rehearsal room reservations.")}>
              <div className="lg-rq-head"><b>{tx("Request queue")}</b><button type="button" className="lg-link" onClick={() => router.push('/dashboard/resource-requests')}>{tx("View all requests")} <ChevronRight size={13} /></button></div>
              <CxTabs value={reqTab} onChange={setReqTab} items={[
                { value: 'pending', label: `${tx("Pending")} (${scopedReq.filter((r) => r.stage.endsWith('_review')).length})` },
                { value: 'approved', label: `${tx("Approved")} (${scopedReq.filter((r) => r.stage === 'approved').length})` },
                { value: 'delivered', label: `${tx("Delivered")} (${scopedReq.filter((r) => delivered.some((t) => t.resourceRequestId === r.id)).length})` },
                { value: 'returned', label: `${tx("Returned")} (${scopedReq.filter((r) => returned.some((t) => t.resourceRequestId === r.id)).length})` },
              ]} />
              <div className="lg-reqs">
                {reqShown.length === 0 && <p className="cx-empty">{tx("No requests yet.")}</p>}
                {reqShown.slice(0, 4).map((r) => (
                  <div className="lg-req lg-lnk" key={r.id} onClick={() => router.push('/dashboard/resource-requests')}>
                    <span className="lg-ico lg">{abbr(r.items)}</span>
                    <div><b>{tx("Request for")} {r.items}</b><small><Link href="/dashboard/groups" onClick={(e) => e.stopPropagation()}>{byId[r.groupId]?.name ?? r.groupId}</Link></small>
                      <small><MapPin size={11} /> {(() => { const l = locationOf(r.groupId) as { country?: { name: string }; city?: { name: string } } | undefined; return [l?.country?.name, l?.city?.name].filter(Boolean).join(' – ') || '—'; })()} <CalendarDays size={11} /> {tx("Needed")}: {fmtD(r.neededMs)}</small></div>
                    <div className="lg-req-r">
                      <CxPill tone={r.stage === 'approved' ? 'green' : r.stage === 'rejected' ? 'red' : 'amber'}>{tx(STAGE[r.stage] ?? r.stage)}</CxPill>
                      {r.stage.endsWith('_review') && <span className="lg-act" onClick={(e) => e.stopPropagation()}><button type="button" className="cx-btn sm ok" disabled={busy} onClick={() => decide(r.id, 'approve')}>{tx("Approve")}</button><button type="button" className="cx-btn sm red" disabled={busy} onClick={() => decide(r.id, 'reject')}>{tx("Reject")}</button></span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="lg-rq-head" id="lg-rooms"><b><CalendarDays size={15} /> {tx("Rehearsal room booking")}</b><button type="button" className="lg-link" onClick={() => router.push('/dashboard/rehearsals')}>{tx("Manage rooms")} <ChevronRight size={13} /></button></div>
              <table className="cx-table lg-rooms">
                <thead><tr><th>{tx("Room")}</th><th>{tx("Today's schedule")}</th><th>{tx("Status")}</th></tr></thead>
                <tbody>
                  {roomNames.length === 0 && <tr><td colSpan={3} className="cx-empty">{tx("No local zone yet. Create one in Local zones.")}</td></tr>}
                  {roomNames.slice(0, 6).map((n) => { const b = todayBy(n); return (
                    <tr key={n} className={roomSel === n ? 'sel' : ''} onClick={() => { setRoomSel(n); router.push('/dashboard/rehearsals'); }}>
                      <td><Users size={14} /> <b>{roomName(n)}</b></td>
                      <td>{b ? `${hm(b.startAt)} – ${hm(b.endAt)} · ${b.title}` : <span className="lg-free">{tx("Available")}</span>}</td>
                      <td>{b ? <CxPill tone="red">{tx("Booked")}</CxPill> : <CxPill tone="green">{tx("Available")}</CxPill>}</td>
                    </tr>); })}
                </tbody>
              </table>
              <button type="button" className="cx-btn green lg-book" onClick={() => router.push('/dashboard/rehearsals')}><CalendarDays size={16} />{tx("Book selected room")}</button>
            </CxCard>
          </div>

          <div className="cx-grid cx-g3 lg-bottom">
            <CxCard id="lg-history" icon={<History size={18} />} title={tx("Recent allocations / usage history")} sub={tx("Traceability of equipment and room usage.")} right={<button type="button" className="lg-link" onClick={() => setManageSignal((n) => n + 1)}>{tx("View full history")} <ChevronRight size={13} /></button>}>
              <table className="cx-table">
                <thead><tr><th>{tx("Item")}</th><th>{tx("Group / Requester")}</th><th>{tx("Site")}</th><th>{tx("Date returned")}</th><th>{tx("Status")}</th></tr></thead>
                <tbody>
                  {(tasks ?? []).length === 0 && <tr><td colSpan={5} className="cx-empty">{tx("No allocations yet.")}</td></tr>}
                  {(tasks ?? []).slice(0, 5).map((t) => { const l = t.groupId ? (locationOf(t.groupId) as { city?: { name: string } } | undefined) : undefined; return (
                    <tr key={t.id} className="lg-lnk" onClick={() => setManageSignal((n) => n + 1)}><td><b>{t.itemsDescription || '—'}</b></td><td onClick={(e) => { e.stopPropagation(); router.push('/dashboard/groups'); }}>{t.groupId ? byId[t.groupId]?.name ?? '—' : '—'}</td><td onClick={(e) => { e.stopPropagation(); router.push('/dashboard/locations'); }}>{l?.city?.name ?? '—'}</td><td>{t.completedAt ? fmtD(t.completedAt.toMillis()) : '—'}</td>
                      <td><CxPill tone={t.status === 'completed' || t.status === 'delivered' ? 'green' : t.status === 'pending' ? 'amber' : 'blue'}>{tx(t.status)}</CxPill></td></tr>); })}
                </tbody>
              </table>
            </CxCard>
            <CxCard icon={<AlertTriangle size={18} />} title={tx("Priority alerts")} sub={tx("Items, rooms or tasks needing attention.")}>
              <div className="lg-alerts">
                <div className="lg-lnk" onClick={() => { setState('low'); document.getElementById('lg-inventory')?.scrollIntoView({ behavior: 'smooth' }); }}><i><Package size={16} /></i><span><b>{tx("Low stock items")}</b><small>{low.length} {tx("items below threshold")}</small></span><em className="r">{low.length}</em></div>
                <div className="lg-lnk" onClick={() => setManageSignal((n) => n + 1)}><i><History size={16} /></i><span><b>{tx("Overdue returns")}</b><small>{overdue} {tx("items not returned on time")}</small></span><em className="r">{overdue}</em></div>
                <div className="lg-lnk" onClick={() => router.push('/dashboard/rehearsals')}><i><CalendarDays size={16} /></i><span><b>{tx("Unavailable rooms")}</b><small>{booked} {tx("rooms fully booked today")}</small></span><em className="r">{booked}</em></div>
                <div className="lg-lnk" onClick={() => setManageSignal((n) => n + 1)}><i><Truck size={16} /></i><span><b>{tx("Pending delivery tasks")}</b><small>{(tasks ?? []).filter((t) => t.status === 'pending').length} {tx("approved requests awaiting delivery")}</small></span><em className="r">{(tasks ?? []).filter((t) => t.status === 'pending').length}</em></div>
              </div>
            </CxCard>
            <CxCard icon={<BarChart3 size={18} />} title={tx("Most requested items")} sub={tx("Top categories by number of requests.")}>
              <div className="lg-top">
                {reqByCat.length === 0 && <p className="cx-empty">{tx("No requests yet.")}</p>}
                {reqByCat.map((r) => (<div key={r.c} className="lg-lnk" onClick={() => router.push('/dashboard/resource-requests')}><span>{tx(CATEGORY[r.c])}</span><CxBar pct={(r.n / reqByCat[0].n) * 100} tone="gold" /><b>{r.n}</b></div>))}
              </div>
            </CxCard>
          </div>
        </div>
      </div>

      <ManageToggle title={tx("Manage logistics — delivery tasks")} openSignal={manageSignal}>
        <LogisticsManage />
      </ManageToggle>
    </>
  );
}

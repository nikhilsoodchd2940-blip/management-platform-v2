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
import { Truck } from 'lucide-react';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Category = 'music_equipment' | 'books' | 'instruments' | 'furniture' | 'transportation' | 'food' | 'other';
interface Item {
  id: string;
  name: string;
  category: Category;
  levelId?: string;
  quantity?: number;
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
      <div className="px px-outils-de-gestion">
        <div className="content">
          <CxBanner icon={<Truck size={26} />} kicker={tx("Logistics")} title={tx("Logistics management")} sub={tx("Equipment catalog, equipment requests, assignments and delivery.")}>
            <button type="button" className="cx-btn gold" onClick={() => setManageSignal((n) => n + 1)}>{tx("+ Request equipment")}</button>
          </CxBanner>

          <section className="card hero">
            <div className="hero-top">
              <div>
                <h2>{tx("Global control center")}</h2>
                <p>{tx("Every item has a level, a category and a quantity. Kurels can only request items their level allows.")}</p>
              </div>
              <div className="hero-actions">
                <button type="button" className="secondary" onClick={() => setManageSignal((n) => n + 1)}>{tx("Delivery tasks")}</button>
                <button type="button" className="primary" onClick={() => (window.location.href = '/dashboard/equipment')}>{tx("Equipment catalog")}</button>
              </div>
            </div>
            <div className="scope">
              <div><span>{tx("Scope")}</span><strong>{tx("Whole world")}</strong><small>{countries.length} {countries.length === 1 ? tx("country") : tx("countries")}</small></div>
              <div><span>{tx("Catalog items")}</span><strong>{fmt(items.length)}</strong><small>{noLevel} {tx("without a level")}</small></div>
              <div><span>{tx("Open requests")}</span><strong>{fmt(pending.length)}</strong><small>{tx("Awaiting a decision")}</small></div>
              <div><span>{tx("Responsible")}</span><strong>{tx("Logistics")}</strong><small>{tx("Administrators")}</small></div>
            </div>
          </section>

          <div className="kpis">
            {byCategory.length === 0 && <article className="card kpi"><span>{tx("No equipment")}</span><strong>—</strong><small>&nbsp;</small></article>}
            {byCategory.map(([c, v]) => (
              <article className="card kpi" key={c}><span>{CATEGORY[c]}</span><strong>{fmt(v.qty || v.items)}</strong><small>{v.items} {tx("item")}{v.items === 1 ? '' : 's'} {tx("in the catalog")}</small></article>
            ))}
          </div>

          <section className="card request-center">
            <div className="request-head">
              <div><h2>{tx("Equipment requests")}</h2><p>{tx("From the stated need to handover, return and final check.")}</p></div>
              <div className="request-head-actions"><button type="button" className="primary openRequest" onClick={() => setManageSignal((n) => n + 1)}>{tx("+ New request")}</button></div>
            </div>
            <div className="request-stats">
              <div className="request-stat"><span>{tx("Pending")}</span><strong>{fmt(pending.length)}</strong><small>{tx("Awaiting a decision")}</small></div>
              <div className="request-stat"><span>{tx("Approved")}</span><strong>{fmt(approved.length)}</strong><small>{tx("Delivery created")}</small></div>
              <div className="request-stat"><span>{tx("Rejected")}</span><strong>{fmt(rejected.length)}</strong><small>{tx("Closed")}</small></div>
            </div>
            <div className="request-body">
              <div className="pane">
                <h3>{tx("Request queue")}</h3>
                <p>{requests.length} {tx("recent request")}{requests.length === 1 ? '' : 's'}</p>
                <div className="request-list">
                  {requests.length === 0 && <div className="empty" style={{ display: 'block' }}>{tx("No requests yet.")}</div>}
                  {requests.slice(0, 12).map((r) => (
                    <button type="button" key={r.id} className={`request-item${selected?.id === r.id ? ' selected' : ''}`} onClick={() => setSelectedId(r.id)}>
                      <b>{abbr(r.items)}</b>
                      <div><strong>{r.items}</strong><span>{byId[r.groupId]?.name ?? r.groupId}</span></div>
                      <small>{STAGE[r.stage] ?? r.stage}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pane">
                <h3>{tx("Request processing")}</h3>
                <p>{tx("Availability, decision, handover and controlled return")}</p>
                {selected ? (
                  <>
                    <div className="detail-top">
                      <div><span>{CATEGORY[selected.category] ?? selected.category}</span><strong>{selected.items}</strong><small>{byId[selected.groupId]?.name ?? selected.groupId}</small></div>
                      <span className="status">{STAGE[selected.stage] ?? selected.stage}</span>
                    </div>
                    <div className="facts">
                      <div><span>{tx("Quantity")}</span><strong>{selected.quantity ?? '—'}</strong></div>
                      <div><span>{tx("Needed by")}</span><strong>{selected.neededMs ? new Date(selected.neededMs).toLocaleDateString(dateLocale()) : '—'}</strong></div>
                      <div><span>{tx("Delivery")}</span><strong>{selected.delivery || '—'}</strong></div>
                      <div><span>{tx("Purpose")}</span><strong>{selected.purpose || '—'}</strong></div>
                    </div>
                    <div className="route">
                      {steps(selected).map((s, i) => (
                        <div className={`step ${s.cls}`} key={i}><b>{i + 1}</b><div><strong>{s.t}</strong><span>{s.s}</span></div><small>{s.st}</small></div>
                      ))}
                    </div>
                    {selected.stage.endsWith('_review') && (
                      <div className="actions">
                        <button type="button" className="primary" disabled={busy} onClick={() => decide(selected.id, 'approve')}>{tx("Approve")}</button>
                        <button type="button" className="secondary" disabled={busy} onClick={() => decide(selected.id, 'reject')}>{tx("Reject")}</button>
                      </div>
                    )}
                    <div className="rule"><strong>{tx("Rule:")}</strong> {tx("a request moves from the admin review to the zone lead, then to the leadership when needed. Items must be within the kurel’s level.")}</div>
                  </>
                ) : (
                  <p>{tx("No request selected.")}</p>
                )}
              </div>
            </div>
          </section>

          <div className="inventory-grid">
            <section className="card panel">
              <div className="panel-head">
                <div><h2>{tx("Equipment register")}</h2><p>{rows.length} {tx("item")}{rows.length === 1 ? '' : 's'} {tx("shown")}</p></div>
                <button type="button" className="secondary" onClick={() => (window.location.href = '/dashboard/equipment')}>{tx("Manage")}</button>
              </div>
              <div className="filters">
                <input type="search" placeholder={tx("Item")} value={search} onChange={(e) => setSearch(e.target.value)} />
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{tx("All types")}</option>
                  {(Object.keys(CATEGORY) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}
                </select>
                <select disabled><option>{tx("All countries")}</option></select>
                <select value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="">{tx("All states")}</option>
                  <option value="active">{tx("Active")}</option>
                  <option value="low">{tx("Low stock")}</option>
                  <option value="retired">{tx("Retired")}</option>
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{tx("Item")}</th><th>{tx("Category")}</th><th>{tx("Quantity")}</th><th>{tx("Level")}</th><th>{tx("Availability")}</th></tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={5}>{tx("No equipment yet.")}</td></tr>}
                    {rows.map((i) => (
                      <tr key={i.id}>
                        <td><div className="asset"><b>{abbr(i.name)}</b><div><strong>{i.name}</strong></div></div></td>
                        <td>{CATEGORY[i.category] ?? i.category}</td>
                        <td>{i.quantity ?? '—'}</td>
                        <td>{i.levelId && levelById[i.levelId] ? levelById[i.levelId].name : tx("No level")}</td>
                        <td>{i.status === 'retired' ? <span className="status red">{tx("Retired")}</span> : i.quantity !== undefined && i.quantity <= 2 ? <span className="status gold">{tx("Low stock")}</span> : <span className="status">{tx("Available")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <aside className="card panel">
              <div className="panel-head"><div><h2>{tx("Priority alerts")}</h2><p>{tx("Actions needed")}</p></div></div>
              <div className="alerts">
                {low.length === 0 && noLevel === 0 && pending.length === 0 && <div className="alert"><strong>{tx("No alerts")}</strong><span>{tx("Everything is in order.")}</span></div>}
                {low.length > 0 && <div className="alert red"><strong>{low.length} {tx("item")}{low.length > 1 ? 's' : ''} {tx("with low stock")}</strong><span>{low.slice(0, 2).map((i) => i.name).join(', ')}</span></div>}
                {pending.length > 0 && <div className="alert"><strong>{pending.length} {tx("request")}{pending.length > 1 ? 's' : ''} {tx("awaiting a decision")}</strong><span>{tx("Review them in the queue.")}</span></div>}
                {noLevel > 0 && <div className="alert"><strong>{noLevel} {tx("item")}{noLevel > 1 ? 's' : ''} {tx("without a level")}</strong><span>{tx("No kurel can request them yet.")}</span></div>}
              </div>
            </aside>
          </div>
        </div>
      </div>

      <ManageToggle title={tx("Manage logistics — delivery tasks")} openSignal={manageSignal}>
        <LogisticsManage />
      </ManageToggle>
    </>
  );
}

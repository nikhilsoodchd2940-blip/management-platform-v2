'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useCollection } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { listEventBooks, type EventBookRow } from '@/lib/functions';
import { notify } from '@/lib/notify';
import Dropdown from '@/components/Dropdown';
import MemberPicker, { Avatar } from '@/components/MemberPicker';
import { PersonLink, ViewProfile } from '@/components/MemberProfile';
import PlaceSearch from '@/components/PlaceSearch';
import MapPicker, { type MapValue } from '@/components/MapPicker';
import { ACCESS_ROLES, KUREL_ROLES } from '../role-access/roles';
import { tx, txf } from '@/lib/i18n/tr';

/* ---------- shared types ---------- */
export type DocKind = 'file' | 'link' | 'audio' | 'book' | 'event_book';
export interface DocDraft { title: string; url: string; kind: DocKind }
export interface PointDraft { id?: string; title: string; minutes: string; description: string; owner: string; docs: DocDraft[] }
export const blankPoint = (): PointDraft => ({ title: '', minutes: '10', description: '', owner: '', docs: [] });

/** Splits the available minutes equally between the points: the first ones get the extra minute when it does not divide evenly. */
export function autoSplit(count: number, total: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/* ---------- documents and media ---------- */
const KIND_LABEL: Record<DocKind, string> = tProxy({ file: 'File', link: 'Link', audio: 'Audio', book: 'Book', event_book: 'Event book' }) as Record<DocKind, string>;

function DocPicker({ onAdd, onClose }: { onAdd: (d: DocDraft) => void; onClose: () => void }) {
  const [tab, setTab] = useState<DocKind>('file');
  const [q, setQ] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const audio = useCollection<{ title?: string; qacaidTitle?: string; melodyLabel?: string; fileUrl: string; status?: string }>('audioTracks', tab === 'audio' ? [orderBy('createdAt', 'desc'), fsLimit(300)] : [fsLimit(1)], tab);
  const editions = useCollection<{ qacaidId: string; label: string; fileUrl: string }>('qacaidEditions', tab === 'book' ? [orderBy('createdAt', 'desc'), fsLimit(300)] : [fsLimit(1)], tab);
  const qacaid = useCollection<{ code?: string; title?: string }>('qacaid', tab === 'book' ? [orderBy('code', 'asc')] : [fsLimit(1)], tab);
  const [eventBooks, setEventBooks] = useState<EventBookRow[] | null>(null);
  useEffect(() => {
    if (tab !== 'event_book' || eventBooks) return;
    listEventBooks({}).then((r) => setEventBooks(r.data.books)).catch(() => setEventBooks([]));
  }, [tab, eventBooks]);
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const bookTitle = (id: string) => { const b = (qacaid ?? []).find((x) => x.id === id); return b ? `${b.code ? `${b.code} · ` : ''}${b.title ?? ''}` : 'Book'; };

  async function upload(file: File) {
    if (file.size > 25 * 1024 * 1024) { notify('The file is larger than 25 MB.', 'error'); return; }
    setBusy(true);
    try {
      const path = `meetingDocs/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
      onAdd({ title: file.name, url: await getDownloadURL(r), kind: 'file' });
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const row = (key: string, title: string, sub: string, d: DocDraft) => (
    <li key={key}><div><b>{title}</b>{sub && <small>{sub}</small>}</div><button type="button" className="fx2-btn" onClick={() => { onAdd(d); onClose(); }}>{tx("Add")}</button></li>
  );

  return createPortal(
    <div className="mt-modal" role="dialog" aria-modal="true" aria-label={tx("Add a document")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mt-sheet">
        <header><h3>{tx("Add a document or media")}</h3><button type="button" className="mt-x" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <nav className="mt-dtabs">
          {(['file', 'link', 'audio', 'book', 'event_book'] as DocKind[]).map((k) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setQ(''); }}>{k === 'file' ? tx("Upload") : k === 'link' ? tx("Link") : k === 'audio' ? tx("Audio") : k === 'book' ? tx("Books") : tx("Event books")}</button>)}
        </nav>
        {tab === 'file' && (
          <div className="mt-dbody">
            <p className="mt-hint">{tx("Choose a file from your computer (PDF, Word, image… up to 25 MB). Participants can open it from the meeting.")}</p>
            <input type="file" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            {busy && <p className="mt-hint">{tx("Uploading…")}</p>}
          </div>
        )}
        {tab === 'link' && (
          <div className="mt-dbody">
            <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder={tx("Name (optional)")} />
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
            <button type="button" className="fx2-btn" disabled={!/^https?:\/\//i.test(linkUrl.trim())} onClick={() => { onAdd({ title: linkTitle.trim() || linkUrl.trim(), url: linkUrl.trim(), kind: 'link' }); onClose(); }}>{tx("Add the link")}</button>
          </div>
        )}
        {(tab === 'audio' || tab === 'book' || tab === 'event_book') && (
          <div className="mt-dbody">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search by name")} />
            <ul className="mt-dlist">
              {tab === 'audio' && (audio === null ? <li className="none">{tx("Loading…")}</li> : audio.filter((t) => t.fileUrl && (t.status ?? 'approved') !== 'rejected' && match(`${t.qacaidTitle ?? t.title ?? ''} ${t.melodyLabel ?? ''}`)).slice(0, 60).map((t) => row(t.id, t.qacaidTitle ?? t.title ?? 'Audio', t.melodyLabel ?? '', { title: `${t.qacaidTitle ?? t.title ?? 'Audio'}${t.melodyLabel ? ` · ${t.melodyLabel}` : ''}`, url: t.fileUrl, kind: 'audio' })))}
              {tab === 'book' && (editions === null ? <li className="none">{tx("Loading…")}</li> : editions.filter((x) => x.fileUrl && match(`${bookTitle(x.qacaidId)} ${x.label}`)).slice(0, 60).map((x) => row(x.id, bookTitle(x.qacaidId), x.label, { title: `${bookTitle(x.qacaidId)}${x.label ? ` · ${x.label}` : ''}`, url: x.fileUrl, kind: 'book' })))}
              {tab === 'event_book' && (eventBooks === null ? <li className="none">{tx("Loading…")}</li> : eventBooks.filter((b) => match(`${b.title} ${b.artist}`)).slice(0, 80).map((b) => row(b.id, b.title, `${b.artist}${b.version ? ` · ${b.version}` : ''}`, { title: `${b.title} · ${b.artist}`, url: `ref:event_book:${b.id}`, kind: 'event_book' })))}
            </ul>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- agenda with time allocation ---------- */
export function AgendaBuilder({ points, setPoints, totalMinutes, locked = 0 }: { points: PointDraft[]; setPoints: (p: PointDraft[]) => void; totalMinutes: number | null; /** Minutes already taken by points that cannot change (closed points). */ locked?: number }) {
  const [mode, setMode] = useState<'auto' | 'custom'>('custom');
  const [docFor, setDocFor] = useState(-1);
  const available = totalMinutes === null ? null : Math.max(0, totalMinutes - locked);
  const used = points.reduce((a, p) => a + (Number(p.minutes) || 0), 0);
  const left = available === null ? null : available - used;

  const apply = (list: PointDraft[], m: 'auto' | 'custom') => {
    if (m === 'auto' && available !== null && list.length) {
      const parts = autoSplit(list.length, available);
      return list.map((p, i) => ({ ...p, minutes: String(parts[i]) }));
    }
    return list;
  };
  // In auto mode the minutes follow the meeting length and the number of points.
  useEffect(() => {
    if (mode !== 'auto' || available === null || points.length === 0) return;
    const parts = autoSplit(points.length, available);
    if (points.some((p, i) => p.minutes !== String(parts[i]))) setPoints(points.map((p, i) => ({ ...p, minutes: String(parts[i]) })));
  }, [mode, available, points, setPoints]);

  const set = (i: number, patch: Partial<PointDraft>) => setPoints(points.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  return (
    <div className="mt-ag">
      <div className="mt-ag-head">
        <b>{tx("Agenda")}</b>
        <span className={left !== null && left < 0 ? 'bad' : ''}>
          {points.length} {tx("point")}{points.length === 1 ? '' : 's'} · {used} {tx("min")}{available !== null ? ` of ${available} available${left !== null && left < 0 ? ` · ${-left} too many` : left !== null && left > 0 ? ` · ${left} free` : ''}` : ''}
        </span>
      </div>
      <div className="mt-ag-modes" role="group" aria-label={tx("Time allocation")}>
        <button type="button" className={mode === 'auto' ? 'on' : ''} disabled={available === null || points.length === 0} onClick={() => { setMode('auto'); setPoints(apply(points, 'auto')); }}>{tx("Auto schedule")}</button>
        <button type="button" className={mode === 'custom' ? 'on' : ''} onClick={() => setMode('custom')}>{tx("Custom schedule")}</button>
        <small>{available === null ? tx("Set the start and end time to share the time between the points.") : mode === 'auto' ? txf("The {n} minutes are divided equally between the points.", { n: available }) : tx("Give each point its own time. The total must fit the meeting.")}</small>
      </div>
      {points.map((p, i) => (
        <div key={i} className="mt-ag-point">
          <div className="mt-ag-row">
            <span className="mt-num">{i + 1}</span>
            <input className="mt-ag-title" value={p.title} placeholder={tx("Point title")} onChange={(e) => set(i, { title: e.target.value })} />
            <label className="mt-ag-min"><input type="number" min={1} max={600} disabled={mode === 'auto' && available !== null} value={p.minutes} onChange={(e) => set(i, { minutes: e.target.value })} /><span>{tx("min")}</span></label>
            {points.length > 1 && <button type="button" className="mt-ag-x" onClick={() => setPoints(points.filter((_, k) => k !== i))}>{tx("Remove")}</button>}
          </div>
          <textarea rows={2} value={p.description} placeholder={tx("What will be discussed")} onChange={(e) => set(i, { description: e.target.value })} />
          <div className="mt-ag-docs">
            {p.docs.map((d, k) => <span key={k} className={`mt-dchip ${d.kind}`}>{KIND_LABEL[d.kind]} · {d.title}<button type="button" aria-label={tx("Remove")} onClick={() => set(i, { docs: p.docs.filter((_, j) => j !== k) })}>×</button></span>)}
            <button type="button" className="mt-dadd" onClick={() => setDocFor(i)}>{tx("+ Document, audio or book")}</button>
          </div>
        </div>
      ))}
      <button type="button" className="fx2-btn ghost" onClick={() => setPoints([...points, blankPoint()])}>{tx("+ Add agenda point")}</button>
      {docFor >= 0 && <DocPicker onClose={() => setDocFor(-1)} onAdd={(d) => set(docFor, { docs: [...(points[docFor]?.docs ?? []), d] })} />}
    </div>
  );
}

/* ---------- participants ---------- */
function tProxy(o: Record<string, string>) { return new Proxy(o, { get: (t, k) => (typeof k === 'string' && k in t ? tx(t[k]) : undefined) }); }
const ROLE_LABEL: Record<string, string> = tProxy({ leaderId: 'Supervisors', surveillantId: 'General supervisors', zone_admin: 'Zone managers', city_manager: 'City managers', city_zone_manager: 'Local zone managers', group_manager: 'Kurel admins', super_admin: 'Super admins' });
interface ScopeRow { role: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[]; groupIds?: string[] }
/** A person who holds a role, and the kurels that role is about ('all' = not tied to a place). */
interface Holder { userId: string; roleKey: string; reach: string[] | 'all' }

/**
 * Chooses who is invited. Pick one or several roles, optionally narrow by country, zone, city, local zone or kurel,
 * see who matches, then add them. Do it as many times as needed (for example Kurel admins of one city, then
 * Supervisors of another). Whole kurels (every member) and single people can be added too.
 */
export function Participants({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const scopes = useCollection<ScopeRow>('adminScopes', []);
  const adminRoles = useCollection<{ isSuperAdmin?: boolean }>('adminRoles', []);
  const kurelDocs = useCollection<Record<string, unknown>>('kurelRoles', []);
  const localZones = useCollection<{ name: string; cityId: string }>('localZones', [orderBy('name')]);
  const zones = useZones() ?? [];
  const { activeLeafGroups, byId, countries, cities } = useGroupHierarchy();
  const [roleSel, setRoleSel] = useState<string[]>([]);
  const [country, setCountry] = useState('');
  const [zone, setZone] = useState('');
  const [city, setCity] = useState('');
  const [localZone, setLocalZone] = useState('');
  const [kurel, setKurel] = useState('');
  const [skip, setSkip] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const profiles = useUserProfiles(value);

  const cityOf = (g: { parentGroupId?: string }) => (g.parentGroupId ? byId[g.parentGroupId] : undefined);
  const holders = useMemo<Holder[]>(() => {
    const out: Holder[] = [];
    const reachOf = (sc: ScopeRow): string[] => activeLeafGroups.filter((g) => {
      const c = cityOf(g);
      const co = c?.parentGroupId;
      if (sc.role === 'group_manager') return !!sc.groupIds?.includes(g.id);
      if (sc.role === 'city_manager') return !!c && !!sc.cityIds?.includes(c.id);
      if (sc.role === 'zone_admin') return (!!co && !!sc.countryIds?.includes(co)) || (!!c?.zoneId && !!sc.zoneIds?.includes(c.zoneId));
      if (sc.role === 'city_zone_manager') return !!c && !!sc.cityIds?.includes(c.id) && (!sc.zoneIds?.length || sc.zoneIds.includes(c.zoneId ?? '') || sc.zoneIds.includes(g.localZoneId ?? ''));
      return false;
    }).map((g) => g.id);
    (scopes ?? []).forEach((sc) => { const id = (sc as unknown as { id: string }).id; if (sc.role === 'super_admin') out.push({ userId: id, roleKey: 'super_admin', reach: 'all' }); else out.push({ userId: id, roleKey: sc.role, reach: reachOf(sc) }); });
    (adminRoles ?? []).filter((a) => a.isSuperAdmin).forEach((a) => out.push({ userId: (a as unknown as { id: string }).id, roleKey: 'super_admin', reach: 'all' }));
    (kurelDocs ?? []).forEach((k) => KUREL_ROLES.forEach((r) => { const v = k[r.key]; if (typeof v === 'string' && v) out.push({ userId: v, roleKey: r.key, reach: [(k as unknown as { id: string }).id] }); }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopes, adminRoles, kurelDocs, activeLeafGroups, byId]);

  const roles = useMemo(() => [...ACCESS_ROLES, ...KUREL_ROLES].filter((r) => holders.some((h) => h.roleKey === r.key)).map((r) => ({ key: r.key, label: ROLE_LABEL[r.key] ?? r.label, n: new Set(holders.filter((h) => h.roleKey === r.key).map((h) => h.userId)).size })), [holders]);

  const areaOn = !!(country || zone || city || localZone || kurel);
  const areaKurels = useMemo(() => (areaOn ? activeLeafGroups.filter((g) => {
    const c = cityOf(g);
    if (!c) return false;
    if (kurel) return g.id === kurel;
    if (country && c.parentGroupId !== country) return false;
    if (zone && c.zoneId !== zone) return false;
    if (city && c.id !== city) return false;
    if (localZone && g.localZoneId !== localZone) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : []), [areaOn, activeLeafGroups, byId, country, zone, city, localZone, kurel]);

  const matches = useMemo(() => {
    const set = new Set(areaKurels.map((g) => g.id));
    const by = new Map<string, Set<string>>();
    holders.forEach((h) => {
      if (roleSel.length && !roleSel.includes(h.roleKey)) return;
      if (areaOn && (h.reach === 'all' || !h.reach.some((k) => set.has(k)))) return;
      (by.get(h.userId) ?? by.set(h.userId, new Set()).get(h.userId)!).add(h.roleKey);
    });
    return Array.from(by.entries()).map(([userId, rs]) => ({ userId, roles: Array.from(rs) }));
  }, [holders, roleSel, areaOn, areaKurels]);
  const shown = matches.filter((m) => !skip.includes(m.userId));
  const addable = shown.filter((m) => !value.includes(m.userId));
  const [prevN, setPrevN] = useState(12);
  const [invN, setInvN] = useState(15);
  const [invQ, setInvQ] = useState('');
  const invList = value.filter((id) => !invQ.trim() || (profiles[id]?.name ?? '').toLowerCase().includes(invQ.trim().toLowerCase()));
  const previewProfiles = useUserProfiles(matches.slice(0, prevN).map((m) => m.userId));

  const countryOpts = countries.map((c) => ({ value: c.id, label: c.name }));
  const zoneOpts = zones.filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }));
  const cityList = cities.filter((c) => (!country || c.parentGroupId === country) && (!zone || c.zoneId === zone));
  const cityOpts = cityList.map((c) => ({ value: c.id, label: c.name }));
  const lzOpts = (localZones ?? []).filter((z) => (city ? z.cityId === city : cityList.some((c) => c.id === z.cityId))).map((z) => ({ value: (z as unknown as { id: string }).id, label: city ? z.name : `${z.name} · ${byId[z.cityId]?.name ?? ''}` }));
  const kurelOpts = activeLeafGroups.filter((g) => { const c = cityOf(g); return !!c && (!country || c.parentGroupId === country) && (!zone || c.zoneId === zone) && (!city || c.id === city) && (!localZone || g.localZoneId === localZone); }).map((g) => ({ value: g.id, label: g.name }));

  const reset = () => { setRoleSel([]); setCountry(''); setZone(''); setCity(''); setLocalZone(''); setKurel(''); setSkip([]); };
  const toggleRole = (k: string) => { setSkip([]); setRoleSel((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k])); };
  const placeName = kurel ? byId[kurel]?.name : localZone ? (localZones ?? []).find((z) => (z as unknown as { id: string }).id === localZone)?.name : city ? byId[city]?.name : zone ? zones.find((z) => z.id === zone)?.name : country ? byId[country]?.name : '';
  const roleText = roleSel.length === 0 ? tx("Everyone with a role") : roleSel.map((k) => ROLE_LABEL[k] ?? k).join(' + ');
  const summary = roleText;

  const rootRef = useRef<HTMLDivElement>(null);
  const goTo = (sel: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('pf-flash');
    window.setTimeout(() => el.classList.remove('pf-flash'), 1400);
  };

  function addMatches() {
    onChange(Array.from(new Set([...value, ...shown.map((m) => m.userId)])));
    notify(`${addable.length} ${addable.length === 1 ? 'person' : 'people'} added`, 'success');
    setSkip([]);
  }
  async function addKurels() {
    setBusy(true);
    try {
      const ids = areaKurels.map((g) => g.id);
      const uids = new Set<string>();
      for (let i = 0; i < ids.length; i += 30) {
        const sn = await getDocs(query(collection(db, 'groupMemberships'), where('groupId', 'in', ids.slice(i, i + 30)), where('status', '==', 'active')));
        sn.docs.forEach((d) => uids.add(d.data().userId as string));
      }
      onChange(Array.from(new Set([...value, ...uids])));
      notify(`${uids.size} member${uids.size === 1 ? '' : 's'} of ${ids.length} kurel${ids.length === 1 ? '' : 's'} added`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not load the members', 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-pt pf pf2" ref={rootRef}>
     <div className="pf-banners">
       <button type="button" className="pf-bn" onClick={() => goTo('.pf-r')} title={tx("Go to the invited list")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.3 3.5 5.2"/></svg><span><b>{value.length}</b><small>{tx("Invited")}</small></span></button>
       <button type="button" className="pf-bn" onClick={() => goTo('.pf-result')} title={tx("Go to the people who match")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg><span><b>{shown.length}</b><small>{tx("Match the filters")}</small></span></button>
       <button type="button" className="pf-bn" onClick={() => goTo('.mt-rolechips')} title={tx("Go to the roles")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3 4 6v6c0 4.5 3.2 7.5 8 9 4.8-1.5 8-4.5 8-9V6z"/></svg><span><b>{roleSel.length || tx("Any")}</b><small>{roleSel.length === 1 ? tx("Role") : tx("Roles")}</small></span></button>
     </div>
     <div className="pf-l">
      <div className="pf-step"><b>A</b> {tx("Who?")} <small>{tx("Pick one or several roles. Pick none to include every role.")}</small>{roleSel.length > 0 && <button type="button" className="mt-clear" onClick={reset}>{tx("Reset roles")}</button>}</div>
      <div className="mt-rolechips">
        <button type="button" className={`all ${roleSel.length === 0 ? 'on' : ''}`} onClick={() => { setRoleSel([]); setSkip([]); }}>{tx("Any role")}</button>
        {roles.map((r) => <button key={r.key} type="button" className={roleSel.includes(r.key) ? 'on' : ''} onClick={() => toggleRole(r.key)}>{r.label}<em>{r.n}</em></button>)}
      </div>

      <div className="pf-result">
        <div className="pf-result-top">
          <div><strong>{shown.length}</strong> <span>{shown.length === 1 ? tx("person matches") : tx("people match")}</span><small>{summary}</small></div>
          <div className="pf-btns">
            <button type="button" className="fx2-btn" disabled={addable.length === 0} onClick={addMatches}>{addable.length === 0 && shown.length > 0 ? tx("Already added") : `Add ${addable.length || ''} ${addable.length === 1 ? 'person' : 'people'}`.replace('  ', ' ')}</button>
            
          </div>
        </div>
        {shown.length === 0 ? <p className="mt-empty">{matches.length ? tx("Everyone was removed from this list.") : tx("No one holds this role in this place. Try another role or a wider place.")}</p> : (
          <div className="pf-prev">
            {shown.slice(0, prevN).map((m) => (
              <span key={m.userId} className={value.includes(m.userId) ? 'in' : ''}>
                <PersonLink userId={m.userId}>{previewProfiles[m.userId]?.name || tx("Member")}</PersonLink><small>{m.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}</small>
                <button type="button" aria-label={tx("Leave this person out")} onClick={() => setSkip([...skip, m.userId])}>×</button>
              </span>
            ))}
            {shown.length > prevN && <button type="button" className="pf-more" onClick={() => setPrevN(prevN + 24)}>{tx("Show 24 more ·")} {shown.length - prevN} {tx("left")}</button>}
          </div>
        )}
      </div>

     </div>
     <aside className="pf-r">
      <div className="pf-step"><b>B</b> {tx("Invited ·")} {value.length}{value.length > 0 && <button type="button" className="mt-clear" onClick={() => onChange([])}>{tx("Clear all")}</button>}</div>
      {value.length === 0 ? <p className="mt-empty">{tx("No one yet. Use the filters on the left, then press Add.")}</p> : (
        <>
          <label className="pf-find"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={invQ} onChange={(e) => { setInvQ(e.target.value); setInvN(15); }} placeholder={txf("Search the {n} invited", { n: value.length })} aria-label={tx("Search the invited")} />{invQ && <button type="button" aria-label={tx("Clear")} onClick={() => setInvQ('')}>×</button>}</label>
          <ul className="pf-inv">
            {invList.slice(0, invN).map((id) => <li key={id}><PersonLink userId={id}><Avatar name={profiles[id]?.name ?? ''} photoUrl={profiles[id]?.photoUrl} size={24} /><b>{profiles[id]?.name || tx("Member")}</b></PersonLink><ViewProfile userId={id} /><button type="button" aria-label={tx("Remove")} onClick={() => onChange(value.filter((v) => v !== id))}>×</button></li>)}
            {invList.length === 0 && <li className="none">{tx("Nobody matches.")}</li>}
          </ul>
          {invList.length > invN && <button type="button" className="pf-more" onClick={() => setInvN(invN + 30)}>{tx("Show 30 more ·")} {invList.length - invN} {tx("left")}</button>}
        </>
      )}
      <details className="mt-one">
        <summary>{tx("Add people one by one")}</summary>
        <MemberPicker multiple value={value} onChange={(ids) => onChange(ids)} />
      </details>
     </aside>
    </div>
  );
}

/* ---------- location (Google Maps) ---------- */
export interface Place { address: string; lat: string; lng: string }

export function LocationPicker({ value, onChange }: { value: Place; onChange: (p: Place) => void }) {
  const { countries, cities } = useGroupHierarchy();
  const zones = useCollection<{ name: string; cityId: string }>('localZones', [orderBy('name')]);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [map, setMap] = useState(false);
  const cityRow = cities.find((c) => c.id === city);
  const zoneRow = (zones ?? []).find((z) => z.id === zone);
  const near = [zoneRow?.name, cityRow?.name, countries.find((c) => c.id === country)?.name].filter(Boolean).join(', ');
  const mapValue: MapValue = { lat: value.lat, lng: value.lng, address: value.address, polygon: [] };
  return (
    <div className="mt-loc">
      <div className="mt-ag-head"><b>{tx("Place")}</b><span>{value.lat && value.lng ? tx("Pinned on the map") : tx("Not pinned yet")}</span></div>
      <div className="mt-areabar three">
        <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); setZone(''); }} allLabel={tx("Any country")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
        <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setZone(''); }} allLabel={tx("Any city")} options={cities.filter((c) => !country || c.parentGroupId === country).map((c) => ({ value: c.id, label: c.name }))} />
        <Dropdown label={tx("Local zone")} value={zone} onChange={setZone} allLabel={tx("Any local zone")} options={(zones ?? []).filter((z) => !city || z.cityId === city).map((z) => ({ value: z.id, label: z.name }))} />
      </div>
      <PlaceSearch near={near || undefined} placeholder={near ? txf("Search a place near {n}", { n: near }) : tx("Type an address or a place")} onPick={(h) => onChange({ address: h.address, lat: h.lat.toFixed(6), lng: h.lng.toFixed(6) })} />
      {value.address && <p className="mt-picked">📍 {value.address}</p>}
      <button type="button" className="mt-maptoggle" onClick={() => setMap(!map)}>{map ? tx("Hide the map") : tx("Open the map to pin the exact place")}</button>
      {map && <MapPicker hideSearch noArea height={280} value={mapValue} onChange={(v) => onChange({ address: v.address, lat: v.lat, lng: v.lng })} />}
    </div>
  );
}

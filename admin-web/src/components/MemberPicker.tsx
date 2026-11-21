'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { ACCESS_ROLES, KUREL_ROLES } from '@/app/dashboard/role-access/roles';
import { db } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { searchMembers } from '@/lib/functions';
import { docVisible } from '@/lib/scopeFilter';
import { ViewProfile } from './MemberProfile';
import Dropdown from './Dropdown';
import { tx } from '@/lib/i18n/tr';

export interface PickedMember {
  id: string;
  name: string;
  phone: string;
  memberId: string;
  photoUrl?: string;
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

/** Round profile picture, or the initials when the member has no photo. */
/** Shown for every member who has not uploaded a picture. */
export const DEFAULT_MEMBER_PHOTO = '/default-member.jpg';

export function Avatar({ name, photoUrl, size = 28 }: { name: string; photoUrl?: string; size?: number }) {
  // Without a photo: the initials on a colour that always stays the same for the same name.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  void h; void initials;
  return (
    <span className="mp-av" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }} aria-hidden="true">
      <img alt="" src={photoUrl || DEFAULT_MEMBER_PHOTO} />
    </span>
  );
}

const ROLE_LABEL: Record<string, string> = { leaderId: 'Supervisors', surveillantId: 'General supervisors', zone_admin: 'Zone managers', city_manager: 'City managers', city_zone_manager: 'Local zone managers', group_manager: 'Kurel admins', super_admin: 'Super admins' };
interface ScopeRow { role: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[]; groupIds?: string[] }
interface Holder { userId: string; roleKey: string; reach: string[] | 'all' }

/** Reads who holds which role (and which kurels it covers) and hands it up. Only mounted when the role filter is on. */
function RoleSource({ onData }: { onData: (h: Holder[]) => void }) {
  const scopes = useCollection<ScopeRow>('adminScopes', []);
  const adminRoles = useCollection<{ isSuperAdmin?: boolean }>('adminRoles', []);
  const kurelDocs = useCollection<Record<string, unknown>>('kurelRoles', []);
  const { activeLeafGroups, byId } = useGroupHierarchy();
  const holders = useMemo<Holder[]>(() => {
    const out: Holder[] = [];
    const reachOf = (sc: ScopeRow): string[] => activeLeafGroups.filter((g) => {
      const c = g.parentGroupId ? byId[g.parentGroupId] : undefined;
      const co = c?.parentGroupId;
      if (sc.role === 'group_manager') return !!sc.groupIds?.includes(g.id);
      if (sc.role === 'city_manager') return !!c && !!sc.cityIds?.includes(c.id);
      if (sc.role === 'zone_admin') return (!!co && !!sc.countryIds?.includes(co)) || (!!c?.zoneId && !!sc.zoneIds?.includes(c.zoneId));
      if (sc.role === 'city_zone_manager') return !!c && !!sc.cityIds?.includes(c.id) && (!sc.zoneIds?.length || sc.zoneIds.includes(c.zoneId ?? '') || sc.zoneIds.includes(g.localZoneId ?? ''));
      return false;
    }).map((g) => g.id);
    (scopes ?? []).forEach((sc) => { const id = (sc as unknown as { id: string }).id; out.push(sc.role === 'super_admin' ? { userId: id, roleKey: 'super_admin', reach: 'all' } : { userId: id, roleKey: sc.role, reach: reachOf(sc) }); });
    (adminRoles ?? []).filter((a) => a.isSuperAdmin).forEach((a) => out.push({ userId: (a as unknown as { id: string }).id, roleKey: 'super_admin', reach: 'all' }));
    (kurelDocs ?? []).forEach((k) => KUREL_ROLES.forEach((r) => { const v = k[r.key]; if (typeof v === 'string' && v) out.push({ userId: v, roleKey: r.key, reach: [(k as unknown as { id: string }).id] }); }));
    return out;
  }, [scopes, adminRoles, kurelDocs, activeLeafGroups, byId]);
  useEffect(() => { onData(holders); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holders]);
  return null;
}

/**
 * Find a member without typing an ID. The list is the active members of the chosen kurel(s);
 * narrow it by kurel, by availability and by name or phone.
 * Typing a name or phone also works when no kurel is chosen. Pass `multiple` to tick several
 * people. People already holding another role are shown greyed out with the reason.
 */
export default function MemberPicker({
  value,
  onChange,
  multiple = false,
  disabledIds = [],
  disabledReason = {},
  initialArea,
  kurelIds,
  restrict = false,
  selected,
  hideChosen = false,
  roleFilter = false,
}: {
  /** Selected user ids. */
  value: string[];
  onChange: (ids: string[], people: PickedMember[]) => void;
  multiple?: boolean;
  disabledIds?: string[];
  /** Why a person cannot be chosen, shown next to the name (for example "Already Leader"). */
  disabledReason?: Record<string, string>;
  /** The kurel (or the country / city) the list starts in. */
  initialArea?: { country?: string; zone?: string; city?: string; localZone?: string; kurel?: string };
  /** Limit the kurel filter to these kurels (for example the kurels of an event). */
  kurelIds?: string[];
  /** Only the members of the listed kurels can be chosen (no search outside them). */
  restrict?: boolean;
  /** The people already chosen (name and photo), so they show at once even before the list has loaded. */
  selected?: PickedMember[];
  /** Hide the chips of the chosen people (when the page lists them itself). */
  hideChosen?: boolean;
  /** Add a Role filter (supervisors, admins, kurel officers…) and role shortcuts when nothing is chosen yet. */
  roleFilter?: boolean;
}) {
  const { byId, activeLeafGroups, countries, cities, locationOf } = useGroupHierarchy();

  const [kurel, setKurel] = useState(initialArea?.kurel ?? '');
  const [free, setFree] = useState(false);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [text, setText] = useState('');
  const [people, setPeople] = useState<PickedMember[]>([]);
  const [known, setKnown] = useState<Record<string, PickedMember>>(() => Object.fromEntries((selected ?? []).map((p) => [p.id, p])));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [holders, setHolders] = useState<Holder[]>([]);
  const [role, setRole] = useState('');

  const kurelsForFilter = useMemo(
    () =>
      activeLeafGroups.filter((g) => {
        if (kurelIds) return kurelIds.includes(g.id);
        if (!initialArea?.city && !initialArea?.country) {
          const l = locationOf(g.id);
          if (country && l.country?.id !== country) return false;
          if (city && l.city?.id !== city) return false;
        }
        const c = g.parentGroupId ? byId[g.parentGroupId] : undefined;
        if (!c) return false;
        if (initialArea?.city && c.id !== initialArea.city) return false;
        if (initialArea?.country && c.parentGroupId !== initialArea.country) return false;
        return true;
      }),
    [activeLeafGroups, byId, kurelIds, initialArea?.city, initialArea?.country, country, city, locationOf]
  );
  const scoped = Boolean(kurelIds || initialArea?.city || initialArea?.country || initialArea?.kurel);
  const areaPicked = Boolean(country || city);
  const groupIds = kurel === '__all' ? [] : kurel ? [kurel] : scoped || areaPicked ? kurelsForFilter.map((g) => g.id) : [];
  const anyArea = groupIds.length > 0;
  const areaKey = groupIds.join(',');
  const roles = useMemo(() => [...ACCESS_ROLES, ...KUREL_ROLES].filter((r) => holders.some((h) => h.roleKey === r.key)).map((r) => ({ key: r.key, label: ROLE_LABEL[r.key] ?? r.label, n: new Set(holders.filter((h) => h.roleKey === r.key).map((h) => h.userId)).size })), [holders]);
  const rolesOf = useMemo(() => { const m = new Map<string, string[]>(); holders.forEach((h) => { const l = ROLE_LABEL[h.roleKey] ?? h.roleKey; const a = m.get(h.userId) ?? []; if (!a.includes(l)) a.push(l); m.set(h.userId, a); }); return m; }, [holders]);
  const roleUids = useMemo(() => {
    if (!role) return [] as string[];
    const set = new Set(groupIds);
    return [...new Set(holders.filter((h) => h.roleKey === role && (!anyArea || (h.reach !== 'all' && h.reach.some((k) => set.has(k))))).map((h) => h.userId))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holders, role, anyArea, areaKey]);
  const roleKey = roleUids.join(',');

  // People of the chosen kurels, or a name search when no kurel applies.
  useEffect(() => {
    let cancelled = false;
    const term = text.trim();
    if (role) {
      (async () => {
        setBusy(true);
        try {
          const rows: PickedMember[] = [];
          for (const c of chunk(roleUids.slice(0, 400), 30)) {
            const s = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', c)));
            s.docs.forEach((d) => {
              const x = d.data();
              if (x.status === 'disabled' || !docVisible('users', d.id, x)) return;
              rows.push({ id: d.id, name: (x.displayName as string) || '(no name)', phone: (x.phone as string) || '', memberId: (x.memberId as string) || '', photoUrl: (x.photoUrl as string) || '' });
            });
          }
          rows.sort((a, b) => a.name.localeCompare(b.name));
          if (cancelled) return;
          setPeople(rows);
          setNote(rows.length ? '' : 'Nobody holds this role here.');
        } catch { if (!cancelled) setNote('Could not load the members.'); } finally { if (!cancelled) setBusy(false); }
      })();
      return () => { cancelled = true; };
    }
    if (!anyArea) {
      const dgt = term.replace(/\D/g, '');
      if (term.length < 2 || (/^[+\d\s().-]+$/.test(term) && dgt.length < 3)) {
        setPeople([]);
        setNote('Pick a country, city or kurel above, or type 2 letters of a name or 3 digits of a phone number. Part of the number is enough.');
        return;
      }
      setBusy(true);
      const h = window.setTimeout(async () => {
        try {
          const res = await searchMembers({ query: term });
          if (cancelled) return;
          const list = res.data.results.filter((u) => u.status !== 'disabled').map((u) => ({ id: u.userId, name: u.displayName || '(no name)', phone: u.phone || '', memberId: '', photoUrl: u.photoUrl || '' }));
          setPeople(list);
          setNote(list.length ? '' : 'Nobody found.');
        } catch {
          if (!cancelled) setNote('Search failed.');
        } finally {
          if (!cancelled) setBusy(false);
        }
      }, 300);
      return () => {
        cancelled = true;
        window.clearTimeout(h);
      };
    }
    (async () => {
      setBusy(true);
      try {
        const uids = new Set<string>();
        for (const c of chunk(groupIds, 30)) {
          const s = await getDocs(query(collection(db, 'groupMemberships'), where('groupId', 'in', c), where('status', '==', 'active')));
          s.docs.forEach((d) => uids.add(d.data().userId as string));
        }
        const rows: PickedMember[] = [];
        for (const c of chunk([...uids].slice(0, 400), 30)) {
          const s = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', c)));
          s.docs.forEach((d) => {
            const x = d.data();
            if (x.status === 'disabled' || !docVisible('users', d.id, x)) return;
            rows.push({ id: d.id, name: (x.displayName as string) || '(no name)', phone: (x.phone as string) || '', memberId: (x.memberId as string) || '', photoUrl: (x.photoUrl as string) || '' });
          });
        }
        rows.sort((a, b) => a.name.localeCompare(b.name));
        if (cancelled) return;
        setPeople(rows);
        setNote(rows.length ? '' : 'Nobody is in this kurel yet.');
      } catch {
        if (!cancelled) setNote('Could not load the members.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, anyArea, role, roleKey, anyArea || role ? '' : text]);

  useEffect(() => {
    setKnown((k) => ({ ...k, ...Object.fromEntries(people.map((p) => [p.id, p])) }));
  }, [people]);
  const selKey = (selected ?? []).map((p) => p.id).join(',');
  useEffect(() => {
    if (selected?.length) setKnown((k) => ({ ...Object.fromEntries(selected.map((p) => [p.id, p])), ...k }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const shown = useMemo(() => {
    const term = text.trim().toLowerCase();
    const dg = term.replace(/\D/g, '');
    let base = (anyArea || role) && term ? people.filter((p) => p.name.toLowerCase().includes(term) || (dg.length > 0 && /^[+\d\s().-]+$/.test(term) && p.phone.replace(/\D/g, '').includes(dg)) || p.phone.includes(term) || p.memberId.toLowerCase().includes(term)) : people;
    if (free) base = base.filter((p) => !disabledIds.includes(p.id));
    return base;
  }, [people, text, anyArea, role, free, disabledIds]);

  const emit = (ids: string[]) => onChange(ids, ids.map((i) => known[i]).filter(Boolean));
  const chosen = value.map((v) => known[v]).filter(Boolean);
  const pickable = shown.filter((p) => !disabledIds.includes(p.id) || value.includes(p.id));
  const allShownOn = pickable.length > 0 && pickable.every((p) => value.includes(p.id));
  const toggleShown = () => emit(allShownOn ? value.filter((v) => !pickable.some((p) => p.id === v)) : [...new Set([...value, ...pickable.map((p) => p.id)])]);
  const sub = (p: PickedMember) => [p.phone, p.memberId].filter(Boolean).join(' · ');

  return (
    <div className="mp">
      {chosen.length > 0 && !hideChosen && (
        <div className="mp-chosen">
          {chosen.map((p) => (
            <span key={p.id} className="mp-chip">
              <Avatar name={p.name} photoUrl={p.photoUrl} size={26} />
              <b>{p.name}</b>
              <ViewProfile userId={p.id} label={tx("Profile")} />
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => emit(value.filter((x) => x !== p.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      {roleFilter && <RoleSource onData={setHolders} />}
      <div className="mp-tools">
        <div className="mp-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Search a name, phone number or member number")} aria-label={tx("Search a name or phone number")} />
          {text && <button type="button" aria-label={tx("Clear the search")} onClick={() => setText('')}>×</button>}
        </div>
        <div className="mp-sel">
          {!scoped && (
            <>
              <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); setKurel(''); }} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
              <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setKurel(''); }} allLabel="All cities" options={cities.filter((c) => !country || c.parentGroupId === country).map((c) => ({ value: c.id, label: c.name }))} />
            </>
          )}
          {roleFilter && <Dropdown label={tx("Role")} value={role} onChange={setRole} allLabel="Any role" options={roles.map((r) => ({ value: r.key, label: r.label, hint: String(r.n) }))} />}
          <Dropdown label={tx("Kurel")} value={kurel} onChange={setKurel} allLabel={scoped ? (restrict ? 'All selected kurels' : 'All kurels here') : 'All kurels'} options={[...(scoped && !restrict ? [{ value: '__all', label: tx("Whole organisation (search by name)") }] : []), ...[...kurelsForFilter].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ value: g.id, label: `${g.name}${byId[g.parentGroupId ?? '']?.name ? ` (${byId[g.parentGroupId ?? ''].name})` : ''}` }))]} />
        </div>
        <div className="mp-chips">
          {disabledIds.length > 0 && <button type="button" className={free ? 'on' : ''} onClick={() => setFree(!free)}>{tx("Available only")}</button>}
          {(country || city || kurel || free || role) && <button type="button" className="clr" onClick={() => { setCountry(''); setCity(''); setKurel(initialArea?.kurel ?? ''); setFree(false); setRole(''); }}>{tx("Clear filters")}</button>}
          {multiple && pickable.length > 1 && <button type="button" className="mp-all" onClick={toggleShown}>{allShownOn ? `Unselect all ${pickable.length}` : `Select all ${pickable.length}`}</button>}
          {multiple && value.length > 0 && <button type="button" className="clr" onClick={() => emit([])}>{tx("Clear selection")}</button>}
          <span className="mp-n">{busy ? tx("Loading…") : anyArea || role || text.trim().length >= 2 ? `${shown.length} ${shown.length === 1 ? 'person' : 'people'}` : ''}</span>
        </div>
      </div>

      <div className="mp-list">
        {busy && <small>{tx("Loading…")}</small>}
        {!busy && shown.length === 0 && roleFilter && !role && !anyArea && text.trim().length < 2 && roles.length > 0 ? (
          <div className="mp-start">
            <p><b>{tx("Start from a role")}</b><small>{tx("or search a name above, or pick a country, city or kurel")}</small></p>
            <div>{roles.map((r) => <button key={r.key} type="button" onClick={() => setRole(r.key)}><b>{r.label}</b><em>{r.n}</em></button>)}</div>
          </div>
        ) : null}
        {!busy && shown.length === 0 && !(roleFilter && !role && !anyArea && text.trim().length < 2 && roles.length > 0) && <small>{note || tx("No member matches these filters.")}</small>}
        {shown.map((p) => {
          const off = disabledIds.includes(p.id) && !value.includes(p.id);
          const on = value.includes(p.id);
          return (
            <label key={p.id} className={`mp-row${on ? ' on' : ''}${off ? ' off' : ''}`}>
              <input
                className="mp-in"
                type={multiple ? 'checkbox' : 'radio'}
                disabled={off}
                checked={on}
                onChange={(e) => emit(multiple ? (e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id)) : [p.id])}
              />
              <span className={`mp-tick${multiple ? '' : ' round'}`} aria-hidden>{on ? '✓' : ''}</span>
              <Avatar name={p.name} photoUrl={p.photoUrl} />
              <span className="mp-who"><b>{p.name}</b>{sub(p) && <small>{sub(p)}</small>}{roleFilter && rolesOf.get(p.id) && <small className="mp-role">{rolesOf.get(p.id)!.join(' · ')}</small>}</span>
              <ViewProfile userId={p.id} label={tx("Profile")} />
              {off && <em className="mp-tag">{disabledReason[p.id] || tx("Unavailable")}</em>}
            </label>
          );
        })}
      </div>
      {value.length > 0 && multiple && <small className="mp-count">{value.length} {tx("selected")}</small>}
    </div>
  );
}

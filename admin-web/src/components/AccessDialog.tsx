'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { setManagerAccess } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

export const ACCESS_ROLES = [
  { value: 'super_admin', label: 'Super Admin (everything)' },
  { value: 'zone_admin', label: 'Zone Manager (assigned countries or zones)' },
  { value: 'city_manager', label: 'City Manager (assigned cities)' },
  { value: 'city_zone_manager', label: 'City-specific Zone Manager (a city AND a zone)' },
  { value: 'group_manager', label: 'Group Admin (assigned groups)' },
];
const ROLE_META: Record<string, { icon: string; hint: string; scopes: ('countryIds' | 'zoneIds' | 'cityIds' | 'groupIds')[] }> = {
  super_admin: { icon: '👑', hint: 'Full access to everything', scopes: [] },
  zone_admin: { icon: '🌍', hint: 'Countries or zones', scopes: ['countryIds', 'zoneIds'] },
  city_manager: { icon: '🏙️', hint: 'One or more cities', scopes: ['cityIds'] },
  city_zone_manager: { icon: '📍', hint: 'A city and a zone', scopes: ['cityIds', 'zoneIds'] },
  group_manager: { icon: '👥', hint: 'Assigned groups', scopes: ['groupIds'] },
};
export const ACCESS_ROLE_LABEL: Record<string, string> = Object.fromEntries(ACCESS_ROLES.map((r) => [r.value, r.label.split(' (')[0]]));
export const ACCESS_SECTIONS = ['groups', 'members', 'events', 'requests', 'donations', 'reports', 'content', 'integrations', 'logistics'];

const split = (v?: string) => (v ? v.split(',').filter(Boolean) : []);

type Scope = 'countryIds' | 'zoneIds' | 'cityIds' | 'groupIds';
type Opt = { value: string; label: string };

function Picker({ title, options, value, onChange, off }: { title: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; off?: boolean }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())), [options, q]);
  const set = new Set(value);
  const toggle = (v: string) => onChange(set.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <section className={`ac-card${off ? ' off' : ''}`}>
      <header>
        <b>{title}</b>{off && <span className="ac-na">{tx("Not used by this role")}</span>}<span className="ac-count">{value.length} / {options.length}</span>
        <div className="ac-acts">
          <button type="button" onClick={() => onChange(Array.from(new Set([...value, ...shown.map((o) => o.value)])))}>{tx("Select all")}</button>
          <button type="button" onClick={() => onChange(value.filter((v) => !shown.some((o) => o.value === v)))}>{tx("Clear")}</button>
        </div>
      </header>
      <input className="ac-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search")} />
      <div className="ac-opts">
        {shown.map((o) => (
          <button type="button" key={o.value} className={`ac-opt${set.has(o.value) ? ' on' : ''}`} onClick={() => toggle(o.value)}><i>{set.has(o.value) ? '✓' : ''}</i><span>{o.label}</span></button>
        ))}
        {shown.length === 0 && <div className="ac-none">{tx("Nothing matches.")}</div>}
      </div>
    </section>
  );
}

/** Full-page screen that gives one account a role (city manager, zone manager, group admin…) and the areas and sections it covers. */
export default function AccessDialog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { byId, countries, cities, activeLeafGroups } = useGroupHierarchy();
  const zones = useZones();
  const [role, setRole] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [sc, setSc] = useState<Record<Scope, string[]>>({ countryIds: [], zoneIds: [], cityIds: [], groupIds: [] });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let off = false;
    (async () => {
      const [s, r] = await Promise.all([getDoc(doc(db, 'adminScopes', userId)), getDoc(doc(db, 'adminRoles', userId))]);
      const sd = s.data() ?? {}; const rd = r.data() ?? {};
      if (off) return;
      const cur = (sd.role as string) ?? (rd.isSuperAdmin ? 'super_admin' : '');
      setRole(cur === 'unrestricted' ? '' : cur);
      setPerms((rd.permissions as string[]) ?? []);
      setSc({ countryIds: sd.countryIds ?? [], zoneIds: sd.zoneIds ?? [], cityIds: sd.cityIds ?? [], groupIds: sd.groupIds ?? [] });
      setReady(true);
    })().catch(() => !off && setReady(true));
    return () => { off = true; };
  }, [userId]);

  if (!ready || zones === null) return null;
  const meta = ROLE_META[role];
  const need = meta?.scopes ?? [];
  const opts: Record<Scope, { title: string; list: Opt[] }> = {
    countryIds: { title: tx("Countries"), list: countries.map((c) => ({ value: c.id, label: c.name })) },
    zoneIds: { title: tx("Zones"), list: zones.map((z) => ({ value: z.id, label: `${z.name} (${byId[z.countryId]?.name ?? '—'})` })) },
    cityIds: { title: tx("Cities"), list: cities.map((c) => ({ value: c.id, label: c.name })) },
    groupIds: { title: tx("Groups"), list: activeLeafGroups.map((g) => ({ value: g.id, label: `${g.name} (${byId[g.parentGroupId ?? '']?.name ?? '—'})` })) },
  };
  const pick = (r: string) => {
    setRole(r);
    if (r === 'group_manager') setPerms((p) => Array.from(new Set([...p, 'events', 'content'])));
  };
  const covered = need.reduce((n, k) => n + sc[k].length, 0);
  const missing = !role ? tx("Choose a role first") : role !== 'super_admin' && covered === 0 ? tx("Pick at least one area") : '';

  const save = async () => {
    if (missing) { setErr(missing); return; }
    setBusy(true); setErr('');
    try {
      const sel = (k: Scope) => (need.includes(k) ? sc[k] : []);
      await setManagerAccess({ userId, role, permissions: role === 'super_admin' ? [] : perms, countryIds: sel('countryIds'), zoneIds: sel('zoneIds'), cityIds: sel('cityIds'), groupIds: sel('groupIds') });
      notify('Access updated', 'success');
      onClose();
    } catch (e) { setErr((e as Error).message || tx("Could not save")); setBusy(false); }
  };

  const ui = (
    <div className="manage-page acs" role="dialog" aria-modal="true" aria-label={tx("Role and access")}>
      <div className="manage-page-bar"><strong>{tx("Role and access")} · {name || userId}</strong><button type="button" className="manage-close" onClick={onClose}>{tx("Close")}</button></div>
      <div className="manage-page-body ac-body">
        <div className="ac-main">
          <section className="ac-card">
            <header><span className="ac-n">1</span><b>{tx("Choose the role")}</b></header>
            <div className="ac-roles">
              {ACCESS_ROLES.map((r) => (
                <button type="button" key={r.value} className={`ac-role${role === r.value ? ' on' : ''}`} onClick={() => pick(r.value)}>
                  <em>{ROLE_META[r.value].icon}</em><b>{tx(ACCESS_ROLE_LABEL[r.value])}</b><small>{tx(ROLE_META[r.value].hint)}</small>
                </button>
              ))}
            </div>
          </section>
          <div className="ac-step"><span className="ac-n">2</span><b>{tx("Choose the areas it covers")}</b>{role === 'super_admin' && <small>{tx("Super Admin covers everything")}</small>}</div>
          <div className="ac-pickers c2">
            {(['countryIds', 'zoneIds', 'cityIds', 'groupIds'] as Scope[]).map((k) => (
              <Picker key={k} off={!role || !need.includes(k)} title={opts[k].title} options={opts[k].list} value={sc[k]} onChange={(v) => setSc((o) => ({ ...o, [k]: v }))} />
            ))}
          </div>
          <section className={`ac-card${role === 'super_admin' ? ' off' : ''}`}>
            <header><span className="ac-n">3</span><b>{tx("Sections they can use")}</b>{role === 'super_admin' && <span className="ac-na">{tx("Not used by this role")}</span>}
              <div className="ac-acts"><button type="button" onClick={() => setPerms([...ACCESS_SECTIONS])}>{tx("Select all")}</button><button type="button" onClick={() => setPerms([])}>{tx("Clear")}</button></div>
            </header>
            <div className="ac-chips">
              {ACCESS_SECTIONS.map((p) => (
                <button type="button" key={p} className={`ac-chip${perms.includes(p) ? ' on' : ''}`} onClick={() => setPerms((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]))}>{perms.includes(p) ? '✓ ' : ''}{tx(p)}</button>
              ))}
            </div>
            {role === 'group_manager' && <small className="ac-note">{tx("A Group Admin needs \"events\" and \"content\".")}</small>}
          </section>
        </div>
        <aside className="ac-side">
          <b>{tx("Summary")}</b>
          <div className="ac-sum"><span>{tx("Member")}</span><strong>{name || userId}</strong></div>
          <div className="ac-sum"><span>{tx("Role")}</span><strong>{role ? tx(ACCESS_ROLE_LABEL[role]) : '—'}</strong></div>
          {need.map((k) => <div className="ac-sum" key={k}><span>{opts[k].title}</span><strong>{sc[k].length}</strong></div>)}
          {role && role !== 'super_admin' && <div className="ac-sum"><span>{tx("Sections they can use")}</span><strong>{perms.length}</strong></div>}
          {err && <div className="ac-err">{err}</div>}
          <button type="button" className="ac-save" disabled={busy} onClick={() => void save()}>{busy ? tx("Saving…") : tx("Save access")}</button>
          <button type="button" className="ac-cancel" onClick={onClose}>{tx("Cancel")}</button>
          <small>{tx("The limits are enforced on the server.")}</small>
        </aside>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? ui : createPortal(ui, document.body);
}

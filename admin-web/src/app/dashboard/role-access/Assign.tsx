'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useZones } from '@/lib/useZones';
import { useUserProfiles } from '@/lib/useUserNames';
import { createManagerAccount, setCommitteeMembers, setKurelRoles, setManagerAccess } from '@/lib/functions';
import MemberPicker, { Avatar } from '@/components/MemberPicker';
import Dropdown from '@/components/Dropdown';
import { notify } from '@/lib/notify';
import { ACCESS_ROLES, ALL_ROLES, ALL_SECTIONS, KUREL_FIELDS, KUREL_ROLES, ROLE_BY_KEY, SECTIONS, TEAM_BY_TITLE, TEAM_TITLES, catalogKey, type RoleDef } from './roles';
import { tx } from '@/lib/i18n/tr';

export interface Team { id: string; level: string; name: string; members: { userId: string; title: string }[] }
export type KurelDoc = { id: string } & Record<string, unknown>;
export interface Scope4 { countryIds: string[]; zoneIds: string[]; cityIds: string[]; groupIds: string[] }
export interface WizardInit { roleKey?: string; userId?: string; edit?: boolean; scope?: Scope4; perms?: string[]; teamId?: string; kurelId?: string }

const LEVEL_NAME: Record<string, string> = { organisation: 'Organisation', country: 'Country', zone: 'Zone', city: 'City', localzone: 'Local city zone' };
const roleOf = (ck: string): RoleDef | undefined => (ck.startsWith('team:') ? TEAM_BY_TITLE[ck.slice(5)] : ROLE_BY_KEY[ck]);
const unique = (a: string[]) => [...new Set(a)];

interface Item { id: string; name: string; sub: string }

export function Chooser({ title, hint, items, value, onChange }: { title: string; hint: string; items: Item[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => !q.trim() || `${i.name} ${i.sub}`.toLowerCase().includes(q.trim().toLowerCase()));
  const flip = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="ra-ch">
      <header><b>{title}</b><span>{value.length} {tx("chosen")}</span></header>
      <small>{hint}</small>
      {items.length > 7 && <input className="ra-q" type="search" placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <ul>
        {shown.map((i) => (
          <li key={i.id}>
            <button type="button" className={value.includes(i.id) ? 'on' : ''} onClick={() => flip(i.id)} aria-pressed={value.includes(i.id)}>
              <i aria-hidden>{value.includes(i.id) ? '✓' : ''}</i>
              <span><b>{i.name}</b>{i.sub && <small>{i.sub}</small>}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="ra-none">{tx("Nothing found.")}</li>}
      </ul>
    </div>
  );
}

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ra-step">
      <header><span>{n}</span><div><h3>{title}</h3>{note && <p>{note}</p>}</div></header>
      {children}
    </section>
  );
}

export default function Assign({ init, teams, kurelDocs, onClose }: { init: WizardInit; teams: Team[]; kurelDocs: KurelDoc[]; onClose: () => void }) {
  const { countries, cities, activeLeafGroups, byId } = useGroupHierarchy();
  const zones = useZones();
  const edit = !!init.edit;
  const [ck, setCk] = useState(init.roleKey ?? '');
  const [userId, setUserId] = useState(init.userId ?? '');
  const [newAcc, setNewAcc] = useState(false);
  const [nu, setNu] = useState({ name: '', email: '', password: '' });
  const [sc, setSc] = useState<Scope4>(init.scope ?? { countryIds: [], zoneIds: [], cityIds: [], groupIds: [] });
  const [perms, setPerms] = useState<string[]>(init.perms ?? []);
  const [touched, setTouched] = useState(edit);
  const [teamId, setTeamId] = useState(init.teamId ?? '');
  const [kurelId, setKurelId] = useState(init.kurelId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const def = ck ? roleOf(ck) : undefined;
  const kind = def?.kind;
  const profiles = useUserProfiles([userId, ...teams.flatMap((t) => t.members.map((m) => m.userId))].filter(Boolean));
  const person = profiles[userId];

  const pick = (key: string) => {
    setCk(key); setErr('');
    const d = roleOf(key);
    if (d?.kind === 'access' && !touched) setPerms(d.key === 'super_admin' ? ALL_SECTIONS : d.preset ?? []);
  };

  const items = useMemo(() => ({
    countries: countries.map((c) => ({ id: c.id, name: c.name, sub: '' })),
    zones: (zones ?? []).map((z) => ({ id: z.id, name: z.name, sub: byId[z.countryId]?.name ?? '' })),
    cities: cities.map((c) => ({ id: c.id, name: c.name, sub: byId[c.parentGroupId ?? '']?.name ?? '' })),
    kurels: activeLeafGroups.map((g) => ({ id: g.id, name: g.name, sub: byId[g.parentGroupId ?? '']?.name ?? '' })),
  }), [countries, zones, cities, activeLeafGroups, byId]);
  const setArea = (field: keyof Scope4) => (v: string[]) => setSc((s) => ({ ...s, [field]: v }));
  const field: Record<string, keyof Scope4> = { countries: 'countryIds', zones: 'zoneIds', cities: 'cityIds', kurels: 'groupIds' };
  const NEED_TITLE: Record<string, string> = { countries: 'Countries', zones: 'Zones', cities: 'Cities', kurels: 'Kurels' };

  const team = teams.find((t) => t.id === teamId);
  const kurelDoc = kurelDocs.find((k) => k.id === kurelId);
  const holder = def?.kind === 'kurel' && kurelDoc ? (kurelDoc[def.key] as string | undefined) : undefined;
  const holderName = holder ? profiles[holder]?.name : '';
  const sitting = def?.kind === 'team' && def.key === 'president' && team ? team.members.find((m) => m.title === 'president' && m.userId !== userId) : undefined;

  const problem = (): string => {
    if (!def) return 'Choose a role first.';
    if (def.kind === 'access') {
      if (newAcc && !edit) {
        if (!nu.name.trim()) return 'Write the full name of the new account.';
        if (!/^\S+@\S+\.\S+$/.test(nu.email.trim())) return 'Write a valid email address.';
        if (nu.password.length < 8) return 'The password needs at least 8 characters.';
      } else if (!userId) return 'Choose the person.';
      if (def.key !== 'super_admin') {
        const need = def.needs ?? [];
        const has = need.map((n) => sc[field[n]].length > 0);
        if (def.mode === 'all' ? !has.every(Boolean) : !has.some(Boolean)) return def.mode === 'all' ? 'Choose at least one city and one zone.' : `Choose at least one: ${need.map((n) => NEED_TITLE[n].toLowerCase()).join(' or ')}.`;
        if (perms.length === 0) return 'Tick at least one section this person can use.';
      }
      return '';
    }
    if (!userId) return 'Choose the person.';
    if (def.kind === 'team') return teamId ? '' : 'Choose the team.';
    return kurelId ? '' : 'Choose the kurel.';
  };

  const save = async () => {
    const p = problem();
    if (p) { setErr(p); return; }
    if (!def) return;
    setBusy(true); setErr('');
    try {
      if (def.kind === 'access') {
        const body = { role: def.key, permissions: def.key === 'super_admin' ? [] : perms, ...(def.key === 'super_admin' ? { countryIds: [], zoneIds: [], cityIds: [], groupIds: [] } : sc) };
        if (newAcc && !edit) await createManagerAccount({ displayName: nu.name.trim(), email: nu.email.trim(), password: nu.password, ...body });
        else await setManagerAccess({ userId, ...body });
      } else if (def.kind === 'team' && team) {
        const others = team.members.filter((m) => m.userId !== userId).map((m) => (def.key === 'president' && m.title === 'president' ? { ...m, title: 'member' } : m));
        await setCommitteeMembers({ id: team.id, members: [...others, { userId, title: def.key }] });
      } else if (def.kind === 'kurel') {
        const cur = (kurelDoc ?? {}) as Record<string, unknown>;
        const keep: Record<string, unknown> = { groupId: kurelId, choirDeputyIds: cur.choirDeputyIds ?? [], committeeIds: cur.committeeIds ?? [] };
        KUREL_FIELDS.forEach((f) => { if (cur[f] && f !== def.key) keep[f] = cur[f]; });
        keep[def.key] = userId;
        await setKurelRoles(keep);
      }
      notify(edit ? 'Saved' : 'Role given', 'success');
      onClose();
    } catch (e) {
      setErr((e as { message?: string }).message || tx("It could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const card = (r: RoleDef) => {
    const key = catalogKey(r);
    const lockedOut = edit && r.kind !== kind;
    return (
      <button type="button" key={key} disabled={lockedOut} className={`ra-opt ${r.tone}${ck === key ? ' on' : ''}`} onClick={() => pick(key)} aria-pressed={ck === key}>
        <span className="ra-badge">{r.badge}</span>
        <span><b>{r.label}</b><small>{r.what}</small></span>
      </button>
    );
  };

  const isSuper = def?.key === 'super_admin' && def.kind === 'access';
  const presetRole = !!init.roleKey;
  const n = (k: number) => k + (presetRole ? 0 : 1);
  const whereReady = !!def && (isSuper || (kind === 'team' ? !!teamId : kind === 'kurel' ? !!kurelId : def.mode === 'all' ? (def.needs ?? []).every((nd) => sc[field[nd]].length > 0) : (def.needs ?? []).some((nd) => sc[field[nd]].length > 0)));
  // The people list starts inside the places chosen above.
  const pickerProps: Record<string, unknown> = kind === 'kurel' && kurelId ? { kurelIds: [kurelId], restrict: true, initialArea: { kurel: kurelId } }
    : kind === 'access' && sc.groupIds.length ? { kurelIds: sc.groupIds }
    : kind === 'access' && sc.cityIds.length ? { initialArea: { city: sc.cityIds[0] } }
    : kind === 'access' && sc.countryIds.length ? { initialArea: { country: sc.countryIds[0] } }
    : kind === 'access' && sc.zoneIds.length ? { initialArea: { zone: sc.zoneIds[0] } } : {};
  const pickerKey = `${ck}|${kurelId}|${sc.groupIds.join(',')}|${sc.cityIds[0] ?? ''}|${sc.countryIds[0] ?? ''}|${sc.zoneIds[0] ?? ''}`;
  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ra-modal" role="dialog" aria-modal="true" aria-label={tx("Assign a role")}>
        <header>
          <div><h2>{edit ? tx("Edit this role") : presetRole && def ? `Assign: ${def.label}` : tx("Give a role")}</h2><p>{edit ? tx("Change what this person can do.") : presetRole ? (def ? def.label : '') : tx("Pick a role, then the place, then the person.")}</p></div>
          <button type="button" aria-label={tx("Close")} onClick={onClose}>×</button>
        </header>
        <div className="ra-body">
          {!presetRole && (
            <Step n={1} title={tx("Role")} note="Pick the role. Everything else follows from it.">
              <div className="ra-group"><h4>{tx("Admin access")}</h4><div className="ra-opts">{ACCESS_ROLES.map(card)}</div></div>
              <div className="ra-group"><h4>{tx("Management team seat")}</h4><div className="ra-opts">{TEAM_TITLES.map(card)}</div></div>
              <div className="ra-group"><h4>{tx("Kurel team")}</h4><div className="ra-opts">{KUREL_ROLES.map(card)}</div></div>
            </Step>
          )}

          {def && !(isSuper) && (
            <Step n={n(1)} title={kind === 'access' ? tx("Where") : kind === 'team' ? tx("Which team") : tx("Which kurel")} note={kind === 'access' ? 'Choose the places first. The people list then follows.' : kind === 'team' ? 'Choose the team first.' : 'Choose the kurel first. Only its members are offered.'}>
              {kind === 'access' && (
                <div className="ra-chs">
                  {(def.needs ?? []).map((nd) => (
                    <Chooser key={nd} title={NEED_TITLE[nd]} hint={def.mode === 'all' ? tx("Needed together with the other list.") : def.needs && def.needs.length > 1 ? tx("Choose in either list.") : tx("Choose one or more.")} items={items[nd]} value={sc[field[nd]]} onChange={setArea(field[nd])} />
                  ))}
                </div>
              )}
              {kind === 'team' && (
                <>
                  <Dropdown label={tx("Team")} value={teamId} onChange={setTeamId} options={teams.map((t) => ({ value: t.id, label: t.name, hint: LEVEL_NAME[t.level] ?? t.level }))} />
                  {teams.length === 0 && <p className="ra-hint">{tx("No management team exists yet. Create one on the Management teams page first.")}</p>}
                  {sitting && <p className="ra-hint">{profiles[sitting.userId]?.name || tx("The current president")} {tx("is the president now. They will become a team member.")}</p>}
                </>
              )}
              {kind === 'kurel' && (
                <>
                  <Dropdown label={tx("Kurel")} value={kurelId} onChange={(v) => { setKurelId(v); setUserId(''); }} options={items.kurels.map((k) => ({ value: k.id, label: k.name, hint: k.sub }))} />
                  {holder && holder !== userId && <p className="ra-hint">{holderName || tx("Someone")} {tx("holds this role in this kurel now. They will be replaced.")}</p>}
                </>
              )}
            </Step>
          )}

          {def && (
            <Step n={n(isSuper ? 1 : 2)} title={tx("Person")} note={newAcc ? 'A new sign-in account is created with this email and password.' : whereReady ? 'Search by name or part of a phone number, or pick from the list.' : undefined}>
              {isSuper && <div className="ra-all"><b>{tx("Everywhere, all sections")}</b><span>{tx("A Super Admin works in every country, zone, city and kurel, and gets every section automatically.")}</span></div>}
              {edit || init.userId ? (
                <div className="ra-who"><Avatar name={person?.name || '…'} photoUrl={person?.photoUrl} size={44} /><span><b>{person?.name || '…'}</b><small>{person?.phone || tx("No phone on file")}</small></span></div>
              ) : !whereReady ? (
                <p className="ra-hint">{kind === 'kurel' ? tx("Choose the kurel above to see its members.") : kind === 'team' ? tx("Choose the team above first.") : tx("Choose the places above to see the people.")}</p>
              ) : newAcc ? (
                <div className="ra-new">
                  <label>{tx("Full name")}<input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></label>
                  <label>{tx("Email")}<input type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></label>
                  <label>{tx("Temporary password (8+ characters)")}<input type="text" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></label>
                </div>
              ) : (
                <MemberPicker key={pickerKey} value={userId ? [userId] : []} onChange={(ids) => setUserId(ids[0] ?? '')} selected={userId && person ? [{ id: userId, name: person.name, phone: person.phone || '', memberId: '', photoUrl: person.photoUrl }] : undefined} {...pickerProps} />
              )}
              {!edit && !init.userId && kind === 'access' && whereReady && (
                <button type="button" className="ra-link" onClick={() => { setNewAcc((v) => !v); setUserId(''); }}>{newAcc ? tx("← Choose an existing member instead") : tx("The person has no account? Create a manager account")}</button>
              )}
            </Step>
          )}

          {def && kind === 'access' && !isSuper && (
            <Step n={n(3)} title={tx("What they can do")} note="Tick the sections this person can use.">
              <div className="ra-quick">
                <button type="button" onClick={() => { setPerms(ALL_SECTIONS); setTouched(true); }}>{tx("Select all")}</button>
                <button type="button" onClick={() => { setPerms(def.preset ?? []); setTouched(true); }}>{tx("Role default")}</button>
                <button type="button" onClick={() => { setPerms([]); setTouched(true); }}>{tx("Clear")}</button>
                <span>{perms.length} {tx("of")} {ALL_SECTIONS.length}</span>
              </div>
              <div className="ra-perms">
                {SECTIONS.map((sec) => (
                  <button type="button" key={sec.key} className={perms.includes(sec.key) ? 'on' : ''} aria-pressed={perms.includes(sec.key)} onClick={() => { setPerms((p) => (p.includes(sec.key) ? p.filter((x) => x !== sec.key) : unique([...p, sec.key]))); setTouched(true); }}>
                    <i aria-hidden>{perms.includes(sec.key) ? '✓' : ''}</i>
                    <span><b>{sec.label}</b><small>{sec.what}</small></span>
                  </button>
                ))}
              </div>
            </Step>
          )}
        </div>
        <footer>
          {err ? <span className="ra-err">{err}</span> : <span className="ra-sum">{def ? <><b>{def.label}</b>{person && !newAcc ? ` · ${person.name}` : newAcc && nu.name ? ` · ${nu.name}` : ''}</> : tx("Choose a role to begin")}</span>}
          <button type="button" className="ra-ghost" onClick={onClose}>{tx("Cancel")}</button>
          <button type="button" className="ra-go" disabled={busy} onClick={save}>{busy ? tx("Saving…") : edit ? tx("Save changes") : tx("Give this role")}</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
export { ALL_ROLES };

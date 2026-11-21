'use client';

import { looseMatch } from '@/lib/looseMatch';
import { useEffect, useMemo, useState } from 'react';
import { limit as fsLimit, orderBy, Timestamp } from 'firebase/firestore';
import { fmt, useCount } from '@/lib/liveStats';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { getAccountEmails, removeManagerAccess, setCommitteeMembers, setKurelRoles, setManagerEnabled } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { Delegations, Overview, SectionMatrix, type MatrixRow } from './Panels';
import KurelCsv from './KurelCsv';
import NewTeam from './NewTeam';
import EditProfile from './EditProfile';
import Dropdown from '@/components/Dropdown';
import Assign, { type KurelDoc, type Scope4, type Team, type WizardInit } from './Assign';
import { ACCESS_ROLES, ALL_SECTIONS, KUREL_FIELDS, KUREL_ROLES, ROLE_BY_KEY, TEAM_BY_TITLE, TEAM_TITLES, catalogKey, type RoleDef } from './roles';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Scope extends Scope4 { role: string; derived?: boolean }
interface RoleDoc { isSuperAdmin?: boolean; permissions?: string[] }
interface Audit { action: string; targetUserId: string; targetEmail?: string; actorName: string; before?: Record<string, unknown>; after?: Record<string, unknown>; at?: Timestamp }

const ACTION_LABEL: Record<string, string> = { create_account: 'Account created', set_access: 'Access changed', remove_access: 'Access removed', disable_account: 'Account disabled', enable_account: 'Account enabled' };
const label = (k: unknown) => ROLE_BY_KEY[String(k)]?.label ?? String(k ?? '—');
const TABS: { key: 'all' | 'access' | 'team' | 'kurel'; name: string }[] = [{ key: 'all', name: 'All people' }, { key: 'access', name: 'Admin access' }, { key: 'team', name: 'Team seats' }, { key: 'kurel', name: 'Kurel team' }];

interface Entry {
  ck: string; def: RoleDef; where: string; areas?: string[]; derived?: boolean;
  init: WizardInit;
}

function Chips({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <span className="ra-chips">
      {shown.map((x, i) => <i key={`${x}${i}`}>{x}</i>)}
      {items.length > 3 && <button type="button" onClick={() => setAll((v) => !v)}>{all ? tx("Show less") : `+${items.length - 3} more`}</button>}
    </span>
  );
}

/** One page for every role: admin access, management team seats and kurel team roles. */
export default function RoleAccessPage() {
  const { byId, locationOf, countries } = useGroupHierarchy();
  const zones = useZones();
  const scopes = useCollection<Scope>('adminScopes', []);
  const roles = useCollection<RoleDoc>('adminRoles', []);
  const teamsRaw = useCollection<Team>('managementCommittees', []);
  const kurels = useCollection<KurelDoc>('kurelRoles', []);
  const audit = useCollection<Audit>('accessAudit', [orderBy('at', 'desc'), fsLimit(100)]);
  const [view, setView] = useState<'overview' | 'roles' | 'people' | 'sections' | 'delegations' | 'activity'>('overview');
  const [tab, setTab] = useState<'all' | 'access' | 'team' | 'kurel'>('all');
  const [deleg, setDeleg] = useState(false);
  const [csv, setCsv] = useState(false);
  const online = useCount('presence', [['lastActiveAt', '>=', Timestamp.fromMillis(Date.now() - 5 * 60 * 1000)]], 60000);
  const suspended = useCount('users', [['status', '==', 'disabled']]);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('');
  const [teamF, setTeamF] = useState('');
  const [kurelF, setKurelF] = useState('');
  const [countryF, setCountryF] = useState('');
  const [newTeam, setNewTeam] = useState(false);
  const [editProf, setEditProf] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [wiz, setWiz] = useState<WizardInit | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const teams = useMemo(() => (teamsRaw ?? []).map((t) => ({ ...t, members: t.members ?? [] })), [teamsRaw]);

  const zoneName = (id: string) => (zones ?? []).find((z) => z.id === id)?.name;
  const permsOf = (uid: string) => (roles ?? []).find((r) => r.id === uid)?.permissions ?? [];

  const people = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const add = (uid: string, e: Entry) => map.set(uid, [...(map.get(uid) ?? []), e]);
    (scopes ?? []).forEach((s) => {
      const d = ROLE_BY_KEY[s.role];
      if (!d) return;
      const places = [...(s.countryIds ?? []).map((i) => byId[i]?.name), ...(s.zoneIds ?? []).map(zoneName), ...(s.cityIds ?? []).map((i) => byId[i]?.name), ...(s.groupIds ?? []).map((i) => byId[i]?.name)].filter(Boolean) as string[];
      add(s.id, { ck: d.key, def: d, derived: !!s.derived, where: s.role === 'super_admin' ? 'Everywhere, all sections' : `${places.length} ${places.length === 1 ? 'place' : 'places'} · ${permsOf(s.id).length} of ${ALL_SECTIONS.length} sections`, areas: s.role === 'super_admin' ? [] : places, init: { roleKey: d.key, userId: s.id, edit: true, scope: { countryIds: s.countryIds ?? [], zoneIds: s.zoneIds ?? [], cityIds: s.cityIds ?? [], groupIds: s.groupIds ?? [] }, perms: permsOf(s.id) } });
    });
    (roles ?? []).forEach((r) => {
      if (r.isSuperAdmin && !(scopes ?? []).some((s) => s.id === r.id)) {
        const d = ROLE_BY_KEY.super_admin;
        add(r.id, { ck: d.key, def: d, where: 'Everywhere, all sections', init: { roleKey: d.key, userId: r.id, edit: true } });
      }
    });
    teams.forEach((t) => t.members.forEach((m) => {
      const d = TEAM_BY_TITLE[m.title];
      if (d) add(m.userId, { ck: catalogKey(d), def: d, where: t.name, init: { roleKey: catalogKey(d), userId: m.userId, edit: true, teamId: t.id } });
    }));
    (kurels ?? []).forEach((k) => KUREL_ROLES.forEach((d) => {
      const uid = k[d.key] as string | undefined;
      if (uid) add(uid, { ck: d.key, def: d, where: byId[k.id]?.name ?? 'Kurel', init: { roleKey: d.key, userId: uid, edit: true, kurelId: k.id } });
    }));
    return map;
  }, [scopes, roles, teams, kurels, byId, zones]); // eslint-disable-line react-hooks/exhaustive-deps

  const accessIds = useMemo(() => [...people.entries()].filter(([, es]) => es.some((e) => e.def.kind === 'access')).map(([id]) => id).sort().join(','), [people]);
  useEffect(() => {
    const ids = accessIds ? accessIds.split(',') : [];
    if (!ids.length) return;
    let off = false;
    (async () => {
      const out: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 100) {
        try { const r = await getAccountEmails({ userIds: ids.slice(i, i + 100) }); Object.entries(r.data.accounts).forEach(([k, v]) => { out[k] = v.email; }); } catch { /* the list still works without emails */ }
      }
      if (!off) setEmails((e) => ({ ...e, ...out }));
    })();
    return () => { off = true; };
  }, [accessIds]);
  const profiles = useUserProfiles([...people.keys(), ...(audit ?? []).flatMap((a) => [a.targetUserId, (a as unknown as { actorId?: string }).actorId ?? ''])].filter(Boolean));
  const count = useMemo(() => {
    const c: Record<string, number> = {};
    people.forEach((es) => es.forEach((e) => { c[e.ck] = (c[e.ck] ?? 0) + 1; }));
    return c;
  }, [people]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...people.entries()]
      .map(([uid, es]) => ({ uid, es: es.filter((e) => (tab === 'all' || e.def.kind === tab) && (!only || e.ck === only) && (!teamF || e.init.teamId === teamF) && (!kurelF || e.init.kurelId === kurelF) && (!countryF || (e.init.kurelId ? locationOf(e.init.kurelId).country?.id === countryF : false))) }))
      .filter((p) => p.es.length > 0)
      .filter((p) => looseMatch(needle, `${profiles[p.uid]?.name ?? ''} ${profiles[p.uid]?.phone ?? ''} ${emails[p.uid] ?? ''}`))
      .sort((a, b) => (profiles[a.uid]?.name ?? '~').localeCompare(profiles[b.uid]?.name ?? '~'));
  }, [people, tab, only, teamF, kurelF, countryF, q, profiles, locationOf, emails]);

  const fail = (e: unknown) => notify(e instanceof Error ? e.message : 'It could not be done', 'error');
  const remove = async (uid: string, e: Entry) => {
    const who = profiles[uid]?.name || 'this person';
    if (!confirm(`Remove ${e.def.label} from ${who}?`)) return;
    try {
      if (e.def.kind === 'access') await removeManagerAccess({ userId: uid });
      else if (e.def.kind === 'team') {
        const t = teams.find((x) => x.id === e.init.teamId);
        if (t) await setCommitteeMembers({ id: t.id, members: t.members.filter((m) => !(m.userId === uid && m.title === e.def.key)) });
      } else {
        const cur = (kurels ?? []).find((k) => k.id === e.init.kurelId) as Record<string, unknown> | undefined;
        const keep: Record<string, unknown> = { groupId: e.init.kurelId, choirDeputyIds: cur?.choirDeputyIds ?? [], committeeIds: cur?.committeeIds ?? [] };
        KUREL_FIELDS.forEach((f) => { if (cur?.[f] && f !== e.def.key) keep[f] = cur[f]; });
        await setKurelRoles(keep);
      }
      notify('Role removed', 'success');
    } catch (x) { fail(x); }
  };
  const toggle = async (uid: string, enabled: boolean) => {
    if (!enabled && !confirm(tx("Disable this account? They will not be able to sign in."))) return;
    try { await setManagerEnabled({ userId: uid, enabled }); notify(enabled ? 'Account enabled' : 'Account disabled', 'success'); } catch (x) { fail(x); }
  };

  const cat = (title: string, defs: RoleDef[]) => (
    <div className="ra-cat">
      <h3>{title}</h3>
      <div className="ra-cards">
        {defs.map((d) => {
          const key = catalogKey(d);
          return (
            <div key={key} className={`ra-card ${d.tone}${only === key ? ' on' : ''}`}>
              <button type="button" className="ra-pick" onClick={() => { setOnly(key); setTab('all'); setView('people'); }} aria-pressed={only === key}>
                <span className="ra-badge">{d.badge}</span>
                <span><b>{d.label}</b><small>{d.what}</small></span>
              </button>
              <footer><em>{count[key] ?? 0} {(count[key] ?? 0) === 1 ? tx("person") : tx("people")}</em><button type="button" onClick={() => setWiz({ roleKey: key })}>{tx("+ Assign")}</button></footer>
            </div>
          );
        })}
      </div>
    </div>
  );

  const loading = scopes === null || roles === null || teamsRaw === null || kurels === null;
  const accessRows: MatrixRow[] = [...people.entries()].flatMap(([uid, es]) => es.filter((e) => e.def.kind === 'access').map((e) => ({ userId: uid, name: profiles[uid]?.name || '…', roleKey: e.def.key, roleLabel: e.def.label, tone: e.def.tone, badge: e.def.badge, perms: (e.init.perms ?? []), edit: () => setWiz(e.init) }))).sort((a, b) => a.name.localeCompare(b.name));
  const supers = accessRows.filter((r) => r.roleKey === 'super_admin').length;
  const goRole = (k: string) => { setOnly(k); setTab('all'); setView('people'); };
  const VIEWS: { key: typeof view; name: string }[] = [{ key: 'overview', name: 'Overview' }, { key: 'roles', name: 'Roles' }, { key: 'people', name: 'People' }, { key: 'sections', name: 'Sections' }, { key: 'delegations', name: 'Delegations' }, { key: 'activity', name: 'Activity' }];
  void showAudit; void setShowAudit;

  return (
    <div className="ra">
      <div className="section-head">
        <div>
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{tx("Roles & access")}</h1>
          <p>{tx("Create roles, give them to people, decide which sections each one sees, and follow every change. One place for admin access, management teams and kurel roles.")}</p>
        </div>
        <div className="ra-headbtns">
          <button className="fx2-btn" onClick={() => { setView('delegations'); setDeleg(true); }}>{tx("+ Delegate")}</button>
          <button className="fx2-btn" onClick={() => setNewTeam(true)}>{tx("+ New team")}</button>
          <button className="fx2-btn" onClick={() => setCsv(true)}>{tx("Import kurel team (CSV)")}</button>
          <button className="fx2-btn primary" onClick={() => setWiz({})}>{tx("+ Give a role")}</button>
        </div>
      </div>

      <div className="ra-kpis">
        <div className="ra-kpi g"><span>{tx("People with a role")}</span><strong>{loading ? '—' : people.size}</strong><small>{tx("Admin, team or kurel")}</small></div>
        <div className="ra-kpi p"><span>{tx("Super Admins")}</span><strong>{loading ? '—' : supers}</strong><small>{tx("Full access")}</small></div>
        <div className="ra-kpi b"><span>{tx("Online now")}</span><strong>{fmt(online)}</strong><small>{tx("Last 5 minutes")}</small></div>
        <div className="ra-kpi r"><span>{tx("Suspended accounts")}</span><strong>{fmt(suspended)}</strong><small>{tx("Access blocked")}</small></div>
      </div>

      <nav className="ra-views" role="tablist" aria-label={tx("Sections")}>
        {VIEWS.map((v) => <button type="button" key={v.key} role="tab" aria-selected={view === v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>{v.name}</button>)}
      </nav>

      {view === 'overview' && <Overview count={count} onRole={goRole} />}
      {view === 'roles' && (
        <div className="ra-cats">
          {cat('Admin access', ACCESS_ROLES)}
          {cat('Management team seats', TEAM_TITLES)}
          {cat('Kurel team', KUREL_ROLES)}
        </div>
      )}
      {view === 'people' && (
      <section className="ra-people">
        <div className="ra-bar">
          <div className="ra-tabs" role="tablist">
            {TABS.map((t) => <button type="button" key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setOnly(''); setTeamF(''); setKurelF(''); setCountryF(''); }}>{t.name}</button>)}
          </div>
          <input type="search" placeholder={tx("Search by name, phone or email")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {tab !== 'all' && (
          <div className="ra-fbar">
            <Dropdown label={tx("Role")} value={only} onChange={setOnly} allLabel="All roles" options={(tab === 'access' ? ACCESS_ROLES : tab === 'team' ? TEAM_TITLES : KUREL_ROLES).map((r) => ({ value: catalogKey(r), label: r.label }))} />
            {tab === 'team' && <Dropdown label={tx("Team")} value={teamF} onChange={setTeamF} allLabel="All teams" options={teams.map((t) => ({ value: t.id, label: t.name }))} />}
            {tab === 'kurel' && <Dropdown label={tx("Country")} value={countryF} onChange={setCountryF} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />}
            {tab === 'kurel' && <Dropdown label={tx("Kurel")} value={kurelF} onChange={setKurelF} allLabel="All kurels" options={(kurels ?? []).filter((k) => KUREL_ROLES.some((r) => k[r.key])).map((k) => ({ value: k.id, label: byId[k.id]?.name ?? k.id })).sort((x, y) => x.label.localeCompare(y.label))} />}
            {(only || teamF || kurelF || countryF) && <button type="button" className="ra-clear" onClick={() => { setOnly(''); setTeamF(''); setKurelF(''); setCountryF(''); }}>{tx("Clear filters")}</button>}
            {tab === 'team' && <button type="button" className="ra-newteam" onClick={() => setNewTeam(true)}>{tx("+ New team")}</button>}
          </div>
        )}
        {tab === 'team' && (
          <div className="ra-teams">
            {teams.length === 0 && <p className="fx2-empty">{tx("No team yet. Use “+ New team” to create the first one.")}</p>}
            {teams.map((t) => (
              <button type="button" key={t.id} className={teamF === t.id ? 'on' : ''} onClick={() => setTeamF(teamF === t.id ? '' : t.id)}>
                <b>{t.name}</b><small>{t.level} · {t.members.length} {t.members.length === 1 ? tx("person") : tx("people")}</small>
              </button>
            ))}
          </div>
        )}
        {only && tab === 'all' && <div className="ra-filter">{tx("Showing only")} <b>{label(only.replace('team:', ''))}</b><button type="button" onClick={() => setOnly('')}>{tx("Show everyone")}</button></div>}
        {loading ? <p>{tx("Loading…")}</p> : list.length === 0 ? <p className="fx2-empty">{tx("Nobody matches. Use “Give a role” to add someone.")}</p> : (
          <div className="ra-list">
            {list.map(({ uid, es }) => (
              <article key={uid} className="ra-person">
                <header>
                  <Avatar name={profiles[uid]?.name || '…'} photoUrl={profiles[uid]?.photoUrl} size={44} />
                  <span><PersonLink userId={uid}><b>{profiles[uid] ? profiles[uid].name || tx("Unnamed account") : tx("Loading…")}</b></PersonLink><small>{emails[uid] || profiles[uid]?.email || tx("No email")}{profiles[uid]?.phone ? ` · ${profiles[uid].phone}` : ''}</small></span>
                  <button type="button" title={tx("Change name, picture, email and password")} onClick={() => setEditProf(uid)}>{tx("Edit account")}</button>
                  <button type="button" onClick={() => setWiz({ userId: uid })}>{tx("+ Role")}</button>
                </header>
                <ul>
                  {es.map((e, i) => (
                    <li key={`${e.ck}${i}`} className={e.def.tone}>
                      <span className="ra-badge">{e.def.badge}</span>
                      <span className="ra-txt"><b>{e.def.label}</b><small>{e.where}{e.derived ? tx(" · comes from a team seat") : ''}</small>{e.areas && e.areas.length > 0 && <Chips key={`${uid}${e.ck}${i}`} items={e.areas} />}</span>
                      <span className="ra-acts">
                        {!e.derived && <button type="button" onClick={() => setWiz(e.init)}>{tx("Edit")}</button>}
                        {e.def.kind === 'access' && !e.derived && <button type="button" onClick={() => toggle(uid, false)}>{tx("Disable")}</button>}
                        {e.def.kind === 'access' && !e.derived && <button type="button" onClick={() => toggle(uid, true)}>{tx("Enable")}</button>}
                        {!e.derived && <button type="button" className="x" onClick={() => remove(uid, e)}>{tx("Remove")}</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>
      )}
      {view === 'sections' && <SectionMatrix rows={accessRows} />}
      {view === 'delegations' && <Delegations open={deleg} onClose={() => setDeleg(false)} />}
      {view === 'activity' && (
        <section className="ra-pane">
          <h2>{tx("Access changes")}</h2>
          <p>{tx("Who gave, changed or removed access, and when. Click a name for the profile.")}</p>
          <div className="ra-feed">
            {audit === null && <p>{tx("Loading…")}</p>}
            {audit !== null && audit.length === 0 && <p className="fx2-empty">{tx("No access change recorded yet.")}</p>}
            {(audit ?? []).map((a) => {
              const sum = (o?: Record<string, unknown>) => {
                if (!o) return '';
                const n = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0);
                const parts = [label(o.role), n('countryIds') && `${n('countryIds')} countries`, n('zoneIds') && `${n('zoneIds')} zones`, n('cityIds') && `${n('cityIds')} cities`, n('groupIds') && `${n('groupIds')} kurels`, Array.isArray(o.permissions) && o.role !== 'super_admin' ? `${n('permissions')} sections` : ''].filter(Boolean);
                return parts.join(' · ');
              };
              const actor = (a as unknown as { actorId?: string }).actorId;
              const by = (actor && profiles[actor]?.name) || (a.actorName !== 'Unknown' ? a.actorName : '') || 'an admin';
              const nowTxt = sum(a.after); const was = sum(a.before);
              const tone = a.action === 'remove_access' || a.action === 'disable_account' ? 'r' : a.action === 'create_account' ? 'g' : a.action === 'enable_account' ? 'g' : 'y';
              return (
                <div key={a.id} className={`ra-ev ${tone}`}>
                  <Avatar name={profiles[a.targetUserId]?.name || '…'} photoUrl={profiles[a.targetUserId]?.photoUrl} size={36} />
                  <span className="ra-evt">
                    <b>{a.targetUserId ? <PersonLink userId={a.targetUserId}>{profiles[a.targetUserId]?.name || a.targetEmail || tx("Open profile")}</PersonLink> : a.targetEmail}</b>
                    <small>{ACTION_LABEL[a.action] ?? a.action} {tx("by")} {by}{nowTxt ? ` · now ${nowTxt}` : ''}{was && was !== nowTxt ? ` · was ${was}` : ''}</small>
                  </span>
                  <time>{tsMs(a.at) ? new Date(tsMs(a.at)).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</time>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {newTeam && <NewTeam onClose={() => setNewTeam(false)} />}
      {editProf && <EditProfile key={editProf} userId={editProf} name={profiles[editProf]?.name ?? ''} photoUrl={profiles[editProf]?.photoUrl} email={emails[editProf] ?? profiles[editProf]?.email} canLogin={emails[editProf] !== undefined} onSaved={(m) => m && setEmails((e) => ({ ...e, [editProf]: m }))} onClose={() => setEditProf(null)} />}
      {csv && <KurelCsv onClose={() => setCsv(false)} />}
      {wiz && <Assign init={wiz} teams={teams} kurelDocs={kurels ?? []} onClose={() => setWiz(null)} />}
    </div>
  );
}

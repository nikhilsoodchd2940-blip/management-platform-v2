'use client';

import { useState } from 'react';
import { collection, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useGroupMembers } from '@/lib/useGroupMembers';
import { createDelegation, revokeDelegation } from '@/lib/functions';
import { notify } from '@/lib/notify';
import FormDialog from '@/components/FormDialog';
import { useEffect } from 'react';
import { ACCESS_ROLES, ALL_SECTIONS, KUREL_ROLES, SECTIONS, TEAM_TITLES, catalogKey, type RoleDef } from './roles';
import { tx, dateLocale } from '@/lib/i18n/tr';

/** Where each role sits in the organisation and what it can do, in plain words. */
const FACTS: Record<string, { level: string; sees: string; admins: string }> = {
  super_admin: { level: 'Organisation', sees: 'Everything, everywhere', admins: 'Yes, manages all admins' },
  zone_admin: { level: 'Country / Zone', sees: 'Assigned countries and zones, with their cities and kurels', admins: 'No' },
  city_manager: { level: 'City', sees: 'Assigned cities, with their kurels', admins: 'No' },
  city_zone_manager: { level: 'Local city zone', sees: 'Kurels in a chosen city and zone', admins: 'No' },
  group_manager: { level: 'Kurel', sees: 'Assigned kurels only', admins: 'No' },
  president: { level: 'Team', sees: 'The team’s level; leads it', admins: 'No' },
  vice_president: { level: 'Team', sees: 'The team’s level; assists the president', admins: 'No' },
  secretary: { level: 'Team', sees: 'The team’s level; keeps records', admins: 'No' },
  treasurer: { level: 'Team', sees: 'The team’s level; follows the money', admins: 'No' },
  member: { level: 'Team', sees: 'The team’s level', admins: 'No' },
};

const LADDER: { level: string; note: string; roles: RoleDef[] }[] = [
  { level: 'Organisation', note: 'The whole organisation', roles: [ACCESS_ROLES[0]] },
  { level: 'Country and zone', note: 'Countries, zones and the cities inside them', roles: [ACCESS_ROLES[1]] },
  { level: 'City', note: 'One or more cities', roles: [ACCESS_ROLES[2]] },
  { level: 'Local city zone', note: 'A city and a zone together', roles: [ACCESS_ROLES[3]] },
  { level: 'Management team', note: 'Seats on a team at any level above', roles: TEAM_TITLES },
  { level: 'Kurel', note: 'One kurel', roles: [ACCESS_ROLES[4], ...KUREL_ROLES] },
];

export function Overview({ count, onRole }: { count: Record<string, number>; onRole: (key: string) => void }) {
  return (
    <div className="ra-ov">
      <article className="ra-pane">
        <h2>{tx("Organisation levels")}</h2>
        <p>{tx("Who works at each level. Click a role to see its people.")}</p>
        <div className="ra-ladder">
          {LADDER.map((l, i) => (
            <div key={l.level} className="ra-rung" style={{ marginLeft: Math.min(i, 4) * 14 }}>
              <div className="ra-rl"><b>{l.level}</b><small>{l.note}</small></div>
              <div className="ra-rc">
                {l.roles.map((r) => {
                  const k = catalogKey(r);
                  return <button type="button" key={k} className={r.tone} onClick={() => onRole(k)}><span>{r.badge}</span>{r.label}<em>{count[k] ?? 0}</em></button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </article>
      <article className="ra-pane">
        <h2>{tx("Rights by role")}</h2>
        <p>{tx("What each admin role can see and do.")}</p>
        <div className="ra-twrap">
          <table className="ra-table">
            <thead><tr><th>{tx("Role")}</th><th>{tx("Level")}</th><th>{tx("Can see")}</th><th>{tx("Manages admins")}</th><th>{tx("People")}</th></tr></thead>
            <tbody>
              {[...ACCESS_ROLES, ...TEAM_TITLES].map((r) => {
                const k = catalogKey(r); const f = FACTS[r.key];
                return (
                  <tr key={k}>
                    <td><span className={`ra-dot ${r.tone}`}>{r.badge}</span><b>{r.label}</b></td>
                    <td>{f.level}</td><td>{f.sees}</td><td className={f.admins === 'No' ? 'no' : 'yes'}>{f.admins}</td><td>{count[k] ?? 0}</td>
                  </tr>
                );
              })}
              <tr><td><span className="ra-dot g">KT</span><b>{tx("Kurel team roles")}</b></td><td>{tx("Kurel")}</td><td>{tx("Their own kurel, in the app (leader validates operations)")}</td><td className="no">{tx("No")}</td><td>{KUREL_ROLES.reduce((n, r) => n + (count[r.key] ?? 0), 0)}</td></tr>
              <tr><td><span className="ra-dot b">M</span><b>{tx("Member")}</b></td><td>{tx("Personal")}</td><td>{tx("Own profile and own kurel, in the app")}</td><td className="no">{tx("No")}</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export interface MatrixRow { userId: string; name: string; roleKey: string; roleLabel: string; tone: string; badge: string; perms: string[]; edit: () => void }

export function SectionMatrix({ rows }: { rows: MatrixRow[] }) {
  return (
    <div className="ra-ov">
      <article className="ra-pane">
        <h2>{tx("Role defaults")}</h2>
        <p>{tx("The sections a new admin gets for each role. You can change them for any person.")}</p>
        <div className="ra-twrap">
          <table className="ra-table ra-mx">
            <thead><tr><th>{tx("Role")}</th>{SECTIONS.map((s) => <th key={s.key} title={s.what}>{s.label}</th>)}</tr></thead>
            <tbody>
              {ACCESS_ROLES.map((r) => (
                <tr key={r.key}>
                  <td><span className={`ra-dot ${r.tone}`}>{r.badge}</span><b>{r.label}</b></td>
                  {SECTIONS.map((s) => { const on = r.key === 'super_admin' || (r.preset ?? []).includes(s.key); return <td key={s.key} className={on ? 'on' : 'off'}>{on ? '✓' : '–'}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      <article className="ra-pane">
        <h2>{tx("Section visibility per person")}</h2>
        <p>{tx("What each admin can open today. Click a row to change it.")}</p>
        <div className="ra-twrap">
          <table className="ra-table ra-mx">
            <thead><tr><th>{tx("Person")}</th>{SECTIONS.map((s) => <th key={s.key} title={s.what}>{s.label}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={SECTIONS.length + 1} className="fx2-empty">{tx("No admin yet.")}</td></tr>}
              {rows.map((r) => (
                <tr key={r.userId} className="click" onClick={r.edit}>
                  <td><span className={`ra-dot ${r.tone}`}>{r.badge}</span><b>{r.name}</b><small>{r.roleLabel}</small></td>
                  {ALL_SECTIONS.map((s) => { const on = r.roleKey === 'super_admin' || r.perms.includes(s); return <td key={s} className={on ? 'on' : 'off'}>{on ? '✓' : '–'}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function Delegations({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { byId, activeLeafGroups } = useGroupHierarchy();
  const list = useCollection<{ groupId: string; role: string; fromName: string; toName: string; startAt: unknown; endAt: unknown; reason?: string; status: 'active' | 'revoked' }>('delegations', [orderBy('createdAt', 'desc'), fsLimit(30)]);
  const [group, setGroup] = useState('');
  const members = useGroupMembers(group);
  const now = Date.now();
  return (
    <>
      <article className="ra-pane">
        <h2>{tx("Temporary delegations")}</h2>
        <p>{tx("A kurel role handed to another member for a set period.")}</p>
        <div className="ra-dl">
          {list !== null && list.length === 0 && <p className="fx2-empty">{tx("No delegation yet. Use “Delegate” to hand a role over for a period.")}</p>}
          {(list ?? []).map((d) => {
            const live = d.status === 'active' && tsMs(d.endAt) >= now;
            return (
              <div key={d.id} className={live ? 'live' : ''}>
                <span><b>{d.fromName} → {d.toName}</b><small>{d.role.replace('_', ' ')} · {byId[d.groupId]?.name ?? ''} · {new Date(tsMs(d.startAt)).toLocaleDateString(dateLocale())} – {new Date(tsMs(d.endAt)).toLocaleDateString(dateLocale())}{d.reason ? ` · ${d.reason}` : ''}</small></span>
                {live ? <button type="button" onClick={() => revokeDelegation({ delegationId: d.id }).then(() => notify('Delegation revoked', 'success')).catch((e: Error) => notify(e.message, 'error'))}>{tx("Revoke")}</button> : <em>{d.status === 'revoked' ? tx("Revoked") : tx("Expired")}</em>}
              </div>
            );
          })}
        </div>
      </article>
      {open && (
        <FormDialog
          title={tx("Delegate a function temporarily")}
          intro="The kurel leader transfers validation authority; the general supervisor and the pedagogy president can also delegate. The delegate must be an active member of the kurel."
          submitLabel={tx("Delegate")}
          onClose={onClose}
          onValuesChange={(v) => setGroup(v.groupId)}
          fields={[
            { name: 'groupId', label: tx("Kurel"), type: 'select', required: true, options: activeLeafGroups.map((g) => ({ value: g.id, label: g.name })) },
            { name: 'role', label: tx("Function"), type: 'select', required: true, options: [{ value: 'leader', label: tx("Kurel leader") }, { value: 'surveillant', label: tx("General supervisor") }, { value: 'pedagogy_president', label: tx("Pedagogy committee president") }] },
            { name: 'toUserId', label: tx("Delegate"), type: 'select', required: true, options: members.map((m) => ({ value: m.id, label: m.name })) },
            { name: 'start', label: tx("From"), type: 'date', required: true },
            { name: 'end', label: tx("Until"), type: 'date', required: true },
            { name: 'reason', label: tx("Reason"), type: 'textarea' },
          ]}
          onSubmit={(v) => createDelegation({ groupId: v.groupId, role: v.role, toUserId: v.toUserId, startMs: new Date(v.start).getTime(), endMs: new Date(v.end).getTime() + 86399000, reason: v.reason }).then(() => notify('Delegation created', 'success'))}
        />
      )}
    </>
  );
}

export function SecurityLog({ names }: { names: Record<string, string> }) {
  const [rows, setRows] = useState<{ id: string; action: string; actor: string; result: string; ms: number }[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), fsLimit(12)), (snap) =>
    setRows(snap.docs.map((d) => ({ id: d.id, action: (d.data().action as string) ?? '', actor: (d.data().actorUserId as string) ?? '', result: (d.data().result as string) ?? '', ms: (d.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0 })))), []);
  return (
    <article className="ra-pane">
      <h2>{tx("Security log")}</h2>
      <p>{tx("Sensitive actions recorded by the server.")}</p>
      <div className="ra-log">
        {rows.length === 0 && <p className="fx2-empty">{tx("No entries.")}</p>}
        {rows.map((a) => (
          <div key={a.id}><time>{a.ms ? new Date(a.ms).toLocaleString(dateLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</time><b>{a.action}</b><span>{names[a.actor] || `${a.actor.slice(0, 8)}…`}</span><em className={a.result === 'SUCCESS' ? '' : 'bad'}>{a.result === 'SUCCESS' ? tx("Logged") : tx("Alert")}</em></div>
        ))}
      </div>
    </article>
  );
}

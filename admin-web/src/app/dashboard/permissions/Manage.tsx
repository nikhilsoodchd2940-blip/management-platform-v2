'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCollection } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { setManagerEnabled } from '@/lib/functions';
import FormDialog from '@/components/FormDialog';
import AccessDialog, { ACCESS_ROLES, ACCESS_ROLE_LABEL } from '@/components/AccessDialog';
import { notify } from '@/lib/notify';

interface Scope { role: string; countryIds: string[]; zoneIds: string[]; cityIds: string[]; groupIds: string[] }
interface RoleDoc { isSuperAdmin?: boolean; permissions?: string[] }
interface Row extends Scope { userId: string; permissions: string[] }

/** All accounts that have admin access: search, filter by role, and change what each one can manage. */
export default function PermissionsManage() {
  const { user } = useAuth();
  const { byId } = useGroupHierarchy();
  const scopes = useCollection<Scope>('adminScopes', []);
  const roles = useCollection<RoleDoc>('adminRoles', []);
  const zones = useZones();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [edit, setEdit] = useState<null | { userId: string; name: string }>(null);
  const [adding, setAdding] = useState(false);

  const me = (roles ?? []).find((r) => r.id === user?.uid);
  const isSuper = me?.isSuperAdmin === true;

  const rows = useMemo(() => {
    const out = new Map<string, Row>();
    (scopes ?? []).forEach((s) => out.set(s.id, { ...s, userId: s.id, permissions: [] }));
    (roles ?? []).forEach((r) => {
      const ex = out.get(r.id);
      if (ex) ex.permissions = r.permissions ?? [];
      else out.set(r.id, { userId: r.id, role: r.isSuperAdmin ? 'super_admin' : 'unrestricted', countryIds: [], zoneIds: [], cityIds: [], groupIds: [], permissions: r.permissions ?? [] });
    });
    return Array.from(out.values());
  }, [scopes, roles]);
  const profiles = useUserProfiles(rows.map((r) => r.userId));
  const names = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.name]));

  const area = (r: Row) => {
    const parts = [...r.countryIds.map((i) => byId[i]?.name), ...r.zoneIds.map((i) => (zones ?? []).find((z) => z.id === i)?.name), ...r.cityIds.map((i) => byId[i]?.name), ...r.groupIds.map((i) => byId[i]?.name)].filter(Boolean);
    return parts.length ? parts.join(', ') : r.role === 'super_admin' || r.role === 'unrestricted' ? 'Everywhere' : '—';
  };

  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!roleFilter || r.role === roleFilter) && (!term || (names[r.userId] ?? '').toLowerCase().includes(term) || r.userId.toLowerCase().includes(term) || area(r).toLowerCase().includes(term)));

  async function toggle(r: Row, enabled: boolean) {
    if (!confirm(enabled ? 'Enable this account?' : 'Disable this account? They will not be able to sign in.')) return;
    try { await setManagerEnabled({ userId: r.userId, enabled }); notify(enabled ? 'Account enabled' : 'Account disabled', 'success'); } catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); }
  }

  if (roles === null || scopes === null) return <p>Loading…</p>;
  if (!isSuper) return <p style={{ color: 'var(--ink-soft)' }}>Only a Super Admin can manage admin permissions.</p>;

  return (
    <div>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>Search an account, filter by role and change what it can manage.</p>
      <div className="fx2-bar">
        <input type="search" placeholder="Search by name or area" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ACCESS_ROLES.map((r) => <option key={r.value} value={r.value}>{ACCESS_ROLE_LABEL[r.value]}</option>)}
          <option value="unrestricted">Admin (no area limit)</option>
        </select>
        <button type="button" className="fx2-btn primary" onClick={() => setAdding(true)}>+ Give a member access</button>
      </div>
      {shown.length === 0 ? <p className="fx2-empty">No account matches.</p> : (
        <table className="fx2-table">
          <thead><tr><th>Person</th><th>Role</th><th>Works in</th><th>Sections</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.userId}>
                <td><span className="who-cell"><Avatar name={names[r.userId] || r.userId} photoUrl={profiles[r.userId]?.photoUrl} size={30} /><strong>{names[r.userId] || r.userId}</strong></span></td>
                <td><span className="fx2-pill info">{r.role === 'unrestricted' ? 'Admin (no area limit)' : ACCESS_ROLE_LABEL[r.role] ?? r.role}</span></td>
                <td>{area(r)}</td>
                <td>{r.role === 'super_admin' || r.permissions.length === 0 ? 'All' : r.permissions.join(', ')}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="fx2-btn" onClick={() => setEdit({ userId: r.userId, name: names[r.userId] ?? '' })}>Manage access</button>{' '}
                  <button type="button" className="fx2-btn danger" onClick={() => toggle(r, false)}>Disable</button>{' '}
                  <button type="button" className="fx2-btn" onClick={() => toggle(r, true)}>Enable</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <AccessDialog userId={edit.userId} name={edit.name} onClose={() => setEdit(null)} />}
      {adding && (
        <FormDialog
          title="Give a member access"
          intro="Search the member, then choose the role and areas on the next screen."
          submitLabel="Continue"
          onClose={() => setAdding(false)}
          fields={[{ name: 'userId', label: 'Member', type: 'member', required: true }]}
          onSubmit={async (v) => { setAdding(false); setEdit({ userId: v.userId, name: '' }); }}
        />
      )}
    </div>
  );
}

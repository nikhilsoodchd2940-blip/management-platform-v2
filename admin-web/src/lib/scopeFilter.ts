import type { DocumentData } from 'firebase/firestore';

/**
 * Role scoping for what an admin SEES.
 *
 * Super Admin and plain admins (no adminScopes doc) see everything. Zone
 * Manager, City Manager, City Zone Manager and Group Admin only see the
 * records that belong to their own zones, cities or groups. The same rule
 * is applied on the server to every change (modules/access/scope.ts); this
 * file applies it to what is shown, in one place, for every list in the
 * panel (see lib/firestore.ts).
 */

export interface Scope {
  role: string;
  countryIds: string[];
  zoneIds: string[];
  cityIds: string[];
  groupIds: string[];
}
export interface Geo {
  countryId?: string;
  zoneId?: string;
  cityId?: string;
  groupId?: string;
}
export interface GroupNodeLite {
  id: string;
  type: 'main' | 'country' | 'city' | 'group';
  parentGroupId?: string;
  zoneId?: string;
}

/** Same rule as the server (modules/access/scope.ts). */
export function geoInScope(scope: Scope | null, geo: Geo): boolean {
  if (!scope || scope.role === 'super_admin') return true;
  const hit = {
    country: !!geo.countryId && scope.countryIds.includes(geo.countryId),
    zone: !!geo.zoneId && scope.zoneIds.includes(geo.zoneId),
    city: !!geo.cityId && scope.cityIds.includes(geo.cityId),
    group: !!geo.groupId && scope.groupIds.includes(geo.groupId),
  };
  if (scope.role === 'city_zone_manager') return hit.city && hit.zone;
  // A Group Admin sees only the groups assigned to them (same as the server).
  if (scope.role === 'group_manager') return hit.group;
  return hit.country || hit.zone || hit.city || hit.group;
}

let scope: Scope | null = null;
let nodes: Record<string, GroupNodeLite> = {};
let memberUids: Set<string> = new Set();
let myUid = '';
let version = 0;
let visibleCache: { v: number; ids: Set<string> } | null = null;
const listeners = new Set<() => void>();

export function configureScope(next: { scope?: Scope | null; nodes?: Record<string, GroupNodeLite>; memberUids?: Set<string>; uid?: string }) {
  if (next.scope !== undefined) scope = next.scope;
  if (next.nodes) nodes = next.nodes;
  if (next.memberUids) memberUids = next.memberUids;
  if (next.uid !== undefined) myUid = next.uid;
  version += 1;
  visibleCache = null;
  listeners.forEach((l) => l());
}
export function onScopeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const scopedMemberUids = () => memberUids;
export const isRestricted = () => !!scope && scope.role !== 'super_admin';
export const currentScope = () => scope;

/** Resolves a group, city, country or zone reference to everything we know about where it sits. */
function enrich(geo: Geo): Geo {
  const out: Geo = { ...geo };
  const g = out.groupId ? nodes[out.groupId] : undefined;
  if (g) {
    if (g.type === 'group') {
      const city = g.parentGroupId ? nodes[g.parentGroupId] : undefined;
      if (city) {
        out.cityId ??= city.id;
        out.zoneId ??= city.zoneId;
        out.countryId ??= city.parentGroupId;
      }
    } else if (g.type === 'city') {
      out.cityId ??= g.id;
      out.zoneId ??= g.zoneId;
      out.countryId ??= g.parentGroupId;
      out.groupId = undefined;
    } else if (g.type === 'country') {
      out.countryId ??= g.id;
      out.groupId = undefined;
    }
  }
  const c = out.cityId ? nodes[out.cityId] : undefined;
  if (c) {
    out.zoneId ??= c.zoneId;
    out.countryId ??= c.parentGroupId;
  }
  return out;
}

export function geoVisible(geo: Geo): boolean {
  return geoInScope(scope, enrich(geo));
}

/** Every group node the admin may see: their own areas, everything inside them, and the parents needed to show a path. */
export function visibleGroupIds(): Set<string> {
  if (visibleCache && visibleCache.v === version) return visibleCache.ids;
  const ids = new Set<string>();
  const all = Object.values(nodes);
  for (const n of all) {
    if (n.type === 'main') continue;
    if (geoVisible({ groupId: n.id })) ids.add(n.id);
  }
  // A zone-level manager owns the cities of the zone: their groups are covered by enrich(); now add ancestors.
  for (const id of [...ids]) {
    let p = nodes[id]?.parentGroupId;
    while (p && !ids.has(p)) {
      ids.add(p);
      p = nodes[p]?.parentGroupId;
    }
  }
  visibleCache = { v: version, ids };
  return ids;
}

const GROUP_FIELDS = ['groupId', 'primaryGroupId', 'toGroupId', 'fromGroupId', 'targetGroupId', 'kurelId'];
const GROUP_ARRAYS = ['subGroupIds', 'groupIds', 'targetGroupIds'];
const USER_FIELDS = ['userId', 'targetUserId', 'memberUserId'];
/** Collections that describe the organisation itself or the admin's own account: never narrowed here. */
const PASS = new Set(['orgSettings', 'adminRoles', 'adminScopes', 'accessAudit', 'presence', 'notifications', 'config', 'levels']);

/** Whether an admin with the current role may see this record. */
export function docVisible(collectionId: string, id: string, data: DocumentData): boolean {
  if (!isRestricted()) return true;
  if (PASS.has(collectionId)) return true;

  if (collectionId === 'groups') {
    if (data.type === 'main') return true;
    return visibleGroupIds().has(id);
  }
  if (collectionId === 'zones') {
    if (geoInScope(scope, { zoneId: id, countryId: data.countryId as string | undefined })) return true;
    return Object.values(nodes).some((n) => n.type === 'city' && n.zoneId === id && visibleGroupIds().has(n.id));
  }
  if (collectionId === 'users') {
    if (id === myUid) return true;
    if (memberUids.has(id)) return true;
    return typeof data.primaryGroupId === 'string' && geoVisible({ groupId: data.primaryGroupId });
  }

  // Geographic references carried by the record itself.
  const geos: Geo[] = [];
  for (const f of GROUP_FIELDS) if (typeof data[f] === 'string' && data[f]) geos.push({ groupId: data[f] as string });
  for (const f of GROUP_ARRAYS) if (Array.isArray(data[f])) for (const g of data[f] as unknown[]) if (typeof g === 'string') geos.push({ groupId: g });
  if (typeof data.cityId === 'string' || typeof data.zoneId === 'string' || typeof data.countryId === 'string') {
    geos.push({ cityId: data.cityId as string | undefined, zoneId: data.zoneId as string | undefined, countryId: data.countryId as string | undefined });
  }
  if (geos.length) return geos.some(geoVisible);

  // Otherwise follow the person the record is about.
  const people = USER_FIELDS.map((f) => data[f]).filter((v): v is string => typeof v === 'string' && !!v);
  if (people.length) return people.some((u) => u === myUid || memberUids.has(u));

  return true;
}


/**
 * A record can be visible because ONE of its groups is yours, yet still list many other groups
 * (an event with 22 kurels). Restricted roles only get the part about their own groups.
 */
export function trimForScope(collectionId: string, data: DocumentData): DocumentData {
  if (!isRestricted() || PASS.has(collectionId) || collectionId === 'groups' || collectionId === 'zones' || collectionId === 'users') return data;
  let out: DocumentData = data;
  for (const f of GROUP_ARRAYS) {
    const v = data[f];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      const kept = (v as string[]).filter((g) => geoVisible({ groupId: g }));
      if (kept.length !== v.length) out = { ...out, [f]: kept };
    }
  }
  if (Array.isArray(data.sites)) {
    const sites = (data.sites as { groupIds?: string[] }[])
      .map((x) => (Array.isArray(x.groupIds) ? { ...x, groupIds: x.groupIds.filter((g) => geoVisible({ groupId: g })) } : x))
      .filter((x, i) => !Array.isArray((data.sites as { groupIds?: string[] }[])[i].groupIds) || (x.groupIds as string[]).length > 0);
    out = { ...out, sites };
  }
  return out;
}

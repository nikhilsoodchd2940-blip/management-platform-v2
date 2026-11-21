'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from './firebase';
import { reportDataError } from './notify';
import { docVisible, isRestricted, onScopeChange } from './scopeFilter';

export type GroupType = 'main' | 'country' | 'city' | 'group';

export interface GroupNode {
  id: string;
  name: string;
  type: GroupType;
  parentGroupId?: string;
  status: 'active' | 'archived';
  /** Leaf ('group') type only — optional max active+host headcount. */
  capacity?: number;
  /** Special kurel: depends directly on the national direction. */
  special?: boolean;
  /** Academic level (levels/{id}) — leaf kurels only. */
  levelId?: string;
  /** City nodes only. */
  zoneId?: string;
  timeZone?: string;
  /** Leaf kurels: the local zone of their city. */
  localZoneId?: string;
}

function useGroupHierarchyState() {
  // `allGroups` is the whole tree (needed to resolve paths and to work out a role's reach);
  // `groups` is what the signed-in role may see and is what every screen lists.
  const [allGroups, setAllGroups] = useState<GroupNode[]>([]);
  const [scopeVersion, setScopeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'groups'), orderBy('name'));
    return onSnapshot(
      q,
      (snap) => {
        setAllGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GroupNode, 'id'>) })));
        setError(false);
        setLoading(false);
      },
      (e) => {
        reportDataError(e);
        // Stop the endless "Loading…" — pages show their empty state and
        // the toast (lib/firestore.ts) explains what went wrong.
        setError(true);
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => onScopeChange(() => setScopeVersion((v) => v + 1)), []);

  const byId = useMemo(() => {
    const map: Record<string, GroupNode> = {};
    allGroups.forEach((g) => (map[g.id] = g));
    return map;
  }, [allGroups]);

  // Only current data: a node whose parent (city, country…) was deleted or archived is left over and is never listed, whatever its own status.
  const groups = useMemo(() => {
    const live = (g: GroupNode) => {
      let p = g.parentGroupId ? byId[g.parentGroupId] : undefined;
      if (g.parentGroupId && !p) return false;
      for (let i = 0; p && i < 6; i++) {
        if (p.status !== 'active') return false;
        if (!p.parentGroupId) return true;
        p = byId[p.parentGroupId];
        if (!p) return false;
      }
      return true;
    };
    const alive = allGroups.filter(live);
    return isRestricted() ? alive.filter((g) => docVisible('groups', g.id, g)) : alive;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeVersion is the signal that the role's reach changed
  }, [allGroups, byId, scopeVersion]);

  const mainGroups = useMemo(() => groups.filter((g) => g.type === 'main' && g.status === 'active'), [groups]);

  const countries = useMemo(
    () => groups.filter((g) => g.type === 'country' && g.status === 'active').sort((a, b) => a.name.localeCompare(b.name)),
    [groups]
  );

  // A city whose country was deleted or archived is left over: it is not listed anywhere.
  const cities = useMemo(
    () =>
      groups
        .filter((g) => g.type === 'city' && g.status === 'active' && byId[g.parentGroupId ?? '']?.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groups, byId]
  );

  /** Every kurel including archived ones (the Groups directory shows them with an "Archived" badge). */
  const leafGroups = useMemo(
    () => groups.filter((g) => g.type === 'group').sort((a, b) => a.name.localeCompare(b.name)),
    [groups]
  );

  /**
   * Active kurels only. Use this for counts, statistics and every
   * dropdown where an admin picks a kurel — archived kurels must not be
   * counted as "active", flagged "empty", or offered as a target.
   */
  const activeLeafGroups = useMemo(
    () => leafGroups.filter((g) => g.status === 'active' && byId[g.parentGroupId ?? '']?.status === 'active' && byId[byId[g.parentGroupId ?? '']?.parentGroupId ?? '']?.status === 'active'),
    [leafGroups, byId]
  );

  const citiesOf = useCallback((countryId: string) => cities.filter((c) => c.parentGroupId === countryId), [cities]);

  const groupsOf = useCallback(
    (cityId: string) => activeLeafGroups.filter((g) => g.parentGroupId === cityId),
    [activeLeafGroups]
  );

  /** Walks a leaf group up to its City and Country nodes (undefined if archived/orphaned along the way). */
  const locationOf = useCallback(
    (groupId: string): { country?: GroupNode; city?: GroupNode } => {
      const group = byId[groupId];
      const city = group?.parentGroupId ? byId[group.parentGroupId] : undefined;
      const country = city?.parentGroupId ? byId[city.parentGroupId] : undefined;
      return { country, city };
    },
    [byId]
  );

  return useMemo(
    () => ({
      groups,
      allGroups,
      byId,
      loading,
      error,
      mainGroups,
      countries,
      cities,
      leafGroups,
      activeLeafGroups,
      citiesOf,
      groupsOf,
      locationOf,
    }),
    [groups, allGroups, byId, loading, error, mainGroups, countries, cities, leafGroups, activeLeafGroups, citiesOf, groupsOf, locationOf]
  );
}

type GroupHierarchy = ReturnType<typeof useGroupHierarchyState>;

const GroupHierarchyContext = createContext<GroupHierarchy | null>(null);

/**
 * One live subscription to the `groups` collection for the whole
 * dashboard. Previously every page opened its own listener, so
 * navigating between pages re-downloaded the entire hierarchy each
 * time (extra Firestore reads + a flash of "Loading…" on every page).
 * Mounted once in app/dashboard/layout.tsx.
 */
export function GroupHierarchyProvider({ children }: { children: ReactNode }) {
  const value = useGroupHierarchyState();
  return <GroupHierarchyContext.Provider value={value}>{children}</GroupHierarchyContext.Provider>;
}

export function useGroupHierarchy(): GroupHierarchy {
  const ctx = useContext(GroupHierarchyContext);
  if (!ctx) throw new Error('useGroupHierarchy() must be used within <GroupHierarchyProvider>');
  return ctx;
}

/** Drops places whose city, country or main group was deleted or archived: only current data is ever used. */
export function keepLiveGroups<T extends { id: string; parentGroupId?: string; status: string }>(rows: T[]): T[] {
  const by = new Map(rows.map((g) => [g.id, g]));
  const live = (g: T) => {
    let p = g.parentGroupId ? by.get(g.parentGroupId) : undefined;
    if (g.parentGroupId && !p) return false;
    for (let i = 0; p && i < 6; i++) {
      if (p.status !== 'active') return false;
      p = p.parentGroupId ? by.get(p.parentGroupId) : undefined;
      if (!p) return true;
    }
    return true;
  };
  return rows.filter(live);
}

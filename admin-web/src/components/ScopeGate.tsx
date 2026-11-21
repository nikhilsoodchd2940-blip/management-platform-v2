'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { collection, onSnapshot as rawOnSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { configureScope, geoInScope, type GroupNodeLite } from '@/lib/scopeFilter';
import { tx } from '@/lib/i18n/tr';

/**
 * Tells the data layer which role is signed in, and holds the page back
 * until that is known, so a Zone / City / Group manager never sees a flash
 * of other areas' data. Super Admin and unrestricted admins pass straight
 * through.
 */
export default function ScopeGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { scope, loaded } = useMyScope();
  const { allGroups: groups, loading } = useGroupHierarchy();
  const [membersReady, setMembersReady] = useState(false);
  const restricted = !!scope && scope.role !== 'super_admin';
  const nodesRef = useRef<Record<string, GroupNodeLite>>({});

  // Group tree + role.
  useEffect(() => {
    if (!loaded || loading) return;
    const nodes: Record<string, GroupNodeLite> = {};
    groups.forEach((g) => (nodes[g.id] = { id: g.id, type: g.type, parentGroupId: g.parentGroupId, zoneId: g.zoneId }));
    nodesRef.current = nodes;
    configureScope({ scope, nodes, uid: user?.uid ?? '' });
  }, [loaded, loading, scope, groups, user]);

  // The people who belong to this role's areas (used to narrow the member lists and anything about a person).
  useEffect(() => {
    if (!loaded) return;
    if (!restricted) {
      setMembersReady(true);
      return;
    }
    return rawOnSnapshot(
      query(collection(db, 'groupMemberships'), where('status', '==', 'active')),
      (snap) => {
        const uids = new Set<string>();
        snap.docs.forEach((d) => {
          const data = d.data();
          const gid = data.groupId as string;
          const nodes = nodesRef.current;
          const node = nodes[gid];
          const city = node?.parentGroupId ? nodes[node.parentGroupId] : undefined;
          const geo = { groupId: gid, cityId: city?.id, zoneId: city?.zoneId, countryId: city?.parentGroupId };
          if (geoInScope(scope, geo)) uids.add(data.userId as string);
        });
        configureScope({ memberUids: uids });
        setMembersReady(true);
      },
      () => setMembersReady(true)
    );
  }, [loaded, restricted, scope, groups]);

  if (!loaded || loading || !membersReady) return <p style={{ color: 'var(--ink-soft)' }}>{tx("Loading your access…")}</p>;
  return <>{children}</>;
}

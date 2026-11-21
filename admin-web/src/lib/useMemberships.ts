import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { onSnapshot } from './firestore';

export interface MembershipInfo {
  groupId: string;
  role: 'member' | 'host';
  /** Substitute seat of the kurel (otherwise a permanent member). */
  substitute?: boolean;
}

/**
 * Live "userId → active kurel memberships" for just the users on screen.
 *
 * The Members and Approvals pages used to subscribe to EVERY active
 * membership in the organization (one document per person per kurel) to
 * decorate a table that shows at most a few hundred people — the cost
 * grew with the whole org, not with what was visible. This listens only
 * for the given users, in chunks of 30 (Firestore's `in` limit).
 */
export function useMembershipsByUser(userIds: string[]): Record<string, MembershipInfo[]> {
  const [byUser, setByUser] = useState<Record<string, MembershipInfo[]>>({});
  const key = useMemo(() => Array.from(new Set(userIds)).sort().join(','), [userIds]);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setByUser({});
      return;
    }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const partials: Record<string, MembershipInfo[]>[] = chunks.map(() => ({}));

    const unsubs = chunks.map((chunk, idx) =>
      onSnapshot(query(collection(db, 'groupMemberships'), where('userId', 'in', chunk)), (snap) => {
        const map: Record<string, MembershipInfo[]> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.status !== 'active') return;
          (map[data.userId as string] ??= []).push({ groupId: data.groupId as string, role: data.role as 'member' | 'host', substitute: data.substitute === true });
        });
        partials[idx] = map;
        setByUser(Object.assign({}, ...partials));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return byUser;
}

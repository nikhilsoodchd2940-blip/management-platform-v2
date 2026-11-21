'use client';

import { useMemo } from 'react';
import { where } from 'firebase/firestore';
import { useCollection } from './useCollection';
import { useUserNames } from './useUserNames';

export interface KurelMember {
  id: string;
  name: string;
  role: 'member' | 'host';
  substitute: boolean;
}

/** Active members of one kurel, with display names — live. Empty until a kurel is chosen. */
export function useGroupMembers(groupId: string): KurelMember[] {
  const rows = useCollection<{ userId: string; role: 'member' | 'host'; substitute?: boolean }>(
    'groupMemberships',
    groupId ? [where('groupId', '==', groupId), where('status', '==', 'active')] : [where('groupId', '==', '__none__')],
    groupId
  );
  const ids = useMemo(() => (rows ?? []).map((r) => r.userId), [rows]);
  const names = useUserNames(ids);
  return useMemo(
    () => (rows ?? []).map((r) => ({ id: r.userId, name: names[r.userId] || r.userId, role: r.role, substitute: r.substitute === true })).sort((a, b) => a.name.localeCompare(b.name)),
    [rows, names]
  );
}

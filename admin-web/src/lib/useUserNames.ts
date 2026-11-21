'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { reportDataError } from './notify';

export interface UserProfileLite { name: string; photoUrl: string; phone?: string; email?: string }

/** One shared cache, so a person shown on several screens (name and picture) is read from the database once. */
const CACHE: Record<string, UserProfileLite> = {};
const SUBS = new Set<() => void>();
let VERSION = 0;
/** Replaces what is known about a person (after a name or picture was changed) and refreshes every screen showing them. */
export function setProfileCache(id: string, p: Partial<UserProfileLite>) {
  CACHE[id] = { ...(CACHE[id] ?? { name: '', photoUrl: '' }), ...p } as UserProfileLite;
  VERSION++;
  SUBS.forEach((f) => f());
}

/** Names and profile pictures for a set of user IDs, fetched in chunks of 30 and cached. */
export function useUserProfiles(userIds: string[]): Record<string, UserProfileLite> {
  const [tick, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); SUBS.add(f); return () => { SUBS.delete(f); }; }, []);
  const key = useMemo(() => Array.from(new Set(userIds.filter(Boolean))).sort().join(','), [userIds]);
  useEffect(() => {
    const ids = (key ? key.split(',') : []).filter((id) => !CACHE[id]);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        for (let i = 0; i < ids.length; i += 30) {
          const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', ids.slice(i, i + 30))));
          snap.docs.forEach((d) => { CACHE[d.id] = { name: (d.data().displayName as string) || '', photoUrl: (d.data().photoUrl as string) || '', phone: (d.data().phone as string) || '', email: (d.data().email as string) || '' }; });
          ids.slice(i, i + 30).forEach((id) => { if (!CACHE[id]) CACHE[id] = { name: '', photoUrl: '', phone: '' }; });
        }
        if (!cancelled) bump((n) => n + 1);
      } catch (err) {
        reportDataError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return useMemo(() => {
    const out: Record<string, UserProfileLite> = {};
    (key ? key.split(',') : []).forEach((id) => { if (CACHE[id]) out[id] = CACHE[id]; });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, VERSION, Object.keys(CACHE).length]);
}

/** Display names for a set of user IDs. */
export function useUserNames(userIds: string[]): Record<string, string> {
  const profiles = useUserProfiles(userIds);
  return useMemo(() => Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.name])), [profiles]);
}

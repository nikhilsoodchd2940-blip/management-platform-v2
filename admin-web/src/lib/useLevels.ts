'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from './firebase';
import { onSnapshot } from './firestore';

export interface Level {
  id: string;
  name: string;
  rank: number;
  description?: string;
  /** Other levels this level may also access (its own is always included). */
  accessLevelIds: string[];
  /** Max books assignable to this level; null = no cap. */
  maxBooks: number | null;
}

/** Live list of academic levels, lowest rank first, straight from Firestore. */
export function useLevels() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'levels'), orderBy('rank')),
      (snap) => {
        setLevels(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: (data.name as string) ?? '',
              rank: (data.rank as number) ?? 0,
              description: (data.description as string) || undefined,
              accessLevelIds: (data.accessLevelIds as string[]) ?? [],
              maxBooks: (data.maxBooks as number | null) ?? null,
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  const byId = useMemo(() => {
    const map: Record<string, Level> = {};
    levels.forEach((l) => (map[l.id] = l));
    return map;
  }, [levels]);

  /** Level IDs a kurel at `levelId` may access: its own plus the ones it grants. */
  function accessibleFrom(levelId: string | undefined): string[] {
    if (!levelId || !byId[levelId]) return [];
    const ids = new Set<string>([levelId]);
    byId[levelId].accessLevelIds.forEach((id) => byId[id] && ids.add(id));
    return [...ids];
  }

  return { levels, byId, loading, accessibleFrom };
}

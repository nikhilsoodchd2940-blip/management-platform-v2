'use client';

import { useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from './useCollection';
import { useGroupHierarchy } from './useGroupHierarchy';

export interface ZoneRow { id: string; name: string; countryId: string; status?: 'active' | 'archived' }

/** Zones that really exist and can be used: not archived, and their country is still there. Deleted or orphaned zones never appear. */
export function useZones(): ZoneRow[] | null {
  const raw = useCollection<ZoneRow>('zones', [orderBy('name')]);
  const { countries } = useGroupHierarchy();
  return useMemo(() => (raw === null ? null : raw.filter((z) => z.status !== 'archived' && countries.some((c) => c.id === z.countryId))), [raw, countries]);
}

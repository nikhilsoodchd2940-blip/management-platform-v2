'use client';

import { useEffect, useState } from 'react';
import { collection, query, type QueryConstraint } from 'firebase/firestore';
import { db } from './firebase';
import { onSnapshot } from './firestore';

export type Row<T> = T & { id: string };

/**
 * Live rows of one collection. `constraints` are rebuilt every render so pass a
 * stable `key` that changes whenever they do. Returns `null` while loading so
 * screens can show "—" instead of a fake zero.
 */
export function useCollection<T = Record<string, unknown>>(name: string, constraints: QueryConstraint[], key: string = ''): Row<T>[] | null {
  const [rows, setRows] = useState<Row<T>[] | null>(null);
  useEffect(() => {
    setRows(null);
    return onSnapshot(
      query(collection(db, name), ...constraints),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))),
      () => setRows([])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
  return rows;
}

export const tsMs = (v: unknown): number => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0);

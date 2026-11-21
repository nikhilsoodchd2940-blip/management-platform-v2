'use client';

import { useEffect, useState } from 'react';
import { collection, getCountFromServer, getDocs, query, where, type WhereFilterOp } from 'firebase/firestore';
import { docVisible, isRestricted, onScopeChange } from './scopeFilter';
import { db } from './firebase';
import { reportDataError } from './notify';

export type Filter = [field: string, op: WhereFilterOp, value: unknown];

/**
 * Live-ish document count for a collection (server-side aggregate, so no
 * documents are downloaded). Returns null while loading or on error —
 * screens show "—" for null, never a made-up number. Refreshes every
 * `refreshMs` when given.
 */
export function useCount(collectionName: string, filters: Filter[] = [], refreshMs?: number): number | null {
  const [count, setCount] = useState<number | null>(null);
  const key = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const q = query(collection(db, collectionName), ...filters.map(([f, op, v]) => where(f, op, v)));
      if (isRestricted()) {
        // Zone / City / Group roles: count only the records of their own areas.
        getDocs(q)
          .then((snap) => !cancelled && setCount(snap.docs.filter((d) => docVisible(collectionName, d.id, d.data())).length))
          .catch((err) => reportDataError(err));
        return;
      }
      getCountFromServer(q)
        .then((snap) => !cancelled && setCount(snap.data().count))
        .catch((err) => {
          reportDataError(err);
        });
    };
    run();
    const handle = refreshMs ? window.setInterval(run, refreshMs) : undefined;
    const off = onScopeChange(() => isRestricted() && run());
    return () => {
      off();
      cancelled = true;
      if (handle) window.clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, key, refreshMs]);

  return count;
}

/** Formats a count for display: "—" while unknown, grouped digits otherwise. */
export function fmt(n: number | null | undefined, locale = 'en-US'): string {
  return n === null || n === undefined ? '—' : n.toLocaleString(locale);
}

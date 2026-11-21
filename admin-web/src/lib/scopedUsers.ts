import { collection, documentId, limit as fsLimit, orderBy, query, where, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { onSnapshot } from './firestore';
import { searchMembers } from './functions';
import { isRestricted, onScopeChange, scopedMemberUids } from './scopeFilter';

export interface UserDocLite {
  id: string;
  data: () => DocumentData;
}

/**
 * Live list of people, newest-first by name, with optional name/phone prefix search.
 * Super Admin: the usual paged server query. Zone / City / Group roles: only the people
 * who belong to their own areas, looked up by id so the page is never empty just because
 * the first alphabetical users belong to someone else.
 */
export function subscribeUsers(
  opts: { term: string; pageSize: number; /** Only these people (e.g. the members of a chosen kurel). */ onlyIds?: string[] },
  next: (docs: UserDocLite[]) => void,
  onError: () => void
): Unsubscribe {
  const { term, pageSize, onlyIds } = opts;
  let inner: Unsubscribe | null = null;

  const start = () => {
    inner?.();
    const users = collection(db, 'users');
    const digits = term.replace(/\D/g, '');
    const numeric = /^[+\d\s().-]+$/.test(term);
    // Any part of a name, phone number or member number matches (server-side, so it covers every member).
    if (!onlyIds && !isRestricted() && term.length >= 2 && (!numeric || digits.length >= 3)) {
      let cancelled = false;
      let live: Unsubscribe | null = null;
      searchMembers({ query: term, limit: 30 })
        .then((res) => {
          if (cancelled) return;
          const ids = res.data.results.map((r) => r.userId).slice(0, 30);
          if (ids.length === 0) { next([]); return; }
          live = onSnapshot(query(users, where(documentId(), 'in', ids)), (snap) => {
            const order = new Map(ids.map((id, i) => [id, i]));
            next([...snap.docs].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
          }, onError);
        })
        .catch(() => !cancelled && onError());
      inner = () => { cancelled = true; live?.(); };
      return;
    }
    if (!onlyIds && !isRestricted()) {
      const phoneLike = /^[+\d]/.test(term);
      const q = !term
        ? query(users, fsLimit(pageSize)) // no orderBy: a sorted query silently drops anyone whose document has no displayNameLower
        : phoneLike
          ? query(users, orderBy('phone'), where('phone', '>=', term), where('phone', '<=', term + ''), fsLimit(pageSize))
          : query(users, orderBy('displayNameLower'), where('displayNameLower', '>=', term), where('displayNameLower', '<=', term + ''), fsLimit(pageSize));
      inner = onSnapshot(q, (snap) => {
        if (term) { next(snap.docs); return; }
        const key = (d: UserDocLite) => { const x = d.data(); return String(x.displayNameLower ?? String(x.displayName ?? '').toLowerCase()); };
        next([...snap.docs].sort((a, b) => { const ka = key(a), kb = key(b); return !ka && kb ? 1 : ka && !kb ? -1 : ka.localeCompare(kb); }));
      }, onError);
      return;
    }
    const mine = scopedMemberUids();
    const ids = (onlyIds ? (isRestricted() ? onlyIds.filter((i) => mine.has(i)) : onlyIds) : [...mine]).slice(0, 900);
    if (ids.length === 0) {
      next([]);
      inner = null;
      return;
    }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const parts: UserDocLite[][] = chunks.map(() => []);
    const emit = () => {
      const phoneLike = /^[+\d]/.test(term);
      const all = parts.flat().filter((d) => {
        if (!term) return true;
        const x = d.data();
        if (phoneLike) { const d = term.replace(/\D/g, ''); return d ? String(x.phone ?? '').replace(/\D/g, '').includes(d) : true; }
        return String(x.displayNameLower ?? String(x.displayName ?? '').toLowerCase()).includes(term) || String(x.memberId ?? '').toLowerCase().includes(term);
      });
      all.sort((a, b) => String(a.data().displayNameLower ?? '').localeCompare(String(b.data().displayNameLower ?? '')));
      next(all.slice(0, pageSize));
    };
    const unsubs = chunks.map((chunk, i) =>
      onSnapshot(
        query(users, where(documentId(), 'in', chunk)),
        (snap) => {
          parts[i] = snap.docs;
          emit();
        },
        onError
      )
    );
    inner = () => unsubs.forEach((u) => u());
  };

  start();
  // A role's reach changing (someone added to a group) refreshes the list.
  const off = onScopeChange(() => isRestricted() && start());
  return () => {
    off();
    inner?.();
  };
}

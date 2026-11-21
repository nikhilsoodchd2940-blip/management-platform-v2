import {
  onSnapshot as rawOnSnapshot,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { reportDataError } from './notify';
import { docVisible, isRestricted, onScopeChange, trimForScope } from './scopeFilter';

/** The same document, but whose data() only mentions the groups the role may see. */
function trimmedDoc<D extends { data: (...a: never[]) => DocumentData | undefined; ref: { parent: { id: string } } }>(d: D): D {
  const raw = d.data as unknown as (...a: unknown[]) => DocumentData | undefined;
  return Object.create(d, {
    data: {
      value: (...a: unknown[]) => {
        const x = raw.apply(d, a);
        return x ? trimForScope(d.ref.parent.id, x) : x;
      },
    },
  });
}

/** A snapshot that only holds the records the signed-in role may see, each narrowed to its own groups. */
function scoped(snap: QuerySnapshot<DocumentData>): QuerySnapshot<DocumentData> {
  if (!isRestricted()) return snap;
  const docs = snap.docs.filter((d) => docVisible(d.ref.parent.id, d.id, d.data())).map((d) => trimmedDoc(d));
  const keep = new Set(docs.map((d) => d.id));
  return Object.create(snap, {
    docs: { value: docs },
    size: { value: docs.length },
    empty: { value: docs.length === 0 },
    forEach: { value: (cb: (d: (typeof docs)[number]) => void) => docs.forEach(cb) },
    docChanges: { value: (...args: unknown[]) => (snap.docChanges as (...a: unknown[]) => ReturnType<typeof snap.docChanges>)(...args).filter((c) => keep.has(c.doc.id)).map((c) => ({ ...c, doc: docs.find((x) => x.id === c.doc.id) ?? c.doc })) },
  });
}

/** For one-off reads (getDocs): the same narrowing as the live lists. */
export function scopeSnap<T extends DocumentData>(snap: QuerySnapshot<T>): QuerySnapshot<T> {
  return scoped(snap as unknown as QuerySnapshot<DocumentData>) as unknown as QuerySnapshot<T>;
}

/**
 * Drop-in replacement for Firestore's onSnapshot that never fails
 * silently. With the raw function, a query rejected by security rules
 * (e.g. a restricted admin opening a section they lack access to) or a
 * dropped connection simply stops delivering data — the page then sits
 * on "Loading…" or shows zeros that look like real numbers. Here every
 * listener error is surfaced as a toast (see <ToastHost />), and the
 * caller's own error callback, if any, still runs.
 */
export function onSnapshot<T = DocumentData>(
  ref: Query<T>,
  next: (snapshot: QuerySnapshot<T>) => void,
  error?: (e: Error) => void
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  ref: DocumentReference<T>,
  next: (snapshot: DocumentSnapshot<T>) => void,
  error?: (e: Error) => void
): Unsubscribe;
export function onSnapshot(
  ref: Query<DocumentData> | DocumentReference<DocumentData>,
  next: (snapshot: never) => void,
  error?: (e: Error) => void
): Unsubscribe {
  const onError = (e: Error) => {
    reportDataError(e);
    error?.(e);
  };
  // The two overloads above keep call sites fully typed; the cast is only
  // needed because the underlying function has the same two overloads.
  // Lists are narrowed to the admin's role (zone / city / group); a single document is passed through untouched.
  const isQuery = (ref as { type?: string }).type !== 'document';
  if (!isQuery) {
    return (rawOnSnapshot as (r: unknown, n: unknown, e: unknown) => Unsubscribe)(
      ref,
      (snap: DocumentSnapshot<DocumentData>) => (next as (s: DocumentSnapshot<DocumentData>) => void)(isRestricted() && snap.exists() ? trimmedDoc(snap as never) : snap),
      onError
    );
  }
  let last: QuerySnapshot<DocumentData> | null = null;
  const unsub = (rawOnSnapshot as (r: unknown, n: unknown, e: unknown) => Unsubscribe)(
    ref,
    (snap: QuerySnapshot<DocumentData>) => {
      last = snap;
      (next as (s: QuerySnapshot<DocumentData>) => void)(scoped(snap));
    },
    onError
  );
  // When the role's reach changes (new group, new member), re-apply it to what is already on screen.
  const off = onScopeChange(() => {
    if (last && isRestricted()) (next as (s: QuerySnapshot<DocumentData>) => void)(scoped(last));
  });
  return () => {
    off();
    unsub();
  };
}

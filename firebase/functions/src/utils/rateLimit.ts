import { db } from '../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * A fixed-window rate limiter — not sliding-window, which would need a
 * more complex data structure for a benefit this app doesn't need.
 * Buckets by `${key}:${windowIndex}`, so a burst right at a window
 * boundary can technically allow up to 2x maxCount across the boundary;
 * acceptable for abuse prevention (stopping automated hammering), not
 * meant to be a precise quota system.
 *
 * Each bucket doc carries an `expiresAt` field. Firestore doesn't clean
 * these up on its own — configure a TTL policy on the `rateLimits`
 * collection's `expiresAt` field in the Firebase Console (one-time
 * per-project setup, see docs/LAUNCH_CHECKLIST.md) so old buckets don't
 * accumulate forever. Until that's configured, this still works
 * correctly — it just leaves harmless expired documents behind.
 *
 * Throws nothing itself — returns whether the call is allowed, so each
 * caller decides how to respond (HttpsError with a specific message,
 * logging, etc.) rather than this utility dictating that.
 */
/**
 * Pure — exported separately so the bucketing math is testable without a
 * Firestore transaction. Given the same `nowMs` and `windowSeconds`, this
 * always produces the same bucket ID for a key, which is the whole
 * correctness property that matters here.
 */
export function rateLimitBucketId(key: string, windowSeconds: number, nowMs: number = Date.now()): string {
  const windowIndex = Math.floor(nowMs / (windowSeconds * 1000));
  return `${key}:${windowIndex}`;
}

export async function checkRateLimit(
  key: string,
  maxCount: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number }> {
  const bucketId = rateLimitBucketId(key, windowSeconds);
  const ref = db.collection('rateLimits').doc(bucketId);

  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data()?.count as number | undefined) ?? 0;
    const next = current + 1;
    tx.set(
      ref,
      {
        count: next,
        expiresAt: Timestamp.fromMillis(Date.now() + windowSeconds * 2 * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return next;
  });

  return { allowed: count <= maxCount, count };
}

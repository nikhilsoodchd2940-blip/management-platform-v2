import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import type { NotificationDoc } from '../types/models';
import { log } from './logger';

/**
 * Writes one row to `notifications` — the collection the mobile app's
 * NotificationsScreen already reads (userId/title/body/createdAt,
 * newest first) but that nothing wrote to before this module ("Phase 4
 * introduces senders" per firestore.rules' comment on it). Failures are
 * logged, not thrown — a notification that didn't send should never
 * roll back or fail the approval/logistics action that triggered it.
 */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  opts?: { type?: NotificationDoc['type']; relatedId?: string }
): Promise<void> {
  try {
    const doc: NotificationDoc = {
      userId,
      title,
      body,
      ...(opts?.type ? { type: opts.type } : {}),
      ...(opts?.relatedId ? { relatedId: opts.relatedId } : {}),
      createdAt: FieldValue.serverTimestamp() as unknown as NotificationDoc['createdAt'],
    };
    await db.collection('notifications').add(doc);
  } catch (err) {
    log.error('notifyUser: failed to write notification', { userId, title, err: String(err) });
  }
}

/**
 * Notifies every admin currently marked Top Management (isSuperAdmin)
 * — used for the final review stage. Note: there's no way to notify
 * "all admins" generically in this schema (an admin's role lives only
 * in their Auth custom claim, not a queryable Firestore field — see
 * UserDoc in types/models.ts) — only admins who have an `adminRoles`
 * doc at all are enumerable this way, which is exactly the set that's
 * ever explicitly super-admin or a Zone Manager. The first review
 * stage (any admin, unrestricted) has no notification for the same
 * reason eventRequests/absenceRequests never had one either — an
 * ordinary admin simply checks the Resource Requests page.
 */
export async function notifyTopManagement(
  title: string,
  body: string,
  opts?: { type?: NotificationDoc['type']; relatedId?: string }
): Promise<void> {
  const snap = await db.collection('adminRoles').where('isSuperAdmin', '==', true).get();
  await Promise.all(snap.docs.map((d) => notifyUser(d.id, title, body, opts)));
}

/** Notifies every admin who is either Top Management or Zone Manager of the given city — used to reach "whoever needs to review this next" without the caller having to look up individual UIDs. */
export async function notifyReviewersForCity(
  cityId: string,
  title: string,
  body: string,
  opts?: { type?: NotificationDoc['type']; relatedId?: string }
): Promise<void> {
  const snap = await db.collection('adminRoles').get();
  const targets = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((r) => r.data.isSuperAdmin === true || (r.data.zoneManagerCityIds ?? []).includes(cityId));
  await Promise.all(targets.map((r) => notifyUser(r.id, title, body, opts)));
}

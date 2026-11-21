import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { AnnouncementDoc, NotificationDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';

/**
 * "Annonces et notifications" (mobile drawer item) — creates one
 * AnnouncementDoc (the admin panel's own send history) and fans that
 * out into one NotificationDoc per recipient, which is what
 * NotificationsScreen and NotificationsBell on mobile actually read.
 * Nothing wrote to `notifications` before this — firestore.rules'
 * `allow write: if false` comment literally said "Function-only once
 * Phase 4 introduces senders". This is that sender.
 *
 * Gated on the 'content' permission — same one Banners/Popups use,
 * rather than introducing a new permission key for one more content
 * type admins manage.
 */
export const sendAnnouncement = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const title = String(request.data?.title ?? '').trim();
  const body = String(request.data?.body ?? '').trim();
  if (!title) throw new HttpsError('invalid-argument', 'title is required');
  if (!body) throw new HttpsError('invalid-argument', 'body is required');

  const target = request.data?.target === 'group' ? 'group' : 'all';
  const targetGroupId = target === 'group' ? String(request.data?.targetGroupId ?? '') : undefined;
  if (target === 'group' && !targetGroupId) {
    throw new HttpsError('invalid-argument', 'targetGroupId is required when target is "group"');
  }

  // Resolve recipients.
  let recipientIds: string[];
  if (target === 'all') {
    const snap = await db.collection('users').where('status', '==', 'active').get();
    recipientIds = snap.docs.map((d) => d.id);
  } else {
    const snap = await db
      .collection('groupMemberships')
      .where('groupId', '==', targetGroupId)
      .where('status', '==', 'active')
      .get();
    recipientIds = [...new Set(snap.docs.map((d) => d.data().userId as string))];
  }

  if (recipientIds.length === 0) {
    throw new HttpsError('failed-precondition', 'No active recipients match this target — nothing was sent');
  }

  const announcement: AnnouncementDoc = {
    title,
    body,
    target,
    ...(targetGroupId ? { targetGroupId } : {}),
    recipientCount: recipientIds.length,
    sentByUserId: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as AnnouncementDoc['createdAt'],
  };
  const announcementRef = await db.collection('announcements').add(announcement);

  // Firestore batches cap at 500 writes — chunk generously under that.
  const CHUNK = 450;
  for (let i = 0; i < recipientIds.length; i += CHUNK) {
    const batch = db.batch();
    for (const userId of recipientIds.slice(i, i + CHUNK)) {
      const doc: NotificationDoc = {
        userId,
        title,
        body,
        announcementId: announcementRef.id,
        createdAt: FieldValue.serverTimestamp() as unknown as NotificationDoc['createdAt'],
      };
      batch.set(db.collection('notifications').doc(), doc);
    }
    await batch.commit();
  }

  await recordAudit({
    action: 'sendAnnouncement',
    actorUserId: request.auth!.uid,
    targetId: announcementRef.id,
    result: 'SUCCESS',
    metadata: { target, targetGroupId, recipientCount: recipientIds.length },
  });

  return { announcementId: announcementRef.id, recipientCount: recipientIds.length };
});

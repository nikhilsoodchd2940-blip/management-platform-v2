import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { recordAudit } from '../../utils/logger';
import { notifyUser } from '../../utils/notify';
import type { AudioCategory, AudioTrackDoc } from '../../types/models';

const VALID_CATEGORIES: readonly AudioCategory[] = ['rehearsal', 'announcement', 'performance'];

/** File itself is uploaded client-side to Storage first (see storage.rules' /audioTracks/ path) — this records the metadata, same pattern as createQacaidEdition. Starts 'pending' — see reviewAudioTrack. */
export const uploadAudioTrack = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const title = String(request.data?.title ?? '').trim();
  const melodyLabel: string | undefined = request.data?.melodyLabel?.trim() || undefined;
  const category = request.data?.category as AudioCategory;
  const groupIds: unknown = request.data?.groupIds;
  const scopeAllGroups = groupIds === undefined || groupIds === null;
  const level: number | undefined = request.data?.level;
  const fileUrl = String(request.data?.fileUrl ?? '').trim();
  const filePath = String(request.data?.filePath ?? '').trim();
  const durationSeconds: number | undefined = request.data?.durationSeconds;
  const linkedEventId: string | undefined = request.data?.linkedEventId || undefined;

  if (!title) throw new HttpsError('invalid-argument', 'title is required');
  if (!VALID_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', `category must be one of ${VALID_CATEGORIES.join(', ')}`);
  if (!fileUrl || !filePath) throw new HttpsError('invalid-argument', 'fileUrl and filePath are required');
  if (!scopeAllGroups && (!Array.isArray(groupIds) || !groupIds.every((g) => typeof g === 'string'))) {
    throw new HttpsError('invalid-argument', 'groupIds must be an array of group IDs, or omitted for all groups');
  }
  if (category === 'performance' && !linkedEventId) {
    throw new HttpsError('invalid-argument', 'linkedEventId is required for a performance recording');
  }
  if (level !== undefined && ![1, 2, 3, 4].includes(level)) {
    throw new HttpsError('invalid-argument', 'level must be 1-4');
  }

  const doc: AudioTrackDoc = {
    title,
    ...(melodyLabel ? { melodyLabel } : {}),
    category,
    scopeAllGroups,
    ...(scopeAllGroups ? {} : { groupIds: groupIds as string[] }),
    ...(level !== undefined ? { level: level as 1 | 2 | 3 | 4 } : {}),
    fileUrl,
    filePath,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    status: 'pending',
    ...(linkedEventId ? { linkedEventId } : {}),
    uploadedBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as AudioTrackDoc['createdAt'],
  };
  const ref = await db.collection('audioTracks').add(doc);
  await recordAudit({ action: 'uploadAudioTrack', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS', metadata: { category, title } });
  return { trackId: ref.id };
});

export const reviewAudioTrack = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const trackId = String(request.data?.trackId ?? '');
  if (!trackId) throw new HttpsError('invalid-argument', 'trackId is required');

  const ref = db.collection('audioTracks').doc(trackId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Track not found');
  const existing = snap.data() as AudioTrackDoc;

  await ref.update({ status: 'approved' });

  if (existing.uploadedBy !== request.auth!.uid) {
    await notifyUser(existing.uploadedBy, 'Audio approved', `"${existing.title}" was approved and is now in the library.`, { relatedId: trackId });
  }
  await recordAudit({ action: 'reviewAudioTrack', actorUserId: request.auth!.uid, targetId: trackId, result: 'SUCCESS' });
  return { ok: true };
});

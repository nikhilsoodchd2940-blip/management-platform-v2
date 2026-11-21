import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { recordAudit } from '../../utils/logger';
import type { LibraryShareDoc, QacaidEditionDoc } from '../../types/models';

/** File itself is uploaded client-side to Storage first (see storage.rules' /qacaidEditions/ path) — this just records the metadata, same pattern as createBanner/createPopup. */
export const createQacaidEdition = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const qacaidId = String(request.data?.qacaidId ?? '');
  const label = String(request.data?.label ?? '').trim();
  const fileUrl = String(request.data?.fileUrl ?? '').trim();
  const filePath = String(request.data?.filePath ?? '').trim();
  const fileSizeBytes = Number(request.data?.fileSizeBytes);
  const downloadable = request.data?.downloadable !== false;

  if (!qacaidId) throw new HttpsError('invalid-argument', 'qacaidId is required');
  if (!label) throw new HttpsError('invalid-argument', 'label is required');
  if (!fileUrl || !filePath) throw new HttpsError('invalid-argument', 'fileUrl and filePath are required');
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) throw new HttpsError('invalid-argument', 'fileSizeBytes must be positive');

  const qacaidSnap = await db.collection('qacaid').doc(qacaidId).get();
  if (!qacaidSnap.exists) throw new HttpsError('not-found', 'Qaçaid not found');

  const doc: QacaidEditionDoc = {
    qacaidId,
    label,
    fileUrl,
    filePath,
    fileSizeBytes,
    downloadable,
    downloadsCount: 0,
    uploadedBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as QacaidEditionDoc['createdAt'],
  };
  const ref = await db.collection('qacaidEditions').add(doc);
  await recordAudit({ action: 'createQacaidEdition', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS', metadata: { qacaidId, label } });
  return { editionId: ref.id };
});

export const shareQacaidEdition = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const editionId = String(request.data?.editionId ?? '');
  const scopeType = request.data?.scopeType as 'group' | 'user';
  const scopeId = String(request.data?.scopeId ?? '');
  const right = request.data?.right as 'download' | 'read_only';
  const expiresAtMs: number | undefined = request.data?.expiresAtMs;

  if (!editionId) throw new HttpsError('invalid-argument', 'editionId is required');
  if (scopeType !== 'group' && scopeType !== 'user') throw new HttpsError('invalid-argument', 'scopeType must be "group" or "user"');
  if (!scopeId) throw new HttpsError('invalid-argument', 'scopeId is required');
  if (right !== 'download' && right !== 'read_only') throw new HttpsError('invalid-argument', 'right must be "download" or "read_only"');

  const editionSnap = await db.collection('qacaidEditions').doc(editionId).get();
  if (!editionSnap.exists) throw new HttpsError('not-found', 'Edition not found');

  const doc: LibraryShareDoc = {
    editionId,
    scopeType,
    scopeId,
    right,
    ...(expiresAtMs !== undefined ? { expiresAt: Timestamp.fromMillis(expiresAtMs) } : {}),
    sharedBy: request.auth!.uid,
    sharedAt: FieldValue.serverTimestamp() as unknown as LibraryShareDoc['sharedAt'],
  };
  const ref = await db.collection('libraryShares').add(doc);
  await recordAudit({ action: 'shareQacaidEdition', actorUserId: request.auth!.uid, targetId: editionId, result: 'SUCCESS', metadata: { scopeType, scopeId, right } });
  return { shareId: ref.id };
});

export const revokeLibraryShare = onCall(async (request) => {
  await requireAdminPermission(request, 'content');
  const shareId = String(request.data?.shareId ?? '');
  if (!shareId) throw new HttpsError('invalid-argument', 'shareId is required');
  await db.collection('libraryShares').doc(shareId).delete();
  await recordAudit({ action: 'revokeLibraryShare', actorUserId: request.auth!.uid, targetId: shareId, result: 'SUCCESS' });
  return { ok: true };
});

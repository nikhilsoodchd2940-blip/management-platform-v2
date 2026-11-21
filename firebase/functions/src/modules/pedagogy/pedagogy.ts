import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { getGroupOrThrow } from '../groups/hierarchy';
import { recordAudit } from '../../utils/logger';
import type { ProgressReportDoc, QacaidAllocationDoc, QacaidDoc } from '../../types/models';

const VALID_LEVELS = [1, 2, 3, 4] as const;

export const createQacaid = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const code = String(request.data?.code ?? '').trim();
  const title = String(request.data?.title ?? '').trim();
  const melody = String(request.data?.melody ?? '').trim();
  const durationSeconds: number | undefined = request.data?.durationSeconds;
  const level = Number(request.data?.level);

  if (!code || !title || !melody) throw new HttpsError('invalid-argument', 'code, title and melody are required');
  if (!VALID_LEVELS.includes(level as 1 | 2 | 3 | 4)) throw new HttpsError('invalid-argument', 'level must be 1-4');

  const doc: QacaidDoc = {
    code,
    title,
    melody,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    level: level as 1 | 2 | 3 | 4,
    status: 'active',
    createdBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as QacaidDoc['createdAt'],
  };
  const ref = await db.collection('qacaid').add(doc);
  await recordAudit({ action: 'createQacaid', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS', metadata: { code, title } });
  return { qacaidId: ref.id };
});

export const allocateQacaid = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const qacaidId = String(request.data?.qacaidId ?? '');
  const groupId = String(request.data?.groupId ?? '');
  if (!qacaidId) throw new HttpsError('invalid-argument', 'qacaidId is required');
  await getGroupOrThrow(groupId);

  const qacaidSnap = await db.collection('qacaid').doc(qacaidId).get();
  if (!qacaidSnap.exists) throw new HttpsError('not-found', 'Qaçaid not found');

  const doc: QacaidAllocationDoc = {
    qacaidId,
    groupId,
    allocatedBy: request.auth!.uid,
    allocatedAt: FieldValue.serverTimestamp() as unknown as QacaidAllocationDoc['allocatedAt'],
  };
  // Deterministic ID (qacaidId_groupId) — re-allocating the same pair just refreshes allocatedAt/allocatedBy rather than creating a duplicate.
  await db.collection('qacaidAllocations').doc(`${qacaidId}_${groupId}`).set(doc);
  await recordAudit({ action: 'allocateQacaid', actorUserId: request.auth!.uid, targetId: groupId, result: 'SUCCESS', metadata: { qacaidId } });
  return { ok: true };
});

export const removeQacaidAllocation = onCall(async (request) => {
  await requireAdminPermission(request, 'content');
  const qacaidId = String(request.data?.qacaidId ?? '');
  const groupId = String(request.data?.groupId ?? '');
  if (!qacaidId || !groupId) throw new HttpsError('invalid-argument', 'qacaidId and groupId are required');
  await db.collection('qacaidAllocations').doc(`${qacaidId}_${groupId}`).delete();
  await recordAudit({ action: 'removeQacaidAllocation', actorUserId: request.auth!.uid, targetId: groupId, result: 'SUCCESS', metadata: { qacaidId } });
  return { ok: true };
});

/** Recorded by the Comité (an admin) after assessing a kurel's rehearsal/performance for the given period — not a member self-report. */
export const submitProgressReport = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const groupId = String(request.data?.groupId ?? '');
  const period = String(request.data?.period ?? '').trim();
  const pcts = ['masteryPct', 'melodyPct', 'timingPct', 'directivesPct'] as const;
  const values: Record<(typeof pcts)[number], number> = {} as never;

  await getGroupOrThrow(groupId);
  if (!period) throw new HttpsError('invalid-argument', 'period is required');
  for (const key of pcts) {
    const v = Number(request.data?.[key]);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new HttpsError('invalid-argument', `${key} must be 0-100`);
    values[key] = v;
  }

  const doc: ProgressReportDoc = {
    groupId,
    period,
    masteryPct: values.masteryPct,
    melodyPct: values.melodyPct,
    timingPct: values.timingPct,
    directivesPct: values.directivesPct,
    submittedBy: request.auth!.uid,
    submittedAt: FieldValue.serverTimestamp() as unknown as ProgressReportDoc['submittedAt'],
  };
  const ref = await db.collection('progressReports').add(doc);
  await recordAudit({ action: 'submitProgressReport', actorUserId: request.auth!.uid, targetId: groupId, result: 'SUCCESS', metadata: { period } });
  return { reportId: ref.id };
});

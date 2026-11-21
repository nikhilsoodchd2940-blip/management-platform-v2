import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { recordAudit } from '../../utils/logger';
import { notifyUser } from '../../utils/notify';
import type { LogisticsHistoryEntryDoc, LogisticsStatus, LogisticsTaskDoc, ResourceRequestDoc } from '../../types/models';

const STATUS_ORDER: readonly LogisticsStatus[] = ['pending', 'assigned', 'preparing', 'dispatched', 'delivered', 'completed'];

/**
 * Updates a logistics task's status and/or who it's assigned to. Status
 * only moves forward through the pipeline (pending → assigned →
 * preparing → dispatched → delivered → completed) — going backward
 * isn't a real-world case this module needs to support, and forbidding
 * it keeps `history` an honest, monotonic record of progress.
 */
export const updateLogisticsTask = onCall(async (request) => {
  await requireAdminPermission(request, 'logistics');

  const taskId = String(request.data?.taskId ?? '');
  const nextStatus = request.data?.status as LogisticsStatus | undefined;
  const assignedToUserId: string | undefined = request.data?.assignedToUserId || undefined;
  const assignedToName: string | undefined = request.data?.assignedToName?.trim() || undefined;
  const comment: string | undefined = request.data?.comment?.trim() || undefined;
  const actorName = String(request.data?.actorName ?? '').trim() || 'Admin';

  if (!taskId) throw new HttpsError('invalid-argument', 'taskId is required');
  if (nextStatus !== undefined && !STATUS_ORDER.includes(nextStatus)) {
    throw new HttpsError('invalid-argument', `status must be one of ${STATUS_ORDER.join(', ')}`);
  }
  if (nextStatus === undefined && !assignedToUserId) {
    throw new HttpsError('invalid-argument', 'Provide a status change, an assignment, or both');
  }
  if (assignedToUserId && !assignedToName) {
    throw new HttpsError('invalid-argument', 'assignedToName is required when assignedToUserId is set');
  }

  const ref = db.collection('logisticsTasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Logistics task not found');
  const existing = snap.data() as LogisticsTaskDoc;

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (assignedToUserId) {
    patch.assignedToUserId = assignedToUserId;
    patch.assignedToName = assignedToName;
  }

  let effectiveStatus = existing.status;
  if (nextStatus !== undefined && nextStatus !== existing.status) {
    const currentIndex = STATUS_ORDER.indexOf(existing.status);
    const nextIndex = STATUS_ORDER.indexOf(nextStatus);
    if (nextIndex <= currentIndex) {
      throw new HttpsError(
        'failed-precondition',
        `Status can only move forward: ${existing.status} → ${STATUS_ORDER[currentIndex + 1] ?? '(already last)'}`
      );
    }
    patch.status = nextStatus;
    effectiveStatus = nextStatus;
  } else if (assignedToUserId && existing.status === 'pending') {
    // Assigning someone to a still-pending task also advances it to
    // 'assigned' — matches the pipeline's own naming (a task can't be
    // "assigned" status with nobody assigned).
    patch.status = 'assigned';
    effectiveStatus = 'assigned';
  }

  const historyEntry: LogisticsHistoryEntryDoc = {
    status: effectiveStatus,
    actorUserId: request.auth!.uid,
    actorName,
    ...(comment ? { comment } : {}),
    at: Timestamp.now(),
  };
  patch.history = FieldValue.arrayUnion(historyEntry);

  await ref.update(patch);

  // Notify the newly-assigned person, and the original requester once
  // their items are actually moving (dispatched/delivered) — not on
  // every intermediate status, to avoid noise for statuses the
  // requester has no action to take on.
  if (assignedToUserId && existing.assignedToUserId !== assignedToUserId) {
    await notifyUser(
      assignedToUserId,
      'Logistics task assigned to you',
      `You've been assigned: ${existing.itemsDescription}.`,
      { type: 'logistics', relatedId: taskId }
    );
  }
  if (effectiveStatus === 'dispatched' || effectiveStatus === 'delivered') {
    const requestSnap = await db.collection('resourceRequests').doc(existing.resourceRequestId).get();
    if (requestSnap.exists) {
      const req = requestSnap.data() as ResourceRequestDoc;
      await notifyUser(
        req.requestedBy,
        effectiveStatus === 'dispatched' ? 'Your items are on the way' : 'Your items have been delivered',
        `${existing.itemsDescription} — status: ${effectiveStatus}.`,
        { type: 'logistics', relatedId: taskId }
      );
    }
  }

  await recordAudit({
    action: 'updateLogisticsTask',
    actorUserId: request.auth!.uid,
    targetId: taskId,
    result: 'SUCCESS',
    metadata: { status: patch.status, assignedToUserId },
  });

  return { ok: true, status: effectiveStatus };
});

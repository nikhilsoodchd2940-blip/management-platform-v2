import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission, isZoneManagerOfCity, isTopManagement } from '../admin/authorize';
import { getGroupOrThrow } from '../groups/hierarchy';
import { recordAudit } from '../../utils/logger';
import { notifyUser, notifyReviewersForCity, notifyTopManagement } from '../../utils/notify';
import type {
  ApprovalStepDoc,
  LogisticsTaskDoc,
  ResourceCategory,
  ResourceRequestDoc,
  ResourceRequestStage,
} from '../../types/models';

const VALID_CATEGORIES: readonly ResourceCategory[] = [
  'music_equipment',
  'books',
  'instruments',
  'furniture',
  'transportation',
  'food',
  'other',
];

/**
 * Recorded by an admin on a member's/host's behalf — see the module doc
 * comment on ResourceRequestDoc (types/models.ts) for why: there's no
 * mobile submission screen yet. `requestedBy`/`requestedByName` identify
 * who the request is FOR, `createdBy` (the caller) is who's ACTUALLY
 * submitting it right now, from the admin panel.
 */
export const createResourceRequest = onCall(async (request) => {
  await requireAdminPermission(request, 'requests');

  const groupId = String(request.data?.groupId ?? '');
  const requestedBy = String(request.data?.requestedBy ?? '');
  const requestedByName = String(request.data?.requestedByName ?? '').trim();
  const category = request.data?.category as ResourceCategory;
  const itemsDescription = String(request.data?.itemsDescription ?? '').trim();
  const quantity = request.data?.quantity;
  const purpose: string | undefined = request.data?.purpose?.trim() || undefined;
  const deliveryLocation: string | undefined = request.data?.deliveryLocation?.trim() || undefined;
  const neededByMs: number | undefined = request.data?.neededByMs;

  if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required');
  if (!requestedBy) throw new HttpsError('invalid-argument', 'requestedBy is required');
  if (!requestedByName) throw new HttpsError('invalid-argument', 'requestedByName is required');
  if (!VALID_CATEGORIES.includes(category)) {
    throw new HttpsError('invalid-argument', `category must be one of ${VALID_CATEGORIES.join(', ')}`);
  }
  if (!itemsDescription) throw new HttpsError('invalid-argument', 'itemsDescription is required');
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    throw new HttpsError('invalid-argument', 'quantity must be a positive whole number');
  }

  const group = await getGroupOrThrow(groupId);
  if (group.type !== 'group') throw new HttpsError('invalid-argument', `${groupId} is not a leaf group`);

  const firstStep: ApprovalStepDoc = {
    stage: 'admin_review',
    action: 'submitted',
    actorUserId: request.auth!.uid,
    actorName: requestedByName,
    at: Timestamp.now(),
  };

  const doc: ResourceRequestDoc = {
    requestedBy,
    requestedByName,
    groupId,
    category,
    itemsDescription,
    ...(quantity !== undefined ? { quantity } : {}),
    ...(purpose ? { purpose } : {}),
    ...(deliveryLocation ? { deliveryLocation } : {}),
    ...(neededByMs !== undefined ? { neededBy: Timestamp.fromMillis(neededByMs) } : {}),
    stage: 'admin_review',
    approvalHistory: [firstStep],
    createdBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as ResourceRequestDoc['createdAt'],
    updatedAt: FieldValue.serverTimestamp() as unknown as ResourceRequestDoc['updatedAt'],
  };

  const ref = await db.collection('resourceRequests').add(doc);

  await notifyUser(
    requestedBy,
    'Resource request submitted',
    `Your request for "${itemsDescription}" was submitted and is awaiting review.`,
    { type: 'resource_request', relatedId: ref.id }
  );

  await recordAudit({
    action: 'createResourceRequest',
    actorUserId: request.auth!.uid,
    targetId: ref.id,
    result: 'SUCCESS',
    metadata: { groupId, category, requestedBy },
  });

  return { requestId: ref.id };
});

const NEXT_STAGE: Record<Exclude<ResourceRequestStage, 'approved' | 'rejected'>, ResourceRequestStage> = {
  admin_review: 'zone_manager_review',
  zone_manager_review: 'top_management_review',
  top_management_review: 'approved',
};

/**
 * Advances or rejects a request at whichever stage it's currently at.
 * Authorization depends on the CURRENT stage — an admin can only act at
 * admin_review, a Zone Manager of the request's kurel's city only at
 * zone_manager_review, Top Management only at top_management_review.
 * Reaching 'approved' auto-creates the LogisticsTaskDoc (requirement:
 * "After final approval, automatically create a logistics task").
 */
export const reviewResourceRequest = onCall(async (request) => {
  if (request.auth?.token?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }

  const requestId = String(request.data?.requestId ?? '');
  const decision = request.data?.decision as 'approve' | 'reject';
  const comment: string | undefined = request.data?.comment?.trim() || undefined;
  const actorName = String(request.data?.actorName ?? '').trim() || 'Admin';

  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required');
  if (decision !== 'approve' && decision !== 'reject') {
    throw new HttpsError('invalid-argument', 'decision must be "approve" or "reject"');
  }

  const ref = db.collection('resourceRequests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Request not found');
  const existing = snap.data() as ResourceRequestDoc;

  if (existing.stage === 'approved' || existing.stage === 'rejected') {
    throw new HttpsError('failed-precondition', `This request was already ${existing.stage}`);
  }

  const uid = request.auth!.uid;
  const group = await getGroupOrThrow(existing.groupId);
  const cityId = group.parentGroupId!; // leaf 'group' always has a 'city' parent — see hierarchy.ts

  if (existing.stage === 'admin_review') {
    await requireAdminPermission(request, 'requests');
  } else if (existing.stage === 'zone_manager_review') {
    if (!(await isZoneManagerOfCity(uid, cityId))) {
      throw new HttpsError('permission-denied', 'Only this kurel\u2019s Zone Manager (or Top Management) can review at this stage');
    }
  } else if (existing.stage === 'top_management_review') {
    if (!(await isTopManagement(uid))) {
      throw new HttpsError('permission-denied', 'Only Top Management can give the final decision');
    }
  }

  const step: ApprovalStepDoc = {
    stage: existing.stage,
    action: decision === 'approve' ? 'approved' : 'rejected',
    actorUserId: uid,
    actorName,
    ...(comment ? { comment } : {}),
    at: Timestamp.now(),
  };

  if (decision === 'reject') {
    await ref.update({
      stage: 'rejected',
      approvalHistory: FieldValue.arrayUnion(step),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await notifyUser(
      existing.requestedBy,
      'Resource request rejected',
      `Your request for "${existing.itemsDescription}" was rejected${comment ? `: ${comment}` : '.'}`,
      { type: 'resource_request', relatedId: requestId }
    );
    await recordAudit({ action: 'reviewResourceRequest', actorUserId: uid, targetId: requestId, result: 'SUCCESS', metadata: { decision, atStage: existing.stage } });
    return { ok: true, stage: 'rejected' };
  }

  const nextStage = NEXT_STAGE[existing.stage];
  const patch: Record<string, unknown> = {
    stage: nextStage,
    approvalHistory: FieldValue.arrayUnion(step),
    updatedAt: FieldValue.serverTimestamp(),
  };

  let logisticsTaskId: string | undefined;
  if (nextStage === 'approved') {
    const logisticsDoc: LogisticsTaskDoc = {
      resourceRequestId: requestId,
      groupId: existing.groupId,
      itemsDescription: existing.itemsDescription,
      ...(existing.quantity !== undefined ? { quantity: existing.quantity } : {}),
      ...(existing.deliveryLocation ? { deliveryLocation: existing.deliveryLocation } : {}),
      ...(existing.neededBy ? { deliveryAt: existing.neededBy } : {}),
      status: 'pending',
      history: [{ status: 'pending', actorUserId: uid, actorName, at: Timestamp.now() }],
      createdAt: FieldValue.serverTimestamp() as unknown as LogisticsTaskDoc['createdAt'],
      updatedAt: FieldValue.serverTimestamp() as unknown as LogisticsTaskDoc['updatedAt'],
    };
    const logisticsRef = await db.collection('logisticsTasks').add(logisticsDoc);
    logisticsTaskId = logisticsRef.id;
    patch.logisticsTaskId = logisticsTaskId;
  }

  await ref.update(patch);

  if (nextStage === 'zone_manager_review') {
    await notifyReviewersForCity(
      cityId,
      'Resource request needs your review',
      `"${existing.itemsDescription}" (${existing.requestedByName}) is awaiting Zone Manager review.`,
      { type: 'resource_request', relatedId: requestId }
    );
  } else if (nextStage === 'top_management_review') {
    await notifyTopManagement(
      'Resource request needs final approval',
      `"${existing.itemsDescription}" (${existing.requestedByName}) is awaiting Top Management approval.`,
      { type: 'resource_request', relatedId: requestId }
    );
  } else if (nextStage === 'approved') {
    await notifyUser(
      existing.requestedBy,
      'Resource request approved',
      `Your request for "${existing.itemsDescription}" was approved and sent to logistics.`,
      { type: 'resource_request', relatedId: requestId }
    );
  }

  await recordAudit({
    action: 'reviewResourceRequest',
    actorUserId: uid,
    targetId: requestId,
    result: 'SUCCESS',
    metadata: { decision, fromStage: existing.stage, toStage: nextStage, logisticsTaskId },
  });

  return { ok: true, stage: nextStage, logisticsTaskId };
});

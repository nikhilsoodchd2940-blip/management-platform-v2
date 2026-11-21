import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { BannerDoc, PopupDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';

const URL_RE = /^https?:\/\/.+/i;

function requireValidLink(raw: unknown): string | undefined {
  const url = String(raw ?? '').trim();
  if (!url) return undefined;
  if (!URL_RE.test(url)) throw new HttpsError('invalid-argument', 'Link must be a full http(s) URL');
  return url;
}

// ---------- Banners ----------

export const createBanner = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const imageUrl = String(request.data?.imageUrl ?? '').trim();
  if (!imageUrl) throw new HttpsError('invalid-argument', 'imageUrl is required');
  const linkUrl = requireValidLink(request.data?.linkUrl);
  const order = Number.isFinite(request.data?.order) ? Number(request.data.order) : 0;

  const doc: BannerDoc = {
    imageUrl,
    ...(linkUrl ? { linkUrl } : {}),
    order,
    active: request.data?.active !== false,
    createdAt: FieldValue.serverTimestamp() as unknown as BannerDoc['createdAt'],
    updatedAt: FieldValue.serverTimestamp() as unknown as BannerDoc['updatedAt'],
  };
  const ref = await db.collection('banners').add(doc);

  await recordAudit({ action: 'createBanner', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS' });
  return { bannerId: ref.id };
});

export const updateBanner = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const bannerId = String(request.data?.bannerId ?? '');
  if (!bannerId) throw new HttpsError('invalid-argument', 'bannerId is required');

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (request.data?.imageUrl !== undefined) {
    const imageUrl = String(request.data.imageUrl).trim();
    if (!imageUrl) throw new HttpsError('invalid-argument', 'imageUrl cannot be empty');
    updates.imageUrl = imageUrl;
  }
  if (request.data?.linkUrl !== undefined) {
    const linkUrl = requireValidLink(request.data.linkUrl);
    updates.linkUrl = linkUrl ?? FieldValue.delete();
  }
  if (request.data?.order !== undefined) updates.order = Number(request.data.order);
  if (request.data?.active !== undefined) updates.active = !!request.data.active;

  const ref = db.collection('banners').doc(bannerId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Banner not found');
  await ref.update(updates);

  await recordAudit({ action: 'updateBanner', actorUserId: request.auth!.uid, targetId: bannerId, result: 'SUCCESS' });
  return { ok: true as const };
});

export const deleteBanner = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const bannerId = String(request.data?.bannerId ?? '');
  if (!bannerId) throw new HttpsError('invalid-argument', 'bannerId is required');

  await db.collection('banners').doc(bannerId).delete();

  await recordAudit({ action: 'deleteBanner', actorUserId: request.auth!.uid, targetId: bannerId, result: 'SUCCESS' });
  return { ok: true as const };
});

// ---------- Popups ----------

export const createPopup = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const title = String(request.data?.title ?? '').trim();
  if (!title) throw new HttpsError('invalid-argument', 'title is required');
  const imageUrl = String(request.data?.imageUrl ?? '').trim();
  const description = String(request.data?.description ?? '').trim();
  const linkUrl = requireValidLink(request.data?.linkUrl);
  const order = Number.isFinite(request.data?.order) ? Number(request.data.order) : 0;

  const doc: PopupDoc = {
    title,
    ...(imageUrl ? { imageUrl } : {}),
    ...(description ? { description } : {}),
    ...(linkUrl ? { linkUrl } : {}),
    order,
    active: request.data?.active !== false,
    createdAt: FieldValue.serverTimestamp() as unknown as PopupDoc['createdAt'],
    updatedAt: FieldValue.serverTimestamp() as unknown as PopupDoc['updatedAt'],
  };
  const ref = await db.collection('popups').add(doc);

  await recordAudit({ action: 'createPopup', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS' });
  return { popupId: ref.id };
});

export const updatePopup = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const popupId = String(request.data?.popupId ?? '');
  if (!popupId) throw new HttpsError('invalid-argument', 'popupId is required');

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (request.data?.title !== undefined) {
    const title = String(request.data.title).trim();
    if (!title) throw new HttpsError('invalid-argument', 'title cannot be empty');
    updates.title = title;
  }
  if (request.data?.imageUrl !== undefined) {
    const imageUrl = String(request.data.imageUrl).trim();
    updates.imageUrl = imageUrl || FieldValue.delete();
  }
  if (request.data?.description !== undefined) {
    const description = String(request.data.description).trim();
    updates.description = description || FieldValue.delete();
  }
  if (request.data?.linkUrl !== undefined) {
    const linkUrl = requireValidLink(request.data.linkUrl);
    updates.linkUrl = linkUrl ?? FieldValue.delete();
  }
  if (request.data?.order !== undefined) updates.order = Number(request.data.order);
  if (request.data?.active !== undefined) updates.active = !!request.data.active;

  const ref = db.collection('popups').doc(popupId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Popup not found');
  await ref.update(updates);

  await recordAudit({ action: 'updatePopup', actorUserId: request.auth!.uid, targetId: popupId, result: 'SUCCESS' });
  return { ok: true as const };
});

export const deletePopup = onCall(async (request) => {
  await requireAdminPermission(request, 'content');

  const popupId = String(request.data?.popupId ?? '');
  if (!popupId) throw new HttpsError('invalid-argument', 'popupId is required');

  await db.collection('popups').doc(popupId).delete();

  await recordAudit({ action: 'deletePopup', actorUserId: request.auth!.uid, targetId: popupId, result: 'SUCCESS' });
  return { ok: true as const };
});

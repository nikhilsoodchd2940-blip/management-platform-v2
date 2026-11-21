import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config/firebase';
import { qrSigningSecret, CHECK_IN_GRACE_MINUTES, APP_CHECK_ENFORCED } from '../../config/env';
import { verifyQrPayload, type QrPayload } from './personalQr';
import { isWithinRadius, type LatLng } from '../../utils/geo';
import { recordAudit, log } from '../../utils/logger';
import type { AttendanceDoc, EventDoc, ScanResult } from '../../types/models';
import { Timestamp } from 'firebase-admin/firestore';
import { checkRateLimit } from '../../utils/rateLimit';

/**
 * The single most security-critical path in the product. This function
 * implements docs/QR_DATAFLOW.md step for step — read that doc alongside
 * this file if you're changing either. Every decision point below is
 * computed from server-fetched data; the client (Host device) supplies
 * only: the scanned QR payload, the eventId it selected, and a location
 * reading used strictly as a hint for the geofence calculation, never as
 * the authorization signal itself.
 *
 * No row is ever written to `attendance` for anything but a verified
 * PRESENT — NOT_ALLOWED/REJECTED/INVALID_QR/EVENT_CLOSED are function
 * response codes (and audit log entries), never attendance rows.
 *
 * Phase 5: rate-limited per Host (not per event or globally) — a real
 * Host scanning a line of people can easily do one every couple of
 * seconds, so the limit is generous; it exists to catch a malfunctioning
 * client stuck in a retry loop or a compromised Host account being used
 * for abuse, not to slow down normal use.
 */

const CHECKIN_MAX_PER_WINDOW = 120;
const CHECKIN_WINDOW_SECONDS = 60;

const attendeeDocId = (eventId: string, userId: string) => `${eventId}_${userId}`;

interface CheckInResponse {
  result: ScanResult;
  message: string;
}

function respond(result: ScanResult, message: string): CheckInResponse {
  return { result, message };
}

export const checkIn = onCall({ secrets: [qrSigningSecret], enforceAppCheck: APP_CHECK_ENFORCED }, async (request): Promise<CheckInResponse> => {
  // ---- 1. Caller must be an authenticated Host ----
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  if (request.auth.token.role !== 'host') {
    throw new HttpsError('permission-denied', 'Only a Host can check attendees in');
  }
  const hostGroupIds: string[] = (request.auth.token.hostGroupIds as string[] | undefined) ?? [];
  const hostId = request.auth.uid;

  const { allowed } = await checkRateLimit(`checkIn:${hostId}`, CHECKIN_MAX_PER_WINDOW, CHECKIN_WINDOW_SECONDS);
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Too many scans too quickly — wait a moment and try again.');
  }

  const eventId = String(request.data?.eventId ?? '');
  const qrDataRaw = String(request.data?.qrData ?? '');
  const clientLocation: LatLng | undefined = request.data?.location;

  if (!eventId || !qrDataRaw) {
    throw new HttpsError('invalid-argument', 'eventId and qrData are required');
  }

  // ---- 2. Parse + verify the QR signature (server-issued at profile time) ----
  let payload: QrPayload;
  try {
    payload = JSON.parse(qrDataRaw);
    if (typeof payload.userId !== 'string' || typeof payload.sig !== 'string') {
      throw new Error('malformed payload');
    }
  } catch {
    await recordAudit({
      action: 'checkIn',
      actorUserId: hostId,
      result: 'DENIED',
      metadata: { eventId, reason: 'unparseable QR' },
    });
    return respond('INVALID_QR', 'That QR code isn\'t valid.');
  }

  if (!verifyQrPayload(payload.userId, payload.sig, qrSigningSecret.value())) {
    await recordAudit({
      action: 'checkIn',
      actorUserId: hostId,
      targetId: payload.userId,
      result: 'DENIED',
      metadata: { eventId, reason: 'signature mismatch' },
    });
    return respond('INVALID_QR', 'That QR code isn\'t valid.');
  }
  const memberUserId = payload.userId;

  // ---- 3. Load the event; verify it's published, this Host is assigned to
  //         one of its Sub Groups, and now() is within the window (+ grace) ----
  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) {
    return respond('EVENT_CLOSED', 'This event no longer exists.');
  }
  const event = eventSnap.data() as EventDoc;

  const hostAssignedToEvent = event.subGroupIds.some((id) => hostGroupIds.includes(id));
  if (!hostAssignedToEvent) {
    throw new HttpsError('permission-denied', 'You are not assigned to this event\'s group');
  }

  if (event.status !== 'published') {
    return respond('EVENT_CLOSED', `This event is ${event.status}, not open for check-in.`);
  }

  const graceMs = CHECK_IN_GRACE_MINUTES * 60 * 1000;
  const nowMs = Date.now();
  const windowStartMs = event.startAt.toMillis() - graceMs;
  const windowEndMs = event.endAt.toMillis() + graceMs;
  if (nowMs < windowStartMs || nowMs > windowEndMs) {
    await recordAudit({
      action: 'checkIn',
      actorUserId: hostId,
      targetId: memberUserId,
      result: 'DENIED',
      metadata: { eventId, reason: 'outside check-in window' },
    });
    return respond('EVENT_CLOSED', 'Check-in isn\'t open for this event right now.');
  }

  // ---- 4. Eligibility: is this person on the event's attendee list? ----
  const attendeeSnap = await db
    .collection('eventAttendees')
    .doc(attendeeDocId(eventId, memberUserId))
    .get();
  if (!attendeeSnap.exists) {
    await recordAudit({
      action: 'checkIn',
      actorUserId: hostId,
      targetId: memberUserId,
      result: 'DENIED',
      metadata: { eventId, reason: 'not on attendee list' },
    });
    return respond('NOT_ALLOWED', 'This person isn\'t on the list for this event.');
  }

  // ---- 5. Geofence: server-computed distance, client location is a hint only ----
  if (!clientLocation || !Number.isFinite(clientLocation.lat) || !Number.isFinite(clientLocation.lng)) {
    throw new HttpsError('invalid-argument', 'location is required to check in');
  }
  const withinGeofence = isWithinRadius(
    clientLocation,
    { lat: event.location.lat, lng: event.location.lng },
    event.geofenceRadiusMeters
  );
  if (!withinGeofence) {
    await recordAudit({
      action: 'checkIn',
      actorUserId: hostId,
      targetId: memberUserId,
      result: 'DENIED',
      metadata: { eventId, reason: 'outside geofence' },
    });
    return respond('REJECTED', 'Too far from the event location to check in.');
  }

  // ---- 6. Transaction: re-check no existing attendance, then write ----
  const attendanceRef = db.collection('attendance').doc(attendeeDocId(eventId, memberUserId));
  const outcome = await db.runTransaction(async (tx) => {
    const existing = await tx.get(attendanceRef);
    if (existing.exists) {
      return 'ALREADY_CHECKED_IN' as const;
    }
    const doc: AttendanceDoc = {
      eventId,
      userId: memberUserId,
      status: 'PRESENT',
      scannedByHostId: hostId,
      serverTimestamp: Timestamp.now(),
      clientReportedLocation: clientLocation,
    };
    tx.set(attendanceRef, doc);
    return 'ALLOWED' as const;
  });

  if (outcome === 'ALLOWED') {
    log.info('checkIn: attendance recorded', { eventId, userId: memberUserId, hostId });
    await recordAudit({
      action: 'checkIn',
      actorUserId: hostId,
      targetId: memberUserId,
      result: 'SUCCESS',
      metadata: { eventId },
    });
    return respond('ALLOWED', 'Checked in.');
  }

  return respond('ALREADY_CHECKED_IN', 'Already checked in.');
});

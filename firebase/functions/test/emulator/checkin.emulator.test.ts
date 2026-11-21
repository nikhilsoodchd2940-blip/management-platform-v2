import { expect } from 'chai';
import * as admin from 'firebase-admin';

/**
 * Requires the Firestore + Auth emulators running (see docs/TESTING.md):
 *   firebase emulators:exec --project demo-test "npm --prefix firebase/functions run test:emulator"
 *
 * This is the ONE emulator test in the project, covering the single most
 * security-critical path end to end (docs/QR_DATAFLOW.md). It exists to
 * establish the pattern for testing v2 callables against real Firestore
 * + Auth state, not as comprehensive coverage — see docs/TESTING.md for
 * what else would be worth adding here.
 *
 * Secrets: checkIn depends on QR_SIGNING_SECRET via defineSecret(). In
 * the emulator/test context, Functions params read from process.env, so
 * we set it directly below rather than needing a real Secret Manager
 * value — this must be set BEFORE importing anything that imports
 * config/env.ts, hence the env var assignment at the very top of the file.
 */
process.env.QR_SIGNING_SECRET = 'emulator-test-secret';
process.env.GCLOUD_PROJECT = 'demo-test';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099';

// Imported AFTER the env vars above are set, deliberately — both of
// these modules read config at import time.
import { checkIn } from '../../src/modules/qr/checkIn';
import { signQrPayload } from '../../src/modules/qr/personalQr';

const db = admin.firestore();

async function seedEvent(overrides: Partial<Record<string, unknown>> = {}) {
  const eventRef = db.collection('events').doc();
  const now = Date.now();
  await eventRef.set({
    title: 'Emulator Test Event',
    mainGroupId: 'main1',
    subGroupIds: ['subA'],
    location: { lat: 37.7749, lng: -122.4194 },
    geofenceRadiusMeters: 100,
    startAt: admin.firestore.Timestamp.fromMillis(now - 5 * 60 * 1000),
    endAt: admin.firestore.Timestamp.fromMillis(now + 55 * 60 * 1000),
    status: 'published',
    createdBy: 'admin-uid',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return eventRef.id;
}

function callerRequest(uid: string, role: string, hostGroupIds: string[], data: Record<string, unknown>) {
  return {
    auth: { uid, token: { role, hostGroupIds, uid } as unknown },
    data,
  } as Parameters<typeof checkIn.run>[0];
}

describe('checkIn (emulator)', () => {
  const memberUid = 'member-uid-1';
  const hostUid = 'host-uid-1';

  before(async () => {
    // Clear anything left over from a prior run in the same emulator
    // instance — emulators persist state across test files within one
    // `emulators:exec` invocation.
    for (const col of ['events', 'eventAttendees', 'attendance', 'rateLimits']) {
      const snap = await db.collection(col).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  it('allows an eligible Host to check in an eligible Member within the geofence and window', async () => {
    const eventId = await seedEvent();
    await db.collection('eventAttendees').doc(`${eventId}_${memberUid}`).set({
      eventId,
      userId: memberUid,
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: 'admin-uid',
    });

    const qrData = JSON.stringify({
      userId: memberUid,
      sig: signQrPayload(memberUid, process.env.QR_SIGNING_SECRET!),
    });

    const result = await checkIn.run(
      callerRequest(hostUid, 'host', ['subA'], {
        eventId,
        qrData,
        location: { lat: 37.7749, lng: -122.4194 }, // exactly at the event location
      })
    );

    expect(result.result).to.equal('ALLOWED');

    const attendanceSnap = await db.collection('attendance').doc(`${eventId}_${memberUid}`).get();
    expect(attendanceSnap.exists).to.equal(true);
    expect(attendanceSnap.data()?.status).to.equal('PRESENT');
  });

  it('returns ALREADY_CHECKED_IN on a second scan, without writing a duplicate row', async () => {
    const eventId = await seedEvent();
    await db.collection('eventAttendees').doc(`${eventId}_${memberUid}`).set({
      eventId,
      userId: memberUid,
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: 'admin-uid',
    });
    const qrData = JSON.stringify({
      userId: memberUid,
      sig: signQrPayload(memberUid, process.env.QR_SIGNING_SECRET!),
    });
    const location = { lat: 37.7749, lng: -122.4194 };

    const first = await checkIn.run(callerRequest(hostUid, 'host', ['subA'], { eventId, qrData, location }));
    expect(first.result).to.equal('ALLOWED');

    const second = await checkIn.run(callerRequest(hostUid, 'host', ['subA'], { eventId, qrData, location }));
    expect(second.result).to.equal('ALREADY_CHECKED_IN');

    const attendanceSnap = await db.collection('attendance').doc(`${eventId}_${memberUid}`).get();
    expect(attendanceSnap.exists).to.equal(true); // still exactly one doc, not an error from a duplicate write
  });

  it("rejects a Host who is not assigned to the event's Sub Group", async () => {
    const eventId = await seedEvent();
    await db.collection('eventAttendees').doc(`${eventId}_${memberUid}`).set({
      eventId,
      userId: memberUid,
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: 'admin-uid',
    });
    const qrData = JSON.stringify({
      userId: memberUid,
      sig: signQrPayload(memberUid, process.env.QR_SIGNING_SECRET!),
    });

    let threw = false;
    try {
      await checkIn.run(
        callerRequest(hostUid, 'host', ['someOtherGroup'], {
          eventId,
          qrData,
          location: { lat: 37.7749, lng: -122.4194 },
        })
      );
    } catch (err) {
      threw = true;
      expect(err).to.have.property('code', 'permission-denied');
    }
    expect(threw).to.equal(true);
  });

  it('returns NOT_ALLOWED for someone not on the attendee list', async () => {
    const eventId = await seedEvent();
    // Deliberately no eventAttendees doc for this user.
    const qrData = JSON.stringify({
      userId: 'not-invited-uid',
      sig: signQrPayload('not-invited-uid', process.env.QR_SIGNING_SECRET!),
    });

    const result = await checkIn.run(
      callerRequest(hostUid, 'host', ['subA'], {
        eventId,
        qrData,
        location: { lat: 37.7749, lng: -122.4194 },
      })
    );

    expect(result.result).to.equal('NOT_ALLOWED');
    const attendanceSnap = await db.collection('attendance').doc(`${eventId}_not-invited-uid`).get();
    expect(attendanceSnap.exists).to.equal(false); // confirms the "no row for a denial" rule
  });

  it('returns REJECTED when the reported location is outside the geofence', async () => {
    const eventId = await seedEvent({ geofenceRadiusMeters: 50 });
    await db.collection('eventAttendees').doc(`${eventId}_${memberUid}`).set({
      eventId,
      userId: memberUid,
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: 'admin-uid',
    });
    const qrData = JSON.stringify({
      userId: memberUid,
      sig: signQrPayload(memberUid, process.env.QR_SIGNING_SECRET!),
    });

    const result = await checkIn.run(
      callerRequest(hostUid, 'host', ['subA'], {
        eventId,
        qrData,
        location: { lat: 37.9, lng: -122.6 }, // far from the event's 37.7749,-122.4194
      })
    );

    expect(result.result).to.equal('REJECTED');
  });
});


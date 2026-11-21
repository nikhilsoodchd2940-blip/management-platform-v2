"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const admin = __importStar(require("firebase-admin"));
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
const checkIn_1 = require("../../src/modules/qr/checkIn");
const personalQr_1 = require("../../src/modules/qr/personalQr");
const db = admin.firestore();
async function seedEvent(overrides = {}) {
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
function callerRequest(uid, role, hostGroupIds, data) {
    return {
        auth: { uid, token: { role, hostGroupIds, uid } },
        data,
    };
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
            sig: (0, personalQr_1.signQrPayload)(memberUid, process.env.QR_SIGNING_SECRET),
        });
        const result = await checkIn_1.checkIn.run(callerRequest(hostUid, 'host', ['subA'], {
            eventId,
            qrData,
            location: { lat: 37.7749, lng: -122.4194 }, // exactly at the event location
        }));
        (0, chai_1.expect)(result.result).to.equal('ALLOWED');
        const attendanceSnap = await db.collection('attendance').doc(`${eventId}_${memberUid}`).get();
        (0, chai_1.expect)(attendanceSnap.exists).to.equal(true);
        (0, chai_1.expect)(attendanceSnap.data()?.status).to.equal('PRESENT');
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
            sig: (0, personalQr_1.signQrPayload)(memberUid, process.env.QR_SIGNING_SECRET),
        });
        const location = { lat: 37.7749, lng: -122.4194 };
        const first = await checkIn_1.checkIn.run(callerRequest(hostUid, 'host', ['subA'], { eventId, qrData, location }));
        (0, chai_1.expect)(first.result).to.equal('ALLOWED');
        const second = await checkIn_1.checkIn.run(callerRequest(hostUid, 'host', ['subA'], { eventId, qrData, location }));
        (0, chai_1.expect)(second.result).to.equal('ALREADY_CHECKED_IN');
        const attendanceSnap = await db.collection('attendance').doc(`${eventId}_${memberUid}`).get();
        (0, chai_1.expect)(attendanceSnap.exists).to.equal(true); // still exactly one doc, not an error from a duplicate write
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
            sig: (0, personalQr_1.signQrPayload)(memberUid, process.env.QR_SIGNING_SECRET),
        });
        let threw = false;
        try {
            await checkIn_1.checkIn.run(callerRequest(hostUid, 'host', ['someOtherGroup'], {
                eventId,
                qrData,
                location: { lat: 37.7749, lng: -122.4194 },
            }));
        }
        catch (err) {
            threw = true;
            (0, chai_1.expect)(err).to.include('permission-denied');
        }
        (0, chai_1.expect)(threw).to.equal(true);
    });
    it('returns NOT_ALLOWED for someone not on the attendee list', async () => {
        const eventId = await seedEvent();
        // Deliberately no eventAttendees doc for this user.
        const qrData = JSON.stringify({
            userId: 'not-invited-uid',
            sig: (0, personalQr_1.signQrPayload)('not-invited-uid', process.env.QR_SIGNING_SECRET),
        });
        const result = await checkIn_1.checkIn.run(callerRequest(hostUid, 'host', ['subA'], {
            eventId,
            qrData,
            location: { lat: 37.7749, lng: -122.4194 },
        }));
        (0, chai_1.expect)(result.result).to.equal('NOT_ALLOWED');
        const attendanceSnap = await db.collection('attendance').doc(`${eventId}_not-invited-uid`).get();
        (0, chai_1.expect)(attendanceSnap.exists).to.equal(false); // confirms the "no row for a denial" rule
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
            sig: (0, personalQr_1.signQrPayload)(memberUid, process.env.QR_SIGNING_SECRET),
        });
        const result = await checkIn_1.checkIn.run(callerRequest(hostUid, 'host', ['subA'], {
            eventId,
            qrData,
            location: { lat: 37.9, lng: -122.6 }, // far from the event's 37.7749,-122.4194
        }));
        (0, chai_1.expect)(result.result).to.equal('REJECTED');
    });
});
//# sourceMappingURL=checkin.emulator.test.js.map
# Testing Strategy

Two tiers, both under `firebase/functions/test/`, distinguished by filename suffix.

## 1. Unit tests (`*.test.ts`) — pure logic, no network, no emulator

Everything with no Firestore/Auth/Twilio/Stripe dependency: `roles.test.ts`, `personalQr.test.ts`, `phone.test.ts`, `geo.test.ts`, `events.test.ts`, `overlap.test.ts`, `recurring-and-permissions.test.ts`, `rateLimit.test.ts`. These run anywhere, instantly, including in this sandbox's absence of network — which is exactly why every phase of this build has been able to ship *some* verified logic even without `npm install` ever succeeding here.

```bash
cd firebase/functions
npm test
```

The pattern used throughout: business logic that CAN be separated from Firestore/Auth calls IS separated into a small pure function (`validateEventInput`, `rangesOverlap`, `addOccurrence`, `signQrPayload`, `rateLimitBucketId`, etc.) and exported specifically so it's unit-testable. When you add a new Function, look for the pure decision-making core first — extract and test that, even if the Function around it still needs an emulator to test end-to-end.

## 2. Emulator integration tests (`*.emulator.test.ts`) — the real thing, needs the Firestore/Auth/Functions emulators running

Everything that actually touches Firestore, custom claims, or Firestore Security Rules — which is most of what actually matters for correctness in this app (the `checkIn` flow, rules enforcement, triggers). These use `firebase-functions-test` (already a devDependency, added in Phase 0) in "online" mode against the local emulator suite, not against a real project.

```bash
firebase emulators:exec --project demo-test "npm --prefix firebase/functions run test:emulator"
```

(`test:emulator` script and the `demo-test` convention are set up in `test/emulator/checkin.emulator.test.ts` — see that file for the exact pattern: seed Firestore, set custom claims via the Auth emulator, call the function, assert on the result AND on what did/didn't get written.)

**This project has exactly one emulator test written** (`test/emulator/checkin.emulator.test.ts`), covering the single most security-critical path (`checkIn`) end-to-end: an eligible Host scanning an eligible Member's QR within the geofence and window succeeds exactly once, a second scan of the same person returns `ALREADY_CHECKED_IN` without a duplicate write, and a Host outside their assigned group is rejected. It exists to establish the pattern, not as complete coverage — **the honest state of this codebase is that unit tests cover the pure logic well, and emulator coverage is a good start, not comprehensive.** Extending it (chat rules, Storage rules, the conflict-detection trigger, absence/event-request review, reminders) is real, valuable Phase 5+ work that this sandbox's lack of network access prevented from being written *and verified* together — anything added here should be run against the emulator before being trusted, same as everything else in this build.

## What's NOT tested here, and why

- **Manual/exploratory QA** (does the UI actually look right, does a real Twilio SMS actually arrive, does a real Stripe test card actually complete) — needs real accounts and real devices, which this sandbox has neither. `docs/LAUNCH_CHECKLIST.md` has the manual smoke-test list to run before trusting a deploy.
- **Admin web and Flutter have no automated tests of their own beyond `flutter analyze`/`flutter test` in CI and one Dart unit test** (`mobile/test/offline_checkin_queue_test.dart`) — the business logic in this app lives almost entirely in Cloud Functions by design (docs/ARCHITECTURE.md §2: "Functions are the trust boundary"), so that's where test investment concentrated. UI-level testing (widget tests, Playwright/Cypress for admin web) is a reasonable next investment once there's a real UI to test against a real deploy, not before.

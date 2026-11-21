# Phase 5 Completion Report — QA, Security, Performance, Launch

Phase 5 is different in kind from Phases 0–4: it's a review and hardening pass across everything already built, not new user-facing features. This report reflects that — more findings-and-fixes, fewer new screens.

## Completed items

**Security — Cloud Functions** (`firebase/functions/src/`)
- `modules/admin/authorize.ts` — new shared `requireAdminPermission`/`hasAdminPermission` helpers, closing the gap Phase 4 explicitly flagged: granular admin permissions existed as data (`adminRoles`) and a UI (`/dashboard/permissions`) but no Function actually checked them. Now wired into `groups.ts` (create/update/archive → `'groups'`), `members.ts` (add/import/search/assign → `'members'`), `events.ts` and `recurring.ts` (create/update/publish/cancel/attendee overrides → `'events'`), `reviewEventRequest` (→ `'requests'`), and `reviewAbsenceRequest`'s admin branch (→ `'requests'`, alongside its existing assigned-Host path).
- `modules/auth/assignRole.ts` — tightened: granting the `admin` role now requires an explicit `isSuperAdmin: true` `adminRoles` doc (a deliberate, documented exception to "missing doc = unrestricted," since granting admin is privilege escalation); granting `host`/`member` requires the `'members'` permission like the rest of member management.
- `utils/rateLimit.ts` — a fixed-window rate limiter backed by Firestore counter docs, pure bucket-ID logic (`rateLimitBucketId`) separated out for unit testing. Applied to `sendOtp` (5/hour/phone) and `checkIn` (120/min/Host).
- App Check: `enforceAppCheck: true` added to `sendOtp`, `verifyOtp`, `checkIn`, `assignRole`, `setAdminPermissions`, `createDonationIntent` — the callables where a forged client would cause the most damage. Not applied to every callable; see Known Issues.
- Resource configs: `timeoutSeconds`/`memory` added to `sendEventReminders`, `importMembers`, `publishEvent` — the three functions doing the most work per invocation.
- `types/models.ts` — `AdminPermission` gained `'groups'` (previously only covered members/events/requests/donations/reports, missing group management itself).

**Security — rules/config**
- `firestore.rules` — added an explicit `rateLimits` collection rule (fully locked, matching `reminders`) rather than relying on the catch-all, for the same "be explicit, not implicit" consistency the rest of the file follows.
- `docs/ENVIRONMENT.md`/`docs/INTEGRATIONS.md` updated with the App Check setup story and `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.

**Client authenticity + crash reporting**
- Mobile `main.dart` — `firebase_app_check` activation (Play Integrity/App Attest in release, debug provider in debug builds) and `firebase_crashlytics` wiring (`FlutterError.onError`, `PlatformDispatcher.instance.onError`) — the latter closes a "crash reporting" item from the original Phase 0 requirements list that never got built.
- Admin web `lib/firebase.ts` — `initializeAppCheck` with `ReCaptchaV3Provider`, gated on a configured site key (no-op, not a crash, if absent — so local dev without a key still works against non-enforced callables).

**Performance — admin web**
- `app/dashboard/events/page.tsx`, `app/dashboard/donations/page.tsx` — both moved from unbounded `onSnapshot` to `limit()` + "Load more" pagination. Donations' running total switched to a server-side `sum()` aggregate specifically so it stays correct regardless of how many pages are loaded (a naive client-side sum over a paginated list would silently undercount).

**QA infrastructure**
- `docs/TESTING.md` — explains the two-tier strategy (pure unit tests vs. emulator integration tests) and is explicit about what's NOT covered and why, rather than implying more confidence than exists.
- `test/emulator/checkin.emulator.test.ts` — the one emulator integration test in the project, covering `checkIn` end-to-end against real Firestore/Auth emulator state: eligible Host + eligible Member within geofence and window succeeds exactly once; a second scan returns `ALREADY_CHECKED_IN` without a duplicate write; a Host outside their assigned group is rejected; someone not on the attendee list gets `NOT_ALLOWED` with no attendance row written; a location outside the geofence gets `REJECTED`. Establishes the pattern (`firebase/functions/package.json` gained a `test:emulator` script) rather than providing comprehensive coverage — stated explicitly in `docs/TESTING.md`.
- Unit tests: `rateLimit.test.ts` (bucket determinism), plus the `'groups'` permission addition reflected in `recurring-and-permissions.test.ts`.
- `mobile/test/offline_checkin_queue_test.dart` — the first Dart unit test in the project, covering `PendingCheckIn` JSON round-tripping (including the int-vs-double edge case `jsonDecode` produces for whole-number coordinates).

**Launch readiness**
- `.github/workflows/ci.yml` — added a `mobile` job (`flutter analyze` + `flutter test`); mobile had zero CI coverage before this phase.
- `.github/workflows/deploy.yml` — new, manual-dispatch only (never triggered by push, since a deploy has real consequences and depends on secrets that don't exist yet in a fresh clone of this repo). Deploys Functions + Firestore rules/indexes + Storage rules together (so they can't drift apart mid-deploy) and admin-web to Vercel, both gated behind repo secrets that fail cleanly at the auth step if unset.
- `docs/QA_SECURITY_REVIEW.md` — the consolidated review: a table of findings fixed this phase, and a separate, equally explicit list of findings reviewed and knowingly left open with a stated reason each (not just fixed items — this is the actual deliverable of a security pass, showing what was *looked at*, not only what changed).
- `docs/LAUNCH_CHECKLIST.md` — every manual/console step flagged across all five phases' completion reports, gathered into one ordered checklist ending in a 12-step smoke test, instead of leaving someone to reconstruct it by reading five separate documents.

## Tests passed
Same caveat as every prior phase: **not executed in this sandbox** (no network access to `npm install`). Ten unit test files and one emulator test file now exist for Cloud Functions; one Dart test file for mobile. Run `npm test`, `npm run test:emulator` (with emulators running), and `flutter test` yourself — none of this has been run here, including the new rate-limiter and permission-check logic added this phase.

## Known issues / sandbox limitations
- **Still unverified**, now across six phases — this is the most consequential phase to actually run before trusting, since it changes authorization behavior (permission enforcement, the `assignRole` super-admin requirement) that could lock out an existing admin if misapplied. Test the emulator suite and the smoke test in `docs/LAUNCH_CHECKLIST.md` before deploying to anything real.
- **App Check is enforced on six callables, not all of them.** Deliberate scoping stated in `docs/QA_SECURITY_REVIEW.md` — expanding coverage is straightforward (add `enforceAppCheck: true` to the option object) but each addition should be tested against a working App Check setup, which this sandbox can't do.
- **The permission-enforcement change and the `assignRole` super-admin requirement are both behavior changes**, not purely additive — an already-deployed Phase 4 system upgrading to this code would need the bootstrap step in `docs/LAUNCH_CHECKLIST.md` §5 (setting `isSuperAdmin: true` on the first admin) run *before* anyone needs to grant a second admin, or that operation will start failing. Called out explicitly rather than left as a surprise.
- **Rate limit windows (5/hour OTP, 120/min check-in) are unvalidated guesses** at reasonable thresholds, not measured against real usage. Worth revisiting once there's real traffic data.
- **`docs/QA_SECURITY_REVIEW.md`'s "left open" list is not exhaustive** — it's what surfaced during a focused review pass in this sandbox, not a formal audit. A few items on it (the broad `users` read rule, chat's lack of rate limiting) are reasonable to revisit post-launch if usage patterns make them matter more than they do today.

## Database changes
- `rateLimits` graduated to a live (but fully client-inaccessible) collection.
- No schema changes to existing collections this phase — Phase 5 was authorization/config/tooling, not data model work.

## Security changes
This entire phase was security changes — see `docs/QA_SECURITY_REVIEW.md` for the full table rather than repeating it here. The headline: the trust boundary established in Phase 0 (Functions validate, Rules independently re-deny, client is never trusted for a decision) was reviewed and held up — nothing required restructuring it, only closing gaps within it. The most significant gap closed was granular permissions going from UI-only to actually enforced.

## Exact next steps

This is the blueprint's final planned phase. What's left is what `docs/LAUNCH_CHECKLIST.md` lays out — verification and real-world configuration, not more code:

1. Run every verification step accumulated across all six phases (`docs/LAUNCH_CHECKLIST.md` §1).
2. Complete Firebase project setup, secrets, and App Check configuration for at least a staging environment (§2–4).
3. Bootstrap the first Admin **and** super-admin — note the Phase 5 requirement that the super-admin doc must exist before that admin can grant `admin` to anyone else (§5).
4. Register the Stripe webhook and confirm the signature-verified flow works end to end (§6).
5. Run the 12-step smoke test in staging (§10) before considering this ready for real users.
6. Beyond launch: the items in `docs/QA_SECURITY_REVIEW.md`'s "left open" list are the natural backlog — most notably expanding emulator test coverage beyond `checkIn` alone, and revisiting the broad `users` read rule if the org's sensitivity profile changes.

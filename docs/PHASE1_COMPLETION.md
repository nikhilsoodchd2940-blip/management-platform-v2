# Phase 1 Completion Report — Org + Identity

## Completed items

**Cloud Functions** (`firebase/functions/src/`)
- `modules/auth/otp.ts` — `sendOtp` / `verifyOtp`: Twilio Verify-backed OTP login. `verifyOtp` finds-or-creates exactly one Auth user + one `users/{uid}` Firestore doc per phone number, defaults new users to `role: member`, mints a Firebase custom token.
- `modules/auth/assignRole.ts` — `assignRole`: Admin-only, sets custom claims on an existing user. Cannot be used to self-promote (caller must already be Admin) — the very first Admin is created out-of-band (documented, see below).
- `modules/auth/roles.ts` — shared `setUserRoleClaims` / `isValidRole` primitive (from Phase 0, now actually used).
- `modules/groups/groups.ts` — `createGroup` (Main or Sub, with parent validation), `updateGroup`, `archiveGroup` (soft-delete).
- `modules/groups/members.ts` — `addMember`, `importMembers` (batch, max 500/call, per-row error reporting), `searchMembers` (name-prefix or exact-phone), `assignMemberToGroups`, `assignHostToGroups` (keeps `groupMemberships.role` and the `hostGroupIds` auth claim in sync — recomputes the full set on every call so it can't drift).
- `modules/qr/personalQr.ts` — `getPersonalQr`: stable HMAC-signed personal QR, pure sign/verify functions exported separately for testing.
- `utils/phone.ts` — shared E.164 validation (`requireE164`), used by both `otp.ts` and `members.ts`.
- `config/env.ts` — added `QR_SIGNING_SECRET` and `DEFAULT_ORG_ID` (Phase 1 assumption: one organization per Firebase project — see `docs/ARCHITECTURE.md` §3).
- `index.ts` updated to export all of the above.

**Firestore rules** (`firebase/firestore.rules`)
- `groups`: narrowed from "any signed-in user" to Admin, assigned Host, or active member of that specific Sub Group (Main Group stays broadly readable). Added `isActiveMember()` helper using the now-deterministic `groupMemberships` doc ID (`${groupId}_${userId}`) for a cheap `exists()`/`get()` check instead of a query.
- `notifications`: read-your-own, write-locked (nothing writes to it yet — Phase 4).

**Firestore indexes** — added `(userId, createdAt desc)` for `notifications`.

**Data model** (`docs/DATA_MODEL.md`, `firebase/functions/src/types/models.ts`)
- `groupMemberships` doc ID is now deterministic (`${groupId}_${userId}`), matching the `eventAttendees` pattern from Phase 0 — idempotent writes, cheap rule checks.
- `UserDoc` gained `displayNameLower` (maintained alongside `displayName`) to support Admin's prefix-search.

**Admin web** (`admin-web/src/`)
- `context/AuthContext.tsx` — Firebase Auth (email/password) + role read from ID token claims.
- `app/login/page.tsx`, `app/dashboard/layout.tsx` (route guard), `app/dashboard/page.tsx` (shell).
- `app/dashboard/groups/page.tsx` — live list (Firestore `onSnapshot`) + create Main/Sub Group + archive.
- `app/dashboard/members/page.tsx` — search members, add a member (with optional initial Sub Group assignment), assign an existing member to Sub Groups as Member or Host.
- `lib/functions.ts` — typed `httpsCallable` wrappers for every Phase 1 callable.
- `app/globals.css` — small shared token set (not a full brand exercise — this is an internal ops tool).

**Mobile** (`mobile/lib/`)
- `core/session.dart` — Riverpod `StateNotifier` tracking signed-in user + role/`hostGroupIds` claims, refreshed on every auth-state change.
- `core/session_gate.dart` — single branch point: loading → OTP login → Member shell / Host shell / "wrong role for mobile" message (Admin is web-only).
- `features/auth/` — `auth_service.dart` (wraps `sendOtp`/`verifyOtp`), `otp_login_screen.dart` (two-step phone → code UI).
- `features/profile/profile_screen.dart` — view/edit own profile + sign out.
- `features/groups/my_groups_screen.dart` — Member's Sub Groups (via `groupMemberships` → `groups` lookup).
- `features/qr/my_qr_screen.dart` — renders the personal QR from `getPersonalQr` using `qr_flutter`.
- `features/notifications/notifications_screen.dart` — inbox shell (no writer yet — Phase 4).
- `features/host/` — `host_home_screen.dart` (assigned Sub Groups from the `hostGroupIds` claim), `host_group_members_screen.dart` (member list per group, "Scan QR" entry point stubbed with an explanatory dialog — real scanning is Phase 2).
- `features/member_home_shell.dart`, `features/host_home_shell.dart` — the two role-specific navigation shells.
- `main.dart` rewritten to wrap the app in `ProviderScope` and route through `SessionGate`.

**Tests** (offline, no emulator) — `test/roles.test.ts` (Phase 0), `test/personalQr.test.ts`, `test/phone.test.ts`.

## Tests passed
Same caveat as Phase 0: **not executed in this sandbox** (no network access to `npm install`). The three test files are structured to run via `npm test`. Run them yourself before Phase 2 — see Known issues.

## Known issues / sandbox limitations
- **Still no network access here.** Nothing in `firebase/functions/`, `admin-web/`, or `mobile/` has been compiled, linted, or run. Before Phase 2: run `npm install && npm run build && npm run lint && npm test` in `firebase/functions/`, and `npm install && npm run build` in `admin-web/`. Flutter still needs `flutter create .` run locally first (no Flutter SDK in this sandbox), then `flutter pub get`, `flutterfire configure`.
- **First Admin account**: `assignRole` requires the caller to already be Admin, by design — there is no self-service bootstrap. Create the first Admin manually once per environment:
  1. Sign up (or create) that person's Firebase Auth user (email/password) via Firebase Console or Admin SDK from a trusted machine.
  2. Run `setUserRoleClaims(uid, { role: 'admin', orgId: 'default-org' })` (import from `modules/auth/roles.ts`) once, e.g. via a one-off local script using the Admin SDK with your service account credentials — not via a deployed callable.
- `QR_SIGNING_SECRET` must be set (`firebase functions:secrets:set QR_SIGNING_SECRET`, generate with `openssl rand -hex 32`) before `getPersonalQr` will deploy/run.
- Admin login is email/password (Firebase Auth), not Twilio OTP — the blueprint specifies OTP for Member/Host login but doesn't mandate a method for Admin; email/password is the standard choice for an internal web ops panel. Flag this now in case that assumption is wrong for your use case — it's a one-function change (`assignRole`/Firebase Console user creation) if Admin should use OTP too.
- `searchMembers` is prefix-only (no fuzzy/substring search) — Firestore has no native full-text search; noted as a non-goal for Phase 1 in the code comment.

## Database changes
- `groupMemberships` doc ID scheme changed from auto-ID to deterministic `${groupId}_${userId}` (documented in `docs/DATA_MODEL.md`). No live data exists yet in any environment, so this is not a migration — just worth knowing if you prototyped against the Phase 0 shape.
- `users` gained `displayNameLower`.

## Security changes
- `groups` read access narrowed to Admin/assigned-Host/active-member (was: any signed-in user).
- `notifications` collection added, read-your-own / write-locked.
- Role/claim mutation remains centralized: `setUserRoleClaims` (Phase 0 primitive) is now called from exactly two places — `assignRole` (Admin-driven) and `assignHostToGroups` (Admin-driven, recomputes the full host group set every time to prevent drift). New-user default (`role: member`) is set inline in `otp.ts`/`members.ts` at the one point identity is minted, not through a separate path.
- Personal QR is a stateless HMAC signature over the user ID only — no group/attendance data encoded, no Firestore round-trip needed to issue or (in Phase 2) verify it.

## Exact next steps (Phase 2 prerequisites)
1. Run the verification steps above (`npm install/build/lint/test`, `flutter create .` + `pub get`) and fix whatever doesn't compile — still unverified.
2. Set `QR_SIGNING_SECRET` and create the first Admin per the steps above in at least your dev environment.
3. Manually smoke-test end-to-end in the Firebase emulator suite: Admin creates a Main Group → a Sub Group → adds a member → assigns them Host → Member signs in via OTP (Twilio test credentials) → Member sees their QR → Host sees the group and member list.
4. Phase 2 work (blueprint §6): `createEvent`/`publishEvent` Cloud Functions, `eventAttendees` population, the `checkIn` Cloud Function implementing `docs/QR_DATAFLOW.md` exactly, Host QR-scanning UI (wire up `mobile_scanner`, already in `pubspec.yaml`), geofence validation via `geolocator`.

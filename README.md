# Management & Group Operations Platform

AI-first build following `CLAUDE_DEVELOPMENT_BLUEPRINT.md`. Fixed stack: **Flutter** (mobile), **React/Next.js** (admin web), **Firebase** (Cloud Functions, Firestore, Storage, FCM, App Check), **Twilio** (OTP/SMS), **Stripe** (donations), **Google Maps Platform** (geofencing). No Supabase.

## Repository layout

```
/firebase        Cloud Functions (TypeScript), Firestore rules & indexes, Storage rules
/admin-web        React/Next.js admin panel
/mobile           Flutter app (Member + Host)
/docs             Architecture, data model, data-flow, integration plan
```

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Foundation & architecture | ✅ Scaffolded |
| **1** | Org + identity (auth, groups, roles, QR issuance) | ✅ Built — unverified, see `docs/PHASE1_COMPLETION.md` |
| **2** | Events + QR + geofence + attendance | ✅ Built — unverified, see `docs/PHASE2_COMPLETION.md` |
| **3** | Absence, chat, requests, conflicts, donations | ✅ Built — unverified, see `docs/PHASE3_COMPLETION.md` |
| **4** | Reports, chat media, recurring events, reminders, permissions, offline QR | ✅ Built — unverified, see `docs/PHASE4_COMPLETION.md` |
| **5** | QA, security, performance, launch | ✅ Built (this delivery) — unverified, see `docs/PHASE5_COMPLETION.md` |

**Start here to actually launch this**: `docs/LAUNCH_CHECKLIST.md` (every manual/console step across all five phases, in order) and `docs/QA_SECURITY_REVIEW.md` (what was reviewed, fixed, and knowingly left open). Read `docs/ARCHITECTURE.md` first for the overall design, then the phase completion reports in order for what was built when.

## Local setup (Phase 0 — architecture only, nothing runs end-to-end yet)

Prerequisites: Node.js 20+, Firebase CLI, Flutter SDK 3.x. These are **not installed in this sandbox** (no network access here), so `npm install`, `flutter pub get`, and `firebase deploy` must be run in your own environment. All source files are hand-authored and ready for that.

```bash
# Firebase Functions
cd firebase/functions && npm install && npm run build && npm test

# Admin web
cd admin-web && npm install && npm run dev

# Mobile
cd mobile && flutter pub get && flutter run
```

See `docs/ENVIRONMENT.md` for required environment variables and secrets — **none are committed to this repo.**

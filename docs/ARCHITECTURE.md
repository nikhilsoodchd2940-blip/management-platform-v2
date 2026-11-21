# Architecture — Phase 0

## 1. Roles & security boundary

Three roles: **Admin**, **Host**, **Member**. A custom claim `role` is set on the Firebase Auth token via a Cloud Function (never set client-side). Additional claims: `orgId` (Main Group), and for Hosts, `hostGroupIds` (array of Sub Group IDs they're assigned to).

- **Member** — mobile app only. Can read/write their own profile, read groups they belong to, read events they're invited to, read/write their own chat messages in rooms they belong to, create donations, mark themselves absent.
- **Host** — mobile app. Everything a Member can do for groups they're assigned to, plus: scan QR codes, view attendee lists/attendance for assigned groups' events, approve absences.
- **Admin** — web only. Full org management: groups, members, hosts, events, reports, permissions.

**Rule**: no role or permission is ever trusted from the client. Every sensitive read/write is re-validated in Firestore Security Rules and/or a Cloud Function using the custom claims and, for the QR flow, server-side lookups — never the payload the client sends.

## 2. High-level components

```
Flutter app (Member + Host)  ──┐
                                 ├─► Firebase Auth (custom claims: role, orgId, hostGroupIds)
Next.js Admin (Admin)        ──┘
        │
        ▼
Cloud Functions (business logic, all sensitive checks)
        │
        ▼
Firestore (source of truth) ── Storage (media) ── FCM (push)
        │
        ├─► Twilio (OTP, SMS reminders)
        ├─► Stripe (donations, webhooks)
        └─► Google Maps Platform (geofence distance calc, address lookup)
```

Admin web never writes sensitive fields directly to Firestore for cross-cutting operations (e.g. assigning a Host, publishing an event with an attendee list) — it calls a Cloud Function (callable) that validates the caller's role/claims server-side, then writes. Firestore Security Rules are the second, independent layer of defense (defense in depth) — rules must independently deny what Functions would deny, not merely mirror UI assumptions.

## 3. Environments

Three Firebase projects: `<app>-dev`, `<app>-staging`, `<app>-prod`. Config is selected via `.env` / `--project` flag, never hard-coded. See `docs/ENVIRONMENT.md`.

Phase 1 assumes **one organization per Firebase project** (a project has exactly one Main Group) — `orgId` is a fixed constant (`DEFAULT_ORG_ID`, `firebase/functions/src/config/env.ts`), not a lookup. Nothing in the blueprint asks for multiple organizations sharing one project; if that changes, `orgId` becomes a real per-org value at that point rather than being generalized speculatively now.

## 4. Why this shape

- **Firestore over a relational DB**: the product is read-heavy on nested membership/attendance lookups with realtime chat and notification requirements — Firestore + FCM covers both without a second realtime layer.
- **Cloud Functions as the only writer of sensitive state**: QR check-in, attendance, donation status, and role assignment are all things a compromised or modified client must not be able to forge. Centralizing them in Functions means one audited code path instead of three (web, Android, iOS).
- **One `users` collection, membership modeled separately**: prevents the single most likely data-integrity bug in a multi-group product — duplicate person records. See `docs/DATA_MODEL.md`.

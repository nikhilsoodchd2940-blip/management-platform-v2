# Integration Plan — Twilio, Stripe, Maps, FCM, Firebase

## How credentials are actually set (read this first)
As of this change, every third-party credential below can be set **live,
from the admin panel's Intégrations page** (`/dashboard/integrations`),
instead of only via `firebase functions:secrets:set` + a redeploy. Under
the hood: `updateIntegrationSettings` (admin-only, gated by the
`integrations` permission) writes to a single locked Firestore doc,
`config/integrations` — `allow read, write: if false` in
`firestore.rules`, so no client (admin panel included) ever reads it
back directly; only Cloud Functions via the Admin SDK touch it. Backend
code reads it through `getIntegrationConfig()`
(`functions/src/config/integrationConfig.ts`), which prefers this
Firestore value and **falls back to the old Secret-Manager-bound value**
if nothing's set there — so an existing deployment that only ever used
`firebase functions:secrets:set` keeps working unchanged, and the
`secrets: [...]` bindings on each callable stay in place (still required
for Functions v2 to grant IAM access to those secrets at all, even when
the Firestore value is what actually gets used).

Google Maps is the one exception: its API key is designed to be used
**client-side** (Google restricts it by HTTP referrer/app package in
Cloud Console, not by secrecy), so `getIntegrationStatus` returns its
actual value to the admin panel — see the events page's
`useGoogleMapsPlaces()` for where the admin-web frontend fetches and
uses it directly to load the Places Autocomplete script.

## Firebase
- **Auth**: phone-based sign-in (Twilio-backed OTP, see below) issues a Firebase custom token after OTP verification; a Function then sets custom claims (`role`, `orgId`, `hostGroupIds`).
- **App Check** (Phase 5, live — not Phase 1 as originally planned; see docs/PHASE5_COMPLETION.md for why): enforced (`enforceAppCheck: true`) on the highest-value callables — `sendOtp`, `verifyOtp`, `checkIn`, `assignRole`, `setAdminPermissions`, `createDonationIntent` — to reject requests not originating from the real apps. Mobile activates via `firebase_app_check` (Play Integrity / App Attest in release, the debug provider in debug builds); admin web activates via `firebase/app-check`'s `ReCaptchaV3Provider`, gated on a configured site key. Not yet enforced on every callable — see docs/PHASE5_COMPLETION.md for the specific scoping rationale and what's still open.
- **Firestore**: primary datastore, rules in `firebase/firestore.rules`.
- **Storage**: chat media (Phase 4, live — `firebase/storage.rules`). Profile photos and meeting-note attachments beyond that remain a later item. Rules restrict by group membership via a cross-service Firestore lookup, mirroring `firestore.rules`' own membership check.
- **FCM**: not implemented — Phase 4 delivers reminders via SMS + the in-app `notifications` inbox instead (see below). Push remains a later enhancement, not a regression.

## Twilio (OTP + SMS reminders)
- Phase 1: `sendOtp` callable Function → Twilio Verify API → user enters code → `verifyOtp` Function exchanges for a Firebase custom auth token. Twilio, not Firebase's own phone auth, is used per blueprint's fixed stack — avoids paying for two SMS providers.
- Phase 4 (live): `sendEventReminders`, a scheduled Function (`firebase/functions/src/modules/reminders/reminders.ts`, runs every 15 minutes) using Twilio's regular Messages API (not Verify) for event reminders. Gated by each user's `notificationsEnabled` field (default on) and deduped via a `reminders/{eventId}_{userId}` marker written *before* the send is attempted — a missed reminder on a retry is a smaller problem than a duplicated one.
- Credentials: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` — Function-side secrets only (Firebase Secret Manager), never in the mobile/web bundle. `TWILIO_FROM_NUMBER` (the sending number) is a regular Functions v2 param, not a secret — it's a public phone number, not a credential.

## Stripe (donations)
- Card entry happens client-side via Stripe's SDK/Elements — raw card data never touches our backend.
- A callable Function creates a PaymentIntent/Checkout Session server-side.
- A **webhook** Function (`stripeWebhook`, public HTTPS endpoint, signature-verified with `STRIPE_WEBHOOK_SECRET`) is the *only* writer of `donations.status`. The client-side "success" callback is UX only — it never marks a donation confirmed.
- Idempotency: webhook handler keys off Stripe's event ID to ignore duplicate deliveries (Stripe retries webhooks).
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Function-side); `STRIPE_PUBLISHABLE_KEY` (client-side, safe to expose).

## Google Maps Platform
- Event creation (Admin web) — **live**: once a key is set on the Intégrations page, the address field on the event
  creation form (`admin-web/src/app/dashboard/events/page.tsx`) becomes a real Places Autocomplete — picking a
  suggestion fills in the address label and the lat/lng fields. Without a key set, it's a plain text field and lat/lng
  are typed by hand — this fallback is intentional, not broken.
- Check-in (mobile): device GPS reading is sent as a hint; the **server** computes the distance from `events.location`
  using the haversine formula (no external API call needed for a simple radius check — Maps Platform is used for
  geocoding/autocomplete at event-creation time, not for the real-time distance check, to avoid a billable API call
  and network dependency on every scan).
- Keys: separate restricted API keys per platform (Android, iOS, web) with API restrictions (Places, Geocoding, Maps
  JS/SDK only) and application restrictions (package name / bundle ID / HTTP referrer). Only one key
  (`googleMapsApiKey`) is currently wired up via the admin panel — that's the web key used by admin-web's event form;
  the mobile app doesn't call Maps Platform at all yet (see the check-in note above), so there's nothing there for an
  Android/iOS-restricted key to unlock today.

## FCM
- Topic-based for broad announcements (per Sub Group topic), token-based for targeted notifications (event reminders, absence approvals, chat mentions).
- Token registration happens on login and app open; stale tokens pruned on send failure.

All of the above are implemented as Cloud Functions calling these services server-side wherever the operation is sensitive (payment confirmation, OTP verification, reminder dispatch) — client SDKs are used only for the parts that are inherently client-side (Stripe Elements card entry, Maps autocomplete UI, FCM token registration).

# QR → Authorization → Attendance Data Flow

This is the single most security-critical path in the product (blueprint §6, §9, §13). Written out fully in Phase 0 because every later phase's Cloud Function must match this exactly — no client is ever trusted for the decision.

## Sequence

```
Host device                Cloud Function: checkIn()              Firestore
    │                              │                                   │
    │  scan member's personal QR   │                                   │
    │  QR payload = {userId, sig}  │                                   │
    ├──────────────────────────────►                                   │
    │  + eventId (host-selected)   │                                   │
    │  + host's authenticated ctx  │                                   │
    │                              │  1. verify caller is an           │
    │                              │     authenticated Host with       │
    │                              │     claim covering this group     │
    │                              ├──────────────────────────────────►│
    │                              │  2. verify QR signature (server   │
    │                              │     issued at profile creation;   │
    │                              │     reject if invalid/expired)    │
    │                              │  3. load event by eventId         │
    │                              ├──────────────────────────────────►│
    │                              │     status must be 'published'    │
    │                              │     now() within [startAt,endAt]  │
    │                              │     window (+ grace config)       │
    │                              │  4. get(eventAttendees/            │
    │                              │       {eventId}_{userId})         │
    │                              ├──────────────────────────────────►│
    │                              │                                   │
    │                              │  ┌─ NOT FOUND ───────────────────┐│
    │                              │  │ return NOT_ALLOWED             ││
    │                              │  │ write auditLogs entry          ││
    │                              │  │ NO attendance doc written      ││
    │                              │  └────────────────────────────────┘│
    │                              │                                   │
    │                              │  5. FOUND → validate geofence:    │
    │                              │     device-reported GPS is a      │
    │                              │     hint only; function computes  │
    │                              │     distance(event.location,      │
    │                              │     reportedLocation) server-side │
    │                              │     against event.geofenceRadius  │
    │                              │                                   │
    │                              │  ┌─ OUTSIDE ──────────────────────┐│
    │                              │  │ return REJECTED                ││
    │                              │  │ write auditLogs entry          ││
    │                              │  │ NO attendance doc written      ││
    │                              │  └────────────────────────────────┘│
    │                              │                                   │
    │                              │  ┌─ INSIDE ───────────────────────┐│
    │                              │  │ transaction:                   ││
    │                              │  │  - re-check no existing        ││
    │                              │  │    attendance for (eventId,    ││
    │                              │  │    userId) -> prevents dupes   ││
    │                              │  │  - write attendance doc,       ││
    │                              │  │    status=PRESENT,             ││
    │                              │  │    serverTimestamp()           ││
    │                              │  │ return ALLOWED / PRESENT       ││
    │                              │  └────────────────────────────────┘│
    │◄──────────────────────────────                                   │
    │  result shown on Host device │                                   │
```

## Non-negotiables this diagram encodes

1. The **decision (ALLOWED/NOT_ALLOWED/REJECTED) is computed entirely inside the Function**, using server-fetched `eventAttendees` and `events` docs. The client sends only: QR payload, selected eventId, and a location reading used purely as a *hint* — never as the authorization signal itself.
2. **Idempotency**: the attendee-list check and the duplicate-attendance check both key off `{eventId}_{userId}`-shaped lookups so retries/double-taps can't create two attendance rows or leak timing info about which failure occurred.
3. **No attendance row for anything but a verified PRESENT.** NOT_ALLOWED and REJECTED are function-response codes and optional audit-log entries, never rows in `attendance`.
4. **Firestore Security Rules independently deny** direct client writes to `attendance` (rule: `allow write: if false;` — only the Admin SDK inside the Function, which bypasses rules, may write it). This is the second layer described in `ARCHITECTURE.md` §2 — even a Function bug doesn't help an attacker if the client literally cannot write the collection.

# QR module

- `personalQr.ts` (Phase 1) — issues each Member/Host's stable signed QR;
  also exports the pure `signQrPayload`/`verifyQrPayload` functions.
- `checkIn.ts` (Phase 2) — implements the full flow in
  `docs/QR_DATAFLOW.md`: verifies the Host's authorization, verifies the
  QR signature, checks the event window, checks `eventAttendees`
  eligibility, validates the geofence, and transactionally writes
  `attendance`. There's no separate `modules/attendance/` — attendance is
  written from exactly one place (here), so it lives with the function
  that writes it rather than being split across a matching "attendance
  module" that would just re-export the same logic.

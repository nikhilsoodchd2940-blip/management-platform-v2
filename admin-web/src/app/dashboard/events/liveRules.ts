import type { LiveStatus } from '@/lib/functions';
import type { Slot } from './LiveBoard';

export const READY_LEAD_MS = 15 * 60000;
/** A performance started by the clock that nobody ended is closed this long after its end. */
export const OVER_CAP_MS = 60 * 60000;

const delayOf = (s: Slot) => (s.status === 'delayed' || s.status === 'in_progress' ? Math.max(0, s.delayMinutes ?? 0) * 60000 : 0);
/** Start and end including a reported delay. */
export const effStart = (s: Slot) => s.startMs + delayOf(s);
export const effEnd = (s: Slot) => s.endMs + delayOf(s);

/**
 * The status a performance has by the clock (same rule as the server job that saves it every minute):
 * Ready 15 minutes before, On stage at the start unless the previous group at the same place is still on
 * stage (held). A running performance is not finished by the clock: it goes over time until a supervisor
 * ends it (only a forgotten one is closed an hour later). Started by hand: left alone.
 */
export function effStatus(s: Slot, now: number, held = false): LiveStatus {
  if (s.status === 'cancelled' || s.status === 'completed') return s.status;
  if (s.status === 'in_progress') return s.auto && now >= effEnd(s) + OVER_CAP_MS ? 'completed' : 'in_progress';
  if (held) return s.status === 'upcoming' && now >= effStart(s) - READY_LEAD_MS && now < effStart(s) ? 'ready' : s.status;
  if (now >= effEnd(s)) return s.status; // slot passed, never started: not marked (see isMissed)
  if (now >= effStart(s)) return 'in_progress';
  if (s.status === 'upcoming' && now >= effStart(s) - READY_LEAD_MS) return 'ready';
  return s.status;
}

/** The slot has fully passed and nobody started or finished it: the board asks whether it performed. */
export const isMissed = (s: Slot, st: LiveStatus, now: number) => (st === 'upcoming' || st === 'ready' || st === 'delayed') && now >= effEnd(s);

/**
 * Whether two [start, end] time ranges overlap at all (touching endpoints
 * do NOT count as overlapping — an event ending at 3pm and one starting
 * at 3pm are back-to-back, not conflicting).
 */
export function rangesOverlap(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

/** Deterministic, order-independent conflict doc ID for a pair of events. */
export function conflictDocId(userId: string, eventIdA: string, eventIdB: string): string {
  const [low, high] = [eventIdA, eventIdB].sort();
  return `${userId}_${low}_${high}`;
}

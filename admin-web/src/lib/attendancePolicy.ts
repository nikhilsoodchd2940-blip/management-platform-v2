/**
 * Counting policy (one rule so the totals always reconcile):
 *  - Present  = arrived on time.
 *  - Leave    = approved leave (an excused status, or an approved absence request).
 *  - Absent   = everyone expected who is neither Present nor on Leave. This includes late members and
 *               people with no record, because a late member counts as absent but may sit and observe.
 *  - Late     = shown on its own as "of which late"; it is a subset of Absent, never added to Present,
 *               so Present + Leave + Absent always equals Expected.
 */
export type Bucket = 'present' | 'late' | 'leave' | 'absent';

export function bucketOf(status: string | undefined, hasApprovedLeave: boolean): Bucket {
  if (status === 'PRESENT') return 'present';
  if (status === 'LATE_APPROVED') return 'present';
  if (status === 'LATE' || status === 'PENDING') return 'late';
  if (status === 'EXCUSED') return 'leave';
  if (status === 'UNEXCUSED') return 'absent';
  return hasApprovedLeave ? 'leave' : 'absent';
}

export interface Summary {
  expected: number;
  present: number;
  leave: number;
  /** Includes the late members. */
  absent: number;
  /** Of the absent total, how many arrived late. */
  late: number;
}

export function summarize(buckets: Bucket[]): Summary {
  const s: Summary = { expected: buckets.length, present: 0, leave: 0, absent: 0, late: 0 };
  for (const b of buckets) {
    if (b === 'present') s.present++;
    else if (b === 'leave') s.leave++;
    else {
      s.absent++;
      if (b === 'late') s.late++;
    }
  }
  return s;
}

export const BUCKET_LABEL: Record<Bucket, string> = { present: 'Present', late: 'Late (counted absent)', leave: 'Leave', absent: 'Absent' };

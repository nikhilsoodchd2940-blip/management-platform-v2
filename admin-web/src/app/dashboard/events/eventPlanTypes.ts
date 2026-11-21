export interface SiteDraft {
  id: string;
  name: string;
  address: string;
  lat: string;
  lng: string;
  groupIds: string[];
}

export interface ShiftPerson {
  userId: string;
  name: string;
  photoUrl?: string;
  role: 'main' | 'member';
  /** Rights of this person; the default of the role applies when empty. */
  can?: string[];
  /** For a team member: the main supervisor he or she works under. */
  leaderId?: string;
}

export interface ShiftDraft {
  id: string;
  label: string;
  /** Local date and time, "2026-11-05T09:00". */
  startAt: string;
  endAt: string;
  /** Places this shift supervises; empty = every place. */
  siteIds: string[];
  /** Groups this shift is responsible for; empty = all groups. */
  groupIds: string[];
  people: ShiftPerson[];
}

/** Hours of one day when they differ from the other days. `slots` are the sessions of that day. */
export interface DayHours {
  start: string;
  end: string;
  slots?: { start: string; end: string }[];
}

export interface TimeSlotDraft {
  id: string;
  start: string;
  end: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 5 -> "5th", 22 -> "22nd". */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "2026-11-05" -> "5th November 2026". */
export function longDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return '—';
  return `${ordinal(Number(m[3]))} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "5th November 2026 to 28th November 2026", or a single date when both days are the same. */
export function longRange(startYmd: string, endYmd: string): string {
  if (!startYmd || !endYmd) return '—';
  return startYmd === endYmd ? longDate(startYmd) : `${longDate(startYmd)} to ${longDate(endYmd)}`;
}

/** "5th Nov, 09:00" for a local date-time string. */
export function shortWhen(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(local);
  if (!m) return '—';
  return `${ordinal(Number(m[3]))} ${MONTHS[Number(m[2]) - 1].slice(0, 3)}, ${m[4]}`;
}

export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

export const RIGHTS: { key: string; label: string; main: boolean; member: boolean }[] = [
  { key: 'status', label: 'Change statuses', main: true, member: true },
  { key: 'delay', label: 'Report delays', main: true, member: true },
  { key: 'notes', label: 'Add notes', main: true, member: true },
  { key: 'adjust', label: 'Change the schedule', main: true, member: false },
  { key: 'cancel', label: 'Cancel a performance', main: true, member: false },
];
/** The rights of a person: the ones chosen, or the default of the role. */
export const rightsOf = (p: { role: 'main' | 'member'; can?: string[] }): string[] => p.can ?? RIGHTS.filter((r) => r[p.role]).map((r) => r.key);

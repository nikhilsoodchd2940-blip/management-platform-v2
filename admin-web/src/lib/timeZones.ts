/** Locations named in the specification. Any IANA name also works (the server validates it). */
const COMMON_ZONES: { value: string; name: string }[] = [
  { value: 'UTC', name: 'UTC (Coordinated Universal Time)' },
  { value: 'Africa/Dakar', name: 'Senegal (Dakar)' },
  { value: 'Africa/Abidjan', name: 'Ivory Coast (Abidjan)' },
  { value: 'Africa/Bamako', name: 'Mali (Bamako)' },
  { value: 'Africa/Banjul', name: 'Gambia (Banjul)' },
  { value: 'Africa/Conakry', name: 'Guinea (Conakry)' },
  { value: 'Africa/Nouakchott', name: 'Mauritania (Nouakchott)' },
  { value: 'Africa/Accra', name: 'Ghana (Accra)' },
  { value: 'Africa/Lagos', name: 'Nigeria (Lagos)' },
  { value: 'Africa/Casablanca', name: 'Morocco (Casablanca)' },
  { value: 'Africa/Algiers', name: 'Algeria (Algiers)' },
  { value: 'Africa/Tunis', name: 'Tunisia (Tunis)' },
  { value: 'Africa/Cairo', name: 'Egypt (Cairo)' },
  { value: 'Africa/Johannesburg', name: 'South Africa (Johannesburg)' },
  { value: 'Europe/London', name: 'London, United Kingdom' },
  { value: 'Europe/Paris', name: 'Paris, France' },
  { value: 'Europe/Berlin', name: 'Berlin, Germany' },
  { value: 'Europe/Madrid', name: 'Madrid, Spain' },
  { value: 'Europe/Rome', name: 'Rome, Italy' },
  { value: 'Europe/Istanbul', name: 'Istanbul, Turkey' },
  { value: 'Asia/Dubai', name: 'Dubai, United Arab Emirates' },
  { value: 'Asia/Riyadh', name: 'Riyadh, Saudi Arabia' },
  { value: 'Asia/Karachi', name: 'Pakistan (Karachi, Lahore)' },
  { value: 'Asia/Kolkata', name: 'India (New Delhi, Chandigarh)' },
  { value: 'Asia/Dhaka', name: 'Bangladesh (Dhaka)' },
  { value: 'Asia/Colombo', name: 'Sri Lanka (Colombo)' },
  { value: 'Asia/Singapore', name: 'Singapore' },
  { value: 'Australia/Sydney', name: 'Sydney, Australia' },
  { value: 'America/New_York', name: 'New York, USA' },
  { value: 'America/Chicago', name: 'Chicago / Houston, USA' },
  { value: 'America/Denver', name: 'Denver, USA' },
  { value: 'America/Los_Angeles', name: 'Los Angeles, USA' },
  { value: 'America/Toronto', name: 'Toronto, Canada' },
  { value: 'America/Sao_Paulo', name: 'Sao Paulo, Brazil' },
];

function nowOffsetLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value ?? '';
    return part === 'GMT' ? 'UTC+00:00' : part.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

/** Common time zones, each with its UTC value. Any IANA name also works (the server validates it). */
export const TIME_ZONES = [
  ...COMMON_ZONES.map((z) => ({ value: z.value, label: `${nowOffsetLabel(z.value)} — ${z.name}`.replace(/^ — /, '') })),
  // Fixed whole-hour UTC values, for any place not listed above.
  ...Array.from({ length: 27 }, (_, i) => i - 12).map((h) => ({ value: h === 0 ? 'Etc/GMT' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`, label: `UTC${h >= 0 ? '+' : '-'}${String(Math.abs(h)).padStart(2, '0')}:00 — fixed` })),
];

function offsetMs(utcMs: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-11-03" + "18:30" typed as local time in `tz` -> the real UTC instant (daylight saving handled). */
export function zonedToUtcMs(date: string, time: string, tzIn: string): number {
  const tz = tzIn || DEFAULT_TIME_ZONE;
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess - offsetMs(guess, tz);
  ms = guess - offsetMs(ms, tz);
  return ms;
}

export function formatInZone(ms: number, tzIn: string, withDate = true): string {
  if (!ms) return '—';
  const tz = tzIn || DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...(withDate ? { day: '2-digit', month: 'short', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms));
}

/** yyyy-mm-dd of the instant as seen in `tz`. */
export function dayKeyInZone(ms: number, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m} min ${s}s` : `${m} min`;
}

/** The four clocks shown on the dashboard until the organisation chooses others in Settings. */
export const DEFAULT_CLOCKS: { label: string; timeZone: string }[] = [
  { label: 'Dakar', timeZone: 'Africa/Dakar' },
  { label: 'New York', timeZone: 'America/New_York' },
  { label: 'Rio de Janeiro', timeZone: 'America/Sao_Paulo' },
  { label: 'Paris', timeZone: 'Europe/Paris' },
];

/** Used for a city that has no time zone yet (Senegal). A Super Admin can change it on the Zones page. */
export const DEFAULT_TIME_ZONE = 'Africa/Dakar';

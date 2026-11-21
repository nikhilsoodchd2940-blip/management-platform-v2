import type { Pt } from '@/app/dashboard/geofence/GeofenceMap';

/** "lat,lng" of the middle of a circle or polygon, for a Google Maps embed. */
export function centerQuery(f?: { shape?: 'circle' | 'polygon'; center?: Pt; polygon?: Pt[] }): string | undefined {
  if (!f) return undefined;
  if (f.shape === 'circle' && f.center) return `${f.center.lat},${f.center.lng}`;
  const p = f.polygon ?? [];
  if (p.length === 0) return f.center ? `${f.center.lat},${f.center.lng}` : undefined;
  return `${(p.reduce((n, x) => n + x.lat, 0) / p.length).toFixed(6)},${(p.reduce((n, x) => n + x.lng, 0) / p.length).toFixed(6)}`;
}

/**
 * Server-side distance check for the geofence step in docs/QR_DATAFLOW.md.
 * Deliberately a local haversine calculation, not a Google Maps Distance
 * Matrix API call — see docs/INTEGRATIONS.md: this runs on every single
 * scan, so avoiding a billable external API call (and its network
 * dependency/latency) on the hot path is the whole point. Maps Platform is
 * still used at event-creation time for address autocomplete, just not here.
 */

const EARTH_RADIUS_METERS = 6371000;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function isWithinRadius(point: LatLng, center: LatLng, radiusMeters: number): boolean {
  return haversineDistanceMeters(point, center) <= radiusMeters;
}

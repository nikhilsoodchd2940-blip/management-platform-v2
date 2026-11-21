'use client';

import { useEffect, useState } from 'react';
import { getMapsConfig } from './functions';

/* eslint-disable @typescript-eslint/no-explicit-any */
let keyPromise: Promise<string> | null = null;
let scriptPromise: Promise<any> | null = null;
export let mapsAuthError = '';
/** Why no key was found (shown on the map so the admin knows what to fix). */
export let mapsKeyProblem = '';

/** The Google Maps key set on the Integrations page (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as a fallback). Empty when none. */
export function getMapsKey(): Promise<string> {
  if (!keyPromise) {
    keyPromise = getMapsConfig({})
      .then((r) => {
        const k = r.data.googleMapsApiKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
        mapsKeyProblem = k ? '' : 'No Google Maps key is saved yet. Add it on the Integrations page.';
        return k;
      })
      .catch((e) => {
        const k = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
        const code = (e as { code?: string })?.code ?? '';
        mapsKeyProblem = k ? '' : code.includes('not-found') ? 'The key could not be read because the latest functions are not deployed yet (run: firebase deploy --only functions).' : code.includes('permission') ? 'Your account is not allowed to read the Google Maps key (it needs the events permission).' : 'The Google Maps key could not be read. Check your connection and reload.';
        return k;
      });
  }
  return keyPromise;
}

/** Forget the cached key (after the key is changed on the Integrations page). */
export function resetMapsKey() {
  keyPromise = null;
}

/** Loads the Google Maps JavaScript API (with Places) once. */
export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if ((window as any).google?.maps?.places) return Promise.resolve((window as any).google);
  if (!scriptPromise) {
    scriptPromise = getMapsKey().then(
      (key) =>
        new Promise((resolve, reject) => {
          if (!key) return reject(new Error('No Google Maps key'));
          (window as any).gm_authFailure = () => {
            mapsAuthError = 'Google Maps rejected the API key. In Google Cloud, enable "Maps JavaScript API" and "Places API", and allow this website for the key.';
            window.dispatchEvent(new Event('gmaps-auth-failed'));
          };
          (window as any).__gmapsReady = () => resolve((window as any).google);
          const js = document.createElement('script');
          js.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly&callback=__gmapsReady`;
          js.async = true;
          js.onerror = () => { scriptPromise = null; reject(new Error('Google Maps could not be loaded. Check the internet connection.')); };
          document.head.appendChild(js);
        })
    );
  }
  return scriptPromise;
}

/** undefined while loading, '' when no key is set, otherwise the key. */
export function useMapsKey(): string | undefined {
  const [key, setKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    getMapsKey().then((k) => !dead && setKey(k));
    return () => { dead = true; };
  }, []);
  return key;
}

/** Finds the coordinates of a typed address. Google when a key is set, otherwise OpenStreetMap. */
export async function geocodeAddress(q: string): Promise<{ lat: number; lng: number; address: string } | null> {
  const text = q.trim();
  if (text.length < 3) return null;
  const key = await getMapsKey();
  if (key) {
    try {
      const g = await loadGoogleMaps();
      return await new Promise<{ lat: number; lng: number; address: string } | undefined>((resolve) => {
        new g.maps.Geocoder().geocode({ address: text }, (res: any, status: string) => {
          if (status === 'OK' && res?.[0]) resolve({ lat: res[0].geometry.location.lat(), lng: res[0].geometry.location.lng(), address: res[0].formatted_address });
          else resolve(undefined);
        });
      }).then((hit) => { if (hit) return hit; throw new Error('google-no-result'); });
    } catch { /* Google gave no answer (API not enabled for the key, or nothing found): try OpenStreetMap */ }
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(text)}`);
    const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon), address: j[0].display_name } : null;
  } catch {
    return null;
  }
}

export interface PlaceHit { lat: number; lng: number; address: string; /** The name of a business or landmark, when Google gives one. */ name?: string }

/** Several matching places for a typed text (live suggestions). Google when a key is set, otherwise OpenStreetMap. */
export async function searchPlaces(q: string, near?: string): Promise<PlaceHit[]> {
  const text = q.trim();
  if (text.length < 3) return [];
  const full = near ? `${text}, ${near}` : text;
  const out: PlaceHit[] = [];
  const add = (h: PlaceHit) => {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) return;
    if (out.some((x) => Math.abs(x.lat - h.lat) < 0.0008 && Math.abs(x.lng - h.lng) < 0.0008)) return;
    out.push(h);
  };
  const key = await getMapsKey();
  if (key) {
    try {
      const g = await loadGoogleMaps();
      // Google Places text search: businesses, landmarks, stadiums and streets (up to 20), not only street addresses.
      const places = await new Promise<PlaceHit[]>((resolve) => {
        try {
          const svc = new g.maps.places.PlacesService(document.createElement('div'));
          svc.textSearch({ query: full }, (res: any[] | null, status: string) => {
            if (status === 'OK' && res?.length) resolve(res.slice(0, 20).map((r) => ({ lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), address: r.formatted_address || r.vicinity || r.name, name: r.name })));
            else resolve([]);
          });
        } catch { resolve([]); }
      });
      places.forEach(add);
      // The address geocoder adds exact street addresses.
      const hits = await new Promise<PlaceHit[]>((resolve) => {
        new g.maps.Geocoder().geocode({ address: full }, (res: any, status: string) => {
          if (status === 'OK' && res?.length) resolve(res.slice(0, 8).map((r: any) => ({ lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), address: r.formatted_address })));
          else resolve([]);
        });
      });
      hits.forEach(add);
    } catch { /* fall back to OpenStreetMap */ }
  }
  // OpenStreetMap adds more suggestions (streets, buildings, districts) next to Google's best match.
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=0&q=${encodeURIComponent(full)}`);
    const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
    j.forEach((x) => add({ lat: Number(x.lat), lng: Number(x.lon), address: x.display_name }));
  } catch { /* keep what we have */ }
  return out.slice(0, 20);
}

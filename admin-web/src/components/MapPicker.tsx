'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, mapsAuthError, mapsKeyProblem, useMapsKey } from '@/lib/googleMaps';
import { tx } from '@/lib/i18n/tr';

export interface LatLng { lat: number; lng: number }
export interface MapValue { lat: string; lng: string; address: string; polygon: LatLng[] }

/* eslint-disable @typescript-eslint/no-explicit-any */
let leafletPromise: Promise<any> | null = null;
/** Loads the Leaflet map library once, from a CDN (no key and no install needed). */
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => resolve((window as any).L);
    js.onerror = () => { leafletPromise = null; reject(new Error('The map could not be loaded. Check your connection.')); };
    document.body.appendChild(js);
  });
  return leafletPromise;
}

interface Hit { display_name: string; lat: string; lon: string }

/** Distance in metres from the centre of a polygon to its farthest corner (used as the fallback radius). */
export function polygonRadius(poly: LatLng[]): number {
  if (poly.length === 0) return 0;
  const c = { lat: poly.reduce((n, p) => n + p.lat, 0) / poly.length, lng: poly.reduce((n, p) => n + p.lng, 0) / poly.length };
  const d = (a: LatLng, b: LatLng) => {
    const r = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  return Math.max(10, Math.ceil(Math.max(...poly.map((p) => d(c, p)))));
}

/**
 * Pick a venue: search an address, click the map to pin it (the pin can be dragged),
 * and optionally draw the area (polygon) inside which attendance counts.
 */
function LeafletPicker({ value, onChange, radius, hideSearch, noArea, height }: PickerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const state = useRef<{ map?: any; marker?: any; poly?: any; circle?: any; L?: any }>({});
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [mode, setMode] = useState<'pin' | 'area'>('pin');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  // build the map once
  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !holder.current || state.current.map) return;
      const v = latest.current.value;
      const has = v.lat !== '' && v.lng !== '' && !Number.isNaN(Number(v.lat));
      const map = L.map(holder.current).setView(has ? [Number(v.lat), Number(v.lng)] : [30.7333, 76.7794], has ? 16 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      state.current = { map, L };
      map.on('click', async (e: any) => {
        const cur = latest.current;
        if (modeRef.current === 'area') {
          cur.onChange({ ...cur.value, polygon: [...cur.value.polygon, { lat: e.latlng.lat, lng: e.latlng.lng }] });
          return;
        }
        const next = { ...cur.value, lat: e.latlng.lat.toFixed(6), lng: e.latlng.lng.toFixed(6) };
        cur.onChange(next);
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`);
          const j = await r.json();
          if (j?.display_name) latest.current.onChange({ ...latest.current.value, lat: next.lat, lng: next.lng, address: j.display_name });
        } catch { /* the pin is still set */ }
      });
      setReady(true);
    }).catch((e) => setError(e instanceof Error ? e.message : tx("The map could not be loaded.")));
    return () => { dead = true; };
  }, []);

  // draw the pin, polygon and radius circle
  useEffect(() => {
    const { map, L } = state.current;
    if (!map || !L) return;
    const has = value.lat !== '' && value.lng !== '' && !Number.isNaN(Number(value.lat)) && !Number.isNaN(Number(value.lng));
    if (has) {
      const pos: [number, number] = [Number(value.lat), Number(value.lng)];
      if (!state.current.marker) {
        const m = L.marker(pos, { draggable: true }).addTo(map);
        m.on('dragend', () => {
          const p = m.getLatLng();
          latest.current.onChange({ ...latest.current.value, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
        });
        state.current.marker = m;
      } else state.current.marker.setLatLng(pos);
      if (!map.getBounds().contains(pos)) map.setView(pos, Math.max(map.getZoom(), 15));
    } else if (state.current.marker) { state.current.marker.remove(); state.current.marker = undefined; }

    if (state.current.circle) { state.current.circle.remove(); state.current.circle = undefined; }
    if (has && value.polygon.length < 3 && radius && radius > 0) {
      state.current.circle = L.circle([Number(value.lat), Number(value.lng)], { radius, color: '#0b5d3b', weight: 2, fillOpacity: 0.12 }).addTo(map);
    }
    if (state.current.poly) { state.current.poly.remove(); state.current.poly = undefined; }
    if (value.polygon.length > 0) {
      const pts = value.polygon.map((p) => [p.lat, p.lng]);
      state.current.poly = (value.polygon.length >= 3 ? L.polygon(pts, { color: '#c9610b', weight: 3, fillOpacity: 0.2 }) : L.polyline(pts, { color: '#c9610b', weight: 3 })).addTo(map);
    }
  }, [value, radius, ready]);

  async function search() {
    const q = query.trim();
    if (q.length < 3) { setError(tx("Type at least 3 letters of the address.")); return; }
    setError(''); setSearching(true); setHits(null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as Hit[];
      setHits(j);
      if (j.length === 0) setError(tx("No place found. Try a more complete address, or click the map."));
    } catch { setError(tx("The address search is not available right now. Click the map to place the pin.")); }
    finally { setSearching(false); }
  }

  function choose(h: Hit) {
    onChange({ ...value, lat: Number(h.lat).toFixed(6), lng: Number(h.lon).toFixed(6), address: h.display_name });
    setHits(null);
    state.current.map?.setView([Number(h.lat), Number(h.lon)], 17);
  }

  function useMyPosition() {
    navigator.geolocation?.getCurrentPosition(
      (p) => { onChange({ ...value, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); state.current.map?.setView([p.coords.latitude, p.coords.longitude], 17); },
      () => setError(tx("Your position could not be read. Allow location access, or click the map."))
    );
  }

  const btn = (active: boolean) => ({ padding: '0.4rem 0.8rem', borderRadius: 999, border: '1px solid ' + (active ? '#0b5d3b' : '#d5ddd7'), background: active ? '#0b5d3b' : '#fff', color: active ? '#fff' : '#252a28', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' } as const);

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: hideSearch ? 'none' : 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder={tx("Search an address or a place")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
          style={{ flex: 1, minWidth: 220, padding: '0.55rem 0.7rem', border: '1px solid #d5ddd7', borderRadius: 10 }}
        />
        <button type="button" className="btn btn-primary" onClick={search} disabled={searching}>{searching ? tx("Searching…") : tx("Search")}</button>
        <button type="button" className="btn btn-secondary" onClick={useMyPosition}>{tx("Use my position")}</button>
      </div>
      {hits && hits.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid #e3e9e4', borderRadius: 10, maxHeight: 180, overflow: 'auto', background: '#fff' }}>
          {hits.map((h, i) => (
            <li key={i}><button type="button" onClick={() => choose(h)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.7rem', border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: '0.86rem' }}>{h.display_name}</button></li>
          ))}
        </ul>
      )}
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {!noArea && <button type="button" style={btn(mode === 'pin')} onClick={() => setMode('pin')}>{tx("1. Place the pin")}</button>}
        {!noArea && <button type="button" style={btn(mode === 'area')} onClick={() => setMode('area')}>{tx("2. Draw the area (optional)")}</button>}
        {value.polygon.length > 0 && <button type="button" className="fx2-btn" onClick={() => onChange({ ...value, polygon: value.polygon.slice(0, -1) })}>{tx("Undo last corner")}</button>}
        {value.polygon.length > 0 && <button type="button" className="fx2-btn danger" onClick={() => onChange({ ...value, polygon: [] })}>{tx("Clear the area")}</button>}
      </div>
      <div ref={holder} style={{ height: height ?? 360, borderRadius: 12, border: '1px solid #e3e9e4', background: '#eef2ee', cursor: mode === 'area' ? 'crosshair' : 'pointer', zIndex: 0 }} />
      <small style={{ color: '#5b6776' }}>
        {mode === 'pin'
          ? tx("Click the map to place the pin, or drag it. The address fills in by itself.")
          : value.polygon.length < 3
            ? `Click the map to add the corners of the venue area (${value.polygon.length} so far, at least 3).`
            : `Area drawn with ${value.polygon.length} corners. Members can only check in inside this area. Click again to add more corners.`}
        {value.polygon.length < 3 && mode === 'pin' && tx(" Without a drawn area, check-in works inside the radius around the pin.")}
      </small>
    </div>
  );
}


type PickerProps = { value: MapValue; onChange: (v: MapValue) => void; radius?: number; /** Hide the address search (the page has its own). */ hideSearch?: boolean; /** Pin only: no drawing of an area. */ noArea?: boolean; height?: number };

/** Google Maps version: address autocomplete, click or drag the pin, and a drawn area. */
function GooglePicker({ value, onChange, radius, hideSearch, noArea, height }: PickerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const st = useRef<{ g?: any; map?: any; marker?: any; poly?: any; circle?: any; geocoder?: any }>({});
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [mode, setMode] = useState<'pin' | 'area'>('pin');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [error, setError] = useState(mapsAuthError);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    const onAuth = () => setError(mapsAuthError);
    window.addEventListener('gmaps-auth-failed', onAuth);
    loadGoogleMaps().then((g) => {
      if (dead || !holder.current || st.current.map) return;
      const v = latest.current.value;
      const has = v.lat !== '' && v.lng !== '' && !Number.isNaN(Number(v.lat));
      const map = new g.maps.Map(holder.current, { center: has ? { lat: Number(v.lat), lng: Number(v.lng) } : { lat: 30.7333, lng: 76.7794 }, zoom: has ? 17 : 5, streetViewControl: false, mapTypeControl: true });
      const geocoder = new g.maps.Geocoder();
      st.current = { g, map, geocoder };
      map.addListener('click', (e: any) => {
        const cur = latest.current;
        const p = { lat: Number(e.latLng.lat().toFixed(6)), lng: Number(e.latLng.lng().toFixed(6)) };
        if (modeRef.current === 'area') { cur.onChange({ ...cur.value, polygon: [...cur.value.polygon, p] }); return; }
        const next = { ...cur.value, lat: String(p.lat), lng: String(p.lng) };
        cur.onChange(next);
        geocoder.geocode({ location: p }, (res: any, status: string) => {
          if (status === 'OK' && res?.[0]) latest.current.onChange({ ...latest.current.value, lat: next.lat, lng: next.lng, address: res[0].formatted_address });
        });
      });
      if (searchRef.current) {
        const ac = new g.maps.places.Autocomplete(searchRef.current, { fields: ['formatted_address', 'geometry', 'name'] });
        ac.addListener('place_changed', () => {
          const pl = ac.getPlace();
          const loc = pl?.geometry?.location;
          if (!loc) return;
          const cur = latest.current;
          cur.onChange({ ...cur.value, lat: loc.lat().toFixed(6), lng: loc.lng().toFixed(6), address: pl.formatted_address || pl.name || cur.value.address });
          if (pl.geometry.viewport) map.fitBounds(pl.geometry.viewport); else { map.setCenter(loc); map.setZoom(17); }
        });
      }
      setReady(true);
    }).catch((e) => setError(e instanceof Error ? e.message : tx("Google Maps could not be loaded.")));
    return () => { dead = true; window.removeEventListener('gmaps-auth-failed', onAuth); };
  }, []);

  useEffect(() => {
    const { g, map } = st.current;
    if (!ready || !g || !map) return;
    const has = value.lat !== '' && value.lng !== '' && !Number.isNaN(Number(value.lat)) && !Number.isNaN(Number(value.lng));
    if (has) {
      const pos = { lat: Number(value.lat), lng: Number(value.lng) };
      if (!st.current.marker) {
        const m = new g.maps.Marker({ map, position: pos, draggable: true });
        m.addListener('dragend', () => {
          const p = m.getPosition();
          latest.current.onChange({ ...latest.current.value, lat: p.lat().toFixed(6), lng: p.lng().toFixed(6) });
        });
        st.current.marker = m;
      } else st.current.marker.setPosition(pos);
      if (!map.getBounds()?.contains(pos)) { map.setCenter(pos); map.setZoom(Math.max(map.getZoom() ?? 5, 15)); }
    } else if (st.current.marker) { st.current.marker.setMap(null); st.current.marker = undefined; }

    st.current.circle?.setMap(null); st.current.circle = undefined;
    if (has && value.polygon.length < 3 && radius && radius > 0) {
      st.current.circle = new g.maps.Circle({ map, center: { lat: Number(value.lat), lng: Number(value.lng) }, radius, strokeColor: '#0b5d3b', fillColor: '#0b5d3b', fillOpacity: 0.12, clickable: false });
    }
    st.current.poly?.setMap(null); st.current.poly = undefined;
    if (value.polygon.length > 0) {
      st.current.poly = value.polygon.length >= 3
        ? new g.maps.Polygon({ map, paths: value.polygon, strokeColor: '#c9610b', strokeWeight: 3, fillColor: '#c9610b', fillOpacity: 0.2, clickable: false })
        : new g.maps.Polyline({ map, path: value.polygon, strokeColor: '#c9610b', strokeWeight: 3, clickable: false });
    }
  }, [value, radius, ready]);

  function useMyPosition() {
    navigator.geolocation?.getCurrentPosition(
      (p) => { onChange({ ...value, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); st.current.map?.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }); st.current.map?.setZoom(17); },
      () => setError(tx("Your position could not be read. Allow location access, or click the map."))
    );
  }
  const btn = (active: boolean) => ({ padding: '0.4rem 0.8rem', borderRadius: 999, border: '1px solid ' + (active ? '#0b5d3b' : '#d5ddd7'), background: active ? '#0b5d3b' : '#fff', color: active ? '#fff' : '#252a28', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' } as const);

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: hideSearch ? 'none' : 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input ref={searchRef} type="search" placeholder={tx("Start typing an address or a place, then pick it")} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} style={{ flex: 1, minWidth: 220, padding: '0.55rem 0.7rem', border: '1px solid #d5ddd7', borderRadius: 10 }} />
        <button type="button" className="btn btn-secondary" onClick={useMyPosition}>{tx("Use my position")}</button>
      </div>
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {!noArea && <button type="button" style={btn(mode === 'pin')} onClick={() => setMode('pin')}>{tx("1. Place the pin")}</button>}
        {!noArea && <button type="button" style={btn(mode === 'area')} onClick={() => setMode('area')}>{tx("2. Draw the area (optional)")}</button>}
        {value.polygon.length > 0 && <button type="button" className="fx2-btn" onClick={() => onChange({ ...value, polygon: value.polygon.slice(0, -1) })}>{tx("Undo last corner")}</button>}
        {value.polygon.length > 0 && <button type="button" className="fx2-btn danger" onClick={() => onChange({ ...value, polygon: [] })}>{tx("Clear the area")}</button>}
      </div>
      <div ref={holder} style={{ height: height ?? 360, borderRadius: 12, border: '1px solid #e3e9e4', background: '#eef2ee', cursor: mode === 'area' ? 'crosshair' : 'pointer' }} />
      <small style={{ color: '#5b6776' }}>
        {mode === 'pin'
          ? tx("Click the map to place the pin, or drag it. The address fills in by itself.")
          : value.polygon.length < 3
            ? `Click the map to add the corners of the venue area (${value.polygon.length} so far, at least 3).`
            : `Area drawn with ${value.polygon.length} corners. Members can only check in inside this area. Click again to add more corners.`}
        {value.polygon.length < 3 && mode === 'pin' && tx(" Without a drawn area, check-in works inside the radius around the pin.")}
      </small>
    </div>
  );
}

/** Venue picker: Google Maps when a key is set on the Integrations page, otherwise OpenStreetMap. */
export default function MapPicker(props: PickerProps) {
  const key = useMapsKey();
  if (key === undefined) return <p style={{ color: '#5b6776' }}>{tx("Loading the map…")}</p>;
  if (key) return <GooglePicker {...props} />;
  return (
    <div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#8a5a00', background: '#fff7e0', borderRadius: 8, padding: '0.4rem 0.6rem' }}>
        {tx("Using the free OpenStreetMap map.")} {mapsKeyProblem || tx("Add a Google Maps key on the Integrations page to use Google Maps.")}
      </p>
      <LeafletPicker {...props} />
    </div>
  );
}

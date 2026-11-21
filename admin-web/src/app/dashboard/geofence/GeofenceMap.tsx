'use client';

import { useEffect, useRef, useState } from 'react';
import GoogleMapView from './GoogleMapView';
import { useMapsKey } from '@/lib/googleMaps';
import { tx } from '@/lib/i18n/tr';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';

export interface Pt { lat: number; lng: number }
export interface FenceShape { id?: string; name?: string; shape: 'circle' | 'polygon'; center?: Pt; radiusMeters?: number; polygon?: Pt[]; active?: boolean }

let loader: Promise<any> | null = null;
/** Loads Leaflet once, from a public CDN (no extra npm package to install). */
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = LEAFLET_JS;
      js.onload = () => resolve((window as any).L);
      js.onerror = () => { loader = null; reject(new Error('The map could not be loaded. Check the internet connection.')); };
      document.head.appendChild(js);
    });
  }
  return loader;
}

/**
 * `edit` = one shape being drawn: click sets a circle's center, or adds a polygon point.
 * `fences` = every saved geofence drawn read-only.
 */
function LeafletMap({ edit, fences = [], onEdit, height = 360, focusKey }: { edit?: FenceShape; fences?: FenceShape[]; onEdit?: (next: FenceShape) => void; height?: number; focusKey?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const fitted = useRef(false);
  const lastFocus = useRef(focusKey);
  const editRef = useRef(edit);
  const onEditRef = useRef(onEdit);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  editRef.current = edit;
  onEditRef.current = onEdit;

  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || map.current) return;
      const m = L.map(el.current, { center: [14.7, -17.4], zoom: 5 });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      m.on('click', (ev: any) => {
        const cur = editRef.current;
        if (!cur || !onEditRef.current) return;
        const p = { lat: Number(ev.latlng.lat.toFixed(6)), lng: Number(ev.latlng.lng.toFixed(6)) };
        onEditRef.current(cur.shape === 'circle' ? { ...cur, center: p } : { ...cur, polygon: [...(cur.polygon ?? []), p] });
      });
      map.current = m;
      setReady(true);
    }).catch((e) => setError(e.message));
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !layer.current) return;
    layer.current.clearLayers();
    const bounds: any[] = [];
    const ebounds: any[] = [];
    const draw = (f: FenceShape, color: string, dashed: boolean) => {
      const style = { color, weight: 2, fillOpacity: 0.15, dashArray: dashed ? '6 4' : undefined };
      if (f.shape === 'circle' && f.center && f.radiusMeters) {
        const c = L.circle([f.center.lat, f.center.lng], { ...style, radius: f.radiusMeters }).addTo(layer.current);
        bounds.push(c.getBounds());
        if (dashed) ebounds.push(c.getBounds());
        if (f.name) c.bindTooltip(f.name);
      } else if (f.shape === 'polygon' && f.polygon?.length) {
        const pts = f.polygon.map((p) => [p.lat, p.lng]);
        const g = (pts.length >= 3 ? L.polygon(pts, style) : L.polyline(pts, style)).addTo(layer.current);
        f.polygon.forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 4, color }).addTo(layer.current));
        bounds.push(g.getBounds());
        if (dashed) ebounds.push(g.getBounds());
        if (f.name) g.bindTooltip(f.name);
      }
    };
    fences.forEach((f) => draw(f, f.active === false ? '#8a949e' : '#1f6fb5', false));
    if (edit) draw(edit, '#c9702b', true);
    if (!edit) fitted.current = false;
    const refocus = focusKey !== lastFocus.current;
    lastFocus.current = focusKey;
    if (bounds.length && map.current && (!(edit && fitted.current) || refocus)) {
      fitted.current = true;
      const use = refocus && ebounds.length ? ebounds : bounds;
      let b = use[0];
      use.slice(1).forEach((x) => (b = b.extend(x)));
      map.current.fitBounds(b, { maxZoom: 17, padding: [20, 20] });
    }
  }, [ready, edit, fences, focusKey]);

  return (
    <div>
      {error && <p className="error-text">{error}</p>}
      <div ref={el} className="fx2-map" style={{ height }} />
    </div>
  );
}

/** Google Maps when a key is set on the Integrations page, otherwise the free OpenStreetMap view. */
export default function GeofenceMap(props: { edit?: FenceShape; fences?: FenceShape[]; onEdit?: (next: FenceShape) => void; height?: number; focusKey?: number }) {
  const key = useMapsKey();
  if (key === undefined) return <p style={{ color: '#5b6776' }}>{tx("Loading the map…")}</p>;
  return key ? <GoogleMapView {...props} /> : <LeafletMap {...props} />;
}

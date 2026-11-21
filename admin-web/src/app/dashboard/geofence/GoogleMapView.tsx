'use client';

import { useEffect, useRef, useState } from 'react';
import type { FenceShape } from './GeofenceMap';
import { loadGoogleMaps, mapsAuthError } from '@/lib/googleMaps';

/* eslint-disable @typescript-eslint/no-explicit-any */
const loadGoogle = loadGoogleMaps;

/** Same behaviour as the OpenStreetMap view: click to set a circle's center or add polygon corners; saved shapes are drawn read-only. */
export default function GoogleMapView({ edit, fences = [], onEdit, height = 360, focusKey }: { edit?: FenceShape; fences?: FenceShape[]; onEdit?: (next: FenceShape) => void; height?: number; focusKey?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const fitted = useRef(false);
  const lastFocus = useRef(focusKey);
  const editRef = useRef(edit);
  const onEditRef = useRef(onEdit);
  const [error, setError] = useState(mapsAuthError);
  const [ready, setReady] = useState(false);
  editRef.current = edit;
  onEditRef.current = onEdit;

  useEffect(() => {
    let dead = false;
    const onAuth = () => setError(mapsAuthError);
    window.addEventListener('gmaps-auth-failed', onAuth);
    loadGoogle().then((g) => {
      if (dead || !el.current || map.current) return;
      const m = new g.maps.Map(el.current, { center: { lat: 14.7, lng: -17.4 }, zoom: 5, streetViewControl: false, fullscreenControl: true });
      m.addListener('click', (ev: any) => {
        const cur = editRef.current;
        if (!cur || !onEditRef.current || !ev.latLng) return;
        const p = { lat: Number(ev.latLng.lat().toFixed(6)), lng: Number(ev.latLng.lng().toFixed(6)) };
        onEditRef.current(cur.shape === 'circle' ? { ...cur, center: p } : { ...cur, polygon: [...(cur.polygon ?? []), p] });
      });
      map.current = m;
      setReady(true);
    }).catch((e) => setError(e.message));
    return () => { dead = true; window.removeEventListener('gmaps-auth-failed', onAuth); };
  }, []);

  useEffect(() => {
    const g = (window as any).google;
    if (!ready || !g?.maps || !map.current) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const bounds = new g.maps.LatLngBounds();
    const ebounds = new g.maps.LatLngBounds();
    let editAny = false;
    let any = false;
    const draw = (f: FenceShape, color: string, editing: boolean) => {
      const opts = { map: map.current, strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: 0.15, clickable: !!f.name, zIndex: editing ? 2 : 1 };
      let o: any = null;
      if (f.shape === 'circle' && f.center && f.radiusMeters) {
        o = new g.maps.Circle({ ...opts, center: f.center, radius: f.radiusMeters });
        bounds.union(o.getBounds());
        if (editing) { ebounds.union(o.getBounds()); editAny = true; }
      } else if (f.shape === 'polygon' && f.polygon?.length) {
        o = f.polygon.length >= 3 ? new g.maps.Polygon({ ...opts, paths: f.polygon }) : new g.maps.Polyline({ map: map.current, path: f.polygon, strokeColor: color });
        f.polygon.forEach((p) => {
          bounds.extend(p);
          if (editing) { ebounds.extend(p); editAny = true; }
          overlays.current.push(new g.maps.Marker({ map: map.current, position: p, clickable: false, icon: { path: g.maps.SymbolPath.CIRCLE, scale: 4, fillColor: color, fillOpacity: 1, strokeColor: color } }));
        });
      }
      if (o) {
        any = true;
        overlays.current.push(o);
        if (f.name) {
          const info = new g.maps.InfoWindow({ content: f.name.replace(/[<>&]/g, '') });
          o.addListener?.('click', (ev: any) => { if (!editRef.current) { info.setPosition(ev.latLng); info.open(map.current); } });
        }
      }
    };
    fences.forEach((f) => draw(f, f.active === false ? '#8a949e' : '#1f6fb5', false));
    if (edit) draw(edit, '#c9702b', true);
    if (!edit) fitted.current = false;
    const refocus = focusKey !== lastFocus.current;
    lastFocus.current = focusKey;
    if (any && (!(edit && fitted.current) || refocus)) {
      fitted.current = true;
      map.current.fitBounds(refocus && editAny ? ebounds : bounds, 40);
      g.maps.event.addListenerOnce(map.current, 'idle', () => map.current.getZoom() > 17 && map.current.setZoom(17));
    }
  }, [ready, edit, fences, focusKey]);

  return (
    <div>
      {error && <p className="error-text">{error}</p>}
      <div ref={el} className="fx2-map" style={{ height }} />
    </div>
  );
}

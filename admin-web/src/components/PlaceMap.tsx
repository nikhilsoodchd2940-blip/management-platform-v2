'use client';

import { useEffect, useRef, useState } from 'react';
import { tx } from '@/lib/i18n/tr';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';

export interface MapShape { id: string; name: string; color: string; shape: 'circle' | 'polygon'; center?: { lat: number; lng: number }; radiusMeters?: number; polygon?: { lat: number; lng: number }[]; active?: boolean }
export interface MapPoint { id: string; name: string; color: string; lat: number; lng: number; /** The zone this point belongs to, so picking a zone can zoom to its points. */ group?: string }

let loader: Promise<any> | null = null;
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

/** A read-only map (OpenStreetMap, no key needed): coloured areas and/or labelled markers, with one of them highlighted. */
export default function PlaceMap({ shapes = [], points = [], selectedId = '', onPick, height = 340 }: { shapes?: MapShape[]; points?: MapPoint[]; selectedId?: string; onPick?: (id: string) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || map.current) return;
      const m = L.map(el.current, { center: [14.7, -17.4], zoom: 4, scrollWheelZoom: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    }).catch((e) => setError(e.message));
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; } };
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !layer.current || !map.current) return;
    layer.current.clearLayers();
    const all: any[] = [];
    const chosen: any[] = [];
    let chosenShape = false;
    shapes.forEach((f) => {
      const sel = f.id === selectedId;
      const dim = !!selectedId && !sel;
      const style = { color: f.active === false ? '#8a949e' : sel ? '#e3bf50' : f.color, weight: sel ? 4 : 2, opacity: dim ? 0.45 : 1, fillOpacity: sel ? 0.35 : dim ? 0.06 : 0.16 };
      let g: any = null;
      if (f.shape === 'circle' && f.center && f.radiusMeters) g = L.circle([f.center.lat, f.center.lng], { ...style, radius: f.radiusMeters });
      else if (f.shape === 'polygon' && f.polygon && f.polygon.length >= 3) g = L.polygon(f.polygon.map((p) => [p.lat, p.lng]), style);
      if (!g) return;
      g.addTo(layer.current).bindTooltip(f.name, { sticky: true });
      g.on('click', () => pick.current?.(f.id));
      all.push(g.getBounds());
      if (sel) { chosen.push(g.getBounds()); chosenShape = true; g.bringToFront(); }
      // A pin at the centre, so even a 500 m zone is visible when the whole world is in view.
      const c = g.getBounds().getCenter();
      const pin = L.marker(c, { icon: L.divIcon({ className: 'zp-pinwrap', html: `<i class="zp-pin${sel ? ' sel' : ''}${dim ? ' dim' : ''}"></i>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: sel ? 1000 : 0 }).addTo(layer.current);
      pin.bindTooltip(f.name, { direction: 'top', offset: [0, -12] });
      pin.on('click', () => pick.current?.(f.id));
    });
    points.forEach((p) => {
      const sel = !!selectedId && p.group === selectedId;
      const dim = !!selectedId && !sel;
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'zp-pinwrap', html: `<i class="zp-pin${sel ? ' sel' : ''}${dim ? ' dim' : ''}"></i>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: sel ? 1000 : 0 }).addTo(layer.current);
      m.bindTooltip(p.name, { direction: 'top', offset: [0, -12] });
      m.on('click', () => p.group && pick.current?.(p.group));
      const b = L.latLngBounds([p.lat, p.lng], [p.lat, p.lng]);
      all.push(b);
      if (sel) chosen.push(b);
    });
    const use = chosen.length ? chosen : all;
    if (use.length) {
      let b = use[0];
      use.slice(1).forEach((x) => (b = b.extend(x)));
      map.current.fitBounds(b, { maxZoom: chosen.length ? (chosenShape ? 16 : 11) : 6, padding: [30, 30], animate: true });
    }
  }, [ready, shapes, points, selectedId]);

  return (
    <div>
      {error && <p className="error-text">{error}</p>}
      <div ref={el} className="zp-leaf" style={{ height }} aria-label={tx("Map")} />
    </div>
  );
}

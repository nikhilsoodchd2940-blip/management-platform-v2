'use client';

import { useState } from 'react';
import GeofenceMap, { type FenceShape } from '@/app/dashboard/geofence/GeofenceMap';
import PlaceSearch from './PlaceSearch';
import type { PlaceHit } from '@/lib/googleMaps';
import { tx } from '@/lib/i18n/tr';

export interface BoundaryDraft extends FenceShape { name: string; radiusMeters: number; cityId?: string }

const step = { fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#5b6776', margin: '0.9rem 0 0.4rem' } as const;

/** Corners of a circle of the given radius around a point (36 points). */
function ring(c: { lat: number; lng: number }, r: number) {
  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * 2 * Math.PI;
    out.push({
      lat: +(c.lat + (r * Math.cos(a)) / 111320).toFixed(6),
      lng: +(c.lng + (r * Math.sin(a)) / (111320 * Math.cos((c.lat * Math.PI) / 180))).toFixed(6),
    });
  }
  return out;
}

/**
 * Name + boundary drawn on the map. Search a place, set a radius and the area is drawn around it
 * (as a circle, or as a polygon you can still adjust); or click the map to place points yourself.
 * Pass `cities` to also ask which city the boundary belongs to.
 */
export default function BoundaryDialog({ title, initial, others, cities, cityName, onSave, onClose }: { title: string; cityName?: string; initial: BoundaryDraft; others: FenceShape[]; cities?: { id: string; name: string }[]; onSave: (d: BoundaryDraft) => Promise<unknown>; onClose: () => void }) {
  const [draft, setDraft] = useState<BoundaryDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState('');
  const [focus, setFocus] = useState(0);

  const withRadius = (d: BoundaryDraft, radius: number): BoundaryDraft =>
    d.shape === 'polygon' && d.center ? { ...d, radiusMeters: radius, polygon: ring(d.center, radius) } : { ...d, radiusMeters: radius };

  function pickPlace(r: PlaceHit) {
    setError('');
    setFound(r.address);
    setDraft((d) => withRadius({ ...d, center: { lat: r.lat, lng: r.lng } }, d.radiusMeters || 500));
    setFocus((n) => n + 1);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  }

  const summary = draft.shape === 'circle'
    ? (draft.center ? `Circle of ${draft.radiusMeters} m around ${draft.center.lat.toFixed(4)}, ${draft.center.lng.toFixed(4)}` : 'No centre yet')
    : `${draft.polygon?.length ?? 0} corner(s)${(draft.polygon?.length ?? 0) < 3 ? ', at least 3 needed' : ''}`;

  return (
    <div className="fx-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: 780, width: '95vw' }}>
        <h2>{title}</h2>

        <p style={{ ...step, marginTop: 0 }}>{tx("1 · Details")}</p>
        <div className="fx-fields">
          <label className="fx-field"><span>{tx("Name *")}</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          {cities && (
            <label className="fx-field"><span>{tx("City *")}</span>
              <select value={draft.cityId ?? ''} onChange={(e) => setDraft({ ...draft, cityId: e.target.value })}>
                <option value="">{tx("Choose a city…")}</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>

        <p style={step}>{tx("2 · Find the place")}</p>
        <div className="fx-fields">
          <div className="fx-field full"><span>{tx("Search a place")}</span>
            <PlaceSearch near={cities?.find((c) => c.id === draft.cityId)?.name.split(' · ')[0] ?? cityName} onPick={pickPlace} />
          </div>
        </div>
        {found && <p className="fx-intro" style={{ marginTop: '0.4rem' }}>{tx("Selected:")} {found}</p>}

        <p style={step}>{tx("3 · Shape and size")}</p>
        <div className="fx-fields">
          <label className="fx-field"><span>{tx("Shape")}</span>
            <select value={draft.shape} onChange={(e) => {
              const shape = e.target.value as 'circle' | 'polygon';
              setDraft(withRadius({ ...draft, shape, polygon: shape === 'polygon' ? draft.polygon : draft.polygon }, draft.radiusMeters));
            }}>
              <option value="circle">{tx("Circle around a point")}</option>
              <option value="polygon">{tx("Polygon (adjustable corners)")}</option>
            </select>
          </label>
          <label className="fx-field"><span>{tx("Radius (meters)")}</span><input type="number" min={10} max={100000} value={draft.radiusMeters} onChange={(e) => setDraft(withRadius(draft, Number(e.target.value)))} /></label>
        </div>
        <p className="fx-intro" style={{ marginTop: '0.4rem' }}>
          {draft.shape === 'circle'
            ? tx("Search a place, or click the map, to set the centre. Anything within the radius counts as inside.")
            : tx("Search a place and the polygon is drawn around it from the radius. You can also click the map to add each corner yourself, in order.")}
        </p>

        <GeofenceMap edit={draft} fences={others} onEdit={(n) => setDraft({ ...draft, ...n })} height={320} focusKey={focus} />
        <p style={{ fontSize: '0.82rem', margin: '0.5rem 0' }}>
          <strong>{summary}</strong>{' '}
          {draft.shape === 'polygon' && (
            <>
              <button type="button" className="fx2-btn" onClick={() => setDraft({ ...draft, polygon: (draft.polygon ?? []).slice(0, -1) })}>{tx("Undo last")}</button>{' '}
              <button type="button" className="fx2-btn" onClick={() => setDraft({ ...draft, polygon: [] })}>{tx("Clear")}</button>
            </>
          )}
        </p>
        {error && <div className="fx-error" role="alert">{error}</div>}
        <div className="fx-actions">
          <button type="button" className="fx-btn" onClick={onClose}>{tx("Cancel")}</button>
          <button type="button" className="fx-btn fx-primary" disabled={busy} onClick={save}>{busy ? tx("Saving…") : tx("Save")}</button>
        </div>
      </div>
    </div>
  );
}

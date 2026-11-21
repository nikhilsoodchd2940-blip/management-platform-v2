'use client';

import { useMemo, useRef, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { saveGeofence, setGeofenceActive, deleteGeofence } from '@/lib/functions';
import BoundaryDialog, { type BoundaryDraft } from '@/components/BoundaryDialog';
import { notify } from '@/lib/notify';
import type { FenceShape } from './GeofenceMap';
import { type MapShape } from '@/components/PlaceMap';
import Dropdown from '@/components/Dropdown';
import { Kpis, Panel, Clear } from '@/components/kit';
import LocMap from '@/components/LocMap';
import { CountryName } from '@/components/CountryFlag';
import { centerQuery } from '@/lib/geoCenter';
import { zoneStyle, hashIx, ZONE_PAL } from '@/lib/zoneColor';
import { tx } from '@/lib/i18n/tr';

interface Fence extends FenceShape { localZoneId?: string; name: string; countryId: string; zoneId?: string; cityId: string; active: boolean }

/** Boundaries used to check members in at a place. Drawn on a map as a circle or a polygon. */
export default function GeofencePage() {
  const { byId, cities, countries } = useGroupHierarchy();
  const { allows } = useMyScope();
  const fences = useCollection<Fence>('geofences', [orderBy('name')]);
  const zones = useZones();
  const localZones = useCollection<{ cityId: string }>('localZones', []);
  const [dialog, setDialog] = useState<null | { fence?: Fence }>(null);
  const [search, setSearch] = useState('');
  const [countryId, setCountryId] = useState('');
  const [cityId, setCityId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [help, setHelp] = useState(true);
  const [sel, setSel] = useState('');
  const [limit, setLimit] = useState(24);
  const mapRef = useRef<HTMLDivElement>(null);

  // A boundary of a local zone that no longer exists, or of a city that is gone, is left over data: never listed.
  const visible = useMemo(() => (fences ?? []).filter((f) => allows(f) && (!f.localZoneId || (localZones ?? []).some((z) => z.id === f.localZoneId)) && !!byId[f.cityId]), [fences, allows, localZones, byId]);
  const cityOptions = cities.filter((c) => allows({ cityId: c.id, countryId: c.parentGroupId, zoneId: c.zoneId }));
  const countryOptions = countries.filter((c) => cityOptions.some((x) => x.parentGroupId === c.id));
  const term = search.trim().toLowerCase();
  const shown = visible.filter((f) =>
    (!countryId || f.countryId === countryId) && (!cityId || f.cityId === cityId) &&
    (!kind || (kind === 'local' ? !!f.localZoneId : !f.localZoneId)) &&
    (!status || (status === 'active') === f.active) &&
    (!term || f.name.toLowerCase().includes(term) || (byId[f.cityId]?.name ?? '').toLowerCase().includes(term)));
  const filtering = !!(countryId || cityId || kind || status || term);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); notify(ok, 'success'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
  }

  const draftOf = (f?: Fence): BoundaryDraft => ({ name: f?.name ?? '', cityId: f?.cityId ?? cityId, shape: f?.shape ?? 'circle', center: f?.center, radiusMeters: f?.radiusMeters ?? 150, polygon: f?.polygon ?? [] });

  const shapes: MapShape[] = useMemo(() => shown.map((f) => ({ id: f.id, name: f.name, color: ZONE_PAL[hashIx(f.id)][0], shape: f.shape, center: f.center, radiusMeters: f.radiusMeters, polygon: f.polygon, active: f.active })), [shown]);
  const selFence = visible.find((f) => f.id === sel);
  const pick = (id: string) => { const f = visible.find((x) => x.id === id); if (f) setCountryId(f.countryId); setSel((c) => (c === id ? '' : id)); mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  const shapeText = (f: Fence) => (f.shape === 'circle' ? `${f.radiusMeters} m` : `${f.polygon?.length ?? 0} pts`);
  const clear = () => { setSearch(''); setCountryId(''); setCityId(''); setKind(''); setStatus(''); };
  const steps: [string, string, string][] = [[tx("1 · Draw"), '', tx("Search a place and set a radius, or click the map to draw a circle or polygon around it.")], [tx("2 · Check in"), '', tx("When a member scans in at an event, the app sends the phone's position to the server.")], [tx("3 · Verify"), '', tx("The server checks the position is inside the area (the polygon if the event has one, otherwise the radius). Outside means no attendance.")], [tx("Local zones"), '', tx("Each local zone has its own area, shown here and managed on the Local zones page.")]];

  return (
    <div className="zp">
      <LocMap
        mapRef={mapRef}
        eyebrow={tx("Check-in areas")}
        title={tx("Geofence")}
        actions={<button className="loc-btn solid" onClick={() => setDialog({})}>{tx("+ New geofence")}</button>}
        countries={countryOptions}
        weight={(id) => visible.filter((f) => f.countryId === id).length}
        countryId={countryId}
        onCountry={(id) => { setCountryId(id); setCityId(''); if (!id) setSel(''); }}
        itemLabel={tx("Choose a geofence")}
        itemAll={`${tx("All geofences")} · ${shown.length}`}
        itemOptions={shown.slice(0, 300).map((f) => ({ value: f.id, label: `${f.name} · ${byId[f.cityId]?.name ?? ''}` }))}
        itemId={sel}
        onItem={(id) => { setSel(id); const f = visible.find((x) => x.id === id); if (f) setCountryId(f.countryId); }}
        mapQuery={selFence ? centerQuery(selFence) ?? `${byId[selFence.cityId]?.name ?? ''}, ${byId[selFence.countryId]?.name ?? ''}` : undefined}
        mapTitle={selFence ? `${selFence.name} · ${byId[selFence.cityId]?.name ?? ''}` : undefined}
        list={countryId ? shown.map((f) => ({ id: f.id, name: f.name, sub: byId[f.cityId]?.name ?? '' })) : undefined}
        overview={<>
              <div className="lm-place"><span>{tx("Geofences")}</span><b>{shown.length}</b><small>{shapes.length} {tx("boundaries drawn")}</small></div>
        </>}
        side={selFence ? <>
              <>
                <div className="lm-place">
                  <span>{selFence.localZoneId ? tx("Local zone") : tx("Geofence")}</span>
                  <b>{selFence.name}</b>
                  <small>{byId[selFence.cityId]?.name ?? '—'} · {byId[selFence.countryId]?.name ?? '—'} · {selFence.active ? tx("Active") : tx("Inactive")}</small>
                </div>
                <div className="zp-facts">
                  <div><b>{shapeText(selFence)}</b><span>{selFence.shape === 'circle' ? tx("Circle") : tx("Polygon")}</span></div>
                  <div><b>{selFence.zoneId ? (zones ?? []).find((z) => z.id === selFence.zoneId)?.name ?? '—' : '—'}</b><span>{tx("Zone")}</span></div>
                </div>
                {!selFence.localZoneId && <div className="lm-acts"><button type="button" className="lm-open" onClick={() => setDialog({ fence: selFence })}>{tx("Edit")}</button></div>}
              </>
        </> : undefined}
      />


      <Kpis items={[
        { icon: '◎', label: tx("Geofences"), value: visible.length, active: !filtering, onClick: clear },
        { icon: '✓', label: tx("Active"), value: visible.filter((f) => f.active).length, gold: true, active: status === 'active', onClick: () => setStatus(status === 'active' ? '' : 'active') },
        { icon: '⏸', label: tx("Inactive"), value: visible.filter((f) => !f.active).length, red: true, active: status === 'inactive', onClick: () => setStatus(status === 'inactive' ? '' : 'inactive') },
        { icon: '📍', label: tx("Local zones"), value: visible.filter((f) => f.localZoneId).length, gold: true, active: kind === 'local', onClick: () => setKind(kind === 'local' ? '' : 'local') },
      ]} />

      <div className="loc-bar kt-bar">
        <input type="search" placeholder={tx("Search by name or city")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Dropdown label={tx("Country")} value={countryId} onChange={(v) => { setCountryId(v); setCityId(''); }} allLabel={`${tx("All countries")} · ${countryOptions.length}`} options={countryOptions.map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("City")} value={cityId} onChange={setCityId} allLabel={tx("All cities")} options={cityOptions.filter((c) => !countryId || c.parentGroupId === countryId).map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("Type")} value={kind} onChange={setKind} allLabel={tx("All types")} options={[{ value: 'own', label: tx("Geofences") }, { value: 'local', label: tx("Local zones") }]} className="loc-dd" />
        <Dropdown label={tx("Status")} value={status} onChange={setStatus} allLabel={tx("Any status")} options={[{ value: 'active', label: tx("Active") }, { value: 'inactive', label: tx("Inactive") }]} className="loc-dd" />
        {filtering && <Clear onClick={clear} />}
      </div>

      

      <Panel title={tx("How a geofence works")} tone={0} actions={<button type="button" className="loc-btn small" onClick={() => setHelp((v) => !v)}>{help ? tx("Hide") : tx("Show")}</button>}>
        {help && (
          <div className="gf-steps">
            {steps.map(([t, , p], i) => <div key={t} style={zoneStyle(i === 3 ? 1 : 0)}><b>{t}</b><p>{p}</p></div>)}
          </div>
        )}
      </Panel>

      <div className="zp-title"><h2>{tx("Areas")} <em>{filtering ? `${shown.length} / ${visible.length}` : visible.length}</em></h2></div>
      {fences === null ? <p>{tx("Loading…")}</p> : shown.length === 0 ? <section className="zp-card"><p className="fx2-empty">{visible.length === 0 ? tx("No geofence yet. Create the first one.") : tx("No geofence matches these filters.")}</p></section> : (
        <div className="zp-grid">
          {shown.slice(0, limit).map((f) => (
            <article className={`zp-card${f.active ? '' : ' off'}${sel === f.id ? ' sel' : ''}`} key={f.id} style={zoneStyle(hashIx(f.id))} onClick={() => pick(f.id)}>
              <header>
                <div className="loc-badge">{f.name.trim().slice(0, 2).toUpperCase()}</div>
                <div className="zp-name"><h3>{f.name}</h3><small>{byId[f.cityId]?.name ?? '—'} · <CountryName name={byId[f.countryId]?.name} size={14} /></small></div>
                <span className={`zp-pill${f.active ? ' ok' : ''}`}>{f.active ? tx("Active") : tx("Inactive")}</span>
              </header>
              <div className="loc-blocks">
                <div className="gold"><b>{shapeText(f)}</b><span>{f.shape === 'circle' ? tx("Circle") : tx("Polygon")}</span></div>
                <div className="wide"><b>{f.localZoneId ? tx("Local zone") : tx("Geofence")}</b><span>{tx("Type")}</span></div>
              </div>
              <footer className="four" onClick={(e) => e.stopPropagation()}>
                {f.localZoneId ? (
                  <a className="loc-btn small" href="/dashboard/local-zones">{tx("Managed in Local zones")}</a>
                ) : (
                  <>
                    <button className="loc-btn small" onClick={() => setDialog({ fence: f })}>{tx("Edit")}</button>
                    <button className="loc-btn small" onClick={() => run(() => setGeofenceActive({ geofenceId: f.id, active: !f.active }), f.active ? 'Geofence deactivated' : 'Geofence activated')}>{f.active ? tx("Deactivate") : tx("Activate")}</button>
                    <button className="loc-btn small danger" style={{ gridColumn: '1/-1' }} onClick={() => confirm(`Delete "${f.name}"?`) && run(() => deleteGeofence({ geofenceId: f.id }), 'Geofence deleted')}>{tx("Delete")}</button>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
      {shown.length > limit && <button type="button" className="loc-btn zp-more" onClick={() => setLimit((n) => n + 24)}>{tx("Show more")} · {shown.length - limit}</button>}

      {dialog && (
        <BoundaryDialog
          title={dialog.fence ? tx("Edit geofence") : tx("New geofence")}
          initial={draftOf(dialog.fence)}
          cities={cityOptions.map((c) => ({ id: c.id, name: `${c.name} · ${byId[c.parentGroupId ?? '']?.name ?? ''}` }))}
          others={visible.filter((f) => f.id !== dialog.fence?.id)}
          onClose={() => setDialog(null)}
          onSave={async (d) => {
            if (!d.cityId) throw new Error('Choose the city');
            if (!d.name.trim()) throw new Error('Give the geofence a name');
            await saveGeofence({
              geofenceId: dialog.fence?.id, name: d.name, cityId: d.cityId, shape: d.shape,
              ...(d.shape === 'circle' ? { center: d.center, radiusMeters: d.radiusMeters } : { polygon: d.polygon }),
            });
            notify('Geofence saved', 'success');
          }}
        />
      )}
    </div>
  );
}

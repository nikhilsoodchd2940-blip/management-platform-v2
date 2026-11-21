'use client';

import { useMemo, useRef, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { saveLocalZone, setLocalZoneActive, deleteLocalZone, setGroupLocalZone } from '@/lib/functions';
import BoundaryDialog, { type BoundaryDraft } from '@/components/BoundaryDialog';
import Dropdown from '@/components/Dropdown';
import type { FenceShape } from '../geofence/GeofenceMap';
import { type MapShape } from '@/components/PlaceMap';
import LocMap from '@/components/LocMap';
import { CountryName } from '@/components/CountryFlag';
import { centerQuery } from '@/lib/geoCenter';
import { zonePal, zoneStyle } from '@/lib/zoneColor';
import Link from 'next/link';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { ACCESS_ROLE_LABEL } from '@/components/AccessDialog';
import { useUserProfiles } from '@/lib/useUserNames';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

interface ScopeDoc { role: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[] }
interface LocalZone { name: string; cityId: string; countryId?: string; geofenceId: string; active: boolean }
interface Fence extends FenceShape { name: string; localZoneId?: string }

/** Areas inside a city. Each has a boundary drawn on the map, and the city's kurels are placed in them. */
export default function LocalZonesPage() {
  const { byId, cities, countries, groups, allGroups } = useGroupHierarchy();
  const { allows } = useMyScope();
  const [countryId, setCountryId] = useState('');
  const [cityId, setCityId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState('');
  const [limit, setLimit] = useState(24);
  const mapRef = useRef<HTMLDivElement>(null);
  const zones = useCollection<LocalZone>('localZones', [orderBy('name')]);
  const fences = useCollection<Fence>('geofences', [orderBy('name')]);
  const scopes = useCollection<ScopeDoc>('adminScopes', []);
  const [dialog, setDialog] = useState<null | { zone?: LocalZone & { id: string } }>(null);

  const cityOptions = useMemo(() => cities.filter((c) => allows({ cityId: c.id, countryId: c.parentGroupId, zoneId: c.zoneId })), [cities, allows]);
  const filteredCities = cityOptions.filter((c) => !countryId || c.parentGroupId === countryId);
  const countryOptions = countries.filter((c) => cityOptions.some((x) => x.parentGroupId === c.id));
  const countryOf = (z: LocalZone) => byId[z.cityId]?.parentGroupId ?? '';

  const kurelsIn = (zoneId: string) => groups.filter((g) => g.type === 'group' && g.status === 'active' && g.localZoneId === zoneId).length;
  const fenceOf = (z: LocalZone) => (fences ?? []).find((f) => f.id === z.geofenceId);

  const allowed = useMemo(() => (zones ?? []).filter((z) => cityOptions.some((c) => c.id === z.cityId)), [zones, cityOptions]);
  const term = search.trim().toLowerCase();
  const shown = allowed.filter((z) =>
    (!countryId || countryOf(z) === countryId) && (!cityId || z.cityId === cityId) &&
    (!status || (status === 'active') === z.active) &&
    (!term || z.name.toLowerCase().includes(term) || (byId[z.cityId]?.name ?? '').toLowerCase().includes(term)));
  const colorIx = (id: string) => Math.max(0, allowed.findIndex((z) => z.id === id));
  const shapes: MapShape[] = useMemo(() => shown.flatMap((z) => { const f = fenceOf(z); return f ? [{ id: z.id, name: z.name, color: zonePal(colorIx(z.id))[0], shape: f.shape, center: f.center, radiusMeters: f.radiusMeters, polygon: f.polygon, active: z.active }] : []; }), [shown, fences, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  const selZone = allowed.find((z) => z.id === sel);
  const selFence = selZone ? fenceOf(selZone) : undefined;
  const managers = useMemo(() => {
    if (!selZone) return [] as { userId: string; label: string; city: boolean }[];
    const city = byId[selZone.cityId];
    const country = city?.parentGroupId ?? '';
    const out: { userId: string; label: string; city: boolean }[] = [];
    (scopes ?? []).forEach((sc) => {
      if (sc.role === 'super_admin') return;
      const userId = (sc as unknown as { id: string }).id;
      if (sc.cityIds?.includes(selZone.cityId)) out.push({ userId, label: `${tx(ACCESS_ROLE_LABEL[sc.role] ?? sc.role)} · ${city?.name ?? ''}`, city: true });
      else if (sc.countryIds?.includes(country) || (city?.zoneId && sc.zoneIds?.includes(city.zoneId))) out.push({ userId, label: sc.role === 'zone_admin' ? tx("Zone manager") : tx(ACCESS_ROLE_LABEL[sc.role] ?? sc.role), city: false });
    });
    return out.sort((a, b) => Number(b.city) - Number(a.city));
  }, [selZone, scopes, byId]);
  const profiles = useUserProfiles(managers.map((m) => m.userId));
  const pick = (id: string) => { const z = allowed.find((x) => x.id === id); if (z) setCountryId(countryOf(z)); setSel((cur) => (cur === id ? '' : id)); mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  const kurels = cityId ? groups.filter((g) => g.type === 'group' && g.status === 'active' && g.parentGroupId === cityId) : [];
  const cityZones = allowed.filter((z) => z.cityId === cityId);
  const filtering = !!(countryId || cityId || status || term);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); notify(ok, 'success'); } catch (e) { notify(e instanceof Error ? e.message : 'Action failed', 'error'); }
  }

  function remove(z: LocalZone & { id: string }) {
    const n = kurelsIn(z.id);
    const msg = n ? `"${z.name}" has ${n} group(s). They will be removed from this zone (they are not deleted). Delete the zone?` : `Delete "${z.name}"?`;
    if (!confirm(msg)) return;
    run(async () => {
      try {
        await deleteLocalZone({ localZoneId: z.id, releaseGroups: true });
      } catch (e) {
        // Server not updated yet: release the groups from here (archived ones too), then delete.
        if (!(e instanceof Error) || !/Move the groups out/.test(e.message)) throw e;
        for (const g of allGroups.filter((x) => x.localZoneId === z.id)) await setGroupLocalZone({ groupId: g.id, localZoneId: '' });
        await deleteLocalZone({ localZoneId: z.id });
      }
    }, 'Zone deleted');
  }

  const initialDraft = (z?: LocalZone & { id: string }): BoundaryDraft => {
    const f = z ? fenceOf(z) : undefined;
    return { name: z?.name ?? '', cityId: z?.cityId ?? cityId, shape: f?.shape ?? 'polygon', center: f?.center, radiusMeters: f?.radiusMeters ?? 500, polygon: f?.polygon ?? [] };
  };

  return (
    <div className="zp">
      <LocMap
        mapRef={mapRef}
        eyebrow={tx("Inside a city")}
        title={tx("Local zones")}
        actions={<button className="loc-btn solid" onClick={() => setDialog({})}>{tx("+ New local zone")}</button>}
        countries={countryOptions}
        weight={(id) => allowed.filter((z) => countryOf(z) === id).length}
        countryId={countryId}
        onCountry={(id) => { setCountryId(id); setCityId(''); if (!id) setSel(''); }}
        itemLabel={tx("Choose a local zone")}
        itemAll={`${tx("All zones")} · ${shown.length}`}
        itemOptions={shown.slice(0, 300).map((z) => ({ value: z.id, label: `${z.name} · ${byId[z.cityId]?.name ?? ''}` }))}
        itemId={sel}
        onItem={(id) => { setSel(id); const z = allowed.find((x) => x.id === id); if (z) setCountryId(countryOf(z)); }}
        mapQuery={selZone ? centerQuery(selFence) ?? `${byId[selZone.cityId]?.name ?? ''}, ${byId[countryOf(selZone)]?.name ?? ''}` : undefined}
        mapTitle={selZone ? `${selZone.name} · ${byId[selZone.cityId]?.name ?? ''}` : undefined}
        list={countryId ? shown.map((z) => ({ id: z.id, name: z.name, sub: byId[z.cityId]?.name ?? '' })) : undefined}
        overview={<>
              <div className="lm-place"><span>{tx("Zones")}</span><b>{shown.length}</b><small>{shapes.length} {tx("boundaries drawn")}</small></div>
        </>}
        side={selZone ? <>
              <>
                <div className="lm-place">
                  <span>{tx("Local zone")}</span>
                  <b>{selZone.name}</b>
                  <small>{byId[selZone.cityId]?.name ?? '—'} · {byId[countryOf(selZone)]?.name ?? '—'} · {selZone.active ? tx("Active") : tx("Inactive")}</small>
                </div>
                <div className="zp-facts">
                  <div><b>{kurelsIn(selZone.id)}</b><span>{tx("Groups")}</span></div>
                  <div><b>{selFence ? (selFence.shape === 'circle' ? `${selFence.radiusMeters} m` : `${selFence.polygon?.length ?? 0} pts`) : '—'}</b><span>{selFence ? (selFence.shape === 'circle' ? tx("Circle") : tx("Polygon")) : tx("No boundary drawn yet.")}</span></div>
                </div>
                <div className="lm-resp">
                  <span className="lm-cap">{tx("Responsible")}</span>
                  {managers.length === 0 && <p>{tx("No manager assigned yet.")} <Link href="/dashboard/role-access">{tx("Assign one")}</Link></p>}
                  {managers.map((r, i) => (
                  <div className="lm-person" key={`${r.userId}${i}`}>
                    <Avatar name={profiles[r.userId]?.name || '…'} photoUrl={profiles[r.userId]?.photoUrl} size={38} />
                    <span><PersonLink userId={r.userId}><b>{profiles[r.userId]?.name || tx("Loading…")}</b></PersonLink><small>{r.label}</small>{profiles[r.userId]?.phone && <a href={`tel:${profiles[r.userId].phone}`}>{profiles[r.userId].phone}</a>}</span>
                  </div>
                ))}
                </div>
                <div className="lm-acts"><button type="button" className="lm-open" onClick={() => setDialog({ zone: selZone })}>{tx("Edit boundary")}</button></div>
              </>
        </> : undefined}
      />

      <div className="loc-kpis zp-kpis">
        <div><i>📍</i><span>{tx("Local zones")}</span><strong>{allowed.length}</strong></div>
        <div className="gold"><i>✓</i><span>{tx("Active")}</span><strong>{allowed.filter((z) => z.active).length}</strong></div>
        <div><i>⏸</i><span>{tx("Inactive")}</span><strong>{allowed.filter((z) => !z.active).length}</strong></div>
        <div className="gold"><i>👥</i><span>{tx("Groups placed")}</span><strong>{allowed.reduce((n, z) => n + kurelsIn(z.id), 0)}</strong></div>
      </div>

      <div className="loc-bar">
        <input type="search" placeholder={tx("Search by zone or city")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Dropdown label={tx("Country")} value={countryId} onChange={(v) => { setCountryId(v); setCityId(''); }} allLabel={`${tx("All countries")} · ${countryOptions.length}`} options={countryOptions.map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("City")} value={cityId} onChange={setCityId} allLabel={`${tx("All cities")} · ${filteredCities.length}`} options={filteredCities.map((c) => ({ value: c.id, label: countryId ? c.name : `${c.name} · ${byId[c.parentGroupId ?? '']?.name ?? ''}` }))} className="loc-dd" />
        <Dropdown label={tx("Status")} value={status} onChange={setStatus} allLabel={tx("Any status")} options={[{ value: 'active', label: tx("Active") }, { value: 'inactive', label: tx("Inactive") }]} className="loc-dd" />
        {filtering && <button type="button" className="loc-btn ghost" onClick={() => { setCountryId(''); setCityId(''); setStatus(''); setSearch(''); }}>{tx("Clear filters")}</button>}
      </div>

      

      <div className="zp-title"><h2>{tx("Zones")} <em>{filtering ? `${shown.length} / ${allowed.length}` : allowed.length}</em></h2></div>
      {zones === null ? <p>{tx("Loading…")}</p> : shown.length === 0 ? <section className="zp-card"><p className="fx2-empty">{allowed.length === 0 ? tx("No local zone yet. Create the first one.") : tx("No local zone matches these filters.")}</p></section> : (
        <div className="zp-grid">
          {shown.slice(0, limit).map((z) => {
            const f = fenceOf(z);
            return (
              <article className={`zp-card${z.active ? '' : ' off'}${sel === z.id ? ' sel' : ''}`} key={z.id} style={zoneStyle(colorIx(z.id))} onClick={() => pick(z.id)}>
                <header>
                  <div className="loc-badge">{z.name.trim().slice(0, 2).toUpperCase()}</div>
                  <div className="zp-name">
                    <h3>{z.name}</h3>
                    <small>{byId[z.cityId]?.name ?? '—'} · <CountryName name={byId[countryOf(z)]?.name} size={14} /></small>
                  </div>
                  <span className={`zp-pill${z.active ? ' ok' : ''}`}>{z.active ? tx("Active") : tx("Inactive")}</span>
                </header>
                <div className="loc-blocks">
                  <div className="gold"><b>{kurelsIn(z.id)}</b><span>{tx("Groups")}</span></div>
                  <div className="wide"><b>{f ? (f.shape === 'circle' ? `${f.radiusMeters} m` : `${f.polygon?.length ?? 0} pts`) : '—'}</b><span>{f ? (f.shape === 'circle' ? tx("Circle") : tx("Polygon")) : tx("Boundary")}</span></div>
                </div>
                <footer className="four" onClick={(e) => e.stopPropagation()}>
                  <button className="loc-btn small" onClick={() => pick(z.id)}>{sel === z.id ? tx("Hide") : tx("📍 Show on map")}</button>
                  <button className="loc-btn small" onClick={() => setDialog({ zone: z })}>{tx("Edit boundary")}</button>
                  <button className="loc-btn small" onClick={() => run(() => setLocalZoneActive({ localZoneId: z.id, active: !z.active }), z.active ? 'Zone deactivated' : 'Zone activated')}>{z.active ? tx("Deactivate") : tx("Activate")}</button>
                  <button className="loc-btn small danger" onClick={() => remove(z)}>{tx("Delete")}</button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {shown.length > limit && <button type="button" className="loc-btn zp-more" onClick={() => setLimit((n) => n + 24)}>{tx("Show more")} · {shown.length - limit}</button>}

      {cityId && (
        <>
          <div className="zp-title zp-title2"><div><h2>{tx("Groups of")} {byId[cityId]?.name} <em>{kurels.length}</em></h2></div></div>
          {kurels.length === 0 ? <section className="zp-card"><p className="fx2-empty">{tx("This city has no group yet.")}</p></section> : (
            <div className="zp-cities">
              {kurels.map((g) => (
                <article className="zp-city" key={g.id}>
                  <header><strong>{g.name}</strong><span>{byId[cityId]?.name}</span></header>
                  <div className="zp-dds one">
                    <Dropdown label={tx("Local zone")} value={g.localZoneId ?? ''} onChange={(v) => run(() => setGroupLocalZone({ groupId: g.id, localZoneId: v }), 'Group updated')} allLabel={tx("No local zone")} options={cityZones.map((z) => ({ value: z.id, label: z.name }))} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {dialog && (
        <BoundaryDialog
          title={dialog.zone ? `Edit ${dialog.zone.name}` : tx("New local zone")}
          initial={initialDraft(dialog.zone)}
          cityName={byId[dialog.zone?.cityId ?? cityId]?.name}
          cities={dialog.zone ? undefined : cityOptions.map((c) => ({ id: c.id, name: `${c.name} · ${byId[c.parentGroupId ?? '']?.name ?? ''}` }))}
          others={(fences ?? []).filter((f) => f.localZoneId && f.localZoneId !== dialog.zone?.id)}
          onClose={() => setDialog(null)}
          onSave={async (d) => {
            const target = dialog.zone?.cityId ?? d.cityId;
            if (!target) throw new Error('Choose the city');
            if (!d.name.trim()) throw new Error('Give the zone a name');
            await saveLocalZone({
              localZoneId: dialog.zone?.id, cityId: target, name: d.name, shape: d.shape,
              ...(d.shape === 'circle' ? { center: d.center, radiusMeters: d.radiusMeters } : { polygon: d.polygon }),
            });
            notify('Local zone saved', 'success');
          }}
        />
      )}
    </div>
  );
}

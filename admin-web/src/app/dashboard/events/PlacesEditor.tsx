'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { setEventSites } from '@/lib/functions';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { notify } from '@/lib/notify';
import MapPicker, { type MapValue } from '@/components/MapPicker';
import { tx } from '@/lib/i18n/tr';

interface Place { id: string; name: string; address: string; lat: string; lng: string; groupIds: string[]; keep: Record<string, unknown> }

/**
 * The places of an event and which groups perform at each one. Shows the places that exist, lets you add or
 * remove places, move the pin of each, and tap the groups that perform there (a group performs at one place).
 */
export default function PlacesEditor({ eventId, groupIds }: { eventId: string; groupIds: string[] }) {
  const { byId } = useGroupHierarchy();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usedBy, setUsedBy] = useState<Set<string>>(new Set());
  const [home, setHome] = useState<{ lat: string; lng: string; address: string }>({ lat: '', lng: '', address: '' });

  useEffect(() => {
    getDoc(doc(db, 'events', eventId)).then((s) => {
      const d = (s.data() ?? {}) as { sites?: Record<string, unknown>[]; shifts?: { siteId?: string; siteIds?: string[] }[]; location?: { lat?: number; lng?: number; address?: string } };
      const list: Place[] = (d.sites ?? []).map((x) => ({ id: String(x.id), name: String(x.name ?? ''), address: String(x.address ?? ''), lat: x.lat === undefined ? '' : String(x.lat), lng: x.lng === undefined ? '' : String(x.lng), groupIds: ((x.groupIds as string[]) ?? []).map(String), keep: x }));
      setHome({ lat: String(d.location?.lat ?? ''), lng: String(d.location?.lng ?? ''), address: d.location?.address ?? '' });
      setUsedBy(new Set((d.shifts ?? []).flatMap((sh) => (sh.siteIds?.length ? sh.siteIds : sh.siteId ? [sh.siteId] : []))));
      setPlaces(list);
      setSel(list[0]?.id ?? '');
    });
  }, [eventId]);

  const nameOf = (g: string) => byId[g]?.name ?? 'Group';
  const cityOf = (g: string) => byId[byId[g]?.parentGroupId ?? '']?.name ?? '';
  const placeOf = (g: string) => places?.find((p) => p.groupIds.includes(g));
  const edit = (fn: (p: Place[]) => Place[]) => { setDirty(true); setPlaces((p) => fn(p ?? [])); };
  const cur = places?.find((p) => p.id === sel);
  const unplaced = useMemo(() => groupIds.filter((g) => !placeOf(g)), [groupIds, places]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!places) return <p className="fx3-note">{tx("Loading the places…")}</p>;

  const setGroup = (g: string, to: string | null) => edit((all) => all.map((p) => ({ ...p, groupIds: p.id === to ? [...new Set([...p.groupIds, g])] : p.groupIds.filter((x) => x !== g) })));
  const addPlace = () => {
    let n = places.length + 1;
    while (places.some((p) => p.id === `site${n}`)) n++;
    const id = `site${n}`;
    edit((all) => [...all, { id, name: `Place ${all.length + 1}`, address: home.address, lat: home.lat, lng: home.lng, groupIds: [], keep: {} }]);
    setSel(id);
  };
  const removePlace = (p: Place) => {
    if (usedBy.has(p.id)) return notify('Supervision shifts use this place. Change those shifts in the Supervisors tab first.', 'error');
    if (!confirm(`Remove "${p.name}"? Its ${p.groupIds.length} group${p.groupIds.length === 1 ? '' : 's'} will have no place until you choose one.`)) return;
    edit((all) => all.filter((x) => x.id !== p.id));
    setSel(places.find((x) => x.id !== p.id)?.id ?? '');
  };
  const matchByCity = () => {
    const rest = unplaced;
    if (!rest.length || places.length === 0) return;
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    let hit = 0;
    edit((all) => {
      const next = all.map((p) => ({ ...p, groupIds: [...p.groupIds] }));
      rest.forEach((g) => {
        const city = norm(cityOf(g));
        if (!city) return;
        const p = next.find((x) => norm(x.name).includes(city) || city.includes(norm(x.name)) || (x.address && norm(x.address).includes(city)));
        if (p) { p.groupIds.push(g); hit++; }
      });
      return next;
    });
    notify(hit ? `${hit} group${hit === 1 ? '' : 's'} placed by city` : 'No group matched a place name. Choose them by hand.', hit ? 'success' : 'info');
  };

  async function save() {
    if (places!.some((p) => !p.name.trim())) return notify('Every place needs a name.', 'error');
    if (places!.length > 1 && unplaced.length > 0 && !confirm(`${unplaced.length} group${unplaced.length === 1 ? ' is' : 's are'} not at any place. They will not show on any place of the live board. Save anyway?`)) return;
    setBusy(true);
    try {
      await setEventSites({
        eventId,
        sites: places!.map((p) => ({ ...p.keep, id: p.id, name: p.name.trim(), address: p.address || undefined, lat: p.lat === '' ? undefined : Number(p.lat), lng: p.lng === '' ? undefined : Number(p.lng), groupIds: p.groupIds.filter((g) => groupIds.includes(g)) })) as never,
      });
      notify('Places saved', 'success');
      setDirty(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save the places', 'error');
    } finally {
      setBusy(false);
    }
  }

  const term = q.trim().toLowerCase();
  const shown = groupIds.map((g) => ({ g, n: nameOf(g), c: cityOf(g) })).filter((x) => !term || x.n.toLowerCase().includes(term) || x.c.toLowerCase().includes(term)).sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));

  return (
    <div className="pe">
      <div className="pe-top">
        <p>{places.length === 0 ? tx("No place yet.") : `${places.length} place${places.length === 1 ? '' : 's'}.`} {places.length > 1 ? (unplaced.length ? <b className="warn">{unplaced.length} {tx("of")} {groupIds.length} {tx("groups are not at a place.")}</b> : <b className="ok">{tx("All")} {groupIds.length} {tx("groups are placed.")}</b>) : tx("Add a second place if groups perform in different locations.")}</p>
        <div>
          {places.length > 1 && unplaced.length > 0 && <button type="button" className="btn btn-secondary" onClick={matchByCity}>{tx("Place groups by city")}</button>}
          <button type="button" className="btn btn-primary" onClick={addPlace}>{tx("+ Add a place")}</button>
        </div>
      </div>

      <div className="pe-body">
        <ul className="pe-list" aria-label={tx("Places of the event")}>
          {places.map((p, i) => (
            <li key={p.id}>
              <button type="button" className={p.id === sel ? 'on' : ''} onClick={() => setSel(p.id)}>
                <b className="pe-n">{i + 1}</b>
                <span><strong>{p.name || tx("Unnamed place")}</strong><small>{p.groupIds.filter((g) => groupIds.includes(g)).length} {tx("group")}{p.groupIds.length === 1 ? '' : 's'}{p.address ? ` · ${p.address}` : ''}</small></span>
              </button>
            </li>
          ))}
          {places.length === 0 && <li className="pe-none">{tx("Press “Add a place” to start.")}</li>}
        </ul>

        {cur ? (
          <div className="pe-pane">
            <div className="pe-fields">
              <label><span>{tx("Name of the place")}</span><input value={cur.name} onChange={(e) => edit((all) => all.map((p) => (p.id === cur.id ? { ...p, name: e.target.value } : p)))} /></label>
              <label><span>{tx("Address")}</span><input value={cur.address} onChange={(e) => edit((all) => all.map((p) => (p.id === cur.id ? { ...p, address: e.target.value } : p)))} /></label>
            </div>
            <details className="pe-map">
              <summary>{tx("Move the pin of this place on the map")}</summary>
              <MapPicker
                value={{ lat: cur.lat, lng: cur.lng, address: cur.address, polygon: [] } as MapValue}
                onChange={(v) => edit((all) => all.map((p) => (p.id === cur.id ? { ...p, lat: v.lat, lng: v.lng, address: v.address || p.address } : p)))}
                noArea
                height={260}
              />
            </details>

            <div className="pe-groups-h">
              <h4>{tx("Groups that perform at")} {cur.name || tx("this place")} <span className="gp-count">{cur.groupIds.filter((g) => groupIds.includes(g)).length}</span></h4>
              <input className="ee-search" placeholder={tx("Search a group or a city")} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="pe-quick">
                <button type="button" className="gp-btn" onClick={() => shown.forEach((x) => { if (!placeOf(x.g)) setGroup(x.g, cur.id); })}>{tx("Add the shown groups that have no place")}</button>
                <button type="button" className="gp-btn" onClick={() => shown.forEach((x) => { if (placeOf(x.g)?.id === cur.id) setGroup(x.g, null); })}>{tx("Clear the shown groups")}</button>
              </div>
            </div>
            <div className="pe-grid">
              {shown.length === 0 && <p className="fx3-note">{tx("No group matches.")}</p>}
              {shown.map(({ g, n, c }) => {
                const at = placeOf(g);
                const here = at?.id === cur.id;
                return (
                  <button type="button" key={g} className={`pe-g${here ? ' here' : at ? ' else' : ''}`} aria-pressed={here} onClick={() => setGroup(g, here ? null : cur.id)}>
                    <span className="gp-tick" aria-hidden="true">{here ? '✓' : ''}</span>
                    <span className="pe-gn"><b>{n}</b><small>{here ? c : at ? `At ${at.name} (tap to move here)` : c}</small></span>
                  </button>
                );
              })}
            </div>
            <div className="pe-foot"><button type="button" className="btn btn-secondary danger" onClick={() => removePlace(cur)}>{tx("Remove this place")}</button></div>
          </div>
        ) : <div className="pe-pane"><p className="fx3-note">{tx("Choose a place on the left, or add one.")}</p></div>}
      </div>

      <div className="pe-save">
        <span>{dirty ? tx("You have unsaved changes in the places.") : tx("The places are saved.")}</span>
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? tx("Saving…") : tx("Save the places")}</button>
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import { createGroup, setGroupLocalZone } from '@/lib/functions';
import { appointOffice, type OfficeInput } from '@/lib/office';
import { notify } from '@/lib/notify';
import Dropdown from '@/components/Dropdown';
import OfficeFields from '@/components/OfficeFields';
import { tx } from '@/lib/i18n/tr';

/** Compact "Create a kurel" form: place, level and name on four short rows, the team optional below. */
export default function CreateKurel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { countries, citiesOf, groupsOf } = useGroupHierarchy();
  const { levels } = useLevels();
  const [countryId, setCountryId] = useState('');
  const [cityId, setCityId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [office, setOffice] = useState<OfficeInput>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const zones = useCollection<{ name: string; active?: boolean }>('localZones', [where('cityId', '==', cityId || '__none__')], cityId);
  const cities = useMemo(() => citiesOf(countryId), [citiesOf, countryId]);
  const inCity = useMemo(() => (cityId ? groupsOf(cityId) : []), [groupsOf, cityId]);
  const needLevel = levels.length > 0;
  const ready = !!cityId && !!name.trim() && (!needLevel || !!levelId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await createGroup({ name: name.trim(), type: 'group', parentGroupId: cityId, ...(capacity.trim() ? { capacity: Number(capacity) } : {}), ...(levelId ? { levelId } : {}) });
      const id = r.data.groupId;
      if (zoneId && id) await setGroupLocalZone({ groupId: id, localZoneId: zoneId });
      if (id && Object.values(office).some(Boolean)) {
        try { await appointOffice(id, office); } catch (oe) { notify(`The kurel was created, but the team was not saved: ${oe instanceof Error ? oe.message : 'error'}`, 'error'); }
      }
      notify('Kurel created', 'success');
      onCreated(id);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : tx("Could not create the kurel"));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="fm ck" role="dialog" aria-modal="true" aria-label={tx("Create a kurel")} onSubmit={submit}>
        <header><div><h2>{tx("Create a kurel")}</h2><p>{tx("Choose where it is, its level and its name.")}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="fm-body">
          <section className="ck-sec">
            <h3>{tx("Where")}</h3>
            <div className="ck-3">
              <Dropdown label={tx("Country")} value={countryId} onChange={(v) => { setCountryId(v); setCityId(''); setZoneId(''); }} allLabel="Choose a country" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
              <Dropdown label={tx("City")} value={cityId} onChange={(v) => { setCityId(v); setZoneId(''); }} allLabel={countryId ? 'Choose a city' : 'Country first'} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
              <Dropdown label={tx("Local zone (optional)")} value={zoneId} onChange={setZoneId} allLabel="No local zone" options={(zones ?? []).filter((z) => z.active !== false).map((z) => ({ value: z.id, label: z.name }))} />
            </div>
          </section>
          <section className="ck-sec">
            <h3>{tx("The kurel")}</h3>
            <div className="ck-3 name">
              <label className="fm-f">{tx("Name")}<input required value={name} onChange={(e) => setName(e.target.value)} disabled={!cityId} /></label>
              <Dropdown label={needLevel ? tx("Academic level") : tx("Academic level (none created)")} value={levelId} onChange={setLevelId} allLabel="Choose a level" options={levels.map((l) => ({ value: l.id, label: l.name }))} />
              <label className="fm-f">{tx("Capacity")}<input type="number" min={1} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} disabled={!cityId} /></label>
            </div>
            {cityId && (
              <div className="ck-have"><b>{inCity.length}</b> {tx("kurel")}{inCity.length === 1 ? '' : 's'} {tx("already in this city")}{inCity.length > 0 && <>: {inCity.slice(0, 8).map((g) => <span key={g.id}>{g.name}</span>)}{inCity.length > 8 && <i>+{inCity.length - 8}</i>}</>}</div>
            )}
          </section>
          <OfficeFields value={office} onChange={setOffice} area={{ country: countryId, city: cityId, localZone: zoneId }} />
        </div>
        <footer>{err && <span className="fm-err">{err}</span>}<button type="button" className="fm-ghost" onClick={onClose}>{tx("Cancel")}</button><button type="submit" className="fm-go" disabled={busy || !ready}>{busy ? tx("Creating…") : tx("Create the kurel")}</button></footer>
      </form>
    </div>,
    document.body
  );
}

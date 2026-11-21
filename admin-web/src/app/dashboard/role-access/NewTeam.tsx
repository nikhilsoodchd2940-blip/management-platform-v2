'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveCommittee } from '@/lib/functions';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useZones } from '@/lib/useZones';
import { notify } from '@/lib/notify';
import { Chooser } from './Assign';
import { SECTIONS } from './roles';
import { tx } from '@/lib/i18n/tr';

type Level = 'organisation' | 'country' | 'zone' | 'city';
const LEVELS: { key: Level; title: string; what: string }[] = [
  { key: 'country', title: 'Country team', what: 'Leads one or more countries' },
  { key: 'zone', title: 'Zone team', what: 'Leads one or more zones' },
  { key: 'city', title: 'City team', what: 'Leads one or more cities' },
  { key: 'organisation', title: 'Organisation team', what: 'Leads the whole organisation' },
];
const TEAM_SECTIONS = SECTIONS.filter((s) => s.key !== 'integrations');

/** Creates an empty management team. People are given seats afterwards with “+ Assign”. */
export default function NewTeam({ onClose }: { onClose: () => void }) {
  const { countries, cities, byId } = useGroupHierarchy();
  const zones = useZones();
  const [level, setLevel] = useState<Level>('country');
  const [name, setName] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [perms, setPerms] = useState<string[]>(TEAM_SECTIONS.map((s) => s.key));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const items = useMemo(() => ({
    country: countries.map((c) => ({ id: c.id, name: c.name, sub: '' })),
    zone: (zones ?? []).map((z) => ({ id: z.id, name: z.name, sub: byId[z.countryId]?.name ?? '' })),
    city: cities.map((c) => ({ id: c.id, name: c.name, sub: byId[c.parentGroupId ?? '']?.name ?? '' })),
  }), [countries, zones, cities, byId]);

  const save = async () => {
    if (level !== 'organisation' && !name.trim()) { setErr(tx("Give the team a name.")); return; }
    if (level !== 'organisation' && areas.length === 0) { setErr(`Choose at least one ${level}.`); return; }
    setBusy(true); setErr('');
    try {
      await saveCommittee({ level, name: name.trim(), permissions: perms, areaIds: level === 'organisation' ? [] : areas });
      notify('Team created. Give it people with “+ Assign”.', 'success');
      onClose();
    } catch (e) { setErr((e as { message?: string }).message || tx("It could not be created.")); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ra-modal" role="dialog" aria-modal="true" aria-label={tx("New team")}>
        <header><div><h2>{tx("New management team")}</h2><p>{tx("Create the team, then give it a president, vice-president and other seats.")}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="ra-body">
          <section className="ra-step">
            <header><span>1</span><div><h3>{tx("Level")}</h3></div></header>
            <div className="ra-opts">
              {LEVELS.map((l) => <button type="button" key={l.key} className={`ra-opt g${level === l.key ? ' on' : ''}`} onClick={() => { setLevel(l.key); setAreas([]); }}><span className="ra-badge">{l.title[0]}</span><span><b>{l.title}</b><small>{l.what}</small></span></button>)}
            </div>
          </section>
          {level !== 'organisation' && (
            <section className="ra-step">
              <header><span>2</span><div><h3>{tx("Name and places")}</h3></div></header>
              <div className="ra-new"><label>{tx("Team name")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tx("For example: Senegal management team")} /></label></div>
              <div style={{ marginTop: 10 }}><Chooser title={level === 'country' ? tx("Countries") : level === 'zone' ? tx("Zones") : tx("Cities")} hint={tx("A place can belong to one team only.")} items={items[level]} value={areas} onChange={setAreas} /></div>
            </section>
          )}
          <section className="ra-step">
            <header><span>{level === 'organisation' ? 2 : 3}</span><div><h3>{tx("Sections the team can use")}</h3></div></header>
            <div className="ra-perms">
              {TEAM_SECTIONS.map((s) => (
                <button type="button" key={s.key} className={perms.includes(s.key) ? 'on' : ''} aria-pressed={perms.includes(s.key)} onClick={() => setPerms((p) => (p.includes(s.key) ? p.filter((x) => x !== s.key) : [...p, s.key]))}>
                  <i aria-hidden>{perms.includes(s.key) ? '✓' : ''}</i><span><b>{s.label}</b><small>{s.what}</small></span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <footer>{err ? <span className="ra-err">{err}</span> : <span className="ra-sum">{tx("Local city zone teams are created in Organization chart.")}</span>}<button type="button" className="ra-ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="ra-go" disabled={busy} onClick={save}>{busy ? tx("Creating…") : tx("Create the team")}</button></footer>
      </div>
    </div>,
    document.body
  );
}

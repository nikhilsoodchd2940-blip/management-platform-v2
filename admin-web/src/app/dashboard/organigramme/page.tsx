'use client';

import '../../px/index.css';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { fmt } from '@/lib/liveStats';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import FormDialog from '@/components/FormDialog';
import Dropdown, { nice } from '@/components/Dropdown';
import { updateGroup } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { useAuth } from '@/context/AuthContext';
import Committees from '../committees/Committees';
import { flagUrl } from '@/lib/flags';
import { tx } from '@/lib/i18n/tr';

/** Organization chart — the approved layout, built from the real Country → City → Kurel structure. */
const CITY_PAL = [['#3fae5a', '#0d5c3a'], ['#2ec4c4', '#0b6a78'], ['#3b9aea', '#0f4c9a'], ['#7fcf6a', '#2f8a3c'], ['#1e9d66', '#0a4a33'], ['#35b6a8', '#116d68'], ['#4aa8f0', '#1a5fb4'], ['#5fbf5f', '#1d7a3a']];
const cityVars = (id: string) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const [a, b] = CITY_PAL[h % CITY_PAL.length]; return { ['--zc' as string]: b, ['--g1' as string]: a, ['--gd' as string]: b } as React.CSSProperties; };
const LV_ICO = ['🌱', '📗', '🎓', '⭐', '🏅', '🏆', '👑', '💎'];
function Flag({ name, code, large }: { name: string; code: string; large?: boolean }) {
  const u = flagUrl(name, 80);
  return <span className={`o2-flag${large ? ' lg' : ''}${u ? ' img' : ''}`} style={u ? { backgroundImage: `url(${u})` } : undefined}>{u ? '' : code}</span>;
}

function OrganizationChart() {
  const { countries, cities, citiesOf, groupsOf, activeLeafGroups, mainGroups, locationOf } = useGroupHierarchy();
  const [picked, setPicked] = useState('');
  const [term, setTerm] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [fCountry, setFCountry] = useState('');
  const [fCity, setFCity] = useState('');
  const [fAll, setFAll] = useState(false);
  const router = useRouter();
  const [fFill, setFFill] = useState('');
  const [levelPop, setLevelPop] = useState('');
  const [popTerm, setPopTerm] = useState('');
  const [renaming, setRenaming] = useState(false);
  const org = mainGroups[0];
  const { byId: levelById, levels } = useLevels();
  const [counts, setCounts] = useState<Record<string, { members: number; hosts: number }>>({});

  useEffect(() => {
    return onSnapshot(query(collection(db, 'groupMemberships'), where('status', '==', 'active')), (snap) => {
      const next: Record<string, { members: number; hosts: number }> = {};
      snap.docs.forEach((d) => {
        const c = (next[d.data().groupId as string] ??= { members: 0, hosts: 0 });
        if (d.data().role === 'host') c.hosts++;
        else c.members++;
      });
      setCounts(next);
    });
  }, []);

  const people = (id: string) => (counts[id]?.members ?? 0) + (counts[id]?.hosts ?? 0);
  const totalMembers = useMemo(() => Object.values(counts).reduce((n, c) => n + c.members + c.hosts, 0), [counts]);
  const hue = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const code = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const lvName = (id?: string) => nice(levelById[id ?? '']?.name ?? 'No level');

  // One row per country, with what it holds.
  const countryRows = useMemo(() => countries.map((c) => {
    const cs = citiesOf(c.id);
    const ks = cs.flatMap((x) => groupsOf(x.id));
    return { c, cities: cs, kurels: ks.length, members: ks.reduce((n, k) => n + people(k.id), 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }).sort((a, b) => b.members - a.members || b.kurels - a.kurels || a.c.name.localeCompare(b.c.name)), [countries, citiesOf, groupsOf, counts]);
  const maxMembers = Math.max(1, ...countryRows.map((r) => r.members));
  const current = countryRows.find((r) => r.c.id === picked) ?? countryRows[0];

  const filtering = term.trim().length >= 2 || !!fLevel || !!fCountry || !!fCity || !!fFill || fAll;
  const found = useMemo(() => {
    if (!filtering) return null;
    const q = term.trim().toLowerCase();
    return countryRows
      .filter((r) => !fCountry || r.c.id === fCountry)
      .flatMap((r) => r.cities.filter((city) => !fCity || city.id === fCity).flatMap((city) => groupsOf(city.id)
        .filter((k) => (q.length < 2 || k.name.toLowerCase().includes(q) || city.name.toLowerCase().includes(q)))
        .filter((k) => !fLevel || (fLevel === 'none' ? !k.levelId || !levelById[k.levelId] : k.levelId === fLevel))
        .filter((k) => !fFill || (fFill === 'empty' ? people(k.id) === 0 : fFill === 'active' ? people(k.id) > 0 : k.capacity !== undefined && people(k.id) >= k.capacity * 0.9))
        .map((k) => ({ k, city: city.name, country: r.c.name }))))
      .sort((a, b) => people(b.k.id) - people(a.k.id) || a.k.name.localeCompare(b.k.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtering, term, fLevel, fCountry, fCity, fFill, fAll, countryRows, groupsOf, levelById, counts]);
  const cityChoices = countryRows.filter((r) => !fCountry || r.c.id === fCountry).flatMap((r) => r.cities);
  const reset = () => { setTerm(''); setFLevel(''); setFCountry(''); setFCity(''); setFFill(''); setFAll(false); };
  const goto = (sel: string) => window.setTimeout(() => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);

  // Spread the city cards over three columns so that every column is about as tall as the others.
  const balance = <T extends { ks: unknown[] }>(items: T[]) => {
    const cols: T[][] = [[], [], []];
    const h = [0, 0, 0];
    items.forEach((it) => { const i = h.indexOf(Math.min(...h)); cols[i].push(it); h[i] += it.ks.length + 1.5; });
    return cols.filter((c) => c.length > 0);
  };

  const kurelRow = (k: { id: string; name: string; levelId?: string; capacity?: number }, where?: string) => (
    <Link key={k.id} href={`/dashboard/groups?kurel=${k.id}`} className="og-k">
      <span className="og-ico" style={{ background: `linear-gradient(145deg,hsl(${hue(k.name)} 55% 38%),hsl(${(hue(k.name) + 30) % 360} 55% 48%))` }}>{code(k.name)}</span>
      <span className="og-kn"><b>{k.name}</b><small>{where ?? lvName(k.levelId)}</small></span>
      {where && <i className="og-lv">{lvName(k.levelId)}</i>}
      <em className="og-mem"><span>{people(k.id)}{k.capacity !== undefined ? <small>/{k.capacity}</small> : null}<small> {tx("members")}</small></span>{k.capacity ? <u><s style={{ width: `${Math.min(100, Math.round((people(k.id) / k.capacity) * 100))}%` }} /></u> : null}</em>
    </Link>
  );
  const kurelCard = (k: { id: string; name: string; levelId?: string; capacity?: number }, where?: string) => {
    const n = people(k.id); const pct = k.capacity ? Math.min(100, Math.round((n / k.capacity) * 100)) : 0;
    return (
      <Link key={k.id} href={`/dashboard/groups?kurel=${k.id}`} className="o2-k">
        <span className="o2-ico" style={{ background: `linear-gradient(145deg,hsl(${hue(k.name)} 60% 40%),hsl(${(hue(k.name) + 30) % 360} 60% 52%))` }}>{code(k.name)}</span>
        <span className="o2-kn"><b>{k.name}</b><small>{where ?? lvName(k.levelId)}</small></span>
        <span className="o2-km"><i className={k.capacity && pct >= 90 ? 'full' : ''}>{n}{k.capacity !== undefined ? <> /{k.capacity}</> : null} {tx("members")}</i>{k.capacity ? <u><s style={{ width: `${pct}%` }} /></u> : null}</span>
        <em aria-hidden>›</em>
      </Link>
    );
  };

  const noLevel = activeLeafGroups.filter((g) => !g.levelId || !levelById[g.levelId]);

  return (
    <div className="px px-index">
      <section className="view active" id="organisation">
        <div className="section-head">
          <div><h1>{tx("Organization")}</h1><p>{tx("How the organisation is built. Each kurel belongs to one city, and each city to one country.")}</p></div>
        </div>
        {org && (
          <div className="o2-top">
            <div className="o2-hero"><small>{tx("Main organisation")}</small><b>{org.name}</b><button type="button" onClick={() => setRenaming(true)}>✎ {tx("Edit the name")}</button></div>
            <div className="o2-tiles">
              <button type="button" className="t1" onClick={() => { reset(); goto('.og-work'); }}><span className="o2-ti">🌍</span><b>{fmt(countries.length)}</b><small>{tx("Countries")}</small><i>›</i></button>
              <button type="button" className="t2" onClick={() => { reset(); goto('.og-main'); }}><span className="o2-ti">🏙️</span><b>{fmt(cities.length)}</b><small>{tx("Cities")}</small><i>›</i></button>
              <button type="button" className="t3" onClick={() => { reset(); setFAll(true); goto('.og-main'); }}><span className="o2-ti">🕌</span><b>{fmt(activeLeafGroups.length)}</b><small>{tx("Kurels")}</small><i>›</i></button>
              <button type="button" className="t4" onClick={() => router.push('/dashboard/members')}><span className="o2-ti">👥</span><b>{fmt(totalMembers)}</b><small>{tx("Members")}</small><i>›</i></button>
            </div>
          </div>
        )}
        {renaming && org && (
          <FormDialog
            title={tx("Edit the organisation name")}
            intro="This is the name of the main organisation. It changes everywhere it is shown."
            submitLabel={tx("Save the name")}
            onClose={() => setRenaming(false)}
            fields={[{ name: 'name', label: tx("Organisation name"), required: true, initial: org.name }]}
            onSubmit={async (v) => { await updateGroup({ groupId: org.id, name: v.name.trim() }); notify('Organisation name saved', 'success'); setRenaming(false); }}
          />
        )}

        <div className="o2-levels">
          {levels.map((l, i) => {
            const ks = activeLeafGroups.filter((g) => g.levelId === l.id);
            return (
              <button type="button" key={l.id} className={ks.length === 0 ? 'zero' : ''} onClick={() => { setLevelPop(l.id); setPopTerm(''); }}>
                <span className="o2-lic">{LV_ICO[i] ?? "•"}</span><span className="o2-lt"><small>{nice(l.name)}</small><b>{ks.length}</b><span>{tx("kurel")}{ks.length === 1 ? '' : 's'} · {ks.reduce((n, g) => n + people(g.id), 0)} {tx("member")}{ks.reduce((n, g) => n + people(g.id), 0) === 1 ? '' : 's'}</span></span>
              </button>
            );
          })}
          {noLevel.length > 0 && <button type="button" className="warn" onClick={() => { setLevelPop('none'); setPopTerm(''); }}><span className="o2-lic">!</span><span className="o2-lt"><small>{tx("No level")}</small><b>{noLevel.length}</b><span>{tx("kurel")}{noLevel.length === 1 ? '' : 's'} {tx("to set")}</span></span></button>}
        </div>

        <div className="o2-filters">
          <label className="o2-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("A kurel or a city")} value={term} onChange={(e) => setTerm(e.target.value)} aria-label={tx("Search the structure")} /></label>
          <div className="o2-fr"><Dropdown label={tx("Level")} value={fLevel} onChange={setFLevel} allLabel="All levels" options={[...levels.map((l) => ({ value: l.id, label: l.name })), { value: 'none', label: tx("No level") }]} />
          <Dropdown label={tx("Country")} value={fCountry} onChange={(v) => { setFCountry(v); setFCity(''); }} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
          <Dropdown label={tx("City")} value={fCity} onChange={setFCity} allLabel="All cities" options={cityChoices.map((c) => ({ value: c.id, label: c.name }))} />
          <Dropdown label={tx("Size")} value={fFill} onChange={setFFill} allLabel="Any size" options={[{ value: 'active', label: tx("With members") }, { value: 'empty', label: tx("Without members") }, { value: 'near', label: tx("Nearly full or full") }]} />
          <button type="button" className="o2-reset" onClick={reset}>↺ {tx("Reset")}</button></div>
        </div>

        {levelPop && createPortal(
          (() => {
            const lv = levels.find((l) => l.id === levelPop);
            const list = activeLeafGroups.filter((g) => (levelPop === 'none' ? !g.levelId || !levelById[g.levelId] : g.levelId === levelPop)).filter((g) => !popTerm.trim() || g.name.toLowerCase().includes(popTerm.trim().toLowerCase())).sort((a, b) => people(b.id) - people(a.id) || a.name.localeCompare(b.name));
            return (
              <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && setLevelPop('')}>
                <div className="lvp" role="dialog" aria-modal="true" aria-label={tx("Kurels of this level")}>
                  <header><div><h3>{lv ? nice(lv.name) : tx("Kurels without a level")}</h3><p>{list.length} {tx("kurel")}{list.length === 1 ? '' : 's'} {tx("· choose one to open its details")}</p></div><button type="button" aria-label={tx("Close")} onClick={() => setLevelPop('')}>×</button></header>
                  <input type="search" autoFocus placeholder={tx("Search in this level")} value={popTerm} onChange={(e) => setPopTerm(e.target.value)} />
                  <div className="lvp-list">
                    {list.map((g) => { const loc = locationOf(g.id); return kurelRow(g, `${loc.city?.name ?? ''} · ${loc.country?.name ?? ''}`); })}
                    {list.length === 0 && <p className="og-none">{tx("No kurel in this level yet.")}</p>}
                  </div>
                </div>
              </div>
            );
          })(),
          document.body
        )}

        <div className="og-work">
          <aside className="card og-side o2-side">
            <div className="og-head"><h2>{tx("Countries")}</h2><span>{countries.length}</span></div>
            <div className="og-list">
              {countryRows.map((r) => (
                <button type="button" key={r.c.id} className={`og-c${current?.c.id === r.c.id && !found ? ' on' : ''}`} onClick={() => { setPicked(r.c.id); reset(); }}>
                  <Flag name={r.c.name} code={code(r.c.name)} /><span className="o2-cn"><b>{r.c.name}</b><span className="og-chips"><i>{r.cities.length} {r.cities.length === 1 ? tx("city") : tx("cities")}</i><i className="k">{r.kurels} {tx("kurel")}{r.kurels === 1 ? '' : 's'}</i></span></span>
                  <em>{fmt(r.members)}</em><span className="o2-chev">›</span>
                  <u><s style={{ width: `${Math.max(r.members ? 4 : 0, Math.round((r.members / maxMembers) * 100))}%` }} /></u>
                </button>
              ))}
              {countries.length === 0 && <p className="og-none">{tx("No country yet. Create countries, cities and kurels first.")}</p>}
            </div>
          </aside>

          <section className="card og-main o2-main">
            <div className="og-head o2-mh">
              {!found && current && <Flag name={current.c.name} code={code(current.c.name)} large />}<div className="o2-mt"><h2>{found ? tx("Kurels found") : current?.c.name ?? tx("Structure")}</h2>{found && <p>{found.length} {tx("kurel")}{found.length === 1 ? '' : 's'}</p>}</div>
              {!found && current && <div className="og-blocks o2-blocks"><button type="button" onClick={() => { goto('.og-cities'); }}><b>{current.cities.length}</b><span>{current.cities.length === 1 ? tx("city") : tx("cities")}</span></button><button type="button" className="gold" onClick={() => { setFCountry(current.c.id); goto('.og-main'); }}><b>{current.kurels}</b><span>{tx("Kurels")}</span></button><button type="button" onClick={() => router.push(`/dashboard/members?country=${current.c.id}`)}><b>{fmt(current.members)}</b><span>{tx("Members")}</span></button></div>}
            </div>
            {found ? (
              <div className="og-flat o2-flat">{found.map((f) => kurelCard(f.k, `${f.city} · ${f.country}`))}{found.length === 0 && <p className="og-none">{tx("Nothing matches.")}</p>}</div>
            ) : current && (() => {
              const withK = current.cities.map((city) => ({ city, ks: groupsOf(city.id) })).filter((x) => x.ks.length > 0).sort((a, b) => b.ks.reduce((n, k) => n + people(k.id), 0) - a.ks.reduce((n, k) => n + people(k.id), 0));
              const empty = current.cities.filter((city) => groupsOf(city.id).length === 0);
              return (
                <>
                  <div className="og-cities"><div className="og-masonry" style={{ gridTemplateColumns: `repeat(${Math.max(1, balance(withK).length)}, minmax(0, 1fr))` }}>
                    {balance(withK).map((col, ci) => <div className="og-mcol" key={ci}>{col.map(({ city, ks }) => (
                      <article className="og-city o2-city" key={city.id} style={cityVars(city.id)}>
                        <header><button type="button" className="og-ch" onClick={() => { setFCountry(current.c.id); setFCity(city.id); }} title={tx("Show only this city")}><b>{city.name}</b><u>{tx("Open")} ▾</u></button><span className="o2-cs">{ks.length} {tx("kurel")}{ks.length === 1 ? '' : 's'} • {ks.reduce((n, k) => n + people(k.id), 0)} {tx("members")}</span></header>
                        <div className="o2-ks">{ks.map((k) => kurelCard(k))}</div>
                      </article>
                    ))}</div>)}
                    {withK.length === 0 && <p className="og-none">{tx("No kurel in this country yet.")}</p>}
                  </div></div>
                  {empty.length > 0 && <div className="og-empty"><b>{tx("Cities without a kurel yet")}</b>{empty.map((c) => <i key={c.id}>{c.name}</i>)}</div>}
                </>
              );
            })()}
          </section>
        </div>
      </section>
    </div>
  );
}

/** The Organization section: the chart of countries, cities and kurels, and (for super admins) the management committees. */
export default function OrganigrammePage() {
  const { can } = useAuth();
  const allowed = can('superAdmin');
  const [tab, setTab] = useState<'chart' | 'committees'>('chart');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'committees') setTab('committees');
  }, []);
  const view = allowed ? tab : 'chart';
  return (
    <>
      {allowed && (
        <div style={{ padding: '18px 32px 0', maxWidth: 1600, margin: 'auto' }}>
          <div className="hb-seg org-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'chart'} className={view === 'chart' ? 'on' : ''} onClick={() => setTab('chart')}>{tx("Organization chart")}</button>
            <button type="button" role="tab" aria-selected={view === 'committees'} className={view === 'committees' ? 'on' : ''} onClick={() => setTab('committees')}>{tx("Management committees")}</button>
          </div>
        </div>
      )}
      {view === 'chart' ? <OrganizationChart /> : <Committees />}
    </>
  );
}

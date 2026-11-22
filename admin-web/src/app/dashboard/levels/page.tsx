'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Award, BookOpen, Check, ChevronLeft, ChevronRight, Eye, MoreHorizontal, ServerCog, Filter, Info, Layers, Pencil, Plus, Repeat2, Search, ShieldCheck, Trash2, Users, UserPlus, X } from 'lucide-react';
import { collection, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { createLevel, updateLevel, deleteLevel, rebuildLevelAccess, setGroupLevel } from '@/lib/functions';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useZones } from '@/lib/useZones';
import { useLevels, type Level } from '@/lib/useLevels';
import { notify } from '@/lib/notify';
import Dropdown from '@/components/Dropdown';
import { CountryName } from '@/components/CountryFlag';
import { CxBanner, CxCard, CxStats } from '@/components/Cx';
import { tx } from '@/lib/i18n/tr';
import Link from 'next/link';
import { academicYearLabel, academicYearOptions, currentAcademicStart } from '@/lib/academicYear';

/** How many library books point at each level (live). */
function useBookCounts() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [none, setNone] = useState(0);
  useEffect(() => onSnapshot(query(collection(db, 'qacaidEditions')), (snap) => {
    const m: Record<string, number> = {};
    let n = 0;
    snap.docs.forEach((d) => { const l = d.data().levelId as string | undefined; if (l) m[l] = (m[l] ?? 0) + 1; else n++; });
    setCounts(m); setNone(n);
  }), []);
  return { counts, none };
}

const PAGE = 5;

export default function LevelsPage() {
  const router = useRouter();
  const { levels, byId, loading } = useLevels();
  const { activeLeafGroups, locationOf, countries, cities } = useGroupHierarchy();
  const zones = useZones() ?? [];
  const zoneName = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z.name])), [zones]);
  const books = useBookCounts();

  const [sel, setSel] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [lvFilter, setLvFilter] = useState('');
  const [year, setYear] = useState(String(currentAcademicStart()));
  const [lvStatus, setLvStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<string[]>([]);
  const [modal, setModal] = useState<null | { mode: 'assign' | 'move' }>(null);
  const [target, setTarget] = useState('');
  const [pickIds, setPickIds] = useState<string[]>([]);
  const [mq, setMq] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Level | null>(null);
  const [name, setName] = useState('');
  const [rank, setRank] = useState('');
  const [description, setDescription] = useState('');
  const [maxBooks, setMaxBooks] = useState('');
  const [accessIds, setAccessIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => { if (!sel && levels[0]) setSel(levels[0].id); }, [levels, sel]);
  useEffect(() => { setPage(1); setChecked([]); }, [sel, country, city, zone, q]);

  const kurelCount = useMemo(() => {
    const m: Record<string, number> = {};
    let none = 0;
    activeLeafGroups.forEach((g) => { if (g.levelId) m[g.levelId] = (m[g.levelId] ?? 0) + 1; else none++; });
    return { m, none };
  }, [activeLeafGroups]);
  const total = activeLeafGroups.length;
  const assigned = total - kurelCount.none;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const booksLinked = Object.values(books.counts).reduce((a, b) => a + b, 0);
  const accessText = (l: Level) => (l.accessLevelIds.length === 0 ? tx("Own level only") : l.accessLevelIds.map((id) => byId[id]).filter(Boolean).sort((a, b) => a.rank - b.rank).map((x) => x.name).join(', '));

  const level = byId[sel];
  const levelRows = levels.filter((l) => (!lvFilter || l.id === lvFilter) && (!lvStatus || (lvStatus === 'filled' ? (kurelCount.m[l.id] ?? 0) > 0 : (kurelCount.m[l.id] ?? 0) === 0)));

  const inScope = (id: string) => {
    const loc = locationOf(id);
    const g = activeLeafGroups.find((x) => x.id === id);
    if (country && loc.country?.id !== country) return false;
    if (city && loc.city?.id !== city) return false;
    if (zone && g?.zoneId !== zone) return false;
    return true;
  };
  const kurels = useMemo(() => {
    const t = q.trim().toLowerCase();
    return activeLeafGroups
      .filter((g) => g.levelId === sel && inScope(g.id) && (!t || g.name.toLowerCase().includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeafGroups, sel, country, city, zone, q]);
  const pages = Math.max(1, Math.ceil(kurels.length / PAGE));
  const shown = kurels.slice((page - 1) * PAGE, page * PAGE);
  const unassigned = activeLeafGroups.filter((g) => !g.levelId);

  function startEdit(l: Level) {
    setEditing(l); setName(l.name); setRank(String(l.rank)); setDescription(l.description ?? '');
    setMaxBooks(l.maxBooks === null ? '' : String(l.maxBooks)); setAccessIds(l.accessLevelIds);
    window.setTimeout(() => document.getElementById('lv-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }
  function resetForm() { setEditing(null); setName(''); setRank(''); setDescription(''); setMaxBooks(''); setAccessIds([]); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: name.trim(), rank: Number(rank), description: description.trim(), maxBooks: maxBooks.trim() === '' ? null : Number(maxBooks), accessLevelIds: accessIds };
      if (editing) await updateLevel({ levelId: editing.id, ...payload }); else await createLevel(payload);
      notify('Level saved', 'success');
      resetForm();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not save the level', 'error'); } finally { setSaving(false); }
  }
  async function remove(l: Level) {
    if (!confirm(`Delete ${l.name}?`)) return;
    try { await deleteLevel({ levelId: l.id }); if (editing?.id === l.id) resetForm(); notify('Level deleted', 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Could not delete the level', 'error'); }
  }
  async function rebuild() {
    setRebuilding(true);
    try { const r = await rebuildLevelAccess({}); notify(`Access rebuilt for ${r.data.users} members`, 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Could not rebuild access', 'error'); } finally { setRebuilding(false); }
  }

  async function apply(ids: string[], levelId: string, okText: string) {
    if (ids.length === 0) return;
    setBusy(true);
    let done = 0;
    try {
      for (const id of ids) { await setGroupLevel({ groupId: id, levelId }); done++; }
      notify(`${okText}: ${done}`, 'success');
      setModal(null); setChecked([]); setPickIds([]);
    } catch (err) { notify(err instanceof Error ? err.message.replace(/^.*?:\s*/, '') : 'Could not change the level', 'error'); }
    finally { setBusy(false); }
  }
  function openAssign(levelId?: string) { setTarget(levelId ?? sel); setPickIds([]); setMq(''); setModal({ mode: 'assign' }); }
  function openMove() { setTarget(''); setModal({ mode: 'move' }); }

  const otherLevels = levels.filter((l) => l.id !== editing?.id);
  const modalList = modal?.mode === 'assign' ? unassigned.filter((g) => !mq.trim() || g.name.toLowerCase().includes(mq.trim().toLowerCase())) : [];

  return (
    <div className="px cx-page lv2">
      <CxBanner icon={<Layers size={30} />} title={tx("Comité Pédagogique — Academic Levels")} sub={tx("Levels determine which kurels, books and events each kurel can access.")}>
        <Dropdown className="lv2-yr" label={tx("Academic Year")} value={year} onChange={setYear} options={academicYearOptions()} />
        <button type="button" className="cx-btn ghost" onClick={() => openAssign()}><UserPlus size={16} /> {tx("Assign kurels")}</button>
        <button type="button" className="cx-btn gold" onClick={() => { resetForm(); document.getElementById('lv-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.getElementById('lv-name')?.focus(); }}><Plus size={16} /> {tx("Create level")}</button>
      </CxBanner>

      <div className="lv2-note"><Info size={18} /><span>{tx("These levels are used later in Event Planning to filter eligible kurels for an event (e.g., only Level 1 or Level 2 groups can be selected).")}</span></div>

      <CxStats cols={5} items={[
        { icon: <Layers size={24} />, tone: 'dark', label: tx("Total Levels"), value: levels.length },
        { icon: <Users size={24} />, tone: 'amber', label: tx("Total Kurels"), value: total },
        { icon: <Check size={24} />, tone: 'green', label: tx("Assigned Kurels"), value: assigned, badge: `${pct(assigned)}%` },
        { icon: <Users size={24} />, tone: 'amber', label: tx("Unassigned Kurels"), value: kurelCount.none, badge: `${pct(kurelCount.none)}%`, onClick: () => openAssign() },
        { icon: <BookOpen size={24} />, tone: 'amber', label: tx("Books Linked to Levels"), value: booksLinked, sub: tx("Books"), onClick: () => router.push('/dashboard/library') },
      ]} />

      <div className="lv2-filters">
        <b><Filter size={16} /> {tx("Filters")}</b>
        <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
        <Dropdown label={tx("City")} value={city} onChange={setCity} allLabel={tx("All cities")} options={cities.filter((c) => !country || c.parentGroupId === country).map((c) => ({ value: c.id, label: c.name }))} />
        <Dropdown label={tx("Zone")} value={zone} onChange={setZone} allLabel={tx("All zones")} options={zones.filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }))} />
        <Dropdown label={tx("Year")} value={year} onChange={setYear} options={academicYearOptions()} />
        <Dropdown label={tx("Level")} value={lvFilter} onChange={setLvFilter} allLabel={tx("All levels")} options={levels.map((l) => ({ value: l.id, label: l.name }))} />
        <Dropdown label={tx("Status")} value={lvStatus} onChange={setLvStatus} allLabel={tx("All statuses")} options={[{ value: 'filled', label: tx("With kurels") }, { value: 'empty', label: tx("Empty") }]} />
        <label className="lv2-s"><Search size={16} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search levels or kurels…")} /></label>
      </div>

      <div className="lv2-grid">
        <div className="lv2-main">
          <CxCard icon={<Layers size={20} />} title={`${tx("Academic Levels")} (${levels.length})`} sub={tx("Manage levels, their access, and the kurels assigned to each level.")}>
            <div className="lv2-tbl">
              <table>
                <thead><tr><th>#</th><th>{tx("Level")}</th><th>{tx("Access / Description")}</th><th>{tx("Kurels")}</th><th>{tx("Books")}</th><th>{tx("Actions")}</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={6} className="lv2-none">{tx("Loading…")}</td></tr>}
                  {!loading && levelRows.length === 0 && <tr><td colSpan={6} className="lv2-none">{levels.length === 0 ? tx("No level yet. Create the first one.") : tx("No level matches these filters.")}</td></tr>}
                  {levelRows.map((l) => (
                    <tr key={l.id} className={sel === l.id ? 'on' : ''} onClick={() => setSel(l.id)}>
                      <td>{l.rank}</td>
                      <td><span className="lv2-lv"><i><Award size={16} /></i><b>{l.name}</b></span></td>
                      <td>{accessText(l)}{l.description ? <small>{l.description}</small> : null}</td>
                      <td><button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); setSel(l.id); document.getElementById('lv-kurels')?.scrollIntoView({ behavior: 'smooth' }); }}><Users size={14} /> {kurelCount.m[l.id] ?? 0}</button></td>
                      <td><button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); router.push('/dashboard/library'); }}><BookOpen size={14} /> {books.counts[l.id] ?? 0}</button></td>
                      <td>
                        <span className="lv2-acts" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="v" onClick={() => { setSel(l.id); document.getElementById('lv-kurels')?.scrollIntoView({ behavior: 'smooth' }); }}><Eye size={14} /> {tx("View")}</button>
                          <button type="button" onClick={() => startEdit(l)}><Pencil size={14} /> {tx("Edit")}</button>
                          <button type="button" className="v" onClick={() => openAssign(l.id)}><Users size={14} /> {tx("Assign")}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CxCard>

          {level && (
            <section className="lv2-sel" id="lv-kurels">
              <div className="lv2-selbar">
                <div className="lv2-seltop"><i><Award size={30} /></i><span><small>{tx("Selected Level")}</small><b>{level.name}</b></span></div>
                <div><BookOpen size={22} /><span><small>{tx("Access Granted")}</small><b>{accessText(level)}</b></span></div>
                <div><Users size={22} /><span><b>{kurelCount.m[level.id] ?? 0} {tx("Kurels")}</b><small>{tx("assigned to this level")}</small></span></div>
                <div><BookOpen size={22} /><span><b>{books.counts[level.id] ?? 0} {tx("Books")}</b><small>{tx("linked to this level")}</small></span></div>
              </div>
              <div className="lv2-kh">
                <h3><Users size={20} /> {tx("Kurels in")} {level.name} ({kurels.length})</h3>
                <div>
                  <button type="button" className="lv2-b" disabled={checked.length === 0} onClick={openMove}><Repeat2 size={16} /> {tx("Move to another level")}</button>
                  <button type="button" className="lv2-b red" disabled={checked.length === 0 || busy} onClick={() => { if (confirm(`Remove ${checked.length} kurel(s) from ${level.name}?`)) void apply(checked, '', 'Removed from the level'); }}><Trash2 size={16} /> {tx("Remove from level")}</button>
                </div>
              </div>
              <div className="lv2-tbl">
                <table>
                  <thead><tr><th><input type="checkbox" aria-label={tx("Select all")} checked={shown.length > 0 && shown.every((g) => checked.includes(g.id))} onChange={(e) => setChecked(e.target.checked ? shown.map((g) => g.id) : [])} /></th><th>{tx("Kurel Name")}</th><th>{tx("Country")}</th><th>{tx("City")}</th><th>{tx("Zone")}</th><th>{tx("Academic Year / Program")}</th><th aria-label={tx("Actions")} /></tr></thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={7} className="lv2-none">{tx("No kurel in this level with these filters.")}</td></tr>}
                    {shown.map((g) => {
                      const loc = locationOf(g.id);
                      return (
                        <tr key={g.id}>
                          <td><input type="checkbox" aria-label={g.name} checked={checked.includes(g.id)} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, g.id] : c.filter((x) => x !== g.id)))} /></td>
                          <td><button type="button" className="lnk" onClick={() => router.push(`/dashboard/groups?q=${encodeURIComponent(g.name)}`)}><b>{g.name}</b></button></td>
                          <td><CountryName name={loc.country?.name} /></td>
                          <td>{loc.city?.name ?? '—'}</td>
                          <td>{g.zoneId && zoneName[g.zoneId] ? <span className="lv2-zone">{zoneName[g.zoneId]}</span> : '—'}</td>
                          <td>{academicYearLabel(year)}</td>
                          <td><Link href={`/dashboard/groups?q=${encodeURIComponent(g.name)}`} className="lv2-kb" aria-label={`${tx("Open the profile")} ${g.name}`}><MoreHorizontal size={18} /></Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="lv2-pg">
                <span>{tx("Showing")} {shown.length} {tx("of")} {kurels.length} {tx("kurels")}</span>
                <span>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={tx("Previous")}><ChevronLeft size={16} /></button>
                  {Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === page ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
                  <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={tx("Next")}><ChevronRight size={16} /></button>
                </span>
              </div>
            </section>
          )}
        </div>

        <aside className="lv2-side">
          <CxCard id="lv-form" icon={<Pencil size={20} />} title={editing ? tx("Edit a Level") : tx("Create / Edit a Level")} sub={tx("Define the level and its access for the pedagogical committee.")}>
            <form className="lv2-form" onSubmit={submit}>
              <div className="lv2-two">
                <label>{tx("Level Name")} <b className="req">*</b><input id="lv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="LEVEL 1" required /></label>
                <label>{tx("Rank")} <b className="req">*</b><input type="number" min={1} step={1} value={rank} onChange={(e) => setRank(e.target.value)} required /></label>
              </div>
              <label>{tx("Description (optional)")}<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tx("e.g., Own level only, or access to specific resources.")} /></label>
              <div className="lv2-two">
                <label>{tx("Book Limit (optional)")}<input type="number" min={1} step={1} value={maxBooks} onChange={(e) => setMaxBooks(e.target.value)} placeholder="e.g., 50" /></label>
                <div className="lv2-acc"><span>{tx("Grants Access To")}</span><em>{accessIds.length === 0 ? tx("Own level only") : `${accessIds.length} ${tx("other level(s)")}`}</em></div>
              </div>
              {otherLevels.length > 0 && (
                <div className="lv2-chips">
                  {otherLevels.map((o) => <button type="button" key={o.id} className={accessIds.includes(o.id) ? 'on' : ''} aria-pressed={accessIds.includes(o.id)} onClick={() => setAccessIds((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]))}>{o.name}</button>)}
                </div>
              )}
              <button type="submit" className="lv2-save" disabled={saving}><Check size={18} /> {saving ? tx("Saving…") : tx("Save Level")}</button>
              {editing && <div className="lv2-edact"><button type="button" onClick={resetForm}>{tx("Cancel")}</button><button type="button" className="red" onClick={() => void remove(editing)}><Trash2 size={14} /> {tx("Delete")}</button></div>}
            </form>
          </CxCard>

          <CxCard icon={<Layers size={20} />} title={tx("Items without a Level")} right={<span className="lv2-badge">{kurelCount.none + books.none}</span>} sub={tx("These have no level yet, so no kurel can access them until you assign one.")}>
            {kurelCount.none + books.none === 0 ? <p className="lv2-ok"><Check size={16} /> {tx("Every kurel and book has a level.")}</p> : (
              <div className="lv2-items">
                <ul>
                  {kurelCount.none > 0 && <li>{kurelCount.none} {tx("kurel(s)")}</li>}
                  {books.none > 0 && <li>{books.none} {tx("library book(s)")}</li>}
                </ul>
                <button type="button" onClick={() => (kurelCount.none > 0 ? openAssign() : router.push('/dashboard/library'))}>{tx("Assign Level")}</button>
              </div>
            )}
          </CxCard>

          <CxCard icon={<ShieldCheck size={20} />} title={tx("How Levels Work / Access Rules")} right={<button type="button" className="lv2-rb" title={tx("Rebuild access for every member from these rules")} onClick={rebuild} disabled={rebuilding}><ServerCog size={14} /> {rebuilding ? tx("Rebuilding…") : tx("Server Rules")}</button>}>
            <ul className="lv2-rules">
              <li><Check size={14} /> {tx("Levels are used by the Comité Pédagogique.")}</li>
              <li><Check size={14} /> {tx("Each kurel belongs to one level.")}</li>
              <li><Check size={14} /> {tx("Event Planning uses these levels to restrict group selection (e.g., only Level 1 or Level 2 groups can be selected).")}</li>
            </ul>
          </CxCard>
        </aside>
      </div>

      {modal && createPortal(
        <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="fm lv2-modal" role="dialog" aria-modal="true">
            <header><div><h2>{modal.mode === 'assign' ? tx("Assign kurels to a level") : tx("Move to another level")}</h2><p>{modal.mode === 'assign' ? tx("Pick the kurels that have no level yet.") : `${checked.length} ${tx("kurel(s) selected")}`}</p></div><button type="button" aria-label={tx("Close")} onClick={() => setModal(null)}><X size={20} /></button></header>
            <div className="lv2-mb">
              <Dropdown label={tx("Level")} value={target} onChange={setTarget} options={levels.filter((l) => modal.mode === 'assign' || l.id !== sel).map((l) => ({ value: l.id, label: l.name }))} />
              {modal.mode === 'assign' && (
                <>
                  <label className="lv2-s"><Search size={16} /><input type="search" value={mq} onChange={(e) => setMq(e.target.value)} placeholder={tx("Search a kurel…")} /></label>
                  <div className="lv2-pick">
                    {modalList.length === 0 && <p className="lv2-none">{tx("Every kurel already has a level.")}</p>}
                    {modalList.map((g) => (
                      <label key={g.id}><input type="checkbox" checked={pickIds.includes(g.id)} onChange={(e) => setPickIds((p) => (e.target.checked ? [...p, g.id] : p.filter((x) => x !== g.id)))} /><span><b>{g.name}</b><small>{[locationOf(g.id).city?.name, locationOf(g.id).country?.name].filter(Boolean).join(' · ')}</small></span></label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <footer><button type="button" className="fm-ghost" onClick={() => setModal(null)}>{tx("Cancel")}</button><button type="button" className="fm-go" disabled={busy || !target || (modal.mode === 'assign' ? pickIds.length === 0 : checked.length === 0)} onClick={() => void apply(modal.mode === 'assign' ? pickIds : checked, target, modal.mode === 'assign' ? 'Assigned' : 'Moved')}>{busy ? tx("Saving…") : modal.mode === 'assign' ? `${tx("Assign")} ${pickIds.length || ''}` : tx("Move")}</button></footer>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

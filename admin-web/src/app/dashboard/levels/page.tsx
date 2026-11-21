'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, CalendarClock, GraduationCap, Layers, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { collection, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { createLevel, updateLevel, deleteLevel, rebuildLevelAccess } from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels, type Level } from '@/lib/useLevels';
import { notify } from '@/lib/notify';
import Dropdown from '@/components/Dropdown';
import { EbBar, EbHero, EbPanel, EbPill, EbSearch, EbTable, EbTiles, type EbCol } from '@/components/Eb';
import { tx } from '@/lib/i18n/tr';

/** How many records of each kind point at each level (live, from Firestore). */
function useLevelUsage(collectionName: string) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unassigned, setUnassigned] = useState(0);
  useEffect(() => {
    return onSnapshot(query(collection(db, collectionName)), (snap) => {
      const next: Record<string, number> = {};
      let none = 0;
      snap.docs.forEach((d) => {
        const levelId = d.data().levelId as string | undefined;
        if (levelId) next[levelId] = (next[levelId] ?? 0) + 1;
        else none++;
      });
      setCounts(next);
      setUnassigned(none);
    });
  }, [collectionName]);
  return { counts, unassigned };
}

export default function LevelsPage() {
  const { t } = useLocale();
  const l18 = t.levels;
  const { levels, byId, loading } = useLevels();
  const { activeLeafGroups } = useGroupHierarchy();
  const books = useLevelUsage('qacaidEditions');
  const materials = useLevelUsage('qacaid');
  const equipment = useLevelUsage('equipment');

  const kurelCounts = useMemo(() => {
    const map: Record<string, number> = {};
    let none = 0;
    activeLeafGroups.forEach((g) => {
      if (g.levelId) map[g.levelId] = (map[g.levelId] ?? 0) + 1;
      else none++;
    });
    return { map, none };
  }, [activeLeafGroups]);

  const [editing, setEditing] = useState<Level | null>(null);
  const [name, setName] = useState('');
  const [rank, setRank] = useState('');
  const [description, setDescription] = useState('');
  const [maxBooks, setMaxBooks] = useState('');
  const [accessIds, setAccessIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [fAccess, setFAccess] = useState('');
  const [fLimit, setFLimit] = useState('');

  function startEdit(level: Level) {
    window.setTimeout(() => document.getElementById('lv-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    setEditing(level);
    setName(level.name);
    setRank(String(level.rank));
    setDescription(level.description ?? '');
    setMaxBooks(level.maxBooks === null ? '' : String(level.maxBooks));
    setAccessIds(level.accessLevelIds);
  }

  function resetForm() {
    setEditing(null);
    setName('');
    setRank('');
    setDescription('');
    setMaxBooks('');
    setAccessIds([]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        rank: Number(rank),
        description: description.trim(),
        maxBooks: maxBooks.trim() === '' ? null : Number(maxBooks),
        accessLevelIds: accessIds,
      };
      if (editing) await updateLevel({ levelId: editing.id, ...payload });
      else await createLevel(payload);
      notify(l18.saved, 'success');
      resetForm();
    } catch (err) {
      notify(err instanceof Error ? err.message : l18.saveFailed, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(level: Level) {
    if (!confirm(l18.confirmDelete(level.name))) return;
    try {
      await deleteLevel({ levelId: level.id });
      if (editing?.id === level.id) resetForm();
      notify(l18.deleted, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : l18.deleteFailed, 'error');
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const res = await rebuildLevelAccess({});
      notify(l18.rebuilt(res.data.users), 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : l18.rebuildFailed, 'error');
    } finally {
      setRebuilding(false);
    }
  }

  const otherLevels = levels.filter((l) => l.id !== editing?.id);
  const unassignedRows = [
    kurelCounts.none > 0 && l18.unassignedKurels(kurelCounts.none),
    books.unassigned > 0 && l18.unassignedBooks(books.unassigned),
    materials.unassigned > 0 && l18.unassignedMaterials(materials.unassigned),
    equipment.unassigned > 0 && l18.unassignedEquipment(equipment.unassigned),
  ].filter(Boolean) as string[];

  const term = q.trim().toLowerCase();
  const rows = levels.filter((l) => (!term || `${l.name} ${l.description ?? ''}`.toLowerCase().includes(term)) && (!fAccess || (fAccess === 'own' ? l.accessLevelIds.length === 0 : l.accessLevelIds.length > 0)) && (!fLimit || (fLimit === 'limited' ? l.maxBooks !== null : l.maxBooks === null)));
  const filtering = !!(q || fAccess || fLimit);
  const clear = () => { setQ(''); setFAccess(''); setFLimit(''); };
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const accessText = (l: Level) => (l.accessLevelIds.length === 0 ? l18.ownLevelOnly : l.accessLevelIds.map((id) => byId[id]).filter(Boolean).sort((a, b) => a.rank - b.rank).map((x) => x.name).join(', '));

  const cols: EbCol<Level>[] = [
    { key: 'rank', label: l18.colRank, width: '8%', sort: (l) => l.rank, onCell: startEdit, hint: tx("Edit this level"), render: (l) => <span className="eb2-rk">{l.rank}</span> },
    { key: 'name', label: l18.colName, width: '22%', sort: (l) => l.name.toLowerCase(), stack: true, onCell: startEdit, hint: tx("Edit this level"), render: (l) => <><b>{l.name}</b>{l.description && <small>{l.description}</small>}</> },
    { key: 'access', label: l18.colAccess, width: '20%', sort: (l) => l.accessLevelIds.length, onCell: (l) => setFAccess(l.accessLevelIds.length === 0 ? 'own' : 'inherit'), hint: tx("Show levels with the same access"), render: (l) => <span>{accessText(l)}</span> },
    { key: 'books', label: l18.colBooks, width: '12%', num: true, sort: (l) => books.counts[l.id] ?? 0, onCell: () => router.push('/dashboard/library'), hint: tx("Open the book library"), render: (l) => <span>{l18.booksUsage(books.counts[l.id] ?? 0, l.maxBooks)}</span> },
    { key: 'kurels', label: l18.colKurels, width: '9%', num: true, sort: (l) => kurelCounts.map[l.id] ?? 0, onCell: (l) => router.push(`/dashboard/groups?level=${l.id}`), hint: tx("Show the kurels of this level"), render: (l) => <EbPill tone="ok">{kurelCounts.map[l.id] ?? 0}</EbPill> },
    { key: 'materials', label: l18.colMaterials, width: '10%', num: true, sort: (l) => materials.counts[l.id] ?? 0, onCell: () => router.push('/dashboard/programme-pedagogique'), hint: tx("Open the pedagogical committee"), render: (l) => <EbPill tone="teal">{materials.counts[l.id] ?? 0}</EbPill> },
    { key: 'equipment', label: l18.colEquipment, width: '10%', num: true, sort: (l) => equipment.counts[l.id] ?? 0, onCell: () => router.push('/dashboard/equipment'), hint: tx("Open the equipment"), render: (l) => <EbPill tone="gold">{equipment.counts[l.id] ?? 0}</EbPill> },
    { key: 'actions', label: l18.colActions, width: '12%', actions: true, render: (l) => <span className="eb2-acts-row"><button type="button" className="eb2-ibt" aria-label={`${l18.edit} ${l.name}`} onClick={() => startEdit(l)}><Pencil size={15} /></button><button type="button" className="eb2-ibt red" aria-label={`${l18.delete} ${l.name}`} onClick={() => void handleDelete(l)}><Trash2 size={15} /></button></span> },
  ];

  return (
    <div className="eb2">
      <EbHero title={l18.title} sub={tx("Levels decide which books, materials and equipment each kurel can access.")}>
        <button type="button" className="ghost" onClick={handleRebuild} disabled={rebuilding}><RefreshCw size={16} /> {rebuilding ? l18.rebuilding : l18.rebuild}</button>
        <button type="button" className="gold" onClick={() => { resetForm(); document.getElementById('lv-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.getElementById('lv-name')?.focus(); }}><Plus size={16} /> {l18.create}</button>
      </EbHero>

      <EbTiles items={[
        { icon: <GraduationCap size={26} />, label: tx("Levels"), value: levels.length, on: !filtering, onClick: clear },
        { icon: <Users size={26} />, label: tx("Kurels"), value: activeLeafGroups.length, hint: `${kurelCounts.none} ${tx("without a level")}`, onClick: () => router.push('/dashboard/groups') },
        { icon: <BookOpen size={26} />, label: tx("Library books"), value: sum(books.counts) + books.unassigned, hint: `${books.unassigned} ${tx("without a level")}`, onClick: () => router.push('/dashboard/library') },
        { icon: <Layers size={26} />, label: tx("Materials · equipment"), value: `${sum(materials.counts) + materials.unassigned} · ${sum(equipment.counts) + equipment.unassigned}`, hint: `${materials.unassigned + equipment.unassigned} ${tx("without a level")}`, onClick: () => router.push('/dashboard/programme-pedagogique') },
      ]} />

      <EbBar active={filtering} onClear={clear}>
        <EbSearch value={q} onChange={setQ} placeholder={tx("Search a level")} />
        <Dropdown label={tx("Access")} value={fAccess} onChange={setFAccess} allLabel={tx("Any access")} options={[{ value: 'own', label: l18.ownLevelOnly }, { value: 'inherit', label: tx("Also reads lower levels") }]} className="eb2-dd" />
        <Dropdown label={tx("Book limit")} value={fLimit} onChange={setFLimit} allLabel={tx("Any limit")} options={[{ value: 'limited', label: tx("Limited") }, { value: 'unlimited', label: tx("No limit") }]} className="eb2-dd" />
      </EbBar>

      <div className="eb2-grid g2">
        <EbPanel icon={<GraduationCap size={20} />} title={l18.allLevels} count={filtering ? `${rows.length} / ${levels.length}` : levels.length} note={l18.howItWorks}>
          <EbTable rows={rows} cols={cols} rowKey={(l) => l.id} loading={loading} empty={levels.length === 0 ? l18.none : tx("No level matches these filters.")} initialSort={{ key: 'rank', dir: 'asc' }} />
        </EbPanel>

        <EbPanel id="lv-form" icon={editing ? <Pencil size={20} /> : <Plus size={20} />} title={editing ? l18.editTitle : l18.createTitle}>
          <form className="eb2-form" onSubmit={handleSubmit}>
            <div className="field"><label className="l" htmlFor="lv-name">{l18.nameLabel}</label><input id="lv-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={l18.namePlaceholder} required /></div>
            <div className="eb2-two">
              <div className="field"><label className="l" htmlFor="lv-rank">{l18.rankLabel}</label><input id="lv-rank" type="number" min={1} step={1} value={rank} onChange={(e) => setRank(e.target.value)} required /></div>
              <div className="field"><label className="l" htmlFor="lv-max">{l18.maxBooksLabel}</label><input id="lv-max" type="number" min={1} step={1} value={maxBooks} onChange={(e) => setMaxBooks(e.target.value)} /></div>
            </div>
            <small>{l18.rankHelp} {l18.maxBooksHelp}</small>
            <div className="field"><label className="l" htmlFor="lv-desc">{l18.descriptionLabel}</label><input id="lv-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="field">
              <label className="l">{l18.accessLabel}</label>
              <small>{l18.accessHelp}</small>
              {otherLevels.length === 0 ? <small>{l18.noOtherLevels}</small> : (
                <>
                  <div className="eb2-chips">
                    {otherLevels.map((o) => <button type="button" key={o.id} className={accessIds.includes(o.id) ? 'on' : ''} aria-pressed={accessIds.includes(o.id)} onClick={() => setAccessIds((prev) => (prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]))}>{o.name}</button>)}
                  </div>
                  <div className="eb2-form-act">
                    <button type="button" className="eb2-bt" onClick={() => setAccessIds(otherLevels.filter((o) => rank !== '' && o.rank < Number(rank)).map((o) => o.id))} disabled={rank === ''}>{l18.selectLowerLevels}</button>
                    <button type="button" className="eb2-bt" onClick={() => setAccessIds([])}>{l18.clearAccess}</button>
                  </div>
                </>
              )}
            </div>
            <div className="eb2-form-act">
              <button type="submit" className="eb2-bt pri" disabled={saving}>{saving ? l18.saving : editing ? l18.save : l18.create}</button>
              {editing && <button type="button" className="eb2-bt" onClick={resetForm}>{l18.cancelEdit}</button>}
            </div>
          </form>
        </EbPanel>
      </div>

      <div className="eb2-grid g11">
        <EbPanel icon={<RefreshCw size={20} />} title={l18.rebuildTitle} note={l18.rebuildHelp}>
          <div className="eb2-form"><div className="eb2-form-act"><button type="button" className="eb2-bt pri" onClick={handleRebuild} disabled={rebuilding}><RefreshCw size={15} /> {rebuilding ? l18.rebuilding : l18.rebuild}</button></div></div>
        </EbPanel>
        <EbPanel icon={<CalendarClock size={20} />} title={l18.unassignedTitle} count={unassignedRows.length} note={l18.unassignedHelp}>
          {unassignedRows.length === 0 ? <p className="eb2-empty-row">{tx("Every kurel, book, material and equipment has a level.")}</p> : (
            <div className="eb2-list">{unassignedRows.map((r, i) => <div key={r} className="eb2-row" style={{ ['--c' as string]: ['#e8832f', '#1f78d1', '#7c4cc4', '#1aa3b8'][i % 4], cursor: 'default' }}><span className="top"><b>{r}</b></span></div>)}</div>
          )}
        </EbPanel>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Download, Music2, Trash2, Upload } from 'lucide-react';
import { collection, orderBy, query } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { onSnapshot } from '@/lib/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import DurationEditor from '@/components/DurationEditor';
import { uploadAudioTrack as uploadTrackFn, reviewAudioTrack as reviewTrackFn, setAudioTrackLevel, deleteAudioTrack } from '@/lib/functions';
import { useLevels } from '@/lib/useLevels';
import { useLocale } from '@/lib/i18n/LocaleContext';
import Dropdown from '@/components/Dropdown';
import { EbBar, EbDrop, EbHero, EbPanel, EbPill, EbSearch, EbTable, type EbCol } from '@/components/Eb';
import { tx } from '@/lib/i18n/tr';

type Category = 'rehearsal' | 'announcement' | 'performance';

interface TrackRow {
  id: string;
  title: string;
  melodyLabel?: string;
  qacaidTitle?: string;
  qacaidId?: string;
  category: Category;
  scopeAllGroups: boolean;
  groupIds?: string[];
  fileUrl: string;
  status: 'pending' | 'approved';
  levelId?: string;
  durationSeconds?: number;
}

export default function AudioManage() {
  const { t: tr } = useLocale();
  const a18 = tr.audio;
  const { activeLeafGroups: leafGroups, byId } = useGroupHierarchy();
  const { levels, byId: levelById, accessibleFrom } = useLevels();
  const [levelId, setLevelId] = useState('');
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    return onSnapshot(query(collection(db, 'audioTracks'), orderBy('createdAt', 'desc')), (snap) => {
      setTracks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackRow, 'id'>) })));
      setLoading(false);
    });
  }, []);

  // ---- Upload form ----
  const books = useCollection<{ code?: string; title?: string }>('qacaid', [orderBy('code', 'asc')]);
  const [qacaidId, setQacaidId] = useState('');
  const [scopeAll, setScopeAll] = useState(true);
  // Only kurels whose academic level can access the chosen level are offered.
  const allowedGroups = leafGroups.filter((g) => !levelId || accessibleFrom((g as { levelId?: string }).levelId).includes(levelId));
  const [groupIds, setGroupIds] = useState<string[]>([]);
  interface Pick { key: string; file: File; melody: string; minutes: string; bookId: string; state: 'wait' | 'busy' | 'ok' | 'err'; msg: string }
  const [picks, setPicks] = useState<Pick[]>([]);
  const [uploading, setUploading] = useState(false);

  function toggleGroup(id: string) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const niceName = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  function addFiles(list: FileList | null) {
    if (!list) return;
    const fresh: Pick[] = Array.from(list).map((f, i) => ({ key: `${Date.now()}_${i}_${f.name}`, file: f, melody: niceName(f), minutes: '', bookId: '', state: 'wait', msg: '' }));
    setPicks((p) => [...p, ...fresh]);
    fresh.forEach((x) => {
      const a = new Audio(URL.createObjectURL(x.file));
      a.onloadedmetadata = () => {
        if (Number.isFinite(a.duration) && a.duration > 0) setPicks((p) => p.map((y) => (y.key === x.key ? { ...y, minutes: String(Math.round((a.duration / 60) * 100) / 100) } : y)));
        URL.revokeObjectURL(a.src);
      };
    });
  }
  const patch = (key: string, v: Partial<Pick>) => setPicks((p) => p.map((y) => (y.key === key ? { ...y, ...v } : y)));

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (picks.length === 0) return setError(tx("Choose at least one audio file."));
    if (!scopeAll && groupIds.length === 0) return setError(tx("Tick at least one kurel, or choose All kurels."));
    const todo = picks.filter((x) => x.state !== 'ok');
    for (const x of todo) {
      if (!(x.bookId || qacaidId)) return setError(tx("Choose the book for every file. Add the book in the Book library first if it is not in the list."));
      if (!x.melody.trim()) return setError(`Give a melody name to "${x.file.name}", for example Qawali or Rap.`);
      if (!(Math.round(Number(x.minutes) * 60) >= 1)) return setError(`Enter the length in minutes for "${x.file.name}".`);
    }
    setUploading(true);
    for (const x of todo) {
      patch(x.key, { state: 'busy', msg: '' });
      try {
        const path = `audioTracks/${Date.now()}_${x.file.name}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, x.file, { contentType: x.file.type || 'audio/mpeg' });
        const fileUrl = await getDownloadURL(ref);
        await uploadTrackFn({
          qacaidId: x.bookId || qacaidId,
          melodyLabel: x.melody.trim(),
          category: 'rehearsal' as Category, // no category choice: the audio library is one list, shared by group access
          groupIds: scopeAll ? undefined : groupIds,
          fileUrl,
          filePath: path,
          durationSeconds: Math.round(Number(x.minutes) * 60),
          levelId: levelId || undefined,
        });
        patch(x.key, { state: 'ok', msg: 'Uploaded and ready to choose' });
      } catch (err) {
        patch(x.key, { state: 'err', msg: err instanceof Error ? err.message : a18.uploadFailed });
      }
    }
    setUploading(false);
    setPicks((p) => (p.every((x) => x.state === 'ok') ? [] : p.filter((x) => x.state !== 'ok')));
  }

  async function approveAll() {
    const waiting = tracks.filter((t) => t.status === 'pending');
    if (!waiting.length || !confirm(`Approve ${waiting.length} audio${waiting.length === 1 ? '' : 's'} so groups can choose them?`)) return;
    for (const t of waiting) { try { await reviewTrackFn({ trackId: t.id }); } catch (err) { setError(err instanceof Error ? err.message : tx("Could not approve")); break; } }
  }

  const [search, setSearch] = useState('');
  const [fBook, setFBook] = useState('');
  const [fMelody, setFMelody] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [fKurel, setFKurel] = useState('');
  const melodyList = Array.from(new Set(tracks.map((t) => t.melodyLabel).filter((m): m is string => !!m))).sort();
  const bookName = (id?: string) => (books ?? []).find((b) => b.id === id)?.title ?? '';
  const term = search.trim().toLowerCase();
  const visible = tracks.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (fBook && t.qacaidId !== fBook) return false;
    if (fMelody && t.melodyLabel !== fMelody) return false;
    if (fLevel && (fLevel === '__none__' ? !!t.levelId : t.levelId !== fLevel)) return false;
    if (fKurel && !t.scopeAllGroups && !(t.groupIds ?? []).includes(fKurel)) return false;
    return !term || `${t.title} ${t.melodyLabel ?? ''} ${bookName(t.qacaidId)}`.toLowerCase().includes(term);
  });
  const anyFilter = !!(search || fBook || fMelody || fLevel || fKurel || statusFilter);

  const waiting = tracks.filter((t) => t.status === 'pending').length;
  const clear = () => { setSearch(''); setFBook(''); setFMelody(''); setFLevel(''); setFKurel(''); setStatusFilter(''); };
  const bookOpts = (books ?? []).map((b) => ({ value: b.id, label: `${b.code ? `${b.code} — ` : ''}${b.title ?? ''}` }));
  const levelOpts = levels.map((l) => ({ value: l.id, label: l.name }));
  const scopeText = (t: TrackRow) => (t.scopeAllGroups ? tx("All kurels") : (t.groupIds ?? []).map((g) => byId[g]?.name ?? g).join(', ') || '—');
  async function remove(t: TrackRow) {
    if (!window.confirm(`Delete "${t.qacaidTitle ?? t.title} — ${t.melodyLabel ?? ''}"? This cannot be undone.`)) return;
    try { await deleteAudioTrack({ trackId: t.id }); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : tx("Could not delete the audio.")); }
  }

  const cols: EbCol<TrackRow>[] = [
    { key: 'audio', label: tx("Audio"), width: '22%', stack: true, sort: (t) => (t.qacaidTitle ?? t.title).toLowerCase(), onCell: (t) => setFBook(t.qacaidId ?? ''), hint: tx("Show only this book"), render: (t) => <><b>{t.qacaidTitle ?? t.title}</b><small>{t.melodyLabel ?? tx("No melody name")}</small></> },
    { key: 'level', label: tx("Level"), width: '17%', sort: (t) => levelById[t.levelId ?? '']?.rank ?? 99, render: (t) => (
      <Dropdown label={tx("Level")} value={t.levelId ?? ''} allLabel={tx("Everyone")} options={levelOpts} className="eb2-dd" onChange={async (v) => {
        try { await setAudioTrackLevel({ trackId: t.id, levelId: v }); setError(null); }
        catch (err) { setError(err instanceof Error ? err.message : tx("Could not change the level.")); }
      }} />
    ) },
    { key: 'length', label: tx("Length"), width: '15%', sort: (t) => t.durationSeconds ?? 0, render: (t) => <DurationEditor type="audio" id={t.id} seconds={t.durationSeconds} /> },
    { key: 'scope', label: tx("Available to"), width: '18%', sort: (t) => scopeText(t).toLowerCase(), onCell: (t) => { if (!t.scopeAllGroups && t.groupIds?.[0]) setFKurel(t.groupIds[0]); }, hint: tx("Show the audio of this kurel"), render: (t) => <span>{scopeText(t)}</span> },
    { key: 'status', label: tx("Status"), width: '10%', sort: (t) => t.status, onCell: (t) => setStatusFilter(statusFilter === t.status ? '' : t.status), hint: tx("Show only this status"), render: (t) => <EbPill tone={t.status === 'approved' ? 'ok' : 'gold'}>{t.status === 'approved' ? tx("Approved") : tx("Waiting")}</EbPill> },
    { key: 'actions', label: tx("Actions"), width: '18%', actions: true, render: (t) => (
      <span className="eb2-acts-row">
        {t.status === 'pending' && <button type="button" className="eb2-bt pri" onClick={() => void reviewTrackFn({ trackId: t.id })}><CheckCircle2 size={14} /> {tx("Approve")}</button>}
        <a href={t.fileUrl} target="_blank" rel="noreferrer" className="eb2-ibt" aria-label={tx("Listen")} title={tx("Listen")}><Download size={15} /></a>
        <button type="button" className="eb2-ibt red" aria-label={tx("Delete")} title={tx("Delete")} onClick={() => void remove(t)}><Trash2 size={15} /></button>
      </span>
    ) },
  ];

  return (
    <div className="eb2">
      <EbHero title={tx("Manage audio")} sub={tx("Upload a version of a book, choose its level and the kurels that can use it, then approve it.")}>
        {waiting > 0 && <button type="button" className="gold" onClick={approveAll}><CheckCircle2 size={16} /> {tx("Approve all")} · {waiting}</button>}
      </EbHero>
      {error && <p className="eb2-err" role="alert">{error}</p>}
      {waiting > 0 && <p className="eb2-banner">{waiting} {tx("uploaded audio(s) are waiting for approval, so groups cannot choose them yet.")}</p>}

      <EbBar active={anyFilter} onClear={clear}>
        <EbSearch value={search} onChange={setSearch} placeholder={tx("Search a book or a melody")} />
        <Dropdown label={tx("Book")} value={fBook} onChange={setFBook} allLabel={tx("All books")} options={bookOpts} className="eb2-dd" />
        <Dropdown label={tx("Melody")} value={fMelody} onChange={setFMelody} allLabel={tx("All melodies")} options={melodyList.map((m) => ({ value: m, label: m }))} className="eb2-dd" />
        <Dropdown label={tx("Level")} value={fLevel} onChange={setFLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level (everyone)") }, ...levelOpts]} className="eb2-dd" />
        <Dropdown label={tx("Kurel")} value={fKurel} onChange={setFKurel} allLabel={tx("All kurels")} options={leafGroups.map((g) => ({ value: g.id, label: g.name }))} className="eb2-dd" />
        <Dropdown label={tx("Status")} value={statusFilter} onChange={setStatusFilter} allLabel={tx("All statuses")} options={[{ value: 'pending', label: tx("Waiting for approval") }, { value: 'approved', label: tx("Approved") }]} className="eb2-dd" />
      </EbBar>

      <div className="eb2-grid g2">
        <EbPanel icon={<Music2 size={20} />} title={tx("Audio files")} count={`${visible.length} ${tx("of")} ${tracks.length}`}>
          <EbTable rows={visible} cols={cols} rowKey={(t) => t.id} loading={loading} empty={tracks.length === 0 ? tx("No audio yet.") : tx("No audio matches these filters.")} />
        </EbPanel>

        <EbPanel icon={<Upload size={20} />} title={tx("Upload a new version")}>
          <form onSubmit={handleUpload} className="eb2-form">
            <Dropdown label={tx("Book (for all the files below)")} value={qacaidId} onChange={setQacaidId} allLabel={tx("Choose the book…")} options={bookOpts} />
            {books !== null && books.length === 0 && <small>{tx("No book yet. Add the book on the Book library page first.")}</small>}
            <Dropdown label={tx("Academic level (optional)")} value={levelId} onChange={(v) => { setLevelId(v); setGroupIds([]); }} allLabel={tx("No level: available to everyone")} options={levelOpts} />
            <div className="field">
              <label className="l">{tx("Who can use this audio?")}</label>
              <div className="eb2-seg"><button type="button" className={scopeAll ? 'on' : ''} onClick={() => setScopeAll(true)}>{tx("All kurels")}</button><button type="button" className={!scopeAll ? 'on' : ''} onClick={() => setScopeAll(false)}>{tx("Choose kurels")}</button></div>
              {!scopeAll && (
                <div className="eb2-chips" style={{ maxHeight: 170, overflowY: 'auto' }}>
                  {allowedGroups.length === 0 && <small>{tx("No kurel can access this level yet.")}</small>}
                  {allowedGroups.map((g) => <button type="button" key={g.id} className={groupIds.includes(g.id) ? 'on' : ''} aria-pressed={groupIds.includes(g.id)} onClick={() => toggleGroup(g.id)}>{g.name}</button>)}
                </div>
              )}
            </div>
            <div className="field">
              <label className="l">{tx("Audio files * (you can choose several at once)")}</label>
              <EbDrop accept="audio/*" multiple onFiles={addFiles} title={tx("Drop the audio files here or click to choose")} hint={picks.length ? `${picks.length} ${tx("file(s) chosen")}` : undefined} />
            </div>
            {picks.length > 0 && (
              <ul className="eb2-picks">
                {picks.map((x) => (
                  <li key={x.key} className={`eb2-pick ${x.state}`}>
                    <div className="eb2-pick-top"><b title={x.file.name}>{x.file.name}</b>{x.state === 'wait' && <button type="button" className="eb2-x" aria-label={tx("Remove this file")} onClick={() => setPicks((p) => p.filter((y) => y.key !== x.key))}>×</button>}</div>
                    <div className="eb2-pick-row">
                      <Dropdown label={tx("Book")} value={x.bookId} onChange={(v) => patch(x.key, { bookId: v })} allLabel={tx("Same book as above")} options={bookOpts} />
                      <input value={x.melody} disabled={x.state === 'busy' || x.state === 'ok'} onChange={(e) => patch(x.key, { melody: e.target.value })} placeholder={tx("Melody (Qawali, Rap…)")} aria-label={tx("Melody")} />
                      <input type="number" min="0.1" step="0.1" value={x.minutes} disabled={x.state === 'busy' || x.state === 'ok'} onChange={(e) => patch(x.key, { minutes: e.target.value })} placeholder={tx("Minutes")} aria-label={tx("Length in minutes")} />
                    </div>
                    {x.state !== 'wait' && <small>{x.state === 'busy' ? tx("Uploading…") : x.msg}</small>}
                  </li>
                ))}
              </ul>
            )}
            <div className="eb2-form-act"><button type="submit" className="eb2-bt pri" disabled={uploading || picks.length === 0} style={{ padding: '13px 24px' }}><Upload size={15} /> {uploading ? tx("Uploading…") : picks.length > 1 ? `Upload ${picks.length} files` : tx("Upload")}</button></div>
          </form>
        </EbPanel>
      </div>
    </div>
  );
}

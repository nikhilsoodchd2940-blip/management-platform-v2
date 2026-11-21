'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, Download, Library, Music2, Pencil, Play } from 'lucide-react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import { useCollection } from '@/lib/useCollection';
import { reviewAudioTrack } from '@/lib/functions';
import { formatDuration } from '@/lib/timeZones';
import { notify } from '@/lib/notify';
import ManageToggle from '../../px/ManageToggle';
import AudioManage from './Manage';
import Dropdown from '@/components/Dropdown';
import { EbBar, EbHero, EbPanel, EbPill, EbSearch, EbTable, EbTabs, EbTiles, type EbCol } from '@/components/Eb';
import { tx } from '@/lib/i18n/tr';

interface Track {
  id: string;
  title: string;
  melodyLabel?: string;
  qacaidId?: string;
  levelId?: string;
  scopeAllGroups: boolean;
  groupIds: string[];
  fileUrl: string;
  status: 'pending' | 'approved';
  size: number;
  durationSeconds: number;
}

const mb = (b: number) => (b ? `${(b / 1048576).toFixed(1)} MB` : '—');

/** Audio library: every audio is a version (melody) of a book. Tabs, filters, grouped by book, one player. */
export default function AudioPage() {
  const { byId, activeLeafGroups } = useGroupHierarchy();
  const { levels, byId: levelById } = useLevels();
  const books = useCollection<{ code?: string; title?: string }>('qacaid', []);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [tab, setTab] = useState<'approved' | 'pending' | 'all'>('approved');
  const [search, setSearch] = useState('');
  const [book, setBook] = useState('');
  const [melody, setMelody] = useState('');
  const [level, setLevel] = useState('');
  const [kurel, setKurel] = useState('');
  const [playing, setPlaying] = useState<Track | null>(null);
  const [manageSignal, setManageSignal] = useState(0);
  const [busy, setBusy] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(
    () =>
      onSnapshot(query(collection(db, 'audioTracks'), orderBy('createdAt', 'desc')), (snap) =>
        setTracks(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              title: (x.title as string) ?? '',
              melodyLabel: (x.melodyLabel as string) || undefined,
              qacaidId: (x.qacaidId as string) || undefined,
              levelId: (x.levelId as string) || undefined,
              scopeAllGroups: x.scopeAllGroups === true,
              groupIds: (x.groupIds as string[]) ?? [],
              fileUrl: (x.fileUrl as string) ?? '',
              status: (x.status as 'pending' | 'approved') ?? 'pending',
              size: Number(x.fileSizeBytes) || 0,
              durationSeconds: Number(x.durationSeconds) || 0,
            };
          })
        )
      ),
    []
  );

  const all = tracks ?? [];
  const approved = all.filter((t) => t.status === 'approved');
  const pending = all.filter((t) => t.status === 'pending');
  const bookName = (id?: string) => {
    const b = (books ?? []).find((x) => x.id === id);
    return b ? `${b.code ? `${b.code} — ` : ''}${b.title ?? ''}` : 'Other audio (no book)';
  };
  const melodyList = useMemo(() => Array.from(new Set(all.map((t) => t.melodyLabel).filter((m): m is string => !!m))).sort(), [all]);

  const term = search.trim().toLowerCase();
  const visible = all.filter((t) => {
    if (tab !== 'all' && t.status !== tab) return false;
    if (book && (book === '__none__' ? !!t.qacaidId : t.qacaidId !== book)) return false;
    if (melody && t.melodyLabel !== melody) return false;
    if (level && (level === '__none__' ? !!t.levelId : t.levelId !== level)) return false;
    if (kurel && !t.scopeAllGroups && !t.groupIds.includes(kurel)) return false;
    return !term || `${t.title} ${t.melodyLabel ?? ''} ${bookName(t.qacaidId)}`.toLowerCase().includes(term);
  });
  const anyFilter = !!(search || book || melody || level || kurel);

  const scopeText = (t: Track) => (t.scopeAllGroups ? 'All kurels' : t.groupIds.map((g) => byId[g]?.name ?? g).join(', ') || '—');

  function play(t: Track) {
    setPlaying(t);
    window.setTimeout(() => audioRef.current?.play().catch(() => undefined), 0);
  }
  async function validate(t: Track) {
    setBusy(t.id);
    try {
      await reviewAudioTrack({ trackId: t.id });
      notify('Audio validated', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not validate', 'error');
    } finally {
      setBusy('');
    }
  }

  const clear = () => { setSearch(''); setBook(''); setMelody(''); setLevel(''); setKurel(''); };
  const manage = () => setManageSignal((n) => n + 1);
  const bookTitle = (t: Track) => bookName(t.qacaidId);
  const tone = (t: Track) => (t.status === 'approved' ? 'ok' : 'gold');

  const cols: EbCol<Track>[] = [
    { key: 'play', label: tx("Play"), width: '7%', onCell: play, hint: tx("Play"), render: () => <span className="eb2-play"><Play size={15} fill="currentColor" /></span> },
    { key: 'book', label: tx("Book"), width: '22%', stack: true, sort: (t) => bookTitle(t).toLowerCase(), onCell: (t) => setBook(t.qacaidId ?? '__none__'), hint: tx("Show only this book"), render: (t) => <b>{bookTitle(t)}</b> },
    { key: 'melody', label: tx("Melody"), width: '14%', sort: (t) => (t.melodyLabel ?? t.title).toLowerCase(), onCell: (t) => { if (t.melodyLabel) setMelody(t.melodyLabel); else play(t); }, hint: tx("Show only this melody"), render: (t) => <span>{t.melodyLabel ?? t.title}</span> },
    { key: 'level', label: tx("Level"), width: '11%', sort: (t) => levelById[t.levelId ?? '']?.rank ?? 99, onCell: (t) => setLevel(t.levelId ?? '__none__'), hint: tx("Show only this level"), render: (t) => (t.levelId && levelById[t.levelId] ? <EbPill tone="ok">{levelById[t.levelId].name}</EbPill> : <EbPill tone="info">{tx("Everyone")}</EbPill>) },
    { key: 'scope', label: tx("Available to"), width: '16%', sort: (t) => scopeText(t).toLowerCase(), onCell: (t) => { if (!t.scopeAllGroups && t.groupIds[0]) setKurel(t.groupIds[0]); else manage(); }, hint: tx("Show the audio of this kurel"), render: (t) => <span>{scopeText(t)}</span> },
    { key: 'length', label: tx("Length"), width: '8%', num: true, sort: (t) => t.durationSeconds, onCell: play, hint: tx("Play"), render: (t) => (t.durationSeconds ? <span>{formatDuration(t.durationSeconds)}</span> : <EbPill tone="red">{tx("No length")}</EbPill>) },
    { key: 'size', label: tx("Size"), width: '7%', num: true, sort: (t) => t.size, onCell: (t) => window.open(t.fileUrl, '_blank'), hint: tx("Download"), render: (t) => <span>{mb(t.size)}</span> },
    { key: 'status', label: tx("Status"), width: '9%', sort: (t) => t.status, onCell: (t) => setTab(t.status), hint: tx("Show only this status"), render: (t) => <EbPill tone={tone(t)}>{t.status === 'approved' ? tx("Approved") : tx("Waiting")}</EbPill> },
    { key: 'actions', label: tx("Actions"), width: '16%', actions: true, render: (t) => (
      <span className="eb2-acts-row">
        {t.status === 'pending' && <button type="button" className="eb2-bt pri" disabled={busy === t.id} onClick={() => void validate(t)}><CheckCircle2 size={14} /> {tx("Validate")}</button>}
        <a href={t.fileUrl} target="_blank" rel="noreferrer" className="eb2-ibt" aria-label={tx("Download")} title={tx("Download")}><Download size={15} /></a>
        <button type="button" className="eb2-ibt blue" aria-label={tx("Edit")} title={tx("Edit")} onClick={manage}><Pencil size={15} /></button>
      </span>
    ) },
  ];

  return (
    <>
      <div className="eb2">
        <EbHero title={tx("Audio library")} sub={tx("Each audio is a version of a book, labelled with its melody. Upload it, give it a level, choose the kurels that can use it, then validate it.")}>
          <button type="button" className="gold" onClick={manage}>+ {tx("Upload audio")}</button>
        </EbHero>

        <EbTiles items={[
          { icon: <CheckCircle2 size={26} />, label: tx("Approved audio"), value: approved.length, on: tab === 'approved', onClick: () => setTab('approved') },
          { icon: <Clock size={26} />, label: tx("Waiting for validation"), value: pending.length, on: tab === 'pending', onClick: () => setTab('pending') },
          { icon: <Library size={26} />, label: tx("Books with audio"), value: new Set(all.map((t) => t.qacaidId).filter(Boolean)).size, onClick: () => { setTab('all'); setBook(''); } },
          { icon: <Music2 size={26} />, label: tx("Melodies"), value: melodyList.length, onClick: () => { setTab('all'); setMelody(''); } },
        ]} />

        <EbTabs value={tab} onChange={(v) => setTab(v as 'approved' | 'pending' | 'all')} items={[{ value: 'approved', label: tx("Approved audio"), count: approved.length }, { value: 'pending', label: tx("Waiting for validation"), count: pending.length }, { value: 'all', label: tx("All"), count: all.length }]} />

        <EbBar active={anyFilter} onClear={clear}>
          <EbSearch value={search} onChange={setSearch} placeholder={tx("Search a book or a melody")} />
          <Dropdown label={tx("Book")} value={book} onChange={setBook} allLabel={tx("All books")} options={[...(books ?? []).map((b) => ({ value: b.id, label: `${b.code ? `${b.code} — ` : ''}${b.title ?? ''}` })), { value: '__none__', label: tx("Audio with no book") }]} className="eb2-dd" />
          <Dropdown label={tx("Melody")} value={melody} onChange={setMelody} allLabel={tx("All melodies")} options={melodyList.map((m) => ({ value: m, label: m }))} className="eb2-dd" />
          <Dropdown label={tx("Level")} value={level} onChange={setLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level (everyone)") }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} className="eb2-dd" />
          <Dropdown label={tx("Kurel")} value={kurel} onChange={setKurel} allLabel={tx("All kurels")} options={activeLeafGroups.map((g) => ({ value: g.id, label: g.name }))} className="eb2-dd" />
        </EbBar>

        {playing && (
          <div className="eb2-player">
            <strong>{playing.title}</strong>
            <audio ref={audioRef} src={playing.fileUrl} controls />
            <button type="button" className="eb2-bt" onClick={() => setPlaying(null)}>{tx("Close")}</button>
          </div>
        )}

        <EbPanel icon={<Music2 size={20} />} title={tx("Audio")} count={anyFilter || tab !== 'all' ? `${visible.length} / ${all.length}` : all.length}>
          <EbTable rows={visible} cols={cols} rowKey={(t) => t.id} loading={tracks === null} initialSort={{ key: 'book', dir: 'asc' }} empty={all.length === 0 ? tx("No audio yet. Click \"Upload audio\" to add the first one.") : tx("No audio matches these filters.")} />
        </EbPanel>
      </div>

      <ManageToggle title={tx("Manage audio — upload, change levels and kurels")} openSignal={manageSignal}>
        <AudioManage />
      </ManageToggle>
    </>
  );
}

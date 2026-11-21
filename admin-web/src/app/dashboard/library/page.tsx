'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Download, Eye, Layers, Share2, Music2, Library } from 'lucide-react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import ManageToggle from '../../px/ManageToggle';
import LibraryManage from './Manage';
import Dropdown from '@/components/Dropdown';
import { EbBar, EbHero, EbPanel, EbPill, EbSearch, EbTable, EbTiles, type EbCol } from '@/components/Eb';
import { tx } from '@/lib/i18n/tr';

interface Material {
  id: string;
  code: string;
  title: string;
}
interface Book {
  id: string;
  qacaidId: string;
  levelId?: string;
  label: string;
  fileUrl: string;
  size: number;
  durationSeconds: number;
  downloadable: boolean;
  downloads: number;
}
interface Share {
  id: string;
  editionId: string;
  scopeType: 'group' | 'user';
  scopeId: string;
  right: 'download' | 'read_only';
}

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

/** Book library — the approved layout on Firebase data. */
export default function LibraryPage() {
  const { byId: groupById } = useGroupHierarchy();
  const { levels, byId: levelById } = useLevels();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [access, setAccess] = useState('');
  const [work, setWork] = useState('');
  const [kurelF, setKurelF] = useState('');
  const [shType, setShType] = useState('');
  const [shRight, setShRight] = useState('');
  const router = useRouter();
  const [audios, setAudios] = useState<{ qacaidId?: string; status?: string }[]>([]);
  const [manageSignal, setManageSignal] = useState(0);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'qacaid'), orderBy('code')), (snap) =>
      setMaterials(snap.docs.map((d) => ({ id: d.id, code: (d.data().code as string) ?? '', title: (d.data().title as string) ?? '' })))
    );
    const u2 = onSnapshot(query(collection(db, 'qacaidEditions'), orderBy('createdAt', 'desc')), (snap) =>
      setBooks(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            qacaidId: x.qacaidId as string,
            levelId: (x.levelId as string) || undefined,
            label: (x.label as string) ?? '',
            fileUrl: (x.fileUrl as string) ?? '',
            size: Number(x.fileSizeBytes) || 0,
            durationSeconds: Number(x.durationSeconds) || 0,
            downloadable: x.downloadable !== false,
            downloads: Number(x.downloadsCount) || 0,
          };
        })
      )
    );
    const u4 = onSnapshot(collection(db, 'audioTracks'), (snap) => setAudios(snap.docs.map((d) => ({ qacaidId: d.data().qacaidId as string | undefined, status: d.data().status as string | undefined }))));
    const u3 = onSnapshot(collection(db, 'libraryShares'), (snap) =>
      setShares(
        snap.docs.map((d) => ({
          id: d.id,
          editionId: d.data().editionId as string,
          scopeType: d.data().scopeType as 'group' | 'user',
          scopeId: d.data().scopeId as string,
          right: d.data().right as 'download' | 'read_only',
        }))
      )
    );
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, []);

  const matById = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const shareCount = useMemo(() => {
    const m: Record<string, number> = {};
    shares.forEach((s) => (m[s.editionId] = (m[s.editionId] ?? 0) + 1));
    return m;
  }, [shares]);

  const sharedWith = (id: string) => shares.some((x) => x.editionId === id && x.scopeType === 'group' && x.scopeId === kurelF);
  const audioCount = (qid: string) => audios.filter((a) => a.qacaidId === qid && a.status === 'approved').length;
  const term = search.trim().toLowerCase();
  const rows = books.filter((b) => {
    const mat = matById[b.qacaidId];
    if (work && b.qacaidId !== work) return false;
    if (kurelF && !sharedWith(b.id)) return false;
    if (level && (level === '__none__' ? !!b.levelId : b.levelId !== level)) return false;
    if (access === 'download' && !b.downloadable) return false;
    if (access === 'read' && b.downloadable) return false;
    return !term || `${mat?.title ?? ''} ${mat?.code ?? ''} ${b.label}`.toLowerCase().includes(term);
  });
  const anyFilter = !!(search || level || access || work || kurelF);
  const clear = () => { setSearch(''); setLevel(''); setAccess(''); setWork(''); setKurelF(''); };
  const bookById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
  const leafGroups = Object.values(groupById).filter((g) => g.type === 'group');
  const openShares = () => document.getElementById('shares')?.scrollIntoView({ behavior: 'smooth' });
  const manage = () => setManageSignal((n) => n + 1);
  const approvedAudio = audios.filter((a) => a.status === 'approved').length;

  const cols: EbCol<Book>[] = [
    { key: 'book', label: tx("Book"), width: '20%', stack: true, sort: (b) => (matById[b.qacaidId]?.title ?? '').toLowerCase(), onCell: (b) => setWork(work === b.qacaidId ? '' : b.qacaidId), hint: tx("Show only this book"), render: (b) => <><b>{matById[b.qacaidId]?.title ?? '—'}</b><small>{matById[b.qacaidId]?.code}</small></> },
    { key: 'edition', label: tx("Edition"), width: '12%', sort: (b) => b.label.toLowerCase(), onCell: () => manage(), hint: tx("Manage this edition"), render: (b) => <span>{b.label || '—'}</span> },
    { key: 'level', label: tx("Level"), width: '13%', sort: (b) => levelById[b.levelId ?? '']?.rank ?? 99, onCell: (b) => setLevel(b.levelId ?? '__none__'), hint: tx("Show only this level"), render: (b) => (b.levelId && levelById[b.levelId] ? <EbPill tone="ok">{levelById[b.levelId].name}</EbPill> : <EbPill tone="info">{tx("Everyone")}</EbPill>) },
    { key: 'audio', label: tx("Audio versions"), width: '10%', num: true, sort: (b) => audioCount(b.qacaidId), onCell: () => router.push('/dashboard/audio'), hint: tx("Open the audio library"), render: (b) => <EbPill tone="teal">{audioCount(b.qacaidId)}</EbPill> },
    { key: 'shared', label: tx("Shared with"), width: '12%', sort: (b) => shareCount[b.id] ?? 0, onCell: () => { openShares(); }, hint: tx("Show the shares"), render: (b) => <span>{shareCount[b.id] ?? 0} {tx("share")}{(shareCount[b.id] ?? 0) === 1 ? '' : 's'}</span> },
    { key: 'size', label: tx("Size"), width: '8%', num: true, sort: (b) => b.size, onCell: (b) => window.open(b.fileUrl, '_blank'), hint: tx("Preview the file"), render: (b) => <span>{mb(b.size)}</span> },
    { key: 'downloads', label: tx("Downloads"), width: '9%', num: true, sort: (b) => b.downloads, onCell: (b) => { setAccess(b.downloadable ? 'download' : 'read'); }, hint: tx("Show books with the same access"), render: (b) => <span>{b.downloads}</span> },
    { key: 'actions', label: tx("Actions"), width: '16%', actions: true, render: (b) => <span className="eb2-acts-row"><a href={b.fileUrl} target="_blank" rel="noreferrer" className="eb2-ibt" aria-label={tx("Preview")} title={tx("Preview")}><Eye size={15} /></a><button type="button" className="eb2-ibt" aria-label={tx("Download")} title={tx("Download")} disabled={!b.downloadable} onClick={() => window.open(b.fileUrl, '_blank')}><Download size={15} /></button><button type="button" className="eb2-ibt blue" aria-label={tx("Share")} title={tx("Share")} onClick={manage}><Share2 size={15} /></button></span> },
  ];

  const shareRows = shares.filter((s) => (!shType || s.scopeType === shType) && (!shRight || s.right === shRight) && (!work || bookById[s.editionId]?.qacaidId === work));
  const shareCols: EbCol<Share>[] = [
    { key: 'book', label: tx("Book"), width: '30%', stack: true, sort: (s) => (matById[bookById[s.editionId]?.qacaidId ?? '']?.title ?? '').toLowerCase(), onCell: (s) => { const q = bookById[s.editionId]?.qacaidId; if (q) setWork(work === q ? '' : q); }, hint: tx("Show only this book"), render: (s) => <><b>{matById[bookById[s.editionId]?.qacaidId ?? '']?.title ?? '—'}</b><small>{bookById[s.editionId]?.label}</small></> },
    { key: 'with', label: tx("Shared with"), width: '30%', sort: (s) => (s.scopeType === 'group' ? groupById[s.scopeId]?.name ?? s.scopeId : s.scopeId).toLowerCase(), onCell: (s) => { if (s.scopeType === 'group') setKurelF(kurelF === s.scopeId ? '' : s.scopeId); }, hint: tx("Show the books shared with this kurel"), render: (s) => <span>{s.scopeType === 'group' ? groupById[s.scopeId]?.name ?? s.scopeId : s.scopeId}</span> },
    { key: 'type', label: tx("Type"), width: '18%', sort: (s) => s.scopeType, onCell: (s) => setShType(shType === s.scopeType ? '' : s.scopeType), hint: tx("Show only this type"), render: (s) => <EbPill tone={s.scopeType === 'group' ? 'ok' : 'teal'}>{s.scopeType === 'group' ? tx("Kurel") : tx("Member")}</EbPill> },
    { key: 'right', label: tx("Right"), width: '22%', sort: (s) => s.right, onCell: (s) => setShRight(shRight === s.right ? '' : s.right), hint: tx("Show only this right"), render: (s) => <EbPill tone={s.right === 'download' ? 'gold' : ''}>{s.right === 'download' ? tx("Read and download") : tx("Read only")}</EbPill> },
  ];

  return (
    <>
      <div className="eb2">
        <EbHero title={tx("Book library")} sub={tx("Books, the level each one belongs to, who it is shared with, and its audio versions.")}>
          <button type="button" className="ghost" onClick={openShares}><Share2 size={16} /> {tx("Shares")}</button>
          <button type="button" className="gold" onClick={manage}>+ {tx("Add a book")}</button>
        </EbHero>

        <EbTiles items={[
          { icon: <BookOpen size={26} />, label: tx("Books"), value: materials.length, on: !anyFilter, onClick: clear },
          { icon: <Library size={26} />, label: tx("Editions (PDF files)"), value: books.length, onClick: clear },
          { icon: <Music2 size={26} />, label: tx("Audio versions"), value: approvedAudio, onClick: () => router.push('/dashboard/audio') },
          { icon: <Layers size={26} />, label: tx("Shares"), value: shares.length, onClick: openShares },
        ]} />

        <EbBar active={anyFilter} onClear={clear}>
          <EbSearch value={search} onChange={setSearch} placeholder={tx("Search a book or an edition")} />
          <Dropdown label={tx("Book")} value={work} onChange={setWork} allLabel={tx("All books")} options={materials.map((m) => ({ value: m.id, label: `${m.code ? `${m.code} — ` : ''}${m.title}` }))} className="eb2-dd" />
          <Dropdown label={tx("Level")} value={level} onChange={setLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level (everyone)") }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} className="eb2-dd" />
          <Dropdown label={tx("Shared with")} value={kurelF} onChange={setKurelF} allLabel={tx("Shared with any kurel")} options={leafGroups.map((g) => ({ value: g.id, label: g.name }))} className="eb2-dd" />
          <Dropdown label={tx("Access")} value={access} onChange={setAccess} allLabel={tx("All access")} options={[{ value: 'download', label: tx("Can be downloaded") }, { value: 'read', label: tx("Read only") }]} className="eb2-dd" />
        </EbBar>

        <EbPanel icon={<BookOpen size={20} />} title={tx("Books")} count={anyFilter ? `${rows.length} / ${books.length}` : books.length}>
          <EbTable rows={rows} cols={cols} rowKey={(b) => b.id} empty={books.length === 0 ? tx("No book yet. Click \"Add a book\".") : tx("No book matches these filters.")} />
        </EbPanel>

        <EbPanel id="shares" icon={<Share2 size={20} />} title={tx("Shares")} count={shareRows.length === shares.length ? shares.length : `${shareRows.length} / ${shares.length}`}
          actions={(shType || shRight || work) ? <button type="button" className="eb2-bt" onClick={() => { setShType(''); setShRight(''); setWork(''); }}>{tx("Clear all")}</button> : undefined}>
          <EbTable rows={shareRows} cols={shareCols} rowKey={(s) => s.id} empty={shares.length === 0 ? tx("Nothing is shared yet.") : tx("No share matches these filters.")} />
        </EbPanel>
      </div>

      <ManageToggle title={tx("Manage the library — upload, level, share")} openSignal={manageSignal}>
        <LibraryManage />
      </ManageToggle>
    </>
  );
}

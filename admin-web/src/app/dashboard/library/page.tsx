'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Download, Eye, Layers, Share2, Music2, LayoutGrid, Bookmark, Users, UserRound, BarChart3, Zap, UserPlus, Upload, Radio, ChevronLeft, ChevronRight, Check, Circle, Headphones, Play, Search, MoreVertical, SlidersHorizontal } from 'lucide-react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import { useZones } from '@/lib/useZones';
import ManageToggle from '../../px/ManageToggle';
import LibraryManage from './Manage';
import Dropdown from '@/components/Dropdown';
import { EbPanel, EbPill, EbTable, type EbCol } from '@/components/Eb';
import { CxBanner, CxStats, CxTabs } from '@/components/Cx';
import Link from 'next/link';
import { tx } from '@/lib/i18n/tr';

interface Material {
  id: string;
  code: string;
  title: string;
  artist?: string;
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
  const { byId: groupById, locationOf, countries, cities } = useGroupHierarchy();
  const zones = useZones() ?? [];
  const { levels, byId: levelById } = useLevels();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [access, setAccess] = useState('');
  const [work, setWork] = useState('');
  const [kurelF, setKurelF] = useState('');
  const [country, setCountry] = useState('');
  const [cityF, setCityF] = useState('');
  const [zoneF, setZoneF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [adv, setAdv] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [shType, setShType] = useState('');
  const [shRight, setShRight] = useState('');
  const router = useRouter();
  const [audios, setAudios] = useState<{ qacaidId?: string; status?: string }[]>([]);
  const [manageSignal, setManageSignal] = useState(0);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'qacaid'), orderBy('code')), (snap) =>
      setMaterials(snap.docs.map((d) => ({ id: d.id, code: (d.data().code as string) ?? '', title: (d.data().title as string) ?? '', artist: ((d.data().artist ?? d.data().interpreter) as string | undefined) || undefined })))
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
    if (statusF === 'assigned' && !(shareCount[b.id] > 0)) return false;
    if (statusF === 'none' && (shareCount[b.id] ?? 0) > 0) return false;
    if (country || cityF || zoneF) {
      const gs = shares.filter((x) => x.editionId === b.id && x.scopeType === 'group').map((x) => x.scopeId);
      if (!gs.some((g) => (!country || locationOf(g).country?.id === country) && (!cityF || locationOf(g).city?.id === cityF) && (!zoneF || groupById[g]?.zoneId === zoneF))) return false;
    }
    if (access === 'download' && !b.downloadable) return false;
    if (access === 'read' && b.downloadable) return false;
    return !term || `${mat?.title ?? ''} ${mat?.artist ?? ''} ${mat?.code ?? ''} ${b.label}`.toLowerCase().includes(term);
  });
  const anyFilter = !!(search || level || access || work || kurelF || country || cityF || zoneF || statusF);
  const clear = () => { setSearch(''); setLevel(''); setAccess(''); setWork(''); setKurelF(''); setCountry(''); setCityF(''); setZoneF(''); setStatusF(''); };
  const bookById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
  const leafGroups = Object.values(groupById).filter((g) => g.type === 'group');
  const openShares = () => document.getElementById('shares')?.scrollIntoView({ behavior: 'smooth' });
  const manage = () => setManageSignal((n) => n + 1);
  const approvedAudio = audios.filter((a) => a.status === 'approved').length;

  const mmss = (sec: number) => (sec > 0 ? `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '—');
  const [page, setPage] = useState(1);
  const PAGE_N = 8;
  useEffect(() => { setPage(1); setPicked([]); }, [search, level, access, work, kurelF, country, cityF, zoneF, statusF]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_N));
  const shownRows = rows.slice((page - 1) * PAGE_N, page * PAGE_N);
  const assignedBooks = books.filter((b) => (shareCount[b.id] ?? 0) > 0).length;
  const pctB = (n: number) => (books.length ? Math.round((n / books.length) * 1000) / 10 : 0);
  const withAudio = books.filter((b) => audioCount(b.qacaidId) > 0).length;
  const multiAudio = books.filter((b) => audioCount(b.qacaidId) > 1).length;
  function exportCsv() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Book', 'Artist', 'Reference', 'Edition', 'Level', 'Duration', 'Audio versions', 'Shares'].join(',')].concat(rows.map((b) => [matById[b.qacaidId]?.title ?? '', matById[b.qacaidId]?.artist ?? '', matById[b.qacaidId]?.code ?? '', b.label, levelById[b.levelId ?? '']?.name ?? '', mmss(b.durationSeconds), audioCount(b.qacaidId), shareCount[b.id] ?? 0].map(esc).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'library.csv';
    a.click();
  }

  const shareRows = shares.filter((s) => (!shType || s.scopeType === shType) && (!shRight || s.right === shRight) && (!work || bookById[s.editionId]?.qacaidId === work));
  const shareCols: EbCol<Share>[] = [
    { key: 'book', label: tx("Book"), width: '30%', stack: true, sort: (s) => (matById[bookById[s.editionId]?.qacaidId ?? '']?.title ?? '').toLowerCase(), onCell: (s) => { const q = bookById[s.editionId]?.qacaidId; if (q) setWork(work === q ? '' : q); }, hint: tx("Show only this book"), render: (s) => <><b>{matById[bookById[s.editionId]?.qacaidId ?? '']?.title ?? '—'}</b><small>{bookById[s.editionId]?.label}</small></> },
    { key: 'with', label: tx("Shared with"), width: '30%', sort: (s) => (s.scopeType === 'group' ? groupById[s.scopeId]?.name ?? s.scopeId : s.scopeId).toLowerCase(), onCell: (s) => { if (s.scopeType === 'group') setKurelF(kurelF === s.scopeId ? '' : s.scopeId); }, hint: tx("Show the books shared with this kurel"), render: (s) => <span>{s.scopeType === 'group' ? groupById[s.scopeId]?.name ?? s.scopeId : s.scopeId}</span> },
    { key: 'type', label: tx("Type"), width: '18%', sort: (s) => s.scopeType, onCell: (s) => setShType(shType === s.scopeType ? '' : s.scopeType), hint: tx("Show only this type"), render: (s) => <EbPill tone={s.scopeType === 'group' ? 'ok' : 'teal'}>{s.scopeType === 'group' ? tx("Kurel") : tx("Member")}</EbPill> },
    { key: 'right', label: tx("Right"), width: '22%', sort: (s) => s.right, onCell: (s) => setShRight(shRight === s.right ? '' : s.right), hint: tx("Show only this right"), render: (s) => <EbPill tone={s.right === 'download' ? 'gold' : ''}>{s.right === 'download' ? tx("Read and download") : tx("Read only")}</EbPill> },
  ];

  return (
    <>
      <div className="px cx-page lb">
        <CxBanner icon={<BookOpen size={30} />} kicker={tx("Comité Pédagogique")} title={tx("Book & Melody Library")} sub={tx("Central library of all approved books and their audio versions. Manage, organize and assign to groups.")}>
          <button type="button" className="cx-btn gold" onClick={manage}><span aria-hidden>+</span> {tx("Add to Library")}</button>
        </CxBanner>
        <CxTabs value="library" onChange={(v) => { if (v === 'assignments') router.push('/dashboard/programme-pedagogique'); else if (v === 'audio') router.push('/dashboard/audio'); else if (v === 'artists') router.push('/dashboard/event-books'); else if (v === 'reports') router.push('/dashboard/reports'); else if (v === 'collections') openShares(); }} items={[
          { value: 'library', label: tx("Library"), icon: <LayoutGrid size={18} /> },
          { value: 'assignments', label: tx("Assignments"), icon: <Layers size={18} /> },
          { value: 'collections', label: tx("Collections"), icon: <Bookmark size={18} /> },
          { value: 'artists', label: tx("Artists"), icon: <UserRound size={18} /> },
          { value: 'audio', label: tx("Audio Versions"), icon: <Music2 size={18} /> },
          { value: 'reports', label: tx("Reports"), icon: <BarChart3 size={18} /> },
        ]} />
        <CxStats cols={5} items={[
          { icon: <BookOpen size={24} />, tone: 'amber', label: tx("Total Books"), value: materials.length, onClick: clear },
          { icon: <Music2 size={24} />, tone: 'amber', label: tx("Audio Versions"), value: approvedAudio, onClick: () => router.push('/dashboard/audio') },
          { icon: <Users size={24} />, tone: 'green', label: tx("Assigned to Groups"), value: assignedBooks, badge: `${pctB(assignedBooks)}%`, onClick: openShares },
          { icon: <Layers size={24} />, tone: 'amber', label: tx("Available (Not Assigned)"), value: books.length - assignedBooks, badge: `${pctB(books.length - assignedBooks)}%` },
          { icon: <Share2 size={24} />, tone: 'green', label: tx("Total Shares"), value: shares.length, onClick: openShares },
        ]} />

        <div className="lb-grid">
          <section className="lb-main">
            <header className="lb-h">
              <div><i><BookOpen size={24} /></i><span><h2>{tx("Library of Books")}</h2><p>{tx("All approved books with their official audio versions and details.")}</p></span></div>
              <label className="lb-s"><Search size={16} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx("Search by title, artist or reference…")} /></label>
            </header>
            <div className="lb-f">
              <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCityF(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
              <Dropdown label={tx("City")} value={cityF} onChange={setCityF} allLabel={tx("All cities")} options={cities.filter((c) => !country || c.parentGroupId === country).map((c) => ({ value: c.id, label: c.name }))} />
              <Dropdown label={tx("Zone")} value={zoneF} onChange={setZoneF} allLabel={tx("All zones")} options={zones.filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }))} />
              <Dropdown label={tx("Level")} value={level} onChange={setLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level (everyone)") }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} />
              <Dropdown label={tx("Status")} value={statusF} onChange={setStatusF} allLabel={tx("All statuses")} options={[{ value: 'assigned', label: tx("Assigned") }, { value: 'none', label: tx("Not Assigned") }]} />
              <button type="button" className={`lb-adv${adv || work || kurelF || access ? ' on' : ''}`} onClick={() => setAdv((v) => !v)} aria-expanded={adv}><SlidersHorizontal size={16} />{tx("Advanced filters")}</button>
              {(adv || work || kurelF || access) && (<div className="lb-f2">
                <Dropdown label={tx("Book")} value={work} onChange={setWork} allLabel={tx("All books")} options={materials.map((m) => ({ value: m.id, label: `${m.code ? `${m.code} — ` : ''}${m.title}` }))} />
                <Dropdown label={tx("Shared with")} value={kurelF} onChange={setKurelF} allLabel={tx("Any kurel")} options={leafGroups.map((g) => ({ value: g.id, label: g.name }))} />
                <Dropdown label={tx("Access")} value={access} onChange={setAccess} allLabel={tx("All access")} options={[{ value: 'download', label: tx("Can be downloaded") }, { value: 'read', label: tx("Read only") }]} />
              </div>)}
              {anyFilter && <button type="button" className="lb-clear" onClick={clear}>{tx("Clear all")}</button>}
            </div>
            {picked.length > 0 && <div className="lb-pick"><b>{picked.length} {tx("selected")}</b><button type="button" onClick={manage}><UserPlus size={15} />{tx("Quick Assign to Groups")}</button><button type="button" onClick={() => setPicked([])}>{tx("Clear")}</button></div>}
            <div className="lb-t">
              <table>
                <thead><tr><th><input type="checkbox" aria-label={tx("Select all")} checked={shownRows.length > 0 && shownRows.every((b) => picked.includes(b.id))} onChange={(e) => setPicked(e.target.checked ? shownRows.map((b) => b.id) : [])} /></th><th>{tx("Title (Book)")}</th><th>{tx("Artist / Interpreter")}</th><th>{tx("Ref.")}</th><th>{tx("Duration")}</th><th>{tx("Audio versions")}</th><th>{tx("Assigned to")}</th><th>{tx("Status")}</th><th>{tx("Actions")}</th></tr></thead>
                <tbody>
                  {shownRows.length === 0 && <tr><td colSpan={9} className="lb-none">{books.length === 0 ? tx("No book yet. Click \"Add to Library\".") : tx("No book matches these filters.")}</td></tr>}
                  {shownRows.map((b) => {
                    const n = shareCount[b.id] ?? 0;
                    const a = audioCount(b.qacaidId);
                    return (
                      <tr key={b.id}>
                        <td><input type="checkbox" aria-label={matById[b.qacaidId]?.title ?? ''} checked={picked.includes(b.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} /></td>
                        <td><button type="button" className="lb-ti" onClick={() => setWork(work === b.qacaidId ? '' : b.qacaidId)}><i><BookOpen size={16} /></i><span><b>{matById[b.qacaidId]?.title ?? '—'}</b>{b.label && <small>{b.label}</small>}</span></button></td>
                        <td>{matById[b.qacaidId]?.artist ? <span className="lb-art"><UserRound size={14} />{matById[b.qacaidId]?.artist}</span> : '—'}</td>
                        <td><span className="lb-ref">{matById[b.qacaidId]?.code || '—'}</span></td>
                        <td><span className="lb-du"><Play size={13} /> {mmss(b.durationSeconds)}</span></td>
                        <td><button type="button" className="lnk" onClick={() => router.push('/dashboard/audio')}><Headphones size={14} /> {a} {a === 1 ? tx("version") : tx("versions")}</button></td>
                        <td>{n > 0 ? <button type="button" className="lnk" onClick={() => { openShares(); setWork(b.qacaidId); }}><Users size={14} /> {n} {n === 1 ? tx("share") : tx("shares")}</button> : '— —'}</td>
                        <td>{n > 0 ? <span className="lb-st ok"><Check size={14} /> {tx("Assigned")}</span> : <span className="lb-st"><Circle size={12} /> {tx("Not Assigned")}</span>}</td>
                        <td><span className="lb-ac"><button type="button" onClick={manage}>{tx("Assign")}</button><details className="lb-kb"><summary aria-label={tx("More actions")}><MoreVertical size={16} /></summary><div><a href={b.fileUrl} target="_blank" rel="noreferrer"><Eye size={15} />{tx("Preview")}</a>{b.downloadable && <a href={b.fileUrl} download><Download size={15} />{tx("Download")}</a>}</div></details></span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="lb-pg">
              <span>{tx("Showing")} {rows.length === 0 ? 0 : (page - 1) * PAGE_N + 1}–{Math.min(page * PAGE_N, rows.length)} {tx("of")} {rows.length} {tx("books")}</span>
              <span>
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={tx("Previous")}><ChevronLeft size={16} /></button>
                {Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === page ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
                {pages > 5 && <><em>…</em><button type="button" className={page === pages ? 'on' : ''} onClick={() => setPage(pages)}>{pages}</button></>}
                <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={tx("Next")}><ChevronRight size={16} /></button>
              </span>
            </div>
          </section>

          <aside className="lb-side">
            <section className="lb-card">
              <h3><Zap size={20} /> {tx("Quick Actions")}</h3>
              <button type="button" className="gold" onClick={manage}><UserPlus size={18} /> {tx("Quick Assign to Groups")} <ChevronRight size={16} /></button>
              <button type="button" onClick={manage}><Upload size={18} /> {tx("Upload Book / Audio")}</button>
              <Link href="/dashboard/programme-pedagogique"><Layers size={18} /> {tx("Create Collection / Program")}</Link>
              <Link href="/dashboard/messagerie"><Radio size={18} /> {tx("Notify Groups")}</Link>
              <button type="button" onClick={exportCsv}><Download size={18} /> {tx("Export Library (Excel)")}</button>
            </section>
            <section className="lb-card">
              <h3><BarChart3 size={20} /> {tx("Library Insights")}</h3>
              <dl>
                <div><dt>{tx("Books assigned")}</dt><dd><b>{assignedBooks}</b><em>{pctB(assignedBooks)}%</em></dd></div>
                <div><dt>{tx("Books not assigned")}</dt><dd><b>{books.length - assignedBooks}</b><em>{pctB(books.length - assignedBooks)}%</em></dd></div>
                <div><dt>{tx("Books with audio")}</dt><dd><b>{withAudio}</b><em>{pctB(withAudio)}%</em></dd></div>
                <div><dt>{tx("Multiple audio versions")}</dt><dd><b>{multiAudio}</b><em>{pctB(multiAudio)}%</em></dd></div>
              </dl>
            </section>
          </aside>
        </div>

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

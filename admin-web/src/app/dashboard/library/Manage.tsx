'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Plus, Share2, Trash2 } from 'lucide-react';
import { collection, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { createQacaid, createQacaidEdition as createEditionFn, shareQacaidEdition as shareEditionFn, revokeLibraryShare as revokeShareFn, setEditionLevel, deleteQacaid as deleteBookFn, deleteQacaidEdition as deleteFileFn } from '@/lib/functions';
import { useLevels } from '@/lib/useLevels';
import { notify } from '@/lib/notify';
import Dropdown from '@/components/Dropdown';
import { EbBar, EbDrop, EbHero, EbPanel, EbPill, EbSearch, EbTable, type EbCol } from '@/components/Eb';
import { tx } from '@/lib/i18n/tr';

interface BookRow { id: string; code: string; title: string; levelId?: string }
interface FileRow { id: string; qacaidId: string; label: string; fileUrl: string; levelId?: string; fileSizeBytes: number; downloadable: boolean; downloadsCount: number; durationSeconds?: number }
interface ShareRow { id: string; editionId: string; scopeType: 'group' | 'user'; scopeId: string; right: 'download' | 'read_only' }

const size = (b: number) => (b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** Add books, upload their PDF files, set levels and share them. Simple lists with filters. */
export default function LibraryManage() {
  const { levels, accessibleFrom } = useLevels();
  const { activeLeafGroups: leafGroups, byId: groupById } = useGroupHierarchy();
  const [books, setBooks] = useState<BookRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState('');
  const [fBook, setFBook] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [fAccess, setFAccess] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'qacaid'), orderBy('code', 'asc')), (snap) => setBooks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BookRow, 'id'>) }))));
    const u2 = onSnapshot(query(collection(db, 'qacaidEditions'), orderBy('createdAt', 'desc')), (snap) => {
      setFiles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FileRow, 'id'>) })));
      setLoading(false);
    });
    const u3 = onSnapshot(collection(db, 'libraryShares'), (snap) => setShares(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShareRow, 'id'>) }))));
    return () => { u1(); u2(); u3(); };
  }, []);

  // ---- delete ----
  async function deleteBook(id: string) {
    const b = books.find((x) => x.id === id);
    if (!window.confirm(`Delete the book "${b?.title ?? ''}"? This cannot be undone.`)) return;
    try {
      await deleteBookFn({ qacaidId: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete the book';
      if (/still has/.test(msg) && window.confirm(`${msg}\n\nDelete the book together with its files?`)) {
        try { await deleteBookFn({ qacaidId: id, deleteFiles: true }); } catch (e2) { notify(e2 instanceof Error ? e2.message : 'Could not delete the book', 'error'); return; }
      } else { if (!/still has/.test(msg)) notify(msg, 'error'); return; }
    }
    setFBook('');
    notify('Book deleted.', 'success');
  }
  async function deleteFile(id: string) {
    if (!window.confirm(tx("Delete this PDF file? This cannot be undone."))) return;
    try { await deleteFileFn({ editionId: id }); notify('File deleted.', 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Could not delete the file', 'error'); }
  }

  // ---- add a book with its PDF (one step: title, level, file) ----
  const [bTitle, setBTitle] = useState('');
  const [bLevel, setBLevel] = useState('');
  const [uFile, setUFile] = useState<File | null>(null);
  const [uDownloadable, setUDownloadable] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const normT = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  async function addBookWithFile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!bTitle.trim()) { setError(tx("Enter the book title.")); return; }
    if (!uFile) { setError(tx("Choose the PDF file.")); return; }
    setUploading(true);
    try {
      // A book with this title already exists: the file is added to it. Otherwise the book is created first.
      const existing = books.find((b) => normT(b.title) === normT(bTitle));
      const qacaidId = existing ? existing.id : (await createQacaid({ title: bTitle.trim(), levelId: bLevel || undefined })).data.qacaidId;
      const path = `qacaidEditions/${Date.now()}_${uFile.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, uFile, { contentType: 'application/pdf' });
      const fileUrl = await getDownloadURL(ref);
      await createEditionFn({ qacaidId, levelId: bLevel || undefined, label: uFile.name.replace(/\.pdf$/i, ''), fileUrl, filePath: path, fileSizeBytes: uFile.size, downloadable: uDownloadable });
      setBTitle(''); setBLevel(''); setUFile(null); setFileKey((k) => k + 1);
      notify(existing ? 'File added to the existing book.' : 'Book added with its PDF.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Could not add the book"));
    } finally {
      setUploading(false);
    }
  }

  // ---- sharing ----
  const [scopeType, setScopeType] = useState<'group' | 'user'>('group');
  const [scopeId, setScopeId] = useState('');
  const [right, setRight] = useState<'download' | 'read_only'>('download');
  async function share(id: string) {
    if (!scopeId.trim()) return;
    try { await shareEditionFn({ editionId: id, scopeType, scopeId: scopeId.trim(), right }); setScopeId(''); notify('Shared', 'success'); }
    catch (err) { setError(err instanceof Error ? err.message : tx("Could not share")); }
  }

  const term = search.trim().toLowerCase();
  const visible = files.filter((f) => {
    const b = books.find((x) => x.id === f.qacaidId);
    if (fBook && f.qacaidId !== fBook) return false;
    if (fLevel && (fLevel === '__none__' ? !!f.levelId : f.levelId !== fLevel)) return false;
    if (fAccess === 'download' && !f.downloadable) return false;
    if (fAccess === 'read' && f.downloadable) return false;
    return !term || `${b?.title ?? ''} ${b?.code ?? ''} ${f.label}`.toLowerCase().includes(term);
  });
  const anyFilter = !!(search || fBook || fLevel || fAccess);

  const clear = () => { setSearch(''); setFBook(''); setFLevel(''); setFAccess(''); };
  const levelOpts = levels.map((l) => ({ value: l.id, label: l.name }));
  const bookOf = (f: FileRow) => books.find((x) => x.id === f.qacaidId);
  const shareFile = files.find((f) => f.id === openId);
  const shareShares = shareFile ? shares.filter((s) => s.editionId === shareFile.id) : [];
  const openShare = (id: string) => { setOpenId(id); window.setTimeout(() => document.getElementById('lm-share')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); };

  const cols: EbCol<FileRow>[] = [
    { key: 'book', label: tx("Book"), width: '20%', stack: true, sort: (f) => (bookOf(f)?.title ?? '').toLowerCase(), onCell: (f) => setFBook(fBook === f.qacaidId ? '' : f.qacaidId), hint: tx("Show only this book"), render: (f) => <><b>{bookOf(f)?.title ?? '—'}</b><small>{bookOf(f)?.code}</small></> },
    { key: 'file', label: tx("File"), width: '14%', sort: (f) => (f.label ?? '').toLowerCase(), onCell: (f) => window.open(f.fileUrl, '_blank'), hint: tx("Open the file"), render: (f) => <span>{f.label}</span> },
    { key: 'level', label: tx("Level"), width: '20%', sort: (f) => f.levelId ?? '', render: (f) => (
      <Dropdown label={tx("Level")} value={f.levelId ?? ''} allLabel={tx("No level (everyone)")} options={levelOpts} className="eb2-dd" onChange={async (v) => { try { await setEditionLevel({ editionId: f.id, levelId: v }); } catch (err) { notify(err instanceof Error ? err.message : 'Could not change the level', 'error'); } }} />
    ) },
    { key: 'size', label: tx("Size"), width: '9%', num: true, sort: (f) => f.fileSizeBytes, render: (f) => <span>{size(f.fileSizeBytes)}</span> },
    { key: 'access', label: tx("Access"), width: '12%', sort: (f) => (f.downloadable ? 1 : 0), onCell: (f) => setFAccess(fAccess ? '' : f.downloadable ? 'download' : 'read'), hint: tx("Show books with the same access"), render: (f) => <EbPill tone={f.downloadable ? 'ok' : 'info'}>{f.downloadable ? tx("Download") : tx("Read only")}</EbPill> },
    { key: 'shared', label: tx("Shared"), width: '8%', num: true, sort: (f) => shares.filter((s) => s.editionId === f.id).length, onCell: (f) => openShare(f.id), hint: tx("Share this file"), render: (f) => <EbPill tone="teal">{shares.filter((s) => s.editionId === f.id).length}</EbPill> },
    { key: 'actions', label: tx("Actions"), width: '17%', actions: true, render: (f) => (
      <span className="eb2-acts-row">
        <a href={f.fileUrl} target="_blank" rel="noreferrer" className="eb2-ibt" aria-label={tx("Open")} title={tx("Open")}><ExternalLink size={15} /></a>
        <button type="button" className={`eb2-ibt blue`} aria-label={tx("Share")} title={tx("Share")} onClick={() => openShare(f.id)}><Share2 size={15} /></button>
        <button type="button" className="eb2-ibt red" aria-label={tx("Delete")} title={tx("Delete")} onClick={() => void deleteFile(f.id)}><Trash2 size={15} /></button>
      </span>
    ) },
  ];

  return (
    <div className="eb2">
      <EbHero title={tx("Manage the book library")} sub={tx("Add a book with its PDF, set its level, and share it with kurels.")} />
      {error && <p className="eb2-err" role="alert">{error}</p>}

      <div className="eb2-grid g11">
        <EbPanel icon={<Plus size={20} />} title={tx("Add a book")}>
          <form onSubmit={addBookWithFile} className="eb2-form">
            <div className="field"><label className="l" htmlFor="b-title">{tx("1. Book title *")}</label>
              <input id="b-title" type="text" required list="book-titles" value={bTitle} onChange={(e) => setBTitle(e.target.value)} placeholder={tx("For example: Quran")} />
              <datalist id="book-titles">{books.map((b) => <option key={b.id} value={b.title} />)}</datalist>
              {bTitle.trim() && books.some((b) => normT(b.title) === normT(bTitle)) && <small>{tx("This book already exists. The PDF will be added to it.")}</small>}
            </div>
            <Dropdown label={tx("2. Level (optional)")} value={bLevel} onChange={setBLevel} allLabel={tx("No level: available to everyone")} options={levels.map((l) => ({ value: l.id, label: `${l.name}${l.maxBooks !== null ? ` (max ${l.maxBooks} books)` : ''}` }))} />
            <div className="field"><label className="l">{tx("3. PDF file *")}</label>
              <EbDrop key={fileKey} accept="application/pdf" onFiles={(fl) => setUFile(fl[0] ?? null)} title={tx("Drop the PDF here or click to choose")} picked={uFile?.name} hint={uFile ? `${(uFile.size / 1048576).toFixed(1)} MB` : undefined} />
            </div>
            <div className="eb2-chips"><button type="button" className={uDownloadable ? 'on' : ''} aria-pressed={uDownloadable} onClick={() => setUDownloadable(!uDownloadable)}>{uDownloadable ? tx("Members can download it") : tx("Read only")}</button></div>
            <small>{tx("Members can download it (untick for read only)")}</small>
            <div className="eb2-form-act"><button type="submit" className="eb2-bt pri" disabled={uploading} style={{ padding: '13px 24px' }}><Plus size={15} /> {uploading ? tx("Saving…") : tx("Add the book")}</button></div>
          </form>
        </EbPanel>

        <EbPanel id="lm-share" icon={<Share2 size={20} />} title={shareFile ? `${tx("Shared with")} · ${bookOf(shareFile)?.title ?? ''} — ${shareFile.label}` : tx("Share a file")}
          actions={shareFile ? <button type="button" className="eb2-bt" onClick={() => setOpenId(null)}>{tx("Hide sharing")}</button> : undefined}>
          {!shareFile ? <p className="eb2-empty-row">{tx("Choose a file in the list below and click Share.")}</p> : (
            <>
              {shareShares.length === 0 ? <p className="eb2-empty-row">{tx("Not shared yet.")}</p> : (
                <div className="eb2-list">
                  {shareShares.map((sh, i) => (
                    <div key={sh.id} className="eb2-row" style={{ ['--c' as string]: ['#1e9d66', '#1f78d1', '#e8832f', '#7c4cc4'][i % 4], cursor: 'default' }}>
                      <span className="top"><b>{sh.scopeType === 'group' ? `${tx("Kurel")} ${groupById[sh.scopeId]?.name ?? sh.scopeId}` : `${tx("Member")} ${sh.scopeId}`}</b><span className="eb2-acts-row"><EbPill tone={sh.right === 'download' ? 'gold' : ''}>{sh.right === 'download' ? tx("read and download") : tx("read only")}</EbPill><button type="button" className="eb2-bt red" onClick={() => revokeShareFn({ shareId: sh.id })}>{tx("Remove")}</button></span></span>
                    </div>
                  ))}
                </div>
              )}
              <div className="eb2-form">
                <div className="eb2-inline">
                  <Dropdown label={tx("Share with")} value={scopeType} onChange={(v) => { setScopeType(v as 'group' | 'user'); setScopeId(''); }} options={[{ value: 'group', label: tx("A kurel") }, { value: 'user', label: tx("A member") }]} />
                  {scopeType === 'group' ? (
                    <Dropdown label={tx("Kurel")} value={scopeId} onChange={setScopeId} allLabel={tx("Choose a kurel…")} options={leafGroups.filter((g) => !shareFile.levelId || accessibleFrom(g.levelId).includes(shareFile.levelId)).map((g) => ({ value: g.id, label: g.name }))} />
                  ) : (
                    <div className="field" style={{ flex: '1 1 220px' }}><input type="text" placeholder={tx("Member ID")} value={scopeId} onChange={(e) => setScopeId(e.target.value)} style={{ minHeight: 52 }} /></div>
                  )}
                  <Dropdown label={tx("Right")} value={right} onChange={(v) => setRight(v as 'download' | 'read_only')} options={[{ value: 'download', label: tx("Read and download") }, { value: 'read_only', label: tx("Read only") }]} />
                </div>
                <div className="eb2-form-act"><button type="button" className="eb2-bt pri" disabled={!scopeId.trim()} onClick={() => share(shareFile.id)}><Share2 size={15} /> {tx("Share")}</button></div>
                <small>{shareFile.levelId ? tx("Only kurels whose level can access this book are listed.") : tx("This book has no level, so every kurel can be chosen.")}</small>
              </div>
            </>
          )}
        </EbPanel>
      </div>

      <EbBar active={anyFilter} onClear={clear}>
        <EbSearch value={search} onChange={setSearch} placeholder={tx("Search a book or a file")} />
        <Dropdown label={tx("Book")} value={fBook} onChange={setFBook} allLabel={tx("All books")} options={books.map((b) => ({ value: b.id, label: b.title }))} className="eb2-dd" />
        <Dropdown label={tx("Level")} value={fLevel} onChange={setFLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level (everyone)") }, ...levelOpts]} className="eb2-dd" />
        <Dropdown label={tx("Access")} value={fAccess} onChange={setFAccess} allLabel={tx("All access")} options={[{ value: 'download', label: tx("Can be downloaded") }, { value: 'read', label: tx("Read only") }]} className="eb2-dd" />
        {fBook && <button type="button" className="eb2-bt red" onClick={() => deleteBook(fBook)}><Trash2 size={14} /> {tx("Delete this book")}</button>}
      </EbBar>

      <EbPanel icon={<FileText size={20} />} title={tx("Uploaded files")} count={`${visible.length} ${tx("of")} ${files.length}`}>
        <EbTable rows={visible} cols={cols} rowKey={(f) => f.id} loading={loading} empty={files.length === 0 ? tx("No file yet.") : tx("No file matches these filters.")} rowClass={(f) => (f.id === openId ? 'open' : '')} />
      </EbPanel>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, CalendarClock, ChevronLeft, ChevronRight, Download, FileUp, Filter, Pencil, PenLine, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { deleteEventBook, importEventBooks, listEventBooks, saveEventBook, type EventBookRow, type ImportBooksResult } from '@/lib/functions';
import { useLevels } from '@/lib/useLevels';
import BookSuggestions from '@/components/BookSuggestions';
import { useMyScope } from '@/lib/useMyScope';
import { parseCsv } from '@/lib/csv';
import { downloadCsv } from '@/lib/download';
import Dropdown from '@/components/Dropdown';
import { useSort } from '@/components/kit';
import { notify } from '@/lib/notify';
import { tx, txf } from '@/lib/i18n/tr';

/** Hours and minutes: "1:30", or "1:30:15" when there are seconds. */
const clock = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60; const p = (n: number) => String(n).padStart(2, '0'); return r ? `${h}:${p(m)}:${p(r)}` : `${h}:${p(m)}`; };
const hours = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
/** Reads "1:30" (hours:minutes), "1:05:00" or minutes ("12.5") the way the server does, so the form can warn at once. */
function readLength(t: string): number | null {
  const s = t.trim().replace(',', '.');
  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) { if (Number(m[2]) > 59 || (m[3] && Number(m[3]) > 59)) return null; const v = m[3] === undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); return v > 0 ? v : null; }
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) { const v = Math.round(Number(m[1]) * 60); return v > 0 ? v : null; }
  return null;
}

const HEAD: Record<'title' | 'artist' | 'version' | 'duration' | 'level', string[]> = {
  title: ['book', 'book name', 'name', 'title', 'book title', 'livre', 'nom', 'nom du livre', 'titre'],
  artist: ['artist', 'artist name', 'singer', 'reciter', 'artiste', 'nom de lartiste', 'nom artiste'],
  version: ['version', 'edition', 'recording', 'enregistrement'],
  duration: ['duration', 'length', 'time', 'duree', 'durée', 'temps'],
  level: ['level', 'niveau'],
};
const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();

/** Turns the text of a CSV file (comma, semicolon or tab) into rows of { title, artist, duration, level }. */
function readFile(text: string) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const grid = parseCsv(text.replace(/^﻿/, ''), delimiter).filter((r) => r.some((c) => c.trim()));
  if (grid.length === 0) return [];
  const head = grid[0].map(norm);
  const find = (k: keyof typeof HEAD) => head.findIndex((h) => HEAD[k].map(norm).includes(h));
  const idx = { title: find('title'), artist: find('artist'), version: find('version'), duration: find('duration'), level: find('level') };
  const hasHeader = idx.title >= 0 || idx.duration >= 0;
  const col = hasHeader ? idx : { title: 0, artist: 1, version: -1, duration: 2, level: 3 };
  return grid.slice(hasHeader ? 1 : 0).map((r) => ({ title: r[col.title] ?? '', artist: col.artist >= 0 ? r[col.artist] ?? '' : '', version: col.version >= 0 ? r[col.version] ?? '' : '', duration: col.duration >= 0 ? r[col.duration] ?? '' : '', level: col.level >= 0 ? r[col.level] ?? '' : '' }));
}

const DUR: { v: string; label: string; test: (s: number) => boolean }[] = [
  { v: 'u30', label: 'Under 30 min', test: (s) => s < 1800 },
  { v: 'm30', label: '30 min to 1 h', test: (s) => s >= 1800 && s < 3600 },
  { v: 'h1', label: '1 h to 2 h', test: (s) => s >= 3600 && s < 7200 },
  { v: 'o2', label: 'Over 2 h', test: (s) => s >= 7200 },
];
const durKey = (s: number) => DUR.find((d) => d.test(s))?.v ?? '';
const PAGE = 10;
/** One colour per column: the header, the cells and the borders between them all use it. */
const COLS = [
  { k: 'title', c: '#1e9d66', b: '#e3f6ec' },
  { k: 'artist', c: '#1f78d1', b: '#e4f0fc' },
  { k: 'level', c: '#e8832f', b: '#fdebd9' },
  { k: 'duration', c: '#7c4cc4', b: '#efe8fa' },
  { k: 'actions', c: '#1aa3b8', b: '#e0f5f8' },
] as const;

export default function EventBooksPage() {
  const { levels, byId: levelById } = useLevels();
  const { scope } = useMyScope();
  const readOnly = scope?.role === 'group_manager';
  const [books, setBooks] = useState<EventBookRow[] | null>(null);
  const [err, setErr] = useState('');
  /** What the filter bar shows (draft) and what is applied to the table. */
  const [d, setD] = useState({ q: '', artist: '', level: '', dur: '' });
  const [f, setF] = useState({ q: '', artist: '', level: '', dur: '' });
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Partial<EventBookRow> | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try { setBooks((await listEventBooks({})).data.books); setErr(''); }
    catch (e) { setErr(e instanceof Error && e.message && !/^internal$/i.test(e.message) ? e.message : tx("The books could not be loaded. The latest Firebase functions may not be deployed yet.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const all = books ?? [];
  const artists = useMemo(() => Array.from(new Set(all.map((b) => b.artist).filter(Boolean))).sort(), [all]);
  const term = f.q.trim().toLowerCase();
  const shown = all.filter((b) => (!term || `${b.title} ${b.artist}`.toLowerCase().includes(term)) && (!f.level || b.levelId === (f.level === 'none' ? '' : f.level)) && (!f.artist || b.artist === f.artist) && (!f.dur || durKey(b.durationSeconds) === f.dur));
  const totalSec = all.reduce((n, b) => n + b.durationSeconds, 0);
  const apply = (n: typeof d) => { setD(n); setF(n); setPage(1); };
  const clear = () => apply({ q: '', artist: '', level: '', dur: '' });
  const filtering = !!(f.q || f.level || f.artist || f.dur);
  const dirty = JSON.stringify(d) !== JSON.stringify(f);

  async function remove(b: EventBookRow) {
    if (!window.confirm(`Remove “${b.title}” from the list? Choices already made keep it.`)) return;
    try { await deleteEventBook({ id: b.id }); notify('Book removed', 'success'); await load(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not remove', 'error'); }
  }

  const levelName = (b: EventBookRow) => (b.levelId ? levelById[b.levelId]?.name ?? '' : tx("Every level"));
  const { sorted, sort, toggle, setSort } = useSort(shown, { title: (b) => b.title.toLowerCase(), artist: (b) => (b.artist || '~').toLowerCase(), level: (b) => levelName(b).toLowerCase(), duration: (b) => b.durationSeconds });
  const sortBy = (key: string, dir: 'asc' | 'desc') => setSort({ key, dir });
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const cur = Math.min(page, pages);
  const rows = sorted.slice((cur - 1) * PAGE, cur * PAGE);
  const tiles = [
    { cls: 't1', icon: <BookOpen size={26} />, label: tx("Books"), value: all.length, on: !filtering && !sort, go: () => { clear(); setSort(null); } },
    { cls: 't2', icon: <PenLine size={26} />, label: tx("Artists"), value: artists.length, on: sort?.key === 'artist', go: () => sortBy('artist', 'asc') },
    { cls: 't4', icon: <CalendarClock size={26} />, label: tx("In total"), value: hours(totalSec), on: sort?.key === 'duration', go: () => sortBy('duration', 'desc') },
  ];
  const head = (i: number, k: string, label: string, sortable = true) => {
    const col = COLS[i];
    const on = sort?.key === k;
    return (
      <th key={k} style={{ ['--cc' as string]: col.c, ['--cb' as string]: col.b } as React.CSSProperties} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={k === 'actions' ? 'num' : ''}>
        {sortable ? <button type="button" className={on ? 'on' : ''} onClick={() => toggle(k)}>{label}<i aria-hidden>{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</i></button> : <span>{label}</span>}
      </th>
    );
  };

  return (
    <div className="eb2">
      <section className="eb2-hero">
        <div className="eb2-ht">
          <span className="eb2-line" aria-hidden />
          <h1>{tx("Event books")}</h1>
          <p>{tx("This section stores the books chosen for performances, including the book title, the interpreting artist, and the performance duration.")}</p>
        </div>
        {!readOnly && (
          <div className="eb2-acts">
            <button type="button" className="ghost" onClick={() => setImporting(true)}><FileUp size={16} /> {tx("Import a CSV file")}</button>
            <button type="button" className="gold" onClick={() => setEdit({})}><Plus size={16} /> {tx("Add a book")}</button>
          </div>
        )}
      </section>

      {err && !books && <div className="at-error" role="alert"><span aria-hidden>⚠</span><div><b>{tx("Event books could not be loaded")}</b><p>{err}</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Try again")}</button></div>}

      <BookSuggestions strip onApproved={() => void load()} />

      {books && (
        <>
          <div className="eb2-tiles">
            {tiles.map((t) => (
              <button type="button" key={t.label} className={`${t.cls}${t.on ? ' on' : ''}`} onClick={t.go} aria-pressed={t.on}>
                <span className="eb2-ti" aria-hidden>{t.icon}</span>
                <small>{t.label}</small><b>{t.value}</b>
                <ChevronRight className="eb2-go" size={20} aria-hidden />
              </button>
            ))}
          </div>

          <form className="eb2-bar" onSubmit={(e) => { e.preventDefault(); apply(d); }}>
            <label className="eb2-search"><Search size={18} aria-hidden /><input type="search" placeholder={tx("Search for a book or an artist…")} value={d.q} onChange={(e) => setD({ ...d, q: e.target.value })} aria-label={tx("Search")} />{d.q && <button type="button" aria-label={tx("Clear")} onClick={() => { const n = { ...d, q: '' }; setD(n); if (f.q) apply(n); }}><X size={16} /></button>}</label>
            <Dropdown label={tx("Artist")} value={d.artist} onChange={(v) => setD({ ...d, artist: v })} allLabel={`${tx("All artists")} · ${artists.length}`} options={artists.map((a) => ({ value: a, label: a }))} className="eb2-dd" />
            <Dropdown label={tx("Duration")} value={d.dur} onChange={(v) => setD({ ...d, dur: v })} allLabel={tx("All durations")} options={DUR.map((x) => ({ value: x.v, label: tx(x.label) }))} className="eb2-dd" />
            <button type="submit" className={`eb2-apply${dirty ? ' dirty' : ''}`}><Filter size={16} /> {tx("Apply filters")}</button>
            <button type="button" className="eb2-clear" onClick={clear} disabled={!filtering && !dirty}><RotateCcw size={15} /> {tx("Clear all")}</button>
          </form>

          {all.length === 0 ? (
            <div className="eb-empty">
              <BookOpen size={34} />
              <h3>{tx("No book yet")}</h3>
              <p>{tx("Add the books one by one, or import many at once from a CSV file with the columns Book name, Artist name, Duration and Level.")}</p>
              {!readOnly && <div><button type="button" className="btn btn-primary" onClick={() => setImporting(true)}>{tx("Import a CSV file")}</button> <button type="button" className="btn btn-secondary" onClick={() => setEdit({})}>{tx("Add a book")}</button></div>}
            </div>
          ) : (
            <section className="eb2-panel">
              <header><i aria-hidden><BookOpen size={20} /></i><h2>{tx("Books")}</h2><em>{filtering ? `${shown.length} / ${all.length}` : all.length}</em></header>
              {shown.length === 0 ? <p className="kt-empty">{tx("No book matches.")}</p> : (
                <div className="eb2-scroll">
                  <table className="eb2-table">
                    <thead><tr>{head(0, 'title', tx("Book title"))}{head(1, 'artist', tx("Artist"))}{head(3, 'duration', tx("Duration"))}{!readOnly && head(4, 'actions', tx("Actions"), false)}</tr></thead>
                    <tbody>
                      {rows.map((b) => {
                        return (
                          <tr key={b.id}>
                            <td className="c0"><button type="button" className="eb2-cell" disabled={readOnly} title={readOnly ? undefined : tx("Edit the book")} onClick={() => setEdit(b)}><i aria-hidden><BookOpen size={17} /></i><b>{b.title}</b>{b.version && <em className="eb-ver">{b.version}</em>}</button></td>
                            <td className="c1">{b.artist ? <button type="button" className="eb2-cell link" title={tx("Show only this artist")} onClick={() => apply({ ...d, artist: b.artist })}>{b.artist}</button> : <em className="eb-none">{tx("No artist")}</em>}</td>
                            <td className="c3"><button type="button" className="eb2-cell" title={tx("Show books of this length")} onClick={() => apply({ ...d, dur: durKey(b.durationSeconds) })}><span className="eb-dur">{clock(b.durationSeconds)}</span></button></td>
                            {!readOnly && <td className="c4 num"><span className="eb-btns"><button type="button" className="ed" aria-label={`Edit ${b.title}`} onClick={() => setEdit(b)}><Pencil size={15} /></button><button type="button" aria-label={`Remove ${b.title}`} className="del" onClick={() => void remove(b)}><Trash2 size={15} /></button></span></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <footer>
                <span>{txf("Showing {a} of {b} results", { a: rows.length, b: shown.length })}</span>
                {pages > 1 && (
                  <nav aria-label={tx("Pages")}>
                    <button type="button" aria-label={tx("Previous")} disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} /></button>
                    {Array.from({ length: pages }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === cur ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
                    <button type="button" aria-label={tx("Next")} disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRight size={16} /></button>
                  </nav>
                )}
              </footer>
            </section>
          )}
        </>
      )}

      {edit && <BookForm book={edit} levels={levels} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      {importing && <ImportBooks onClose={() => setImporting(false)} onDone={() => { setImporting(false); void load(); }} />}
    </div>
  );
}

function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return createPortal(
    <div className="mls-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mls-sheet eb-sheet${wide ? ' wide' : ''}`}>
        <header><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div><button type="button" className="mls-x" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        {children}
      </div>
    </div>, document.body);
}

function BookForm({ book, levels, onClose, onSaved }: { book: Partial<EventBookRow>; levels: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(book.title ?? '');
  const [artist, setArtist] = useState(book.artist ?? '');
  const [version, setVersion] = useState(book.version ?? '');
  const [dur, setDur] = useState(book.durationSeconds ? clock(book.durationSeconds) : '');
  const [levelId, setLevelId] = useState(book.levelId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sec = readLength(dur);
  async function save() {
    setBusy(true); setErr('');
    try { await saveEventBook({ ...(book.id ? { id: book.id } : {}), title, artist, version, durationSeconds: sec ?? 0, levelId }); notify(book.id ? 'Book saved' : 'Book added', 'success'); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : tx("Could not save")); setBusy(false); }
  }
  return (
    <Modal title={book.id ? tx("Edit the book") : tx("Add a book")} onClose={onClose}>
      <div className="eb-form">
        <div className="field"><label>{tx("Book name")}</label><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
        <div className="eb-two">
          <div className="field"><label>{tx("Artist name")}</label><input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={120} /></div>
          <div className="field"><label>{tx("Version (only if the same book and artist exist twice)")}</label><input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={60} placeholder={tx("Version 2")} /></div>
        </div>
        <div className="eb-two">
          <div className="field"><label>{tx("Duration")}</label><input value={dur} onChange={(e) => setDur(e.target.value)} placeholder="1:30" inputMode="text" />{dur && !sec && <small className="bad">{tx("Write it as 1:30 (hours:minutes) or in minutes, like 90")}</small>}</div>
          <div className="field"><label>{tx("Level")}</label><Dropdown label={tx("Level")} value={levelId} onChange={setLevelId} allLabel={tx("Every level")} options={levels.map((l) => ({ value: l.id, label: l.name }))} /></div>
        </div>
        <p className="eb-hint">{tx("A group can only choose books of its own level or of the levels it may read.")}</p>
        {err && <p className="mls-note bad">{err}</p>}
      </div>
      <footer><span /><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{tx("Cancel")}</button><button type="button" className="btn btn-primary" disabled={busy || title.trim().length < 2 || !sec} onClick={() => void save()}>{busy ? tx("Saving…") : tx("Save")}</button></footer>
    </Modal>
  );
}

function ImportBooks({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ReturnType<typeof readFile> | null>(null);
  const [fileName, setFileName] = useState('');
  const [res, setRes] = useState<ImportBooksResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);

  async function take(f?: File) {
    if (!f) return;
    setErr(''); setRes(null); setBusy(true); setFileName(f.name);
    try {
      const parsed = readFile(await f.text());
      if (parsed.length === 0) throw new Error('The file is empty');
      setRows(parsed);
      setRes((await importEventBooks({ rows: parsed, dryRun: true })).data);
    } catch (e) { setErr(e instanceof Error ? e.message : tx("The file could not be read")); setRows(null); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!rows) return;
    setBusy(true); setErr('');
    try { const r = (await importEventBooks({ rows, dryRun: false })).data; notify(`${r.summary.added} added, ${r.summary.updated} updated`, 'success'); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : tx("Import failed")); setBusy(false); }
  }
  const s = res?.summary;
  const todo = (s?.added ?? 0) + (s?.updated ?? 0);
  return (
    <Modal wide title={tx("Import books from a CSV file")} sub={tx("One line per book: Book name, Artist name, Duration, Level.")} onClose={onClose}>
      <div className="eb-import">
        <div className="eb-help">
          <div><b>{tx("How to prepare the file")}</b><p>{tx("In Excel or Google Sheets, make five columns (the Version column can stay empty) and save as CSV. When the same book and artist appear twice, write a different version on each line. The duration is written 1:30 (hours:minutes) or as a number of minutes, like 90. The level must be written as it is in Academic levels; leave it empty for a book open to every level.")}</p></div>
          <button type="button" className="btn btn-secondary" onClick={() => downloadCsv('event-books-template', [['Book name', 'Artist name', 'Version', 'Duration', 'Level'], ['Example book one', 'Artist name', '', '1:30', ''], ['Example book one', 'Artist name', 'Version 2', '1:10', ''], ['Example book two', 'Another artist', '', '0:45', '']])}><Download size={15} /> {tx("Download the template")}</button>
        </div>
        <div className={`eb-drop${drag ? ' on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files[0]); }}>
          <FileUp size={26} />
          <b>{fileName || tx("Drop the CSV file here")}</b>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => input.current?.click()}>{fileName ? tx("Choose another file") : tx("Choose a file")}</button>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {err && <p className="mls-note bad">{err}</p>}
        {busy && !res && <p className="fx3-note">{tx("Checking the file…")}</p>}
        {s && res && (
          <>
            <div className="eb-sum">
              <span className="n"><b>{s.added}</b> {tx("to add")}</span><span className="u"><b>{s.updated}</b> {tx("to update")}</span><span className="s"><b>{s.unchanged}</b> {tx("already there")}</span><span className={`e${s.errors ? ' on' : ''}`}><b>{s.errors}</b> {tx("to fix")}</span>
            </div>
            <div className="eb-prev">
              <table>
                <thead><tr><th>{tx("Line")}</th><th>{tx("Book title")}</th><th>{tx("Artist")}</th><th>{tx("Level")}</th><th>{tx("Duration")}</th><th>{tx("Result")}</th></tr></thead>
                <tbody>
                  {res.rows.map((r) => (
                    <tr key={r.row} className={`s-${r.status}`}>
                      <td>{r.row}</td><td>{r.title || '—'}{r.version ? ` (${r.version})` : ''}</td><td>{r.artist || '—'}</td><td>{r.levelName || tx("Every level")}</td><td>{r.durationSeconds ? clock(r.durationSeconds) : '—'}</td>
                      <td><span className={`eb-st s-${r.status}`}>{r.status === 'new' ? tx("New") : r.status === 'update' ? tx("Update") : r.status === 'same' ? tx("Same") : tx("Fix")}</span> {r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.errors > 0 && <p className="eb-hint">{tx("Lines marked “Fix” are skipped. You can correct them and import the file again, nothing is added twice.")}</p>}
          </>
        )}
      </div>
      <footer><span>{s ? `${todo} book${todo === 1 ? '' : 's'} will be saved` : ''}</span><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{tx("Cancel")}</button><button type="button" className="btn btn-primary" disabled={busy || !res || todo === 0} onClick={() => void confirm()}>{busy && res ? tx("Saving…") : `Import ${todo || ''} book${todo === 1 ? '' : 's'}`}</button></footer>
    </Modal>
  );
}



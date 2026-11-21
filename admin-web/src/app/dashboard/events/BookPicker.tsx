'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLevels } from '@/lib/useLevels';
import { listBookSuggestions, listEventBooks, suggestEventBook, submitPerformanceSelection, type BookSuggestion, type EventBookRow } from '@/lib/functions';
import { formatDuration } from '@/lib/timeZones';
import { notify } from '@/lib/notify';
import type { Selection, Slot } from './planParts';
import { tx } from '@/lib/i18n/tr';

/** Books for one slot: the group ticks the books it will perform from the event books list (name, artist, length, level), with the running total against the time allowed. The server checks it again. */
export function ResourcePicker({ slot, current, onClose, setNotes, onDone }: { slot: Slot; current?: Selection; onClose: () => void; setNotes?: (s: string) => void; onDone?: () => void }) {
  const { byId: levelById } = useLevels();
  const [books, setBooks] = useState<EventBookRow[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => Object.fromEntries((current?.items ?? []).filter((i) => i.type === 'eventBook').map((i) => [i.id, true])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [artist, setArtist] = useState('');
  const [only, setOnly] = useState(false);
  const [tab, setTab] = useState<'choose' | 'suggest'>('choose');
  const [mine, setMine] = useState<BookSuggestion[]>([]);
  const reloadMine = () => { listBookSuggestions({}).then((r) => setMine(r.data.suggestions)).catch(() => undefined); };
  useEffect(reloadMine, []);
  const reloadBooks = () => { listEventBooks({ groupId: slot.groupId }).then((r) => setBooks(r.data.books)).catch(() => undefined); };
  useEffect(() => { const h = window.setInterval(() => { reloadBooks(); reloadMine(); }, 15000); return () => window.clearInterval(h); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const waiting = mine.filter((m) => m.status === 'pending').length;

  useEffect(() => { listEventBooks({ groupId: slot.groupId }).then((r) => setBooks(r.data.books)).catch((e) => setLoadErr(e instanceof Error ? e.message : 'The books could not be loaded')); }, [slot.groupId]);

  const rows = books ?? [];
  const levelIds = Array.from(new Set(rows.map((b) => b.levelId))).sort((a, b) => (levelById[a]?.rank ?? -1) - (levelById[b]?.rank ?? -1));
  const artists = Array.from(new Set(rows.map((b) => b.artist).filter(Boolean))).sort();
  const term = search.trim().toLowerCase();
  const shown = rows.filter((b) => (!term || `${b.title} ${b.artist}`.toLowerCase().includes(term)) && (!level || b.levelId === (level === 'none' ? '' : level)) && (!artist || b.artist === artist) && (!only || chosen[b.id]));
  const picked = rows.filter((b) => chosen[b.id]);
  const total = picked.reduce((n, b) => n + b.durationSeconds, 0);
  const remaining = slot.allocatedSeconds - total;
  const count = picked.length;
  const over = remaining < 0;
  const pct = slot.allocatedSeconds > 0 ? Math.min(100, Math.round((total / slot.allocatedSeconds) * 100)) : 0;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await submitPerformanceSelection({ slotId: slot.id, items: picked.map((b) => ({ type: 'eventBook' as const, id: b.id })) });
      notify(`Submitted for approval. ${formatDuration(Number((res.data as { remainingSeconds: number }).remainingSeconds))} left.`, 'success');
      setNotes?.('');
      onDone?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not submit"));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pick-dialog" role="dialog" aria-modal="true" aria-label={tx("Choose the books")}>
        <div className="pick-head">
          <div>
            <h2>{tx("Choose the books")}</h2>
            <p>{slot.groupName}. Tick the books your group will perform. The Super Admin approves your choice.</p>
          </div>
          <button type="button" className="pick-x" onClick={onClose} aria-label={tx("Close")}>×</button>
        </div>

        <div className="pk-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'choose'} className={tab === 'choose' ? 'on' : ''} onClick={() => setTab('choose')}>{tx("Choose a book")}</button>
          <button type="button" role="tab" aria-selected={tab === 'suggest'} className={tab === 'suggest' ? 'on' : ''} onClick={() => setTab('suggest')}>{tx("Suggest a book")}{waiting > 0 ? <em>{waiting}</em> : null}</button>
        </div>

        {tab === 'suggest' ? <SuggestBook slot={slot} mine={mine} onSent={() => { reloadMine(); }} /> : <>
        <div className="pick-summary">
          <div><span>{tx("Time allowed")}</span><strong>{formatDuration(slot.allocatedSeconds)}</strong></div>
          <div><span>{tx("Selected (")}{count})</span><strong>{formatDuration(total)}</strong></div>
          <div><span>{tx("Time left")}</span><strong style={{ color: over ? '#a02820' : '#1b6b3a' }}>{over ? `-${formatDuration(-remaining)}` : formatDuration(remaining)}</strong></div>
          <div className="pick-bar"><i style={{ width: `${pct}%`, background: over ? '#c0392b' : '#0b5d3b' }} /></div>
        </div>

        {(current?.rejectedItems ?? []).length > 0 && (
          <div className="fx-error" role="alert">
            {(current?.rejectedItems ?? []).map((r) => <div key={`${r.type}:${r.id}`}><strong>{r.title}</strong> {tx("was rejected.")} {r.reason}</div>)}
          </div>
        )}
        {current?.status === 'rejected' && current.reason && <div className="fx-error" role="alert">{tx("The Super Admin rejected the last choice. Reason:")} {current.reason}</div>}
        {current?.status === 'approved' && <p className="pick-note">{tx("This choice is already approved. If you change it, it goes back to the Super Admin for approval.")}</p>}
        {current && current.items.some((i) => i.type !== 'eventBook') && <p className="pick-note">{tx("The last choice used audio. From now on an event performance uses books from the list below.")}</p>}
        {over && <div className="fx-error" role="alert">{tx("Your choice is")} {formatDuration(-remaining)} {tx("longer than the time allowed. Remove something to submit.")}</div>}

        <div className="pick-filters">
          <input className="pick-search" type="search" placeholder={tx("Search a book or an artist")} value={search} onChange={(e) => setSearch(e.target.value)} />
          {artists.length > 1 && <select value={artist} onChange={(e) => setArtist(e.target.value)} aria-label={tx("Artist")}><option value="">{tx("All artists")}</option>{artists.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
          <label className="pick-only"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> {tx("Selected only")}</label>
        </div>
        {levelIds.length > 1 && (
          <div className="pick-levels">
            <button type="button" className={!level ? 'on' : ''} onClick={() => setLevel('')}>{tx("All levels")}</button>
            {levelIds.map((l) => <button type="button" key={l || 'none'} className={level === (l || 'none') ? 'on' : ''} onClick={() => setLevel(l || 'none')}>{l ? levelById[l]?.name ?? tx("Level") : tx("Every level")}</button>)}
          </div>
        )}

        <div className="pick-list">
          {loadErr ? <p className="pick-empty">{loadErr}</p> : books === null ? <p className="pick-empty">{tx("Loading the books…")}</p> : rows.length === 0 ? <p className="pick-empty">{tx("No book is available to this group yet. Use “Suggest a book” and the Super Admin will add it.")}</p> : shown.length === 0 ? <p className="pick-empty">{tx("No book matches.")}</p> : (
            <div className="pick-grid">
              {shown.map((b) => (
                <label key={b.id} className={`pick-card${chosen[b.id] ? ' on' : ''}`}>
                  <input type="checkbox" checked={!!chosen[b.id]} onChange={(e) => setChosen({ ...chosen, [b.id]: e.target.checked })} />
                  <span className="pick-tick" aria-hidden>{chosen[b.id] ? '✓' : ''}</span>
                  <strong className="pick-title">{b.title}</strong>
                  <span className="pick-artist">{b.artist || tx("No artist")}</span>
                  <span className="pick-meta">
                    {b.levelId && <span className="pick-chip">{levelById[b.levelId]?.name ?? tx("Level")}</span>}
                    <span className="pick-chip time">{formatDuration(b.durationSeconds)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <p className="pk-cant">{tx("Cannot find your book?")} <button type="button" onClick={() => setTab('suggest')}>{tx("Suggest it to the Super Admin")}</button></p>
        {error && <div className="fx-error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        </>}
        <div className="pick-foot">
          <button type="button" className="fx-btn" onClick={onClose}>{tab === 'choose' ? tx("Cancel") : tx("Close")}</button>
          {tab === 'choose' && <button type="button" className="fx-btn fx-primary" disabled={busy || over || count === 0} onClick={submit}>{busy ? tx("Submitting…") : `Submit for approval${count ? ` (${count})` : ''}`}</button>}
        </div>
      </div>
    </div>
  , document.body);
}


const STATUS_TXT: Record<string, string> = { pending: 'Waiting for the Super Admin', approved: 'Approved, now in the list', rejected: 'Refused' };

/** A group manager suggests a book that is not in the list: name, artist and duration go to the Super Admin. */
function SuggestBook({ slot, mine, onSent }: { slot: Slot; mine: BookSuggestion[]; onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [version, setVersion] = useState('');
  const [h, setH] = useState('0');
  const [m, setM] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mins = Math.max(0, Math.round(Number(h || 0) * 60 + Number(m || 0)));
  async function send() {
    setBusy(true); setErr('');
    try {
      await suggestEventBook({ slotId: slot.id, title, artist, version, duration: `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` });
      notify('Sent to the Super Admin. When it is approved, it appears in the list for everybody.', 'success');
      setTitle(''); setArtist(''); setVersion(''); setH('0'); setM('');
      onSent();
    } catch (e) { setErr(e instanceof Error ? e.message : tx("Could not send")); } finally { setBusy(false); }
  }
  return (
    <div className="pk-sug">
      <div className="pk-form">
        <p className="pk-help">{tx("Type the details of the book. The Super Admin checks them. Once approved, the book is added to the list and every group can choose it.")}</p>
        <label>{tx("Name of the book")}<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={tx("For example: Burda")} /></label>
        <label>{tx("Artist")}<input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={120} placeholder={tx("Name of the artist")} /></label>
        <label>{tx("Version")} <small>{tx("(only if the same book and artist already exist)")}</small><input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={60} placeholder={tx("For example: Version 2")} /></label>
        <div className="pk-dur">
          <label>{tx("Hours")}<input type="number" min={0} max={23} value={h} onChange={(e) => setH(e.target.value)} /></label>
          <label>{tx("Minutes")}<input type="number" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} placeholder="0" /></label>
          <span className="pk-dsum">{tx("Duration")}<b>{mins > 0 ? formatDuration(mins * 60) : '—'}</b></span>
        </div>
        {err && <div className="fx-error" role="alert">{err}</div>}
        <button type="button" className="fx-btn fx-primary" disabled={busy || title.trim().length < 2 || artist.trim().length < 2 || mins < 1} onClick={() => void send()}>{busy ? tx("Sending…") : tx("Send to the Super Admin")}</button>
      </div>
      <div className="pk-mine">
        <h3>{tx("My suggestions")} <em>{mine.length}</em></h3>
        {mine.length === 0 && <p className="pk-none">{tx("Nothing suggested yet.")}</p>}
        {mine.map((x) => (
          <article key={x.id} className={`pk-s ${x.status}`}>
            <div><b>{x.title}</b><small>{x.artist}{x.version ? ` · ${x.version}` : ''} · {formatDuration(x.durationSeconds)}</small></div>
            <span className={`pk-st ${x.status}`}>{STATUS_TXT[x.status]}</span>
            {x.status === 'rejected' && x.reason && <p>{tx("Reason:")} {x.reason}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}

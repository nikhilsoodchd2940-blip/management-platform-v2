'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Users } from 'lucide-react';
import { listBookSuggestions, reviewBookSuggestion, type BookSuggestion } from '@/lib/functions';
import { useLevels } from '@/lib/useLevels';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

const clock = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60; const p = (n: number) => String(n).padStart(2, '0'); return r ? `${h}:${p(m)}:${p(r)}` : `${h}:${p(m)}`; };
const ago = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Books suggested by group managers: the Super Admin approves them (they join the list at once) or refuses them; a group manager follows the answer. */
export default function BookSuggestions({ onApproved, always, strip }: { onApproved?: () => void; always?: boolean; strip?: boolean }) {
  const { levels } = useLevels();
  const [rows, setRows] = useState<BookSuggestion[] | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [lv, setLv] = useState<Record<string, string>>({});
  const [refuse, setRefuse] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);
  const load = useCallback(() => { listBookSuggestions({}).then((r) => { setRows(r.data.suggestions); setCanReview(r.data.canReview); }).catch(() => setRows([])); }, []);
  useEffect(() => { load(); const h = window.setInterval(load, 20000); return () => window.clearInterval(h); }, [load]);
  if (!always && !strip && (!rows || rows.length === 0)) return null;
  const list = rows ?? [];
  const pending = list.filter((r) => r.status === 'pending');
  const past = list.filter((r) => r.status !== 'pending');
  async function decide(x: BookSuggestion, approve: boolean) {
    setBusy(x.id);
    try {
      await reviewBookSuggestion({ id: x.id, decision: approve ? 'approve' : 'reject', ...(approve ? { levelId: lv[x.id] ?? x.levelId } : { reason: why }) });
      notify(approve ? 'Approved. The book is now in the list.' : 'Refused. The group manager is told.', 'success');
      setRefuse(''); setWhy(''); load(); if (approve) onApproved?.();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(''); }
  }
  const card = (x: BookSuggestion) => (
    <article key={x.id} className={`bs-card ${x.status}`}>
      <header>
        <span className="bs-ico" aria-hidden><BookOpen size={18} /></span>
        <div><b>{x.title}{x.version && <em className="eb-ver">{x.version}</em>}</b><small>{x.artist} · {clock(x.durationSeconds)}</small></div>
        <span className={`pk-st ${x.status}`}>{x.status === 'pending' ? tx("To approve") : x.status === 'approved' ? tx("Approved") : tx("Refused")}</span>
      </header>
      <div className="bs-info"><div><small>{tx("Suggested by")}</small><b>{x.requesterName}</b></div><div><small>{tx("Group")}</small><b>{x.groupName || '—'}</b></div><div><small>{tx("Sent")}</small><b>{ago(x.createdAtMs)}</b></div></div>
      {x.status === 'pending' && canReview && (
        refuse === x.id ? (
          <div className="bs-why"><input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={tx("Why is it refused? The group manager will read it")} maxLength={300} autoFocus /><button type="button" className="btn btn-secondary" onClick={() => { setRefuse(''); setWhy(''); }}>{tx("Cancel")}</button><button type="button" className="btn btn-primary" disabled={why.trim().length < 3 || busy === x.id} onClick={() => void decide(x, false)}>{tx("Refuse")}</button></div>
        ) : (
          <footer>
            <label>{tx("Level of the book")}<select value={lv[x.id] ?? x.levelId} onChange={(e) => setLv({ ...lv, [x.id]: e.target.value })}><option value="">{tx("Every level")}</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <button type="button" className="btn btn-primary" disabled={busy === x.id} onClick={() => void decide(x, true)}>{busy === x.id ? tx("Saving…") : tx("Approve and add to the list")}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setRefuse(x.id)}>{tx("Refuse")}</button>
          </footer>
        )
      )}
      {x.status === 'pending' && !canReview && <p className="bs-note">{tx("Waiting for the Super Admin.")}</p>}
      {x.status === 'rejected' && x.reason && <p className="bs-note bad">{tx("Reason:")} {x.reason}</p>}
      {x.status === 'approved' && <p className="bs-note">{tx("Added to the list")}{x.decidedByName ? ` by ${x.decidedByName}` : ''}{x.levelName ? ` (${x.levelName})` : ''}.</p>}
    </article>
  );
  if (strip) {
    return (
      <section className="bs2">
        <div className="bs2-bar">
          <div className="bs2-l">
            <span className="bs2-ic" aria-hidden><Users size={26} /></span>
            <div>
              <h2>{canReview ? tx("Books suggested by the groups") : tx("My book suggestions")}</h2>
              <p>{canReview ? tx("Once approved, a book is added to the list and every group of its level can choose it.") : tx("The Super Admin answers here. An approved book joins the list for everybody.")}</p>
              {past.length > 0 && <button type="button" onClick={() => setAll(!all)}>{all ? tx("Hide") : tx("Show")} {tx("the")} {past.length} {tx("answered suggestion")}{past.length === 1 ? '' : 's'} <ArrowRight size={14} /></button>}
            </div>
          </div>
          <div className="bs2-r">
            <p><i className={pending.length ? 'on' : ''} aria-hidden />{rows === null ? tx("Loading…") : pending.length === 0 ? tx("Nothing is waiting. Books suggested by the groups appear here and in your notifications.") : `${pending.length} ${tx("waiting")}`}</p>
            <span className={`bs2-pill${pending.length ? ' on' : ''}`}><i aria-hidden />{pending.length} {tx("waiting")}</span>
          </div>
        </div>
        {pending.length > 0 && <div className="bs-grid">{pending.map(card)}</div>}
        {all && <div className="bs-grid">{past.slice(0, 30).map(card)}</div>}
      </section>
    );
  }
  return (
    <section className={`bs${always ? " card" : ""}`}>
      <div className="bs-head"><div><h2>{canReview ? tx("Books suggested by the groups") : tx("My book suggestions")}</h2><p>{canReview ? tx("Once approved, a book is added to the list and every group of its level can choose it.") : tx("The Super Admin answers here. An approved book joins the list for everybody.")}</p></div><span className={`pk-st ${pending.length ? 'pending' : 'approved'}`}>{pending.length} {tx("waiting")}</span></div>
      {rows === null && <p>{tx("Loading…")}</p>}
      {rows !== null && pending.length === 0 && <p className="fx2-empty">{tx("Nothing is waiting. Books suggested by the groups appear here and in your notifications.")}</p>}
      {pending.length > 0 && <div className="bs-grid">{pending.map(card)}</div>}
      {past.length > 0 && <button type="button" className="bs-more" onClick={() => setAll(!all)}>{all ? tx("Hide") : tx("Show")} {tx("the")} {past.length} {tx("answered suggestion")}{past.length === 1 ? '' : 's'}</button>}
      {all && <div className="bs-grid">{past.slice(0, 30).map(card)}</div>}
    </section>
  );
}

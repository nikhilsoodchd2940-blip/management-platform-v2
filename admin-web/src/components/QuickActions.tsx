'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Coffee, Ellipsis, GlassWater, Volume2, VolumeX, Wind } from 'lucide-react';
import { createQuickRequest, listQuickRequests, setQuickRequestStatus, type QuickItem, type QuickRow, type QuickStatus } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

const ITEMS: { id: QuickItem; label: string; Icon: typeof Coffee }[] = [
  { id: 'books', label: 'Books', Icon: BookOpen }, { id: 'water', label: 'Water', Icon: GlassWater }, { id: 'coffee', label: 'Coffee', Icon: Coffee },
  { id: 'tissue', label: 'Tissue', Icon: Wind }, { id: 'other', label: 'Other', Icon: Ellipsis },
];
const STATUS: Record<QuickStatus, string> = { new: 'New', in_progress: 'In progress', not_available: 'Not available', delivered: 'Delivered' };
const ago = (ms: number, now: number) => { const m = Math.max(0, Math.floor((now - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const nameOf = (r: QuickRow) => (r.item === 'other' ? r.note || 'Other' : ITEMS.find((x) => x.id === r.item)?.label ?? r.item);

/** Two short notes, played when a new request arrives. Needs one click on the page first (browser rule), so the switch below also unlocks it. */
function beep(ctx: AudioContext) {
  [880, 1175].forEach((f, i) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.start(t); o.stop(t + 0.4);
  });
}

/**
 * Quick actions: staff ask for books, water, coffee, tissue or something else; the supervisor of the place hears a sound,
 * answers In progress, Not available or Delivered, and the staff member sees the latest answer. Refreshes every few seconds.
 */
export default function QuickActions({ eventId, onOpen, compact = false }: { eventId: string; onOpen?: (open: number) => void; compact?: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listQuickRequests>>['data'] | null>(null);
  const [err, setErr] = useState('');
  const [other, setOther] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState('');
  const [sound, setSound] = useState(true);
  const ctx = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(true);
  soundRef.current = sound;

  useEffect(() => { try { setSound(localStorage.getItem('quick-sound') !== 'off'); } catch { /* private window */ } }, []);

  const load = useCallback(async () => {
    try {
      const r = (await listQuickRequests({ eventId })).data;
      const fresh = r.rows.filter((x) => x.canAnswer && !x.mine && x.status === 'new').map((x) => x.id);
      if (seen.current && fresh.some((id) => !seen.current!.has(id)) && soundRef.current) { try { if (ctx.current) beep(ctx.current); } catch { /* blocked */ } }
      seen.current = new Set([...(seen.current ?? []), ...r.rows.map((x) => x.id)]);
      setData(r); setErr(''); onOpen?.(r.open);
    } catch (e) { setErr(e instanceof Error && e.message && !/^internal$/i.test(e.message) ? e.message : tx("Requests could not be loaded. The latest Firebase functions may not be deployed yet.")); }
  }, [eventId, onOpen]);
  useEffect(() => { seen.current = null; void load(); const h = window.setInterval(() => void load(), 4000); return () => window.clearInterval(h); }, [load]);

  function toggleSound() {
    const next = !sound; setSound(next);
    try { localStorage.setItem('quick-sound', next ? 'on' : 'off'); } catch { /* ignore */ }
    if (next) { try { ctx.current ??= new AudioContext(); void ctx.current.resume(); beep(ctx.current); } catch { /* not supported */ } }
  }

  async function ask(item: QuickItem) {
    if (item === 'other' && !asking) { setAsking(true); return; }
    setBusy(item);
    try { await createQuickRequest({ eventId, item, note: item === 'other' ? other : '' }); notify('Sent to the supervisor of your place', 'success'); setOther(''); setAsking(false); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not send', 'error'); } finally { setBusy(''); }
  }
  async function answer(id: string, status: QuickStatus) {
    setBusy(id);
    try { await setQuickRequestStatus({ id, status }); await load(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(''); }
  }

  if (err && !data) return <div className="at-error" role="alert"><span aria-hidden>⚠</span><div><b>{tx("Quick actions could not be loaded")}</b><p>{err}</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Try again")}</button></div>;
  if (!data) return <p className="fx3-note">{tx("Loading…")}</p>;
  const now = data.nowMs;
  const toAnswer = data.rows.filter((r) => r.canAnswer && !r.mine);
  const mine = data.rows.filter((r) => r.mine);
  const open = (r: QuickRow) => r.status === 'new' || r.status === 'in_progress';

  return (
    <div className={`qak${compact ? ' compact' : ''}`}>
      <section className="qak-ask">
        <div className="qak-title"><div><h3>{compact ? tx("Quick actions") : tx("Ask for something")}</h3><p>{compact ? (data.canHandle && toAnswer.length === 0 ? tx("Ask for what the group needs. No request waiting: you hear a sound when someone asks.") : tx("Ask for what the group on stage needs.")) : tx("Your request goes straight to the supervisor of your place.")}</p></div>
          {data.canHandle && <button type="button" className={`qak-sound${sound ? ' on' : ''}`} onClick={toggleSound} aria-pressed={sound}>{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}{sound ? tx("Sound on") : tx("Sound off")}</button>}
        </div>
        <div className="qak-items">
          {ITEMS.map(({ id, label, Icon }) => <button type="button" key={id} disabled={!!busy} className={`qak-item${asking && id === 'other' ? ' on' : ''}`} onClick={() => void ask(id)}><Icon size={26} /><b>{label}</b></button>)}
        </div>
        {asking && (
          <div className="qak-other">
            <input autoFocus value={other} maxLength={200} placeholder={tx("What do you need?")} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && other.trim().length > 1 && void ask('other')} />
            <button type="button" className="btn btn-primary" disabled={other.trim().length < 2 || !!busy} onClick={() => void ask('other')}>{tx("Send")}</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setAsking(false); setOther(''); }}>{tx("Cancel")}</button>
          </div>
        )}
      </section>

      {data.canHandle && (!compact || toAnswer.length > 0) && (
        <section className="qak-box">
          <h3>{tx("Requests to answer")} {data.open > 0 && <em>{data.open}</em>}</h3>
          {toAnswer.length === 0 && <p className="fx3-note">{tx("No request yet. When someone asks, you hear a sound and it shows here.")}</p>}
          <ul className="qak-list">
            {toAnswer.map((r) => (
              <li key={r.id} className={`s-${r.status}`}>
                <span className="qak-ico">{(() => { const I = ITEMS.find((x) => x.id === r.item)?.Icon ?? Ellipsis; return <I size={20} />; })()}</span>
                <span className="qak-main"><b>{nameOf(r)}</b><small>{r.requesterName}{r.siteName ? ` · ${r.siteName}` : ''} · {ago(r.createdMs, now)}</small></span>
                <span className={`qak-pill s-${r.status}`}>{STATUS[r.status]}</span>
                <span className="qak-btns">
                  {(['in_progress', 'not_available', 'delivered'] as const).map((s) => <button type="button" key={s} disabled={busy === r.id || r.status === s} className={`s-${s}${r.status === s ? ' on' : ''}`} onClick={() => void answer(r.id, s)}>{s === 'delivered' && <Check size={14} />}{STATUS[s]}</button>)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(!compact || mine.some(open)) && <section className="qak-box">
        <h3>{tx("My requests")}</h3>
        {mine.length === 0 && <p className="fx3-note">{tx("You have not asked for anything yet.")}</p>}
        <ul className="qak-list mine">
          {(compact ? mine.filter(open) : mine).map((r) => (
            <li key={r.id} className={`s-${r.status}`}>
              <span className="qak-ico">{(() => { const I = ITEMS.find((x) => x.id === r.item)?.Icon ?? Ellipsis; return <I size={20} />; })()}</span>
              <span className="qak-main"><b>{nameOf(r)}</b><small>{ago(r.createdMs, now)}{r.handledByName && !open(r) ? ` · ${r.handledByName}` : r.handledByName ? ` · ${r.handledByName} is on it` : ''}</small></span>
              <span className={`qak-pill s-${r.status}`}>{STATUS[r.status]}</span>
            </li>
          ))}
        </ul>
      </section>}
    </div>
  );
}

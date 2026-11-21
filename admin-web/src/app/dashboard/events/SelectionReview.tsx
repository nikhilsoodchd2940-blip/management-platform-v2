'use client';

import { useMemo, useState } from 'react';
import { reviewPerformanceSelection } from '@/lib/functions';
import { formatDuration } from '@/lib/timeZones';
import { notify } from '@/lib/notify';
import type { Selection } from './planParts';
import { tx } from '@/lib/i18n/tr';

export interface OtherChoice { groupName: string; keys: string[]; status: string }
type Verdict = { decision: '' | 'approve' | 'reject'; reason: string };

/**
 * Decide on each book of a submission on its own: approve one, reject another with a reason.
 * Nothing is decided by default, so every item needs a clear choice before the decision is sent.
 */
export default function SelectionReview({ slotId, selection, others, onDone, initial }: { slotId: string; selection: Selection; others: OtherChoice[]; onDone: () => void; initial?: 'approve' | '' }) {
  const keyOf = (i: { type: string; id: string }) => `${i.type}:${i.id}`;
  const [v, setV] = useState<Record<string, Verdict>>(() => Object.fromEntries(selection.items.map((i) => [keyOf(i), { decision: initial ?? '', reason: '' } as Verdict])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, patch: Partial<Verdict>) => setV((p) => ({ ...p, [k]: { ...p[k], ...patch } }));
  const all = (decision: 'approve' | 'reject') => setV((p) => Object.fromEntries(Object.entries(p).map(([k, x]) => [k, { ...x, decision }])));
  const approved = selection.items.filter((i) => v[keyOf(i)]?.decision === 'approve');
  const rejected = selection.items.filter((i) => v[keyOf(i)]?.decision === 'reject');
  const undecided = selection.items.length - approved.length - rejected.length;
  const approvedSeconds = approved.reduce((n, i) => n + i.durationSeconds, 0);
  const left = selection.allocatedSeconds - approvedSeconds;
  const pct = selection.allocatedSeconds ? Math.min(100, Math.round((approvedSeconds / selection.allocatedSeconds) * 100)) : 0;
  const missingReason = useMemo(() => rejected.some((i) => !v[keyOf(i)].reason.trim()), [rejected, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const clashOf = (i: { type: string; id: string }) => others.filter((o) => o.keys.includes(keyOf(i)));

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await reviewPerformanceSelection({ slotId, decisions: selection.items.map((i) => ({ type: i.type, id: i.id, decision: v[keyOf(i)].decision as 'approve' | 'reject', reason: v[keyOf(i)].reason.trim() })) });
      notify(rejected.length === 0 ? 'Everything approved' : approved.length ? 'Decision sent: some approved, some rejected' : 'Everything rejected', 'success');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not save the decision"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap">
      <div className="ap-meter">
        <div className="ap-meter-top">
          <span>{tx("Approved")} <b>{formatDuration(approvedSeconds)}</b> {tx("of")} <b>{formatDuration(selection.allocatedSeconds)}</b></span>
          <span className={left < 0 ? 'bad' : ''}>{left < 0 ? `${formatDuration(-left)} too long` : `${formatDuration(left)} left`}</span>
        </div>
        <div className="ap-bar"><i className={left < 0 ? 'bad' : ''} style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="ap-quick">
        <span>{selection.items.length} {tx("item")}{selection.items.length === 1 ? '' : 's'} {tx("to decide")}</span>
        <div>
          <button type="button" onClick={() => all('approve')}>{tx("Approve all")}</button>
          <button type="button" onClick={() => all('reject')}>{tx("Reject all")}</button>
        </div>
      </div>

      <div className="ap-items">
        {selection.items.map((i) => {
          const k = keyOf(i);
          const d = v[k].decision;
          const clashes = clashOf(i);
          return (
            <div key={k} className={`ap-item ${d}`}>
              <div className="ap-row">
                <span className="ap-ico">{i.type === 'audio' ? '🎵' : '📖'}</span>
                <div className="ap-title">
                  <strong>{i.title}</strong>
                  <div className="ap-pills">{i.artist && <span>{i.artist}</span>}<span>{i.type === 'audio' ? tx("Audio") : tx("Book")}</span><span className="t">{formatDuration(i.durationSeconds)}</span></div>
                </div>
                <div className="ap-seg" role="group" aria-label={`Decision for ${i.title}`}>
                  <button type="button" className={d === 'approve' ? 'on ok' : ''} onClick={() => set(k, { decision: 'approve' })}>{tx("✓ Approve")}</button>
                  <button type="button" className={d === 'reject' ? 'on no' : ''} onClick={() => set(k, { decision: 'reject' })}>{tx("✕ Reject")}</button>
                </div>
              </div>
              {clashes.length > 0 && (
                <div className="ap-clash"><span>{tx("Also chosen by")}</span>{clashes.map((c, n) => <em key={n} className={c.status === 'approved' ? 'ok' : ''}>{c.groupName} · {c.status === 'approved' ? tx("approved") : tx("waiting")}</em>)}</div>
              )}
              {d === 'reject' && (
                <label className="ap-reason"><span>{tx("Reason sent to the group manager *")}</span>
                  <textarea rows={2} value={v[k].reason} onChange={(e) => set(k, { reason: e.target.value })} placeholder={tx("Why is this not accepted? The group manager will read this.")} />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && <div className="fx-error" role="alert">{error}</div>}
      <div className="ap-foot">
        <span>{approved.length} {tx("approved ·")} {rejected.length} {tx("rejected")}{undecided ? ` · ${undecided} to decide` : ''}</span>
        <button type="button" className="ap-send" disabled={busy || undecided > 0 || missingReason || left < 0} onClick={submit}>{busy ? tx("Sending…") : tx("Send decision")}</button>
      </div>
    </div>
  );
}

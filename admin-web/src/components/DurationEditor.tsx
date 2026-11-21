'use client';

import { useState } from 'react';
import { setResourceDuration } from '@/lib/functions';
import { formatDuration } from '@/lib/timeZones';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

/** Shows a saved duration and lets an admin correct it. The server re-checks every selection that uses the resource. */
export default function DurationEditor({ type, id, seconds }: { type: 'audio' | 'book'; id: string; seconds?: number }) {
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(seconds ? String(Math.round((seconds / 60) * 10) / 10) : '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const sec = Math.round(Number(min) * 60);
    if (!Number.isFinite(sec) || sec < 1) return notify('Enter a duration in minutes', 'error');
    setBusy(true);
    try {
      const res = await setResourceDuration({ type, id, durationSeconds: sec });
      const n = (res.data as { revalidated?: number }).revalidated ?? 0;
      notify(n ? `Duration saved. ${n} selection(s) rechecked.` : 'Duration saved', 'success');
      setEditing(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save the duration', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span style={{ fontSize: '0.8rem' }}>
        {tx("Duration:")} <strong>{seconds ? formatDuration(seconds) : tx("not set")}</strong>{' '}
        <button type="button" className="fx2-btn" onClick={() => setEditing(true)}>{seconds ? tx("Edit") : tx("Add")}</button>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8rem' }}>
      <input type="number" min="0.5" step="0.5" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 80 }} aria-label={tx("Duration in minutes")} /> {tx("min")}
      <button type="button" className="fx2-btn primary" disabled={busy} onClick={save}>{tx("Save")}</button>
      <button type="button" className="fx2-btn" onClick={() => setEditing(false)}>{tx("Cancel")}</button>
    </span>
  );
}

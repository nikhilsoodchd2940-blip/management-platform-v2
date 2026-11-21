'use client';

import { useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { addPerformanceRemark, setPerformanceStatus } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tsMs } from '@/lib/useCollection';
import { formatInZone } from '@/lib/timeZones';
import { tx } from '@/lib/i18n/tr';

export interface Slot {
  id: string;
  eventId: string;
  groupId: string;
  groupName: string;
  cityId: string;
  zoneId?: string;
  countryId: string;
  startAt: Timestamp;
  endAt: Timestamp;
  allocatedSeconds: number;
  timeZone: string;
  performanceStatus?: 'scheduled' | 'started' | 'completed';
  allowOverlap?: boolean;
}
export interface Selection {
  id: string;
  items: { type: 'audio' | 'book' | 'eventBook'; id: string; title: string; artist?: string; durationSeconds: number }[];
  totalSeconds: number;
  allocatedSeconds: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'needs_revision' | 'cancelled';
  reason?: string;
  rejectedItems?: { type: 'audio' | 'book' | 'eventBook'; id: string; title: string; reason: string }[];
}
export interface Remark {
  id: string;
  slotId: string;
  kind?: 'feedback' | 'instruction';
  text: string;
  authorName: string;
  createdAt?: Timestamp;
}

/** Other groups that chose any of the same books for the same event. */
export function othersFor<T extends { id: string; groupId: string; status: string; items: { type: string; id: string }[] }>(all: T[], self: { id: string }, names: (groupId: string) => string) {
  return all.filter((o) => o.id !== self.id && (o.status === 'submitted' || o.status === 'approved')).map((o) => ({ groupName: names(o.groupId), keys: o.items.map((i) => `${i.type}:${i.id}`), status: o.status }));
}

export const SELECTION_LABEL: Record<string, { text: string; cls: string }> = {
  none: { text: 'No selection yet', cls: '' },
  submitted: { text: 'Waiting for approval', cls: 'warn' },
  approved: { text: 'Approved', cls: 'ok' },
  rejected: { text: 'Rejected', cls: 'bad' },
  needs_revision: { text: 'Needs changes', cls: 'bad' },
  draft: { text: 'Draft', cls: '' },
  cancelled: { text: 'Cancelled', cls: '' },
};

/** Saved remarks for a group's performance, plus a box to add one. */
export function RemarksBox({ slot, remarks }: { slot: Slot; remarks: Remark[] }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'feedback' | 'instruction'>('feedback');
  const [busy, setBusy] = useState(false);
  const mine = remarks.filter((r) => r.slotId === slot.id).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addPerformanceRemark({ slotId: slot.id, text: text.trim(), kind });
      setText('');
      notify('Remark saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save the remark', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <strong style={{ fontSize: '0.84rem' }}>{tx("Performance notes / remarks")}</strong>
      {mine.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#5b6776', margin: '0.25rem 0' }}>{tx("No remark saved yet.")}</p> : (
        <ul style={{ margin: '0.3rem 0', paddingLeft: '1.1rem', fontSize: '0.84rem' }}>
          {mine.map((r) => <li key={r.id}><em>{r.kind === 'instruction' ? tx("Instruction for next time: ") : tx("Feedback: ")}</em>{r.text} <span style={{ color: '#5b6776' }}>({r.authorName}, {formatInZone(tsMs(r.createdAt), slot.timeZone)})</span></li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'feedback' | 'instruction')} style={{ padding: '0.4rem', border: '1px solid #d9dfdb', borderRadius: 10, font: 'inherit' }}>
          <option value="feedback">{tx("Feedback")}</option>
          <option value="instruction">{tx("Instruction for next time")}</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Write a note for this group…")} style={{ flex: '1 1 180px', minWidth: 0, padding: '0.4rem 0.6rem', border: '1px solid #d9dfdb', borderRadius: 10, font: 'inherit' }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="fx2-btn primary" disabled={busy || !text.trim()} onClick={add}>{tx("Save note")}</button>
      </div>
    </div>
  );
}

/** Start / Complete buttons. The status only changes when an admin presses one; the clock never changes it. */
export function PerformanceControls({ slot, approved }: { slot: Slot; approved: boolean }) {
  const [busy, setBusy] = useState(false);
  const status = slot.performanceStatus ?? 'scheduled';
  async function go(next: 'started' | 'completed') {
    setBusy(true);
    try {
      await setPerformanceStatus({ slotId: slot.id, status: next });
      notify(next === 'started' ? 'Performance started' : 'Performance ended', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not change the status', 'error');
    } finally {
      setBusy(false);
    }
  }
  const pill = status === 'started' ? { cls: 'ok', t: 'On stage' } : status === 'completed' ? { cls: '', t: 'Finished' } : { cls: 'warn', t: 'Not started' };
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0', flexWrap: 'wrap' }}>
      <span className={`fx2-pill ${pill.cls}`}>{pill.t}</span>
      {status === 'scheduled' && <button className="fx2-btn primary" disabled={busy || !approved} title={approved ? '' : tx("Approve the group's books first")} onClick={() => go('started')}>{tx("Start performance")}</button>}
      {status === 'started' && <button className="fx2-btn primary" disabled={busy} onClick={() => go('completed')}>{tx("End performance")}</button>}
    </div>
  );
}

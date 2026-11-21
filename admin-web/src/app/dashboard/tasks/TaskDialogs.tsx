'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { editTask, remindTask } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tsMs } from '@/lib/useCollection';
import MemberPicker from '@/components/MemberPicker';
import DateTimePicker from '@/components/DateTimePicker';
import { PRIORITY, type TaskRow, type TPriority } from './taskTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const isoIn = (days: number, from = Date.now()) => isoDay(from + days * 86400000);
/** A date picked in the calendar means the end of that day, local time. */
export const endOfDay = (iso: string) => new Date(`${iso}T23:59:00`).getTime();

export function TkModal({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key); };
  }, [onClose]);
  return createPortal(
    <div className="mt-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mt-sheet${wide ? ' wide xl' : ' tkm'}`}>
        <header><div><h3>{title}</h3>{sub && <p className="tkm-sub">{sub}</p>}</div><button type="button" className="mt-x" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="mt-sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Block or cancel: a reason is written to the history. */
export function ReasonDialog({ title, sub, label, confirm, tone, required, onClose, onSubmit }: { title: string; sub: string; label: string; confirm: string; tone?: 'danger'; required?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <TkModal title={title} sub={sub} onClose={onClose} footer={<><button type="button" className="fx2-btn ghost" onClick={onClose}>{tx("Back")}</button><button type="button" className={`fx2-btn${tone === 'danger' ? ' danger' : ''}`} disabled={busy || (required && !v.trim())} onClick={async () => { setBusy(true); try { await onSubmit(v.trim()); onClose(); } finally { setBusy(false); } }}>{busy ? tx("Saving…") : confirm}</button></>}>
      <label className="tkm-f"><em>{label}{required ? ' *' : tx(" (optional)")}</em><textarea className="tk-ta" rows={4} autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={tx("Write it in a few words")} /></label>
    </TkModal>
  );
}

/** Move the deadline: quick steps or a day in the calendar. */
export function ExtendDialog({ t, onClose }: { t: TaskRow; onClose: () => void }) {
  const cur = t.dueAt ? tsMs(t.dueAt) : 0;
  const [day, setDay] = useState(cur ? isoDay(cur) : isoIn(7));
  const [busy, setBusy] = useState(false);
  const base = cur && cur > Date.now() ? cur : Date.now();
  const steps: [string, number][] = [['+1 day', 1], ['+3 days', 3], ['+1 week', 7], ['+2 weeks', 14], ['+1 month', 30]];
  async function save(clear = false) {
    setBusy(true);
    try { await editTask({ taskId: t.id, dueMs: clear ? null : endOfDay(day) }); notify(clear ? 'Deadline removed' : 'Deadline updated', 'success'); onClose(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    setBusy(false);
  }
  return (
    <TkModal title={cur ? tx("Change the deadline") : tx("Set a deadline")} sub={cur ? `Now: ${new Date(cur).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : tx("This task has no deadline yet.")} onClose={onClose}
      footer={<>{cur > 0 && <button type="button" className="fx2-btn danger" disabled={busy} onClick={() => void save(true)}>{tx("Remove the deadline")}</button>}<button type="button" className="fx2-btn ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fx2-btn" disabled={busy || !day} onClick={() => void save()}>{busy ? tx("Saving…") : tx("Save the deadline")}</button></>}>
      <div className="tkm-quick">{steps.map(([l, n]) => <button key={l} type="button" className={day === isoIn(n, base) ? 'on' : ''} onClick={() => setDay(isoIn(n, base))}>{l}</button>)}</div>
      <label className="tkm-f"><em>{tx("Or choose a day")}</em><DateTimePicker mode="date" value={day} onChange={setDay} placeholder={tx("Choose the deadline")} min={isoIn(0)} /></label>
      <p className="tkm-note">{tx("The people responsible are notified of the new deadline.")}</p>
    </TkModal>
  );
}

/** Send a reminder to the people responsible now. */
export function RemindDialog({ t, onClose }: { t: TaskRow; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { const r = await remindTask({ taskId: t.id, message: msg }); notify(`Reminder sent to ${r.data.sent} ${r.data.sent === 1 ? 'person' : 'people'}`, 'success'); onClose(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not send', 'error'); }
    setBusy(false);
  }
  return (
    <TkModal title={tx("Remind now")} sub={`${t.assigneeIds.length} ${t.assigneeIds.length === 1 ? 'person is' : 'people are'} responsible. They receive a notification.`} onClose={onClose}
      footer={<><button type="button" className="fx2-btn ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fx2-btn" disabled={busy} onClick={() => void send()}>{busy ? tx("Sending…") : tx("Send the reminder")}</button></>}>
      <div className="tkm-quick">{['Please send me an update on this task.', 'This task is now urgent.', 'The deadline is close. Can you finish it?'].map((x) => <button key={x} type="button" className={msg === x ? 'on' : ''} onClick={() => setMsg(x)}>{x}</button>)}</div>
      <label className="tkm-f"><em>{tx("Message (optional)")}</em><textarea className="tk-ta" rows={3} maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={tx("Add a few words for the team")} /></label>
    </TkModal>
  );
}

const PR: { k: TPriority; d: string }[] = [{ k: 'low', d: 'Can wait' }, { k: 'normal', d: 'Usual pace' }, { k: 'high', d: 'Soon' }, { k: 'urgent', d: 'Right now' }];

/** Edit the title, details, priority, deadline and people. */
export function EditDialog({ t, onClose }: { t: TaskRow; onClose: () => void }) {
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description ?? '');
  const [priority, setPriority] = useState<TPriority>(t.priority);
  const [due, setDue] = useState(t.dueAt ? isoDay(tsMs(t.dueAt)) : '');
  const [ids, setIds] = useState<string[]>(t.assigneeIds);
  const [busy, setBusy] = useState(false);
  const oldDue = t.dueAt ? isoDay(tsMs(t.dueAt)) : '';
  async function save() {
    setBusy(true);
    try {
      await editTask({
        taskId: t.id, title: title.trim(), description: desc.trim(), priority, assigneeIds: ids,
        ...(due !== oldDue ? { dueMs: due ? endOfDay(due) : null } : {}),
      });
      notify('Task updated', 'success'); onClose();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    setBusy(false);
  }
  return (
    <TkModal wide title={tx("Edit the task")} sub={tx("Change what is needed. The people affected are notified.")} onClose={onClose}
      footer={<><button type="button" className="fx2-btn ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fx2-btn" disabled={busy || !title.trim() || ids.length === 0} onClick={() => void save()}>{busy ? tx("Saving…") : tx("Save the changes")}</button></>}>
      <div className="tkm-two">
        <div className="tkm-col">
          <label className="tkm-f"><em>{tx("Title")}</em><input className="mc-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="tkm-f"><em>{tx("Details")}</em><textarea className="tk-ta" rows={5} maxLength={3000} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <div className="tkm-f"><em>{tx("Priority")}</em>
            <div className="tk-prs" role="radiogroup" aria-label={tx("Priority")}>{PR.map((p) => <button type="button" key={p.k} role="radio" aria-checked={priority === p.k} className={`${p.k}${priority === p.k ? ' on' : ''}`} onClick={() => setPriority(p.k)}><b>{PRIORITY[p.k]}</b><small>{p.d}</small></button>)}</div>
          </div>
          <div className="tkm-f"><em>{tx("Deadline")}</em>
            <div className="tkm-due"><div><DateTimePicker mode="date" value={due} onChange={setDue} placeholder={tx("No deadline")} /></div>{due && <button type="button" className="mb-reset" onClick={() => setDue('')}>{tx("No deadline")}</button>}</div>
          </div>
        </div>
        <div className="tkm-col">
          <div className="tkm-f"><em>{tx("Responsible ·")} {ids.length}</em></div>
          <MemberPicker multiple roleFilter value={ids} onChange={(v) => setIds(v)} />
        </div>
      </div>
    </TkModal>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { addTaskFeedback, setTaskReminders, updateTask } from '@/lib/functions';
import { tsMs } from '@/lib/useCollection';
import { useUserProfiles } from '@/lib/useUserNames';
import { notify } from '@/lib/notify';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink, ViewProfile } from '@/components/MemberProfile';
import DateTimePicker from '@/components/DateTimePicker';
import Dropdown from '@/components/Dropdown';
import { WizSvg, type WizIcon } from '@/components/WizardShell';
import { EditDialog, ExtendDialog, ReasonDialog, RemindDialog, isoDay } from './TaskDialogs';
import { PRIORITY, STATUS, daysLeft, isActive, type Task, type TaskRow, type TaskUpdate, type TStatus } from './taskTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

export type Profiles = Record<string, { name?: string; photoUrl?: string } | undefined>;
type Tab = 'overview' | 'updates' | 'feedback' | 'reminders';

export const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)} d ago`;
  return new Date(ms).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
};
export const dateLong = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (ms: number) => `${new Date(ms).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })} · ${new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}`;
export const dueText = (t: Task) => {
  if (!t.dueAt) return 'No deadline';
  const d = daysLeft(tsMs(t.dueAt));
  const date = new Date(tsMs(t.dueAt)).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  if (!isActive(t)) return date;
  return d < 0 ? `${date} · ${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? `${date} · today` : `${date} · in ${d} day${d === 1 ? '' : 's'}`;
};

const KIND: Record<string, { l: string; i: string }> = {
  created: { l: 'Created', i: '+' }, status: { l: 'Status', i: '↻' }, update: { l: 'Progress', i: '✎' },
  feedback: { l: 'Feedback', i: '“' }, edit: { l: 'Edited', i: '✐' }, reminder: { l: 'Reminder', i: '🔔' },
};

/**
 * One task, organised in four parts: Overview (facts, progress, people), Updates (add one, filter the history by date and kind),
 * Feedback (the team's comments) and Reminders (automatic alerts, planned reminders, remind now).
 */
export default function TaskDetail({ t, canManage, canUpdate, onClose }: { t: TaskRow; canManage: boolean; canUpdate: boolean; onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [dlg, setDlg] = useState<null | 'edit' | 'extend' | 'remind' | 'block' | 'cancel'>(null);
  const [busy, setBusy] = useState(false);
  const ups = useMemo(() => t.updates ?? [], [t.updates]);
  const ids = useMemo(() => Array.from(new Set([...t.assigneeIds, ...ups.map((u) => u.byId).filter(Boolean)])).slice(0, 80), [t.assigneeIds, ups]);
  const profiles = useUserProfiles(ids);
  const late = isActive(t) && !!t.dueAt && daysLeft(tsMs(t.dueAt)) < 0;
  const fbN = ups.filter((u) => u.kind === 'feedback').length;
  const updN = ups.filter((u) => u.kind === 'update' || u.kind === 'status').length;
  const remN = (t.reminders ?? []).filter((r) => !r.sent).length;

  async function setStatus(status: TStatus, note = '', progress?: number) {
    setBusy(true);
    try { await updateTask({ taskId: t.id, status, note, ...(progress !== undefined ? { progress } : {}) }); notify('Task updated', 'success'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    setBusy(false);
  }

  const tabs: { k: Tab; l: string; n?: number; i: WizIcon }[] = [
    { k: 'overview', l: 'Overview', i: 'doc' }, { k: 'updates', l: 'Updates', n: updN, i: 'list' },
    { k: 'feedback', l: 'Feedback', n: fbN, i: 'users' }, { k: 'reminders', l: 'Reminders', n: remN || undefined, i: 'clock' },
  ];

  return (
    <aside className="tk-detail tk2-d">
      <header className={`tk-dh s-${t.status}`}>
        <div className="tk-dh-top">
          <div className="tk-dh-chips"><i className={`tk-st ${t.status}`}>{STATUS[t.status]}</i><i className={`tk-pr ${t.priority}`}>{PRIORITY[t.priority]} {tx("priority")}</i>{late && <i className="tk-st late">{tx("Late")}</i>}</div>
          {onClose && <button type="button" className="tk2-x" onClick={onClose} aria-label={tx("Close")}>×</button>}
        </div>
        <h2>{t.title}</h2>
        <div className="tk-dh-from">{t.source === 'meeting' ? <>{tx("From the meeting")} <Link href="/dashboard/meetings">{t.meetingTitle}</Link>{t.pointTitle ? <> {tx("· point “")}{t.pointTitle}”</> : null}</> : <>{tx("Created by")} {t.createdByName || tx("an admin")}</>}</div>

        <div className="tk2-actions" role="toolbar" aria-label={tx("Task actions")}>
          {canUpdate && t.status === 'open' && <button type="button" className="a go" disabled={busy} onClick={() => void setStatus('in_progress', 'Work started.', Math.max(t.progress, 5))}>{tx("▶ Start work")}</button>}
          {canUpdate && (t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked') && <button type="button" className="a done" disabled={busy} onClick={() => void setStatus('done')}>{tx("✓ Mark done")}</button>}
          {canUpdate && t.status === 'in_progress' && <button type="button" className="a warn" disabled={busy} onClick={() => setDlg('block')}>{tx("⏸ Blocked")}</button>}
          {canUpdate && t.status === 'blocked' && <button type="button" className="a go" disabled={busy} onClick={() => void setStatus('in_progress', 'Work resumed.')}>{tx("▶ Resume")}</button>}
          {canUpdate && (t.status === 'done' || t.status === 'cancelled') && <button type="button" className="a go" disabled={busy} onClick={() => void setStatus(t.status === 'done' ? 'in_progress' : 'open', 'Task reopened.')}>{tx("↺ Reopen")}</button>}
          {canManage && <button type="button" className="a" onClick={() => setDlg('edit')}>{tx("✎ Edit")}</button>}
          {canManage && isActive(t) && <button type="button" className="a" onClick={() => setDlg('extend')}>📅 {t.dueAt ? tx("Change deadline") : tx("Set deadline")}</button>}
          {canManage && isActive(t) && <button type="button" className="a" onClick={() => setDlg('remind')}>{tx("🔔 Remind now")}</button>}
          {canManage && isActive(t) && <button type="button" className="a danger" onClick={() => setDlg('cancel')}>{tx("✕ Cancel task")}</button>}
        </div>
      </header>

      <nav className="tk2-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} className={tab === x.k ? 'on' : ''} onClick={() => setTab(x.k)}><WizSvg name={x.i} size={16} /> {x.l}{x.n ? <em>{x.n}</em> : null}</button>
        ))}
      </nav>

      <div className="tk2-body">
        {tab === 'overview' && <Overview t={t} profiles={profiles} late={late} busy={busy} onExtend={canManage ? () => setDlg('extend') : undefined} onStage={canUpdate ? (s) => void setStatus(s, s === 'done' ? '' : s === 'open' ? 'Moved back to to do.' : t.status === 'blocked' ? 'Work resumed.' : 'Work started.', s === 'in_progress' ? Math.max(t.progress, 5) : undefined) : undefined} />}
        {tab === 'updates' && <Updates t={t} ups={ups} profiles={profiles} canUpdate={canUpdate} />}
        {tab === 'feedback' && <Feedback t={t} ups={ups} profiles={profiles} />}
        {tab === 'reminders' && <Reminders t={t} ups={ups} canManage={canManage} onExtend={() => setDlg('extend')} onRemind={() => setDlg('remind')} />}
      </div>

      {dlg === 'edit' && <EditDialog t={t} onClose={() => setDlg(null)} />}
      {dlg === 'extend' && <ExtendDialog t={t} onClose={() => setDlg(null)} />}
      {dlg === 'remind' && <RemindDialog t={t} onClose={() => setDlg(null)} />}
      {dlg === 'block' && <ReasonDialog title={tx("Mark as blocked")} sub={tx("Say what is in the way, so the others can help.")} label={tx("What is blocking the task?")} confirm="Mark as blocked" required onClose={() => setDlg(null)} onSubmit={(r) => setStatus('blocked', r)} />}
      {dlg === 'cancel' && <ReasonDialog title={tx("Cancel this task")} sub={tx("The task is closed and kept in the history. The people responsible are no longer reminded.")} label={tx("Why is it cancelled?")} confirm="Cancel the task" tone="danger" onClose={() => setDlg(null)} onSubmit={(r) => setStatus('cancelled', r)} />}
    </aside>
  );
}

/* ---------------- Overview ---------------- */

function Overview({ t, profiles, late, busy, onExtend, onStage }: { t: TaskRow; profiles: Profiles; late: boolean; busy: boolean; onExtend?: () => void; onStage?: (s: TStatus) => void }) {
  const created = tsMs(t.createdAt);
  const done = t.completedAt ? tsMs(t.completedAt) : 0;
  const lastMs = t.updates?.length ? Math.max(...t.updates.map((u) => tsMs(u.at))) : tsMs(t.updatedAt);
  const by = (id: string) => (t.updates ?? []).filter((u) => u.byId === id && (u.kind === 'update' || u.kind === 'status')).length;
  const facts: { i: WizIcon; l: string; v: string; s?: string; tone?: string }[] = [
    { i: 'calendar', l: 'Deadline', v: t.dueAt ? dateLong(tsMs(t.dueAt)) : 'No deadline', s: t.dueAt ? (isActive(t) ? (daysLeft(tsMs(t.dueAt)) < 0 ? `${-daysLeft(tsMs(t.dueAt))} day(s) late` : daysLeft(tsMs(t.dueAt)) === 0 ? 'Due today' : `In ${daysLeft(tsMs(t.dueAt))} day(s)`) : undefined) : 'Add one to get alerts', tone: late ? 'red' : t.dueAt ? '' : 'idle' },
    { i: 'shield', l: 'Priority', v: PRIORITY[t.priority], tone: t.priority === 'urgent' ? 'red' : t.priority === 'high' ? 'gold' : '' },
    { i: 'doc', l: 'Origin', v: t.source === 'meeting' ? (t.meetingTitle || 'A meeting') : 'Created by an admin', s: t.source === 'meeting' ? (t.pointTitle ? `Point “${t.pointTitle}”` : 'Decided in a meeting') : t.createdByName },
    { i: 'clock', l: done ? 'Completed' : 'Created', v: dateLong(done || created), s: done ? `Took ${Math.max(1, Math.round((done - created) / 86400000))} day(s)` : `${Math.max(0, Math.round((Date.now() - created) / 86400000))} day(s) ago` },
    { i: 'list', l: 'Last activity', v: ago(lastMs), s: `${(t.updates ?? []).length} entries in the history` },
    { i: 'users', l: 'Responsible', v: `${t.assigneeIds.length} ${t.assigneeIds.length === 1 ? 'person' : 'people'}`, s: `Created by ${t.createdByName || '—'}` },
  ];
  const stage = t.status === 'done' ? 2 : t.status === 'in_progress' || t.status === 'blocked' ? 1 : 0;
  return (
    <div className="tk2-ov">
      <div className="tk2-facts">
        {facts.map((f) => (
          <div key={f.l} className={`tk2-fact ${f.tone ?? ''}`}>
            <i><WizSvg name={f.i} size={18} /></i>
            <span><small>{f.l}</small><b>{f.v}</b>{f.s && <em>{f.s}</em>}</span>
            {f.l === 'Deadline' && onExtend && isActive(t) && <button type="button" className="tk2-mini" onClick={onExtend}>{t.dueAt ? tx("Change") : tx("Set")}</button>}
          </div>
        ))}
      </div>

      <section className="tk2-card">
        <h4>{tx("Details")}</h4>
        {t.description ? <p className="tk2-desc">{t.description}</p> : <p className="tk-none">{tx("No details were written for this task.")}</p>}
      </section>

      <section className="tk2-card">
        <h4>{tx("Progress")} <em>{t.progress}%</em></h4>
        <div className="tk-prog"><i style={{ width: `${t.progress}%` }} /></div>
        <ol className="tk2-steps" aria-label={tx("Stage")}>
          {([['open', 'To do'], ['in_progress', t.status === 'blocked' ? 'Blocked' : 'In progress'], ['done', t.status === 'cancelled' ? 'Cancelled' : 'Done']] as [TStatus, string][]).map(([k, l], i) => {
            const here = i === stage;
            return (
              <li key={k} className={`${i < stage ? 'past' : here ? 'cur' : ''}${t.status === 'blocked' && i === 1 ? ' bad' : ''}${t.status === 'cancelled' && i === 2 ? ' bad cur' : ''}`}>
                <button type="button" disabled={!onStage || busy || (here && t.status !== 'blocked' && t.status !== 'cancelled')} onClick={() => onStage?.(k)} title={onStage ? `Move the task to “${l}”` : undefined}><i>{i < stage ? '✓' : i + 1}</i>{l}</button>
              </li>
            );
          })}
        </ol>
        {onStage && <p className="tk2-hint">{tx("Click a step to move the task there.")}</p>}
      </section>

      <section className="tk2-card">
        <h4>{tx("Responsible")} <em>{t.assigneeIds.length}</em></h4>
        {t.assigneeIds.length === 0 ? <p className="tk-none">{tx("Nobody is responsible yet.")}</p> : (
          <>
            <p className="tk2-ppl-s"><b>{t.assigneeIds.filter((id) => by(id) > 0).length}</b> {tx("of")} {t.assigneeIds.length} {tx("posted an update")}</p>
            <ul className="tk2-ppl">
              {t.assigneeIds.map((id, i) => (
                <li key={id} className={by(id) > 0 ? 'act' : ''}>
                  <Avatar name={profiles[id]?.name || t.assigneeNames[i] || ''} photoUrl={profiles[id]?.photoUrl} size={44} />
                  <span><PersonLink userId={id}><b>{profiles[id]?.name || t.assigneeNames[i] || tx("Member")}</b></PersonLink><small>{by(id) ? `${by(id)} update${by(id) === 1 ? '' : 's'}` : tx("No update yet")}</small></span>
                  <ViewProfile userId={id} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/* ---------------- Updates ---------------- */

type KindF = 'all' | 'progress' | 'status' | 'edit' | 'reminder';

function Updates({ t, ups, profiles, canUpdate }: { t: TaskRow; ups: TaskUpdate[]; profiles: Profiles; canUpdate: boolean }) {
  const today = isoDay(Date.now());
  const [status, setStatus] = useState<TStatus>(t.status);
  const [progress, setProgress] = useState(t.progress);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(today);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<KindF>('all');
  const [who, setWho] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(25);
  const dirty = status !== t.status || progress !== t.progress || note.trim() !== '';

  async function save() {
    setBusy(true);
    try {
      const day = when > today ? today : when;
      await updateTask({ taskId: t.id, status, progress, note, ...(day !== today ? { atMs: new Date(`${day}T12:00:00`).getTime() } : {}) });
      notify('Update saved', 'success'); setNote(''); setWhen(today);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    setBusy(false);
  }

  const people = useMemo(() => {
    const m = new Map<string, string>();
    ups.filter((u) => u.kind !== 'feedback').forEach((u) => { if (u.byId) m.set(u.byId, profiles[u.byId]?.name || u.byName || u.byId); });
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [ups, profiles]);

  const list = useMemo(() => {
    const f = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const e = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
    return ups.filter((u) => u.kind !== 'feedback')
      .filter((u) => kind === 'all' || (kind === 'progress' ? u.kind === 'update' : kind === 'status' ? u.kind === 'status' : kind === 'edit' ? u.kind === 'edit' || u.kind === 'created' : u.kind === 'reminder'))
      .filter((u) => !who || u.byId === who)
      .filter((u) => tsMs(u.at) >= f && tsMs(u.at) <= e)
      .sort((a, b) => tsMs(b.at) - tsMs(a.at));
  }, [ups, kind, who, from, to]);
  const all = ups.filter((u) => u.kind !== 'feedback').length;
  const vis = list.slice(0, limit);
  const days: { d: string; items: TaskUpdate[] }[] = [];
  for (const u of vis) {
    const d = dateLong(tsMs(u.at));
    const g = days[days.length - 1];
    if (g && g.d === d) g.items.push(u); else days.push({ d, items: [u] });
  }
  const filtered = kind !== 'all' || who || from || to;

  return (
    <div className="tk2-up">
      {canUpdate && isActive(t) ? (
        <section className="tk2-card tk2-form">
          <h4>{tx("Add an update")}</h4>
          <div className="tk2-form-g">
            <label><em>{tx("Date of this update")}</em><DateTimePicker mode="date" value={when} onChange={(v) => setWhen(v > today ? today : v)} placeholder={tx("Today")} /></label>
            <div className="tk2-st">
              <em>{tx("Status")}</em>
              <div className="tk-seg" role="radiogroup" aria-label={tx("Status")}>
                {(['open', 'in_progress', 'blocked', 'done'] as TStatus[]).map((s) => <button key={s} type="button" role="radio" aria-checked={status === s} className={`${s}${status === s ? ' on' : ''}`} onClick={() => { setStatus(s); if (s === 'done') setProgress(100); }}>{STATUS[s]}</button>)}
              </div>
            </div>
          </div>
          <label className="tk2-range"><em>{tx("Progress")} <b>{progress}%</b></em>
            <input className="tk-range" type="range" min={0} max={100} step={5} value={progress} onChange={(e) => { const v = Number(e.target.value); setProgress(v); if (v === 100) setStatus('done'); else if (status === 'done') setStatus('in_progress'); else if (v > 0 && status === 'open') setStatus('in_progress'); }} />
          </label>
          <textarea className="tk-ta" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx("What was done? What is next?")} />
          <div className="tk-act"><button type="button" className="tk-go" disabled={!dirty || busy} onClick={() => void save()}>{busy ? tx("Saving…") : tx("Save the update")}</button>{dirty && <button type="button" className="tk-ghost" onClick={() => { setStatus(t.status); setProgress(t.progress); setNote(''); }}>{tx("Reset")}</button>}</div>
        </section>
      ) : <p className="tk2-closed">{isActive(t) ? tx("Only the people responsible and admins can add updates.") : `This task is ${STATUS[t.status].toLowerCase()}. Reopen it to add updates.`}</p>}

      <section className="tk2-card">
        <h4>{tx("History")} <em>{list.length}{filtered ? ` of ${all}` : ''}</em></h4>
        <div className="tk2-flt">
          <div className="tk2-chips" role="tablist" aria-label={tx("Type")}>
            {([['all', 'All'], ['progress', 'Progress'], ['status', 'Status'], ['edit', 'Edits'], ['reminder', 'Reminders']] as [KindF, string][]).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setLimit(25); }}>{l}</button>)}
          </div>
          <div className="tk2-flt-r">
            <div className="tk2-date"><DateTimePicker mode="date" value={from} onChange={(v) => { setFrom(v); setLimit(25); }} placeholder={tx("From")} /></div>
            <span aria-hidden>→</span>
            <div className="tk2-date"><DateTimePicker mode="date" value={to} onChange={(v) => { setTo(v); setLimit(25); }} placeholder={tx("To")} min={from || undefined} /></div>
            {people.length > 1 && <div className="tk2-who"><Dropdown label={tx("By")} value={who} onChange={(v) => { setWho(v); setLimit(25); }} allLabel="Everyone" options={people} /></div>}
            {filtered && <button type="button" className="mb-reset" onClick={() => { setKind('all'); setWho(''); setFrom(''); setTo(''); }}>{tx("Reset")}</button>}
          </div>
        </div>
        {list.length === 0 ? <p className="tk-none">{all === 0 ? tx("Nothing has been recorded yet.") : tx("No entry in this period. Change the dates or the type.")}</p> : (
          <div className="tk2-days">
            {days.map((g) => (
              <div key={g.d} className="tk2-day">
                <h5>{g.d}<em>{g.items.length}</em></h5>
                <ol className="tk-tl">
                  {g.items.map((u) => (
                    <li key={u.id} className={u.kind}>
                      <i aria-hidden="true">{KIND[u.kind]?.i ?? '•'}</i>
                      <div>
                        <p><b className="tk2-by">{u.byId && <Avatar name={profiles[u.byId]?.name || u.byName || ''} photoUrl={profiles[u.byId]?.photoUrl} size={22} />}{profiles[u.byId]?.name || u.byName || tx("System")}</b><em>{KIND[u.kind]?.l ?? u.kind}</em><time>{dateTime(tsMs(u.at))}</time></p>
                        <span>{u.text}</span>
                        {u.progress !== undefined && (u.kind === 'update' || u.kind === 'status') && <u className="tk2-pg"><i style={{ width: `${u.progress}%` }} /><small>{u.progress}%</small></u>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {list.length > limit && <button type="button" className="pf-more" onClick={() => setLimit(limit + 25)}>{tx("Show 25 more ·")} {list.length - limit} {tx("left")}</button>}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- Feedback ---------------- */

function Feedback({ t, ups, profiles }: { t: TaskRow; ups: TaskUpdate[]; profiles: Profiles }) {
  const [fb, setFb] = useState('');
  const [busy, setBusy] = useState(false);
  const list = ups.filter((u) => u.kind === 'feedback').sort((a, b) => tsMs(b.at) - tsMs(a.at));
  async function send() {
    if (!fb.trim()) return;
    setBusy(true);
    try { await addTaskFeedback({ taskId: t.id, text: fb }); notify('Feedback added', 'success'); setFb(''); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not send', 'error'); }
    setBusy(false);
  }
  return (
    <div className="tk2-fbk">
      <section className="tk2-card">
        <h4>{tx("Write feedback")}</h4>
        <textarea className="tk-ta" rows={3} value={fb} onChange={(e) => setFb(e.target.value)} placeholder={tx("Your remark, a question or a word of thanks for the team")} />
        <div className="tk-act"><button type="button" className="tk-go" disabled={!fb.trim() || busy} onClick={() => void send()}>{busy ? tx("Sending…") : tx("Send feedback")}</button></div>
      </section>
      <section className="tk2-card">
        <h4>{tx("Team feedback")} <em>{list.length}</em></h4>
        {list.length === 0 ? <p className="tk-none">{tx("No feedback yet. Be the first to write.")}</p> : (
          <ul className="tk2-cm">
            {list.map((u) => {
              const mine = t.assigneeIds.includes(u.byId);
              return (
                <li key={u.id}>
                  <Avatar name={profiles[u.byId]?.name || u.byName} photoUrl={profiles[u.byId]?.photoUrl} size={46} />
                  <div>
                    <p className="tk2-cm-h">
                      <PersonLink userId={u.byId}><b>{profiles[u.byId]?.name || u.byName || tx("Member")}</b></PersonLink>
                      <i className={mine ? 'res' : 'adm'}>{mine ? tx("Responsible") : u.byId === t.createdBy ? tx("Creator") : tx("Admin")}</i>
                      <time title={dateTime(tsMs(u.at))}>{dateTime(tsMs(u.at))} · {ago(tsMs(u.at))}</time>
                      {u.byId && <ViewProfile userId={u.byId} />}
                    </p>
                    <span>{u.text}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------- Reminders ---------------- */

function Reminders({ t, ups, canManage, onExtend, onRemind }: { t: TaskRow; ups: TaskUpdate[]; canManage: boolean; onExtend: () => void; onRemind: () => void }) {
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const auto = t.autoRemind !== false;
  const planned = (t.reminders ?? []).map((r) => ({ ...r, ms: tsMs(r.at) })).sort((a, b) => a.ms - b.ms);
  const sent = ups.filter((u) => u.kind === 'reminder').sort((a, b) => tsMs(b.at) - tsMs(a.at));
  const dueMs = t.dueAt ? tsMs(t.dueAt) : 0;
  const active = isActive(t);
  const al = t.alertState ?? {};
  const todayIso = isoDay(Date.now());
  const sched: { l: string; when: string; msg: string; st: 'sent' | 'wait' | 'skip' }[] = dueMs ? (() => {
    const dd = isoDay(dueMs);
    const dm1 = isoDay(dueMs - 86400000);
    const st = (iso: string, sentFlag?: boolean): 'sent' | 'wait' | 'skip' => (sentFlag ? 'sent' : iso < todayIso ? 'skip' : 'wait');
    return [
      { l: 'The day before', when: dateLong(dueMs - 86400000), msg: '“Due tomorrow”', st: st(dm1, al.soon) },
      { l: 'On the deadline day', when: dateLong(dueMs), msg: '“Due today”', st: st(dd, al.today) },
      { l: 'Every day while late', when: `From ${dateLong(dueMs + 86400000)}, up to 14 days`, msg: 'Also sent to the creator', st: al.lateDay ? 'sent' : 'wait' },
    ];
  })() : [
    { l: 'The day before', when: 'Needs a deadline', msg: '“Due tomorrow”', st: 'wait' },
    { l: 'On the deadline day', when: 'Needs a deadline', msg: '“Due today”', st: 'wait' },
    { l: 'Every day while late', when: 'Needs a deadline', msg: 'Also sent to the creator', st: 'wait' },
  ];

  async function persist(nextAuto: boolean, list: { id: string; ms: number; note?: string; sent?: boolean }[]) {
    setBusy(true);
    try { await setTaskReminders({ taskId: t.id, autoRemind: nextAuto, reminders: list.filter((r) => !r.sent).map((r) => ({ id: r.id, atMs: r.ms, note: r.note ?? '' })) }); notify('Saved', 'success'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    setBusy(false);
  }
  const addAt = (ms: number, n = note) => { void persist(auto, [...planned, { id: '', ms, note: n }]); setAt(''); setNote(''); };
  const quick: [string, number][] = [];
  if (dueMs) {
    const nine = (ms: number) => { const d = new Date(ms); d.setHours(9, 0, 0, 0); return d.getTime(); };
    quick.push(['1 day before, 09:00', nine(dueMs - 86400000)], ['3 days before, 09:00', nine(dueMs - 3 * 86400000)], ['On the day, 09:00', nine(dueMs)]);
  }
  const future = quick.filter(([, ms]) => ms > Date.now());

  return (
    <div className="tk2-rem">
      <section className="tk2-card">
        <div className="tk2-sw">
          <div><h4>{tx("Automatic alerts")}</h4><p>{tx("The people responsible are notified by themselves, so nothing is forgotten.")}</p></div>
          {canManage ? (
            <button type="button" role="switch" aria-checked={auto} aria-label={tx("Automatic alerts")} className={`tk2-switch${auto ? ' on' : ''}`} disabled={busy || !active} onClick={() => void persist(!auto, planned)}><i /></button>
          ) : <span className={`tk-st ${auto ? '' : 'cancelled'}`}>{auto ? tx("On") : tx("Off")}</span>}
        </div>
        <ul className={`tk2-alerts${auto && t.dueAt ? '' : ' off'}`}>
          {sched.map((x, i) => (
            <li key={x.l} className={x.st}><i>{i + 1}</i><b>{x.l}<small>{x.when}</small></b><span>{x.msg}</span><em>{x.st === 'sent' ? tx("Sent") : x.st === 'skip' ? tx("Passed") : tx("Scheduled")}</em></li>
          ))}
        </ul>
        <p className="tk2-how">{tx("Checked every hour. Each person responsible gets a notification in the app, and the creator is told when the task is late. Nothing is sent once the task is done or cancelled.")}</p>
        {!t.dueAt && <div className="tk2-warn"><span>{tx("This task has no deadline, so no automatic alert can be sent.")}</span>{canManage && <button type="button" onClick={onExtend}>{tx("Set a deadline")}</button>}</div>}
      </section>

      <section className="tk2-card">
        <h4>{tx("Planned reminders")} <em>{planned.filter((r) => !r.sent).length}</em></h4>
        {planned.length === 0 ? <p className="tk-none">{tx("No reminder is planned.")}</p> : (
          <ul className="tk2-pl">
            {planned.map((r) => (
              <li key={r.id} className={r.sent ? 'sent' : ''}>
                <i aria-hidden>🔔</i>
                <span><b>{dateLong(r.ms)} · {new Date(r.ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}</b>{r.note && <small>{r.note}</small>}</span>
                <em className={r.sent ? 'ok' : ''}>{r.sent ? tx("Sent") : tx("Planned")}</em>
                {canManage && !r.sent && <button type="button" aria-label={tx("Remove this reminder")} disabled={busy} onClick={() => void persist(auto, planned.filter((x) => x.id !== r.id))}>×</button>}
              </li>
            ))}
          </ul>
        )}
        {canManage && active && (
          <div className="tk2-add">
            {future.length > 0 && <div className="tkm-quick">{future.map(([l, ms]) => <button key={l} type="button" disabled={busy} onClick={() => addAt(ms, '')}>{l}</button>)}</div>}
            <div className="tk2-add-r">
              <div className="tk2-date wide"><DateTimePicker value={at} onChange={setAt} placeholder={tx("Pick a day and time")} min={isoDay(Date.now())} /></div>
              <input className="tk2-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={tx("Message (optional)")} aria-label={tx("Reminder message")} />
              <button type="button" className="tk-go" disabled={busy || !at || new Date(at).getTime() <= Date.now()} onClick={() => addAt(new Date(at).getTime())}>{tx("Add")}</button>
            </div>
          </div>
        )}
      </section>

      <section className="tk2-card">
        <div className="tk2-sw">
          <div><h4>{tx("Remind now")}</h4><p>{t.lastRemindedAt ? `Last reminder ${ago(tsMs(t.lastRemindedAt))}.` : tx("Send a notification to the people responsible right now.")}</p></div>
          {canManage && active && <button type="button" className="tk-go" onClick={onRemind}>{tx("🔔 Remind now")}</button>}
        </div>
        {sent.length > 0 && (
          <ul className="tk2-log">
            {sent.slice(0, 6).map((u) => <li key={u.id}><time>{dateTime(tsMs(u.at))}</time><span>{u.text}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

export type { Task };

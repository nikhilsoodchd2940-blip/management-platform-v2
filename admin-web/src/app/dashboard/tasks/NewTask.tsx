'use client';

import { useMemo, useState } from 'react';
import { createTask } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tsMs } from '@/lib/useCollection';
import { useUserProfiles } from '@/lib/useUserNames';
import MemberPicker, { Avatar } from '@/components/MemberPicker';
import { PersonLink, ViewProfile } from '@/components/MemberProfile';
import DateTimePicker from '@/components/DateTimePicker';
import Dropdown from '@/components/Dropdown';
import WizardShell, { WizSvg, type WizIcon } from '@/components/WizardShell';
import { PRIORITY, daysLeft, type MeetingLite, type TPriority, type TaskRow } from './taskTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

const STEPS: { n: number; label: string; sub: string }[] = [
  { n: 1, label: 'What', sub: 'Title and priority' },
  { n: 2, label: 'Who', sub: 'Who is responsible' },
  { n: 3, label: 'When', sub: 'Deadline' },
  { n: 4, label: 'Review', sub: 'Check and create' },
];
const PANELS: { t: string; s: string; i: WizIcon }[] = [
  { t: 'What is the task?', s: 'Say clearly what has to be done.', i: 'doc' },
  { t: 'Who is responsible?', s: 'Choose one or several people. They are notified.', i: 'users' },
  { t: 'When is it due?', s: 'Pick a deadline, or leave it open.', i: 'clock' },
  { t: 'Review and create', s: 'Check the summary, then create the task.', i: 'check' },
];
const PR: { k: TPriority; d: string }[] = [
  { k: 'low', d: 'Can wait' },
  { k: 'normal', d: 'Usual pace' },
  { k: 'high', d: 'Soon' },
  { k: 'urgent', d: 'Right now' },
];
const pad = (n: number) => String(n).padStart(2, '0');
const isoIn = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };

/** Creating a task uses the same step-by-step screen as creating a meeting. */
const localDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function NewTask({ rows, meetings, onClose, onCreated }: { rows: TaskRow[]; meetings: (MeetingLite & { id: string })[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(1);
  const [passed, setPassed] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState<TPriority>('normal');
  const [meetingId, setMeetingId] = useState('');
  const [mDay, setMDay] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const profiles = useUserProfiles(ids.slice(0, 120));
  const meeting = meetings.find((m) => m.id === meetingId);
  const dayMeetings = useMemo(() => (mDay ? meetings.filter((m) => localDay(tsMs(m.startAt)) === mDay) : meetings), [meetings, mDay]);
  const nameOf = (id: string) => profiles[id]?.name || 'Member';

  // The workload of the chosen people, from the tasks already given.
  const load = useMemo(() => ids.map((id) => {
    const mine = rows.filter((t) => t.assigneeIds.includes(id) && t.status !== 'done' && t.status !== 'cancelled');
    return { id, open: mine.length, late: mine.filter((t) => t.dueAt && daysLeft(tsMs(t.dueAt)) < 0).length };
  }), [ids, rows]);

  const dueMs = due ? new Date(`${due}T12:00:00`).getTime() : NaN;
  const dueDays = Number.isFinite(dueMs) ? daysLeft(dueMs) : null;
  const dueWords = due ? new Date(dueMs).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'No deadline';

  const check = (n: number): string => {
    if (n === 1 && !title.trim()) return 'Give the task a title.';
    if (n === 2 && ids.length === 0) return 'Choose at least one person.';
    if (n === 3 && due && dueDays !== null && dueDays < 0) return 'The deadline is in the past.';
    return '';
  };
  const next = () => { const e = check(step); if (e) { setErr(e); return; } setErr(''); setPassed((p) => (p.includes(step) ? p : [...p, step])); setStep(step + 1); };
  const back = () => { setErr(''); setStep(Math.max(1, step - 1)); };
  const go = (n: number) => { if (n < step) { setErr(''); setStep(n); } };

  async function create() {
    for (const n of [1, 2, 3]) { const e = check(n); if (e) { setErr(e); setStep(n); return; } }
    setBusy(true);
    setErr('');
    try {
      const r = await createTask({ title: title.trim(), description: desc.trim(), assigneeIds: ids, priority, ...(due ? { dueMs: dueMs } : {}), ...(meetingId ? { meetingId } : {}) });
      notify(`Task created. ${ids.length} ${ids.length === 1 ? 'person was' : 'people were'} notified.`, 'success');
      onCreated(r.data.taskId);
    } catch (e) { setErr(e instanceof Error ? e.message : tx("Could not create the task")); }
    setBusy(false);
  }

  return (
    <WizardShell
      overlay
      title={tx("Manage Tasks")}
      setup="Task Setup"
      subtitle={tx("Give a task, follow it, get the team’s feedback")}
      steps={STEPS.map((x) => ({ ...x, done: passed.includes(x.n) }))}
      current={step}
      onStep={go}
      panelTitle={PANELS[step - 1].t}
      panelSub={PANELS[step - 1].s}
      panelIcon={PANELS[step - 1].i}
      onClose={onClose}
      recap={[
        { label: tx("Task"), value: title.trim() },
        { label: tx("Priority"), value: PRIORITY[priority] },
        { label: tx("Responsible"), value: ids.length ? String(ids.length) : '' },
        { label: tx("Due"), value: due ? new Date(dueMs).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '' },
      ]}
      footer={
        <>
          <button type="button" className="wzs-btn" onClick={onClose} disabled={busy}>{tx("Cancel")}</button>
          {err ? <p className="wzs-err" role="alert">{err}</p> : <span className="sp" />}
          <button type="button" className="wzs-btn" onClick={back} disabled={step === 1 || busy}>{tx("‹ Back")}</button>
          {step < 4 ? <button type="button" className="wzs-btn go" onClick={next}>{tx("Next:")} {STEPS[step].label} ›</button> : <button type="button" className="wzs-btn go" disabled={busy} onClick={() => void create()}>{busy ? tx("Creating…") : tx("Create the task ✓")}</button>}
        </>
      }
    >
      {step === 1 && (
        <div className="mw-two tk-w">
          <div className="mw-col">
            <label className="mc-f"><em>{tx("Title")}</em><input className="mc-title" autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tx("e.g. Send the list of the new hosts")} /><small className="mw-count">{title.length}/200</small></label>
            <label className="mc-f"><em>{tx("Details")} <small>{tx("optional")}</small></em><textarea className="tk-ta" rows={5} maxLength={3000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={tx("What exactly has to be done, and what does done look like?")} /></label>
            <div className="mc-f"><em>{tx("Come from a meeting?")} <small>{tx("optional")}</small></em>
              <div className="tk-mday">
                <div className="tk-mday-d"><DateTimePicker mode="date" value={mDay} onChange={(v) => { setMDay(v); if (v && meetingId && localDay(tsMs(meeting?.startAt)) !== v) setMeetingId(''); }} placeholder={tx("Filter by date")} /></div>
                {mDay && <button type="button" className="tk-mday-x" onClick={() => setMDay('')}>{tx("All dates")}</button>}
              </div>
              <Dropdown label={tx("Meeting")} value={meetingId} onChange={setMeetingId} allLabel="Not linked to a meeting" options={dayMeetings.map((m) => ({ value: m.id, label: m.title, hint: new Date(tsMs(m.startAt)).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) }))} />
              <small className="tk-mday-n">{mDay ? (dayMeetings.length ? `${dayMeetings.length} meeting${dayMeetings.length === 1 ? '' : 's'} on ${new Date(`${mDay}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}` : tx("No meeting on this date. Pick another day or choose All dates.")) : `${meetings.length} meetings. Pick a date to see only that day.`}</small>
            </div>
          </div>
          <div className="mw-col">
            <div className="mc-f"><em>{tx("Priority")}</em></div>
            <div className="tk-prs" role="radiogroup" aria-label={tx("Priority")}>
              {PR.map((p) => (
                <button type="button" key={p.k} role="radio" aria-checked={priority === p.k} className={`${p.k}${priority === p.k ? ' on' : ''}`} onClick={() => setPriority(p.k)}><b>{PRIORITY[p.k]}</b><small>{p.d}</small></button>
              ))}
            </div>
            <ul className="mw-check">
              <li className={title.trim() ? 'ok' : ''}><i>{title.trim() ? '✓' : '1'}</i><b>{tx("Title")}</b><span>{title.trim() ? tx("Done") : tx("Say what has to be done")}</span></li>
              <li className="ok"><i>✓</i><b>{tx("Priority")}</b><span>{PRIORITY[priority]}</span></li>
              <li className={meeting ? 'ok' : ''}><i>{meeting ? '✓' : '3'}</i><b>{tx("Meeting")}</b><span>{meeting ? meeting.title : tx("Not linked")}</span></li>
              <li><i>›</i><b>{tx("Next")}</b><span>{tx("Who and when")}</span></li>
            </ul>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mw-two tk-w">
          <div className="mw-col">
            <div className="mc-f"><em>{tx("Responsible *")} <small>{tx("search and pick one or several people")}</small></em><MemberPicker multiple hideChosen roleFilter value={ids} onChange={setIds} /></div>
          </div>
          <div className="mw-col">
            <Assigned ids={ids} load={load} profiles={profiles} onRemove={(id) => setIds(ids.filter((x) => x !== id))} onClear={() => setIds([])} title={tx("Chosen")} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mw-two tk-w">
          <div className="mw-col">
            <div className="mw-quick"><span>{tx("Quick")}</span>
              {[['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['In 2 weeks', 14], ['In a month', 30]].map(([l, d]) => <button type="button" key={String(l)} className={due === isoIn(Number(d)) ? 'on' : ''} onClick={() => setDue(isoIn(Number(d)))}>{l}</button>)}
              <button type="button" className={!due ? 'on' : ''} onClick={() => setDue('')}>{tx("No deadline")}</button>
            </div>
            <div className="mc-f"><em>{tx("Or choose a day")}</em><DateTimePicker mode="date" value={due} onChange={setDue} placeholder={tx("Choose the deadline")} min={isoIn(0)} /></div>
            <div className="mw-bn">
              <div><WizSvg name="clock" /><span><small>{tx("Deadline")}</small><b>{due ? new Date(dueMs).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '—'}</b><em>{dueWords}</em></span></div>
              <div className="gold"><WizSvg name="list" /><span><small>{tx("Time left")}</small><b>{dueDays === null ? '—' : dueDays === 0 ? tx("Today") : `${dueDays} d`}</b><em>{dueDays === null ? tx("The task stays open") : tx("From today")}</em></span></div>
              <div className="dark"><WizSvg name="users" /><span><small>{tx("Responsible")}</small><b>{ids.length}</b><em>{ids.length === 1 ? tx("person") : tx("people")} {tx("notified")}</em></span></div>
            </div>
            <div className="tk-sum">
              <div><small>{tx("Task")}</small><b>{title || '—'}</b></div>
              <div><small>{tx("Priority")}</small><b className={`pr-${priority}`}>{PRIORITY[priority]}</b></div>
              <div><small>{tx("From meeting")}</small><b>{meeting ? meeting.title : tx("Not linked")}</b></div>
              <div><small>{tx("Details")}</small><b>{desc.trim() ? `${desc.trim().length} characters` : tx("None")}</b></div>
            </div>
          </div>
          <div className="mw-col">
            <Assigned ids={ids} load={load} profiles={profiles} title={tx("Responsible")} hint={tx("Their current workload, so nobody gets overloaded.")} />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mw-two tk-w">
          <div className="mw-col">
            <div className="tk-rev">
              <div className="tk-rev-t"><small>{tx("Task")}</small><b>{title}</b>{desc && <p>{desc}</p>}</div>
              <div className="tk-rev-g">
                <div className={`pr-${priority}`}><WizSvg name="shield" size={18} /><span><small>{tx("Priority")}</small><b>{PRIORITY[priority]}</b></span></div>
                <div><WizSvg name="clock" size={18} /><span><small>{tx("Due")}</small><b>{due ? dueWords : tx("No deadline")}</b>{dueDays !== null && <em>{dueDays === 0 ? tx("Today") : `In ${dueDays} day${dueDays === 1 ? '' : 's'}`}</em>}</span></div>
                <div><WizSvg name="doc" size={18} /><span><small>{tx("Meeting")}</small><b>{meeting?.title ?? tx("Not linked")}</b></span></div>
                <div><WizSvg name="users" size={18} /><span><small>{tx("Responsible")}</small><b>{ids.length} {ids.length === 1 ? tx("person") : tx("people")}</b></span></div>
              </div>
            </div>
            <div className="mw-coban"><WizSvg name="shield" size={30} /><div><b>{tx("Followed from the Tasks section")}</b><small>{tx("The people responsible update the progress. Everyone concerned can add feedback.")}</small></div></div>
          </div>
          <div className="mw-col">
            <Assigned ids={ids} load={load} profiles={profiles} title={tx("Will be notified")} />
          </div>
        </div>
      )}
    </WizardShell>
  );
}

type Load = { id: string; open: number; late: number };

/** The people chosen, one compact card: photo, name, how much they already have, and a way to remove them. */
function Assigned({ ids, load, profiles, title, hint, onRemove, onClear }: { ids: string[]; load: Load[]; profiles: Record<string, { name?: string; photoUrl?: string } | undefined>; title: string; hint?: string; onRemove?: (id: string) => void; onClear?: () => void }) {
  const by = new Map(load.map((l) => [l.id, l]));
  const total = load.reduce((n, l) => n + l.open, 0);
  return (
    <section className="tk-as">
      <header>
        <h4>{title}<em>{ids.length}</em></h4>
        {onClear && ids.length > 0 && <button type="button" onClick={onClear}>{tx("Remove all")}</button>}
      </header>
      {ids.length === 0 ? (
        <div className="tk-as-none"><WizSvg name="users" size={22} /><span><b>{tx("Nobody yet")}</b><small>{tx("Pick people on the left, or start from a role.")}</small></span></div>
      ) : (
        <>
          {hint && <p className="tk-as-h">{hint}</p>}
          <ul>
            {ids.map((id) => {
              const l = by.get(id);
              const tone = !l ? '' : l.late ? 'bad' : l.open >= 5 ? 'warn' : 'ok';
              const nm = profiles[id]?.name || 'Member';
              return (
                <li key={id} className={tone}>
                  <Avatar name={nm} photoUrl={profiles[id]?.photoUrl} size={36} />
                  <span><PersonLink userId={id}><b>{nm}</b></PersonLink><small>{l ? (l.open === 0 ? tx("Nothing open") : `${l.open} open task${l.open === 1 ? '' : 's'}${l.late ? ` · ${l.late} late` : ''}`) : ''}</small>{l && <i className="tk-as-bar" aria-hidden><u style={{ width: `${Math.min(100, l.open * 20)}%` }} /></i>}</span>
                  <ViewProfile userId={id} />
                  {onRemove && <button type="button" className="x" aria-label={`Remove ${nm}`} onClick={() => onRemove(id)}>×</button>}
                </li>
              );
            })}
          </ul>
          {ids.length > 1 && <footer><span><b>{ids.length}</b> {tx("people")}</span><span><b>{total}</b> {tx("open tasks in total")}</span></footer>}
        </>
      )}
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { limit as fsLimit, orderBy, where } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useUserProfiles } from '@/lib/useUserNames';
import { syncMeetingTasks } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { Avatar } from '@/components/MemberPicker';
import DateTimePicker from '@/components/DateTimePicker';
import Dropdown from '@/components/Dropdown';
import { WizSvg } from '@/components/WizardShell';
import NewTask from './NewTask';
import TaskDetail, { dueText } from './TaskDetail';
import { PRIORITY, PRIORITY_RANK, STATUS, daysLeft, isActive, type MeetingLite, type Task, type TaskRow, type TStatus } from './taskTypes';
import { tx } from '@/lib/i18n/tr';

type DueF = '' | 'late' | 'today' | 'week' | 'none' | 'stale';
type SortF = 'recent' | 'due' | 'priority' | 'progress' | 'newest';
type DateBy = 'due' | 'created' | 'activity';

const isLate = (t: Task) => isActive(t) && !!t.dueAt && daysLeft(tsMs(t.dueAt)) < 0;
const lastActivity = (t: Task) => (t.updates?.length ? Math.max(...t.updates.map((u) => tsMs(u.at))) : tsMs(t.updatedAt));
const DUE_LABEL: Record<DueF, string> = { '': 'Any time', late: 'Late', today: 'Due today', week: 'Next 7 days', none: 'No deadline', stale: 'No activity for 7 days' };

/**
 * Tasks: every action item decided in a meeting and every task an admin creates. Alerts at the top show what needs attention,
 * the list (or the board) filters by status, person, priority, deadline and dates, and each task opens in an organised detail.
 */
export default function TasksView({ memberMode = false }: { memberMode?: boolean }) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const fetched = useCollection<Task>('tasks', memberMode ? [where('assigneeIds', 'array-contains', uid || '-')] : [orderBy('updatedAt', 'desc'), fsLimit(500)], memberMode ? `t-${uid}` : 'tasks');
  const tasks = useMemo(() => (memberMode && fetched ? [...fetched].sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt)) : fetched), [fetched, memberMode]);
  const meetings = useCollection<MeetingLite>('meetings', memberMode ? [where('inviteeIds', 'array-contains', uid || '-')] : [orderBy('startAt', 'desc'), fsLimit(150)], memberMode ? `tm-${uid}` : 'tasks-meetings');

  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [st, setSt] = useState<'' | 'active' | TStatus>('active');
  const [src, setSrc] = useState('');
  const [who, setWho] = useState('');
  const [pri, setPri] = useState('');
  const [due, setDue] = useState<DueF>('');
  const [sort, setSort] = useState<SortF>('recent');
  const [by, setBy] = useState<DateBy>('due');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [limit, setLimit] = useState(30);
  const [importing, setImporting] = useState(false);

  useEffect(() => { try { const v = window.localStorage.getItem('tk-view'); if (v === 'board' || v === 'list') setView(v); } catch { /* storage blocked */ } }, []);
  const setView2 = () => { setLimit(30); setSel(''); };
  const chooseView = (v: 'list' | 'board') => { setView(v); try { window.localStorage.setItem('tk-view', v); } catch { /* storage blocked */ } };

  const rows: TaskRow[] = useMemo(() => tasks ?? [], [tasks]);
  const known = useMemo(() => new Set(rows.map((t) => t.id)), [rows]);
  const missing = useMemo(() => (meetings ?? []).reduce((n, m) => n + (m.actions ?? []).filter((a) => !known.has(a.id)).length, 0), [meetings, known]);
  const personIds = useMemo(() => Array.from(new Set(rows.flatMap((t) => t.assigneeIds))).slice(0, 150), [rows]);
  const profiles = useUserProfiles(personIds);
  const people = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((t) => t.assigneeIds.forEach((id, i) => m.set(id, t.assigneeNames[i] || id)));
    return Array.from(m.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Alerts: what needs attention now (counted on the open tasks).
  const open = rows.filter(isActive);
  const lateN = open.filter(isLate).length;
  const todayN = open.filter((t) => t.dueAt && daysLeft(tsMs(t.dueAt)) === 0).length;
  const weekN = open.filter((t) => t.dueAt && daysLeft(tsMs(t.dueAt)) >= 0 && daysLeft(tsMs(t.dueAt)) <= 7).length;
  const blockedN = rows.filter((t) => t.status === 'blocked').length;
  const noDueN = open.filter((t) => !t.dueAt).length;
  const staleN = open.filter((t) => Date.now() - lastActivity(t) > 7 * 86400000).length;
  const doneN = rows.filter((t) => t.status === 'done').length;
  const progN = rows.filter((t) => t.status === 'in_progress').length;
  const avg = open.length ? Math.round(open.reduce((a, t) => a + t.progress, 0) / open.length) : 0;

  // Every filter except the status (the board shows all statuses as columns).
  const base = useMemo(() => {
    const f = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const e = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
    const term = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (src && t.source !== src) return false;
      if (who && !t.assigneeIds.includes(who)) return false;
      if (pri && t.priority !== pri) return false;
      if (due === 'late' && !isLate(t)) return false;
      if (due === 'today' && !(isActive(t) && t.dueAt && daysLeft(tsMs(t.dueAt)) === 0)) return false;
      if (due === 'week' && !(isActive(t) && t.dueAt && daysLeft(tsMs(t.dueAt)) >= 0 && daysLeft(tsMs(t.dueAt)) <= 7)) return false;
      if (due === 'none' && !(isActive(t) && !t.dueAt)) return false;
      if (due === 'stale' && !(isActive(t) && Date.now() - lastActivity(t) > 7 * 86400000)) return false;
      if (from || to) {
        const ms = by === 'due' ? (t.dueAt ? tsMs(t.dueAt) : -1) : by === 'created' ? tsMs(t.createdAt) : lastActivity(t);
        if (ms < f || ms > e) return false;
      }
      return !term || `${t.title} ${t.meetingTitle ?? ''} ${t.assigneeNames.join(' ')} ${t.description ?? ''}`.toLowerCase().includes(term);
    });
  }, [rows, src, who, pri, due, from, to, by, q]);

  const sorted = useMemo(() => {
    const l = [...base];
    const dueOf = (t: Task) => (t.dueAt ? tsMs(t.dueAt) : Number.MAX_SAFE_INTEGER);
    if (sort === 'due') l.sort((a, b) => dueOf(a) - dueOf(b));
    else if (sort === 'priority') l.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || dueOf(a) - dueOf(b));
    else if (sort === 'progress') l.sort((a, b) => a.progress - b.progress);
    else if (sort === 'newest') l.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    else l.sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt));
    return l;
  }, [base, sort]);

  const list = sorted.filter((t) => (st === 'active' ? isActive(t) : st ? t.status === st : true));
  const selected = rows.find((t) => t.id === sel) ?? (view === 'list' ? list[0] : undefined);
  const filtered = !!(src || who || pri || due || from || to || q.trim());
  const reset = () => { setSrc(''); setWho(''); setPri(''); setDue(''); setFrom(''); setTo(''); setQ(''); setSort('recent'); setLimit(30); };
  const pick = (id: string) => { setSel(id); if (view === 'board') setDrawer(true); };
  const jump = (d: DueF, status: '' | 'active' | TStatus = 'active') => { setDue(d); setSt(status); setLimit(30); };

  async function importNow() {
    setImporting(true);
    try { const r = await syncMeetingTasks({}); notify(`${r.data.created} action item${r.data.created === 1 ? '' : 's'} brought in from the meetings.`, 'success'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not import', 'error'); }
    setImporting(false);
  }

  const tiles: { l: string; v: string; s: string; i: 'list' | 'clock' | 'shield' | 'check' | 'users'; tone?: string; hint: string; on: () => void }[] = [
    { l: 'Open tasks', v: String(open.length), s: `${progN} in progress`, i: 'list', tone: 'green', hint: tx("Show the open tasks"), on: () => { setDue(''); setSt('active'); setView2(); } },
    { l: 'Late', v: String(lateN), s: lateN ? 'Past their deadline' : 'Nothing is late', i: 'clock', tone: 'red', hint: tx("Show the late tasks"), on: () => { jump('late'); setView2(); } },
    { l: 'Done', v: String(doneN), s: `of ${rows.length} tasks`, i: 'check', tone: 'gold', hint: tx("Show the finished tasks"), on: () => { setDue(''); setSt('done'); setView2(); } },
    { l: 'Average progress', v: `${avg}%`, s: 'Of the open tasks', i: 'users', tone: 'dark', hint: tx("Open tasks, least advanced first"), on: () => { setDue(''); setSt('active'); setSort('progress'); setView2(); } },
  ];
  const alerts: { n: number; l: string; tone: string; on: () => void }[] = [
    { n: lateN, l: 'late', tone: 'red', on: () => jump('late') },
    { n: todayN, l: 'due today', tone: 'gold', on: () => jump('today') },
    { n: weekN, l: 'due in the next 7 days', tone: 'green', on: () => jump('week') },
    { n: blockedN, l: 'blocked', tone: 'red', on: () => { setDue(''); setSt('blocked'); } },
    { n: staleN, l: 'with no news for 7 days', tone: 'gold', on: () => jump('stale') },
    { n: noDueN, l: 'without a deadline', tone: 'idle', on: () => jump('none') },
  ].filter((a) => a.n > 0);

  const detail = (t: TaskRow, onClose?: () => void) => (
    <TaskDetail key={`${t.id}-${tsMs(t.updatedAt)}`} t={t} canManage={!memberMode} canUpdate={!memberMode || t.assigneeIds.includes(uid)} onClose={onClose} />
  );

  return (
    <div className="tk tk2">
      <header className="tk-hero">
        <div>
          <span className="tk-k">Follow-up</span>
          <h1>{memberMode ? tx("My tasks") : tx("Tasks")}</h1>
          <p>{memberMode ? tx("The tasks given to you, from your meetings or by an admin. Update your progress and read the team’s feedback.") : tx("Every action item decided in a meeting, and every task you give to someone, with its progress, alerts and the team’s feedback.")}</p>
        </div>
        {!memberMode && <button type="button" className="tk-new" onClick={() => setCreating(true)}>{tx("+ New task")}</button>}
      </header>

      {alerts.length > 0 && (
        <section className="tk2-al" aria-label={tx("Needs attention")}>
          <span className="tk2-al-h"><WizSvg name="shield" size={18} /> {tx("Needs attention")}</span>
          {alerts.map((a) => <button key={a.l} type="button" className={a.tone} onClick={a.on}><b>{a.n}</b> {a.l}</button>)}
        </section>
      )}

      <div className="tk-kpis">
        {tiles.map((t) => (
          <button type="button" key={t.l} className={`tk-kpi ${t.tone ?? ''}`} title={t.hint} onClick={t.on}>
            <WizSvg name={t.i} size={22} />
            <span><small>{t.l}</small><b>{t.v}</b><em>{t.s}</em></span>
            <i className="tk-kpi-go" aria-hidden>›</i>
          </button>
        ))}
      </div>

      {!memberMode && missing > 0 && (
        <div className="tk-import" role="status">
          <WizSvg name="doc" size={26} />
          <p><b>{missing} {tx("action item")}{missing === 1 ? '' : 's'} {tx("from your meetings")} {missing === 1 ? tx("is") : tx("are")} {tx("not in the task list yet.")}</b><small>{tx("New action items arrive here by themselves. Bring in the older ones once.")}</small></p>
          <button type="button" onClick={() => void importNow()} disabled={importing}>{importing ? tx("Importing…") : tx("Bring them in")}</button>
        </div>
      )}

      <section className="tk-bar tk2-bar">
        <div className="tk2-r1">
          {view === 'list' ? (
            <div className="tk-chips" role="tablist" aria-label={tx("Status")}>
              {([['active', `Open · ${open.length}`], ['', `All · ${rows.length}`], ['blocked', `Blocked · ${blockedN}`], ['done', `Done · ${doneN}`], ['cancelled', `Cancelled · ${rows.filter((t) => t.status === 'cancelled').length}`]] as const).map(([k, l]) => (
                <button key={k || 'all'} type="button" role="tab" aria-selected={st === k} className={st === k ? 'on' : ''} onClick={() => { setSt(k as '' | 'active' | TStatus); setLimit(30); }}>{l}</button>
              ))}
            </div>
          ) : <span className="tk2-bh">{tx("Board · every status at a glance")}</span>}
          <div className="tk2-view" role="tablist" aria-label={tx("View")}>
            <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list')}>{tx("☰ List")}</button>
            <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => chooseView('board')}>{tx("▥ Board")}</button>
          </div>
        </div>
        <div className="tk2-r2">
          <label className="tk-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(30); }} placeholder={tx("Search a task, a person, a meeting")} aria-label={tx("Search tasks")} /></label>
          {!memberMode && <div className="tk-dd"><Dropdown label={tx("Responsible")} value={who} onChange={(v) => { setWho(v); setLimit(30); }} allLabel="Everyone" options={people} /></div>}
          <div className="tk-dd"><Dropdown label={tx("Deadline")} value={due} onChange={(v) => { setDue(v as DueF); setLimit(30); }} allLabel="Any time" options={(['late', 'today', 'week', 'none', 'stale'] as DueF[]).map((v) => ({ value: v, label: DUE_LABEL[v] }))} /></div>
          <div className="tk-dd"><Dropdown label={tx("Priority")} value={pri} onChange={(v) => { setPri(v); setLimit(30); }} allLabel="All priorities" options={(['urgent', 'high', 'normal', 'low'] as const).map((v) => ({ value: v, label: PRIORITY[v] }))} /></div>
          <div className="tk-dd"><Dropdown label={tx("Origin")} value={src} onChange={(v) => { setSrc(v); setLimit(30); }} allLabel="All origins" options={[{ value: 'meeting', label: tx("From a meeting") }, { value: 'manual', label: tx("Created by an admin") }]} /></div>
          <div className="tk-dd"><Dropdown label={tx("Sort")} value={sort === 'recent' ? '' : sort} onChange={(v) => setSort((v || 'recent') as SortF)} allLabel="Recently updated" options={[{ value: 'due', label: tx("Deadline, soonest first") }, { value: 'priority', label: tx("Priority") }, { value: 'progress', label: tx("Progress, lowest first") }, { value: 'newest', label: tx("Newest created") }]} /></div>
        </div>
        <div className="tk2-r3">
          <span className="tk2-r3-l">{tx("Dates")}</span>
          <div className="tk2-by" role="tablist" aria-label={tx("Date to filter")}>
            {([['due', 'Deadline'], ['created', 'Created'], ['activity', 'Last activity']] as [DateBy, string][]).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} className={by === k ? 'on' : ''} onClick={() => { setBy(k); setLimit(30); }}>{l}</button>)}
          </div>
          <div className="tk2-date"><DateTimePicker mode="date" value={from} onChange={(v) => { setFrom(v); setLimit(30); }} placeholder={tx("From")} /></div>
          <span aria-hidden>→</span>
          <div className="tk2-date"><DateTimePicker mode="date" value={to} onChange={(v) => { setTo(v); setLimit(30); }} placeholder={tx("To")} min={from || undefined} /></div>
          <span className="tk2-count"><b>{view === 'list' ? list.length : sorted.length}</b> {tx("task")}{(view === 'list' ? list.length : sorted.length) === 1 ? '' : 's'}</span>
          {filtered && <button type="button" className="mb-reset" onClick={reset}>{tx("Reset filters")}</button>}
        </div>
      </section>

      {tasks === null ? <p className="tk-none">{tx("Loading tasks…")}</p> : view === 'list' ? (
        <div className="tk-grid">
          <section className="tk-list">
            {list.length === 0 ? (
              <div className="tk-empty">
                <WizSvg name="check" size={34} />
                <div><b>{rows.length === 0 ? (memberMode ? tx("You have no task") : tx("No task yet")) : tx("No task matches these filters")}</b><small>{rows.length === 0 ? (memberMode ? tx("Tasks given to you appear here and in the mobile app.") : tx("Action items decided in a meeting appear here. You can also create a task for someone.")) : tx("Change the status, the dates or the search.")}</small></div>
                {rows.length === 0 && !memberMode && <button type="button" onClick={() => setCreating(true)}>{tx("Create a task")}</button>}
                {rows.length > 0 && filtered && <button type="button" onClick={reset}>{tx("Reset filters")}</button>}
              </div>
            ) : (
              <ul>
                {list.slice(0, limit).map((t) => (
                  <li key={t.id}><Card t={t} on={t.id === selected?.id} profiles={profiles} onPick={() => pick(t.id)} /></li>
                ))}
              </ul>
            )}
            {list.length > limit && <button type="button" className="tk-more" onClick={() => setLimit(limit + 30)}>{tx("Show 30 more ·")} {list.length - limit} {tx("left")}</button>}
            {list.length > 0 && list.length <= 5 && <SidePanels rows={rows} profiles={profiles} onPick={pick} onWho={memberMode ? undefined : (id) => { setWho(id); setSt('active'); }} />}
          </section>
          {selected ? detail(selected) : <aside className="tk-detail tk-empty"><WizSvg name="list" size={34} /><div><b>{tx("Choose a task")}</b><small>{tx("Its progress, updates, feedback and reminders appear here.")}</small></div></aside>}
        </div>
      ) : (
        <Board tasks={sorted} profiles={profiles} selectedId={selected?.id} onPick={pick} showCancelled={st === 'cancelled'} />
      )}

      {view === 'board' && drawer && selected && createPortal(
        <div className="tk2-drawer" role="dialog" aria-modal="true" aria-label={tx("Task")} onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}>
          {detail(selected, () => setDrawer(false))}
        </div>, document.body)}

      {creating && <NewTask rows={rows} meetings={meetings ?? []} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSt('active'); setSel(id); }} />}
    </div>
  );
}

function SidePanels({ rows, profiles, onPick, onWho }: { rows: TaskRow[]; profiles: Record<string, { name?: string; photoUrl?: string } | undefined>; onPick: (id: string) => void; onWho?: (id: string) => void }) {
  const act = rows.filter(isActive);
  const load = new Map<string, { n: number; late: number; name: string }>();
  act.forEach((t) => t.assigneeIds.forEach((id, i) => { const c = load.get(id) ?? { n: 0, late: 0, name: t.assigneeNames[i] || '' }; c.n++; if (isLate(t)) c.late++; load.set(id, c); }));
  const [wq, setWq] = useState('');
  const [wSort, setWSort] = useState<'' | 'late' | 'name'>('');
  const [lateOnly, setLateOnly] = useState(false);
  const [wn, setWn] = useState(6);
  const nm = (id: string, v: { name: string }) => profiles[id]?.name || v.name || 'Member';
  const all = [...load.entries()].filter(([id, v]) => (!lateOnly || v.late > 0) && (!wq.trim() || nm(id, v).toLowerCase().includes(wq.trim().toLowerCase())))
    .sort((a, b) => (wSort === 'name' ? nm(a[0], a[1]).localeCompare(nm(b[0], b[1])) : wSort === 'late' ? b[1].late - a[1].late || b[1].n - a[1].n : b[1].n - a[1].n || b[1].late - a[1].late));
  const top = all.slice(0, wn);
  const max = Math.max(1, ...[...load.values()].map((v) => v.n));
  const next = act.filter((t) => t.dueAt).sort((a, b) => tsMs(a.dueAt) - tsMs(b.dueAt)).slice(0, 5);
  const byStatus = (['open', 'in_progress', 'blocked', 'done'] as TStatus[]).map((k) => ({ k, n: rows.filter((t) => t.status === k).length }));
  const total = Math.max(1, byStatus.reduce((n, x) => n + x.n, 0));
  return (
    <div className="tk2-side">
      <section className="tk2-sc">
        <h4>{tx("Status breakdown")}<em>{rows.length}</em></h4>
        <div className="tk2-sbar">{byStatus.filter((x) => x.n).map((x) => <i key={x.k} className={x.k} style={{ flex: x.n }} title={`${STATUS[x.k]} · ${x.n}`} />)}</div>
        <ul className="tk2-sleg">{byStatus.map((x) => <li key={x.k}><i className={x.k} />{STATUS[x.k]}<b>{x.n}</b><small>{Math.round((x.n / total) * 100)}%</small></li>)}</ul>
      </section>
      {load.size > 0 && (
        <section className="tk2-sc">
          <h4>{tx("Who has the most to do")}<em>{all.length === load.size ? load.size : `${all.length} of ${load.size}`}</em></h4>
          {load.size > 6 && (
            <div className="tk2-wf">
              <label className="tk2-wfs"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={wq} onChange={(e) => { setWq(e.target.value); setWn(6); }} placeholder={tx("Find a person")} aria-label={tx("Find a person")} /></label>
              <div className="tk2-wfd"><Dropdown label={tx("Order")} value={wSort} onChange={(v) => setWSort(v as '' | 'late' | 'name')} allLabel="Most open tasks" options={[{ value: 'late', label: tx("Most late") }, { value: 'name', label: tx("Name, A to Z") }]} /></div>
              <button type="button" className={lateOnly ? 'on' : ''} onClick={() => { setLateOnly(!lateOnly); setWn(6); }}>{tx("Late only")}</button>
            </div>
          )}
          {top.length === 0 ? <p className="tk-none">{tx("Nobody matches.")}</p> : (
            <ul className="tk2-wl">
              {top.map(([id, v]) => (
                <li key={id}>
                  <Avatar name={nm(id, v)} photoUrl={profiles[id]?.photoUrl} size={28} />
                  {onWho ? <button type="button" onClick={() => onWho(id)}>{nm(id, v)}</button> : <span>{nm(id, v)}</span>}
                  <u><s className={v.late ? 'bad' : ''} style={{ width: `${(v.n / max) * 100}%` }} /></u><b>{v.n}</b>{v.late > 0 && <i className="late">{v.late} {tx("late")}</i>}
                </li>
              ))}
            </ul>
          )}
          {all.length > wn && <button type="button" className="pf-more" onClick={() => setWn(wn + 8)}>{tx("Show 8 more ·")} {all.length - wn} {tx("left")}</button>}
        </section>
      )}
      {next.length > 0 && (
        <section className="tk2-sc">
          <h4>{tx("Next deadlines")}</h4>
          <ul className="tk2-nx">
            {next.map((t) => <li key={t.id}><button type="button" onClick={() => onPick(t.id)}><b>{t.title}</b><small className={isLate(t) ? 'late' : ''}>{dueText(t)}</small></button></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Card({ t, on, profiles, onPick, compact }: { t: TaskRow; on: boolean; profiles: Record<string, { name?: string; photoUrl?: string } | undefined>; onPick: () => void; compact?: boolean }) {
  const late = isLate(t);
  return (
    <button type="button" className={`tk-card ${on ? 'on' : ''} s-${t.status}${late ? ' late' : ''}${compact ? ' tk2-cc' : ''}`} onClick={onPick}>
      <span className="tk-card-top"><b>{t.title}</b>{!compact && <i className={`tk-st ${t.status}`}>{STATUS[t.status]}</i>}</span>
      <span className="tk-meta">
        <span className="tk-av">{t.assigneeIds.slice(0, 3).map((id, i) => <Avatar key={id} name={profiles[id]?.name || t.assigneeNames[i] || ''} photoUrl={profiles[id]?.photoUrl} size={24} />)}{t.assigneeIds.length > 3 && <em>+{t.assigneeIds.length - 3}</em>}</span>
        <span className="tk-who">{t.assigneeIds.length === 0 ? tx("Nobody assigned") : t.assigneeIds.length === 1 ? (profiles[t.assigneeIds[0]]?.name || t.assigneeNames[0]) : `${profiles[t.assigneeIds[0]]?.name || t.assigneeNames[0] || ''} and ${t.assigneeIds.length - 1} other${t.assigneeIds.length === 2 ? '' : 's'}`}</span>
        <i className={`tk-pr ${t.priority}`}>{PRIORITY[t.priority]}</i>
      </span>
      <span className="tk-bar2"><i style={{ width: `${t.progress}%` }} /></span>
      <span className="tk-foot"><span>{t.progress}%</span><span className={late ? 'late' : ''}>{dueText(t)}</span>{!compact && <span>{t.source === 'meeting' ? `Meeting · ${t.meetingTitle ?? ''}` : tx("Created by an admin")}</span>}</span>
    </button>
  );
}

const COLS: { k: TStatus; l: string }[] = [{ k: 'open', l: 'To do' }, { k: 'in_progress', l: 'In progress' }, { k: 'blocked', l: 'Blocked' }, { k: 'done', l: 'Done' }];

function Board({ tasks, profiles, selectedId, onPick, showCancelled }: { tasks: TaskRow[]; profiles: Record<string, { name?: string; photoUrl?: string } | undefined>; selectedId?: string; onPick: (id: string) => void; showCancelled: boolean }) {
  const cols = showCancelled ? [...COLS, { k: 'cancelled' as TStatus, l: 'Cancelled' }] : COLS;
  const [n, setN] = useState<Record<string, number>>({});
  return (
    <div className="tk2-board" style={{ gridTemplateColumns: `repeat(${cols.length},minmax(240px,1fr))` }}>
      {cols.map((c) => {
        const items = tasks.filter((t) => t.status === c.k);
        const lim = n[c.k] ?? 12;
        return (
          <section key={c.k} className={`tk2-col ${c.k}`} aria-label={c.l}>
            <h3>{c.l}<em>{items.length}</em></h3>
            <div className="tk2-col-b">
              {items.length === 0 && <p className="tk2-col-none">{tx("Nothing here")}</p>}
              {items.slice(0, lim).map((t) => <Card key={t.id} t={t} compact on={t.id === selectedId} profiles={profiles} onPick={() => onPick(t.id)} />)}
              {items.length > lim && <button type="button" className="pf-more" onClick={() => setN({ ...n, [c.k]: lim + 12 })}>{tx("Show 12 more ·")} {items.length - lim} {tx("left")}</button>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

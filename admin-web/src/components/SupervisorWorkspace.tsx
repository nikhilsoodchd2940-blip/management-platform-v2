'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookUser, ClipboardCheck, ClipboardList, LifeBuoy, LogOut, MapPin, Radio, Repeat, Users } from 'lucide-react';
import ParticipationPanel from '@/components/ParticipationPanel';
import AttendancePanel from '@/components/AttendancePanel';
import SupervisorContact from './SupervisorContact';
import ReportForm from './ReportForm';
import ThreadList from './ThreadList';
import { useAuth } from '@/context/AuthContext';
import { getMySupervision, getSupervisionEvent, getSupervisorThreads, LEVEL_NAME, type SupervisionEvent, type SupervisionLevel, type SupervisionSummary, type SupervisorThread } from '@/lib/functions';
import LiveBoard from '@/app/dashboard/events/LiveBoard';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { longDate, hoursLabel } from '@/app/dashboard/events/eventPlanTypes';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Tab = 'live' | 'attendance' | 'lists' | 'reports' | 'contact' | 'shifts' | 'members' | 'places';
const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—');
const dm = (ms?: number) => (ms ? new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const RIGHT_LABEL: Record<string, string> = { status: 'change statuses', delay: 'report delays', notes: 'add notes', adjust: 'change the schedule', cancel: 'cancel a performance' };

/**
 * What a supervisor sees after signing in to the admin panel: only the events they supervise, with
 * tabs for the live board, their shifts and team, the members who perform in several groups, and
 * the places and schedule. Data comes from checked server calls and refreshes every few seconds.
 */
export default function SupervisorWorkspace() {
  const { signOut } = useAuth();
  const [summary, setSummary] = useState<SupervisionSummary | null>(null);
  const [eventId, setEventId] = useState('');
  const [data, setData] = useState<SupervisionEvent | null>(null);
  const [quickOpen, setQuickOpen] = useState(0);
  const [tab, setTab] = useState<Tab>('attendance');
  const [error, setError] = useState('');
  const [threads, setThreads] = useState<SupervisorThread[]>([]);
  const [preset, setPreset] = useState<{ about?: string; text?: string; kind?: 'urgent'; n: number } | undefined>();
  const [filter, setFilter] = useState('');

  useEffect(() => {
    getMySupervision({}).then((r) => {
      setSummary(r.data);
      const now = Date.now();
      const pick = r.data.events.find((e) => e.startMs <= now && e.endMs >= now) ?? r.data.events.find((e) => e.endMs >= now) ?? r.data.events[0];
      if (pick) setEventId(pick.id);
    }).catch((e) => setError(e instanceof Error ? e.message : tx("Could not load your events")));
  }, []);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const [r, t] = await Promise.all([getSupervisionEvent({ eventId }), getSupervisorThreads({ eventId }).catch(() => null)]);
      setData(r.data);
      if (t) setThreads(t.data.threads);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not load the event"));
    }
  }, [eventId]);

  useEffect(() => {
    setData(null);
    setThreads([]);
    load();
    const h = window.setInterval(load, 10000);
    return () => window.clearInterval(h);
  }, [load]);

  const feed = useMemo(() => (data ? { slots: data.slots, log: data.log } : undefined), [data]);

  const now = Date.now();
  const count = (f: (x: SupervisionEvent['slots'][number]) => boolean) => (data ? data.slots.filter(f).length : 0);
  const stats = [
    { k: 'On stage', v: count((x) => x.status === 'in_progress'), c: 'stage' },
    { k: 'Late', v: count((x) => x.status === 'delayed' || (['upcoming', 'ready'].includes(x.status) && x.startMs < now)), c: 'late' },
    { k: 'To come', v: count((x) => ['upcoming', 'ready'].includes(x.status) && x.startMs >= now), c: 'next' },
    { k: 'Finished', v: count((x) => x.status === 'completed'), c: 'done' },
  ];
  const runStates = data ? Object.values(data.event.run) : [];
  const runLabel = runStates.some((r) => r.state === 'paused') ? 'Paused' : runStates.length && runStates.every((r) => r.state === 'ended') ? 'Ended' : 'Running';
  const waitingForMe = threads.filter((t) => t.canAct && t.status === 'open').length;
  const level: SupervisionLevel = data?.me.level ?? 'member';
  const firstTab = useRef(false);
  useEffect(() => { if (data && !firstTab.current) { firstTab.current = true; if (data.me.level !== 'member') setTab('lists'); } }, [data]);
  type NavItem = { id: Tab; label: string; icon: typeof Radio; note?: string; hot?: boolean };
  const openReports = threads.filter((t) => t.status === 'open').length;
  const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
    ...(level !== 'member' ? [{ title: tx("Before the event"), items: [{ id: 'lists' as Tab, label: tx("Member lists"), icon: ClipboardList }] }] : []),
    { title: tx("During the event"), items: [
      { id: 'attendance', label: tx("Attendance"), icon: ClipboardCheck },
      { id: 'live', label: tx("Live board"), icon: Radio, note: quickOpen > 0 ? `${quickOpen} request${quickOpen > 1 ? 's' : ''}` : undefined, hot: quickOpen > 0 },
    ] },
    { title: tx("Communication"), items: [
      { id: 'reports', label: tx("Reports and replies"), icon: LifeBuoy, note: waitingForMe ? String(waitingForMe) : openReports ? String(openReports) : undefined, hot: waitingForMe > 0 },
      { id: 'contact', label: tx("Contacts"), icon: BookUser },
    ] },
    { title: tx("Organisation"), items: [
      { id: 'shifts', label: tx("Shifts and team"), icon: Users },
      { id: 'members', label: tx("Members in several groups"), icon: Repeat, note: data ? String(data.members.length) : undefined },
      { id: 'places', label: tx("Places and schedule"), icon: MapPin },
    ] },
  ];
  const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
  const groupNames = data ? Array.from(new Set(data.slots.map((s) => s.groupName))).sort() : [];
  const dshort = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const CHIP: Record<string, string> = { in_progress: 'On stage', completed: 'Finished', delayed: 'Delayed', cancelled: 'Cancelled', upcoming: 'To come', ready: 'Ready' };

  return (
    <div className="sv">
      <aside className="sv-side">
        <div className="sv-brand"><b>{tx("Supervision")}</b><small>{summary?.name ?? ''}</small></div>
        {summary && summary.events.length > 0 && (() => {
          const stateOf = (e: { id: string; startMs: number; endMs: number; run?: string[] }) => {
            const runs = e.id === eventId && data ? Object.values(data.event.run ?? {}).map((r) => r.state) : e.run ?? [];
            const pressedEnd = runs.length > 0 && runs.every((r) => r === 'ended');
            const pressedLive = runs.some((r) => r === 'running' || r === 'paused');
            const liveNow = pressedEnd ? false : pressedLive || (e.startMs <= now && e.endMs >= now);
            const ended = pressedEnd || (!pressedLive && e.endMs < now);
            return liveNow ? 'live' : ended ? 'ended' : 'soon';
          };
          const TXT: Record<string, string> = { live: 'Live now', ended: 'Ended', soon: 'Upcoming' };
          const sorted = [...summary.events].sort((x, y) => x.startMs - y.startMs);
          const current = summary.events.find((e) => e.id === eventId);
          const active = sorted.filter((e) => stateOf(e) !== 'ended');
          const past = sorted.filter((e) => stateOf(e) === 'ended').reverse();
          const st = current ? stateOf(current) : 'soon';
          return (
            <div className="sv-sw">
              <div className="sv-sw-card">
                <span className={`sw-tag ${st}`}>{TXT[st]}</span>
                <b>{current?.title ?? tx("Choose an event")}</b>
                {current && <small>{dm(current.startMs)} {tx("to")} {dm(current.endMs)}</small>}
              </div>
              {summary.events.length > 1 && (
                <label className="sv-sw-pick"><span>{tx("Switch event")}</span>
                  <select value={eventId} onChange={(e) => { setEventId(e.target.value); setTab(level !== 'member' ? 'lists' : 'attendance'); }} aria-label={tx("Switch event")}>
                    {active.length > 0 && <optgroup label={tx("Live and upcoming")}>{active.map((e) => <option key={e.id} value={e.id}>{TXT[stateOf(e)]} · {e.title}</option>)}</optgroup>}
                    {past.length > 0 && <optgroup label={tx("Ended")}>{past.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</optgroup>}
                  </select>
                </label>
              )}
            </div>
          );
        })()}

        <nav className="sv-nav" aria-label={tx("Supervision")}>
          {NAV_GROUPS.map((g) => (
            <div className="sv-ng" key={g.title}>
              <small>{g.title}</small>
              {g.items.map((n) => (
                <button key={n.id} type="button" className={tab === n.id ? 'on' : ''} onClick={() => setTab(n.id)} disabled={!data}>
                  <span className="sv-ico"><n.icon size={17} /></span><span className="sv-lbl">{n.label}</span>{n.note && <em className={n.hot ? 'hot' : ''}>{n.note}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <button type="button" className="sv-out" onClick={() => signOut()}><LogOut size={15} /> {tx("Sign out")}</button>
      </aside>

      <main className="sv-main">
        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="fx3-note">{tx("Loading…")}</p>}
        {data && (
          <>
            <header className="sv-top">
              <div className="sv-top-l">
                <small>{NAV.find((n) => n.id === tab)?.label}</small>
                <h1>{data.event.title}</h1>
                <p>{dm(data.event.startMs)} {tx("to")} {dm(data.event.endMs)}{data.event.location ? ` · ${data.event.location}` : ''}</p>
                <div className="sv-chips">
                  <span className={`sv-chip st ${runLabel.toLowerCase()}`}><i />{runLabel}</span>
                  <span className="sv-chip">{LEVEL_NAME[level]}</span>
                  {!data.event.scopeAll && <span className="sv-chip">{tx("Places:")} {data.event.sites.map((x) => x.name).join(', ') || tx("none yet")}</span>}
                  {data.me.rights.map((r) => <span key={r} className="sv-chip soft">{RIGHT_LABEL[r] ?? r}</span>)}
                </div>
              </div>
              <div className="sv-kpis">{stats.map((x) => <div key={x.k} className={x.c}><b>{x.v}</b><span>{x.k}</span></div>)}</div>
            </header>

            {tab === 'live' && (
              <section className="card">
                <LiveBoard quick={{ eventId: data.event.id, onOpen: setQuickOpen }} eventId={data.event.id} sites={data.event.sites} shifts={data.event.shifts} feed={feed} run={data.event.run} members={data.members.map((m) => ({ name: m.name, groups: m.groups.map((g) => g.groupName) }))} rights={data.me.rights} level={level} onReport={(p) => { setPreset({ ...p, n: Date.now() }); setTab('reports'); }} onChanged={load} />
              </section>
            )}

            {tab === 'lists' && <section className="card"><ParticipationPanel eventId={data.event.id} /></section>}

            {tab === 'attendance' && <section className="card"><AttendancePanel eventId={data.event.id} title={data.event.title} /></section>}

            {tab === 'reports' && (
              <div className="rp">
                <ReportForm key={preset?.n ?? 0} eventId={data.event.id} level={level} groups={groupNames} onSent={load} preset={preset} />
                <section className="card rp-list">
                  <h2>{tx("Reports and replies")}</h2>
                  <ThreadList eventId={data.event.id} threads={threads} onChanged={load} empty={tx("Nothing reported yet. When you or someone in your team reports an issue, it appears here with the answers.")} />
                </section>
              </div>
            )}

            {tab === 'contact' && <SupervisorContact eventId={data.event.id} contacts={data.contacts} level={level} />}

            {tab === 'shifts' && (
              <div className="hs">
                <p className="fx3-hint hs-note">{tx("Event head, then site managers, then site staff. Staff report to their site manager, who sends serious issues to the event head.")}</p>
                {data.event.shifts.length === 0 && <section className="card"><p className="fx3-note">{tx("No shift has been created for this event.")}</p></section>}
                {data.event.shifts.map((sh) => {
                  const mine = sh.supervisors.some((p) => p.userId === data.me.userId);
                  const places = sh.siteIds.length ? sh.siteIds.map((id) => data.event.sites.find((x) => x.id === id)?.name ?? '').join(' + ') : 'All places';
                  const heads = sh.supervisors.filter((p) => p.level === 'main');
                  const managers = sh.supervisors.filter((p) => p.level === 'manager');
                  const staff = sh.supervisors.filter((p) => p.level === 'member');
                  const crewOf = (m: string) => staff.filter((p) => p.leaderId === m || (!p.leaderId && managers.length === 1));
                  const loose = staff.filter((p) => !managers.some((m) => crewOf(m.userId).includes(p)));
                  const person = (p: (typeof sh.supervisors)[number], big = false) => (
                    <span key={p.userId} className={`hs-p${big ? ' big' : ''}${p.userId === data.me.userId ? ' me' : ''}`}>
                      <Avatar name={p.name} photoUrl={p.photoUrl} size={big ? 44 : 32} /><b>{p.name}{p.userId === data.me.userId ? tx(" (you)") : ''}</b><small>{LEVEL_NAME[p.level]}</small>
                    </span>
                  );
                  return (
                    <section key={sh.id} className={`card hs-shift${mine ? ' mine' : ''}`}>
                      <header><div><h3>{sh.label}{mine && <em> {tx("· your shift")}</em>}</h3><small>{dm(sh.startMs)} {tx("to")} {dm(sh.endMs)} · {hoursLabel((sh.endMs - sh.startMs) / 60000)}</small></div><span className="hs-places">{places}</span></header>
                      {heads.length > 0 && <div className="hs-level"><h4>{tx("Main event supervisor")}</h4><div className="hs-row">{heads.map((p) => person(p, true))}</div></div>}
                      {managers.length > 0 && (
                        <div className="hs-level">
                          <h4>{tx("Site managers and their staff")}</h4>
                          <div className="hs-mgrs">
                            {managers.map((m) => (
                              <div key={m.userId} className="hs-mgr">
                                {person(m, true)}
                                <div className="hs-crew">{crewOf(m.userId).length === 0 ? <small>{tx("No staff assigned")}</small> : crewOf(m.userId).map((p) => person(p))}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {loose.length > 0 && <div className="hs-level"><h4>{tx("Site staff")}</h4><div className="hs-crew wide">{loose.map((p) => person(p))}</div></div>}
                    </section>
                  );
                })}
              </div>
            )}

            {tab === 'members' && (
              <div className="mm">
                <section className="mm-help">
                  <b>{tx("What this page shows")}</b>
                  <p>{tx("These members perform in more than one group of this event, so they have to move from one group to the next. For each person you see where they are")} <i>{tx("right now")}</i>{tx(", which group they have to join")} <i>{tx("next")}</i>{tx(", and their full list of groups for the day with the time, the place and whether each one is finished or still to come.")}</p>
                </section>
                {data.members.length === 0 && <section className="card"><p className="fx3-note">{tx("No member belongs to several groups of this event.")}</p></section>}
                <div className="mm-grid2">
                  {data.members.map((m) => (
                    <article key={m.userId} className={`mm-card${m.current ? ' on' : ''}`}>
                      <header>
                        <Avatar name={m.name} photoUrl={m.photoUrl} size={52} />
                        <div><b>{m.name}</b><small>{tx("Performs in")} {m.groups.length} {tx("groups today")}</small></div>
                        <span className={`mm-st ${m.current ? 'stage' : m.next ? 'next' : 'free'}`}>{m.current ? tx("On stage now") : m.next ? tx("Waiting for next group") : tx("All groups done")}</span>
                      </header>
                      <div className="mm-now">
                        <div className={m.current ? 'on' : ''}><small>{tx("Right now")}</small><b>{m.current ? m.current.groupName : tx("Not on stage")}</b><span>{m.current ? `${dshort(m.current.startMs)}, ${hm(m.current.startMs)} to ${hm(m.current.endMs)}${(m.current as { place?: string }).place ? ` · ${(m.current as { place?: string }).place}` : ''}` : tx("Not performing at this moment")}</span></div>
                        <div className={m.next ? 'nx' : ''}><small>{tx("Has to join next")}</small><b>{m.next ? m.next.groupName : tx("Nothing more today")}</b><span>{m.next ? `${dshort(m.next.startMs)}, starts at ${hm(m.next.startMs)}${(m.next as { place?: string }).place ? ` · ${(m.next as { place?: string }).place}` : ''}` : tx("No other group to join")}</span></div>
                      </div>
                      <div className="mm-tbl" role="table" aria-label={`Groups of ${m.name}`}>
                        <div className="mm-th" role="row"><span>{tx("Date and time")}</span><span>{tx("Group")}</span><span>{tx("Place")}</span><span>{tx("Status")}</span></div>
                        {m.groups.map((g) => (
                          <div key={`${g.groupName}${g.startMs}`} className={`mm-tr ${g.status}`} role="row">
                            <b>{hm(g.startMs)}<small> {tx("to")} {hm(g.endMs)}</small><i>{dshort(g.startMs)}</i></b>
                            <span>{g.groupName}</span>
                            <span>{(g as { place?: string }).place || '—'}</span>
                            <em>{CHIP[g.status] ?? g.status}</em>
                          </div>
                        ))}
                      </div>
                      <footer className="mm-act">
                        <PersonLink userId={m.userId}><span className="mm-btn">{tx("View profile")}</span></PersonLink>
                        <button type="button" className="mm-btn" onClick={() => setTab('contact')}>{tx("Send a message")}</button>
                        <button type="button" className="mm-btn warn" onClick={() => { setPreset({ about: m.name, text: `${m.name} has to move between groups: `, n: Date.now() }); setTab('reports'); }}>{tx("Report a delay")}</button>
                      </footer>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {tab === 'places' && (
              <div className="pl">
                <div className="pl-tiles">
                  <div><small>{tx("When")}</small><b>{dm(data.event.startMs)}</b><span>{tx("to")} {dm(data.event.endMs)}</span></div>
                  <div><small>{tx("Places")}</small><b>{data.event.sites.length || 1}</b><span>{data.event.sites.length ? data.event.sites.map((x) => x.name).join(', ') : data.event.location || tx("One place")}</span></div>
                  <div><small>{tx("Groups")}</small><b>{groupNames.length}</b><span>{count((x) => x.status === 'completed')} {tx("finished")}</span></div>
                  <div><small>{tx("Time slots")}</small><b>{data.event.timeSlots.length || 1}</b><span>{data.event.timeSlots.length ? data.event.timeSlots.map((t) => `${t.start} to ${t.end}`).join(' · ') : tx("whole day")}</span></div>
                </div>

                <section className="card">
                  <h2>{tx("Daily schedule")}</h2>
                  <div className="pl-days">
                    {(data.event.dailySchedule.length ? data.event.dailySchedule.map((d) => ({ k: d.date, label: longDate(d.date), t: `${d.start} to ${d.end}` })) : [{ k: 'all', label: `${longDate(ymd(data.event.startMs))}${ymd(data.event.endMs) !== ymd(data.event.startMs) ? ` to ${longDate(ymd(data.event.endMs))}` : ''}`, t: 'whole event' }]).map((d) => (
                      <div key={d.k}><b>{d.label}</b><span>{d.t}</span></div>
                    ))}
                  </div>
                </section>

                <div className="pl-bar"><input type="search" placeholder={tx("Find a group…")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tx("Find a group")} /></div>
                {data.event.sites.length === 0 && <section className="card"><p className="fx3-note">{tx("No place has been set.")}</p></section>}
                {data.event.sites.map((st) => {
                  const mgrs = data.event.shifts.filter((sh) => sh.siteIds.includes(st.id)).flatMap((sh) => sh.supervisors.filter((p) => p.level === 'manager'));
                  const unique = Array.from(new Map(mgrs.map((p) => [p.userId, p])).values());
                  const rows = st.groupIds.map((g) => ({ g, name: data.slots.find((x) => x.groupId === g)?.groupName ?? g, slots: data.slots.filter((x) => x.groupId === g) }))
                    .filter((r) => !filter.trim() || r.name.toLowerCase().includes(filter.trim().toLowerCase())).sort((a, b) => (a.slots[0]?.startMs ?? 0) - (b.slots[0]?.startMs ?? 0));
                  const done = st.groupIds.filter((g) => data.slots.filter((x) => x.groupId === g).every((x) => x.status === 'completed')).length;
                  return (
                    <section key={st.id} className="card pl-place">
                      <header>
                        <div><h3>{st.name}</h3><small>{st.groupIds.length} {tx("group")}{st.groupIds.length === 1 ? '' : 's'} · {done} {tx("finished")}</small></div>
                        <div className="pl-mgr">{unique.length ? unique.map((p) => <span key={p.userId}><Avatar name={p.name} photoUrl={p.photoUrl} size={30} /><b>{p.name}</b><small>{tx("Site manager")}</small></span>) : st.supervisorName ? <span><Avatar name={st.supervisorName} size={30} /><b>{st.supervisorName}</b><small>{tx("Site manager")}</small></span> : <small>{tx("No site manager yet")}</small>}</div>
                      </header>
                      <div className="pl-bars" aria-hidden="true"><i style={{ width: `${st.groupIds.length ? Math.round((done / st.groupIds.length) * 100) : 0}%` }} /></div>
                      <ul className="pl-groups">
                        {rows.length === 0 && <li className="none">{tx("No group matches.")}</li>}
                        {rows.map((r) => {
                          const cur = r.slots.find((x) => x.status === 'in_progress') ?? r.slots.find((x) => ['upcoming', 'ready', 'delayed'].includes(x.status)) ?? r.slots[r.slots.length - 1];
                          return <li key={r.g} className={cur?.status ?? ''}><b>{r.name}</b><span>{cur ? `${hm(cur.startMs)} to ${hm(cur.endMs)}` : '—'}</span><em>{cur ? CHIP[cur.status] ?? cur.status : ''}</em></li>;
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

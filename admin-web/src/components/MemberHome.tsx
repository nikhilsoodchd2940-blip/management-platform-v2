'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useCollection, tsMs } from '@/lib/useCollection';
import { Avatar } from '@/components/MemberPicker';
import { KUREL_ROLES } from '@/app/dashboard/role-access/roles';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Profile { displayName?: string; email?: string; phone?: string; memberId?: string; photoUrl?: string; status?: string; registrationStatus?: string; createdAt?: unknown; notificationsEnabled?: boolean; primaryGroupId?: string; memberSince?: number | string }
interface Mine { groupId: string; name: string; place: string; roles: string[]; seat: string; since: number }
interface MeetingLite { id: string; title: string; status: string; startAt: unknown; endAt?: unknown; type?: string; location?: string; link?: string; coordinatorId?: string; coordinatorName?: string; inviteeIds?: string[]; agenda?: { id: string; title: string; plannedMinutes: number }[]; attendance?: Record<string, { status: string }>; actions?: { id: string; text: string; ownerId?: string; status: string; dueAt?: unknown }[] }
interface Note { id: string; title: string; body: string; type?: string; relatedId?: string; createdAt?: unknown }
interface Rec { id: string; [k: string]: unknown }
interface Records { events: { id: string; title: string; ms: number }[]; attendance: { id: string; title: string; status: string; late?: number; ms: number }[]; absences: { id: string; title: string; status: string; reason: string; ms: number }[]; contributions: { id: string; program: string; amount: number; cur: string; status: string; method: string; ms: number }[]; donations: { id: string; amount: number; cur: string; status: string; ms: number }[]; welfare: { id: string; category: string; status: string; ms: number }[] }

const when = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => (ms ? new Date(ms).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const money = (cents: number, cur: string) => `${(cents / 100).toLocaleString(dateLocale(), { maximumFractionDigits: 2 })} ${cur}`.trim();
const nice = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const rows = async (q: ReturnType<typeof query>): Promise<Rec[]> => { try { return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })); } catch { return []; } };
const one = async (path: string, id: string) => { try { return (await getDoc(doc(db, path, id))).data() as Record<string, unknown> | undefined; } catch { return undefined; } };

/** A member's own page: every detail about them, their kurels and roles, meetings, attendance, contributions and requests. Only their own data. */
export default function MemberHome() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [rec, setRec] = useState<Records | null>(null);
  const meetings = useCollection<MeetingLite>('meetings', [where('inviteeIds', 'array-contains', uid || '-')], `h-${uid}`);
  const notes = useCollection<Note>('notifications', [where('userId', '==', uid || '-'), limit(40)], `n-${uid}`);

  useEffect(() => {
    if (!uid) return;
    let off = false;
    (async () => {
      const u = await one('users', uid);
      if (!off) setProfile((u as Profile) ?? {});

      const ms = await rows(query(collection(db, 'groupMemberships'), where('userId', '==', uid), where('status', '==', 'active')));
      const out: Mine[] = [];
      for (const m of ms) {
        const groupId = m.groupId as string;
        const [g, kd] = await Promise.all([one('groups', groupId), one('kurelRoles', groupId)]);
        const city = g?.parentGroupId ? await one('groups', g.parentGroupId as string) : undefined;
        const country = city?.parentGroupId ? await one('groups', city.parentGroupId as string) : undefined;
        out.push({ groupId, name: (g?.name as string) || 'Kurel', place: [city?.name, country?.name].filter(Boolean).join(' · '), roles: KUREL_ROLES.filter((r) => kd?.[r.key] === uid).map((r) => r.label), seat: m.substitute ? 'Substitute seat' : 'Member', since: tsMs(m.joinedAt) });
      }
      if (!off) setMine(out);

      const [att, abs, con, don, wel, inv] = await Promise.all([
        rows(query(collection(db, 'attendance'), where('userId', '==', uid), limit(40))),
        rows(query(collection(db, 'absenceRequests'), where('userId', '==', uid), limit(20))),
        rows(query(collection(db, 'contributions'), where('userId', '==', uid), limit(30))),
        rows(query(collection(db, 'donations'), where('userId', '==', uid), limit(30))),
        rows(query(collection(db, 'welfareRequests'), where('userId', '==', uid), limit(20))),
        rows(query(collection(db, 'eventAttendees'), where('userId', '==', uid), limit(40))),
      ]);
      const evIds = Array.from(new Set([...att, ...abs, ...inv].map((r) => r.eventId as string).filter(Boolean)));
      const evs: Record<string, { title: string; ms: number }> = {};
      await Promise.all(evIds.slice(0, 30).map(async (id) => { const e = await one('events', id); if (e) evs[id] = { title: (e.title as string) || tx("Event"), ms: (e.startMs as number) || tsMs(e.startAt) }; }));
      const progIds = Array.from(new Set(con.map((c) => c.programId as string).filter(Boolean)));
      const progs: Record<string, { name: string; cur: string }> = {};
      await Promise.all(progIds.slice(0, 20).map(async (id) => { const p = await one('financialPrograms', id); if (p) progs[id] = { name: (p.name as string) || (p.title as string) || 'Program', cur: (p.currency as string) || '' }; }));
      if (off) return;
      setRec({
        events: inv.map((r) => ({ id: r.id, title: evs[r.eventId as string]?.title ?? tx("Event"), ms: evs[r.eventId as string]?.ms ?? 0 })).filter((e) => e.ms >= Date.now() - 86400000).sort((a, b) => a.ms - b.ms),
        attendance: att.map((r) => ({ id: r.id, title: evs[r.eventId as string]?.title ?? tx("Event"), status: String(r.status ?? ''), late: r.minutesLate as number | undefined, ms: tsMs(r.serverTimestamp) })).sort((a, b) => b.ms - a.ms),
        absences: abs.map((r) => ({ id: r.id, title: evs[r.eventId as string]?.title ?? tx("Event"), status: String(r.status ?? ''), reason: String(r.reason ?? ''), ms: tsMs(r.requestedAt) })).sort((a, b) => b.ms - a.ms),
        contributions: con.map((r) => ({ id: r.id, program: progs[r.programId as string]?.name ?? 'Contribution', amount: Number(r.amountCents ?? 0), cur: progs[r.programId as string]?.cur ?? '', status: String(r.status ?? ''), method: String(r.method ?? ''), ms: tsMs(r.createdAt) })).sort((a, b) => b.ms - a.ms),
        donations: don.map((r) => ({ id: r.id, amount: Number(r.amountCents ?? 0), cur: String(r.currency ?? '').toUpperCase(), status: String(r.status ?? ''), ms: tsMs(r.paidAt) || tsMs(r.createdAt) })).sort((a, b) => b.ms - a.ms),
        welfare: wel.map((r) => ({ id: r.id, category: String(r.category ?? ''), status: String(r.status ?? ''), ms: tsMs(r.createdAt) })).sort((a, b) => b.ms - a.ms),
      });
    })();
    return () => { off = true; };
  }, [uid]);

  const now = Date.now();
  const stats = useMemo(() => {
    const all = meetings ?? [];
    const upcoming = all.filter((m) => m.status === 'scheduled' && tsMs(m.startAt) >= now - 3600000).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt));
    const live = all.filter((m) => m.status === 'in_progress');
    const coordinating = all.filter((m) => m.coordinatorId === uid && (m.status === 'scheduled' || m.status === 'in_progress'));
    const actions = all.flatMap((m) => (m.actions ?? []).filter((a) => a.ownerId === uid && a.status === 'open').map((a) => ({ m, a })));
    const done = all.filter((m) => m.status === 'completed').sort((a, b) => tsMs(b.startAt) - tsMs(a.startAt));
    const present = done.filter((m) => m.attendance?.[uid]?.status === 'present').length;
    return { upcoming, live, coordinating, actions, done, present };
  }, [meetings, uid, now]);
  const recent = useMemo(() => [...(notes ?? [])].sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)).slice(0, 7), [notes]);

  const next = stats.live[0] ?? stats.upcoming[0];
  const name = profile?.displayName || user?.displayName || user?.email || 'Member';
  const rate = stats.done.length ? Math.round((stats.present / stats.done.length) * 100) : null;
  const nextMin = next && next.endAt ? Math.max(1, Math.round((tsMs(next.endAt) - tsMs(next.startAt)) / 60000)) : 0;
  const noteHref = (n: Note) => (n.type === 'meeting' && n.relatedId ? `/dashboard/meetings?open=${n.relatedId}` : '/dashboard/meetings');
  const paid = (rec?.contributions ?? []).filter((c) => c.status === 'validated');
  const evPresent = (rec?.attendance ?? []).filter((a) => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'LATE_APPROVED').length;
  const evRate = rec && rec.attendance.length ? Math.round((evPresent / rec.attendance.length) * 100) : null;

  const info: [string, string][] = [
    ['Member number', profile?.memberId || '—'],
    ['Phone', profile?.phone || '—'],
    ['Email', profile?.email || user?.email || '—'],
    ['Account', profile?.status ? nice(profile.status) : '—'],
    ['Registration', profile?.registrationStatus ? nice(profile.registrationStatus) : '—'],
    ['Member since', profile?.memberSince ? String(profile.memberSince) : day(tsMs(profile?.createdAt))],
    ['Reminders', profile?.notificationsEnabled === false ? 'Off' : 'On'],
    ['Main kurel', mine?.find((g) => g.groupId === profile?.primaryGroupId)?.name || mine?.[0]?.name || '—'],
  ];

  // Cards with nothing to show are not drawn; they become one line of chips, so the page has no empty boxes.
  const quiet: string[] = [];
  if (stats.actions.length === 0) quiet.push('No open action item');
  if (stats.coordinating.length === 0) quiet.push('You coordinate no open meeting');
  if (rec && rec.contributions.length === 0 && rec.donations.length === 0) quiet.push('No contribution or donation');
  if (rec && rec.absences.length === 0) quiet.push('No absence request');
  if (rec && rec.welfare.length === 0) quiet.push('No welfare request');
  if (rec && rec.events.length === 0) quiet.push('No upcoming event invitation');
  if (rec && rec.attendance.length === 0) quiet.push('No event attendance recorded');

  return (
    <div className="mh">
      <section className="mh-hero">
        <Avatar name={name} photoUrl={profile?.photoUrl} size={64} />
        <div className="mh-who">
          <h2>{name}</h2>
          <p>{[profile?.memberId ? `Member ${profile.memberId}` : '', profile?.phone, profile?.email || user?.email].filter(Boolean).join(' · ')}</p>
          <div className="mh-pills">
            {(mine ?? []).flatMap((g) => g.roles.map((r) => <span key={`${g.groupId}${r}`} className="gold">{r} · {g.name}</span>))}
            {(mine ?? []).map((g) => <span key={g.groupId}>{g.name}</span>)}
          </div>
        </div>
        <div className="mh-tiles">
          <div><b>{stats.upcoming.length}</b><span>{tx("Upcoming meetings")}</span></div>
          <div><b>{stats.coordinating.length}</b><span>{tx("You coordinate")}</span></div>
          <div className={stats.actions.length ? 'hot' : ''}><b>{stats.actions.length}</b><span>{tx("Open actions")}</span></div>
          <div><b>{rate === null ? '—' : `${rate}%`}</b><span>{tx("Meeting attendance")}</span></div>
          <div><b>{evRate === null ? '—' : `${evRate}%`}</b><span>{tx("Event attendance")}</span></div>
        </div>
      </section>

      <div className="mh-row two">
        <section className="mh-card">
          <h3>{tx("My details")}</h3>
          <dl className="mh-kv">{info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <h4>{tx("My kurels and roles")}</h4>
          {mine === null ? <p className="mh-empty">{tx("Loading…")}</p> : mine.length === 0 ? <p className="mh-empty">{tx("You are not in an active kurel.")}</p> : (
            <ul className="mh-list">{mine.map((g) => (
              <li key={g.groupId}><b>{g.name}</b><span>{[g.place, g.roles.length ? g.roles.join(', ') : g.seat, g.since ? `since ${day(g.since)}` : ''].filter(Boolean).join(' · ')}</span></li>
            ))}</ul>
          )}
        </section>

        <section className="mh-card">
          <h3>{stats.live[0] ? tx("Meeting in progress") : tx("Next meeting")}</h3>
          {!next ? <p className="mh-empty">{tx("No meeting is planned for you.")}</p> : (
            <div className="mh-next">
              <b>{next.title}</b>
              <div className="mh-meta">
                <span>{when(tsMs(next.startAt))}{next.endAt ? ` – ${new Date(tsMs(next.endAt)).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                {nextMin > 0 && <span>{nextMin} {tx("min")}</span>}
                <span>{next.type === 'online' ? (next.link ? <a href={next.link} target="_blank" rel="noreferrer">{tx("Join online")}</a> : tx("Online")) : next.location || tx("In person")}</span>
                <span>{(next.inviteeIds ?? []).length} {tx("invited")}</span>
                {next.coordinatorName && <span>{tx("Coordinator")} {next.coordinatorName}{next.coordinatorId === uid ? tx(" (you)") : ''}</span>}
              </div>
              {(next.agenda ?? []).length > 0 && <ol className="mh-agenda">{(next.agenda ?? []).map((p, i) => <li key={p.id}><i>{i + 1}</i><span>{p.title}</span><em>{p.plannedMinutes} {tx("min")}</em></li>)}</ol>}
              <Link className="mh-btn" href={`/dashboard/meetings?open=${next.id}`}>{next.coordinatorId === uid && next.status === 'scheduled' ? tx("Open and start") : tx("Open the meeting")}</Link>
            </div>
          )}
          {stats.upcoming.length > (stats.live[0] ? 0 : 1) && (
            <>
              <h4>{tx("Then")}</h4>
              <ul className="mh-list">{stats.upcoming.slice(stats.live[0] ? 0 : 1, 6).map((m) => <li key={m.id}><b>{m.title}</b><span>{when(tsMs(m.startAt))}</span><Link className="mh-link" href={`/dashboard/meetings?open=${m.id}`}>{tx("Open")}</Link></li>)}</ul>
            </>
          )}
        </section>
      </div>

      <div className="mh-row">
        {stats.coordinating.length > 0 && (
          <section className="mh-card"><h3>{tx("You coordinate ·")} {stats.coordinating.length}</h3>
            <ul className="mh-list">{stats.coordinating.map((m) => <li key={m.id}><b>{m.title}</b><span>{when(tsMs(m.startAt))}</span><Link className="mh-link" href={`/dashboard/meetings?open=${m.id}`}>{m.status === 'in_progress' ? tx("Run it") : tx("Open")}</Link></li>)}</ul>
          </section>
        )}
        {stats.actions.length > 0 && (
          <section className="mh-card"><h3>{tx("My action items ·")} {stats.actions.length}</h3>
            <ul className="mh-list">{stats.actions.slice(0, 8).map(({ m, a }) => <li key={`${m.id}${a.id}`}><b>{a.text}</b><span>{m.title}{a.dueAt ? ` · by ${day(tsMs(a.dueAt))}` : ''}</span></li>)}</ul>
          </section>
        )}
        <section className="mh-card">
          <h3>{tx("Meeting attendance")}</h3>
          {stats.done.length === 0 ? <p className="mh-empty">{tx("No finished meeting yet.")}</p> : (
            <>
              <div className="mh-att"><i style={{ width: `${rate ?? 0}%` }} /></div>
              <p className="mh-sub">{stats.present} {tx("present of")} {stats.done.length} {tx("finished meeting")}{stats.done.length === 1 ? '' : 's'}</p>
              <ul className="mh-list">{stats.done.slice(0, 5).map((m) => { const st = m.attendance?.[uid]?.status; return <li key={m.id} className={st === 'present' ? '' : 'miss'}><b>{m.title}</b><span>{day(tsMs(m.startAt))}</span><em className={st === 'present' ? 'ok' : 'no'}>{st === 'present' ? tx("Present") : st === 'absent' ? tx("Absent") : tx("Not marked")}</em></li>; })}</ul>
            </>
          )}
        </section>
        <section className="mh-card">
          <h3>{tx("Latest notifications")}</h3>
          {recent.length === 0 ? <p className="mh-empty">{tx("No notification yet.")}</p> : (
            <ul className="mh-list">{recent.slice(0, 5).map((n) => <li key={n.id}><Link className="mh-note" href={noteHref(n)}><b>{n.title}</b><span>{n.body}</span></Link></li>)}</ul>
          )}
        </section>
      </div>

      {rec && (rec.events.length > 0 || rec.attendance.length > 0 || rec.contributions.length > 0 || rec.donations.length > 0 || rec.absences.length > 0 || rec.welfare.length > 0) && (
        <div className="mh-row">
          {rec.events.length > 0 && (
            <section className="mh-card"><h3>{tx("My events ·")} {rec.events.length}</h3>
              <ul className="mh-list">{rec.events.slice(0, 6).map((e) => <li key={e.id}><b>{e.title}</b><span>{e.ms ? when(e.ms) : ''}</span></li>)}</ul>
            </section>
          )}
          {rec.attendance.length > 0 && (
            <section className="mh-card"><h3>{tx("Event attendance ·")} {evRate}%</h3>
              <ul className="mh-list">{rec.attendance.slice(0, 6).map((a) => <li key={a.id} className={a.status === 'PRESENT' ? '' : a.status === 'LATE' || a.status === 'LATE_APPROVED' ? 'late' : 'miss'}><b>{a.title}</b><span>{day(a.ms)}{a.late ? ` · ${a.late} min late` : ''}</span><em className={a.status === 'PRESENT' ? 'ok' : 'no'}>{nice(a.status.toLowerCase())}</em></li>)}</ul>
            </section>
          )}
          {(rec.contributions.length > 0 || rec.donations.length > 0) && (
            <section className="mh-card"><h3>{tx("Contributions and donations")}</h3>
              {paid.length > 0 && <p className="mh-sub">{paid.length} {tx("validated payment")}{paid.length === 1 ? '' : 's'}: {Object.entries(paid.reduce<Record<string, number>>((a, c) => ({ ...a, [c.cur]: (a[c.cur] ?? 0) + c.amount }), {})).map(([cur, v]) => money(v, cur)).join(' + ')}</p>}
              <ul className="mh-list">
                {rec.contributions.slice(0, 4).map((c) => <li key={c.id}><b>{c.program}</b><span>{money(c.amount, c.cur)} · {nice(c.method)} · {day(c.ms)}</span><em className={c.status === 'validated' ? 'ok' : 'no'}>{nice(c.status)}</em></li>)}
                {rec.donations.slice(0, 3).map((d) => <li key={d.id}><b>{tx("Donation")}</b><span>{money(d.amount, d.cur)} · {day(d.ms)}</span><em className={d.status === 'succeeded' ? 'ok' : 'no'}>{nice(d.status)}</em></li>)}
              </ul>
            </section>
          )}
          {(rec.absences.length > 0 || rec.welfare.length > 0) && (
            <section className="mh-card"><h3>{tx("My requests")}</h3>
              <ul className="mh-list">
                {rec.absences.slice(0, 4).map((a) => <li key={a.id}><b>{tx("Absence ·")} {a.title}</b><span>{a.reason ? `${a.reason.slice(0, 60)} · ` : ''}{day(a.ms)}</span><em className={a.status === 'approved' ? 'ok' : 'no'}>{nice(a.status)}</em></li>)}
                {rec.welfare.slice(0, 3).map((w) => <li key={w.id}><b>{tx("Welfare ·")} {nice(w.category)}</b><span>{day(w.ms)}</span><em className={w.status === 'closed' ? 'ok' : 'no'}>{nice(w.status)}</em></li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      {quiet.length > 0 && <div className="mh-quiet">{quiet.map((q) => <span key={q}>{q}</span>)}</div>}
    </div>
  );
}

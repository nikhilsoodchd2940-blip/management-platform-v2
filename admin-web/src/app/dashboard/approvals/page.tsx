'use client';

import { useHashScroll } from '@/lib/useHashScroll';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, orderBy, query, where, Timestamp, limit as fsLimit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { reviewRegistration, reviewPhoneUpdateRequest } from '@/lib/functions';
import { fmt, useCount } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { looseMatch } from '@/lib/looseMatch';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMembershipsByUser } from '@/lib/useMemberships';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useUserNames } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import Dropdown from '@/components/Dropdown';
import FormDialog from '@/components/FormDialog';
import { Admissions, RenewalCard, TransferTools } from './Pipeline';
import { tx, dateLocale } from '@/lib/i18n/tr';
import { CxBanner, CxCard, CxStats, CxSteps, CxTabs } from '@/components/Cx';
import { BarChart3, Calendar, ClipboardCheck, FileText, FlaskConical, FolderOpen, GraduationCap, Inbox, Layers, MapPin, MessageCircle, Phone, Plus, RefreshCw, ScrollText, ShieldCheck, Users, Wifi, Check } from 'lucide-react';

interface Pending { id: string; displayName: string; memberId: string; phone: string; email: string; photoUrl: string; createdMs: number }
interface PhoneRequest { id: string; memberId: string; requestedPhone: string; note: string; createdMs: number }
type Tab = 'registrations' | 'applications' | 'requests' | 'renewals' | 'activity';

const ago = (ms: number) => {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};
const dateOf = (ms: number) => (ms ? new Date(ms).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const waitingDays = (ms: number) => (ms ? Math.floor((Date.now() - ms) / 86400000) : 0);

function Flag({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`ap-flag ${ok ? 'ok' : 'bad'}`}>{ok ? '✓' : '!'} {ok ? yes : no}</span>;
}
function Pane({ title, note, right, children, icon }: { title: string; note?: string; right?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <CxCard className="ap-pane" icon={icon ?? <FileText size={22} />} title={title} sub={note} right={right}>{children}</CxCard>
  );
}

/** Administration: one workspace for registrations, applications, requests, renewals and the log. */
export default function AdministrationPage() {
  useHashScroll();
  const { locationOf, countries, byId } = useGroupHierarchy();
  const [tab, setTab] = useState<Tab>('registrations');
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [phoneRequests, setPhoneRequests] = useState<PhoneRequest[]>([]);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [idFilter, setIdFilter] = useState('');
  const [photoFilter, setPhotoFilter] = useState('');
  const [waitFilter, setWaitFilter] = useState('');
  const [sort, setSort] = useState<{ by: 'name' | 'date' | 'id'; dir: 1 | -1 }>({ by: 'date', dir: 1 });
  const [open, setOpen] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState<string[] | null>(null);
  const [newApp, setNewApp] = useState(0);

  const online = useCount('presence', [['lastActiveAt', '>=', Timestamp.fromMillis(Date.now() - 5 * 60 * 1000)]], 60000);
  const testsScheduled = useCount('admissionApplications', [['stage', '==', 'test']], 60000);
  const apps = useCollection<{ stage: string }>('admissionApplications', [orderBy('updatedAt', 'desc'), fsLimit(100)]);
  const transfers = useCollection<{ stage: string }>('transferRequests', [orderBy('updatedAt', 'desc'), fsLimit(30)]);
  const logRaw = useCollection<{ action: string; actorUserId: string | null; result: string; createdAt: unknown }>('auditLogs', [orderBy('createdAt', 'desc'), fsLimit(40)]);
  const logActors = useUserNames((logRaw ?? []).map((l) => l.actorUserId ?? '').filter(Boolean));

  useEffect(() => onSnapshot(query(collection(db, 'users'), where('registrationStatus', '==', 'pending_approval'), orderBy('displayNameLower')), (snap) => {
    setPending(snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, displayName: (x.displayName as string) || '', memberId: (x.memberId as string) || '', phone: (x.phone as string) || '', email: (x.email as string) || '', photoUrl: (x.photoUrl as string) || '', createdMs: (x.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0 };
    }));
    setLoaded(true);
  }), []);
  useEffect(() => onSnapshot(query(collection(db, 'phoneUpdateRequests'), where('status', '==', 'pending')), (snap) =>
    setPhoneRequests(snap.docs.map((d) => ({ id: d.id, memberId: (d.data().memberId as string) || '', requestedPhone: (d.data().requestedPhone as string) || '', note: (d.data().note as string) || '', createdMs: (d.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0 })))), []);

  const memberships = useMembershipsByUser(useMemo(() => pending.map((p) => p.id), [pending]));
  const kurelsOf = (id: string) => (memberships[id] ?? []).map((m) => ({ id: m.groupId, name: byId[m.groupId]?.name ?? '', place: [locationOf(m.groupId).city?.name, locationOf(m.groupId).country?.name].filter(Boolean).join(', ') }));

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = pending.filter((p) => {
      if (term && !looseMatch(term, `${p.displayName} ${p.memberId} ${p.phone} ${p.email}`)) return false;
      if (country && !(memberships[p.id] ?? []).some((m) => locationOf(m.groupId).country?.id === country)) return false;
      if (idFilter === 'with' && !p.memberId) return false;
      if (idFilter === 'without' && p.memberId) return false;
      if (photoFilter === 'with' && !p.photoUrl) return false;
      if (photoFilter === 'without' && p.photoUrl) return false;
      if (waitFilter === 'week' && waitingDays(p.createdMs) < 7) return false;
      if (waitFilter === 'new' && waitingDays(p.createdMs) >= 7) return false;
      return true;
    });
    const key = (p: Pending) => (sort.by === 'name' ? p.displayName.toLowerCase() : sort.by === 'id' ? p.memberId : p.createdMs);
    return list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * sort.dir);
  }, [pending, search, country, idFilter, photoFilter, waitFilter, sort, memberships, locationOf]);

  const head = (by: 'name' | 'date' | 'id', text: string) => (
    <button type="button" className={`ap-sort${sort.by === by ? ' on' : ''}`} onClick={() => setSort((s) => ({ by, dir: s.by === by ? (s.dir === 1 ? -1 : 1) : 1 }))}>{text}{sort.by === by ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
  );

  async function approve(ids: string[]) {
    if (ids.length > 1 && !confirm(`Approve ${ids.length} registrations? These members get access to the app.`)) return;
    setBusy(true);
    let ok = 0;
    for (const userId of ids) {
      try { await reviewRegistration({ userId, decision: 'approved' }); ok++; } catch (err) { notify(err instanceof Error ? err.message : 'Could not approve one registration', 'error'); }
    }
    setBusy(false); setPicked((p) => p.filter((x) => !ids.includes(x)));
    if (ok) notify(ok === 1 ? 'Registration approved' : `${ok} registrations approved`, 'success');
  }
  async function decidePhone(requestId: string, decision: 'approved' | 'rejected') {
    try { await reviewPhoneUpdateRequest({ requestId, decision }); notify(decision === 'approved' ? 'New number approved' : 'Request rejected', 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Could not update this request', 'error'); }
  }

  const allShownPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));
  const activeApps = (apps ?? []).filter((a) => a.stage !== 'account_created' && a.stage !== 'rejected').length;
  const openTransfers = (transfers ?? []).filter((t) => t.stage === 'zone_opinion' || t.stage === 'decision').length;
  const oldest = pending.reduce((m, p) => (p.createdMs && (!m || p.createdMs < m) ? p.createdMs : m), 0);
  const TILES: { tab: Tab; label: string; value: string; note: string; tone: string }[] = [
    { tab: 'registrations', label: tx("Registrations to review"), value: loaded ? fmt(pending.length) : '—', note: oldest ? `Oldest waiting ${ago(oldest).toLowerCase()}` : 'Nothing waiting', tone: 'y' },
    { tab: 'applications', label: tx("Applications in progress"), value: apps === null ? '—' : fmt(activeApps), note: `${fmt(testsScheduled)} at test stage`, tone: 'b' },
    { tab: 'requests', label: tx("Requests to answer"), value: fmt(phoneRequests.length + openTransfers), note: `${phoneRequests.length} phone · ${openTransfers} kurel`, tone: 'p' },
    { tab: 'activity', label: tx("Online now"), value: fmt(online), note: 'Last 5 minutes', tone: 'g' },
  ];
  const TABS: { key: Tab; name: string; badge?: number }[] = [
    { key: 'registrations', name: 'Registrations', badge: pending.length }, { key: 'applications', name: 'Applications', badge: activeApps },
    { key: 'requests', name: 'Requests', badge: phoneRequests.length + openTransfers }, { key: 'renewals', name: 'Renewals' },
    { key: 'activity', name: 'Activity' },
  ];

  return (
    <div className="ap cx-page">
      <CxBanner kicker="Direction Conservatoire" title={tx("Administration")} sub={tx("Review registrations, move applications through the official path, answer requests and run renewals.")}>
        <button type="button" className="cx-btn gold" onClick={() => { setTab('applications'); setNewApp((n) => n + 1); }}><Plus size={18} />{tx("New application")}</button>
      </CxBanner>

      <CxStats items={[
        { label: TILES[0].label, value: TILES[0].value, sub: TILES[0].note, icon: <FileText size={24} />, tone: 'amber', onClick: () => setTab('registrations') },
        { label: TILES[1].label, value: TILES[1].value, sub: TILES[1].note, icon: <Layers size={24} />, tone: 'green', onClick: () => setTab('applications') },
        { label: TILES[2].label, value: TILES[2].value, sub: TILES[2].note, icon: <MessageCircle size={24} />, tone: 'violet', onClick: () => setTab('requests') },
        { label: TILES[3].label, value: TILES[3].value, sub: TILES[3].note, icon: <Wifi size={24} />, tone: 'green', onClick: () => setTab('activity') },
      ]} />

      <CxSteps steps={[
        { icon: <FileText size={18} />, label: tx("Request") }, { icon: <ShieldCheck size={18} />, label: tx("Verification") }, { icon: <FlaskConical size={18} />, label: tx("Test") },
        { icon: <GraduationCap size={18} />, label: tx("Pedagogical opinion") }, { icon: <MapPin size={18} />, label: tx("Local validation") }, { icon: <ClipboardCheck size={18} />, label: tx("Final validation") }, { icon: <Users size={18} />, label: tx("Account and Kurel") },
      ]} />

      <CxTabs value={tab} onChange={(v) => setTab(v as Tab)} items={[
        { value: 'registrations', label: tx("Registrations"), icon: <FolderOpen size={20} />, count: pending.length || undefined },
        { value: 'applications', label: tx("Applications"), icon: <Layers size={20} />, count: activeApps || undefined },
        { value: 'requests', label: tx("Requests"), icon: <MessageCircle size={20} />, count: phoneRequests.length + openTransfers || undefined },
        { value: 'renewals', label: tx("Renewals"), icon: <RefreshCw size={20} /> },
        { value: 'activity', label: tx("Activity"), icon: <BarChart3 size={20} /> },
      ]} />

      {tab === 'registrations' && (
        <Pane icon={<FileText size={22} />} title={tx("Registration files")} note={`${rows.length} of ${pending.length} shown. Click a name for the profile, a row for the checks.`}
          right={picked.length > 0 ? (
            <>
              <button type="button" className="ap-btn ok" disabled={busy} onClick={() => approve(picked)}>{tx("Approve")} {picked.length} {tx("selected")}</button>
              <button type="button" className="ap-btn no" disabled={busy} onClick={() => setReject(picked)}>{tx("Reject")} {picked.length}</button>
              <button type="button" className="ap-btn" onClick={() => setPicked([])}>{tx("Clear")}</button>
            </>
          ) : undefined}>
          <div className="ap-bar">
            <input type="search" placeholder={tx("Name, member ID, phone or email")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Dropdown label={tx("Country")} value={country} onChange={setCountry} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("Member ID")} value={idFilter} onChange={setIdFilter} allLabel="Any" options={[{ value: 'with', label: tx("Provided") }, { value: 'without', label: tx("Missing") }]} />
            <Dropdown label={tx("Photo")} value={photoFilter} onChange={setPhotoFilter} allLabel="Any" options={[{ value: 'with', label: tx("Provided") }, { value: 'without', label: tx("Missing") }]} />
            <Dropdown label={tx("Waiting")} value={waitFilter} onChange={setWaitFilter} allLabel="Any time" options={[{ value: 'week', label: tx("7 days or more") }, { value: 'new', label: tx("Less than 7 days") }]} />
          </div>
          <div className="ap-twrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th className="ck"><input type="checkbox" aria-label={tx("Select all")} checked={allShownPicked} onChange={() => setPicked(allShownPicked ? [] : rows.map((r) => r.id))} /></th>
                  <th>{head('name', 'Candidate')}</th><th>{head('id', 'Member ID')}</th><th>{tx("Contact")}</th><th>{tx("Kurel")}</th><th>{tx("Checks")}</th><th>{head('date', 'Received')}</th><th className="act">{tx("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {!loaded && <tr><td colSpan={8} className="ap-none">{tx("Loading…")}</td></tr>}
                {loaded && rows.length === 0 && <tr><td colSpan={8} className="ap-none"><span className="cx-empty"><Inbox size={44} /><b>{pending.length === 0 ? tx("No registrations are waiting") : tx("No registration matches these filters.")}</b>{pending.length === 0 && <span>{tx("New sign-ups from the app will appear here.")}</span>}</span></td></tr>}
                {rows.map((p) => {
                  const ks = kurelsOf(p.id);
                  const late = waitingDays(p.createdMs) >= 7;
                  return (
                    <Fragment key={p.id}>
                      <tr className={`row${open === p.id ? ' open' : ''}`} onClick={() => setOpen(open === p.id ? '' : p.id)}>
                        <td className="ck" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${p.displayName}`} checked={picked.includes(p.id)} onChange={() => setPicked((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <PersonLink userId={p.id}><span className="ap-who"><Avatar name={p.displayName || '?'} photoUrl={p.photoUrl} size={38} /><span><b>{p.displayName || tx("(no name)")}</b><small>{p.email || tx("No email")}</small></span></span></PersonLink>
                        </td>
                        <td>{p.memberId ? <code className="ap-id">{p.memberId}</code> : <span className="ap-miss">{tx("Missing")}</span>}</td>
                        <td onClick={(e) => e.stopPropagation()}>{p.phone ? <a href={`tel:${p.phone}`} className="ap-link">{p.phone}</a> : <span className="ap-miss">{tx("No phone")}</span>}</td>
                        <td>{ks.length === 0 ? <span className="ap-miss">{tx("No kurel")}</span> : <span className="ap-k"><b>{ks[0].name}</b><small>{ks[0].place}{ks.length > 1 ? ` · +${ks.length - 1} more` : ''}</small></span>}</td>
                        <td><span className="ap-flags"><Flag ok={!!p.memberId} yes="ID" no="ID" /><Flag ok={!!p.photoUrl} yes="Photo" no="Photo" /></span></td>
                        <td><span className={`ap-age${late ? ' late' : ''}`}><b>{ago(p.createdMs)}</b><small>{dateOf(p.createdMs)}</small></span></td>
                        <td className="act" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="ap-btn ok" disabled={busy} onClick={() => approve([p.id])}>{tx("Approve")}</button>
                          <button type="button" className="ap-btn no" disabled={busy} onClick={() => setReject([p.id])}>{tx("Reject")}</button>
                        </td>
                      </tr>
                      {open === p.id && (
                        <tr className="detail"><td colSpan={8}>
                          <div className="ap-detail">
                            <div><span>{tx("Declared member ID")}</span><b>{p.memberId || '—'}</b></div>
                            <div><span>{tx("Phone")}</span><b>{p.phone || '—'}</b></div>
                            <div><span>{tx("Email")}</span><b>{p.email ? <a className="ap-link" href={`mailto:${p.email}`}>{p.email}</a> : '—'}</b></div>
                            <div><span>{tx("Kurels")}</span><b>{ks.length ? ks.map((k) => `${k.name}${k.place ? ` (${k.place})` : ''}`).join(' · ') : tx("None yet")}</b></div>
                            <div><span>{tx("Photo")}</span><b>{p.photoUrl ? <a className="ap-link" href={p.photoUrl} target="_blank" rel="noreferrer">{tx("Open the photo")}</a> : tx("Missing")}</b></div>
                            <div><span>{tx("Received")}</span><b>{dateOf(p.createdMs)} · {ago(p.createdMs)}</b></div>
                          </div>
                          {(!p.memberId || !p.photoUrl || ks.length === 0) && <p className="ap-warn">{tx("Check before approving:")} {[!p.memberId && 'no member ID', !p.photoUrl && 'no photo', ks.length === 0 && 'no kurel'].filter(Boolean).join(', ')}.</p>}
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Pane>
      )}

      {tab === 'applications' && <Admissions newSignal={newApp} />}

      {tab === 'requests' && (
        <div className="ap-two">
          <Pane icon={<Phone size={22} />} title={tx("Phone number changes")} note="Members asking to use a new number." right={<span className="ap-count">{phoneRequests.length}</span>}>
            {phoneRequests.length === 0 && <p className="ap-none">{tx("No pending phone change.")}</p>}
            <div className="ap-cards">
              {phoneRequests.map((r) => (
                <article key={r.id} className="ap-req">
                  <i className="ap-av"><Users size={26} /></i>
                  <div><b>{r.memberId}</b><small>{tx("New number")}</small><code className="ap-id"><Phone size={14} /> {r.requestedPhone}</code>{r.note && <p>{r.note}</p>}{r.createdMs ? <small className="ap-when"><Calendar size={14} /> {ago(r.createdMs)}</small> : null}</div>
                  <footer><button type="button" className="ap-btn no" onClick={() => decidePhone(r.id, 'rejected')}>{tx("Reject")}</button><button type="button" className="ap-btn ok" onClick={() => decidePhone(r.id, 'approved')}>{tx("Approve")}</button></footer>
                </article>
              ))}
            </div>
          </Pane>
          <div id="phone-changes"><TransferTools /></div>
        </div>
      )}

      {tab === 'renewals' && <RenewalCard />}

      {tab === 'activity' && (
        <Pane icon={<ScrollText size={22} />} title={tx("Administrative log")} note="Sensitive operations recorded by the server. Click a name for the profile." right={<span className="ap-count">{fmt(online)} {tx("online")}</span>}>
          <div className="cx-scroll"><table className="cx-table ap-logt">
            <thead><tr><th>{tx("Date & time")}</th><th>{tx("Operation")}</th><th>{tx("Result")}</th><th /></tr></thead>
            <tbody>
              {logRaw !== null && logRaw.length === 0 && <tr><td colSpan={4} className="ap-none">{tx("No log entries.")}</td></tr>}
              {(logRaw ?? []).map((l) => (
                <tr key={l.id}>
                  <td><span className="ap-dt"><Calendar size={17} />{tsMs(l.createdAt) ? new Date(tsMs(l.createdAt)).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span></td>
                  <td><b>{l.action}</b></td>
                  <td><span className="cx-pill grey">{l.actorUserId ? <PersonLink userId={l.actorUserId}>{logActors[l.actorUserId] || tx("Open profile")}</PersonLink> : tx("System")}</span></td>
                  <td><span className={`cx-pill ${l.result.toLowerCase() === 'success' ? 'green' : 'red'}`}>{l.result.toLowerCase() === 'success' ? <><Check size={14} strokeWidth={3} /> {tx("Done")}</> : tx("Failed")}</span></td>
                </tr>
              ))}
            </tbody></table></div>
          </Pane>
      )}

      {reject && (
        <FormDialog
          title={reject.length === 1 ? tx("Reject this registration") : `Reject ${reject.length} registrations`}
          intro="The reason is shown to the member in the app. Leave it empty to give none."
          submitLabel={tx("Reject")}
          onClose={() => setReject(null)}
          fields={[{ name: 'reason', label: tx("Reason"), type: 'textarea' }]}
          onSubmit={async (v) => {
            for (const userId of reject) await reviewRegistration({ userId, decision: 'rejected', reason: v.reason?.trim() || undefined });
            setPicked((p) => p.filter((x) => !reject.includes(x)));
            notify(reject.length === 1 ? 'Registration rejected' : `${reject.length} registrations rejected`, 'success');
          }}
        />
      )}
    </div>
  );
}

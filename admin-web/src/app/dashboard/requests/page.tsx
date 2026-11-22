'use client';

import { useHashScroll } from '@/lib/useHashScroll';
import '../../px/index.css';
import { useEffect, useMemo, useState } from 'react';
import { collection, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { reviewAbsenceRequest, reviewEventRequest, submitWelfareRequest, updateWelfareRequest } from '@/lib/functions';
import { useGroupMembers } from '@/lib/useGroupMembers';
import FormDialog from '@/components/FormDialog';
import { fmt } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import Link from 'next/link';
import { tx, dateLocale } from '@/lib/i18n/tr';
import Dropdown from '@/components/Dropdown';
import { CxBanner, CxCard, CxStats } from '@/components/Cx';
import { ArrowUpRight, BarChart3, CheckCircle2, FileText, Info, Inbox, Layers, Plus, Search, Send, Users, Workflow } from 'lucide-react';

type Status = 'pending' | 'approved' | 'rejected';
type WStatus = 'new' | 'in_progress' | 'escalated' | 'closed';
interface WReport { id: string; kind: string; text: string; amountCents?: number; actorName: string }
interface Row {
  key: string;
  kind: 'event' | 'absence' | 'welfare';
  welfare?: { status: WStatus; report: WReport[]; collectedCents?: number; spentCents?: number; beneficiary?: string; categoryKey: string };
  id: string;
  eventId?: string;
  userId: string;
  category: string;
  groupId?: string;
  whenMs: number;
  status: Status;
  detail: string;
  createdMs: number;
}

const CAP = 300;
const WCATEGORY: Record<string, string> = { marriage: 'Marriage', death: 'Death', birth: 'Birth', illness: 'Illness', prayer_request: 'Prayer request', financial_assistance: 'Financial assistance', other: 'Other' };
const WSTATUS: Record<WStatus, string> = { new: 'New', in_progress: 'Local handling', escalated: 'Escalated', closed: 'Resolved' };
const ENTRY_KIND: Record<string, string> = { call: 'Call', visit: 'Visit', travel: 'Kurel travel', attendance: 'Attendance', support: 'Support given', decision: 'Decision', document: 'Document', note: 'Note' };
const STATUS_LABEL: Record<Status, string> = { pending: 'Under review', approved: 'Resolved', rejected: 'Rejected' };

/** Member welfare — event and absence requests, in the approved layout. */
export default function WelfarePage() {
  useHashScroll();
  const { byId, activeLeafGroups } = useGroupHierarchy();
  const [events, setEvents] = useState<Row[]>([]);
  const [absences, setAbsences] = useState<Row[]>([]);
  const [welfares, setWelfares] = useState<Row[]>([]);
  const [formGroup, setFormGroup] = useState('');
  const [dialog, setDialog] = useState<null | 'new' | { id: string; categoryKey: string }>(null);
  const members = useGroupMembers(formGroup);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'eventRequests'), orderBy('createdAt', 'desc'), fsLimit(CAP)), (snap) =>
      setEvents(
        snap.docs.map((d) => ({
          key: `e-${d.id}`,
          kind: 'event',
          id: d.id,
          userId: d.data().requestedBy as string,
          category: 'Event request',
          groupId: d.data().groupId as string,
          whenMs: (d.data().proposedStartAt as Timestamp | undefined)?.toMillis?.() ?? 0,
          status: (d.data().status as Status) ?? 'pending',
          detail: (d.data().proposedTitle as string) ?? '',
          createdMs: (d.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0,
        }))
      )
    );
    const u2 = onSnapshot(query(collection(db, 'absenceRequests'), orderBy('createdAt', 'desc'), fsLimit(CAP)), (snap) =>
      setAbsences(
        snap.docs.map((d) => ({
          key: `a-${d.id}`,
          kind: 'absence',
          id: d.id,
          eventId: d.data().eventId as string,
          userId: d.data().userId as string,
          category: 'Absence request',
          whenMs: 0,
          status: (d.data().status as Status) ?? 'pending',
          detail: (d.data().reason as string) ?? '',
          createdMs: (d.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0,
        }))
      )
    );
    const u3 = onSnapshot(query(collection(db, 'welfareRequests'), orderBy('createdAt', 'desc'), fsLimit(CAP)), (snap) =>
      setWelfares(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            key: `w-${d.id}`,
            kind: 'welfare' as const,
            id: d.id,
            userId: x.userId as string,
            category: WCATEGORY[x.category as string] ?? 'Welfare',
            groupId: x.groupId as string,
            whenMs: (x.eventDate as Timestamp | undefined)?.toMillis?.() ?? 0,
            status: x.status === 'closed' ? 'approved' : 'pending',
            detail: (x.explanation as string) ?? '',
            createdMs: (x.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0,
            welfare: { status: (x.status as WStatus) ?? 'new', report: (x.report as WReport[]) ?? [], collectedCents: x.collectedCents as number | undefined, spentCents: x.spentCents as number | undefined, beneficiary: x.beneficiary as string | undefined, categoryKey: x.category as string },
          };
        })
      )
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const all = useMemo(() => [...events, ...absences, ...welfares].sort((a, b) => b.createdMs - a.createdMs), [events, absences, welfares]);
  const profiles = useUserProfiles(all.map((r) => r.userId));
  const names = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.name]));
  const rows = all.filter((r) => !filter || r.status === filter);
  const pending = all.filter((r) => (r.kind === 'welfare' ? r.welfare?.status === 'new' : r.status === 'pending')).length;
  const localHandling = welfares.filter((r) => r.welfare?.status === 'in_progress').length;
  const escalated = welfares.filter((r) => r.welfare?.status === 'escalated').length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const resolvedMonth = all.filter((r) => r.status !== 'pending' && r.createdMs >= monthStart).length;

  const [form, setForm] = useState({ userId: '', category: '', date: '', time: '', text: '' });
  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await submitWelfareRequest({ userId: form.userId, groupId: formGroup, category: form.category, eventDateMs: new Date(`${form.date}T${form.time || '00:00'}`).getTime(), explanation: form.text });
      notify('Request sent to the kurel manager', 'success');
      setForm({ userId: '', category: '', date: '', time: '', text: '' });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not send the request', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function welfareAction(id: string, patch: Record<string, unknown>, ok: string) {
    try {
      await updateWelfareRequest({ requestId: id, ...patch });
      notify(ok, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update the request', 'error');
    }
  }

  async function decide(r: Row, decision: 'approved' | 'rejected') {
    let reason: string | undefined;
    if (r.kind === 'event' && decision === 'rejected') {
      const typed = window.prompt('Reason for rejecting this event proposal (sent to the group manager):');
      if (!typed || !typed.trim()) { notify('A reason is required to reject a proposal', 'error'); return; }
      reason = typed.trim();
    }
    setBusy(true);
    try {
      if (r.kind === 'event') await reviewEventRequest({ eventRequestId: r.id, decision, reason });
      else await reviewAbsenceRequest({ eventId: r.eventId as string, userId: r.userId, decision });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not record the decision', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px px-index so-wrap">
      <section className="cx-page so-page" id="requests">
        <CxBanner icon={<Users size={26} />} kicker="Direction Conservatoire" title={tx("Social")} sub={tx("A confidential path from the member to their manager, with full visibility for the leadership.")}>
          <button className="cx-btn green" type="button" onClick={() => document.getElementById('welfare-form')?.scrollIntoView({ behavior: 'smooth' })}><Plus size={18} />{tx("New request")}</button>
        </CxBanner>
        <CxStats items={[
          { label: tx("New requests"), value: fmt(pending), icon: <FileText size={22} />, tone: 'green' },
          { label: tx("Local handling"), value: fmt(localHandling), icon: <Layers size={22} />, tone: 'amber' },
          { label: tx("Escalated to leadership"), value: fmt(escalated), icon: <ArrowUpRight size={22} />, tone: 'blue' },
          { label: tx("Resolved this month"), value: fmt(resolvedMonth), icon: <CheckCircle2 size={22} />, tone: 'violet' },
        ]} />
        <div className="cx-grid cx-g32">
          <form className="cx-card so-form" id="welfare-form" onSubmit={submitForm}>
            <header><i><Send size={22} /></i><div><h2>{tx("Submit a request")}</h2><p>{tx("The manager of the chosen group receives it directly.")}</p></div><div className="cx-hr"><span className="cx-pill green" ><i />{tx("On behalf of a member")}</span></div></header>
            <div className="cx-cb">
              <div className="cx-two">
                <Dropdown label={tx("Group concerned")} value={formGroup} onChange={(v) => { setFormGroup(v); setForm({ ...form, userId: '' }); }} allLabel={tx("Choose a group")} options={activeLeafGroups.map((g) => ({ value: g.id, label: g.name }))} />
                <Dropdown label={tx("Member")} value={form.userId} onChange={(v) => setForm({ ...form, userId: v })} allLabel={tx("Choose a member")} options={members.map((m) => ({ value: m.id, label: m.name }))} />
              </div>
              <div className="cx-two">
                <Dropdown label={tx("Category")} value={form.category} onChange={(v) => setForm({ ...form, category: v })} allLabel={tx("Choose a category")} options={Object.entries(WCATEGORY).map(([k, v]) => ({ value: k, label: v }))} />
                <label className="cx-field">{tx("Date concerned")}<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
                <label className="cx-field">{tx("Time concerned")}<input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
              </div>
              <label className="cx-field">{tx("Explanation of the request")}<textarea required rows={4} placeholder={tx("Describe the situation…")} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></label>
              <div className="so-act"><span className="cx-note"><Info size={16} />{tx("Members follow the status and the answer from their account.")}</span><button className="cx-btn green" type="submit" disabled={busy || !formGroup || !form.userId || !form.category}><Send size={16} />{tx("Send to the manager")}</button></div>
            </div>
          </form>
          <CxCard icon={<Workflow size={22} />} title={tx("Handling path")} sub={tx("Every decision is time-stamped and visible to the main administrators.")}>
            <ol className="so-path">
              {[[<FileText size={20} key="a" />, 'Request submitted', 'The member chooses their kurel and explains the situation.'], [<Search size={20} key="b" />, 'Review by the manager', 'The manager receives the request and checks the information.'], [<Users size={20} key="c" />, 'Local handling', 'The action and the answer are recorded.'], [<ArrowUpRight size={20} key="d" />, 'Escalation', 'Cases needing a central decision are passed on with their full history.'], [<CheckCircle2 size={20} key="e" />, 'Resolution', 'The final decision is recorded and communicated to the member.']].map(([ic, t, d], i) => (
                <li key={t as string} className={`s${i + 1}`}><b>{i + 1}</b><i>{ic}</i><span><strong>{tx(t as string)}</strong><small>{tx(d as string)}</small></span></li>
              ))}
            </ol>
          </CxCard>
        </div>
        <CxCard id="all-requests" icon={<BarChart3 size={22} />} title={tx("Leadership overview")} sub={tx("All requests, including those handled locally.")}
          right={<Dropdown label={tx("Status")} value={filter} onChange={setFilter} allLabel={tx("All statuses")} options={[{ value: 'pending', label: tx("Under review") }, { value: 'approved', label: tx("Resolved") }, { value: 'rejected', label: tx("Rejected") }]} />}>
          <div className="cx-scroll">
            <table className="cx-table dk so-table">
              <thead><tr><th>{tx("Reference")}</th><th>{tx("Member")}</th><th>{tx("Category")}</th><th>{tx("Group")}</th><th>{tx("Date / time")}</th><th>{tx("Status")}</th><th>{tx("Manager action")}</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7}><span className="cx-empty"><Inbox size={36} /><b>{tx("No requests yet.")}</b></span></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><code className="so-ref">{r.id.slice(0, 8).toUpperCase()}</code></td>
                    <td><span className="who-cell"><Avatar name={names[r.userId] || '?'} photoUrl={profiles[r.userId]?.photoUrl} size={30} /><PersonLink userId={r.userId}><strong>{names[r.userId] || '…'}</strong></PersonLink></span></td>
                    <td>{r.category}<br /><small>{r.detail}</small>
                      {r.welfare?.categoryKey === 'financial_assistance' && <><br /><small>{tx("Collected")} {((r.welfare.collectedCents ?? 0) / 100).toFixed(2)} {tx("· spent")} {((r.welfare.spentCents ?? 0) / 100).toFixed(2)} {tx("· balance")} {(((r.welfare.collectedCents ?? 0) - (r.welfare.spentCents ?? 0)) / 100).toFixed(2)}{r.welfare.beneficiary ? ` · for ${r.welfare.beneficiary}` : ''}</small></>}
                      {(r.welfare?.report ?? []).slice(-3).map((e) => <small key={e.id} style={{ display: 'block' }}>• {ENTRY_KIND[e.kind] ?? e.kind}: {e.text} ({e.actorName})</small>)}</td>
                    <td>{r.groupId ? <Link href="/dashboard/groups" className="lnk">{byId[r.groupId]?.name ?? '—'}</Link> : '—'}</td>
                    <td>{r.whenMs ? new Date(r.whenMs).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : tx("Not specified")}</td>
                    <td><span className={`so-st${r.kind === 'welfare' ? (r.welfare?.status === 'escalated' ? ' red' : r.welfare?.status === 'closed' ? '' : ' amber') : r.status === 'pending' ? ' amber' : r.status === 'rejected' ? ' red' : ''}`}>{r.kind === 'welfare' ? WSTATUS[r.welfare!.status] : STATUS_LABEL[r.status]}</span></td>
                    <td>
                      {r.kind === 'welfare' ? (
                        r.welfare!.status === 'closed' ? tx("Decision recorded") : (
                          <div className="manager-controls">
                            <button type="button" className="cx-btn sm" onClick={() => setDialog({ id: r.id, categoryKey: r.welfare!.categoryKey })}>{tx("Log treatment")}</button>
                            {r.welfare!.status !== 'escalated' && <button type="button" className="cx-btn sm" onClick={() => welfareAction(r.id, { status: 'escalated' }, 'Escalated to the leadership')}>{tx("Escalate")}</button>}
                            <button type="button" className="cx-btn green sm" onClick={() => welfareAction(r.id, { status: 'closed' }, 'Request resolved')}>{tx("Resolve")}</button>
                          </div>
                        )
                      ) : r.status === 'pending' ? (
                        <div className="manager-controls">
                          <button type="button" className="cx-btn sm" disabled={busy} onClick={() => decide(r, 'rejected')}>{tx("Reject")}</button>
                          <button type="button" className="cx-btn green sm" disabled={busy} onClick={() => decide(r, 'approved')}>{tx("Approve")}</button>
                        </div>
                      ) : (
                        tx("Decision recorded")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CxCard>
      </section>
      {dialog && dialog !== 'new' && (
        <FormDialog
          title={tx("Log the treatment")}
          intro="Record calls, visits, kurel travel, attendance, support given, decisions or documents. For financial assistance, update the amounts collected and spent."
          submitLabel={tx("Save")}
          onClose={() => setDialog(null)}
          fields={[
            { name: 'kind', label: tx("Type"), type: 'select', required: true, options: Object.entries(ENTRY_KIND).map(([value, label]) => ({ value, label })) },
            { name: 'text', label: tx("Details"), type: 'textarea', required: true },
            ...(dialog.categoryKey === 'financial_assistance'
              ? [
                  { name: 'beneficiary', label: tx("Beneficiary") },
                  { name: 'collected', label: tx("Total collected so far"), type: 'number' as const, min: 0 },
                  { name: 'spent', label: tx("Total spent so far"), type: 'number' as const, min: 0 },
                ]
              : []),
          ]}
          onSubmit={(v) => updateWelfareRequest({ requestId: dialog.id, entryKind: v.kind, entryText: v.text, ...(v.beneficiary ? { beneficiary: v.beneficiary } : {}), ...(v.collected !== undefined && v.collected !== '' ? { collectedCents: Math.round(Number(v.collected) * 100) } : {}), ...(v.spent !== undefined && v.spent !== '' ? { spentCents: Math.round(Number(v.spent) * 100) } : {}) }).then(() => notify('Treatment recorded', 'success'))}
        />
      )}
    </div>
  );
}

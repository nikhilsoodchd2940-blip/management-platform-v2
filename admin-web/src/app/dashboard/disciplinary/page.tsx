'use client';

import { useHashScroll } from '@/lib/useHashScroll';
import '../../px/conseil-discipline.css';
import { useEffect, useState } from 'react';
import { collection, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { castDisciplinaryVote, requestDisciplinaryHearing, resolveDisciplinaryCase, saveDisciplinaryMinutes } from '@/lib/functions';
import { useAuth } from '@/context/AuthContext';
import { fmt } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import ManageToggle from '../../px/ManageToggle';
import DisciplinaryManage from './Manage';
import { tx, dateLocale } from '@/lib/i18n/tr';
import Dropdown from '@/components/Dropdown';
import { CxBanner, CxCard, CxStats } from '@/components/Cx';
import { ArrowRight, ArrowUp, Calendar, CheckCircle2, Download, FileText, FolderOpen, Gavel, Headphones, History, Layers, Lock, Minus, Plus, RefreshCw, Save, Scale, Search, UserRound, Users, Vote } from 'lucide-react';

type Status = 'open' | 'hearing_requested' | 'vote_required' | 'escalated' | 'resolved';
const QUORUM = 5;
interface Vote {
  voterName: string;
  decision: 'reinstate' | 'uphold';
}
interface HistoryEntry {
  action: string;
  actorName: string;
  note?: string;
  atMs: number;
}
interface CaseRow {
  id: string;
  memberId: string;
  memberName: string;
  groupId: string;
  reason: string;
  description: string;
  status: Status;
  votes: Vote[];
  resolution?: 'reinstated' | 'upheld';
  minutes?: string;
  source?: string;
  history: HistoryEntry[];
  openedMs: number;
}

const STATUS: Record<Status, string> = { open: 'Open', hearing_requested: 'Hearing requested', vote_required: 'Vote required', escalated: 'Escalated to national', resolved: 'Resolved' };
const ACTION: Record<string, string> = { opened: 'Case opened', hearing_requested: 'Hearing requested', vote_cast: 'Vote recorded', escalated: 'Escalated to the national direction', resolved: 'Case resolved', note: 'Note' };
const LIST_CAP = 300;

/** Disciplinary council — the approved layout on Firebase data. */
export default function DisciplinaryPage() {
  useHashScroll();
  const { user } = useAuth();
  const { byId, locationOf, countries } = useGroupHierarchy();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [zone, setZone] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [minutesDraft, setMinutesDraft] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [manageSignal, setManageSignal] = useState(0);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'disciplinaryCases'), orderBy('openedAt', 'desc'), fsLimit(LIST_CAP)), (snap) =>
      setCases(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            memberId: (x.memberId as string) ?? '',
            memberName: (x.memberName as string) ?? '',
            groupId: x.groupId as string,
            reason: (x.reason as string) ?? '',
            description: (x.description as string) ?? '',
            status: (x.status as Status) ?? 'open',
            votes: ((x.votes as Vote[]) ?? []),
            resolution: x.resolution as CaseRow['resolution'],
            minutes: (x.minutes as string) || undefined,
            source: x.source as string | undefined,
            history: ((x.history as { action: string; actorName: string; note?: string; at?: Timestamp }[]) ?? []).map((h) => ({ action: h.action, actorName: h.actorName, note: h.note, atMs: h.at?.toMillis?.() ?? 0 })),
            openedMs: (x.openedAt as Timestamp | undefined)?.toMillis?.() ?? 0,
          };
        })
      )
    );
  }, []);

  const rows = cases.filter((c) => (!state || c.status === state) && (!zone || locationOf(c.groupId).country?.id === zone) && (!reasonFilter || c.reason === reasonFilter) && (!search.trim() || `${c.memberName} ${c.memberId} ${c.reason} ${byId[c.groupId]?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const selected = rows.find((c) => c.id === selectedId) ?? rows[0];
  const open = cases.filter((c) => c.status !== 'resolved');
  const hearings = cases.filter((c) => c.status === 'hearing_requested');
  const voting = cases.filter((c) => c.status === 'vote_required' || c.status === 'escalated');
  const resolved = cases.filter((c) => c.status === 'resolved');
  const reinstate = selected?.votes.filter((v) => v.decision === 'reinstate').length ?? 0;
  const uphold = selected?.votes.filter((v) => v.decision === 'uphold').length ?? 0;
  const actor = user?.email ?? 'Admin';
  const when = (ms: number) => (ms ? new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportRegister() {
    const lines = [['Case', 'Member', 'Member ID', 'Kurel', 'Reason', 'Status'], ...rows.map((c) => [c.id, c.memberName, c.memberId, byId[c.groupId]?.name ?? '', c.reason, STATUS[c.status]])];
    const csv = lines.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'disciplinary-register.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="px px-conseil-discipline">
        <div className="content cx-page dc-page">
          <CxBanner icon={<Scale size={26} />} kicker="Direction Conservatoire" title={tx("Disciplinary Council")} sub={tx("Examine the facts, hear the member, vote and secure the decision until resolution.")}>
            <button type="button" className="cx-btn ghost-light" onClick={exportRegister}><Download size={16} />{tx("Export the register")}</button>
            <button type="button" className="cx-btn gold" onClick={() => setManageSignal((n) => n + 1)}><Plus size={18} />{tx("Open a case")}</button>
          </CxBanner>

          <section className="dc-circuit">
            <div className="dc-ch"><i><Scale size={28} /></i><div><h2>{tx("Controlled disciplinary circuit")}</h2><p>{tx("The member can consult the allegations, submit an explanation and ask to be heard. The decision follows the council’s vote.")}</p></div><div className="dc-tags"><span><Users size={14} />{tx("Majority required")}</span><span><History size={14} />{tx("Permanent history")}</span></div></div>
            <ol className="dc-steps">
              {[[<FileText size={26} key="a" />, '01', 'Report', 'Opening'], [<Users size={26} key="b" />, '02', 'Hearing', 'If requested'], [<Vote size={26} key="c" />, '03', 'Vote', 'Council'], [<Gavel size={26} key="d" />, '04', 'Decision', 'Reinstate or uphold']].map(([ic, n, t, sub]) => (
                <li key={n as string}><i>{ic}</i><span><small>{n}</small><strong>{tx(t as string)}</strong><em>{tx(sub as string)}</em></span></li>
              ))}
            </ol>
          </section>

          <CxStats items={[
            { label: tx("Open cases"), value: fmt(open.length), sub: tx("Not yet resolved"), icon: <FolderOpen size={24} />, tone: 'green' },
            { label: tx("Hearings requested"), value: fmt(hearings.length), sub: tx("To schedule"), icon: <Headphones size={24} />, tone: 'amber' },
            { label: tx("Votes in progress"), value: fmt(voting.length), sub: tx("Council"), icon: <Vote size={24} />, tone: 'blue' },
            { label: tx("Resolved"), value: fmt(resolved.length), sub: tx("Closed cases"), icon: <CheckCircle2 size={24} />, tone: 'violet' },
          ]} />

          <section className="cx-filters">
            <label className="cx-search"><Search size={18} /><input type="search" placeholder={tx("Case, member, member ID or kurel")} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <Dropdown label={tx("Zone")} value={zone} onChange={setZone} allLabel={tx("All zones")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("Status")} value={state} onChange={setState} allLabel={tx("All statuses")} options={(Object.keys(STATUS) as Status[]).map((st) => ({ value: st, label: STATUS[st] }))} />
            <Dropdown label={tx("Reason")} value={reasonFilter} onChange={setReasonFilter} allLabel={tx("All reasons")} options={[...new Set(cases.map((c) => c.reason).filter(Boolean))].map((r) => ({ value: r, label: r }))} />
          </section>

          <div className="cx-grid cx-g12 dc-work">
            <CxCard id="cases" icon={<Layers size={22} />} title={tx("Case queue")} sub={`${rows.length} ${rows.length === 1 ? tx("case") : tx("cases")} ${tx("shown")}`} right={<span className="cx-pill red">{open.length} {tx("open")}</span>}>
              <div className="dc-cases">
                {rows.map((c, i) => (
                  <button type="button" key={c.id} className={`dc-case${selected?.id === c.id ? ' on' : ''}`} onClick={() => setSelectedId(c.id)}>
                    <b>{String(rows.length - i).padStart(3, '0')}</b>
                    <span><strong>{c.memberName}{c.memberId ? ` · ${c.memberId}` : ''}</strong><small>{byId[c.groupId]?.name ?? ''} · {c.reason}</small></span>
                    <em><span className={`cx-pill ${c.status === 'resolved' ? 'green' : c.status === 'vote_required' || c.status === 'escalated' ? 'blue' : 'amber'}`}>{STATUS[c.status]}</span><small>{c.openedMs ? new Date(c.openedMs).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : ''}</small></em>
                  </button>
                ))}
                {rows.length === 0 && <div className="cx-empty"><b>{cases.length === 0 ? tx("No cases yet.") : tx("No case matches the filters.")}</b></div>}
              </div>
            </CxCard>

            <article className="cx-card dc-detail">
              {selected ? (
                <>
                  <header>
                    <i><UserRound size={24} /></i>
                    <div><p>{tx("Case ·")} {STATUS[selected.status]}{selected.source === 'attendance' ? tx(" · opened automatically (left after excessive lateness)") : ''}</p><h2>{selected.memberName}</h2><p>{selected.memberId || '—'} · {byId[selected.groupId]?.name ?? ''} · {[locationOf(selected.groupId).city?.name, locationOf(selected.groupId).country?.name].filter(Boolean).join(' · ')}</p></div>
                    <div className="cx-hr"><span className={`cx-pill ${selected.status === 'resolved' ? 'green' : 'red'}`}>{selected.status === 'resolved' ? (selected.resolution === 'reinstated' ? tx("Reinstated") : tx("Decision upheld")) : <><Lock size={13} />{tx("Reinstatement blocked")}</>}</span></div>
                  </header>
                  <div className="cx-cb">
                    <div className="dc-facts"><FileText size={18} /><span><b>{tx("Reported facts:")}</b> {selected.reason}{selected.description ? ` — ${selected.description}` : ''}</span></div>
                    <section className="dc-vote">
                      <div className="dc-vh"><i><Users size={22} /></i><div><h3>{tx("Council vote")}</h3><p>{selected.votes.length} {tx("of")} {QUORUM} {tx("votes needed (quorum). Majority decides, no veto; a tie goes to the national direction.")}</p></div><span className="cx-pill amber">{STATUS[selected.status]}</span></div>
                      <div className="dc-vg">
                        <div><ArrowUp size={20} /><span><small>{tx("Uphold the measure")}</small><b>{uphold} {uphold === 1 ? tx("vote") : tx("votes")}</b></span></div>
                        <div><RefreshCw size={20} /><span><small>{tx("Reinstate")}</small><b>{reinstate} {reinstate === 1 ? tx("vote") : tx("votes")}</b></span></div>
                        <div className="none"><Minus size={20} /><span><small>{tx("No vote yet")}</small><b>{selected.votes.length === 0 ? '—' : selected.votes.map((v) => v.voterName).join(', ')}</b></span></div>
                      </div>
                      {selected.status !== 'resolved' && selected.status !== 'escalated' && (
                        <div className="dc-va">
                          <button type="button" className="cx-btn" disabled={busy} onClick={() => act(() => requestDisciplinaryHearing({ caseId: selected.id, actorName: actor }))}><Headphones size={16} />{tx("Request a hearing")}</button>
                          <button type="button" className="cx-btn green" disabled={busy} onClick={() => act(() => castDisciplinaryVote({ caseId: selected.id, decision: 'reinstate', voterName: actor }))}><Gavel size={16} />{tx("Vote: reinstate")}</button>
                          <button type="button" className="cx-btn green" disabled={busy} onClick={() => act(() => castDisciplinaryVote({ caseId: selected.id, decision: 'uphold', voterName: actor }))}><Gavel size={16} />{tx("Vote: uphold")}</button>
                        </div>
                      )}
                    </section>
                    {selected.status === 'escalated' && (
                      <section className="dc-vote">
                        <div className="dc-vh"><i><ArrowUp size={22} /></i><div><h3>{tx("National direction decision")}</h3><p>{tx("The first vote ended in a tie. Only a senior administrator can decide.")}</p></div><span className="cx-pill red">{tx("Escalated")}</span></div>
                        <div className="dc-va">
                          <button type="button" className="cx-btn green" disabled={busy} onClick={() => act(() => resolveDisciplinaryCase({ caseId: selected.id, resolution: 'reinstated', actorName: actor }))}>{tx("Decide: reinstate")}</button>
                          <button type="button" className="cx-btn" disabled={busy} onClick={() => act(() => resolveDisciplinaryCase({ caseId: selected.id, resolution: 'upheld', actorName: actor }))}>{tx("Decide: uphold")}</button>
                        </div>
                      </section>
                    )}
                    <section className="dc-min">
                      <div className="dc-vh"><i><FileText size={22} /></i><div><h3>{tx("Minutes")}</h3><p>{selected.minutes ? tx("Recorded minutes of the hearing and deliberation.") : tx("Write the minutes of the hearing and deliberation.")}</p></div></div>
                      {selected.minutes && <p style={{ whiteSpace: 'pre-wrap' }}>{selected.minutes}</p>}
                      {selected.status !== 'resolved' && (
                        <>
                          <textarea aria-label={tx("Minutes")} rows={3} value={minutesDraft} onChange={(e) => setMinutesDraft(e.target.value)} placeholder={tx("Minutes of the session…")} />
                          <div><button type="button" className="cx-btn" disabled={busy || !minutesDraft.trim()} onClick={() => act(async () => { await saveDisciplinaryMinutes({ caseId: selected.id, minutes: minutesDraft }); setMinutesDraft(''); })}><Save size={16} />{tx("Save the minutes")}</button></div>
                        </>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <div className="cx-cb"><div className="cx-empty"><b>{tx("No case to show.")}</b></div></div>
              )}
            </article>
          </div>

          <CxCard icon={<History size={22} />} title={tx("Full case history")} sub={tx("Facts, hearings, votes and decisions stay recorded.")}>
            <div className="dc-tl">
              {(!selected || selected.history.length === 0) && <div className="dc-hi"><span>{tx("No history.")}</span></div>}
              {selected?.history.map((h, i) => (
                <div className="dc-hi" key={i}><Calendar size={18} /><span><time>{when(h.atMs)}</time><strong>{ACTION[h.action] ?? h.action}</strong><small>{h.actorName}{h.note ? ` — ${h.note}` : ''}</small></span></div>
              ))}
            </div>
          </CxCard>

          <button type="button" className="dc-manage" onClick={() => setManageSignal((n) => n + 1)}><FolderOpen size={20} /><b>{tx("Manage cases — open and review")}</b><ArrowRight size={20} /></button>
        </div>
      </div>

      <ManageToggle title={tx("Manage cases — open and review")} openSignal={manageSignal}>
        <DisciplinaryManage />
      </ManageToggle>
    </>
  );
}

'use client';

import '../../px/index.css';
import '../../px/finance.css';
import CommandHero from '@/components/CommandHero';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, getAggregateFromServer, limit as fsLimit, orderBy, query, sum, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { reviewContribution, updateFinancialProgram } from '@/lib/functions';
import { useCollection } from '@/lib/useCollection';
import { fmt } from '@/lib/liveStats';
import { formatMoney } from '@/lib/money';
import { money as fmtMoney, phaseProgress, frDate, type Currency, type Phase } from '@/lib/finance';
import PayIcon from './PayIcon';
import ProgramForm from './ProgramForm';
import Dropdown from '@/components/Dropdown';
import { AllocateModal, SplitModal, Shell } from './AllocDialogs';
import FlowDetails from './FlowDetails';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import ManageToggle from '../../px/ManageToggle';
import FinanceManage from './Manage';
import { CxBanner } from '@/components/Cx';
import { Wallet } from 'lucide-react';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Method = 'wave' | 'orange_money' | 'cash';
interface Program {
  id: string;
  name: string;
  goalAmountCents: number;
  status: 'open' | 'closed';
  scopeAllGroups: boolean;
  groupIds: string[];
  description: string;
  recurrence?: 'monthly' | 'quarterly' | 'yearly';
  cycle?: number;
  currency: Currency;
  startMs: number;
  endMs: number;
  phases: Phase[];
}
interface Contribution {
  id: string;
  programId: string;
  groupId: string;
  userId?: string;
  userName: string;
  method: Method;
  amountCents: number;
  proofUrl?: string;
  status: 'pending_review' | 'validated' | 'rejected';
  createdMs: number;
}

const METHOD: Record<Method, string> = { wave: 'Wave', orange_money: 'Orange Money', cash: 'Cash' };
const STATUS: Record<Contribution['status'], string> = { validated: 'Validated', pending_review: 'To review', rejected: 'Rejected' };

/** Financial programs — the approved layout on Firebase data. */
export default function FinancePage() {
  const { byId, locationOf, activeLeafGroups } = useGroupHierarchy();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [progFilter, setProgFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [progSearch, setProgSearch] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [stripeTotal, setStripeTotal] = useState<number | null>(null);
  const [manageSignal] = useState(0);
  const [dialog, setDialog] = useState<null | 'allocate' | 'shares' | 'create' | 'edit'>(null);
  const [flowStep, setFlowStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [groupBy, setGroupBy] = useState<'kurel' | 'city' | 'country'>('kurel');
  const [cmpSort, setCmpSort] = useState<'rank' | 'low' | 'paid' | 'name'>('rank');
  const [cmpShow, setCmpShow] = useState('');
  const [cmpQ, setCmpQ] = useState('');
  const [cmpOpen, setCmpOpen] = useState<string | null>(null);
  const [scope, setScope] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'financialPrograms'), orderBy('createdAt', 'desc')), (snap) =>
      setPrograms(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? '',
          goalAmountCents: Number(d.data().goalAmountCents) || 0,
          status: (d.data().status as 'open' | 'closed') ?? 'open',
          scopeAllGroups: d.data().scopeAllGroups === true,
          groupIds: (d.data().groupIds as string[]) ?? [],
          description: (d.data().description as string) ?? '',
          recurrence: d.data().recurrence as Program['recurrence'],
          cycle: Number(d.data().cycle) || undefined,
          currency: ((d.data().currency as Currency) ?? 'XOF'),
          startMs: (d.data().startAt as Timestamp | undefined)?.toMillis?.() ?? 0,
          endMs: (d.data().deadline as Timestamp | undefined)?.toMillis?.() ?? 0,
          phases: ((d.data().phases as { name: string; amountCents: number; startAt?: Timestamp; endAt?: Timestamp }[]) ?? []).map((x) => ({ name: x.name, amountCents: Number(x.amountCents) || 0, startMs: x.startAt?.toMillis?.(), endMs: x.endAt?.toMillis?.() })),
        }))
      )
    );
    const u2 = onSnapshot(query(collection(db, 'contributions'), orderBy('createdAt', 'desc'), fsLimit(500)), (snap) =>
      setContribs(
        snap.docs.map((d) => ({
          id: d.id,
          programId: d.data().programId as string,
          groupId: d.data().groupId as string,
          userId: d.data().userId as string | undefined,
          userName: (d.data().userName as string) ?? '',
          method: d.data().method as Method,
          amountCents: Number(d.data().amountCents) || 0,
          proofUrl: d.data().proofUrl as string | undefined,
          status: d.data().status as Contribution['status'],
          createdMs: (d.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0,
        }))
      )
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    getAggregateFromServer(query(collection(db, 'donations'), where('status', '==', 'succeeded')), { total: sum('amountCents') })
      .then((r) => setStripeTotal(r.data().total as number))
      .catch(() => setStripeTotal(null));
  }, []);

  const visible = programs.filter((p) => (progFilter === 'all' || p.status === progFilter) && (!progSearch.trim() || p.name.toLowerCase().includes(progSearch.trim().toLowerCase())));
  const program = programs.find((p) => p.id === selectedId) ?? visible[0] ?? programs[0];
  const allocRaw = useCollection<{ programId: string; groupId: string; amountCents: number; collectorName?: string; collectorPhone?: string }>('programAllocations', [where('programId', '==', program?.id ?? '__none__')], program?.id ?? '');
  const allocs = useMemo(() => allocRaw ?? [], [allocRaw]);
  const allocByGroup = useMemo(() => Object.fromEntries(allocs.map((a) => [a.groupId, a])), [allocs]);
  const allocated = allocs.reduce((n, a) => n + a.amountCents, 0);
  const sharesRaw = useCollection<{ groupId: string; userId: string; amountCents: number }>('memberShares', [where('programId', '==', program?.id ?? '__none__')], program?.id ?? '');
  const sharesTotal = (sharesRaw ?? []).reduce((n, a) => n + a.amountCents, 0);
  const mine = useMemo(() => contribs.filter((c) => c.programId === program?.id), [contribs, program]);
  const validated = mine.filter((c) => c.status === 'validated');
  const paid = validated.reduce((n, c) => n + c.amountCents, 0);
  const review = mine.filter((c) => c.status === 'pending_review');
  const reviewAmount = review.reduce((n, c) => n + c.amountCents, 0);
  const rate = program && program.goalAmountCents ? Math.round((paid / program.goalAmountCents) * 100) : 0;
  const remaining = program ? Math.max(0, program.goalAmountCents - paid) : 0;
  const cur: Currency = program?.currency ?? 'XOF';
  const money = (c: number) => fmtMoney(c, cur);
  const pp = phaseProgress(program?.goalAmountCents ?? 0, program?.phases, paid);
  const nowMs = Date.now();
  const daysLeft = program?.endMs ? Math.ceil((program.endMs - nowMs) / 86400000) : null;
  const dateOf = frDate;

  const byMethod = (m: Method) => validated.filter((c) => c.method === m).reduce((n, c) => n + c.amountCents, 0);
  const rows = mine.filter((c) => {
    if (method && c.method !== method) return false;
    if (status && c.status !== status) return false;
    if (scope && locationOf(c.groupId).country?.id !== scope) return false;
    const term = search.trim().toLowerCase();
    return !term || `${c.userName} ${byId[c.groupId]?.name ?? ''}`.toLowerCase().includes(term);
  });
  const kurelBars = useMemo(() => {
    const keyOf = (groupId: string) => {
      if (groupBy === 'kurel') return { id: groupId, name: byId[groupId]?.name ?? groupId };
      const loc = locationOf(groupId);
      const n = groupBy === 'city' ? loc.city : loc.country;
      return { id: n?.id ?? '?', name: n?.name ?? 'Unknown' };
    };
    const m = new Map<string, { name: string; v: number; target: number; ids: string[]; sub: string }>();
    const sub = (gid: string) => { const l = locationOf(gid); return groupBy === 'kurel' ? [l.city?.name, l.country?.name].filter(Boolean).join(' · ') : groupBy === 'city' ? (l.country?.name ?? '') : ''; };
    validated.forEach((c) => {
      const k = keyOf(c.groupId);
      const o = m.get(k.id); m.set(k.id, { name: k.name, v: (o?.v ?? 0) + c.amountCents, target: o?.target ?? 0, ids: [...new Set([...(o?.ids ?? []), c.groupId])], sub: sub(c.groupId) });
    });
    allocs.forEach((a) => {
      const k = keyOf(a.groupId);
      const cur = m.get(k.id) ?? { name: k.name, v: 0, target: 0, ids: [], sub: sub(a.groupId) };
      m.set(k.id, { ...cur, target: cur.target + a.amountCents, ids: [...new Set([...cur.ids, a.groupId])] });
    });
    const all = [...m.entries()].map(([g, x]) => ({ g, name: x.name, v: x.v, target: x.target, ids: x.ids, sub: x.sub, ratio: x.target ? x.v / x.target : -1 }));
    all.sort((a, b) => b.ratio - a.ratio || b.v - a.v || a.name.localeCompare(b.name));
    return all.map((x, i) => ({ ...x, rank: i + 1, pct: x.ratio < 0 ? 0 : Math.min(100, Math.round(x.ratio * 100)) }));
  }, [validated, allocs, groupBy, byId, locationOf]);

  async function decide(id: string, decision: 'validate' | 'reject') {
    try {
      await reviewContribution({ contributionId: id, decision });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not review this contribution', 'error');
    }
  }

  function exportRegister() {
    const lines = [['Member', 'Kurel', 'Method', 'Amount', 'Status'], ...rows.map((c) => [c.userName, byId[c.groupId]?.name ?? '', METHOD[c.method] ?? c.method, (c.amountCents / 100).toFixed(2), STATUS[c.status]])];
    const csv = lines.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contributions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }


  return (
    <>
      <div className="px px-index fn-top"><section className="view active"><CommandHero title={tx("Finance command center")} subtitle={tx("Programs, collections and contributions across the Conservatory.")} /></section></div>
      <div className="px px-finance">
        <div className="content">
          <CxBanner icon={<Wallet size={26} />} kicker={tx("Finance")} title={tx("Financial programs")} sub={tx("Create a program, allocate it, follow every contribution until its validation.")}>
            <button type="button" className="cx-btn ghost-light" onClick={() => document.getElementById('register')?.scrollIntoView({ behavior: 'smooth' })}>{tx("Detailed report")}</button>
            <Link href="/dashboard/donations/collection" className="cx-btn ghost-light">{tx("Collection plan ›")}</Link>
            <button type="button" className="cx-btn gold" onClick={() => setDialog('create')}>{tx("+ Create a program")}</button>
          </CxBanner>

          <section className="fn-plist">
            <header>
              <div className="fn-seg" role="tablist" aria-label={tx("Programs")}>
                {([['open', 'Open'], ['closed', 'Closed'], ['all', 'All']] as const).map(([k, l]) => (
                  <button type="button" role="tab" aria-selected={progFilter === k} key={k} className={progFilter === k ? 'on' : ''} onClick={() => { setProgFilter(k); setSelectedId(''); }}>{l}<b>{k === 'all' ? programs.length : programs.filter((p) => p.status === k).length}</b></button>
                ))}
              </div>
              <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Program name")} value={progSearch} onChange={(e) => setProgSearch(e.target.value)} /></label>
            </header>
            <div className="fn-progs">
              {visible.length === 0 && <p className="fn-cmp-none">{programs.length === 0 ? tx("No program yet. Create the first one with the button above.") : tx("No program matches this filter.")}</p>}
              {visible.map((p) => {
                const paidP = contribs.filter((c) => c.programId === p.id && c.status === 'validated').reduce((n, c) => n + c.amountCents, 0);
                const r = p.goalAmountCents ? Math.round((paidP / p.goalAmountCents) * 100) : 0;
                const ph = phaseProgress(p.goalAmountCents, p.phases, paidP);
                return (
                  <button type="button" key={p.id} className={`fn-prog${program?.id === p.id ? ' on' : ''}${p.status === 'closed' ? ' off' : ''}`} onClick={() => setSelectedId(p.id)}>
                    <span className="fn-prog-top"><strong>{p.name}</strong><em>{p.status === 'open' ? tx("Open") : tx("Closed")}</em></span>
                    <span className="fn-prog-amt"><b>{fmtMoney(paidP, p.currency)}</b> {tx("of")} {fmtMoney(p.goalAmountCents, p.currency)}<i>{r}%</i></span>
                    <span className="fn-bar"><i style={{ width: `${Math.min(100, r)}%` }} /></span>
                    <small>{ph.hasPhases ? `Phase ${ph.current.i} of ${ph.rows.length}` : tx("Single collection")} · {p.scopeAllGroups ? tx("All kurels") : `${p.groupIds.length} kurels`}{p.endMs ? ` · until ${frDate(p.endMs)}` : ''}</small>
                  </button>
                );
              })}
            </div>
          </section>

          {program && (
            <section className="fn-hero">
              <div className="fn-hero-top">
                <div>
                  <h2>{program.name}{program.recurrence && <em className="cm-rec">{{ monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }[program.recurrence]} {tx("· period")} {program.cycle ?? 1}</em>}</h2>
                  <p>{program.description || tx("No description yet.")}</p>
                  <div className="fn-hero-act">
                    <button type="button" onClick={() => setDialog('edit')}>{tx("Edit the program")}</button>
                    <button type="button" onClick={() => updateFinancialProgram({ programId: program.id, status: program.status === 'open' ? 'closed' : 'open' }).then(() => notify(program.status === 'open' ? 'Program closed' : 'Program reopened', 'success')).catch((e: Error) => notify(e.message, 'error'))}>{program.status === 'open' ? tx("Close the program") : tx("Reopen the program")}</button>
                  </div>
                </div>
                <div className="fn-chips">
                  <span>{program.currency}</span>
                  <span>{program.scopeAllGroups ? tx("All kurels") : `${program.groupIds.length} kurels`}</span>
                  <span>{program.startMs ? `From ${dateOf(program.startMs)}` : tx("No start date")}</span>
                  <span>{program.endMs ? `Until ${dateOf(program.endMs)}${daysLeft !== null ? (daysLeft >= 0 ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ' · ended') : ''}` : tx("No end date")}</span>
                  <span className={program.status === 'open' ? 'ok' : ''}>{program.status === 'open' ? tx("Collection open") : tx("Closed")}</span>
                </div>
              </div>
              <div className="fn-metrics">
                <div className="g"><small>{tx("Total to collect")}</small><strong>{money(program.goalAmountCents)}</strong><span>{pp.hasPhases ? `${pp.rows.length} phases planned` : tx("One collection")}</span></div>
                <div className="b"><small>{tx("Collected")}</small><strong>{money(paid)}</strong><span>{rate}{tx("% of the total")}</span></div>
                <div className="y"><small>{pp.hasPhases ? `${pp.current.name} still to collect` : tx("Still to collect")}</small><strong>{money(pp.hasPhases ? Math.max(0, pp.current.target - pp.current.got) : remaining)}</strong><span>{pp.hasPhases ? (pp.current.endMs ? `until ${dateOf(pp.current.endMs)}` : tx("no end date")) : `${money(allocated)} allocated`}</span></div>
                <div className="p"><small>{tx("Contributors")}</small><strong>{fmt(new Set(validated.map((c) => c.userName)).size)}</strong><span>{tx("validated payments")}</span></div>
                <div className="r"><small>{tx("Proofs to check")}</small><strong>{fmt(review.length)}</strong><span>{money(reviewAmount)} {tx("waiting")}</span></div>
              </div>
              <div className="fn-phases">
                <div className="fn-phases-head"><b>{pp.hasPhases ? tx("Phases") : tx("Collection")}</b><button type="button" onClick={() => setDialog('edit')}>{pp.hasPhases ? tx("Edit the phases") : tx("Split into phases")}</button></div>
                <div className="fn-phase-row">
                  {pp.rows.map((r) => (
                    <div key={r.i} className={`fn-phase${r.done ? ' done' : !r.open ? ' lock' : r.i === pp.current.i ? ' now' : ''}`}>
                      <span><b>{pp.hasPhases ? r.name : tx("Whole goal")}</b><em>{r.done ? tx("Complete") : !r.open ? tx("Opens after the previous phase") : pp.hasPhases ? tx("Now") : tx("In progress")}</em></span>
                      <strong>{money(r.got)} <small>{tx("of")} {money(r.target)}</small></strong>
                      <span className="fn-bar"><i style={{ width: `${r.target ? Math.round((r.got / r.target) * 100) : 0}%` }} /></span>
                      {pp.hasPhases && <small className="fn-phase-dates">{r.startMs || r.endMs ? `${r.startMs ? dateOf(r.startMs) : '…'} → ${r.endMs ? dateOf(r.endMs) : '…'}` : tx("No dates")}</small>}
                    </div>
                  ))}
                  {pp.hasPhases && pp.unplanned > 0 && <div className="fn-phase later"><span><b>{tx("Not planned yet")}</b><em>{tx("Later")}</em></span><strong>{money(pp.unplanned)} <small>{tx("left for next phases")}</small></strong><span className="fn-bar"><i style={{ width: '0%' }} /></span></div>}
                </div>
              </div>
            </section>
          )}

          <section className="fn-flow">
            <header>
              <div><h2>{tx("Where the money stands")}</h2><p>{tx("Figures for the program chosen here. Change the program to see its own figures.")}</p></div>
              <div className="fn-flow-act"><Dropdown label={tx("Program")} value={program?.id ?? ''} onChange={(v) => { setSelectedId(v); const pr = programs.find((x) => x.id === v); if (pr && progFilter !== 'all' && pr.status !== progFilter) setProgFilter('all'); }} options={programs.map((x) => ({ value: x.id, label: x.recurrence ? `${x.name} · period ${x.cycle ?? 1}` : x.name, hint: x.status === 'open' ? tx("Open") : tx("Closed") }))} /><button type="button" disabled={!program || program.status !== 'open'} onClick={() => setDialog('allocate')}>{tx("Allocate the envelope")}</button><button type="button" disabled={!program || program.status !== 'open'} onClick={() => setDialog('shares')}>{tx("Split among members")}</button></div>
            </header>
            {program && <div className="fn-flow-prog"><span>{tx("Program")}</span><b>{program.name}</b><em className={program.status === 'open' ? 'ok' : ''}>{program.status === 'open' ? tx("Open") : tx("Closed")}</em><small>{program.currency}</small></div>}
            {program && (() => {
              const goal = program.goalAmountCents;
              const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 1000) / 10) : 0);
              const members = (sharesRaw ?? []).length;
              const steps = [
                { n: 1, title: tx("Total to collect"), big: money(goal), line: `The amount to collect. ${program.scopeAllGroups ? 'All kurels take part' : `${program.groupIds.length} kurel${program.groupIds.length === 1 ? ' takes' : 's take'} part`}.`, bar: 100, note: pp.hasPhases ? `${pp.rows.length} phases · phase ${pp.current.i} is ${money(pp.current.target)}` : 'Collected in one go' },
                { n: 2, title: tx("Targets for kurels"), big: money(allocated), line: allocs.length === 0 ? `${program.scopeAllGroups ? 'The kurels take' : `The ${program.groupIds.length} kurel${program.groupIds.length === 1 ? ' takes' : 's take'}`} part, but none has its share of the total yet. Press “Allocate the envelope” to set each kurel's target.` : `${allocs.length} kurel${allocs.length === 1 ? ' has' : 's have'} a target, their share of the total to collect.`, bar: pct(allocated, goal), note: `${pct(allocated, goal)}% of the total has a target · ${money(Math.max(0, goal - allocated))} not assigned yet` },
                { n: 3, title: tx("Shared among members"), big: money(sharesTotal), line: members === 0 ? 'No kurel leader has split its target among members yet.' : `${members} member${members === 1 ? ' has' : 's have'} an amount to pay, set by their kurel leader.`, bar: pct(sharesTotal, allocated), note: `${pct(sharesTotal, allocated)}% of the kurel targets · ${money(Math.max(0, allocated - sharesTotal))} not shared yet` },
                { n: 4, title: tx("Paid so far"), big: money(paid), line: `${new Set(validated.map((c) => c.userName)).size} member${new Set(validated.map((c) => c.userName)).size === 1 ? ' has' : 's have'} paid, with the proof checked.`, bar: pct(paid, goal), note: `${pct(paid, goal)}% of the total · ${money(remaining)} still to collect` },
              ];
              return (
                <div className="fn-steps">
                  {steps.map((st) => (
                    <button type="button" key={st.n} onClick={() => setFlowStep(st.n as 1 | 2 | 3 | 4)} title={tx("Click to see the details")}>
                      <span className="fn-step-top"><b>{st.n}</b><strong>{st.title}</strong><i aria-hidden>{tx("See the list ›")}</i></span>
                      <em>{st.big}</em>
                      <span className="fn-bar"><i style={{ width: `${st.bar}%` }} /></span>
                      <p>{st.line}</p>
                      <small>{st.note}</small>
                    </button>
                  ))}
                </div>
              );
            })()}
          </section>

          <div className="fn-grid">
            <section className="fn-card">
              <header><div><h2>{tx("Collection status")}</h2><p>{tx("How much of the total has come in")}</p></div><span className="fn-pill">{rate}%</span></header>
              {(() => {
                const g = Math.max(1, program?.goalAmountCents ?? 0);
                const v = Math.min(100, (paid / g) * 100);
                const r = Math.min(100 - v, (reviewAmount / g) * 100);
                const tiles: [string, string, string, string, number, ReactNode][] = [
                  ['g', 'Validated', money(paid), `${validated.length} payment${validated.length === 1 ? '' : 's'}`, (paid / g) * 100, <svg key="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.500 4.500L19 7.500" /></svg>],
                  ['y', 'In review', money(reviewAmount), `${mine.filter((c) => c.status === 'pending_review').length} waiting`, (reviewAmount / g) * 100, <svg key="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 7.500V12l3 2" /></svg>],
                  ['n', 'To collect', money(remaining), `of ${money(program?.goalAmountCents ?? 0)}`, (remaining / g) * 100, <svg key="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>],
                  ['b', 'In cash', money(byMethod('cash')), `${validated.filter((c) => c.method === 'cash').length} payment${validated.filter((c) => c.method === 'cash').length === 1 ? '' : 's'}`, (byMethod('cash') / g) * 100, <svg key="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>],
                ];
                return (
                  <div className="cs">
                    <div className="cs-ring" style={{ background: `conic-gradient(#1f9d63 0 ${v}%, #f0b429 ${v}% ${v + r}%, #e4ece8 ${v + r}% 100%)` }}><div><strong>{rate}%</strong><span>{tx("collected")}</span><small>{tx("of")} {money(program?.goalAmountCents ?? 0)}</small></div></div>
                    <div className="cs-tiles">
                      {tiles.map(([t, l, amt, sub, pc, ic]) => (
                        <div key={l} className={`cs-t ${t}`}>
                          <span className="cs-ic">{ic}</span>
                          <small>{l}</small>
                          <b>{amt}</b>
                          <em>{sub}</em>
                          {<span className="cs-bar"><i style={{ width: `${Math.min(100, pc)}%` }} /></span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <footer><span><b>{validated.length}</b> {tx("validated")}</span><span><b>{mine.length}</b> {tx("payments in all")}</span></footer>
            </section>
            <section className="fn-card">
              <header><div><h2>{tx("Payment channels")}</h2><p>{tx("Validated amount per way of paying")}</p></div></header>
              <ul className="fn-ch">
                {(['wave', 'orange_money', 'cash'] as Method[]).map((m) => {
                  const v = byMethod(m);
                  const n = mine.filter((c) => c.method === m && c.status === 'validated').length;
                  const share = paid ? Math.round((v / paid) * 100) : 0;
                  return (
                    <li key={m}>
                      <PayIcon kind={m} size={42} />
                      <span><b>{METHOD[m]}</b><small>{n} {tx("payment")}{n === 1 ? '' : 's'} · {share}{tx("% of what is collected")}</small><span className="fn-bar"><i style={{ width: `${share}%`, background: m === 'wave' ? '#1dc8f1' : m === 'orange_money' ? '#ff7900' : '#1f9d63' }} /></span></span>
                      <strong>{money(v)}</strong>
                    </li>
                  );
                })}
              </ul>
              <footer><span><b>{review.length}</b> {tx("waiting for a check")}</span><span><b>{mine.filter((c) => c.status === 'rejected').length}</b> {tx("rejected")}</span></footer>
            </section>
            <section className="fn-card">
              <header><div><h2>{tx("Proofs to check")}</h2><p>{tx("Validate or reject right here")}</p></div><span className="fn-pill warn">{review.length}</span></header>
              <ul className="fn-list2">
                {review.map((c) => (
                  <li key={c.id}><PayIcon kind={c.method} size={30} /><span><b>{c.userName || '—'}</b><small>{byId[c.groupId]?.name ?? ''} · {money(c.amountCents)}</small></span>
                    <span>{c.proofUrl && <a href={c.proofUrl} target="_blank" rel="noreferrer">{tx("Proof")}</a>}<button type="button" onClick={() => decide(c.id, 'validate')}>{tx("Validate")}</button><button type="button" className="no" onClick={() => decide(c.id, 'reject')}>{tx("Reject")}</button></span></li>
                ))}
                {review.length === 0 && <li className="fn-clear"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.500l4.500 4.500L19 7.500" /></svg><span>{tx("Nothing waits for a check.")}</span></li>}
              </ul>
              <footer><span><b>{money(reviewAmount)}</b> {tx("waiting")}</span><span><b>{validated.length}</b> {tx("done")}</span></footer>
            </section>
          </div>

          <section className="fn-cmp">
            <header>
              <div><h2>{tx("Comparative progress")}</h2><p>{tx("What each")} {groupBy} {tx("has paid, against what it was given. Rank 1 is the highest progress.")}</p></div>
            </header>
            <div className="fn-cmp-filters">
              <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Name")} value={cmpQ} onChange={(e) => setCmpQ(e.target.value)} /></label>
              <Dropdown label={tx("Group by")} value={groupBy} onChange={(v) => setGroupBy(v as 'kurel' | 'city' | 'country')} options={[{ value: 'kurel', label: tx("By kurel") }, { value: 'city', label: tx("By city") }, { value: 'country', label: tx("By country") }]} />
              <Dropdown label={tx("Sort")} value={cmpSort} onChange={(v) => setCmpSort(v as 'rank' | 'low' | 'paid' | 'name')} options={[{ value: 'rank', label: tx("By rank — best first") }, { value: 'low', label: tx("By percentage — lowest first") }, { value: 'paid', label: tx("By amount paid") }, { value: 'name', label: tx("By name A–Z") }]} />
            </div>
            {(() => {
              const t = cmpQ.trim().toLowerCase();
              const cat = (x: { ratio: number }) => (x.ratio < 0 ? 'none' : x.ratio >= 1 ? 'done' : x.ratio > 0 ? 'going' : 'zero');
              const base = kurelBars.filter((x) => !t || x.name.toLowerCase().includes(t));
              const count = (k: string) => base.filter((x) => cat(x) === k).length;
              const list = base
                .filter((x) => !cmpShow || cat(x) === cmpShow)
                .sort((a, b) => (cmpSort === 'rank' ? a.rank - b.rank : cmpSort === 'low' ? (a.ratio < 0 ? 1 : b.ratio < 0 ? -1 : a.ratio - b.ratio) || a.rank - b.rank : cmpSort === 'paid' ? b.v - a.v : a.name.localeCompare(b.name)));
              const chips: [string, string, number][] = [['', 'All', base.length], ['done', 'Completed', count('done')], ['going', 'In progress', count('going')], ['zero', 'Nothing paid', count('zero')], ['none', 'No allocation', count('none')]];
              const open = kurelBars.find((x) => x.g === cmpOpen);
              const pays = open ? validated.filter((c) => open.ids.includes(c.groupId)).sort((a, b) => b.createdMs - a.createdMs) : [];
              const label = (x: { ratio: number }) => ({ done: 'Completed', going: 'In progress', zero: 'Nothing paid', none: 'No allocation' })[cat(x)];
              return (
                <>
                  <div className="cm-chips">{chips.map(([k, l, n]) => <button type="button" key={k} className={`cm-chip${cmpShow === k ? ' on' : ''}`} onClick={() => setCmpShow(k)}>{l}<b>{n}</b></button>)}</div>
                  <div className="cm-list">
                    {list.map((x) => (
                      <button type="button" className="cm-row" key={x.g} onClick={() => setCmpOpen(x.g)}>
                        <i className={`cm-rk${x.rank <= 3 ? ` r${x.rank}` : ''}`}>{x.rank}</i>
                        <span className="cm-name">{x.name}{x.sub && <small>{x.sub}</small>}</span>
                        <span className={`cm-pill ${cat(x)}`}>{x.target ? `${x.ratio * 100 > 100 ? Math.round(x.ratio * 100) : x.pct}%` : label(x)}</span>
                        <span className="cm-bar"><i style={{ width: `${x.pct}%` }} /></span>
                        <span className="cm-nums"><span><b>{money(x.v)}</b> {tx("paid")}</span><span>{x.target ? `of ${money(x.target)}${x.ratio > 1 ? ' · above target' : ''}` : tx("no target set")}</span></span>
                      </button>
                    ))}
                    {list.length === 0 && <p className="fn-cmp-none">{kurelBars.length === 0 ? tx("Nothing is allocated or paid yet.") : tx("Nothing matches these filters.")}</p>}
                  </div>
                  <p className="fn-cmp-count">{list.length} {tx("of")} {kurelBars.length} {tx("shown")}</p>
                  {open && (
                    <Shell title={open.name} sub={`${label(open)} · ${open.target ? `${Math.round(open.ratio * 100)}% of target` : 'no target set'}`} onClose={() => setCmpOpen(null)} footer={<button type="button" className="secondary" onClick={() => setCmpOpen(null)}>{tx("Close")}</button>}>
                      <div className="cm-nums" style={{ marginBottom: 10 }}><span><b>{money(open.v)}</b> {tx("paid")}</span><span>{open.target ? `Target ${money(open.target)}` : tx("No target")}</span></div>
                      <span className="cm-bar" style={{ display: 'block', marginBottom: 14 }}><i style={{ width: `${open.pct}%` }} /></span>
                      {groupBy !== 'kurel' && <p style={{ margin: '0 0 10px', fontSize: '.85rem' }}><b>{tx("Kurels inside:")}</b> {open.ids.map((id) => byId[id]?.name ?? id).join(', ') || tx("none")}</p>}
                      <b style={{ fontSize: '.85rem' }}>{tx("Payments (")}{pays.length})</b>
                      {pays.length === 0 && <p style={{ fontSize: '.85rem', color: '#6b8378' }}>{tx("No validated payment yet.")}</p>}
                      {pays.slice(0, 60).map((c) => <div className="cm-pay" key={c.id}><span>{c.userName || tx("Member")} · {METHOD[c.method]}{groupBy !== 'kurel' ? ` · ${byId[c.groupId]?.name ?? ''}` : ''}<br /><small>{frDate(c.createdMs)}</small></span><b>{money(c.amountCents)}</b></div>)}
                    </Shell>
                  )}
                </>
              );
            })()}
          </section>

          <section className="fn-reg" id="register">
            <div className="fn-reg-head">
              <div><h2>{tx("Detailed payment register")}</h2><p>{rows.length} {tx("payment")}{rows.length === 1 ? '' : 's'} {tx("shown")}</p></div>
              <button type="button" className="secondary" onClick={exportRegister}>{tx("Export")}</button>
            </div>
            <div className="fn-filters">
              <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Member or kurel")} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              <Dropdown label={tx("Method")} value={method} onChange={setMethod} allLabel="All methods" options={(Object.keys(METHOD) as Method[]).map((m) => ({ value: m, label: METHOD[m] }))} />
              <Dropdown label={tx("Country")} value={scope} onChange={setScope} allLabel="All countries" options={[...new Map(activeLeafGroups.map((g) => locationOf(g.id).country).filter((x): x is NonNullable<typeof x> => !!x).map((x) => [x.id, x.name])).entries()].map(([id, name]) => ({ value: id, label: name }))} />
              <Dropdown label={tx("Status")} value={status} onChange={setStatus} allLabel="All statuses" options={[{ value: 'validated', label: tx("Validated") }, { value: 'pending_review', label: tx("To review") }, { value: 'rejected', label: tx("Rejected") }]} />
            </div>
            <div className="fn-table">
              <table>
                <thead><tr><th>{tx("Member")}</th><th>{tx("Kurel")}</th><th>{tx("Payment")}</th><th>{tx("Amount")}</th><th>{tx("Proof")}</th><th>{tx("Collector")}</th><th>{tx("Status")}</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} className="fn-none">{tx("No payment matches.")}</td></tr>}
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><strong className="member-name">{c.userName || '—'}</strong></td>
                      <td>{byId[c.groupId]?.name ?? '—'}</td>
                      <td>{METHOD[c.method] ?? c.method}<small>{c.createdMs ? new Date(c.createdMs).toLocaleString(dateLocale()) : ''}</small></td>
                      <td><strong>{money(c.amountCents)}</strong></td>
                      <td>{c.proofUrl ? <a href={c.proofUrl} target="_blank" rel="noreferrer"><button type="button" className="secondary proof">{tx("View proof")}</button></a> : '—'}</td>
                      <td>{allocByGroup[c.groupId]?.collectorName ? `${allocByGroup[c.groupId].collectorName}${allocByGroup[c.groupId].collectorPhone ? ` · ${allocByGroup[c.groupId].collectorPhone}` : ''}` : '—'}</td>
                      <td>
                        <span className={`status${c.status === 'validated' ? '' : c.status === 'rejected' ? ' red' : ' gold'}`}>{STATUS[c.status]}</span>
                        {c.status === 'pending_review' && (
                          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
                            <button type="button" className="secondary" onClick={() => decide(c.id, 'validate')}>{tx("Validate")}</button>
                            <button type="button" className="secondary" onClick={() => decide(c.id, 'reject')}>{tx("Reject")}</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {dialog === 'create' && <ProgramForm onClose={() => setDialog(null)} />}
      {dialog === 'edit' && program && <ProgramForm edit={{ id: program.id, name: program.name, description: program.description, currency: program.currency, goalCents: program.goalAmountCents, startMs: program.startMs, endMs: program.endMs, phases: program.phases, locked: allocs.length > 0, recurrence: program.recurrence }} onClose={() => setDialog(null)} />}
      {dialog === 'allocate' && program && <AllocateModal program={{ ...program, phase1Cents: program.phases[0]?.amountCents, baseCents: program.phases.length ? pp.current.target : undefined }} allocs={allocs} onClose={() => setDialog(null)} />}
      {flowStep !== 0 && program && <FlowDetails step={flowStep} program={program} allocs={allocs} shares={(sharesRaw ?? []).map((x) => ({ id: x.id, groupId: x.groupId, userId: x.userId, amountCents: x.amountCents }))} payments={validated.map((c) => ({ id: c.id, userId: c.userId, userName: c.userName, groupId: c.groupId, method: c.method, amountCents: c.amountCents, createdMs: c.createdMs }))} onClose={() => setFlowStep(0)} />}
      {dialog === 'shares' && program && <SplitModal program={program} allocs={allocs} onClose={() => setDialog(null)} />}
      <ManageToggle title={tx("Manage finance — record contributions, card donations")} openSignal={manageSignal}>
        <FinanceManage />
      </ManageToggle>
    </>
  );
}

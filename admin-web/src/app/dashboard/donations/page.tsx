'use client';

import '../../px/index.css';
import '../../px/finance.css';
import CommandHero from '@/components/CommandHero';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getAggregateFromServer, limit as fsLimit, orderBy, query, sum, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { reviewContribution, updateFinancialProgram } from '@/lib/functions';
import { useCollection } from '@/lib/useCollection';
import { fmt } from '@/lib/liveStats';
import { formatMoney } from '@/lib/money';
import { money as fmtMoney, phaseProgress, type Currency, type Phase } from '@/lib/finance';
import PayIcon from './PayIcon';
import ProgramForm from './ProgramForm';
import Dropdown from '@/components/Dropdown';
import { AllocateModal, SplitModal, Shell } from './AllocDialogs';
import FlowDetails from './FlowDetails';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import ManageToggle from '../../px/ManageToggle';
import FinanceManage from './Manage';
import { BarChart3, CheckCircle2, Clock, Coins, FileText, Globe2, Info, Layers, MapPin, Plus, UserRound, Users, CalendarDays, CreditCard, PieChart, Network, Download, ChevronRight, FileCheck, Check, Hourglass, Target, CircleDot, Wallet, Search, ArrowUpDown } from 'lucide-react';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Method = 'wave' | 'orange_money' | 'cash';
interface Program {
  id: string;
  name: string;
  goalAmountCents: number;
  status: 'open' | 'closed' | 'draft';
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
  const [progFilter, setProgFilter] = useState<'open' | 'closed' | 'draft' | 'all'>('all');
  const [regSort, setRegSort] = useState<{ k: string; dir: 1 | -1 }>({ k: '', dir: 1 });
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [stripeTotal, setStripeTotal] = useState<number | null>(null);
  const [manageSignal, setManageSignal] = useState(0);
  const [heroTab, setHeroTab] = useState<'overview' | 'details'>('overview');
  const [dialog, setDialog] = useState<null | 'allocate' | 'shares' | 'create' | 'edit'>(null);
  const [flowStep, setFlowStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [groupBy, setGroupBy] = useState<'kurel' | 'city' | 'country'>('kurel');
  const [cmpSort, setCmpSort] = useState<'rank' | 'low' | 'paid' | 'name'>('rank');
  const [cmpOpen, setCmpOpen] = useState<string | null>(null);
  const [scope, setScope] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'financialPrograms'), orderBy('createdAt', 'desc')), (snap) =>
      setPrograms(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? '',
          goalAmountCents: Number(d.data().goalAmountCents) || 0,
          status: (d.data().status as 'open' | 'closed' | 'draft') ?? 'open',
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

  const visible = programs.filter((p) => (progFilter === 'all' || p.status === progFilter));
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

  const dmy = (ms: number) => new Date(ms).toLocaleDateString(dateLocale().startsWith('en') ? 'en-GB' : dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const statusName = (st: Program['status']) => (st === 'open' ? tx("Open") : st === 'draft' ? tx("Draft") : tx("Closed"));
  const nOpen = programs.filter((x) => x.status === 'open').length;
  const nClosed = programs.filter((x) => x.status === 'closed').length;
  const nDraft = programs.filter((x) => x.status === 'draft').length;
  const inReviewAmt = review.filter((c) => c.proofUrl).reduce((n, c) => n + c.amountCents, 0);
  const awaitingAmt = review.filter((c) => !c.proofUrl).reduce((n, c) => n + c.amountCents, 0);
  const csG = Math.max(1, program?.goalAmountCents ?? 0);
  const csV = Math.min(100, (paid / csG) * 100);
  const csR = Math.min(100 - csV, (inReviewAmt / csG) * 100);
  const csA = Math.min(100 - csV - csR, (awaitingAmt / csG) * 100);

  const byMethod = (m: Method) => validated.filter((c) => c.method === m).reduce((n, c) => n + c.amountCents, 0);
  const rows = mine.filter((c) => {
    if (method && c.method !== method) return false;
    if (status && c.status !== status) return false;
    if (scope && locationOf(c.groupId).country?.id !== scope) return false;
    const term = search.trim().toLowerCase();
    return !term || `${c.userName} ${byId[c.groupId]?.name ?? ''}`.toLowerCase().includes(term);
  });
  const regRows = useMemo(() => {
    if (!regSort.k) return rows;
    const f = (c: Contribution) => (regSort.k === 'member' ? c.userName : regSort.k === 'group' ? byId[c.groupId]?.name : regSort.k === 'method' ? METHOD[c.method] : regSort.k === 'collector' ? allocByGroup[c.groupId]?.collectorName : STATUS[c.status]) ?? '';
    return [...rows].sort((a, b) => regSort.dir * String(f(a)).localeCompare(String(f(b))));
  }, [rows, regSort, byId, allocByGroup]);
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
      <div className="px px-index fn-top"><section className="view active"><CommandHero variant="finance" title={tx("Finance command center")} subtitle={tx("Programs, collections and contributions across the Conservatory.")} /></section></div>
      <div className="px px-finance fx">
        <div className="content">
          <div className="fx-oh">
            <div className="fx-title"><Layers size={26} /><h2>{tx("Financial overview")}</h2><span className="fx-gold">{tx("All programs")}</span></div>
            <p className="fx-note"><Info size={15} />{tx("Tracking and follow-up only — this platform does not collect money.")}</p>
          </div>
          <div className="fx-kpis">
            <button type="button" className="fx-k dark" onClick={() => { setProgFilter('all'); document.getElementById('fx-programs')?.scrollIntoView({ behavior: 'smooth' }); }}>
              <Layers size={30} />
              <span className="fx-kt"><span>{tx("Active programs")}</span><b>{programs.length}</b><small>{nOpen} {tx("open")} • {nClosed} {tx("closed")} • {nDraft} {tx("draft")}</small></span>
              <ChevronRight size={18} className="fx-kgo" />
            </button>
            <div className="fx-k"><Coins size={30} /><span className="fx-kt"><span>{tx("Total to collect")}</span><b>{money(program?.goalAmountCents ?? 0)}</b></span></div>
            <div className="fx-k ok"><CheckCircle2 size={30} /><span className="fx-kt"><span>{tx("Collected so far")}</span><b>{money(paid)}</b><small>{rate}% {tx("of total")}</small></span></div>
            <div className="fx-k warn"><Clock size={30} /><span className="fx-kt"><span>{tx("Pending / awaiting validation")}</span><b>{money(Math.max(0, (program?.goalAmountCents ?? 0) - paid))}</b><small>{Math.max(0, 100 - Math.min(rate, 100))}% {tx("of total")}</small></span></div>
            <div className="fx-k"><FileText size={30} /><span className="fx-kt"><span>{tx("Proofs to check")}</span><b>{review.length}</b><small>{review.length ? `${money(reviewAmount)} ${tx("awaiting")}` : tx("No pending proofs")}</small></span></div>
          </div>

          <div className="fx-ph" id="fx-programs">
            <div className="fx-title sm"><Layers size={26} /><div><h2>{tx("Financial programs")}</h2><p>{tx("Browse and manage all financial programs. Select a program to see its full overview.")}</p></div></div>
            <div className="fx-pa">
              <button type="button" className="fx-btn" onClick={() => document.getElementById('register')?.scrollIntoView({ behavior: 'smooth' })}><BarChart3 size={16} />{tx("Detailed report")}</button>
              <Link href="/dashboard/donations/collection" className="fx-btn"><FileText size={16} />{tx("Collection plan")}</Link>
              <button type="button" className="fx-btn green" onClick={() => setDialog('create')}><Plus size={16} />{tx("Create a program")}</button>
            </div>
          </div>
          <div className="fx-tabs" role="tablist" aria-label={tx("Programs")}>
            {([['all', 'All'], ['open', 'Open'], ['closed', 'Closed'], ['draft', 'Draft']] as const).map(([k, l]) => (
              <button type="button" role="tab" aria-selected={progFilter === k} key={k} className={progFilter === k ? 'on' : ''} onClick={() => { setProgFilter(k); setSelectedId(''); }}>{tx(l)}<b>{k === 'all' ? programs.length : programs.filter((p) => p.status === k).length}</b></button>
            ))}
          </div>
          <div className="fx-progs">
            {visible.length === 0 && <p className="fx-none">{programs.length === 0 ? tx("No program yet. Create the first one with the button above.") : tx("No program matches this filter.")}</p>}
            {visible.map((p) => {
              const paidP = contribs.filter((c) => c.programId === p.id && c.status === 'validated').reduce((n, c) => n + c.amountCents, 0);
              const r = p.goalAmountCents ? Math.round((paidP / p.goalAmountCents) * 100) : 0;
              const ph = phaseProgress(p.goalAmountCents, p.phases, paidP);
              return (
                <button type="button" key={p.id} className={`fx-prog${program?.id === p.id ? ' on' : ''}${p.status === 'closed' ? ' off' : ''}`} onClick={() => setSelectedId(p.id)}>
                  <span className="fx-prog-top"><strong>{p.name}</strong><em className={p.status}>{statusName(p.status)}</em></span>
                  <span className="fx-prog-amt"><span><b>{fmtMoney(paidP, p.currency)}</b> {tx("of")} {fmtMoney(p.goalAmountCents, p.currency)}</span><i>{r}%</i></span>
                  <span className="fx-bar"><i style={{ width: `${Math.min(100, r)}%` }} /></span>
                  <small><CalendarDays size={15} />{ph.hasPhases ? `Phase ${ph.current.i} of ${ph.rows.length} · ` : ''}{p.scopeAllGroups ? tx("All groups") : `${p.groupIds.length} kurels`}{p.endMs ? ` · ${tx("until")} ${dmy(p.endMs)}` : ''}</small>
                </button>
              );
            })}
          </div>

          {program && (
            <section className="fx-hero">
              <div className="fx-hero-top">
                <i className="fx-hero-ic"><FileText size={34} /></i>
                <div className="fx-hero-id">
                  <h2>{program.name}{program.recurrence && <em>{{ monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }[program.recurrence]} {tx("· period")} {program.cycle ?? 1}</em>}</h2>
                  <p>{program.description || tx("No description yet.")}</p>
                </div>
                <div className="fx-chips">
                  <span>{program.currency}</span>
                  <span><Users size={15} />{program.scopeAllGroups ? tx("All groups") : `${program.groupIds.length} kurels`}</span>
                  <span><CalendarDays size={15} />{program.startMs || program.endMs ? `${program.startMs ? dmy(program.startMs) : '…'} – ${program.endMs ? dmy(program.endMs) : '…'}${daysLeft !== null ? (daysLeft >= 0 ? ` (${daysLeft} ${daysLeft === 1 ? tx("day left") : tx("days left")})` : ` (${tx("ended")})`) : ''}` : tx("No dates")}</span>
                  <span className={`st ${program.status}`}>{statusName(program.status)}</span>
                </div>
              </div>
              <div className="fx-htabs" role="tablist"><button type="button" role="tab" aria-selected={heroTab === 'overview'} className={heroTab === 'overview' ? 'on' : ''} onClick={() => setHeroTab('overview')}>{tx("Overview")}</button><button type="button" role="tab" aria-selected={heroTab === 'details'} className={heroTab === 'details' ? 'on' : ''} onClick={() => setHeroTab('details')}>{tx("Program details")}</button></div>
              {heroTab === 'overview' && (<>
                <div className="fx-metrics">
                  <div><i><Coins size={34} /></i><span><small>{tx("Total to collect")}</small><strong>{money(program.goalAmountCents)}</strong></span></div>
                  <div><i><CheckCircle2 size={32} /></i><span><small>{tx("Collected")}</small><strong>{money(paid)}</strong><em>{rate}% {tx("of total")}</em></span></div>
                  <div><i><Clock size={32} /></i><span><small>{pp.hasPhases ? `${pp.current.name} ${tx("still to collect")}` : tx("Still to collect")}</small><strong>{money(pp.hasPhases ? Math.max(0, pp.current.target - pp.current.got) : remaining)}</strong><em>{pp.hasPhases ? (pp.current.endMs ? `${tx("until")} ${dmy(pp.current.endMs)}` : tx("no end date")) : `${money(allocated)} ${tx("allocated")}`}</em></span></div>
                  <div><i><Users size={32} /></i><span><small>{tx("Contributors")}</small><strong>{fmt(new Set(validated.map((c) => c.userName)).size)}</strong><em>{tx("Validated payments")}</em></span></div>
                  <div><i><FileText size={32} /></i><span><small>{tx("Proofs to check")}</small><strong>{fmt(review.length)}</strong><em>{money(reviewAmount)} {tx("awaiting")}</em></span></div>
                </div>
                <div className="fx-hprog"><b>{tx("Collection progress")}</b><span>{money(paid)} {tx("of")} {money(program.goalAmountCents)} ({rate}%)</span><u><s style={{ width: `${Math.min(100, rate)}%` }} /></u></div>
              </>)}
              {heroTab === 'details' && (
                <div className="fx-phases">
                  <div className="fx-pacts">
                    <button type="button" onClick={() => setManageSignal((n) => n + 1)}>{tx("Record a contribution")}</button>
                    <button type="button" onClick={() => setDialog('edit')}>{tx("Edit the program")}</button>
                    <button type="button" onClick={() => updateFinancialProgram({ programId: program.id, status: program.status === 'open' ? 'closed' : 'open' }).then(() => notify(program.status === 'open' ? 'Program closed' : 'Program reopened', 'success')).catch((e: Error) => notify(e.message, 'error'))}>{program.status === 'open' ? tx("Close the program") : tx("Reopen the program")}</button>
                    <button type="button" disabled={program.status !== 'open'} onClick={() => setDialog('allocate')}>{tx("Allocate the envelope")}</button>
                    <button type="button" disabled={program.status !== 'open'} onClick={() => setDialog('shares')}>{tx("Split among members")}</button>
                    <button type="button" onClick={() => setDialog('edit')}>{pp.hasPhases ? tx("Edit the phases") : tx("Split into phases")}</button>
                  </div>
                  <div className="fx-phase-row">
                    {pp.rows.map((r) => (
                      <div key={r.i} className={`fx-phase${r.done ? ' done' : !r.open ? ' lock' : r.i === pp.current.i ? ' now' : ''}`}>
                        <span><b>{pp.hasPhases ? r.name : tx("Whole goal")}</b><em>{r.done ? tx("Complete") : !r.open ? tx("Opens after the previous phase") : pp.hasPhases ? tx("Now") : tx("In progress")}</em></span>
                        <strong>{money(r.got)} <small>{tx("of")} {money(r.target)}</small></strong>
                        <span className="fx-bar"><i style={{ width: `${r.target ? Math.round((r.got / r.target) * 100) : 0}%` }} /></span>
                        {pp.hasPhases && <small>{r.startMs || r.endMs ? `${r.startMs ? dmy(r.startMs) : '…'} → ${r.endMs ? dmy(r.endMs) : '…'}` : tx("No dates")}</small>}
                      </div>
                    ))}
                    {pp.hasPhases && pp.unplanned > 0 && <div className="fx-phase lock"><span><b>{tx("Not planned yet")}</b><em>{tx("Later")}</em></span><strong>{money(pp.unplanned)} <small>{tx("left for next phases")}</small></strong><span className="fx-bar"><i style={{ width: '0%' }} /></span></div>}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="fx-card fx-flow">
            <header>
              <div className="fx-ct"><Network size={28} /><div><h2>{tx("Money flow & assignment overview")}</h2><p>{tx("How the amount is allocated, assigned, and paid within this program.")}</p></div></div>
              <Dropdown label={tx("Program")} value={program?.id ?? ''} onChange={(v) => { setSelectedId(v); const pr = programs.find((x) => x.id === v); if (pr && progFilter !== 'all' && pr.status !== progFilter) setProgFilter('all'); }} options={programs.map((x) => ({ value: x.id, label: x.recurrence ? `${x.name} · period ${x.cycle ?? 1}` : x.name, hint: statusName(x.status) }))} />
            </header>
            {program && (() => {
              const goal = program.goalAmountCents;
              const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 1000) / 10) : 0);
              const members = (sharesRaw ?? []).length;
              const payers = new Set(validated.map((c) => c.userName)).size;
              const steps = [
                { n: 1, Ic: Layers, tone: '', title: tx("Allocation envelope"), cap: tx("Total amount to collect"), big: money(goal), foot: '' },
                { n: 2, Ic: Users, tone: '', title: tx("Targets for groups"), cap: `${allocs.length} ${tx("groups (kurels)")}`, big: money(allocated), foot: `${pct(allocated, goal)}% ${tx("of total")}` },
                { n: 3, Ic: Network, tone: 'warn', title: tx("Shared among members"), cap: members === 0 ? tx("No leader has split the target yet.") : `${members} ${tx(members === 1 ? "member has an amount to pay." : "members have an amount to pay.")}`, big: money(sharesTotal), foot: `${pct(sharesTotal, goal)}% ${tx("of the total")}` },
                { n: 4, Ic: CheckCircle2, tone: '', title: tx("Paid so far"), cap: `${payers} ${tx(payers === 1 ? "member has paid with proof checked." : "members have paid with proof checked.")}`, big: money(paid), foot: `${pct(paid, goal)}% ${tx("of the total")}` },
              ];
              return (
                <div className="fx-flowrow">
                  <aside className="fx-levels"><b>{tx("Assignment levels")}</b>
                    {[[Globe2, tx("Country")], [MapPin, tx("City")], [Layers, tx("Zone")], [Users, tx("Group / Kurel")], [UserRound, tx("Individual member")]].map(([Ic, l]) => { const I = Ic as typeof Globe2; return <span key={l as string}><I size={16} />{l as string}</span>; })}
                  </aside>
                  <span className="fx-lv-go" aria-hidden><ChevronRight size={18} /></span>
                  <div className="fx-steps">
                    {steps.map((st, i) => (
                      <Fragment key={st.n}>
                        <button type="button" className={`fx-step ${st.tone}`} onClick={() => setFlowStep(st.n as 1 | 2 | 3 | 4)} title={tx("Click to see the details")}>
                          <span className="fx-step-top"><st.Ic size={26} /><strong>{st.title}</strong></span>
                          <small>{st.cap}</small>
                          <em>{st.big}</em>
                          <u>{st.foot}</u>
                        </button>
                        {i < steps.length - 1 && <ChevronRight size={18} className="fx-sep" aria-hidden />}
                      </Fragment>
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>

          <div className="fx-row3">
            <section className="fx-card">
              <header><div className="fx-ct"><PieChart size={24} /><div><h2>{tx("Collection status")}</h2><p>{tx("Breakdown of the total amount and payment status.")}</p></div></div></header>
              <div className="fx-cs">
                <div className="fx-ring" style={{ background: `conic-gradient(#1f9d63 0 ${csV}%, #e9b949 ${csV}% ${csV + csR}%, #5b8def ${csV + csR}% ${csV + csR + csA}%, #dcebe3 ${csV + csR + csA}% 100%)` }}><div><strong>{rate}%</strong><span>{tx("collected")}</span><small>{tx("of")} {money(program?.goalAmountCents ?? 0)}</small></div></div>
                <ul className="fx-csl">
                  <li className="g"><CheckCircle2 size={18} /><span>{tx("Validated")}</span><b>{money(paid)}</b></li>
                  <li className="y"><Clock size={18} /><span>{tx("In review")}</span><b>{money(inReviewAmt)}</b></li>
                  <li className="b"><Hourglass size={18} /><span>{tx("Awaiting proof")}</span><b>{money(awaitingAmt)}</b></li>
                  <li className="n"><Layers size={18} /><span>{tx("To collect")}</span><b>{money(remaining)}</b></li>
                </ul>
              </div>
            </section>
            <section className="fx-card">
              <header><div className="fx-ct"><CreditCard size={24} /><div><h2>{tx("Payment channels")}</h2><p>{tx("Validated amount by way of paying.")}</p></div></div></header>
              <ul className="fx-ch">
                {(['wave', 'orange_money', 'cash'] as Method[]).map((m) => {
                  const v = byMethod(m);
                  const n = mine.filter((c) => c.method === m && c.status === 'validated').length;
                  const share = paid ? Math.round((v / paid) * 100) : 0;
                  return (
                    <li key={m}>
                      <PayIcon kind={m} size={44} />
                      <span><b>{METHOD[m]}</b><small>{n} {tx(n === 1 ? "payment" : "payments")} • {share}% {tx("of total")}</small></span>
                      <strong>{money(v)}</strong>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="fx-card">
              <header><div className="fx-ct"><FileCheck size={24} /><div><h2>{tx("Proofs to check")}</h2><p>{tx("Validate or reject payment proofs.")}</p></div></div></header>
              <ul className="fx-pf">
                {review.map((c) => (
                  <li key={c.id}><PayIcon kind={c.method} size={32} /><span><b>{c.userName || '—'}</b><small>{byId[c.groupId]?.name ?? ''} · {money(c.amountCents)}</small></span>
                    <span>{c.proofUrl && <a href={c.proofUrl} target="_blank" rel="noreferrer">{tx("Proof")}</a>}<button type="button" onClick={() => decide(c.id, 'validate')}>{tx("Validate")}</button><button type="button" className="no" onClick={() => decide(c.id, 'reject')}>{tx("Reject")}</button></span></li>
                ))}
                {review.length === 0 && <li className="fx-clear"><i><Check size={26} /></i><span>{tx("Nothing waits for a check.")}</span></li>}
              </ul>
              <footer><span><b>{money(reviewAmount)}</b> {tx("awaiting")}</span><span><b>{review.length}</b> {tx(review.length === 1 ? "proof" : "proofs")}</span></footer>
            </section>
          </div>

          <div className="fx-row2">
            <section className="fx-card fx-cmp">
              <header>
                <div className="fx-ct"><BarChart3 size={28} /><div><h2>{tx("Comparative progress")}</h2><p>{tx("What each")} {groupBy === 'kurel' ? tx("group") : groupBy === 'city' ? tx("city") : tx("country")} {tx("has paid, against what it was given.")}</p></div></div>
                <div className="fx-cmp-f">
                  <Dropdown label={tx("Group by")} value={groupBy} onChange={(v) => setGroupBy(v as 'kurel' | 'city' | 'country')} options={[{ value: 'kurel', label: tx("Group / Kurel") }, { value: 'city', label: tx("City") }, { value: 'country', label: tx("Country") }]} />
                  <Dropdown label={tx("Sort by")} value={cmpSort} onChange={(v) => setCmpSort(v as 'rank' | 'low' | 'paid' | 'name')} options={[{ value: 'rank', label: tx("By rank — best first") }, { value: 'low', label: tx("By percentage — lowest first") }, { value: 'paid', label: tx("By amount paid") }, { value: 'name', label: tx("By name A–Z") }]} />
                </div>
              </header>
              {(() => {
                const cat = (x: { ratio: number }) => (x.ratio < 0 ? 'none' : x.ratio >= 1 ? 'done' : x.ratio > 0 ? 'going' : 'zero');
                const list = [...kurelBars].sort((a, b) => (cmpSort === 'rank' ? a.rank - b.rank : cmpSort === 'low' ? (a.ratio < 0 ? 1 : b.ratio < 0 ? -1 : a.ratio - b.ratio) || a.rank - b.rank : cmpSort === 'paid' ? b.v - a.v : a.name.localeCompare(b.name)));
                const open = kurelBars.find((x) => x.g === cmpOpen);
                const pays = open ? validated.filter((c) => open.ids.includes(c.groupId)).sort((a, b) => b.createdMs - a.createdMs) : [];
                const label = (x: { ratio: number }) => ({ done: 'Completed', going: 'In progress', zero: 'Nothing paid', none: 'No allocation' })[cat(x)];
                return (
                  <>
                    <div className="fx-cmp-list">
                      {list.map((x) => (
                        <button type="button" className="fx-cr" key={x.g} onClick={() => setCmpOpen(x.g)}>
                          <i className={`fx-rk${x.rank <= 3 ? ` r${x.rank}` : ''}`}>{x.rank}</i>
                          <span className="fx-cn"><b>{x.name}</b>{x.sub && <small>{x.sub.replace(' · ', ' • ')}</small>}</span>
                          <span className="fx-cb">
                            <span className={`fx-cp ${cat(x)}`}>{x.target ? `${x.ratio * 100 > 100 ? Math.round(x.ratio * 100) : x.pct}%` : tx(label(x))}</span>
                            <span className="fx-bar"><i style={{ width: `${x.pct}%` }} /></span>
                            <span className="fx-cnum"><span><b>{money(x.v)}</b> {tx("paid")}</span><span>{x.target ? `${tx("of")} ${money(x.target)}` : tx("no target set")}</span></span>
                          </span>
                        </button>
                      ))}
                      {list.length === 0 && <p className="fx-none">{tx("Nothing is allocated or paid yet.")}</p>}
                    </div>
                    {open && (
                      <Shell title={open.name} sub={`${tx(label(open))} · ${open.target ? `${Math.round(open.ratio * 100)}% of target` : 'no target set'}`} onClose={() => setCmpOpen(null)} footer={<button type="button" className="secondary" onClick={() => setCmpOpen(null)}>{tx("Close")}</button>}>
                        <div className="cm-nums" style={{ marginBottom: 10 }}><span><b>{money(open.v)}</b> {tx("paid")}</span><span>{open.target ? `Target ${money(open.target)}` : tx("No target")}</span></div>
                        <span className="cm-bar" style={{ display: 'block', marginBottom: 14 }}><i style={{ width: `${open.pct}%` }} /></span>
                        {groupBy !== 'kurel' && <p style={{ margin: '0 0 10px', fontSize: '.85rem' }}><b>{tx("Kurels inside:")}</b> {open.ids.map((id) => byId[id]?.name ?? id).join(', ') || tx("none")}</p>}
                        <b style={{ fontSize: '.85rem' }}>{tx("Payments (")}{pays.length})</b>
                        {pays.length === 0 && <p style={{ fontSize: '.85rem', color: '#6b8378' }}>{tx("No validated payment yet.")}</p>}
                        {pays.slice(0, 60).map((c) => <div className="cm-pay" key={c.id}><span>{c.userName || tx("Member")} · {METHOD[c.method]}{groupBy !== 'kurel' ? ` · ${byId[c.groupId]?.name ?? ''}` : ''}<br /><small>{dmy(c.createdMs)}</small></span><b>{money(c.amountCents)}</b></div>)}
                      </Shell>
                    )}
                  </>
                );
              })()}
            </section>
            <section className="fx-card fx-sum">
              <header><div className="fx-ct"><Info size={26} /><div><h2>{tx("Program summary")}</h2></div></div></header>
              <dl>
                <div><dt><Wallet size={17} />{tx("Total to collect")}</dt><dd>{money(program?.goalAmountCents ?? 0)}</dd></div>
                <div><dt><Target size={17} />{tx("Number of assignments")}</dt><dd>{allocs.length} {tx("groups (kurels)")}</dd></div>
                <div><dt><Layers size={17} />{tx("Assignment levels")}</dt><dd>{tx("Country, City, Zone, Group (Kurel), Member")}</dd></div>
                <div><dt><CalendarDays size={17} />{tx("Program period")}</dt><dd>{program?.startMs ? dmy(program.startMs) : '—'} – {program?.endMs ? dmy(program.endMs) : '—'}</dd></div>
                <div><dt><CircleDot size={17} />{tx("Status")}</dt><dd><span className={`fx-st ${program?.status ?? ''}`}>{program ? statusName(program.status) : '—'}</span></dd></div>
              </dl>
            </section>
          </div>

          <section className="fx-card fx-reg" id="register">
            <header>
              <div className="fx-ct"><FileText size={26} /><div><h2>{tx("Detailed payment register")}</h2><p>{tx("All recorded payments and their current status.")}</p></div></div>
              <button type="button" className="fx-btn" onClick={exportRegister}><Download size={16} />{tx("Export")}</button>
            </header>
            <div className="fx-rf">
              <label className="fx-srch"><Search size={17} /><input type="search" placeholder={tx("Search member or group...")} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              <Dropdown label={tx("Method")} value={method} onChange={setMethod} allLabel={tx("All methods")} options={(Object.keys(METHOD) as Method[]).map((m) => ({ value: m, label: METHOD[m] }))} />
              <Dropdown label={tx("Country")} value={scope} onChange={setScope} allLabel={tx("All countries")} options={[...new Map(activeLeafGroups.map((g) => locationOf(g.id).country).filter((x): x is NonNullable<typeof x> => !!x).map((x) => [x.id, x.name])).entries()].map(([id, name]) => ({ value: id, label: name }))} />
              <Dropdown label={tx("Status")} value={status} onChange={setStatus} allLabel={tx("All statuses")} options={[{ value: 'validated', label: tx("Validated") }, { value: 'pending_review', label: tx("To review") }, { value: 'rejected', label: tx("Rejected") }]} />
            </div>
            <div className="fx-table">
              <table>
                <thead><tr>
                  {([['member', 'Member'], ['group', 'Group / Kurel'], ['method', 'Payment method'], ['', 'Amount'], ['', 'Proof'], ['collector', 'Collector'], ['status', 'Status']] as const).map(([k, l]) => (
                    <th key={l}>{k ? <button type="button" onClick={() => setRegSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: 1 }))}>{tx(l)}<ArrowUpDown size={13} className={regSort.k === k ? 'on' : ''} /></button> : tx(l)}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {regRows.length === 0 && <tr><td colSpan={7} className="fx-empty"><FileText size={30} /><span>{tx("No payment matches your filters.")}</span></td></tr>}
                  {regRows.map((c) => (
                    <tr key={c.id}>
                      <td><strong className="member-name">{c.userName || '—'}</strong></td>
                      <td>{byId[c.groupId]?.name ?? '—'}</td>
                      <td>{METHOD[c.method] ?? c.method}<small>{c.createdMs ? new Date(c.createdMs).toLocaleString(dateLocale()) : ''}</small></td>
                      <td><strong>{money(c.amountCents)}</strong></td>
                      <td>{c.proofUrl ? <a href={c.proofUrl} target="_blank" rel="noreferrer" className="fx-proof">{tx("View proof")}</a> : '—'}</td>
                      <td>{allocByGroup[c.groupId]?.collectorName ? `${allocByGroup[c.groupId].collectorName}${allocByGroup[c.groupId].collectorPhone ? ` · ${allocByGroup[c.groupId].collectorPhone}` : ''}` : '—'}</td>
                      <td>
                        <span className={`fx-stp ${c.status}`}>{STATUS[c.status]}</span>
                        {c.status === 'pending_review' && (
                          <span className="fx-rv">
                            <button type="button" onClick={() => decide(c.id, 'validate')}>{tx("Validate")}</button>
                            <button type="button" className="no" onClick={() => decide(c.id, 'reject')}>{tx("Reject")}</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="fx-foot"><Info size={16} /><span><b>{tx("Conservatoire — Financial tracking and follow-up only.")}</b> {tx("Tracks assigned amounts, paid amounts, pending amounts and validation/proof status. It does not process or collect payments.")}</span></p>
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

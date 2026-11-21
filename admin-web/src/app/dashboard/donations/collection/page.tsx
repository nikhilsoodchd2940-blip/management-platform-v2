'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { where } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useZones } from '@/lib/useZones';
import { useUserProfiles } from '@/lib/useUserNames';
import { money, type Currency } from '@/lib/finance';
import { notify } from '@/lib/notify';
import { createCollectionPlan, removeDraftTarget, publishCollectionPlan, respondToAllocation, splitAllocation, respondAsMember, resolveShortfall, reviewEscalation } from '@/lib/functions';
import Dropdown from '@/components/Dropdown';
import { Avatar } from '@/components/MemberPicker';
import { Shell } from '../AllocDialogs';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Level = 'country' | 'zone' | 'city' | 'group' | 'member';
type Status = 'draft' | 'offered' | 'accepted' | 'rejected' | 'change_requested' | 'redistributed' | 'escalated' | 'removed';
interface Alloc { programId: string; level: Level; nodeId: string; nodeName: string; groupId?: string; parentId?: string | null; amountCents: number; status: Status; reason?: string; requestedCents?: number; escalationRejected?: boolean; upheld?: boolean }
interface Esc { programId: string; kind: 'rejected_allocation' | 'kurel_shortfall'; allocId?: string; nodeName: string; pendingCents: number; reason: string; status: 'pending' | 'approved' | 'rejected'; mode?: string; comment?: string }
interface Ev { programId: string; text: string; type: string; createdAt?: { seconds: number } }
type A = Alloc & { id: string };

const LEVEL_NAME: Record<Level, string> = { country: 'Country', zone: 'Zone', city: 'City', group: 'Kurel', member: 'Member' };
const RANK: Record<Level, number> = { country: 0, zone: 1, city: 2, group: 3, member: 4 };
const STATUS: Record<Status, [string, string]> = {
  draft: ['Not shared yet', 'gray'], offered: ['Waiting for an answer', 'amber'], accepted: ['Accepted', 'green'], rejected: ['Rejected', 'red'],
  change_requested: ['Change requested', 'amber'], redistributed: ['Redistributed', 'gray'], escalated: ['Sent to Top Management', 'blue'], removed: ['Removed by Top Management', 'gray'],
};
const LIVE: Status[] = ['offered', 'accepted', 'change_requested', 'escalated'];
const toCents = (s: string) => Math.round(parseFloat(s.replace(/\s/g, '').replace(',', '.')) * 100);

interface Pick { level: Level; nodeId: string; groupId?: string; amount: string }

function MemberSel({ groupId, value, onChange }: { groupId: string; value: string; onChange: (v: string) => void }) {
  const roster = useCollection<{ userId: string }>('groupMemberships', [where('groupId', '==', groupId || '__none__'), where('status', '==', 'active')], groupId);
  const prof = useUserProfiles((roster ?? []).map((m) => m.userId));
  return <Dropdown label={tx("Member")} value={value} onChange={onChange} allLabel="Choose a member" options={(roster ?? []).map((m) => ({ value: m.userId, label: prof[m.userId]?.name || '…' }))} />;
}

/** One line per entity: choose its level and name, then the amount to collect. */
function Rows({ rows, setRows, levels, parentLevel, kurelOnly, currency }: { rows: Pick[]; setRows: (r: Pick[]) => void; levels: Level[]; parentLevel?: Level; kurelOnly?: string; currency: Currency }) {
  const { countries, cities, activeLeafGroups, locationOf } = useGroupHierarchy();
  const zones = useZones();
  const set = (i: number, patch: Partial<Pick>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const options = (l: Level) => l === 'country' ? countries.map((c) => ({ value: c.id, label: c.name }))
    : l === 'zone' ? (zones ?? []).map((z) => ({ value: z.id, label: z.name }))
    : l === 'city' ? cities.map((c) => ({ value: c.id, label: c.name }))
    : activeLeafGroups.map((g) => ({ value: g.id, label: `${g.name} · ${locationOf(g.id).city?.name ?? ''}` }));
  return (
    <div className="cp-rows">
      {rows.map((r, i) => (
        <div className="cp-row" key={i}>
          {!kurelOnly && levels.length > 1 && <Dropdown label={tx("Level")} value={r.level} onChange={(v) => set(i, { level: v as Level, nodeId: '', groupId: '' })} allLabel="Level" options={levels.map((l) => ({ value: l, label: LEVEL_NAME[l] }))} />}
          {r.level === 'member' ? (
            <>
              {!kurelOnly && <Dropdown label={tx("Kurel")} value={r.groupId ?? ''} onChange={(v) => set(i, { groupId: v, nodeId: '' })} allLabel="Choose a kurel" options={options('group')} />}
              {(kurelOnly || r.groupId) && <MemberSel groupId={kurelOnly ?? r.groupId ?? ''} value={r.nodeId} onChange={(v) => set(i, { nodeId: v })} />}
            </>
          ) : (
            <Dropdown label={LEVEL_NAME[r.level]} value={r.nodeId} onChange={(v) => set(i, { nodeId: v })} allLabel={`Choose a ${LEVEL_NAME[r.level].toLowerCase()}`} options={options(r.level)} />
          )}
          <label className="cp-amt"><span>{tx("Amount to collect (")}{currency})</span><input inputMode="decimal" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="0" /></label>
          <button type="button" className="cp-x" aria-label={tx("Remove this line")} onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => setRows([...rows, { level: levels.find((l) => !parentLevel || RANK[l] > RANK[parentLevel]) ?? levels[0], nodeId: '', amount: '' }])}>{tx("+ Add a line")}</button>
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string, done?: () => void) => {
    setBusy(true);
    try { await fn(); notify(ok, 'success'); done?.(); }
    catch (e) { notify((e as { message?: string }).message ?? 'It did not work', 'error'); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

export default function CollectionPlanPage() {
  const { access } = useAuth();
  const top = access.isSuperAdmin || access.permissions === null;
  const programsRaw = useCollection<{ name: string; currency?: Currency; goalAmountCents: number; status: string; recurrence?: string; cycle?: number }>('financialPrograms', []);
  const programs = (programsRaw ?? []).filter((p) => p.status === 'open').sort((a, b) => a.name.localeCompare(b.name));
  const [pid, setPid] = useState('');
  const program = programs.find((p) => p.id === pid) ?? programs[0];
  const id = program?.id ?? '__none__';
  const currency = program?.currency ?? 'XOF';
  const allocsRaw = useCollection<Alloc>('financeAllocations', [where('programId', '==', id)], id);
  const escRaw = useCollection<Esc>('financeEscalations', [where('programId', '==', id)], id);
  const evRaw = useCollection<Ev>('financeEvents', [where('programId', '==', id)], id);
  const contribRaw = useCollection<{ groupId: string; userId: string; userName?: string; amountCents: number; status: string; createdMs?: number }>('contributions', [where('programId', '==', id)], id);
  const { locationOf } = useGroupHierarchy();
  const allocs = useMemo(() => (allocsRaw ?? []) as A[], [allocsRaw]);
  const escs = useMemo(() => escRaw ?? [], [escRaw]);
  const paid = useMemo(() => (contribRaw ?? []).filter((c) => c.status === 'validated'), [contribRaw]);

  const [planOpen, setPlanOpen] = useState(false);
  const [splitOf, setSplitOf] = useState<A | null>(null);
  const [rejectOf, setRejectOf] = useState<A | null>(null);
  const [changeOf, setChangeOf] = useState<A | null>(null);
  const [shortOf, setShortOf] = useState<A | null>(null);
  const [reviewOf, setReviewOf] = useState<(Esc & { id: string }) | null>(null);
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [statOpen, setStatOpen] = useState<string | null>(null);
  const [lineOpen, setLineOpen] = useState<A | null>(null);
  const { busy, run } = useBusy();

  const removedCents = escs.filter((e) => e.status === 'approved' && e.mode === 'remove').reduce((n, e) => n + e.pendingCents, 0);
  const target = Math.max(0, (program?.goalAmountCents ?? 0) - removedCents);
  const collected = paid.reduce((n, c) => n + c.amountCents, 0);
  const topLevel = allocs.filter((a) => !a.parentId);
  const shared = topLevel.filter((a) => LIVE.includes(a.status)).reduce((n, a) => n + a.amountCents, 0);
  const drafts = allocs.filter((a) => a.status === 'draft');
  const heads = allocs.filter((a) => a.level !== 'member' && a.status !== 'draft');
  const members = allocs.filter((a) => a.level === 'member');
  const committed = members.filter((a) => a.status === 'accepted').reduce((n, a) => n + a.amountCents, 0);
  const waitingMembers = members.filter((a) => a.status === 'offered').length;
  const changeReq = members.filter((a) => a.status === 'change_requested');
  const pendingEsc = escs.map((e, i) => ({ ...e, id: (escRaw ?? [])[i].id })).filter((e) => e.status === 'pending');

  const collectedFor = (a: Alloc) => {
    const place = (gid: string) => locationOf(gid);
    return paid.filter((c) => {
      if (a.level === 'member') return c.userId === a.nodeId && c.groupId === a.groupId;
      if (a.level === 'group') return c.groupId === a.nodeId;
      const l = place(c.groupId);
      if (a.level === 'city') return l.city?.id === a.nodeId;
      if (a.level === 'country') return l.country?.id === a.nodeId;
      return (l.city as { zoneId?: string } | undefined)?.zoneId === a.nodeId;
    }).reduce((n, c) => n + c.amountCents, 0);
  };

  const memberIds = members.map((m) => m.nodeId);
  const prof = useUserProfiles(memberIds);

  const byParent = useMemo(() => {
    const m = new Map<string, A[]>();
    allocs.forEach((a) => { const k = a.parentId ?? ''; m.set(k, [...(m.get(k) ?? []), a]); });
    m.forEach((v) => v.sort((x, y) => RANK[x.level] - RANK[y.level] || x.nodeName.localeCompare(y.nodeName)));
    return m;
  }, [allocs]);

  const Line = ({ a, depth }: { a: A; depth: number }) => {
    const [label, tone] = STATUS[a.status];
    const got = collectedFor(a);
    const pct = a.amountCents ? Math.min(100, Math.round((got / a.amountCents) * 100)) : 0;
    const kids = byParent.get(a.id) ?? [];
    const kidsSum = kids.filter((k) => LIVE.includes(k.status)).reduce((n, k) => n + k.amountCents, 0);
    const actions: ReactNode[] = [];
    if (a.status === 'draft' && top) actions.push(<button key="rm" type="button" className="secondary" disabled={busy} onClick={() => run(() => removeDraftTarget({ allocId: a.id }), 'Removed')}>{tx("Remove")}</button>);
    if (a.level !== 'member' && a.status === 'offered') {
      actions.push(<button key="ac" type="button" className="cp-go" disabled={busy} onClick={() => run(() => respondToAllocation({ allocId: a.id, accept: true }), `${a.nodeName} accepted`)}>{tx("Accept")}</button>);
      actions.push(<button key="rj" type="button" className="secondary" disabled={busy} onClick={() => setRejectOf(a)}>{tx("Reject")}</button>);
    }
    if (a.level !== 'member' && a.status === 'accepted') actions.push(<button key="sp" type="button" className="cp-go" onClick={() => setSplitOf(a)}>{tx("Share it out")}</button>);
    if (a.level === 'member' && a.status === 'offered') {
      actions.push(<button key="ma" type="button" className="cp-go" disabled={busy} onClick={() => run(() => respondAsMember({ allocId: a.id, action: 'accept' }), 'Accepted')}>{tx("Accepted by member")}</button>);
      actions.push(<button key="mc" type="button" className="secondary" onClick={() => setChangeOf(a)}>{tx("Asks a change")}</button>);
    }
    if (a.level === 'member' && a.status === 'change_requested') actions.push(<button key="rs" type="button" className="cp-go" onClick={() => setShortOf(a)}>{tx("Redistribute or escalate")}</button>);
    return (
      <>
        <div className={`cp-line ${a.status}`} style={{ marginLeft: depth * 22, cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setLineOpen(a)} onKeyDown={(e) => e.key === 'Enter' && setLineOpen(a)}>
          <span className="cp-lv">{LEVEL_NAME[a.level]}</span>
          <span className="cp-name">{a.level === 'member' ? <><Avatar name={prof[a.nodeId]?.name || a.nodeName} photoUrl={prof[a.nodeId]?.photoUrl} size={26} /> <b>{prof[a.nodeId]?.name || a.nodeName}</b></> : <b>{a.nodeName}</b>}
            {a.reason && <small>{a.status === 'change_requested' && a.requestedCents !== undefined ? `Can give ${money(a.requestedCents, currency)} · ` : ''}{a.reason}</small>}
            {a.upheld && <small>{tx("Top Management kept this target in place.")}</small>}
          </span>
          <span className="cp-amount"><b>{money(a.amountCents, currency)}</b><small>{tx("target")}</small></span>
          <span className="cp-prog"><u><s style={{ width: `${pct}%` }} /></u><small>{money(got, currency)} {tx("collected ·")} {pct}%</small></span>
          <em className={`cp-st ${tone}`}>{label}</em>
          <span className="cp-act" onClick={(e) => e.stopPropagation()}>{actions}</span>
          {kids.length > 0 && <small className="cp-left">{tx("Shared out:")} {money(kidsSum, currency)} {tx("of")} {money(a.amountCents, currency)}</small>}
        </div>
        {kids.map((k) => <Line key={k.id} a={k} depth={depth + 1} />)}
      </>
    );
  };


  const nm = (a: A) => (a.level === 'member' ? prof[a.nodeId]?.name || a.nodeName : a.nodeName);
  const row = (a: A, extra?: string) => <div className="cm-pay" key={a.id} role="button" style={{ cursor: 'pointer' }} onClick={() => { setStatOpen(null); setLineOpen(a); }}><span><b>{nm(a)}</b> · {LEVEL_NAME[a.level]}<br /><small>{extra ?? STATUS[a.status][0]}{a.reason ? ` · ${a.reason}` : ''}</small></span><b>{money(a.amountCents, currency)}</b></div>;
  const none = <p className="cp-empty">{tx("Nothing to show yet.")}</p>;
  const closeBtn = (f: () => void) => <button type="button" className="secondary" onClick={f}>{tx("Close")}</button>;
  const statBody = (): [string, string, ReactNode] => {
    switch (statOpen) {
      case 'target': return ['Program target', `${money(target, currency)} to collect`, <>
        <div className="cm-pay"><span>{tx("Original program total")}</span><b>{money(program?.goalAmountCents ?? 0, currency)}</b></div>
        <div className="cm-pay"><span>{tx("Removed after Top Management approval")}</span><b>{money(removedCents, currency)}</b></div>
        <div className="cm-pay"><span><b>{tx("Target now")}</b></span><b>{money(target, currency)}</b></div>
        {escs.filter((e) => e.status === 'approved').map((e, i) => <div className="cm-pay" key={i}><span>{e.nodeName}<br /><small>{e.mode === 'remove' ? tx("Removed") : tx("Reallocated")} · {e.reason}</small></span><b>{money(e.pendingCents, currency)}</b></div>)}</>];
      case 'handed': { const l = topLevel.filter((a) => LIVE.includes(a.status)); return ['Handed to entities', `${money(shared, currency)} of ${money(target, currency)}`, l.length ? l.map((a) => row(a)) : none]; }
      case 'answers': { const l = heads.filter((a) => ['accepted', 'rejected', 'offered'].includes(a.status)).sort((x, y) => x.status.localeCompare(y.status)); return ['Accepted, rejected and waiting', `${l.length} entit${l.length === 1 ? 'y' : 'ies'}`, l.length ? l.map((a) => row(a)) : none]; }
      case 'members': { const l = members.filter((a) => a.status !== 'removed'); return ['Promised by members', `${money(committed, currency)} accepted`, l.length ? l.map((a) => row(a)) : none]; }
      case 'collected': { const l = [...paid].sort((x, y) => (y.createdMs ?? 0) - (x.createdMs ?? 0)); return ['Collected', `${money(collected, currency)} · ${l.length} payment${l.length === 1 ? '' : 's'}`, l.length ? l.slice(0, 80).map((c, i) => <div className="cm-pay" key={i}><span>{c.userName || prof[c.userId]?.name || tx("Member")}<br /><small>{c.createdMs ? new Date(c.createdMs).toLocaleDateString() : ''}</small></span><b>{money(c.amountCents, currency)}</b></div>) : none]; }
      default: { const l = topLevel.filter((a) => LIVE.includes(a.status)).map((a) => ({ a, left: Math.max(0, a.amountCents - collectedFor(a)) })).filter((x) => x.left > 0); return ['Still to collect', `${money(Math.max(0, target - collected), currency)} left`, <>{l.length ? l.map((x) => row(x.a, `${money(x.left, currency)} left`)) : none}{pendingEsc.length > 0 && <p className="cp-empty">{pendingEsc.length} {tx("request")}{pendingEsc.length === 1 ? '' : 's'} {tx("waiting for Top Management.")}</p>}</>]; }
    }
  };
  const stat = (key: string, tone: string, v: string, l: string, s: string) => <button type="button" className={`cp-stat ${tone}`} onClick={() => setStatOpen(key)}><b>{v}</b><span>{l}</span><small>{s}</small><i>{tx("See details ›")}</i></button>;

  return (
    <div className="px px-finance cp">
      <div className="content">
        <div className="section-head">
          <div><h1>{tx("Collection plan")}</h1><p>{tx("A program's total is an amount to collect, not money to pay out. Each level accepts its target and shares it with the level below.")}</p></div>
          <div className="actions">
            <Link href="/dashboard/donations" className="secondary">{tx("‹ Back to finance")}</Link>
            {top && program && <button type="button" className="secondary" onClick={() => setPlanOpen(true)}>{tx("Set targets")}</button>}
            {top && drafts.length > 0 && <button type="button" className="cp-go" disabled={busy} onClick={() => run(() => publishCollectionPlan({ programId: id }), 'Plan approved and shared with the heads')}>{tx("Approve and share (")}{drafts.length})</button>}
          </div>
        </div>

        {programsRaw === null ? <p className="cp-empty">{tx("Loading…")}</p> : programs.length === 0 ? <p className="cp-empty">{tx("No open program yet. Create one on the finance page first.")}</p> : (
          <>
            <section className="card cp-head">
              <Dropdown label={tx("Program")} value={program?.id ?? ''} onChange={setPid} allLabel="Choose a program" options={programs.map((p) => ({ value: p.id, label: p.recurrence ? `${p.name} · period ${p.cycle ?? 1}` : p.name }))} />
              <div className="hb-seg"><button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>{tx("All targets")}</button><button type="button" className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>{tx("Needs an answer (")}{heads.filter((a) => a.status === 'offered').length + waitingMembers + changeReq.length + pendingEsc.length})</button></div>
            </section>

            <div className="cp-stats">
              {stat('target', 'g', money(target, currency), 'Program target', removedCents ? `${money(removedCents, currency)} removed by Top Management` : 'Total to collect')}
              {stat('handed', 'b', money(shared, currency), 'Handed to entities', `${money(Math.max(0, target - shared), currency)} not yet handed out`)}
              {stat('answers', 'y', `${heads.filter((a) => a.status === 'accepted').length} / ${heads.filter((a) => a.status === 'rejected').length}`, 'Accepted / rejected', `${heads.filter((a) => a.status === 'offered').length} waiting`)}
              {stat('members', 'p', money(committed, currency), 'Promised by members', `${members.filter((a) => a.status === 'accepted').length} accepted · ${waitingMembers} waiting`)}
              {stat('collected', 't', money(collected, currency), 'Collected', `${target ? Math.round((collected / target) * 100) : 0}% of the target`)}
              {stat('left', 'r', money(Math.max(0, target - collected), currency), 'Still to collect', `${pendingEsc.length} request${pendingEsc.length === 1 ? '' : 's'} for Top Management`)}
            </div>

            {(tab === 'mine' || pendingEsc.length > 0 || changeReq.length > 0) && (
              <section className="card cp-queue">
                <h2>{tx("Waiting for a decision")}</h2>
                {pendingEsc.length === 0 && changeReq.length === 0 && heads.filter((a) => a.status === 'offered').length === 0 && waitingMembers === 0 && <p className="cp-empty">{tx("Nothing is waiting.")}</p>}
                {pendingEsc.map((e) => (
                  <div className="cp-q" key={e.id}><span><b>{e.nodeName} {tx("cannot collect")} {money(e.pendingCents, currency)}</b><small>{e.kind === 'rejected_allocation' ? tx("Target rejected") : tx("Shortfall in a kurel")} · {e.reason}</small></span>
                    {top ? <button type="button" className="cp-go" onClick={() => setReviewOf(e)}>{tx("Review")}</button> : <em className="cp-st blue">{tx("With Top Management")}</em>}</div>
                ))}
                {changeReq.map((a) => (
                  <div className="cp-q" key={a.id}><span><b>{prof[a.nodeId]?.name || a.nodeName} {tx("asks to change")} {money(a.amountCents, currency)}</b><small>{a.requestedCents !== undefined ? `Can give ${money(a.requestedCents, currency)} · ` : ''}{a.reason}</small></span>
                    <button type="button" className="cp-go" onClick={() => setShortOf(a)}>{tx("Redistribute or escalate")}</button></div>
                ))}
              </section>
            )}

            <section className="card cp-tree">
              <header><h2>{tx("Targets, level by level")}</h2><span>{allocs.length} {tx("line")}{allocs.length === 1 ? '' : 's'}</span></header>
              {allocsRaw === null ? <p className="cp-empty">{tx("Loading…")}</p> : allocs.length === 0 ? <p className="cp-empty">{top ? tx("No target yet. Use “Set targets” to hand the program total to countries, zones, cities, kurels or members.") : tx("No target has been shared yet.")}</p> : (
                <div className="cp-lines">{(tab === 'mine' ? allocs.filter((a) => (a.level !== 'member' && a.status === 'offered') || a.status === 'change_requested' || (a.level === 'member' && a.status === 'offered')).map((a) => ({ ...a, parentId: null })) : byParent.get('') ?? []).map((a) => <Line key={a.id} a={a as A} depth={0} />)}</div>
              )}
            </section>

            <section className="card cp-log">
              <header><h2>{tx("What happened")}</h2><span>{tx("Redistributions, requests and approvals")}</span></header>
              <ul>{[...(evRaw ?? [])].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).slice(0, 30).map((e, i) => <li key={i}><b>{e.createdAt ? new Date(e.createdAt.seconds * 1000).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</b><span>{e.text}</span></li>)}
                {(evRaw ?? []).length === 0 && <li className="cp-empty">{tx("Nothing yet.")}</li>}</ul>
            </section>
          </>
        )}
      </div>

      {planOpen && program && <PlanModal programId={id} currency={currency} left={target - shared - drafts.reduce((n, a) => n + a.amountCents, 0)} onClose={() => setPlanOpen(false)} />}
      {splitOf && <SplitDialog a={splitOf} currency={currency} used={(byParent.get(splitOf.id) ?? []).filter((k) => LIVE.includes(k.status)).reduce((n, k) => n + k.amountCents, 0)} onClose={() => setSplitOf(null)} />}
      {rejectOf && <ReasonDialog title={`Reject ${rejectOf.nodeName}'s target`} sub={tx("The request goes to Top Management with your reason.")} cta={tx("Reject the target")} onClose={() => setRejectOf(null)} onSend={(reason) => run(() => respondToAllocation({ allocId: rejectOf.id, accept: false, reason }), 'Sent to Top Management', () => setRejectOf(null))} />}
      {changeOf && <ChangeDialog a={changeOf} currency={currency} onClose={() => setChangeOf(null)} />}
      {shortOf && <ShortDialog a={shortOf} currency={currency} onClose={() => setShortOf(null)} />}
      {reviewOf && <ReviewDialog e={reviewOf} currency={currency} onClose={() => setReviewOf(null)} />}

      {statOpen && (() => { const [t, sub, body] = statBody(); return <Shell title={t} sub={sub} onClose={() => setStatOpen(null)} footer={closeBtn(() => setStatOpen(null))}>{body}</Shell>; })()}
      {lineOpen && (() => { const a = allocs.find((x) => x.id === lineOpen.id) ?? lineOpen; const got = collectedFor(a); const kids = byParent.get(a.id) ?? []; const [lab] = STATUS[a.status]; return (
        <Shell title={nm(a)} sub={`${LEVEL_NAME[a.level]} · ${lab}`} onClose={() => setLineOpen(null)} footer={closeBtn(() => setLineOpen(null))}>
          <div className="cm-pay"><span>{tx("Target")}</span><b>{money(a.amountCents, currency)}</b></div>
          <div className="cm-pay"><span>{tx("Collected")}</span><b>{money(got, currency)} ({a.amountCents ? Math.round((got / a.amountCents) * 100) : 0}%)</b></div>
          <div className="cm-pay"><span>{tx("Still to collect")}</span><b>{money(Math.max(0, a.amountCents - got), currency)}</b></div>
          {a.requestedCents !== undefined && <div className="cm-pay"><span>{tx("Can give instead")}</span><b>{money(a.requestedCents, currency)}</b></div>}
          {a.reason && <p style={{ fontSize: '.85rem' }}><b>{tx("Reason:")}</b> {a.reason}</p>}
          {a.upheld && <p style={{ fontSize: '.85rem' }}>{tx("Top Management kept this target in place.")}</p>}
          <b style={{ fontSize: '.85rem' }}>{tx("Shared out to (")}{kids.length})</b>
          {kids.length ? kids.map((k) => row(k)) : <p className="cp-empty">{tx("Not shared further.")}</p>}
        </Shell>); })()}
    </div>
  );
}

function PlanModal({ programId, currency, left, onClose }: { programId: string; currency: Currency; left: number; onClose: () => void }) {
  const [rows, setRows] = useState<Pick[]>([{ level: 'country', nodeId: '', amount: '' }]);
  const { busy, run } = useBusy();
  const total = rows.reduce((n, r) => n + (toCents(r.amount) || 0), 0);
  const ok = rows.every((r) => r.nodeId && toCents(r.amount) > 0 && (r.level !== 'member' || r.groupId));
  return (
    <Shell title={tx("Set targets")} sub={`Choose who must collect what. ${money(Math.max(0, left), currency)} can still be handed out.`} onClose={onClose}
      footer={<><span className="fm-err" style={{ color: total > left ? '#b3261e' : '#4a5c53' }}>{money(total, currency)} {tx("in this list")}</span><button type="button" className="fm-go" disabled={busy || !ok || total > left} onClick={() => run(() => createCollectionPlan({ programId, rows: rows.map((r) => ({ level: r.level, nodeId: r.nodeId, ...(r.groupId ? { groupId: r.groupId } : {}), amountCents: toCents(r.amount) })) }), 'Targets saved. Approve and share them when ready.', onClose)}>{tx("Save targets")}</button></>}>
      <p className="cp-note">{tx("These are collection responsibilities. Nothing is paid to anyone.")}</p>
      <Rows rows={rows} setRows={setRows} levels={['country', 'zone', 'city', 'group', 'member']} currency={currency} />
    </Shell>
  );
}

function SplitDialog({ a, currency, used, onClose }: { a: A; currency: Currency; used: number; onClose: () => void }) {
  const levels = (['zone', 'city', 'group', 'member'] as Level[]).filter((l) => RANK[l] > RANK[a.level]);
  const [rows, setRows] = useState<Pick[]>([{ level: levels[0], nodeId: '', groupId: a.level === 'group' ? a.nodeId : '', amount: '' }]);
  const { busy, run } = useBusy();
  const left = a.amountCents - used;
  const total = rows.reduce((n, r) => n + (toCents(r.amount) || 0), 0);
  const ok = rows.every((r) => r.nodeId && toCents(r.amount) > 0);
  return (
    <Shell title={`Share out ${a.nodeName}'s target`} sub={`${money(left, currency)} of ${money(a.amountCents, currency)} is still to be shared. Everyone you pick is asked to accept.`} onClose={onClose}
      footer={<><span className="fm-err" style={{ color: total > left ? '#b3261e' : '#4a5c53' }}>{money(total, currency)} {tx("of")} {money(left, currency)}</span><button type="button" className="fm-go" disabled={busy || !ok || total > left} onClick={() => run(() => splitAllocation({ allocId: a.id, rows: rows.map((r) => ({ level: r.level, nodeId: r.nodeId, ...(r.groupId ? { groupId: r.groupId } : {}), amountCents: toCents(r.amount) })) }), 'Shared and sent for acceptance', onClose)}>{tx("Send for acceptance")}</button></>}>
      <Rows rows={rows} setRows={setRows} levels={levels} parentLevel={a.level} kurelOnly={a.level === 'group' ? a.nodeId : undefined} currency={currency} />
    </Shell>
  );
}

function ReasonDialog({ title, sub, cta, onClose, onSend }: { title: string; sub: string; cta: string; onClose: () => void; onSend: (reason: string) => void }) {
  const [t, setT] = useState('');
  return (
    <Shell title={title} sub={sub} onClose={onClose} footer={<button type="button" className="fm-go" disabled={t.trim().length < 5} onClick={() => onSend(t.trim())}>{cta}</button>}>
      <label className="cp-amt wide"><span>{tx("Why?")}</span><textarea rows={4} value={t} onChange={(e) => setT(e.target.value)} placeholder={tx("Explain in a few words")} /></label>
    </Shell>
  );
}

function ChangeDialog({ a, currency, onClose }: { a: A; currency: Currency; onClose: () => void }) {
  const [t, setT] = useState('');
  const [amt, setAmt] = useState('');
  const { busy, run } = useBusy();
  return (
    <Shell title={tx("The member asks for a change")} sub={`Share of ${money(a.amountCents, currency)} for ${a.nodeName}. The Social Head will review it.`} onClose={onClose}
      footer={<button type="button" className="fm-go" disabled={busy || t.trim().length < 3} onClick={() => run(() => respondAsMember({ action: 'request_change', allocId: a.id, reason: t.trim(), ...(amt ? { requestedCents: toCents(amt) } : {}) }), 'Request sent to the Social Head', onClose)}>{tx("Send the request")}</button>}>
      <label className="cp-amt wide"><span>{tx("Amount the member can give (")}{currency}{tx("), optional")}</span><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={tx("0 if nothing")} /></label>
      <label className="cp-amt wide"><span>{tx("Reason")}</span><textarea rows={3} value={t} onChange={(e) => setT(e.target.value)} /></label>
    </Shell>
  );
}

/** The Social Head either shares the pending amount with other members of the kurel or sends it up to Top Management. */
function ShortDialog({ a, currency, onClose }: { a: A; currency: Currency; onClose: () => void }) {
  const keep = a.requestedCents ?? 0;
  const pending = a.amountCents - keep;
  const [mode, setMode] = useState<'redistribute' | 'escalate'>('redistribute');
  const [rows, setRows] = useState<Pick[]>([{ level: 'member', nodeId: '', amount: '' }]);
  const [why, setWhy] = useState('');
  const { busy, run } = useBusy();
  const total = rows.reduce((n, r) => n + (toCents(r.amount) || 0), 0);
  const ready = mode === 'escalate' ? why.trim().length >= 5 : rows.every((r) => r.nodeId && toCents(r.amount) > 0) && total === pending;
  return (
    <Shell title={`${a.nodeName}: ${money(pending, currency)} to cover`} sub={keep ? `The member keeps ${money(keep, currency)}.` : tx("The member cannot give this share.")} onClose={onClose}
      footer={<><span className="fm-err" style={{ color: mode === 'redistribute' && total !== pending ? '#b3261e' : '#4a5c53' }}>{mode === 'redistribute' ? `${money(total, currency)} of ${money(pending, currency)}` : ''}</span>
        <button type="button" className="fm-go" disabled={busy || !ready} onClick={() => run(() => resolveShortfall({ allocId: a.id, mode, keepCents: keep, ...(mode === 'escalate' ? { reason: why.trim() } : { targets: rows.map((r) => ({ userId: r.nodeId, amountCents: toCents(r.amount) })) }) }), mode === 'escalate' ? 'Sent to Top Management' : 'Shared with other members', onClose)}>{mode === 'escalate' ? tx("Send to Top Management") : tx("Redistribute")}</button></>}>
      <div className="hb-seg"><button type="button" className={mode === 'redistribute' ? 'on' : ''} onClick={() => setMode('redistribute')}>{tx("Share with other members")}</button><button type="button" className={mode === 'escalate' ? 'on' : ''} onClick={() => setMode('escalate')}>{tx("Escalate to Top Management")}</button></div>
      {mode === 'redistribute'
        ? <Rows rows={rows} setRows={setRows} levels={['member']} kurelOnly={a.groupId} currency={currency} />
        : <label className="cp-amt wide"><span>{tx("Why can the target not be fully collected?")}</span><textarea rows={4} value={why} onChange={(e) => setWhy(e.target.value)} /></label>}
    </Shell>
  );
}

function ReviewDialog({ e, currency, onClose }: { e: Esc & { id: string }; currency: Currency; onClose: () => void }) {
  const [mode, setMode] = useState<'remove' | 'reallocate' | 'reject'>('remove');
  const [rows, setRows] = useState<Pick[]>([{ level: 'country', nodeId: '', amount: '' }]);
  const [note, setNote] = useState('');
  const { busy, run } = useBusy();
  const total = rows.reduce((n, r) => n + (toCents(r.amount) || 0), 0);
  const ready = mode !== 'reallocate' || (rows.every((r) => r.nodeId && toCents(r.amount) > 0 && (r.level !== 'member' || r.groupId)) && total === e.pendingCents);
  return (
    <Shell title={`${e.nodeName}: ${money(e.pendingCents, currency)}`} sub={e.reason} onClose={onClose}
      footer={<><span className="fm-err" style={{ color: mode === 'reallocate' && total !== e.pendingCents ? '#b3261e' : '#4a5c53' }}>{mode === 'reallocate' ? `${money(total, currency)} of ${money(e.pendingCents, currency)}` : ''}</span>
        <button type="button" className="fm-go" disabled={busy || !ready} onClick={() => run(() => reviewEscalation({ escalationId: e.id, decision: mode === 'reject' ? 'reject' : 'approve', ...(mode !== 'reject' ? { mode } : {}), comment: note.trim(), ...(mode === 'reallocate' ? { targets: rows.map((r) => ({ level: r.level, nodeId: r.nodeId, ...(r.groupId ? { groupId: r.groupId } : {}), amountCents: toCents(r.amount) })) } : {}) }), 'Decision saved', onClose)}>{mode === 'reject' ? tx("Reject the request") : tx("Approve")}</button></>}>
      <div className="hb-seg"><button type="button" className={mode === 'remove' ? 'on' : ''} onClick={() => setMode('remove')}>{tx("Approve: remove it")}</button><button type="button" className={mode === 'reallocate' ? 'on' : ''} onClick={() => setMode('reallocate')}>{tx("Approve: move it elsewhere")}</button><button type="button" className={mode === 'reject' ? 'on' : ''} onClick={() => setMode('reject')}>{tx("Reject")}</button></div>
      {mode === 'reject' && <p className="cp-note">{tx("The original target stays with")} {e.nodeName}.</p>}
      {mode === 'remove' && <p className="cp-note">{tx("The program target goes down by")} {money(e.pendingCents, currency)}.</p>}
      {mode === 'reallocate' && <Rows rows={rows} setRows={setRows} levels={['country', 'zone', 'city', 'group', 'member']} currency={currency} />}
      <label className="cp-amt wide"><span>{tx("Comment (optional)")}</span><textarea rows={2} value={note} onChange={(e2) => setNote(e2.target.value)} /></label>
    </Shell>
  );
}

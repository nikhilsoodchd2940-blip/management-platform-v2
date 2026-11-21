'use client';

import { useMemo, useState } from 'react';
import { money, frDate, type Currency, type Phase } from '@/lib/finance';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import Dropdown from '@/components/Dropdown';
import PayIcon from './PayIcon';
import { Shell, type AllocRow } from './AllocDialogs';
import { tx } from '@/lib/i18n/tr';

export interface FlowProgram { name: string; currency: Currency; goalAmountCents: number; scopeAllGroups: boolean; groupIds: string[]; phases: Phase[] }
export interface FlowShare { id: string; groupId: string; userId: string; amountCents: number }
export interface FlowPayment { id: string; userId?: string; userName: string; groupId: string; method: 'wave' | 'orange_money' | 'cash'; amountCents: number; createdMs: number }

const METHOD = { wave: 'Wave', orange_money: 'Orange Money', cash: 'Cash' } as const;

const TITLES: Record<number, { t: string; s: string }> = {
  1: { t: 'Total to collect', s: 'The goal, its phases, and the kurels it is meant for.' },
  2: { t: 'Targets for kurels', s: 'The part of the total each kurel has to collect.' },
  3: { t: 'Shared among members', s: 'The amount each member has to pay, set by their kurel leader.' },
  4: { t: 'Paid so far', s: 'Every payment whose proof has been checked.' },
};

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></label>
  );
}

export default function FlowDetails({ step, program, allocs, shares, payments, onClose }: { step: 1 | 2 | 3 | 4; program: FlowProgram; allocs: (AllocRow & { id?: string })[]; shares: FlowShare[]; payments: FlowPayment[]; onClose: () => void }) {
  const { byId, locationOf, activeLeafGroups } = useGroupHierarchy();
  const [q, setQ] = useState('');
  const [kurel, setKurel] = useState('');
  const [state, setState] = useState('');
  const cur = program.currency;
  const m = (c: number) => money(c, cur);
  const place = (gid: string) => { const l = locationOf(gid); return [l.city?.name, l.country?.name].filter(Boolean).join(', '); };
  const name = (gid: string) => byId[gid]?.name ?? gid;
  const term = q.trim().toLowerCase();

  const scopeIds = useMemo(() => (program.scopeAllGroups ? activeLeafGroups.map((g) => g.id) : program.groupIds), [program, activeLeafGroups]);
  const allocBy = useMemo(() => Object.fromEntries(allocs.map((a) => [a.groupId, a.amountCents])), [allocs]);
  const goal = program.goalAmountCents;
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 1000) / 10) : 0);

  const profiles = useUserProfiles(step === 3 ? shares.map((s) => s.userId) : step === 4 ? payments.map((p) => p.userId ?? '') : []);
  const paidByUser = useMemo(() => {
    const r: Record<string, number> = {};
    payments.forEach((p) => { if (p.userId) r[p.userId] = (r[p.userId] ?? 0) + p.amountCents; });
    return r;
  }, [payments]);
  const kurelOptions = useMemo(() => {
    const ids = step === 3 ? shares.map((s) => s.groupId) : step === 4 ? payments.map((p) => p.groupId) : [];
    return [...new Set(ids)].map((id) => ({ value: id, label: name(id) })).sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shares, payments, byId]);

  const t = TITLES[step];
  let body: JSX.Element;

  if (step === 1) {
    const given = scopeIds.filter((id) => allocBy[id] !== undefined);
    const rows = scopeIds.filter((id) => !term || `${name(id)} ${place(id)}`.toLowerCase().includes(term)).sort((a, b) => (allocBy[b] ?? 0) - (allocBy[a] ?? 0) || name(a).localeCompare(name(b)));
    body = (
      <>
        <section className="fd-sum"><div><small>{tx("Goal")}</small><b>{m(goal)}</b></div><div><small>{tx("Kurels concerned")}</small><b>{scopeIds.length}</b></div><div><small>{tx("Already given to")}</small><b>{given.length} {tx("kurel")}{given.length === 1 ? '' : 's'}</b></div></section>
        <section className="fd-box"><h3>{program.phases.length ? tx("Phases") : tx("Collection")}</h3>
          {program.phases.length === 0 ? <p className="fm-note">{tx("No phases: the whole")} {m(goal)} {tx("is collected in one go.")}</p> : (
            <ul className="fd-ph">{program.phases.map((p, i) => <li key={i}><b>{p.name || `Phase ${i + 1}`}</b><span>{p.startMs || p.endMs ? `${p.startMs ? frDate(p.startMs) : '…'} → ${p.endMs ? frDate(p.endMs) : '…'}` : tx("No dates")}</span><strong>{m(p.amountCents)}</strong></li>)}</ul>
          )}
        </section>
        <section className="fd-box"><div className="fd-head"><h3>{tx("Kurels concerned")} <small>({rows.length})</small></h3><Search value={q} onChange={setQ} placeholder={tx("Kurel or city")} /></div>
          <ul className="fd-list">{rows.map((id) => <li key={id}><span><b>{name(id)}</b><small>{place(id) || '—'}</small></span>{allocBy[id] !== undefined ? <strong>{m(allocBy[id])}</strong> : <em className="no">{tx("No target yet")}</em>}</li>)}{rows.length === 0 && <li className="fd-none">{tx("No kurel matches.")}</li>}</ul>
        </section>
      </>
    );
  } else if (step === 2) {
    const total = allocs.reduce((n, a) => n + a.amountCents, 0);
    const given = allocs.filter((a) => !term || `${name(a.groupId)} ${place(a.groupId)} ${a.collectorName ?? ''}`.toLowerCase().includes(term)).sort((a, b) => b.amountCents - a.amountCents);
    const waiting = scopeIds.filter((id) => allocBy[id] === undefined && (!term || `${name(id)} ${place(id)}`.toLowerCase().includes(term)));
    body = (
      <>
        <section className="fd-sum"><div><small>{tx("Given in total")}</small><b>{m(total)}</b></div><div><small>{tx("Kurels that received")}</small><b>{allocs.length}</b></div><div><small>{tx("Not given yet")}</small><b>{m(Math.max(0, goal - total))}</b></div></section>
        <section className="fd-box"><div className="fd-head"><h3>{tx("Kurels that received")} <small>({given.length})</small></h3><Search value={q} onChange={setQ} placeholder={tx("Kurel, city or collector")} /></div>
          <ul className="fd-list">
            {given.map((a) => (
              <li key={a.groupId}>
                <span><b>{name(a.groupId)}</b><small>{place(a.groupId) || '—'} · {pct(a.amountCents, goal)}{tx("% of the total")}</small>{a.collectorName && <small className="fd-col">{tx("Collects:")} {a.collectorName}{a.collectorPhone ? ` · ${a.collectorPhone}` : ''}</small>}</span>
                <strong>{m(a.amountCents)}</strong>
              </li>
            ))}
            {given.length === 0 && <li className="fd-none">{allocs.length === 0 ? tx("No kurel has a target yet. Press “Allocate the envelope” to set one.") : tx("No kurel matches.")}</li>}
          </ul>
        </section>
        {waiting.length > 0 && <section className="fd-box"><h3>{tx("Still waiting")} <small>({waiting.length})</small></h3><div className="fd-chips">{waiting.slice(0, 120).map((id) => <span key={id}>{name(id)}</span>)}{waiting.length > 120 && <i>+{waiting.length - 120} {tx("more")}</i>}</div></section>}
      </>
    );
  } else if (step === 3) {
    const total = shares.reduce((n, s) => n + s.amountCents, 0);
    const rows = shares
      .map((s) => ({ ...s, paid: paidByUser[s.userId] ?? 0, who: profiles[s.userId]?.name ?? '…', photo: profiles[s.userId]?.photoUrl }))
      .filter((s) => (!kurel || s.groupId === kurel) && (!state || (state === 'paid' ? s.paid >= s.amountCents : state === 'part' ? s.paid > 0 && s.paid < s.amountCents : s.paid === 0)) && (!term || `${s.who} ${name(s.groupId)}`.toLowerCase().includes(term)))
      .sort((a, b) => a.who.localeCompare(b.who));
    const withShare = new Set(shares.map((s) => s.groupId));
    const notShared = allocs.filter((a) => !withShare.has(a.groupId));
    body = (
      <>
        <section className="fd-sum"><div><small>{tx("Shared in total")}</small><b>{m(total)}</b></div><div><small>{tx("Members with an amount")}</small><b>{shares.length}</b></div><div><small>{tx("In")} {withShare.size} {tx("kurel")}{withShare.size === 1 ? '' : 's'}</small><b>{notShared.length} {tx("not shared yet")}</b></div></section>
        <section className="fd-box"><div className="fd-head"><h3>{tx("Members")} <small>({rows.length})</small></h3></div>
          <div className="fd-filters"><Search value={q} onChange={setQ} placeholder={tx("Member or kurel")} /><Dropdown label={tx("Kurel")} value={kurel} onChange={setKurel} allLabel="All kurels" options={kurelOptions} /><Dropdown label={tx("Payment")} value={state} onChange={setState} allLabel="All" options={[{ value: 'paid', label: tx("Paid in full") }, { value: 'part', label: tx("Paid in part") }, { value: 'none', label: tx("Not paid yet") }]} /></div>
          <ul className="fd-list">
            {rows.map((s) => (
              <li key={s.id}>
                <Avatar name={s.who} photoUrl={s.photo} size={34} />
                <span><b>{s.who}</b><small>{name(s.groupId)}</small></span>
                <span className="fd-amt"><strong>{m(s.amountCents)}</strong><em className={s.paid >= s.amountCents && s.amountCents > 0 ? 'ok' : s.paid > 0 ? 'mid' : 'no'}>{s.paid >= s.amountCents && s.amountCents > 0 ? tx("Paid") : s.paid > 0 ? `Paid ${m(s.paid)}` : tx("Not paid yet")}</em></span>
              </li>
            ))}
            {rows.length === 0 && <li className="fd-none">{shares.length === 0 ? tx("No kurel leader has split its target among members yet.") : tx("No member matches.")}</li>}
          </ul>
        </section>
        {notShared.length > 0 && <section className="fd-box"><h3>{tx("Kurels that have not shared yet")} <small>({notShared.length})</small></h3><div className="fd-chips">{notShared.slice(0, 120).map((a) => <span key={a.groupId}>{name(a.groupId)}</span>)}</div></section>}
      </>
    );
  } else {
    const total = payments.reduce((n, p) => n + p.amountCents, 0);
    const rows = payments
      .filter((p) => (!kurel || p.groupId === kurel) && (!term || `${p.userName} ${name(p.groupId)}`.toLowerCase().includes(term)))
      .sort((a, b) => b.createdMs - a.createdMs);
    const per = (['wave', 'orange_money', 'cash'] as const).map((k) => ({ k, v: payments.filter((p) => p.method === k).reduce((n, p) => n + p.amountCents, 0) }));
    body = (
      <>
        <section className="fd-sum"><div><small>{tx("Paid so far")}</small><b>{m(total)}</b></div><div><small>{tx("Payments")}</small><b>{payments.length}</b></div><div><small>{tx("Still to collect")}</small><b>{m(Math.max(0, goal - total))}</b></div></section>
        <section className="fd-box"><h3>{tx("By way of paying")}</h3><div className="fd-meth">{per.map((x) => <div key={x.k}><PayIcon kind={x.k} size={30} /><span><b>{METHOD[x.k]}</b><small>{pct(x.v, total)}%</small></span><strong>{m(x.v)}</strong></div>)}</div></section>
        <section className="fd-box"><div className="fd-head"><h3>{tx("Payments")} <small>({rows.length})</small></h3></div>
          <div className="fd-filters two"><Search value={q} onChange={setQ} placeholder={tx("Member or kurel")} /><Dropdown label={tx("Kurel")} value={kurel} onChange={setKurel} allLabel="All kurels" options={kurelOptions} /></div>
          <ul className="fd-list">
            {rows.map((p) => (
              <li key={p.id}>
                <PayIcon kind={p.method} size={34} />
                <span><b>{p.userName || profiles[p.userId ?? '']?.name || '—'}</b><small>{name(p.groupId)} · {METHOD[p.method]}{p.createdMs ? ` · ${frDate(p.createdMs)}` : ''}</small></span>
                <strong>{m(p.amountCents)}</strong>
              </li>
            ))}
            {rows.length === 0 && <li className="fd-none">{payments.length === 0 ? tx("No payment has been validated yet.") : tx("No payment matches.")}</li>}
          </ul>
        </section>
      </>
    );
  }

  return (
    <Shell title={`${t.t} — ${program.name}`} sub={t.s} onClose={onClose} footer={<button type="button" className="fm-go" onClick={onClose}>{tx("Close")}</button>}>
      <div className="fd">{body}</div>
    </Shell>
  );
}

'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { where } from 'firebase/firestore';
import { setMemberShares, setProgramAllocations } from '@/lib/functions';
import { money, type Currency } from '@/lib/finance';
import { notify } from '@/lib/notify';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useGroupMembers } from '@/lib/useGroupMembers';
import KurelPicker from './KurelPicker';
import { Avatar } from '@/components/MemberPicker';
import { useUserProfiles } from '@/lib/useUserNames';
import DatePicker from '@/components/DatePicker';
import Dropdown from '@/components/Dropdown';
import { tx } from '@/lib/i18n/tr';

export interface ProgramInfo { id: string; name: string; currency: Currency; goalAmountCents: number; scopeAllGroups: boolean; groupIds: string[]; phase1Cents?: number; baseCents?: number }
export interface AllocRow { groupId: string; amountCents: number; collectorName?: string; collectorPhone?: string }

export function Shell({ title, sub, onClose, children, footer }: { title: string; sub: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fm" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h2>{title}</h2><p>{sub}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="fm-body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>,
    document.body
  );
}

interface Collector { userId: string; kurelId: string; role: 'Finance/Social' | 'Second member' }

/** Give each chosen kurel its part of the envelope. Kurels are chosen with filters (country, city, local zone, level). */
export function AllocateModal({ program, allocs, onClose }: { program: ProgramInfo; allocs: AllocRow[]; onClose: () => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [mode, setMode] = useState<'each' | 'equal' | 'custom'>('each');
  const [amount, setAmount] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [cMode, setCMode] = useState<'own' | 'pick'>('own');
  const [picked, setPicked] = useState('');
  const [phone, setPhone] = useState('');
  const [cq, setCq] = useState('');
  const [onlyChosen, setOnlyChosen] = useState(true);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { byId, locationOf } = useGroupHierarchy();
  const allowed = useMemo(() => (program.scopeAllGroups ? undefined : program.groupIds), [program]);
  const cur = program.currency;
  const base = program.baseCents ?? program.goalAmountCents;

  const roles = useCollection<{ socialId?: string; socialDeputyId?: string }>('kurelRoles', []);
  const collectors = useMemo<Collector[]>(() => (roles ?? []).flatMap((r) => [
    ...(r.socialId ? [{ userId: r.socialId, kurelId: r.id, role: 'Finance/Social' as const }] : []),
    ...(r.socialDeputyId ? [{ userId: r.socialDeputyId, kurelId: r.id, role: 'Second member' as const }] : []),
  ]).filter((c) => !!byId[c.kurelId] && byId[c.kurelId].status === 'active'), [roles, byId]);
  const profiles = useUserProfiles(useMemo(() => collectors.map((c) => c.userId), [collectors]));
  const ownOf = (kurelId: string) => collectors.find((c) => c.kurelId === kurelId && c.role === 'Finance/Social') ?? collectors.find((c) => c.kurelId === kurelId);

  const others = allocs.filter((a) => !sel.includes(a.groupId)).reduce((n, a) => n + a.amountCents, 0);
  const free = Math.max(0, base - others);
  const each = sel.length ? Math.floor(free / sel.length / 100) * 100 : 0;
  const rows = useMemo(() => sel.map((id) => {
    const total = Math.round((Number(amount) || 0) * 100);
    const cents = mode === 'each' ? each : mode === 'equal' ? Math.floor(total / Math.max(1, sel.length)) : Math.round((Number(custom[id]) || 0) * 100);
    return { groupId: id, amountCents: cents };
  }), [sel, mode, amount, custom, each]);
  const newTotal = rows.reduce((n, r) => n + r.amountCents, 0);
  const left = program.goalAmountCents - others - newTotal;
  const without = sel.filter((id) => !ownOf(id));

  const shown = useMemo(() => collectors.filter((c) => (!onlyChosen || sel.length === 0 || sel.includes(c.kurelId)) && (!cq.trim() || `${profiles[c.userId]?.name ?? ''} ${byId[c.kurelId]?.name ?? ''}`.toLowerCase().includes(cq.trim().toLowerCase()))).sort((a, b) => (profiles[a.userId]?.name ?? '').localeCompare(profiles[b.userId]?.name ?? '')), [collectors, onlyChosen, sel, cq, profiles, byId]);
  const pickedPerson = collectors.find((c) => `${c.kurelId}_${c.userId}` === picked);

  async function save() {
    setErr('');
    if (sel.length === 0) return setErr(tx("Choose at least one kurel."));
    if (rows.some((r) => r.amountCents <= 0)) return setErr(mode === 'each' ? tx("There is nothing free to share. Check the amount already given to other kurels.") : tx("Every chosen kurel needs an amount above zero."));
    if (left < 0) return setErr(`The allocations are ${money(-left, cur)} above the goal.`);
    if (cMode === 'pick' && !pickedPerson) return setErr(tx("Choose who collects, or switch to each kurel's own Finance/Social member."));
    setBusy(true);
    try {
      await setProgramAllocations({
        programId: program.id,
        allocations: rows.map((r) => {
          const who = cMode === 'own' ? ownOf(r.groupId) : pickedPerson;
          const prof = who ? profiles[who.userId] : undefined;
          return { ...r, ...(who && prof?.name ? { collectorName: prof.name } : {}), ...(cMode === 'pick' ? (phone.trim() || prof?.phone ? { collectorPhone: phone.trim() || prof?.phone } : {}) : prof?.phone ? { collectorPhone: prof.phone } : {}), ...(due ? { dueMs: new Date(due).getTime() } : {}) };
        }),
      });
      notify(`${rows.length} kurel${rows.length === 1 ? '' : 's'} allocated`, 'success');
      onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Shell title={`Allocate the envelope · ${program.name}`} sub={`Goal ${money(program.goalAmountCents, cur)}${program.phase1Cents ? ` · phase 1 ${money(program.phase1Cents, cur)}` : ''} · already allocated ${money(allocs.reduce((n, a) => n + a.amountCents, 0), cur)}`} onClose={onClose}
      footer={<>{err && <span className="fm-err">{err}</span>}<button type="button" className="fm-ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fm-go" disabled={busy} onClick={save}>{busy ? tx("Saving…") : tx("Save the allocation")}</button></>}>
      <section className="fm-sec">
        <h3>{tx("1 · Who receives it")}</h3>
        <p className="fm-note">{program.scopeAllGroups ? tx("This program is for all kurels. Filter by country, city, local zone or level, then select what is shown.") : `This program is for ${program.groupIds.length} chosen kurels. Filter inside them.`}</p>
        <KurelPicker allowed={allowed} selected={sel} onChange={setSel} height={190} />
      </section>
      <section className="fm-sec">
        <h3>{tx("2 · How much")}</h3>
        <div className="fm-cur wide" role="group" aria-label={tx("How to share")}>
          <button type="button" className={mode === 'each' ? 'on' : ''} onClick={() => setMode('each')}>{tx("Same amount for each")}</button>
          <button type="button" className={mode === 'equal' ? 'on' : ''} onClick={() => setMode('equal')}>{tx("Share one amount equally")}</button>
          <button type="button" className={mode === 'custom' ? 'on' : ''} onClick={() => setMode('custom')}>{tx("Amount per kurel")}</button>
        </div>
        {mode === 'each' && (
          <div className="fm-auto">
            <div><small>{tx("Free to give")}{program.baseCents ? tx(" in the current phase") : ''}</small><b>{money(free, cur)}</b></div>
            <i>÷</i>
            <div><small>{tx("Chosen kurels")}</small><b>{sel.length}</b></div>
            <i>=</i>
            <div className="hl"><small>{tx("Each kurel receives")}</small><b>{sel.length ? money(each, cur) : '—'}</b></div>
          </div>
        )}
        {mode === 'equal' && <label className="fm-f">{`Total to share (${cur})`}<input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={tx("Add amount")} /></label>}
        {mode === 'custom' && <div className="fm-cust">{sel.map((id) => <label key={id}><span>{byId[id]?.name ?? id}</span><input type="number" min={0} step="any" value={custom[id] ?? ''} onChange={(e) => setCustom((c) => ({ ...c, [id]: e.target.value }))} placeholder={tx("Add amount")} /></label>)}{sel.length === 0 && <p className="fm-note">{tx("Choose kurels above first.")}</p>}</div>}
        <div className={`fm-sum${left < 0 ? ' bad' : ''}`}><span><b>{sel.length}</b> {tx("kurels")}</span><span>{tx("New total")} <b>{money(newTotal, cur)}</b></span><span>{left < 0 ? tx("Over the goal by") : tx("Still free")} <b>{money(Math.abs(left), cur)}</b></span></div>
      </section>
      <section className="fm-sec">
        <h3>{tx("3 · Who collects")} <small>{tx("Finance/Social members")}</small></h3>
        <div className="fm-cur wide" role="group" aria-label={tx("Who collects")}>
          <button type="button" className={cMode === 'own' ? 'on' : ''} onClick={() => setCMode('own')}>{tx("Each kurel's own Finance/Social member")}</button>
          <button type="button" className={cMode === 'pick' ? 'on' : ''} onClick={() => setCMode('pick')}>{tx("Choose one person for all")}</button>
        </div>
        {cMode === 'own' ? (
          <p className="fm-note">{sel.length === 0 ? tx("Choose kurels first. Each one will pay its own Finance/Social member.") : without.length === 0 ? `All ${sel.length} chosen kurels have a Finance/Social member. Each one collects for its own kurel.` : `${sel.length - without.length} of ${sel.length} chosen kurels have a Finance/Social member. No collector is named for: ${without.slice(0, 6).map((id) => byId[id]?.name ?? id).join(', ')}${without.length > 6 ? ` and ${without.length - 6} more` : ''}.`}</p>
        ) : (
          <>
            <div className="fm-cbar">
              <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Name or kurel")} value={cq} onChange={(e) => setCq(e.target.value)} /></label>
              <button type="button" className={onlyChosen ? 'on' : ''} onClick={() => setOnlyChosen((o) => !o)}>{onlyChosen ? tx("Of the chosen kurels") : tx("Everyone")}</button>
            </div>
            <div className="fm-people">
              {shown.map((c) => { const pr = profiles[c.userId]; const k = `${c.kurelId}_${c.userId}`; const loc = locationOf(c.kurelId); return (
                <button type="button" key={k} className={picked === k ? 'on' : ''} onClick={() => { setPicked(k); setPhone(pr?.phone ?? ''); }}>
                  <Avatar name={pr?.name || '…'} photoUrl={pr?.photoUrl} size={38} />
                  <span><b>{pr?.name || '…'}</b><small>{byId[c.kurelId]?.name ?? ''}{loc.city ? ` · ${loc.city.name}` : ''}</small><em>{c.role}{pr?.phone ? ` · ${pr.phone}` : ''}</em></span>
                </button>
              ); })}
              {shown.length === 0 && <p className="kp-none">{tx("No Finance/Social member matches.")}</p>}
            </div>
            <label className="fm-f">{tx("Wave / Orange Money number")}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx("Number members pay to")} /></label>
          </>
        )}
        <DatePicker label={tx("Due date")} value={due} onChange={setDue} />
      </section>
    </Shell>
  );
}

/** The kurel's allocation divided among its members. */
export function SplitModal({ program, allocs, onClose }: { program: ProgramInfo; allocs: AllocRow[]; onClose: () => void }) {
  const { byId, locationOf, countries, cities } = useGroupHierarchy();
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [groupId, setGroupId] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cur = program.currency;
  const members = useGroupMembers(groupId);
  const existing = useCollection<{ userId: string; amountCents: number }>('memberShares', [where('programId', '==', program.id), where('groupId', '==', groupId || '__none__')], groupId);
  useEffect(() => { setVals(Object.fromEntries((existing ?? []).map((x) => [x.userId, String(x.amountCents / 100)]))); }, [existing, groupId]);
  const choices = allocs.filter((a) => { const l = locationOf(a.groupId); return (!country || l.country?.id === country) && (!city || l.city?.id === city); });
  const cap = allocs.find((a) => a.groupId === groupId)?.amountCents ?? 0;
  const total = members.reduce((n, m) => n + Math.round((Number(vals[m.id]) || 0) * 100), 0);
  const equally = () => { const each = members.length ? Math.floor(cap / members.length) / 100 : 0; setVals(Object.fromEntries(members.map((m) => [m.id, String(each)]))); };

  async function save() {
    setErr('');
    if (!groupId) return setErr(tx("Choose a kurel."));
    if (total > cap) return setErr(`The shares are ${money(total - cap, cur)} above the kurel allocation.`);
    setBusy(true);
    try {
      await setMemberShares({ programId: program.id, groupId, shares: members.filter((m) => vals[m.id] !== undefined && vals[m.id] !== '').map((m) => ({ userId: m.id, amountCents: Math.round(Number(vals[m.id]) * 100) })) });
      notify('Split saved', 'success');
      onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Shell title={`Split among members · ${program.name}`} sub={tx("Divide a kurel's allocation among its members. The total cannot go above the allocation.")} onClose={onClose}
      footer={<>{err && <span className="fm-err">{err}</span>}<button type="button" className="fm-ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fm-go" disabled={busy || !groupId} onClick={save}>{busy ? tx("Saving…") : tx("Save the split")}</button></>}>
      <section className="fm-sec">
        <h3>{tx("1 · Choose the kurel")}</h3>
        <div className="fm-3">
          <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); setGroupId(''); }} allLabel="All countries" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
          <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setGroupId(''); }} allLabel="All cities" options={cities.filter((c) => !country || locationOf(c.id).country?.id === country || c.parentGroupId === country).map((c) => ({ value: c.id, label: c.name }))} />
          <Dropdown label={tx("Kurel with an allocation")} value={groupId} onChange={setGroupId} options={choices.map((a) => ({ value: a.groupId, label: byId[a.groupId]?.name ?? a.groupId, hint: money(a.amountCents, cur) }))} />
        </div>
        {allocs.length === 0 && <p className="fm-note">{tx("No kurel has an allocation yet. Allocate the envelope first.")}</p>}
      </section>
      {groupId && (
        <section className="fm-sec">
          <h3>{tx("2 · Members")} <small>{members.length}</small></h3>
          <div className="fm-ph-bar"><button type="button" onClick={equally}>{tx("Split equally")}</button><button type="button" onClick={() => setVals({})}>{tx("Clear")}</button><span className={total > cap ? 'bad' : ''}>{money(total, cur)} {tx("of")} {money(cap, cur)}</span></div>
          <div className="fm-cust">{members.map((m) => <label key={m.id}><span>{m.name}{m.substitute ? tx(" (substitute)") : ''}</span><input type="number" min={0} step="any" value={vals[m.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [m.id]: e.target.value }))} placeholder={tx("Add amount")} /></label>)}</div>
        </section>
      )}
    </Shell>
  );
}

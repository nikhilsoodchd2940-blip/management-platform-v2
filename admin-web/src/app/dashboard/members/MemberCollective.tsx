'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Light { id: string; status: string; registered: boolean; hasPhoto: boolean; online: boolean; kurels: string[] }
interface Loc { city?: { id: string; name: string }; country?: { id: string; name: string } }
interface Agg { rate: number | null; records: number; absPending: number; welfareOpen: number; paid: number; tasksOpen: number; late: number; cases: number }

const CAP = 600;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const PRESENT = new Set(['PRESENT', 'LATE', 'LATE_APPROVED']);
const num = (n: number) => n.toLocaleString(dateLocale());

async function pull(coll: string, field: string, ids: string[], op: 'in' | 'array-contains-any' = 'in') {
  const out: Record<string, unknown>[] = [];
  const parts = await Promise.all(chunk(ids, 30).map((c) => getDocs(query(collection(db, coll), where(field, op, c))).catch(() => null)));
  parts.forEach((p) => p?.docs.forEach((d) => out.push(d.data())));
  return out;
}

/** The whole selection at a glance: who they are, where they are, and how they take part. Follows every filter above it. */
export function MemberCollective({ rows, byId, locationOf, scoped, onCity, onKurel, onCountry, onFilter }: { rows: Light[]; byId: Record<string, { name: string; capacity?: number }>; locationOf: (id: string) => Loc; scoped: boolean; onCity: (id: string) => void; onKurel: (id: string) => void; onCountry: (id: string) => void; onFilter: (f: { status?: string; profile?: string; app?: string; presence?: string; kurelCount?: string }) => void }) {
  const ids = useMemo(() => rows.map((r) => r.id).slice(0, CAP), [rows]);
  const idKey = ids.join(',');
  const [agg, setAgg] = useState<Agg | null>(null);
  const [more, setMore] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (ids.length === 0) { setAgg({ rate: null, records: 0, absPending: 0, welfareOpen: 0, paid: 0, tasksOpen: 0, late: 0, cases: 0 }); return; }
    let off = false;
    setAgg(null);
    const t = window.setTimeout(async () => {
      const [att, abs, wel, con, tsk, dis] = await Promise.all([
        pull('attendance', 'userId', ids), pull('absenceRequests', 'userId', ids), pull('welfareRequests', 'userId', ids),
        pull('contributions', 'userId', ids), pull('tasks', 'assigneeIds', ids, 'array-contains-any'), pull('disciplinaryCases', 'memberId', ids),
      ]);
      if (off) return;
      const present = att.filter((a) => PRESENT.has(String(a.status))).length;
      const open = tsk.filter((x) => x.status !== 'done' && x.status !== 'cancelled');
      const toMs = (v: unknown) => (v && typeof (v as { toMillis?: () => number }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0);
      setAgg({
        rate: att.length ? Math.round((present / att.length) * 100) : null,
        records: att.length,
        absPending: abs.filter((a) => a.status === 'pending').length,
        welfareOpen: wel.filter((w) => w.status !== 'closed').length,
        paid: con.filter((c) => c.status === 'validated').reduce((s, c) => s + Number(c.amountCents ?? 0), 0),
        tasksOpen: open.length,
        late: open.filter((x) => { const d = toMs(x.dueAt); return d && d < Date.now(); }).length,
        cases: dis.filter((c) => c.status !== 'closed').length,
      });
    }, 350);
    return () => { off = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const s = useMemo(() => {
    let active = 0, suspended = 0, registered = 0, online = 0, multi = 0, none = 0, incomplete = 0;
    const byCountry = new Map<string, { name: string; n: number }>();
    const byCity = new Map<string, { name: string; n: number }>();
    const byKurel = new Map<string, number>();
    for (const r of rows) {
      if (r.status === 'disabled') suspended++; else active++;
      if (r.registered) registered++;
      if (r.online) online++;
      if (r.kurels.length > 1) multi++;
      if (r.kurels.length === 0) none++;
      if (!r.hasPhoto) incomplete++;
      const seenCountry = new Set<string>(), seenCity = new Set<string>();
      for (const g of r.kurels) {
        byKurel.set(g, (byKurel.get(g) ?? 0) + 1);
        const loc = locationOf(g);
        if (loc.country && !seenCountry.has(loc.country.id)) { seenCountry.add(loc.country.id); const c = byCountry.get(loc.country.id) ?? { name: loc.country.name, n: 0 }; c.n++; byCountry.set(loc.country.id, c); }
        if (loc.city && !seenCity.has(loc.city.id)) { seenCity.add(loc.city.id); const c = byCity.get(loc.city.id) ?? { name: loc.city.name, n: 0 }; c.n++; byCity.set(loc.city.id, c); }
      }
    }
    const top = <T extends { n: number }>(m: Map<string, T>, k = 8) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, k);
    return { active, suspended, registered, online, multi, none, incomplete, countries: top(byCountry, 8), cities: top(byCity), kurels: [...byKurel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) };
  }, [rows, locationOf]);

  const total = rows.length;
  const max = (a: { n: number }[]) => Math.max(1, ...a.map((x) => x.n));
  const Bar = ({ label, n, of, on }: { label: string; n: number; of: number; on?: () => void }) => (
    <button type="button" className="mc-bar" onClick={on} disabled={!on}><span>{label}</span><u><i style={{ width: `${Math.round((n / of) * 100)}%` }} /></u><b>{num(n)}</b></button>
  );

  return (
    <section className="card mc">
      <div className="panel-head">
        <div>
          <h2>{scoped ? tx("Selected members at a glance") : tx("All members at a glance")}</h2>
          <p>{num(total)} {tx("members")} · {tx("follows the filters above")}</p>
        </div>
        <button type="button" className="mc-toggle" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? tx("Hide details") : tx("Show details")} <i>{more ? '▴' : '▾'}</i></button>
      </div>
      <div className="mc-kpis">
        <button type="button" onClick={() => onFilter({})}><b>{num(total)}</b><span>{tx("Members")}</span></button>
        <button type="button" onClick={() => onFilter({ status: 'active' })}><b>{num(s.active)}</b><span>{tx("Active")}</span></button>
        <button type="button" className={s.suspended ? 'hot' : ''} onClick={() => onFilter({ status: 'suspended' })}><b>{num(s.suspended)}</b><span>{tx("Suspended")}</span></button>
        <button type="button" onClick={() => onFilter({ app: 'registered' })}><b>{num(s.registered)}</b><span>{tx("In the app")}</span></button>
        <button type="button" className="gold" onClick={() => onFilter({ presence: 'online' })}><b>{num(s.online)}</b><span>{tx("Online now")}</span></button>
        <button type="button" onClick={() => onFilter({ kurelCount: 'multi' })}><b>{num(s.multi)}</b><span>{tx("In several kurels")}</span></button>
        <button type="button" className={s.none ? 'hot' : ''} onClick={() => onFilter({ kurelCount: '0' })}><b>{num(s.none)}</b><span>{tx("Without a kurel")}</span></button>
        <button type="button" onClick={() => onFilter({ profile: 'incomplete' })}><b>{num(s.incomplete)}</b><span>{tx("Incomplete profile")}</span></button>
      </div>
      {more && <div className="mc-act">
        <header><b>{tx("Participation")}</b><small>{total > CAP ? `${tx("based on the first")} ${CAP} ${tx("members")}` : tx("all members shown")}</small></header>
        {!agg ? <div className="mm-empty">{tx("Loading…")}</div> : (
          <div className="mc-tiles">
            <button type="button" className="g" onClick={() => router.push('/dashboard/events')}><b>{agg.rate === null ? '—' : `${agg.rate}%`}</b><span>{tx("Event attendance")}</span><small>{num(agg.records)} {tx("records")}</small></button>
            <button type="button" className="b" onClick={() => router.push('/dashboard/requests')}><b>{num(agg.absPending)}</b><span>{tx("Absence requests pending")}</span></button>
            <button type="button" className="b" onClick={() => router.push('/dashboard/requests')}><b>{num(agg.welfareOpen)}</b><span>{tx("Welfare requests open")}</span></button>
            <button type="button" className="y" onClick={() => router.push('/dashboard/donations')}><b>{agg.paid ? num(Math.round(agg.paid / 100)) : '—'}</b><span>{tx("Contributions validated")}</span></button>
            <button type="button" className="p" onClick={() => router.push('/dashboard/tasks')}><b>{num(agg.tasksOpen)}</b><span>{tx("Open tasks")}</span><small>{agg.late ? `${num(agg.late)} ${tx("late")}` : tx("Nothing late")}</small></button>
            <button type="button" className="r" onClick={() => router.push('/dashboard/disciplinary')}><b>{num(agg.cases)}</b><span>{tx("open disciplinary cases")}</span></button>
          </div>
        )}
      </div>}
      {more && <div className="mc-cols">
        <div><h4>{tx("By country")}</h4>{s.countries.length === 0 && <small>—</small>}{s.countries.map(([id, c]) => <Bar key={id} label={c.name} n={c.n} of={max(s.countries.map((x) => x[1]))} on={() => onCountry(id)} />)}</div>
        <div><h4>{tx("Biggest cities")}</h4>{s.cities.length === 0 && <small>—</small>}{s.cities.map(([id, c]) => <Bar key={id} label={c.name} n={c.n} of={max(s.cities.map((x) => x[1]))} on={() => onCity(id)} />)}</div>
        <div><h4>{tx("Biggest kurels")}</h4>{s.kurels.length === 0 && <small>—</small>}{s.kurels.map(([id, n]) => <Bar key={id} label={byId[id]?.name ?? id} n={n} of={Math.max(1, ...s.kurels.map((x) => x[1]))} on={() => onKurel(id)} />)}</div>
      </div>}
    </section>
  );
}

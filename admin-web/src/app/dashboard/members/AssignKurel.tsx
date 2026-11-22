'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { assignMemberToGroups } from '@/lib/functions';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import Dropdown from '@/components/Dropdown';
import { DEFAULT_MEMBER_PHOTO } from '@/components/MemberPicker';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

export interface AssignMember { id: string; name: string; memberId: string; photoUrl: string; kurels: string[] }

/** Assign one member to a kurel: pick the member on the left, then press "Assign" on the kurel you want. */
export default function AssignKurel({ members, headcount, initialId, onClose }: { members: AssignMember[]; headcount: Record<string, number>; initialId?: string; onClose: () => void }) {
  const { byId, locationOf, countries, cities, activeLeafGroups } = useGroupHierarchy();
  const { byId: levelById } = useLevels();
  const [pick, setPick] = useState(initialId ?? '');
  const [mq, setMq] = useState('');
  const [kq, setKq] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [mCountry, setMCountry] = useState('');
  const [mCity, setMCity] = useState('');
  const [mGroup, setMGroup] = useState('');
  const [mState, setMState] = useState('');
  const [busy, setBusy] = useState('');
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const person = members.find((m) => m.id === pick);
  const mine = useMemo(() => new Set([...(person?.kurels ?? []), ...(added[pick] ?? [])]), [person, added, pick]);
  const people = useMemo(() => {
    const t = mq.trim().toLowerCase();
    return members.filter((m) => {
      if (t && !m.name.toLowerCase().includes(t) && !m.memberId.toLowerCase().includes(t)) return false;
      const ks = [...m.kurels, ...(added[m.id] ?? [])];
      if (mState === 'none' ? ks.length > 0 : mState === 'one' ? ks.length !== 1 : mState === 'multi' ? ks.length < 2 : false) return false;
      if (mGroup && !ks.includes(mGroup)) return false;
      if (mCountry && !ks.some((g) => locationOf(g).country?.id === mCountry)) return false;
      if (mCity && !ks.some((g) => locationOf(g).city?.id === mCity)) return false;
      return true;
    }).slice(0, 80);
  }, [members, mq, mState, mGroup, mCountry, mCity, added, locationOf]);
  const kurels = useMemo(() => {
    const t = kq.trim().toLowerCase();
    return activeLeafGroups
      .filter((g) => {
        const loc = locationOf(g.id);
        if (country && loc.country?.id !== country) return false;
        if (city && loc.city?.id !== city) return false;
        return !t || g.name.toLowerCase().includes(t) || (loc.city?.name ?? '').toLowerCase().includes(t);
      })
      .sort((a, b) => Number(mine.has(a.id)) - Number(mine.has(b.id)) || a.name.localeCompare(b.name))
      .slice(0, 120);
  }, [activeLeafGroups, kq, country, city, locationOf, mine]);

  async function assign(groupId: string) {
    if (!person) return;
    setBusy(groupId);
    try {
      await assignMemberToGroups({ userId: person.id, groupIds: [groupId], strict: true });
      setAdded((a) => ({ ...a, [person.id]: [...(a[person.id] ?? []), groupId] }));
      notify(`${person.name} → ${byId[groupId]?.name ?? ''}`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message.replace(/^.*?:\s*/, '') : 'Could not assign', 'error');
    } finally { setBusy(''); }
  }

  if (!mounted) return null;
  return createPortal(
    <div className="manage-page akp" role="dialog" aria-modal="true" aria-label={tx("Assign to a Group")}>
      <div className="manage-page-bar"><strong>{tx("Assign to a Group")}</strong><button type="button" className="manage-close" onClick={onClose}>{tx("Close")}</button></div>
      <div className="manage-page-body ak-body">
        <section className="ak-col">
          <header><span className="ak-n">1</span><div><b>{tx("Choose the member")}</b><small>{tx("Search by name or member ID")}</small></div></header>
          <div className="ak-mf">
            <input type="search" placeholder={tx("Search a member")} value={mq} onChange={(e) => setMq(e.target.value)} autoFocus={!pick} />
            <Dropdown label={tx("Country")} value={mCountry} onChange={(v) => { setMCountry(v); setMCity(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("City")} value={mCity} onChange={setMCity} allLabel={tx("All cities")} options={cities.filter((c) => !mCountry || c.parentGroupId === mCountry).map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("Group")} value={mGroup} onChange={setMGroup} allLabel={tx("All groups")} options={activeLeafGroups.map((g) => ({ value: g.id, label: g.name }))} />
            <Dropdown label={tx("Groups per member")} value={mState} onChange={setMState} allLabel={tx("Any number of kurels")} options={[{ value: 'none', label: tx("Without a kurel") }, { value: 'one', label: tx("1 kurel") }, { value: 'multi', label: tx("2 kurels or more") }]} />
          </div>
          <div className="ak-list">
            {people.map((m) => (
              <button type="button" key={m.id} className={`ak-person${pick === m.id ? ' on' : ''}`} onClick={() => setPick(m.id)}>
                <img alt="" src={m.photoUrl || DEFAULT_MEMBER_PHOTO} />
                <span><b>{m.name || tx("(no name)")}</b><small>{m.memberId || '—'} · {m.kurels.length + (added[m.id]?.length ?? 0)} {tx("group")}</small></span>
              </button>
            ))}
            {people.length === 0 && <div className="mm-empty">{tx("No member matches.")}</div>}
          </div>
        </section>
        <section className="ak-col wide">
          <header><span className="ak-n">2</span><div><b>{person ? `${tx("Assign")} ${person.name}` : tx("Choose the group")}</b><small>{person ? tx("Select the group you want to assign this member to.") : tx("Pick a member first")}</small></div></header>
          <div className="ak-filters">
            <input type="search" placeholder={tx("Search a group or city")} value={kq} onChange={(e) => setKq(e.target.value)} />
            <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            <Dropdown label={tx("City")} value={city} onChange={setCity} allLabel={tx("All cities")} options={cities.filter((c) => !country || c.parentGroupId === country).map((c) => ({ value: c.id, label: c.name }))} />
          </div>
          <div className="ak-grid">
            {kurels.map((g) => {
              const n = headcount[g.id] ?? 0;
              const cap = g.capacity;
              const full = cap !== undefined && n >= cap;
              const loc = locationOf(g.id);
              const has = mine.has(g.id);
              return (
                <article key={g.id} className={`ak-k${has ? ' has' : ''}${full ? ' full' : ''}`}>
                  <div><b>{g.name}</b><small>{[loc.city?.name, loc.country?.name].filter(Boolean).join(' · ') || '—'}</small></div>
                  <div className="ak-meta"><span>{g.levelId && levelById[g.levelId] ? levelById[g.levelId].name : tx("No level")}</span><span>{n}{cap !== undefined ? ` / ${cap}` : ''} {tx("seats")}</span></div>
                  {cap !== undefined && <div className="ak-bar"><i style={{ width: `${Math.min(100, Math.round((n / Math.max(1, cap)) * 100))}%` }} /></div>}
                  <button type="button" className={has ? 'ok' : 'go'} disabled={!person || has || full || busy === g.id} onClick={() => void assign(g.id)}>
                    {has ? `✓ ${tx("Assigned")}` : full ? tx("Full") : busy === g.id ? '…' : tx("Assign")}
                  </button>
                </article>
              );
            })}
            {kurels.length === 0 && <div className="mm-empty">{tx("No group matches.")}</div>}
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}

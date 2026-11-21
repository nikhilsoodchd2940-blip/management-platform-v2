'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { Avatar } from './MemberPicker';
import { setMembershipSeat } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

interface Profile {
  name: string;
  phone: string;
  email: string;
  memberId: string;
  photoUrl: string;
  status: string;
  groups: { id: string; role: string; substitute: boolean }[];
}

/** A member's profile in a pop-up: photo, contact details, status and kurels. Close it with the button, Escape or a click outside. */
export function MemberProfileDialog({ userId, kurelId, onClose }: { userId: string; kurelId?: string; onClose: () => void }) {
  const { byId, locationOf } = useGroupHierarchy();
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const u = await getDoc(doc(db, 'users', userId));
        if (!u.exists()) { if (!off) setErr(tx("This member was not found.")); return; }
        const x = u.data();
        let groups: Profile['groups'] = [];
        try {
          const m = await getDocs(query(collection(db, 'groupMemberships'), where('userId', '==', userId), where('status', '==', 'active')));
          groups = m.docs.map((d) => ({ id: d.data().groupId as string, role: (d.data().role as string) || 'member', substitute: d.data().substitute === true }));
        } catch { /* the kurels are optional */ }
        if (!off) setP({ name: (x.displayName as string) || '(no name)', phone: (x.phone as string) || '', email: (x.email as string) || '', memberId: (x.memberId as string) || '', photoUrl: (x.photoUrl as string) || '', status: (x.status as string) || 'active', groups });
      } catch {
        if (!off) setErr(tx("Could not load this profile."));
      }
    })();
    return () => { off = true; };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [busy, setBusy] = useState(false);
  const here = kurelId ? p?.groups.find((g) => g.id === kurelId) : undefined;
  const changeSeat = async () => {
    if (!here || !kurelId) return;
    setBusy(true);
    try {
      await setMembershipSeat({ userId, groupId: kurelId, substitute: !here.substitute });
      setP((x) => x && { ...x, groups: x.groups.map((g) => (g.id === kurelId ? { ...g, substitute: !here.substitute } : g)) });
      notify(here.substitute ? 'Now a permanent member' : 'Now a substitute', 'success');
    } catch (e) { notify((e as Error).message, 'error'); }
    setBusy(false);
  };
  const row = (label: string, value: string) => (value ? <div className="mpf-row"><span>{label}</span><b>{value}</b></div> : null);
  return createPortal(
    <div className="fx-backdrop mpf-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mpf" role="dialog" aria-modal="true" aria-label={tx("Member profile")}>
        <button type="button" className="mpf-x" aria-label={tx("Close the profile")} onClick={onClose}>×</button>
        {!p && !err && <p className="mpf-wait">{tx("Loading the profile…")}</p>}
        {err && <p className="mpf-wait">{err}</p>}
        {p && (
          <>
            <div className="mpf-top">
              <Avatar name={p.name} photoUrl={p.photoUrl} size={96} />
              <h3>{p.name}</h3>
              <span className={`mpf-st ${p.status === 'disabled' ? 'off' : 'on'}`}>{p.status === 'disabled' ? tx("Suspended") : tx("Active")}</span>
            </div>
            <div className="mpf-rows">
              {row('Member ID', p.memberId)}
              {row('Phone', p.phone)}
              {row('Email', p.email)}
            </div>
            {here && kurelId && (
              <div className={`mpf-seat ${here.substitute ? 'sub' : 'perm'}`}>
                <div><small>{tx("Seat in")} {byId[kurelId]?.name ?? tx("this kurel")}</small><b>{here.role === 'host' ? tx("Host (permanent)") : here.substitute ? tx("Substitute") : tx("Permanent member")}</b></div>
                {here.role !== 'host' && <button type="button" className="btn btn-primary" disabled={busy} onClick={changeSeat}>{busy ? tx("Saving…") : here.substitute ? tx("Make permanent") : tx("Make substitute")}</button>}
              </div>
            )}
            <div className="mpf-groups">
              <h4>{tx("Kurels")}</h4>
              {p.groups.length === 0 ? <p>{tx("Not in any kurel.")}</p> : (
                <ul>
                  {p.groups.map((g) => {
                    const loc = locationOf(g.id);
                    return <li key={g.id}><b>{byId[g.id]?.name ?? g.id}</b><span>{[loc.city?.name, loc.country?.name].filter(Boolean).join(', ')}{g.role === 'host' ? tx(" · Host") : ''}</span></li>;
                  })}
                </ul>
              )}
            </div>
            <button type="button" className="btn btn-primary mpf-close" onClick={onClose}>{tx("Close")}</button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/** A small "Profile" button that opens the member's profile pop-up. */
export function ViewProfile({ userId, label = 'Profile', className = '' }: { userId: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`mpf-btn ${className}`} title={tx("See the profile")} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>{label}</button>
      {open && <MemberProfileDialog userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Wraps a person (photo and name) so that clicking it opens their profile. `as` keeps the surrounding layout styles working. */
export function PersonLink({ userId, kurelId, as: Tag = 'span', children }: { userId: string; kurelId?: string; as?: 'span' | 'em'; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const go = () => setOpen(true);
  return (
    <>
      <Tag className="plink" role="button" tabIndex={0} title={tx("Open the profile")} onClick={go} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>{children}</Tag>
      {open && <MemberProfileDialog userId={userId} kurelId={kurelId} onClose={() => setOpen(false)} />}
    </>
  );
}

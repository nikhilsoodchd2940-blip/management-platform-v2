'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { ACCESS_ROLE_LABEL } from '@/components/AccessDialog';
import type { UserProfileLite } from '@/lib/useUserNames';
import { tx } from '@/lib/i18n/tr';

export interface Responsible { userId: string; role: string; where: string }

/** The sheet of one country or city: where it is on a map, how many kurels it holds, and who is responsible, with call and WhatsApp buttons. */
export default function LocationSheet({ kind, name, country, kurels, people, profiles, onClose, onManage }: {
  kind: 'country' | 'city'; name: string; country: string; kurels: number; people: Responsible[]; profiles: Record<string, UserProfileLite>; onClose: () => void; onManage: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const query = kind === 'city' ? `${name}, ${country}` : name;
  const first = people[0];
  const p = first ? profiles[first.userId] : undefined;
  const digits = (p?.phone ?? '').replace(/\D/g, '');
  const others = people.slice(1);
  return createPortal(
    <div className="lsh-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lsh" role="dialog" aria-modal="true" aria-label={name}>
        <div className="lsh-bar"><span>{tx("Location sheet")}</span><button type="button" onClick={onClose}>✕ {tx("Close")}</button></div>
        <header className="lsh-head">
          <div>
            <small>{kind === 'city' ? `${country} · ${tx("City")}` : tx("Country")}</small>
            <h2>{name}</h2>
            <span>{tx("Organization map")}</span>
          </div>
          <div className="lsh-count"><b>{kurels}</b><span>{tx("Kurels")}</span></div>
        </header>
        <div className="lsh-body">
          <section className="lsh-card">
            <span className="lsh-cap">{tx("Responsible")}</span>
            {first ? (
              <>
                <div className="lsh-who">
                  <Avatar name={p?.name || '…'} photoUrl={p?.photoUrl} size={84} />
                  <div>
                    <small>{tx(ACCESS_ROLE_LABEL[first.role] ?? first.role)} · {first.where}</small>
                    <PersonLink userId={first.userId}><b>{p?.name || tx("Loading…")}</b></PersonLink>
                  </div>
                </div>
                <div className="lsh-phone"><small>{tx("Phone")}</small><b>{p?.phone || '—'}</b></div>
                <div className="lsh-btns">
                  {p?.phone ? <a className="call" href={`tel:${p.phone}`}>📞 {tx("Call")}</a> : <span className="call off">📞 {tx("Call")}</span>}
                  {digits ? <a className="wa" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">💬 WhatsApp</a> : <span className="wa off">💬 WhatsApp</span>}
                </div>
                {others.length > 0 && (
                  <div className="lsh-others">
                    <span className="lsh-cap">{tx("Also responsible")}</span>
                    {others.map((r, i) => (
                      <div key={`${r.userId}${i}`}><Avatar name={profiles[r.userId]?.name || '…'} photoUrl={profiles[r.userId]?.photoUrl} size={32} /><span><PersonLink userId={r.userId}><b>{profiles[r.userId]?.name || '…'}</b></PersonLink><small>{tx(ACCESS_ROLE_LABEL[r.role] ?? r.role)} · {r.where}</small></span>{profiles[r.userId]?.phone && <a href={`tel:${profiles[r.userId].phone}`}>{profiles[r.userId].phone}</a>}</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="lsh-none"><p>{tx("No manager assigned yet.")}</p><button type="button" onClick={onManage}>{tx("Assign one")}</button></div>
            )}
          </section>
          <section className="lsh-card">
            <span className="lsh-cap">{tx("Location")}</span>
            <h3>{name}</h3>
            <small className="lsh-sub">{kind === 'city' ? `${name}, ${country}` : country}</small>
            <div className="lsh-map">
              <iframe title={name} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${kind === 'city' ? 11 : 5}&output=embed`} />
            </div>
            <a className="lsh-open" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">{tx("Open in Maps")} ↗</a>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

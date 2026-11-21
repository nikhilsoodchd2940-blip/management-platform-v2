'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { tx } from '@/lib/i18n/tr';

interface Shift { siteId?: string; siteIds?: string[]; supervisors: { userId: string; role: 'main' | 'member' }[] }
export interface CheckEvent { id: string; title: string; startMs: number; groupIds: string[]; sites: { id: string; name: string; groupIds?: string[] }[]; shifts: Shift[] }
interface Item { ok: boolean; title: string; detail?: string }

/** Before an event is published: what is still missing. Nothing here blocks the publish, it only warns. */
export default function PublishCheck({ event, onClose, onPublish }: { event: CheckEvent; onClose: () => void; onPublish: () => void }) {
  const { byId } = useGroupHierarchy();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const [slotSnap, selSnap] = await Promise.all([
        getDocs(query(collection(db, 'eventSlots'), where('eventId', '==', event.id))),
        getDocs(query(collection(db, 'performanceSelections'), where('eventId', '==', event.id))),
      ]);
      const name = (g: string) => byId[g]?.name ?? 'A group';
      const list = (xs: string[]) => (xs.length <= 4 ? xs.join(', ') : `${xs.slice(0, 4).join(', ')} and ${xs.length - 4} more`);
      const slotGroups = new Set(slotSnap.docs.map((d) => d.data().groupId as string));
      const noSlot = event.groupIds.filter((g) => !slotGroups.has(g)).map(name);
      const approved = new Set(selSnap.docs.filter((d) => d.data().status === 'approved').map((d) => (d.data().slotId as string) ?? d.id));
      const noAudio = slotSnap.docs.filter((d) => !approved.has(d.id)).map((d) => (d.data().groupName as string) ?? name(d.data().groupId as string));
      const people = event.shifts.flatMap((s) => s.supervisors);
      const many = event.sites.length > 1;
      const covers = (sh: Shift, siteId: string) => { const ids = sh.siteIds?.length ? sh.siteIds : sh.siteId ? [sh.siteId] : []; return ids.length === 0 || ids.includes(siteId); };
      const noManager = many ? event.sites.filter((st) => !event.shifts.some((sh) => covers(sh, st.id) && sh.supervisors.some((p) => p.role === 'main'))).map((st) => st.name) : [];
      const unplaced = many ? event.groupIds.filter((g) => !event.sites.some((st) => (st.groupIds ?? []).includes(g))).map(name) : [];
      const out: Item[] = [
        { ok: event.groupIds.length > 0, title: event.groupIds.length > 0 ? `${event.groupIds.length} group${event.groupIds.length === 1 ? '' : 's'} take part` : tx("No group takes part yet") },
        ...(many ? [{ ok: unplaced.length === 0, title: unplaced.length === 0 ? tx("Every group is placed at a place") : `${unplaced.length} group${unplaced.length === 1 ? ' is' : 's are'} not at any place`, detail: unplaced.length ? `${list(unplaced)}. Open Edit event, then Places.` : undefined }] : []),
        { ok: noSlot.length === 0, title: noSlot.length === 0 ? tx("Every group has a performance time") : `${noSlot.length} group${noSlot.length === 1 ? ' has' : 's have'} no performance time`, detail: list(noSlot) },
        { ok: noAudio.length === 0, title: noAudio.length === 0 ? tx("Every group has approved books") : `${noAudio.length} performance${noAudio.length === 1 ? ' has' : 's have'} no approved books yet`, detail: noAudio.length ? `${list(noAudio)}. Groups can still choose them after publishing.` : undefined },
        { ok: people.length > 0, title: people.length > 0 ? tx("Supervisors are chosen") : tx("No supervisor is chosen"), detail: people.length ? undefined : 'Nobody will be able to run the live board.' },
        ...(many ? [{ ok: noManager.length === 0, title: noManager.length === 0 ? tx("Every place has a site manager") : `${noManager.length} place${noManager.length === 1 ? ' has' : 's have'} no site manager`, detail: list(noManager) }] : []),
        { ok: event.startMs > Date.now(), title: event.startMs > Date.now() ? tx("The event starts in the future") : tx("The start time is already in the past"), detail: event.startMs > Date.now() ? undefined : 'Members will be invited to an event that has already started.' },
      ];
      if (!off) setItems(out);
    })().catch(() => { if (!off) setItems([{ ok: false, title: tx("Could not check the event"), detail: 'You can still publish.' }]); });
    return () => { off = true; };
  }, [event, byId]);

  const problems = items?.filter((i) => !i.ok).length ?? 0;
  return createPortal(
    <div className="fx-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog pc" role="dialog" aria-modal="true" aria-label={tx("Before you publish")}>
        <h2>{tx("Before you publish")}</h2>
        <p className="fx-intro">{event.title}. Publishing invites the members of every group at once.</p>
        {!items ? <p className="mpf-wait">{tx("Checking…")}</p> : (
          <ul className="pk-list">
            {items.map((i, n) => (
              <li key={n} className={i.ok ? 'ok' : 'bad'}>
                <span aria-hidden="true">{i.ok ? '✓' : '!'}</span>
                <div><b>{i.title}</b>{i.detail && <small>{i.detail}</small>}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="fx-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{tx("Go back")}</button>
          <button type="button" className="btn btn-primary" disabled={!items} onClick={onPublish}>{problems > 0 ? tx("Publish anyway") : tx("Publish")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

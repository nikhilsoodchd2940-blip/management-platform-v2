import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getEventParticipation, getParticipationInbox, type InboxList } from '@/lib/functions';

/**
 * The member lists that wait for an answer, from every event.
 * The inbox function answers in one call. If it cannot be reached, the same list is put together from the
 * events themselves (one look per event that is not over), so the page keeps working.
 */
export async function loadListInbox(): Promise<{ items: InboxList[]; canDecide: boolean }> {
  try {
    const r = await getParticipationInbox({});
    return r.data;
  } catch {
    const since = Date.now() - 86400000;
    const snap = await getDocs(query(collection(db, 'events'), where('status', '==', 'published')));
    const events = snap.docs.filter((e) => ((e.data().endAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) >= since).slice(0, 40);
    const results = await Promise.all(events.map((e) => getEventParticipation({ eventId: e.id }).then((r) => r.data).catch(() => null)));
    const items: InboxList[] = [];
    let canDecide = false;
    results.forEach((d) => {
      if (!d) return;
      if (d.canDecide) canDecide = true;
      d.groups.filter((g) => g.status === 'submitted' || g.status === 'withdrawal_pending').forEach((g) =>
        items.push({ eventId: d.eventId, title: d.title, startMs: d.startMs, groupId: g.groupId, groupName: g.groupName, status: g.status, memberCount: g.memberCount, late: g.late, submittedAtMs: g.submittedAtMs ?? null, submittedByName: g.submittedByName, withdrawalReason: g.withdrawal?.reason ?? '' }));
    });
    items.sort((a, b) => (a.submittedAtMs ?? 0) - (b.submittedAtMs ?? 0));
    return { items, canDecide };
  }
}

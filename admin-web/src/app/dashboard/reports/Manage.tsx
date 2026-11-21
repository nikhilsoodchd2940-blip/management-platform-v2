'use client';

import { scopeSnap } from '@/lib/firestore';
import { useEffect, useState } from 'react';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { collection, doc, getDoc, getDocs, getCountFromServer, getAggregateFromServer, sum, limit as fsLimit, orderBy, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { formatMoney } from '@/lib/money';
import Dropdown from '@/components/Dropdown';
import { PersonLink } from '@/components/MemberProfile';
import { Kpis, Panel, Pill } from '@/components/kit';

interface EventOption {
  id: string;
  title: string;
  status: string;
}

/**
 * Uses Firestore's server-side aggregation queries (count()/sum()) rather
 * than fetching every document and counting client-side — this is a
 * read-only reporting page, but at real org sizes a naive "fetch
 * everything" approach would be slow and expensive. The one exception is
 * the absentee list, which fetches full docs deliberately (it needs the
 * actual names, not just a count, and is bounded by one event's group size).
 */
export default function ReportsManage() {
  const { t, intlLocale } = useLocale();
  const r18 = t.reports;
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState<number | null>(null);
  const { groups: liveGroups } = useGroupHierarchy();
  const hierarchyGroups = liveGroups.filter((g) => g.status === 'active').length;
  const [totalDonationsCents, setTotalDonationsCents] = useState<number | null>(null);

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [invitedCount, setInvitedCount] = useState<number | null>(null);
  const [presentCount, setPresentCount] = useState<number | null>(null);
  const [absentees, setAbsentees] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    // "Active members" previously counted every users/{uid} doc with
    // status=='active' — but that field is just "not deactivated", so
    // it included people an Admin pre-loaded (CSV/Add member) who
    // haven't even opened the app yet, and people still waiting on
    // approval. Neither of those is a real, active app user, which is
    // why this number looked inflated. Now it's genuinely
    // registrationStatus=='approved' AND status=='active' — someone
    // who can actually use the app right now.
    getCountFromServer(
      query(collection(db, 'users'), where('registrationStatus', '==', 'approved'), where('status', '==', 'active'))
    ).then((snap) => setTotalMembers(snap.data().count));
    getCountFromServer(query(collection(db, 'users'), where('registrationStatus', '==', 'pending_approval'))).then(
      (snap) => setPendingApprovalCount(snap.data().count)
    );
    getAggregateFromServer(query(collection(db, 'donations'), where('status', '==', 'succeeded')), {
      totalCents: sum('amountCents'),
    }).then((snap) => setTotalDonationsCents(snap.data().totalCents));

    return onSnapshot(query(collection(db, 'events'), orderBy('startAt', 'desc'), fsLimit(200)), (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, title: d.data().title, status: d.data().status })));
    });
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setInvitedCount(null);
      setPresentCount(null);
      setAbsentees([]);
      return;
    }
    setLoadingReport(true);
    (async () => {
      const attendeesQuery = query(collection(db, 'eventAttendees'), where('eventId', '==', selectedEventId));
      const attendanceQuery = query(collection(db, 'attendance'), where('eventId', '==', selectedEventId));

      const [invitedSnapCount, presentSnapCount, attendeesSnap, attendanceSnap] = await Promise.all([
        getCountFromServer(attendeesQuery),
        getCountFromServer(attendanceQuery),
        getDocs(attendeesQuery),
        getDocs(attendanceQuery),
      ]);

      const mineAtt = scopeSnap(attendanceSnap);
      const mineInv = scopeSnap(attendeesSnap);
      void invitedSnapCount; void presentSnapCount;
      setInvitedCount(mineInv.size);
      setPresentCount(mineAtt.size);

      const presentUserIds = new Set(mineAtt.docs.map((d) => d.data().userId as string));
      const absentUserIds = mineInv.docs
        .map((d) => d.data().userId as string)
        .filter((id) => !presentUserIds.has(id));

      const names = await Promise.all(
        absentUserIds.map(async (userId) => {
          const userSnap = await getDoc(doc(db, 'users', userId));
          const data = userSnap.data();
          return { id: userId, name: (data?.displayName as string) ?? userId, phone: (data?.phone as string) ?? '' };
        })
      );
      setAbsentees(names);
      setLoadingReport(false);
    })();
  }, [selectedEventId]);

  const pct = invitedCount ? Math.round(((presentCount ?? 0) / invitedCount) * 100) : 0;
  return (
    <div className="zp">
      <Kpis items={[
        { icon: '👥', label: r18.activeMembers, value: totalMembers ?? '…', hint: r18.activeMembersHint },
        { icon: '⏳', label: r18.pendingApprovals, value: pendingApprovalCount ?? '…', gold: true },
        { icon: '🕌', label: r18.activeKurels, value: hierarchyGroups },
        { icon: '💰', label: r18.totalDonations, value: totalDonationsCents !== null ? formatMoney(totalDonationsCents, 'USD', intlLocale) : '…', gold: true },
      ]} />

      <Panel tone={0} title={r18.attendanceTitle} actions={invitedCount !== null && presentCount !== null && selectedEventId ? <Pill tone="ok">{presentCount} / {invitedCount} · {pct}%</Pill> : undefined}>
        <div className="loc-bar kt-bar">
          <Dropdown label={r18.eventLabel} value={selectedEventId} onChange={setSelectedEventId} allLabel={r18.selectEvent} options={events.map((ev) => ({ value: ev.id, label: `${ev.title} (${ev.status === 'published' ? r18.statusPublished : ev.status === 'cancelled' ? r18.statusCancelled : r18.statusDraft})` }))} className="loc-dd" />
        </div>
        {loadingReport && <p className="kt-empty">{t.common.loading}</p>}
        {!loadingReport && selectedEventId && invitedCount !== null && presentCount !== null && (
          <>
            <div className="att-bar"><i style={{ width: `${pct}%` }} /></div>
            <p className="kt-note"><strong>{presentCount} / {invitedCount}</strong> {r18.checkedIn}{invitedCount > 0 && ` (${pct}%)`}</p>
            {absentees.length > 0 && (
              <>
                <h3 className="att-h3">{r18.notCheckedIn} <em>{absentees.length}</em></h3>
                <div className="kt-people">
                  {absentees.map((a) => (
                    <div className="kt-person" key={a.id}>
                      <PersonLink userId={a.id}><b>{a.name}</b></PersonLink>
                      {a.phone && <a className="kt-tel" href={`tel:${a.phone}`}>{a.phone}</a>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

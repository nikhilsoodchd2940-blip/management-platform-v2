'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { collection, doc, getDoc, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { useMembershipsByUser } from '@/lib/useMemberships';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import EventPlan from '../EventPlan';
import { tx } from '@/lib/i18n/tr';

type Status = 'PRESENT' | 'LATE' | 'EXCUSED' | 'UNEXCUSED';
const STATUS_LABEL: Record<Status, string> = { PRESENT: 'Present', LATE: 'Late', EXCUSED: 'Excused absence', UNEXCUSED: 'Unexcused absence' };
interface Mark { seconds: number; status: Status; minutesLate?: number }

interface EventDoc {
  title: string;
  status: 'draft' | 'published' | 'cancelled';
  startAt: { seconds: number };
  endAt: { seconds: number };
  location: { lat: number; lng: number; address?: string };
  geofenceRadiusMeters: number;
  subGroupIds?: string[];
}

interface AttendeeRow {
  userId: string;
  displayName?: string;
  phone?: string;
  checkedIn: boolean;
  checkedInAt?: number;
  status?: Status;
  minutesLate?: number;
}

export default function EventDetailPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { t, formatDate } = useLocale();
  const e18 = t.eventDetail;

  const [event, setEvent] = useState<EventDoc | null>(null);
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [attendanceByUser, setAttendanceByUser] = useState<Record<string, Mark>>({});
  const [namesByUser, setNamesByUser] = useState<Record<string, { displayName: string; phone: string }>>({});

  useEffect(() => {
    const unsubEvent = onSnapshot(doc(db, 'events', eventId), (snap) => {
      setEvent(snap.exists() ? (snap.data() as EventDoc) : null);
    });
    const unsubAttendees = onSnapshot(
      query(collection(db, 'eventAttendees'), where('eventId', '==', eventId)),
      (snap) => setAttendeeIds(snap.docs.map((d) => d.data().userId as string))
    );
    const unsubAttendance = onSnapshot(
      query(collection(db, 'attendance'), where('eventId', '==', eventId)),
      (snap) => {
        const map: Record<string, Mark> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          map[data.userId as string] = { seconds: (data.serverTimestamp?.seconds as number) ?? 0, status: (data.status as Status) ?? 'PRESENT', minutesLate: data.minutesLate as number | undefined };
        });
        setAttendanceByUser(map);
      }
    );
    return () => {
      unsubEvent();
      unsubAttendees();
      unsubAttendance();
    };
  }, [eventId]);

  // Look up display names lazily as attendee IDs arrive — Admin can read
  // any user doc per firestore.rules, so this is a direct client read.
  useEffect(() => {
    attendeeIds.forEach(async (userId) => {
      if (namesByUser[userId]) return;
      const snap = await getDoc(doc(db, 'users', userId));
      const data = snap.data();
      if (data) {
        setNamesByUser((prev) => ({
          ...prev,
          [userId]: { displayName: data.displayName ?? '', phone: data.phone ?? '' },
        }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendeeIds]);

  const rows: AttendeeRow[] = attendeeIds
    .map((userId) => ({
      userId,
      displayName: namesByUser[userId]?.displayName,
      phone: namesByUser[userId]?.phone,
      checkedIn: attendanceByUser[userId] !== undefined && ['PRESENT', 'LATE', 'LATE_APPROVED'].includes(attendanceByUser[userId].status),
      checkedInAt: attendanceByUser[userId]?.seconds,
      status: attendanceByUser[userId]?.status,
      minutesLate: attendanceByUser[userId]?.minutesLate,
    }))
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));

  const checkedInCount = rows.filter((r) => r.checkedIn).length;

  const { byId } = useGroupHierarchy();
  const memberships = useMembershipsByUser(attendeeIds);
  const faces = useUserProfiles(attendeeIds);
  const [groupFilter, setGroupFilter] = useState('');
  const [q, setQ] = useState('');
  const inEvent = useMemo(() => new Set(event?.subGroupIds ?? []), [event?.subGroupIds]);
  const groupsOf = (userId: string) => (memberships[userId] ?? []).filter((m) => inEvent.size === 0 || inEvent.has(m.groupId));
  const eventGroups = useMemo(() => (event?.subGroupIds ?? []).map((id) => ({ id, name: byId[id]?.name ?? id })).sort((x, y) => x.name.localeCompare(y.name)), [event?.subGroupIds, byId]);
  const shown = rows.filter((r) => (!groupFilter || groupsOf(r.userId).some((m) => m.groupId === groupFilter)) && (!q.trim() || (r.displayName ?? '').toLowerCase().includes(q.trim().toLowerCase())));

  if (!event) {
    return <div><Link href="/dashboard/events" className="fx2-btn">{tx("← Back to events")}</Link><p>{t.common.loading}</p></div>;
  }

  return (
    <div>
      <Link href="/dashboard/events" className="fx2-btn" style={{ display: 'inline-block', marginBottom: '0.75rem' }}>{tx("← Back to events")}</Link>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{event.title}</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
        {formatDate(event.startAt, true)} –{' '}
        {formatDate(event.endAt, true)} · {e18.geofence(event.geofenceRadiusMeters)}
        {event.location.address ? ` · ${event.location.address}` : ''}
      </p>

      <EventPlan eventId={eventId} />

      <div className="card idl">
        <div className="idl-head">
          <div><h3>{tx("Invited members")}</h3><p>{tx("Everyone invited to this event, with the group each person performs in. Attendance is recorded in the Attendance tab of the event, where you can also change several statuses at once.")}</p></div>
          <div className="idl-kpi"><b>{checkedInCount} / {rows.length}</b><span>{e18.checkedIn}</span></div>
        </div>
        <div className="idl-filters">
          <input type="search" placeholder={tx("Search a member")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search a member")} />
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label={tx("Group")}><option value="">{tx("All groups (")}{rows.length})</option>{eventGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
          <Link href="/dashboard/events" className="btn btn-secondary">{tx("Open the Attendance tab")}</Link>
        </div>
        {rows.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)' }}>{e18.noAttendees}</p>
        ) : shown.length === 0 ? <p className="fx3-note">{tx("No member matches.")}</p> : (
          <div className="table-scroll"><table className="idl-t">
            <thead><tr><th>{e18.colName}</th><th>{tx("Group")}</th><th>{e18.colPhone}</th><th>{e18.colStatus}</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.userId} className={r.checkedIn ? 'in' : ''}>
                  <td><PersonLink userId={r.userId}><span className="idl-who"><Avatar name={r.displayName || '…'} photoUrl={faces[r.userId]?.photoUrl} size={30} /><b>{r.displayName || '…'}</b></span></PersonLink></td>
                  <td>{groupsOf(r.userId).length ? <span className="idl-groups">{groupsOf(r.userId).map((m) => <em key={m.groupId}>{byId[m.groupId]?.name ?? m.groupId}{m.substitute ? tx(" · substitute") : ''}</em>)}</span> : <small>{tx("No group")}</small>}</td>
                  <td>{r.phone}</td>
                  <td>
                    {r.status ? (
                      <span className="badge" style={{ background: r.checkedIn ? 'var(--accent-soft)' : undefined, color: r.checkedIn ? 'var(--accent)' : undefined }}>
                        {STATUS_LABEL[r.status] ?? r.status}{r.status === 'LATE' && r.minutesLate ? ` · ${r.minutesLate} min` : ''}
                      </span>
                    ) : (
                      <span className="badge badge-member">{e18.notCheckedIn}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

'use client';

import '../../px/index.css';
import { useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useCount } from '@/lib/liveStats';
import ManageToggle from '../../px/ManageToggle';
import ReportsManage from './Manage';
import AttendanceSummary from './AttendanceSummary';
import { CxBanner } from '@/components/Cx';
import { Calendar, CalendarCheck, ChevronDown, Download } from 'lucide-react';
import type { Bucket } from '@/lib/attendancePolicy';
import { tx } from '@/lib/i18n/tr';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Attendance report — the approved layout on Firebase attendance records. */
export default function AttendanceReportPage() {
  const [stamps, setStamps] = useState<number[]>([]);
  const [manageSignal, setManageSignal] = useState(0);
  const [expOpen, setExpOpen] = useState(false);
  const [focus, setFocus] = useState<'' | Bucket>('');
  const events = useCount('events', [['status', '==', 'published']]);
  const [since] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6);
    return d.getTime();
  });

  useEffect(() => {
    return onSnapshot(query(collection(db, 'attendance'), where('serverTimestamp', '>=', Timestamp.fromMillis(since)), orderBy('serverTimestamp')), (snap) =>
      setStamps(snap.docs.map((d) => (d.data().serverTimestamp as Timestamp)?.toMillis?.() ?? 0))
    );
  }, [since]);

  const perDay = useMemo(() => {
    const out = Array.from({ length: 7 }, (_, i) => ({ start: since + i * 86400000, n: 0 }));
    stamps.forEach((ms) => {
      const i = Math.floor((ms - since) / 86400000);
      if (i >= 0 && i < 7) out[i].n++;
    });
    return out;
  }, [stamps, since]);
  const today = perDay[6].n;
  const week = stamps.length;

  const labels = perDay.map((d) => DAYS[new Date(d.start).getDay()]);
  return (
    <>
      <div className="px px-index">
        <div className="zp cx-page at-page">
          <CxBanner icon={<CalendarCheck size={26} />} kicker={tx("Reports")} title={tx("Attendance Report")} sub={tx("Visual tracking of sessions, punctuality and absences by group, event and period.")}>
            <div className="at-exp"><button className="cx-btn ghost-light" type="button" aria-haspopup="menu" aria-expanded={expOpen} onClick={() => setExpOpen(!expOpen)}><Download size={16} />{tx("Export")}<ChevronDown size={15} /></button>
              {expOpen && <div className="at-expm" role="menu" onMouseLeave={() => setExpOpen(false)}><button type="button" role="menuitem" onClick={() => { setExpOpen(false); window.dispatchEvent(new Event('att-export-csv')); }}>{tx("Download CSV")}</button><button type="button" role="menuitem" onClick={() => { setExpOpen(false); window.print(); }}>{tx("Print or save as PDF")}</button></div>}</div>
            <button className="cx-btn gold" type="button" onClick={() => setManageSignal((n) => n + 1)}><Calendar size={16} />{tx("Attendance by Event")}</button>
          </CxBanner>
          <div id="att-summary"><AttendanceSummary focus={focus} onFocus={setFocus} extras={{ labels, values: perDay.map((d) => d.n), events, week, today }} /></div>
        </div>
      </div>
      <ManageToggle title={tx("Attendance by Event")} openSignal={manageSignal}>
        <ReportsManage />
      </ManageToggle>
    </>
  );
}

'use client';

import { useState } from 'react';
import { sendSupervisorMessage, type SupervisionLevel } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

type Kind = 'question' | 'urgent' | 'request';
const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'urgent', label: 'Urgent problem', hint: 'Delay, clash, safety, anything blocking' },
  { id: 'request', label: 'Request help', hint: 'People, equipment, a change of plan' },
  { id: 'question', label: 'Ask a question', hint: 'Something you need to know or decide' },
];
const TO: Record<SupervisionLevel, string> = { member: 'your site manager', manager: 'the main event supervisor', main: 'the administration', admin: '' };

/** A new report. It goes to the level just above the author, who is alerted at once and answers in the same thread. */
export default function ReportForm({ eventId, level, groups, onSent, preset }: { eventId: string; level: SupervisionLevel; groups: string[]; onSent: () => void; preset?: { about?: string; text?: string; kind?: Kind } }) {
  const [kind, setKind] = useState<Kind>(preset?.kind ?? 'urgent');
  const [about, setAbout] = useState(preset?.about ?? '');
  const [text, setText] = useState(preset?.text ?? '');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (text.trim().length < 2) return;
    setBusy(true);
    try {
      await sendSupervisorMessage({ eventId, text: text.trim(), kind, about: about || undefined });
      setText(''); setAbout('');
      notify(`Sent to ${TO[level]}. You will see the answer here.`, 'success');
      onSent();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not send', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rf">
      <h2>{tx("Report an issue")}</h2>
      <p className="rf-to">{tx("It goes to")} <b>{TO[level]}</b>{tx(", who is alerted at once. If it cannot be solved there, they send it up the chain.")}</p>
      <div className="sc-kinds" role="group" aria-label={tx("Type of report")}>
        {KINDS.map((k) => (
          <button key={k.id} type="button" className={`${k.id}${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}>
            <b>{k.label}</b><small>{k.hint}</small>
          </button>
        ))}
      </div>
      <div className="rf-row">
        <label htmlFor="rf-about">{tx("About (optional)")}</label>
        <select id="rf-about" value={about} onChange={(e) => setAbout(e.target.value)}>
          <option value="">{tx("The event in general")}</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value.slice(0, 1500))} placeholder={tx("Say what happened and what you need…")} aria-label={tx("Message")} />
      <div className="sc-foot"><small>{text.length}/1500</small><button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 2} onClick={send}>{busy ? tx("Sending…") : tx("Send report")}</button></div>
    </section>
  );
}

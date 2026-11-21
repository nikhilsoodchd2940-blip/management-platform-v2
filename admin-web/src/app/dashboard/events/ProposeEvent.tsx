'use client';

import { useState } from 'react';
import { submitEventRequest } from '@/lib/functions';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import FormDialog from '@/components/FormDialog';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

/** What a Group Admin sees instead of the create form: a proposal that goes to the Super Admin for approval. */
export default function ProposeEvent() {
  const { groups, byId } = useGroupHierarchy();
  const [open, setOpen] = useState(false);
  const mine = groups.filter((g) => g.type === 'group' && g.status === 'active');
  return (
    <div className="fx2-empty" style={{ padding: '1rem', textAlign: 'left' }}>
      <h3 style={{ margin: 0 }}>{tx("Propose an event for your group")}</h3>
      <p style={{ fontSize: '0.88rem' }}>{tx("Group Admins do not create events directly. Send a proposal; the Super Admin approves or rejects it (with a reason) and, if approved, schedules the event and your group's performance slot.")}</p>
      <button className="fx2-btn primary" onClick={() => setOpen(true)}>{tx("Propose an event")}</button>
      {open && (
        <FormDialog
          title={tx("Propose an event")}
          intro="What happens: you describe the event you want for your group, the Super Admin reviews it, and you are notified of the decision. If it is rejected, you will see the reason. Nothing is published until the Super Admin approves and schedules it."
          submitLabel={tx("Send proposal")}
          onClose={() => setOpen(false)}
          fields={[
            { name: 'groupId', label: tx("Which of your groups is proposing it?"), type: 'select', required: true, initial: mine[0]?.id ?? '', options: mine.map((g) => ({ value: g.id, label: `${g.name}${g.parentGroupId ? ` (${byId[g.parentGroupId]?.name ?? ''})` : ''}` })) },
            { name: 'title', label: tx("Event name (what the Super Admin will see)"), type: 'text', required: true },
            { name: 'start', label: tx("Proposed start (your local time)"), type: 'datetime-local', required: true },
            { name: 'end', label: tx("Proposed end (your local time)"), type: 'datetime-local', required: true },
            { name: 'notes', label: tx("Why this event, and what you need (optional)"), type: 'textarea' },
          ]}
          onSubmit={async (v) => {
            await submitEventRequest({ groupId: v.groupId, proposedTitle: v.title, proposedStartAtMs: new Date(v.start).getTime(), proposedEndAtMs: new Date(v.end).getTime(), notes: v.notes });
            notify('Proposal sent to the Super Admin', 'success');
          }}
        />
      )}
    </div>
  );
}

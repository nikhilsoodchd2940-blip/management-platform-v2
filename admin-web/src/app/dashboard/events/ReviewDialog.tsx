'use client';

import { createPortal } from 'react-dom';
import type { Selection } from './planParts';
import SelectionReview, { type OtherChoice } from './SelectionReview';
import { tx } from '@/lib/i18n/tr';

export type { OtherChoice };

/** The one-by-one decision of a submission, in a dialog (used from the event plan). */
export default function ReviewDialog({ slotId, groupName, eventTitle, selection, others, onClose }: { slotId: string; groupName: string; eventTitle?: string; selection: Selection; others: OtherChoice[]; onClose: () => void }) {
  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog" role="dialog" aria-modal="true" aria-label={tx("Review the selection")} style={{ maxWidth: 780, width: '95vw', maxHeight: '92vh', overflow: 'auto' }}>
        <h2 style={{ marginBottom: 2 }}>{groupName}</h2>
        {eventTitle && <p className="fx-intro" style={{ marginTop: 0 }}>{eventTitle}</p>}
        <SelectionReview slotId={slotId} selection={selection} others={others} onDone={onClose} initial={selection.status === 'approved' ? 'approve' : ''} />
        <div className="fx-actions"><button type="button" className="fx-btn" onClick={onClose}>{tx("Close")}</button></div>
      </div>
    </div>,
    document.body
  );
}

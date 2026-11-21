import { ns } from '../types';

export default ns({
  title: 'Requests',
  eventRequestsTitle: (n: number) => `Event requests (${n} pending)`,
  noEventRequests: 'No pending event requests.',
  colProposedBy: 'Proposed by',
  colKurel: 'Kurel',
  colTitle: 'Title',
  colWhen: 'When',
  colNotes: 'Notes',
  approve: 'Approve',
  reject: 'Reject',
  eventApprovalNote:
    "Approving marks the request as reviewed — it does not create the event automatically. Use the Events page to create and publish it once approved.",
  absenceRequestsTitle: (n: number) => `Absence requests (${n} pending)`,
  noAbsenceRequests: 'No pending absence requests.',
  colMember: 'Member',
  colReason: 'Reason',
});

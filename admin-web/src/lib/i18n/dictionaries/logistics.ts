import { ns } from '../types';

export default ns({
  title: 'Logistics',
  subtitle:
    'Created automatically when a resource request is fully approved. Pending → Assigned → Preparing → Dispatched → Delivered → Completed.',
  statuses: {
    pending: 'Pending',
    assigned: 'Assigned',
    preparing: 'Preparing',
    dispatched: 'Dispatched',
    delivered: 'Delivered',
    completed: 'Completed',
  },
  tasksUnit: 'tasks',
  allStatuses: 'All statuses',
  panelTitle: 'Logistics tasks',
  shown: (n: number) => `${n} shown`,
  empty:
    'No logistics tasks yet — they appear here as soon as a resource request receives its final approval.',
  delivery: 'Delivery:',
  assignedTo: 'Assigned to:',
  nobodyYet: 'nobody yet',
  history: 'Logistics history',
  by: 'by',
  commentPlaceholder: 'Comment (optional)',
  assignPlaceholder: 'Assign to (user ID)',
  assign: 'Assign',
  assignToMe: 'Assign to me',
  assignFirst: 'Assign someone first',
  markAs: (status: string) => `Mark as "${status}"`,
  updateFailed: 'Could not update the task',
  noUserWithId: 'No user with this ID.',
});

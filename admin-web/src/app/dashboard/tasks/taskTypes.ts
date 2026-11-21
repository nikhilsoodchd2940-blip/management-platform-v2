export type TStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskUpdate { id: string; kind: 'update' | 'feedback' | 'status' | 'created' | 'edit' | 'reminder'; text: string; byId: string; byName: string; at: unknown; progress?: number; status?: TStatus }
export interface Task {
  title: string; description?: string; assigneeIds: string[]; assigneeNames: string[];
  status: TStatus; priority: TPriority; progress: number; dueAt?: unknown;
  source: 'meeting' | 'manual'; meetingId?: string; meetingTitle?: string; pointTitle?: string;
  createdBy: string; createdByName: string; createdAt: unknown; updatedAt: unknown; completedAt?: unknown;
  autoRemind?: boolean; reminders?: { id: string; at: unknown; note?: string; sent?: boolean }[]; lastRemindedAt?: unknown; alertState?: { soon?: boolean; today?: boolean; lateDay?: string };
  updates: TaskUpdate[];
}
export type TaskRow = Task & { id: string };
export interface MeetingLite { title: string; startAt: unknown; actions?: { id: string; text: string }[] }

export const STATUS: Record<TStatus, string> = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' };
export const PRIORITY: Record<TPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

/** Whole days from today to a moment (negative when it is past). */
export function daysLeft(ms: number): number {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(ms); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export const isActive = (t: Pick<Task, 'status'>) => t.status !== 'done' && t.status !== 'cancelled';
export const isLate = (t: Pick<Task, 'status' | 'dueAt'>, tsMs: (v: unknown) => number) => isActive(t) && !!t.dueAt && daysLeft(tsMs(t.dueAt)) < 0;
export const PRIORITY_RANK: Record<TPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

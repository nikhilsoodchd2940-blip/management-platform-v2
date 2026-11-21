import { logger } from 'firebase-functions/v2';
import { db } from '../config/firebase';
import type { AuditLogDoc } from '../types/models';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Thin wrapper over firebase-functions structured logging (shows up
 * correctly in Cloud Logging severity levels) plus a helper for writing
 * to the `auditLogs` collection for sensitive actions (role changes,
 * denied QR attempts, refunds, permission changes). Every Phase-2+
 * Function that makes a security decision should call recordAudit —
 * see docs/QR_DATAFLOW.md.
 */

export const log = {
  info: (message: string, data?: Record<string, unknown>) => logger.info(message, data),
  warn: (message: string, data?: Record<string, unknown>) => logger.warn(message, data),
  error: (message: string, data?: Record<string, unknown>) => logger.error(message, data),
};

export async function recordAudit(entry: Omit<AuditLogDoc, 'createdAt'>): Promise<void> {
  await db.collection('auditLogs').add({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}

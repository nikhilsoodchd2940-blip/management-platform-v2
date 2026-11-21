import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { Twilio } from 'twilio';
import { db } from '../../config/firebase';
import { twilioAccountSid, twilioAuthToken, REMINDER_LEAD_MINUTES, REMINDER_SCHEDULE } from '../../config/env';
import { getIntegrationConfig } from '../../config/integrationConfig';
import type { EventAttendeeDoc, EventDoc, ReminderSentDoc, UserDoc } from '../../types/models';
import { log } from '../../utils/logger';

const reminderDocId = (eventId: string, userId: string) => `${eventId}_${userId}`;

/**
 * Runs every 15 minutes (REMINDER_SCHEDULE). Finds published events
 * starting within the next REMINDER_LEAD_MINUTES, and for each attendee
 * who hasn't already checked in and hasn't already been reminded for
 * THIS event (dedupe via the reminders collection's deterministic doc
 * ID), sends an SMS (if they haven't opted out) and writes an in-app
 * notification. Runs repeatedly against the same upcoming events until
 * they start — the dedupe check, not the query window, is what prevents
 * duplicate sends across runs.
 */
export const sendEventReminders = onSchedule(
  {
    schedule: REMINDER_SCHEDULE,
    secrets: [twilioAccountSid, twilioAuthToken],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const now = Date.now();
    const windowEnd = now + REMINDER_LEAD_MINUTES * 60 * 1000;

    const upcomingSnap = await db
      .collection('events')
      .where('status', '==', 'published')
      .where('startAt', '>=', Timestamp.fromMillis(now))
      .where('startAt', '<=', Timestamp.fromMillis(windowEnd))
      .get();

    if (upcomingSnap.empty) {
      log.info('sendEventReminders: no events in window', { windowEnd });
      return;
    }

    const config = await getIntegrationConfig();
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
      log.warn('sendEventReminders: Twilio is not configured — skipping this run\'s SMS sends (in-app notifications still go out below).');
    }
    const twilio = config.twilioAccountSid && config.twilioAuthToken ? new Twilio(config.twilioAccountSid, config.twilioAuthToken) : null;
    let sentCount = 0;

    for (const eventSnap of upcomingSnap.docs) {
      const event = eventSnap.data() as EventDoc;
      const eventId = eventSnap.id;

      const attendeeSnap = await db.collection('eventAttendees').where('eventId', '==', eventId).get();

      for (const attendeeDoc of attendeeSnap.docs) {
        const attendee = attendeeDoc.data() as EventAttendeeDoc;
        const userId = attendee.userId;

        const [alreadyReminded, alreadyCheckedIn] = await Promise.all([
          db.collection('reminders').doc(reminderDocId(eventId, userId)).get(),
          db.collection('attendance').doc(reminderDocId(eventId, userId)).get(),
        ]);
        if (alreadyReminded.exists || alreadyCheckedIn.exists) continue;

        const userSnap = await db.collection('users').doc(userId).get();
        if (!userSnap.exists) continue;
        const user = userSnap.data() as UserDoc;
        if (user.status !== 'active') continue;

        // Write the dedupe marker FIRST — if the SMS send fails partway,
        // we'd rather silently skip a reminder than risk double-texting
        // on retry (a missed reminder is much less costly than spam).
        const reminderDoc: ReminderSentDoc = {
          eventId,
          userId,
          sentAt: FieldValue.serverTimestamp() as unknown as ReminderSentDoc['sentAt'],
        };
        await db.collection('reminders').doc(reminderDocId(eventId, userId)).set(reminderDoc);

        await db.collection('notifications').add({
          userId,
          title: 'Upcoming event',
          body: `${event.title} starts soon.`,
          createdAt: FieldValue.serverTimestamp(),
        });

        if (twilio && config.twilioFromNumber && user.notificationsEnabled !== false && user.phone) {
          try {
            await twilio.messages.create({
              to: user.phone,
              from: config.twilioFromNumber,
              body: `Reminder: "${event.title}" starts soon.`,
            });
            sentCount++;
          } catch (err) {
            log.warn('sendEventReminders: SMS send failed', { userId, eventId, err: String(err) });
          }
        }
      }
    }

    log.info('sendEventReminders: run complete', { eventsChecked: upcomingSnap.size, smsSent: sentCount });
  }
);

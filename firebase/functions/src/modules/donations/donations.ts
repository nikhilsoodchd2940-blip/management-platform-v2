import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { stripeSecretKey, stripeWebhookSecret, APP_CHECK_ENFORCED } from '../../config/env';
import { getIntegrationConfig } from '../../config/integrationConfig';
import type { DonationDoc } from '../../types/models';
import { log, recordAudit } from '../../utils/logger';

/**
 * Card entry happens client-side via Stripe Elements — raw card data
 * never reaches this backend (docs/INTEGRATIONS.md). This callable only
 * creates the PaymentIntent and a matching `donations` doc with
 * status='pending'. The webhook below is the ONLY thing that ever moves
 * status to 'succeeded'/'failed' — the client's own "payment succeeded"
 * callback is UX only and is never trusted to confirm a donation.
 */
export const createDonationIntent = onCall({ secrets: [stripeSecretKey], enforceAppCheck: APP_CHECK_ENFORCED }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const amountCents = Number(request.data?.amountCents);
  const currency = String(request.data?.currency ?? 'usd').toLowerCase();
  const groupId: string | undefined = request.data?.groupId;
  const eventId: string | undefined = request.data?.eventId;

  if (!Number.isInteger(amountCents) || amountCents < 100) {
    throw new HttpsError('invalid-argument', 'amountCents must be an integer of at least 100 (i.e. $1.00)');
  }

  const config = await getIntegrationConfig();
  if (!config.stripeSecretKey) {
    throw new HttpsError('failed-precondition', 'Donations are not configured yet. Ask an admin to set Stripe credentials.');
  }
  const stripe = new Stripe(config.stripeSecretKey);
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    metadata: { userId: request.auth.uid, groupId: groupId ?? '', eventId: eventId ?? '' },
  });

  const doc: DonationDoc = {
    userId: request.auth.uid,
    amountCents,
    currency,
    groupId,
    eventId,
    status: 'pending',
    stripePaymentIntentId: intent.id,
    createdAt: FieldValue.serverTimestamp() as unknown as DonationDoc['createdAt'],
    updatedAt: FieldValue.serverTimestamp() as unknown as DonationDoc['updatedAt'],
  };
  await db.collection('donations').doc(intent.id).set(doc);

  return { clientSecret: intent.client_secret, donationId: intent.id };
});

/**
 * Public HTTPS endpoint (Stripe calls this directly, not through the
 * Firebase SDK) — signature-verified with STRIPE_WEBHOOK_SECRET so an
 * unauthenticated request can't forge a "payment succeeded" event.
 * Idempotent: Stripe retries webhook deliveries, so this keys off the
 * Stripe event's own ID and no-ops if that donation is already terminal.
 */
export const stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  const config = await getIntegrationConfig();
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    log.error('stripeWebhook: Stripe is not configured (set it in the admin panel\'s Intégrations page)');
    res.status(503).send('Not configured');
    return;
  }
  const stripe = new Stripe(config.stripeSecretKey);
  const signature = req.headers['stripe-signature'];

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature as string, config.stripeWebhookSecret);
  } catch (err) {
    log.warn('stripeWebhook: signature verification failed', { err: String(err) });
    res.status(400).send('Invalid signature');
    return;
  }

  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const ref = db.collection('donations').doc(intent.id);
    const snap = await ref.get();

    if (!snap.exists) {
      log.warn('stripeWebhook: no matching donation doc', { paymentIntentId: intent.id });
      res.status(200).send('ok'); // acknowledge anyway — nothing to retry into
      return;
    }

    const existing = snap.data() as DonationDoc;
    if (existing.status !== 'pending') {
      // Already processed (Stripe retried delivery) — idempotent no-op.
      res.status(200).send('ok');
      return;
    }

    const newStatus = event.type === 'payment_intent.succeeded' ? 'succeeded' : 'failed';
    await ref.update({ status: newStatus, updatedAt: FieldValue.serverTimestamp() });

    await recordAudit({
      action: 'stripeWebhook',
      actorUserId: existing.userId,
      targetId: intent.id,
      result: newStatus === 'succeeded' ? 'SUCCESS' : 'DENIED',
      metadata: { amountCents: existing.amountCents, eventType: event.type },
    });
  }

  res.status(200).send('ok');
});

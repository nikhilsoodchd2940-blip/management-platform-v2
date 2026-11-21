import { ns } from '../types';

export default ns({
  title: 'Integrations',
  intro:
    'Enter the credentials below to enable each service. Every save takes effect immediately — no redeployment is needed.',
  secretsNotice:
    'These values are never sent back to this panel once saved — only a "configured" status and, for secrets, the last 4 characters are shown, for confirmation. Retype the full value to replace it.',
  configured: 'configured',
  notConfigured: 'not configured',
  leaveEmpty: 'Leave empty to keep unchanged',
  clear: 'Clear',
  noFieldChanged: 'No field changed.',
  savedImmediately: 'Saved — active immediately, no redeployment needed.',
  saveFailed: 'Save failed',
  loadFailed: 'Could not load integration status',
  clearFailed: 'Could not clear field',
  confirmClear: (label: string) =>
    `Clear "${label}"? Any feature that depends on it will stop working until a new value is set.`,
  twilio: {
    title: 'Twilio (SMS sign-in)',
    description:
      'Used to send SMS sign-in codes and event reminders. Without it, nobody can sign in by phone.',
    docsHint:
      'Find these values in the Twilio Console → Account → API keys & tokens, and in Verify → Services for the Service SID.',
    authTokenPlaceholder: 'Your Twilio secret token',
    fromNumberLabel: 'Sender number for reminders',
    fromNumberHelp:
      'International format (+country code). Used only for event reminders, not for sign-in codes.',
  },
  stripe: {
    title: 'Stripe (donations)',
    description:
      'Used to accept card donations. Without it, the donations page cannot create a payment.',
    docsHint:
      'Find these values in the Stripe Dashboard → Developers → API keys, and → Webhooks for the signing secret.',
    secretKeyLabel: 'Secret key',
    webhookSecretLabel: 'Webhook signing secret',
    webhookSecretHelp:
      "Generated when you create the webhook endpoint in Stripe (pointing to this project's stripeWebhook URL).",
    publishableKeyLabel: 'Publishable key',
    publishableKeyHelp:
      'Safe to display — it is the key the mobile app itself uses on the client side.',
  },
  maps: {
    title: 'Google Maps',
    description:
      'Used for address autocomplete when creating an event (place search, geofence positioning).',
    docsHint:
      'Google Cloud Console → APIs & Services → Credentials. Enable "Maps JavaScript API" and "Places API", then restrict the key to your website address. Event maps and the geofence map use this key.',
    apiKeyLabel: 'API key',
  },
});

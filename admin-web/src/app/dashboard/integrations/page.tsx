'use client';

import { useEffect, useState } from 'react';
import { resetMapsKey } from '@/lib/googleMaps';
import { getIntegrationStatus, updateIntegrationSettings, type IntegrationStatus } from '@/lib/functions';
import type { Dictionary } from '@/lib/i18n/translations';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

type FieldKey = keyof IntegrationStatus;

interface FieldSpec {
  key: FieldKey;
  label: string;
  placeholder: string;
  secret: boolean;
  help?: string;
}

interface ProviderSpec {
  id: string;
  title: string;
  description: string;
  docsHint: string;
  fields: FieldSpec[];
}

// Built per render from the dictionary so every label follows the
// selected language; keys/ids/placeholders that are literal tokens
// (ACxxxx…, sk_live_…) stay language-neutral.
function buildProviders(t: Dictionary): ProviderSpec[] {
  const i = t.integrations;
  return [
    {
      id: 'twilio',
      title: i.twilio.title,
      description: i.twilio.description,
      docsHint: i.twilio.docsHint,
      fields: [
        { key: 'twilioAccountSid', label: tx("Account SID"), placeholder: tx("ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), secret: true },
        { key: 'twilioAuthToken', label: tx("Auth Token"), placeholder: i.twilio.authTokenPlaceholder, secret: true },
        { key: 'twilioVerifyServiceSid', label: tx("Verify Service SID"), placeholder: tx("VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), secret: true },
        { key: 'twilioFromNumber', label: i.twilio.fromNumberLabel, placeholder: '+15551234567', secret: false, help: i.twilio.fromNumberHelp },
      ],
    },
    {
      id: 'stripe',
      title: i.stripe.title,
      description: i.stripe.description,
      docsHint: i.stripe.docsHint,
      fields: [
        { key: 'stripeSecretKey', label: i.stripe.secretKeyLabel, placeholder: tx("sk_live_… / sk_test_…"), secret: true },
        { key: 'stripeWebhookSecret', label: i.stripe.webhookSecretLabel, placeholder: 'whsec_…', secret: true, help: i.stripe.webhookSecretHelp },
        { key: 'stripePublishableKey', label: i.stripe.publishableKeyLabel, placeholder: tx("pk_live_… / pk_test_…"), secret: false, help: i.stripe.publishableKeyHelp },
      ],
    },
    {
      id: 'maps',
      title: i.maps.title,
      description: i.maps.description,
      docsHint: i.maps.docsHint,
      fields: [{ key: 'googleMapsApiKey', label: i.maps.apiKeyLabel, placeholder: tx("AIza…"), secret: false }],
    },
  ];
}

export default function IntegrationsPage() {
  const { t } = useLocale();
  const i18 = t.integrations;
  const PROVIDERS = buildProviders(t);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<FieldKey, string>>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ provider: string; text: string; ok: boolean } | null>(null);
  const [clearingField, setClearingField] = useState<FieldKey | null>(null);

  async function reload() {
    try {
      const res = await getIntegrationStatus({});
      setStatus(res.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : i18.loadFailed);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSave(provider: ProviderSpec) {
    // Only fields the admin actually typed something into are sent —
    // an untouched (blank) field means "leave as-is", not "clear it".
    // Clearing is its own explicit action (the "Effacer" button below).
    const payload: Partial<Record<FieldKey, string>> = {};
    for (const f of provider.fields) {
      const draft = drafts[f.key];
      if (draft !== undefined && draft.trim() !== '') payload[f.key] = draft.trim();
    }
    if (Object.keys(payload).length === 0) {
      setSaveMsg({ provider: provider.id, text: i18.noFieldChanged, ok: false });
      return;
    }
    setSavingProvider(provider.id);
    setSaveMsg(null);
    try {
      await updateIntegrationSettings(payload);
      resetMapsKey();
      setDrafts((prev) => {
        const next = { ...prev };
        provider.fields.forEach((f) => delete next[f.key]);
        return next;
      });
      await reload();
      setSaveMsg({ provider: provider.id, text: i18.savedImmediately, ok: true });
    } catch (err) {
      setSaveMsg({ provider: provider.id, text: err instanceof Error ? err.message : i18.saveFailed, ok: false });
    } finally {
      setSavingProvider(null);
    }
  }

  async function handleClear(field: FieldKey, label: string) {
    if (!window.confirm(i18.confirmClear(label))) {
      return;
    }
    setClearingField(field);
    try {
      await updateIntegrationSettings({ [field]: '' });
      resetMapsKey();
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : i18.clearFailed, 'error');
    } finally {
      setClearingField(null);
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>{i18.title}</h1>
          <p>
            {i18.intro}
          </p>
        </div>
      </div>

      <div className="help-banner">
        <span style={{ fontSize: '1.1rem' }}>🔒</span>
        <span>
          {i18.secretsNotice}
        </span>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}

      {!status && !loadError ? (
        <p>{t.common.loading}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {PROVIDERS.map((provider) => (
            <section key={provider.id} className="card">
              <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.3rem' }}>{provider.title}</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 0.3rem' }}>{provider.description}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '0 0 1rem' }}>{provider.docsHint}</p>

              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {provider.fields.map((f) => {
                  const fieldStatus = status?.[f.key];
                  return (
                    <div className="field" key={f.key} style={{ marginBottom: 0 }}>
                      <label htmlFor={f.key}>
                        {f.label}{' '}
                        {fieldStatus?.configured ? (
                          <span className="status" style={{ marginLeft: '0.4rem' }}>
                            {f.secret ? `${i18.configured} (${fieldStatus.hint})` : fieldStatus.value}
                          </span>
                        ) : (
                          <span className="status gold" style={{ marginLeft: '0.4rem' }}>
                            {i18.notConfigured}
                          </span>
                        )}
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          id={f.key}
                          type={f.secret ? 'password' : 'text'}
                          autoComplete="off"
                          placeholder={fieldStatus?.configured ? i18.leaveEmpty : f.placeholder}
                          value={drafts[f.key] ?? ''}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          style={{ flex: 1 }}
                        />
                        {fieldStatus?.configured && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={clearingField === f.key}
                            onClick={() => handleClear(f.key, f.label)}
                          >
                            {clearingField === f.key ? '…' : i18.clear}
                          </button>
                        )}
                      </div>
                      {f.help && <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: '0.3rem' }}>{f.help}</p>}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-primary" disabled={savingProvider === provider.id} onClick={() => handleSave(provider)}>
                  {savingProvider === provider.id ? t.common.saving : t.common.save}
                </button>
                {saveMsg?.provider === provider.id && (
                  <span style={{ fontSize: '0.85rem', color: saveMsg.ok ? 'var(--ok)' : 'var(--danger)' }}>{saveMsg.text}</span>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

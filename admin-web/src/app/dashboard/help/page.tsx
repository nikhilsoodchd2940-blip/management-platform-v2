'use client';

import { useLocale } from '@/lib/i18n/LocaleContext';

export default function HelpPage() {
  const { t } = useLocale();
  const h = t.help;
  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>{h.title}</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: '1.5rem', fontSize: '0.9rem' }}>{h.intro}</p>

      <div className="help-banner">
        <span style={{ fontSize: '1.1rem' }}>💡</span>
        <span>
          <strong>{h.newHereLead}</strong> {h.newHereBefore} <strong>{h.newHereOrg}</strong> {h.newHereOrgDetail}{' '}
          <strong>{h.newHereMembers}</strong> {h.newHereMembersDetail}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {h.sections.map((section) => (
          <div key={section.title} className="card">
            <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: '0.9rem' }}>{section.title}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              {section.items.map((item) => (
                <div key={item.name}>
                  <strong style={{ fontSize: '0.9rem' }}>{item.name}</strong>
                  <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0.25rem 0 0', lineHeight: 1.5 }}>
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

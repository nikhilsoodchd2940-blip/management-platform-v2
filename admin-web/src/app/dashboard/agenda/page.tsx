'use client';

import AdminComingSoon from '@/components/AdminComingSoon';
import { useLocale } from '@/lib/i18n/LocaleContext';

export default function AgendaPage() {
  const { t } = useLocale();
  return <AdminComingSoon title={t.comingSoon.agendaTitle} description={t.comingSoon.agendaDescription} />;
}

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

import { PageHeader } from '../../components/admin';

import DirectMessagesTab from './components/DirectMessagesTab';

// Scheduled-send + Broadcast tabs were removed from this page — the unified
// /admin/outreach composer is now the single send pipeline. The
// `ScheduledMessagingTab.jsx` and `BroadcastTab.jsx` files are intentionally
// kept around so scheduled-send can be rebuilt inside Outreach later.
export default function AdminMessaging() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { profile, gym } = useAuth();
  const [searchParams] = useSearchParams();
  const gymId = profile?.gym_id;
  const adminId = profile?.id;

  useEffect(() => {
    document.title = `${t('admin.messaging.pageTitle', 'Admin - Messaging')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  return (
    <div className="px-3 sm:px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.messaging.inboxTitle', 'Inbox')}
        subtitle={t('admin.messaging.subtitle')}
      />

      <div className="mt-5">
        <DirectMessagesTab
          gymId={gymId}
          adminId={adminId}
          gym={gym}
          searchParams={searchParams}
          t={t}
          dateFnsLocale={dateFnsLocale}
        />
      </div>
    </div>
  );
}

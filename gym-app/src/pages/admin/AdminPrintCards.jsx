import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { AdminPageShell, PageHeader, FadeIn } from '../../components/admin';
import CardsToPrintPanel from './components/CardsToPrintPanel';
import UpcomingCardsPanel from './components/UpcomingCardsPanel';

export default function AdminPrintCards() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  useEffect(() => {
    document.title = `${t('admin.printCards.pageTitle', 'Print Cards')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger)' }}>
          {t('admin.overview.accessDenied', 'Access denied')}
        </p>
      </div>
    );
  }

  return (
    <AdminPageShell>
      <FadeIn>
        <PageHeader
          title={t('admin.printCards.pageTitle', 'Print Cards')}
          subtitle={t('admin.printCards.pageSubtitle', 'Hand-written cards generated daily for welcomes, milestones, and returning members. Print on Avery 8371, sign, and hand them over in person.')}
          className="mb-6"
        />
      </FadeIn>
      <FadeIn delay={20}>
        <UpcomingCardsPanel gymId={gymId} />
      </FadeIn>
      <FadeIn delay={40}>
        <CardsToPrintPanel gymId={gymId} />
      </FadeIn>
    </AdminPageShell>
  );
}

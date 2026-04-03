import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';

const SocialFeed = lazy(() => import('../SocialFeed'));

const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-20">
    <div
      className="w-8 h-8 border-3 rounded-full animate-spin"
      style={{
        borderColor: 'var(--color-border)',
        borderTopColor: 'var(--color-accent)',
      }}
    />
  </div>
);

export default function TrainerSocial() {
  const { t } = useTranslation('pages');

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ background: 'var(--color-bg-primary)' }}>
      <PageHeader title={t('trainerSocial.title', 'Activity')} />

      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4">
        <Suspense fallback={<LoadingSpinner />}>
          <SocialFeed embedded />
        </Suspense>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminPageShell, PageHeader, FadeIn } from '../../components/admin';
import PrintPreviewModal from '../../components/admin/PrintPreviewModal';
import CardsToPrintPanel from './components/CardsToPrintPanel';
import UpcomingCardsPanel from './components/UpcomingCardsPanel';
import CardDeliveryBanner from './components/CardDeliveryBanner';

export default function AdminPrintCards() {
  const { t } = useTranslation('pages');
  const { profile, availableRoles } = useAuth();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  // ids open in the page-level print preview modal — null when closed
  const [previewIds, setPreviewIds] = useState(null);

  useEffect(() => {
    document.title = `${t('admin.printCards.pageTitle', 'Print Cards')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  // All pending card ids — powers the header "Print sheet" action so the owner
  // can preview + print the whole waiting batch in one click.
  const { data: pendingIds = [] } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), 'pending-ids'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_cards')
        .select('id')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).map((c) => c.id);
    },
    enabled: isAuthorized,
    staleTime: 30_000,
  });

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
      {previewIds && (
        <PrintPreviewModal ids={previewIds} onClose={() => setPreviewIds(null)} />
      )}

      <FadeIn>
        <PageHeader
          title={t('admin.printCards.pageTitle', 'Print Cards')}
          subtitle={t('admin.printCards.pageSubtitle', 'Hand-written cards generated daily for welcomes, milestones, and returning members. Print, sign, and hand them over in person.')}
          className="mb-6"
          actions={
            <button
              onClick={() => pendingIds.length && setPreviewIds(pendingIds)}
              disabled={pendingIds.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-bold transition active:scale-[0.98] disabled:opacity-40"
              style={{ background: 'var(--color-admin-text)', color: '#fff' }}
            >
              <Printer size={14} />
              {t('admin.printCards.printSheetBtn', { defaultValue: 'Print sheet' })}
              {pendingIds.length > 0 && (
                <span
                  className="admin-mono"
                  style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                >
                  {pendingIds.length}
                </span>
              )}
            </button>
          }
        />
      </FadeIn>
      <FadeIn delay={10}>
        <CardDeliveryBanner gymId={gymId} />
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

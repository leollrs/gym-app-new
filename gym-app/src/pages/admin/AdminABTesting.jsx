import { useState, useMemo, useCallback } from 'react';
import {
  FlaskConical, Plus, TrendingUp, Users, Award, Info,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader, AdminPageShell, FadeIn, StatCard, AdminTabs, AdminModal,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import CreateCampaignModal from './components/CreateCampaignModal';
import ExperimentCard from './components/ExperimentCard';
import { fetchABTestingData, getExperimentType, calcVariantStats } from '../../lib/admin/abTestingHelpers';

// ── Main Page ──────────────────────────────────────────────
export default function AdminABTesting() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  // Confirm modals replacing window.confirm — each holds the campaign id
  // being acted on; null means closed.
  const [endConfirm, setEndConfirm] = useState(null);
  const [reactivateConfirm, setReactivateConfirm] = useState(null);

  const queryKey = adminKeys.churn.campaigns(gymId);
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchABTestingData(gymId),
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const campaigns = data?.campaigns || [];
  const attempts = data?.attempts || [];

  // ── Filtered lists ───────────────────────────────────────
  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => c.is_active && !c.ended_at),
    [campaigns],
  );
  const completedCampaigns = useMemo(
    () => campaigns.filter((c) => !c.is_active || c.ended_at),
    [campaigns],
  );

  const filteredCampaigns = useMemo(() => {
    if (activeTab === 'active') return activeCampaigns;
    if (activeTab === 'completed') return completedCampaigns;
    return campaigns;
  }, [activeTab, activeCampaigns, completedCampaigns, campaigns]);

  const tabOptions = useMemo(() => [
    { key: 'active', label: t('admin.abTesting.tabActive', 'Active'), count: activeCampaigns.length },
    { key: 'completed', label: t('admin.abTesting.tabCompleted', 'Completed'), count: completedCampaigns.length },
    { key: 'all', label: t('admin.abTesting.tabAll', 'All'), count: campaigns.length },
  ], [t, activeCampaigns.length, completedCampaigns.length, campaigns.length]);

  // ── Summary stats (only when data exists) ────────────────
  const summary = useMemo(() => {
    if (campaigns.length === 0) return null;
    const totalAttempts = attempts.length;
    const responded = attempts.filter((a) => a.responded_at != null).length;
    const returned = attempts.filter((a) => a.outcome === 'returned').length;
    const avgResponse = totalAttempts > 0 ? ((responded / totalAttempts) * 100).toFixed(1) : '0.0';

    // Best performing type
    const typeStats = {};
    for (const c of campaigns) {
      const type = getExperimentType(c);
      if (!typeStats[type]) typeStats[type] = { returned: 0, total: 0 };
      const cAttempts = attempts.filter((a) => a.message_template === c.id);
      typeStats[type].total += cAttempts.length;
      typeStats[type].returned += cAttempts.filter((a) => a.outcome === 'returned').length;
    }
    let bestType = '—';
    let bestRate = 0;
    for (const [type, data] of Object.entries(typeStats)) {
      const rate = data.total > 0 ? data.returned / data.total : 0;
      if (rate > bestRate) { bestRate = rate; bestType = type; }
    }

    return {
      totalExperiments: campaigns.length,
      avgResponse,
      totalRecovered: returned,
      bestType: bestType !== '—' ? t(`admin.abTesting.types.${bestType}`, bestType) : '—',
    };
  }, [campaigns, attempts, t]);

  // ── Actions ──────────────────────────────────────────────
  // Card "End" / "Reactivate" buttons now open a confirm modal — the actual
  // mutation runs once the admin confirms from the modal footer.
  const handleEndExperiment = useCallback((campaignId) => setEndConfirm(campaignId), []);
  const handleReactivate = useCallback((campaignId) => setReactivateConfirm(campaignId), []);

  const doEndExperiment = useCallback(
    async (campaignId) => {
      try {
        const { error } = await supabase
          .from('winback_campaigns')
          .update({ is_active: false, ended_at: new Date().toISOString() })
          .eq('id', campaignId);
        if (error) throw error;
        showToast(t('admin.abTesting.endedSuccess', 'Experiment ended'), 'success');
        queryClient.invalidateQueries({ queryKey });
      } catch (err) {
        logger.error('Failed to end experiment', err);
        showToast(t('admin.abTesting.endedError', 'Failed to end experiment'), 'error');
      } finally {
        setEndConfirm(null);
      }
    },
    [queryClient, queryKey, t, showToast],
  );

  const doReactivateExperiment = useCallback(
    async (campaignId) => {
      try {
        const { error } = await supabase
          .from('winback_campaigns')
          .update({ is_active: true, ended_at: null, started_at: new Date().toISOString() })
          .eq('id', campaignId);
        if (error) throw error;
        showToast(t('admin.abTesting.reactivatedSuccess', 'Experiment reactivated'), 'success');
        queryClient.invalidateQueries({ queryKey });
      } catch (err) {
        logger.error('Failed to reactivate experiment', err);
        showToast(t('admin.abTesting.reactivatedError', 'Failed to reactivate'), 'error');
      } finally {
        setReactivateConfirm(null);
      }
    },
    [queryClient, queryKey, t, showToast],
  );

  // Ship-winner: pick the variant with the higher return rate, append its
  // message to the URL as ?body=... and route to the unified Outreach
  // composer pre-targeted at the critical churn tier on the push channel.
  const handleShipWinner = useCallback(
    (campaign) => {
      const statsA = calcVariantStats(attempts, campaign.id, 'A');
      const statsB = calcVariantStats(attempts, campaign.id, 'B');
      const rateA = parseFloat(statsA.returnRate) || 0;
      const rateB = parseFloat(statsB.returnRate) || 0;
      const winner = rateB > rateA ? campaign.variant_b : campaign.variant_a;
      const winnerMsg = winner?.message || '';
      const params = new URLSearchParams({
        audience: 'critical',
        channel: 'push',
      });
      if (winnerMsg) params.set('body', encodeURIComponent(winnerMsg));
      navigate(`/admin/outreach?${params.toString()}`);
    },
    [attempts, navigate],
  );

  const handleCreated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return (
    <AdminPageShell>
      {/* Header */}
      <PageHeader
        title={t('admin.abTesting.title', 'A/B Testing')}
        subtitle={t('admin.abTesting.subtitle', 'Create and manage experiments to optimize engagement')}
        icon={FlaskConical}
        actions={
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-bold transition-colors hover:brightness-110 active:scale-[0.98]"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-on-accent)',
            }}
          >
            <Plus size={14} />
            {t('admin.abTesting.newExperiment', 'New Experiment')}
          </button>
        }
      />

      {/* Plain-English explainer — sits just below the PageHeader so first-time
          admins know what A/B testing is for without reading docs. */}
      <FadeIn delay={0}>
        <div
          className="flex items-start gap-2.5 mb-4 px-3.5 py-2.5 rounded-xl"
          style={{
            background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
          }}
        >
          <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
          <p className="text-[12.5px] leading-snug" style={{ color: 'var(--color-admin-text)' }}>
            {t('admin.abTesting.explainer', 'Test two versions of a win-back message against at-risk members and see which brings more back.')}
          </p>
        </div>
      </FadeIn>

      {/* Summary stats — only when experiments exist */}
      {!isLoading && summary && (
        <FadeIn delay={0}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mb-5">
            <StatCard
              label={t('admin.abTesting.totalExperiments', 'Total Experiments')}
              value={summary.totalExperiments}
              icon={FlaskConical}
              onClick={() => setActiveTab('all')}
            />
            <StatCard
              label={t('admin.abTesting.avgResponse', 'Avg Response Rate')}
              value={`${summary.avgResponse}%`}
              icon={TrendingUp}
            />
            <StatCard
              label={t('admin.abTesting.totalRecovered', 'Members Recovered')}
              value={summary.totalRecovered}
              icon={Users}
            />
            <StatCard
              label={t('admin.abTesting.bestType', 'Best Performing Type')}
              value={summary.bestType}
              icon={Award}
            />
          </div>
        </FadeIn>
      )}

      {/* Tabs */}
      <FadeIn delay={0.03}>
        <div className="mb-4">
          <AdminTabs tabs={tabOptions} active={activeTab} onChange={setActiveTab} />
        </div>
      </FadeIn>

      {/* Experiment list */}
      {isLoading ? (
        <FadeIn delay={0.06}>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-white/[0.02] rounded-xl animate-pulse border border-white/6" />
            ))}
          </div>
        </FadeIn>
      ) : (
        <SwipeableTabContent tabs={tabOptions} active={activeTab} onChange={setActiveTab}>
          {(tabKey) => {
            const tabCampaigns = tabKey === 'active' ? activeCampaigns : tabKey === 'completed' ? completedCampaigns : campaigns;
            return tabCampaigns.length > 0 ? (
              <div className="space-y-3">
                {tabCampaigns.map((c) => (
                  <ExperimentCard
                    key={c.id}
                    campaign={c}
                    attempts={attempts}
                    onEnd={handleEndExperiment}
                    onReactivate={handleReactivate}
                    onShipWinner={handleShipWinner}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <>
                <div className="admin-card text-center" style={{ padding: 30 }}>
                  <div
                    className="flex items-center justify-center mx-auto mb-3.5"
                    style={{ width: 64, height: 64, borderRadius: 16, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
                  >
                    <FlaskConical size={28} style={{ color: 'var(--color-accent)' }} />
                  </div>
                  <div
                    className="mb-1.5"
                    style={{ fontFamily: 'Archivo, sans-serif', fontSize: 18, fontWeight: 800, color: 'var(--color-admin-text)' }}
                  >
                    {tabKey === 'active'
                      ? t('admin.abTesting.noActive', 'No active experiments')
                      : tabKey === 'completed'
                      ? t('admin.abTesting.noCompleted', 'No completed experiments yet')
                      : t('admin.abTesting.noExperiments', 'No experiments yet')}
                  </div>
                  <div className="text-[13px] mb-4" style={{ color: 'var(--color-admin-text-muted)' }}>
                    {t('admin.abTesting.emptyHint', 'Create your first A/B experiment to start optimizing')}
                  </div>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors"
                    style={{ background: 'var(--color-accent)', color: '#fff' }}
                  >
                    <Plus size={14} />
                    {t('admin.abTesting.createFirst', 'Create Experiment')}
                  </button>
                </div>

                {/* Ideas to try — dashed-border idea cards */}
                <div style={{ height: 20 }} />
                <div className="mb-2.5">
                  <span className="admin-eyebrow">{t('admin.abTesting.ideasToTry', 'Ideas to try')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { title: t('admin.abTesting.idea1Title', 'Push copy for inactives'), desc: t('admin.abTesting.idea1Desc', '"We miss you" vs "Your streak is waiting"') },
                    { title: t('admin.abTesting.idea2Title', 'Onboarding length'), desc: t('admin.abTesting.idea2Desc', '3 steps vs 5 steps') },
                    { title: t('admin.abTesting.idea3Title', 'Referral reward tier'), desc: t('admin.abTesting.idea3Desc', '250 pts vs 500 pts') },
                  ].map((idea, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'var(--color-bg-card)',
                        borderRadius: 12,
                        border: '1px dashed var(--color-admin-border)',
                        padding: 14,
                      }}
                    >
                      <div className="mb-1" style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-admin-text)' }}>
                        {idea.title}
                      </div>
                      <div className="mb-2.5 text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                        {idea.desc}
                      </div>
                      <button
                        onClick={() => setShowCreateModal(true)}
                        className="text-[11.5px] font-semibold transition-colors"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {t('admin.abTesting.useIdea', 'Use idea')}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            );
          }}
        </SwipeableTabContent>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateCampaignModal
          gymId={gymId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Confirm: end experiment */}
      <AdminModal
        isOpen={!!endConfirm}
        onClose={() => setEndConfirm(null)}
        title={t('admin.abTesting.confirmEndTitle', 'End this experiment?')}
        size="sm"
        footer={
          <>
            <button
              onClick={() => setEndConfirm(null)}
              className="flex-1 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-deep)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {t('admin.abTesting.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => endConfirm && doEndExperiment(endConfirm)}
              className="flex-1 px-4 py-2 rounded-xl text-[13px] font-bold text-white bg-[#EF4444] hover:bg-[#DC2626] transition-colors"
            >
              {t('admin.abTesting.endExperiment', 'End Experiment')}
            </button>
          </>
        }
      >
        <p className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
          {t('admin.abTesting.confirmEnd', 'End this experiment? It will be archived and stop assigning variants.')}
        </p>
      </AdminModal>

      {/* Confirm: reactivate experiment */}
      <AdminModal
        isOpen={!!reactivateConfirm}
        onClose={() => setReactivateConfirm(null)}
        title={t('admin.abTesting.reactivateTitle', 'Reactivate this experiment?')}
        size="sm"
        footer={
          <>
            <button
              onClick={() => setReactivateConfirm(null)}
              className="flex-1 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-deep)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {t('admin.abTesting.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => reactivateConfirm && doReactivateExperiment(reactivateConfirm)}
              className="flex-1 px-4 py-2 rounded-xl text-[13px] font-bold transition-colors hover:brightness-110"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-on-accent)',
              }}
            >
              {t('admin.abTesting.reactivate', 'Reactivate')}
            </button>
          </>
        }
      >
        <p className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
          {t('admin.abTesting.reactivateConfirm', 'Reactivating resets the test start time to now. Old attempts stay in the data but the time window restarts. Continue?')}
        </p>
      </AdminModal>
    </AdminPageShell>
  );
}

import { useState, useMemo, useCallback } from 'react';
import {
  FlaskConical, Trophy, StopCircle, Play, Plus,
  TrendingUp, Users, Award, ChevronDown, ChevronUp,
  Mail, Bell, Tag, Zap, Dumbbell,
} from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  AdminCard, PageHeader, AdminPageShell, FadeIn, StatCard, AdminTabs,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import CreateCampaignModal from './components/CreateCampaignModal';

// ── Constants ──────────────────────────────────────────────
const EXPERIMENT_TYPES = {
  win_back:          { color: 'var(--color-danger)', icon: TrendingUp },
  push_notification: { color: 'var(--color-success)', icon: Bell },
  email:             { color: 'var(--color-info)', icon: Mail },
  offer:             { color: 'var(--color-warning)', icon: Tag },
  challenge:         { color: 'var(--color-coach)', icon: Zap },
  class_promo:       { color: 'var(--color-accent)', icon: Dumbbell },
};

const TIER_COLORS = {
  critical: { bg: 'var(--color-danger-soft)', text: 'var(--color-danger)', border: 'var(--color-danger-soft)' },
  high:     { bg: 'var(--color-warning-soft)', text: 'var(--color-warning)', border: 'var(--color-warning-soft)' },
  medium:   { bg: 'var(--color-info-soft)', text: 'var(--color-info)', border: 'var(--color-info-soft)' },
};

// ── Data fetcher ───────────────────────────────────────────
async function fetchABTestingData(gymId) {
  const [campaignsRes, attemptsRes] = await Promise.all([
    supabase
      .from('winback_campaigns')
      .select('*')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false }),
    supabase
      .from('win_back_attempts')
      .select('id, variant, message_template, outcome, responded_at, created_at')
      .eq('gym_id', gymId),
  ]);

  return {
    campaigns: campaignsRes.data || [],
    attempts: attemptsRes.data || [],
  };
}

// ── Helpers ────────────────────────────────────────────────
function calcVariantStats(attempts, campaignId, variant) {
  const rows = attempts.filter(
    (a) => a.message_template === campaignId && a.variant === variant,
  );
  const sent = rows.length;
  const responded = rows.filter((a) => a.responded_at != null).length;
  const returned = rows.filter((a) => a.outcome === 'returned').length;
  return {
    sent,
    responded,
    returned,
    responseRate: sent > 0 ? ((responded / sent) * 100).toFixed(1) : '0.0',
    returnRate: sent > 0 ? ((returned / sent) * 100).toFixed(1) : '0.0',
  };
}

// Two-proportion z-test (one-sided / two-sided gives the same |z|).
// Returns { significant, marginal, winner, zScore, requiresMoreData, perArmSize }.
//
// Significance rule:
//   - Each arm needs ≥30 samples (rule of thumb for normal approximation
//     and to keep early stopping from declaring noise as a winner).
//   - |z| ≥ 1.96 → significant at 95% (p ≈ 0.05).
//   - |z| ≥ 1.645 → marginal (90% confidence).
//
// metric: 'response' or 'return' — picks which numerator to use.
function abSignificance(statsA, statsB, metric = 'return') {
  const xA = metric === 'response' ? statsA.responded : statsA.returned;
  const xB = metric === 'response' ? statsB.responded : statsB.returned;
  const nA = statsA.sent;
  const nB = statsB.sent;
  const MIN_PER_ARM = 30;

  if (nA < MIN_PER_ARM || nB < MIN_PER_ARM) {
    return {
      significant: false,
      marginal: false,
      winner: null,
      zScore: null,
      requiresMoreData: true,
      perArmSize: { a: nA, b: nB, min: MIN_PER_ARM },
    };
  }

  const pA = xA / nA;
  const pB = xB / nB;
  const pPooled = (xA + xB) / (nA + nB);
  const seSquared = pPooled * (1 - pPooled) * ((1 / nA) + (1 / nB));
  // Edge case: pPooled is 0 or 1 → SE is 0 → variance is undefined. Treat as
  // not enough variation to call it.
  if (seSquared <= 0) {
    return { significant: false, marginal: false, winner: null, zScore: 0, requiresMoreData: false, perArmSize: { a: nA, b: nB, min: MIN_PER_ARM } };
  }
  const z = (pA - pB) / Math.sqrt(seSquared);
  const absZ = Math.abs(z);

  return {
    significant: absZ >= 1.96,
    marginal: absZ >= 1.645 && absZ < 1.96,
    winner: absZ >= 1.645 ? (z > 0 ? 'A' : 'B') : null,
    zScore: z,
    requiresMoreData: false,
    perArmSize: { a: nA, b: nB, min: MIN_PER_ARM },
  };
}

function getExperimentType(campaign) {
  return campaign.type
    || campaign.variant_a?.experiment_type
    || 'win_back';
}

function getVariantSummary(variant, t) {
  if (!variant) return '—';
  const parts = [];
  if (variant.offer_type) {
    // Translate stable enum key (e.g., 'pt_session'); falls back to raw value
    // for any legacy rows that stored an English label directly.
    parts.push(
      t
        ? t(`admin.churn.campaign.offer.${variant.offer_type}`, variant.offer_type)
        : variant.offer_type,
    );
  }
  if (variant.discount_pct) parts.push(`${variant.discount_pct}%`);
  if (variant.free_days) parts.push(`${variant.free_days}d free`);
  if (parts.length > 0) return parts.join(' · ');
  if (variant.message) return variant.message.slice(0, 40) + (variant.message.length > 40 ? '...' : '');
  return '—';
}

function getKeyMetric(type, statsA, statsB) {
  // Return the most relevant metric label and values per type
  if (type === 'email' || type === 'push_notification') {
    return { label: 'responseRate', a: statsA.responseRate, b: statsB.responseRate };
  }
  return { label: 'returnRate', a: statsA.returnRate, b: statsB.returnRate };
}

// ── Small components ───────────────────────────────────────
function TierBadge({ tier, t }) {
  const c = TIER_COLORS[tier] || TIER_COLORS.medium;
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {t(`admin.abTesting.tier.${tier}`, tier)}
    </span>
  );
}

function TypeBadge({ type, t }) {
  const cfg = EXPERIMENT_TYPES[type] || EXPERIMENT_TYPES.win_back;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: `${cfg.color}15`,
        color: cfg.color,
        border: `1px solid ${cfg.color}30`,
      }}
    >
      <Icon size={10} />
      {t(`admin.abTesting.types.${type}`, type)}
    </span>
  );
}

function VariantPill({ label, summary, color }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/[0.03] border border-white/6 min-w-0"
    >
      <span
        className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold shrink-0"
        style={{ background: `${color}20`, color }}
      >
        {label}
      </span>
      <span className="text-[#9CA3AF] truncate">{summary}</span>
    </div>
  );
}

function ComparisonBar({ valueA, valueB, label }) {
  const max = Math.max(Number(valueA) || 0.01, Number(valueB) || 0.01);
  const pctA = ((Number(valueA) || 0) / max) * 100;
  const pctB = ((Number(valueB) || 0) / max) * 100;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-[#6B7280] font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#D4AF37] font-bold w-4 shrink-0">A</span>
        <div className="flex-1 h-1.5 bg-white/4 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pctA}%`, background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }} />
        </div>
        <span className="text-[11px] text-[#E5E7EB] font-semibold w-12 text-right">{valueA}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#8B5CF6] font-bold w-4 shrink-0">B</span>
        <div className="flex-1 h-1.5 bg-white/4 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pctB}%`, background: 'var(--color-coach-soft)' }} />
        </div>
        <span className="text-[11px] text-[#E5E7EB] font-semibold w-12 text-right">{valueB}%</span>
      </div>
    </div>
  );
}

// ── Experiment Card ────────────────────────────────────────
function ExperimentCard({ campaign, attempts, onEnd, onReactivate, t }) {
  const [expanded, setExpanded] = useState(false);

  const type = getExperimentType(campaign);
  const isActive = campaign.is_active && !campaign.ended_at;
  const statsA = calcVariantStats(attempts, campaign.id, 'A');
  const statsB = calcVariantStats(attempts, campaign.id, 'B');
  const totalAttempts = statsA.sent + statsB.sent;
  const metric = getKeyMetric(type, statsA, statsB);

  // Statistical significance (two-proportion z-test, return-rate is the
  // primary metric). Replaces the old "absolute diff > 5%" heuristic which
  // was both noisy on small samples and overconfident on large ones.
  const sig = abSignificance(statsA, statsB, 'return');
  // Only declare a winner when the test reaches significance AND the campaign
  // is no longer active (so admins don't act on early peeks).
  const showWinner = !isActive && (sig.significant || sig.marginal);
  const winnerVariant = showWinner ? sig.winner : null;

  const dateLabel = isActive
    ? `${t('admin.abTesting.runningSince', 'Running since')} ${format(new Date(campaign.started_at || campaign.created_at), 'MMM d, yyyy')}`
    : `${format(new Date(campaign.started_at || campaign.created_at), 'MMM d')} — ${campaign.ended_at ? format(new Date(campaign.ended_at), 'MMM d, yyyy') : '?'}`;

  return (
    <AdminCard className="overflow-hidden">
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start justify-between gap-3 p-4 text-left"
      >
        <div className="flex-1 min-w-0 space-y-2">
          {/* Row 1: type badge + name + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={type} t={t} />
            <span className="text-[13px] font-semibold text-[#E5E7EB] truncate">
              {campaign.name}
            </span>
            {isActive ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-emerald-500/12 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t('admin.abTesting.active', 'Active')}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-white/5 text-[#6B7280] border border-white/8">
                {t('admin.abTesting.completed', 'Completed')}
              </span>
            )}
            {winnerVariant && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/12 text-emerald-400 border border-emerald-500/20">
                <Trophy size={9} />
                {t('admin.abTesting.winner', 'Winner')}: {winnerVariant}
              </span>
            )}
          </div>

          {/* Row 2: date + tier + variant pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-[#6B7280]">{dateLabel}</span>
            <TierBadge tier={campaign.target_tier} t={t} />
          </div>

          {/* Row 3: variant pills side by side */}
          <div className="flex items-center gap-2 flex-wrap">
            <VariantPill label="A" summary={getVariantSummary(campaign.variant_a, t)} color="var(--color-accent)" />
            <span className="text-[10px] text-[#4B5563] font-medium">vs</span>
            <VariantPill label="B" summary={getVariantSummary(campaign.variant_b, t)} color="var(--color-coach)" />
          </div>

          {/* Row 4: key metric (only if data) */}
          {totalAttempts > 0 && (
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-[#6B7280]">
                {t(`admin.abTesting.${metric.label}`, metric.label)}:
              </span>
              <span className="text-[#D4AF37] font-semibold">A {metric.a}%</span>
              <span className="text-[#4B5563]">|</span>
              <span className="text-[#8B5CF6] font-semibold">B {metric.b}%</span>
              <span className="text-[#6B7280]">({totalAttempts} {t('admin.abTesting.attempts', 'attempts')})</span>
            </div>
          )}
        </div>

        <div className="shrink-0 pt-1">
          {expanded
            ? <ChevronUp size={14} className="text-[#6B7280]" />
            : <ChevronDown size={14} className="text-[#6B7280]" />}
        </div>
      </button>

      {/* Expandable detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/6 pt-3">
          {/* Full stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {['sent', 'responded', 'returned'].map((key) => (
              <div key={key} className="bg-[#0F172A] rounded-lg px-3 py-2 border border-white/4">
                <p className="text-[10px] text-[#6B7280] capitalize">{t(`admin.abTesting.${key}`, key)}</p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-[13px] font-bold text-[#D4AF37]">{statsA[key]}</span>
                  <span className="text-[10px] text-[#4B5563]">vs</span>
                  <span className="text-[13px] font-bold text-[#8B5CF6]">{statsB[key]}</span>
                </div>
              </div>
            ))}
            {(sig.requiresMoreData || totalAttempts > 0) && (
              <div className="bg-[#0F172A] rounded-lg px-3 py-2 border border-white/4">
                <p className="text-[10px] text-[#6B7280]">{t('admin.abTesting.significance', 'Significance')}</p>
                {sig.requiresMoreData ? (
                  <p className="text-[12px] font-semibold text-[#9CA3AF] mt-0.5">
                    {t('admin.abTesting.moreDataNeeded', { min: sig.perArmSize.min, defaultValue: 'Need {{min}}+ per arm' })}
                  </p>
                ) : sig.significant ? (
                  <p className="text-[13px] font-bold text-emerald-400 mt-0.5">
                    {t('admin.abTesting.significantP05', 'Significant (p<0.05)')}
                  </p>
                ) : sig.marginal ? (
                  <p className="text-[13px] font-bold text-amber-400 mt-0.5">
                    {t('admin.abTesting.marginalP10', 'Marginal (p<0.10)')}
                  </p>
                ) : (
                  <p className="text-[13px] font-bold text-[#6B7280] mt-0.5">
                    {t('admin.abTesting.inconclusive', 'Inconclusive')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Comparison bars */}
          {totalAttempts > 0 && (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3 space-y-2.5">
              <ComparisonBar
                valueA={statsA.responseRate}
                valueB={statsB.responseRate}
                label={t('admin.abTesting.responseRate', 'Response Rate')}
              />
              <ComparisonBar
                valueA={statsA.returnRate}
                valueB={statsB.returnRate}
                label={t('admin.abTesting.returnRate', 'Return Rate')}
              />
            </div>
          )}

          {/* No data message */}
          {totalAttempts === 0 && (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-center">
              <p className="text-[11px] text-[#6B7280]">
                {t('admin.abTesting.noData', 'No data yet. Results will appear as members are contacted.')}
              </p>
            </div>
          )}

          {/* Variant messages preview */}
          {(campaign.variant_a?.message || campaign.variant_b?.message) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {['a', 'b'].map((v) => {
                const variant = v === 'a' ? campaign.variant_a : campaign.variant_b;
                const color = v === 'a' ? 'var(--color-accent)' : 'var(--color-coach)';
                if (!variant?.message) return null;
                return (
                  <div key={v} className="bg-[#0F172A] border border-white/4 rounded-lg p-2.5">
                    <p className="text-[10px] font-bold mb-1" style={{ color }}>
                      {t('admin.abTesting.variant', 'Variant')} {v.toUpperCase()}
                    </p>
                    <p className="text-[11px] text-[#9CA3AF] line-clamp-3">{variant.message}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {isActive && onEnd && (
              <button
                onClick={() => onEnd(campaign.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500/8 text-red-400 border border-red-500/15 hover:bg-red-500/15 transition-colors"
              >
                <StopCircle size={12} />
                {t('admin.abTesting.endExperiment', 'End Experiment')}
              </button>
            )}
            {!isActive && onReactivate && (
              <button
                onClick={() => onReactivate(campaign.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/8 text-emerald-400 border border-emerald-500/15 hover:bg-emerald-500/15 transition-colors"
              >
                <Play size={12} />
                {t('admin.abTesting.reactivate', 'Reactivate')}
              </button>
            )}
          </div>
        </div>
      )}
    </AdminCard>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function AdminABTesting() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState('active');

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
  const handleEndExperiment = useCallback(
    async (campaignId) => {
      if (!window.confirm(t('admin.abTesting.confirmEnd', 'End this experiment? It will be archived and stop assigning variants.'))) return;
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
      }
    },
    [queryClient, queryKey, t, showToast],
  );

  const handleReactivate = useCallback(
    async (campaignId) => {
      // Confirm: reactivating resets `started_at` to now, which means previous-period
      // attempt data still exists but the displayed time window shifts. Make sure the
      // admin understands they're effectively starting a fresh test window.
      if (!window.confirm(t('admin.abTesting.reactivateConfirm', 'Reactivating resets the test start time to now. Old attempts stay in the data but the time window restarts. Continue?'))) {
        return;
      }
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
      }
    },
    [queryClient, queryKey, t, showToast],
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
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
              color: 'var(--color-accent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            }}
          >
            <Plus size={14} />
            {t('admin.abTesting.newExperiment', 'New Experiment')}
          </button>
        }
      />

      {/* Summary stats — only when experiments exist */}
      {!isLoading && summary && (
        <FadeIn delay={0}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mb-5">
            <StatCard
              label={t('admin.abTesting.totalExperiments', 'Total Experiments')}
              value={summary.totalExperiments}
              icon={FlaskConical}
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
    </AdminPageShell>
  );
}

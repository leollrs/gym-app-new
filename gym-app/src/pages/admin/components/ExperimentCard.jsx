/**
 * Expandable card that renders a single A/B win-back campaign for the Admin
 * A/B Testing page. Owns its own expand/collapse state; receives campaign +
 * attempts + action handlers from the parent. Stats and significance come
 * from abTestingHelpers; badges from ABTestingBadges.
 */

import { useState } from 'react';
import { Trophy, StopCircle, Play, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { format } from 'date-fns';
import { AdminCard } from '../../../components/admin';
import {
  calcVariantStats,
  abSignificance,
  getExperimentType,
  getVariantSummary,
  getKeyMetric,
} from '../../../lib/admin/abTestingHelpers';
import { TierBadge, TypeBadge, VariantPill, ComparisonBar } from './ABTestingBadges';

export default function ExperimentCard({ campaign, attempts, onEnd, onReactivate, onShipWinner, t }) {
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
          <div className="flex justify-end gap-2 pt-1 flex-wrap">
            {!isActive && onShipWinner && (campaign.variant_a?.message || campaign.variant_b?.message) && (
              <button
                onClick={() => onShipWinner(campaign)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors hover:brightness-110 active:scale-[0.98]"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-bg-base)',
                }}
              >
                <Send size={12} />
                {t('admin.abTesting.shipWinner', 'Ship winner to Outreach')}
              </button>
            )}
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

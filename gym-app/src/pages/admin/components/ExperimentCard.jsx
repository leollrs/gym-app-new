/**
 * A single A/B win-back experiment, restyled to the "Pruebas A/B" design:
 * flask chip + name + type/status/winner pills + audience·date meta + a "Lift"
 * readout, then the per-variant result grid (winner highlighted) with a
 * significance note and the contextual actions (ship winner / end / reactivate).
 * Theme-aware + white-label accent; stats/significance from abTestingHelpers.
 */

import { Trophy, StopCircle, Play, Send, FlaskConical, Users, Calendar, TrendingUp, Check } from 'lucide-react';
import { format } from 'date-fns';
import { AdminCard } from '../../../components/admin';
import {
  calcVariantStats,
  abSignificance,
  getExperimentType,
  getVariantSummary,
  getKeyMetric,
} from '../../../lib/admin/abTestingHelpers';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

// experiment type → semantic tone (theme tokens, dark-mode + white-label safe).
const TYPE_TONE = {
  win_back: 'hot',
  push_notification: 'good',
  email: 'coach',
  offer: 'warn',
  challenge: 'coach',
  class_promo: 'teal',
};

function toneStyles(tone) {
  switch (tone) {
    case 'teal': return { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', fg: 'var(--color-accent)', ink: 'var(--color-accent)' };
    case 'coach': return { bg: 'var(--color-coach-soft)', fg: 'var(--color-coach)', ink: 'var(--color-coach-ink)' };
    case 'warn': return { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)', ink: 'var(--color-warning-ink)' };
    case 'hot': return { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)', ink: 'var(--color-danger-ink)' };
    case 'good': return { bg: 'var(--color-success-soft)', fg: 'var(--color-success)', ink: 'var(--color-success-ink)' };
    default: return { bg: 'var(--color-admin-panel)', fg: 'var(--color-admin-text-sub)', ink: 'var(--color-admin-text-sub)' };
  }
}

function TonePill({ children, tone = 'neutral', icon: Icon }) {
  const c = toneStyles(tone);
  return (
    <span className="inline-flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: 800, color: c.ink, background: c.bg, padding: '3px 9px', borderRadius: 999, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

// One variant's result tile — letter chip, label, big % + sample, progress bar.
// Winner tiles get the success wash + green bar.
function VariantRow({ vKey, label, pct, sample, isWin, t }) {
  const tone = vKey === 'A' ? 'teal' : 'coach';
  const c = toneStyles(tone);
  const num = parseFloat(pct) || 0;
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 13,
        background: isWin ? 'var(--color-success-soft)' : 'var(--color-admin-panel)',
        border: `1px solid ${isWin ? 'color-mix(in srgb, var(--color-success) 28%, transparent)' : 'var(--color-admin-border)'}`,
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="grid place-items-center flex-shrink-0" style={{ width: 26, height: 26, borderRadius: 8, background: c.bg, color: c.ink, fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 13 }}>{vKey}</div>
        <span className="flex-1 min-w-0 truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-admin-text)' }}>{label}</span>
        {isWin && <TonePill tone="good" icon={Trophy}>{t('admin.abTesting.winner', 'Winner')}</TonePill>}
      </div>
      <div className="flex items-end gap-2 mb-2">
        <span style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 26, letterSpacing: '-1px', lineHeight: 1, color: isWin ? 'var(--color-success-ink)' : 'var(--color-admin-text)' }}>{pct}%</span>
        <span className="mb-0.5" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)' }}>{sample} {t('admin.abTesting.sampled', 'sampled')}</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: isWin ? 'color-mix(in srgb, var(--color-success) 18%, transparent)' : 'var(--color-admin-border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(num * 2.2, 100)}%`, borderRadius: 99, background: isWin ? 'var(--color-success)' : c.fg }} />
      </div>
    </div>
  );
}

export default function ExperimentCard({ campaign, attempts, onEnd, onReactivate, onShipWinner, t }) {
  const type = getExperimentType(campaign);
  const isActive = campaign.is_active && !campaign.ended_at;
  const statsA = calcVariantStats(attempts, campaign.id, 'A');
  const statsB = calcVariantStats(attempts, campaign.id, 'B');
  const totalAttempts = statsA.sent + statsB.sent;
  const metric = getKeyMetric(type, statsA, statsB); // { label, a, b }
  const metricLabel = t(`admin.abTesting.${metric.label}`, metric.label);

  const sig = abSignificance(statsA, statsB, 'return');
  // Only declare a winner once the test is closed AND reaches (at least marginal)
  // significance — keeps admins from acting on early noise.
  const showWinner = !isActive && (sig.significant || sig.marginal);
  const winnerVariant = showWinner ? sig.winner : null;

  // Lift = winner vs loser on the key metric. Relative when the loser rate is
  // non-zero, otherwise an absolute point delta.
  const rateA = parseFloat(metric.a) || 0;
  const rateB = parseFloat(metric.b) || 0;
  const winRate = winnerVariant === 'A' ? rateA : rateB;
  const loseRate = winnerVariant === 'A' ? rateB : rateA;
  const lift = winnerVariant
    ? (loseRate > 0 ? `+${Math.round(((winRate - loseRate) / loseRate) * 100)}%` : `+${(winRate - loseRate).toFixed(1)} pts`)
    : null;

  const audienceLabel = campaign.target_tier
    ? t(`admin.abTesting.tier.${campaign.target_tier}`, campaign.target_tier)
    : t('admin.abTesting.atRisk', 'At-risk members');
  const dateLabel = isActive
    ? `${t('admin.abTesting.runningSince', 'Running since')} ${format(new Date(campaign.started_at || campaign.created_at), 'MMM d, yyyy')}`
    : `${format(new Date(campaign.started_at || campaign.created_at), 'MMM d')} — ${campaign.ended_at ? format(new Date(campaign.ended_at), 'MMM d, yyyy') : '?'}`;

  const hasMessage = campaign.variant_a?.message || campaign.variant_b?.message;

  return (
    <AdminCard padding="p-5">
      {/* Header */}
      <div className="flex items-start gap-3.5">
        <div className="grid place-items-center flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
          <FlaskConical size={22} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 16, color: 'var(--color-admin-text)', letterSpacing: '-0.3px' }}>{campaign.name}</span>
            <TonePill tone={TYPE_TONE[type] || 'neutral'}>{t(`admin.abTesting.types.${type}`, type)}</TonePill>
            {isActive
              ? <TonePill tone="teal">{t('admin.abTesting.active', 'Active')}</TonePill>
              : <TonePill tone="good" icon={Check}>{t('admin.abTesting.completed', 'Completed')}</TonePill>}
            {winnerVariant && <TonePill tone="good" icon={Trophy}>{t('admin.abTesting.winner', 'Winner')} {winnerVariant}</TonePill>}
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)', fontWeight: 500 }}>
              <Users size={13} /> {audienceLabel}
            </span>
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)', fontWeight: 500 }}>
              <Calendar size={13} /> {dateLabel}
            </span>
          </div>
        </div>
        {lift && (
          <div className="flex-shrink-0 text-right">
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--color-admin-text-muted)' }}>{t('admin.abTesting.lift', 'Lift')}</div>
            <div className="inline-flex items-center gap-1 mt-1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 22, letterSpacing: '-0.8px', color: 'var(--color-success-ink)' }}>
              <TrendingUp size={17} style={{ color: 'var(--color-success)' }} /> {lift}
            </div>
          </div>
        )}
      </div>

      {/* Per-variant results */}
      {totalAttempts > 0 ? (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--color-admin-text-muted)', margin: '18px 0 10px' }}>
            {t('admin.abTesting.metricPerVariant', { metric: metricLabel, defaultValue: '{{metric}} by variant' })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <VariantRow vKey="A" label={getVariantSummary(campaign.variant_a, t)} pct={metric.a} sample={statsA.sent} isWin={winnerVariant === 'A'} t={t} />
            <VariantRow vKey="B" label={getVariantSummary(campaign.variant_b, t)} pct={metric.b} sample={statsB.sent} isWin={winnerVariant === 'B'} t={t} />
          </div>
          <p className="mt-3 text-[11.5px] font-medium" style={{ color: 'var(--color-admin-text-muted)' }}>
            {sig.requiresMoreData
              ? t('admin.abTesting.moreDataNeeded', { min: sig.perArmSize.min, defaultValue: 'Need {{min}}+ per arm' })
              : sig.significant
                ? t('admin.abTesting.significantP05', 'Significant (p<0.05)')
                : sig.marginal
                  ? t('admin.abTesting.marginalP10', 'Marginal (p<0.10)')
                  : t('admin.abTesting.inconclusive', 'Inconclusive')}
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-xl text-center" style={{ padding: 14, background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
          <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>
            {t('admin.abTesting.noData', 'No data yet. Results will appear as members are contacted.')}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 mt-4 flex-wrap">
        {!isActive && onShipWinner && hasMessage && (
          <button
            onClick={() => onShipWinner(campaign)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors hover:brightness-[1.04]"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Send size={13} /> {t('admin.abTesting.shipWinner', 'Ship winner to Outreach')}
          </button>
        )}
        {isActive && onEnd && (
          <button
            onClick={() => onEnd(campaign.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors hover:brightness-[1.04]"
            style={{ color: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}
          >
            <StopCircle size={13} /> {t('admin.abTesting.endExperiment', 'End Experiment')}
          </button>
        )}
        {!isActive && onReactivate && (
          <button
            onClick={() => onReactivate(campaign.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors hover:brightness-[1.04]"
            style={{ color: 'var(--color-success)', background: 'var(--color-success-soft)' }}
          >
            <Play size={13} /> {t('admin.abTesting.reactivate', 'Reactivate')}
          </button>
        )}
      </div>
    </AdminCard>
  );
}

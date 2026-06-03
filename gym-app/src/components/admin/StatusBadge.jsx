/**
 * Status badge for membership status and risk tiers.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertOctagon, Info, CheckCircle } from 'lucide-react';

// All status/risk colors now route through CSS vars so they auto-adapt to
// light/dark and to the premium triage palette (danger=hot orange, warning=amber,
// success=green, coach=purple). Background uses the *-soft tint, text uses *-ink.
const STATUS_CONFIG = {
  active:      { dot: true,  key: 'active',      tone: 'good' },
  frozen:      { dot: false, key: 'frozen',      tone: 'info' },
  deactivated: { dot: false, key: 'deactivated', tone: 'warn' },
  cancelled:   { dot: false, key: 'cancelled',   tone: 'neutral' },
  banned:      { dot: false, key: 'banned',      tone: 'hot' },
};

const RISK_CONFIG = {
  critical: { key: 'critical', tone: 'hot',   Icon: AlertOctagon },
  high:     { key: 'high',     tone: 'hot',   Icon: AlertTriangle },   // hot + AlertTriangle differentiates from critical
  medium:   { key: 'medium',   tone: 'warn',  Icon: Info },
  low:      { key: 'low',      tone: 'good',  Icon: CheckCircle },
};

const TONE_VARS = {
  good:    { bg: 'var(--color-success-soft)', fg: 'var(--color-success-ink)', dot: 'var(--color-success)' },
  warn:    { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning-ink)', dot: 'var(--color-warning)' },
  hot:     { bg: 'var(--color-danger-soft)',  fg: 'var(--color-danger-ink)',  dot: 'var(--color-danger)' },
  coach:   { bg: 'var(--color-coach-soft)',   fg: 'var(--color-coach-ink)',   dot: 'var(--color-coach)' },
  info:    { bg: 'var(--color-info-soft)',    fg: 'var(--color-info)',        dot: 'var(--color-info)' },
  neutral: { bg: 'var(--color-admin-panel)',  fg: 'var(--color-admin-text-sub)', dot: 'var(--color-admin-text-muted)' },
};

export function StatusBadge({ status }) {
  const { t } = useTranslation('pages');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  const tone = TONE_VARS[cfg.tone] ?? TONE_VARS.neutral;
  const label = t(`admin.statusLabels.${(status || 'active').toLowerCase()}`);
  if (cfg.dot) {
    return (
      <span className="flex items-center gap-1" title={label}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tone.dot }} />
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {label}
    </span>
  );
}

/**
 * Compact status dot — color-coded by membership status (active=green,
 * frozen=blue, deactivated=amber, cancelled=neutral, banned=red). Used in the
 * members directory table where a clean liveness dot beats a text pill; the
 * exact status stays available on hover (title) and to screen readers.
 */
export function StatusDot({ status, size = 9 }) {
  const { t } = useTranslation('pages');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  const tone = TONE_VARS[cfg.tone] ?? TONE_VARS.neutral;
  const label = t(`admin.statusLabels.${(status || 'active').toLowerCase()}`);
  return (
    <span className="inline-flex items-center justify-center" title={label} aria-label={label} role="img">
      <span className="rounded-full flex-shrink-0" style={{ width: size, height: size, background: tone.dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.dot} 16%, transparent)` }} />
    </span>
  );
}

export function RiskBadge({ tier, score }) {
  const { t } = useTranslation('pages');
  const cfg = RISK_CONFIG[tier] ?? RISK_CONFIG.low;
  const tone = TONE_VARS[cfg.tone] ?? TONE_VARS.neutral;
  const RiskIcon = cfg.Icon;
  const label = t(`admin.riskLabels.${(tier || 'low').toLowerCase()}`);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
      style={{ color: tone.fg, background: tone.bg }}
      role="status"
      aria-label={`${label}${score != null ? ` ${typeof score === 'number' && score % 1 === 0 ? score : score?.toFixed?.(1)}` : ''}`}
    >
      <RiskIcon size={12} className="flex-shrink-0" aria-hidden="true" />
      {label}
      {score != null && (
        <span className="admin-mono opacity-70 font-semibold">
          {typeof score === 'number' && score % 1 === 0 ? score : score?.toFixed?.(1)}
        </span>
      )}
    </span>
  );
}

export function ScoreBar({ score }) {
  const tier = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const cfg = RISK_CONFIG[tier];
  const tone = TONE_VARS[cfg.tone];
  const display = score % 1 === 0 ? score : score.toFixed(1);
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 md:min-w-[120px] h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-admin-panel)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, score)}%`, background: tone.dot }}
        />
      </div>
      <span
        className="admin-mono text-[11px] font-bold w-10 text-right"
        style={{ color: tone.fg }}
      >
        {display}%
      </span>
    </div>
  );
}

export { STATUS_CONFIG, RISK_CONFIG };

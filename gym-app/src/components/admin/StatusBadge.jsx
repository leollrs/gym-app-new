/**
 * Status badge for membership status and risk tiers.
 */
import { useTranslation } from 'react-i18next';

const STATUS_CONFIG = {
  active:      { dot: true,  key: 'active',      color: 'text-[#10B981]',  bg: 'bg-[#10B981]/10',  border: 'border-[#10B981]/20' },
  frozen:      { dot: false, key: 'frozen',      color: 'text-[#60A5FA]',  bg: 'bg-[#60A5FA]/10',  border: 'border-[#60A5FA]/20' },
  deactivated: { dot: false, key: 'deactivated', color: 'text-[#F97316]',  bg: 'bg-[#F97316]/10',  border: 'border-[#F97316]/20' },
  cancelled:   { dot: false, key: 'cancelled',   color: 'text-[#9CA3AF]',  bg: 'bg-white/6',       border: 'border-white/10' },
  banned:      { dot: false, key: 'banned',      color: 'text-[#EF4444]',  bg: 'bg-[#EF4444]/10',  border: 'border-[#EF4444]/20' },
};

const RISK_CONFIG = {
  critical: { key: 'critical', color: '#EF4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.25)' },
  high:     { key: 'high',     color: '#F97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.25)' },
  medium:   { key: 'medium',   color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.25)' },
  low:      { key: 'low',      color: '#10B981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.25)' },
};

export function StatusBadge({ status }) {
  const { t } = useTranslation('pages');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  const label = t(`admin.statusLabels.${(status || 'active').toLowerCase()}`);
  if (cfg.dot) {
    return (
      <span className="flex items-center gap-1" title={label}>
        <span className="w-2 h-2 rounded-full bg-[#10B981] flex-shrink-0" />
      </span>
    );
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {label}
    </span>
  );
}

export function RiskBadge({ tier, score }) {
  const { t } = useTranslation('pages');
  const cfg = RISK_CONFIG[tier] ?? RISK_CONFIG.low;
  const label = t(`admin.riskLabels.${(tier || 'low').toLowerCase()}`);
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
      {label}
      {score != null && <span className="opacity-60">{typeof score === 'number' && score % 1 === 0 ? score : score?.toFixed?.(1)}</span>}
    </span>
  );
}

export function ScoreBar({ score }) {
  const tier = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const cfg = RISK_CONFIG[tier];
  const display = score % 1 === 0 ? score : score.toFixed(1);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 md:min-w-[120px] h-1.5 bg-white/6 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, score)}%`, background: cfg.color }}
        />
      </div>
      <span className="text-[11px] font-bold text-[#9CA3AF] w-10 text-right">{display}%</span>
    </div>
  );
}

export { STATUS_CONFIG, RISK_CONFIG };

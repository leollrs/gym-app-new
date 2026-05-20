/**
 * Small presentational badges + comparison bar used by the Admin A/B Testing
 * page (and its ExperimentCard). Pure UI — receive their config from
 * abTestingHelpers (TIER_COLORS / EXPERIMENT_TYPES) and translate via `t`.
 */

import { EXPERIMENT_TYPES, TIER_COLORS } from '../../../lib/admin/abTestingHelpers';

export function TierBadge({ tier, t }) {
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

export function TypeBadge({ type, t }) {
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

export function VariantPill({ label, summary, color }) {
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

export function ComparisonBar({ valueA, valueB, label }) {
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

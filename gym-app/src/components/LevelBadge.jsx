import React from 'react';
import { useTranslation } from 'react-i18next';
import { getRewardTier } from '../lib/rewardsEngine';

// ── Level calculation ────────────────────────────────────────────────────────
// Each level = 200 XP. Level 1 starts at 0 XP.
const XP_PER_LEVEL = 200;

export function getLevel(totalPoints) {
  const level = Math.floor(totalPoints / XP_PER_LEVEL) + 1;
  const xpIntoLevel = totalPoints % XP_PER_LEVEL;
  const xpForNext = XP_PER_LEVEL;
  const progress = (xpIntoLevel / xpForNext) * 100;
  return { level, xpIntoLevel, xpForNext, progress };
}

// ── Compact badge (for nav, social cards, etc.) ──────────────────────────────
export function LevelBadgeCompact({ totalPoints, size = 'sm' }) {
  const { t } = useTranslation('pages');
  const { level } = getLevel(totalPoints);
  const tier = getRewardTier(totalPoints);

  const sizes = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-[12px]',
  };

  const tierLabel = t(`rewards.tiers.${tier.nameKey}`, tier.name);

  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-black flex-shrink-0 tabular-nums`}
      style={{
        backgroundColor: `${tier.color}20`,
        color: tier.color,
        border: `1.5px solid ${tier.color}40`,
      }}
      title={`${t('rewards.level', 'Level')} ${level} • ${tierLabel}`}
    >
      {level}
    </div>
  );
}

// ── Full level card (for dashboard, profile) ─────────────────────────────────
export function LevelCard({ totalPoints, lifetimePoints, className = '' }) {
  const { t } = useTranslation('pages');
  // Level and tier are based on lifetime points (never decrease when spending)
  const pts = lifetimePoints ?? totalPoints ?? 0;
  const { level, xpIntoLevel, xpForNext, progress } = getLevel(pts);
  const tier = getRewardTier(pts);
  const levelLabel = t('rewards.level', 'Level');
  const tierLabel = t(`rewards.tiers.${tier.nameKey}`, tier.name);

  return (
    <div className={`bg-white/[0.04] rounded-2xl border border-white/[0.06] p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center font-black text-[18px] tabular-nums"
          style={{
            backgroundColor: `${tier.color}15`,
            color: tier.color,
            border: `2px solid ${tier.color}40`,
          }}
        >
          {level}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-[#E5E7EB]">{levelLabel} {level}</span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: `${tier.color}15`,
                color: tier.color,
                border: `1px solid ${tier.color}30`,
              }}
            >
              {tierLabel}
            </span>
          </div>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            {t('rewards.xpTotal', { count: totalPoints.toLocaleString() })}
          </p>
        </div>
      </div>

      {/* XP Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[#6B7280]">
            {xpIntoLevel} / {xpForNext} XP
          </span>
          <span className="text-[10px] font-semibold" style={{ color: tier.color }}>
            {levelLabel} {level + 1}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%`, backgroundColor: tier.color }}
          />
        </div>
      </div>
    </div>
  );
}

export default LevelBadgeCompact;

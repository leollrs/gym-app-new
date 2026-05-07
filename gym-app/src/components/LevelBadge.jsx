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
export function LevelBadgeCompact({ totalPoints, size = 'sm', interactive = false }) {
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
      className={`${sizes[size]} ${interactive ? 'min-w-[44px] min-h-[44px]' : ''} rounded-full flex items-center justify-center font-black flex-shrink-0 tabular-nums`}
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
export function LevelCard({ totalPoints, lifetimePoints, className = '', onReport }) {
  const { t } = useTranslation('pages');
  const pts = lifetimePoints ?? totalPoints ?? 0;
  const { level, xpIntoLevel, xpForNext, progress } = getLevel(pts);
  const tier = getRewardTier(pts);
  const levelLabel = t('rewards.level', 'Level');
  const tierLabel = t(`rewards.tiers.${tier.nameKey}`, tier.name);
  const COACH = '#6D5FDB';

  return (
    <div className={`rounded-[22px] p-[18px] relative overflow-hidden ${className}`}
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
      {/* Decorative gradient blob */}
      <div className="absolute -top-8 -right-8 w-[120px] h-[120px] rounded-full" style={{ background: `radial-gradient(circle, rgba(109,95,219,0.08) 0%, transparent 70%)` }} />

      <div className="flex items-center gap-3.5 mb-3.5 relative">
        {/* Purple gradient level circle */}
        <div className="w-[56px] h-[56px] rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${COACH} 0%, #4a3fc8 100%)`, boxShadow: '0 4px 12px rgba(109,95,219,0.25)' }}>
          <span style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui', fontSize: 22, fontWeight: 800, color: '#fff' }}>{level}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui', fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
              {levelLabel} {level}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-muted)', letterSpacing: 0.8 }}>
              {tierLabel.toUpperCase()}
            </span>
          </div>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {pts.toLocaleString()} XP {'\u00B7'} {xpForNext - xpIntoLevel} {t('rewards.xpTo', 'to')} {levelLabel} {level + 1}
          </p>
        </div>
        {onReport && (
          <button onClick={onReport}
            className="flex-shrink-0 flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all"
            style={{ background: 'var(--color-accent, #2EC4C4)12', color: 'var(--color-accent, #2EC4C4)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
            {t('progress.overview.report', 'Report')}
          </button>
        )}
      </div>

      {/* XP Progress bar — purple gradient */}
      <div className="h-[6px] rounded-full overflow-hidden relative" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${Math.max(progress, 2)}%`, background: `linear-gradient(90deg, ${COACH}, #8B7DFF)` }} />
      </div>
    </div>
  );
}

export default LevelBadgeCompact;

import React from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const ACCENT = 'var(--color-accent, #2EC4C4)';
const MEDAL_COLORS = ['var(--color-accent, #2EC4C4)', 'var(--color-text-muted)', '#92400E'];

export default function MostImprovedList({ entries, loading, userId }) {
  const { t } = useTranslation('pages');
  if (loading) {
    return (
      <div className="flex flex-col gap-2.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="rounded-[18px] border border-[var(--color-border,rgba(200,200,200,0.1))] h-[60px] animate-pulse" style={{ background: 'var(--color-bg-card)' }} />
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-20">
        <TrendingUp size={32} className="text-[var(--color-text-subtle)] mx-auto mb-3" />
        <p className="text-[14px] text-[var(--color-text-muted)]">{t('leaderboard.noImprovementData', { defaultValue: 'No improvement data yet' })}</p>
        <p className="text-[12px] text-[var(--color-text-subtle)] mt-1">{t('leaderboard.noImprovementDataHint', { defaultValue: 'Train consistently across two periods to see progress' })}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, i) => {
        const rank = i + 1;
        const isMe = entry.id === userId;
        const isTopThree = rank <= 3;
        const medalColor = isTopThree ? MEDAL_COLORS[rank - 1] : null;

        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-4 py-3 rounded-[18px] transition-colors overflow-hidden border"
            style={{
              background: isMe ? 'color-mix(in srgb, var(--color-accent, #2EC4C4) 6%, var(--color-bg-card))' : 'var(--color-bg-card)',
              borderColor: isMe ? 'color-mix(in srgb, var(--color-accent, #2EC4C4) 20%, transparent)' : 'var(--color-border, rgba(200,200,200,0.1))',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
            }}
          >
            {/* Rank */}
            <div className="w-7 flex items-center justify-center flex-shrink-0">
              {isTopThree ? (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black"
                  style={{ backgroundColor: `color-mix(in srgb, ${medalColor} 12%, transparent)`, color: medalColor, fontFamily: DISPLAY_FONT }}
                >
                  {rank}
                </div>
              ) : (
                <span className="text-[13px] font-bold text-[var(--color-text-subtle)]" style={{ fontFamily: DISPLAY_FONT }}>{rank}</span>
              )}
            </div>

            {/* Avatar */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: 'var(--color-bg-elevated, var(--color-bg-card))' }}>
              {entry.avatar ? (
                <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[12px] font-bold text-[var(--color-text-muted)]">
                  {entry.name?.charAt(0)?.toUpperCase() ?? '?'}
                </span>
              )}
            </div>

            {/* Name + previous -> current */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate" style={{ color: isMe ? ACCENT : 'var(--color-text-primary)' }}>
                {isMe ? t('leaderboard.you', { defaultValue: 'You' }) : entry.name}
              </p>
              {entry.previous_value != null && entry.current_value != null && (
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
                  {Math.round(entry.previous_value).toLocaleString()} → {Math.round(entry.current_value).toLocaleString()}
                </p>
              )}
            </div>

            {/* Improvement % */}
            <div className="flex items-center gap-1 flex-shrink-0" style={{ color: isMe ? ACCENT : 'var(--color-success, #10B981)' }}>
              <TrendingUp size={12} />
              <span className="text-[13px] font-bold" style={{ fontFamily: DISPLAY_FONT }}>+{entry.score}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

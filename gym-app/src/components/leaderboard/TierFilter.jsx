import React from 'react';
import { useTranslation } from 'react-i18next';

const TIERS = [
  { key: null,           label: 'All' },
  { key: 'beginner',     label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced',     label: 'Advanced' },
];

export default function TierFilter({ active, onChange }) {
  const { t } = useTranslation('pages');
  return (
    <div className="flex gap-1.5">
      {TIERS.map(tp => (
        <button
          key={tp.key ?? 'all'}
          type="button"
          onClick={() => onChange(tp.key)}
          className={`px-3.5 py-1.5 min-h-[44px] min-w-[44px] text-[11px] font-semibold transition-all ${
            active === tp.key
              ? 'text-white'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
          style={{
            borderRadius: 999,
            ...(active === tp.key
              ? { background: 'var(--color-accent, #2EC4C4)' }
              : { background: 'transparent', border: '1px solid var(--color-border, rgba(200,200,200,0.15))' }),
          }}
        >
          {t(`leaderboard.tiers.${tp.key ?? 'all'}`)}
        </button>
      ))}
    </div>
  );
}

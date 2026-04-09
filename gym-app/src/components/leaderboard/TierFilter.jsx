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
    <div className="flex gap-1">
      {TIERS.map(tp => (
        <button
          key={tp.key ?? 'all'}
          type="button"
          onClick={() => onChange(tp.key)}
          className={`px-3 py-1.5 min-h-[44px] min-w-[44px] rounded-lg text-[11px] font-semibold transition-all ${
            active === tp.key
              ? 'bg-white/[0.08] text-[#E5E7EB]'
              : 'text-[#4B5563] hover:text-[#6B7280]'
          }`}
        >
          {t(`leaderboard.tiers.${tp.key ?? 'all'}`)}
        </button>
      ))}
    </div>
  );
}

import React from 'react';

const TIERS = [
  { key: null,           label: 'All' },
  { key: 'beginner',     label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced',     label: 'Advanced' },
];

export default function TierFilter({ active, onChange }) {
  return (
    <div className="flex gap-1">
      {TIERS.map(t => (
        <button
          key={t.key ?? 'all'}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
            active === t.key
              ? 'bg-white/[0.08] text-[#E5E7EB]'
              : 'text-[#4B5563] hover:text-[#6B7280]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

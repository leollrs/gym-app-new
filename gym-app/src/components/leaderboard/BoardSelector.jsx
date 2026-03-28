import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const BOARDS = [
  { key: 'rankings',    label: 'Rankings' },
  { key: 'improved',    label: 'Most Improved' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'prs',         label: 'PR Kings' },
  { key: 'checkins',    label: 'Check-Ins' },
  { key: 'newcomers',   label: 'Newcomers' },
  { key: 'milestones',  label: 'Milestones' },
];

export { BOARDS };

export default function BoardSelector({ active, onChange }) {
  const { t } = useTranslation('pages');
  const scrollRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const el = activeRef.current;
      const left = el.offsetLeft - container.offsetWidth / 2 + el.offsetWidth / 2;
      container.scrollTo({ left, behavior: 'smooth' });
    }
  }, [active]);

  return (
    <div
      ref={scrollRef}
      className="flex gap-1 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1"
    >
      {BOARDS.map(b => (
        <button
          key={b.key}
          ref={b.key === active ? activeRef : null}
          type="button"
          onClick={() => onChange(b.key)}
          className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all whitespace-nowrap ${
            active === b.key
              ? 'bg-[#D4AF37] text-[#05070B]'
              : 'bg-white/[0.04] text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.06]'
          }`}
        >
          {t(`leaderboard.boards.${b.key}`)}
        </button>
      ))}
    </div>
  );
}

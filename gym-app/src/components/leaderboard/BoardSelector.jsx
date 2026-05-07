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
      className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1"
    >
      {BOARDS.map(b => (
        <button
          key={b.key}
          ref={b.key === active ? activeRef : null}
          type="button"
          onClick={() => onChange(b.key)}
          className={`flex-shrink-0 px-4 py-2 text-[12px] font-semibold transition-all whitespace-nowrap ${
            active === b.key
              ? 'text-white'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
          style={{
            borderRadius: 999,
            ...(active === b.key
              ? { background: 'var(--color-accent, #2EC4C4)' }
              : { background: 'transparent', border: '1px solid var(--color-border, rgba(200,200,200,0.15))' }),
          }}
        >
          {t(`leaderboard.boards.${b.key}`)}
        </button>
      ))}
    </div>
  );
}

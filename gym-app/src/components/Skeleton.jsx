import React from 'react';

/**
 * Reusable skeleton loading component with shimmer animation.
 * Matches the app's dark theme (bg-[#0F172A], subtle white/opacity).
 *
 * Variants:
 *   card   — card-shaped placeholder (full-width, rounded)
 *   text   — multiple text line placeholders (use `lines` prop)
 *   avatar — circular placeholder
 *   stat   — stat card placeholder (icon + value + label)
 *   chart  — chart area placeholder
 *   feed   — social feed card placeholder
 */

const shimmer =
  'relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.8s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.04] before:to-transparent';

// --- Variant renderers ---

const SkeletonCard = ({ className = '', height = 'h-[140px]' }) => (
  <div
    className={`${height} rounded-[14px] bg-[#0F172A] border border-white/8 animate-pulse ${shimmer} ${className}`}
  />
);

const SkeletonText = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2.5 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        className={`h-3.5 rounded-lg bg-white/[0.06] animate-pulse ${shimmer}`}
        style={{ width: i === lines - 1 ? '60%' : '100%' }}
      />
    ))}
  </div>
);

const SkeletonAvatar = ({ size = 44, className = '' }) => (
  <div
    className={`rounded-full bg-white/[0.06] animate-pulse flex-shrink-0 ${shimmer} ${className}`}
    style={{ width: size, height: size }}
  />
);

const SkeletonStat = ({ className = '' }) => (
  <div
    className={`rounded-[14px] bg-[#0F172A] border border-white/8 p-4 animate-pulse ${shimmer} ${className}`}
  >
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-8 h-8 rounded-lg bg-white/[0.06]" />
      <div className="h-3 w-16 rounded-md bg-white/[0.06]" />
    </div>
    <div className="h-7 w-20 rounded-lg bg-white/[0.06] mb-1.5" />
    <div className="h-3 w-14 rounded-md bg-white/[0.04]" />
  </div>
);

const SkeletonChart = ({ className = '' }) => (
  <div
    className={`rounded-[14px] bg-[#0F172A] border border-white/8 p-5 animate-pulse ${shimmer} ${className}`}
  >
    <div className="h-4 w-32 rounded-md bg-white/[0.06] mb-4" />
    <div className="flex items-end gap-2 h-[160px]">
      {[40, 65, 50, 80, 55, 70, 45, 60, 75, 50, 85, 65].map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-md bg-white/[0.04]"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
    <div className="flex justify-between mt-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-2.5 w-8 rounded bg-white/[0.04]" />
      ))}
    </div>
  </div>
);

const SkeletonFeed = ({ className = '' }) => (
  <div
    className={`rounded-[14px] bg-[#0F172A] border border-white/8 overflow-hidden animate-pulse ${shimmer} ${className}`}
  >
    {/* Header */}
    <div className="flex items-center gap-4 p-5 pb-4">
      <div className="w-11 h-11 rounded-full bg-white/[0.06]" />
      <div className="flex-1">
        <div className="h-3.5 w-28 rounded-md bg-white/[0.06] mb-2" />
        <div className="h-2.5 w-20 rounded-md bg-white/[0.04]" />
      </div>
    </div>
    {/* Content */}
    <div className="px-5 pb-4">
      <div className="rounded-[14px] bg-white/[0.03] p-4 space-y-2.5">
        <div className="h-4 w-3/4 rounded-md bg-white/[0.06]" />
        <div className="h-3 w-1/2 rounded-md bg-white/[0.04]" />
      </div>
    </div>
    {/* Action bar */}
    <div className="flex items-center gap-6 px-5 py-3 border-t border-white/8">
      <div className="h-3 w-12 rounded bg-white/[0.04]" />
      <div className="h-3 w-16 rounded bg-white/[0.04]" />
      <div className="h-3 w-10 rounded bg-white/[0.04]" />
    </div>
  </div>
);

const SkeletonListItem = ({ className = '' }) => (
  <div
    className={`rounded-[14px] bg-[#0F172A] border border-white/8 flex items-center gap-3 px-4 py-3.5 animate-pulse ${shimmer} ${className}`}
  >
    <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex-shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="h-3.5 w-32 rounded-md bg-white/[0.06] mb-2" />
      <div className="h-2.5 w-24 rounded-md bg-white/[0.04]" />
    </div>
    <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex-shrink-0" />
  </div>
);

const SkeletonPage = ({ className = '' }) => (
  <div className={`p-4 space-y-4 ${className}`}>
    {/* Page title */}
    <div className={`h-7 w-40 rounded-lg bg-white/[0.06] animate-pulse ${shimmer}`} />
    {/* Stat row */}
    <div className="grid grid-cols-2 gap-3">
      <SkeletonStat />
      <SkeletonStat />
    </div>
    {/* Content card */}
    <SkeletonCard height="h-[200px]" />
    {/* List items */}
    <div className="space-y-3">
      <SkeletonListItem />
      <SkeletonListItem />
      <SkeletonListItem />
    </div>
  </div>
);

// --- Main component ---

const VARIANTS = {
  card: SkeletonCard,
  text: SkeletonText,
  avatar: SkeletonAvatar,
  stat: SkeletonStat,
  chart: SkeletonChart,
  feed: SkeletonFeed,
  'list-item': SkeletonListItem,
  page: SkeletonPage,
};

const Skeleton = ({ variant = 'card', count = 1, className = '', ...props }) => {
  const Component = VARIANTS[variant] || SkeletonCard;

  if (count === 1) {
    return <Component className={className} {...props} />;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} {...props} />
      ))}
    </div>
  );
};

// Also export individual variants for flexibility
Skeleton.Card = SkeletonCard;
Skeleton.Text = SkeletonText;
Skeleton.Avatar = SkeletonAvatar;
Skeleton.Stat = SkeletonStat;
Skeleton.Chart = SkeletonChart;
Skeleton.Feed = SkeletonFeed;
Skeleton.ListItem = SkeletonListItem;
Skeleton.Page = SkeletonPage;

export default Skeleton;

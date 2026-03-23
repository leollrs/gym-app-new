/**
 * Skeleton loading primitives for admin pages.
 */

export const Skeleton = ({ className = '' }) => (
  <div
    className={`bg-white/6 rounded-[10px] ${className}`}
    style={{ animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
  />
);

export const SkeletonRow = () => (
  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/4 last:border-0 animate-pulse">
    <div className="w-9 h-9 rounded-full bg-white/6 flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 bg-white/6 rounded-full w-32" />
      <div className="h-2.5 bg-white/4 rounded-full w-48" />
    </div>
    <div className="h-5 w-20 bg-white/6 rounded-full" />
  </div>
);

export const CardSkeleton = ({ h = 'h-[220px]' }) => (
  <div className={`bg-[#0F172A] border border-white/6 rounded-xl p-4 ${h}`}>
    <Skeleton className="h-4 w-36 mb-5" />
    <Skeleton className="h-full w-full" />
  </div>
);

export const TableSkeleton = ({ rows = 5 }) => (
  <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-white/6 animate-pulse">
      <div className="flex gap-8">
        <div className="h-3 bg-white/6 rounded-full w-20" />
        <div className="h-3 bg-white/6 rounded-full w-24" />
        <div className="h-3 bg-white/6 rounded-full w-16" />
      </div>
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonRow key={i} />
    ))}
  </div>
);

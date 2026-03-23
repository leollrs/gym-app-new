import React from 'react';

export default function LoadMoreButton({ hasMore, loading, onLoadMore }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-6">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className="px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-50 bg-white/[0.04] border border-white/8 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            Loading…
          </span>
        ) : 'Load more'}
      </button>
    </div>
  );
}

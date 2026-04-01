import React from 'react';
import { Target } from 'lucide-react';

const MEDAL_COLORS = ['#D4AF37', '#9CA3AF', '#92400E'];

export default function ConsistencyList({ entries, loading, userId }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[60px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-20">
        <Target size={32} className="text-[#4B5563] mx-auto mb-3" />
        <p className="text-[14px] text-[#6B7280]">No consistency data yet</p>
        <p className="text-[12px] text-[#4B5563] mt-1">Set your training days in onboarding to track consistency</p>
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
        const pct = Math.min(entry.score, 100);

        return (
          <div
            key={entry.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-[14px] transition-colors overflow-hidden ${
              isMe
                ? 'bg-[#D4AF37]/8 border border-[#D4AF37]/20'
                : 'bg-[#0F172A] border border-white/6'
            }`}
          >
            {/* Rank */}
            <div className="w-7 flex items-center justify-center flex-shrink-0">
              {isTopThree ? (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black"
                  style={{ backgroundColor: `${medalColor}20`, color: medalColor }}
                >
                  {rank}
                </div>
              ) : (
                <span className="text-[13px] font-bold text-[#4B5563]">{rank}</span>
              )}
            </div>

            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {entry.avatar ? (
                <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[12px] font-bold text-[#9CA3AF]">
                  {entry.name?.charAt(0)?.toUpperCase() ?? '?'}
                </span>
              )}
            </div>

            {/* Name + days */}
            <div className="flex-1 min-w-0">
              <p className={`text-[13px] font-medium truncate ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                {isMe ? 'You' : entry.name}
              </p>
              {entry.actual_days != null && entry.planned_days != null && (
                <p className="text-[10px] text-[#4B5563] mt-0.5">
                  {entry.actual_days} of {entry.planned_days}/wk planned days
                </p>
              )}
            </div>

            {/* Consistency ring + % */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Mini progress bar */}
              <div className="w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-[#10B981]' : pct >= 50 ? 'bg-[#D4AF37]' : 'bg-[#EF4444]'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`text-[13px] font-bold ${isMe ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>
                {pct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

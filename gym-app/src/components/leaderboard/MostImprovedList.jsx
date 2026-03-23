import React from 'react';
import { TrendingUp, Trophy } from 'lucide-react';

const MEDAL_COLORS = ['#D4AF37', '#9CA3AF', '#92400E'];

export default function MostImprovedList({ entries, loading, userId }) {
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
        <TrendingUp size={32} className="text-[#4B5563] mx-auto mb-3" />
        <p className="text-[14px] text-[#6B7280]">No improvement data yet</p>
        <p className="text-[12px] text-[#4B5563] mt-1">Train consistently across two periods to see progress</p>
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
            className={`flex items-center gap-3 px-4 py-3 rounded-[14px] transition-colors ${
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

            {/* Name + previous → current */}
            <div className="flex-1 min-w-0">
              <p className={`text-[13px] font-medium truncate ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                {isMe ? 'You' : entry.name}
              </p>
              {entry.previous_value != null && entry.current_value != null && (
                <p className="text-[10px] text-[#4B5563] mt-0.5">
                  {Math.round(entry.previous_value).toLocaleString()} → {Math.round(entry.current_value).toLocaleString()}
                </p>
              )}
            </div>

            {/* Improvement % */}
            <div className={`flex items-center gap-1 flex-shrink-0 ${isMe ? 'text-[#D4AF37]' : 'text-[#10B981]'}`}>
              <TrendingUp size={12} />
              <span className="text-[13px] font-bold">+{entry.score}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

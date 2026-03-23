import React from 'react';
import { Trophy, Dumbbell, Flame, Sparkles, Award } from 'lucide-react';

const MILESTONE_CONFIG = {
  workout_count: {
    icon: Dumbbell,
    color: '#3B82F6',
    label: (data) => {
      const n = data?.count ?? 0;
      if (n === 1) return 'Completed their first workout!';
      return `Completed ${n} workouts!`;
    },
  },
  streak: {
    icon: Flame,
    color: '#EF4444',
    label: (data) => `${data?.days ?? 0}-day streak!`,
  },
  first_pr: {
    icon: Trophy,
    color: '#D4AF37',
    label: (data) => `First PR on ${data?.exercise_name ?? 'an exercise'}! ${data?.weight_lbs ?? 0} lbs x ${data?.reps ?? 0}`,
  },
  pr_count: {
    icon: Award,
    color: '#A855F7',
    label: (data) => `${data?.count ?? 0} personal records total!`,
  },
};

const DEFAULT_CONFIG = {
  icon: Sparkles,
  color: '#10B981',
  label: () => 'New milestone!',
};

function timeAgoShort(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export default function MilestoneFeed({ entries, loading }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[72px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-20">
        <Sparkles size={32} className="text-[#4B5563] mx-auto mb-3" />
        <p className="text-[14px] text-[#6B7280]">No milestones yet</p>
        <p className="text-[12px] text-[#4B5563] mt-1">Complete workouts to celebrate achievements</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(entry => {
        const config = MILESTONE_CONFIG[entry.type] ?? DEFAULT_CONFIG;
        const Icon = config.icon;
        const description = config.label(entry.data ?? {});

        return (
          <div
            key={entry.id}
            className="flex items-center gap-3.5 px-4 py-3.5 rounded-[14px] bg-[#0F172A] border border-white/6"
          >
            {/* Icon badge */}
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${config.color}15` }}
            >
              <Icon size={18} style={{ color: config.color }} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                {entry.name}
              </p>
              <p className="text-[12px] text-[#9CA3AF] mt-0.5 leading-snug">
                {description}
              </p>
            </div>

            {/* Time ago */}
            <span className="text-[11px] text-[#4B5563] flex-shrink-0">
              {timeAgoShort(entry.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

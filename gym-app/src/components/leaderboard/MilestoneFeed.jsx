import React, { useState, useCallback } from 'react';
import { Trophy, Dumbbell, Flame, Sparkles, Award } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

const MILESTONE_CONFIG = {
  workout_count: {
    icon: Dumbbell,
    color: '#3B82F6',
    label: (data, t) => {
      const n = data?.count ?? 0;
      if (n === 1) return t?.('social.milestones.firstWorkout') ?? 'Completed their first workout!';
      return t?.('social.milestones.workoutCount', { count: n }) ?? `Completed ${n} workouts!`;
    },
  },
  streak: {
    icon: Flame,
    color: '#EF4444',
    label: (data, t) => t?.('social.milestones.streak', { days: data?.days ?? 0 }) ?? `${data?.days ?? 0}-day streak!`,
  },
  first_pr: {
    icon: Trophy,
    color: '#D4AF37',
    label: (data, t) => t?.('social.milestones.firstPR', {
      exercise: data?.exercise_name ?? 'an exercise',
      weight: data?.weight_lbs ?? 0,
      reps: data?.reps ?? 0,
    }) ?? `First PR on ${data?.exercise_name ?? 'an exercise'}! ${data?.weight_lbs ?? 0} lbs x ${data?.reps ?? 0}`,
  },
  pr_count: {
    icon: Award,
    color: '#A855F7',
    label: (data, t) => t?.('social.milestones.prCount', { count: data?.count ?? 0 }) ?? `${data?.count ?? 0} personal records total!`,
  },
};

const DEFAULT_CONFIG = {
  icon: Sparkles,
  color: '#10B981',
  label: (_data, t) => t?.('social.milestones.new') ?? 'New milestone!',
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

// ── Milestone Item with Reaction ────────────────────────────────────────────
const MilestoneItem = ({ entry, config, currentUserId }) => {
  const { t } = useTranslation('pages');
  const Icon = config.icon;
  const description = config.label(entry.data ?? {}, t);
  const [reactionCount, setReactionCount] = useState(entry.reaction_count ?? 0);
  const [hasReacted, setHasReacted] = useState(entry.has_reacted ?? false);
  const [animating, setAnimating] = useState(false);

  const handleReact = useCallback(async () => {
    if (!currentUserId) return;

    if (hasReacted) {
      // Remove reaction
      setHasReacted(false);
      setReactionCount(c => Math.max(0, c - 1));
      await supabase
        .from('milestone_reactions')
        .delete()
        .eq('milestone_id', entry.id)
        .eq('profile_id', currentUserId);
    } else {
      // Add reaction + animate
      setHasReacted(true);
      setReactionCount(c => c + 1);
      setAnimating(true);
      setTimeout(() => setAnimating(false), 600);

      await supabase
        .from('milestone_reactions')
        .insert({ milestone_id: entry.id, profile_id: currentUserId });

      // Send congratulation notification to milestone owner
      if (entry.profile_id && entry.profile_id !== currentUserId) {
        supabase.from('notifications').insert({
          profile_id: entry.profile_id,
          type: 'milestone',
          title: t('social.milestoneReactionTitle'),
          body: t('social.milestoneReactionBody', { name: entry.name }),
          data: { milestone_id: entry.id, reactor_id: currentUserId },
          dedup_key: `milestone_reaction_${entry.id}_${currentUserId}`,
        }).then(() => {});
      }
    }
  }, [currentUserId, hasReacted, entry.id, entry.profile_id, entry.name, t]);

  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-[14px] bg-[#0F172A] border border-white/6 overflow-hidden">
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

      {/* Reaction button */}
      <button
        type="button"
        onClick={handleReact}
        aria-label={t('social.congratulate')}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all active:scale-90 flex-shrink-0 ${
          hasReacted
            ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
            : 'bg-white/[0.04] text-[#6B7280] hover:bg-white/[0.08] hover:text-[#9CA3AF]'
        }`}
      >
        <span className={`text-[16px] ${animating ? 'animate-bounce' : ''}`}>
          {'\uD83D\uDC4F'}
        </span>
        {reactionCount > 0 && <span>{reactionCount}</span>}
      </button>

      {/* Time ago */}
      <span className="text-[11px] text-[#4B5563] flex-shrink-0">
        {timeAgoShort(entry.created_at)}
      </span>
    </div>
  );
};

export default function MilestoneFeed({ entries, loading }) {
  const { user } = useAuth();
  const currentUserId = user?.id;

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
        return (
          <MilestoneItem
            key={entry.id}
            entry={entry}
            config={config}
            currentUserId={currentUserId}
          />
        );
      })}
    </div>
  );
}

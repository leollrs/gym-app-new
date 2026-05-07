import React, { useState, useCallback } from 'react';
import { Trophy, Dumbbell, Flame, Sparkles, Award } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

const ACCENT = 'var(--color-accent, #2EC4C4)';

const MILESTONE_CONFIG = {
  workout_count: {
    icon: Dumbbell,
    color: 'var(--color-blue, #3B82F6)',
    label: (data, t) => {
      const n = data?.count ?? 0;
      if (n === 1) return t?.('social.milestones.firstWorkout') ?? 'Completed their first workout!';
      return t?.('social.milestones.workoutCount', { count: n }) ?? `Completed ${n} workouts!`;
    },
  },
  streak: {
    icon: Flame,
    color: '#FF5A2E',
    label: (data, t) => t?.('social.milestones.streak', { days: data?.days ?? 0 }) ?? `${data?.days ?? 0}-day streak!`,
  },
  first_pr: {
    icon: Trophy,
    color: ACCENT,
    label: (data, t) => t?.('social.milestones.firstPR', {
      exercise: data?.exercise_name ?? 'an exercise',
      weight: data?.weight_lbs ?? 0,
      reps: data?.reps ?? 0,
    }) ?? `First PR on ${data?.exercise_name ?? 'an exercise'}! ${data?.weight_lbs ?? 0} lbs x ${data?.reps ?? 0}`,
  },
  pr_count: {
    icon: Award,
    color: '#6D5FDB',
    label: (data, t) => t?.('social.milestones.prCount', { count: data?.count ?? 0 }) ?? `${data?.count ?? 0} personal records total!`,
  },
};

const DEFAULT_CONFIG = {
  icon: Sparkles,
  color: 'var(--color-success, #10B981)',
  label: (_data, t) => t?.('social.milestones.new') ?? 'New milestone!',
};

function timeAgoShort(iso, t) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t ? t('milestones.timeNow', { defaultValue: 'now' }) : 'now';
  if (mins < 60) return t ? t('milestones.timeMinutes', { defaultValue: '{{count}}m', count: mins }) : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t ? t('milestones.timeHours', { defaultValue: '{{count}}h', count: hrs }) : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return t ? t('milestones.timeDays', { defaultValue: '{{count}}d', count: days }) : `${days}d`;
  const weeks = Math.floor(days / 7);
  return t ? t('milestones.timeWeeks', { defaultValue: '{{count}}w', count: weeks }) : `${weeks}w`;
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
    <div
      className="flex items-center gap-3.5 px-4 py-3.5 rounded-[18px] border overflow-hidden"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: 'var(--color-border, rgba(200,200,200,0.1))',
        boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
      }}
    >
      {/* Icon badge */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${config.color} 10%, transparent)` }}
      >
        <Icon size={18} style={{ color: config.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
          {entry.name}
        </p>
        <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
          {description}
        </p>
      </div>

      {/* Reaction button */}
      <button
        type="button"
        onClick={handleReact}
        aria-label={t('social.congratulate')}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-semibold transition-all active:scale-90 flex-shrink-0`}
        style={{
          background: hasReacted ? 'color-mix(in srgb, var(--color-accent, #2EC4C4) 12%, transparent)' : 'var(--color-bg-elevated, var(--color-bg-card))',
          color: hasReacted ? 'var(--color-accent, #2EC4C4)' : 'var(--color-text-muted)',
        }}
      >
        <span className={`text-[16px] ${animating ? 'animate-bounce' : ''}`}>
          {'\uD83D\uDC4F'}
        </span>
        {reactionCount > 0 && <span>{reactionCount}</span>}
      </button>

      {/* Time ago */}
      <span className="text-[11px] text-[var(--color-text-subtle)] flex-shrink-0">
        {timeAgoShort(entry.created_at, t)}
      </span>
    </div>
  );
};

export default function MilestoneFeed({ entries, loading }) {
  const { user } = useAuth();
  const { t } = useTranslation('pages');
  const currentUserId = user?.id;

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="rounded-[18px] border border-[var(--color-border,rgba(200,200,200,0.1))] h-[72px] animate-pulse" style={{ background: 'var(--color-bg-card)' }} />
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-20">
        <Sparkles size={32} className="text-[var(--color-text-subtle)] mx-auto mb-3" />
        <p className="text-[14px] text-[var(--color-text-muted)]">{t('milestones.noMilestonesYet', { defaultValue: 'No milestones yet' })}</p>
        <p className="text-[12px] text-[var(--color-text-subtle)] mt-1">{t('milestones.noMilestonesHint', { defaultValue: 'Complete workouts to celebrate achievements' })}</p>
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

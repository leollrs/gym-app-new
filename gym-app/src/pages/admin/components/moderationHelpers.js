import { Activity, MessageSquare, MessagesSquare, User as UserIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sanitize } from '../../../lib/sanitize';

/**
 * Display config + label helpers shared across the AdminModeration
 * surfaces: posts/comments/reports tabs, the ReportDetailModal, and any
 * future moderation views.
 *
 * Functions take an optional i18n `t` so callers from a context without
 * translations (tests, jobs) still get a sensible English fallback.
 */

// ── Post type chip colors + labels ─────────────────────────

const POST_TYPE_COLORS = {
  workout_completed:   'text-emerald-400 bg-emerald-500/10',
  pr_hit:              'text-[#D4AF37] bg-[#D4AF37]/10',
  challenge_joined:    'text-blue-400 bg-blue-500/10',
  challenge_won:       'text-purple-400 bg-purple-500/10',
  achievement_unlocked:'text-pink-400 bg-pink-500/10',
  check_in:            'text-cyan-400 bg-cyan-500/10',
  program_started:     'text-indigo-400 bg-indigo-500/10',
};

const POST_TYPE_KEYS = {
  workout_completed:   'workout',
  pr_hit:              'prHit',
  challenge_joined:    'challenge',
  challenge_won:       'won',
  achievement_unlocked:'achievement',
  check_in:            'checkIn',
  program_started:     'program',
};

export const postTypeBadge = (type, t) => {
  const color = POST_TYPE_COLORS[type];
  const key = POST_TYPE_KEYS[type];
  if (!color || !key) return { label: t ? t(`admin.moderation.postTypes.unknown`, { defaultValue: type ?? 'Unknown' }) : (type ?? 'Unknown'), color: 'text-[#9CA3AF] bg-white/6' };
  const label = t ? t(`admin.moderation.postTypes.${key}`, { defaultValue: key }) : key;
  return { label, color };
};

export const relativeTime = (ts, dateFnsOpts) => {
  if (!ts) return '—';
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true, ...dateFnsOpts }); }
  catch { return '—'; }
};

/**
 * Format the "data" JSONB column for a feed item into a short summary
 * string for the moderation table. Returns null when there's nothing
 * interesting to show — callers should hide the row when that happens.
 */
export const dataPreview = (type, data, t) => {
  if (!data || typeof data !== 'object') return null;
  switch (type) {
    case 'workout_completed':
      return [
        data.workout_name && `"${sanitize(data.workout_name)}"`,
        data.duration_min != null && `${data.duration_min} min`,
        data.total_volume_lbs != null && `${Math.round(data.total_volume_lbs).toLocaleString()} lbs`,
      ].filter(Boolean).join(' · ') || null;
    case 'pr_hit':
      return [
        data.exercise_name && sanitize(data.exercise_name),
        data.weight_lbs != null && data.reps != null && `${data.weight_lbs} lbs × ${data.reps}`,
        data.estimated_1rm != null && `est. 1RM ${Math.round(data.estimated_1rm)} lbs`,
      ].filter(Boolean).join(' · ') || null;
    case 'challenge_joined':
    case 'challenge_won':
      return data.challenge_name ? `"${sanitize(data.challenge_name)}"` : null;
    case 'achievement_unlocked':
      return data.achievement_name ? `"${sanitize(data.achievement_name)}"` : null;
    case 'check_in':
      return data.method ? (t ? t('admin.moderation.viaMethod', { defaultValue: 'Via {{method}}', method: sanitize(data.method) }) : `Via ${sanitize(data.method)}`) : null;
    case 'program_started':
      return data.program_name ? `"${sanitize(data.program_name)}"` : null;
    default:
      return null;
  }
};

// ── Report status pill ─────────────────────────────────────

const REPORT_STATUS_COLORS = {
  pending:   { color: 'text-amber-400 bg-amber-500/10', dot: 'bg-amber-400' },
  reviewed:  { color: 'text-blue-400 bg-blue-500/10', dot: 'bg-blue-400' },
  dismissed: { color: 'text-[#9CA3AF] bg-white/6', dot: 'bg-[#9CA3AF]' },
  actioned:  { color: 'text-emerald-400 bg-emerald-500/10', dot: 'bg-emerald-400' },
};

export const getReportStatus = (statusKey, t) => {
  const style = REPORT_STATUS_COLORS[statusKey] || REPORT_STATUS_COLORS.pending;
  const label = t ? t(`admin.moderation.reportStatus.${statusKey}`, { defaultValue: statusKey }) : statusKey;
  return { label, ...style };
};

// ── Content-type chips (post / comment / message / profile) ────────────────

const CONTENT_TYPE_STYLES = {
  activity: { color: 'text-blue-400 bg-blue-500/10',     icon: Activity },
  comment:  { color: 'text-cyan-400 bg-cyan-500/10',     icon: MessageSquare },
  message:  { color: 'text-purple-400 bg-purple-500/10', icon: MessagesSquare },
  profile:  { color: 'text-pink-400 bg-pink-500/10',     icon: UserIcon },
};

export const getContentTypeChip = (contentType, t) => {
  const fallback = CONTENT_TYPE_STYLES.activity;
  const style = CONTENT_TYPE_STYLES[contentType] || fallback;
  const label = t
    ? t(`admin.moderation.contentTypes.${contentType || 'activity'}`, { defaultValue: contentType || 'activity' })
    : (contentType || 'activity');
  return { label, ...style };
};

// ── Reason translation (8 reasons from migration 20260429000001) ──────────

const KNOWN_REASONS = new Set([
  'spam', 'inappropriate', 'harassment', 'hate_speech',
  'nudity', 'violence', 'dangerous', 'other',
]);

export const getReasonLabel = (reason, t) => {
  if (!reason) return t ? t('admin.moderation.reasons.other', { defaultValue: 'Other' }) : 'Other';
  if (KNOWN_REASONS.has(reason)) {
    return t ? t(`admin.moderation.reasons.${reason}`, { defaultValue: reason }) : reason;
  }
  // Free-form / legacy reason — render as-is.
  return reason;
};

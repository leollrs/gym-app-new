import { supabase } from './supabase';
import i18n from 'i18next';
import logger from './logger';

// ── NOTIFICATION TYPE CONSTANTS ────────────────────────────
// Valid DB enum values: workout_reminder, streak_warning, challenge_update,
// friend_activity, overload_suggestion, announcement, pr_beaten, trainer_message, churn_followup
export const NOTIFICATION_TYPES = {
  STREAK_WARNING:  'streak_warning',
  MILESTONE:       'workout_reminder',
  FRIEND_ACTIVITY: 'friend_activity',
  WIN_BACK:        'churn_followup',
  ACHIEVEMENT:     'pr_beaten',
  HABIT_CHECKIN:   'workout_reminder',
  WEEKLY_SUMMARY:  'workout_reminder',
  SYSTEM:          'workout_reminder',
  ANNOUNCEMENT:    'announcement',
};

// ── QUIET HOURS ──────────────────────────────────────────────
/**
 * Returns true if the current local time is within quiet hours (10pm–7am).
 * During quiet hours we still insert in-app notifications but skip push delivery.
 */
export function isQuietHours() {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 7; // 10pm to 7am
}

// ── BASE HELPERS ───────────────────────────────────────────

/**
 * Insert a notification with dedup protection.
 * If a notification with the same dedupKey already exists, the insert is silently skipped.
 *
 * @param {{ profileId: string, gymId?: string, type: string, title: string, body?: string, data?: object, dedupKey: string }} params
 */
export async function sendOnce({ profileId, gymId, type, title, body, data, dedupKey }) {
  if (!profileId || !dedupKey) return;
  const { error } = await supabase.from('notifications').insert({
    profile_id: profileId,
    gym_id:     gymId,
    type,
    title,
    body:       body || null,
    data:       data || null,
    dedup_key:  dedupKey,
  });
  // Silently ignore duplicate key violations
  if (error && error.code === '23505') return;
  if (error) logger.error('Notification error:', error);
}

/**
 * Insert a notification for a single member.
 * Retained for backwards compatibility — column names match existing schema.
 * Accepts an optional dedupKey to prevent duplicate notifications.
 */
export async function createNotification({ profileId, gymId, type, title, body = null, data = {}, dedupKey = null }) {
  const row = {
    profile_id: profileId,
    gym_id:     gymId,
    type,
    title,
    body,
    data,
  };
  if (dedupKey) row.dedup_key = dedupKey;
  const { error } = await supabase.from('notifications').insert(row);
  // Silently ignore duplicate key violations when dedupKey is provided
  if (error && error.code === '23505') return;
  if (error) logger.error('createNotification error:', error);
}

/**
 * Insert the same notification for every member in a gym (used for announcements).
 * Also fires a native push notification to all registered devices.
 */
export async function broadcastNotification({ gymId, type, title, body = null, data = {}, dedupKey = null }) {
  const { data: members } = await supabase
    .from('profiles')
    .select('id')
    .eq('gym_id', gymId)
    .eq('role', 'member');

  if (!members?.length) return;

  // Insert in-app notifications for all members
  const rows = members.map(m => {
    const row = { profile_id: m.id, gym_id: gymId, type, title, body, data };
    if (dedupKey) row.dedup_key = `${dedupKey}_${m.id}`;
    return row;
  });
  const { error } = await supabase.from('notifications').insert(rows);
  // Silently ignore duplicate key violations when dedupKey is provided
  if (error && error.code === '23505') return;
  if (error) logger.error('broadcastNotification error:', error);

  // Fire native push notifications via edge function (fire-and-forget)
  // Skip push delivery during quiet hours (10pm–7am) — the in-app notification is already inserted above
  if (!isQuietHours()) {
    supabase.functions.invoke('send-push', {
      body: { gym_id: gymId, title, body: body || '', data: { route: '/notifications', type } },
    }).then(({ data: res, error }) => {
      if (error) logger.warn('[Push] send-push error:', error.message);
      else logger.info('[Push] send-push result:', res);
    }).catch(err => logger.warn('[Push] send-push failed:', err));
  }
}

/**
 * Send a notification to a specific user.
 * Low-level helper used by all typed helpers below.
 * Inserts the in-app notification AND triggers a native push to the user's devices.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ title: string, body: string, type?: string, actionUrl?: string }} options
 */
export async function sendNotification(userId, gymId, { title, body, type = NOTIFICATION_TYPES.SYSTEM, actionUrl = null, dedupKey = null }) {
  const row = {
    profile_id: userId,
    gym_id:     gymId,
    title,
    body,
    type,
  };
  if (dedupKey) row.dedup_key = dedupKey;
  const { error } = await supabase.from('notifications').insert(row);
  // Silently ignore duplicate key violations when dedupKey is provided
  if (error && error.code === '23505') return;
  if (error) throw error;

  // Fire native push to this specific user's devices (fire-and-forget)
  // Skip push delivery during quiet hours (10pm–7am) — the in-app notification is already inserted above
  if (!isQuietHours()) {
    sendPushToUser({ userId, gymId, title, body: body || '', data: { route: actionUrl || '/notifications', type } });
  }
}

/**
 * Send a native push notification to a specific user's registered devices
 * via the send-push-user edge function (which reads tokens server-side).
 */
async function sendPushToUser({ userId, gymId, title, body, data = {} }) {
  try {
    supabase.functions.invoke('send-push-user', {
      body: { profile_id: userId, gym_id: gymId, title, body, data },
    }).then(({ data: res, error: pushErr }) => {
      if (pushErr) logger.warn('[Push] send-push-user error:', pushErr.message);
      else logger.info('[Push] send-push-user result:', res);
    }).catch(err => logger.warn('[Push] send-push-user failed:', err));
  } catch (e) {
    logger.warn('[Push] sendPushToUser failed:', e?.message || e);
  }
}

// ── TYPED NOTIFICATION HELPERS ─────────────────────────────

/**
 * Streak warning — call when a member hasn't trained in 5 days.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {number} currentStreak  The streak value at risk (days)
 */
export async function sendStreakWarning(userId, gymId, currentStreak) {
  const today = new Date().toISOString().slice(0, 10);
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.STREAK_WARNING,
    title: i18n.t('notifications.streakAtRisk', { ns: 'common', defaultValue: '⚠️ Your streak is at risk' }),
    body:  i18n.t('notifications.streakAtRiskBody', { ns: 'common', streak: currentStreak, defaultValue: `You have a ${currentStreak}-day streak — don't let it break! Hit the gym today.` }),
    dedupKey: `streak_warning_${userId}_${today}`,
  });
}

/**
 * Milestone approaching — when member is within 2 workouts of a milestone.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ milestoneName: string, remaining: number }} options
 */
export async function sendMilestoneApproach(userId, gymId, { milestoneName, remaining }) {
  // Wrap achievement/milestone name in locale-appropriate quotes
  const quotedName = i18n.language === 'es' ? `\u00AB${milestoneName}\u00BB` : `\u201C${milestoneName}\u201D`;
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.MILESTONE,
    title: i18n.t('notifications.almostThere', { ns: 'common', defaultValue: 'Almost there!' }),
    body:  remaining > 1
      ? i18n.t('notifications.milestoneApproachBodyPlural', { ns: 'common', remaining, milestone: quotedName, defaultValue: `${remaining} more workouts to unlock ${quotedName}.` })
      : i18n.t('notifications.milestoneApproachBodySingular', { ns: 'common', remaining, milestone: quotedName, defaultValue: `${remaining} more workout to unlock ${quotedName}.` }),
    dedupKey: `milestone_approach_${milestoneName}_${remaining}_${userId}`,
  });
}

/**
 * Friend activity — when a friend logs a workout or hits a PR.
 *
 * @param {string} userId        Recipient (the friend being notified)
 * @param {string} gymId
 * @param {{ friendName: string, activityDesc: string, actionUrl?: string }} options
 */
export async function sendFriendActivityNotif(userId, gymId, { friendName, activityDesc, actionUrl = null, dedupKey = null }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.FRIEND_ACTIVITY,
    title:     i18n.t('notifications.friendJustTrained', { ns: 'common', name: friendName, defaultValue: `${friendName} just trained` }),
    body:      activityDesc,
    actionUrl,
    dedupKey,
  });
}

/**
 * Win-back — admin sends to a lapsed member to re-engage them.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ message: string, offer?: string, actionUrl?: string }} options
 */
export async function sendWinBackNotif(userId, gymId, { message, offer = null, actionUrl = null, dedupKey = null }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.WIN_BACK,
    title:     i18n.t('notifications.weMissYou', { ns: 'common', defaultValue: 'We miss you 👋' }),
    body:      offer ? `${message} — ${offer}` : message,
    actionUrl,
    dedupKey,
  });
}

/**
 * Achievement earned — fired when a member unlocks a badge or milestone.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ achievementLabel: string, achievementDesc: string, actionUrl?: string }} options
 */
export async function sendAchievementNotif(userId, gymId, { achievementLabel, achievementDesc, actionUrl = null, dedupKey = null }) {
  // Wrap achievement name in locale-appropriate quotes
  const quotedLabel = i18n.language === 'es' ? `\u00AB${achievementLabel}\u00BB` : `\u201C${achievementLabel}\u201D`;
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.ACHIEVEMENT,
    title:     i18n.t('notifications.achievementUnlocked', { ns: 'common', label: quotedLabel, defaultValue: `Achievement Unlocked: ${quotedLabel}` }),
    body:      achievementDesc,
    actionUrl,
    dedupKey:  dedupKey || `achievement_${achievementLabel}_${userId}`,
  });
}

/**
 * Habit formation check-in — send on day 7 if member has fewer than 4 visits.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {number} visitCount  Number of sessions logged so far this week
 */
export async function sendHabitCheckIn(userId, gymId, visitCount) {
  const today = new Date().toISOString().slice(0, 10);
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.HABIT_CHECKIN,
    title: i18n.t('notifications.howsFirstWeek', { ns: 'common', defaultValue: "How's your first week going?" }),
    body:  visitCount !== 1
      ? i18n.t('notifications.habitCheckinBodyPlural', { ns: 'common', count: visitCount, defaultValue: `You've logged ${visitCount} workouts so far. Try to hit 4 this week to build momentum!` })
      : i18n.t('notifications.habitCheckinBodySingular', { ns: 'common', count: visitCount, defaultValue: `You've logged ${visitCount} workout so far. Try to hit 4 this week to build momentum!` }),
    dedupKey: `habit_checkin_${userId}_${today}`,
  });
}

/**
 * Weekly summary — send on Sundays to recap the member's week.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ sessionsThisWeek: number, weekGoal: number, streakDays: number }} options
 */
export async function sendWeeklySummary(userId, gymId, { sessionsThisWeek, weekGoal, streakDays }) {
  const streakText = streakDays > 0
    ? i18n.t('notifications.streakDayCount', { ns: 'common', days: streakDays, defaultValue: `${streakDays}-day streak` })
    : i18n.t('notifications.startStreakNextWeek', { ns: 'common', defaultValue: 'Start your streak next week!' });

  // Use ISO week number for dedup (one summary per week)
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);

  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.WEEKLY_SUMMARY,
    title: i18n.t('notifications.weekInReview', { ns: 'common', defaultValue: 'Your week in review 📊' }),
    body:  i18n.t('notifications.weeklySessionsSummary', { ns: 'common', done: sessionsThisWeek, goal: weekGoal, streak: streakText, defaultValue: `${sessionsThisWeek}/${weekGoal} sessions completed. ${streakText}` }),
    dedupKey: `weekly_summary_${userId}_${now.getFullYear()}_w${weekNum}`,
  });
}

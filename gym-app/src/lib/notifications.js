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

  // Insert in-app notifications for all members (one by one to avoid batch dedup failures)
  for (const m of members) {
    const row = { profile_id: m.id, gym_id: gymId, type, title, body, data };
    if (dedupKey) row.dedup_key = `${dedupKey}_${m.id}`;
    const { error } = await supabase.from('notifications').insert(row);
    if (error && error.code !== '23505') logger.warn('broadcastNotification insert failed:', m.id, error);
  }

  // Fire native push to each member individually (same pattern as DMs)
  // Pass `notification_type` so the send-push-user edge function can honor
  // per-type opt-outs (e.g. notif_announcements_enabled).
  if (!isQuietHours()) {
    for (const m of members) {
      sendPushToUser({
        userId: m.id,
        gymId,
        title,
        body: body || '',
        data: { route: '/notifications', type },
        notificationType: type,
      });
    }
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
export async function sendNotification(userId, gymId, { title, body, type = NOTIFICATION_TYPES.SYSTEM, actionUrl = null, dedupKey = null, data = null }) {
  const row = {
    profile_id: userId,
    gym_id:     gymId,
    title,
    body,
    type,
  };
  if (dedupKey) row.dedup_key = dedupKey;
  if (data) row.data = data;
  const { error } = await supabase.from('notifications').insert(row);
  // Silently ignore duplicate key violations when dedupKey is provided
  if (error && error.code === '23505') return;
  if (error) throw error;

  // Fire native push to this specific user's devices (fire-and-forget)
  // Skip push delivery during quiet hours (10pm–7am) — the in-app notification is already inserted above
  if (!isQuietHours()) {
    sendPushToUser({
      userId,
      gymId,
      title,
      body: body || '',
      data: { route: actionUrl || '/notifications', type, ...(data || {}) },
      notificationType: type,
    });
  }
}

/**
 * Send a native push notification to a specific user's registered devices
 * via the send-push-user edge function (which reads tokens server-side).
 */
async function sendPushToUser({ userId, gymId, title, body, data = {}, notificationType = null }) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
    const { data: res, error: pushErr } = await supabase.functions.invoke('send-push-user', {
      body: {
        profile_id: userId,
        gym_id: gymId,
        title,
        body: body || title,
        data,
        ...(notificationType ? { notification_type: notificationType } : {}),
      },
      headers,
    });
    if (pushErr) logger.warn('[Push] send-push-user error:', pushErr.message);
    else logger.info('[Push] send-push-user result:', res);
  } catch (e) {
    logger.warn('[Push] sendPushToUser failed:', e?.message || e);
  }
}

// ── TYPED NOTIFICATION HELPERS ─────────────────────────────

/**
 * Streak warning — call when a member hasn't trained in 5 days.
 */
export async function sendStreakWarning(userId, gymId, currentStreak, firstName = '') {
  const today = new Date().toISOString().slice(0, 10);
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.STREAK_WARNING,
    title: i18n.t('notifications.streakAtRisk', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, your streak is at risk 🔥` : 'Your streak is at risk 🔥' }),
    body:  i18n.t('notifications.streakAtRiskBody', { ns: 'common', count: currentStreak, name: firstName, defaultValue: `Your ${currentStreak}-day streak ends at midnight. 30 minutes today and it survives.` }),
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
export async function sendMilestoneApproach(userId, gymId, { milestoneName, remaining, firstName = '' }) {
  // Wrap achievement/milestone name in locale-appropriate quotes
  const quotedName = i18n.language === 'es' ? `\u00AB${milestoneName}\u00BB` : `\u201C${milestoneName}\u201D`;
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.MILESTONE,
    title: i18n.t('notifications.almostThere', { ns: 'common', name: firstName, defaultValue: firstName ? `So close, ${firstName} \uD83C\uDFC6` : 'So close \uD83C\uDFC6' }),
    body:  remaining > 1
      ? i18n.t('notifications.milestoneApproachBodyPlural', { ns: 'common', remaining, milestone: quotedName, defaultValue: `${remaining} more workouts and you unlock ${quotedName}. Don't stall now.` })
      : i18n.t('notifications.milestoneApproachBodySingular', { ns: 'common', remaining, milestone: quotedName, defaultValue: `One more workout unlocks ${quotedName}. Go grab it.` }),
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
export async function sendFriendActivityNotif(userId, gymId, { friendName, activityDesc, actionUrl = null, dedupKey = null, firstName = '' }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.FRIEND_ACTIVITY,
    title:     i18n.t('notifications.friendJustTrained', { ns: 'common', name: friendName, defaultValue: `${friendName} just crushed a session 💪` }),
    body:      activityDesc || i18n.t('notifications.friendCompletedWorkout', { ns: 'common', name: friendName, you: firstName, defaultValue: firstName ? `${firstName}, your turn?` : 'Your turn?' }),
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
export async function sendWinBackNotif(userId, gymId, { message, offer = null, actionUrl = null, dedupKey = null, firstName = '' }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.WIN_BACK,
    title:     i18n.t('notifications.weMissYou', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, ready to come back?` : 'Ready to come back?' }),
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
export async function sendAchievementNotif(userId, gymId, { achievementLabel, achievementDesc, actionUrl = null, dedupKey = null, firstName = '' }) {
  // Wrap achievement name in locale-appropriate quotes
  const quotedLabel = i18n.language === 'es' ? `\u00AB${achievementLabel}\u00BB` : `\u201C${achievementLabel}\u201D`;
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.ACHIEVEMENT,
    title:     i18n.t('notifications.achievementUnlocked', { ns: 'common', label: quotedLabel, name: firstName, defaultValue: firstName ? `${firstName}, you just unlocked ${quotedLabel} \uD83C\uDFC6` : `Unlocked: ${quotedLabel} \uD83C\uDFC6` }),
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
export async function sendHabitCheckIn(userId, gymId, visitCount, firstName = '') {
  const today = new Date().toISOString().slice(0, 10);
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.HABIT_CHECKIN,
    title: i18n.t('notifications.howsFirstWeek', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, how's week one?` : "How's week one?" }),
    body:  visitCount !== 1
      ? i18n.t('notifications.habitCheckinBodyPlural', { ns: 'common', count: visitCount, defaultValue: `${visitCount} sessions logged. Two more this week locks the habit in.` })
      : i18n.t('notifications.habitCheckinBodySingular', { ns: 'common', count: visitCount, defaultValue: `1 session logged. Three more this week and the habit takes hold.` }),
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
export async function sendWeeklySummary(userId, gymId, { sessionsThisWeek, weekGoal, streakDays, firstName = '' }) {
  const streakText = streakDays > 0
    ? i18n.t('notifications.streakDayCount', { ns: 'common', days: streakDays, defaultValue: `${streakDays}-day streak` })
    : i18n.t('notifications.startStreakNextWeek', { ns: 'common', defaultValue: 'streak starts next week' });

  const hitGoal = sessionsThisWeek >= weekGoal;

  // Use ISO week number for dedup (one summary per week)
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);

  const titleKey = hitGoal ? 'notifications.weekInReviewHitGoal' : 'notifications.weekInReview';
  const titleDefault = hitGoal
    ? (firstName ? `${firstName}, you crushed the week 🔥` : 'You crushed the week 🔥')
    : (firstName ? `${firstName}, your week 📊` : 'Your week 📊');

  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.WEEKLY_SUMMARY,
    title: i18n.t(titleKey, { ns: 'common', name: firstName, defaultValue: titleDefault }),
    body:  i18n.t('notifications.weeklySessionsSummary', { ns: 'common', done: sessionsThisWeek, goal: weekGoal, streak: streakText, defaultValue: `${sessionsThisWeek}/${weekGoal} sessions • ${streakText}` }),
    dedupKey: `weekly_summary_${userId}_${now.getFullYear()}_w${weekNum}`,
  });
}

/**
 * Rest day acknowledgement — call on a non-training day to congratulate
 * the member for protecting their streak with recovery.
 */
export async function sendRestDayCongrats(userId, gymId, { firstName = '', nextRoutineName = null, nextDayName = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const nextHint = nextRoutineName
    ? i18n.t('notifications.restDayNextRoutine', { ns: 'common', routine: nextRoutineName, day: nextDayName, defaultValue: nextDayName ? `${nextDayName} is ${nextRoutineName} day — eat well, sleep deep.` : `Tomorrow is ${nextRoutineName} day — eat well, sleep deep.` })
    : i18n.t('notifications.restDayDefault', { ns: 'common', defaultValue: 'Recovery is where the gains lock in. Be ready tomorrow.' });

  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.SYSTEM,
    title: i18n.t('notifications.restDayTitle', { ns: 'common', name: firstName, defaultValue: firstName ? `Rest day, ${firstName} 🛌` : 'Rest day 🛌' }),
    body:  nextHint,
    dedupKey: `rest_day_${userId}_${today}`,
  });
}

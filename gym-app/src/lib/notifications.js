import { supabase } from './supabase';

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

// ── BASE HELPERS ───────────────────────────────────────────

/**
 * Insert a notification for a single member.
 * Retained for backwards compatibility — column names match existing schema.
 */
export async function createNotification({ profileId, gymId, type, title, body = null, data = {} }) {
  await supabase.from('notifications').insert({
    profile_id: profileId,
    gym_id:     gymId,
    type,
    title,
    body,
    data,
  });
}

/**
 * Insert the same notification for every member in a gym (used for announcements).
 * Also fires a native push notification to all registered devices.
 */
export async function broadcastNotification({ gymId, type, title, body = null, data = {} }) {
  const { data: members } = await supabase
    .from('profiles')
    .select('id')
    .eq('gym_id', gymId)
    .eq('role', 'member');

  if (!members?.length) return;

  // Insert in-app notifications for all members
  await supabase.from('notifications').insert(
    members.map(m => ({ profile_id: m.id, gym_id: gymId, type, title, body, data }))
  );

  // Fire native push notifications via edge function (fire-and-forget)
  supabase.functions.invoke('send-push', {
    body: { gym_id: gymId, title, body: body || '', data: { route: '/notifications', type } },
  }).then(({ data: res, error }) => {
    if (error) console.warn('[Push] send-push error:', error.message);
    else console.info('[Push] send-push result:', res);
  }).catch(err => console.warn('[Push] send-push failed:', err));
}

/**
 * Send a notification to a specific user.
 * Low-level helper used by all typed helpers below.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ title: string, body: string, type?: string, actionUrl?: string }} options
 */
export async function sendNotification(userId, gymId, { title, body, type = NOTIFICATION_TYPES.SYSTEM, actionUrl = null }) {
  const { error } = await supabase.from('notifications').insert({
    profile_id: userId,
    gym_id:     gymId,
    title,
    body,
    type,
  });
  if (error) throw error;
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
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.STREAK_WARNING,
    title: '⚠️ Your streak is at risk',
    body:  `You have a ${currentStreak}-day streak — don't let it break! Hit the gym today.`,
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
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.MILESTONE,
    title: 'Almost there!',
    body:  `${remaining} more workout${remaining > 1 ? 's' : ''} to unlock ${milestoneName}`,
  });
}

/**
 * Friend activity — when a friend logs a workout or hits a PR.
 *
 * @param {string} userId        Recipient (the friend being notified)
 * @param {string} gymId
 * @param {{ friendName: string, activityDesc: string, actionUrl?: string }} options
 */
export async function sendFriendActivityNotif(userId, gymId, { friendName, activityDesc, actionUrl = null }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.FRIEND_ACTIVITY,
    title:     `${friendName} just trained`,
    body:      activityDesc,
    actionUrl,
  });
}

/**
 * Win-back — admin sends to a lapsed member to re-engage them.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ message: string, offer?: string, actionUrl?: string }} options
 */
export async function sendWinBackNotif(userId, gymId, { message, offer = null, actionUrl = null }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.WIN_BACK,
    title:     'We miss you 👋',
    body:      offer ? `${message} — ${offer}` : message,
    actionUrl,
  });
}

/**
 * Achievement earned — fired when a member unlocks a badge or milestone.
 *
 * @param {string} userId
 * @param {string} gymId
 * @param {{ achievementLabel: string, achievementDesc: string, actionUrl?: string }} options
 */
export async function sendAchievementNotif(userId, gymId, { achievementLabel, achievementDesc, actionUrl = null }) {
  await sendNotification(userId, gymId, {
    type:      NOTIFICATION_TYPES.ACHIEVEMENT,
    title:     `Achievement Unlocked: ${achievementLabel}`,
    body:      achievementDesc,
    actionUrl,
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
  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.HABIT_CHECKIN,
    title: "How's your first week going?",
    body:  `You've logged ${visitCount} workout${visitCount !== 1 ? 's' : ''} so far. Try to hit 4 this week to build momentum!`,
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
    ? `${streakDays}-day streak`
    : 'Start your streak next week!';

  await sendNotification(userId, gymId, {
    type:  NOTIFICATION_TYPES.WEEKLY_SUMMARY,
    title: 'Your week in review 📊',
    body:  `${sessionsThisWeek}/${weekGoal} sessions completed. ${streakText}`,
  });
}

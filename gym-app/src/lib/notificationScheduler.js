import { supabase } from './supabase';
import {
  NOTIFICATION_TYPES,
  sendStreakWarning,
  sendMilestoneApproach,
  sendFriendActivityNotif,
  sendWinBackNotif,
  sendHabitCheckIn,
  sendWeeklySummary,
} from './notifications';

// ── HELPERS ──────────────────────────────────────────────────

/** Get notification preferences from localStorage (defaults all ON). */
function getPreferences(userId) {
  const key = `notification_prefs_${userId}`;
  const defaults = {
    workout_reminders: true,
    streak_alerts: true,
    weekly_summary: true,
    friend_activity: true,
    milestone_alerts: true,
  };
  try {
    const stored = localStorage.getItem(key);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
}

/** Start of today (UTC). */
function todayStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Start of N days ago (UTC). */
function daysAgoStart(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Check if a notification of a given type was already sent within a window. */
async function wasNotificationSentSince(userId, type, sinceISO) {
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('created_at', sinceISO)
    .limit(1);
  return data && data.length > 0;
}

/** Count notifications of a given type sent since a timestamp. */
async function notificationCountSince(userId, type, sinceISO) {
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('created_at', sinceISO);
  return data ? data.length : 0;
}

/** Map preferred_training_time label to an approximate hour threshold. */
function timeWindowHourThreshold(preferredTime) {
  switch (preferredTime) {
    case 'morning':   return 10; // after 10 AM
    case 'afternoon': return 15; // after 3 PM
    case 'evening':   return 19; // after 7 PM
    default:          return 12;
  }
}

/** Get the current day name (e.g. "Monday"). */
function currentDayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

// ── INDIVIDUAL CHECK FUNCTIONS ───────────────────────────────

/**
 * Streak Protection
 * If user trained yesterday but NOT today, and it's past their preferred time -> warn.
 */
export async function checkStreakProtection(userId, gymId, profile) {
  const prefs = getPreferences(userId);
  if (!prefs.streak_alerts) return;

  // Already sent today?
  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.STREAK_WARNING, todayStart());
  if (alreadySent) return;

  // Check if it's past user's preferred training window
  const currentHour = new Date().getHours();
  const threshold = timeWindowHourThreshold(profile?.preferred_training_time);
  if (currentHour < threshold) return;

  // Did the user train yesterday?
  const yesterdayStart = daysAgoStart(1);
  const { data: yesterdaySessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', yesterdayStart)
    .lt('created_at', todayStart())
    .limit(1);

  if (!yesterdaySessions?.length) return; // didn't train yesterday, no streak to protect

  // Did the user train today?
  const { data: todaySessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', todayStart())
    .limit(1);

  if (todaySessions?.length) return; // already trained today

  // Fetch current streak from profile or calculate
  const streak = profile?.current_streak || 1;
  await sendStreakWarning(userId, gymId, streak);
}

/**
 * Morning Workout Reminder
 * On preferred training days, remind the user if they haven't been notified today.
 */
export async function checkWorkoutReminder(userId, gymId, profile) {
  const prefs = getPreferences(userId);
  if (!prefs.workout_reminders) return;

  // Is today one of the user's preferred training days?
  const today = currentDayName();
  const preferredDays = profile?.preferred_training_days || [];
  if (!preferredDays.includes(today)) return;

  // Already sent a reminder today?
  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.SYSTEM, todayStart());
  if (alreadySent) return;

  // Did the user already train today?
  const { data: todaySessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', todayStart())
    .limit(1);

  if (todaySessions?.length) return;

  // Send reminder via the base sendNotification (it's a system-type reminder)
  const { sendNotification } = await import('./notifications');
  await sendNotification(userId, gymId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Time to train!',
    body: `Today is ${today} — one of your training days. Let's get after it!`,
  });
}

/**
 * Weekly Progress Digest
 * On Sundays, compile the week's stats and send a summary.
 */
export async function checkWeeklyDigest(userId, gymId) {
  const prefs = getPreferences(userId);
  if (!prefs.weekly_summary) return;

  const dayOfWeek = new Date().getDay(); // 0 = Sunday
  if (dayOfWeek !== 0) return;

  // Already sent this week?
  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.WEEKLY_SUMMARY, todayStart());
  if (alreadySent) return;

  // Fetch sessions from the past 7 days
  const weekStart = daysAgoStart(7);
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', weekStart);

  const sessionsThisWeek = sessions?.length || 0;

  // Fetch profile for streak and goal
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_streak, weekly_goal')
    .eq('id', userId)
    .maybeSingle();

  const streakDays = profile?.current_streak || 0;
  const weekGoal = profile?.weekly_goal || 4;

  await sendWeeklySummary(userId, gymId, { sessionsThisWeek, weekGoal, streakDays });
}

/**
 * Milestone Proximity
 * Check if user is within 2 workouts/days of a milestone.
 */
export async function checkMilestoneProximity(userId, gymId, profile) {
  const prefs = getPreferences(userId);
  if (!prefs.milestone_alerts) return;

  // Session milestones
  const sessionMilestones = [10, 25, 50, 100, 200, 500];
  const { data: allSessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('gym_id', gymId);

  const totalSessions = allSessions?.length || 0;

  for (const milestone of sessionMilestones) {
    const remaining = milestone - totalSessions;
    if (remaining > 0 && remaining <= 2) {
      // Check if we already notified for this milestone
      const milestoneKey = `session_${milestone}`;
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('type', NOTIFICATION_TYPES.MILESTONE)
        .ilike('body', `%${milestone}%`)
        .limit(1);

      if (!existing?.length) {
        await sendMilestoneApproach(userId, gymId, {
          milestoneName: `${milestone} Workouts`,
          remaining,
        });
      }
      break; // only notify for the nearest milestone
    }
  }

  // Streak milestones
  const streakMilestones = [7, 14, 30, 60, 100];
  const currentStreak = profile?.current_streak || 0;

  for (const milestone of streakMilestones) {
    const remaining = milestone - currentStreak;
    if (remaining > 0 && remaining <= 2) {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('type', NOTIFICATION_TYPES.MILESTONE)
        .ilike('body', `%${milestone}%`)
        .limit(1);

      if (!existing?.length) {
        await sendMilestoneApproach(userId, gymId, {
          milestoneName: `${milestone}-Day Streak`,
          remaining,
        });
      }
      break;
    }
  }
}

/**
 * Re-engagement Nudge
 * If user hasn't trained in 3+ days, send escalating win-back messages.
 * Max one per 3 days.
 */
export async function checkReengagement(userId, gymId) {
  const prefs = getPreferences(userId);
  if (!prefs.workout_reminders) return;

  // Rate limit: max 1 win-back per 3 days
  const threeDaysAgo = daysAgoStart(3);
  const recentWinBack = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.WIN_BACK, threeDaysAgo);
  if (recentWinBack) return;

  // Find the last session
  const { data: lastSession } = await supabase
    .from('workout_sessions')
    .select('created_at')
    .eq('user_id', userId)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!lastSession?.length) return; // no sessions at all — handled by new member flow

  const lastDate = new Date(lastSession[0].created_at);
  const now = new Date();
  const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (daysSince < 3) return;

  let message;
  let offer = null;

  if (daysSince >= 7) {
    message = "It's been over a week since your last workout. Your body is ready — let's get back on track.";
    offer = 'A fresh start is just one session away';
  } else if (daysSince >= 5) {
    message = "You've been away for a few days. Don't lose the progress you've built!";
    offer = 'Even a quick session counts';
  } else {
    message = "It's been a few days since your last session. A quick workout can reignite your momentum!";
  }

  await sendWinBackNotif(userId, gymId, { message, offer });
}

/**
 * Friend Activity (rate-limited)
 * Send friend workout notifications, max 3 per day.
 */
export async function checkFriendActivity(userId, gymId) {
  const prefs = getPreferences(userId);
  if (!prefs.friend_activity) return;

  // Check how many friend notifications were sent today
  const count = await notificationCountSince(userId, NOTIFICATION_TYPES.FRIEND_ACTIVITY, todayStart());
  if (count >= 3) return;

  // Get user's friends
  const { data: friendships } = await supabase
    .from('friendships')
    .select('friend_id, user_id')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .eq('status', 'accepted');

  if (!friendships?.length) return;

  const friendIds = friendships.map(f => f.user_id === userId ? f.friend_id : f.user_id);

  // Get friend sessions from today that we haven't notified about
  const { data: friendSessions } = await supabase
    .from('workout_sessions')
    .select('id, user_id, created_at')
    .in('user_id', friendIds)
    .eq('gym_id', gymId)
    .gte('created_at', todayStart())
    .order('created_at', { ascending: false })
    .limit(3 - count);

  if (!friendSessions?.length) return;

  for (const session of friendSessions) {
    // Get friend name
    const { data: friendProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', session.user_id)
      .maybeSingle();

    const friendName = friendProfile?.full_name || 'A friend';

    // Check if we already sent a notification for this specific session
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('type', NOTIFICATION_TYPES.FRIEND_ACTIVITY)
      .gte('created_at', todayStart())
      .ilike('title', `%${friendName}%`)
      .limit(1);

    if (existing?.length) continue;

    const currentCount = await notificationCountSince(userId, NOTIFICATION_TYPES.FRIEND_ACTIVITY, todayStart());
    if (currentCount >= 3) break;

    await sendFriendActivityNotif(userId, gymId, {
      friendName,
      activityDesc: `${friendName} completed a workout today. Time to match their energy!`,
    });
  }
}

/**
 * New Member First Week
 * If member is < 7 days old and has < 3 sessions, send encouraging check-in.
 */
export async function checkNewMemberCheckin(userId, gymId, profile) {
  const prefs = getPreferences(userId);
  if (!prefs.workout_reminders) return;

  if (!profile?.created_at) return;

  const createdAt = new Date(profile.created_at);
  const now = new Date();
  const daysSinceJoin = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  if (daysSinceJoin >= 7) return;

  // Already sent a habit check-in today?
  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.HABIT_CHECKIN, todayStart());
  if (alreadySent) return;

  // Only send once during the first week (check if any were sent since signup)
  const sentSinceJoin = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.HABIT_CHECKIN, createdAt.toISOString());
  if (sentSinceJoin) return;

  // Count sessions since join
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', createdAt.toISOString());

  const sessionCount = sessions?.length || 0;

  if (sessionCount >= 3) return; // already building the habit

  // Only send after at least day 2
  if (daysSinceJoin < 2) return;

  await sendHabitCheckIn(userId, gymId, sessionCount);
}

// ── MAIN SCHEDULER ───────────────────────────────────────────

/**
 * Run all notification checks for a user.
 * Call this when the app opens or from a cron/edge function.
 *
 * @param {string} userId
 * @param {string} gymId
 */
export async function runNotificationScheduler(userId, gymId) {
  if (!userId || !gymId) return;

  // Fetch profile once for all checks
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return;

  // Run all checks concurrently — each handles its own deduplication
  const checks = [
    checkStreakProtection(userId, gymId, profile),
    checkWorkoutReminder(userId, gymId, profile),
    checkWeeklyDigest(userId, gymId),
    checkMilestoneProximity(userId, gymId, profile),
    checkReengagement(userId, gymId),
    checkFriendActivity(userId, gymId),
    checkNewMemberCheckin(userId, gymId, profile),
  ];

  // Use allSettled so one failure doesn't block the rest
  const results = await Promise.allSettled(checks);

  // Log any failures for debugging
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[NotificationScheduler] Check ${i} failed:`, result.reason);
    }
  });
}

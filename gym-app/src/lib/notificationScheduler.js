import { supabase } from './supabase';
import logger from './logger';
import {
  NOTIFICATION_TYPES,
  createNotification,
  sendStreakWarning,
  sendMilestoneApproach,
  sendFriendActivityNotif,
  sendWinBackNotif,
  sendHabitCheckIn,
  sendWeeklySummary,
  sendNotification,
} from './notifications';
import { REWARDS_CATALOG, getUserPoints } from './rewardsEngine';

// ── HELPERS ──────────────────────────────────────────────────

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
    .eq('profile_id', userId)
    .eq('type', type)
    .gte('created_at', sinceISO)
    .limit(1);
  return data && data.length > 0;
}

/** Check if any notification with a matching title substring was sent since a time. */
async function wasNotificationWithTitleSince(userId, titlePattern, sinceISO) {
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('profile_id', userId)
    .ilike('title', `%${titlePattern}%`)
    .gte('created_at', sinceISO)
    .limit(1);
  return data && data.length > 0;
}

/** Count notifications of a given type sent since a timestamp. */
async function notificationCountSince(userId, type, sinceISO) {
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('profile_id', userId)
    .eq('type', type)
    .gte('created_at', sinceISO);
  return data ? data.length : 0;
}

/** Map preferred_training_time label to an approximate hour threshold. */
function timeWindowHourThreshold(preferredTime) {
  switch (preferredTime) {
    case 'morning':   return 10;
    case 'afternoon': return 15;
    case 'evening':   return 19;
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
async function checkStreakProtection(userId, gymId, profile) {
  if (!profile.notif_streak_alerts) return;

  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.STREAK_WARNING, todayStart());
  if (alreadySent) return;

  const currentHour = new Date().getHours();
  const threshold = timeWindowHourThreshold(profile?.preferred_training_time);
  if (currentHour < threshold) return;

  const yesterdayStart = daysAgoStart(1);
  const { data: yesterdaySessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', yesterdayStart)
    .lt('created_at', todayStart())
    .limit(1);

  if (!yesterdaySessions?.length) return;

  const { data: todaySessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', todayStart())
    .limit(1);

  if (todaySessions?.length) return;

  const streak = profile?.current_streak || 1;
  await sendStreakWarning(userId, gymId, streak);
}

/**
 * Routine-Aware Workout Reminder
 * On preferred training days, remind the user with their scheduled routine name.
 * "Today is Back day — don't forget to hit it!"
 */
async function checkWorkoutReminder(userId, gymId, profile) {
  if (!profile.notif_workout_reminders) return;

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
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', todayStart())
    .limit(1);

  if (todaySessions?.length) return;

  // Try to find the user's next scheduled routine
  const dayIndex = preferredDays.indexOf(today);
  const { data: routines } = await supabase
    .from('routines')
    .select('id, name')
    .eq('created_by', userId)
    .eq('is_template', false)
    .order('created_at', { ascending: true });

  let title = 'Time to train!';
  let body = `Today is ${today} — one of your training days. Let's get after it!`;

  if (routines?.length) {
    // Rotate routines across training days
    const routine = routines[dayIndex % routines.length];
    if (routine?.name) {
      title = `Today is ${routine.name} day`;
      body = `Don't forget to hit your ${routine.name} routine. Your body's ready for it!`;
    }
  }

  await sendNotification(userId, gymId, { type: NOTIFICATION_TYPES.SYSTEM, title, body });
}

/**
 * Weekly Progress Digest
 * On Sundays, compile the week's stats and send a summary.
 */
async function checkWeeklyDigest(userId, gymId, profile) {
  if (!profile.notif_weekly_summary) return;

  const dayOfWeek = new Date().getDay();
  if (dayOfWeek !== 0) return;

  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.WEEKLY_SUMMARY, todayStart());
  if (alreadySent) return;

  const weekStart = daysAgoStart(7);
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', weekStart);

  const sessionsThisWeek = sessions?.length || 0;
  const streakDays = profile?.current_streak || 0;
  const weekGoal = profile?.weekly_goal || 4;

  await sendWeeklySummary(userId, gymId, { sessionsThisWeek, weekGoal, streakDays });
}

/**
 * Milestone Proximity
 * Check if user is within 2 workouts/days of a milestone.
 */
async function checkMilestoneProximity(userId, gymId, profile) {
  if (!profile.notif_milestone_alerts) return;

  const sessionMilestones = [10, 25, 50, 100, 200, 500];
  const { data: allSessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('gym_id', gymId);

  const totalSessions = allSessions?.length || 0;

  for (const milestone of sessionMilestones) {
    const remaining = milestone - totalSessions;
    if (remaining > 0 && remaining <= 2) {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('profile_id', userId)
        .eq('type', NOTIFICATION_TYPES.MILESTONE)
        .ilike('body', `%${milestone}%`)
        .limit(1);

      if (!existing?.length) {
        await sendMilestoneApproach(userId, gymId, {
          milestoneName: `${milestone} Workouts`,
          remaining,
        });
      }
      break;
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
        .eq('profile_id', userId)
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
async function checkReengagement(userId, gymId, profile) {
  if (!profile.notif_workout_reminders) return;

  const threeDaysAgo = daysAgoStart(3);
  const recentWinBack = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.WIN_BACK, threeDaysAgo);
  if (recentWinBack) return;

  const { data: lastSession } = await supabase
    .from('workout_sessions')
    .select('created_at')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!lastSession?.length) return;

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
async function checkFriendActivity(userId, gymId, profile) {
  if (!profile.notif_friend_activity) return;

  const count = await notificationCountSince(userId, NOTIFICATION_TYPES.FRIEND_ACTIVITY, todayStart());
  if (count >= 3) return;

  const { data: friendships } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted');

  if (!friendships?.length) return;

  const friendIds = friendships.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id);

  const { data: friendSessions } = await supabase
    .from('workout_sessions')
    .select('id, profile_id, created_at')
    .in('profile_id', friendIds)
    .eq('gym_id', gymId)
    .gte('created_at', todayStart())
    .order('created_at', { ascending: false })
    .limit(3 - count);

  if (!friendSessions?.length) return;

  for (const session of friendSessions) {
    const { data: friendProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', session.profile_id)
      .maybeSingle();

    const friendName = friendProfile?.full_name || 'A friend';

    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('profile_id', userId)
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
async function checkNewMemberCheckin(userId, gymId, profile) {
  if (!profile.notif_workout_reminders) return;

  if (!profile?.created_at) return;

  const createdAt = new Date(profile.created_at);
  const now = new Date();
  const daysSinceJoin = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  if (daysSinceJoin >= 7) return;

  const alreadySent = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.HABIT_CHECKIN, todayStart());
  if (alreadySent) return;

  const sentSinceJoin = await wasNotificationSentSince(userId, NOTIFICATION_TYPES.HABIT_CHECKIN, createdAt.toISOString());
  if (sentSinceJoin) return;

  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', createdAt.toISOString());

  const sessionCount = sessions?.length || 0;
  if (sessionCount >= 3) return;
  if (daysSinceJoin < 2) return;

  await sendHabitCheckIn(userId, gymId, sessionCount);
}

/**
 * Reward Proximity
 * If user is within 15% of affording a reward, nudge them.
 * Max one reward nudge per week.
 */
async function checkRewardProximity(userId, gymId, profile) {
  if (!profile.notif_reward_reminders) return;

  // Rate limit: max 1 reward nudge per week
  const weekAgo = daysAgoStart(7);
  const recentRewardNudge = await wasNotificationWithTitleSince(userId, 'close to', weekAgo);
  if (recentRewardNudge) return;

  const points = await getUserPoints(userId);
  if (!points) return;
  const currentPoints = points.total_points ?? 0;

  // Find the cheapest reward the user can't yet afford but is close to
  const sortedRewards = [...REWARDS_CATALOG].sort((a, b) => a.cost - b.cost);

  for (const reward of sortedRewards) {
    if (currentPoints >= reward.cost) continue; // already can afford
    const remaining = reward.cost - currentPoints;
    const threshold = reward.cost * 0.15; // within 15%

    if (remaining <= threshold && remaining > 0) {
      await createNotification({
        profileId: userId,
        gymId,
        type: NOTIFICATION_TYPES.SYSTEM,
        title: `You're close to a ${reward.name}!`,
        body: `Just ${remaining} more points to redeem. Keep training!`,
      });
      break; // only nudge for the nearest reward
    }
  }
}

/**
 * Challenge Awareness
 * - Notify about new challenges the user hasn't joined
 * - Nudge if user joined a challenge but hasn't worked out in 2+ days
 * Max one challenge nudge per day.
 */
async function checkChallengeUpdates(userId, gymId, profile) {
  if (!profile.notif_challenge_updates) return;

  const now = new Date().toISOString();

  // Already sent a challenge notification today?
  const alreadySent = await wasNotificationSentSince(userId, 'challenge_update', todayStart());
  if (alreadySent) return;

  // 1. New challenges user hasn't joined
  const [{ data: activeChallenges }, { data: myParticipations }] = await Promise.all([
    supabase
      .from('challenges')
      .select('id, name, type, end_date')
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .gte('end_date', now),
    supabase
      .from('challenge_participants')
      .select('challenge_id')
      .eq('profile_id', userId),
  ]);

  const joinedIds = new Set((myParticipations || []).map(p => p.challenge_id));
  const unjoinedChallenges = (activeChallenges || []).filter(c => !joinedIds.has(c.id));

  if (unjoinedChallenges.length > 0) {
    // Check if we already notified about this challenge
    const challenge = unjoinedChallenges[0];
    const alreadyNotified = await wasNotificationWithTitleSince(userId, challenge.title, daysAgoStart(7));
    if (!alreadyNotified) {
      await createNotification({
        profileId: userId,
        gymId,
        type: 'challenge_update',
        title: `New challenge: ${challenge.title}`,
        body: 'Join now and compete with your gym!',
      });
      return; // one notification per cycle
    }
  }

  // 2. Challenge inactivity — user joined but hasn't worked out in 2+ days
  if (!myParticipations?.length) return;

  const { data: lastSession } = await supabase
    .from('workout_sessions')
    .select('created_at')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!lastSession?.length) return;

  const lastDate = new Date(lastSession[0].created_at);
  const daysSince = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));

  if (daysSince >= 2) {
    // Find an active challenge they're in
    const activeJoined = (activeChallenges || []).filter(c => joinedIds.has(c.id));
    if (activeJoined.length > 0) {
      const ch = activeJoined[0];
      const daysLeft = Math.ceil((new Date(ch.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 0) {
        await createNotification({
          profileId: userId,
          gymId,
          type: 'challenge_update',
          title: `Don't fall behind in ${ch.name}!`,
          body: `${daysLeft} days left — a workout today keeps you in the running.`,
        });
      }
    }
  }
}

// ── MAIN SCHEDULER ───────────────────────────────────────────

/**
 * Run all notification checks for a user.
 * Call this when the app opens or from a cron/edge function.
 */
export async function runNotificationScheduler(userId, gymId) {
  if (!userId || !gymId) return;

  // Fetch profile once — includes notification preferences
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return;

  // If push is completely disabled, skip everything
  if (profile.notif_push_enabled === false) return;

  // Run all checks concurrently — each handles its own deduplication + pref check
  const checks = [
    checkStreakProtection(userId, gymId, profile),
    checkWorkoutReminder(userId, gymId, profile),
    checkWeeklyDigest(userId, gymId, profile),
    checkMilestoneProximity(userId, gymId, profile),
    checkReengagement(userId, gymId, profile),
    checkFriendActivity(userId, gymId, profile),
    checkNewMemberCheckin(userId, gymId, profile),
    checkRewardProximity(userId, gymId, profile),
    checkChallengeUpdates(userId, gymId, profile),
  ];

  const results = await Promise.allSettled(checks);

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.warn(`[NotificationScheduler] Check ${i} failed:`, result.reason);
    }
  });
}

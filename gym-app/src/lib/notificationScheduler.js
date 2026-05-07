import { supabase } from './supabase';
import logger from './logger';
import i18n from 'i18next';
import {
  NOTIFICATION_TYPES,
  sendStreakWarning,
  sendMilestoneApproach,
  sendFriendActivityNotif,
  sendWinBackNotif,
  sendHabitCheckIn,
  sendWeeklySummary,
  sendNotification,
  sendRestDayCongrats,
} from './notifications';
import { getUserPoints } from './rewardsEngine';
import { checkSmartVisitReminder, formatScheduleTime } from './workoutScheduleTracker';

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

/** Get the current day name in English (e.g. "Monday") — used for preference matching. */
function currentDayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

/** Get the localized day name for display in notifications. */
function localizedDayName(englishDay) {
  const key = `days.${englishDay.toLowerCase()}`;
  return i18n.t(key, { ns: 'common', defaultValue: englishDay });
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
  await sendStreakWarning(userId, gymId, streak, profile?.first_name || '');
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

  const localDay = localizedDayName(today);
  const firstName = profile?.first_name || '';
  let title = i18n.t('notifications.timeToTrain', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, gym time` : 'Gym time' });
  let body = i18n.t('notifications.todayIsTrainingDay', { ns: 'common', name: firstName, day: localDay, defaultValue: `Today's a training day. ${localDay} is on the schedule — own it.` });

  if (routines?.length) {
    // Rotate routines across training days
    const routine = routines[dayIndex % routines.length];
    if (routine?.name) {
      title = i18n.t('notifications.todayIsRoutineDay', { ns: 'common', name: firstName, routine: routine.name, defaultValue: firstName ? `${firstName}, it's ${routine.name} day` : `It's ${routine.name} day` });
      body = i18n.t('notifications.dontForgetRoutine', { ns: 'common', name: firstName, routine: routine.name, defaultValue: `Your ${routine.name} session is waiting. Hit it before the day gets away from you.` });
    }
  }

  await sendNotification(userId, gymId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title,
    body,
    dedupKey: `workout_reminder_${userId}_${new Date().toISOString().slice(0, 10)}`,
  });
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

  await sendWeeklySummary(userId, gymId, { sessionsThisWeek, weekGoal, streakDays, firstName: profile?.first_name || '' });
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
          milestoneName: i18n.t('notifications.nWorkouts', { ns: 'common', count: milestone, defaultValue: `${milestone} Workouts` }),
          remaining,
          firstName: profile?.first_name || '',
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
          milestoneName: i18n.t('notifications.nDayStreak', { ns: 'common', count: milestone, defaultValue: `${milestone}-Day Streak` }),
          remaining,
          firstName: profile?.first_name || '',
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
  const firstName = profile?.first_name || '';

  if (daysSince >= 7) {
    message = i18n.t('notifications.reengageWeek', { ns: 'common', name: firstName, days: daysSince, defaultValue: `It's been over a week. ${firstName ? firstName + ', ' : ''}your body's ready — even a light session puts you back on track.` });
    offer = i18n.t('notifications.freshStart', { ns: 'common', defaultValue: 'A fresh start is one session away' });
  } else if (daysSince >= 5) {
    message = i18n.t('notifications.reengageFiveDays', { ns: 'common', name: firstName, defaultValue: `${firstName ? firstName + ', ' : ''}you're 5 days out. Don't lose the progress you built.` });
    offer = i18n.t('notifications.quickSessionCounts', { ns: 'common', defaultValue: 'Even a quick session counts' });
  } else {
    message = i18n.t('notifications.reengageThreeDays', { ns: 'common', name: firstName, defaultValue: `${firstName ? firstName + ', ' : ''}3 days off. Ten minutes today rebuilds the habit.` });
  }

  await sendWinBackNotif(userId, gymId, { message, offer, firstName, dedupKey: `winback_${userId}_${new Date().toISOString().slice(0, 10)}` });
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

    const friendName = friendProfile?.full_name || i18n.t('notifications.aFriend', { ns: 'common', defaultValue: 'A friend' });

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

    const youName = profile?.first_name || '';
    await sendFriendActivityNotif(userId, gymId, {
      friendName,
      firstName: youName,
      activityDesc: i18n.t('notifications.friendCompletedWorkout', { ns: 'common', name: friendName, you: youName, defaultValue: youName ? `${friendName} just trained. ${youName}, your turn?` : `${friendName} just trained. Your turn?` }),
      dedupKey: `friend_activity_${userId}_${session.profile_id}_${new Date().toISOString().slice(0, 10)}`,
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

  await sendHabitCheckIn(userId, gymId, sessionCount, profile?.first_name || '');
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

  // Fetch gym rewards from DB, sorted by cost
  const { data: gymRewards } = await supabase
    .from('gym_rewards')
    .select('name, name_es, cost_points')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .order('cost_points');

  if (!gymRewards?.length) return;

  for (const reward of gymRewards) {
    if (currentPoints >= reward.cost_points) continue; // already can afford
    const remaining = reward.cost_points - currentPoints;
    const threshold = reward.cost_points * 0.15; // within 15%

    if (remaining <= threshold && remaining > 0) {
      const rewardName = i18n.language?.startsWith('es') && reward.name_es ? reward.name_es : reward.name;
      const firstName = profile?.first_name || '';
      await sendNotification(userId, gymId, {
        type: NOTIFICATION_TYPES.SYSTEM,
        title: i18n.t('notifications.closeToReward', { ns: 'common', name: firstName, reward: rewardName, defaultValue: firstName ? `${firstName}, you're close to a ${rewardName}` : `You're close to a ${rewardName}` }),
        body: i18n.t('notifications.closeToRewardBody', { ns: 'common', points: remaining, defaultValue: `Just ${remaining} more points and it's yours. Keep training.` }),
        dedupKey: `reward_proximity_${userId}_${reward.cost_points}_${new Date().toISOString().slice(0, 10)}`,
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
      await sendNotification(userId, gymId, {
        type: 'challenge_update',
        title: i18n.t('notifications.newChallenge', { ns: 'common', name: challenge.title, defaultValue: `New challenge: ${challenge.title}` }),
        body: i18n.t('notifications.joinNowCompete', { ns: 'common', defaultValue: 'Your gym is competing — jump in.' }),
        dedupKey: `challenge_new_${challenge.id}_${userId}`,
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
        const firstName = profile?.first_name || '';
        await sendNotification(userId, gymId, {
          type: 'challenge_update',
          title: i18n.t('notifications.dontFallBehind', { ns: 'common', name: firstName, challenge: ch.name, defaultValue: firstName ? `${firstName}, don't fall behind in ${ch.name}` : `Don't fall behind in ${ch.name}` }),
          body: i18n.t('notifications.challengeDaysLeft', { ns: 'common', days: daysLeft, defaultValue: `${daysLeft} days left. A workout today keeps you in the running.` }),
          dedupKey: `challenge_inactivity_${ch.id}_${userId}_${new Date().toISOString().slice(0, 10)}`,
        });
      }
    }
  }
}

/**
 * Nutrition Reminder
 * If user has nutrition targets but hasn't logged any food today and it's past 2pm -> remind.
 */
async function checkNutritionReminder(userId, gymId, profile) {
  const currentHour = new Date().getHours();
  if (currentHour < 14) return;

  const alreadySent = await wasNotificationSentSince(userId, 'overload_suggestion', todayStart());
  if (alreadySent) return;

  // Check if user has nutrition targets set
  const { data: targets } = await supabase
    .from('nutrition_targets')
    .select('daily_calories')
    .eq('profile_id', userId)
    .maybeSingle();

  if (!targets?.daily_calories) return;

  // Check today's food logs
  const today = new Date().toISOString().slice(0, 10);
  const { data: logs } = await supabase
    .from('food_logs')
    .select('calories')
    .eq('profile_id', userId)
    .eq('log_date', today);

  if (logs?.length) return; // user has logged food today

  const firstName = profile?.first_name || '';
  await sendNotification(userId, gymId, {
    type: 'overload_suggestion',
    title: i18n.t('notifications.nutritionReminderTitle', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, log today's food` : "Log today's food" }),
    body: i18n.t('notifications.nutritionReminderBody', { ns: 'common', defaultValue: `Nothing tracked yet. Even a quick estimate keeps you on target.` }),
    dedupKey: `nutrition_reminder_${userId}_${new Date().toISOString().slice(0, 10)}`,
  });
}

/**
 * Weight Log Reminder
 * If user's most recent body_weight_logs entry is older than 7 days -> remind.
 */
async function checkWeightLogReminder(userId, gymId, profile) {
  const alreadySent = await wasNotificationSentSince(userId, 'overload_suggestion', daysAgoStart(7));
  if (alreadySent) return;

  const { data: lastLog } = await supabase
    .from('body_weight_logs')
    .select('created_at')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  // If user has never logged weight, don't nag
  if (!lastLog?.length) return;

  const lastDate = new Date(lastLog[0].created_at);
  const now = new Date();
  const days = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (days < 7) return;

  const firstName = profile?.first_name || '';
  await sendNotification(userId, gymId, {
    type: 'overload_suggestion',
    title: i18n.t('notifications.weightReminderTitle', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, time to weigh in` : 'Time to weigh in' }),
    body: i18n.t('notifications.weightReminderBody', { ns: 'common', days, defaultValue: `${days} days since your last log. Track it now.` }),
    dedupKey: `weight_reminder_${userId}_${new Date().toISOString().slice(0, 10)}`,
  });
}

/**
 * Punch Card Proximity
 * If user has a punch card within 2 punches of the target -> nudge.
 */
async function checkPunchCardProximity(userId, gymId, profile) {
  const { data: cards } = await supabase
    .from('member_punch_cards')
    .select('punches, gym_products!inner(name, punch_card_target, punch_card_enabled)')
    .eq('member_id', userId)
    .eq('gym_products.punch_card_enabled', true);

  if (!cards?.length) return;

  const lang = i18n.language || 'en';

  for (const card of cards) {
    const punches = card.punches ?? 0;
    const target = card.gym_products?.punch_card_target ?? 10;
    const productName = card.gym_products?.name || 'reward';

    if (punches >= target - 2 && punches < target) {
      const alreadySent = await wasNotificationWithTitleSince(userId, productName, todayStart());
      if (alreadySent) continue;

      const remaining = target - punches;
      const firstName = profile?.first_name || '';

      await sendNotification(userId, gymId, {
        type: NOTIFICATION_TYPES.SYSTEM,
        title: i18n.t('notifications.punchCardProximityTitle', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, almost there 🎉` : 'Almost there 🎉' }),
        body: i18n.t('notifications.punchCardProximityBody', { ns: 'common', remaining, product: productName, defaultValue: `Just ${remaining} away from a free ${productName}. Don't leave it on the table.` }),
        dedupKey: `punch_card_${userId}_${productName}_${punches}`,
      });
    }
  }
}

/**
 * Smart Visit Reminder
 * If the user has a detected workout schedule pattern and it's ~1 hour before
 * their usual workout time on a preferred day, send a push reminder.
 * Requires 5+ completed sessions with a clear pattern.
 */
async function checkSmartVisitNotification(userId, gymId, profile) {
  if (!profile.notif_workout_reminders) return;

  // Check if we already sent a smart visit notification today
  const alreadySent = await wasNotificationWithTitleSince(userId, 'usually work out', todayStart());
  if (alreadySent) return;

  // Also check Spanish variant
  const alreadySentEs = await wasNotificationWithTitleSince(userId, 'sueles entrenar', todayStart());
  if (alreadySentEs) return;

  const result = await checkSmartVisitReminder(userId, gymId);
  if (!result || !result.shouldNotify) return;

  const localDay = localizedDayName(result.dayName);
  const firstName = profile?.first_name || '';

  await sendNotification(userId, gymId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: i18n.t('notifications.smartVisitTitle', {
      ns: 'common',
      name: firstName,
      defaultValue: firstName ? `${firstName}, gym time` : 'Gym time',
    }),
    body: i18n.t('notifications.smartVisitBody', {
      ns: 'common',
      time: result.formattedTime,
      day: localDay,
      defaultValue: `${localDay}s at ${result.formattedTime} is your usual. Lock it in.`,
    }),
    dedupKey: `smart_visit_${userId}_${new Date().toISOString().slice(0, 10)}`,
  });
}

/**
 * Challenge Onboarding Nudge
 * After exactly 3 completed workouts, nudge the user to join an active challenge.
 */
async function checkChallengeOnboardingNudge(userId, gymId) {
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('status', 'completed');

  const count = sessions?.length || 0;
  if (count !== 3) return;

  const alreadySent = await wasNotificationWithTitleSince(userId, 'challenge', daysAgoStart(90));
  if (alreadySent) return;

  const now = new Date().toISOString();
  const { data: activeChallenges } = await supabase
    .from('challenges')
    .select('id, name')
    .eq('gym_id', gymId)
    .lte('start_date', now)
    .gte('end_date', now)
    .eq('status', 'active')
    .limit(1);

  if (!activeChallenges?.length) return;

  const challenge = activeChallenges[0];
  // Look up first name for personalized title
  const { data: prof } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  const firstName = (prof?.full_name || '').trim().split(/\s+/)[0] || '';

  await sendNotification(userId, gymId, {
    type: 'challenge_update',
    title: i18n.t('notifications.challengeNudgeTitle', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, ready to compete?` : 'Ready to compete?' }),
    body: i18n.t('notifications.challengeNudgeBody', { ns: 'common', challenge: challenge.name, defaultValue: `You've stacked 3 workouts. "${challenge.name}" is live — jump in and stack points.` }),
    dedupKey: `challenge_nudge_${userId}`,
  });
}

/**
 * Same-Day Streak-at-Risk Warning
 * If user has a 3+ day streak, last activity was yesterday, and it's past 4 PM -> warn.
 */
async function checkStreakAtRisk(userId, gymId, profile) {
  const { data: streakData } = await supabase
    .from('streak_cache')
    .select('current_streak_days, last_activity_date')
    .eq('profile_id', userId)
    .maybeSingle();

  if (!streakData) return;

  // Column is current_streak_days, not current_streak — the prior selector
  // returned undefined which (a) made the early-return below always hit OR
  // (b) leaked through as an undefined `count` to i18next, causing
  // "Tu racha de {{count}} días..." to render literally.
  const currentStreak = streakData.current_streak_days || 0;
  if (currentStreak < 3) return;

  // Check if last_activity_date is yesterday
  const lastActivity = new Date(streakData.last_activity_date);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    lastActivity.getFullYear() === yesterday.getFullYear() &&
    lastActivity.getMonth() === yesterday.getMonth() &&
    lastActivity.getDate() === yesterday.getDate();

  if (!isYesterday) return;

  // Only warn after 4 PM local time
  const currentHour = new Date().getHours();
  if (currentHour < 16) return;

  const alreadySent = await wasNotificationWithTitleSince(userId, 'streak', todayStart());
  if (alreadySent) return;

  const firstName = profile?.first_name || '';
  await sendNotification(userId, gymId, {
    type: 'streak_warning',
    title: i18n.t('notifications.streakAtRiskTitle', { ns: 'common', name: firstName, defaultValue: firstName ? `${firstName}, your streak ends at midnight 🔥` : 'Your streak ends at midnight 🔥' }),
    body: i18n.t('notifications.streakAtRiskBody', { ns: 'common', count: currentStreak, defaultValue: `Your ${currentStreak}-day streak ends at midnight. 30 minutes today and it survives.` }),
    dedupKey: `streak_risk_${userId}_${new Date().toISOString().slice(0, 10)}`,
  });
}

/**
 * Rest-Day Acknowledgement
 * On a non-training day (per profile.preferred_training_days), congratulate the
 * member for protecting their streak with recovery and tease the next session.
 * Fires once per day, only if the member has trained at least once in the last
 * week (so we don't congratulate ghost users on rest days).
 */
async function checkRestDay(userId, gymId, profile) {
  if (!profile.notif_workout_reminders) return;

  const preferredDays = profile?.preferred_training_days || [];
  if (!preferredDays.length) return;

  const today = currentDayName();
  if (preferredDays.includes(today)) return; // training day — different notif

  // Only fire once per day
  const alreadySent = await wasNotificationWithTitleSince(userId, 'rest', todayStart());
  if (alreadySent) return;

  // Only acknowledge for members who have actually been training recently
  const weekAgo = daysAgoStart(7);
  const { data: recent } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .gte('created_at', weekAgo)
    .limit(1);

  if (!recent?.length) return;

  // Find the next training day in their schedule and which routine rotates onto it
  const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayIdx = dayOrder.indexOf(today);
  let nextTrainingDay = null;
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = dayOrder[(todayIdx + offset) % 7];
    if (preferredDays.includes(candidate)) {
      nextTrainingDay = candidate;
      break;
    }
  }

  let nextRoutineName = null;
  if (nextTrainingDay) {
    const { data: routines } = await supabase
      .from('routines')
      .select('id, name')
      .eq('created_by', userId)
      .eq('is_template', false)
      .order('created_at', { ascending: true });
    if (routines?.length) {
      const dayIndex = preferredDays.indexOf(nextTrainingDay);
      nextRoutineName = routines[dayIndex % routines.length]?.name || null;
    }
  }

  await sendRestDayCongrats(userId, gymId, {
    firstName: profile?.first_name || '',
    nextRoutineName,
    nextDayName: nextTrainingDay ? localizedDayName(nextTrainingDay) : null,
  });
}

// ── MAIN SCHEDULER ───────────────────────────────────────────

/**
 * Run all notification checks for a user.
 * Call this when the app opens or from a cron/edge function.
 */
export async function runNotificationScheduler(userId, gymId) {
  if (!userId || !gymId) return;

  // Note: quiet hours are enforced inside each helper (push skipped, DB row still inserted),
  // so we always run the checks. Returning early here previously meant zero notifications
  // ever flowed for users who only opened the app at night.

  // Fetch profile once — includes notification preferences
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return;

  // Streak lives in streak_cache (renamed in migration 0352).
  // Fetch alongside profile and surface as `current_streak` for downstream checks.
  const { data: streakRow } = await supabase
    .from('streak_cache')
    .select('current_streak_days')
    .eq('profile_id', userId)
    .maybeSingle();
  profile.current_streak = streakRow?.current_streak_days ?? 0;

  // Derive first name once so all checks can personalize copy without re-querying.
  profile.first_name = (profile.full_name || '').trim().split(/\s+/)[0] || '';

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
    checkNutritionReminder(userId, gymId, profile),
    checkWeightLogReminder(userId, gymId, profile),
    checkPunchCardProximity(userId, gymId, profile),
    checkSmartVisitNotification(userId, gymId, profile),
    checkChallengeOnboardingNudge(userId, gymId),
    checkStreakAtRisk(userId, gymId, profile),
    checkRestDay(userId, gymId, profile),
  ];

  const results = await Promise.allSettled(checks);

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.warn(`[NotificationScheduler] Check ${i} failed:`, result.reason);
    }
  });
}

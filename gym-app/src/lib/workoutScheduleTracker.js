import { supabase } from './supabase';
import logger from './logger';

// ── CONSTANTS ──────────────────────────────────────────────────
const MIN_WORKOUTS_FOR_PATTERN = 3;
const MIN_WORKOUTS_FOR_NOTIFICATIONS = 5;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── PATTERN ANALYSIS ───────────────────────────────────────────

/**
 * Analyze a user's workout history and detect schedule patterns.
 * Looks at the day-of-week and start times of completed workouts.
 *
 * @param {Array<{ started_at: string }>} sessions - Completed workout sessions
 * @returns {{ preferredDays: Array<{ day: number, dayName: string, count: number }>, averageStartHour: number, averageStartMinute: number, totalSessions: number, confidence: number } | null}
 */
export function analyzeSchedulePattern(sessions) {
  if (!sessions || sessions.length < MIN_WORKOUTS_FOR_PATTERN) return null;

  // Count workouts per day of week
  const dayCounts = new Array(7).fill(0);
  const dayStartTimes = new Array(7).fill(null).map(() => []);

  for (const session of sessions) {
    const date = new Date(session.started_at);
    const dayOfWeek = date.getDay();
    dayCounts[dayOfWeek]++;
    dayStartTimes[dayOfWeek].push({
      hour: date.getHours(),
      minute: date.getMinutes(),
    });
  }

  // Find preferred days: days with at least 20% of average frequency
  // (i.e., days they actually train on, not one-offs)
  const totalSessions = sessions.length;
  const avgPerDay = totalSessions / 7;
  const threshold = Math.max(1, avgPerDay * 0.5);

  const preferredDays = [];
  for (let i = 0; i < 7; i++) {
    if (dayCounts[i] >= threshold) {
      preferredDays.push({
        day: i,
        dayName: DAY_NAMES[i],
        count: dayCounts[i],
      });
    }
  }

  // Sort by frequency (most common day first)
  preferredDays.sort((a, b) => b.count - a.count);

  if (preferredDays.length === 0) return null;

  // Calculate average start time across preferred days
  const allStartTimes = preferredDays.flatMap(d => dayStartTimes[d.day]);
  if (allStartTimes.length === 0) return null;

  // Convert to minutes-since-midnight for averaging
  const totalMinutes = allStartTimes.reduce((sum, t) => sum + t.hour * 60 + t.minute, 0);
  const avgMinutes = Math.round(totalMinutes / allStartTimes.length);
  const averageStartHour = Math.floor(avgMinutes / 60);
  const averageStartMinute = avgMinutes % 60;

  // Calculate confidence: higher if workouts cluster on specific days
  // Ratio of preferred-day workouts to total workouts
  const preferredDayWorkouts = preferredDays.reduce((sum, d) => sum + d.count, 0);
  const confidence = Math.min(1, preferredDayWorkouts / totalSessions);

  return {
    preferredDays,
    averageStartHour,
    averageStartMinute,
    totalSessions,
    confidence,
  };
}

/**
 * Format a time as a human-readable string (e.g., "6:30 PM" or "18:30").
 *
 * @param {number} hour
 * @param {number} minute
 * @param {string} locale - 'en' or 'es'
 * @returns {string}
 */
export function formatScheduleTime(hour, minute, locale = 'en') {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString(locale === 'es' ? 'es-ES' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── DATA FETCHING & PERSISTENCE ────────────────────────────────

/**
 * Fetch completed workout sessions for a user (last 90 days).
 *
 * @param {string} userId
 * @param {string} gymId
 * @returns {Promise<Array<{ started_at: string }>>}
 */
export async function fetchWorkoutSessions(userId, gymId) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data, error } = await supabase
    .from('workout_sessions')
    .select('started_at')
    .eq('profile_id', userId)
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', ninetyDaysAgo.toISOString())
    .order('started_at', { ascending: false });

  if (error) {
    logger.warn('[ScheduleTracker] Failed to fetch sessions:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Analyze the user's workout schedule and persist the pattern to the
 * workout_schedule_patterns table.
 *
 * @param {string} userId
 * @param {string} gymId
 * @returns {Promise<object|null>} The detected pattern, or null if insufficient data.
 */
export async function updateWorkoutSchedulePattern(userId, gymId) {
  if (!userId || !gymId) return null;

  try {
    const sessions = await fetchWorkoutSessions(userId, gymId);
    const pattern = analyzeSchedulePattern(sessions);

    if (!pattern) return null;

    // Upsert into the schedule patterns table
    const { error } = await supabase
      .from('workout_schedule_patterns')
      .upsert({
        profile_id: userId,
        gym_id: gymId,
        preferred_days: pattern.preferredDays.map(d => d.day),
        preferred_day_names: pattern.preferredDays.map(d => d.dayName),
        avg_start_hour: pattern.averageStartHour,
        avg_start_minute: pattern.averageStartMinute,
        total_sessions_analyzed: pattern.totalSessions,
        confidence: pattern.confidence,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id' });

    if (error) {
      logger.warn('[ScheduleTracker] Failed to upsert pattern:', error.message);
    }

    return pattern;
  } catch (e) {
    logger.warn('[ScheduleTracker] updateWorkoutSchedulePattern error:', e?.message || e);
    return null;
  }
}

/**
 * Fetch the stored workout schedule pattern for a user.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getWorkoutSchedulePattern(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('workout_schedule_patterns')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) {
    logger.warn('[ScheduleTracker] Failed to fetch pattern:', error.message);
    return null;
  }

  return data;
}

// ── NOTIFICATION CHECK ─────────────────────────────────────────

/**
 * Check if it's time to send a smart visit notification.
 * Returns notification data if the user should be reminded, null otherwise.
 *
 * Rules:
 * - Requires 5+ workouts with a detected pattern
 * - Only triggers on preferred workout days
 * - Only triggers ~1 hour before their usual start time
 * - Skips if the user already trained today
 *
 * @param {string} userId
 * @param {string} gymId
 * @returns {Promise<{ shouldNotify: boolean, formattedTime: string, dayName: string } | null>}
 */
export async function checkSmartVisitReminder(userId, gymId) {
  if (!userId || !gymId) return null;

  try {
    const pattern = await getWorkoutSchedulePattern(userId);
    if (!pattern) return null;

    // Need sufficient data for reliable notifications
    if (pattern.total_sessions_analyzed < MIN_WORKOUTS_FOR_NOTIFICATIONS) return null;

    // Need reasonable confidence (at least 60%)
    if (pattern.confidence < 0.6) return null;

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Is today a preferred workout day?
    const preferredDays = pattern.preferred_days || [];
    if (!preferredDays.includes(currentDay)) return null;

    // Calculate minutes until usual start time
    const usualMinutes = pattern.avg_start_hour * 60 + pattern.avg_start_minute;
    const currentMinutes = currentHour * 60 + currentMinute;
    const minutesUntilUsual = usualMinutes - currentMinutes;

    // Trigger window: 45-75 minutes before usual start time
    if (minutesUntilUsual < 45 || minutesUntilUsual > 75) return null;

    // Check if user already trained today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todaySessions } = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('profile_id', userId)
      .eq('gym_id', gymId)
      .gte('started_at', todayStart.toISOString())
      .limit(1);

    if (todaySessions?.length) return null;

    return {
      shouldNotify: true,
      formattedTime: formatScheduleTime(pattern.avg_start_hour, pattern.avg_start_minute),
      dayName: DAY_NAMES[currentDay],
    };
  } catch (e) {
    logger.warn('[ScheduleTracker] checkSmartVisitReminder error:', e?.message || e);
    return null;
  }
}

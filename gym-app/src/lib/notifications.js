import { supabase } from './supabase';
import logger from './logger';
import { selectAllRows } from './churn/batchedSelect';

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
  // Page through the FULL member roster — a plain select clamps at the ~1000-row
  // PostgREST cap, so on a gym over 1000 members announcements / NPS surveys
  // silently reached only the first 1000. selectAllRows fetches every page.
  const { data: members } = await selectAllRows(
    (from, to) => supabase
      .from('profiles')
      .select('id')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .range(from, to),
  );

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

// ── TYPED NOTIFICATION HELPERS (removed 2026-05-23) ─────────
// The streak / milestone / friend-activity / win-back / achievement /
// habit-checkin / weekly-summary / rest-day helpers that used to live here
// were dead code — every one had zero call sites. Those notifications are
// now produced server-side (scheduled-reminders edge function + the
// lifecycle / winback / milestone SQL cron), or via direct sendNotification()
// calls (achievement in SessionSummary, challenge/duel in Challenges &
// Leaderboard, admin message in AdminMembers). Do NOT re-add client-side
// typed helpers without a real caller — wire the producer where the event
// actually happens instead.

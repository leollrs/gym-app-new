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

// Rows per notifications insert. Well under any statement/URL limit while
// turning a 2,000-member announcement into 4 round-trips instead of 2,000.
const INSERT_CHUNK = 500;
// Simultaneous send-push-user edge invocations during a gym-wide broadcast.
// Matches the pacing already used by lib/admin/outreachSender.js.
const PUSH_CONCURRENCY = 8;

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

  // Insert in-app notifications in CHUNKS, not one row at a time.
  //
  // The original loop awaited one HTTP round-trip per member. At ~60ms that is
  // two full minutes of blocking for a 2,000-member gym, during which the admin's
  // browser tab has to stay open and foregrounded — navigate away mid-flight and
  // the announcement is half-delivered with no resume and no record of where it
  // stopped.
  //
  // The loop existed to survive dedup_key collisions (a batch insert fails whole
  // if any single row conflicts). `upsert` with ignoreDuplicates does the same job
  // server-side: conflicting rows are skipped, the rest still land. Without a
  // dedupKey there is no conflict target, so a plain insert is correct there.
  const rows = members.map((m) => {
    const row = { profile_id: m.id, gym_id: gymId, type, title, body, data };
    if (dedupKey) row.dedup_key = `${dedupKey}_${m.id}`;
    return row;
  });
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { error } = dedupKey
      ? await supabase.from('notifications')
          .upsert(chunk, { onConflict: 'dedup_key', ignoreDuplicates: true })
      : await supabase.from('notifications').insert(chunk);
    if (error && error.code !== '23505') {
      logger.warn('broadcastNotification insert failed for chunk', i, error);
    }
  }

  // Fire native push, CONCURRENCY-BOUNDED.
  //
  // This used to be a bare un-awaited for-loop, i.e. one `send-push-user` edge
  // invocation per member fired simultaneously from a single browser: 2,000
  // concurrent invocations for a 2,000-member gym, each doing its own token
  // lookup and APNs/FCM call. That is an edge cold-start storm and a real
  // rate-limit risk with the push providers. Browser per-origin connection
  // limits then queued them anyway, so the announcement trickled out over
  // minutes — the pacing was happening regardless, just uncontrolled.
  //
  // Still fire-and-forget overall (the caller shouldn't wait on push), but with
  // a bounded worker pool so the burst is flat instead of spiky. Kept on
  // send-push-user rather than the batched send-push function because only this
  // one honours per-type opt-outs like notif_announcements_enabled.
  if (!isQuietHours()) {
    const queue = [...members];
    const worker = async () => {
      for (;;) {
        const m = queue.shift();
        if (!m) return;
        try {
          await sendPushToUser({
            userId: m.id,
            gymId,
            title,
            body: body || '',
            data: { route: '/notifications', type },
            notificationType: type,
          });
        } catch (err) {
          logger.warn('broadcastNotification push failed:', m.id, err);
        }
      }
    };
    // Not awaited: the announcement is already durably inserted above, so the
    // caller can return and let push drain in the background.
    Promise.all(Array.from({ length: PUSH_CONCURRENCY }, worker))
      .catch((err) => logger.warn('broadcastNotification push pool:', err));
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

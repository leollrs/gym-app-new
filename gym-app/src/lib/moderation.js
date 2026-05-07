// src/lib/moderation.js
//
// Client helpers for UGC moderation (Apple Guideline 1.2 + Google Play UGC).
//
// - reportContent({ type, id, reason, details, gymId, targetUserId })
//   Idempotent per (reporter, content). Routes everything into the existing
//   `content_reports` table that AdminModeration.jsx already reads.
//
// - blockUser(targetUserId)        — adds a blocked_users row
// - unblockUser(targetUserId)      — removes it
// - getBlockedUserIds()            — cached set of blocked user ids
// - isBlocked(userId)              — sync boolean against the cache
// - subscribeBlocks(listener)      — change subscription
//
// All writes are scoped to the authenticated caller via auth.uid() — RLS on
// content_reports + blocked_users enforces this server-side.
//
// IMPORTANT: This module mirrors the schema as it exists today (migrations
// 0038, 0134, 0210, 0272, 20260429000001). Do not change the column names
// here without checking AdminModeration.jsx first — it's the consumer.

import { supabase } from './supabase';

// ── Reason allow-list (matches CHECK constraint in 20260429000001) ──────────
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'nudity',
  'violence',
  'dangerous',
  'inappropriate',
  'other',
];

// ── Content type allow-list (matches CHECK constraint) ─────────────────────
export const CONTENT_TYPES = ['activity', 'comment', 'message', 'profile'];

// Map UI-facing labels to DB content_type values.
const TYPE_ALIASES = {
  post: 'activity',
  feed_item: 'activity',
  activity: 'activity',
  comment: 'comment',
  message: 'message',
  dm: 'message',
  profile: 'profile',
  user: 'profile',
};

// ── Local cache of blocked users (per session) ──────────────────────────────
let _blockedSet = null;
let _blockedLoaded = false;
let _inflight = null;
const _listeners = new Set();

function notify() {
  for (const fn of _listeners) {
    try { fn(_blockedSet ?? new Set()); } catch { /* swallow */ }
  }
}

/**
 * Subscribe to changes to the blocked-user set.
 * Returns an unsubscribe function.
 */
export function subscribeBlocks(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Force-invalidate the in-memory cache. Useful on logout.
 */
export function invalidateBlocks() {
  _blockedSet = null;
  _blockedLoaded = false;
  _inflight = null;
}

/**
 * Returns the set of blocked user ids for the current viewer.
 * Cached in module memory — call invalidateBlocks() to refresh.
 */
export async function getBlockedUserIds() {
  if (_blockedLoaded && _blockedSet) return _blockedSet;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const { data, error } = await supabase
      .from('blocked_users')
      .select('blocked_id');

    if (error) {
      _inflight = null;
      return new Set();
    }
    _blockedSet = new Set((data || []).map(r => r.blocked_id));
    _blockedLoaded = true;
    _inflight = null;
    notify();
    return _blockedSet;
  })();

  return _inflight;
}

/**
 * Synchronous check against the cache. Falsey if cache hasn't loaded yet —
 * components should call getBlockedUserIds() once on mount.
 */
export function isBlocked(userId) {
  if (!userId || !_blockedSet) return false;
  return _blockedSet.has(userId);
}

/**
 * Blocks a user. Idempotent.
 * Side effect: removes any existing friendship with that user (mirroring
 * the long-standing behavior in SocialFeed.handleBlock).
 */
export async function blockUser(targetUserId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !targetUserId || user.id === targetUserId) {
    return { error: new Error('invalid_block_target') };
  }

  const { error } = await supabase
    .from('blocked_users')
    .upsert(
      { blocker_id: user.id, blocked_id: targetUserId },
      { onConflict: 'blocker_id,blocked_id' }
    );

  if (error) return { error };

  // Drop any active friendship — block implies severance.
  await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),` +
      `and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`
    );

  if (!_blockedSet) _blockedSet = new Set();
  _blockedSet.add(targetUserId);
  _blockedLoaded = true;
  notify();

  return { error: null };
}

/**
 * Unblocks a user.
 */
export async function unblockUser(targetUserId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !targetUserId) return { error: new Error('not_authenticated') };

  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', targetUserId);

  if (error) return { error };

  if (_blockedSet) {
    _blockedSet.delete(targetUserId);
    notify();
  }

  return { error: null };
}

/**
 * Files a content report. Routes into the existing content_reports table
 * that AdminModeration.jsx reads.
 *
 * @param {Object}  args
 * @param {string}  args.type     — 'post' | 'comment' | 'message' | 'profile'
 *                                  (also accepts 'activity', 'feed_item', etc.)
 * @param {string}  args.id       — content id (uuid). Required.
 * @param {string}  args.reason   — one of REPORT_REASONS. Defaults 'other'.
 * @param {string}  [args.details]— optional free-form details from reporter.
 * @param {string}  [args.gymId]  — gym id of the reporter; required by RLS.
 *                                  Pass profile.gym_id from AuthContext.
 * @param {string}  [args.targetUserId] — author of the reported content
 *                                        (informational; not stored separately).
 *
 * Idempotent — if the same (reporter, content) report already exists, the
 * insert returns a 23505 unique-violation, which we coerce into a soft success.
 */
export async function reportContent({ type, id, reason = 'other', details, gymId, targetUserId } = {}) {
  if (!id) return { error: new Error('missing_content_id'), alreadyReported: false };

  const dbType = TYPE_ALIASES[type] || type;
  if (!CONTENT_TYPES.includes(dbType)) {
    return { error: new Error('invalid_content_type'), alreadyReported: false };
  }

  const safeReason = REPORT_REASONS.includes(reason) ? reason : 'other';

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: new Error('not_authenticated'), alreadyReported: false };
  if (!gymId) return { error: new Error('missing_gym_id'), alreadyReported: false };

  const payload = {
    reporter_id: user.id,
    gym_id: gymId,
    reason: safeReason,
    details: details?.trim() || null,
    content_type: dbType,
    content_id: id,
    // For 'activity' (legacy code path) keep feed_item_id populated so the
    // existing AdminModeration query (which joins on feed_item_id) keeps
    // surfacing reports unchanged.
    feed_item_id: dbType === 'activity' ? id : null,
  };
  // targetUserId is not persisted — admin can resolve it from the joined
  // feed_item / comment / message row. Kept in the API for future use.
  void targetUserId;

  const { error } = await supabase.from('content_reports').insert(payload);

  if (error) {
    if (error.code === '23505') {
      return { error: null, alreadyReported: true };
    }
    return { error, alreadyReported: false };
  }
  return { error: null, alreadyReported: false };
}

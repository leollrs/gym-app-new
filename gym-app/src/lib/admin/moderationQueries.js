import { supabase } from '../supabase.js';

/**
 * Moderation list queries shared across the AdminModeration surfaces:
 *
 *   - The main page uses all three to derive stat-card counts + tab badges.
 *   - PostsTab, CommentsTab, ReportsTab each use their own to feed the
 *     table they render.
 *
 * Pulling them into a shared lib avoids duplicating the SELECT shape +
 * 50-row cap across 4 callers — and keeps the embedded-relations syntax
 * (which Postgrest is picky about) in one place.
 */

export async function fetchPosts(gymId) {
  const { data, error } = await supabase
    .from('activity_feed_items')
    .select(`
      id, type, data, is_public, is_deleted, created_at, actor_id,
      profiles!activity_feed_items_actor_id_fkey (full_name, username, gym_id)
    `)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function fetchComments(gymId) {
  const { data, error } = await supabase
    .from('feed_comments')
    .select(`
      id, content, is_deleted, created_at, profile_id, feed_item_id,
      profiles!feed_comments_profile_id_fkey (full_name, username, gym_id),
      activity_feed_items!feed_comments_feed_item_id_fkey (type, created_at, gym_id)
    `)
    .eq('activity_feed_items.gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  // Drop rows where the embedded activity_feed_items relation came back null
  // — those are comments on posts that belong to a different gym (the embed
  // filter is enforced via `.eq('activity_feed_items.gym_id', gymId)` but
  // returns the row with relation = null rather than excluding it).
  return (data || []).filter(c => c.activity_feed_items !== null);
}

/**
 * Reports query has the most logic — it joins activity_feed_items with
 * `!left` so non-feed-item reports (comment/message/profile) still come
 * through, then does a follow-up batched lookup to enrich the
 * comment-target and profile-target rows. The output schema is:
 *
 *   {
 *     ...content_reports row,
 *     profiles: { full_name, username },              // reporter
 *     activity_feed_items: { ... } | null,            // populated for content_type === 'activity'
 *     reported_comment: { ... } | null,               // populated for content_type === 'comment'
 *     reported_profile: { ... } | null,               // populated for content_type === 'profile'
 *   }
 */
export async function fetchReports(gymId) {
  // LEFT JOIN on activity_feed_items via the explicit FK + `!left` hint so
  // reports with NULL feed_item_id (the new comment / message / profile types)
  // are still included. PostgREST treats embedded resources as left joins when
  // the FK column is nullable, but we set `!left` explicitly for clarity.
  const { data, error } = await supabase
    .from('content_reports')
    .select(`
      id, reason, status, created_at, reviewed_at, reporter_id,
      content_type, content_id, feed_item_id, details,
      profiles!content_reports_reporter_id_fkey (full_name, username),
      activity_feed_items!content_reports_feed_item_id_fkey!left (
        id, type, data, is_deleted, created_at, actor_id,
        profiles:profiles!activity_feed_items_actor_id_fkey (full_name, username)
      )
    `)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  const rows = data || [];

  // ── Enrich comment/profile reports with their target rows ──────────────
  // We do separate batched lookups instead of trying to embed multiple
  // possible relations from content_reports (PostgREST can't pick a target
  // table dynamically based on content_type).
  const commentIds = rows
    .filter(r => r.content_type === 'comment' && r.content_id)
    .map(r => r.content_id);
  const profileIds = rows
    .filter(r => r.content_type === 'profile' && r.content_id)
    .map(r => r.content_id);

  const [commentsRes, profilesRes] = await Promise.all([
    commentIds.length
      ? supabase
          .from('feed_comments')
          .select(`
            id, content, is_deleted, created_at, profile_id, feed_item_id,
            profiles!feed_comments_profile_id_fkey (full_name, username, avatar_url)
          `)
          .in('id', commentIds)
      : { data: [], error: null },
    profileIds.length
      ? supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', profileIds)
      : { data: [], error: null },
  ]);

  const commentMap = new Map((commentsRes.data || []).map(c => [c.id, c]));
  const profileMap = new Map((profilesRes.data || []).map(p => [p.id, p]));

  return rows.map(r => ({
    ...r,
    // Normalize: every report has at most one of these populated.
    reported_comment: r.content_type === 'comment' ? commentMap.get(r.content_id) || null : null,
    reported_profile: r.content_type === 'profile' ? profileMap.get(r.content_id) || null : null,
  }));
}

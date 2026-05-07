// gym-app/src/lib/moderationFilter.js
// ─────────────────────────────────────────────────────────────────────────────
// Pre-publication content filter — client-side helpers.
//
// Apple Guideline 1.2(a) and Google Play UGC policy require user-generated
// content to be filtered for objectionable material BEFORE publication. The
// canonical filter lives server-side (see migration 0345_content_filter.sql).
// This module exposes:
//
//   1. `checkContentBeforeSend(supabase, plaintext)` — async. Calls the
//      `moderation_check_dm` RPC. Use this in the DM send path BEFORE
//      encrypting the plaintext, since the encrypted column is opaque to
//      the database trigger.
//
//   2. `containsProhibitedTerm(plaintext, termsArray)` — sync. Pure JS
//      mirror of the same logic for fast UX (e.g. inline character counter
//      hints). Pass a pre-fetched list from `moderation_terms`.
//
// The server-side trigger remains the source of truth for `feed_posts` and
// `feed_comments`; the client filter is purely a UX accelerator + a
// gatekeeper for end-to-end-encrypted DMs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async pre-flight check. Round-trips to Supabase RPC.
 *
 * @param {object} supabase  Supabase client instance
 * @param {string} plaintext User-authored text (NOT yet encrypted)
 * @returns {Promise<{ allowed: boolean, severity: number, matched: string[] }>}
 */
export async function checkContentBeforeSend(supabase, plaintext) {
  if (!supabase || typeof plaintext !== 'string' || plaintext.trim().length === 0) {
    return { allowed: true, severity: 0, matched: [] };
  }

  try {
    const { data, error } = await supabase.rpc('moderation_check_dm', {
      p_plaintext: plaintext,
    });

    if (error) {
      // Fail open on RPC errors — UX should not be blocked by a transient
      // network issue. The server-side trigger still protects feed posts +
      // comments, and the DM trigger (none — DM is encrypted) means we can
      // do nothing more here. Log only.
      console.warn('[moderationFilter] RPC failed, allowing send:', error.message);
      return { allowed: true, severity: 0, matched: [] };
    }

    return {
      allowed: !!data?.allowed,
      severity: data?.severity ?? 0,
      matched: Array.isArray(data?.matched) ? data.matched : [],
    };
  } catch (err) {
    console.warn('[moderationFilter] unexpected error, allowing send:', err);
    return { allowed: true, severity: 0, matched: [] };
  }
}

/**
 * Synchronous offline mirror — useful for inline UI hints (e.g. disable Send
 * button while the user is typing a hard-blocked term). Caller must supply a
 * pre-fetched list from `moderation_terms` (or a baked-in fallback).
 *
 * Word-boundary match for single-word terms; substring match for multi-word.
 *
 * @param {string} plaintext
 * @param {Array<{ term: string, severity: number }>} termsArray
 * @returns {{ matched: string[], severity: number }}
 */
export function containsProhibitedTerm(plaintext, termsArray) {
  if (typeof plaintext !== 'string' || plaintext.length === 0 || !Array.isArray(termsArray)) {
    return { matched: [], severity: 0 };
  }

  const lower = plaintext.toLowerCase();
  const matched = [];
  let maxSev = 0;

  for (const row of termsArray) {
    const term = (row?.term ?? '').toLowerCase();
    if (!term) continue;

    let hit = false;
    if (term.includes(' ')) {
      hit = lower.includes(term);
    } else {
      // Word-boundary regex; allow accented Spanish characters as part of "word".
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-záéíóúñ])${escaped}([^a-záéíóúñ]|$)`, 'i');
      hit = re.test(lower);
    }

    if (hit) {
      matched.push(term);
      if ((row.severity ?? 1) > maxSev) maxSev = row.severity ?? 1;
    }
  }

  return { matched, severity: maxSev };
}

export default {
  checkContentBeforeSend,
  containsProhibitedTerm,
};

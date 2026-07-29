// shareToFeed.js
// -----------------------------------------------------------------------------
// Post a rendered share card to the gym's own activity feed.
//
// Every share sheet had its own copy of this, and all of them had the same two
// holes: they inserted TEXT ONLY — the card image, the entire point of a share,
// was never uploaded — and they logged failures to the console instead of
// telling the member. So "Share to TuGymPR" either posted a bare line of text
// or nothing at all, and looked identical either way: no image, no confirmation,
// no error. The gym feed is meant to be the members' local social; posting to it
// has to actually carry the picture and has to say whether it worked.
//
// One helper, three callers (workout / cardio / achievement), so the next sheet
// that wants this can't reinvent a fourth broken version.
// -----------------------------------------------------------------------------

import { supabase } from './supabase';
import { safeNavigate } from './navigationRef';

/**
 * @param blob   rendered card PNG (optional — text-only still posts)
 * @param text   caption/body
 * @param userId actor
 * @param gymId  tenant
 * @param extra  type-specific fields merged into `data`
 * @throws       on upload / insert failure so the caller can surface it
 */
export async function postShareCardToFeed({ blob, text, userId, gymId, extra = {} }) {
  if (!userId || !gymId) throw new Error('not signed in to a gym');

  // Strip the app link. Every sheet builds ONE caption and reuses it for all
  // destinations, and for Messages/WhatsApp/IG the trailing
  // `https://app.tugympr.com/get?c=…` is the whole point — it's how a friend
  // installs the app. Inside the gym feed it is noise: the reader is already in
  // the app, looking at the post, and a raw URL sitting under the text just
  // makes a member's post look like an ad.
  const body = String(text || '')
    .replace(/https?:\/\/\S*app\.tugympr\.com\/\S*/gi, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  let photoPath = null;
  if (blob) {
    // Same convention as SocialFeed's composer: the object key MUST start with
    // the uploader's id — the storage INSERT policy checks
    // foldername[1] = auth.uid() — and the ROW stores the PATH, not a signed
    // url, because the feed signs paths at read time.
    const storagePath = `${userId}/${Date.now()}-share.png`;
    const { error: upErr } = await supabase.storage
      .from('social-posts')
      .upload(storagePath, blob, { cacheControl: '31536000', contentType: 'image/png' });
    if (upErr) throw upErr;
    photoPath = storagePath;
  }

  const { error } = await supabase.from('activity_feed_items').insert({
    actor_id: userId,
    gym_id: gymId,
    type: 'user_post',
    post_type: 'user',
    is_public: true,
    body: body || null,
    photo_url: photoPath,
    data: { body: body || null, photo_url: photoPath, ...extra },
  });
  // supabase-js does NOT throw on a Postgres error — it returns it. Rethrow so
  // callers can't accidentally treat a failed insert as a success.
  if (error) throw error;

  // Tell the feed. /social is a keep-alive route, so it stays mounted with a
  // list it fetched earlier — a post made from a share sheet simply wasn't in
  // it, and only a full app restart brought it back. That reads as "the share
  // failed", which is the worst possible outcome for something that worked.
  try { window.dispatchEvent(new CustomEvent('tugympr:feed-changed')); } catch { /* non-browser host */ }

  // Take them to the post — specifically to MY POSTS, not the default feed.
  // You share from a summary screen, a profile, a recap — nowhere near the
  // feed — so the only evidence anything happened was a toast that vanished.
  // Landing on the feed IS the confirmation, but "For You" deliberately
  // filters out your own items (rankedFeed drops actor_id === me), so dropping
  // someone on the default tab showed them a feed WITHOUT the thing they just
  // posted. That reads as "it failed". `?tab=mine` is consumed and cleared by
  // SocialFeed, which also forces My Posts to refetch.
  //
  // safeNavigate (not window.location): on Capacitor the app runs under
  // MemoryRouter, where a location assignment reloads the whole bundle from
  // disk and throws away app state.
  try { safeNavigate('/social?tab=mine'); }
  catch { /* navigation is a nicety — never fail the post over it */ }
}

/** Moderation trigger (23514) vs any other failure — drives which toast shows. */
export function isModerationBlock(err) {
  return err?.code === '23514' || String(err?.message || '').includes('community guidelines');
}

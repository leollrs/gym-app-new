// Resolves food/meal image paths to Supabase Storage public URLs.
// Uses the same pattern as exercise videos: supabase.storage.from().getPublicUrl()
import { supabase } from './supabase';

// Branded placeholder shown when a recipe/meal image is missing (404) so the
// Discover grid never renders a broken tile. getPublicUrl() always returns a
// URL string even when the object doesn't exist, so a missing /meals/*.png
// only fails at <img> load time — hence an onError swap rather than a null check.
// Gold-on-black to match the brand (black + #D8A93A).
const MEAL_FALLBACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect width="400" height="300" fill="#111114"/>' +
  '<circle cx="200" cy="128" r="46" fill="none" stroke="#D8A93A" stroke-width="4" opacity="0.9"/>' +
  '<circle cx="200" cy="128" r="30" fill="none" stroke="#D8A93A" stroke-width="2" opacity="0.45"/>' +
  '<rect x="150" y="116" width="4" height="52" rx="2" fill="#D8A93A" opacity="0.9"/>' +
  '<rect x="246" y="116" width="4" height="52" rx="2" fill="#D8A93A" opacity="0.9"/>' +
  '<text x="200" y="226" fill="#7a7a80" font-family="Barlow, sans-serif" font-size="15" letter-spacing="3" text-anchor="middle">TUGYMPR</text>' +
  '</svg>';

/** Data-URI branded placeholder for a missing meal/recipe image. */
export const MEAL_IMG_FALLBACK = `data:image/svg+xml,${encodeURIComponent(MEAL_FALLBACK_SVG)}`;

/**
 * onError handler for recipe/meal <img> tags. Swaps a 404'd image for the
 * branded placeholder exactly once (nulls onerror first to avoid a load loop).
 * Usage: <img src={foodImageUrl(recipe.image)} onError={handleMealImgError} />
 */
export function handleMealImgError(e) {
  const el = e?.target;
  if (!el || el.dataset.fallbackApplied) return;
  el.dataset.fallbackApplied = '1';
  el.onerror = null;
  el.src = MEAL_IMG_FALLBACK;
}

// ── Supabase Storage image transforms ────────────────────────────────────────
// Storage can serve a RESIZED / re-encoded copy of a public object from
//   /storage/v1/render/image/public/<bucket>/<path>?width=<w>&quality=<q>
// instead of the raw bytes at /storage/v1/object/public/<bucket>/<path>.
// supabase-js builds that URL itself when getPublicUrl() is handed a
// `transform` option, so we never hand-splice the path/host and the bucket
// plumbing above stays the single source of truth.
//
// VERIFIED against THIS project on 2026-07-26 (curl -sI on both endpoints —
// the render endpoint is live here and answers HTTP 200):
//   food-images/meals/grilled_chicken_and_sweet_potato.jpg
//                                    214,247 B  →  w96  q60   12,648 B  (-94%)
//   food-images/ingredients/chicken_breast.jpg
//                                    164,680 B  →  w144 q70    9,142 B  (-94%)
//   food-images/categories/high_protein.jpg
//                                    401,313 B  →  w144 q70   21,697 B  (-95%)
// The stored originals are 1024x1024. Several of these paths render into a
// 34–44 px box, i.e. we were shipping ~20x the pixels the screen can show —
// on gym wifi/cellular, and with NOTHING cached between sessions on native
// (vite.config.js ships a self-destructing SW on Capacitor on purpose).
//
// Contract: with no transform requested, the URL is byte-identical to what
// this file returned before. Only the two thumbnail-only prefixes below opt in
// by default; every other path — and both other buckets — is unchanged.
function transformFor(opts) {
  if (!opts || typeof opts !== 'object') return undefined;
  const width = Number(opts.width) || 0;
  const quality = Number(opts.quality) || 0;
  if (!width && !quality) return undefined;   // nothing asked for → original object URL
  const t = {};
  if (width) t.width = Math.round(width);
  if (quality) t.quality = Math.round(quality);
  return t;
}

// Prefixes inside `food-images` whose EVERY call site was checked and renders
// into a ≤44 px box, so a small transform is safe to apply by default:
//   ingredients/ → Nutrition.jsx:1182, :6221 (FoodThumb size 40), :6466 (size 34)
//   categories/  → Nutrition.jsx:5607 (`w-11 h-11` = 44 px)
// 144 px covers a 44 px box at DPR 3 (132) with headroom.
//
// ⚠️ THAT LIST WAS INCOMPLETE when first written, and the failure mode is worth
// understanding: this default keys on the PATH PREFIX, so it fires for every
// caller whose path happens to start with `ingredients/` — not just the ones
// that build the path literally from a slug. The 116 ingredient rows seeded by
// migration 0634 store `image_url = '/ingredients/<slug>.jpg'`, so any site
// passing a DB `food_items.image_url` also got the 144 px transform. Two of
// those render LARGE (Nutrition.jsx:2116, a full-width 4/3 hero, and :4940, a
// 150 px card) and were served an 8x upscale — visibly blurry. Both now pass an
// explicit width, which overrides this default.
//
// If you add a call site that renders one of these prefixes above ~44 px, pass
// `{ width }` explicitly. Auditing "every call site" by grepping the literal
// path is not enough; grep the DB column too.
//
// MEAL images are deliberately NOT in this list: their call sites run from a
// 44 px row thumb (Nutrition.jsx:2654) all the way up to the recipe-detail
// hero (full width x 260 px, Nutrition.jsx:554). One default can't serve both,
// so meals keep the original until each thumbnail site passes its own width.
const THUMB_ONLY_PREFIXES = ['ingredients/', 'categories/'];
const THUMB_TRANSFORM = { width: 144, quality: 70 };

/**
 * Convert a local image path (e.g. "/foods/chicken_breast.jpg") to its
 * Supabase Storage public URL. Already-absolute URLs are returned as-is.
 * Handles .png → .jpg extension correction (all images were re-exported as JPG).
 *
 * @param {string} path
 * @param {{width?:number, quality?:number}} [opts] - request a resized copy via
 *   the Storage render endpoint. Omit for the original bytes (default).
 *   Pass an explicit width at any site that renders a thumbnail.
 */
export function foodImageUrl(path, opts) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  // Pass through base64 data URLs (e.g. AI photo previews captured locally).
  // Without this guard the data URL was sent to supabase.storage as a "path"
  // and we rendered the wrong product image — that surfaced as the
  // "Recently scanned" tile / re-open modal showing a stale food image.
  if (path.startsWith('data:')) return path;
  // Same for blob: object URLs created from File APIs.
  if (path.startsWith('blob:')) return path;
  let clean = path.startsWith('/') ? path.slice(1) : path;
  clean = clean.replace(/\.png$/i, '.jpg');
  // Explicit opts always win; otherwise fall back to the thumbnail default for
  // the prefixes whose call sites are all ≤44 px (see THUMB_ONLY_PREFIXES).
  const transform = transformFor(
    opts || (THUMB_ONLY_PREFIXES.some((p) => clean.startsWith(p)) ? THUMB_TRANSFORM : null),
  );
  const { data } = supabase.storage
    .from('food-images')
    .getPublicUrl(clean, transform ? { transform } : undefined);
  return data?.publicUrl || null;
}

/**
 * Equipment-station image → its Supabase Storage public URL.
 * Dedicated "equipment-images" bucket (kept separate from food/meal images),
 * files stored at the root as "<slug>.jpg" (e.g. "treadmill.jpg"). Accepts a
 * bare slug ("treadmill"), a legacy "/equipment/<slug>.jpg" path, or a full URL.
 *
 * @param {string} slugOrPath
 * @param {{width?:number, quality?:number}} [opts] - optional Storage transform.
 *   Left OFF by default: the only caller (Equipment.jsx StationHero) renders at
 *   52 px in a list row BUT also full-bleed in a 224 px-tall arrival hero and a
 *   square browse tile, so there is no single safe width to bake in here.
 */
export function equipmentImageUrl(slugOrPath, opts) {
  if (!slugOrPath) return null;
  const s = String(slugOrPath);
  if (s.startsWith('http') || s.startsWith('data:') || s.startsWith('blob:')) return s;
  let clean = s.startsWith('/') ? s.slice(1) : s;
  clean = clean.replace(/^equipment\//, '');          // strip legacy folder prefix
  clean = clean.replace(/\.png$/i, '.jpg');           // all images re-exported as JPG
  if (!/\.(jpe?g|webp)$/i.test(clean)) clean = `${clean}.jpg`; // bare slug → add .jpg
  const transform = transformFor(opts);
  const { data } = supabase.storage
    .from('equipment-images')
    .getPublicUrl(clean, transform ? { transform } : undefined);
  return data?.publicUrl || null;
}

/**
 * Convert a local program image path (e.g. "/programs/starting-strength.jpg")
 * to its Supabase Storage public URL.
 * The bucket is "program-images" and files are stored at the root (e.g. "starting-strength.jpg"),
 * so we strip the "programs/" prefix from the path.
 *
 * @param {string} path
 * @param {{width?:number, quality?:number}} [opts] - optional Storage transform.
 *   Left OFF by default: Workouts.jsx:3084 renders a program cover as a
 *   FULL-WIDTH square hero (~390 CSS px, 1170 device px at DPR 3), so a small
 *   default would visibly soften it. The 190 px carousel cards (Workouts.jsx:3134)
 *   and the 3:4 grid tiles (:3293) are the ones worth passing a width at.
 */
export function programImageUrl(path, opts) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  let clean = path.startsWith('/') ? path.slice(1) : path;
  // Strip "programs/" prefix — files in the bucket are at the root level
  clean = clean.replace(/^programs\//, '');
  const transform = transformFor(opts);
  const { data } = supabase.storage
    .from('program-images')
    .getPublicUrl(clean, transform ? { transform } : undefined);
  return data?.publicUrl || null;
}

// ── Signed (private-bucket) transforms ───────────────────────────────────────
// `social-posts` is private, so its URLs come from createSignedUrls(). That
// BATCH api — the one the feed uses to sign every photo in a page with a single
// round trip — does NOT accept a `transform` option; only the singular
// createSignedUrl() does. So the feed was serving the FULL-SIZE original of
// every photo: member uploads are stored at up to 2048px (stripExif), and share
// cards are rasterised at 1080x1920.
//
// Measured on a representative grained share card (1080x1920):
//     stored original .......... 374 KB
//     800w q72 via transform ....  73 KB   (-80%)
// A photo feed is a dozen of those at once, which is what makes it crawl.
//
// Going one-signed-URL-per-image to get `transform` would trade one request for
// N. Instead: the storage API exposes the SAME token on a render/image route,
// so the batch-signed URL can simply be pointed at it.
//
// VERIFIED against THIS project on 2026-07-28 (curl):
//   /storage/v1/object/sign/social-posts/x.png?token=fake
//        → 400 {"error":"InvalidJWT"}          route exists, token rejected
//   /storage/v1/render/image/sign/social-posts/x.png?token=fake&width=800
//        → 400 {"error":"InvalidJWT"}          same — route exists, same token
//   /storage/v1/render/image/sign/social-posts/x.png   (no token)
//        → 400 "querystring must have required property 'token'"
// i.e. the render route is live and authenticates with the identical token,
// so rewriting the path is sufficient. Returns the input untouched for
// anything that isn't a signed object URL, so a caller can pass through
// already-absolute or already-rendered urls safely.
export function signedImageUrl(signedUrl, { width, quality } = {}) {
  if (!signedUrl || typeof signedUrl !== 'string') return signedUrl;
  if (!signedUrl.includes('/storage/v1/object/sign/')) return signedUrl;
  const w = Number(width) || 0;
  const q = Number(quality) || 0;
  if (!w && !q) return signedUrl;
  try {
    const u = new URL(signedUrl);
    u.pathname = u.pathname.replace('/storage/v1/object/sign/', '/storage/v1/render/image/sign/');
    if (w) u.searchParams.set('width', String(Math.round(w)));
    if (q) u.searchParams.set('quality', String(Math.round(q)));
    return u.toString();
  } catch {
    return signedUrl;   // not parseable — never break an image over an optimisation
  }
}

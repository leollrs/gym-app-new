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

/**
 * Convert a local image path (e.g. "/foods/chicken_breast.jpg") to its
 * Supabase Storage public URL. Already-absolute URLs are returned as-is.
 * Handles .png → .jpg extension correction (all images were re-exported as JPG).
 */
export function foodImageUrl(path) {
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
  const { data } = supabase.storage.from('food-images').getPublicUrl(clean);
  return data?.publicUrl || null;
}

/**
 * Convert a local program image path (e.g. "/programs/starting-strength.jpg")
 * to its Supabase Storage public URL.
 * The bucket is "program-images" and files are stored at the root (e.g. "starting-strength.jpg"),
 * so we strip the "programs/" prefix from the path.
 */
export function programImageUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  let clean = path.startsWith('/') ? path.slice(1) : path;
  // Strip "programs/" prefix — files in the bucket are at the root level
  clean = clean.replace(/^programs\//, '');
  const { data } = supabase.storage.from('program-images').getPublicUrl(clean);
  return data?.publicUrl || null;
}

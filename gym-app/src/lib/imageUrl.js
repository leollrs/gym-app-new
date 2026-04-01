// Resolves food/meal image paths to Supabase Storage public URLs.
// Uses the same pattern as exercise videos: supabase.storage.from().getPublicUrl()
import { supabase } from './supabase';

/**
 * Convert a local image path (e.g. "/foods/chicken_breast.jpg") to its
 * Supabase Storage public URL. Already-absolute URLs are returned as-is.
 * Handles .png → .jpg extension correction (all images were re-exported as JPG).
 */
export function foodImageUrl(path) {
  if (!path) return null;
  // Already a full URL — leave untouched
  if (path.startsWith('http')) return path;
  // Strip leading slash: "/foods/xxx.jpg" → "foods/xxx.jpg"
  let clean = path.startsWith('/') ? path.slice(1) : path;
  // All images are now .jpg — correct any .png references
  clean = clean.replace(/\.png$/i, '.jpg');
  const { data } = supabase.storage.from('food-images').getPublicUrl(clean);
  return data?.publicUrl || null;
}

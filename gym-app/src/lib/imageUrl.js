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
  if (path.startsWith('http')) return path;
  let clean = path.startsWith('/') ? path.slice(1) : path;
  clean = clean.replace(/\.png$/i, '.jpg');
  const { data } = supabase.storage.from('food-images').getPublicUrl(clean);
  return data?.publicUrl || null;
}

/**
 * Convert a local program image path (e.g. "/programs/starting-strength.jpg")
 * to its Supabase Storage public URL.
 */
export function programImageUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  let clean = path.startsWith('/') ? path.slice(1) : path;
  const { data } = supabase.storage.from('program-images').getPublicUrl(clean);
  return data?.publicUrl || null;
}

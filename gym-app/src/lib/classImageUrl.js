import { supabase } from './supabase';

export function classImageUrl(path) {
  if (!path) return null;
  // Already a usable src: an absolute URL, a local object URL from
  // URL.createObjectURL (the admin form's "just picked this file" preview), or
  // an inline data URI. Feeding any of these to getPublicUrl would produce
  // `.../object/public/class-images/blob:http://...` — a guaranteed 400.
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  // Legacy rows (gym_classes.image_url) stored the path WITH the bucket prefix.
  // getPublicUrl prepends the bucket itself, so those produced
  // `.../object/public/class-images/class-images/<gym>/<ts>.jpg` → 400. Strip it.
  const key = path.replace(/^class-images\//, '');
  const { data } = supabase.storage.from('class-images').getPublicUrl(key);
  return data?.publicUrl || null;
}

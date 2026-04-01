import { supabase } from './supabase';

export function classImageUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const { data } = supabase.storage.from('class-images').getPublicUrl(path);
  return data?.publicUrl || null;
}

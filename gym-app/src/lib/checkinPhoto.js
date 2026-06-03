/**
 * Staff check-in reference photos — private storage helpers.
 *
 * A photo OF a member/trainer that staff attach so the front desk can verify
 * identity at check-in. Stored in the PRIVATE `member-checkin-photos` bucket;
 * read access is gated by RLS to admins-of-gym and trainers-of-client, so URLs
 * must be signed. The profile pointer (profiles.checkin_photo_path) is written
 * through the set_checkin_photo SECURITY DEFINER RPC (migration 0454), because
 * trainers can't UPDATE arbitrary client profiles directly.
 *
 * Members can neither see nor set this — it is purely a staff tool.
 */
import { supabase } from './supabase';
import logger from './logger';
import { validateImageFile } from './validateImage';
import { stripExif } from './stripExif';

export const CHECKIN_BUCKET = 'member-checkin-photos';
const SIGNED_TTL = 60 * 60; // 1 hour

/** Sign one private check-in photo path → a temporary URL (or null). */
export async function signCheckinPhoto(path, ttl = SIGNED_TTL) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(CHECKIN_BUCKET).createSignedUrl(path, ttl);
  if (error) {
    logger.warn('signCheckinPhoto failed:', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

/** Batch-sign many paths → Map<path, url>. Falsy/duplicate paths are skipped. */
export async function signCheckinPhotos(paths, ttl = SIGNED_TTL) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const out = new Map();
  if (unique.length === 0) return out;
  const { data, error } = await supabase.storage.from(CHECKIN_BUCKET).createSignedUrls(unique, ttl);
  if (error) {
    logger.warn('signCheckinPhotos failed:', error.message);
    return out;
  }
  (data || []).forEach((row) => {
    if (row?.signedUrl && !row.error && row.path) out.set(row.path, row.signedUrl);
  });
  return out;
}

/**
 * Validate → strip EXIF → upload a new check-in photo for a subject.
 * Returns the stored object path. Best-effort deletes the previous object so
 * the private bucket doesn't accumulate orphans. Does NOT persist the pointer
 * — pair with persistCheckinPhoto().
 */
export async function uploadCheckinPhoto({ subjectId, file, previousPath = null }) {
  if (!subjectId || !file) throw new Error('Missing subject or file');

  // Re-encode FIRST to a clean, downscaled JPEG (strips EXIF/GPS, and transcodes
  // HEIC→JPEG via createImageBitmap). iPhone camera files are HEIC, which the
  // magic-byte validator rejects — so we must normalize before validating, not
  // after. A face for ID recognition needs no more than ~1024px.
  const clean = await stripExif(file, { maxDimension: 1024, quality: 0.85 });

  const check = await validateImageFile(clean, { maxSizeMB: 8 });
  if (!check.valid) throw new Error(check.error || 'Invalid image');

  const path = `${subjectId}/${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(CHECKIN_BUCKET)
    .upload(path, clean, { contentType: 'image/jpeg', upsert: true });
  if (upErr) throw upErr;

  if (previousPath && previousPath !== path) {
    // Best-effort: drop the old object on replace so the private bucket doesn't
    // accumulate orphans. Log (don't throw) so a failed cleanup is visible.
    supabase.storage.from(CHECKIN_BUCKET).remove([previousPath])
      .then(({ error }) => { if (error) logger.warn('checkin previous-photo delete failed:', error.message); })
      .catch((e) => logger.warn('checkin previous-photo delete error:', e?.message));
  }
  return path;
}

/** Persist (or clear, when path=null) the pointer on the subject's profile. */
export async function persistCheckinPhoto(subjectId, path) {
  const { error } = await supabase.rpc('set_checkin_photo', { p_member_id: subjectId, p_path: path });
  if (error) throw error;
}

/** Clear the photo: drop the profile pointer + best-effort delete the object. */
export async function removeCheckinPhoto(subjectId, path) {
  await persistCheckinPhoto(subjectId, null);
  if (path) {
    supabase.storage.from(CHECKIN_BUCKET).remove([path])
      .then(({ error }) => { if (error) logger.warn('checkin photo delete failed:', error.message); })
      .catch((e) => logger.warn('checkin photo delete error:', e?.message));
  }
}

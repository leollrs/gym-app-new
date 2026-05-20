/*
 * Pure helpers for the AdminProfile page: pill-class lookup tables for role
 * and audit-action badges, plus a client-side avatar compressor that produces
 * a JPEG blob suitable for upload to the `profile-photos` storage bucket.
 */

export const ROLE_PILL_CLASS = {
  super_admin: 'admin-pill admin-pill--warn',
  admin:       'admin-pill admin-pill--info',
  trainer:     'admin-pill admin-pill--good',
};

export const ACTION_PILL_CLASS = {
  member_invited:          'admin-pill admin-pill--info',
  member_deleted:          'admin-pill admin-pill--hot',
  role_changed:            'admin-pill admin-pill--warn',
  setting_updated:         'admin-pill admin-pill--warn',
  challenge_created:       'admin-pill admin-pill--good',
  announcement_published:  'admin-pill admin-pill--good',
  class_created:           'admin-pill admin-pill--info',
  program_created:         'admin-pill admin-pill--good',
  store_item_created:      'admin-pill admin-pill--coach',
  trainer_added:           'admin-pill admin-pill--info',
  trainer_demoted:         'admin-pill admin-pill--hot',
  moderation_action:       'admin-pill admin-pill--hot',
};

// ── Compress avatar image ────────────────────────────────────────────────────
export async function compressAvatar(file, maxSize = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height); height = maxSize;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('compress failed')), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

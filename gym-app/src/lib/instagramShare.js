// Direct deep-link share to Instagram Stories.
//
// The native iOS share sheet takes the user 3 taps to land in IG Stories
// ("pick IG → 'Add to story' → confirm"). Instagram's documented
// `instagram-stories://` URL scheme jumps straight into the Stories composer
// with our image pre-loaded — one tap from our Share sheet.
//
// The image data is passed via UIPasteboard with specific keys (Instagram
// reads it from there, not from the URL). That requires native iOS code, so
// this module wraps the InstagramSharePlugin defined in
// ios/App/App/InstagramSharePlugin.swift.

import { Capacitor, registerPlugin } from '@capacitor/core';

// `jsName` on the native side is "InstagramShare" (see
// ios/App/App/InstagramSharePlugin.swift) — Capacitor v6 looks up the
// plugin by that string, NOT by the Swift class name. Mismatched names
// here would silently route every call to the rejection branch and
// drop us back to the native share sheet.
const InstagramSharePlugin = registerPlugin('InstagramShare');

// Convert a Blob to a base64 data URL — the format the native plugin expects
// (it strips the optional `data:image/png;base64,` prefix on its end).
async function blobToBase64DataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// `isAvailable` answers: "can we even attempt the deep link on this device?".
// Web + Android fall straight back to the native share sheet via shareBlob().
export async function isInstagramStoriesAvailable() {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    const res = await InstagramSharePlugin.isInstagramInstalled();
    return !!res?.installed;
  } catch {
    return false;
  }
}

/**
 * Share an image directly to the Instagram Stories composer.
 *
 * @param {object} opts
 * @param {Blob}   [opts.backgroundBlob]  Full-bleed background image (PNG/JPEG).
 * @param {Blob}   [opts.stickerBlob]     Transparent sticker image to overlay
 *                                        on the user's photo (Strava-style).
 * @param {string} [opts.backgroundTopColor]    Gradient top (used when there's
 *                                              no background image — IG fills
 *                                              the page with this gradient).
 * @param {string} [opts.backgroundBottomColor] Gradient bottom.
 * @param {string} [opts.contentURL]      Deep-link attribution URL.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function shareToInstagramStory({
  backgroundBlob,
  stickerBlob,
  backgroundTopColor,
  backgroundBottomColor,
  contentURL,
} = {}) {
  if (Capacitor.getPlatform() !== 'ios') return { ok: false, reason: 'not-ios' };
  if (!backgroundBlob && !stickerBlob) return { ok: false, reason: 'no-image' };

  try {
    const [backgroundImage, stickerImage] = await Promise.all([
      backgroundBlob ? blobToBase64DataUrl(backgroundBlob) : Promise.resolve(undefined),
      stickerBlob ? blobToBase64DataUrl(stickerBlob) : Promise.resolve(undefined),
    ]);
    await InstagramSharePlugin.shareToStory({
      backgroundImage,
      stickerImage,
      backgroundTopColor,
      backgroundBottomColor,
      contentURL,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unknown' };
  }
}

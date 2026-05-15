// Direct-share endpoints for Messages, WhatsApp, and Instagram Feed.
//
// Bridges to the native SocialSharePlugin (iOS). Each method skips the
// generic iOS share sheet and lands the user one tap closer to the
// destination they actually picked:
//
//   shareToMessages     → MFMessageComposeViewController (in-app iMessage
//                         composer; image attached, body pre-filled).
//   shareToWhatsApp     → UIDocumentInteractionController with the
//                         `net.whatsapp.image` UTI (jumps into WhatsApp
//                         at the contact picker with the image attached).
//   shareToInstagramFeed → save image to Photos library + open
//                          `instagram://library?LocalIdentifier=<id>`
//                          (lands inside IG with our image preselected).
//
// IG Stories has its own module (`lib/instagramShare.js`) because the
// background/sticker pasteboard flow is different enough to warrant a
// separate native plugin.

import { Capacitor, registerPlugin } from '@capacitor/core';

// `jsName` on the native side is "SocialShare" (see
// ios/App/App/SocialSharePlugin.swift) — Capacitor v6 looks plugins up
// by that string, NOT by the Swift class name.
const SocialSharePlugin = registerPlugin('SocialShare');

async function blobToBase64DataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Capability probes. All three return false off-iOS so the calling code
// can transparently fall back to the generic share sheet on web/Android.
export async function canShareViaMessages() {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    const res = await SocialSharePlugin.canShareViaMessages();
    return !!res?.installed;
  } catch {
    return false;
  }
}

export async function isWhatsAppInstalled() {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    const res = await SocialSharePlugin.isWhatsAppInstalled();
    return !!res?.installed;
  } catch {
    return false;
  }
}

export async function isInstagramInstalled() {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    const res = await SocialSharePlugin.isInstagramInstalled();
    return !!res?.installed;
  } catch {
    return false;
  }
}

/**
 * Open the iMessage composer with image + body pre-filled.
 * @param {Blob}   opts.blob  image to attach (required)
 * @param {string} opts.text  message body
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function shareToMessages({ blob, text = '' } = {}) {
  if (Capacitor.getPlatform() !== 'ios') return { ok: false, reason: 'not-ios' };
  if (!blob) return { ok: false, reason: 'no-image' };
  try {
    const image = await blobToBase64DataUrl(blob);
    await SocialSharePlugin.shareToMessages({ image, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unknown' };
  }
}

/**
 * Open WhatsApp's "Open in WhatsApp" sheet with image attached.
 * @param {Blob}   opts.blob  image to attach
 * @param {string} opts.text  caption (also copied to clipboard as fallback)
 */
export async function shareToWhatsApp({ blob, text = '' } = {}) {
  if (Capacitor.getPlatform() !== 'ios') return { ok: false, reason: 'not-ios' };
  if (!blob) return { ok: false, reason: 'no-image' };
  try {
    const image = await blobToBase64DataUrl(blob);
    await SocialSharePlugin.shareToWhatsApp({ image, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unknown' };
  }
}

/**
 * Save image to Photos and open Instagram at the picker, with our image
 * pre-selected. Falls back to opening IG without the asset if the user
 * declines Photos permission.
 */
export async function shareToInstagramFeed({ blob } = {}) {
  if (Capacitor.getPlatform() !== 'ios') return { ok: false, reason: 'not-ios' };
  if (!blob) return { ok: false, reason: 'no-image' };
  try {
    const image = await blobToBase64DataUrl(blob);
    const res = await SocialSharePlugin.shareToInstagramFeed({ image });
    return { ok: true, openedWithAsset: !!res?.openedWithAsset };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unknown' };
  }
}

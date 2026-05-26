// WhatsApp deep-link helper.
// Builds a wa.me link (the universal entry point WhatsApp recommends) and opens
// it. On native we go through @capacitor/browser (SFSafariViewController), which
// hands off to the WhatsApp app; on web it opens a new tab. PR/US numbers are
// the common case here, so a bare 10-digit number is assumed +1.

// Normalize a stored phone number to digits-only with a country code.
// Returns null when there aren't enough digits to dial.
export function normalizePhone(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  // Bare 10-digit number with no country code → assume US/PR (+1).
  if (!hadPlus && digits.length === 10) digits = `1${digits}`;
  // 11 digits starting with 1 is already a US/PR number.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function hasWhatsApp(rawPhone) {
  return !!normalizePhone(rawPhone);
}

// Build the https://wa.me/<number>?text=<msg> URL, or null if the number is unusable.
export function whatsappUrl(rawPhone, message) {
  const digits = normalizePhone(rawPhone);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

// Open WhatsApp to this number with an optional prefilled message.
// Mirrors the openExternalUrl pattern used elsewhere (QRCodeModal, Referrals).
// Returns true if a link was opened.
export async function openWhatsApp(rawPhone, message) {
  const url = whatsappUrl(rawPhone, message);
  if (!url) return false;
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* opener blocked */ }
  }
  return true;
}

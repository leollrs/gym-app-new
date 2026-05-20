/**
 * Scan Router — shared payload parsing for both camera and physical scanners.
 * Extracted from QRScannerModal.jsx so both input methods use the same pipeline.
 */
import { verifyQRPayload } from './qrSecurity';

/**
 * Verify signature (if present) and parse the scanned text into a typed action.
 * @param {string} rawText - Raw scanned text
 * @param {(err: string) => void} setError - Error callback
 * @returns {{ type: string, [key: string]: any } | null} Parsed result or null
 */
export async function handleScannedValue(rawText, setError) {
  if (!rawText || typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();

  // JSON payloads (password_reset) are not signed
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (json.type === 'password_reset' && json.request_id && json.token) {
        return { type: 'password_reset', request_id: json.request_id, token: json.token };
      }
    } catch { /* fall through */ }
  }

  // Signed payloads: payload:timestamp|signature
  const lastPipe = trimmed.lastIndexOf('|');
  if (lastPipe !== -1) {
    const { valid, payload } = await verifyQRPayload(trimmed);
    if (!valid) {
      setError?.('QR code signature invalid or expired. Ask member to refresh their QR.');
      return null;
    }
    // Strip the :timestamp suffix from verified payload
    const withoutTimestamp = payload?.replace(/:\d+$/, '') || '';
    const parsed = parseQRContent(withoutTimestamp);
    if (parsed) return parsed;
  }

  // Reward QRs delivered via email are signed by the reward-qr edge function;
  // an unsigned `gym-reward:` payload almost always means signQRPayload failed
  // mid-render. Keep the strict rejection so we don't claim against a forged ID.
  if (trimmed.startsWith('gym-reward:') && !trimmed.includes('|')) {
    setError?.('Invalid QR — please refresh in the app');
    return null;
  }

  // Wallet passes (Apple Wallet / Google Wallet) bake an UNSIGNED `gym-purchase:`
  // barcode at install time and can't re-sign — the pass is static. Previously
  // we rejected unsigned `gym-purchase:` payloads for safety, but that broke
  // every wallet-pass punch scan in production. Forging is bounded: the
  // `record_gym_purchase` RPC requires admin auth, so an attacker would
  // already need to be an admin (who could just add a punch directly).
  // → Allow unsigned `gym-purchase:` and let the handler validate.

  // Unsigned / legacy fallback — try parsing directly (covers gym-purchase: too)
  const parsed = parseQRContent(trimmed);
  if (parsed) return parsed;

  return null;
}

/**
 * Parse a QR/barcode payload into a typed action object.
 * Supports all scan action types.
 */
export function parseQRContent(text) {
  if (!text || typeof text !== 'string') return null;

  // Purchase: gym-purchase:{gymId}:{memberId}:{productId}
  if (text.startsWith('gym-purchase:')) {
    const parts = text.split(':');
    if (parts.length >= 4 && parts[1] && parts[2] && parts[3]) {
      return { type: 'purchase', gymId: parts[1], memberId: parts[2], productId: parts[3] };
    }
    return null;
  }

  // Reward redemption: gym-reward:{gymId}:{memberId}:{redemptionId}
  if (text.startsWith('gym-reward:')) {
    const parts = text.split(':');
    if (parts.length >= 4 && parts[1] && parts[2] && parts[3]) {
      return { type: 'reward_redemption', gymId: parts[1], memberId: parts[2], redemptionId: parts[3] };
    }
    return null;
  }

  // Earned reward (birthday/milestone/manual): earned-reward:{qrCode}
  if (text.startsWith('earned-reward:')) {
    const code = text.substring('earned-reward:'.length);
    if (code && code.length >= 6) {
      return { type: 'earned_reward', qrCode: code };
    }
    return null;
  }

  // Referral: gym-referral:{gymId}:{referrerId}:{referralCode}
  if (text.startsWith('gym-referral:')) {
    const parts = text.split(':');
    if (parts.length >= 4 && parts[1] && parts[2] && parts[3]) {
      return { type: 'referral', gymId: parts[1], referrerId: parts[2], referralCode: parts[3] };
    }
    return null;
  }

  // Win-back voucher: gym-voucher:{code}
  if (text.startsWith('gym-voucher:')) {
    const code = text.substring('gym-voucher:'.length);
    if (code.length >= 6) {
      return { type: 'voucher', voucherCode: code };
    }
    return null;
  }

  // Default: check-in (member QR payload — typically 8-char UUID prefix)
  if (text.length > 0) {
    return { type: 'checkin', qrPayload: text };
  }

  return null;
}

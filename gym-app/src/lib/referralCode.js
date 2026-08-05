// referralCode.js
// One formatter for the referral-code inputs (member Signup, member Onboarding,
// admin Add Member). It was copy-pasted into two of them and absent from the
// third, which is how the bug below survived.
//
// THE SHAPE: `generate_referral_code` (migration 0653:148) builds
// `REF-<GYM4>-<8 hex>` — a 3-char prefix, up to 4 characters derived from the
// gym name, and 8 hex characters. That is **15 alphanumerics**, 17 with dashes.
//
// THE BUG THIS FIXES: both existing formatters capped the cleaned string at
// `.slice(0, 11)` — correct for the ORIGINAL 4-hex code, and silently wrong ever
// since 0653 widened it to 8. Typing or pasting a current code got it truncated
// to `REF-GYM4-XXXX` as you typed, and `lookup_referral_code` then reported a
// perfectly valid code as invalid, with the field showing something the member
// never typed. Only scanning the QR worked. 0653 deliberately left short legacy
// codes in circulation, so both lengths have to keep working.

const PREFIX_LEN = 3;   // "REF"
const GYM_LEN    = 4;   // gym-name derived
const CODE_LEN   = 8;   // hex — 4 on legacy codes, which just format shorter
export const REFERRAL_MAX_CHARS = PREFIX_LEN + GYM_LEN + CODE_LEN;   // 15

/**
 * Format free-typed or pasted input into `REF-XXXX-XXXXXXXX`, inserting the
 * dashes as the user types. Non-alphanumerics are dropped, so pasting an
 * already-dashed code is idempotent.
 */
export function formatReferralCode(raw) {
  const cleaned = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, REFERRAL_MAX_CHARS);
  if (cleaned.length <= PREFIX_LEN) return cleaned;
  if (cleaned.length <= PREFIX_LEN + GYM_LEN) {
    return `${cleaned.slice(0, PREFIX_LEN)}-${cleaned.slice(PREFIX_LEN)}`;
  }
  return `${cleaned.slice(0, PREFIX_LEN)}-${cleaned.slice(PREFIX_LEN, PREFIX_LEN + GYM_LEN)}-${cleaned.slice(PREFIX_LEN + GYM_LEN)}`;
}

/** Loose completeness check for enabling a lookup — the server is the authority. */
export function looksLikeReferralCode(value) {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
  // Legacy codes are 11 (4-hex), current ones 15 (8-hex).
  return cleaned.length >= 11 && cleaned.toUpperCase().startsWith('REF');
}

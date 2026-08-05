/**
 * Phone plausibility for admin-entered contact details.
 *
 * The app already defends email (validateEmail.js: format + a ~90-domain
 * disposable blocklist). Phone had nothing — `normalizePhone` in whatsapp.js
 * only counts digits, so `1111111111` and `787-555-0100` both sailed through
 * and landed in a prospect row nobody could ever call.
 *
 * These are STRUCTURAL rules from the North American Numbering Plan, not
 * guesses about what looks suspicious:
 *
 *   • An area code (NPA) and an exchange (NXX) must both start 2–9. That makes
 *     `1111111111` and `0000000000` impossible numbers, not merely odd ones.
 *   • N11 (211, 311, … 911) are service codes and are never assignable as area
 *     codes.
 *   • 555-0100 through 555-0199 are reserved for fiction — the block every
 *     movie uses, and the one a person invents on the spot.
 *
 * Everything here is US/PR/CA (+1) only, which is the market. A number with a
 * different country code is passed through as `unknown` rather than rejected:
 * we can't structurally validate the world, and refusing a real Dominican
 * number would be worse than accepting a bad one.
 */

// Puerto Rico's two area codes. Not used to reject — a gym here legitimately
// has clients with mainland numbers — but useful for a soft "are you sure".
export const PR_AREA_CODES = ['787', '939'];

/**
 * Reduce anything to digits, dropping a leading +1 / 1.
 * Returns null when there's nothing usable.
 */
export function toNanpDigits(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null; // not a NANP-shaped number
}

/**
 * @returns {{ ok: boolean, reason: string|null, digits: string|null, e164: string|null, isPR: boolean }}
 *
 * `reason` is a stable key the UI maps to copy — never a user-facing string,
 * so the two locales stay in the JSON where they belong.
 */
export function validatePhone(raw) {
  const out = { ok: false, reason: null, digits: null, e164: null, isPR: false };

  if (!raw || !String(raw).trim()) {
    return { ...out, reason: 'empty' };
  }

  const trimmed = String(raw).trim();
  const allDigits = trimmed.replace(/\D/g, '');

  // A non-+1 international number: we can't structurally check it, and
  // rejecting a real foreign number is the worse error. Accept, flag as
  // unknown-quality rather than validated.
  const hasIntlPrefix = trimmed.startsWith('+') && !trimmed.startsWith('+1');
  if (hasIntlPrefix) {
    if (allDigits.length < 8 || allDigits.length > 15) return { ...out, reason: 'length' };
    return { ok: true, reason: 'unverifiable_intl', digits: allDigits, e164: `+${allDigits}`, isPR: false };
  }

  const digits = toNanpDigits(trimmed);
  if (!digits) return { ...out, reason: 'length' };

  const npa = digits.slice(0, 3);
  const nxx = digits.slice(3, 6);
  const line = digits.slice(6);

  // NPA and NXX must both start 2–9.
  if (npa[0] === '0' || npa[0] === '1') return { ...out, reason: 'bad_area_code' };
  if (nxx[0] === '0' || nxx[0] === '1') return { ...out, reason: 'bad_exchange' };

  // N11 service codes are never area codes.
  if (npa[1] === '1' && npa[2] === '1') return { ...out, reason: 'bad_area_code' };

  // The fiction block. 555-0100…555-0199 only — other 555 exchanges do get
  // assigned, so blanket-rejecting 555 would be wrong.
  if (nxx === '555' && line >= '0100' && line <= '0199') {
    return { ...out, reason: 'fictional' };
  }

  // Every digit the same: structurally impossible anyway (fails the NPA rule
  // for 0s and 1s), but 2222222222 passes the rules above and is obviously not
  // a phone number.
  if (/^(\d)\1{9}$/.test(digits)) return { ...out, reason: 'repeated' };

  // Straight run up or down — 2345678901 / 9876543210.
  if (isSequential(digits)) return { ...out, reason: 'sequential' };

  return {
    ok: true,
    reason: null,
    digits,
    e164: `+1${digits}`,
    isPR: PR_AREA_CODES.includes(npa),
  };
}

/**
 * Straight keypad runs, counted modulo 10 so a wrap is still a run.
 *
 * Strict arithmetic misses the common case: 2345678901 rolls 9→0 in the middle,
 * so a plain `next - prev === 1` check lets it through — and that is precisely
 * the number someone types when they're making one up.
 *
 * Only 20 ten-digit numbers are runs at all (ten ascending, ten descending),
 * so the false-positive cost of rejecting them is nil.
 */
function isSequential(digits) {
  let up = true;
  let down = true;
  for (let i = 1; i < digits.length; i++) {
    const prev = Number(digits[i - 1]);
    const next = Number(digits[i]);
    if ((next - prev + 10) % 10 !== 1) up = false;
    if ((prev - next + 10) % 10 !== 1) down = false;
  }
  return up || down;
}

/**
 * Same digits, ignoring formatting — for spotting that the number typed at the
 * desk already belongs to a member or an existing prospect. Comparing the raw
 * strings would miss "(787) 414-4239" vs "+17874144239".
 */
export function samePhone(a, b) {
  const da = toNanpDigits(a) ?? String(a ?? '').replace(/\D/g, '');
  const db = toNanpDigits(b) ?? String(b ?? '').replace(/\D/g, '');
  return !!da && da === db;
}

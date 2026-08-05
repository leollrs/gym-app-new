import { describe, it, expect } from 'vitest';
import { formatReferralCode, looksLikeReferralCode, REFERRAL_MAX_CHARS } from '../referralCode';

describe('formatReferralCode', () => {
  it('inserts the dashes as you type', () => {
    expect(formatReferralCode('R')).toBe('R');
    expect(formatReferralCode('REF')).toBe('REF');
    expect(formatReferralCode('REFG')).toBe('REF-G');
    expect(formatReferralCode('REFGOLD')).toBe('REF-GOLD');
    expect(formatReferralCode('REFGOLDA')).toBe('REF-GOLD-A');
  });

  // The regression. generate_referral_code (0653) emits 8 hex chars; both
  // existing formatters capped the cleaned string at 11, so every code minted
  // since then was silently cut down to REF-GYM4-XXXX as the user typed and
  // came back "invalid".
  it('keeps all 8 hex characters of a current code', () => {
    expect(REFERRAL_MAX_CHARS).toBe(15);
    expect(formatReferralCode('REFGOLD1A2B3C4D')).toBe('REF-GOLD-1A2B3C4D');
    expect(formatReferralCode('REF-GOLD-1A2B3C4D')).toBe('REF-GOLD-1A2B3C4D');
  });

  it('still formats a legacy 4-hex code', () => {
    expect(formatReferralCode('REFGOLD1A2B')).toBe('REF-GOLD-1A2B');
    expect(formatReferralCode('REF-GOLD-1A2B')).toBe('REF-GOLD-1A2B');
  });

  it('is idempotent, so re-rendering the formatted value never mangles it', () => {
    const once = formatReferralCode('ref gold 1a2b3c4d');
    expect(formatReferralCode(once)).toBe(once);
    expect(once).toBe('REF-GOLD-1A2B3C4D');
  });

  it('drops junk and uppercases', () => {
    expect(formatReferralCode('  ref_gold/1a2b3c4d  ')).toBe('REF-GOLD-1A2B3C4D');
    expect(formatReferralCode(null)).toBe('');
    expect(formatReferralCode(undefined)).toBe('');
  });

  it('caps at the full code length instead of accepting endless input', () => {
    expect(formatReferralCode('REFGOLD1A2B3C4DEXTRAJUNK')).toBe('REF-GOLD-1A2B3C4D');
  });
});

describe('looksLikeReferralCode', () => {
  it('accepts both live lengths and rejects partials', () => {
    expect(looksLikeReferralCode('REF-GOLD-1A2B3C4D')).toBe(true);
    expect(looksLikeReferralCode('REF-GOLD-1A2B')).toBe(true);
    expect(looksLikeReferralCode('REF-GOLD')).toBe(false);
    expect(looksLikeReferralCode('')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { validatePhone, toNanpDigits, samePhone } from '../admin/phoneValidation';

const reason = (raw) => validatePhone(raw).reason;
const ok = (raw) => validatePhone(raw).ok;

describe('validatePhone — real numbers pass in every format the desk types', () => {
  it.each([
    '7874144239',
    '(787) 414-4239',
    '787-414-4239',
    '+1 787 414 4239',
    '1 787 414 4239',
    ' 787.414.4239 ',
  ])('accepts %s', (raw) => {
    const r = validatePhone(raw);
    expect(r.ok).toBe(true);
    expect(r.digits).toBe('7874144239');
    expect(r.e164).toBe('+17874144239');
  });

  it('flags Puerto Rico area codes without making them a requirement', () => {
    expect(validatePhone('7874144239').isPR).toBe(true);
    expect(validatePhone('9395551234').isPR).toBe(true);
    // A mainland number is still perfectly valid — gyms here have those clients.
    const mainland = validatePhone('3055551234');
    expect(mainland.ok).toBe(true);
    expect(mainland.isPR).toBe(false);
  });
});

// These are NANP structural rules, not heuristics: an area code or exchange
// starting 0/1 cannot exist, so these aren't "suspicious" — they're impossible.
describe('validatePhone — structurally impossible numbers', () => {
  it('rejects an area code starting 0 or 1', () => {
    expect(reason('1111111111')).toBe('bad_area_code');
    expect(reason('0005551234')).toBe('bad_area_code');
  });

  it('rejects N11 service codes as area codes', () => {
    expect(reason('9115551234')).toBe('bad_area_code');
    expect(reason('4115551234')).toBe('bad_area_code');
  });

  it('rejects an exchange starting 0 or 1', () => {
    expect(reason('7871234567')).toBe('bad_exchange');
    expect(reason('7870234567')).toBe('bad_exchange');
  });
});

describe('validatePhone — the numbers people invent on the spot', () => {
  it('rejects the 555-01XX fiction block', () => {
    expect(reason('7875550100')).toBe('fictional');
    expect(reason('7875550142')).toBe('fictional');
    expect(reason('7875550199')).toBe('fictional');
  });

  // Blanket-rejecting 555 would be wrong — other 555 exchanges are assigned.
  it('does NOT reject 555 numbers outside the reserved block', () => {
    expect(ok('7875551234')).toBe(true);
    expect(ok('7875550200')).toBe(true);
    expect(ok('7875550099')).toBe(true);
  });

  it('rejects all-same and straight runs', () => {
    expect(reason('2222222222')).toBe('repeated');
    expect(reason('2345678901')).toBe('sequential');
    expect(reason('9876543210')).toBe('sequential');
  });
});

describe('validatePhone — length and emptiness', () => {
  it('rejects too short and too long', () => {
    expect(reason('78741442')).toBe('length');
    expect(reason('787414423900')).toBe('length');
  });

  it('reports empty separately so the UI can stay quiet until they type', () => {
    expect(reason('')).toBe('empty');
    expect(reason('   ')).toBe('empty');
    expect(reason(null)).toBe('empty');
    expect(reason(undefined)).toBe('empty');
  });
});

// Refusing a real Dominican or Spanish number would be a worse failure than
// letting a bad one through, so non-+1 passes with an honest label.
describe('validatePhone — international', () => {
  it('accepts a plausible non-+1 number as unverifiable rather than rejecting it', () => {
    const r = validatePhone('+34 600 123 456');
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('unverifiable_intl');
    expect(r.e164).toBe('+34600123456');
  });

  it('still enforces a sane length on international input', () => {
    expect(reason('+34 60')).toBe('length');
  });
});

describe('toNanpDigits', () => {
  it('strips the country code and formatting', () => {
    expect(toNanpDigits('+1 (787) 414-4239')).toBe('7874144239');
    expect(toNanpDigits('17874144239')).toBe('7874144239');
    expect(toNanpDigits('7874144239')).toBe('7874144239');
  });

  it('returns null for anything not NANP-shaped', () => {
    expect(toNanpDigits('123')).toBeNull();
    expect(toNanpDigits('')).toBeNull();
    expect(toNanpDigits(null)).toBeNull();
  });
});

// The duplicate check is only useful if it sees through formatting — the desk
// types "(787) 414-4239" and the member row holds "+17874144239".
describe('samePhone', () => {
  it('matches across formats', () => {
    expect(samePhone('(787) 414-4239', '+17874144239')).toBe(true);
    expect(samePhone('787-414-4239', '7874144239')).toBe(true);
  });

  it('does not match different numbers, or nothing at all', () => {
    expect(samePhone('7874144239', '7874144230')).toBe(false);
    expect(samePhone('', '7874144239')).toBe(false);
    expect(samePhone(null, null)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  normalizeHandle, instagramUrl, facebookUrl, whatsappUrl,
} from '../socialHandles';

describe('normalizeHandle', () => {
  it('accepts a bare handle', () => {
    expect(normalizeHandle('coachluis')).toBe('coachluis');
  });

  it('strips a leading @ (including repeats)', () => {
    expect(normalizeHandle('@coachluis')).toBe('coachluis');
    expect(normalizeHandle('@@coachluis')).toBe('coachluis');
  });

  it('pulls the handle out of a pasted profile URL', () => {
    expect(normalizeHandle('https://www.instagram.com/coachluis/?hl=es')).toBe('coachluis');
    expect(normalizeHandle('instagram.com/coach.luis')).toBe('coach.luis');
    expect(normalizeHandle('https://m.facebook.com/GymPR', 'facebook')).toBe('GymPR');
  });

  it('keeps the numeric id from a facebook profile.php link', () => {
    expect(normalizeHandle('https://facebook.com/profile.php?id=100001234567890', 'facebook'))
      .toBe('100001234567890');
  });

  // Facebook serves several profile shapes and the prefix is part of the
  // address — dropping it links to facebook.com/p, which is nobody.
  it('keeps the facebook /p/ prefix', () => {
    expect(facebookUrl('https://www.facebook.com/p/Leonel-Llorens-61590619448098/'))
      .toBe('https://facebook.com/p/Leonel-Llorens-61590619448098');
  });

  it('keeps /pages/ and /people/ with their id segment', () => {
    expect(facebookUrl('https://www.facebook.com/pages/Gym-PR/123456789'))
      .toBe('https://facebook.com/pages/Gym-PR/123456789');
    expect(facebookUrl('https://www.facebook.com/people/Leo/61590619448098/'))
      .toBe('https://facebook.com/people/Leo/61590619448098');
    expect(facebookUrl('facebook.com/groups/tugympr'))
      .toBe('https://facebook.com/groups/tugympr');
  });

  it('still handles a plain facebook vanity url', () => {
    expect(facebookUrl('https://www.facebook.com/coachluis'))
      .toBe('https://facebook.com/coachluis');
  });

  it('accepts a prefixed path typed without the host', () => {
    expect(normalizeHandle('p/Leonel-Llorens-61590619448098', 'facebook'))
      .toBe('p/Leonel-Llorens-61590619448098');
  });

  it('rejects an instagram post or reel link — that is not a profile', () => {
    expect(instagramUrl('https://instagram.com/p/DAbC123/')).toBeNull();
    expect(instagramUrl('https://www.instagram.com/reel/DAbC123/')).toBeNull();
  });

  it('pulls the username out of an instagram story link', () => {
    expect(instagramUrl('https://instagram.com/stories/coachluis/1234'))
      .toBe('https://instagram.com/coachluis');
  });

  it('does not mistake a bare word for a content path', () => {
    // Someone whose handle really is "reel" typed it by hand — no slash, so
    // it's a handle, not a URL path.
    expect(normalizeHandle('reel')).toBe('reel');
  });

  it('keeps hyphens for facebook page slugs but not for instagram', () => {
    expect(normalizeHandle('Gym-PR-123', 'facebook')).toBe('Gym-PR-123');
    expect(normalizeHandle('gym-pr', 'instagram')).toBe('gympr');
  });

  it('returns null for empty-ish input', () => {
    expect(normalizeHandle('')).toBeNull();
    expect(normalizeHandle('   ')).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
    expect(normalizeHandle(undefined)).toBeNull();
    expect(normalizeHandle('@')).toBeNull();
  });

  it('caps length per network', () => {
    expect(normalizeHandle('a'.repeat(200), 'instagram')).toHaveLength(30);
    expect(normalizeHandle('a'.repeat(200), 'facebook')).toHaveLength(100);
  });
});

// The whole point of the whitelist: a hostile value can never become a
// working href to somewhere else.
describe('normalizeHandle — injection', () => {
  it('cannot produce a javascript: url', () => {
    expect(instagramUrl('javascript:alert(1)')).toBe('https://instagram.com/javascriptalert1');
  });

  it('cannot escape the path with a slash', () => {
    expect(instagramUrl('coach/../../evil')).toBe('https://instagram.com/coach');
    expect(instagramUrl('//evil.com')).toBe('https://instagram.com/evil.com');
  });

  it('drops a query string that would retarget the link', () => {
    expect(facebookUrl('coach?next=https://evil.com')).toBe('https://facebook.com/coach');
  });

  it('never emits a colon, question mark or angle bracket', () => {
    expect(normalizeHandle('a:b<c>d"e\'f g')).toBe('abcdefg');
  });

  it('rejects a prefixed path whose segments are all dots', () => {
    // p/../.. → both segments after the prefix clean to nothing, leaving no
    // profile to link to. Null, not `facebook.com/p/../..`.
    expect(facebookUrl('facebook.com/p/../../evil')).toBeNull();
    expect(facebookUrl('facebook.com/p/Real-Name-123/..'))
      .toBe('https://facebook.com/p/Real-Name-123');
  });

  // The property that actually matters: whatever goes in, the browser resolves
  // the result to the intended host.
  it('always resolves to instagram.com / facebook.com', () => {
    const hostile = [
      'javascript:alert(1)', '//evil.com', 'https://evil.com/coach',
      'coach/../../..', '\\\\evil.com', 'p/../../../evil', 'data:text/html,x',
      'coach?next=//evil.com', '@evil.com', 'https://facebook.com.evil.com/x',
    ];
    for (const h of hostile) {
      const ig = instagramUrl(h);
      const fb = facebookUrl(h);
      if (ig) expect(new URL(ig).host).toBe('instagram.com');
      if (fb) expect(new URL(fb).host).toBe('facebook.com');
    }
  });
});

// Contract with migration 0663. If these drift, saving a handle fails in
// production with a constraint violation and no obvious cause — so assert the
// client can never produce a value the database would reject.
describe('normalizeHandle ⇄ the 0663 CHECK constraints', () => {
  const DB_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
  const DB_FACEBOOK =
    /^(?:(?:p|pages|people|groups)\/[A-Za-z0-9.-]{1,80}(?:\/[A-Za-z0-9.-]{1,80})?|[A-Za-z0-9.-]{1,100})$/;

  const CORPUS = [
    'coachluis', '@coach.luis', 'Coach-Luis', 'reel', 'p', 'pages',
    'https://www.instagram.com/coachluis/?hl=es',
    'https://instagram.com/stories/coachluis/1234',
    'https://www.facebook.com/p/Leonel-Llorens-61590619448098/',
    'https://www.facebook.com/pages/Gym-PR/123456789',
    'https://www.facebook.com/people/Leo/61590619448098/',
    'https://facebook.com/profile.php?id=100001234567890',
    'facebook.com/groups/tugympr',
    'https://es-la.facebook.com/coachluis',
    // hostile / malformed
    'javascript:alert(1)', '//evil.com', 'https://evil.com/coach',
    'coach/../../..', 'p/../..', 'data:text/html,x', '@@@', '   ', '',
    'a'.repeat(300), `p/${'b'.repeat(300)}`, `pages/${'c'.repeat(200)}/${'9'.repeat(200)}`,
    'p/Name/', 'p//', 'coach?next=//evil.com', 'ñoño', '🏋️',
    // The id branch used to return before the length cap, so this produced a
    // value the DB CHECK rejects — and the corpus's short id hid it.
    `https://facebook.com/profile.php?id=${'9'.repeat(150)}`,
    // …and it wasn't anchored to a Facebook host, so this took the same branch.
    'https://evil.com/profile.php?id=123',
  ];

  it('every instagram result satisfies the instagram CHECK', () => {
    for (const input of CORPUS) {
      const out = normalizeHandle(input, 'instagram');
      if (out !== null) expect(out, `input: ${input}`).toMatch(DB_INSTAGRAM);
    }
  });

  it('every facebook result satisfies the facebook CHECK', () => {
    for (const input of CORPUS) {
      const out = normalizeHandle(input, 'facebook');
      if (out !== null) expect(out, `input: ${input}`).toMatch(DB_FACEBOOK);
    }
  });

  it('is idempotent — re-normalizing a stored value is a no-op', () => {
    for (const input of CORPUS) {
      for (const kind of ['instagram', 'facebook']) {
        const once = normalizeHandle(input, kind);
        expect(normalizeHandle(once, kind), `input: ${input} (${kind})`).toBe(once);
      }
    }
  });
});

describe('instagramUrl / facebookUrl', () => {
  it('build canonical profile urls', () => {
    expect(instagramUrl('@coach.luis')).toBe('https://instagram.com/coach.luis');
    expect(facebookUrl('Coach-Luis', 'facebook')).toBe('https://facebook.com/Coach-Luis');
  });

  it('return null when there is nothing to link to', () => {
    expect(instagramUrl('')).toBeNull();
    expect(instagramUrl(null)).toBeNull();
    expect(facebookUrl('@@@')).toBeNull();
  });
});

describe('whatsappUrl', () => {
  it('assumes +1 for a bare 10-digit local number', () => {
    expect(whatsappUrl('(787) 414-4239')).toBe('https://wa.me/17874144239');
  });

  it('keeps an already-international number', () => {
    expect(whatsappUrl('+1 787 414 4239')).toBe('https://wa.me/17874144239');
    expect(whatsappUrl('+34 600 123 456')).toBe('https://wa.me/34600123456');
  });

  it('encodes the prefill text', () => {
    expect(whatsappUrl('7874144239', 'Hola, ¿precio?'))
      .toBe('https://wa.me/17874144239?text=Hola%2C%20%C2%BFprecio%3F');
  });

  it('returns null when there is no usable number', () => {
    expect(whatsappUrl('')).toBeNull();
    expect(whatsappUrl(null)).toBeNull();
    expect(whatsappUrl('123')).toBeNull();
  });
});

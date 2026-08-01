/**
 * Trainer social handles → safe profile URLs.
 *
 * Trainers paste whatever the app gave them. That is NOT always a bare
 * username — Facebook in particular serves several profile shapes, and the
 * prefix is load-bearing:
 *
 *   facebook.com/coachluis                        → coachluis
 *   facebook.com/p/Leonel-Llorens-61590619448098/ → p/Leonel-Llorens-61590619448098
 *   facebook.com/pages/Gym-PR/123456789           → pages/Gym-PR/123456789
 *   facebook.com/people/Leo/61590619448098/       → people/Leo/61590619448098
 *   facebook.com/profile.php?id=1000012345        → 1000012345
 *
 * Dropping the `p/` there links to facebook.com/p, which is nobody.
 *
 * SECURITY: the stored value is interpolated into an `href`, so every segment
 * is reduced to a character whitelist and the only slashes that survive are
 * the ones joining a KNOWN prefix to its segments. A handle therefore can't
 * carry a scheme (`javascript:`), a host (`//evil.com`), or a query that
 * retargets the link. Dot segments can't escape either — `..` beyond the root
 * of a relative path is discarded, so the host always stays facebook.com /
 * instagram.com. Normalization runs on BOTH write and read, so a row written
 * before this file existed is still safe to render.
 */

// These mirror the CHECK constraints in migration 0663 exactly. A value this
// file produces that the constraint rejects becomes a save failure with no
// obvious cause, so socialHandles.test.js asserts the two stay in agreement.
const IG_MAX = 30;       // Instagram's own username cap
const FB_MAX = 100;      // whole value, e.g. pages/<name>/<numeric id>
const FB_SEG_MAX = 80;   // any one segment after the prefix

// Facebook path prefixes that are part of the profile's address.
const FB_PREFIXES = new Set(['p', 'pages', 'people', 'groups']);

// Instagram paths that are content, not a profile. Pasting a reel link into
// "your Instagram" is a mistake — better to reject it than to publish a
// button that lands on instagram.com/p.
const IG_NON_PROFILE = new Set(['p', 'reel', 'reels', 'tv', 'explore', 's', 'accounts', 'direct']);

const IG_HOST = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\//i;
const FB_HOST = /^(?:https?:\/\/)?(?:www\.|m\.|web\.|business\.|[a-z]{2}-[a-z]{2}\.)?(?:facebook\.com|fb\.com|fb\.me)\//i;

// A dot-only segment ('.', '..') is a path operation, never a name. It can't
// escape the host — `..` past the root is discarded — but it makes for an
// absurd stored value, so drop it here rather than publish `p/../..`.
const clean = (seg, allowed) => {
  const s = String(seg).replace(/^@+/, '').replace(allowed, '');
  return /^\.+$/.test(s) ? '' : s;
};

// Strip the origin (if a full URL was pasted), the query/fragment, and any
// leading or trailing slashes — leaving just the path segments.
function toSegments(raw, host) {
  const path = String(raw)
    .replace(host, '')
    .split(/[?#]/)[0]
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return path ? path.split('/').filter(Boolean) : [];
}

function normalizeInstagram(raw) {
  let segs = toSegments(raw, IG_HOST);
  if (!segs.length) return null;

  const first = segs[0].toLowerCase();
  // instagram.com/stories/<user>/<id> — the username is the SECOND segment.
  if (first === 'stories' && segs[1]) segs = [segs[1]];
  // Only reject on a real path (`instagram.com/reel/...`), never on a bare
  // word someone typed — that word is their handle.
  else if (segs.length > 1 && IG_NON_PROFILE.has(first)) return null;

  return clean(segs[0], /[^A-Za-z0-9._]/g).slice(0, IG_MAX) || null;
}

function normalizeFacebook(raw) {
  // profile.php?id=N — no vanity slug exists, the numeric id IS the handle.
  //
  // Anchored to a Facebook host, and capped. This branch returned BEFORE the
  // length cap, so an id longer than FB_MAX produced a value that 0663's CHECK
  // rejects — a 23514 on save with nothing shown to the trainer. The contract
  // test passed only because its corpus used a short id.
  const byId = String(raw).match(
    /^(?:https?:\/\/)?(?:www\.|m\.|web\.|business\.)?(?:facebook\.com|fb\.com|fb\.me)\/profile\.php\?id=(\d+)/i,
  );
  if (byId) return byId[1].slice(0, FB_MAX);

  const segs = toSegments(raw, FB_HOST);
  if (!segs.length) return null;

  const first = segs[0].toLowerCase();
  if (FB_PREFIXES.has(first) && segs.length > 1) {
    // Keep the prefix plus up to two segments (`pages/<name>/<id>`). The
    // prefix is taken from the fixed set above, never from user text, so the
    // surviving slashes can't be used to reach another host.
    const rest = segs.slice(1, 3)
      .map(s => clean(s, /[^A-Za-z0-9.-]/g).slice(0, FB_SEG_MAX))
      .filter(Boolean);
    if (!rest.length) return null;
    // Trailing slash stripped after the slice: a cut landing on the separator
    // would produce `pages/Name/` and fail the DB's CHECK.
    return [first, ...rest].join('/').slice(0, FB_MAX).replace(/\/+$/, '');
  }

  return clean(segs[0], /[^A-Za-z0-9.-]/g).slice(0, FB_MAX) || null;
}

export function normalizeHandle(raw, kind = 'instagram') {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return kind === 'facebook' ? normalizeFacebook(s) : normalizeInstagram(s);
}

export const instagramUrl = (handle) => {
  const h = normalizeHandle(handle, 'instagram');
  return h ? `https://instagram.com/${h}` : null;
};

export const facebookUrl = (handle) => {
  const h = normalizeHandle(handle, 'facebook');
  return h ? `https://facebook.com/${h}` : null;
};

/**
 * wa.me wants full international digits with no '+'. A bare 10-digit local
 * number is treated as US/PR (+1) — the gym market.
 */
export const whatsappUrl = (phone, text) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const intl = digits.length === 10 ? `1${digits}` : digits;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};

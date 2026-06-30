// Email validation — blocks fake/disposable emails without requiring confirmation
// Validates format, domain structure, and blocks known disposable providers

const ALLOWED_PROVIDERS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.es',
  // Yahoo
  'yahoo.com', 'yahoo.es', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Other major providers
  'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'mail.com',
  'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com', 'tuta.io',
  // Telecom / ISP
  'att.net', 'comcast.net', 'verizon.net', 'sbcglobal.net', 'cox.net',
  'charter.net', 'earthlink.net', 'optonline.net',
  // Regional
  'mail.ru', 'yandex.com', 'qq.com', '163.com', 'naver.com',
  'hanmail.net', 'daum.net', 'libero.it', 'virgilio.it',
  'web.de', 't-online.de', 'orange.fr', 'laposte.net',
  // Education (allow .edu domains)
  // Work domains (allow anything not in blocklist)
]);

const BLOCKED_DOMAINS = new Set([
  // Disposable / temporary email services
  'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'guerrillamail.net',
  'mailinator.com', 'yopmail.com', 'tempail.com', 'fakeinbox.com',
  'sharklasers.com', 'guerrillamailblock.com', 'grr.la', 'discard.email',
  'discardmail.com', 'trashmail.com', 'trashmail.me', 'trashmail.net',
  'maildrop.cc', 'mailnesia.com', 'mailcatch.com', 'temp-mail.org',
  'temp-mail.io', 'tempmailo.com', 'mohmal.com', 'getnada.com',
  'emailondeck.com', 'crazymailing.com', 'tmail.io', '10minutemail.com',
  '10minutemail.net', 'minutemail.com', 'tempinbox.com', 'bupmail.com',
  'mailtemp.org', 'tempmailaddress.com', 'burnermail.io', 'inboxbear.com',
  'spamgourmet.com', 'harakirimail.com', 'mailsac.com', 'mytemp.email',
  'disposableemailaddresses.emailmiser.com', 'jetable.org', 'trashinbox.com',
  // Catch-all fake domains
  'example.com', 'test.com', 'test.org', 'fake.com', 'noemail.com',
  'invalid.com', 'nowhere.com', 'nomail.com',
]);

const BLOCKED_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', // Free TLDs commonly used for spam
  '.xyz', '.top', '.click', '.link', '.buzz', '.rest',
  '.invalid', '.test', '.localhost', '.example',
]);

/**
 * Validates an email address for signup.
 * Returns { valid: true } or { valid: false, reason: string }
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'Email is required' };
  }

  const trimmed = email.trim().toLowerCase();

  // Basic format check
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, reason: 'Please enter a valid email address' };
  }

  const [localPart, domain] = trimmed.split('@');

  // Local part checks
  if (!localPart || localPart.length < 1) {
    return { valid: false, reason: 'Please enter a valid email address' };
  }
  if (localPart.length > 64) {
    return { valid: false, reason: 'Email username is too long' };
  }

  // Domain checks
  if (!domain || domain.length < 4) {
    return { valid: false, reason: 'Please enter a valid email domain' };
  }

  // Must have at least one dot in domain
  if (!domain.includes('.')) {
    return { valid: false, reason: 'Please enter a valid email domain' };
  }

  // TLD must be at least 2 chars
  const tld = domain.substring(domain.lastIndexOf('.'));
  if (tld.length < 3) {
    return { valid: false, reason: 'Please enter a valid email domain' };
  }

  // Block disposable TLDs
  if (BLOCKED_TLDS.has(tld)) {
    return { valid: false, reason: 'Please use a personal or work email address' };
  }

  // Block known disposable/fake domains
  if (BLOCKED_DOMAINS.has(domain)) {
    return { valid: false, reason: 'Please use a personal or work email address' };
  }

  // Allow known providers immediately
  if (ALLOWED_PROVIDERS.has(domain)) {
    return { valid: true };
  }

  // Allow .edu, .gov, .mil domains
  if (tld === '.edu' || tld === '.gov' || tld === '.mil') {
    return { valid: true };
  }

  // Allow any custom work/business domain that passed earlier checks
  // (has valid format, not blocked, has at least name.tld)
  return { valid: true };
}

// ── "Did you mean…?" typo suggestion ────────────────────────────────────────
// validateEmail() deliberately waves through any well-formed custom domain, so
// the classic bouncing typos — gmial.com, hotnail.com, yaho.com, gmail.con —
// all pass as "valid" and then silently fail to deliver (reset / wallet /
// notification emails). This catches them at the keystroke.
//
// NON-BLOCKING by design: the UI shows the result as a one-tap suggestion, never
// a hard error. It is also SAFE by construction — the suggestion can only ever
// point AT a known real provider domain in SUGGEST_TARGETS, so we can never
// propose an address that itself doesn't exist, and we never touch a domain
// that's already a known-good provider or anything with a subdomain.

// High-volume consumer mailbox providers (incl. ES-locale variants). me.com is
// intentionally omitted: at 6 chars it generates false matches against legit
// short domains, and its users almost always type icloud.com anyway.
const SUGGEST_TARGETS = [
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.es', 'hotmail.com', 'hotmail.es', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.es', 'ymail.com',
  'icloud.com', 'aol.com', 'proton.me', 'protonmail.com',
];

// Obvious .com/.net fat-fingers that an edit-distance pass alone can miss.
const TLD_TYPOS = {
  con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com',
  cm: 'com', om: 'com', coom: 'com', cpm: 'com', con1: 'com',
  nte: 'net', ner: 'net', orh: 'org', ogr: 'org',
};

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Suggests a corrected email when the domain looks like a typo of a known
 * provider. Returns the full corrected email string, or null when there's
 * nothing confident to suggest.
 */
export function suggestEmailCorrection(email) {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return null;

  const localPart = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (!domain.includes('.')) return null;

  // Only simple `label.tld` domains — never second-guess a subdomain or a
  // multi-label corporate domain (e.g. mail.acme.co.uk), which would risk
  // mangling a perfectly valid address.
  if (domain.split('.').length !== 2) return null;

  // Already a known-good provider → nothing to suggest.
  if (ALLOWED_PROVIDERS.has(domain) || SUGGEST_TARGETS.includes(domain)) return null;

  // 1. Pre-fix an obvious TLD fat-finger so it can match a target exactly.
  const lastDot = domain.lastIndexOf('.');
  const tld = domain.slice(lastDot + 1);
  if (TLD_TYPOS[tld]) {
    domain = `${domain.slice(0, lastDot)}.${TLD_TYPOS[tld]}`;
    if (ALLOWED_PROVIDERS.has(domain) || SUGGEST_TARGETS.includes(domain)) {
      return `${localPart}@${domain}`;
    }
  }

  // 2. Otherwise suggest the nearest provider domain within a tight distance.
  //    Short domains demand an even closer match to avoid false positives.
  let best = null;
  let bestDist = 3;
  for (const target of SUGGEST_TARGETS) {
    const dist = levenshtein(domain, target);
    if (dist < bestDist) { bestDist = dist; best = target; }
  }
  const maxDist = domain.length <= 7 ? 1 : 2;
  if (best && best !== domain && bestDist <= maxDist) {
    return `${localPart}@${best}`;
  }
  return null;
}

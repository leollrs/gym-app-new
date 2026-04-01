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

// aiConsent.js
// ─────────────────────────────────────────────────────────────────────────────
// Tracks per-feature consent for sending photos to OpenAI Vision (third-party
// AI processor). Required by Apple App Store guideline 5.1.2 — explicit
// consent must be obtained before sharing personal data (photos) with named
// third parties.
//
// Storage strategy:
//   1. Source of truth: `profiles.ai_consent` (jsonb), shape:
//        { body: ISO8601, food: ISO8601, menu: ISO8601, version: 1 }
//   2. Mirrored to localStorage so we can answer `hasConsentedToAI` without a
//      round-trip on cold starts and offline. The DB still authoritative.
//
// Feature names map to the three AI photo flows:
//   - "body-analysis"  → analyze-body-photo
//   - "food-analysis"  → analyze-food-photo
//   - "menu-analysis"  → analyze-menu-photo
//
// GDPR Art. 7(3): consent must be revocable as easily as it is given. The
// `revokeAIConsent` and `revokeAllAIConsent` helpers null out the relevant
// fields in the DB and clear the local cache.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase';

export const AI_CONSENT_VERSION = 1;
const LS_KEY = 'ai_consent_v1';

const FEATURE_TO_FIELD = {
  'body-analysis': 'body',
  'food-analysis': 'food',
  'menu-analysis': 'menu',
};

const ALL_FIELDS = ['body', 'food', 'menu'];

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(obj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // Quota or private mode — DB still has the truth.
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Check whether the current user has consented to AI processing for `feature`.
 * Synchronous: reads from localStorage cache only. Hydration from DB happens
 * via `hydrateAIConsent()` (call once after auth resolves).
 *
 * @param {'body-analysis'|'food-analysis'|'menu-analysis'} feature
 * @returns {boolean}
 */
export function hasConsentedToAI(feature) {
  const field = FEATURE_TO_FIELD[feature];
  if (!field) return false;
  const local = readLocal();
  return Boolean(local?.[field]) && local?.version === AI_CONSENT_VERSION;
}

/**
 * Persist consent for `feature` to both the DB (profiles.ai_consent) and
 * localStorage. Safe to call multiple times — subsequent calls refresh the
 * timestamp and merge with existing consents.
 *
 * Returns the merged consent object on success.
 *
 * @param {'body-analysis'|'food-analysis'|'menu-analysis'} feature
 * @returns {Promise<object>}
 */
export async function recordAIConsent(feature) {
  const field = FEATURE_TO_FIELD[feature];
  if (!field) throw new Error(`Unknown AI consent feature: ${feature}`);

  const now = new Date().toISOString();
  const local = readLocal();
  const merged = {
    ...local,
    [field]: now,
    version: AI_CONSENT_VERSION,
  };

  // Always update local cache first so the gating check can succeed even if
  // the network write fails (we'll retry next time anyway).
  writeLocal(merged);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      // Read existing DB value so we don't clobber other-feature consents
      // recorded on another device.
      const { data: profile } = await supabase
        .from('profiles')
        .select('ai_consent')
        .eq('id', user.id)
        .maybeSingle();

      const dbExisting = profile?.ai_consent && typeof profile.ai_consent === 'object'
        ? profile.ai_consent
        : {};
      const dbMerged = {
        ...dbExisting,
        ...merged,
      };

      await supabase
        .from('profiles')
        .update({ ai_consent: dbMerged })
        .eq('id', user.id);

      // Replace local with the DB-merged value so we pick up cross-device consents.
      writeLocal(dbMerged);
      return dbMerged;
    }
  } catch (err) {
    // Network failure — the localStorage write already succeeded so the
    // current session is unblocked. Next successful call will sync.
    console.warn('[aiConsent] DB write failed, kept local only:', err?.message || err);
  }

  return merged;
}

/**
 * Revoke consent for a single feature. Nulls the relevant field in
 * profiles.ai_consent JSONB and removes it from the local cache. Other
 * feature consents are preserved.
 *
 * @param {'body-analysis'|'food-analysis'|'menu-analysis'} feature
 * @returns {Promise<object>} the resulting consent object (after removal)
 */
export async function revokeAIConsent(feature) {
  const field = FEATURE_TO_FIELD[feature];
  if (!field) throw new Error(`Unknown AI consent feature: ${feature}`);

  // Update local cache first — keep other fields, drop this one.
  const local = readLocal();
  const next = { ...local };
  delete next[field];
  // Preserve version tag so other features stay valid.
  next.version = AI_CONSENT_VERSION;
  writeLocal(next);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('ai_consent')
        .eq('id', user.id)
        .maybeSingle();

      const dbExisting = profile?.ai_consent && typeof profile.ai_consent === 'object'
        ? profile.ai_consent
        : {};
      const dbNext = { ...dbExisting };
      // Null the field rather than delete so audits can see the explicit
      // revocation timestamp via updated_at on the profile row.
      dbNext[field] = null;
      dbNext.version = AI_CONSENT_VERSION;

      await supabase
        .from('profiles')
        .update({ ai_consent: dbNext })
        .eq('id', user.id);
    }
  } catch (err) {
    console.warn('[aiConsent] DB revoke failed, kept local change:', err?.message || err);
  }

  return next;
}

/**
 * Revoke ALL AI consents at once. Sets profiles.ai_consent to {} and clears
 * the local cache. Used by the GDPR-style "withdraw all" path.
 *
 * @returns {Promise<void>}
 */
export async function revokeAllAIConsent() {
  clearLocal();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      await supabase
        .from('profiles')
        .update({ ai_consent: {} })
        .eq('id', user.id);
    }
  } catch (err) {
    console.warn('[aiConsent] DB full-revoke failed, kept local clear:', err?.message || err);
  }
}

/**
 * Pull consent state from the DB into localStorage. Call once after the user
 * is authenticated. Idempotent and silent on failure.
 *
 * Version handling: if the DB record was written under a different consent
 * version than the current one (`AI_CONSENT_VERSION`), we do NOT trust those
 * consents — wipe local cache so the user is forced to re-consent under the
 * new disclosures next time. This prevents silently grandfathering users
 * across consent revisions.
 */
export async function hydrateAIConsent() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('ai_consent')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.ai_consent || typeof profile.ai_consent !== 'object') {
      // No DB consent at all — drop any stale local cache.
      clearLocal();
      return;
    }

    const dbConsent = profile.ai_consent;
    const dbVersion = dbConsent.version;

    if (dbVersion !== AI_CONSENT_VERSION) {
      // Version mismatch — do NOT carry old consent forward. The user must
      // re-consent under the current disclosures.
      clearLocal();
      return;
    }

    // Versions match — copy DB → local as the source of truth.
    writeLocal({ ...dbConsent, version: AI_CONSENT_VERSION });
  } catch {
    // Ignore — fall back to whatever is in localStorage.
  }
}

/**
 * Returns a snapshot of the current consent state for each feature, suitable
 * for rendering in the settings UI.
 *
 * @returns {{ body: { consented: boolean, timestamp: number|null },
 *             food: { consented: boolean, timestamp: number|null },
 *             menu: { consented: boolean, timestamp: number|null } }}
 */
export function getConsentStatus() {
  const local = readLocal();
  const versionOk = local?.version === AI_CONSENT_VERSION;
  const out = {};
  for (const field of ALL_FIELDS) {
    const raw = versionOk ? local?.[field] : null;
    let ts = null;
    if (raw) {
      const parsed = Date.parse(raw);
      ts = Number.isFinite(parsed) ? parsed : null;
    }
    out[field] = {
      consented: Boolean(raw) && versionOk,
      timestamp: ts,
    };
  }
  return out;
}

import { useState, useEffect, useCallback } from 'react';
import { signQRPayload } from '../lib/qrSecurity';

// verify-qr rejects signatures older than 60s (QR_EXPIRY_MS) and consumes
// each one on first verify. Signing once on open meant any QR left on
// screen past the window scanned as "expired" at the desk. Refresh at 45s
// so the displayed code is always inside its validity window, and re-sign
// immediately on foreground (the signature is stale after backgrounding).
const REFRESH_MS = 45_000;

// Module-level signed-payload cache shared by every hook instance AND the
// prewarm below. A signature stays useful for REFRESH_MS; within that window
// reopening a QR (or opening one that was prewarmed at app launch) renders
// instantly with zero spinner — the check-in-at-the-door case.
const signedCache = new Map(); // payload → { signed, at }

function readFreshCache(payload) {
  const hit = payload ? signedCache.get(payload) : null;
  if (hit && Date.now() - hit.at < REFRESH_MS) return hit;
  return null;
}

/**
 * Pre-sign a payload so the next useSignedQR(payload) mount is instant.
 * Called on app open / resume for the member pass (see AuthContext).
 * Silent on failure — the hook will just sign on demand as before.
 */
export async function prewarmSignedQR(payload) {
  if (!payload || readFreshCache(payload)) return;
  try {
    const signed = await signQRPayload(payload);
    signedCache.set(payload, { signed, at: Date.now() });
  } catch { /* offline / signed out — on-demand path handles it */ }
}

/**
 * Keep a signed QR payload fresh for as long as it's displayed.
 *
 * Returns { signed, failed, pending, retry }:
 *   signed  — the `payload:timestamp|signature` string, or null
 *   failed  — last sign attempt errored (offline / edge fn down); keeps
 *             retrying every REFRESH_MS so it self-heals when back online
 *   pending — first signature still in flight (callers render a spinner,
 *             never the unsigned payload — the unsigned→signed swap is what
 *             made QRs visibly "change structure" mid-display)
 *   retry   — manual re-attempt for tap-to-retry UIs
 *
 * @param {string|null} payload - exact string to sign (already prefixed)
 * @param {{ skip?: boolean }} opts - skip: don't sign at all (raw/external payloads)
 */
export default function useSignedQR(payload, { skip = false } = {}) {
  // Seed from the shared cache so a prewarmed/recently-shown QR renders
  // on the very first paint.
  const [signed, setSigned] = useState(() => readFreshCache(payload)?.signed ?? null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setFailed(false);
    setSigned(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const cached = readFreshCache(payload);
    setSigned(cached?.signed ?? null);
    setFailed(false);
    if (!payload || skip) return undefined;

    let cancelled = false;
    let timer = null;
    let inFlight = false;

    const sign = async () => {
      // Single chain: a visibilitychange firing while a sign is already in
      // flight must not start a second request + second timer chain.
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const s = await signQRPayload(payload);
        signedCache.set(payload, { signed: s, at: Date.now() });
        if (!cancelled) {
          setSigned(s);
          setFailed(false);
        }
      } catch {
        // Swallow — an unhandled rejection from the edge function crashes the
        // Capacitor WebView. `failed` lets the caller fall back or show retry.
        if (!cancelled) {
          setSigned(null);
          setFailed(true);
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          clearTimeout(timer);
          timer = setTimeout(sign, REFRESH_MS);
        }
      }
    };

    if (cached) {
      // Fresh cached signature: show it now, re-sign when it ages out.
      timer = setTimeout(sign, Math.max(1_000, REFRESH_MS - (Date.now() - cached.at)));
    } else {
      sign();
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled && !readFreshCache(payload)) {
        clearTimeout(timer);
        sign();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [payload, skip, nonce]);

  return { signed, failed, pending: !skip && !!payload && !signed && !failed, retry };
}

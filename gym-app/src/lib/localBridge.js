/**
 * Local sidecar bridge — forwards scan/check-in events to a separate
 * process running on the same machine (typically the front-desk PC).
 *
 * Why a local sidecar instead of the existing cloud webhook (integration-
 * webhook edge function)? Two reasons:
 *
 *   1. The gym's existing software (member management, POS, legacy check-in
 *      system) usually has no public API. The sidecar lives on the same
 *      LAN/machine and bridges the gap — it can drive the legacy software's
 *      UI via keystroke emulation, file drops, named pipes, or whatever the
 *      vendor provides locally. The cloud webhook can't reach those.
 *
 *   2. Latency. A cloud round-trip on every check-in adds ~200-500ms; the
 *      sidecar responds in milliseconds because it's local.
 *
 * **Contract for the second software (sidecar) you're building:**
 *   - Listen on `http://127.0.0.1:9876` (configurable via the
 *     `TUGYMPR_SIDECAR_URL` env var or local override in TVDisplay
 *     settings, but defaults work for the common case).
 *   - Accept `POST /scan` with JSON body shaped like:
 *       {
 *         "action": "checkin" | "purchase" | "reward_redemption" | ...,
 *         "payload": { ... },          // matches result.externalPayload
 *         "timestamp": "ISO-8601",
 *         "gymId": "uuid",
 *         "source": "tauri-desktop"
 *       }
 *   - Respond with 2xx for success; non-2xx logs a warning but doesn't
 *     block the TuGymPR check-in itself (we fire-and-forget).
 *   - The `payload` field already contains memberId, memberName, and
 *     memberExternalId — everything the sidecar needs to look up the same
 *     person in the gym's existing system.
 *
 * We don't fail the user-facing check-in on sidecar failure because the
 * cloud-side check-in is the source of truth — the sidecar is a sync
 * convenience. If it's down, the gym just gets a check-in that didn't
 * propagate to their legacy system, which they can reconcile later.
 */

// AbortController timeout — keeps a slow/hung sidecar from blocking the UI.
// 2000ms is generous: the sidecar is on localhost, so anything past 100ms
// already means something's wrong.
const REQUEST_TIMEOUT_MS = 2000;

// Default URL. Override via Vite env (`VITE_SIDECAR_URL`) for testing
// against a sidecar on a non-default port. Tauri build picks up env vars
// at build time, so the released installer ships with whatever was set.
const DEFAULT_URL = 'http://127.0.0.1:9876/scan';
const SIDECAR_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIDECAR_URL) || DEFAULT_URL;

/**
 * Dispatch a scan result to the local sidecar. Fire-and-forget — never
 * throws, never rejects, returns synchronously. The actual HTTP call runs
 * in the background and any failure is logged to console but ignored.
 *
 * @param {Object} args
 * @param {string} args.gymId - The gym tenant id
 * @param {string} args.action - Scan action type (checkin, purchase, ...)
 * @param {Object} args.payload - externalPayload from scanActionHandlers
 */
export function dispatchToLocalBridge({ gymId, action, payload }) {
  if (!payload) return;
  const body = {
    action,
    payload,
    timestamp: new Date().toISOString(),
    gymId,
    source: 'tauri-desktop',
  };

  // AbortController gives us a clean timeout. Without it, a hung sidecar
  // would hold the fetch promise open for ~30s (browser default) and the
  // queryClient invalidations downstream wouldn't get garbage collected.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  fetch(SIDECAR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
    // No credentials, no cache — the sidecar is dumb middleware.
    credentials: 'omit',
    cache: 'no-store',
  })
    .then(async (res) => {
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.warn(`[localBridge] sidecar returned ${res.status} for ${action}`);
      }
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      // ECONNREFUSED is the common case: sidecar isn't running. Don't
      // spam the console — log once at debug level. AbortError happens
      // on our own timeout; not interesting.
      if (err?.name === 'AbortError') return;
      // Network failures all surface as TypeError with message like
      // "Failed to fetch". One concise log line per event is enough.
      console.debug(`[localBridge] sidecar unreachable for ${action}:`, err?.message || err);
    });
}

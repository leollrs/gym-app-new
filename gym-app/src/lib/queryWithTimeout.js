/**
 * Hard timeout wrapper for Supabase / fetch-based queries.
 *
 * Why this exists: the Supabase JS client doesn't time out a stalled
 * request. When the underlying TCP socket goes silent (flaky cellular,
 * connection-pooler backpressure, paused RPC on the server) the fetch
 * promise never resolves and never rejects. React Query then sits in
 * `pending` forever — the retry config in main.jsx only fires on
 * errors, not on hangs. UI symptom: admin pages stuck on skeleton
 * indefinitely, can only "reset" by navigating away and back.
 *
 * `withQueryTimeout(promise, ms, label)` races the underlying promise
 * against a setTimeout that rejects with a labeled error. Once the
 * error bubbles into React Query, the retry policy + error UI kick in
 * normally — the user sees an "error, retry?" state instead of an
 * eternal spinner.
 *
 * Defaults are intentionally generous (15s) because some admin RPCs
 * legitimately need time on cold cache (churn scoring, cohort joins),
 * and a too-aggressive ceiling would surface false-positive timeouts
 * on the gym's first day. Per-query overrides are encouraged for
 * known-fast endpoints.
 *
 * Note: this rejects the JS promise but does NOT cancel the in-flight
 * HTTP request. For that, use Supabase's `.abortSignal(AbortSignal.timeout(ms))`
 * on the builder directly. That's stricter (closes the socket) but
 * requires touching each query builder; this wrapper is the cheap
 * one-line fix that solves the user-visible hang.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export async function withQueryTimeout(promise, ms = DEFAULT_TIMEOUT_MS, label = 'query') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

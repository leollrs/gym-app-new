import { supabase } from './supabase';
import posthog from 'posthog-js';

let _authContext = null;

/**
 * Called from AuthContext when user logs in so errors include profile/gym info.
 */
export function setErrorTrackerAuth(user, profile, gymName) {
  _authContext = { user, profile, gymName };
}

/**
 * Collect basic device info for error context.
 */
function getDeviceInfo() {
  try {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screenWidth: screen.width,
      screenHeight: screen.height,
      language: navigator.language,
      online: navigator.onLine,
    };
  } catch {
    return {};
  }
}

/**
 * Debounce: skip duplicate error messages within 5 seconds.
 */
const _recentErrors = [];
const DEBOUNCE_WINDOW = 5000;
const MAX_RECENT = 10;

function isDuplicate(message) {
  const now = Date.now();
  while (_recentErrors.length > 0 && now - _recentErrors[0].timestamp > DEBOUNCE_WINDOW) {
    _recentErrors.shift();
  }
  if (_recentErrors.some((e) => e.message === message)) {
    return true;
  }
  _recentErrors.push({ message, timestamp: now });
  if (_recentErrors.length > MAX_RECENT) {
    _recentErrors.shift();
  }
  return false;
}

/**
 * Track an error by inserting into the error_logs table.
 * Never throws — all failures are silently swallowed.
 *
 * Types:
 * - 'react_crash'        — React ErrorBoundary caught a component crash
 * - 'js_error'           — Uncaught JS error (window.onerror)
 * - 'promise_rejection'  — Unhandled promise rejection
 * - 'api_error'          — Explicit logger.error() call in code
 * - 'network_error'      — Offline or request timeout
 * - 'slow_api'           — API call took > 3 seconds
 * - 'auth_error'         — 401/403 from Supabase (token expired, RLS blocked)
 * - 'http_error'         — 400/500 level HTTP errors from API
 * - 'action_failed'      — Specific user action failed (save workout, check-in, etc.)
 */
/**
 * Scrub sensitive data (tokens, emails, keys) from strings before logging.
 */
function scrubSensitive(str) {
  if (typeof str !== 'string') return str;
  return str
    // JWT tokens (eyJ...)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_TOKEN]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    // Bearer tokens in headers
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    // API keys (long hex/base64 strings)
    .replace(/(?:key|token|secret|password|apikey)["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/gi, '[REDACTED_KEY]');
}

export async function trackError(type, error, extra = {}) {
  try {
    const rawMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : String(error ?? 'Unknown error');
    const message = scrubSensitive(rawMessage);
    const stack = error instanceof Error ? scrubSensitive(error.stack) : undefined;

    // Don't track errors from the error tracker itself
    if (message.includes('error_logs')) return;

    if (isDuplicate(`${type}:${message}`)) return;

    // Strip query params from page URL (may contain tokens/codes)
    const page = typeof window !== 'undefined' ? window.location.pathname : undefined;

    // Scrub any string values in extra metadata
    const cleanExtra = {};
    for (const [k, v] of Object.entries(extra)) {
      cleanExtra[k] = typeof v === 'string' ? scrubSensitive(v) : v;
    }

    const component = extra.componentStack ? 'ErrorBoundary' : extra.component || undefined;

    // Send to PostHog for correlation with user sessions
    try {
      posthog?.capture('$exception', { message, stack, component, type });
    } catch {}

    await supabase.from('error_logs').insert({
      type,
      message,
      stack: stack || undefined,
      page,
      component,
      device_info: getDeviceInfo(),
      metadata: Object.keys(cleanExtra).length > 0 ? cleanExtra : undefined,
      profile_id: _authContext?.profile?.id || null,
      gym_id: _authContext?.profile?.gym_id || null,
    });
  } catch {
    // Never throw from the error tracker itself
  }
}

// ── Supabase API Interceptor ─────────────────────────────────────────────────

const SLOW_THRESHOLD_MS = 3000;

/**
 * Wrap the global fetch to monitor all Supabase API calls.
 * Tracks: network errors, slow calls, 400/401/403/500 responses.
 */
export function installFetchInterceptor() {
  if (typeof window === 'undefined') return;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return;

  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isSupabase = url.includes(supabaseUrl) || url.includes('supabase.co');

    // Non-Supabase requests — pass through
    if (!isSupabase) {
      return originalFetch.call(this, input, init);
    }

    // Don't intercept error_logs inserts (prevent infinite loop)
    if (url.includes('error_logs')) {
      return originalFetch.call(this, input, init);
    }

    const startTime = Date.now();
    const endpoint = url.replace(supabaseUrl, '').split('?')[0]; // e.g. "/rest/v1/profiles"

    try {
      const response = await originalFetch.call(this, input, init);
      const elapsed = Date.now() - startTime;

      // Slow API call
      if (elapsed > SLOW_THRESHOLD_MS) {
        trackError('slow_api', `${init?.method || 'GET'} ${endpoint} took ${elapsed}ms`, {
          endpoint,
          method: init?.method || 'GET',
          duration_ms: elapsed,
          status: response.status,
        });
      }

      // Auth errors (401/403)
      if (response.status === 401 || response.status === 403) {
        trackError('auth_error', `${response.status} on ${init?.method || 'GET'} ${endpoint}`, {
          endpoint,
          method: init?.method || 'GET',
          status: response.status,
        });
      }

      // HTTP errors (400, 500+)
      if (response.status === 400 || response.status >= 500) {
        // Try to get error body without consuming the response
        try {
          const cloned = response.clone();
          const body = await cloned.text();
          const parsed = JSON.parse(body);
          trackError('http_error', `${response.status} on ${init?.method || 'GET'} ${endpoint}: ${parsed.message || body.slice(0, 200)}`, {
            endpoint,
            method: init?.method || 'GET',
            status: response.status,
            error_code: parsed.code,
            error_detail: parsed.details?.slice?.(0, 500) || parsed.detail?.slice?.(0, 500),
          });
        } catch {
          trackError('http_error', `${response.status} on ${init?.method || 'GET'} ${endpoint}`, {
            endpoint,
            method: init?.method || 'GET',
            status: response.status,
          });
        }
      }

      return response;
    } catch (fetchError) {
      // Network failure (offline, DNS, timeout)
      const elapsed = Date.now() - startTime;
      trackError('network_error', fetchError, {
        endpoint,
        method: init?.method || 'GET',
        duration_ms: elapsed,
        online: navigator.onLine,
      });
      throw fetchError; // Re-throw so the original caller still gets the error
    }
  };
}

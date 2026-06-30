/**
 * Production-safe logger. Suppresses all output in production builds
 * to prevent leaking error details, stack traces, or internal state.
 * In production, errors are silently sent to the error_logs table.
 */
import { trackError } from './errorTracker';

const isProd = import.meta.env.PROD;

const noop = () => {};

// Serialize a single log argument to a readable string. Supabase / PostgREST
// errors are plain objects ({ message, code, details, hint }), NOT Error
// instances, so the default String() coercion yields "[object Object]" and
// hides the real cause. Pull the message (+ code) out, and JSON-stringify any
// other object as a last resort.
const serializeArg = (a) => {
  if (a instanceof Error) return a.message;
  if (a && typeof a === 'object') {
    if (typeof a.message === 'string') return a.code ? `${a.message} (${a.code})` : a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
};

const logger = {
  log:   isProd ? noop : console.log.bind(console),
  warn:  isProd ? noop : console.warn.bind(console),
  error: isProd ? (...args) => { trackError('api_error', args[0] instanceof Error ? args[0] : args.map(serializeArg).join(' ')); } : console.error.bind(console),
  info:  isProd ? noop : console.info.bind(console),
  debug: isProd ? noop : console.debug.bind(console),
};

export default logger;

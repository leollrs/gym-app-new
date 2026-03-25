/**
 * Production-safe logger. Suppresses all output in production builds
 * to prevent leaking error details, stack traces, or internal state.
 * In production, errors are silently sent to the error_logs table.
 */
import { trackError } from './errorTracker';

const isProd = import.meta.env.PROD;

const noop = () => {};

const logger = {
  log:   isProd ? noop : console.log.bind(console),
  warn:  isProd ? noop : console.warn.bind(console),
  error: isProd ? (...args) => { trackError('api_error', args[0] instanceof Error ? args[0] : args.join(' ')); } : console.error.bind(console),
  info:  isProd ? noop : console.info.bind(console),
  debug: isProd ? noop : console.debug.bind(console),
};

export default logger;

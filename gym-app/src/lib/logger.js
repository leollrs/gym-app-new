/**
 * Production-safe logger. Suppresses all output in production builds
 * to prevent leaking error details, stack traces, or internal state.
 */
const isProd = import.meta.env.PROD;

const noop = () => {};

const logger = {
  log:   isProd ? noop : console.log.bind(console),
  warn:  isProd ? noop : console.warn.bind(console),
  error: isProd ? noop : console.error.bind(console),
  info:  isProd ? noop : console.info.bind(console),
  debug: isProd ? noop : console.debug.bind(console),
};

export default logger;

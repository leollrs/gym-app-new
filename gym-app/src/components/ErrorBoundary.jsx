import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import i18n from 'i18next';
import { trackError } from '../lib/errorTracker';
import { recordGoodPath } from '../lib/lastGoodPath';

// The error boundary may render before the lazy `pages` namespace finishes
// loading (the very crash we're catching can happen during initial hydration).
// Resolve from `common` first so we still get a localized string when `pages`
// is missing.
const tr = (key, fallback, commonKey) => {
  try {
    if (commonKey) {
      const fromCommon = i18n.t(commonKey, { ns: 'common', defaultValue: '' });
      if (fromCommon) return fromCommon;
    }
    return i18n.t(key, { ns: 'pages', defaultValue: fallback });
  } catch {
    return fallback;
  }
};

// A lazy route's chunk failed to load — almost always because a deploy landed
// while this tab was open. On web the service worker precaches the whole app
// shell with `registerType: 'autoUpdate'` (vite.config.js), so the new SW
// activates mid-session and drops the old precache while THIS page is still
// running off the old index.html and still asking for old chunk hashes. The
// request 404s, the SPA rewrite answers with index.html, and the browser gets
// HTML where it wanted JavaScript.
//
// Every engine words it differently, hence the list. Safari says "'text/html'
// is not a valid JavaScript MIME type", Chrome "Failed to fetch dynamically
// imported module", Firefox "error loading dynamically imported module".
const CHUNK_ERROR_PATTERNS = [
  'is not a valid javascript mime type',
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'failed to load module script',
  'loading chunk',
  'loading css chunk',
];

function isStaleChunkError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);

    // Stale chunk → the running build no longer exists on the server. The
    // normal "Reiniciar" is useless here: it routes to the last good page,
    // which is ALSO lazy and will fail on the same missing chunks. Only a hard
    // reload picks up the new index.html.
    //
    // sessionStorage-guarded so a genuinely broken deploy can't put the user in
    // a reload loop — second time through we fall past this and show the normal
    // error UI. Same one-shot pattern as the boot-failure net in index.html.
    if (isStaleChunkError(error)) {
      try {
        if (!sessionStorage.getItem('__chunk_reload__')) {
          sessionStorage.setItem('__chunk_reload__', '1');
          trackError('stale_chunk_reload', error, { componentStack: errorInfo.componentStack });
          window.location.reload();
          return;
        }
      } catch { /* private mode — fall through to the error UI */ }
    }

    trackError('react_crash', error, { componentStack: errorInfo.componentStack });
  }

  componentDidUpdate(prevProps) {
    const navigated = prevProps.resetKey !== this.props.resetKey;
    if (!navigated) return;

    if (this.state.hasError) {
      // Auto-clear the fallback once the user navigates to a different route,
      // so a crash on one page doesn't keep showing after they move away.
      this.setState({ hasError: false, error: null });
      return;
    }

    // We just left `prevProps.resetKey` and it had rendered cleanly → it's a
    // safe place for "Reiniciar" to return to. Recording the OUTGOING path
    // (not the incoming one) is what makes lazy pages work: a lazy route shows
    // a Suspense fallback first (no error), so recording the incoming path
    // would wrongly mark the page that's about to crash as "good".
    if (prevProps.resetKey) {
      recordGoodPath(prevProps.resetKey);
      // A route rendered cleanly, so whatever chunk problem triggered the
      // one-shot reload is behind us. Clear the guard or a SECOND deploy
      // landing in this same tab session would hit the error UI instead of
      // healing itself.
      try { sessionStorage.removeItem('__chunk_reload__'); } catch { /* private mode */ }
    }
  }

  componentWillUnmount() {
    // A whole section's boundary is unmounting (e.g. leaving /admin/* for the
    // member app). If it wasn't showing an error, its route was good — record
    // it so cross-section recovery has a target.
    if (!this.state.hasError && this.props.resetKey) {
      recordGoodPath(this.props.resetKey);
    }
  }

  handleRestart = () => {
    const { onReset } = this.props;
    if (typeof onReset === 'function') {
      // Router-aware reset: navigate back to the last good page, then clear.
      try { onReset(); } catch { /* navigation failed — fall through to clear */ }
      this.setState({ hasError: false, error: null });
    } else {
      // No router context (public/standalone boundary) — hard restart the app.
      try {
        window.location.reload();
      } catch {
        this.setState({ hasError: false, error: null });
      }
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-[60vh] flex items-center justify-center px-6 py-10"
          role="alert"
        >
          <div
            className="w-full max-w-sm text-center"
            style={{
              background: 'var(--color-bg-card, #0F172A)',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
              borderRadius: 20,
              padding: '32px 24px',
            }}
          >
            <div
              className="mx-auto flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                borderRadius: '9999px',
                background: 'color-mix(in srgb, var(--color-danger, #EF4444) 14%, transparent)',
                color: 'var(--color-danger, #EF4444)',
              }}
            >
              <AlertTriangle size={26} />
            </div>

            <h2
              className="font-semibold"
              style={{ marginTop: 18, fontSize: 20, color: 'var(--color-text-primary, #E5E7EB)' }}
            >
              {tr('errorBoundary.title', 'Something went wrong', 'errorBoundaryTitle')}
            </h2>
            <p
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--color-text-muted, #9CA3AF)',
              }}
            >
              {tr('errorBoundary.body', 'An unexpected error occurred. Please try again or refresh the page.', 'errorBoundaryBody')}
            </p>

            <button
              onClick={this.handleRestart}
              className="inline-flex items-center justify-center gap-2 font-bold transition-opacity hover:opacity-90"
              style={{
                marginTop: 24,
                width: '100%',
                padding: '14px 24px',
                borderRadius: 14,
                fontSize: 14,
                background: 'var(--color-accent, #D4AF37)',
                color: 'var(--color-text-on-accent, #ffffff)',
              }}
            >
              <RotateCcw size={16} />
              {tr('errorBoundary.restart', 'Restart', 'errorBoundaryRestart')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

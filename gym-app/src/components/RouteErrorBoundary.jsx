import { useLocation, useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import { getLastGoodPath } from '../lib/lastGoodPath';

/**
 * Router-aware wrapper around <ErrorBoundary>.
 *
 * - Feeds the current pathname as `resetKey` so the boundary auto-clears when
 *   the user navigates away from a crashed page.
 * - Gives the "Reiniciar" button a real recovery action: it returns the user to
 *   the last page that rendered cleanly. If the page that crashed IS the last
 *   good one (a crash that happened while sitting on a page), it falls back to
 *   the section `home` so we don't just reload straight back into the crash.
 */
export default function RouteErrorBoundary({ children, home = '/' }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleReset = () => {
    const last = getLastGoodPath();
    const target = last && last !== location.pathname ? last : home;
    navigate(target);
  };

  return (
    <ErrorBoundary resetKey={location.pathname} onReset={handleReset}>
      {children}
    </ErrorBoundary>
  );
}

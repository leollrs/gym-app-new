import React, { useRef, useState, useEffect } from 'react';

// ── Ease-out cubic ─────────────────────────────────────────────────────────────
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ── Format value ───────────────────────────────────────────────────────────────
function formatValue(n, compact) {
  if (compact && n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return Math.round(n).toLocaleString();
}

// ── AnimatedCounter ────────────────────────────────────────────────────────────
// Counts up from 0 → value with ease-out cubic, triggered on scroll into view.
export default function AnimatedCounter({
  value,
  duration = 800,
  suffix = '',
  prefix = '',
  compact = false,
  className = '',
}) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(null); // null = not yet triggered
  const hasAnimated = useRef(false);

  // Null / undefined / 0 → static render
  if (value == null || value === 0) {
    return (
      <span className={className}>
        {value === 0 ? `${prefix}0${suffix}` : '—'}
      </span>
    );
  }

  // Observe visibility
  useEffect(() => {
    const el = ref.current;
    if (!el || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          hasAnimated.current = true;
          observer.disconnect();
          animate();
        }
      },
      { threshold: 0.2 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function animate() {
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = eased * value;

      setDisplay(formatValue(current, compact));

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        setDisplay(formatValue(value, compact));
      }
    }

    requestAnimationFrame(tick);
  }

  return (
    <span ref={ref} className={className}>
      {display !== null ? `${prefix}${display}${suffix}` : `${prefix}0${suffix}`}
    </span>
  );
}

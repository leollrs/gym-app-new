import { useEffect, useState, useRef } from 'react';

/**
 * Animated count-up hook with ease-out cubic easing.
 * @param {number} end - Target value
 * @param {number} duration - Animation duration in ms
 * @returns {number} Current animated value
 */
export default function useCountUp(end, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const target = typeof end === 'number' ? end : parseFloat(end) || 0;
    if (target === 0) { setValue(0); return; }
    // Round to whole numbers when the target is whole; otherwise keep one decimal.
    const isWhole = Number.isInteger(target);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const raw = eased * target;
      setValue(isWhole ? Math.round(raw) : Math.round(raw * 10) / 10);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration]);

  return value;
}

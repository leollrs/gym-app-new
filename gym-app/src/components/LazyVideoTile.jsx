// LazyVideoTile.jsx
//
// Renders an exercise demo video tile that:
//   1. Defers attaching `src` until the tile first scrolls into view, so
//      a 30-tile grid doesn't fire 30 simultaneous video fetches on mount.
//   2. Once src is attached, KEEPS it attached forever. We just toggle
//      play/pause on visibility. This lets the browser/service-worker
//      cache do its job — the bytes stay in memory + on disk and the
//      next scroll-back doesn't re-fetch.
//   3. Paused <video> elements don't hold an active decoder, so iOS
//      WebView is happy even with dozens of tiles loaded.
//
// preload="metadata" pulls just enough header data to show the first
// frame as a poster, so off-screen-but-loaded tiles look instant when
// you scroll back to them.

import { useEffect, useRef, useState } from 'react';

export default function LazyVideoTile({ src, className = '', style }) {
  const ref = useRef(null);
  // Sticky: flips true the first time we intersect, never flips back.
  // This is what makes the cache work — src stays attached so the
  // browser doesn't re-fetch when we scroll past.
  const [hasLoaded, setHasLoaded] = useState(false);
  // First decoded frame. Until then the element paints the shimmer class as
  // its own background — no wrapper div, so every caller's layout is
  // untouched. On a slow connection this is the difference between a tile
  // that reads as "loading" and one that reads as broken.
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setHasLoaded(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setHasLoaded(true);
          node.play?.().catch(() => {});
        } else {
          // Pause off-screen tiles so 50 videos aren't rolling at once,
          // but DO NOT clear src — the bytes are cached in the
          // element/browser/SW, scroll-back should be instant.
          node.pause?.();
        }
      },
      { rootMargin: '200px 0px', threshold: 0.01 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  if (!src) return null;
  return (
    <video
      ref={ref}
      src={hasLoaded ? src : undefined}
      loop
      muted
      playsInline
      preload="metadata"
      onLoadedData={() => setHasFrame(true)}
      // Also clear on error: a 404'd or undecodable video would otherwise
      // shimmer forever, which reads as "still loading" rather than "no video".
      onError={() => setHasFrame(true)}
      className={`${className}${hasFrame ? '' : ' tt-media-loading'}`}
      style={style}
    />
  );
}

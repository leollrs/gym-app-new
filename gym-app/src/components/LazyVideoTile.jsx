// LazyVideoTile.jsx
//
// Renders an exercise demo video tile that:
//   1. Defers attaching `src` until the tile first scrolls into view, so
//      a 30-tile grid doesn't fire 30 simultaneous video fetches on mount.
//   2. Once src is attached, KEEPS it attached forever, so scrolling back
//      doesn't re-fetch.
//   3. Shows the first frame as a still poster and does NOT play.
//
// (3) is the important one and it used to be the opposite. This tile called
// play() on intersect, and playback downloads the ENTIRE file — which makes
// preload="metadata" meaningless. AllExercisesModal renders every matching
// exercise with no cap, so one scroll of that grid pulled 203 x 177 KB =
// ~36 MB, the whole demo-video corpus, in a single screen. The old comment
// here claimed "the bytes are cached in the element/browser/SW"; on iOS and
// Android there IS no SW (vite.config.js ships a self-destructing stub on
// Capacitor by design), so that cache does not exist on the platforms the
// app actually ships on.
//
// Every caller is an exercise PICKER — the search modal, the muscle sheet,
// WorkoutBuilder, ActiveSession's add-exercise, TrainerPlans, the client
// program editor. You are choosing an exercise, not studying form. The
// detail view still autoplays the full clip. This matches ExerciseVideoThumb,
// which has always been metadata-only.
//
// `#t=0.1` is what makes a still frame appear without playing: it seeks the
// media fragment so the decoder paints one frame from the header bytes.

import { useEffect, useRef, useState } from 'react';
import { hasDecoded, markDecoded } from '../lib/decodedMedia';

export default function LazyVideoTile({ src, className = '', style }) {
  const ref = useRef(null);
  // Already decoded once ANYWHERE in the app (the memory is shared with
  // ExerciseVideoThumb) → mount immediately and treat as painted. Without this,
  // tapping one muscle then another re-ran the whole observe → mount → decode →
  // shimmer sequence for clips decoded seconds earlier, because the tiles
  // unmount when the sheet's contents change. Same for back-navigation.
  const seen = hasDecoded(src);
  // Sticky: flips true the first time we intersect, never flips back.
  // This is what makes the cache work — src stays attached so the
  // browser doesn't re-fetch when we scroll past.
  const [hasLoaded, setHasLoaded] = useState(seen);
  // First decoded frame. Until then the element paints the shimmer class as
  // its own background — no wrapper div, so every caller's layout is
  // untouched. On a slow connection this is the difference between a tile
  // that reads as "loading" and one that reads as broken.
  const [hasFrame, setHasFrame] = useState(seen);

  useEffect(() => {
    if (seen) return;              // nothing to observe — already mounted
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setHasLoaded(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        // Attach src once, then stop observing. Nothing to do on exit now that
        // we never play: a non-playing <video> holds no decoder, so there is
        // no pause() to balance and no reason to keep the observer alive.
        setHasLoaded(true);
        obs.disconnect();
      },
      { rootMargin: '200px 0px', threshold: 0.01 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [seen]);

  if (!src) return null;
  return (
    <video
      ref={ref}
      src={hasLoaded ? `${src}#t=0.1` : undefined}
      muted
      playsInline
      preload="metadata"
      tabIndex={-1}
      // Record the decode in the SHARED registry so the next mount of this clip —
      // in this component or in ExerciseVideoThumb — skips straight to painted.
      // Key on the BARE `src`, not the `#t=0.1` variant that goes on the element.
      // `hasDecoded(src)` above reads the bare form, and ExerciseVideoThumb keys
      // on the bare form too — marking the fragment version would write a key
      // nothing ever reads, silently disabling the whole registry.
      onLoadedData={() => { markDecoded(src); setHasFrame(true); }}
      // Clear on error too so a 404'd clip doesn't shimmer forever — but do NOT
      // markDecoded it, or a broken src would be force-mounted on every remount.
      onError={() => setHasFrame(true)}
      className={`${className}${hasFrame ? '' : ' tt-media-loading'}`}
      style={style}
    />
  );
}

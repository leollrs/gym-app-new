// useInlinedImage.js
// -----------------------------------------------------------------------------
// Turn a remote image URL into a data URL *inside the component that renders it*,
// and report failure so the component can draw its own fallback.
//
// WHY THIS EXISTS — the share cards were exporting with an empty gym badge, and
// every layer looked innocent on its own:
//
//   • The logo loads FINE in the app (you can see it in the header), so the
//     <img>'s `onError` never fires — React therefore never falls back to the
//     gym initial. The DOM is "correct".
//   • Export goes through rasterizeNode, which serialises the DOM into an SVG
//     <foreignObject> and paints it as an image. A browser will NOT fetch
//     external resources from inside an SVG-as-image, so that same working <img>
//     resolves to nothing in the PNG.
//   • The sheets tried to pre-inline the logo and pass a data URL down, but only
//     the gym logo, only in three sheets, and only as a prop the templates could
//     ignore. Anything they missed exported blank.
//
// Fixing it at the SHEET level can't work: the sheet doesn't know whether the
// template rendered the image or its fallback. Fixing it in rasterizeNode can't
// work either — by then all it can do is delete the <img>, which leaves the same
// hole. It has to happen where the fallback lives: the component itself renders
// EITHER a data URL (which survives rasterisation) or its fallback mark. Never a
// remote URL, so there is nothing left that can silently vanish on export.
//
// Returns `null` while resolving AND on failure; callers distinguish with
// `failed` and paint their fallback for both (a spinner has no place inside a
// photo the member is about to send someone).

import { useEffect, useState } from 'react';
import { urlToDataUrl } from '../../lib/imageInline';

export default function useInlinedImage(url) {
  // Already inlined by a caller (some sheets pre-resolve the gym logo) — no
  // state, no round trip, and no synchronous setState inside the effect.
  const isData = !!url && String(url).startsWith('data:');
  // One piece of state carrying WHICH url it answers for, so a url change is
  // handled by the comparison below instead of a reset call in the effect.
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
    if (!url || isData) return undefined;
    let cancelled = false;
    urlToDataUrl(url).then((d) => {
      if (!cancelled) setResolved({ url, src: d || null, failed: !d });
    });
    return () => { cancelled = true; };
  }, [url, isData]);

  if (!url) return { src: null, failed: true };
  if (isData) return { src: url, failed: false };
  if (resolved?.url === url) return { src: resolved.src, failed: resolved.failed };
  return { src: null, failed: false }; // still resolving — caller shows its fallback
}

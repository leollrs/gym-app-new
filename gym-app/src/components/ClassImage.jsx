// Class / program cover image with a real fallback.
//
// THE BUG THIS FIXES: every call site rendered `imgUrl ? <img/> : <gradient/>`.
// That only falls back when there is NO image_path at all. When a path EXISTS
// but the object is missing from the bucket — a class whose upload failed, or
// whose file was deleted — the <img> renders and the user gets the browser's
// broken-image glyph: a blue box with a question mark, sitting where a photo
// should be. Reported on Classes with `class-images/<gym>/<ts>.jpg` returning
// 400 "Object not found".
//
// A missing file is indistinguishable from no file as far as the member is
// concerned, so both must land on the same graceful gradient. That needs an
// `onError`, which none of the nine call sites had.
//
// The gradient is rendered UNDERNEATH rather than swapped in, so there is never
// a frame with nothing painted, and a slow-loading image fades in over the
// placeholder instead of replacing a blank box.

import { useState } from 'react';
import { classImageUrl } from '../lib/classImageUrl';

/**
 * @param path      raw `image_path` from the row (bucket-relative or absolute)
 * @param accent    gym/class accent colour used to tint the fallback
 * @param className applied to the wrapper
 * @param imgClassName applied to the <img> (defaults to a cover fill)
 */
export default function ClassImage({
  path,
  accent = 'var(--color-accent)',
  alt = '',
  className = '',
  style,
  imgClassName = 'absolute inset-0 w-full h-full object-cover',
  loading = 'lazy',
}) {
  const url = classImageUrl(path);
  // Reset on url change so a fixed image starts showing again without a reload.
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState(url);
  if (url !== loadedUrl) { setLoadedUrl(url); setFailed(false); setReady(false); }

  const showImg = !!url && !failed;

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', ...style }}>
      {/* Always-present base. Identical gradient to what the call sites used as
          their no-image branch, so nothing changes visually for classes that
          never had a photo. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(150deg, color-mix(in srgb, ${accent} 42%, #12161a) 0%, #12161a 55%, #0c0f12 100%)`,
        }}
      />
      {showImg && (
        <img
          src={url}
          alt={alt}
          loading={loading}
          className={imgClassName}
          // Hidden until it actually decodes. `onError` alone still let the
          // browser paint its broken-image glyph for the frames between the
          // request failing and React re-rendering — which read as the photo
          // "flickering" into the gradient. At opacity 0 a missing object never
          // paints at all: you just see the gradient, start to finish.
          style={{ opacity: ready ? 1 : 0, transition: 'opacity .18s ease' }}
          onLoad={() => setReady(true)}
          // The whole point of this component. Without it a 400/404 leaves the
          // broken-image glyph on screen with no way to recover.
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

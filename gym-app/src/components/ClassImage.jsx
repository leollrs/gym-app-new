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

// ── Fotos que ya sabemos que no están ──────────────────────────────────────
//
// `onError` quita el icono de imagen rota, pero NO evita la petición. Una clase
// que sale seis veces en el horario del mes pedía seis veces el mismo objeto
// muerto y dejaba seis errores rojos en la consola.
//
// PERO `onError` NO DISTINGUE. Salta igual con un 400 de «ese objeto no existe»
// que con una guagua sin cobertura, un 5xx pasajero o una navegación abortada.
// La primera versión de esto anotaba la ruta en cualquiera de esos casos y lo
// persistía en sessionStorage, que sobrevive al recargado: un túnel dejaba al
// socio sin fotos de clase en NUEVE pantallas hasta que cerrara la app. El
// arreglo era peor que el fallo.
//
// Ahora solo se anota lo que se puede demostrar muerto:
//   · nada si el navegador dice que no hay red;
//   · se pregunta por la cabecera y solo cuenta 400/403/404 (Supabase Storage
//     responde 400 «Object not found» a un objeto inexistente);
//   · y con caducidad, porque un fichero puede volver a subirse.
const DEAD_KEY = 'classImageDeadPaths';
const DEAD_TTL_MS = 30 * 60 * 1000;

const readDead = () => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DEAD_KEY)) || {};
    const now = Date.now();
    // De paso se poda: si no, una sesión larga arrastra rutas ya resucitadas.
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => now - t < DEAD_TTL_MS));
  } catch { return {}; }
};

let deadPaths = readDead();

const isDead = (url) => {
  const t = deadPaths[url];
  if (!t) return false;
  if (Date.now() - t >= DEAD_TTL_MS) { delete deadPaths[url]; return false; }
  return true;
};

/**
 * Se anota SOLO tras confirmar con el servidor que el objeto no está. Un fallo
 * de red no deja rastro: la foto se reintenta la próxima vez.
 */
async function markDeadIfReallyGone(url) {
  if (!url || isDead(url)) return;
  // Una URL de sesión (`blob:`) o incrustada (`data:`) no tiene servidor al que
  // preguntar, y además muere con la pestaña: no tiene sentido recordarla.
  if (/^(blob:|data:)/.test(url)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.ok || ![400, 403, 404].includes(res.status)) return;
  } catch {
    return;  // no se pudo comprobar → no se condena
  }

  deadPaths = { ...deadPaths, [url]: Date.now() };
  try { sessionStorage.setItem(DEAD_KEY, JSON.stringify(deadPaths)); } catch { /* modo privado */ }
}

/**
 * @param path      raw `image_path` from the row (bucket-relative or absolute)
 * @param accent    gym/class accent colour used to tint the fallback
 * @param fallback  node painted underneath instead of the gradient — pass the
 *                  cover preset here so a class with BOTH a dead photo and a
 *                  chosen preset degrades to its preset, not to a generic wash
 * @param className applied to the wrapper
 * @param imgClassName applied to the <img> (defaults to a cover fill)
 */
export default function ClassImage({
  path,
  accent = 'var(--color-accent)',
  fallback = null,
  alt = '',
  className = '',
  style,
  imgClassName = 'absolute inset-0 w-full h-full object-cover',
  loading = 'lazy',
}) {
  const url = classImageUrl(path);
  // Reset on url change so a fixed image starts showing again without a reload.
  const [failed, setFailed] = useState(() => isDead(url));
  const [ready, setReady] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState(url);
  if (url !== loadedUrl) { setLoadedUrl(url); setFailed(isDead(url)); setReady(false); }

  // Una ruta ya confirmada muerta ni siquiera monta el <img>: sin elemento, no
  // hay petición, y sin petición no hay 400 en la consola.
  const showImg = !!url && !failed;

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', ...style }}>
      {/* Always-present base. Identical gradient to what the call sites used as
          their no-image branch, so nothing changes visually for classes that
          never had a photo. A caller-supplied `fallback` replaces it. */}
      {/* The gradient always paints. `fallback` layers ON TOP of it rather than
          replacing it, because a fallback node can legitimately render nothing —
          CoverPreview returns null for a preset key it doesn't recognise — and
          swapping the gradient out for the PROP rather than for what the prop
          actually renders left a blank box, strictly worse than no fallback. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          background: `linear-gradient(150deg, color-mix(in srgb, ${accent} 42%, #12161a) 0%, #12161a 55%, #0c0f12 100%)`,
        }}
      >
        {fallback}
      </div>
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
          // broken-image glyph on screen with no way to recover. Y además se
          // apunta la ruta, para que ninguna otra tarjeta de la página la
          // vuelva a pedir.
          // Se apaga la foto YA (el socio ve el degradado, no un icono roto) y
          // por separado se comprueba si de verdad no está. Solo entonces se
          // anota, y solo entonces dejan de pedirla las demás tarjetas.
          onError={() => { setFailed(true); markDeadIfReallyGone(url); }}
        />
      )}
    </div>
  );
}

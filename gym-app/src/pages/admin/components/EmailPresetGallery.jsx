import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { emailDoc, PRESETS, PRESET_IDS } from '../../../lib/admin/emailEngine';

/**
 * Paso 1 del constructor: escoger la MAQUETA.
 *
 * Cada miniatura es el correo real renderizado por el motor y escalado, no un
 * dibujo aproximado. Es la diferencia entre escoger a ciegas y ver lo que vas a
 * mandar: el selector anterior enseñaba rayas grises y por eso nadie lo tocaba.
 *
 * Se renderiza dentro de un iframe con `sandbox=""` y se encoge con
 * `transform: scale()` en vez de con `zoom`, que Firefox no soporta. El iframe
 * se dibuja a tamaño completo (600px) y se escala — así la tipografía cae en
 * proporción y la miniatura se parece de verdad al resultado.
 */
/**
 * 632, no 600.
 *
 * La columna del correo mide 600, pero `buildEmail` la envuelve en 16px de aire
 * a cada lado (el `wrapBg` sobre el que flota el papel). En un iframe de 600 esa
 * envoltura no cabe: el correo salía desplazado a la izquierda y con el borde
 * derecho cortado. Se enseña el ancho COMPLETO de la envoltura.
 */
const TH_W = 632;

/**
 * Franja vertical que se enseña, medida — no estimada.
 *
 * El bloque más alto de las seis maquetas (contundente: cabecera 157 + portada
 * 221 + cuerpo 85 + relleno) termina en 490px. A 400 se cortaba el titular por
 * la mitad, que es lo que se lee como «esto está roto» y no como «esto sigue».
 * A 500 las seis caben enteras.
 */
const CROP = 500;

/**
 * Texto de muestra FIJO — nunca el de la plantilla.
 *
 * Comparar seis maquetas exige que lo único distinto sea la maqueta. Con el
 * contenido real las miniaturas cambiaban de alto y dejaban de ser comparables,
 * y —peor— en una plantilla recién creada están todos los campos vacíos: las
 * seis salían como un rectángulo beige idéntico. Un selector de estilos en el
 * que los seis estilos se ven igual no selecciona nada.
 *
 * La marca sí es la de verdad (nombre, logo, color): eso es lo que hace que la
 * miniatura se sienta tuya. Lo que se ve escrito es atrezo.
 */
const DEMO = {
  es: {
    header: 'Boletín',
    eyebrow: 'Esta semana',
    title: 'Te guardamos el sitio',
    subtitle: 'Tu rutina sigue donde la dejaste.',
    body: 'Llevas doce días seguidos. Una sesión más y entras en el top 10 del mes.',
  },
  en: {
    header: 'Newsletter',
    eyebrow: 'This week',
    title: 'We saved your spot',
    subtitle: 'Your routine is right where you left it.',
    body: 'Twelve days in a row so far. One more session puts you in this month’s top 10.',
  },
};

function PresetCard({ label, note, html, wrapBg, active, onClick }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(0);

  // La escala se MIDE, no se adivina.
  //
  // Estaba fija en 0.315: 189px de correo dentro de una tarjeta de 243, o sea
  // que el 22% de cada miniatura era relleno. Y el ancho de la tarjeta depende
  // del viewport y del número de columnas, así que NINGÚN número fijo puede ser
  // correcto en todos los tamaños.
  //
  // `useLayoutEffect` y no `useEffect`: mide antes de pintar, así no se ve un
  // fotograma con la miniatura a escala cero.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const apply = (w) => setScale(w > 0 ? w / TH_W : 0);
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      className="overflow-hidden rounded-xl text-left transition-all"
      style={{
        border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-admin-border)'}`,
        background: active ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-admin-panel)',
      }}
    >
      {/*
        El alto sale del ancho por `aspect-ratio`, no de un píxel fijo: con la
        escala midiéndose sola, un alto fijo volvería a dejar hueco —o cortaría
        de más— en cuanto cambiara el número de columnas. Así la franja del
        correo que se ve (`CROP`px) es la misma en todos los tamaños.

        Es un `div` en flujo normal dentro del grid, no un hijo de flex: aquí
        `aspect-ratio` no se lo come el `flex-shrink`.

        El fondo es el del propio correo, no un beige fijo: `contundente` monta
        sobre papel oscuro y un beige debajo se vería como una franja clara si el
        contenido no llegara al borde.
      */}
      <div
        ref={boxRef}
        style={{
          aspectRatio: `${TH_W} / ${CROP}`,
          overflow: 'hidden',
          position: 'relative',
          background: wrapBg,
        }}
      >
        <iframe
          title={label}
          srcDoc={html}
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          aria-hidden="true"
          style={{
            width: TH_W, height: CROP, border: 0, display: 'block',
            transform: `scale(${scale})`, transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div className="px-2.5 py-2">
        <div className="text-[12px] font-bold" style={{ color: active ? 'var(--color-accent)' : 'var(--color-admin-text)' }}>
          {label}
        </div>
        <div className="mt-0.5 text-[10.5px] leading-tight" style={{ color: 'var(--color-admin-text-faint)' }}>
          {note}
        </div>
      </div>
    </button>
  );
}

function EmailPresetGallery({ cfg, value, onChange, lang }) {
  // LAS DEPENDENCIAS SON CAMPOS SUELTOS, NO `cfg` NI `cfg.brand`.
  //
  // El editor rehace `cfg` —y dentro `brand`, que es un objeto literal nuevo—
  // en cada pulsación de tecla. Con `[cfg]` las seis miniaturas se rearmaban por
  // carácter. Construir los seis HTML cuesta 0,07 ms, así que el coste no era
  // ese: era destruir y reparsear SEIS contextos de navegación en el hilo
  // principal, más el de la vista previa.
  //
  // Con el texto de muestra fijo, esto ya solo se rearma si cambia la marca o el
  // idioma. Escribir el correo no toca la galería en absoluto.
  const { name, monogram, accent, logoUrl } = cfg.brand || {};
  const htmls = useMemo(() => {
    const d = DEMO[lang] || DEMO.es;
    const sample = {
      lang,
      brand: { name, monogram, accent, logoUrl },
      density: 'comodo',
      fontScale: 15,
      device: 'desktop',
      header: { on: true, showLogo: true, text: d.header },
      hero: { on: true, eyebrow: d.eyebrow, title: d.title, subtitle: d.subtitle },
      body: { on: true, text: d.body },
      footer: { on: false },
      reward: { on: false },
      cta: { on: false },
    };
    // `emailDoc` y no `buildEmail`: es el documento COMPLETO, el mismo que se
    // envía. Trae `body{margin:0}`, sin el cual el margen por defecto de 8px
    // del iframe descentraba el correo y le comía el borde derecho.
    return Object.fromEntries(PRESET_IDS.map((id) => {
      try { return [id, emailDoc({ ...sample, preset: id })]; }
      catch { return [id, '']; }
    }));
  }, [lang, name, monogram, accent, logoUrl]);

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {PRESET_IDS.map((id) => {
        const p = PRESETS[id];
        return (
          <PresetCard
            key={id}
            label={p.label[lang] || id}
            note={p.note[lang] || ''}
            html={htmls[id] || ''}
            wrapBg={p.onDark ? '#07090B' : '#E9E5DC'}
            active={value === id}
            onClick={() => onChange(id)}
          />
        );
      })}
    </div>
  );
}

// `memo`: el editor reconstruye `cfg` en cada tecla. Sin esto la galería se
// re-renderiza entera aunque sus props efectivas no hayan cambiado.
export default memo(EmailPresetGallery);

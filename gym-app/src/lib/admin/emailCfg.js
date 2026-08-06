/**
 * Puente entre la plantilla guardada y el motor de correo.
 *
 * La fila de `gym_email_templates` tiene la forma vieja de bloques
 * (`{header, hero, body, cta, reward, footer, colors, typography}`), y el motor
 * v2 quiere `{brand, preset, density, fontScale, …}`. Este adaptador traduce en
 * los dos sentidos.
 *
 * Existe para NO migrar la base de datos: las plantillas que ya están guardadas
 * abren y se envían igual, y lo nuevo (`preset`, `eyebrow`, `dest`) vive dentro
 * del mismo JSONB. Una migración de datos aquí habría sido irreversible y sin
 * ninguna ganancia.
 */
import { appDeepLink, gymShareUrl } from '../appUrls';
import { PRESETS, PRESET_IDS } from './emailEngine';

/** Destinos que el botón puede tomar, y a dónde va cada uno de verdad. */
export const CTA_DESTS = [
  { v: 'app', section: 'home' },
  { v: 'plan', section: 'workout' },
  { v: 'clase', section: 'classes' },
  { v: 'tienda', section: 'rewards' },
  { v: 'web', section: null },
];

export const destUrl = (dest, gymUrl) => {
  const d = CTA_DESTS.find((x) => x.v === dest);
  if (!d || !d.section) return gymUrl || '';
  return appDeepLink(d.section);
};

/** Qué destino representa una URL guardada — para reabrir el selector. */
export function destFromUrl(url, gymUrl) {
  const s = String(url || '');
  const m = s.match(/\/invite\/go\/([a-z]+)$/i);
  if (m) {
    const hit = CTA_DESTS.find((d) => d.section === m[1].toLowerCase());
    if (hit) return hit.v;
    // El editor ofrece ONCE secciones de app y esta lista nombra CUATRO. Las
    // otras siete caían en 'web', y con eso el motor dejaba de pintar la
    // leyenda honesta «abre la app si la tienes» y la etiqueta caía en «Ver
    // más». Cualquier enlace profundo de la app es un destino de app.
    return 'app';
  }
  if (gymUrl && s === gymUrl) return 'web';
  return s ? 'web' : 'app';
}

const firstPreset = (v) => (PRESET_IDS.includes(v) ? v : 'editorial');

const DENSITIES = ['compacto', 'comodo', 'espacioso'];

/** Densidad del correo, aceptando la forma nueva y los píxeles de la vieja. */
function densityOf(d) {
  if (DENSITIES.includes(d.density)) return d.density;
  const px = Number(d.typography?.padding);
  if (DENSITIES.includes(d.typography?.padding)) return d.typography.padding;
  if (Number.isFinite(px)) {
    if (px <= 26) return 'compacto';
    if (px >= 46) return 'espacioso';
  }
  return 'comodo';
}

/**
 * Plantilla guardada → cfg del motor.
 *
 * `brand` NO sale de la plantilla sino del gimnasio: es la promesa del white
 * label. Guardar el color de marca dentro de cada plantilla es lo que hacía que
 * cambiar de colores dejara plantillas viejas con la paleta anterior.
 */
export function templateToCfg(tpl, opts = {}) {
  const d = tpl || {};
  const t = d.typography || {};
  const gymUrl = opts.gymUrl || '';
  return {
    lang: opts.lang === 'en' ? 'en' : 'es',
    preset: firstPreset(d.preset),
    // El espaciado sale del panel Avanzado. `typography.padding` guardaba píxeles
    // ('24'|'32'|'40'|'48') del renderizador v1; el motor v2 trabaja con tres
    // densidades. Se aceptan las dos formas para no romper lo ya guardado.
    density: densityOf(d),
    // Las esquinas también venían del panel y no las leía NADIE: el motor caía
    // siempre al radio del preset. Se guardaban, se recargaban intactas, y no
    // pintaban nada — la misma clase de bug que `preset`, girada.
    radius: Number.isFinite(Number(t.borderRadius)) && String(t.borderRadius) !== ''
      ? Math.max(0, Math.min(28, Number(t.borderRadius)))
      : undefined,
    // `fontSize` es la clave que el editor escribe de verdad. `fontScale` solo
    // la escribia cfgToTemplateData, que nunca se llamo — asi que la previa se
    // quedaba en 15px para siempre mientras el correo enviado si cambiaba.
    fontScale: Number(t.fontScale) || Number(t.fontSize) || Number(d.fontScale) || 15,
    device: opts.device || 'desktop',
    brand: {
      name: opts.gymName || '',
      monogram: (opts.gymName || '??').replace(/[^A-Za-zÁÉÍÓÚÑ]/g, '').slice(0, 2).toUpperCase() || '??',
      accent: opts.accent || d.colors?.primary || '#19B8B8',
      logoUrl: opts.gymLogoUrl || '',
    },
    subject: d.subject || '',
    preheader: d.preheader || '',
    header: {
      on: d.header?.enabled !== false,
      showLogo: d.header?.showLogo !== false,
      text: d.header?.text || '',
    },
    // `hero.on` se DERIVA del contenido, no del interruptor.
    //
    // El chip "Portada con foto" escribe `hero.enabled`, y al mover el titular
    // y la bajada al paso 2 quedaron colgando de esa misma bandera — que nace
    // en false. Resultado: escribías titular y bajada y no salían por ningún
    // lado, porque el renderizador aborta antes de llegar a ellos.
    //
    // Ahora el interruptor significa solo "quiero foto de portada", y el hero
    // se muestra si hay ALGO que mostrar. Escribir un titular lo hace aparecer,
    // que es lo único que un editor puede hacer sin sorprender.
    hero: {
      on: !!(d.hero?.headline || d.hero?.subtitle || d.hero?.eyebrow
             || d.hero?.imageUrl || d.hero?.enabled),
      imageUrl: d.hero?.imageUrl || '',
      // El marcador a rayas es SOLO del editor. En un envío real jamás.
      imagePlaceholder: !!opts.allowPlaceholder && !d.hero?.imageUrl && !!d.hero?.enabled,
      eyebrow: d.hero?.eyebrow || '',
      title: d.hero?.headline || '',
      subtitle: d.hero?.subtitle || '',
    },
    body: { on: true, text: d.body?.text || '' },
    reward: {
      on: !!d.reward?.enabled,
      label: d.reward?.label || (opts.lang === 'en' ? 'Your reward' : 'Tu recompensa'),
      title: d.reward?.title || '',
      desc: d.reward?.description || '',
      // El código REAL es individual y lo genera el enviador
      // (grant_email_campaign_reward, mig 0694) en el momento del envío: uno
      // distinto por miembro, ligado a su fila de earned_rewards. Aquí no hay
      // ninguno porque aquí no hay miembro.
      //
      // En la vista previa se enseña uno de muestra —con su QR— para que el
      // bloque se vea completo. Sin él el admin veía un recuadro a medias y
      // concluía, con razón, que faltaba el QR.
      // `codeToken`: el camino de campaña. El código es POR MIEMBRO y el HTML
      // se monta una sola vez, así que viaja como token y lo sustituye el
      // enviador tras conceder. Sin esto la tarjeta salía con título y
      // descripción y NADA que enseñar en recepción.
      code: opts.codeToken ? '{{reward_code}}'
        : (d.reward?.code || (opts.sampleCode ? 'A1B2C3D4E5' : '')),
      // Canjeable solo en la vista previa (código de muestra) o cuando el
      // enviador lo concedió. Un código de texto libre no tiene fila en
      // earned_rewards y su QR devolvería "no encontrada" en recepción.
      scannable: !!opts.sampleCode || !!opts.codeToken,
      expires: d.reward?.expiry || '',
    },
    cta: {
      on: !!d.cta?.enabled,
      label: d.cta?.text || '',
      dest: d.cta?.dest || destFromUrl(d.cta?.url, gymUrl),
      url: d.cta?.url || destUrl(d.cta?.dest || 'app', gymUrl),
      color: d.cta?.color || '',
    },
    footer: {
      on: d.footer?.enabled !== false,
      text: d.footer?.text || '',
      address: opts.gymAddress || d.footer?.address || '',
      unsub: d.footer?.unsubscribeText || '',
      unsubUrl: opts.unsubscribeUrl || '',
    },
    strings: opts.strings,
  };
}

// `cfgToTemplateData` vivio aqui y se borro.
//
// Era la mitad de ESCRITURA de este adaptador y nunca se conecto: cero
// llamadores. Se leia como "el camino de guardado nuevo" y no lo era, y esa
// asimetria —lectura enganchada, escritura huerfana— es la causa raiz de que
// `preset` no persistiera y de que media docena de campos que `templateToCfg`
// lee no los escribiera nadie.
//
// El guardado va por `templateToDbPayload` (emailTemplateRenderer.js), que ya
// persiste `preset` y `density`. Una sola direccion, enganchada.

export { PRESETS, gymShareUrl };

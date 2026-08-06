/**
 * Temas con nombre para el editor de plantillas de correo.
 *
 * POR QUÉ EXISTE ESTO
 *
 * El editor ofrecía seis perillas sueltas — tres selectores de color y tres
 * números (tamaño de letra, radio, relleno) — y esperaba que el dueño de un
 * gimnasio diseñara un correo con ellas. No es diseñador. El resultado
 * previsible, y el que se ve, es que todo el mundo se queda con el default y
 * todos los correos salen iguales y sosos.
 *
 * Un tema es esa misma decisión ya tomada y coordinada: color + tipografía +
 * estilo de cabecera que van juntos, aplicados de un clic, con el color de
 * marca del gimnasio inyectado solo. Es MENOS decisión, no más aplicación. Las
 * perillas siguen existiendo detrás de "Avanzado" para quien las quiera.
 *
 * LÍMITE REAL QUE MARCA EL DISEÑO DE ESTOS TEMAS
 *
 * La tarjeta del correo está fijada a blanco en el renderizador
 * (emailTemplateRenderer.js:150, `background:#ffffff`), y `colors.background`
 * solo pinta la página que rodea a esa tarjeta. O sea: el texto del cuerpo
 * SIEMPRE cae sobre blanco.
 *
 * Por eso aquí no hay tema oscuro. Uno "premium oscuro" tendría que poner
 * `text` claro, y ese texto claro se pintaría sobre la tarjeta blanca: texto
 * ilegible en el correo de verdad mientras la vista previa del editor —que usa
 * el mismo renderizador— lo enseñaría igual de roto sin explicar por qué.
 * Ofrecer un tema que produce un correo ilegible es peor que no ofrecerlo. El
 * catálogo de diseños (emailDesignerTemplates.js) sí tiene "Dark premium",
 * porque ese sí controla su documento entero.
 */

// ── Mezcla de color (pura, sin DOM — corre en los tests) ─────────────
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}/.test(h)) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function rgbToHex({ r, g, b }) {
  const t = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + t(r) + t(g) + t(b);
}

/** Mezcla `hex` con blanco. `amt` 0 = el color, 1 = blanco. */
export function tint(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return '#ffffff';
  const t = clamp(amt, 0, 1);
  return rgbToHex({
    r: c.r + (255 - c.r) * t,
    g: c.g + (255 - c.g) * t,
    b: c.b + (255 - c.b) * t,
  });
}

/** Normaliza a #rrggbb, o devuelve el sustituto si no es un hex usable. */
export function normalizeHex(hex, fallback = '#D4AF37') {
  const c = hexToRgb(hex);
  return c ? rgbToHex(c) : fallback;
}

/**
 * Los temas. Cada uno recibe el color de marca del gimnasio y devuelve
 * { colors, cta, typography } COMPLETO — nunca parcial, para que aplicar un
 * tema deje la plantilla en un estado conocido en vez de heredar restos del
 * anterior. La forma es deliberadamente la misma que la de la plantilla, así
 * que aplicarlo es un merge y detectarlo es una comparación directa.
 *
 * `headerStyle` solo admite gradient | solid | minimal: son los tres que el
 * renderizador sabe pintar (emailTemplateRenderer.js:106). Cualquier otro valor
 * cae a 'gradient', así que no se ofrece ninguno más.
 */
export const EMAIL_THEMES = [
  {
    id: 'brand',
    label: { es: 'Marca', en: 'Brand' },
    hint: { es: 'Cabecera en degradado con tu color', en: 'Gradient header in your color' },
    build: (accent) => ({
      colors: { primary: accent, background: '#F5F5F7', text: '#333333' },
      cta: { color: accent },
      typography: { fontSize: '15', borderRadius: '12', padding: '40', headerStyle: 'gradient' },
    }),
  },
  {
    id: 'clean',
    label: { es: 'Limpio', en: 'Clean' },
    hint: { es: 'Parece un correo personal, no una campaña', en: 'Reads like a personal email, not a campaign' },
    build: (accent) => ({
      colors: { primary: accent, background: '#FFFFFF', text: '#1F2937' },
      cta: { color: accent },
      typography: { fontSize: '15', borderRadius: '8', padding: '40', headerStyle: 'minimal' },
    }),
  },
  {
    id: 'editorial',
    label: { es: 'Editorial', en: 'Editorial' },
    hint: { es: 'Fondo crema, esquinas rectas, letra grande', en: 'Cream page, square corners, larger type' },
    build: (accent) => ({
      colors: { primary: accent, background: '#F0EEE9', text: '#0B0F12' },
      cta: { color: accent },
      typography: { fontSize: '16', borderRadius: '0', padding: '48', headerStyle: 'solid' },
    }),
  },
  {
    id: 'bold',
    label: { es: 'Contundente', en: 'Bold' },
    hint: { es: 'Cabecera sólida y texto grande — para avisos', en: 'Solid header, big type — for announcements' },
    build: (accent) => ({
      colors: { primary: accent, background: tint(accent, 0.88), text: '#111827' },
      cta: { color: accent },
      typography: { fontSize: '17', borderRadius: '0', padding: '32', headerStyle: 'solid' },
    }),
  },
  {
    id: 'soft',
    label: { es: 'Suave', en: 'Soft' },
    hint: { es: 'Aireado, esquinas muy redondas', en: 'Airy, very round corners' },
    build: (accent) => ({
      colors: { primary: accent, background: tint(accent, 0.94), text: '#374151' },
      cta: { color: accent },
      typography: { fontSize: '15', borderRadius: '20', padding: '48', headerStyle: 'minimal' },
    }),
  },
  {
    id: 'compact',
    label: { es: 'Compacto', en: 'Compact' },
    hint: { es: 'Denso — para resúmenes con mucho dato', en: 'Dense — for data-heavy digests' },
    build: (accent) => ({
      colors: { primary: accent, background: '#F5F5F7', text: '#333333' },
      cta: { color: accent },
      typography: { fontSize: '14', borderRadius: '8', padding: '24', headerStyle: 'gradient' },
    }),
  },
];

export const themeById = (id) => EMAIL_THEMES.find((th) => th.id === id) || null;

/** El tema resuelto para un gimnasio, listo para volcar en la plantilla. */
export function buildTheme(id, accent) {
  const th = themeById(id);
  return th ? th.build(normalizeHex(accent)) : null;
}

/**
 * Qué tema tiene puesto una plantilla, o 'custom'.
 *
 * Se deriva de los valores guardados en vez de guardar un `theme_id`: así las
 * plantillas que ya existen abren en el tema que les corresponde sin migración
 * ninguna, y una plantilla que alguien retocó a mano se identifica como
 * 'custom' en vez de mentir diciendo que sigue en un tema del que ya se salió.
 *
 * La comparación ignora mayúsculas en los hex (un `#d4af37` guardado por el
 * selector de color nativo es el mismo tema que `#D4AF37`) y trata los números
 * como cadenas, que es como los escribe el editor.
 */
export function detectTheme(template, accent) {
  if (!template) return 'custom';
  const c = template.colors || {};
  const ty = template.typography || {};
  const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

  for (const th of EMAIL_THEMES) {
    const built = th.build(normalizeHex(accent));
    // El color del botón vive en `cta.color`, no en `colors`. Entra en la
    // comparación porque el tema lo fija: sin él, un botón cian sobre un
    // correo de marca roja contaba como "tema aplicado" y era justo lo que
    // rompía la coherencia que el tema promete.
    const sameColors = eq(c.primary, built.colors.primary)
      && eq(c.background, built.colors.background)
      && eq(c.text, built.colors.text)
      && eq(template.cta?.color, built.cta.color);
    const sameType = eq(ty.fontSize, built.typography.fontSize)
      && eq(ty.borderRadius, built.typography.borderRadius)
      && eq(ty.padding, built.typography.padding)
      && eq(ty.headerStyle, built.typography.headerStyle);
    if (sameColors && sameType) return th.id;
  }
  return 'custom';
}

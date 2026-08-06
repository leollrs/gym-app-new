/**
 * Lo que una plantilla DICE, en dos líneas.
 *
 * La lista de plantillas enseñaba nombre y categoría y nada más, así que para
 * saber qué decía «Recuperación» había que abrirla. Con doce prefabricadas eso
 * son doce viajes de ida y vuelta para escoger una.
 *
 * Por qué texto y no una miniatura del correo: a lo ancho de una fila de la
 * lista, un correo de 600px escalado deja la tipografía en dos píxeles — se ve
 * la FORMA pero no se lee ni una palabra, y aquí la pregunta es «qué dice»,
 * no «cómo se ve». La forma ya se escoge en el paso 1 del editor, donde la
 * miniatura sí tiene sitio para leerse.
 */
import { fillTokens } from './emailEngine';

/** Un saludo de apertura: primera línea corta que acaba en coma. */
const GREETING = /^.{0,44},\s*$/;

/**
 * El cuerpo, legible.
 *
 * Se quitan el saludo, los separadores de sección (`--Título--`) y los guiones
 * de viñeta, y los tokens se rellenan con los valores de muestra — los mismos
 * que la vista previa. «Llevas {{streak_count}} días» no dice nada de un
 * vistazo, y encima delata la maquinaria.
 */
function readableBody(text, gymName) {
  const filled = fillTokens(String(text || ''), { brand: { name: gymName || '' } });
  const lines = filled.split('\n').map((l) => l.trim());
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (/^--\s*.+\s*--$/.test(l)) continue;            // separador de sección
    if (kept.length === 0 && GREETING.test(l)) continue; // «Hola José,»
    kept.push(l.replace(/^[-•]\s*/, ''));
  }
  return kept.join(' ');
}

/** Para comparar títulos: sin acentos, sin puntuación, sin mayúsculas. */
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clamp(s, max) {
  const str = String(s || '').replace(/\s+/g, ' ').trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:—-]$/, '')}…`;
}

/**
 * `{ title, body }` para enseñar en la tarjeta. Los dos pueden salir vacíos:
 * una plantilla recién creada no dice nada todavía, y la tarjeta tiene que
 * saber no pintar una línea en blanco.
 */
export function templateExcerpt(tpl, opts = {}) {
  const d = tpl || {};
  // El titular se calla cuando repite el nombre de la plantilla, que la tarjeta
  // ya enseña justo encima. Pasa de verdad —«Recordatorio de Clase» se llama
  // igual que su titular— y ahí la línea extra no añade nada: gasta el hueco
  // que le tocaba al cuerpo.
  const dedupe = (title) => (
    norm(title) && norm(title) === norm(opts.name) ? '' : title
  );
  // Un diseño de la galería no tiene bloques: su texto es el asunto y la línea
  // de vista previa que se guardaron al adoptarlo.
  if (d.designer_id) {
    return {
      title: dedupe(clamp(d.designer_subject || '', 68)),
      body: clamp(d.designer_preview || '', 120),
    };
  }
  const gymName = opts.gymName || '';
  // El titular del correo, y si no hay, el rótulo de la cabecera. La tarjeta
  // pinta lo que venga y se salta lo vacío.
  return {
    title: dedupe(clamp(fillTokens(d.hero?.headline || d.header?.text || '', { brand: { name: gymName } }), 68)),
    body: clamp(readableBody(d.body?.text, gymName), 120),
  };
}

/**
 * Sustitución de merge tags para el envío de campañas.
 *
 * Vive aquí y se copia literal a Deno porque la hacen DOS sitios: el navegador
 * (envío inmediato) y la cola en servidor (cuando la pestaña ya no está). Dos
 * implementaciones escritas por separado es exactamente lo que ya nos costó un
 * día entero entre la vista previa y el enviador.
 *
 * QUÉ LÍNEAS SE TIRAN Y CUÁLES NO.
 *
 * La versión anterior no tiraba ninguna, con este razonamiento: el texto lo
 * escribió un admin a mano, así que borrarle una línea por llevar llaves es peor
 * que dejar pasar un token literal. El razonamiento era bueno pero la premisa
 * era falsa — decía «aquí no hay ese conocimiento», y sí lo hay: `KNOWN_TOKENS`
 * es la lista de los que la plataforma documenta.
 *
 * Así que se discrimina: una línea con un token CONOCIDO que no resuelve se cae
 * entera; unas llaves cualesquiera que el admin escribiera se quedan intactas.
 * Eso cierra el agujero que abrió cambiar los corchetes de la prefabricada de
 * clase por tokens de verdad — en el envío manual nadie rellena
 * `{{next_class_name}}`, y sin esto le llegaba literal al buzón.
 *
 * PERO SOLO EN TEXTO PLANO. Sobre el HTML prerenderizado NO se tira nada: el
 * motor emite el documento entero SIN UN SOLO salto de línea (medido: cero), así
 * que "la línea" es el correo completo y una sola llave sin resolver lo borraría
 * del todo. Ahí un token sin valor se queda literal — feo, pero acotado.
 *
 * Sin dependencias y sin DOM: `scripts/sync-email-engine.mjs` genera la copia.
 */

/** Escapa para HTML. Solo se aplica en el camino del correo. */
export function escOutreach(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Los tokens que la plataforma documenta y rellena en ALGÚN camino.
 *
 * Es la lista que decide si una línea se cae. Un token de aquí sin valor
 * significa "iba a decir algo y no lo sabe"; cualquier otra llave es texto del
 * admin y se respeta.
 */
export const KNOWN_TOKENS = [
  'member_name', 'full_name', 'first_name', 'name', 'gym_name', 'coach_name',
  'streak_count', 'workout_count', 'days_inactive',
  'next_class_name', 'next_class_date', 'next_class_time', 'next_class_instructor',
  'next_class_url', 'today_plan_name', 'today_plan_url', 'last_class_name',
  'classes_url', 'checkin_url', 'app_url', 'unsubscribe_url', 'reward_code',
];

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** El mapa completo de valores para un destinatario. */
function valuesFor(ctx) {
  const c = ctx || {};
  const fullName = c.fullName || '';
  const s = c.stats || {};
  const out = {};
  // Lo que venga del servidor primero (next_class_*, today_plan_*, …), y encima
  // lo que sabemos calcular aquí.
  for (const k in s) if (s[k] != null && String(s[k]).trim() !== '') out[k.toLowerCase()] = String(s[k]);
  out.member_name = fullName;
  out.full_name = fullName;
  out.name = fullName;
  out.first_name = fullName.split(' ')[0] || '';
  out.gym_name = c.gymName || '';
  out.coach_name = c.coachName || c.gymName || '';
  if (out.streak_count == null) out.streak_count = '0';
  if (out.workout_count == null) out.workout_count = '0';
  if (out.days_inactive == null) out.days_inactive = '—';
  return out;
}

/** ¿Esta línea lleva un token CONOCIDO que no resuelve? */
function lineIsDead(line, vals) {
  const found = String(line || '').match(TOKEN_RE);
  if (!found) return false;
  return found.some((m) => {
    const k = m.replace(/[{}\s]/g, '').toLowerCase();
    if (!KNOWN_TOKENS.includes(k)) return false;   // llaves del admin: se respetan
    const v = vals[k];
    return v == null || String(v).trim() === '';
  });
}

/**
 * Rellena los tokens de una campaña.
 *
 * `escape` va en true SOLO para el HTML del correo. El texto plano de push, SMS
 * y notificación no se escapa: ahí `&amp;` se leería tal cual. Y sin escapar en
 * el HTML, un miembro cuyo nombre lleve marcado (`<img onerror=…>`) inyecta
 * HTML activo en el correo que recibe.
 */
export function renderOutreachTokens(raw, ctx) {
  if (!raw) return '';
  const vals = valuesFor(ctx);
  const isHtml = !!(ctx && ctx.escape);
  const esc = isHtml ? escOutreach : ((x) => x);
  return String(raw)
    .split('\n')
    // `isHtml ||`: ver la cabecera. Sobre el HTML el documento va en UNA línea,
    // así que filtrar aquí lo borraría entero.
    .filter((line) => isHtml || !lineIsDead(line, vals))
    .map((line) => line.replace(TOKEN_RE, (m, key) => {
      const k = String(key).toLowerCase();
      const v = vals[k];
      // Un token desconocido, o conocido pero sin valor en una línea que
      // sobrevivió (porque llevaba además texto), se queda como está: mejor una
      // llave visible que una frase mutilada.
      return v == null || String(v).trim() === '' ? m : esc(String(v));
    }))
    .join('\n');
}

// Alcance real — cuántos RECIBEN, no cuántos caen en el grupo.
//
// El resumen viejo repetía la audiencia y los canales que acababas de elegir
// tres centímetros a la izquierda, y callaba lo único que no puedes deducir:
// que de esos 96 miembros, 24 no tienen push, 11 no dieron teléfono y 3 se
// dieron de baja de promocionales. Eso se descubría DESPUÉS de enviar, en el
// recuento de fallidos.
//
// Los hechos se piden UNA VEZ POR GIMNASIO, no por audiencia: quién tiene push
// y quién consiente correo no cambia al cambiar el filtro, así que cambiar de
// audiencia recalcula en memoria en vez de volver a la red.
import { supabase } from '../supabase';
import { selectAllRows } from '../churn/batchedSelect.js';
import logger from '../logger';

// ── NUNCA devuelvas un Set desde un queryFn ────────────────────────────────
// La caché de React Query se persiste a localStorage (24 h, ver main.jsx), y
// `JSON.stringify(new Set([...]))` da `{}`. Al rehidratar, lo que era un Set es
// un objeto vacío sin `.has`, y `computeReach` revienta la página entera con
// «facts.push.has is not a function» — no en la primera carga, sino al volver.
// Por eso esto viaja como ARRAYS y los Sets se arman en el consumidor.
export async function fetchReachFacts(gymId) {
  const empty = { pushIds: [], emailOkIds: [] };
  if (!gymId) return empty;

  try {
    const [tokens, profiles] = await Promise.all([
      selectAllRows((from, to) => supabase
        .from('push_tokens')
        .select('id, profile_id')
        .eq('gym_id', gymId)
        .order('id')
        .range(from, to)),
      selectAllRows((from, to) => supabase
        .from('profiles')
        .select('id, notif_email_enabled')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .order('id')
        .range(from, to)),
    ]);

    return {
      pushIds: [...new Set((tokens.data || []).map(r => r.profile_id))],
      // El interruptor MAESTRO de consentimiento (mig 0685). NO es lo mismo que
      // «tiene dirección»: la dirección vive en auth.users y el cliente no la
      // ve. Lo que falte —sin correo utilizable, o en la lista de rebotes— lo
      // descuenta el servidor al enviar con email_allowed_for, y por eso la
      // tarjeta lo dice en vez de fingir un número exacto.
      emailOkIds: (profiles.data || [])
        .filter(p => p.notif_email_enabled !== false)
        .map(p => p.id),
    };
  } catch (err) {
    // Sin hechos la tarjeta se calla; nunca inventa.
    logger.error('outreach reach facts failed:', err);
    return empty;
  }
}

/**
 * Arrays (lo que sobrevive a localStorage) → Sets (lo que necesita el cálculo).
 * Tolera la forma rehidratada rota por si quedó algo en la caché de alguien.
 */
export function toReachSets(raw) {
  const set = (v) => (Array.isArray(v) ? new Set(v) : v instanceof Set ? v : new Set());
  return { push: set(raw?.pushIds), emailOk: set(raw?.emailOkIds) };
}

// El orden en que se enseñan, no el de los toggles.
export const REACH_CHANNELS = ['push', 'inApp', 'email', 'sms'];

/** ¿Alcanza este canal a este miembro? */
function reaches(channel, member, facts) {
  if (channel === 'push') return facts.push.has(member.id);
  if (channel === 'sms') return !!member.phone;
  if (channel === 'email') return facts.emailOk.has(member.id);
  // In-app es una fila en la base: le llega a cualquiera que abra la app.
  return true;
}

/**
 * @returns {{ total, per: {push,inApp,email,sms}, unique, messages, missing: [{channel, count}] }}
 *   `unique`   — personas distintas que reciben AL MENOS un mensaje
 *   `messages` — mensajes totales (una persona por dos canales cuenta dos)
 */
export function computeReach(recipients = [], facts, channels = {}) {
  const active = REACH_CHANNELS.filter(c => channels[c]);
  const per = {};
  for (const c of REACH_CHANNELS) {
    per[c] = recipients.filter(m => reaches(c, m, facts)).length;
  }

  const unique = active.length
    ? recipients.filter(m => active.some(c => reaches(c, m, facts))).length
    : 0;
  const messages = active.reduce((n, c) => n + per[c], 0);

  const missing = active
    .map(c => ({ channel: c, count: recipients.length - per[c] }))
    .filter(x => x.count > 0);

  return { total: recipients.length, per, unique, messages, missing, active };
}

// ── SMS: lo único que se cobra ────────────────────────────────────────────
// Twilio parte el cuerpo cada 160 caracteres y cobra cada trozo. Escribir 30
// caracteres de más duplica la factura, y hasta ahora eso no se veía por
// ninguna parte hasta la siguiente factura.
export const SMS_SEGMENT_CHARS = 160;
export const SMS_COST_PER_SEGMENT = 0.0125;
export const PUSH_PREVIEW_CHARS = 120;

export const smsSegments = (body = '') => Math.max(1, Math.ceil((body.length || 1) / SMS_SEGMENT_CHARS));
export const smsCost = (recipientsWithPhone, body) => recipientsWithPhone * smsSegments(body) * SMS_COST_PER_SEGMENT;

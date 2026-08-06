import { supabase, authHeader } from '../supabase';
import { sendNotification } from '../notifications';
import logger from '../logger';
import { logAdminAction } from '../adminAudit';
import { fetchMemberStats, tokensNeeded } from './outreachPersonalization';
import { renderOutreachTokens } from './outreachTokens';

// ── Batch dispatch tuning ──────────────────────────────────────────────────
// Email/SMS each go out as one edge-function invoke per recipient. Firing the
// whole audience at once (the old `Promise.allSettled(recipients.map(…))`) bursts
// past the email/SMS providers' concurrency + the edge runtime's limits, so a
// large batch sends to the first few then 502/500s the rest — even though every
// call works on its own. We cap in-flight recipients and pace each worker so the
// blast behaves like a steady stream of the known-good individual sends.
const OUTREACH_CONCURRENCY = 4;   // max recipients processed simultaneously
const OUTREACH_PACE_MS = 150;     // gap between sends within a single worker
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Reintento ──────────────────────────────────────────────────────────────
// Un 429 del PROVEEDOR es pasajero por definición: significa "vas muy rápido".
// Antes se contaba como fallo y ese miembro no recibía nada nunca — sin cola,
// sin reintento y sin dejar rastro de por qué, porque `logger.warn` es no-op en
// producción. Tres intentos con espera creciente cubren de sobra un pico.
const RETRY_MAX = 3;
const RETRY_BASE_MS = 1200;

/**
 * Qué ha pasado de verdad, leyendo el cuerpo del error UNA sola vez.
 *
 * `err.context` es un Response y `.json()` lo consume, así que hay que sacar
 * todo de una pasada: el estado de la función y el del proveedor, que NO son el
 * mismo. Un límite de Resend llega como 502 con `providerStatus: 429` dentro
 * (send-admin-email:800-803); el tope horario del admin llega como 429 con
 * `error: 'admin_hourly_limit_exceeded'`.
 */
async function readFailure(err) {
  const out = { status: err?.context?.status ?? 0, code: '', providerStatus: 0 };
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      out.code = body?.error || body?.message || '';
      out.providerStatus = Number(body?.providerStatus) || 0;
    }
  } catch { /* sin cuerpo, ya consumido, o no es JSON */ }
  if (!out.code) out.code = err?.message || 'unknown';
  return out;
}

/** Pasajero: reintentar tiene sentido. */
const isTransient = (f) => f.providerStatus === 429 || f.status === 503 || f.status === 502;

/**
 * Fatal para TODO el lote, no solo para este destinatario.
 *
 * El tope horario por admin y una sesión muerta van a fallar exactamente igual
 * en los 400 que quedan. Seguir adelante no envía ni uno más: solo convierte un
 * problema legible («llegaste al tope, faltan 400») en 400 fallos mudos.
 */
const isBatchFatal = (f) => (
  f.code === 'admin_hourly_limit_exceeded'
  || f.status === 401
  || f.code === 'Unauthorized'
);

/**
 * Single send pipeline used by the unified Outreach composer. Given a resolved
 * recipient list and per-channel content, fans out to each enabled channel
 * (push, email, SMS, in-app), tallies successes/failures per channel, and
 * records one row in `admin_audit_log` for the whole batch so the gym has a
 * paper trail.
 *
 * Channels:
 *  - push:  routes through `sendNotification` (in-app row + native push)
 *  - email: invokes the `send-admin-email` edge function once per recipient
 *  - sms:   invokes the `send-sms` edge function once per recipient
 *  - inApp: a row in `notifications` only — no native push (use this when
 *           the message is informational and quiet hours matter less)
 */
export async function sendOutreach({
  gymId,
  recipients,            // [{ id, full_name, email, phone }]
  channels,              // { push, email, sms, inApp }
  subject,               // string (email)
  body,                  // string (all channels)
  html = null,           // optional pre-rendered email HTML (designer templates).
                         // When set, it's sent as the email body (merge tags
                         // inside it are personalized per recipient) instead of
                         // wrapping `body` in a <p>. Push/SMS/in-app still use `body`.
  personalize = {},      // gym-level constants for designer-template tokens:
                         // { gymName, coachName }. Per-recipient stats
                         // (streak_count/workout_count/days_inactive) are
                         // fetched here when their tokens appear in the copy.
  templateKey = null,    // optional — recorded in the audit log
  audienceLabel = '',    // human-readable description for the audit log
}) {
  const results = {
    push: { sent: 0, failed: 0 },
    // `reasons` agrupa los fallos por causa. Sin esto el resumen decía "12
    // fallidos" y nada más: un tope de envío, un buzón rebotado y una sesión
    // caducada se veían idénticos, y como `logger.warn` es no-op en producción
    // no quedaba rastro en ningún sitio.
    email: { sent: 0, failed: 0, retried: 0, reasons: {} },
    sms: { sent: 0, failed: 0, retried: 0, reasons: {} },
    inApp: { sent: 0, failed: 0 },
    skipped: { noEmail: 0, noPhone: 0, optedOut: 0 },
    // Se rellena si el lote se corta: qué pasó y a quién NO le llegó, para
    // poder reintentar solo con esos en vez de volver a mandarle a todos.
    aborted: null,
    pending: [],
  };

  if (!recipients?.length) return results;

  // The email + SMS edge functions are deployed verify_jwt=on: a request that
  // reaches the gateway without a valid `Authorization` JWT is bounced with an
  // opaque `UNAUTHORIZED_NO_AUTH_HEADER` 401 before the function runs. Resolve
  // one fresh token for the whole batch up front (refreshing a lapsed access
  // token via the still-valid refresh token). If the session is truly dead this
  // throws SESSION_EXPIRED — fail the batch with a clear "sign in again" rather
  // than silently tallying every recipient as a failed send.
  const batchAuthHeader = (channels.email || channels.sms) ? await authHeader() : null;

  // Pre-fetch per-recipient stats once for the whole audience, but only for the
  // stat tokens this particular send actually references. Cheap (streak_cache /
  // last_active_at) plus a heavier completed-sessions count when needed.
  const statTokens = tokensNeeded(subject, body, html);
  const statsMap = statTokens.length
    ? await fetchMemberStats(gymId, recipients.map((r) => r.id), statTokens)
    : {};

  const gymNameToken = personalize.gymName || '';
  const coachNameToken = personalize.coachName || personalize.gymName || '';

  // La sustitución vive en `outreachTokens.js` y se copia LITERAL a Deno
  // (scripts/sync-email-engine.mjs). La hacen dos sitios —este y la cola en
  // servidor— y tenerla escrita dos veces es justo la divergencia que ya nos
  // costó un día entre la vista previa y el enviador.
  const renderTokens = (recipient, raw, { escape = false } = {}) => renderOutreachTokens(raw, {
    fullName: recipient.full_name || '',
    stats: statsMap[recipient.id] || {},
    gymName: gymNameToken,
    coachName: coachNameToken,
    escape,
  });

  // EL FILTRADO DE LÍNEAS VIVE AHORA EN `outreachTokens.js`, y es DISTINTO del
  // que hay aquí escrito antes.
  //
  // Lo que decía este comentario —que no se filtra nada porque "aquí no hay
  // conocimiento de qué token resuelve"— era buen razonamiento sobre una premisa
  // falsa: `KNOWN_TOKENS` es exactamente ese conocimiento. Así que se tira la
  // línea cuando lleva un token CONOCIDO sin valor, y se respetan intactas las
  // llaves que escribiera el admin. Sobre el HTML no se tira nada, porque el
  // motor lo emite en una sola línea y filtrar borraría el correo entero.

  // Se levanta cuando un fallo condena al resto del lote. Los obreros la miran
  // antes de coger el siguiente destinatario.
  let fatal = null;
  // Quién está en vuelo AHORA MISMO. Al cortar el lote, esos ya salieron de la
  // cola con `shift()` pero fallarán con la misma causa: sin esto se quedaban
  // fuera de `pending` —hasta tres personas— y el aviso decía "faltan N" con N
  // corto. Invisibles en el toast y en el registro.
  const inFlight = new Set();

  /**
   * Invoca una función de envío con reintento acotado, y clasifica el fallo.
   * Devuelve `{ ok, data, failure }` — nunca lanza.
   */
  const invokeWithRetry = async (fn, payload, tally) => {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await supabase.functions.invoke(fn, { headers: batchAuthHeader, body: payload });
      if (!error) return { ok: true, data };
      const failure = await readFailure(error);
      if (isBatchFatal(failure)) return { ok: false, failure, fatal: true };
      if (isTransient(failure) && attempt < RETRY_MAX - 1) {
        tally.retried++;
        // Espera creciente: 1,2 s, luego 2,4 s. Suficiente para que pase un
        // pico del proveedor sin dejar el lote parado un minuto.
        await sleep(RETRY_BASE_MS * (attempt + 1));
        continue;
      }
      return { ok: false, failure };
    }
  };

  const note = (tally, failure) => {
    tally.failed++;
    const key = failure.providerStatus === 429 ? 'rate_limited'
      : failure.status === 401 ? 'session_expired'
        : (failure.code || 'unknown').slice(0, 60);
    tally.reasons[key] = (tally.reasons[key] || 0) + 1;
  };

  const processRecipient = async (r) => {
    const personalizedBody = renderTokens(r, body);
    const personalizedSubject = renderTokens(r, subject);
    const personalizedHtml = html ? renderTokens(r, html, { escape: true }) : null;

    // Push + in-app (notifications row) via the same helper.
    if (channels.push) {
      try {
        await sendNotification(r.id, gymId, {
          type: 'admin_message',
          title: personalizedSubject || personalizedBody.slice(0, 80),
          body: personalizedBody,
          dedupKey: `outreach_${r.id}_${Date.now()}`,
        });
        results.push.sent++;
      } catch (err) {
        logger.warn('outreach push failed', r.id, err);
        results.push.failed++;
      }
    } else if (channels.inApp) {
      // In-app only — write the notification row, skip native push.
      try {
        const { error } = await supabase.from('notifications').insert({
          profile_id: r.id,
          gym_id: gymId,
          type: 'admin_message',
          title: personalizedSubject || personalizedBody.slice(0, 80),
          body: personalizedBody,
        });
        if (error) throw error;
        results.inApp.sent++;
      } catch (err) {
        logger.warn('outreach inApp failed', r.id, err);
        results.inApp.failed++;
      }
    }

    // Each channel is independent. (Previously a missing email did an early
    // `return`, which also skipped this recipient's SMS when both were enabled.)
    if (channels.email) {
      if (!r.email) {
        results.skipped.noEmail++;
      } else {
        // The edge function requires `memberId` (it looks up the member, verifies
        // they belong to the caller's gym, resolves the stored email, audits, and
        // rate-limits). When a designer template is attached we pass the
        // pre-rendered, token-substituted `html`; otherwise we send `body` and the
        // function wraps it in the gym's branded template.
        const res = await invokeWithRetry('send-admin-email', {
          memberId: r.id,
          subject: personalizedSubject || 'Message from your gym',
          body: personalizedBody || personalizedSubject || ' ',
          ...(personalizedHtml ? { html: personalizedHtml } : {}),
          // Marca esto como envío COMERCIAL. La función consulta entonces
          // email_allowed_for (interruptor maestro + lista de supresión) y
          // emite List-Unsubscribe. Sin este campo, la campaña salía
          // esquivando todo el aparato de consentimiento de 0685 y sin
          // enlace de baja — desde el remitente que comparte toda la
          // plataforma, así que las quejas de un gimnasio le caen a todos.
          scope: 'marketing',
        }, results.email);
        if (res.ok) {
          // El miembro se dio de baja o está en la lista de supresión: no es un
          // fallo, pero tampoco un envío. Contarlo como enviado hacía que el
          // resumen mintiera sobre el alcance real.
          if (res.data?.sent === false && res.data?.reason === 'opted_out') {
            results.skipped.optedOut++;
          } else {
            results.email.sent++;
          }
        } else {
          logger.warn('outreach email failed', r.id, res.failure.code);
          note(results.email, res.failure);
          if (res.fatal) fatal = { channel: 'email', ...res.failure };
        }
      }
    }

    if (channels.sms) {
      if (!r.phone) {
        results.skipped.noPhone++;
      } else {
        // send-sms derives the recipient phone + gym from the member record
        // server-side; it requires `{ memberId, body }` (a raw `to` is ignored).
        const res = await invokeWithRetry('send-sms', { memberId: r.id, body: personalizedBody }, results.sms);
        if (res.ok) {
          results.sms.sent++;
        } else {
          logger.warn('outreach sms failed', r.id, res.failure.code);
          note(results.sms, res.failure);
          if (res.fatal) fatal = { channel: 'sms', ...res.failure };
        }
      }
    }
  };

  // Bounded-concurrency pool: at most OUTREACH_CONCURRENCY recipients are ever
  // in flight, each worker pacing itself between sends. This is the fix for the
  // batch breaking after the first few — it never creates the burst that trips
  // the providers / edge runtime. A failed recipient never kills the pool.
  const queue = recipients.slice();
  const runWorker = async () => {
    while (queue.length) {
      // Un fallo que condena al lote PARA la piscina. Antes se seguía adelante
      // fallando uno por uno hasta el final: cuatrocientos fallos mudos en vez
      // de un mensaje que dice qué pasó y a quién le falta.
      if (fatal) return;
      const r = queue.shift();
      inFlight.add(r.id);
      try { await processRecipient(r); }
      catch (err) {
        logger.warn('outreach recipient failed', r?.id, err);
        // Un destinatario que revienta aquí no lo contaba NADIE: ni enviado, ni
        // fallido, ni omitido. Desaparecía del resumen.
        if (channels.email) note(results.email, { status: 0, code: 'unexpected', providerStatus: 0 });
      } finally {
        inFlight.delete(r.id);
      }
      if (queue.length && !fatal) await sleep(OUTREACH_PACE_MS);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(OUTREACH_CONCURRENCY, recipients.length) }, runWorker),
  );

  if (fatal) {
    results.aborted = { reason: fatal.code, channel: fatal.channel };
    // A quién NO le llegó: los que quedan en cola MÁS los que iban en vuelo
    // cuando se cortó. Sin duplicados — sirve para reintentar tal cual.
    results.pending = [...new Set([...inFlight, ...queue.map((r) => r.id)])];
  }

  // Single audit-log row covering the whole batch.
  await logAdminAction('outreach_send', 'outreach', null, {
    audience: audienceLabel,
    recipientCount: recipients.length,
    channels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
    templateKey,
    subject: subject || null,
    bodyPreview: body?.slice(0, 200) || '',
    results,
    // El lote cortado queda en el registro con su causa: si un gimnasio dice
    // "no le llegó a la mitad", la respuesta está aquí y no hay que adivinarla.
    ...(results.aborted ? { aborted: results.aborted, notSent: results.pending.length } : {}),
  });

  return results;
}

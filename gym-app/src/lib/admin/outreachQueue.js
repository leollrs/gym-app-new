import { supabase, authHeader } from '../supabase';
import logger from '../logger';
import { logAdminAction } from '../adminAudit';

/**
 * Encolar una campaña en el servidor en vez de mandarla desde la pestaña.
 *
 * EL PROBLEMA: `sendOutreach` recorre la audiencia desde el navegador. Cerrar la
 * pestaña, navegar, dormir el portátil o perder el wifi corta el envío por donde
 * iba — sin cola, sin reanudar y sin saber a quién le faltó.
 *
 * EL TRATO: se encola (mig 0695) y se le da un EMPUJÓN al procesador para que
 * empiece ya. Si la pestaña sigue abierta, los empujones lo terminan en
 * segundos; si se cierra, el cron de cada minuto lo remata. Un solo camino, sin
 * dos comportamientos que puedan divergir.
 */

/** Un empujón procesa un lote. Con esto se cubren 500 destinatarios sin cron. */
const MAX_NUDGES = 20;

/**
 * @returns {Promise<{ jobId: string }>}
 */
export async function enqueueOutreach({
  recipients,        // [{ id, … }] — solo se usan los ids
  subject,
  body,
  html = null,       // HTML ya montado, con los merge tags LITERALES
  personalize = {},
  templateKey = null,
  audienceLabel = '',
  reward = null,      // { template_id, label, reward_id, expires_at } — qué conceder
}) {
  const ids = (recipients || []).map((r) => r.id).filter(Boolean);
  if (!ids.length) throw new Error('no_recipients');

  const { data: jobId, error } = await supabase.rpc('enqueue_outreach_job', {
    p_recipients: ids,
    p_subject: subject || '',
    p_body: body || '',
    p_html: html,
    p_audience_label: audienceLabel || '',
    p_template_key: templateKey,
    p_personalize: personalize || {},
    p_reward: reward || null,
  });
  // `rpc` resuelve con `{data, error}` y NUNCA lanza — comprobar `error` es
  // obligatorio o un fallo de permisos pasaría por un encolado correcto.
  if (error) throw new Error(error.message || 'enqueue_failed');

  await logAdminAction('outreach_enqueue', 'outreach', jobId, {
    audience: audienceLabel,
    recipientCount: ids.length,
    // `channels` lo lee `SendRow` para pintar la línea del historial. Sin él la
    // fila salía sin canal, con un `·` suelto.
    channels: ['email'],
    templateKey,
    subject: subject || null,
  });

  return { jobId };
}

/**
 * Empuja el procesador hasta que el trabajo termine o se agoten los empujones.
 *
 * Se llama sin `await` desde la UI: si el admin cierra la pestaña a mitad, el
 * cron sigue. Esto solo hace que, con la pestaña abierta, no haya que esperar
 * al minuto siguiente.
 */
export async function nudgeOutreachJob(jobId, onTick) {
  const headers = await authHeader();
  let empty = 0;
  for (let i = 0; i < MAX_NUDGES; i++) {
    const { data, error } = await supabase.functions.invoke('process-outreach-jobs', {
      headers, body: { job_id: jobId },
    });
    if (error) {
      // No es fatal: el cron lo recogerá. Se registra y se para de empujar.
      logger.warn('outreach nudge failed', jobId, error?.message);
      return;
    }
    if (onTick) onTick(data);
    if (data?.done) return;
    // Un lote VACÍO significa que no hay nada reclamable ahora: o el arriendo de
    // las filas en vuelo, o el aplazamiento de un 429. Antes se miraba
    // `data.retry`, que la rama sin lote ni siquiera devuelve, así que el
    // cliente quemaba los 20 empujones en menos de un segundo.
    //
    // Dos vacíos seguidos y se para: el cron recoge el trabajo cada minuto, y
    // quedarse aquí esperando ocho segundos por vuelta no adelanta nada — solo
    // deja una promesa colgando dos minutos y medio.
    if (!data?.processed) {
      empty += 1;
      if (empty >= 2) return;
      await new Promise((r) => setTimeout(r, 8000));
    } else {
      empty = 0;
    }
  }
}

/** El progreso de un trabajo, para la tarjeta de la UI. */
export async function fetchOutreachProgress(jobId) {
  const { data, error } = await supabase
    .from('outreach_job_progress')
    .select('id, status, total, sent, failed, skipped, remaining, last_error')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return null;
  return data;
}

export async function cancelOutreachJob(jobId) {
  const { error } = await supabase.rpc('cancel_outreach_job', { p_job_id: jobId });
  if (error) throw new Error(error.message || 'cancel_failed');
}

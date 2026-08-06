/**
 * process-outreach-jobs — el consumidor de la cola de campañas.
 *
 * POR QUÉ EXISTE
 *
 * El envío masivo corría en la pestaña del navegador: `sendOutreach` recorría la
 * audiencia desde el cliente. Cerrar la pestaña, navegar, dormir el portátil o
 * perder el wifi cortaba la campaña por donde iba, sin cola ni forma de saber a
 * quién le faltó. Para trescientos miembros eso es media campaña perdida.
 *
 * Ahora el navegador solo ENCOLA (`enqueue_outreach_job`, mig 0695) y le da un
 * empujón a esta función. Si la pestaña sigue abierta, termina en segundos; si
 * se cierra, el cron de cada minuto lo remata.
 *
 * QUÉ NO CAMBIA
 *
 * El consentimiento. Cada envío sigue pasando por `email_allowed_for` con
 * scope 'marketing' y llevando su enlace de baja y sus cabeceras
 * List-Unsubscribe. La cola decide CUÁNDO se envía, nunca A QUIÉN.
 *
 * UN LOTE POR INVOCACIÓN, a propósito: una edge function tiene techo de tiempo,
 * así que procesar veinte mil destinatarios en una llamada es garantizarse un
 * timeout a mitad. Se coge un lote, se marca cada fila y se vuelve; quien llame
 * otra vez sigue por donde iba. `claim_outreach_batch` usa SKIP LOCKED, así que
 * dos llamadas solapadas cogen filas distintas en vez de mandar dos veces.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderOutreachTokens } from '../_shared/outreachTokens.ts';
import { appendComplianceFooter } from '../_shared/emailRenderer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const APP_ORIGIN = 'https://app.tugympr.com';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Cuántos destinatarios por invocación. Por debajo del techo de tiempo. */
const BATCH = 25;
/** Ritmo entre envíos: el mismo que el cliente ya tenía calibrado. */
const PACE_MS = 160;

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Comparación en tiempo constante — el token de servicio no se compara con ===. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ka, kb] = await Promise.all([
    crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  ]);
  const msg = enc.encode('timing-safe-compare');
  const [sa, sb] = await Promise.all([
    crypto.subtle.sign('HMAC', ka, msg), crypto.subtle.sign('HMAC', kb, msg),
  ]);
  const A = new Uint8Array(sa), B = new Uint8Array(sb);
  if (A.length !== B.length) return false;
  let r = 0;
  for (let i = 0; i < A.length; i++) r |= A[i] ^ B[i];
  return r === 0;
}

/** Ninguna cabecera de correo admite CR ni LF: con uno se inyecta un Bcc. */
const headerSafe = (s: string, max: number) =>
  String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/**
 * El nombre visible del remitente. Además de CR/LF hay que quitar `"` `<` `>`:
 * un `gymName` de `Acme <ceo@banco.example>` produce
 * `From: Acme <ceo@banco.example> <noreply@tugympr.com>` — dos direcciones en un
 * mailbox-list, y el intermediario escoge. `send-admin-email` y
 * `send-automated-email` ya lo hacían; esta función se lo saltó.
 */
const fromDisplayName = (s: string, fallback: string) =>
  headerSafe(String(s ?? '').replace(/["<>]/g, ''), 60) || fallback;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) return jsonResp({ error: 'RESEND_API_KEY not configured' }, 500);

    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResp({ error: 'Missing authorization' }, 401);
    const token = auth.replace('Bearer ', '');

    // DOS entradas, y las dos hacen falta:
    //
    //   • service role — el cron (`run_outreach_queue`, mig 0695).
    //   • JWT de admin — el EMPUJÓN del navegador justo después de encolar, para
    //     que la campaña arranque ya en vez de esperar al minuto siguiente. El
    //     cliente manda su propio token, no la clave de servicio; sin este
    //     camino el empujón devolvía 403 y todo dependía del cron.
    //
    // El admin solo puede empujar trabajos DE SU GIMNASIO — se comprueba abajo,
    // con el trabajo ya cargado.
    const isService = await timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { job_id, limit } = await req.json().catch(() => ({}));
    if (!job_id || typeof job_id !== 'string') return jsonResp({ error: 'job_id is required' }, 400);

    const { data: job, error: jobErr } = await supabase
      .from('outreach_jobs')
      .select('id, gym_id, subject, body, html, personalize, reward, status')
      .eq('id', job_id)
      .maybeSingle();
    if (jobErr) return jsonResp({ error: 'job_lookup_failed', detail: jobErr.message }, 500);
    if (!job) return jsonResp({ error: 'not_found' }, 404);

    if (!isService) {
      const { data: caller } = await createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        .auth.getUser(token);
      if (!caller?.user) return jsonResp({ error: 'Forbidden' }, 403);
      const { data: prof } = await supabase
        .from('profiles')
        .select('gym_id, role, additional_roles')
        .eq('id', caller.user.id)
        .maybeSingle();
      const roles: string[] = Array.isArray(prof?.additional_roles) ? prof!.additional_roles : [];
      // `role` MÁS `additional_roles`: desde 0332 un admin puede serlo solo por
      // el array, y mirar únicamente la columna deja fuera a la mitad.
      const isAdmin = prof?.role === 'admin' || prof?.role === 'super_admin'
        || roles.includes('admin') || roles.includes('super_admin');
      if (!isAdmin || prof?.gym_id !== job.gym_id) return jsonResp({ error: 'Forbidden' }, 403);
    }
    if (job.status === 'cancelled' || job.status === 'done') {
      return jsonResp({ done: true, status: job.status });
    }

    const { data: batch, error: claimErr } = await supabase
      .rpc('claim_outreach_batch', { p_job_id: job_id, p_limit: Math.min(Number(limit) || BATCH, 100) });
    if (claimErr) return jsonResp({ error: 'claim_failed', detail: claimErr.message }, 500);

    if (!batch || batch.length === 0) {
      const { data: state } = await supabase.rpc('settle_outreach_job', { p_job_id: job_id });
      return jsonResp({ done: state === 'done', processed: 0, status: state });
    }

    const gymName = String((job.personalize as Record<string, unknown>)?.gymName || '');
    const coachName = String((job.personalize as Record<string, unknown>)?.coachName || '') || gymName;
    const tally = { sent: 0, failed: 0, skipped: 0, retry: 0 };

    for (const row of batch) {
      // Se relee el estado del trabajo en cada destinatario. `cancel_outreach_job`
      // marca 'skipped' las filas pendientes, pero este bucle ya tenía las suyas
      // reclamadas y `finish_outreach_recipient` escribe 'sent' ENCIMA: pulsabas
      // Detener y salían hasta 25 correos más, con la tarjeta ya diciendo
      // "cancelada". Una lectura por destinatario es barata al lado de mandar
      // correo que alguien acaba de decir que no quiere mandar.
      const { data: live } = await supabase
        .from('outreach_jobs').select('status').eq('id', job_id).maybeSingle();
      if (live?.status === 'cancelled') {
        await supabase.rpc('finish_outreach_recipient', {
          p_recipient_id: row.recipient_id, p_status: 'skipped', p_reason: 'cancelled', p_retry_after: null,
        });
        tally.skipped++;
        continue;
      }

      // `p_provider_id` guarda el id que devuelve Resend. Sin él, un rebote que
      // llega media hora después por el webhook (0700) sabe QUÉ dirección murió
      // pero no a quién ni desde qué campaña se le escribió, así que no se puede
      // enseñar en la pantalla del gimnasio que la mandó.
      const finish = (status: string, reason?: string, retryAfter?: number, providerId?: string) =>
        supabase.rpc('finish_outreach_recipient', {
          p_recipient_id: row.recipient_id,
          p_status: status,
          p_reason: reason ? reason.slice(0, 300) : null,
          p_retry_after: retryAfter ?? null,
          p_provider_id: providerId ?? null,
        });

      // ── Consentimiento. Igual que el resto de la plataforma: interruptor
      // maestro + lista de supresión. Una campaña es comercial, sin discusión.
      const { data: allowed, error: allowErr } = await supabase
        .rpc('email_allowed_for', { p_profile_id: row.profile_id, p_scope: 'marketing' });
      if (allowErr) { await finish('failed', `consent_check_failed: ${allowErr.message}`); tally.failed++; continue; }
      if (allowed !== true) { await finish('skipped', 'opted_out'); tally.skipped++; continue; }

      // ── Dirección, token de baja y estadísticas del miembro, de una vez.
      const { data: ctx, error: ctxErr } = await supabase
        .rpc('member_email_context', { p_profile_id: row.profile_id });
      if (ctxErr) { await finish('failed', `context_failed: ${ctxErr.message}`); tally.failed++; continue; }
      if (!ctx?.email) { await finish('skipped', 'no_address'); tally.skipped++; continue; }

      const stats = { ...((ctx.values || {}) as Record<string, unknown>) };

      // ── La recompensa: un código PROPIO para este miembro.
      //
      // El HTML de la campaña se montó una vez con `{{reward_code}}` dentro —
      // en el texto Y en la URL del QR—, así que aquí basta con conceder y
      // meter el código en los valores. Antes no se concedía nada: la tarjeta
      // salía con título y descripción y el miembro no tenía qué enseñar en
      // recepción.
      //
      // `already_granted` NO es un fallo: la RPC deduplica por plantilla y
      // miembro de por vida, y devuelve el código que ya tenía. Reenviar una
      // campaña le devuelve el suyo, no uno nuevo.
      const rw = job.reward as Record<string, unknown> | null;
      if (rw?.template_id && rw?.label) {
        const { data: grant, error: grantErr } = await supabase.rpc('grant_email_campaign_reward', {
          p_profile_id: row.profile_id,
          p_template_id: rw.template_id,
          p_label: rw.label,
          p_label_es: null,
          p_reward_id: rw.reward_id ?? null,
          p_expires_at: rw.expires_at ?? null,
        });
        // PGRST202 = la 0694 no está aplicada. Se manda el correo sin bloque de
        // recompensa antes que no mandar nada: el token sin valor deja la
        // tarjeta a medias, no rompe el envío.
        if (grantErr && grantErr.code !== 'PGRST202') {
          console.error('grant_email_campaign_reward failed:', grantErr.message);
        }
        if (grant?.code) stats.reward_code = grant.code;
      }
      const tok = (raw: string, escape: boolean) => renderOutreachTokens(raw, {
        fullName: row.full_name || '', stats, gymName, coachName, escape,
      });

      // El `||` va DENTRO de headerSafe: estaba fuera, así que con el asunto
      // vacío pasaba el `gymName` crudo —con sus CR/LF— directo a la cabecera.
      const subject = headerSafe(tok(job.subject || '', false) || gymName || 'Message', 200);
      const unsubUrl = ctx.unsub_token ? `${APP_ORIGIN}/u/${ctx.unsub_token}` : '';
      // El HTML guardado trae los merge tags LITERALES: se montó una vez para
      // toda la campaña y se personaliza aquí, por destinatario.
      // El pie de cumplimiento va en LOS DOS caminos.
      //
      // Estaba solo en la rama sin html — es decir, nunca en una campaña con
      // plantilla, que son todas las que salen del selector. Esas iban con la
      // cabecera List-Unsubscribe (Gmail one-click sí funcionaba) pero SIN
      // enlace visible de baja ni dirección postal en el cuerpo, que es lo que
      // pide CAN-SPAM. `send-admin-email` lo inyecta en cualquier html
      // precisamente por eso; al mover el correo a la cola me lo dejé.
      const body = job.html
        ? tok(job.html, true)
        : `<div style="font-family:Archivo,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#0B0F12">`
          + tok(job.body || '', true).replace(/\n/g, '<br/>')
          + `</div>`;
      const html = appendComplianceFooter(body, {
        unsubscribeUrl: unsubUrl || null,
        postalAddress: (ctx.gym?.address as string) ?? null,
        gymName,
      });

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromDisplayName(gymName, 'TuGymPR')} <noreply@tugympr.com>`,
          to: ctx.email,
          subject,
          html,
          // Obligatorio en Gmail/Yahoo para remitentes masivos desde feb-2024.
          // El one-click apunta a la edge function, NO a /u/:token: esa ruta es
          // React del lado del cliente y el POST de Gmail recibiría el shell.
          headers: ctx.unsub_token
            ? {
                'List-Unsubscribe': `<${SUPABASE_URL}/functions/v1/unsubscribe-oneclick?t=${ctx.unsub_token}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              }
            : undefined,
        }),
      });

      if (resp.status === 429) {
        // El proveedor dice "más despacio". La fila VUELVE a pendiente con su
        // espera: es lo que hace que un pico no le cueste el correo a nadie.
        // `Retry-After` cuando lo manda; si no, medio minuto.
        const ra = Number(resp.headers.get('Retry-After')) || 30;
        await finish('pending', 'rate_limited', ra);
        tally.retry++;
        // Y se corta el lote: los que quedan van a chocar con el mismo techo.
        break;
      }

      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        console.error('Resend rejected:', resp.status, detail.slice(0, 300));
        await finish('failed', `provider_${resp.status}: ${detail}`);
        tally.failed++;
      } else {
        // El id viaja en el cuerpo de la respuesta. Se lee con tolerancia: si
        // Resend cambiara la forma, se pierde la correlación del rebote pero
        // NO el envío, que ya salió.
        const sentBody = await resp.json().catch(() => null);
        await finish('sent', undefined, undefined, sentBody?.id ?? undefined);
        tally.sent++;
      }

      await sleep(PACE_MS);
    }

    const { data: state } = await supabase.rpc('settle_outreach_job', { p_job_id: job_id });
    return jsonResp({ done: state === 'done', status: state, processed: batch.length, ...tally });
  } catch (err) {
    // El detalle se queda en el servidor; fuera va un mensaje genérico.
    console.error('process-outreach-jobs error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});

// =============================================================
// resend-webhook — lo que pasa DESPUÉS de que Resend acepta el correo
// =============================================================
//
// POR QUÉ EXISTE
//
// `automated_email_log.status = 'sent'` significa «la API de Resend devolvió un
// id», no «llegó». El rebote ocurre minutos después, asíncrono, y hasta ahora no
// había nada escuchando: ni un webhook en todo el proyecto. Una dirección muerta
// nunca entraba en la lista de supresión, así que se le volvía a escribir en
// cada campaña — desde el `noreply@tugympr.com` que comparten TODOS los
// gimnasios. La reputación que se quema no es la de uno.
//
// LA FIRMA NO ES OPCIONAL Y NO ES UN HMAC CUALQUIERA
//
// Este endpoint corre con `verify_jwt = false`, porque Resend no trae JWT. O sea
// que la URL está abierta a internet. Sin verificar la firma, cualquiera que la
// descubra puede POSTear «rebote permanente» con la dirección de quien quiera y
// dejarlo sin correo para siempre — supresión global, silenciosa e indefinida.
// La firma ES la autenticación.
//
// Resend firma con Svix, que NO es «HMAC del cuerpo»:
//
//   contenido = `${svix-id}.${svix-timestamp}.${cuerpo crudo}`
//   firma     = base64( HMAC-SHA256( base64decode(secreto sin 'whsec_'), contenido ) )
//
// Tres detalles que rompen la verificación si se hacen de oído:
//   1. La clave es el secreto DECODIFICADO de base64, no sus caracteres.
//   2. Se firma el CUERPO CRUDO. Un JSON.parse + re-stringify cambia los bytes
//      y la firma deja de cuadrar.
//   3. La cabecera trae una LISTA separada por espacios (`v1,aaa v1,bbb`)
//      porque durante una rotación conviven dos secretos. Vale con que una cuadre.
//
// Y la marca de tiempo se comprueba: sin eso, un POST legítimo capturado sirve
// para siempre.
//
// REQUIERE `verify_jwt = false` en config.toml. Sin esa entrada, un
// `supabase functions deploy` lo devuelve tras la puerta y los rebotes dejan de
// llegar EN SILENCIO — que es exactamente el estado del que venimos.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
// La verificación vive en `_shared/svix.ts` y NO aquí, porque este fichero llama
// a `Deno.serve` al importarse y por tanto no se puede cargar desde una prueba.
// Duplicar la lógica para «poder testearla» dejaría probada una copia y en
// producción la otra — que es como se aprueba un test verde sobre código muerto.
// Cobertura: `deno test supabase/functions/_shared/svix.test.ts` (12 casos,
// incluidos cuerpo alterado, secreto ajeno, repetición y rotación de clave).
import { verifySvix } from '../_shared/svix.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SIGNING_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';

/** Resend → nuestro vocabulario. Lo que no reconocemos se ignora sin ruido. */
function mapEventType(t: string): string | null {
  switch (t) {
    case 'email.delivered':       return 'delivered';
    case 'email.bounced':         return 'bounced';
    case 'email.complained':      return 'complained';
    case 'email.delivery_delayed': return 'delayed';
    case 'email.failed':          return 'failed';
    // email.sent / opened / clicked no aportan nada aquí y multiplicarían el
    // volumen. `sent` ya lo registra el propio remitente.
    default: return null;
  }
}

/**
 * Permanente vs transitorio. ESTA CLASIFICACIÓN ES LA QUE DECIDE SI ALGUIEN
 * DEJA DE RECIBIR CORREO, así que ante la duda devuelve 'undetermined', que no
 * suprime. Suprimir por un buzón lleno es perder a un miembro de verdad.
 */
function mapBounceKind(raw: unknown): string | null {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'permanent' || v === 'hardbounce' || v === 'hard') return 'permanent';
  if (v === 'transient' || v === 'softbounce' || v === 'soft') return 'transient';
  if (!v) return null;
  return 'undetermined';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('resend-webhook: falta configuración de Supabase');
    return new Response(null, { status: 500 });
  }
  // Sin secreto no se procesa NADA. Degradar a «acepto lo que venga» convierte
  // este endpoint en un botón público para silenciar el correo de cualquiera.
  if (!SIGNING_SECRET) {
    console.error('resend-webhook: RESEND_WEBHOOK_SECRET sin configurar — se rechaza todo');
    return new Response(null, { status: 500 });
  }

  // El cuerpo CRUDO, y una sola vez: es lo que se firma.
  const rawBody = await req.text();

  const ok = await verifySvix(SIGNING_SECRET, rawBody, {
    id:        req.headers.get('svix-id')        ?? req.headers.get('webhook-id'),
    timestamp: req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp'),
    signature: req.headers.get('svix-signature') ?? req.headers.get('webhook-signature'),
  });
  if (!ok) {
    console.warn('resend-webhook: firma inválida — descartado');
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = JSON.parse(rawBody);
    const eventType = mapEventType(String(payload?.type ?? ''));

    // 200 y no 4xx: el evento es legítimo, simplemente no nos interesa. Un error
    // haría que Svix lo reintentara en bucle.
    if (!eventType) {
      return new Response(JSON.stringify({ ok: true, ignored: payload?.type ?? null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = payload?.data ?? {};
    const providerId: string = String(data.email_id ?? data.id ?? '');
    const recipients: string[] = Array.isArray(data.to)
      ? data.to.filter((x: unknown) => typeof x === 'string' && x.includes('@'))
      : (typeof data.to === 'string' ? [data.to] : []);

    if (recipients.length === 0) {
      console.warn('resend-webhook: evento sin destinatario utilizable:', payload?.type);
      return new Response(JSON.stringify({ ok: true, skipped: 'no_recipient' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const bounceKind = eventType === 'bounced' ? mapBounceKind(data?.bounce?.type) : null;
    const detail =
      data?.bounce?.message ?? data?.failed?.reason ?? data?.reason ?? payload?.type ?? null;

    const svixId = req.headers.get('svix-id') ?? req.headers.get('webhook-id') ?? '';
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: Array<Record<string, unknown>> = [];
    for (let i = 0; i < recipients.length; i++) {
      // Un mensaje de webhook puede traer varios destinatarios y el `svix-id` es
      // uno solo. Sufijarlo mantiene la unicidad por destinatario sin perder la
      // idempotencia: un reintento del MISMO mensaje regenera las mismas claves.
      const eventId = recipients.length > 1 ? `${svixId}:${i}` : svixId;

      const { data: res, error } = await supabase.rpc('record_email_delivery_event', {
        p_event_id:    eventId,
        p_provider_id: providerId || null,
        p_email:       recipients[i],
        p_event_type:  eventType,
        p_bounce_kind: bounceKind,
        p_detail:      detail ? String(detail).slice(0, 1000) : null,
        p_occurred_at: payload?.created_at ?? new Date().toISOString(),
      });

      if (error) {
        // 500 a propósito: Svix reintenta, y un fallo nuestro NO debe perder un
        // rebote. Perderlo significa seguir escribiendo a una dirección muerta.
        console.error('resend-webhook: record falló:', error.message);
        return new Response(JSON.stringify({ error: 'record_failed' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
      results.push(res as Record<string, unknown>);
    }

    return new Response(JSON.stringify({ ok: true, events: results.length, results }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('resend-webhook error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

/**
 * send-automated-email — the sender for lifecycle / win-back / class-reminder
 * email (migs 0685, 0686).
 *
 * WHY A NEW FUNCTION INSTEAD OF send-admin-email
 *
 * send-admin-email verifies a real admin USER JWT (auth.getUser + role check,
 * index.ts:307-341). A pg_cron trigger has no user — it holds the service-role
 * key — so it cannot call it at all. This one is service-role only, and refuses
 * anything else.
 *
 * CONSENT IS NOT OPTIONAL HERE
 *
 * Every send goes through email_allowed_for(), which checks the master switch,
 * the per-scope switch, a usable address, and the suppression list in one
 * place. That single gate exists because the alternative already failed: the
 * win-back PUSH path (0402) never checks notif_reengagement even though
 * scheduled-reminders does, precisely because each sender was left to remember
 * on its own.
 *
 * Every message carries a real unsubscribe URL, List-Unsubscribe and
 * List-Unsubscribe-Post headers (Gmail/Yahoo bulk rules, Feb 2024), and the
 * gym's postal address.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyTokensInline, applyTokensToHtml, appendComplianceFooter } from '../_shared/emailRenderer.ts';
// El MISMO motor que dibuja la vista previa del editor. Es una copia generada
// (scripts/sync-email-engine.mjs) y un test de contrato la compara byte a byte
// con la del navegador, porque tenerlas escritas por separado ya nos costó que
// el editor enseñara una maqueta y al miembro le llegara otra.
import { emailDoc, PRESET_IDS } from '../_shared/emailEngine.ts';
import { pickVariant } from '../_shared/emailVariants.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const APP_ORIGIN = 'https://app.tugympr.com';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SCOPES = ['lifecycle', 'winback', 'classes'] as const;
type Scope = typeof SCOPES[number];

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

/**
 * Deep links that actually open the app. Only paths listed in BOTH the AASA
 * file and main.jsx's appUrlOpen handler route natively — anything else opens
 * a browser. `/invite/go/:section` and `/class/:id` are both handled; a
 * hand-rolled `/rewards` would not be.
 */
function buildLinks(v: Record<string, string | null>) {
  const links: Record<string, string> = {
    today_plan_url: `${APP_ORIGIN}/invite/go/workout`,
    classes_url: `${APP_ORIGIN}/invite/go/classes`,
    checkin_url: `${APP_ORIGIN}/invite/go/checkin`,
    app_url: `${APP_ORIGIN}/invite/go/home`,
  };
  if (v.next_class_schedule_id && v.next_class_date) {
    links.next_class_url = `${APP_ORIGIN}/class/${v.next_class_schedule_id}?d=${v.next_class_date}`;
  }
  return links;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) return jsonResp({ error: 'RESEND_API_KEY not configured' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Missing authorization' }, 401);
    const token = authHeader.replace('Bearer ', '');

    // Service role ONLY. There is no user-JWT path: this function sends
    // marketing mail on a schedule and must never be reachable from a browser.
    if (!(await timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY))) {
      return jsonResp({ error: 'Forbidden' }, 403);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // `dedup_key` es opcional. Lifecycle y win-back no lo mandan: sus tablas de
    // log ya garantizan una fila por paso y por miembro de por vida, así que
    // 'scope:step_key' basta. El recordatorio de clase SÍ lo manda, porque un
    // miembro tiene clase muchos días y cada reserva merece su propio correo.
    const { profile_id, scope, step_key, dedup_key, dry_run } = await req.json();

    if (!profile_id || typeof profile_id !== 'string') {
      return jsonResp({ error: 'profile_id is required' }, 400);
    }
    if (!SCOPES.includes(scope as Scope)) {
      return jsonResp({ error: `scope must be one of ${SCOPES.join(', ')}` }, 400);
    }

    // ── 1. Consent, suppression, deliverable address ──
    const { data: allowed, error: allowErr } = await supabase
      .rpc('email_allowed_for', { p_profile_id: profile_id, p_scope: scope });
    if (allowErr) {
      console.error('email_allowed_for failed:', allowErr);
      return jsonResp({ error: 'consent_check_failed' }, 500);
    }
    // Not an error — the common, correct outcome for anyone opted out.
    if (allowed !== true) return jsonResp({ sent: false, reason: 'opted_out' });

    // ── 2. The member's real data ──
    const { data: ctx, error: ctxErr } = await supabase
      .rpc('member_email_context', { p_profile_id: profile_id });
    // Un error real de BD y "este miembro no existe" NO son lo mismo. Los dos
    // devolvían 200, así que cuando member_email_context reventaba con 42703
    // (mig 0686 seleccionaba profiles.timezone, columna inexistente) pg_net
    // veía éxito y el correo automático tenía 0% de envío sin una sola señal.
    if (ctxErr) {
      console.error('member_email_context failed:', ctxErr);
      return jsonResp({ error: 'context_failed', detail: ctxErr.message }, 500);
    }
    if (!ctx?.found) return jsonResp({ sent: false, reason: 'no_context' });
    if (!ctx.email) return jsonResp({ sent: false, reason: 'no_address' });

    // ── 3. The gym's template for this moment ──
    // auto_enabled defaults false: a gym never starts sending because a
    // template happens to exist. Someone has to switch it on.
    const { data: tplRow } = await supabase
      .from('gym_email_templates')
      .select('id, name, template_data, step_key')
      .eq('gym_id', ctx.gym_id)
      .eq('step_key', step_key || scope)
      .eq('auto_enabled', true)
      .maybeSingle();

    if (!tplRow) return jsonResp({ sent: false, reason: 'no_template' });

    // La plantilla EN EL IDIOMA DEL MIEMBRO.
    //
    // Una plantilla guarda su texto en los dos idiomas (base + `i18n`), con la
    // maqueta y los enlaces compartidos. `pickVariant` superpone el texto que
    // toque; un campo sin traducir cae al base, así que media traducción sale
    // media traducida y nunca en blanco. Si la plantilla no tiene variante
    // —todas las de antes— esto devuelve la misma fila y no cambia nada.
    const d = pickVariant(tplRow.template_data || {}, ctx.language === 'en' ? 'en' : 'es');
    const template = {
      header: d.header || { enabled: true, showLogo: true, text: '' },
      hero: d.hero || { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: d.body || { text: '' },
      cta: d.cta || { enabled: false, text: '', url: '', color: '#D4AF37' },
      reward: d.reward,
      footer: d.footer || { enabled: true, text: '', unsubscribeText: 'Unsubscribe' },
      colors: d.colors || { primary: '#D4AF37', background: '#ffffff', text: '#333333' },
      typography: d.typography,
    };

    // ── 4. Values + links ──
    const values: Record<string, string | null> = { ...(ctx.values || {}) };
    Object.assign(values, buildLinks(values));

    // Scope hygiene: a win-back recipient has cancelled, so "today's plan" is
    // meaningless — blanking it makes the renderer drop those lines rather than
    // promising a plan they no longer have.
    if (scope === 'winback') {
      values.today_plan_name = null;
      values.today_plan_url = null;
    }

    const unsubscribeUrl = ctx.unsub_token ? `${APP_ORIGIN}/u/${ctx.unsub_token}` : null;
    values.unsubscribe_url = unsubscribeUrl;

    // El corte de `dry_run` va AQUÍ, antes de conceder nada.
    //
    // Estaba después: una prueba en seco creaba una fila real en
    // earned_rewards, quemaba el dedup key —así que el envío de verdad ya no
    // podía conceder— y disparaba el trigger que le manda un push al miembro
    // diciéndole que recoja un premio. Todo eso mientras el llamante recibía
    // `{ sent: false, reason: 'dry_run' }`.
    // Sin excepciones. La condición llevaba `&& !(reward.enabled && reward.title)`,
    // o sea que eximía JUSTO el caso que el comentario de arriba dice estar
    // arreglando: con recompensa no cortaba, caía en 4b, creaba la fila real en
    // earned_rewards y disparaba el push al miembro. El arreglo estaba escrito
    // en el comentario y desmentido por la línea siguiente.
    if (dry_run) {
      return jsonResp({ sent: false, reason: 'dry_run', values });
    }

    // ── 4b. Recompensa: un código PROPIO para este miembro ──
    //
    // El `code` que el admin escribió en la plantilla es un único string para
    // toda la campaña. Mandarlo tal cual significa que quien lo reenvíe al
    // grupo de WhatsApp lo regala a todo el mundo, y que no hay forma de saber
    // quién canjeó ni de cerrar la promoción.
    //
    // grant_email_campaign_reward (0694) crea una fila en `earned_rewards`
    // —la tabla que el escáner de recepción y la pantalla de recompensas del
    // miembro YA usan— y devuelve un código único. Es idempotente por
    // dedup_key, así que un reintento del cron devuelve el mismo código en vez
    // de regalar dos veces.
    if (template.reward?.enabled && template.reward?.title) {
      const { data: grant, error: grantErr } = await supabase.rpc('grant_email_campaign_reward', {
        p_profile_id: profile_id,
        p_template_id: tplRow.id,
        p_label: template.reward.title,
        p_label_es: template.reward.title_es ?? null,
        p_reward_id: template.reward.reward_id || null,
        p_expires_at: /^\d{4}-\d{2}-\d{2}$/.test(String(template.reward.expiry || ''))
          ? `${template.reward.expiry}T23:59:59Z`
          : null,
      });
      // La función llega con la migración 0694. Si aún no se aplicó, PostgREST
      // responde PGRST202 — y tratarlo como fatal significaba CERO entrega para
      // toda plantilla con recompensa, en silencio: `fire_automated_email`
      // (0687:74) dispara por `net.http_post` y nunca lee la respuesta.
      //
      // Es la misma regla que ya aplica el reclamo de `automated_email_log`
      // treinta líneas más abajo: mandar de más es recuperable, no mandar nada
      // no lo es. Se manda el correo sin bloque de recompensa antes que no
      // mandar nada.
      const grantMissing = grantErr
        && (grantErr.code === 'PGRST202' || grantErr.code === '42883'
            || /could not find the function|does not exist/i.test(grantErr.message || ''));
      if (grantErr && !grantMissing) {
        console.error('grant_email_campaign_reward failed:', grantErr);
        return jsonResp({ error: 'reward_grant_failed', detail: grantErr.message }, 500);
      }
      if (grantMissing) {
        console.warn('grant_email_campaign_reward missing (mig 0694 no aplicada) — se envía sin recompensa');
        template.reward = { ...template.reward, enabled: false };
      }
      // `granted:false` con motivo 'already_granted' NO es un error: trae el
      // código que ya tenía, que es justo lo que hay que volver a enseñarle.
      template.reward = { ...template.reward, code: grant?.code || '' };
      // También como token. El camino de las plantillas de la galería renderiza
      // HTML fijo con `applyTokensToHtml` y NO mira `template.reward`, así que
      // sin esto se concedía el regalo, el trigger le empujaba "recoge tu
      // recompensa" y el correo llegaba sin el código.
      values.reward_code = grant?.code || '';
    }

    // ── 5. Logo: a bucket path, not a URL ──
    // Email clients can't authenticate, so a private-bucket ref has to be
    // signed. One year, matching send-invite:250-258.
    let logoUrl: string | null = null;
    const rawLogo = ctx.gym?.logo_ref;
    if (rawLogo) {
      if (/^https?:\/\//i.test(rawLogo)) logoUrl = rawLogo;
      else {
        const { data: signed } = await supabase.storage
          .from('gym-logos').createSignedUrl(rawLogo, 60 * 60 * 24 * 365);
        logoUrl = signed?.signedUrl ?? null;
      }
    }

    const gymName = ctx.gym?.name || 'Your Gym';

    // Dos clases de plantilla comparten esta tabla:
    //
    //   • BLOQUES — cabecera/hero/cuerpo/botón; las arma renderEmailHtml.
    //   • DISEÑO  — uno de los quince layouts editoriales del catálogo,
    //     guardado ya renderizado desde la galería con los tokens intactos.
    //     Es HTML fijo: aquí solo se sustituyen los tokens.
    //
    // Los valores se escapan como HTML en este camino y NO en el de bloques,
    // donde renderEmailHtml ya escapa al insertar. Un miembro cuyo nombre
    // lleve marcado (`<img onerror=…>`) inyectaría HTML activo en el correo
    // que recibe — el mismo escape que hace outreachSender al sustituir sobre
    // HTML prerenderizado.
    const designerHtml = typeof d.designer_html === 'string' ? d.designer_html : '';
    let html: string;
    if (designerHtml) {
      html = applyTokensToHtml(designerHtml, values);
      html = appendComplianceFooter(html, {
        unsubscribeUrl,
        postalAddress: ctx.gym?.address ?? null,
        gymName,
      });
    } else {
      // El MISMO motor que la vista previa. Antes esto llamaba a
      // `renderEmailHtml`, que no sabe qué es una maqueta: las seis opciones
      // del paso 1 producían HTML idéntico al enviar, y de paso arrastraba dos
      // bugs que la copia del navegador ya tenía arreglados —el hero con foto
      // descartaba el titular, y el separador de sección esperaba
      // `---Título---` cuando el editor documenta `--Título--`.
      // `primary_color`, NO `accent`: member_email_context (0688:220-226) devuelve
      // {name, address, logo_ref, primary_color, secondary_color}. Leer `accent`
      // fallaba el test SIEMPRE y caía al teal por defecto — en silencio, porque
      // `ctx` es `any` y nadie se queja de una propiedad que no existe.
      const gymAccent = /^#[0-9a-fA-F]{3,8}$/.test(String(ctx.gym?.primary_color || ''))
        ? ctx.gym.primary_color : (d.colors?.primary || '#19B8B8');
      html = emailDoc({
        lang: ctx.language === 'en' ? 'en' : 'es',
        preset: PRESET_IDS.includes(d.preset) ? d.preset : 'editorial',
        density: ['compacto', 'comodo', 'espacioso'].includes(d.density) ? d.density : 'comodo',
        fontScale: Number(d.typography?.fontScale) || Number(d.typography?.fontSize) || 15,
        brand: {
          name: gymName,
          monogram: (gymName || '??').replace(/[^A-Za-zÁÉÍÓÚÑ]/g, '').slice(0, 2).toUpperCase() || '??',
          accent: gymAccent,
          logoUrl: logoUrl || '',
        },
        subject: '',
        preheader: d.preheader || '',
        header: {
          on: template.header?.enabled !== false,
          showLogo: template.header?.showLogo !== false,
          text: template.header?.text || '',
        },
        // `on` derivado del contenido, igual que en el editor: el interruptor
        // solo significa "quiero foto", y un titular escrito tiene que salir.
        hero: {
          on: !!(template.hero?.headline || template.hero?.subtitle
                 || template.hero?.eyebrow || template.hero?.imageUrl),
          imageUrl: template.hero?.imageUrl || '',
          imagePlaceholder: false,   // el marcador a rayas es SOLO del editor
          eyebrow: template.hero?.eyebrow || '',
          title: template.hero?.headline || '',
          subtitle: template.hero?.subtitle || '',
        },
        body: { on: true, text: template.body?.text || '' },
        reward: {
          on: !!template.reward?.enabled,
          label: template.reward?.label || '',
          title: template.reward?.title || '',
          desc: template.reward?.description || '',
          code: template.reward?.code || '',
          // Solo canjeable si `grant_email_campaign_reward` creó la fila. Si la
          // 0694 no está aplicada el bloque ya viene apagado, así que aquí
          // basta con que haya código concedido.
          scannable: !!values.reward_code,
          expires: template.reward?.expiry || '',
        },
        cta: {
          on: !!template.cta?.enabled,
          label: template.cta?.text || '',
          dest: template.cta?.dest || 'app',
          url: template.cta?.url || '',
          color: template.cta?.color || '',
        },
        footer: {
          on: template.footer?.enabled !== false,
          text: template.footer?.text || '',
          address: ctx.gym?.address || '',
          unsub: template.footer?.unsubscribeText || (ctx.language === 'en' ? 'Unsubscribe' : 'Cancelar suscripción'),
          unsubUrl: unsubscribeUrl || '',
        },
        // Los valores REALES del miembro. El motor los usa en vez de la tabla
        // de muestra que alimenta la vista previa.
        values,
      });
    }

    // Subject from the header text, falling back to the template name. Uses the
    // inline rule: an unresolved token blanks it rather than shipping
    // "Your {{next_class_name}} is coming up" to an inbox.
    // Ninguna cabecera de correo puede llevar CR ni LF: un salto de línea en
    // Subject o en From permite inyectar cabeceras arbitrarias, Bcc incluido.
    // Y las dos fuentes son texto de usuario — `member_name` sale de
    // profiles.full_name, que escribe el propio miembro y que 0677 dejó dicho
    // que nada mantiene limpio; `gymName` sale de gyms.name, que cualquier
    // admin puede actualizar sin restricción de columna (0013:5-9).
    const headerSafe = (s: string, max: number) =>
      String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

    const subject = headerSafe(
      applyTokensInline(template.header?.text || '', values)
        || applyTokensInline(tplRow.name || '', values)
        || gymName,
      200);

    // Además de CR/LF, en el display-name del From hay que quitar las comillas
    // y los ángulos, que son estructurales.
    const fromName = headerSafe(gymName, 64).replace(/["<>]/g, '') || 'TuGymPR';

    if (dry_run) {
      return jsonResp({ sent: false, reason: 'dry_run', subject, html_length: html.length, values });
    }

    // ── 6. Reclamar el envío ANTES de mandarlo ──
    //
    // El índice único (profile_id, dedup_key) de automated_email_log (0691) es
    // lo que impide el duplicado, y lo decide Postgres — no una lectura previa,
    // que tendría carrera. Un unique_violation aquí significa "esto ya salió".
    //
    // Reclamar antes de enviar y no después es deliberado: si el proceso muere
    // entre el claim y Resend, el peor caso es un correo NO enviado, que es
    // mucho mejor que dos correos idénticos saliendo del remitente que comparte
    // toda la plataforma. La fila queda en 'claimed' y se ve en el barrido.
    const dedupKey = typeof dedup_key === 'string' && dedup_key
      ? dedup_key
      : `${scope}:${step_key || scope}`;

    const { data: claim, error: claimErr } = await supabase
      .from('automated_email_log')
      .insert({
        profile_id, gym_id: ctx.gym_id, scope,
        step_key: step_key || scope, dedup_key: dedupKey, status: 'claimed',
      })
      .select('id')
      .single();

    if (claimErr) {
      // 23505 = ya reclamado. No es un error: es el dedup funcionando.
      if (claimErr.code === '23505') {
        return jsonResp({ sent: false, reason: 'duplicate', dedup_key: dedupKey });
      }
      // La tabla la crea la 0691, que puede no estar aplicada cuando esta
      // función se despliegue. Fallar aquí significaba que NINGÚN correo
      // automático salía — peor que el bug que el dedup viene a arreglar. Se
      // degrada a "sin dedup" y se avisa en el log: enviar de más es
      // recuperable, no enviar nada no lo es.
      const missingTable = claimErr.code === '42P01' || claimErr.code === 'PGRST205'
        || /does not exist|schema cache/i.test(claimErr.message || '');
      if (!missingTable) {
        console.error('automated_email_log claim failed:', claimErr);
        return jsonResp({ error: 'claim_failed', detail: claimErr.message }, 500);
      }
      console.warn('automated_email_log missing — sending without dedup (apply 0691)');
    }

    // ── 7. Send ──
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${fromName} <noreply@tugympr.com>`,
        to: ctx.email,
        subject,
        html,
        // Required by Gmail and Yahoo for bulk senders since Feb 2024. Without
        // these, automated mail from the shared noreply@ address is a
        // deliverability risk for every gym on the platform, not just this one.
        // La URL del one-click apunta a la edge function, NO a /u/:token: esa
        // ruta es React del lado del cliente y vercel.json la reescribe a
        // index.html, así que el POST de Gmail recibía el shell HTML y no daba
        // de baja a nadie — mientras la cabecera aseguraba que sí. El enlace
        // visible del cuerpo sigue yendo a /u/:token, que es la página humana.
        headers: ctx.unsub_token
          ? {
              'List-Unsubscribe': `<${SUPABASE_URL}/functions/v1/unsubscribe-oneclick?t=${ctx.unsub_token}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : undefined,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error('Resend rejected:', resp.status, detail);
      // La fila queda como 'failed' con el motivo. Antes un 502 del proveedor
      // quemaba el paso PARA SIEMPRE en silencio: la fila de
      // lifecycle_message_log ya estaba escrita y su UNIQUE(profile_id,
      // step_key) la hace terminal, así que ese miembro no volvía a recibir ese
      // correo nunca. Ahora al menos se ve, y se puede barrer para reintento.
      // `claim?.id` — sin la 0691 aplicada no hay fila que marcar.
      if (claim?.id) {
        await supabase.from('automated_email_log')
          .update({ status: 'failed', error: `${resp.status}: ${detail}`.slice(0, 500) })
          .eq('id', claim.id);
      }
      return jsonResp({ sent: false, reason: 'provider_error', status: resp.status }, 502);
    }

    const result = await resp.json();

    if (claim?.id) {
      const { error: markErr } = await supabase.from('automated_email_log')
        .update({ status: 'sent', provider_id: result?.id ?? null, sent_at: new Date().toISOString() })
        .eq('id', claim.id);
      if (markErr) console.warn('automated_email_log mark-sent failed:', markErr.message);
    }

    // Sin fila en admin_audit_log: esa tabla es para acciones de un ADMIN y su
    // actor_id es NOT NULL REFERENCES profiles(id) (0164:5). Un envío disparado
    // por cron no tiene actor humano, y meter el propio miembro ahí era un
    // encaje forzado. automated_email_log (0691) es el registro correcto, y ya
    // lleva scope, step_key, estado, id de proveedor y el error si lo hubo.
    return jsonResp({ sent: true, id: result?.id ?? null, scope });
  } catch (err) {
    console.error('send-automated-email failed:', err);
    return jsonResp({ error: 'internal_error' }, 500);
  }
});

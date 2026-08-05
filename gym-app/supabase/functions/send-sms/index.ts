import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

// Per-gym monthly SMS cap. Single source of truth: platform_config
// 'sms_monthly_cap' (seeded by migration 0597, also DISPLAYED by SmsUsageCard).
// An explicit SMS_MONTHLY_CAP env var still wins (per-deploy escape hatch);
// otherwise read platform_config; otherwise fall back to 500.
const SMS_CAP_FALLBACK = 500;
const SMS_MONTHLY_CAP_ENV = (() => {
  const raw = Deno.env.get('SMS_MONTHLY_CAP');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

// Resolve the cap for a request. Env override > platform_config > fallback.
// Parses platform_config the same way SmsUsageCard does (strip surrounding
// quotes off the JSONB value, then parseInt).
async function getMonthlyCap(supabase: ReturnType<typeof createClient>): Promise<number> {
  if (SMS_MONTHLY_CAP_ENV !== null) return SMS_MONTHLY_CAP_ENV;
  try {
    const { data } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'sms_monthly_cap')
      .maybeSingle();
    if (data?.value != null) {
      const parsed = parseInt(String(data.value).replace(/^"+|"+$/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch (e) {
    console.warn('getMonthlyCap lookup failed, using fallback:', e);
  }
  return SMS_CAP_FALLBACK;
}

const TWILIO_CONFIGURED = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Timing-safe comparison for service role key
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyA = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const keyB = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = enc.encode('timing-safe-compare');
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', keyA, msg),
    crypto.subtle.sign('HMAC', keyB, msg),
  ]);
  const bytesA = new Uint8Array(sigA);
  const bytesB = new Uint8Array(sigB);
  if (bytesA.length !== bytesB.length) return false;
  let result = 0;
  for (let i = 0; i < bytesA.length; i++) result |= bytesA[i] ^ bytesB[i];
  return result === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Missing authorization' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');

    // Check if caller is using the service role key (automated/cron calls)
    const isServiceRole = await timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY);

    let callerId: string | null = null;
    let callerGymId: string | null = null;
    let callerRole: string | null = null;

    if (isServiceRole) {
      // Service role — automated send, gymId must be in body
    } else {
      // JWT auth — verify user
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

      const { data: callerProfile } = await supabase
        .from('profiles')
        .select('role, gym_id, additional_roles')
        .eq('id', user.id)
        .single();

      // Multi-role (mig 0332): admin/trainer authority can come from `role`
      // OR `additional_roles`. Without this, an admin whose primary role is
      // 'member' (e.g. they're also a member at their own gym) gets 403.
      const STAFF_ROLES = ['admin', 'super_admin', 'trainer'];
      const hasPrimary = !!callerProfile && STAFF_ROLES.includes(callerProfile.role);
      const additional = Array.isArray(callerProfile?.additional_roles) ? callerProfile.additional_roles : [];
      const staffFromAdditional = additional.find((r: string) => STAFF_ROLES.includes(r));
      if (!callerProfile || (!hasPrimary && !staffFromAdditional)) {
        return jsonResp({ error: 'Admin/trainer access required' }, 403);
      }

      callerId = user.id;
      callerGymId = callerProfile.gym_id;
      callerRole = hasPrimary ? callerProfile.role : staffFromAdditional;
    }

    const { memberId, prospectId, body, source, gymId: bodyGymId, mediaUrl, overridePhone } = await req.json();

    // A prospect (gym_prospects, mig 0681) is a walk-in who is NOT a member and
    // therefore has no `profiles` row at all. Before this, every path here
    // required one — the profile lookup below 404s without it, and gym_id is
    // derived from it — so the access code could never be texted to the person
    // it was minted for. `overridePhone` did not help: it overrides the NUMBER,
    // not the recipient lookup.
    if (!body) {
      return jsonResp({ error: 'body is required' }, 400);
    }
    if (!memberId && !prospectId) {
      return jsonResp({ error: 'memberId or prospectId is required' }, 400);
    }
    if (memberId && prospectId) {
      return jsonResp({ error: 'Pass either memberId or prospectId, not both' }, 400);
    }
    if (typeof body !== 'string' || body.length > 640) {
      return jsonResp({ error: 'Body must be 640 characters or fewer' }, 400);
    }

    // Validate mediaUrl (optional). It is attacker-controlled and passed straight
    // to Twilio as MediaUrl (MMS), so we reject anything that isn't an https URL
    // hosted on our own Supabase project. This prevents cost amplification and
    // arbitrary content fetch by Twilio. Reject with 400 (don't silently drop).
    if (mediaUrl !== undefined && mediaUrl !== null && mediaUrl !== '') {
      if (typeof mediaUrl !== 'string') {
        return jsonResp({ error: 'mediaUrl must be a string' }, 400);
      }
      let parsedMedia: URL;
      try {
        parsedMedia = new URL(mediaUrl);
      } catch {
        return jsonResp({ error: 'mediaUrl must be a valid URL' }, 400);
      }
      const supabaseHost = new URL(SUPABASE_URL).host;
      if (parsedMedia.protocol !== 'https:' || parsedMedia.host !== supabaseHost) {
        return jsonResp({ error: 'mediaUrl must be an https URL on this project\'s Supabase storage' }, 400);
      }
    }

    // Resolve the recipient — a member profile or a prospect. Both paths must
    // end with the same three facts: a gym_id (never taken from the caller), a
    // phone on file, and a name.
    let recipient: { id: string; full_name: string | null; phone_number: string | null; gym_id: string } | null = null;

    if (prospectId) {
      const { data: prospect } = await supabase
        .from('gym_prospects')
        .select('id, full_name, phone, gym_id')
        .eq('id', prospectId)
        .single();
      if (!prospect) {
        return jsonResp({ error: 'Prospect not found' }, 404);
      }
      recipient = {
        id: prospect.id,
        full_name: prospect.full_name,
        phone_number: prospect.phone,
        gym_id: prospect.gym_id,
      };
    } else {
      const { data: memberProfile } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, gym_id')
        .eq('id', memberId)
        .single();
      if (!memberProfile) {
        return jsonResp({ error: 'Member not found' }, 404);
      }
      recipient = memberProfile;
    }

    // Narrows `recipient` for the type checker (both branches above either
    // assign or return) and is a real backstop if that ever stops being true.
    if (!recipient) {
      return jsonResp({ error: 'Recipient not found' }, 404);
    }

    // Always derive gym_id from the recipient record — never trust the caller-supplied bodyGymId.
    const effectiveGymId = recipient.gym_id;

    // If the caller supplied a gymId that doesn't match the recipient's actual gym, reject.
    if (bodyGymId && bodyGymId !== recipient.gym_id) {
      console.warn('send-sms gym_id mismatch:', {
        bodyGymId,
        recipientGymId: recipient.gym_id,
        memberId,
        prospectId,
        callerId,
      });
      return jsonResp({ error: 'gym_id_mismatch' }, 403);
    }

    // Gym boundary check (non-super_admin can only SMS their own gym). Applies
    // identically to prospects — a walk-in belongs to one gym like anyone else.
    if (!isServiceRole && callerRole !== 'super_admin' && recipient.gym_id !== callerGymId) {
      return jsonResp({ error: 'Recipient not in your gym' }, 403);
    }

    // ── GYM DAILY USAGE CAP CHECK — DISABLED ────────────────────
    // The `check_and_increment_gym_usage` RPC is buggy: it ignores p_limit and
    // returns !ok on the very FIRST request of the day, which fail-closes every
    // send to a 429 (the exact same issue documented in send-admin-email, where
    // this gate was already disabled). Until that RPC is fixed, the daily gym
    // cap is off here — SMS is still bounded by the per-admin 50/hour limit and
    // the monthly increment_sms_usage cap further below.
    // ── END (DISABLED) ──────────────────────────────────────────

    // Determine recipient phone — admin can override (e.g. testing with own
    // phone, or member doesn't have one on file). Normalize to E.164 first.
    const normalizePhone = (raw: string): string => {
      const digits = raw.replace(/[^\d+]/g, '');
      if (digits.startsWith('+')) return digits;
      // Assume US/CA 10-digit input → prepend +1
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
      return digits; // pass through; validation below will catch
    };
    const finalPhone = overridePhone
      ? normalizePhone(String(overridePhone))
      : normalizePhone(String(recipient.phone_number ?? ''));
    if (!finalPhone) {
      return jsonResp({ error: 'No phone number provided (recipient has none on file and no override given)' }, 400);
    }
    const phoneRegex = /^\+1\d{10}$/;
    if (!phoneRegex.test(finalPhone)) {
      return jsonResp({ error: 'Invalid phone number format (expected +1XXXXXXXXXX)' }, 400);
    }

    // Rate limiting for non-service-role callers: max 50 SMS per hour per admin
    if (!isServiceRole && callerId) {
      const { count: recentCount } = await supabase
        .from('admin_audit_log')
        .select('*', { count: 'exact', head: true })
        .eq('actor_id', callerId)
        .eq('action', 'send_sms')
        .gte('created_at', new Date(Date.now() - 3600000).toISOString());
      if ((recentCount ?? 0) >= 50) {
        return jsonResp({ error: 'Rate limit exceeded (50 SMS/hour)' }, 429);
      }
    }

    // SMS cap check — best-effort (table may not exist yet)
    const smsMonthlyCap = await getMonthlyCap(supabase);
    const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    let newCount: number | null = null;
    try {
      // El error se destructura. Antes solo se leía `data`: un rpc() de
      // Supabase RESUELVE con {data:null, error} y nunca lanza, así que el
      // catch no disparaba, newCount quedaba null, `newCount && …` era falso y
      // EL ENVÍO SEGUÍA SIN TOPE. El tope diario ya está desactivado más
      // arriba, así que esto era lo único que acotaba el gasto de Twilio.
      const { data, error: usageErr } = await supabase.rpc('increment_sms_usage', {
        p_gym_id: effectiveGymId,
        p_month: currentMonth,
        p_count: 1,
      });
      if (usageErr) throw usageErr;
      newCount = data;

      if (newCount && newCount > smsMonthlyCap) {
        await supabase.rpc('increment_sms_usage', {
          p_gym_id: effectiveGymId,
          p_month: currentMonth,
          p_count: -1,
        });
        return jsonResp({
          error: `SMS limit reached (${smsMonthlyCap}/month). Contact support for extension.`,
          usage: { used: smsMonthlyCap, limit: smsMonthlyCap },
        }, 429);
      }
    } catch (e) {
      // Falla CERRADO. Si no se puede evaluar el tope, no se manda: esto gasta
      // dinero real del fundador y un contador roto no puede ser barra libre.
      console.error('increment_sms_usage failed — refusing to send:', e);
      return jsonResp({ error: 'SMS usage could not be verified. Try again shortly.' }, 429);
    }

    // Get gym name and SMS phone number
    const { data: gym } = await supabase
      .from('gyms')
      .select('name, sms_phone_number')
      .eq('id', effectiveGymId)
      .single();

    // Determine the "From" number: prefer gym's dedicated number, fall back to env var
    const fromNumber = gym?.sms_phone_number || TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      return jsonResp({ error: 'This gym does not have an SMS phone number configured' }, 400);
    }

    const gymName = gym?.name || 'Your Gym';
    const smsBody = `[${gymName}] ${body}`;

    // Send via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', finalPhone);
    formData.append('Body', smsBody);
    if (mediaUrl) {
      formData.append('MediaUrl', mediaUrl);
    }

    const twilioResp = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!twilioResp.ok) {
      const errBody = await twilioResp.text();
      console.error('Twilio error:', twilioResp.status, errBody);
      // Roll back usage (best-effort)
      try {
        await supabase.rpc('increment_sms_usage', {
          p_gym_id: effectiveGymId,
          p_month: currentMonth,
          p_count: -1,
        });
      } catch {}

      return jsonResp({ error: 'Failed to send SMS' }, 500);
    }

    // Twilio succeeded — everything from here is best-effort
    let twilioSid: string | null = null;
    try { twilioSid = (await twilioResp.json()).sid; } catch {}

    // Insert SMS log (best-effort). member_id y phone_number eran NOT NULL
    // (0257:62) — así que TODO SMS a un prospecto fallaba aquí con 23502, y
    // como un insert de Supabase resuelve en vez de lanzar, el try/catch no lo
    // veía: el mensaje salía, Twilio cobraba, y no quedaba fila. Mig 0689
    // relaja las dos columnas y añade prospect_id.
    const { error: logErr } = await supabase.from('sms_log').insert({
      gym_id: effectiveGymId,
      member_id: memberId ?? null,
      // Condicional a propósito. `prospect_id` lo añade la 0689, que puede no
      // estar aplicada cuando esta función se despliegue — y PostgREST rechaza
      // una columna desconocida en el payload aunque el valor sea null
      // (PGRST204). Mandarla siempre rompía el registro de TODOS los SMS,
      // incluidos los de miembros, que hoy funcionan. Así degrada al
      // comportamiento actual hasta que la migración entre.
      ...(prospectId ? { prospect_id: prospectId } : {}),
      admin_id: callerId,
      // finalPhone, no recipient.phone_number: cuando se usa overridePhone el
      // mensaje fue a OTRO número, y registrar el de la ficha hace que el log
      // mienta sobre a quién se le mandó.
      phone_number: finalPhone,
      body: smsBody,
      twilio_sid: twilioSid,
      status: 'sent',
      source: source || 'manual',
    });
    if (logErr) console.error('sms_log insert failed:', logErr.message);

    // Audit log (best-effort)
    try {
      if (callerId) {
        await supabase.from('admin_audit_log').insert({
          gym_id: effectiveGymId,
          actor_id: callerId,
          action: 'send_sms',
          entity_type: prospectId ? 'prospect' : 'member',
          entity_id: memberId ?? prospectId,
          // `overrode` deja rastro de cuándo el staff mandó a un número que NO
          // es el de la ficha. Los dos usos legítimos (código de acceso a un
          // miembro recién creado, panel de contacto) lo necesitan, así que no
          // se puede quitar — pero sí se puede hacer visible.
          details: {
            phone: finalPhone,
            on_file: recipient.phone_number ?? null,
            overrode: !!overridePhone && finalPhone !== recipient.phone_number,
            source: source || 'manual',
          },
        });
      }
    } catch {}

    return jsonResp({
      success: true,
      messageSid: twilioSid,
      usage: newCount ? { used: newCount, limit: smsMonthlyCap } : null,
    });
  } catch (err) {
    console.error('send-sms error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
const SMS_MONTHLY_CAP = parseInt(Deno.env.get('SMS_MONTHLY_CAP') || '200', 10);

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
        .select('role, gym_id')
        .eq('id', user.id)
        .single();

      if (!callerProfile || !['admin', 'super_admin', 'trainer'].includes(callerProfile.role)) {
        return jsonResp({ error: 'Admin/trainer access required' }, 403);
      }

      callerId = user.id;
      callerGymId = callerProfile.gym_id;
      callerRole = callerProfile.role;
    }

    const { memberId, body, source, gymId: bodyGymId, mediaUrl } = await req.json();

    if (!memberId || !body) {
      return jsonResp({ error: 'memberId and body are required' }, 400);
    }
    if (typeof body !== 'string' || body.length > 640) {
      return jsonResp({ error: 'Body must be 640 characters or fewer' }, 400);
    }

    // Get member profile with phone number
    const { data: memberProfile } = await supabase
      .from('profiles')
      .select('id, full_name, phone_number, gym_id')
      .eq('id', memberId)
      .single();

    if (!memberProfile) {
      return jsonResp({ error: 'Member not found' }, 404);
    }

    // Determine gym_id
    const effectiveGymId = isServiceRole
      ? (bodyGymId || memberProfile.gym_id)
      : callerGymId;

    // Gym boundary check (non-super_admin can only SMS their own gym)
    if (!isServiceRole && callerRole !== 'super_admin' && memberProfile.gym_id !== callerGymId) {
      return jsonResp({ error: 'Member not in your gym' }, 403);
    }

    // Validate phone number
    if (!memberProfile.phone_number) {
      return jsonResp({ error: 'Member has no phone number on file' }, 400);
    }
    const phoneRegex = /^\+1\d{10}$/;
    if (!phoneRegex.test(memberProfile.phone_number)) {
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
    const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    let newCount: number | null = null;
    try {
      const { data } = await supabase.rpc('increment_sms_usage', {
        p_gym_id: effectiveGymId,
        p_month: currentMonth,
        p_count: 1,
      });
      newCount = data;

      if (newCount && newCount > SMS_MONTHLY_CAP) {
        await supabase.rpc('increment_sms_usage', {
          p_gym_id: effectiveGymId,
          p_month: currentMonth,
          p_count: -1,
        });
        return jsonResp({
          error: `SMS limit reached (${SMS_MONTHLY_CAP}/month). Contact support for extension.`,
          usage: { used: SMS_MONTHLY_CAP, limit: SMS_MONTHLY_CAP },
        }, 429);
      }
    } catch (e) {
      console.warn('increment_sms_usage skipped:', e);
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
    formData.append('To', memberProfile.phone_number);
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

    // Insert SMS log (best-effort)
    try {
      await supabase.from('sms_log').insert({
        gym_id: effectiveGymId,
        member_id: memberId,
        admin_id: callerId,
        phone_number: memberProfile.phone_number,
        body: smsBody,
        twilio_sid: twilioSid,
        status: 'sent',
        source: source || 'manual',
      });
    } catch (e) {
      console.warn('sms_log insert failed:', e);
    }

    // Audit log (best-effort)
    try {
      if (callerId) {
        await supabase.from('admin_audit_log').insert({
          gym_id: effectiveGymId,
          actor_id: callerId,
          action: 'send_sms',
          entity_type: 'member',
          entity_id: memberId,
          details: { phone: memberProfile.phone_number, source: source || 'manual' },
        });
      }
    } catch {}

    return jsonResp({
      success: true,
      messageSid: twilioSid,
      usage: newCount ? { used: newCount, limit: SMS_MONTHLY_CAP } : null,
    });
  } catch (err) {
    console.error('send-sms error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.tugympr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Generate a cryptographically secure 6-digit code. */
function generateSecureCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const code = 100000 + (arr[0] % 900000);
  return String(code);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405);

  try {
    // --- Authentication: verify JWT from Authorization header ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResp({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');

    const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return jsonResp({ error: 'Invalid or expired token' }, 401);
    }

    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return jsonResp({ error: 'Email is required' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- Rate limiting: max 3 reset emails per email address per hour ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await adminClient
      .from('password_reset_requests')
      .select('*', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', oneHourAgo);

    if (countErr) {
      console.error('Rate limit check error:', countErr);
      return jsonResp({ error: 'Internal error' }, 500);
    }

    if ((count ?? 0) >= 3) {
      return jsonResp({ error: 'Too many reset requests. Please try again later.' }, 429);
    }

    // Create a password reset request using the existing RPC
    const { data, error: rpcErr } = await adminClient.rpc('create_password_reset_request', {
      p_email: email,
    });

    if (rpcErr) {
      console.error('RPC error:', rpcErr);
      return jsonResp({ error: 'Failed to create reset request' }, 500);
    }

    // If no account found, the RPC returns success without request_id/token.
    // We still return success to avoid revealing whether the email exists.
    if (!data?.request_id || !data?.token) {
      return jsonResp({ success: true, message: 'If an account exists, a code has been sent.' });
    }

    // Generate a cryptographically secure 6-digit numeric code
    const code = generateSecureCode();

    // Store the email_code on the request row
    const { error: updateErr } = await adminClient
      .from('password_reset_requests')
      .update({ email_code: code })
      .eq('id', data.request_id);

    if (updateErr) {
      console.error('Failed to store email code:', updateErr);
      return jsonResp({ error: 'Failed to generate reset code' }, 500);
    }

    // Send email via Resend
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TuGymPR <noreply@tugympr.com>',
        to: [email],
        subject: 'Your Password Reset Code',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">Password Reset</h2>
            <p style="color: #666; font-size: 15px;">Your verification code is:</p>
            <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">${code}</span>
            </div>
            <p style="color: #999; font-size: 13px;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
          </div>
        `,
      }),
    });

    if (!emailResp.ok) {
      const errBody = await emailResp.text();
      console.error('Resend error:', errBody);
      return jsonResp({ error: 'Failed to send email' }, 500);
    }

    return jsonResp({ success: true, message: 'If an account exists, a code has been sent.' });
  } catch (err) {
    console.error('send-reset-email error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});

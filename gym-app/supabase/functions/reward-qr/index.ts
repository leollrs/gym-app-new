import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const QR_SIGNING_SECRET = Deno.env.get('QR_SIGNING_SECRET');

// CORS — mirrors the pattern used by analyze-body-photo / send-push.
// ALLOWED_ORIGIN is required so this function cannot be called from
// arbitrary origins via XHR/fetch in a third-party browser context.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_ROLES = new Set(['owner', 'admin', 'super_admin']);

async function hmacSign(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(QR_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  // ── CORS preflight ─────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const redemptionId = url.searchParams.get('id');

  if (!redemptionId) {
    return new Response('Missing redemption ID', { status: 400, headers: corsHeaders });
  }

  // ── Auth: verify JWT from Authorization header ──────────
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return new Response(renderError('Authentication required'), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(renderError('Invalid or expired session'), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const callerId = userData.user.id;

  // Service-role client for trusted lookups
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up the redemption
  const { data: redemption, error } = await supabase
    .from('reward_redemptions')
    .select('id, profile_id, gym_id, reward_id, reward_name, points_spent, status, created_at')
    .eq('id', redemptionId)
    .single();

  if (error || !redemption) {
    return new Response(renderError('Reward not found'), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // ── Authorization: caller must own the redemption OR be admin in same gym ──
  const isOwner = redemption.profile_id === callerId;
  let isAuthorized = isOwner;

  if (!isAuthorized) {
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('id, role, gym_id, additional_roles')
      .eq('id', callerId)
      .single();

    const hasAdminPrimary = !!callerProfile && ADMIN_ROLES.has(callerProfile.role);
    const hasAdminAdditional = !!callerProfile
      && Array.isArray(callerProfile.additional_roles)
      && callerProfile.additional_roles.some((r: string) => ADMIN_ROLES.has(r));

    if (
      callerProfile &&
      (hasAdminPrimary || hasAdminAdditional) &&
      callerProfile.gym_id === redemption.gym_id
    ) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return new Response(renderError('You are not authorized to view this reward'), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (redemption.status === 'claimed') {
    return new Response(renderClaimed(redemption.reward_name), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (redemption.status === 'cancelled') {
    return new Response(renderError('This reward was cancelled'), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Get gym name + reward emoji
  const { data: gym } = await supabase
    .from('gyms')
    .select('name')
    .eq('id', redemption.gym_id)
    .single();

  // Try to get emoji from gym_rewards
  let emoji = '🎁';
  try {
    const { data: gr } = await supabase
      .from('gym_rewards')
      .select('emoji_icon')
      .eq('id', redemption.reward_id)
      .single();
    if (gr?.emoji_icon) emoji = gr.emoji_icon;
  } catch {}

  // SECURITY: only the redemption OWNER may be issued a claimable signed
  // `gym-reward:` token. A same-gym admin passes the authorization check above
  // (so they can VIEW status — the claimed/cancelled pages above already
  // rendered for them), but the signed QR is the artifact the *member* presents
  // to staff to claim. Minting it for an admin would let that admin self-scan
  // and claim a member's pending reward without the member being present.
  // Admins therefore get a status-only response for pending redemptions.
  if (!isOwner) {
    return new Response(
      renderError('Only the reward owner can display this QR code'),
      {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  // Build and sign the QR payload. Fail CLOSED if the signing secret is unset:
  // emitting an unsigned `gym-reward:...` payload would be forgeable and the
  // scanner/verifier could accept it, letting anyone mint a reward redemption QR.
  if (!QR_SIGNING_SECRET) {
    console.error('[reward-qr] QR_SIGNING_SECRET not set — refusing to mint an unsigned QR');
    return new Response(
      '<html><body style="font-family:sans-serif;padding:40px;text-align:center">Reward QR is temporarily unavailable. Please try again later.</body></html>',
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  const rawPayload = `gym-reward:${redemption.gym_id}:${redemption.profile_id}:${redemption.id}`;
  const timestamped = rawPayload + ':' + Date.now();
  const sig = await hmacSign(timestamped);
  const qrValue = timestamped + ':' + sig;

  const gymName = gym?.name || 'Your Gym';
  const format = url.searchParams.get('format');

  // Return PNG image for MMS embedding
  if (format === 'png') {
    try {
      const dataUrl: string = await QRCode.toDataURL(qrValue, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      const base64 = dataUrl.split(',')[1];
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      return new Response(binary, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      console.error('QR PNG generation failed:', e);
      return new Response('Failed to generate QR image', { status: 500, headers: corsHeaders });
    }
  }

  return new Response(
    renderQRPage(gymName, redemption.reward_name, emoji, qrValue, redemption.points_spent === 0),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
});

function escapeEmoji(s: string): string {
  return [...s].map(c => {
    const cp = c.codePointAt(0)!;
    return cp > 127 ? `&#x${cp.toString(16)};` : c;
  }).join('');
}

function renderQRPage(gymName: string, rewardName: string, emoji: string, qrValue: string, isGift: boolean): string {
  const escaped = (s: string) => escapeEmoji(s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escaped(rewardName)} - ${escaped(gymName)}</title>
  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #05070B;
      color: #E5E7EB;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 380px;
      width: 100%;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    }
    .badge {
      background: ${isGift ? 'linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))' : 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))'};
      text-align: center;
      padding: 14px;
      font-size: 14px;
      font-weight: 700;
      color: ${isGift ? '#D4AF37' : '#10B981'};
    }
    .info {
      background: #111827;
      text-align: center;
      padding: 24px 20px 16px;
    }
    .emoji { font-size: 48px; margin-bottom: 8px; }
    .reward-name { font-size: 20px; font-weight: 800; color: #F9FAFB; }
    .gym-name { font-size: 13px; color: #6B7280; margin-top: 4px; }
    .qr-wrap {
      background: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
    }
    .qr-wrap canvas { border-radius: 8px; }
    .footer {
      background: #111827;
      border-top: 1px solid rgba(255,255,255,0.06);
      text-align: center;
      padding: 16px 20px;
    }
    .footer p { font-size: 13px; font-weight: 600; color: #9CA3AF; }
    .footer .icon { display: inline-block; margin-right: 6px; vertical-align: -2px; color: #D4AF37; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${isGift ? '&#x1f381; Gift Reward' : '&#x2705; Reward Redeemed'}</div>
    <div class="info">
      <div class="emoji">${escaped(emoji)}</div>
      <div class="reward-name">${escaped(rewardName)}</div>
      <div class="gym-name">${escaped(gymName)}</div>
    </div>
    <div class="qr-wrap"><canvas id="qr"></canvas></div>
    <div class="footer">
      <p><span class="icon">&#9634;</span>Show this QR to staff to claim</p>
    </div>
  </div>
  <script>
    var qr = qrcode(0, 'H');
    qr.addData(${JSON.stringify(qrValue)});
    qr.make();
    var canvas = document.getElementById('qr');
    var size = 220;
    var cellSize = size / qr.getModuleCount();
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < qr.getModuleCount(); r++) {
      for (var c = 0; c < qr.getModuleCount(); c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
        }
      }
    }
  <\/script>
</body>
</html>`;
}

function renderClaimed(rewardName: string): string {
  const escaped = (s: string) => escapeEmoji(s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reward Claimed</title>
<style>body{font-family:-apple-system,sans-serif;background:#05070B;color:#E5E7EB;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.card{max-width:380px;width:100%;background:#111827;border-radius:20px;padding:40px 24px;box-shadow:0 25px 50px rgba(0,0,0,0.5)}
h2{font-size:20px;color:#10B981;margin-bottom:8px}</style></head>
<body><div class="card"><div style="font-size:48px;margin-bottom:16px">&#x2705;</div><h2>Already Claimed</h2><p style="color:#6B7280;font-size:14px">${escaped(rewardName)} has already been redeemed.</p></div></body></html>`;
}

function renderError(message: string): string {
  const escaped = (s: string) => escapeEmoji(s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reward</title>
<style>body{font-family:-apple-system,sans-serif;background:#05070B;color:#E5E7EB;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.card{max-width:380px;width:100%;background:#111827;border-radius:20px;padding:40px 24px;box-shadow:0 25px 50px rgba(0,0,0,0.5)}</style></head>
<body><div class="card"><div style="font-size:48px;margin-bottom:16px">&#x1f615;</div><p style="color:#9CA3AF;font-size:14px">${escaped(message)}</p></div></body></html>`;
}

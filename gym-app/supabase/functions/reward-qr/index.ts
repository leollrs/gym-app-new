import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const QR_SIGNING_SECRET = Deno.env.get('QR_SIGNING_SECRET');

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
  const url = new URL(req.url);
  const redemptionId = url.searchParams.get('id');

  if (!redemptionId) {
    return new Response('Missing redemption ID', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up the redemption
  const { data: redemption, error } = await supabase
    .from('reward_redemptions')
    .select('id, profile_id, gym_id, reward_name, points_spent, status, created_at')
    .eq('id', redemptionId)
    .single();

  if (error || !redemption) {
    return new Response(renderError('Reward not found'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (redemption.status === 'claimed') {
    return new Response(renderClaimed(redemption.reward_name), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (redemption.status === 'cancelled') {
    return new Response(renderError('This reward was cancelled'), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
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

  // Build and sign the QR payload
  const rawPayload = `gym-reward:${redemption.gym_id}:${redemption.profile_id}:${redemption.id}`;
  let qrValue = rawPayload;
  if (QR_SIGNING_SECRET) {
    const timestamped = rawPayload + ':' + Date.now();
    const sig = await hmacSign(timestamped);
    qrValue = timestamped + ':' + sig;
  }

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
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      console.error('QR PNG generation failed:', e);
      return new Response('Failed to generate QR image', { status: 500 });
    }
  }

  return new Response(
    renderQRPage(gymName, redemption.reward_name, emoji, qrValue, redemption.points_spent === 0),
    {
      status: 200,
      headers: {
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
      <div class="emoji">${emoji}</div>
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

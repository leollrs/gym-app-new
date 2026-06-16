// check-error-alerts
// Scheduled cron job (every 15 min) that turns the PULL-based error_logs table
// into a PUSH alert: it scans for new errors since its last run and emails the
// platform owner when there's a crash or an error spike — so you find out at
// 3am instead of when you next open the Platform → Error Logs page.
//
// Mirrors check-moderation-sla (auth, Resend, JSON-never-throw). Differences:
//   - Keeps a watermark in `ops_alert_state` (key='error-alerts') so each error
//     is considered exactly once (no double-alerting, no gaps between windows).
//   - A cooldown prevents 15-min spam during a sustained incident.
//
// Trigger logic (intentionally high-signal, to avoid alert fatigue):
//   - ANY react_crash in the window, OR
//   - (js_error + promise_rejection) >= OPS_ERROR_SPIKE_THRESHOLD (default 10).
//   400s (validation), auth_error (token expiry), slow_api and network_error
//   (offline transitions) are counted and SHOWN in the email but do NOT trigger
//   on their own — they're too noisy to page on.
//
// Wiring:
//   - Schedule:  supabase/migrations/0600_error_alert_cron.sql
//   - Auth:      X-Cron-Secret OR service-role bearer (cron-invoked).
//   - Recipient: OPS_ALERT_RECIPIENT env (default support@tugympr.com).
//   - Output:    { window, total, by_type, triggered, sent }
//
// Resilient pre-migration: if `ops_alert_state` doesn't exist yet, it falls
// back to a fixed 20-min window and skips the watermark write.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const ALERT_RECIPIENT = Deno.env.get('OPS_ALERT_RECIPIENT') || 'support@tugympr.com';
const ALERT_FROM = 'TuGymPR Alerts <noreply@tugympr.com>';
const SPIKE_THRESHOLD = Number(Deno.env.get('OPS_ERROR_SPIKE_THRESHOLD') ?? '10');
const COOLDOWN_MIN = Number(Deno.env.get('OPS_ALERT_COOLDOWN_MIN') ?? '30');
const STATE_KEY = 'error-alerts';

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Timing-safe comparison (HMAC-based, no length leak) — same as check-moderation-sla.
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
  // ── Auth: cron secret OR service-role token (cron sends Bearer <service_role>) ──
  const cronSecret = Deno.env.get('CRON_SECRET');
  const incomingCronSecret = req.headers.get('X-Cron-Secret') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '');

  const cronOk = !!(cronSecret && incomingCronSecret && await timingSafeEqual(cronSecret, incomingCronSecret));
  const serviceRoleOk = !!(bearerToken && SUPABASE_SERVICE_ROLE_KEY && await timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY));

  if (!cronOk && !serviceRoleOk) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // ── Read watermark (best-effort; table may not exist pre-migration) ──
    let lastRunIso: string | null = null;
    let lastAlertSentMs = 0;
    let stateAvailable = true;
    try {
      const { data: state, error: stateErr } = await admin
        .from('ops_alert_state')
        .select('last_run_at, last_alert_sent_at')
        .eq('key', STATE_KEY)
        .maybeSingle();
      if (stateErr) throw stateErr;
      lastRunIso = state?.last_run_at ?? null;
      lastAlertSentMs = state?.last_alert_sent_at ? Date.parse(state.last_alert_sent_at) : 0;
    } catch (_) {
      stateAvailable = false; // pre-migration — fall back to a fixed window
    }

    // Window = (lastRun, now]. First run / missing state → last 20 min.
    const windowStartMs = lastRunIso ? Date.parse(lastRunIso) : nowMs - 20 * 60 * 1000;
    const windowStartIso = new Date(windowStartMs).toISOString();

    // ── Pull new errors in the window ──
    const { data: rows, error: queryErr } = await admin
      .from('error_logs')
      .select('type, message, gym_id, page, created_at')
      .gt('created_at', windowStartIso)
      .lte('created_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (queryErr) {
      console.error('check-error-alerts query error:', queryErr);
      return jsonResp({ total: 0, sent: false, error: 'query_failed' }, 500);
    }

    const errors = rows ?? [];
    const total = errors.length;

    // Aggregate by type + by message + affected gyms.
    const byType: Record<string, number> = {};
    const byMessage = new Map<string, number>();
    const gymSet = new Set<string>();
    for (const e of errors) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      const m = (e.message ?? '').slice(0, 160);
      byMessage.set(m, (byMessage.get(m) ?? 0) + 1);
      if (e.gym_id) gymSet.add(e.gym_id);
    }

    const crashes = byType['react_crash'] ?? 0;
    const hardErrors = (byType['js_error'] ?? 0) + (byType['promise_rejection'] ?? 0);
    const triggered = crashes >= 1 || hardErrors >= SPIKE_THRESHOLD;

    const cooledDown = nowMs - lastAlertSentMs >= COOLDOWN_MIN * 60 * 1000;
    const shouldSend = triggered && cooledDown && !!RESEND_API_KEY;

    let sent = false;
    if (shouldSend) {
      const typeRows = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;">${escHtml(t)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${c}</td></tr>`,
        )
        .join('');

      const topMessages = Array.from(byMessage.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([m, c]) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;width:48px;">${c}×</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;word-break:break-word;">${escHtml(m) || '<em>(empty)</em>'}</td></tr>`,
        )
        .join('');

      const headline = crashes >= 1
        ? `${crashes} app crash${crashes === 1 ? '' : 'es'} detected`
        : `Error spike: ${hardErrors} hard errors in ~15 min`;
      const subject = `TuGymPR ALERT: ${headline}`;

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
          <h2 style="color:#b91c1c;margin:0 0 12px;">${escHtml(headline)}</h2>
          <p style="color:#1a1a1a;font-size:15px;line-height:1.5;margin:0 0 4px;">
            ${total} error${total === 1 ? '' : 's'} logged across ${gymSet.size} gym${gymSet.size === 1 ? '' : 's'}
            between <strong>${escHtml(windowStartIso)}</strong> and <strong>${escHtml(nowIso)}</strong>.
          </p>
          <h3 style="color:#1a1a1a;margin:20px 0 8px;font-size:14px;">By type</h3>
          <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead><tr style="background:#f5f5f5;"><th style="text-align:left;padding:8px 12px;">type</th><th style="text-align:right;padding:8px 12px;">count</th></tr></thead>
            <tbody>${typeRows}</tbody>
          </table>
          <h3 style="color:#1a1a1a;margin:20px 0 8px;font-size:14px;">Top messages</h3>
          <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <tbody>${topMessages}</tbody>
          </table>
          <p style="color:#999;font-size:12px;margin-top:24px;">
            Triage in Platform → Error Logs. Re-alerts are throttled to once per ${COOLDOWN_MIN} min while errors keep arriving.
            Tune via OPS_ERROR_SPIKE_THRESHOLD / OPS_ALERT_COOLDOWN_MIN / OPS_ALERT_RECIPIENT.
          </p>
        </div>
      `;

      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_RECIPIENT], subject, html }),
        });
        if (!emailResp.ok) {
          console.error('check-error-alerts Resend error:', await emailResp.text());
        } else {
          sent = true;
        }
      } catch (err) {
        console.error('check-error-alerts Resend exception:', err);
      }
    }

    // ── Advance the watermark (best-effort) ──
    if (stateAvailable) {
      try {
        const patch: Record<string, unknown> = { key: STATE_KEY, last_run_at: nowIso, updated_at: nowIso };
        if (sent) patch.last_alert_sent_at = nowIso;
        await admin.from('ops_alert_state').upsert(patch, { onConflict: 'key' });
      } catch (err) {
        console.error('check-error-alerts state write failed:', err);
      }
    }

    return jsonResp({
      window: { start: windowStartIso, end: nowIso },
      total,
      by_type: byType,
      triggered,
      sent,
      reason: !triggered ? 'below_threshold' : (!cooledDown ? 'cooldown' : (!RESEND_API_KEY ? 'resend_key_missing' : 'ok')),
    });
  } catch (err) {
    console.error('check-error-alerts unexpected error:', err);
    return jsonResp({ total: 0, sent: false, error: 'unexpected' }, 500);
  }
});

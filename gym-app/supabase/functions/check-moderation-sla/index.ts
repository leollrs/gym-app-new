// check-moderation-sla
// Hourly cron job that flags content_reports rows older than 24 hours that
// have not been triaged. Sends an internal alert email to support@tugympr.com
// so the moderation team can keep up with Apple's required 24h SLA on UGC
// reports (Guideline 1.2 / Play UGC policy).
//
// Wiring:
//   - Schedule: see supabase/migrations/0348_moderation_sla_cron.sql
//   - Auth:     uses service-role key (no caller auth — cron-invoked).
//   - Output:   { overdue: number, sent: boolean, error?: string }
//
// Failure mode: if Resend errors out we still return JSON (with the error
// captured) instead of throwing — pg_cron schedules should not crash on a
// transient mail failure.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const ALERT_RECIPIENT = 'support@tugympr.com';
const ALERT_FROM = 'TuGymPR Moderation <noreply@tugympr.com>';

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Timing-safe comparison (HMAC-based, no length leak)
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
  // ── Auth: require valid cron secret OR service-role token ──
  // The existing pg_cron job (migration 0348) sends Authorization: Bearer <service_role_key>.
  // Newer cron entries may send X-Cron-Secret. Either is accepted so the existing
  // pg_cron schedule keeps working without a forced migration.
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
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Anything still in 'pending' that was filed >24h ago is overdue.
    // content_reports.status enum (per migration 0038): pending | reviewed | dismissed | actioned.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: overdueRows, error: queryErr } = await adminClient
      .from('content_reports')
      .select('id, gym_id, content_type, reason, created_at')
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(500);

    if (queryErr) {
      console.error('check-moderation-sla query error:', queryErr);
      return jsonResp({ overdue: 0, sent: false, error: 'query_failed' }, 500);
    }

    const reports = overdueRows ?? [];
    const overdueCount = reports.length;

    if (overdueCount === 0) {
      return jsonResp({ overdue: 0, sent: false });
    }

    // Group counts per gym for the email body.
    const byGym = new Map<string, number>();
    for (const r of reports) {
      const key = r.gym_id ?? 'unknown';
      byGym.set(key, (byGym.get(key) ?? 0) + 1);
    }

    // Build the email body. Keep it plain — this is an internal ops alert.
    const idList = reports.map((r) => r.id).join(', ');
    const perGymRows = Array.from(byGym.entries())
      .sort((a, b) => b[1] - a[1])
      .map(
        ([gymId, count]) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;">${escHtml(
            String(gymId),
          )}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${count}</td></tr>`,
      )
      .join('');

    const subject = `TuGymPR: ${overdueCount} content reports overdue (24h SLA)`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #b91c1c; margin: 0 0 12px;">Moderation SLA breach</h2>
        <p style="color: #1a1a1a; font-size: 15px; line-height: 1.5;">
          ${overdueCount} content report${overdueCount === 1 ? '' : 's'} ${overdueCount === 1 ? 'has' : 'have'} been pending for more than 24 hours.
          Apple's UGC guideline requires action within 24h.
        </p>
        <h3 style="color: #1a1a1a; margin: 20px 0 8px; font-size: 14px;">Per-gym breakdown</h3>
        <table style="border-collapse: collapse; width: 100%; font-size: 13px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="text-align:left;padding:8px 12px;">gym_id</th>
              <th style="text-align:right;padding:8px 12px;">overdue</th>
            </tr>
          </thead>
          <tbody>${perGymRows}</tbody>
        </table>
        <h3 style="color: #1a1a1a; margin: 20px 0 8px; font-size: 14px;">Report IDs</h3>
        <p style="color: #555; font-size: 12px; word-break: break-all; font-family: monospace; line-height: 1.6;">
          ${escHtml(idList)}
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          Triage in the Admin → Moderation panel. This alert is sent hourly while the queue is non-empty.
        </p>
      </div>
    `;

    if (!RESEND_API_KEY) {
      console.error('check-moderation-sla: RESEND_API_KEY not configured — alert NOT sent.');
      return jsonResp({ overdue: overdueCount, sent: false, error: 'resend_key_missing' });
    }

    let sent = false;
    try {
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: ALERT_FROM,
          to: [ALERT_RECIPIENT],
          subject,
          html,
        }),
      });

      if (!emailResp.ok) {
        const errBody = await emailResp.text();
        console.error('check-moderation-sla Resend error:', errBody);
        return jsonResp({
          overdue: overdueCount,
          sent: false,
          error: 'resend_failed',
        });
      }
      sent = true;
    } catch (err) {
      console.error('check-moderation-sla Resend exception:', err);
      return jsonResp({
        overdue: overdueCount,
        sent: false,
        error: 'resend_exception',
      });
    }

    return jsonResp({ overdue: overdueCount, sent });
  } catch (err) {
    console.error('check-moderation-sla unexpected error:', err);
    return jsonResp({ overdue: 0, sent: false, error: 'unexpected' }, 500);
  }
});

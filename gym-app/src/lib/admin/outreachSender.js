import { supabase } from '../supabase';
import { sendNotification } from '../notifications';
import logger from '../logger';
import { logAdminAction } from '../adminAudit';
import { fetchMemberStats, tokensNeeded } from './outreachPersonalization';

// ── Batch dispatch tuning ──────────────────────────────────────────────────
// Email/SMS each go out as one edge-function invoke per recipient. Firing the
// whole audience at once (the old `Promise.allSettled(recipients.map(…))`) bursts
// past the email/SMS providers' concurrency + the edge runtime's limits, so a
// large batch sends to the first few then 502/500s the rest — even though every
// call works on its own. We cap in-flight recipients and pace each worker so the
// blast behaves like a steady stream of the known-good individual sends.
const OUTREACH_CONCURRENCY = 4;   // max recipients processed simultaneously
const OUTREACH_PACE_MS = 150;     // gap between sends within a single worker
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single send pipeline used by the unified Outreach composer. Given a resolved
 * recipient list and per-channel content, fans out to each enabled channel
 * (push, email, SMS, in-app), tallies successes/failures per channel, and
 * records one row in `admin_audit_log` for the whole batch so the gym has a
 * paper trail.
 *
 * Channels:
 *  - push:  routes through `sendNotification` (in-app row + native push)
 *  - email: invokes the `send-admin-email` edge function once per recipient
 *  - sms:   invokes the `send-sms` edge function once per recipient
 *  - inApp: a row in `notifications` only — no native push (use this when
 *           the message is informational and quiet hours matter less)
 */
export async function sendOutreach({
  gymId,
  recipients,            // [{ id, full_name, email, phone }]
  channels,              // { push, email, sms, inApp }
  subject,               // string (email)
  body,                  // string (all channels)
  html = null,           // optional pre-rendered email HTML (designer templates).
                         // When set, it's sent as the email body (merge tags
                         // inside it are personalized per recipient) instead of
                         // wrapping `body` in a <p>. Push/SMS/in-app still use `body`.
  personalize = {},      // gym-level constants for designer-template tokens:
                         // { gymName, coachName }. Per-recipient stats
                         // (streak_count/workout_count/days_inactive) are
                         // fetched here when their tokens appear in the copy.
  templateKey = null,    // optional — recorded in the audit log
  audienceLabel = '',    // human-readable description for the audit log
}) {
  const results = {
    push: { sent: 0, failed: 0 },
    email: { sent: 0, failed: 0 },
    sms: { sent: 0, failed: 0 },
    inApp: { sent: 0, failed: 0 },
    skipped: { noEmail: 0, noPhone: 0 },
  };

  if (!recipients?.length) return results;

  // Pre-fetch per-recipient stats once for the whole audience, but only for the
  // stat tokens this particular send actually references. Cheap (streak_cache /
  // last_active_at) plus a heavier completed-sessions count when needed.
  const statTokens = tokensNeeded(subject, body, html);
  const statsMap = statTokens.length
    ? await fetchMemberStats(gymId, recipients.map((r) => r.id), statTokens)
    : {};

  const gymNameToken = personalize.gymName || '';
  const coachNameToken = personalize.coachName || personalize.gymName || '';

  // HTML-escape member-controlled values before they're substituted into the
  // pre-rendered designer HTML. The designer renderer escapes its own literals
  // but leaves merge tokens (e.g. {{first_name}}) intact for per-recipient
  // substitution here — without escaping, a member whose name contains markup
  // (`<img onerror=…>`) would inject active HTML into the email they receive.
  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Personalize text for each recipient. Order matters for `full_name` vs
  // `name` — replace the longer token first so it doesn't get clipped.
  // `escape` is set ONLY for the HTML email path (plain push/SMS/in-app text
  // must NOT be HTML-escaped).
  const renderTokens = (recipient, raw, { escape = false } = {}) => {
    if (!raw) return '';
    const first = (recipient.full_name || '').split(' ')[0] || '';
    const s = statsMap[recipient.id] || {};
    const v = (x) => (escape ? escapeHtml(x) : x);
    return raw
      .replace(/\{\{full_name\}\}/g, v(recipient.full_name || ''))
      .replace(/\{\{first_name\}\}/g, v(first))
      .replace(/\{\{name\}\}/g, v(recipient.full_name || ''))
      .replace(/\{\{gym_name\}\}/g, v(gymNameToken))
      .replace(/\{\{coach_name\}\}/g, v(coachNameToken))
      .replace(/\{\{streak_count\}\}/g, v(s.streak_count ?? '0'))
      .replace(/\{\{workout_count\}\}/g, v(s.workout_count ?? '0'))
      .replace(/\{\{days_inactive\}\}/g, v(s.days_inactive ?? '—'));
  };

  const processRecipient = async (r) => {
    const personalizedBody = renderTokens(r, body);
    const personalizedSubject = renderTokens(r, subject);
    const personalizedHtml = html ? renderTokens(r, html, { escape: true }) : null;

    // Push + in-app (notifications row) via the same helper.
    if (channels.push) {
      try {
        await sendNotification(r.id, gymId, {
          type: 'admin_message',
          title: personalizedSubject || personalizedBody.slice(0, 80),
          body: personalizedBody,
          dedupKey: `outreach_${r.id}_${Date.now()}`,
        });
        results.push.sent++;
      } catch (err) {
        logger.warn('outreach push failed', r.id, err);
        results.push.failed++;
      }
    } else if (channels.inApp) {
      // In-app only — write the notification row, skip native push.
      try {
        const { error } = await supabase.from('notifications').insert({
          profile_id: r.id,
          gym_id: gymId,
          type: 'admin_message',
          title: personalizedSubject || personalizedBody.slice(0, 80),
          body: personalizedBody,
        });
        if (error) throw error;
        results.inApp.sent++;
      } catch (err) {
        logger.warn('outreach inApp failed', r.id, err);
        results.inApp.failed++;
      }
    }

    // Each channel is independent. (Previously a missing email did an early
    // `return`, which also skipped this recipient's SMS when both were enabled.)
    if (channels.email) {
      if (!r.email) {
        results.skipped.noEmail++;
      } else {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          // The edge function requires `memberId` (it looks up the member, verifies
          // they belong to the caller's gym, resolves the stored email, audits, and
          // rate-limits). When a designer template is attached we pass the
          // pre-rendered, token-substituted `html`; otherwise we send `body` and the
          // function wraps it in the gym's branded template.
          const { error } = await supabase.functions.invoke('send-admin-email', {
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
            body: {
              memberId: r.id,
              subject: personalizedSubject || 'Message from your gym',
              body: personalizedBody || personalizedSubject || ' ',
              ...(personalizedHtml ? { html: personalizedHtml } : {}),
            },
          });
          if (error) throw error;
          results.email.sent++;
        } catch (err) {
          logger.warn('outreach email failed', r.id, err);
          results.email.failed++;
        }
      }
    }

    if (channels.sms) {
      if (!r.phone) {
        results.skipped.noPhone++;
      } else {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          // send-sms derives the recipient phone + gym from the member record
          // server-side; it requires `{ memberId, body }` (a raw `to` is ignored).
          const { error } = await supabase.functions.invoke('send-sms', {
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
            body: { memberId: r.id, body: personalizedBody },
          });
          if (error) throw error;
          results.sms.sent++;
        } catch (err) {
          logger.warn('outreach sms failed', r.id, err);
          results.sms.failed++;
        }
      }
    }
  };

  // Bounded-concurrency pool: at most OUTREACH_CONCURRENCY recipients are ever
  // in flight, each worker pacing itself between sends. This is the fix for the
  // batch breaking after the first few — it never creates the burst that trips
  // the providers / edge runtime. A failed recipient never kills the pool.
  const queue = recipients.slice();
  const runWorker = async () => {
    while (queue.length) {
      const r = queue.shift();
      try { await processRecipient(r); }
      catch (err) { logger.warn('outreach recipient failed', r?.id, err); }
      if (queue.length) await sleep(OUTREACH_PACE_MS);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(OUTREACH_CONCURRENCY, recipients.length) }, runWorker),
  );

  // Single audit-log row covering the whole batch.
  await logAdminAction('outreach_send', 'outreach', null, {
    audience: audienceLabel,
    recipientCount: recipients.length,
    channels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
    templateKey,
    subject: subject || null,
    bodyPreview: body?.slice(0, 200) || '',
    results,
  });

  return results;
}

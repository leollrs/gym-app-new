import { supabase } from '../supabase';
import { sendNotification } from '../notifications';
import logger from '../logger';
import { logAdminAction } from '../adminAudit';

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

  // Personalize the body for each recipient (replaces {{name}} / {{first_name}}).
  const renderBody = (recipient, raw) => {
    if (!raw) return '';
    const first = (recipient.full_name || '').split(' ')[0] || '';
    return raw
      .replace(/\{\{first_name\}\}/g, first)
      .replace(/\{\{name\}\}/g, recipient.full_name || '')
      .replace(/\{\{full_name\}\}/g, recipient.full_name || '');
  };

  const tasks = recipients.map(async (r) => {
    const personalizedBody = renderBody(r, body);
    const personalizedSubject = renderBody(r, subject);

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

    if (channels.email) {
      if (!r.email) { results.skipped.noEmail++; return; }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase.functions.invoke('send-admin-email', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          body: {
            to: r.email,
            subject: personalizedSubject || 'Message from your gym',
            html: `<p>${personalizedBody.replace(/\n/g, '<br>')}</p>`,
            text: personalizedBody,
          },
        });
        if (error) throw error;
        results.email.sent++;
      } catch (err) {
        logger.warn('outreach email failed', r.id, err);
        results.email.failed++;
      }
    }

    if (channels.sms) {
      if (!r.phone) { results.skipped.noPhone++; return; }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase.functions.invoke('send-sms', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          body: { to: r.phone, message: personalizedBody },
        });
        if (error) throw error;
        results.sms.sent++;
      } catch (err) {
        logger.warn('outreach sms failed', r.id, err);
        results.sms.failed++;
      }
    }
  });

  await Promise.allSettled(tasks);

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

import { supabase } from './supabase';

/**
 * Log an admin action to the audit trail.
 * Fire-and-forget — never blocks the calling action.
 *
 * @param {string} action - e.g. 'create_challenge', 'freeze_member', 'send_sms'
 * @param {string} [entityType] - e.g. 'member', 'challenge', 'announcement'
 * @param {string} [entityId] - UUID of the affected entity
 * @param {object} [details] - extra context (truncated to avoid bloat)
 */
export function logAdminAction(action, entityType = null, entityId = null, details = {}) {
  try {
    supabase.rpc('log_admin_action', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_details: details,
    }).then(() => {}).catch(() => {}); // fire-and-forget
  } catch (_) {
    // silently ignore
  }
}

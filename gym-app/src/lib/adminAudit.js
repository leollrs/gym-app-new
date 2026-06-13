import { supabase } from './supabase';

/**
 * Log an admin action to the audit trail.
 * Fire-and-forget — never blocks the calling action.
 *
 * @param {string} action - e.g. 'create_challenge', 'freeze_member', 'send_sms'
 * @param {string} [entityType] - e.g. 'member', 'challenge', 'announcement'
 * @param {string} [entityId] - UUID of the affected entity
 * @param {object} [details] - extra context (truncated to avoid bloat)
 * @param {string} [targetGymId] - gym the action AFFECTED (platform support
 *   actions on another gym should file under that gym, not the actor's).
 *   Omitted → server falls back to the actor's gym (pre-0543 behavior).
 */
export function logAdminAction(action, entityType = null, entityId = null, details = {}, targetGymId = undefined) {
  const baseArgs = {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_details: details,
  };
  // Only pass the new named arg when provided — on a pre-0543 database the
  // extra named RPC arg would 404 (PGRST202), so plain calls stay untouched.
  const args = targetGymId ? { ...baseArgs, p_target_gym_id: targetGymId } : baseArgs;

  const isSignatureError = (error) => {
    if (!error) return false;
    if (error.code === 'PGRST202' || error.code === '42883') return true;
    const msg = `${error.message || ''} ${error.hint || ''}`;
    return /p_target_gym_id|could not find the function|does not exist/i.test(msg);
  };

  try {
    supabase.rpc('log_admin_action', args)
      .then(({ error }) => {
        if (!error) return;
        if (targetGymId && isSignatureError(error)) {
          // Pre-0543 database: retry with the legacy 4-arg signature.
          return supabase.rpc('log_admin_action', baseArgs).then(({ error: retryError }) => {
            if (retryError) console.error('[AuditLog] Failed to log action:', retryError);
          });
        }
        console.error('[AuditLog] Failed to log action:', error);
      })
      .catch(err => console.error('[AuditLog] Failed to log action:', err));
  } catch (err) {
    console.error('[AuditLog] Failed to log action:', err);
  }
}

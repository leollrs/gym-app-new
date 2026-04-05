/**
 * Integration Bridge — dispatches scan actions to external gym software.
 *
 * Design: fire-and-forget. The UI never waits for the external system.
 * Our Supabase write is the source of truth; the external call is best-effort.
 * Failed calls are queued to integration_queue for retry by a cron job.
 */
import { supabase } from './supabase';
import logger from './logger';

// In-memory cache for integration config (avoids DB hit on every scan)
let configCache = {};
let configCacheTime = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the active integration config for a gym.
 * Uses a 5-minute in-memory cache.
 */
async function getIntegrationConfig(gymId) {
  const now = Date.now();
  if (configCache[gymId] && (now - configCacheTime[gymId]) < CACHE_TTL) {
    return configCache[gymId];
  }

  try {
    const { data } = await supabase
      .from('gym_integrations')
      .select('id, provider, config, is_active, actions_enabled')
      .eq('gym_id', gymId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    configCache[gymId] = data || null;
    configCacheTime[gymId] = now;
    return data;
  } catch {
    return null;
  }
}

/** Clear the cached config (e.g. after admin changes settings). */
export function clearIntegrationCache(gymId) {
  if (gymId) {
    delete configCache[gymId];
    delete configCacheTime[gymId];
  } else {
    configCache = {};
    configCacheTime = {};
  }
}

/**
 * Dispatch a scan action to the gym's external integration (non-blocking).
 * @param {string} gymId
 * @param {string} action - 'checkin' | 'purchase' | 'reward' | 'referral' | 'voucher'
 * @param {Object} externalPayload - Data to send to the external system
 */
export async function dispatchToIntegration(gymId, action, externalPayload) {
  if (!gymId || !action || !externalPayload) return;

  const config = await getIntegrationConfig(gymId);
  if (!config?.is_active) return;
  if (!config.actions_enabled?.includes(action)) return;

  // Fire-and-forget: call the edge function, don't await in the UI
  supabase.functions.invoke('integration-webhook', {
    body: {
      integrationId: config.id,
      action,
      payload: externalPayload,
    },
  }).catch(async (err) => {
    // Queue for retry on failure
    logger.error('Integration dispatch failed, queuing for retry:', err);
    try {
      await supabase.from('integration_queue').insert({
        gym_id: gymId,
        integration_id: config.id,
        action,
        payload: externalPayload,
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      });
    } catch (queueErr) {
      logger.error('Failed to queue integration retry:', queueErr);
    }
  });
}

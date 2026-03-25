import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

// Always log push events — even in production — since push is critical infrastructure
const log = (...args) => console.log('[Push]', ...args);
const err = (...args) => console.error('[Push]', ...args);

const isNative = () => Capacitor.isNativePlatform();

/**
 * Register for push notifications, save the device token to Supabase,
 * and set up listeners for incoming notifications.
 *
 * Call once after login when user + profile are available.
 */
export async function initPushNotifications({ userId, gymId, onNotificationTap }) {
  if (!isNative() || !userId || !gymId) {
    log('Skipping — not native or missing userId/gymId');
    return;
  }

  try {
    // ── 1. Set up listeners BEFORE registering ────────────────────────────
    // This prevents the race condition where the token event fires
    // before the listener is attached.
    await PushNotifications.removeAllListeners();

    PushNotifications.addListener('registration', async ({ value: token }) => {
      log('Token received:', token?.substring(0, 20) + '...');
      await saveToken({ userId, gymId, token });
    });

    PushNotifications.addListener('registrationError', (error) => {
      err('Registration FAILED:', JSON.stringify(error));
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      log('Received in foreground:', notification.title || notification.id);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      log('Notification tapped:', action.notification?.data);
      const data = action.notification?.data;
      if (onNotificationTap) onNotificationTap(data);
    });

    // ── 2. Check / request permission ─────────────────────────────────────
    let permStatus = await PushNotifications.checkPermissions();
    log('Permission status:', permStatus.receive);

    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
      log('Permission after request:', permStatus.receive);
    }

    if (permStatus.receive !== 'granted') {
      log('Permission denied — cannot register');
      return;
    }

    // ── 3. Register with APNs / FCM ───────────────────────────────────────
    log('Registering with APNs...');
    await PushNotifications.register();
    log('register() called — waiting for token callback');

  } catch (e) {
    err('initPushNotifications error:', e?.message || e);
  }
}

/**
 * Upsert the device token into push_tokens table.
 */
async function saveToken({ userId, gymId, token }) {
  try {
    const platform = Capacitor.getPlatform();
    log(`Saving token to DB (platform: ${platform}, token: ${token.substring(0, 12)}...)`);

    // Try delete + insert instead of upsert (avoids RLS issues with ON CONFLICT)
    await supabase
      .from('push_tokens')
      .delete()
      .eq('profile_id', userId)
      .eq('platform', platform);

    const { data, error, status, statusText } = await supabase
      .from('push_tokens')
      .insert({
        profile_id: userId,
        gym_id: gymId,
        token,
        platform,
        updated_at: new Date().toISOString(),
      })
      .select('id');

    if (error) {
      err('INSERT failed:', error.message, error.code, error.details, 'status:', status);
    } else if (!data || data.length === 0) {
      err('INSERT returned no rows — likely RLS blocking. Status:', status, statusText);
    } else {
      log('Token saved successfully, id:', data[0].id);
    }
  } catch (e) {
    err('saveToken exception:', e?.message || e);
  }
}

/**
 * Remove all push tokens for the current user (call on logout).
 */
export async function removePushTokens(userId) {
  if (!isNative() || !userId) return;
  try {
    await supabase.from('push_tokens').delete().eq('profile_id', userId);
    await PushNotifications.removeAllListeners();
    log('Tokens removed for user');
  } catch (e) {
    err('removePushTokens error:', e?.message || e);
  }
}

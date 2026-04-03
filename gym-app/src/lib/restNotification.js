/**
 * Rest timer notifications — works on both native Capacitor and web.
 * On native: uses @capacitor/local-notifications (fires even when app is backgrounded/killed).
 * On web: uses the Web Notification API with a setTimeout fallback.
 */

import logger from './logger';
import i18n from 'i18next';

const REST_NOTIF_ID = 1001;
let channelCreated = false;

const isNative = () => {
  try { return window.Capacitor?.isNativePlatform?.() === true; }
  catch { return false; }
};

const isAndroid = () => {
  try { return window.Capacitor?.getPlatform?.() === 'android'; }
  catch { return false; }
};

/**
 * Ensure the high-priority Android notification channel exists.
 * On iOS this is a no-op (channels are Android-only).
 */
const ensureRestTimerChannel = async () => {
  if (channelCreated || !isAndroid()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel({
      id: 'rest-timer',
      name: 'Rest Timer',
      description: 'Alerts when your rest period is complete',
      importance: 5,
      visibility: 1,
      vibration: true,
      sound: 'default',
    });
    channelCreated = true;
  } catch (e) { logger.warn('Failed to create rest-timer channel:', e); }
};

export const requestNotificationPermission = async () => {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const { display } = await LocalNotifications.requestPermissions();
      await ensureRestTimerChannel();
      return display === 'granted';
    } catch { return false; }
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
};

export const scheduleRestDoneNotification = async (exerciseName, delaySeconds) => {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
      await LocalNotifications.schedule({
        notifications: [{
          id: REST_NOTIF_ID,
          title: i18n.t('notifications.restComplete', { ns: 'common', defaultValue: 'Rest Complete!' }),
          body: i18n.t('notifications.timeForNextSet', { ns: 'common', exercise: exerciseName, defaultValue: `Time for your next set of ${exerciseName}!` }),
          schedule: { at: new Date(Date.now() + delaySeconds * 1000) },
          sound: 'default',
          importance: 5,
          visibility: 1,
          channelId: 'rest-timer',
        }],
      });
    } catch (e) { logger.warn('LocalNotifications error:', e); }
    return;
  }
  // Web fallback
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  setTimeout(() => {
    if (document.hidden) {
      try {
        new Notification(i18n.t('notifications.restComplete', { ns: 'common', defaultValue: 'Rest Complete!' }), {
          body: i18n.t('notifications.timeForNextSet', { ns: 'common', exercise: exerciseName, defaultValue: `Time for your next set of ${exerciseName}!` }),
          icon: '/favicon.ico',
        });
      } catch { }
    }
  }, delaySeconds * 1000);
};

export const cancelRestNotification = async () => {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
    } catch { }
  }
  // Web: can't cancel a pending setTimeout without the ID — acceptable trade-off
};

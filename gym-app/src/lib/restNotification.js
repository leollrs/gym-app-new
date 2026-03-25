/**
 * Rest timer notifications — works on both native Capacitor and web.
 * On native: uses @capacitor/local-notifications (fires even when app is backgrounded/killed).
 * On web: uses the Web Notification API with a setTimeout fallback.
 */

import logger from './logger';

const REST_NOTIF_ID = 1001;

const isNative = () => {
  try { return window.Capacitor?.isNativePlatform?.() === true; }
  catch { return false; }
};

export const requestNotificationPermission = async () => {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const { display } = await LocalNotifications.requestPermissions();
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
          title: 'Rest Complete!',
          body: `Time for your next set of ${exerciseName}!`,
          schedule: { at: new Date(Date.now() + delaySeconds * 1000) },
          sound: 'default',
          importance: 4,
          visibility: 1,
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
        new Notification('Rest Complete!', {
          body: `Time for your next set of ${exerciseName}!`,
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

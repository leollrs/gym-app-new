/**
 * Daily 9 AM local notification reminding the user to log their soreness
 * check-in. Uses @capacitor/local-notifications so it fires regardless of
 * app state (and independent of the push pipeline, which is unrelated and
 * sometimes flaky in this codebase).
 *
 * Strategy: schedule the next 7 days at app launch. iOS allows up to 64
 * pending local notifications so 7 is safely within the limit. We cancel
 * any prior wellness reminders before scheduling new ones to prevent
 * duplicates after a re-install or settings change.
 *
 * The notification fires daily even on workout days — by design, the check-
 * in is a "how do I feel today" signal best captured in the morning before
 * training. The post-workout in-app prompt in SessionSummary is a backup
 * for users who skipped the morning prompt.
 */

import logger from './logger';
import i18n from 'i18next';

// ID range reserved for wellness reminders. Each scheduled day gets its own
// ID so we can cancel them individually if needed.
const WELLNESS_NOTIF_ID_BASE = 4000;
const WELLNESS_NOTIF_ID_END = 4006; // base + 6 → 7 IDs total

const isNative = () => {
  try { return window.Capacitor?.isNativePlatform?.() === true; }
  catch { return false; }
};

const isAndroid = () => {
  try { return window.Capacitor?.getPlatform?.() === 'android'; }
  catch { return false; }
};

let channelCreated = false;
const ensureWellnessChannel = async () => {
  if (channelCreated || !isAndroid()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel({
      id: 'wellness-checkin',
      name: 'Daily wellness check-in',
      description: 'Reminds you to log your soreness each morning',
      importance: 4,
      visibility: 1,
      vibration: true,
      sound: 'default',
    });
    channelCreated = true;
  } catch (e) { logger.warn('Failed to create wellness-checkin channel:', e); }
};

/**
 * Schedule the next 7 days at 9:00 local time. Idempotent — cancels any
 * prior wellness reminders first.
 */
export async function scheduleWellnessReminders() {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    // Ask for permission once. If the user has already granted (or denied),
    // this is a quick no-op on iOS.
    try { await LocalNotifications.requestPermissions(); } catch {}
    await ensureWellnessChannel();

    // Cancel any pending wellness reminders so we don't double-schedule.
    const cancelIds = [];
    for (let i = WELLNESS_NOTIF_ID_BASE; i <= WELLNESS_NOTIF_ID_END; i += 1) {
      cancelIds.push({ id: i });
    }
    try { await LocalNotifications.cancel({ notifications: cancelIds }); } catch {}

    const title = i18n.t('notifications.wellnessTitle', {
      ns: 'common',
      defaultValue: 'Daily check-in',
    });
    const body = i18n.t('notifications.wellnessBody', {
      ns: 'common',
      defaultValue: 'How sore are you today? Tap to log.',
    });

    const now = new Date();
    const todayAt9 = new Date(now);
    todayAt9.setHours(9, 0, 0, 0);

    const notifications = [];
    for (let i = 0; i < 7; i += 1) {
      const at = new Date(todayAt9);
      at.setDate(at.getDate() + i);
      // If today's 9 AM has already passed, skip it (user is already past the
      // reminder window for today — the post-workout prompt covers them).
      if (at.getTime() <= now.getTime()) continue;
      notifications.push({
        id: WELLNESS_NOTIF_ID_BASE + i,
        title,
        body,
        schedule: { at },
        sound: 'default',
        importance: 4,
        visibility: 1,
        channelId: 'wellness-checkin',
      });
    }

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch (e) {
    logger.warn('scheduleWellnessReminders failed:', e);
  }
}

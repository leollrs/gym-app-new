/**
 * Meal-time local reminders + the shared meal-schedule model.
 *
 * The Nutrition planner lets a member choose how many meals a day they eat
 * (3–5, snacks sit between lunch and dinner) and, optionally, a time for each.
 * When a time is set we fire a @capacitor/local-notifications reminder near it
 * carrying the NAME of the meal they planned for that slot — so the nudge is
 * "Grilled Chicken Bowl · time for your lunch", not a generic ping.
 *
 * This module owns:
 *   • the slot model (plannerSlotKeys / slotTypeOf) — imported by Nutrition.jsx
 *     so the planner and the scheduler can never drift,
 *   • the persisted per-user schedule (localStorage `meal_schedule_<uid>`),
 *   • scheduling: cancel prior meal reminders, then schedule the next 7 days'
 *     planned meals that have a time still in the future.
 *
 * Mirrors wellnessReminder.js: native-only, idempotent (cancel-then-schedule),
 * dynamic import so the web build never pulls the plugin. iOS caps pending
 * local notifications at 64; 7 days × 5 slots = 35, safely under.
 */

import logger from './logger';
import i18n from 'i18next';

// ── Slot model (shared source of truth) ──────────────────────────────────────
// Planner slot KEYS are unique (snack1/snack2/…) so two snacks never collide in
// a day map; the generator only knows the TYPE 'snack', so slotTypeOf() maps
// back. Realistic bounds: 2–6 meals/day.
export const MEAL_SLOT_MIN = 2;
export const MEAL_SLOT_MAX = 6;

const clampCount = (count) => Math.min(MEAL_SLOT_MAX, Math.max(MEAL_SLOT_MIN, count | 0));

// Slot keys for a meals/day count. Snacks sit between lunch and dinner. Order
// MIRRORS mealPlanner.slotTypesFor() so positional matching stays aligned.
export function plannerSlotKeys(count = 3) {
  const n = clampCount(count);
  if (n === 2) return ['lunch', 'dinner'];
  const snacks = n - 3; // 0 when n === 3
  return ['breakfast', 'lunch', ...Array.from({ length: snacks }, (_, i) => `snack${i + 1}`), 'dinner'];
}

// Planner key → mealPlanner slot type (matchesSlot only understands these).
export function slotTypeOf(key) {
  return /^snack\d*$/.test(key) ? 'snack' : key;
}

// Translated label for a slot key. Snacks get numbered only when there's >1.
export function slotLabelFor(key, count, t) {
  const tr = t || ((k, o) => (o && o.defaultValue) || k);
  if (key === 'breakfast') return tr('nutrition.meals.breakfast', { defaultValue: 'Breakfast' });
  if (key === 'lunch') return tr('nutrition.meals.lunch', { defaultValue: 'Lunch' });
  if (key === 'dinner') return tr('nutrition.meals.dinner', { defaultValue: 'Dinner' });
  const base = tr('nutrition.meals.snack', { defaultValue: 'Snack' });
  const m = /^snack(\d+)$/.exec(key);
  const snackCount = Math.max(0, clampCount(count) - 3);
  if (m && snackCount > 1) return `${base} ${m[1]}`;
  return base;
}

// ── Persisted schedule ───────────────────────────────────────────────────────
const scheduleKey = (userId) => `meal_schedule_${userId || 'anon'}`;
const DEFAULT_SCHEDULE = { count: 3, times: {} };

export function loadMealSchedule(userId) {
  try {
    const raw = localStorage.getItem(scheduleKey(userId));
    if (!raw) return { ...DEFAULT_SCHEDULE };
    const parsed = JSON.parse(raw);
    const raw2 = parsed.count | 0;
    return {
      count: raw2 ? clampCount(raw2) : 3,
      times: (parsed.times && typeof parsed.times === 'object') ? parsed.times : {},
    };
  } catch { return { ...DEFAULT_SCHEDULE }; }
}

export function saveMealSchedule(userId, schedule) {
  try { localStorage.setItem(scheduleKey(userId), JSON.stringify(schedule)); }
  catch { /* quota */ }
}

// ── Native plumbing ──────────────────────────────────────────────────────────
const MEAL_NOTIF_ID_BASE = 7200; // reserves 7200 .. 7234 (7 days × 5 slots)

const isNative = () => {
  try { return window.Capacitor?.isNativePlatform?.() === true; } catch { return false; }
};
const isAndroid = () => {
  try { return window.Capacitor?.getPlatform?.() === 'android'; } catch { return false; }
};

const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Sunday-start week key, matching Nutrition.jsx getWeekStartDate().
const weekStartOf = (d) => {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay());
  return toDateStr(s);
};

// Read a persisted week plan the same way the planner writes it.
const readWeekPlan = (userId, ws) => {
  try {
    const raw = localStorage.getItem(`meal_plan_${userId || 'anon'}_${ws}`);
    if (!raw) return {};
    return JSON.parse(raw).days || {};
  } catch { return {}; }
};

let channelCreated = false;
const ensureMealChannel = async (LocalNotifications) => {
  if (channelCreated || !isAndroid()) return;
  try {
    await LocalNotifications.createChannel({
      id: 'meal-reminders',
      name: 'Meal reminders',
      description: 'Reminds you when a planned meal is coming up',
      importance: 4,
      visibility: 1,
      vibration: true,
      sound: 'default',
    });
    channelCreated = true;
  } catch (e) { logger.warn('Failed to create meal-reminders channel:', e); }
};

/**
 * Request notification permission for meal reminders. Call this from a user
 * gesture (setting a time) — never from a background effect. Returns granted.
 */
export async function ensureMealNotifPermission() {
  if (!isNative()) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    return perm.display === 'granted';
  } catch { return false; }
}

const mealName = (meal) => (meal?.name || meal?.title || '').toString().trim();

/**
 * Cancel all meal reminders, then (if permission is already granted) schedule
 * the next 7 days of planned meals that have a time still ahead. Idempotent —
 * safe to call on every plan/schedule change. Never PROMPTS for permission;
 * that's ensureMealNotifPermission()'s job from a user gesture.
 */
export async function syncMealReminders({ userId, schedule, t } = {}) {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    // Always clear our whole reserved range first so removed times / meals
    // don't leave orphan reminders pending.
    const cancelIds = [];
    for (let i = 0; i < 7 * MEAL_SLOT_MAX; i += 1) cancelIds.push({ id: MEAL_NOTIF_ID_BASE + i });
    try { await LocalNotifications.cancel({ notifications: cancelIds }); } catch {}

    const times = schedule?.times || {};
    const keys = plannerSlotKeys(schedule?.count || 3);
    if (!keys.some((k) => times[k])) return; // no times set → nothing to schedule

    // Only schedule if the user has already granted; don't surprise-prompt.
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    await ensureMealChannel(LocalNotifications);

    const now = new Date();
    const notifications = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() + d);
      date.setHours(12, 0, 0, 0);
      const dateStr = toDateStr(date);
      const days = readWeekPlan(userId, weekStartOf(date));
      const dayMeals = days[dateStr] || {};

      keys.forEach((key, si) => {
        const time = times[key];
        if (!time) return;
        const meal = dayMeals[key];
        const name = mealName(meal);
        if (!name) return; // nothing planned for this slot → no name to show
        const [H, M] = String(time).split(':').map((x) => parseInt(x, 10));
        if (Number.isNaN(H)) return;
        const at = new Date(date);
        at.setHours(H, M || 0, 0, 0);
        if (at.getTime() <= now.getTime()) return; // already passed

        const slotLabel = slotLabelFor(key, schedule.count, t || i18n.t.bind(i18n));
        notifications.push({
          id: MEAL_NOTIF_ID_BASE + d * MEAL_SLOT_MAX + si,
          title: name,
          body: i18n.t('nutrition.mealReminderBody', {
            ns: 'pages', slot: slotLabel,
            defaultValue: `Time for your ${slotLabel.toLowerCase()}`,
          }),
          schedule: { at },
          sound: 'default',
          importance: 4,
          visibility: 1,
          channelId: 'meal-reminders',
        });
      });
    }

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch (e) {
    logger.warn('syncMealReminders failed:', e);
  }
}

const QUEUE_KEY = 'offline_queue';
const CACHE_KEY = 'offline_workout_cache';

const ALLOWED_TABLES = [
  'workout_sessions', 'session_exercises', 'check_ins',
  'body_weight_logs', 'body_measurements', 'food_logs',
  'personal_records', 'pr_history', 'activity_feed_items',
  'workout_likes', 'workout_comments', 'daily_challenge_completions'
];

export function queueWrite(table, payload) {
  if (!ALLOWED_TABLES.includes(table)) {
    console.warn('Blocked offline queue write to unauthorized table:', table);
    return;
  }
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  queue.push({ table, payload, timestamp: Date.now(), id: crypto.randomUUID() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueue() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

export function removeFromQueue(id) {
  const queue = getQueue().filter(item => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function cacheWorkoutData(routineId, data) {
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  cache[routineId] = { data, cachedAt: Date.now() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function getCachedWorkoutData(routineId) {
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  const entry = cache[routineId];
  if (!entry) return null;
  // Cache valid for 7 days
  if (Date.now() - entry.cachedAt > 7 * 24 * 60 * 60 * 1000) return null;
  return entry.data;
}

export async function flushQueue(supabase) {
  const queue = getQueue();
  if (queue.length === 0) return;

  for (const item of queue) {
    if (!ALLOWED_TABLES.includes(item.table)) {
      console.warn('Blocked offline queue flush to unauthorized table:', item.table);
      removeFromQueue(item.id);
      continue;
    }
    try {
      const { error } = await supabase.from(item.table).insert(item.payload);
      if (!error) {
        removeFromQueue(item.id);
      }
    } catch {
      // Will retry next time
      break;
    }
  }
}

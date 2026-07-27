const QUEUE_KEY = 'offline_queue';
const CACHE_KEY = 'offline_workout_cache';
// Items that exhausted their retries land here so we never silently destroy a
// member's logged workout — support can read it, and it can never grow into
// the live queue's replay path again.
const DEAD_KEY = 'offline_queue_dead';
// Global flush gate: { failures, nextFlushAt }. Lives in localStorage so it
// survives the WebView reloads that Capacitor does on resume.
const GATE_KEY = 'offline_queue_gate';

const ALLOWED_TABLES = [
  'workout_sessions', 'session_exercises', 'check_ins',
  'body_weight_logs', 'body_measurements', 'food_logs',
  'personal_records', 'pr_history', 'activity_feed_items',
  'workout_likes', 'workout_comments', 'daily_challenge_completions'
];

// ── Guard rails ─────────────────────────────────────────────────────────────
// The queue shares the ~5 MB localStorage budget with the React Query
// persister and the ucs: page caches, so it must be bounded. 200 rows is far
// more than a stranded session can produce and still leaves the budget intact.
const MAX_QUEUE_ITEMS = 200;
const MAX_DEAD_ITEMS = 50;
// A write that comes back with a RETURNED error (RLS reject, FK violation,
// duplicate key, schema drift) will fail identically forever. Without a cap it
// stayed queued for life and replayed in full on every single reconnect.
const MAX_ATTEMPTS = 5;
// Anything older than this is unrecoverable in practice (schema has moved on).
const ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Backoff between whole-queue flushes after a TRANSPORT failure. Connectivity
// flapping (gym basement, elevator, lock screen) used to fire a full replay per
// flap; now the second flap inside 30s is a no-op.
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

// Reentrancy guard — 'online' + appStateChange + the ActiveSession finish path
// can all fire within the same tick, and two concurrent flushes of the same
// queue double-insert every row.
let flushInFlight = false;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded — the queue is the least valuable thing in localStorage
    // to keep whole, so halve it (oldest first) and try once more rather than
    // letting the write silently vanish.
    if (Array.isArray(value) && value.length > 1) {
      try {
        localStorage.setItem(key, JSON.stringify(value.slice(Math.ceil(value.length / 2))));
        return true;
      } catch { /* still no room — give up */ }
    }
    return false;
  }
}

export function queueWrite(table, payload) {
  if (!ALLOWED_TABLES.includes(table)) {
    console.warn('Blocked offline queue write to unauthorized table:', table);
    return;
  }
  const queue = getQueue();
  queue.push({
    table,
    payload,
    timestamp: Date.now(),
    id: crypto.randomUUID(),
    attempts: 0,      // failed insert count — drives MAX_ATTEMPTS + backoff
    nextAttemptAt: 0, // epoch ms; 0 = eligible immediately
  });
  // FIFO eviction. Dropping the OLDEST keeps the workout the member just
  // finished — the one they'd actually notice missing.
  while (queue.length > MAX_QUEUE_ITEMS) {
    const dropped = queue.shift();
    console.warn('Offline queue full — dropping oldest queued write:', dropped?.table);
  }
  writeJson(QUEUE_KEY, queue);
}

export function getQueue() {
  const queue = readJson(QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

export function removeFromQueue(id) {
  const queue = getQueue().filter(item => item.id !== id);
  writeJson(QUEUE_KEY, queue);
}

/** Read-only view of writes that exhausted their retries (diagnostics). */
export function getDeadLetterQueue() {
  const dead = readJson(DEAD_KEY, []);
  return Array.isArray(dead) ? dead : [];
}

function moveToDeadLetter(item, reason) {
  console.warn('Offline queue: giving up on write', { table: item?.table, reason, attempts: item?.attempts });
  const dead = getDeadLetterQueue();
  dead.push({ ...item, deadReason: reason, deadAt: Date.now() });
  // Bounded — the dead letter is diagnostics, not storage.
  while (dead.length > MAX_DEAD_ITEMS) dead.shift();
  writeJson(DEAD_KEY, dead);
}

function readGate() {
  const gate = readJson(GATE_KEY, null);
  return gate && typeof gate === 'object'
    ? { failures: Number(gate.failures) || 0, nextFlushAt: Number(gate.nextFlushAt) || 0 }
    : { failures: 0, nextFlushAt: 0 };
}

function noteTransportFailure() {
  const { failures } = readGate();
  const next = failures + 1;
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (next - 1));
  writeJson(GATE_KEY, { failures: next, nextFlushAt: Date.now() + delay });
}

function clearGate() {
  try { localStorage.removeItem(GATE_KEY); } catch { /* noop */ }
}

export function cacheWorkoutData(routineId, data) {
  const cache = readJson(CACHE_KEY, {});
  cache[routineId] = { data, cachedAt: Date.now() };
  writeJson(CACHE_KEY, cache);
}

export function getCachedWorkoutData(routineId) {
  const cache = readJson(CACHE_KEY, {});
  const entry = cache[routineId];
  if (!entry) return null;
  // Cache valid for 7 days
  if (Date.now() - entry.cachedAt > 7 * 24 * 60 * 60 * 1000) return null;
  return entry.data;
}

export async function flushQueue(supabase) {
  if (flushInFlight) return;

  // Backoff gate — a flapping connection must not replay the whole queue on
  // every flap. `force`-style callers don't exist today; reconnect handlers
  // simply retry later.
  if (Date.now() < readGate().nextFlushAt) return;

  const queue = getQueue();
  if (queue.length === 0) { clearGate(); return; }

  flushInFlight = true;
  try {
    const now = Date.now();
    let transportFailed = false;

    for (const item of queue) {
      if (!ALLOWED_TABLES.includes(item.table)) {
        console.warn('Blocked offline queue flush to unauthorized table:', item.table);
        removeFromQueue(item.id);
        continue;
      }
      // Per-item backoff — a row that just failed waits its turn instead of
      // being hammered on the next reconnect.
      if (item.nextAttemptAt && now < item.nextAttemptAt) continue;
      // Age out: after a week the schema this payload was shaped for may not
      // exist any more, so retrying is pure noise.
      if (item.timestamp && now - item.timestamp > ITEM_TTL_MS) {
        moveToDeadLetter(item, 'expired');
        removeFromQueue(item.id);
        continue;
      }

      let returnedError = null;
      try {
        const { error } = await supabase.from(item.table).insert(item.payload);
        returnedError = error || null;
      } catch (err) {
        // Belt-and-braces. postgrest-js normally does NOT throw (see below), but
        // an exception here is unambiguously not this row's fault either.
        transportFailed = true;
        console.warn('Offline queue flush aborted — transport threw:', err?.message);
        break;
      }

      if (!returnedError) {
        removeFromQueue(item.id);
        continue;
      }

      // ── Transport failure vs row rejection ──────────────────────────────
      // Do NOT assume a network failure arrives as a thrown exception. It does
      // not: postgrest-js attaches `res.catch(fetchError => ({ error, data: null,
      // status: 0 }))` whenever `shouldThrowOnError` is false, and this project
      // never calls `.throwOnError()` (see src/lib/supabase.js). So a dead
      // connection comes back as a RETURNED error with `status === 0` and no
      // Postgres `code`.
      //
      // Getting this wrong is a data-loss bug: a member finishing a workout on
      // dead-but-"online" wifi (gym basement, captive portal) would burn one
      // attempt per flush, hit MAX_ATTEMPTS in minutes, and have their completed
      // session silently dead-lettered. A transport failure must cost nothing.
      const isTransport =
        returnedError.status === 0 ||
        (!returnedError.code && /fetch|network|load failed|timeout/i.test(returnedError.message || ''));
      if (isTransport) {
        transportFailed = true;
        console.warn('Offline queue flush aborted — transport failure:', returnedError.message);
        break;
      }

      // RETURNED error WITH a Postgres code = the server rejected this specific
      // row (RLS, FK, duplicate key, dropped column). Retrying it verbatim will
      // fail the same way forever, so count it and eventually let it go.
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        moveToDeadLetter({ ...item, attempts }, returnedError.message || 'insert rejected');
        removeFromQueue(item.id);
        continue;
      }
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempts - 1));
      const updated = getQueue().map(q =>
        q.id === item.id ? { ...q, attempts, nextAttemptAt: Date.now() + delay } : q
      );
      writeJson(QUEUE_KEY, updated);
    }

    if (transportFailed) noteTransportFailure();
    else clearGate(); // reached the server for every eligible item — reset backoff
  } finally {
    flushInFlight = false;
  }
}

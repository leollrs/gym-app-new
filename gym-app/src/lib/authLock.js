// authLock.js
// The `lock` implementation handed to supabase-js's auth client.
//
// WHY NOT THE DEFAULT: supabase-js defaults to `navigatorLock` (Web Locks). The
// default lock is held while our async storage adapter resolves the token. In
// React StrictMode (dev) the AuthProvider mounts → starts acquiring the lock →
// unmounts, ORPHANING it. The next acquire then blocks ~5s, gets force-"stolen",
// and throws `AbortError: Lock was stolen by another request`, which left auth
// init hung and the whole app stuck on the black splash. (Multiple tabs amplify
// it, but StrictMode alone reproduces it.) A per-tab promise-chain lock
// serializes token refresh WITHIN the tab — which is all that matters for
// refresh races in practice; it was the supabase-js default for years — and can
// never be orphaned or stolen. Separate browser profiles (our admin/trainer/
// member test sessions) each have their own scope anyway.
//
// THE CONTRACT (@supabase/auth-js src/lib/locks.ts): `acquireTimeout` is not
// advisory.
//   • < 0  → wait indefinitely
//   • = 0  → throw NOW if the lock isn't free. `_autoRefreshTokenTick` passes 0
//            and catches `isAcquireTimeout` to skip that tick.
//   • > 0  → throw after that long. Every public auth call passes
//            `lockAcquireTimeout`, which defaults to 5000.
// The error must carry `isAcquireTimeout === true`; auth-js tests that property,
// not `instanceof`.
//
// The first version of this lock took the timeout as `_acquireTimeout` and
// ignored it — every acquisition waited forever. That turned a single hung
// holder into a PERMANENT app-wide wedge: `getSession()` runs on every Supabase
// REST request (SupabaseClient._getAccessToken), so once the chain stalled,
// every query, every refresh and every realtime auth push queued behind it and
// never came back. The session looked "stale" with no error anywhere, and the
// only cure was relaunching the app — a new JS context gets a fresh Map.
// Honoring the timeout turns that into a 5s failure the caller can retry, which
// is what auth-js is written against.

// A holder can hang for real: a @capacitor/preferences bridge callback dropped
// across an iOS suspend never settles, and no fetch timeout covers it. So the
// queue also gets a hard ceiling — past it we release the gate and let the queue
// drain. Losing mutual exclusion against an operation that is never going to
// finish costs nothing; keeping the app dead until relaunch costs everything.
// It sits above the 15s fetch abort in supabase.js, so a merely-slow network
// request finishes (or aborts) long before this can fire.
export const LOCK_HOLD_CEILING_MS = 20_000;

export class LockAcquireTimeoutError extends Error {
  constructor(name, timeout) {
    super(`Acquiring an exclusive Navigator LockManager lock "${name}" timed out after ${timeout}ms`);
    this.name = 'LockAcquireTimeoutError';
    this.isAcquireTimeout = true;
  }
}

// name → { tail, queued }. `tail` is the promise the next caller waits on;
// `queued` counts holder + waiters, which is how "is it free right now" gets
// answered for the acquireTimeout === 0 case.
const locks = new Map();

export default async function inMemoryLock(name, acquireTimeout, fn) {
  let st = locks.get(name);
  if (!st) { st = { tail: Promise.resolve(), queued: 0 }; locks.set(name, st); }

  // Fail-fast probe. Skipping is the sanctioned outcome here — auth-js catches
  // this exact shape and tries again on the next 30s tick.
  if (acquireTimeout === 0 && st.queued > 0) throw new LockAcquireTimeoutError(name, 0);

  const prev = st.tail;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // Both arms resolve to `gate`: a rejected link would propagate down the whole
  // queue and fail every future acquisition for the life of the page.
  st.tail = prev.then(() => gate, () => gate);
  st.queued += 1;

  let ceiling = null;
  try {
    if (acquireTimeout >= 0) {
      let timer;
      const timedOut = Symbol('timeout');
      const raced = await Promise.race([
        prev.then(() => null, () => null),
        new Promise((resolve) => { timer = setTimeout(() => resolve(timedOut), acquireTimeout); }),
      ]);
      clearTimeout(timer);
      // Bail without running fn. Releasing our gate in the `finally` is safe:
      // the next caller awaits `prev` BEFORE it, so whoever actually holds the
      // lock keeps its exclusivity.
      if (raced === timedOut) throw new LockAcquireTimeoutError(name, acquireTimeout);
    } else {
      await prev.catch(() => {});
    }
    // Held from here on, so the ceiling is armed only for the critical section.
    ceiling = setTimeout(() => { try { release(); } catch { /* already released */ } }, LOCK_HOLD_CEILING_MS);
    return await fn();
  } finally {
    if (ceiling) clearTimeout(ceiling);
    st.queued -= 1;
    release();           // hand off to the next waiter
  }
}

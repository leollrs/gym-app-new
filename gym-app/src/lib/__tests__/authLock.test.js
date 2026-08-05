import { describe, it, expect } from 'vitest';
import inMemoryLock from '../authLock';

// Unique names per test: the lock map is module-level, so sharing a name would
// leak queue state between cases.
let n = 0;
const nextName = () => `lock-${++n}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('inMemoryLock', () => {
  it('serializes callers on the same name', async () => {
    const name = nextName();
    const order = [];
    const run = (id, ms) => inMemoryLock(name, -1, async () => {
      order.push(`start-${id}`);
      await sleep(ms);
      order.push(`end-${id}`);
    });
    await Promise.all([run('a', 30), run('b', 5), run('c', 5)]);
    // No interleaving: every start is immediately followed by its own end.
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
  });

  it('does not serialize different names', async () => {
    const [a, b] = [nextName(), nextName()];
    const order = [];
    await Promise.all([
      inMemoryLock(a, -1, async () => { order.push('a-in'); await sleep(20); order.push('a-out'); }),
      inMemoryLock(b, -1, async () => { order.push('b-in'); await sleep(1); order.push('b-out'); }),
    ]);
    expect(order).toEqual(['a-in', 'b-in', 'b-out', 'a-out']);
  });

  // THE CONTRACT. auth-js's _autoRefreshTokenTick passes 0 and catches
  // `isAcquireTimeout` to skip the tick. Ignoring the 0 made the tick QUEUE
  // instead of skip.
  it('acquireTimeout 0 throws immediately when the lock is busy', async () => {
    const name = nextName();
    let released;
    const holder = inMemoryLock(name, -1, () => new Promise(r => { released = r; }));
    await sleep(1);

    const started = Date.now();
    await expect(inMemoryLock(name, 0, async () => 'ran')).rejects.toMatchObject({ isAcquireTimeout: true });
    expect(Date.now() - started).toBeLessThan(30);   // immediate, not queued

    released();
    await holder;
  });

  it('acquireTimeout 0 succeeds when the lock is free', async () => {
    await expect(inMemoryLock(nextName(), 0, async () => 'ran')).resolves.toBe('ran');
  });

  // The whole point: every public auth call passes lockAcquireTimeout (default
  // 5000). Waiting forever is what turned one hung holder into a dead app.
  it('a positive acquireTimeout gives up instead of waiting forever', async () => {
    const name = nextName();
    let released;
    const holder = inMemoryLock(name, -1, () => new Promise(r => { released = r; }));
    await sleep(1);

    let ran = false;
    await expect(
      inMemoryLock(name, 40, async () => { ran = true; })
    ).rejects.toMatchObject({ isAcquireTimeout: true });
    expect(ran).toBe(false);   // fn must NOT run after a failed acquire

    released();
    await holder;
  });

  // A timed-out waiter releases its own gate on the way out. That must not let
  // the next caller in while the real holder is still inside.
  it('a timed-out waiter does not break exclusivity for the next caller', async () => {
    const name = nextName();
    const order = [];
    let released;
    const holder = inMemoryLock(name, -1, async () => {
      order.push('holder-in');
      await new Promise(r => { released = r; });
      order.push('holder-out');
    });
    await sleep(1);

    const bailed = inMemoryLock(name, 20, async () => { order.push('bailer-ran'); }).catch(() => {});
    const after = inMemoryLock(name, -1, async () => { order.push('after-in'); });

    await bailed;
    await sleep(20);
    expect(order).toEqual(['holder-in']);   // `after` still waiting on the holder

    released();
    await Promise.all([holder, after]);
    expect(order).toEqual(['holder-in', 'holder-out', 'after-in']);
  });

  // A rejecting holder used to poison the chain link, so EVERY later acquire
  // rejected for the life of the page.
  it('a throwing holder does not poison the queue', async () => {
    const name = nextName();
    await expect(inMemoryLock(name, -1, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(inMemoryLock(name, -1, async () => 'fine')).resolves.toBe('fine');
    await expect(inMemoryLock(name, 0, async () => 'still fine')).resolves.toBe('still fine');
  });

  it('releases the slot after a rejected acquire so the queue keeps draining', async () => {
    const name = nextName();
    let released;
    const holder = inMemoryLock(name, -1, () => new Promise(r => { released = r; }));
    await sleep(1);
    await expect(inMemoryLock(name, 10, async () => {})).rejects.toMatchObject({ isAcquireTimeout: true });
    released();
    await holder;
    // queued is back to 0, so the fail-fast probe sees a free lock again.
    await expect(inMemoryLock(name, 0, async () => 'free')).resolves.toBe('free');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Pretend we're on a phone — every function in durableStorage is a no-op on web,
// and the bug only ever existed on native.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    keys:   async () => ({ keys: [...store.keys()] }),
    get:    async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set:    async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
  },
}));

const { clearDurable, hydrateFromDurable } = await import('../durableStorage');

// Minimal localStorage for the hydrate test.
const local = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
  key: (i) => [...local.keys()][i] ?? null,
  get length() { return local.size; },
};

const seedSignedInUser = () => {
  store.clear();
  local.clear();
  store.set('offline_profile', '{"id":"member-1","full_name":"Leo"}');
  store.set('offline_gym', '{"id":"gym-1"}');
  store.set('offline_branding', '{"accent":"#D4AF37"}');
  store.set('tugympr-query-cache', '{"queries":[]}');
  store.set('gym_session_abc', '{"startedAt":"..."}');
};

describe('clearDurable', () => {
  beforeEach(seedSignedInUser);

  // THE REGRESSION. Sign-out cleared localStorage only; these Preferences rows
  // survived an app kill AND an overwrite install, and the next cold start
  // hydrated the previous member's account back onto the screen.
  it('removes every mirrored key so a cold start has nothing to hydrate', async () => {
    await clearDurable();
    expect([...store.keys()]).toEqual([]);
  });

  it('leaves untracked keys alone — sign-out is not a factory reset', async () => {
    store.set('theme', 'dark');
    store.set('i18nextLng', 'es');
    // The auth token has its own lifecycle (supabase.js writes it directly and
    // signOut removes it); this must not be the thing responsible for it.
    store.set('sb-abcdef-auth-token', '{"access_token":"..."}');
    await clearDurable();
    expect([...store.keys()].sort()).toEqual(['i18nextLng', 'sb-abcdef-auth-token', 'theme']);
  });

  it('is idempotent', async () => {
    await clearDurable();
    await expect(clearDurable()).resolves.toBeUndefined();
    expect([...store.keys()]).toEqual([]);
  });

  it('never rejects when the plugin blows up, so sign-out still completes', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    const orig = Preferences.keys;
    Preferences.keys = async () => { throw new Error('plugin unavailable'); };
    await expect(clearDurable()).resolves.toBeUndefined();
    Preferences.keys = orig;
  });
});

describe('hydrateFromDurable', () => {
  it('proves the resurrection path: what clearDurable leaves behind comes back', async () => {
    seedSignedInUser();
    await clearDurable();
    await hydrateFromDurable();
    // Nothing restored → AuthProvider finds no offline_profile to boot from.
    expect(local.get('offline_profile')).toBeUndefined();
  });
});

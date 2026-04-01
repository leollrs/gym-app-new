const CACHE_PREFIX = 'offline_data_';

export async function fetchWithOfflineFallback(key, fetchFn, ttlMs = 24 * 60 * 60 * 1000) {
  try {
    const result = await fetchFn();
    // Cache successful result
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
        data: result,
        cachedAt: Date.now(),
      }));
    } catch {}
    return result;
  } catch (err) {
    // Network failed — try cache
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + key));
      if (cached && (Date.now() - cached.cachedAt) < ttlMs) {
        return cached.data;
      }
    } catch {}
    throw err; // No cache available
  }
}

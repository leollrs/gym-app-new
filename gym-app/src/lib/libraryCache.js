// Egress-saving cache layer for the bulk content libraries (exercises, meals).
//
// These libraries are hundreds–~1000 rows carrying big text arrays (steps,
// ingredients, instructions). Re-pulling the WHOLE library from Supabase on every
// cold start is ~1 MB of egress per app open — brutal at member scale. This caches
// the mapped list in localStorage and only does the full pull when a CHEAP row-count
// probe shows the library actually changed (add/remove), or a weekly TTL / version
// bump forces it. Steady-state cost per boot: one HEAD count request (no body).
//
// Layered on top of the static seed each store already ships: cache miss + network
// failure both fall back to the bundled floor, so content is never empty.

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // weekly backstop — catches edits that don't change the row count

/**
 * @param supabase      the supabase client
 * @param cacheKey      localStorage key (unique per library)
 * @param version       bump to invalidate all caches after a shape/mapping change
 * @param table         DB table name
 * @param columns       select() column list for the full pull
 * @param applyFilter   (query) => query — adds the same .eq/.is filters to count + rows
 * @param map           (rows) => in-app shaped list
 * @param commit        (list) => boolean — the store setter (returns whether accepted)
 * @returns Promise<boolean> — whether the store now holds DB data (cache or fresh)
 */
export async function cachedHydrate({ supabase, cacheKey, version, table, columns, applyFilter, map, commit }) {
  // 1) Seed instantly from the localStorage cache — 0 egress, offline-friendly.
  let cached = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.v === version && Array.isArray(c.list) && c.list.length >= 50) {
        cached = c;
        commit(c.list);
      }
    }
  } catch { /* corrupt/oversized cache — ignore, fall through to fetch */ }

  try {
    // 2) Cheap freshness probe — exact count, HEAD only (count in a header, no rows).
    const { count, error: cErr } = await applyFilter(
      supabase.from(table).select('id', { count: 'exact', head: true })
    );
    const fresh = cached && !cErr && typeof count === 'number'
      && count === cached.count
      && (Date.now() - (cached.t || 0)) < TTL_MS;
    if (fresh) return true; // cache is current → skip the full pull entirely

    // 3) Full paginated pull. PostgREST caps each response at ~1000 rows regardless
    //    of .range(), so page until a short page signals the end.
    const PAGE = 1000;
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await applyFilter(
        supabase.from(table).select(columns)
      ).order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error || !Array.isArray(data)) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    if (all.length === 0) return !!cached; // pull failed → keep whatever we seeded

    const list = map(all);
    const ok = commit(list);
    if (ok) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          v: version,
          count: typeof count === 'number' ? count : all.length,
          t: Date.now(),
          list,
        }));
      } catch { /* quota (esp. constrained WebViews) — skip caching; in-memory store is still updated */ }
    }
    return ok;
  } catch {
    return !!cached; // network failure → keep the cache/seed we already committed
  }
}

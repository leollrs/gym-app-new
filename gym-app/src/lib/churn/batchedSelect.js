/**
 * selectInBatches — run a PostgREST `.in(col, ids)` style query in chunks.
 *
 * Why this exists: supabase-js turns `.in('profile_id', ids)` into a GET
 * querystring `profile_id=in.(uuid,uuid,...)`. Each UUID is ~39 bytes, and the
 * proxy in front of Postgres rejects URLs past ~15 KB (HTTP 414 / connection
 * reset). Measured break point: ~390 ids. So any gym past ~375 members broke
 * the churn pipeline on every load. Chunking keeps each request well under the
 * limit while returning the exact same row set as one big query.
 *
 * `makeQuery(idsChunk)` must return a FRESH Supabase query (thenable) for one
 * chunk — don't reuse a builder across chunks. Returns `{ data, error }` with
 * all chunk rows concatenated, so call sites can keep doing `res.data || []`.
 *
 * `dedupeKey(row)` removes rows that can legitimately match more than one chunk
 * (e.g. a friendship whose two members fall in different chunks).
 */

/**
 * True when a PostgREST error is "this column doesn't exist" — i.e. the DB is
 * behind the frontend (a migration that adds a column hasn't been applied yet).
 * Lets read paths retry with a reduced column set instead of hard-failing the
 * whole query (which would otherwise drop the page to a legacy fallback).
 */
export function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '').toLowerCase();
  const msg = String(error.message || '').toLowerCase();
  return code === '42703' || code === 'pgrst204'
    || msg.includes('does not exist')
    || msg.includes('schema cache')
    || msg.includes('could not find');
}

// 200 uuids * ~39 bytes ≈ 7.8 KB of querystring — ~2x margin under the limit.
const DEFAULT_CHUNK_SIZE = 200;

export async function selectInBatches(makeQuery, ids, { chunkSize = DEFAULT_CHUNK_SIZE, dedupeKey } = {}) {
  if (!ids || ids.length === 0) return { data: [], error: null };

  // Small lists: skip the machinery, one request.
  if (ids.length <= chunkSize) {
    const res = await makeQuery(ids);
    return { data: res.data || [], error: res.error || null };
  }

  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

  const results = await Promise.all(chunks.map((c) => makeQuery(c)));

  const firstErr = results.find((r) => r.error)?.error || null;
  if (firstErr) return { data: null, error: firstErr };

  let data = results.flatMap((r) => r.data || []);

  if (dedupeKey) {
    const seen = new Set();
    data = data.filter((row) => {
      const k = dedupeKey(row);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return { data, error: null };
}

/**
 * selectAllRows — page through a result set with `.range()` so we get ALL
 * rows, not just PostgREST's default response cap (~1000 on Supabase). Use
 * this for "I need every member" reads; a missing page silently shows churn
 * for only the first 1000 members otherwise.
 *
 * `makeQuery(from, to)` must return a Supabase query with `.range(from, to)`.
 */
export async function selectAllRows(makeQuery, { pageSize = 1000, maxRows = 100000 } = {}) {
  let from = 0;
  let all = [];
  for (;;) {
    const res = await makeQuery(from, from + pageSize - 1);
    if (res.error) return { data: all.length ? all : null, error: res.error };
    const rows = res.data || [];
    all = all.concat(rows);
    if (rows.length < pageSize || all.length >= maxRows) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

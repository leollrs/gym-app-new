#!/usr/bin/env node
/**
 * restamp-storage-cache.mjs
 *
 * Re-stamps existing Supabase Storage objects with a long `cache-control`.
 *
 * WHY: objects already in the bucket were uploaded with `cache-control: no-cache`
 * (verified live). They DO carry an ETag, so a repeat view returns 304 with zero
 * bytes — egress is fine. What it costs is a REVALIDATION ROUND TRIP per asset
 * per view. An exercise list showing 40 thumbnails pays 40 of them, every time.
 * On native, `<video>` loads through AVFoundation rather than the WebView URL
 * cache, so those may re-download outright.
 *
 * Supabase Storage has no metadata-only update, so changing cache-control means
 * re-uploading the bytes. This downloads each object and re-uploads it in place
 * with `upsert: true`.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * Only ever run this against buckets whose paths are IMMUTABLE — a new file
 * always gets a new name. `exercise-videos` (global/<ts>_<rand>.mp4) and
 * `food-images` qualify. Do NOT run it on `gym-logos` or `splash-*`: those are
 * overwritten in place at a fixed path, so a long TTL would freeze a changed
 * logo on every member's device. The app now stamps those with 60s on upload.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 * Needs a key with Storage write access. Export it yourself — this script reads
 * it from the environment and never logs it:
 *
 *   export SUPABASE_URL="https://<project>.supabase.co"
 *   export SUPABASE_SERVICE_KEY="<your service role key>"
 *   node scripts/restamp-storage-cache.mjs exercise-videos --dry-run
 *   node scripts/restamp-storage-cache.mjs exercise-videos
 *
 * Start with --dry-run. It is idempotent: re-running is harmless.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.argv[2];
const DRY = process.argv.includes('--dry-run');
const CACHE = '31536000';          // 1 year
// `--limit N` — restamp only the first N objects. Use it to prove the header
// actually changes on ONE file before spending a full bucket's bandwidth.
const limArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limArg ? Number(limArg.split('=')[1] ?? process.argv[process.argv.indexOf(limArg) + 1]) : null;

const IMMUTABLE_OK = new Set(['exercise-videos', 'food-images']);

if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first (see header).');
  process.exit(1);
}
if (!BUCKET) {
  console.error('Usage: node scripts/restamp-storage-cache.mjs <bucket> [--dry-run]');
  process.exit(1);
}
if (!IMMUTABLE_OK.has(BUCKET)) {
  console.error(
    `Refusing to touch "${BUCKET}".\n` +
    `Only immutable-path buckets are safe: ${[...IMMUTABLE_OK].join(', ')}.\n` +
    `Buckets written in place (gym-logos, splash-videos, splash-logos) must keep a\n` +
    `short TTL or a changed logo will stay stale on members' devices.`);
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

/** Recursively walk a bucket; Storage list() is per-prefix and paginated. */
async function walk(prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from(BUCKET)
      .list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      // A folder entry has no id/metadata; recurse into it.
      if (e.id === null || e.metadata === null) out.push(...await walk(path));
      else out.push({ path, size: e.metadata?.size ?? 0, type: e.metadata?.mimetype });
    }
    if (data.length < 100) break;
  }
  return out;
}

const files = await walk();
const totalMB = (files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1);
console.log(`${BUCKET}: ${files.length} objects, ${totalMB} MB`);
if (DRY) {
  files.slice(0, 10).forEach(f => console.log(`  would restamp  ${f.path}`));
  if (files.length > 10) console.log(`  … and ${files.length - 10} more`);
  console.log('\nDry run — nothing changed. Drop --dry-run to apply.');
  process.exit(0);
}

// `update()` (HTTP PUT), NOT `upload({upsert:true})` (HTTP POST + x-upsert).
//
// The first attempt used upload+upsert. It genuinely replaced the bytes — the
// object's last-modified moved to the run time — but every URL still served
// `cache-control: no-cache`, verified against the origin with a cache-buster so
// it was not the CDN. The overwrite path preserves the existing object row's
// cache-control instead of taking the new one. PUT replaces the record.
//
// If a run still leaves `no-cache` on the verification below, stop: Storage is
// not honouring the field on this project and re-running will not help.
const target = files.slice(0, LIMIT ?? files.length);
if (LIMIT) console.log(`--limit ${LIMIT}: touching only the first ${target.length}\n`);

let done = 0, failed = 0;
for (const f of target) {
  try {
    const { data: blob, error: dErr } = await sb.storage.from(BUCKET).download(f.path);
    if (dErr) throw dErr;
    const { error: uErr } = await sb.storage.from(BUCKET).update(
      f.path, blob, { cacheControl: CACHE, contentType: f.type || undefined });
    if (uErr) throw uErr;
    done++;
    if (LIMIT || done % 20 === 0) console.log(`  ${done}/${target.length}  ${LIMIT ? f.path : ''}`);
  } catch (e) {
    failed++;
    console.warn(`  FAILED ${f.path}: ${e.message || JSON.stringify(e)}`);
  }
}
console.log(`\ndone: ${done} restamped, ${failed} failed`);

// Verify automatically — the whole point is the header, not the upload.
if (done) {
  const probe = target[0].path;
  const url = `${URL}/storage/v1/object/public/${BUCKET}/${probe}?cb=${Date.now()}`;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const cc = r.headers.get('cache-control');
    console.log(`\nverify ${probe}\n  cache-control: ${cc}`);
    console.log(cc && cc.includes('max-age=' + CACHE)
      ? '  ✅ applied — safe to run the full bucket'
      : '  ❌ NOT applied — do not run the rest; Storage is ignoring cacheControl here');
  } catch (e) { console.warn('  verify failed:', e.message); }
}

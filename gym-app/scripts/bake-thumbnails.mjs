#!/usr/bin/env node
/**
 * bake-thumbnails.mjs — stop renting Supabase Image Transformations.
 *
 * WHY THIS EXISTS
 * Supabase's render endpoint (`getPublicUrl(path, { transform })`) is billed as
 * "Storage Image Transformations", and the quota counts UNIQUE ORIGIN IMAGES
 * per billing cycle, not requests. Pro includes 100. `food-images/ingredients/`
 * alone holds 117 objects (migration 0634) and `categories/` ~10, and every one
 * of them is asked for at 144px by imageUrl.js — so the project sits at ~126/100
 * every single month, permanently over, with no new members required.
 *
 * The images are STATIC. Paying a monthly per-image fee to re-derive the same
 * thumbnail from the same never-changing source is renting something you can own.
 * This bakes each thumbnail ONCE into the bucket at `<prefix>thumb/<file>`, and
 * imageUrl.js then serves it as a plain object — no render endpoint, no quota.
 *
 * Why not just serve the originals? Measured on this bucket:
 *   chicken_breast.jpg  165 KB      broccoli.jpg  228 KB
 * …each rendered into a 44 px box. One scroll of the ingredient list would pull
 * ~25 MB down a phone connection. Cheaper for the bill, worse for the member.
 *
 * USAGE
 *   SUPABASE_SERVICE_KEY=<service_role key> \
 *     node scripts/bake-thumbnails.mjs food-images ingredients/ categories/
 *
 *   Add --dry-run to list what it WOULD do and touch nothing.
 *   Add --width=NNN to override the 144 px default.
 *
 * The service key is read from the environment and never written anywhere.
 * Run it from a shell where you have exported it yourself.
 *
 * SAFE TO RE-RUN. It skips any thumbnail that already exists, so an interrupted
 * run just continues. It only ever WRITES to `<prefix>thumb/` — it never
 * modifies or deletes an original.
 *
 * Resizing uses macOS `sips` (built in, no npm dependency for a one-off job).
 * `-Z` caps the LONGEST side and preserves aspect ratio, which is what the
 * transform this replaces was doing (`resize: 'contain'`).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUPABASE_URL = 'https://erdhnixjnjullhjzmvpm.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const widthArg = argv.find((a) => a.startsWith('--width='));
const WIDTH = widthArg ? parseInt(widthArg.split('=')[1], 10) : 144;
const QUALITY = 70;                       // matches the transform being retired
const positional = argv.filter((a) => !a.startsWith('--'));
const BUCKET = positional[0];
const PREFIXES = positional.slice(1);

if (!BUCKET || PREFIXES.length === 0) {
  console.error('usage: SUPABASE_SERVICE_KEY=… node scripts/bake-thumbnails.mjs <bucket> <prefix/> [prefix/ …] [--dry-run] [--width=144]');
  process.exit(1);
}
if (!KEY) {
  console.error('SUPABASE_SERVICE_KEY is not set. Export it in your shell first — this script never stores it.');
  process.exit(1);
}

const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** Every object directly under `prefix`, paging until the bucket is exhausted. */
async function listPrefix(prefix) {
  const out = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${prefix} → ${res.status} ${await res.text()}`);
    const page = await res.json();
    if (!page.length) break;
    // Folders come back with a null id; `thumb/` is our own output.
    out.push(...page.filter((o) => o.id && /\.(jpe?g|png|webp)$/i.test(o.name)));
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * A HEAD on the public object URL — deliberately not `/object/info/public/`,
 * which is a newer endpoint and is not guaranteed on every Storage version. A
 * plain HEAD on the object route is the one thing that has always worked, and a
 * wrong answer here only costs a re-bake (the upload is x-upsert), never data.
 */
async function exists(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`, { method: 'HEAD' });
  return res.ok;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'bake-'));
  let baked = 0, skipped = 0, failed = 0, bytesBefore = 0, bytesAfter = 0;

  try {
    for (const prefix of PREFIXES) {
      const objects = await listPrefix(prefix);
      console.log(`\n${prefix} — ${objects.length} source image(s)`);

      for (const obj of objects) {
        const srcPath = `${prefix}${obj.name}`;
        // Always .jpg out: sips writes JPEG and the app's paths are .jpg.
        const outName = obj.name.replace(/\.(jpe?g|png|webp)$/i, '.jpg');
        const dstPath = `${prefix}thumb/${outName}`;

        if (await exists(dstPath)) { skipped += 1; continue; }
        if (dryRun) { console.log(`  would bake  ${srcPath} → ${dstPath}`); baked += 1; continue; }

        try {
          // Download the ORIGINAL. A plain object read — it does not touch the
          // render endpoint, so listing/baking costs nothing against the quota.
          const dl = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${srcPath}`);
          if (!dl.ok) throw new Error(`download ${dl.status}`);
          const original = Buffer.from(await dl.arrayBuffer());
          bytesBefore += original.length;

          const inFile = join(tmp, `in-${outName}`);
          const outFile = join(tmp, `out-${outName}`);
          writeFileSync(inFile, original);
          execFileSync('sips', [
            '-s', 'format', 'jpeg',
            '-s', 'formatOptions', String(QUALITY),
            '-Z', String(WIDTH),
            inFile, '--out', outFile,
          ], { stdio: 'ignore' });
          const thumb = readFileSync(outFile);
          bytesAfter += thumb.length;

          const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${dstPath}`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': '31536000' },
            body: thumb,
          });
          if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);

          baked += 1;
          const pct = Math.round((1 - thumb.length / original.length) * 100);
          console.log(`  ✓ ${outName}  ${(original.length / 1024).toFixed(0)}KB → ${(thumb.length / 1024).toFixed(0)}KB  (-${pct}%)`);
        } catch (err) {
          failed += 1;
          console.error(`  ✗ ${srcPath}: ${err.message}`);
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${dryRun ? 'DRY RUN — ' : ''}baked ${baked}, already present ${skipped}, failed ${failed}`);
  if (bytesBefore) {
    console.log(`payload ${(bytesBefore / 1024 / 1024).toFixed(1)} MB → ${(bytesAfter / 1024 / 1024).toFixed(1)} MB`);
  }
  if (failed) {
    console.error('\nSome images did not bake. imageUrl.js falls back to the placeholder for a missing');
    console.error('thumb, so nothing breaks — but re-run to finish before you consider this done.');
    process.exit(1);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });

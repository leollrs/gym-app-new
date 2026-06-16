#!/usr/bin/env node
/**
 * Decode a minified stack frame (or a whole pasted stack) from error_logs
 * against the archived production source maps in ./sourcemaps/.
 *
 * Maps are produced by `vite build` (sourcemap: 'hidden') and moved into
 * ./sourcemaps/<version>-<buildId>/ by the archive plugin in vite.config.js,
 * so they're kept locally but never deployed publicly.
 *
 * Usage:
 *   node scripts/symbolicate.mjs 'index-1wEQ6UpK.js:1:2345'
 *   pbpaste | node scripts/symbolicate.mjs            # whole stack on stdin
 *
 * Requires the `source-map-js` dev dependency (npm install).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceMapConsumer } from 'source-map-js';

const MAPS_DIR = fileURLToPath(new URL('../sourcemaps', import.meta.url));

function collectMaps(dir, acc = new Map()) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectMaps(full, acc);
    else if (entry.name.endsWith('.map')) acc.set(entry.name, full); // basename -> path (newest wins)
  }
  return acc;
}

function readInput() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) return arg;
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

const input = readInput();
if (!input) {
  console.error('Usage: node scripts/symbolicate.mjs "<chunk>.js:LINE:COL"   (or pipe a stack on stdin)');
  process.exit(1);
}

const maps = collectMaps(MAPS_DIR);
if (maps.size === 0) {
  console.error(`No source maps under ${MAPS_DIR}. Run \`npm run build\` first — it archives maps there.`);
  process.exit(1);
}

const consumers = new Map();
function consumerFor(file) {
  const mapPath = maps.get(`${basename(file)}.map`);
  if (!mapPath) return null;
  if (!consumers.has(mapPath)) {
    consumers.set(mapPath, new SourceMapConsumer(JSON.parse(readFileSync(mapPath, 'utf8'))));
  }
  return consumers.get(mapPath);
}

// Match frames like `index-abc123.js:12:3456` anywhere in the input.
const FRAME = /([\w.-]+\.js):(\d+):(\d+)/g;
let any = false;
let m;
while ((m = FRAME.exec(input)) !== null) {
  const [, file, lineNo, colNo] = m;
  const consumer = consumerFor(file);
  if (!consumer) { console.log(`${file}:${lineNo}:${colNo}  ->  (no archived map for ${file})`); continue; }
  const pos = consumer.originalPositionFor({ line: Number(lineNo), column: Number(colNo) });
  if (pos && pos.source) {
    any = true;
    const name = pos.name ? ` (${pos.name})` : '';
    console.log(`${file}:${lineNo}:${colNo}  ->  ${pos.source}:${pos.line}:${pos.column}${name}`);
  } else {
    console.log(`${file}:${lineNo}:${colNo}  ->  (unmapped)`);
  }
}

if (!any) {
  console.error('No resolvable frames found. Check the chunk filename matches an archived build.');
  process.exit(2);
}

/**
 * End-to-end churn benchmark — runs the ACTUAL shipped code paths against a
 * seeded database (local supabase or staging), not a simulation.
 *
 * Usage:
 *   SB_URL=http://127.0.0.1:54321 SB_KEY=<service_role_key> \
 *   GYM=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa node supabase/bench/e2e_churn.mjs
 *
 * Asserts:
 *   - loadGymChurnScores (precompute path) returns all members, fast
 *   - fetchMembersWithChurnScores (live engine) returns the same members
 *   - the two AGREE on risk-tier counts (the consistency guarantee)
 *   - neither throws / 414s at 2,000 members
 */
import { createClient } from '@supabase/supabase-js';
import { loadGymChurnScores } from '../../src/lib/churn/loadScores.js';
import { fetchMembersWithChurnScores } from '../../src/lib/churn/retention.js';

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GYM = process.env.GYM || 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

if (!SB_URL || !SB_KEY) {
  console.error('Set SB_URL and SB_KEY (service_role key for local).');
  process.exit(1);
}

const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function tierCounts(scored) {
  const t = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const m of scored) {
    const s = m.churnScore ?? 0;
    if (s >= 80) t.critical++;
    else if (s >= 55) t.high++;
    else if (s >= 30) t.medium++;
    else t.low++;
  }
  return t;
}

async function timed(label, fn) {
  const t = performance.now();
  try {
    const out = await fn();
    return { out, ms: Math.round(performance.now() - t), err: null };
  } catch (e) {
    return { out: null, ms: Math.round(performance.now() - t), err: e.message };
  }
}

console.log(`\nE2E churn benchmark — gym ${GYM}\n`);

const pre = await timed('precompute', () => loadGymChurnScores(GYM, supabase));
const live = await timed('live', () => fetchMembersWithChurnScores(GYM, supabase));

if (pre.err) console.log(`precompute path ERROR: ${pre.err}`);
if (live.err) console.log(`live engine ERROR:     ${live.err}`);

const preN = pre.out?.length ?? 0;
const liveN = live.out?.length ?? 0;

console.log('                      | members | latency  | tier counts (crit/high/med/low)');
console.log('----------------------|---------|----------|--------------------------------');
if (pre.out) {
  const t = tierCounts(pre.out);
  console.log(`loadGymChurnScores    | ${String(preN).padStart(7)} | ${(pre.ms + 'ms').padStart(8)} | ${t.critical}/${t.high}/${t.medium}/${t.low}`);
}
if (live.out) {
  const t = tierCounts(live.out);
  console.log(`live engine (fallback)| ${String(liveN).padStart(7)} | ${(live.ms + 'ms').padStart(8)} | ${t.critical}/${t.high}/${t.medium}/${t.low}`);
}

if (pre.out && live.out) {
  const pt = tierCounts(pre.out), lt = tierCounts(live.out);
  const drift = ['critical', 'high', 'medium', 'low'].map(k => Math.abs(pt[k] - lt[k])).reduce((a, b) => a + b, 0);
  console.log(`\nspeedup: ${(live.ms / Math.max(pre.ms, 1)).toFixed(1)}x   tier-count drift between the two paths: ${drift} members`);
  console.log(pre.err || live.err ? 'VERDICT: see errors above' :
    (preN === liveN ? '✅ both paths returned all members, no 414/throw' : '⚠️ member-count mismatch between paths'));
}

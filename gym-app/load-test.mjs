/**
 * Load Test for Gym App
 * ---------------------
 * Simulates concurrent users hitting Supabase endpoints
 * (the same queries your React app makes from the browser).
 *
 * Usage:
 *   node load-test.mjs                    # default: 10 users, 30s ramp
 *   node load-test.mjs --users 50         # 50 concurrent users
 *   node load-test.mjs --users 100 --duration 60
 *   node load-test.mjs --stress           # stress test: ramp to 200 users
 *
 * Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load env ──────────────────────────────────────────────
function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, '.env.local'), 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const [key, ...vals] = line.split('=');
      if (key && vals.length) env[key.trim()] = vals.join('=').trim();
    }
    return env;
  } catch {
    console.error('❌ Cannot read .env.local — make sure it exists');
    process.exit(1);
  }
}

const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── Parse CLI args ────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? Number(args[idx + 1]) : defaultVal;
}
const isStress = args.includes('--stress');
const MAX_USERS = isStress ? 200 : getArg('users', 10);
const DURATION_SEC = getArg('duration', 30);
const RAMP_SEC = Math.min(10, DURATION_SEC / 2);

// ── Stats tracking ────────────────────────────────────────
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  errors: {},          // error message → count
  latencies: [],       // ms values
  byEndpoint: {},      // endpoint → { count, success, failed, latencies }
  statusCodes: {},     // HTTP status → count
  startTime: null,
  activeUsers: 0,
  peakUsers: 0,
  firstErrorAt: null,
};

function recordResult(endpoint, latencyMs, ok, status, errorMsg) {
  stats.total++;
  stats.latencies.push(latencyMs);
  stats.statusCodes[status] = (stats.statusCodes[status] || 0) + 1;

  if (!stats.byEndpoint[endpoint]) {
    stats.byEndpoint[endpoint] = { count: 0, success: 0, failed: 0, latencies: [] };
  }
  const ep = stats.byEndpoint[endpoint];
  ep.count++;
  ep.latencies.push(latencyMs);

  if (ok) {
    stats.success++;
    ep.success++;
  } else {
    stats.failed++;
    ep.failed++;
    if (errorMsg) {
      stats.errors[errorMsg] = (stats.errors[errorMsg] || 0) + 1;
    }
    if (!stats.firstErrorAt) {
      stats.firstErrorAt = { users: stats.activeUsers, time: Date.now() - stats.startTime };
    }
  }
}

// ── Supabase REST helpers ─────────────────────────────────
const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

async function supabaseQuery(endpoint, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}${query ? '?' + query : ''}`;
  const start = performance.now();
  let status = 0;
  let ok = false;
  let errorMsg = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    status = res.status;
    ok = res.ok;

    if (!ok) {
      const body = await res.text().catch(() => '');
      errorMsg = `HTTP ${status}: ${body.slice(0, 100)}`;
    }
  } catch (err) {
    errorMsg = err.name === 'AbortError' ? 'TIMEOUT (15s)' : err.message;
    status = 0;
  }

  const latency = performance.now() - start;
  recordResult(endpoint, latency, ok, status, errorMsg);
  return { ok, status, latency };
}

// ── Simulated user journey ────────────────────────────────
// Each "user" does what a real member does when opening the app:
async function simulateUser(userId) {
  stats.activeUsers++;
  if (stats.activeUsers > stats.peakUsers) stats.peakUsers = stats.activeUsers;

  try {
    // 1. Load profile
    await supabaseQuery('profiles', 'select=*&limit=1');

    // 2. Load dashboard data (parallel, like the real app)
    await Promise.all([
      supabaseQuery('workout_sessions', 'select=*&order=started_at.desc&limit=5'),
      supabaseQuery('exercises', 'select=id,name,muscle_group&limit=50'),
      supabaseQuery('body_weight_logs', 'select=*&order=logged_at.desc&limit=30'),
      supabaseQuery('challenges', 'select=*&limit=10'),
    ]);

    // Small random delay to simulate reading the dashboard
    await sleep(randomBetween(200, 800));

    // 3. Check leaderboard
    await supabaseQuery('leaderboard_snapshots', 'select=*&limit=20');

    // 4. Load notifications
    await supabaseQuery('notifications', 'select=*&order=created_at.desc&limit=20');

    // 5. View workout log
    await supabaseQuery('workout_sessions', 'select=*,session_exercises(*)&order=started_at.desc&limit=10');

    // 6. Check personal records
    await supabaseQuery('personal_records', 'select=*&limit=20');

  } catch (err) {
    // Individual user errors are already tracked
  } finally {
    stats.activeUsers--;
  }
}

// ── Helpers ───────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Main test runner ──────────────────────────────────────
async function runLoadTest() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║          GYM APP LOAD TEST                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Target:     ${SUPABASE_URL}`);
  console.log(`  Mode:       ${isStress ? 'STRESS TEST (ramp to 200)' : `${MAX_USERS} concurrent users`}`);
  console.log(`  Duration:   ${DURATION_SEC}s`);
  console.log(`  Ramp-up:    ${RAMP_SEC}s\n`);

  stats.startTime = Date.now();
  const endTime = stats.startTime + DURATION_SEC * 1000;
  const userPromises = [];
  let userCounter = 0;

  // Progress reporting
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
    const rps = (stats.total / (elapsed || 1)).toFixed(1);
    const failRate = stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(1) : '0';
    const avgLatency = stats.latencies.length > 0
      ? (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(0)
      : 0;
    process.stdout.write(
      `\r  ⏱ ${elapsed}s | 👥 Active: ${stats.activeUsers} | 📊 Reqs: ${stats.total} (${rps}/s) | ❌ Fail: ${failRate}% | ⚡ Avg: ${avgLatency}ms`
    );
  }, 1000);

  // Spawn users over time
  while (Date.now() < endTime) {
    const elapsed = (Date.now() - stats.startTime) / 1000;

    // Calculate target users at this point in time
    let targetUsers;
    if (isStress) {
      // Stress: linear ramp from 1 to 200
      targetUsers = Math.min(200, Math.ceil((elapsed / DURATION_SEC) * 200));
    } else {
      // Normal: ramp up over RAMP_SEC, then hold
      targetUsers = elapsed < RAMP_SEC
        ? Math.ceil((elapsed / RAMP_SEC) * MAX_USERS)
        : MAX_USERS;
    }

    // Spawn new users to reach target
    while (stats.activeUsers < targetUsers && Date.now() < endTime) {
      userCounter++;
      const p = simulateUser(userCounter);
      userPromises.push(p);

      // When a user finishes, spawn a new one (to maintain concurrency)
      p.then(() => {
        if (Date.now() < endTime && stats.activeUsers < targetUsers) {
          userCounter++;
          const next = simulateUser(userCounter);
          userPromises.push(next);
        }
      });

      // Stagger spawning slightly
      await sleep(10);
    }

    await sleep(500);
  }

  // Wait for all active users to finish
  await Promise.allSettled(userPromises);
  clearInterval(progressInterval);

  // ── Report ──────────────────────────────────────────────
  const totalTime = (Date.now() - stats.startTime) / 1000;
  const avgLatency = stats.latencies.length > 0
    ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
    : 0;

  console.log('\n\n');
  console.log('┌──────────────────────────────────────────────────┐');
  console.log('│                 RESULTS SUMMARY                  │');
  console.log('├──────────────────────────────────────────────────┤');
  console.log(`│  Duration:         ${totalTime.toFixed(1)}s`);
  console.log(`│  Total requests:   ${stats.total}`);
  console.log(`│  Peak concurrent:  ${stats.peakUsers} users`);
  console.log(`│  Requests/sec:     ${(stats.total / totalTime).toFixed(1)}`);
  console.log(`│  Success:          ${stats.success} (${((stats.success/stats.total)*100).toFixed(1)}%)`);
  console.log(`│  Failed:           ${stats.failed} (${((stats.failed/stats.total)*100).toFixed(1)}%)`);
  console.log('├──────────────────────────────────────────────────┤');
  console.log('│  LATENCY                                        │');
  console.log(`│  Average:          ${avgLatency.toFixed(0)}ms`);
  console.log(`│  P50 (median):     ${percentile(stats.latencies, 50).toFixed(0)}ms`);
  console.log(`│  P90:              ${percentile(stats.latencies, 90).toFixed(0)}ms`);
  console.log(`│  P95:              ${percentile(stats.latencies, 95).toFixed(0)}ms`);
  console.log(`│  P99:              ${percentile(stats.latencies, 99).toFixed(0)}ms`);
  console.log(`│  Max:              ${Math.max(...stats.latencies).toFixed(0)}ms`);
  console.log('└──────────────────────────────────────────────────┘');

  // Per-endpoint breakdown
  console.log('\n📊 Per-Endpoint Breakdown:');
  console.log('─'.repeat(80));
  console.log(`${'Endpoint'.padEnd(30)} ${'Reqs'.padStart(6)} ${'OK'.padStart(6)} ${'Fail'.padStart(6)} ${'Avg(ms)'.padStart(8)} ${'P95(ms)'.padStart(8)} ${'Max(ms)'.padStart(8)}`);
  console.log('─'.repeat(80));

  for (const [ep, data] of Object.entries(stats.byEndpoint).sort((a, b) => b[1].count - a[1].count)) {
    const avg = data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length;
    const p95 = percentile(data.latencies, 95);
    const max = Math.max(...data.latencies);
    console.log(
      `${ep.padEnd(30)} ${String(data.count).padStart(6)} ${String(data.success).padStart(6)} ${String(data.failed).padStart(6)} ${avg.toFixed(0).padStart(8)} ${p95.toFixed(0).padStart(8)} ${max.toFixed(0).padStart(8)}`
    );
  }

  // HTTP status codes
  console.log('\n📈 HTTP Status Codes:');
  for (const [code, count] of Object.entries(stats.statusCodes).sort()) {
    const bar = '█'.repeat(Math.min(40, Math.round((count / stats.total) * 40)));
    console.log(`  ${code === '0' ? 'TIMEOUT/ERR' : code}: ${bar} ${count}`);
  }

  // Errors
  if (Object.keys(stats.errors).length > 0) {
    console.log('\n🚨 Error Breakdown:');
    for (const [msg, count] of Object.entries(stats.errors).sort((a, b) => b[1] - a[1])) {
      console.log(`  [${count}x] ${msg}`);
    }
  }

  // First error
  if (stats.firstErrorAt) {
    console.log(`\n⚠️  First error occurred at ${(stats.firstErrorAt.time / 1000).toFixed(1)}s with ${stats.firstErrorAt.users} active users`);
  }

  // Verdict
  console.log('\n' + '═'.repeat(50));
  const failRate = stats.total > 0 ? (stats.failed / stats.total) * 100 : 0;
  if (failRate === 0) {
    console.log(`✅ PASSED — ${stats.peakUsers} concurrent users, 0% failure rate`);
  } else if (failRate < 5) {
    console.log(`⚠️  WARNING — ${failRate.toFixed(1)}% failure rate at ${stats.peakUsers} peak users`);
  } else {
    console.log(`❌ FAILED — ${failRate.toFixed(1)}% failure rate at ${stats.peakUsers} peak users`);
  }

  // Capacity estimate
  if (stats.firstErrorAt) {
    console.log(`📉 App started failing at ~${stats.firstErrorAt.users} concurrent users`);
  } else {
    console.log(`📈 App handled ${stats.peakUsers} concurrent users without errors`);
    if (!isStress) {
      console.log(`   Run with --stress to find the breaking point`);
    }
  }
  console.log('═'.repeat(50) + '\n');
}

runLoadTest().catch(console.error);

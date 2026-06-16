# Operations & Observability

How TuGymPR is monitored, and the few manual steps required after deploying the
push-alerting / uptime / source-map changes.

## What collects what (today)

| Signal | Where | Notes |
|---|---|---|
| Product analytics, `$pageview`, `$exception` | PostHog | lazy-loaded in `main.jsx` |
| Client errors (9 types) | `error_logs` table | `src/lib/errorTracker.js` — global handlers + fetch interceptor, PII-scrubbed |
| In-app crash alert | `notifications` (super admins) + bell | migration `0517` |
| **Email alert on crash / error spike** | `check-error-alerts` fn → Resend | **new** — cron every 15 min |
| **Uptime (DB-liveness probe)** | `health-check` fn (200/503) | **new** — meant for an external monitor |
| Audit trail | `audit_log` / `admin_audit_log` | admin actions |
| Moderation SLA | `check-moderation-sla` fn → Resend | migration `0348` |

The first two were already solid. The three **new** pieces close the "it's all
pull, not push" gap: errors now reach you, and downtime can page you.

---

## 1. Error / crash push alerts

`supabase/functions/check-error-alerts/` + migration `0600_error_alert_cron.sql`.

A cron hits the function every 15 minutes. It scans `error_logs` for everything
since its last run (watermarked in `ops_alert_state` so each error is counted
once) and emails when:

- **any** `react_crash` occurred, or
- `js_error + promise_rejection >= OPS_ERROR_SPIKE_THRESHOLD` (default **10**).

400s, `auth_error` (token expiry), `slow_api`, and `network_error` (offline
transitions) are shown in the email but never trigger on their own — too noisy.
Re-alerts are throttled to once per `OPS_ALERT_COOLDOWN_MIN` (default **30 min**)
so a sustained incident pings you periodically, not every 15 minutes.

**Env (set on the function):**

| Var | Required | Default |
|---|---|---|
| `RESEND_API_KEY` | yes | — (already set for `check-moderation-sla`) |
| `OPS_ALERT_RECIPIENT` | no | `support@tugympr.com` |
| `OPS_ERROR_SPIKE_THRESHOLD` | no | `10` |
| `OPS_ALERT_COOLDOWN_MIN` | no | `30` |

**Deploy:**
```bash
supabase functions deploy check-error-alerts
# point alerts at your inbox if you don't watch support@:
supabase secrets set OPS_ALERT_RECIPIENT=you@example.com
```
Then apply `0600` (schedules the cron + creates `ops_alert_state`).

**Smoke test** (forces an immediate run; needs the service-role key):
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/check-error-alerts" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq
# -> { window, total, by_type, triggered, sent, reason }
```
`reason` tells you why nothing sent (`below_threshold` / `cooldown` /
`resend_key_missing` / `ok`).

---

## 2. Uptime monitoring

`health-check` now does a real DB round-trip and returns **503** when the
database is unreachable (was always 200). Body: `{ ok, db, time }`.

> **Why not an internal cron?** A pg_cron job lives *inside* Supabase — if the
> project is down, so is the job, so it can't alert you. Uptime must be checked
> from **outside**. Hence an external monitor.

**Set up a free external monitor** (~2 min) pointing at two URLs:

1. Website — `https://tugympr.com` — expect HTTP 200.
2. Health probe — `https://<project-ref>.supabase.co/functions/v1/health-check` —
   expect HTTP 200 and body containing `"db":"up"`.

**Two ways to run the external check:**

1. **GitHub Actions monitor (in-repo, shipped)** — `.github/workflows/uptime.yml`.
   Runs on GitHub's servers (external to Vercel + Supabase), pings the site +
   health-check every ~10 min, fails the run when down. Setup in
   Repo → Settings → Secrets and variables → Actions:
   - **Variable** `HEALTHCHECK_URL` = `https://<ref>.supabase.co/functions/v1/health-check`
     (the `<ref>` is your `.env` `VITE_SUPABASE_URL`). Optional vars: `SITE_URL`
     (defaults to tugympr.com), `OPS_ALERT_RECIPIENT`.
   - Optional **Secret** `RESEND_API_KEY` for a dedicated alert email; otherwise
     GitHub emails you on the failed run.
   - ⚠️ `schedule:` runs only from the **default branch (main)** — it starts
     ticking once merged to main; use "Run workflow" to test from a branch.
     GitHub crons can also be delayed under load.

2. **UptimeRobot / healthchecks.io / Better Stack** (hosted, more reliable) —
   free tiers, sub-5-min checks, SMS, public status pages. Point two HTTP monitors
   at the site + the health-check URL (expect 200 + `"db":"up"`). healthchecks.io
   also offers a *dead-man's-switch* worth pointing the `check-error-alerts` cron
   at, so you learn if the cron itself dies.

The GitHub Action is good enough for launch; reach for a hosted monitor when you
want faster cadence or SMS. Record which you rely on here.

---

## 3. Symbolicating crash stacks

Builds now emit **hidden** source maps (`sourcemap: 'hidden'` in
`vite.config.js`). A build plugin moves the `.map` files out of `dist/` into
`sourcemaps/<version>-<buildId>/` (git-ignored) so they're kept for decoding but
never deployed (a public `.map` leaks all source).

When a `react_crash` in `error_logs` has a minified stack like
`at a (index-1wEQ6UpK.js:1:2345)`:
```bash
node scripts/symbolicate.mjs 'index-1wEQ6UpK.js:1:2345'
# or paste the whole stack:
pbpaste | node scripts/symbolicate.mjs
```
It resolves each frame to `src/...:line:col (originalName)` against the archived
maps. Maps are archived on whatever machine runs `npm run build`, so keep your
**release** build's `sourcemaps/` dir (or stash it) to decode that release's
crashes later.

> Follow-up option: have `errorTracker.js` include `__BUILD_ID__` in the crash
> metadata so a stack can be matched to its exact build's maps unambiguously.

---

## 4. Tests & CI

- **Run:** `npm run test:run` (CI) or `npm test` (watch).
- **Covers** the pure, high-blast-radius logic: `overloadEngine` (1RM math,
  deload, starting weight), `macroCalculator` (TDEE + macro invariants),
  `mealPlanner` (slotting + suggestion ranking).
- **CI:** `.github/workflows/ci.yml` runs lint (non-blocking for now) → tests →
  build on every push/PR.
- **Not yet covered:** the QR HMAC sign/verify lives server-side in the
  `sign-qr` / `verify-qr` Deno functions — a `deno test` pass is the natural
  next step (different runtime than Vitest).

---

## Deploy checklist for this change

- [ ] `supabase functions deploy check-error-alerts`
- [ ] `supabase functions deploy health-check --no-verify-jwt` (redeploy — now does a DB probe; MUST be public or external monitors get 401'd)
- [ ] Verify public: `curl -s https://erdhnixjnjullhjzmvpm.supabase.co/functions/v1/health-check` → expect `{"ok":true,"db":"up",...}` (not a 401)
- [ ] Apply migration `0600_error_alert_cron.sql`
- [ ] Confirm `RESEND_API_KEY` is set; optionally set `OPS_ALERT_RECIPIENT`
- [ ] Smoke-test `check-error-alerts` (curl above) — expect `reason: below_threshold`
- [ ] Create the external uptime monitor (website + health-check URL)
- [ ] `npm install` (pulls in `vitest` + `source-map-js`), then `npm run test:run`

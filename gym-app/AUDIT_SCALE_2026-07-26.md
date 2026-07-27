# Scalability & Cost Audit — 2026-07-26

Read-only audit. **No code was changed.** Six parallel agents over disjoint scopes
(member hot paths, nutrition/content, social/realtime, admin, trainer/platform,
cross-cutting infra), plus direct measurement against the live production API and
Storage bucket.

---

## Bottom line

Three answers to the three questions asked:

**"Will it be slow?"** — Yes, and it already is in places. Not because any single
query is slow, but because ~12 routes are permanently mounted (`App.jsx:972`
`KEEP_ALIVE_MAP`) and several of their load effects are keyed on values that change
on *every* navigation or *every* auth-token refresh. The app re-fetches itself
constantly.

**"Will it overload the servers?"** — Not the database. The estimated steady-state
is ~9M PostgREST requests/month at 1,000 DAU, which Supabase handles. The exposed
surface is **Realtime message volume**, and that depends on one unresolved question
(below).

**"Will it burn egress / CPU / storage?"** — Egress is **not** the emergency:
~$0/mo at 1,000 members, ~$37/mo at 5,000, ~$97/mo at 10,000. The real cost is
**~17.5 MB per member per session on their phone**, much of it on cellular.

**But the most serious finding is none of those. It is that several admin analytics
are showing gym owners numbers that are simply wrong, today, in production.**

---

## Evidence status — what is proven vs. what is inferred

Agents produce plausible-sounding findings. These were checked directly:

| Claim | Status | Evidence |
|---|---|---|
| PostgREST caps rows at 1000 **in production** | ✅ **PROVEN** | Live API: `content-range: 0-999/1275` |
| `food_items` already exceeds the cap | ✅ **PROVEN** | 1275 rows; **275 invisible to the app today** |
| `exercises` under the cap | ✅ Verified | 307 rows — safe, no headroom |
| `max_rows = 1000` in config | ✅ Verified | `supabase/config.toml:18` |
| `dist/sw.js` is a self-destruct stub | ✅ Verified | 608 bytes, `registration.unregister()` |
| `useFoodItems()` unbounded | ✅ Verified | `useSupabaseQuery.js:136` — no limit, no filter |
| PBKDF2 at 600,000 iterations | ✅ Verified | `messageEncryption.js:24` |
| `location.key` in load-effect deps | ✅ Verified | `Dashboard.jsx:482`, `QuickStart.jsx:309` |
| Trainer plan lists `select('*')` w/ JSONB | ✅ Verified | `TrainerPlans.jsx:2566, 2631` |
| `LazyVideoTile` calls `.play()` | ✅ Verified | `LazyVideoTile.jsx:43` |
| `AllExercisesModal` grid uncapped | ✅ Verified | `AllExercisesModal.jsx:285` — `filtered.map()` |
| Videos re-download on revisit | ❌ **FALSE ALARM** | ETag → `304`, **0 bytes**. Cost is latency, not egress |
| Image transform saves 6.5× | ⚠️ Agent-measured | Could not confirm — bucket name not resolvable from repo |
| High-traffic tables in realtime publication | 🔴 **UNRESOLVED** | Not in any migration. My probe was **invalid** (see below) |

### The one open question — please run this

Not one of `workout_sessions`, `check_ins`, `personal_records`, `streak_cache`,
`challenge_participants`, or `direct_messages` is added to the realtime publication
by any migration. They were either added by hand in the dashboard, or never.

I tried to settle it by subscribing from a client. **The test was invalid** — my
negative control (`zzz_table_does_not_exist`) also reported success, proving
Realtime accepts any binding at subscribe time without validating it. Discard that
result.

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;
```

It cuts both ways, and both answers matter:

- **Published** → the Realtime cost findings are live. Estimated **17.3M messages/month
  from a single 2,000-member gym**, against a 5M/month Pro allowance. That is the
  largest cost exposure in this audit.
- **Not published** → those costs are zero, but GymPulse, the live Leaderboard,
  Challenge leaderboards and DM live-updates **have never worked** and have been
  silently running on fallback polls this whole time.

---

## P0 — Wrong data in production

This class matters more than performance. A slow page annoys; a wrong number gets
acted on. Everything here is a *correctness* failure caused by the 1000-row cap,
and the cap is now **proven** in prod.

The root idiom: **`.limit(10000)` reads as a safeguard in code review but PostgREST
applies `LEAST(limit, max_rows)`.** Every such call silently returns 1000 rows. There
are ~21 of them left. This is why unbounded queries passed review.

| # | Where | What the owner sees |
|---|---|---|
| 1 | `analytics/RetentionChart.jsx:24,33` | Retention reads **~2–6% instead of ~60–70%** at a 1,500-member gym |
| 2 | `analytics/CohortTable.jsx:15,24` | All 24 cohort cells computed off 1.4% of sessions — grid paints all-red |
| 3 | `analytics/ActivityChart.jsx:17,23` | Engagement reads ~15–25% instead of ~60% |
| 4 | `analytics/LifecycleStages.jsx:28` | **"At Risk" understated, "Active" overstated** — on the page whose job is warning about churn |
| 5 | `analytics/MonthlySummary.jsx:27-43` | Downloadable monthly report: 1,000 workouts instead of 15,600 (**6.4%**) |
| 6 | `lib/churn/retention.js:75-87` | Churn scores **only the first 1,000 members alphabetically** — everyone past ~"R" is invisible |
| 7 | `lib/churn/retention.js:104-140` | Lapsed members read as "never activated" — **the exact population the product exists to catch** |
| 8 | `lib/exportData.js` (7 sites) | CSV exports ship **0.5% of the record** with no warning — includes the **GDPR member-data export** |
| 9 | `lib/admin/segmentFilters.js:80-87` | "Hasn't trained in N days" segment targets the wrong members → real SMS/email sent to them |
| 10 | `AdminMembers.jsx:571` | "Total Members" shows the *loaded page count* (200), not the real total |
| 11 | `TrainerClients.jsx:1040` | Churn row chosen arbitrarily from history; **Home and Clients label the same person differently** |
| 12 | `useSupabaseQuery.js:136` | **275 of 1,275 foods unreachable today** — proven, not projected |
| 13 | `PersonalRecords.jsx:155` | `.order(asc).limit(500)` returns the **oldest** 500 → PR charts silently frozen for 2-yr members |
| 14 | `Messages.jsx:580` | DM thread `asc` + 1000 cap → past 1,000 messages users see the *beginning* and can never reach recent history |

**Fix order caveat — this is the trap.** Findings 6/7 and `retention.js:183-188` are
coupled. Paging the churn inputs multiplies `allSessionRows` ~22×, and the existing
per-member `.filter()` inside a `forEach` turns a 2.4 s stall into a **~54 s frozen
tab**. Same for the nine analytics charts: fixing them individually converts a
fast-and-wrong page into a slow-and-right one that no longer loads. **These must move
to server-side aggregate RPCs, not client-side paging.**

---

## P0 — Cost & load

### 15. The service worker does not run on iOS or Android

`vite.config.js:100` — `selfDestroying: isCapacitor`. Verified: `dist/sw.js` is a
608-byte unregister stub.

The comment at `vite.config.js:128` says *"Runtime caching — active on both web and
Capacitor."* **That is false.** The `video-cache` rule (`rangeRequests: true`, 30-day
TTL — someone clearly debugged 206 handling to get it right) and the 1500-entry
`storage-cache` rule **never execute on the platforms the app actually ships on**.

This is the multiplier on every other media number: **it turns one-time costs into
per-session costs.**

`LazyVideoTile.jsx:44`'s own comment gives the game away — *"the bytes are cached in
the element/browser/SW"*. On native there is no SW. The code depends on a cache that
was deliberately removed.

### 16. `LazyVideoTile` plays every tile, in an uncapped grid

`LazyVideoTile.jsx:43` calls `node.play()` on intersect. `preload="metadata"` is
irrelevant once playback starts — it downloads the **entire file**.
`AllExercisesModal.jsx:285` maps *all* 307 exercises with no cap or virtualization.

**One scroll of that modal = 203 × 177 KB = 35.9 MB — the entire video corpus, in
one screen.**

`ExerciseVideoThumb` is the correct sibling (metadata-only, `#t=0.1`, no `play()`).
Two components render the same assets with a ~4× cost difference.

### 17. 1024×1024 images rendered at 44 px

`Nutrition.jsx:1189` — `FoodThumb size={44}` pulling ~190 KB images. One ingredient
category = 7.6 MB; all six = 45.6 MB. `lib/imageUrl.js:53,71,87` return
`getPublicUrl()` with no width/quality params.

### 18. `broadcastNotification` — N sequential inserts + N unthrottled edge invocations

`lib/notifications.js:52-72`. Two client-side loops: inserts awaited one at a time,
then `sendPushToUser` fired un-awaited with no concurrency bound.

A 2,000-member announcement = **120 seconds of blocking** with the admin's tab pinned
open (navigate away → half-delivered, no resume, no record), then **2,000 concurrent
edge invocations** from one browser.

Both correct patterns already exist in the repo and this call site uses neither:
`send-push/index.ts:197` batches at 50; `outreachSender.js:203` has a bounded worker
pool with pacing.

### 19. `appResume.js:199` — unfiltered `invalidateQueries()` on every resume

Global `refetchOnWindowFocus: false` is correct for Capacitor — and then this
replaces it with something worse. An unkeyed `invalidateQueries()` ignores
`staleTime`, so it nukes even the `staleTime: Infinity` entries.

**~3.42M avoidable requests/month at 1,000 DAU.** One-line fix (a predicate).

---

## P1 — Selected

- **`ProgressOverview.jsx:1000`** — lifetime workout history with *every set*, no
  limit. 2-yr member = 12,896 rows ≈ **1.05 MB JSON**, on the **default** Progress
  tab, held in heap all session.
- **`ActiveSession.jsx:2127`** — draft upsert re-uploads the whole exercise catalogue
  (incl. `instructions` + `instructions_es`) on every keystroke pause. ~8 KB × ~75
  writes = **640 KB uploaded per workout** to persist ~2 KB of state.
- **`ActiveSession.jsx:1276`** — unfiltered `exercises` select against an RLS function
  with 5 correlated subqueries → evaluated **once per row, platform-wide**.
- **Dashboard + QuickStart refetch on every navigation** (`Dashboard.jsx:482`,
  `QuickStart.jsx:309`) — **8 requests per navigation** the user never asked for.
- **`user` object in deps** — `AuthContext.jsx:774` mints a new reference on
  `TOKEN_REFRESHED`; 7 pages key effects on the object, not `user.id`. Includes a
  **mid-workout** full reload in ActiveSession.
- **`TrainerMessages.jsx:483`** — 60 conversations = 120 requests +
  **36,000,000 PBKDF2 iterations** (~15–20 CPU-seconds) on cold launch.
- **`TrainerPlans.jsx:2566,2631`** — `select('*')` ships full `weeks`/`meals` JSONB to
  render card titles. 100 plans ≈ 4.5 MB; the 500 ceiling ≈ **22 MB**.
- **`platform_gym_activity_pulse`** — two **unbounded full-table aggregates** over all
  check-ins and sessions fleet-wide, on a **60-second interval**.
- **`GymDetail.jsx:655`** — opening one gym runs a whole-fleet aggregate, then discards
  all but one row client-side.
- **TVDisplay** — 2,880 RPCs/day/screen; the PRs board aggregates **lifetime** PR
  history every 30 s, forever, for a top-10 list. `tv_get_dashboard_data` is
  **anon-callable with no rate limit**.
- **`get_friend_feed`** — a **friendless member** (i.e. every new signup) triggers a
  full gym-feed scan with a per-row `is_trainer_of()`. Worst possible first
  impression, and it degrades with gym age.
- **`meal_plan_<uid>_<weekStart>`** — one localStorage key per week, forever, storing
  full recipe objects (990 B/meal → **1.37 MB/year**). Cleared only on sign-out.

### The silent failure mode worth understanding

`useCachedState.js:46` swallows `QuotaExceededError`. WebKit caps localStorage at
~5 MB/origin. Stack the meal-plan keys + 533 KB library caches + ~55 `ucs:` keys +
the React Query persister + the offline queue, and when it trips **every cached page
in the app permanently loses persistence** — skeletons return everywhere, and there
is no telemetry to tell you it happened.

The Nutrition date-key prune added earlier today was verified correct and is *not*
part of this problem.

---

## Cost model

**Egress**, assuming no SW cache on native (finding 15):

| Members | Egress/mo | Over 250 GB (Pro) | ≈ Cost |
|---|---|---|---|
| 1,000 | 133 GB | — | $0 |
| 2,000 | 266 GB | 16 GB | ~$1 |
| 5,000 | 665 GB | 415 GB | **~$37/mo** |
| 10,000 | 1.33 TB | 1.08 TB | **~$97/mo** |

**The bill is not the emergency.** The user-facing cost is: typical session
**17.5 MB**, power session (search grid + Discover) **88 MB**.

Fixing the SW alone: **7.6×**. SW + image transforms + JPEG posters: **~53×**
(17.5 MB → ~2.5 MB per session).

**Requests**: ~9M PostgREST/month at 1,000 DAU (~3.5/s average, far higher at gym
peak). Roughly **60% is avoidable** — resume invalidation, navigation refetches,
two 30-second polls, and 180,000 wasted `sign-qr` edge invocations.

---

## What is already good

Worth stating so it doesn't get "fixed":

- **No cross-tenant leak found.** Every `platform_*` RPC is `SECURITY DEFINER` with
  an in-body `super_admin` guard. Trainer→client access is properly two-phase gated.
- **Realtime hygiene is clean** — all 28 channels tear down correctly. No leaks.
- **AI edge functions are well built** — server-side 15/hour/user cap that **fails
  closed**, client-side image compression, 3 MB hard reject. Leave alone.
- **`libraryCache.js`** — count-probe + TTL. Genuinely cheap and correct.
- **`selectAllRows` / `selectAllInBatches` already exist** and are correct. Roughly
  half the admin surface was migrated in a prior wave. `selectAllInBatches` has
  **zero call sites** — the fix for finding 7 is written and unused.
- **`lib/admin/reportExports.js`** is the correct model (stable `(sort, id)`
  tiebreakers) — 9 of 10 queries right.
- `overloadEngine.js` is pure computation, zero DB access. No concern.

---

## Recommended order

**First — decide, don't code:**
0. Run the `pg_publication_tables` query. It determines whether the single largest
   cost item is real or whether four live-update features are silently dead.

**Then, highest value per unit of risk:**
1. **Ban `.limit(N > 1000)`** with a CI grep. It would have caught every P0
   correctness finding. Do this before fixing them, or they grow back.
2. **Un-self-destruct the service worker** on Capacitor (`vite.config.js:100`) —
   7.6× on repeat egress, one line.
3. **Drop `node.play()`** from `LazyVideoTile.jsx:43` — removes 35.9 MB from one
   screen.
4. **Scope `appResume.js:199`** to a predicate — ~3.4M requests/month, one line.
5. **Move the 9 admin analytics charts to aggregate RPCs.** Not client paging — see
   the coupling trap above.
6. **`broadcastNotification` → server-side batch** (`notifications.js:52`).
7. Drop `location.key` from Dashboard/QuickStart deps; switch `user` → `user.id` in
   the 7 effects that use the object.
8. Image transforms in `lib/imageUrl.js` (verify the 6.5× claim first — I could not).

Items 2, 3, 4 and 7 are one-to-few-line changes covering most of the load and egress
waste. The correctness work (item 5) is the largest and the one that actually
protects a paying customer from acting on a wrong number.

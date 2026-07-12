# TuGymPR — Release Plan of Record · 2026-07-11
**One update, three workstreams:** fix Audit-1 (correctness/security), fix Audit-2 (performance/scale + codes-links), and ship **Onboarding v2** (specific goals → tailored programs). All shipped together so that when I'm back from the cruise the app is on its latest version **and** ready to sell.

Full per-finding detail (repro + fix + file:line) lives in **[AUDIT_2026-07-05.md](AUDIT_2026-07-05.md)** and **[AUDIT_PERF_2026-07-09.md](AUDIT_PERF_2026-07-09.md)**. Onboarding v2 detail lives in the approved plan file. This doc is the **execution order + what/why** across all of it.

## The numbers
- **Audit-1:** 99 findings (1 P0 · 29 P1 · 69 P2) — correctness & security.
- **Audit-2:** 108 findings (1 P0 · 36 P1 · 71 P2) — performance/scale & functional-failure.
- **~174 distinct issues** after removing the 33 that both audits found (those overlaps = corroboration).
- **~35 warrant attention now** (the P0s + P1s); the rest are latent-at-scale or polish, correctly tagged.

> **Deploy tags:** 🟢 server = SQL/edge-fn, ships in minutes, no store review · 🟡 either = a server fix covers it now · 🔵 app = rides the store update. The whole point of the ordering below: **do everything 🟢/🟡 first** — it's live before Apple/Google even see the binary.

---

## Phase 1 — Ship-today, server-side (no store review)
The highest-leverage batch. Every P0/P1 that deploys as a migration or edge-function redeploy. Do this first; it's live the moment you push, independent of the app update.

### Security / RLS (3)
- **🔴 P0** Any member can self-assign as a trainer to any same-gym member (trainer_clients INSERT has no role gate) → full read/write breach of that member's coaching, health, PR, goal & nutrition data
- **🟠 P1** DSAR "Export data" silently exports empty PRs, body measurements and goals (RLS filters them out, success toast still fires)
- **🟠 P1** add_friend_by_code bypasses block enforcement — a blocked user can re-friend the person who blocked them (confirmed live: SECURITY DEFINER RPC skips the friendships RLS block guard and has no is_blocked check) `supabase/migrations/0563_add_friend_by_code_autoadd.sql:78` _(both audits)_

### Points / referral economy (9)
- **🟠 P1** Move-member RPC leaves the member's social feed history stamped with the OLD gym (misses activity_feed_items, gym_class_recurring, referrals)
- **🟠 P1** Finish-workout Retry after a committed-but-lost RPC response creates a duplicate session + double points/XP/streak
- **🟠 P1** register_referral has no same-gym check — cross-gym signups fund a referrer's points balance
- **🟠 P1** pr_hit points (100) + public "New PR" feed item are awarded without re-checking the PR actually beat the stored record
- **🟠 P1** choose_referral_reward: non-atomic pending→chosen flip + un-deduped points credit = member can double/N-tuple a referral reward
- **🟠 P1** complete_referral dropped the per-gym monthly referral cap (and circular/account-age guards) — admin 'Max Referrals Per Month' is silently ignored, referral points uncapped
- **🟠 P1** redeem_reward → claim_redemption points overspend race: no row lock lets a member hold pending redemptions exceeding balance, then claim both
- **🟠 P1** Move-member RPC still misses activity_feed_items, gym_class_recurring, referrals — social/class/referral history stays stamped to the OLD gym after a support move `supabase/migrations/0591_admin_move_member_to_gym.sql:58` _(both audits)_
- **🟠 P1** Win-back / outreach reward voucher email QR omits the `gym-voucher:` prefix — scans as a check-in, voucher never redeems `supabase/functions/send-admin-email/index.ts:495`

### Codes / links / QR / account-delete (8)
- **🔴 P0** Entire invite pipeline hardcodes the dead `tugympr.app` domain AND send-invite's validator REQUIRES it (rejects the correct app.tugympr.com) `supabase/functions/send-invite/index.ts:173` _(both audits)_
- **🟠 P1** Admin invite links & QR codes point to dead domain tugympr.app — member-acquisition flow broken + wasted SMS/email spend
- **🟠 P1** Deleting a member resurrects their one-use invite code (banned member can rejoin)
- **🟠 P1** Android App Links unverifiable — assetlinks.json still ships the placeholder SHA-256 fingerprint `public/.well-known/assetlinks.json:8`
- **🟠 P1** Win-back reward-QR (reward-qr edge fn) joins signature with COLON, but the scanner only accepts PIPE — every emailed/SMS'd/pushed win-back reward QR is rejected as "Invalid QR — please refresh in the app" `supabase/functions/reward-qr/index.ts:179` _(both audits)_
- **🟠 P1** Account-deletion chain is blocked at the gateway: request/confirm-account-deletion lack verify_jwt=false in config.toml (public no-login form gets 401) `supabase/config.toml:407`
- **🟠 P1** Admin invite links & QR codes point to dead domain tugympr.app (invite acquisition funnel broken); send-invite edge validator REQUIRES the dead domain `src/pages/admin/components/InviteModal.jsx:40` _(both audits)_
- **🟠 P1** Invite universal-link fails on native even after DNS fix: iOS associated-domains and Android assetlinks only cover app.tugympr.com, never tugympr.app `ios/App/App/App.entitlements:7` _(both audits)_

### Data integrity (support actions) (2)
- **🟠 P1** Reactivated gym keeps plan_type='cancelled' — plan badge reads CANCELLED everywhere
- **🟠 P1** Bulk gym Deactivate/Activate bypasses pause_gym/unpause_gym — corrupts member membership_status across paths (banned members resurrected as active; or whole gym permanently locked out) `src/pages/platform/GymsOverview.jsx:265`

### Analytics / pagination (wrong-data) (5)
- **🟠 P1** Costs & margin panel MRR contradicts the page's own MRR card — margin is wrong for any gym without a manual price
- **🟠 P1** broadcastNotification selects members with no pagination — announcement and NPS-survey broadcasts reach only the first ~1000 members (PostgREST cap) `src/lib/notifications.js:36` _(both audits)_
- **🟠 P1** AdminStore 'Total Sales' fetches all purchase prices and sums in JS with a .limit(2000) clamped to 1000 — revenue figure undercounts on established gyms `src/pages/admin/AdminStore.jsx:58`
- **🟠 P1** CardQueue loads the fleet-wide print_cards queue with .limit(2000) — clamped to 1000 by max_rows, so open cards across all gyms silently vanish from the operator's print/deliver queue `src/pages/platform/CardQueue.jsx:95`
- **🟠 P1** FleetCostPanel MRR/margin contradicts the page's own bracket-priced MRR card (platform_cost_summary sums NULL monthly_price) `src/pages/platform/PlatformAnalytics.jsx:75` _(both audits)_

### Other server fixes (5)
- **🟠 P1** Win-back reward gift is non-idempotent; a send failure + retry double-issues claimable rewards
- **🟠 P1** translate edge function returns 429 on every call for all gym members — auto-translate silently dead
- **🟠 P1** 0602 member_purchases.approved_by FK has no ON DELETE rule — blocks deleting any admin/owner who approved a store purchase (0605 sibling)
- **🟠 P1** Exercise favorites feature is completely dead — `exercise_favorites` table does not exist in any migration `src/pages/ExerciseLibrary.jsx:2839`
- **🟠 P1** Operations incident detector reads only the newest 200 error rows in the 2h window — magnitude and blast-radius undercounted during a real incident `src/pages/platform/Operations.jsx:534`

**Why first:** these are the account-breach hole, the value/money leaks, the flows that are simply broken (unscannable QR, dead account-delete, dead invite domain, broken Android app-links), and the analytics that are already feeding gym owners wrong numbers. None need Apple/Google. Rehearse the migrations against local/staging Supabase, then push.

---

## Phase 2 — Next app-update batch (rides the store release)
Client/native fixes, grouped by the systemic pattern so you fix the cause once, not the symptom N times. Detail + every instance in the two audit reports.

### The live P1s (broken now, need the binary)
- **🟠 P1** Referral "Approve" marks completed but awards no points/reward (bare UPDATE bypasses safe_complete_referral)
- **🟠 P1** DSAR member export silently truncates every table at the ~1000-row PostgREST cap
- **🟠 P1** Retention diagnostic computes cohort/churn charts on an arbitrary first-1000-member subset for large gyms
- **🟠 P1** Post-import 'Download codes sheet' truncates at ~1000 members, so large imports hand the front desk an incomplete invite-code list
- **🟠 P1** SupportConsole unreadable in light mode: inline dark backgrounds vs theme-remapped text
- **🟠 P1** Daily "Check-In" challenge queries nonexistent check_ins.created_at → can never be completed, silently leaks 25 pts
- **🟠 P1** WorkoutLog routine picker queries nonexistent routines.profile_id column → always empty ('No routines yet')
- **🟠 P1** DM thread loads the entire conversation unbounded and ascending → newest messages silently dropped past the 1000-row cap
- **🟠 P1** TrainerClients churn score/status uses an arbitrary (often stale) row → at-risk clients silently misclassified as "on track"
- **🟠 P1** Segment-targeted campaigns silently truncate to 500 members (send, count, CSV, bulk DM)
- **🟠 P1** broadcastNotification fetches all members with an unbounded select → announcements & NPS surveys miss members past ~1000
- **🟠 P1** AdminRevenue purchases query is uncapped — revenue totals silently truncate at the 1000-row PostgREST cap
- **🟠 P1** Rewards redemption modal shows English 'Reward' label (key rewards.rewardLabel missing from ES)
- **🟠 P1** `_plural` suffix is silently dead in i18next v25 → Spanish shows the SINGULAR form for every plural count (109 key families)
- **🟠 P1** Rewards redemption modal shows English 'Reward' label (key rewards.rewardLabel missing from ES)
- **🟠 P1** `_plural` suffix is silently dead in i18next v25 → Spanish shows the SINGULAR form for every plural count (109 key families)
- **🟠 P1** CreateInviteModal ships dead-domain `tugympr.app` access links to real new members via send-admin-email/send-sms (no domain validation) `src/pages/admin/components/CreateInviteModal.jsx:147` _(both audits)_
- **🟠 P1** Admin "Delete Account" calls nonexistent RPC delete_own_account — silently fails yet signs the admin out (false success) `src/pages/admin/components/DeleteAccountModal.jsx:59`
- **🟠 P1** TrainerClients churn status/% uses an arbitrary (often stale) churn_risk_scores row → at-risk clients silently misclassified 'on track' `src/pages/trainer/TrainerClients.jsx:1028` _(both audits)_
- **🟠 P1** Trainer class workout-template preview always shows 'No exercises' — queries nonexistent routine_exercises columns (sets, reps, order_index) `src/pages/trainer/TrainerClasses.jsx:1194`
- **🟠 P1** Daily 'Check-In' challenge queries nonexistent check_ins.created_at → progress stuck at 0, 25 pts never awarded (re-report of audit-1) `src/pages/Challenges.jsx:1220` _(both audits)_
- **🟠 P1** WorkoutLog routine picker queries nonexistent routines.profile_id → always empty 'No routines' (re-report of audit-1) `src/pages/WorkoutLog.jsx:235` _(both audits)_
- **🟠 P1** AdminMembers gym-wide CSV exports (workout history, PRs, body metrics) truncate at 1000 rows behind a .limit(10000), no count-check `src/lib/exportData.js:113`
- **🟠 P1** applySegmentFilters caps base roster at .limit(500) — segment campaign SEND, recipient COUNT, CSV export, and 'Message All' DM all silently truncate to 500 members `src/lib/admin/segmentFilters.js:44` _(both audits)_
- **🟠 P1** Analytics Retention/Cohort/Engagement charts truncate workout_sessions at the 1000-row PostgREST cap → retention/cohort/engagement numbers shown to the gym owner are understated and non-deterministic `src/pages/admin/components/analytics/RetentionChart.jsx:33`
- **🟠 P1** AdminMembers search is client-side only over the loaded page cache → on gyms >200 members, searching for any not-yet-loaded member returns 'No members found' (member is unreachable) `src/pages/admin/AdminMembers.jsx:285`
- **🟠 P1** AdminAttendance heatmap/trends/unique-visitors computed on check_ins & sessions capped at 1000 rows ordered OLDEST-first — newest days silently dropped, stats wrong `src/pages/admin/AdminAttendance.jsx:88`
- **🟠 P1** Admin Overview totalMembers/retention/active-rate silently wrong on any gym over 1000 members (profiles fetch clamped to max_rows) `src/lib/admin/overviewQuery.js:34`
- **🟠 P1** AdminRevenue purchases query uncapped → Total Sales / avg transaction / category revenue truncate at the 1000-row cap (re-report; known) `src/pages/admin/AdminRevenue.jsx:159` _(both audits)_
- **🟠 P1** AdminAttendance: check-ins & workouts capped at .limit(1000) with ascending order — totals, daily trend, peak-hours heatmap and the 1st-vs-2nd-half delta silently truncate (and mislead) on busy gyms `src/pages/admin/AdminAttendance.jsx:87`
- **🟠 P1** CardQueue fulfillment worklist clamps at 1000 rows — cards past the cap silently vanish from the print/deliver queue and the operator's counts undercount `src/pages/platform/CardQueue.jsx:104`
- **🟠 P1** DSAR member export silently truncates every table at the 1000-row cap `src/pages/platform/SupportConsole.jsx:561` _(both audits)_
- **🟠 P1** GymDiagnostic computes cohort/retention charts on an arbitrary first-1000-member subset for large gyms `src/pages/platform/GymDiagnostic.jsx:77` _(both audits)_
- **🟠 P1** GymImport codes sheet fetches imported members with no paging — CSV omits everyone past 1000, front desk never gets their claim codes `src/pages/platform/GymImport.jsx:224` _(both audits)_
- **🟠 P1** Admin referral-QR-scan completion is dead — handleReferralScan filters a nonexistent `referral_code` column on the `referrals` table, so a scanned referral QR NEVER completes or pays out `src/lib/scanActionHandlers.js:408`
- **🟠 P1** Admin 'Approve' on an approval-required referral marks it completed but awards nothing (bare UPDATE bypasses safe_complete_referral) — the ONLY non-scan completion path leaves both parties unpaid `src/pages/admin/AdminReferrals.jsx:164` _(both audits)_
- **🟠 P1** SupportConsole DSAR export unbounded (1000-row clamp) and RLS-blind (empty PR/body/goal arrays) — silently incomplete legal export `src/pages/platform/SupportConsole.jsx:559` _(both audits)_

### The systemic P2 patterns (fix the pattern, batch the rest)
From Audit-2, the P2 volume collapses into a few root causes — fix each pattern once:
- **`max_rows=1000` cap (47)** — the `.limit(10000)`/`.limit(2000)` are false safeguards; paginate with the existing `selectAllRows()` / head-counts. Member-side = latent; admin/platform analytics = the near-term wrong-data ones (already pulled into Phase 1 where they're P1).
- **Native deep-link / MemoryRouter (11)** — incl. the Android back-button-quits-everywhere bug; one navigation-model fix covers most.
- **Client-render scale (4)** — add list virtualization (the exercise grid + pickers) + release far-offscreen video src. One shared windowing helper.
- **`${cssVar}`+alpha transparent-CSS + dark/light contrast** — mechanical sweep → `color-mix()`.
- **Realtime scope + missing indexes (rest of Pattern 6)** — mostly server, a few client filters.

Audit-1's P2 backlog (69) is grouped by side in its report — sweep the two cheap patterns (1000-row counts → head-count; CSS-alpha → color-mix) in one mechanical pass each, then triage the remainder.

---

## Phase 3 — Onboarding v2 (the feature)
**What:** a new skippable "Your Targets" step lets members set specific goals (muscle emphasis, target body weight, body composition, target lifts), each run through an intensity-band realism guardrail (Steady/Moderate/Aggressive + honest override; big goals get a ~12-week milestone + the long-term aim). Those become real `member_goals` + a `priority_muscles` setting that feed the generator you already have — which already adds volume to goal lifts and emphasized muscles. Plus a **goal-anchored program name** ("The 160 Build", not "PPL Hypertrophy") and a **"why this plan" caption** so the tailoring is visible.

**Why:** installs a retention loop at the front door — specific intention → realistic target → personalized program → tracked progress → near-term milestone → celebrated win. It's ~80% wiring existing engines. Behind a **remote feature flag** so it's killable without a store release (critical: no hotfix window on the cruise).

**Build order** (each step independently revertible): additive `priority_muscles` migration → extract `goalRealism.js` → `onboardingGoals.js` (baselines/conflict/idempotent/normalize) → generator wiring → Targets UI → goal-anchored naming + caption → analytics → the 120→160 acceptance test + full verification. Detail in the approved plan file. Ships in **this same update**; test this path hardest (it's the first impression when selling).

---

## Phase 4 — Share previews (static + fail-safe dynamic)

**What:** shared links (invite, referral, workout/PR/cardio) currently unfurl as bare URLs (zero OG tags, pure SPA). Two tiers, both shipping:
- **Static baseline:** one set of `og:*` + `twitter:card` tags + a branded `og-image` in `index.html`, so every link shows a clean TuGymPR card. Ships with the dead-domain/assetlinks "links cluster."
- **Dynamic per-gym (fail-safe):** a Vercel edge function fronting the share routes (`/invite/*`, `/referral/*`, `/get`) that detects crawlers and injects per-link/per-gym `og:` tags — an invite to *Iron House* unfurls with Iron House's logo + "Join Iron House on TuGymPR." **Reuse existing rendering:** point `og:image` at (a) the app's existing on-device share-card PNG uploaded to storage for user content, and (b) a pre-generated branded image per gym at branding-setup for invites — so **no server-side image engine needed**. **Every path fail-safes to the static baseline card on any error** (missing gym, lookup failure, unknown route) → a link is never broken, only ever "less custom."

**Why:** white-label share cards are a real sales/word-of-mouth lever, and the fail-safe design caps the downside (worst case = the static card). Difficulty ~4/10 with the reuse-existing-renders shortcut.

**Build order:** static baseline first (it's also the fallback) → edge function with crawler detect + gym lookup → wire the two image sources → fail-safe wrapper → OG validation (FB debugger, real iMessage/WA sends). Depends on the invite base-URL fix landing first (links must resolve to `app.tugympr.com`).

---

## Suggested working order (the 8 days)
1. **Server-side session** — Phase 1 in full (P0s, economy, codes/QR/account-delete, analytics pagination, indexes, assetlinks + send-invite validator). Rehearse on local/staging Supabase, push. Live immediately.
2. **Onboarding v2** — build in the plan's sequence behind the feature flag; run the 120→160 acceptance test.
3. **App-update batch** — the Phase-2 live P1s + the systemic P2 sweeps (dead features, deep-link/back-button, invite base-URL client change, CSS/contrast, virtualization).
4. **One staged release** — build iOS + Android, staged rollout (10-20% first, watch crashes), Capgo bundle matched. Bundle the dead-domain client fix + (optionally) the static OG share-preview here.
5. **Verify + tag** — commit/tag the exact shipped build; confirm the two audit reports' items are checked off.

## Scope note — both audits fully in scope
Audit-1 and Audit-2 are to be **fully fixed** this release. The P2 volume collapses into the ~6 mechanical pattern-sweeps above, so "fully fixed" ≈ the P0/P1s + those sweeps, which clears 90%+. A small set (~10-15) are **judgment/product calls** (e.g. DSAR export completeness, streak-leaderboard ranking behavior, win-back QR delivery redesign, impersonation-clear approach) — these are **flagged, not silently deferred**, and get surfaced for a decision rather than guessed. A literal handful are premature-optimization for far-off scale; fixed anyway for a clean slate.

## Explicitly NOT in this release
- The desktop/Tauri force-update gap (tracked separately — not an audit finding).
- AI body scan inside onboarding (stays a post-onboarding nudge).
- `assetlinks.json` real fingerprint requires the release keystore (founder action — the code/placeholder is ready, the SHA-256 must be pasted from the keystore).

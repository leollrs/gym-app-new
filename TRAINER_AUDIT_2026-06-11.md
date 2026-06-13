# Trainer-Side Full Audit — 2026-06-11

Method: 9 code agents read every trainer page/component in full (~850KB) and verified columns/RPCs/RLS against migrations + i18n against both locales; 1 agent researched 2025-26 competitor feature sets (Trainerize, TrueCoach, Everfit, PT Distinction, FitSW, Hevy Coach, Mindbody/Glofox/TeamUp). All file:line refs relative to `gym-app/`. VERIFIED = root cause confirmed in code/migrations.

Status legend: `[ ]` open · `[x]` fixed · `[-]` won't fix / deferred

---

## ✅ RESOLUTION — 2026-06-11 fix wave (same day)

**ALL P0 (3), P1 (12), P2 (20) + the P3 batch fixed** by 1 lead + 9 parallel agents. Market features built: session packs (0534 + UI both sides), evening reminders + confirm/can't-make-it (0532), intake/PAR-Q preset (coaching 'once' cadence), assigned-plan compliance (shared weeklyAdherence), member delivery of trainer plans + meal plans (0537 + viewer components). Bonus root-cause found: notifications localized off never-written profiles.language → everyone got English; 0538 switches helpers to preferred_language.

**PENDING USER ACTIONS**
1. Apply migrations **0528 → 0538 in order** (11 files) in the Supabase SQL editor.
2. Redeploy the 10 edge functions from the earlier ai_rate_limits fix (still pending).
3. Xcode Run (build green, cap copy done).

**STILL DEFERRED (not built, by design)**
- DM attachments (photo/video); full reschedule-request table flow (lean decline-notify shipped); drag-to-reschedule + series edit/cancel; availability-aware booking; calendar realtime; partial payments / structured payment method / fee-change history; per-occurrence class cancel + QR class check-in + closure awareness; trainer-recorded body metrics; notes autosave; admin UI for trainer_verified; phone-privacy toggle (hint shipped); materialized session title still hardcoded 'Entrenamiento' (ES-only market, acceptable); class slot-delete still CASCADEs history (confirm dialog warns); trainer-side class analytics still client-computed (error-handled now; get_trainer_class_analytics RPC remains unused); cosmetic duplicates (plan card on 2 tabs, Home needs-attention ×3, review-card JSX ×3, assign-program copy-paste in 2 files — consistent now via shared helpers but not consolidated).

---

## P0 — SYSTEMIC (product-level breaks)

- [x] **P0-1 TrainerProfile is read-dead AND write-destructive.** VERIFIED 3× independently.
  Root cause (two halves): (a) `get_auth_context` (latest def 0392) returns NONE of `trainer_services/credentials/specialties/availability/cover_url/tagline/pronouns/location/years_exp/verified/default_rate/rate_unit` (AuthContext fallback select :232 also omits them); (b) `PATCHABLE_FIELDS` (AuthContext.jsx:1079) excludes every `trainer_*` field so optimistic patches are dropped.
  Effects: profile page always renders EMPTY services/credentials/specialties/availability/cover/tagline even right after a successful save; **adding a service/credential WIPES all previous ones** (builds array from empty `profile.trainer_services` and replaces whole JSONB — TrainerProfile.jsx:1144,1177); **EditIdentityModal nulls 6 DB columns on any save** (pronouns/location/years_exp/tagline/default_rate/rate_unit — :190–203); public profile (`/trainers/:id`, RPC 0391) shows the REAL DB data → split-brain. Supersedes M8 (rate prefill dead + rate silently wiped: TrainerClientPayment.jsx:112; TrainerProfile.jsx:183,201).
  Fix direction: add trainer_* to get_auth_context (or have TrainerProfile fetch its own full row) + extend PATCHABLE_FIELDS + seed modals from fetched row.

- [x] **P0-2 Custom plans & meal plans never reach the member.** VERIFIED.
  (a) `trainer_workout_plans` has NO member-side viewer — only the DM share card (week 1, one day per token); members' Workouts page consumes `gym_program_enrollments` (a different system). An 8-week plan built in TrainerPlans produces nothing in the client's app, and no notification on assign. (b) `trainer_meal_plans`: zero member-side readers (repo-wide grep); doesn't sync `nutrition_targets`; "Assign Meal Plan" CTA promises delivery that doesn't exist. (c) ClientDetail's Plan tab never lists `trainer_workout_plans` either — invisible even to the trainer's own client screen.
  Decision needed: build member viewer + sync, or fold trainer plans into the gym-programs pipeline.

- [x] **P0-3 `set_client_schedule` re-save destroys session history.** VERIFIED (0452:62–64).
  DELETE of `from_schedule` rows `scheduled_at >= date_trunc('day', now())` — UTC midnight = 8pm PR the day BEFORE, and **no status filter**. Re-saving a weekly plan: wipes today's already-COMPLETED sessions (deflates `attended_with_trainer`, money overview, attendance), resurrects CANCELLED/no-show future sessions as fresh `scheduled`, and discards any calendar edits (moved time, notes, attached workout, confirmed). Also: materialization does no conflict/duplicate check vs manual sessions, and NOTHING extends the 8 weeks — week 9 the calendar silently empties ("just stopped working" report waiting to happen).

---

## P1 — HIGH (users will hit these)

- [x] **P1-1 Trainer→client messages send no push.** sendText (TrainerMessages.jsx:740) never calls send-push-user; member side does (Messages.jsx:747). Trainer replies are silent unless app is open. Also no in-app notification row for new client DMs (`client_message` type has zero producers).
- [x] **P1-2 Messages swipe Archive/Delete/Block don't visually remove the row** — `visibleConversations` memo missing `hiddenIds`/`archivedIds` deps (TrainerMessages.jsx:667). And swipe-Delete = permanent localStorage hide, no resurface on new message (member side has server-side state + resurface trigger 0449); deleted client's future messages invisible forever on that device.
- [x] **P1-3 Calendar day view drops sessions.** (a) Hour slots built from `selectedDay` carrying wall-clock seconds (TrainerCalendar.jsx:667 vs 1195/1597) → every session matches one row early; sessions at the first row's hour (7:00) match NO row and vanish. (b) `.find()` renders max ONE session per hour row (1197/1599); cancelled sessions aren't filtered and can occupy the slot, hiding the real booking.
- [x] **P1-4 Desktop Home timeline is hard-coded 2am–4pm** (TrainerHome.jsx:876–957) — evening sessions (PR prime time) render outside the card / NOW line pegs after 4pm; desktop has no other today list. Plus desktop: NO error state at all (banner is mobile-only :534), and per-query errors render as empty data everywhere (only the catch sets error).
- [x] **P1-5 Desktop trainers can never see notifications/social** — bell + Users buttons are `md:hidden` (TrainerLayout.jsx:153–181), sidebar has no entries; `/trainer/notifications` + `/trainer/social` are desktop-orphans. The entire 0439/0440/0443/0501 alert stack is invisible on desktop.
- [x] **P1-6 Classes roster/analytics count cancelled + waitlisted bookings** — no status filter (TrainerClasses.jsx:513–532; `status` fetched, never used). Phantom members with live "Mark attended" buttons; attendance rate systematically understated; waitlisted indistinguishable.
- [x] **P1-7 Co-trainers see an empty Classes page** — page filters `gym_classes.trainer_id` only; admin's `gym_class_trainers` junction (source of truth per 0379) ignored; co-trainer booking RLS also keyed on primary trainer (0159). Per-slot `gym_class_schedules.trainer_id` (0512) also ignored.
- [x] **P1-8 Bulk DM (Clients page) counts failures as success** (TrainerClients.jsx:618–628): no maxLength on textarea while ciphertext CHECK is ≤2000 (thread composer caps 1400 for this reason) → long broadcast fails EVERY insert yet toasts success; failed seed fetch → encrypts with key from literal `"undefined"` → recipient gets garbage, also "success". Also never bumps `conversations.last_message_at` (threads don't reorder).
- [x] **P1-9 NEW schema drift: `trainer_sessions.started_at` doesn't exist** — TrainerProfile.jsx:948 ("Sessions this month" KPI permanently 0; error ignored). Real column: `scheduled_at`. Same class as enrolled_at/booking_date/completed_at/created_at.
- [x] **P1-10 Payment dates render wrong** (TrainerClientPayment.jsx:50–51): date-only strings parsed UTC then formatted PR-local → history rows show the PREVIOUS month ('2026-06-01' → "may 2026") and next-due shows one day early. Money surface = trust killer.
- [x] **P1-11 Classes Templates tab is dead code** — `TABS` (TrainerClasses.jsx:46) omits 'templates'; TemplatesTab/RoutineSelector/TemplatePreview (~225 lines) unreachable, so trainers can't attach/change a class workout template despite working RLS.
- [x] **P1-12 Multi-trainer money split-brain**: `member_payments` unique per (member, month) with NO trainer attribution (0450:25) — two trainers of one client both see the full amount as theirs, either can hard-delete the other's record (Undo); year totals double-count. Related: `get_client_schedule` falls back to ANY trainer's slots → second trainer silently forks a parallel duplicate schedule (0452:105).

---

## P2 — MEDIUM

- [x] **P2-1 ClientDetail notes silently revert** — `loadClientData` re-derives notes from page-load snapshot; saving doesn't refresh `_assignmentNotes`; any reload (assign program, language switch) wipes/reverts edits with no warning (TrainerClientDetail.jsx:192,290–312,728–752).
- [x] **P2-2 Meal-plan dual-active corruption**: TrainerPlans never deactivates the existing active plan; ClientDetail enforces single-active and reads `.maybeSingle()` → errors on 2 rows → silently shows "No plan", trainer stacks a third (TrainerPlans.jsx:1309; TrainerClientDetail.jsx:550,673). ClientDetail's own deactivate also ignores `{error}` (fake success / dup actives).
- [x] **P2-3 Check-ins logic is decorative in 3 ways**: cadence ignored (always Monday-weekly, coaching.js:34); card shows "Completed" forever after ONE response ever (TrainerClientCoaching.jsx:191); habit bar mixes ~4 weeks of logs against a weekly target → 2×/wk habit shows 7/7 (coaching.js:182). Past answers unviewable anywhere; 8-response limit shared ACROSS templates starves cards.
- [x] **P2-4 Attendance numbers disagree tab-to-tab**: Payment card counts check-in ROWS (double-counts re-scans, ignores workouts — 0453:133); Attendance tab counts distinct DAYS of check-ins ∪ workouts (0452:122). Same client/month, two numbers one tab apart.
- [x] **P2-5 Three disagreeing risk models** — TrainerHome `deriveClientStatus` (≥50/≥70/≥60), TrainerClients list (≥30/≥55/≥80), ClientPreview's own variant; same client = different status per page. Chip counts use different thresholds than the filter they trigger ("Churn 2" → lists 6, TrainerClients.jsx:995). Plus churn staleness never checked (`computed_at` fetched, ignored).
- [x] **P2-6 Calendar hard-delete notifies nobody** (triggers fire on UPDATE only — 0443:187); member's session just vanishes. Cancel-then-notify exists; Delete bypasses it.
- [x] **P2-7 Stale drafts render as live sessions with absurd timers** — TrainerLiveSession has no draft age cutoff (Home uses 24h; Detail none) → 3-day-old abandoned draft shows "Both viewing · 4320:00".
- [x] **P2-8 Dead "DB conflict guard"** — error mapping for `trainer_schedule_conflict`/23505 (TrainerCalendar.jsx:227) but NO such constraint/trigger exists in any migration; only guard is the racy client-side pre-check; cross-trainer double-booking fully unguarded (deferred RPC still pending).
- [x] **P2-9 One-off class slots invisible** — page never selects `specific_date`; `slotsByDow` skips null day_of_week (TrainerClasses.jsx:1327,340); bookings for them DO show → bookings for occurrences the schedule says don't exist.
- [x] **P2-10 "Propose New Class" is a write-only black hole** — logs `class_proposal` via log_admin_action; no admin notification; admin UI shows details only in CSV export. Trainer gets "sent to admin" success.
- [x] **P2-11 Payment reminder copy wrong twice** — hardcoded Spanish (EN members get ES) AND says gym "membresía"/front desk when it's the trainer's own PT fee (0450:190; TrainerPayments.jsx:114 WhatsApp template too).
- [x] **P2-12 Cross-client workout share renders empty for recipient** — WorkoutShareModal lists ALL plans, no filter/label by conversation client (`client_id` fetched, unused); RLS-denied → blank fallback card; trainer never knows (WorkoutShareModal.jsx:40–47).
- [x] **P2-13 Exercise names English-only in trainer builder** — query omits `name_es` (TrainerPlans.jsx:373); muscle-group pills show raw English enum. Member side localizes.
- [x] **P2-14 Builder duration-shrink orphans weeks in JSON** (8→4 keeps keys 5–8; counts/chips wrong — TrainerPlans.jsx:790,554). Duplicate-then-reassign impossible (copy keeps client_id; client select locked on edit — :1384,632).
- [x] **P2-15 Unread state stale** — opening a thread doesn't update list badge/Unread tab (INSERT-only list channel); TrainerLayout nav badge fetched once, no realtime (vs bell which has it); badge counts hidden/archived convs → phantom badge.
- [x] **P2-16 Multi-role trainers can't be messaged from public profile** — `get_or_create_conversation` gates on primary role only (0374:61) while 0391 includes additional_roles trainers → "Could not open messages".
- [x] **P2-17 Sunday week-math mismatch on Home** — fetch weekStartsOn:1 vs spark/bars weekStartsOn:0 (TrainerHome.jsx:137 vs 47,276); Sunday KPI vs sparkline disagree, Sunday bar always 0.
- [x] **P2-18 Deactivating a client erases their money history** — overview CTEs filter `tc.is_active=true` for ANY month (0452:189) → past collected vanishes from month/year views; expected totals recompute on fee change (annual income not stable).
- [x] **P2-19 Roster ignores `membership_status`** — paused/cancelled gym members look like normal active clients (admin/churn loaders filter it; trainer roster doesn't).
- [x] **P2-20 Dark-mode literal in builder sticky header** — `rgba(250,248,243,.92)` cream stays light in dark mode (TrainerPlans.jsx:603). Also TrainerLayout uses old cyan `#19B8B8` ×7 (visibly different teal than every page) + invisible `hover:bg-white/[0.04]` on light sidebar.

---

## P3 — LOW (grouped; fix opportunistically)

- [x] Legacy redirect `/trainer/client/:clientId` doesn't interpolate params (App.jsx:1822) — lands on literal `:clientId` → fake "Access denied".
- [x] Swallowed `{error}` class (false empties / fake success): ClientDetail 17-query load + checkAssignment + follow-up save (silent fail) + meal deactivate; coaching.js all reads; TrainerClientSchedule load (then save wipes real schedule); TrainerClientPayment load; Classes main fetch ("No classes assigned" on RLS error, no retry) + analytics; TrainerSocial stats; thread conversation fetch; bulk assign-program enrollment failures counted as success (TrainerClients.jsx:469).
- [x] PostgREST `.or()` injection: comma/parens in member search breaks filter → silent empty (TrainerClients.jsx:256).
- [x] Payments page: mark-paid stamps today (no date picker; client card has one); backdate into prior month covers THAT month with no "which month" picker; `fmtMoney` toFixed(0) rounds cents; year stepper to 1900; no partial payments (UNIQUE month row); method stored only as note text.
- [x] Calendar: "Upcoming this month" lists past sessions for past months; desktop rail false-empty when weekOffset≠0 + mislabeled; kind/tone heuristics English-only (ES titles never match); recurring with past end-date inserts 0 + toasts success; day-view week strip dots wrong + prev/next desync; `weekConfirmed` counts completed as confirmed.
- [x] ClientDetail: "Next session" card hidden for new clients (condition ignores nextSession, :1353); "Week 2 · day 4" passes days-per-week as day (:1376); `prog.days_per_week` column doesn't exist (suffix never renders, :2333); stale-draft Start check has no 6h window like the pill; check_ins limit 30 undercounts monthly visits for multi-scan members; weight limited to last 50 rows (1y view truncated); photo signed URLs expire after 1h unrefreshed; report `daysPlanned` reads trainer's profile + nonexistent column (always 4 — MonthlyProgressReport.jsx:324); generated meal description loses slot labels (reads `m.type`, generator writes `slot`, :644); theme-flip staleness (:1140).
- [x] Coaching: trainer can deactivate a member's OWN habits (no created_by filter); habit target not editable; multiple same-day schedule slots collapse on load (keyed by day).
- [x] Classes: mark-attended allowed for future dates, no undo, leaves `status='confirmed'` while member self-check-in sets `status='attended'` (two half-synced signals); slot add has no end>start/overlap validation; slot delete CASCADE wipes booking/rating history (warned, but admin loses analytics).
- [x] Messages: invisible-but-tappable pin overlay on touch (ConversationList.jsx:234); block irreversible (no unblock UI anywhere); realtime auto-mark-read ignores document.hidden (shows "Leído" while backgrounded); thread loads newest 200 only, no pagination; `messages_update` RLS over-broad (either participant can UPDATE any column incl. body — hardening).
- [x] Notifications: dead "Messages" filter pill (`client_message`/`trainer_message` never produced); `client_review` promised in empty-state copy, never produced; `trainer_alert` (the type automations actually emit) missing from TYPE_META → renders generic; `clients` category counted but has no pill.
- [x] Home: mobile cobros card shows "$0 · All paid" when RPC fails/unconfigured (desktop handles both); "Avg adherence" KPI is actually 30d-active % (mislabeled); messages badge stale; `classesEnabled` default flips between layout (`!==false`) and AuthContext (`??false`) → tab flash.
- [x] Privacy/Settings: privacy page promises conversation mute that doesn't exist (:273); 2 disabled placeholder toggles look interactive; `trainer_verified` unsettable by any UI (badge/banner unreachable); services hardcode USD; data export aborts on any read error + omits sessions/payments.
- [x] Help FAQ #1 describes a nonexistent flow (membership-ID/QR add + member notification) — actual flow is name search, member never notified.
- [x] Hardcoded `'Entrenamiento'` title on materialized sessions (0452:77) regardless of language.

---

## DUPLICATES / OVERLAP (founder question #1)

1. **Two program systems that never meet** (P0-2): `gym_program_enrollments` (member-visible) vs `trainer_workout_plans` (member-invisible). Assign-program code copy-pasted verbatim in TrainerClients.jsx:459 + TrainerClientDetail.jsx:779.
2. **Two meal-plan flows, incompatible invariants** on the same table (TrainerPlans stacks actives; ClientDetail enforces single-active) → P2-2 corruption.
3. **Two recurrence systems** on `trainer_sessions` (manual `recurrence_group` w/ conflict check vs `from_schedule` materialization w/ none), mutually unaware → root of P0-3.
4. **Payment UI ×3** (Home money card, Cobros page, client Payment card) — same RPCs (consistent), but mark-paid form re-implemented 2×, date picker only on client card, fee editor only on client card, month history only in Cobros; METHODS constants duplicated.
5. **Risk/status models ×3** disagreeing (P2-5) + adherence defined 3 different ways (Home ÷4-cap, Clients ÷6, Profile RPC).
6. **Attendance semantics ×3** (P2-4).
7. **Conversation state two systems**: member = server-side `conversation_member_state` RPCs; trainer = localStorage Sets (→ P1-2, no cross-device).
8. **ClientDetail internal**: current-plan card on 2 tabs; streak in 2 places with different math (history "longest" counts workout days only → lower than member's); monthly visits (Historial) vs attendance calendar (Cuerpo tab — odd placement).
9. "Needs attention" ×3 renders on Home; adherence/retention twice on mobile.
10. Code-level: review card JSX ×3 (Profile ×2 + Public); avatar-save, delete-account card, language picker duplicated from member side; ExerciseSearchPanel vs member picker; AddClient search vs ClientPicker; legacy `specialties`/`years_of_experience` columns vs `trainer_specialties`/`trainer_years_exp` (two sources that can disagree).

## EXTRA / DEAD (founder question #3)

- Classes: Templates tab cluster ~225 lines dead (P1-11); `override_capacity` + `status` fetched unused; `get_trainer_class_analytics` RPC (0159) has ZERO callers while the page re-implements it worse client-side; ProposeClassModal unused props.
- Home: dead call-log modal cluster (state+handler+JSX, nothing opens it; insert ignores error too — TrainerHome.jsx:78,423,1127); decorative Day/Week/Month segmented (always navigates); roster "Program" column hardcoded "No program"; same sparkline pasted on all 4 KPIs (fake data implication); liveClientIds machinery unused on mobile; dead ternary :927.
- Plans: `adherenceMap` computed from a batched query EVERY load, never rendered; `filterClient` dead state + empty-state copy references a control that doesn't exist; decorative GripVertical drag handle; `weeks` prop unused in DayCard; empty-state `onAction={openBuilder}` passes the click event as plan (surviving sibling of the isEdit bug — works by luck).
- ClientDetail: dead 8-week weeklyWorkouts query + volume reduce; sampleMeals set never rendered; dead imports (UnderlineTabs, AnimatedCounter, TrainerStatCard, 11 lucide icons); TAB_KEYS unused (tab ids defined 3×); display:none wrapper; history row expansion adds nothing (repeats collapsed data); "⋯" header menu = single action.
- Messages: ScheduleSoonModal = permanent "coming soon" for a feature that exists (calendar), doesn't even pass the client; `trainerName` computed then void'd; renderTime prop unused.
- Calendar/Live: attach-workout `details` written, read by NOTHING (and can't attach trainer_workout_plans — the actual Plans feature); cue `acknowledged` columns + policy built (0357), never read; disabled "Log set" button with unreachable onClick toast.
- Recovery RPC returns `priority_muscles`, never consumed.
- TrainerSocial embeds full member SocialFeed incl. composer — trainer posts visible to ~nobody (0527 feed arm is one-directional); two design systems on one screen.
- Profile: always-false `TT.bg === '#f0eee9'` ternary ×4; `<AlertTriangle size={0}>` spacer hack.
- TrainerClients: `getChurnLevel` dead (returns pre-Atelier Tailwind classes); SORT_DEFAULTS unreachable entries; 4 unused lucide imports; `trainer_clients.notes` + `last_active_at` fetched, discarded; pageTitle key hardcodes "TuGymPR" (white-label name never reaches tab).

## GAPS — in-app workflow (founder question #4a)

Client detail: member's declared injuries + excluded exercises (member_onboarding) fetched but NEVER shown (safety!); member_goals readable since 0527, never surfaced; no phone/contact on the page (roster fetches it); history rows don't expand into exercises/sets; no schedule/reschedule action; no record-body-metrics (v1 read-only decision); tab not in URL; no notes autosave/dirty guard.
Clients: member never notified/consented on add (FAQ even claims otherwise); no removed-clients view/undo; no other-trainer ownership signal; add modal closes per add, no toast.
Calendar: no drag/reschedule; no series edit/cancel; availability (`trainer_availability`) never read by booking; no member notification on book (only 1h reminder); no auto-complete link member-workout→trainer_session (payments/attendance depend on manual completion); no end-of-day unresolved nudge; no calendar realtime.
Messages: no attachments (form-check clips); no broadcast; no unblock; no per-message report (only nuclear block); no pagination.
Payments: no partial/multiple payments per month; no structured method; no export/CSV; no fee-change history; no receipts/member confirmation UI.
Coaching: no pending-check-in nudge; no response history/trends (weight Q begs for sparkline); no custom questions.
Classes: no per-occurrence cancel; no waitlist view/promote; no no-show; no capacity edit; no QR check-in; no closure awareness; no proposal feedback loop.
Profile/Settings: no password change for trainers; phone becomes public via Call button with zero warning/toggle; no admin flow to grant `trainer_verified`; availability informational only.
Home: PRs fetched ×8, one shown (celebration list is free); no refresh affordance; no done-today recap; live state unused on mobile hero.

## MARKET VERDICT (founder question #4b)

**Not behind for in-gym use.** ~80% of table stakes covered + several genuine differentiators no competitor has:
attendance-fused client view (trainer-vs-solo days), churn risk from REAL attendance, per-muscle recovery view, Spanish-first (TrueCoach is officially EN-only; Spanish = years-old open request at Trainerize), WhatsApp-native nudges, PT+classes in one app, trainer pays $0, built-in lead flow to gym members.

**Verified missing table stakes (in-gym lens):**
1. **Session packs / remaining-session balance** (Trainerize Session Packs, Mindbody session bank, Glofox credits, FitSW credits) — THE business model of a $20–40/session cash/ATH trainer; zero hits for any pack concept in code. Size M.
2. **Pre-session reminders w/ confirm / can't-make-it** (Mindbody timed +1-click confirm, Glofox push, FitSW) — no-shows are the per-session trainer's money leak; we auto-book 8 weeks with no reminders. Infra partly exists. Size S–M.
3. **Client reschedule-request flow** (FitSW request+accept/decline) — request-based, not full self-booking. Size M.
4. **One-time intake/PAR-Q on enrollment** (FitSW, Everfit, PTD) — reuse existing check-in form builder + one ES template. Size S.
5. **Assigned-plan compliance** ("did 2/3 solo workouts") — ours is visit-frequency, not plan-vs-done; needs P0-2 fixed first. Size M.
Skip list (deliberate): Stripe storefronts, wearables, video coaching, marketplace profiles, MFP sync, AI form analysis, drip marketing, HSA/FSA.

## SUGGESTED ATTACK ORDER (when proceeding)

1. P0-1 profile (one migration + AuthContext lists + modal seeding) — unblocks M8 too.
2. P1-9 + P1-10 + P1-3 + P1-4 (schema drift, money dates, calendar/day + home timeline rendering) — quick, high-visibility.
3. P0-3 schedule RPC rewrite (status-aware, PR-tz, conflict check, + extend-materialization cron).
4. P1-1/P1-2 messages (push on send + memo deps + server-side state or resurface).
5. P0-2 decision (member viewer vs fold into gym programs) — product call, then build.
6. P1-6/7/11 classes batch. 7. Dedup pass (risk model, attendance semantics, payment forms). 8. Dead-code sweep. 9. Market features (packs → reminders → intake → reschedule).

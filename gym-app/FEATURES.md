# TuGymPR — Feature Reference

> Full feature inventory across all permission levels, generated from a complete
> codebase scan on **2026-06-16**. This is a living reference — update it as
> features ship. Grounded in `src/pages/`, `src/layouts/`, `src/components/`, and
> `src/contexts/AuthContext.jsx`.

## Permission model

TuGymPR is a **multi-tenant, white-label SaaS** with **4 roles**, enforced both by
route guards (`src/App.jsx`) and database RLS:

| Role | Lives at | Layout | Who it's for |
|------|----------|--------|--------------|
| `member` | `/` (root pages) | `Navigation.jsx` | The gym-goer / end user |
| `trainer` | `/trainer/*` | `TrainerLayout.jsx` | Personal trainers / coaches |
| `admin` | `/admin/*` | `AdminLayout.jsx` | Gym owner / operator (single gym) |
| `super_admin` | `/platform/*` | `PlatformLayout.jsx` | Platform operator over ALL gyms |

Key facts:
- A single account can hold **multiple roles** (`profiles.additional_roles`) and
  hot-swap experiences via a **View Switcher** modal. `activeView` is a UI hint;
  RLS still enforces real permissions server-side.
- Roles are **never trusted from cache** — `role` / `additional_roles` are stripped
  from the cached profile and re-fetched on every app start.
- Route guards: `ProtectedRoute` (member), `TrainerRoute`, `AdminRoute`,
  `PlatformRoute` (super_admin only). A live **role-demotion detector** boots a
  user out of an elevated view if their role changes mid-session.
- Nearly every privileged action writes to an **audit log** (`logAdminAction`).
- The app is **bilingual EN/ES** throughout, **white-label** themed per gym, with
  **AI features separately consent-gated** and behind a platform kill switch.

---

## Table of contents

1. [Member](#1-member--the-gym-goer)
2. [Trainer](#2-trainer--the-coach)
3. [Admin](#3-admin--the-gym-owneroperator-single-gym)
4. [Super Admin](#4-super-admin--the-platform-operator-all-gyms)
5. [Cross-cutting systems](#5-cross-cutting-systems)

---

## 1. MEMBER — the gym-goer

Pages live directly in `src/pages/`; nav in `src/components/Navigation.jsx`.

### Auth & Onboarding
- Email/password login with show/hide, forgot-password email flow, **plus a
  "6-digit reset code" path** for members with no email access (front-desk issued).
- Signup via invite link / gym code / open registration, with PR-style name split
  (first / middle / 2 apellidos), DOB age-gating (under-13 blocked unless invited).
- **13-step resumable onboarding wizard** (language, fitness level, goal, equipment,
  schedule, data/AI consent, health sync, body stats, phone, social, program,
  nutrition) with a "Salir/Exit" hatch that signs out without losing the account.

### Workouts & Training
- **Routines** + multi-week **Programs** — enroll in gym programs or browse a
  template catalog (4–16 weeks), with week navigation, A/B variant rotation, and
  dismissible adaptation suggestions (deload / increase / underperforming exercise).
- **AI workout generator** (type, training days, duration, intensity, priority
  muscles, cardio focus) with goal + somatotype awareness and a "start today / on
  my days" toggle.
- **Workout of the Day** — adaptive AI-generated daily workout, regenerate, one-tap start.
- Manual **Workout Builder** and a member **Program Builder** (build multi-day
  programs by hand) with grip drag-to-reorder, supersets/circuits, sets/reps/rest steppers.
- **QuickStart** launcher — today's routine, resume mid-workout, warm-up toggle,
  start-empty-workout, inline cardio entry; stays in sync with the dashboard.

### Active Session (live tracker)
- Suggested weight/reps (progressive-overload engine), previous-set display,
  RPE (1–10) capture, per-set notes.
- **PR detection with full-screen confetti**, auto rest timer (skip/adjust),
  **barbell plate calculator**, warm-up + cool-down stretch phases.
- On-the-fly supersets/circuits, exercise swap/substitution, add-exercise
  mid-session, inline video demos, in-session cardio mini-tracker.
- Draft persistence (localStorage + DB) with conflict detection, wrong-day warning,
  **bidirectional Apple Watch sync**, iOS Live Activity.

### Progress & Tracking
- **Session summary** — duration, volume + delta vs last session, PRs (each with a
  share circle), XP/level, challenge score updates, achievement auto-unlock, health sync write.
- **Goals** — 6 types (1RM lift, body weight, body fat, workout count, streak,
  volume) with realistic-date validation, progress bars, completion confetti; feed
  the overload engine + generator.
- **Coaching insights** — volume trend, push/pull/leg imbalance detection, frequency advice.
- **Body tracking** — weight + 8 measurements with goal-aware color logic,
  **progress photos** (camera, angle/date timeline), **AI body-fat photo analysis** (consent-gated).
- **Personal Records** (per-exercise 1RM-over-time charts), **Strength Standards**
  (5 lifts, bodyweight-normalized tiers Beginner→Elite), monthly-grouped **workout log**.

### Cardio
- Strava-style tracker (~21 activity types; Running/Walking/Cycling/Hiking/Skiing
  GPS-tracked, rest timer-only): live splits, pace, elevation, calories, manual
  distance entry, offline queueing, share-this-run.
- **Cardio session detail** — read-only review with route map, stats, splits, re-share.

### Nutrition
- Macro rings + auto-calculated targets from goal/pace/activity.
- Food logging via debounced search / **barcode scanner** / **AI food-photo scan** /
  **AI menu scan** / manual entry, with Nutri-Score badges + AI disclaimers.
- 300+ curated recipes with thumbs up/down affinity learning, bookmarks, add-to-grocery.
- **Weekly meal planner** — generate/regenerate day or week, slot-aware
  (breakfast/lunch/snack/dinner), no-repeat, with allergy/diet/avoid **preferences
  hard-fed to the generator**.
- Grocery list grouped by meal/category; trainer-assigned meal plans surfaced.

### Social & Community
- **Social feed** — friend activity (workouts, PRs, achievements, check-ins, posts)
  + your own paginated "My Posts"; relevance-scored.
- Create posts (text + photo + workout tag), emoji reactions + like, comment threads
  with **@mentions**, report/hide/mute/block, server-side slur moderation on insert.
- **Friends** (add by link/search, accept/reject), encrypted **direct messages**
  with read receipts, **Gym Pulse** (who's active/checked-in right now).

### Gamification & Rewards
- **Leaderboards** — 7 categories (volume, workouts, most-improved, consistency,
  streak, PRs, check-ins) with time filters.
- **Challenges** — consistency/volume/PR-count/specific-lift/**team**, real-time
  leaderboard, countdown, reward tiers (points + custom prizes), join/leave, friend
  + team invites, DNF roster after end.
- **Achievements** — 30+ shareable badges with progress bars.
- **Rewards** — points balance + tier badge (Bronze→Diamond), catalog with redeem →
  re-signing QR for staff, points history, **Apple/Google Wallet** passes.
- **Referrals** — auto-generated code + QR + native share, history with real
  referred-friend names, gym-configured rewards.

### Gym & Check-in
- **QR check-in** (gated by platform `feature_qr` kill switch) with streak counter +
  date-grouped history.
- **My Gym** — hours, holidays/closures, announcements, upcoming classes, trainers.
- **Classes** (gated on `classes_enabled`) — book/cancel/check-in, waitlist with
  position, recurring booking, class check-in → workout-template launch, post-class
  1–5 star rating.
- **Public trainer profiles** — bio, reviews, contact via message/SMS/WhatsApp,
  leave a review; **"My Trainer" card** on dashboard/profile.

### Dashboard & Profile
- **Dashboard** — hero workout card, day strip, QR + messages shortcuts, gym news,
  challenge of the day, recent workouts/cardio, My Plan sheet, **backdated workout**
  (anti-cheat: logs but doesn't touch streak), deleted-workout recovery, readiness +
  wellness check-in modals, NPS survey, birthday greeting.
- **Profile/Settings** — achievements hub, goals, personal info, language,
  leaderboard visibility, **device-permission panel**, **AI consent management**
  (body/food/menu separately), blocked users, **data export (CSV)**, account
  deletion, granular notification prefs (transactional vs promotional), health sync
  (Apple Health / Health Connect), in-app support/FAQ.

### Sharing
- 7+ card templates (editorial, sport, poster, photo, **transparent sticker**,
  body-comp, cardio), Instagram Stories integration, format toggle (story/square/portrait),
  monthly "Wrapped"-style recap, embedded fonts for SVG-as-image export.

---

## 2. TRAINER — the coach

Pages in `src/pages/trainer/`; layout `src/layouts/TrainerLayout.jsx` (fixed teal/cream
"TT" theme, dark/light aware). Nav: Home, Clients, Calendar, Plans, Payments, Classes
(gated), Messages, Social, Notifications, Profile.

### Clients & Roster
- Assigned-client roster (`trainer_clients`) with status filter chips (all / on-track
  / at-risk / churn / new / no-plan / on-program / **removed**), search, sort.
- **Add client** (search gym members, warns if already coached by another trainer).
- **Bulk select** → assign program to N clients, compose/message-all.
- Per-client quick actions: Message (DM), **WhatsApp**, remove, block, restore.

### Client Detail (5 tabs)
- **Overview** — check-in reference photo, inline payment + weekly-schedule tools,
  next session (→ live), current plan progress, recent PRs, client goals (read-only), pinned notes.
- **Program & Nutrition** — assign/remove gym program (week-by-week viewer),
  auto-generate/assign meal plans (macro targets + auto-calc), **edit the client's
  own nutrition preferences** (writes `member_onboarding`), 7-day food-log compliance.
- **Body (read-only — RLS-gated)** — recovery panel + muscle-map figure, attendance
  calendar (with-you vs alone), weight/composition/measurements/photos, all view-only.
- **Notes & Follow-up** — coach notes (5k char), injuries/limitations (surfaces
  member-declared injuries + excluded exercises), follow-up log (method + outcome).
- **History** — current/longest streak, monthly visits, volume trend, PR timeline.

### Workout Plan Builder
- List with client + status filters and drafts; **fast-track templates** (PPL,
  Upper/Lower, Bootcamp, Beginner Foundations); duplicate plan; toggle active.
- Full-screen builder: assign to a client OR leave generic; multi-week (presets +
  custom); **auto-generate from the client's onboarding + goals** (reuses the member
  `generateProgram` engine, strips "Auto:" naming); exercise picker with filters;
  per-exercise steppers; supersets; **drag-reorder**; copy day→day / week→week; drafts vs publish.

### Nutrition / Meal Plans
- Create/assign multi-week meal plans — client selection, macro targets, duration,
  start date, **editable client food preferences** seeded from saved prefs;
  auto-generate from goals; per-meal swap/remove/regenerate; "macros fit" validation; detail viewer.

### Live Sessions
- The **member physically trains** while the trainer spectates + coaches in real time
  (realtime channel + `trainer_send_cue` RPC).
- Coach cues pushed into the member's active workout: suggest a set (weight/reps/RPE),
  typed note, **drop set, rest +30/+60s, reduce weight 10%**, with sent/seen delivery status.

### Scheduling & Calendar
- Month/week/day views; session create/edit (client, time, duration, status,
  send-reminder, **recurring weekly**); auto-classified session kinds; server-side
  reminders ~1h before; per-client recurring schedule auto-books 8 weeks.

### Payments & Packages (manual — no billing engine)
- Per-client monthly fee OR per-session pricing; mark paid/unpaid; payment history;
  **session packs** (track used/remaining); in-app + WhatsApp payment reminders;
  fleet view with All/Pending/Paid/Packs tabs, totals, **CSV export**.

### Classes (gated on `classesEnabled`)
- Manage assigned class slots, attach/change workout templates, **propose new classes**
  to the gym (admin approval), mark attendance, promote from waitlist, per-class
  analytics (attendance rate, ratings, individual workout results).

### Messaging
- Encrypted DMs (iMessage-style, read receipts) with in-thread quick actions:
  **schedule session**, **share a workout day card**; block/delete; new-message picker.

### Social
- Engagement hero + reactions/comments stats; embeds the member feed (read/react/comment)
  but **composer hidden** — trainer posts aren't broadcast.

### Public Profile & Directory
- Editable directory listing (`/t/:id` share link, preview at `/trainers/:id`): cover
  (upload/preset), avatar, **admin-set verified badge**, tagline, location, public
  phone (renders a Call button to members), bio, years experience, pronouns.
- Tabs: **Services & rates** (full CRUD + "popular" flag), About (bio/specialties/
  credentials), **Reviews** (member ratings), **Schedule** (per-day availability hours).
- **Directory-visibility** toggle (private-view banner when off).

### Notifications & Settings
- Notifications inbox (filter, mark-all-read, clear).
- Settings — view switcher (multi-role), notification settings, **automations**
  (inactivity / missed-checkin nudge rules fired by daily cron), privacy (directory/
  photo visibility, blocked users, JSON export), in-app password change, language,
  help/FAQ, account deletion.

> **Note:** Trainers **cannot edit client body metrics** — that side is RLS read-only.
> The only client data a trainer writes is nutrition preferences, notes, and injuries.

---

## 3. ADMIN — the gym owner/operator (single gym)

Pages in `src/pages/admin/` (38 pages) + `src/pages/admin/components/`; layout
`src/layouts/AdminLayout.jsx`. Everything is scoped to one `gym_id` via multi-tenant RLS.

### Command Center (Overview)
- Daily retention KPI strip (active rate, total members, cards-to-deliver, active
  challenges) each with benchmark tooltips; retention-health panel; 10-week growth
  chart; "morning queue" action list; needs-attention chores; recent-activity feed;
  inline password-reset approvals; at-risk watchlist modal.

### Member Management
- Roster (3 tabs: Members / Invites / Resets) with debounced search, filters
  (active/frozen/unonboarded), column sort, numbered pagination, summary stat cards.
- **Bulk actions** — message, freeze/unfreeze, export selected (CSV); partial-success toasts.
- **Member detail drawer** (5 tabs): edit profile (split name), **membership
  lifecycle** state machine (active → frozen/deactivated/cancelled/banned/reactivate
  with reason + exit survey), generate password reset codes, external-system ID
  bridge (`qr_external_id`), private admin notes, per-member data export + account deletion.
- Invites (link/code/QR, revoke, expiry), manual member creation, exports (members,
  workout history, PRs, body metrics).

### Churn Intelligence & Win-Back (the retention engine)
- v3 churn scoring (nightly `compute-churn-scores` precompute or live recompute),
  4 tabs (Retention / Churned / Win-Back / Campaigns).
- "Today's priority action" banner, critical/high/contacted/returned KPIs, queue with
  weighted risk signals + trend arrows, sticky member detail panel.
- **ContactPanel** — 4-channel outreach: in-app DM (encrypted + push), email, SMS,
  WhatsApp. On a phone, **SMS/WhatsApp hand off to the admin's own device** (zero gym
  credits); web path uses the paid SMS API with a monthly usage cap. Attach a gifted reward.
- **Win-back** attempts tracking with effectiveness %, channel attribution, attempts
  history with outcome editing; **A/B campaigns** with live variant stats + winner detection.
- **Vacation hold** (30-day churn-alert pause) to suppress recency-decay false positives.
- Bulk: message selected, win-back selected, add-to-challenge, mark contacted; CSV export.

### Segmentation
- 12 pre-built templates + custom behavioral builder (last-workout-days, count, streak,
  churn tier, fitness level, join date); pin/edit/delete; message-all (batched); CSV
  export; feeds Outreach as an audience.

### Outreach (unified composer)
- Audience picker (everyone / churn tier / segment / specific members / not-onboarded
  / birthdays-this-week) × channels (push / in-app / email / SMS, any combo).
- `{{first_name}}` / `{{name}}` merge tokens, template starters, or a **rich designer
  email** (editorial HTML with brand colors/logo, iframe live preview, self-test send).
- Live recipient resolution + preview before sending; real per-channel delivery
  outcome reporting; recent sends + full history (reconstructed from audit log).

### Messaging & Engagement
- Encrypted **DM inbox** with members.
- **Announcements** — 4 types (news/event/challenge/maintenance), scheduled + recurring
  (daily/weekly/biweekly/monthly), push broadcast honoring per-type opt-outs.
- **Email template designer** (designs gallery + per-gym saved templates + prebuilt catalog).
- **Message templates** — per-gym overrides of platform lifecycle + win-back templates,
  where "disable" is an explicit opt-out that skips the send.
- **A/B testing** with "ship winner" → routes winning copy to Outreach pre-targeted.

### Content Moderation
- 3 tabs (Reports / Posts / Comments); soft-delete + restore (reversible); auto-flagged
  badge (pre-publication wordlist); honest handling of encrypted DM reports.

### Intelligence & Analytics
- **NPS surveys** — send to all members, score gauge (−100..+100), response rate,
  distribution, feedback highlights, multiple surveys (one active), reactivate/delete.
- **Attendance analytics** — KPI cards with half-period deltas, daily activity chart,
  **peak-hours heatmap**, CSV export.
- **Analytics dashboards** — editable KPI targets with **AI-suggested realistic goals**,
  growth/retention charts, onboarding funnel, exit-reason breakdown, cohort retention,
  trainer performance, monthly summary.
- **Reports** — 8 CSV export types (members, body metrics, workouts, PRs, attendance,
  challenges, class bookings, purchases) with export history.
- **Audit log** — server-paginated view of ~90 action types with filters, color-coded
  badges, sanitized + humanized CSV export.

### Trainers (CRM)
- Roster with client count, **retention %**, activity sparkline + trend, at-risk client
  count; assign/unassign clients; promote member→trainer; demote (atomic RPC); message; CSV.

### Operations & Content
- **Classes** (gated) — CRUD with bilingual **DeepL auto-translate**, multi-instructor,
  capacity, cover images, recurring slots with conflict detection, class routine authoring,
  bookings roster + per-class analytics.
- **Programs** — multi-week builder (week→day→exercise, supersets, copy week/day),
  publish/draft, AI monthly suggestions, enrolled-member view.
- **Challenges** — create (5 types) with gradient covers + reward tiers, live leaderboard,
  award prizes.

### Gamification & Commerce
- **Leaderboard** — 6 metrics, period/tier filters, medal tokens, CSV export.
- **TV Display** — 8-char connection code + QR, 4 brand-tinted themes pushed live within
  ~30s, multi-TV URL patterns (track/lang), per-screen session tracking with surgical
  revoke, leaked-code rotation kill-switch; drives the public no-auth `/tv` page with
  challenge join-QRs.
- **Rewards** — catalog (9 types, custom symbols, featured, deactivate), redemption log,
  birthday-reward automation.
- **Store/products** — 6 categories, points-per-purchase, **punch-card mode** (free item
  every X), purchase history; sold via the QR scan pipeline.
- **Revenue** — sales, points economy + **outstanding points liability**, point-flow chart,
  top products, punch-card usage.
- **Referrals** — program config (rewards, approval mode, monthly cap), approval queue,
  activity + top-referrer leaderboard, CSV export.

### Print / Retention Cards
- Handwritten physical cards auto-generated daily for welcomes/milestones/tenure/
  returning/birthdays.
- **Predictive** ("in 3 workouts" / "Thursday" from check-in + workout history),
  print-early, sorted by expected next-visit date, **flag members physically present
  right now**, surfaced at the check-in scanner for instant hand-over with accountable
  ("who delivered + note") tracking. 3 status tabs (To print / To deliver / Delivered),
  per-card + bulk print-format selector, attach reward.
- Platform-fulfilled central-printing path with delivery-date banners.

### QR Check-In / Scan Pipeline
- Hardware barcode scanner (`ScanFeedback`) with approval gating + **face-photo
  matching**, audio feedback, punch-card progress, cards-at-checkin, duplicate-today guard.
- **External integration bridges** — cloud (Mindbody/ClubReady webhook) + local sidecar
  for legacy gym software.

### Settings & White-Label
- **Branding** — welcome message, logo, **launch logo** (splash) + **launch video**
  (≤4.2s vertical), primary/accent colors with **WCAG contrast analysis + auto-harmonize**,
  10 preset palettes.
- **Hours** — per-day open/close + **holiday closures** (streak-protected for members).
- **Registration** — mode (invite-only / gym-code / both), class-booking toggle,
  birthday rewards.
- **Gym info**, **card-engine tuning** (habit window/target, occasion toggles + default
  rewards), **email digest scheduler** (frequency, sections, preview).
- **Admin profile** — avatar, password change, recent activity, account management.
- **Onboarding wizard** (7-step first-run setup), **22-stop guided tour** (spotlight,
  DB-backed "seen" persistence), **Cmd-K global search**.

---

## 4. SUPER ADMIN — the platform operator (all gyms)

Pages in `src/pages/platform/` (+ `gym-detail/`, `components/`); layout
`src/layouts/PlatformLayout.jsx` (fixed dark theme, gold accent, 30-min inactivity
auto-sign-out). **[FLEET]** = cross-gym · **[GYM]** = scoped to one gym.

### Fleet Overview `[FLEET]`
- Every gym with server-aggregated real stats (members excluding ghosts/staff,
  completed-only 30d sessions); KPI strip (total/active/inactive/members/new/struggling);
  search/filter/sort; health-tier + plan badges.
- **Bulk fleet actions** (multi-select, single round-trip + audit): set feature
  entitlements, set plan, activate, **deactivate** (typed-count confirm; warns members
  booted immediately).

### Gym Create / Onboarding `[FLEET→GYM]`
- Create gym via `platform_create_gym` RPC (name, auto-slug, owner email, tier) with
  auto-generated owner invite code.
- **CSV bulk member import** (upload → preview → result), past-batch tracking,
  **rollback** unclaimed members, download codes sheet for the front desk.

### Single Gym Hub `[GYM]` (6 tabs)
- Header: plan/tier dropdown, pause/reactivate, **Impersonate ("View as admin")**,
  + Import CSV / Diagnostic / Data & costs tools.
- **Overview** — identity, owner/staff counts, activity snapshot, **owner contact
  (mailto / tel / WhatsApp)**, SMS usage.
- **Wellness** — composite health score + 6 admin-parity KPIs.
- **People** — members (change role/status, delete, add member), staff, invites.
- **Activity** — 30-day check-in + workout trends.
- **Content** — full CRUD on this gym's challenges / programs / achievements / rewards.
- **Settings** — branding (**custom app name + logo push**), **plan & billing records**
  (price/seats/trial), **per-gym feature entitlements**, QR check-in config, multi-admin,
  SMS phone number, set owner, deactivate.
- Full admin-parity member detail via `PlatformMemberDetail`.

### Gym Data & Costs `[GYM]`
- Full **JSON data export** (`super_admin_export_gym_data`).
- **Two-track deletion**: scheduled-with-grace (default 90d, cancel/restore) OR
  **hard-delete-now** (slug-typed confirm, wipes profiles/sessions/storage/shadow auth users).
- **Per-gym cost estimate** ($/month: DB / storage / egress / MAU).

### Support Console `[FLEET]`
- Cross-gym omnibox (members / gyms / invites / email lookup).
- Per-member actions: change role/status, reset password, **move member to another gym**
  (atomic cross-tenant transfer), **DSAR export (JSON)**, deactivate, delete — all
  blocked on super_admin rows.

### Operations `[FLEET]`
- Live service-health probes (API/DB, Auth, Storage, Edge functions, Realtime) with latency.
- Incident detection from error logs with **blast radius** (affected gyms + features).
- **Global feature kill switches** (referrals/classes/social/messaging/qr/challenges/
  nutrition/**ai**) — "off everywhere wins" over per-gym entitlements; AI gates paid spend.
- **Maintenance mode** (locks out all users via MaintenanceGate).

### Intelligence `[FLEET]`
- **Attention** — daily triage board turning retention signals into per-gym
  "problem → the fix," worst-first (incl. admin-never-logged-in, technical errors).
- **Platform Analytics** — MRR/ARR, **fleet costs & margin** (SMS spend), member growth,
  revenue-by-gym, cross-gym churn patterns, comparison table + CSV.
- **Gym Health** — health-tier distribution, **"gyms going quiet" watchlist**,
  **admin-presence awareness**.
- **Feature Adoption** — cross-gym heatmap of 12 features.

### Cross-gym tooling `[FLEET]`
- **Card Queue** — print/deliver celebration cards across gyms with reward QR attachment,
  delivery-date freezing + admin notification.
- **Custom Meals moderation** — delete user-submitted dishes.
- **Audit Log** — cross-gym, huge action vocabulary, per-gym filter, CSV export.
- **Error Logs** — react-crash/auth/slow-API with device info, mark-resolved.
- **Platform Notifications** — super-admin alert inbox; react-crash alerts land here.

### Platform Settings `[FLEET]` (5 tabs)
- **Content** — global exercise library (CRUD + video + **CSV bulk import**), global
  achievement definitions, global program templates.
- **Defaults** — default new-gym config seeded by `platform_create_gym`.
- **System** — **app version gate** (min-required + latest, iOS/Android store URLs to
  force updates).
- **Comms** + **Health** — email config info + real system probes.

### Most powerful capabilities
1. **Impersonation** — one click into any gym's full admin dashboard (`AuthContext`
   gym-context override + AdminLayout "Viewing as admin" exit banner).
2. **Move member between gyms** — atomic cross-tenant transfer.
3. **Two-track gym deletion** including hard-delete with storage wipe.
4. **Global kill switches + maintenance mode** — fleet-wide control (incl. cutting AI spend).
5. **White-label push** — set any gym's colors / app name / logo remotely.
6. **Full DSAR tooling** — per-member and per-gym data export + right-to-erasure.
7. **Cross-gym content authority** — CRUD on any gym's challenges/programs/achievements/
   rewards + global libraries.

---

## 5. Cross-cutting systems

These span multiple roles:

- **Multi-role view switching** — `AuthContext` exposes `availableRoles` + `activeView`;
  a `ViewSwitcherModal` lets a multi-role account flip between member/trainer/admin/
  super-admin experiences. RLS enforces real permissions regardless of view.
- **Audit logging** — `logAdminAction(...)` writes to `admin_audit_log` from nearly
  every privileged mutation; surfaced in both the admin and platform (cross-gym) audit logs.
- **AI features** — body-fat photo analysis, food-photo scan, menu scan, workout/program
  generation, meal planning. Each user-facing AI feature is **separately consent-gated**;
  all sit behind the platform `feature_ai` kill switch (paid OpenAI spend).
- **SMS / WhatsApp** — on native devices, both **hand off to the staff member's own
  device app** (zero platform credits); only the web path uses the paid SMS API, which
  has a per-gym monthly cap.
- **White-label theming** — per-gym branding (colors, logo, custom app name, launch
  splash/video) injected via CSS variables (`applyBranding`), with WCAG contrast guards.
- **Bilingual EN/ES** — full i18n throughout, with DeepL auto-translation on admin
  content creation (classes, rewards, programs, challenges).
- **Health integration** — Apple HealthKit (iOS) + Health Connect (Android), with an
  explainer modal before the OS permission prompt.
- **Apple Watch app** — companion app with reps/QR/friends/start-flow/GPS-cardio and
  bidirectional active-session sync.
- **Error recovery** — themed/bilingual ErrorBoundary that navigates back to the last-good
  page; React crashes notify super-admins.

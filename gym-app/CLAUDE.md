# TuGymPR — Project Reference

## What This App Is

A **white-label B2B SaaS churn reduction platform** sold to gyms. Each gym gets a fully branded version of the app (their colors, logo, name) that their members use to track workouts, compete socially, and stay accountable. The gym owner gets an admin dashboard with member analytics, attendance data, challenge management, churn prediction, and class management tools.

**Core value proposition**:
- **For members**: An intelligent workout tracker that automatically drives progressive overload based on their current level and goals, with social, competitive, and nutritional hooks that keep them coming back.
- **For gym owners**: A retention tool that reduces churn, increases member engagement, and gives them real visibility into member activity — all under their own brand.
- **For trainers**: Client management, program assignment, class analytics with individual workout results, and scheduling tools.

---

## Business Model

- **B2B SaaS** — gyms pay a recurring subscription (per member or tiered flat rate)
- **White-label** — each gym instance is customized with their branding (colors, logo, name, palette)
- **Gym handles member acquisition** — the platform rides on existing gym membership
- **No billing by design** — gym handles payments externally, app focuses purely on engagement/retention
- **Upsell**: Personal trainer tier — trainers can assign programs, manage classes, and track clients inside the app

---

## Full Product Scope

### Member-Facing App (25+ pages)

#### 1. Onboarding Flow (9 steps)
- Invite code (optional, validated via RPC)
- Language selection (EN/ES, changes UI mid-flow)
- Fitness level (beginner / intermediate / advanced)
- Primary goal (muscle gain / fat loss / strength / endurance / general fitness)
- Training schedule (days per week with day selection)
- Available equipment (Barbell, Dumbbell, Cable, Machine, Bands, Cardio, Bodyweight)
- Injuries or limitations (exercises to exclude or auto-substitute)
- Health sync (Apple Health / Google Fit permissions)
- Body metrics (weight, height, age, sex — seeds overload engine + macro calculator)
- **Onboarding analytics** — step-by-step completion tracking via PostHog + profiles.onboarding_step column, admin funnel with drop-off percentages

#### 2. Progressive Overload Engine (Core Differentiator)
- Automatically calculates what weight/reps to target each session based on:
  - User's logged history
  - Current 1RM estimates (Epley formula for ≤12 reps, Brzycki for >12)
  - Goal (hypertrophy vs strength vs endurance)
  - Training frequency and recovery
  - **Active member goals** (prioritizes exercises linked to specific targets)
- Uses double progression (reps first, then weight)
- Goal-based rep ranges: muscle gain 8-12, strength 3-6, fat loss 12-15, endurance 15-20, general 10-12
- Fitness-level-based increments: beginner +5lb compound/+2.5lb isolation, advanced +2.5lb/+1.25lb
- Accounts for deload weeks (every 4-6 weeks of accumulated load)
- Adjusts after missed workouts
- Flags injury-excluded exercises and auto-substitutes alternatives
- Shows "suggested" weight/reps chip during active session

#### 3. Workout Tracking (ActiveSession)
- Fullscreen immersive workout tracker
- Suggested weight/reps shown per set (from overload engine)
- Set logging: previous 3 sets shown, weight + reps input, quick-rep buttons (6/8/10/12/15)
- RPE (1-10) capture with color-coded selector + set notes
- Auto rest timer after set completion (configurable per exercise)
- Elapsed session timer (stopwatch)
- PR detection with fullscreen celebration toast + confetti
- Exercise navigation (prev/next arrows, dot navigation)
- Draft session persistence (localStorage + session_drafts DB table)
- Conflict detection (warns about other active drafts)
- Wrong-day detection (warns if routine scheduled for different day)
- Exercise video demos inline (Supabase storage)
- ExerciseProgressChart with 1RM trend + 4-week linear regression projection
- Superset/circuit support
- **Class workout linking** — logs from class context feed into PRs/overload/XP
- Error boundary with fallback UI
- **iOS Dynamic Island / Live Activity** — workout progress on lock screen (elapsed time, sets, rest countdown)
- **Apple Watch sync** — bidirectional WCSession messaging for real-time workout state
- **Persistent notification** — lock screen notification with set progress (updated every 60s)

#### 4. Session Summary
- Post-workout celebration screen with confetti on PRs
- Stats: duration, total volume, sets completed, heart rate (from Watch)
- PRs highlighted with trophy badges
- XP earned + level progression display
- Challenge score updates
- Program adaptation analysis (analyzeAndAdapt)
- Health sync to Apple Health / Health Connect
- Share button with pre-filled social text

#### 5. Auto Workout Generator
- Somatotype-based programming (ectomorph/mesomorph/endomorph from BMI)
- A/B split rotation for variety
- 6-week periodized programs
- Exercise tiering: primary/secondary/isolation per muscle
- Split selection based on training frequency: full body (≤2), PPL (3), upper/lower (4), PPL extended (5+)
- Cardio prescription based on goal
- **Goal-aware generation** — prioritizes exercises linked to active member goals (+1 set, boosted muscle group scores)
- Workout of the Day — AI-generated daily suggestion with per-exercise reasoning

#### 6. Exercise Library (144 exercises with videos)
- 144 exercises with video demonstrations (stored in Supabase storage)
- Filter by muscle group (Chest, Back, Shoulders, Legs, Arms, Core) and equipment
- Filter button with dropdown (muscle group + equipment pills)
- Search by name with debounced input
- Expandable cards with: instructions, video demo, BodyDiagram showing muscles worked
- Custom exercise creation and editing
- Friends' exercises access via friendships
- Exercise favorites system
- Fully localized (exercise names in Spanish)

#### 7. Workout Builder
- Create and edit custom routines
- Add exercises from library (3 tabs: Library / Mine / Friends)
- Configure sets / reps / rest per exercise
- Drag reorder exercises
- Estimated duration calculator (reps × 7s + setup time + rest per set)
- Auto-save with dirty state detection
- Custom exercise creation inline

#### 8. Goal Setting
- 6 goal types: lift 1RM, body weight, body fat, workout count, streak, volume
- Realistic date validation based on scientific progression rates (beginner/intermediate/advanced)
- Auto-fetches current 1RM for lift goals
- 2-column compact card layout with progress bars
- Detail/edit modal with delete option
- Goals influence workout generation and progressive overload suggestions
- Celebration confetti on goal completion

#### 9. Body Metrics & Progress Tracking
- Weight tracking with trend charts (AreaChart, 30/90/180/365 day periods)
- Body measurements: chest, waist, hips, arms, thighs, body fat %
- **Progress photos** — camera capture, Supabase storage, timeline view with month/date grouping, signed URLs
- **AI body composition analysis** — OpenAI Vision via analyze-body-photo edge function for body fat estimation
- Personal info editing (sex, age, height)
- Goal-aware progress visualization (colors adapt based on whether user wants to gain or lose)

#### 10. 1RM Tracker & Strength Standards
- Track estimated 1RM per exercise over time (LineChart)
- 5 key lifts: Bench Press, Back Squat, Deadlift, Overhead Press, Barbell Row
- Strength tiers: Beginner → Novice → Intermediate → Advanced → Elite (bodyweight-normalized)
- "Lbs to next tier" display with progress bars
- PR history chart per exercise with max-per-day deduplication
- Filter button with muscle group + equipment dropdown
- Fully localized tier labels

#### 11. Attendance / Check-In
- QR code display for admin scanning (HMAC-SHA256 signed payloads)
- GPS-based auto check-in when near gym
- Manual check-in button
- Check-in history grouped by date with method indicator (QR/GPS/Manual)
- Streak counter with streak freeze mechanic (1 per calendar month, DB-backed)
- Gym closure awareness (streak protected on closed days)
- Rest day awareness (streak protected on non-training days)

#### 12. Social Features
- Friend system (add friends, friend requests, accept/reject)
- Activity feed via RPC (get_friend_feed with pagination)
- Feed content: workouts completed, PRs hit, achievements unlocked, check-ins, user posts
- Heart likes (tap to toggle)
- Comment threads on activities with @mentions
- **Create posts** — text + photo + workout tagging
- Friend streaks display (via get_friend_streaks RPC, tappable for profile preview)
- Content reporting with flag/unflag (DB-backed, persists across sessions)
- Privacy controls (friend-only vs gym-visible)
- **Live Training Indicator** — pulsing avatar stack showing friends currently working out
- **Profile preview** on tap — stats, goals, achievements, fitness level, avatar (via get_profile_preview RPC)

#### 13. Direct Messaging
- **Encrypted DMs** — AES-256-GCM encryption via Web Crypto API (messages stored as ciphertext in DB)
- iMessage-style chat UI (bubbles with tails, timestamps on 5+ min gaps, no per-message avatars)
- Read receipts ("Leído"/"Enviado") with real-time updates via postgres_changes
- Friends-only messaging restriction (can only start conversations with accepted friends)
- Admin/trainer messages receivable and respondable
- **Keyboard-aware input** — Capacitor Keyboard plugin events move input above keyboard
- New message picker with friend search
- Conversation list with unread badges, last message preview, timestamps
- Optimistic send (message appears instantly)
- Access from: Dashboard (messages shortcut), Profile Preview ("Message" button)

#### 14. Class Booking
- Day strip schedule view with image-based class cards
- Capacity bar showing booked/total spots
- **Waitlist** — when class is full, join waitlist with position tracking. When someone cancels, next waitlisted person auto-promoted + notified
- **Recurring bookings** — "Repeat weekly" toggle auto-reserves the slot each week
- Book / Cancel / Check-In button states
- **Check-in flow with workout linking** — if class has a workout template, prompts to start tracking via ActiveSession
- Post-class 1-5 star rating + notes
- Class workouts feed into PR tracking, overload engine, XP, achievements
- "Upcoming Classes" section in My Gym page (conditionally shown when gym has classes enabled)
- Cancel booking uses RPC with automatic waitlist promotion

#### 15. Challenges
- Live / Upcoming / Ended tabs
- Types: Consistency, Volume, PR Count, Specific Lift, Team
- Real-time leaderboard with Supabase postgres_changes subscription
- Countdown timer with Framer Motion
- Participant list with names fetched from Supabase
- Join/leave actions
- Medal rankings (🥇🥈🥉)
- Reward tiers per challenge

#### 16. Leaderboards
- 7 categories via RPCs: Volume, Workouts, Most Improved, Consistency, Streak, PRs, Check-ins
- "Your Position" hero card with rank + top %
- Time filters: weekly / monthly / all-time
- Expandable full-list modals per category
- Milestone feed (achievements from gym members via get_milestone_feed RPC)
- TV Display mode for gym screens (rotates metrics every 20s)
- Security hardened: gym boundary checks, privacy filtering, limit bounds (1-100)

#### 17. Achievements & Gamification
- **30+ milestone badges** — fully implemented with auto-unlock detection
- Categories: Workouts (1/10/25/50/100/200/500), Streaks (7/14/30/90/180/365), PRs (1/5/10/25/50), Volume (100k/500k/1M lbs), Strength standards, Social, Challenges, Community
- Achievement toast with radial glow, shimmer ring, particle sparkles
- Profile achievements hub with progress tracking
- Real-time detection via awardAchievements() function
- Achievement names in locale-appropriate quotes in notifications

#### 18. Rewards & Points System
- Points: Workout 50pts, PR 100pts, Check-in 20pts, Streak day 10pts (×length, cap 200), Challenge 500pts, Achievement 75pts
- Tiers: Bronze (0-999) → Silver (1k-5k) → Gold (5k-15k) → Platinum (15k-50k) → Diamond (50k+)
- Rewards catalog: smoothie (2k), guest pass (3.5k), merch (7.5k), PT session (15k), free month (30k)
- Redeem flow with QR code generation
- Points history log (fully translated, date-fns locale-aware)
- **Punch card system** with stamp tracking
- **Apple Wallet / Google Wallet** integration for membership cards + punch cards (via edge functions)
- Animated point counter with ease-out cubic easing

#### 19. Referral System
- Unique referral code generation per member (via RPC)
- Share via clipboard, native share (Capacitor)
- QR code for referral link
- Referral history: status tracking (pending/completed/expired), referred friend name
- Gym-configurable rewards (referrer + referred friend rewards)
- Referral security hardening

#### 20. Nutrition (Comprehensive)
- **AI food photo scanning** — capture photo → analyze-food-photo edge function (OpenAI Vision) → identified items with confidence scores, portion sizes
- **Language-aware AI responses** — Spanish prompts return Spanish food names when app is in Spanish
- **Nutri-Score** (0-100) health rating on every food item (color-coded badge: green/lime/yellow/orange/red)
- 1,000 food items in Supabase food_items table
- 300+ curated recipes in local data (6 categories: High Protein, Fat Loss, Lean Bulk, Mass Gain, Quick/Budget, Breakfast/Post-Workout)
- **Barcode scanner** via MLKit
- Food database search with debounced input
- Manual food entry with custom macro input
- Macro rings (SVG circular progress) for Calories, Protein, Carbs, Fat
- Macro bars (linear progress)
- Daily macro targets (auto-calculated from goal + body metrics via macro calculator)
- Serving size adjustment with dynamic macro recalculation
- **Meal planning algorithm** (greedy with macro balancing: cal 30%, protein 35%, carbs 20%, fat 15%)
  - Single meal suggestions (top 20 ranked by macro fit)
  - Full day plan generation (±10% cal, ±15% macro tolerance)
  - Weekly meal plan generation (7 days, no repeats within 3 days, all macros displayed per meal)
  - Post-workout meal suggestions (min 20g protein, carb-prioritized)
- Recipe discovery with ingredient-based search
- Weekly curated collections (themed 5-recipe bundles)
- **Grocery list** — full checklist generated from recipes, category grouping, check-off
- Saved/bookmarked recipes with virtual scrolling
- Food favorites system (boosted +0.1-0.15 in suggestion scoring)
- AI food correction logging (ai_food_corrections table)
- Weekly nutrition summary with compliance %, 7-day bar chart
- 4 views: Home (daily tracking), Discover (recipes), Saved (bookmarks), Grocery (shopping list)
- Confidence display translated ("alta confianza" / "high confidence")

#### 21. Notifications
- Real-time INSERT subscription via Supabase postgres_changes
- Types with color coding: Announcement (blue), PR (gold), Milestone (emerald), Challenge (purple), Friend (pink)
- Mark as read / clear all
- Announcements with type-based borders + expiry countdown
- Load more pagination (5 at a time)
- 14-day auto-cleanup
- 8 per-type notification toggles in settings
- **Push notifications** — fully implemented:
  - iOS: APNs with JWT signing (50-min token cache), device token management
  - Android: FCM v1 via Google Cloud
  - Edge functions: send-push (dual-platform), send-push-user (individual)
  - Push token upsert/cleanup in push_tokens table
- **Quiet hours** (10pm-7am) — push skipped, DB insert preserved
- **Notification deduplication** — dedup_key column with unique partial index, all 12 insertion points use dedup keys
- Achievement names in locale-appropriate quotes (Spanish: «», English: "")

#### 22. Health Integrations
- **Apple Health** — read/write via @capgo/capacitor-health plugin
  - Read: steps, weight, heart rate, calories (daily + weekly aggregation)
  - Write: weight (lbs→kg conversion), workout calories
  - 30-day weight history
- **Google Fit** — same API surface
- Connection state persisted in profiles.health_sync_enabled (DB-backed, not just localStorage)
- Health settings cached in localStorage for quick reads

#### 23. Profile & Settings
- User stats: lifetime workouts, streak, volume, PRs, achievement count, level badge
- Weekly volume chart (8-week rolling)
- Achievements hub with earned badges + progress
- **Goals section** with full CRUD (6 goal types)
- **Avatar customization** — photo upload, 16 color presets, 12 SVG design icons
- Friend code copy for sharing
- Referral count
- Goal editing (fitness level, goal, equipment, injuries)
- Identity editing (name, username)
- Language selector (EN/ES)
- **Dark/light mode toggle** (persists across reinstalls, respects system preference on fresh install)
- Leaderboard visibility toggle
- **Data export** (CSV: workouts, PRs, body metrics)
- Account deletion with typed confirmation
- Notification settings (8 per-type toggles)

---

### Apple Watch App (Full Native watchOS)

A complete native watchOS companion app:

- **ActiveWorkoutView** — full workout UI on wrist (exercise name, sets, weight/reps, suggestions)
- **RestTimerView** — rest countdown with skip button
- **QRCheckInView** — QR code display for gym check-in from wrist
- **HeartRateZoneView** — real-time heart rate zone visualization
- **RepCountingManager** — CoreMotion accelerometer at 50Hz with signal processing (**ON HOLD — accuracy issues being resolved**)
  - Exercise category detection (push/pull/squat/hinge/isolation)
  - Exponential low-pass filter + peak detection state machine + hysteresis threshold
  - Dynamic thresholds per exercise type
- **OfflineCacheManager** — offline data caching via shared UserDefaults (group.com.tugympr.app)
- **WatchSessionManager** — bidirectional WCSession messaging
  - Message types: workout_active, workout_ended, routines_sync, user_context, pr_hit, request_rpe
  - updateApplicationContext (latest state), sendMessage (direct), transferUserInfo (queued fallback)
- **4 Complication formats**: Accessory Circular (flame + streak), Rectangular (streak + count + last workout), Inline (emoji + text), Corner (gauge with weekly count)
- **Siri Intents**: Start Workout, Check Streak, Quick Check-In
- **Watch → Phone actions**: startWorkout, completeSet, skipRest, endWorkout, submitRPE

---

### iOS Native Features

- **Live Activities (Dynamic Island)** — workout progress on lock screen
  - Elapsed time, completed sets, current exercise, rest countdown
  - "LOG NEXT SET" prompt after rest completes (5s background task)
- **Apple Wallet passes** — membership cards + punch cards via PKAddPassesViewController
  - Edge functions: generate-apple-pass, generate-punch-card-pass
  - Webhook: apple-wallet-webhook for pass updates
- **Siri Shortcuts** (5 commands via AppIntents):
  - Start Workout, Check-In, Show Gym Card, Check Streak, Log Nutrition
  - tugympr:// custom URL scheme for deep linking
- **APNs push notifications** with JWT signing
- **Local notifications** — rest timer done, workout in progress (persistent, updated every 60s)

---

### Android Native Features

- **FCM push notifications** via Google Services
- **Google Wallet passes** via JWT signing (generate-google-pass edge function)
- **QR scanning** via @capacitor-mlkit/barcode-scanning
- **Camera** via native file input with capture="environment"

---

### Admin Dashboard (15 pages)

#### Overview
- Referral stats, at-risk members, recent activity, password reset approvals

#### Member Management
- Full member list with search, sort, churn badges
- Per-member detail view: 4 tabs (Workouts, Attendance, PRs, Notes)
- At-risk member flags (churn prediction with visual indicators)
- Contact panel, send message modal
- Password reset approval flow
- Member invite system (one-use enforcement)
- **CSV export** — members, workout history, PRs, body metrics (4 export types)

#### Churn Prediction & Follow-Up
- **Edge functions**: compute-churn-scores, calibrate-churn-weights
- ML-based churn scoring across attendance, workout frequency, social engagement, streak data
- At-risk member list with risk scores and tier colors
- Follow-up settings with customizable templates
- Win-back modal for targeted outreach (push/call/email)
- Contact history tracking

#### Analytics (9 charts)
- Growth chart, retention chart, activity chart
- Cohort analysis table
- Lifecycle stages visualization
- **Onboarding funnel** — step-by-step bar chart with drop-off percentages
- Monthly summary
- Challenge stats
- Trainer performance metrics

#### Challenges Management
- Create/configure/launch challenges (ChallengeModal)
- Set type, duration, scoring, rewards
- Monitor live leaderboards
- Archive completed

#### Programs
- Create gym programs (ProgramBuilderModal)
- Template selection with week/day/exercise structure
- Member enrollment tracking

#### Class Management
- Class CRUD with images (Supabase storage `class-images` bucket)
- Schedule management (recurring day/time slots with capacity)
- **Trainer assignment** per class
- **Workout template attachment** — link routines to classes
- **Analytics per class** — attendance rate, average rating, star distribution, individual workout results
- Waitlist management

#### Other Admin Features
- Announcements with scheduling and type selection (news/event/challenge/maintenance)
- Gym branding settings (logo, colors, name, palette, surface color) — **runtime CSS variable injection**
- Gym hours and holiday closures management (i18n day names)
- Class booking toggle
- QR scanner for check-ins (QRScannerModal with MLKit)
- Referral program configuration
- Store management (product CRUD, reward categories, purchase logging)
- Moderation tools (reported content dashboard, approve/delete/restore)
- Messaging system (in-app chat, delivery status)
- Trainer management (add/demote, client counts, CSV export)
- Leaderboard management (6 metrics, period/tier filtering, CSV export)
- Attendance tracking (30/60/90-day trends, heatmaps by day/hour, CSV export)

---

### Trainer Tier (8 pages)

- **Dashboard** — client overview, week session stats, at-risk clients, recent activity, follow-up modal
- **Clients** — list with search/sort, detail modal (workouts/PRs/programs), program assignment
- **Schedule** — calendar view, session CRUD (5 statuses: scheduled/confirmed/completed/no-show/cancelled), reminder toggles
- **Workout Plans** — trainer-created plans with week/day/exercise structure
- **Analytics** — per-client charts (sessions, PRs, weight), client selector
- **Programs** — published programs list, expandable week/day/exercise view
- **Client Notes** — 3-tab view (Overview/Notes/Body Metrics), text editor, streak tracking, follow-up logging
- **Classes** — assigned classes with schedule management, upcoming bookings (7 days), mark attendance, analytics (attendance rate, ratings, workout results), template management

---

### Platform Level — Super Admin (8 pages)

- **Gyms Overview** — gym list with member count, activity, churn indicators, count-up animation
- **Gym Detail** — full settings, admin/trainer/member management, role assignment, QR toggle, classes toggle, pause/freeze/cancel
- **Member Lookup** — cross-gym search by name/email, result modal with role/status badges
- **Audit Log** — 50-item pagination, 9 action types, date range filters, color-coded badges
- **Error Logs** — 50-item pagination, 9 error types, device/browser info, timestamps
- **Analytics** — 9 stat cards, monthly/weekly/all-time views, growth/churn/engagement charts
- **Settings** — exercise library editor, **email configuration** (status/templates), **feature flags** (7 toggles), **default gym config** (calories/days/language/theme), **system health** (Supabase status, active users, edge functions, storage)

---

## Architecture Notes

### Multi-Tenancy
- Each gym is an isolated tenant with their own members, data, branding, and admin
- Shared infrastructure, logically separated data (gym_id on all records)
- White-label config stored per gym (colors, logo, name, palette, surface tinting)
- RLS enforced on all tables

### Backend (Supabase — fully integrated)
- **Auth**: member + admin + trainer + super_admin roles, MFA enforcement for admin/trainer
- **Database**: 100+ tables covering all features
- **Storage**: exercise-videos, progress-photos, profile photos, gym logos, food images, class images
- **Edge Functions**: analyze-food-photo, analyze-body-photo, generate-apple-pass, generate-google-pass, generate-punch-card-pass, send-push, send-push-user, compute-churn-scores, calibrate-churn-weights, verify-qr, sign-qr, reset-password, send-reset-email, apple-wallet-webhook, push-wallet-update
- **RLS**: Comprehensive row-level security on all tables
- **Realtime**: postgres_changes subscriptions for notifications, challenges, password resets, direct messages, gym pulse
- **RPCs**: 25+ including leaderboard queries (7), complete_workout, add_reward_points, generate_referral_code, claim_invite_code, get_friend_feed, get_friend_streaks, get_feed_enrichment, get_profile_preview, get_dashboard_data, get_auth_context, get_trainer_class_analytics, book_class, cancel_class_booking, toggle_recurring_class, checkin_class, link_class_workout, get_or_create_conversation, awardAchievements

### State Management
- TanStack React Query via useSupabaseQuery.js (11 domain-specific hooks with caching + deduplication)
- **Persistent cache** — React Query persisted to localStorage (24h max age) via @tanstack/react-query-persist-client
- React Context: AuthContext (auth + gym branding + MFA + Watch sync), ToastContext, ThemeContext
- useRoutines hook with session-storage cache (5-min TTL)
- localStorage for draft sessions, coach marks, health settings cache, offline data

### Performance Optimizations
- **Lazy-loaded pages** — Workouts + all non-critical routes loaded on navigation
- **Lazy-loaded programTemplates.js** — 396KB static data loaded dynamically, Dashboard uses 1.5KB name map
- **Consolidated RPCs** — get_dashboard_data (replaces 8+ queries), get_auth_context (replaces 4+ queries)
- **Duplicate query elimination** — getUserPoints and getStreakWithProtections accept pre-fetched data
- **React Query offlineFirst** — serves cached data when offline, stops retrying when network lost
- **Hidden source maps** for native builds
- **Trimmed Google Fonts** (9 weights → 6)
- **Service worker** for Capacitor — runtime caching (API: NetworkFirst 15s, Storage: CacheFirst 7d, Fonts: CacheFirst 365d)

### Offline Support
- **Offline queue** — failed writes queued to localStorage, auto-synced on reconnect
- **Cached profile/gym data** — instant cold start from localStorage
- **Cached routines** — workouts startable offline
- **Draft session persistence** — survives crashes, app kills, network loss
- **Failed workout completion** — queued and synced when online
- **Offline banner** — "Sin conexión" with i18n, auto-dismisses on reconnect
- **Service worker** — runtime caching for API responses, images, fonts

### Native Integrations
- **@capgo/capacitor-watch** — Apple Watch WCSession bridge
- **@capgo/capacitor-health** — Apple Health / Google Fit
- **@capacitor/push-notifications** — APNs + FCM
- **@capacitor/keyboard** — keyboard height events for chat input positioning
- **@capacitor/local-notifications** — rest timer, workout tracking
- **@capacitor-mlkit/barcode-scanning** — QR code + barcode scanning
- **@capacitor/share** — native share sheet
- **Capacitor Updater** — auto-update via Capgo
- **PostHog** — analytics, user identification, onboarding step tracking
- **DOMPurify** — XSS protection

### Security
- HMAC-SHA256 QR code signing (constant-time comparison for timing attack prevention)
- **AES-256-GCM message encryption** — DMs stored as ciphertext in DB
- Image validation via magic bytes (prevents spoofed MIME types) + decompression bomb protection (4096px max)
- EXIF metadata stripping on photos before AI analysis
- Email validation with disposable domain blocklist (90+ domains)
- Content sanitization via DOMPurify
- **Notification deduplication** — dedup_key unique constraint prevents duplicate notifications across all 12 insertion points

---

## Design System

- **Dark + Light mode** — full CSS variable architecture with 2,315+ hardcoded colors refactored
  - CSS intercept rules in index.css remap all remaining Tailwind hex classes to variables
  - Toggle in Settings, persists to localStorage, respects system preference on fresh install
  - `html.dark` class-based switching
- **White-label branding** — per-gym colors via applyBranding() + applyGymTheme()
  - Sets `--color-accent`, `--color-bg-*`, `--color-surface-*` CSS variables at runtime
  - 10 preset palettes (obsidian_amber, electric_night, crimson_power, etc.)
  - Custom primary + secondary color support with WCAG contrast checking
  - Surface tinting in both dark and light mode
- **Typography**: Barlow (body, 4 weights), Barlow Condensed (headings, 2 weights)
- **Mobile**: bottom nav (Strava-style, center Record button in secondary gym color), fullscreen pages for active flows
- **Desktop**: top nav, max-width containers
- **Animations**: Framer Motion for page transitions, card reveals, modals; Canvas-based confetti; CSS keyframe particles
- **Accessibility**: Focus rings, 44px min touch targets, ARIA labels, keyboard navigation

---

## Internationalization

- **3,000+ translation keys** in both English and Spanish
- Covers: all UI text, exercise names, meal names, achievement labels/descriptions, navigation, notifications, error messages
- date-fns locale-aware formatting (timestamps, relative dates)
- AI responses language-aware (food scanning returns Spanish when app is in Spanish)
- i18next with `compatibilityJSON: 'v3'` for plural support (`_plural` key suffix)

---

## Current Build Status

### Fully Built & Shipped
- [x] Auth (login, signup, password reset, role-based routing, MFA for admin/trainer)
- [x] Onboarding (9-step wizard with analytics tracking, invite code, language selection)
- [x] Dashboard (stats, hero card, DayStrip, schedule, challenge card, gym news, messages shortcut, QR)
- [x] Workouts (My Routines + Gym Programs + Auto-Generated, enrollment, adaptation)
- [x] Workout Builder (exercise picker, custom exercises, drag reorder, time estimation)
- [x] Active Session (fullscreen tracker, overload suggestions, rest timer, PR detection, RPE/notes, draft persistence, class linking)
- [x] Session Summary (stats, PRs, XP, challenge updates, health sync)
- [x] Workout Log (monthly grouping, expandable sessions, PR indicators)
- [x] Progressive Overload Engine (double progression, 1RM, deload, injury substitution, goal-aware)
- [x] Auto Workout Generator (somatotype-based, periodized, goal-aware, Workout of the Day)
- [x] Exercise Library (144 exercises with video, custom, favorites, filter button)
- [x] Goal Setting (6 types, realistic dates, progress tracking, influences overload engine)
- [x] Body Diagram (interactive SVG muscle visualizer, front + back)
- [x] Body Metrics (weight charts, 8 measurements, progress photos, AI body fat)
- [x] 1RM Tracker + Strength Standards (5 lifts, 5 tiers, max-per-day charts, filter dropdown)
- [x] Social Feed (likes, comments, @mentions, posts with photos, profile preview, flag/unflag)
- [x] Direct Messaging (encrypted, iMessage-style, read receipts, keyboard-aware, friends-only)
- [x] Class Booking (images, capacity, waitlist with auto-promotion, recurring weekly, workout linking, ratings)
- [x] Challenges (5 types, real-time leaderboards, medals, rewards)
- [x] Leaderboards (7 categories, security hardened, milestone feed, TV Display mode)
- [x] Achievements (30+ badges, auto-unlock, celebration toast)
- [x] Rewards & Points (5 tiers, catalog, punch cards, Wallet passes, translated history)
- [x] Referrals (code generation, sharing, QR, history)
- [x] Nutrition (AI scan, nutri-score, barcode, 1000 foods, 300+ recipes, meal planning, grocery list)
- [x] Notifications (real-time, push, quiet hours, deduplication, translated)
- [x] Health Integrations (Apple Health, Google Fit, DB-persisted)
- [x] Check-In (QR/GPS/manual, streak freeze, closure awareness)
- [x] Apple Watch App (workout UI, rest timer, QR, heart rate, complications, Siri, offline cache)
- [x] iOS Live Activities (Dynamic Island workout display)
- [x] Apple/Google Wallet (membership + punch cards)
- [x] Siri Shortcuts (5 commands)
- [x] Profile (stats, goals, achievements, avatar customization, data export)
- [x] Settings (language, dark/light mode, notifications, privacy, account deletion)
- [x] My Gym (hours, holidays, announcements, upcoming classes)
- [x] Navigation (Strava-style, secondary-color Record button, route prefetching)
- [x] TV Display (fullscreen leaderboard rotation)
- [x] Admin Dashboard (15 pages: Overview, Members, Attendance, Challenges, Programs, Leaderboard, Announcements, Settings, Store, Moderation, Messaging, Churn, Analytics, Trainers, Classes)
- [x] Churn Prediction (ML scoring, follow-up workflows, win-back campaigns)
- [x] Trainer Tier (8 pages: Dashboard, Clients, Schedule, Plans, Analytics, Programs, Notes, Classes)
- [x] Platform Tier (7 pages: Gyms, Detail, Lookup, Audit, Errors, Analytics, Settings)
- [x] Dark + Light Mode (CSS variable architecture, 2,315+ colors refactored, toggle in settings)
- [x] White-label Branding (runtime CSS injection, 10 palettes, surface tinting)
- [x] Performance (lazy loading, RPCs, persistent cache, offline support, service worker)
- [x] Offline Support (queue, cached data, draft persistence, sync on reconnect)
- [x] i18n (English + Spanish, 3,000+ keys, locale-aware dates, AI language-aware)
- [x] Security (HMAC QR, AES-256-GCM messaging, image validation, EXIF stripping, DOMPurify, dedup)
- [x] Supabase (auth, 100+ tables, storage, 15+ edge functions, RLS, realtime, 25+ RPCs)
- [x] Multi-tenancy (gym_id isolation, RLS enforced)
- [x] PostHog Analytics (user identification, event tracking, onboarding funnel)
- [x] CSV Exports (members, workouts, PRs, body metrics — GDPR compliance)

### Known Issues / On Hold
- [ ] Apple Watch rep counting — on hold due to accuracy issues with CoreMotion signal processing
- [ ] Desktop view optimization — planned for gym computer screens (admin/trainer focus)
- [ ] Android build — Capacitor Android project setup pending

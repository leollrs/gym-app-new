# Gym App — Project Reference

## What This App Is

A **white-label B2B SaaS platform** sold to gyms. Each gym gets a branded version of the app (their colors, logo, name) that their members use to track workouts, compete socially, and stay accountable. The gym owner gets an admin dashboard with member analytics, attendance data, challenge management, and churn prediction tools.

The core value proposition:
- **For members**: An intelligent workout tracker that automatically drives progressive overload based on their current level and goals, with social and competitive hooks that keep them coming back.
- **For gym owners**: A retention tool that reduces churn, increases member engagement, and gives them real visibility into member activity — all under their own brand.

---

## Business Model

- **B2B SaaS** — gyms pay a recurring subscription (per member or tiered flat rate)
- **White-label** — each gym instance is customized with their branding (colors, logo, name)
- **Gym handles member acquisition** — the platform rides on existing gym membership
- **Upsell**: Personal trainer tier — trainers can assign programs and track clients inside the app

---

## Full Product Scope

### Member-Facing App

#### 1. Onboarding Flow
- Fitness level (beginner / intermediate / advanced)
- Primary goal (muscle gain / fat loss / strength / endurance / general fitness)
- Target timeline / goal date
- Training frequency (days per week)
- Available equipment
- Injuries or limitations (exercises to exclude or substitute)
- Current body metrics (weight, optionally body fat %)
- This data seeds the progressive overload engine and program recommendations

#### 2. Progressive Overload Engine (Core Differentiator)
- Automatically calculates what weight/reps to target each session based on:
  - User's logged history
  - Current 1RM estimates
  - Goal (hypertrophy vs strength vs endurance)
  - Training frequency and recovery
- Uses double progression (reps first, then weight) or percentage-based periodization depending on goal
- Accounts for deload weeks (every 4-6 weeks of accumulated load)
- Adjusts after missed workouts (doesn't just add load on top of a gap)
- Flags injury-excluded exercises and auto-substitutes alternatives
- Shows "suggested" weight/reps at the start of each set during a session

#### 3. Program Templates
- Pre-built 8-12 week programs (PPL, 5/3/1, Upper/Lower, Full Body, etc.)
- Progressive overload engine rides on top of selected program
- Gym admins and trainers can create and publish custom programs for their members

#### 4. Workout Tracking (ActiveSession)
- Fullscreen live workout tracker
- Suggested weight/reps shown per set (from the engine)
- Set logging: previous performance shown, input current weight + reps, checkbox to complete
- Auto rest timer after set completion (configurable per exercise)
- Elapsed session timer
- Finish session → summary screen with PRs hit, volume, duration

#### 5. Body Metrics & Progress Tracking
- Weight tracking over time (chart)
- Body measurements (chest, waist, hips, arms, legs)
- Body fat % (optional, manual input or calculated estimate)
- Progress photos (front, side, back — private by default)
- Strength progress charts per exercise (1RM over time)
- Volume trends over time

#### 6. Exercise Library
- 40+ exercises (expandable) across all muscle groups
- Filter by muscle group and equipment
- Search by name
- Each exercise: instructions, default sets/reps, inline BodyDiagram showing muscles worked
- Used as a picker in WorkoutBuilder and program creation

#### 7. Workout Builder
- Create and edit custom routines
- Add exercises from the library
- Configure sets / reps / rest per exercise
- Reorder and remove exercises
- Estimated duration + total set count
- Save to My Routines

#### 8. Attendance / Check-In
- QR code scan at gym entrance (primary method)
- GPS-based auto check-in when near the gym (fallback)
- Manual check-in option
- Attendance history visible to member and admin
- Feeds the churn prediction model

#### 9. Social Features
- Add friends within the same gym
- Activity feed: see when friends log workouts, hit PRs, complete challenges
- Like and comment on activity
- Friend profiles (public stats, recent workouts — with privacy controls)
- Privacy settings: choose what's visible to gym members vs friends only

#### 10. Challenges
- Hosted by gym admin
- Types:
  - **Consistency**: most check-ins in a period
  - **Volume**: most total weight lifted in a period
  - **PR**: most new personal records set
  - **Team**: members split into teams, competing on combined volume or consistency
  - **Specific lift**: highest squat / bench / deadlift 1RM
- Scoring normalized by experience level or bodyweight where applicable
- Leaderboard within each challenge
- Badges and achievements awarded on completion

#### 11. Leaderboards
- Overall gym leaderboard (volume, streak, PRs, challenges won)
- Weekly / monthly / all-time views
- Displayed in-app and exportable to TV display mode
- TV Display: fullscreen leaderboard view designed for large screens at the gym

#### 12. Achievements & Gamification
- Milestone badges (first workout, 30-day streak, 100 workouts, first PR, etc.)
- Challenge completion badges
- Strength standard tiers (e.g. reach 1.5x bodyweight squat)
- Visible on profile

#### 13. 1RM Tracker & Strength Standards
- Track estimated 1RM per lift over time
- Show where the user stands vs strength standards for their bodyweight class
- Motivational context ("You're in the top 30% for your weight class on bench")

#### 14. Notifications
- Workout reminders (scheduled)
- Streak warnings ("You haven't trained in X days")
- Challenge updates (new challenge started, leaderboard position changed)
- Friend activity ("Alex just hit a new deadlift PR")
- Progressive overload suggestions ("You're ready to increase bench press weight")
- Admin messages / announcements

#### 15. Nutrition Targets (Basic)
- Daily calorie target (calculated from goal + body metrics)
- Daily protein target
- Not a full food diary — just targets with a simple daily check-in ("Did you hit your nutrition today?")
- Can integrate with Apple Health / MyFitnessPal in a later phase

#### 16. Health Integrations
- Apple Health (read/write steps, workouts, weight)
- Google Fit
- Wearables (later phase)

---

### Admin Dashboard (Gym Owner Portal)

Separate web interface, not the member app.

#### Member Management
- Full member list with activity status
- Per-member view: workouts logged, attendance, PRs, challenge participation
- At-risk member flags (churn prediction model)
- Manual notes per member

#### Churn Prediction & Follow-Up
- Model based on: attendance drop-off, workout frequency decline, challenge disengagement, days since last session
- At-risk member list with risk score
- Automated follow-up triggers: push notification, email, or SMS to at-risk members
- Customizable message templates
- Track follow-up outcomes (member resumed activity or churned)

#### Attendance Analytics
- Daily / weekly / monthly attendance trends
- Peak hours heatmap
- Individual member attendance history

#### Challenges Management
- Create, configure, and launch challenges
- Set challenge type, duration, scoring method, rewards
- Monitor live leaderboards during active challenges
- Archive completed challenges

#### Leaderboard Controls
- Configure what shows on TV display leaderboards
- Choose metric, time period, number of spots shown
- Gym branding applied to TV display

#### Announcements
- Push announcements to all members (shown in Dashboard news feed)
- Schedule announcements in advance

#### Program & Content Management
- Create gym-branded workout programs
- Assign programs to specific members or make available to all
- Trainer accounts: trainers can manage their own client list

#### Gym Branding (White-Label Config)
- Upload gym logo
- Set primary color, secondary color, accent color
- Gym name shown throughout member app
- Custom welcome message for onboarding

#### Analytics Overview
- Active members this month
- Retention rate trend
- Most popular exercises / programs
- Challenge participation rates
- New member onboarding completion rate

---

### Trainer Tier (Upsell)

- Trainer account type within a gym
- Trainer manages a client list (subset of gym members)
- Assign custom programs to clients
- View client workout logs and progress
- Get notified when a client logs a session or hits a PR
- Message clients within the app

---

## Architecture Notes

### Multi-Tenancy
- Each gym is an isolated tenant with their own members, data, branding, and admin
- Shared infrastructure, logically separated data (gym_id on all records)
- White-label config stored per gym (colors, logo, name)

### Backend (Supabase — to be integrated)
- Auth (member + admin + trainer roles)
- Database: gyms, users, workouts, sessions, sets, exercises, programs, challenges, attendance, body_metrics, friendships, activity_feed, achievements
- Storage: profile photos, progress photos, gym logos
- Edge functions: progressive overload calculations, churn scoring, notification triggers
- Row-level security (members only see their gym's data)

### State Management
- Zustand for local/UI state (imported, not yet implemented)
- TanStack React Query for server state (imported, not yet implemented)

---

## Current Build Status

### Done
- [x] Auth (login, signup, role-based routing — member / admin / trainer)
- [x] Onboarding flow (fitness level, goal, training days, equipment, injuries, body metrics)
- [x] Dashboard (stats, upcoming workout, weekly volume chart, gym news)
- [x] Workouts page (My Routines + Gym Programs tabs + Auto-generated program section)
- [x] Workout Builder (create/edit routines, add from library, configure sets/reps/rest)
- [x] Active Session (live workout tracker, set logging, rest timer, draft persistence)
- [x] Session Summary (post-workout summary screen with PRs, volume, duration)
- [x] Workout Log (history of past sessions)
- [x] Progressive overload engine (overloadEngine.js — double progression, Epley 1RM, wired into ActiveSession suggestion chip)
- [x] Auto Workout Generator (workoutGenerator.js + GenerateWorkoutModal — BMI/somatotype, A/B rotation, 6-week program, cardio prescription)
- [x] Exercise Library (40+ exercises, filter by muscle + equipment, expandable cards with BodyDiagram)
- [x] Body Diagram (interactive SVG muscle visualizer, compact mode)
- [x] Body Metrics (weight tracking, measurements, progress charts — BodyMetrics.jsx)
- [x] 1RM Tracker + Strength Standards (Strength.jsx)
- [x] Social Feed (activity timeline, like/comment, friend system — add friends, friend requests)
- [x] Challenges (member-facing: Live/Upcoming/Ended tabs, leaderboards — Challenges.jsx)
- [x] Leaderboard (in-app leaderboard page)
- [x] Notifications (bell icon in nav with unread badge, Notifications.jsx, realtime)
- [x] Check-In (QR / GPS / manual check-in — CheckIn.jsx)
- [x] Nutrition (calorie + protein targets, daily check-in — Nutrition.jsx)
- [x] Profile (user stats, achievements hub)
- [x] Navigation (desktop top nav, mobile bottom nav, notification badge)
- [x] TV Display (leaderboard screen for gym displays)
- [x] Admin dashboard (Overview, Members, Attendance, Challenges, Programs, Leaderboard, Announcements, Settings)
- [x] Trainer tier (TrainerClients, TrainerPrograms)
- [x] Design system (dark theme, gold accent, glassmorphism, Tailwind CSS)
- [x] Supabase backend integration (auth, DB, realtime, RLS policies, generated_programs table)
- [x] Multi-tenancy (gym_id on all records, RLS enforced)

### Not Built Yet
- [ ] Program templates (pre-built 8-12 week PPL, 5/3/1, Upper/Lower etc. — gym admin can assign)
- [ ] Progress photos (front/side/back upload, private by default)
- [ ] Achievements / gamification (milestone badges, challenge completion badges — backend logic + display)
- [ ] White-label config system (per-gym branding via AdminSettings — UI exists, dynamic theming not applied)
- [ ] Churn prediction model + automated follow-up (at-risk scoring, trigger notifications/SMS)
- [ ] Health integrations (Apple Health, Google Fit read/write)
- [ ] Push notifications (web push / mobile — currently in-app only)

---

## Design System

- **Background**: `#05070B` (darkest), `#0A0D14`, `#0F172A`, `#111827`
- **Text**: `#E5E7EB` (primary), `#9CA3AF` (muted), `#6B7280` (subtle)
- **Accent (gold)**: `#D4AF37` — CTAs, active states, highlights, primary buttons
- **Success**: `#10B981` (emerald)
- **Danger**: `#EF4444` (red)
- **Borders**: `border-white/6`, `border-white/8`
- **Cards**: `bg-[#0F172A]`, `rounded-[14px]`, subtle borders
- **Sticky headers / overlays**: `backdrop-blur-2xl`, `bg-[#05070B]/90`
- **Mobile**: bottom nav, fullscreen pages for active flows (session, builder)
- **Desktop**: top nav, max-width containers, sidebar layouts where appropriate

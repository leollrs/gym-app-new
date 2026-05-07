# App Store Connect — Notes for Review

Paste the body of this document into the "Notes for Review" field in App Store Connect. Replace bracketed placeholders before submission.

---

## What's New in This Submission

- **Submission date:** 2026-04-29
- **App version / build:** `[USER ACTION REQUIRED: insert the marketing version (e.g., 2.4.0) and the App Store Connect build number for this submission]`
- **Summary of changes since the previously approved build:** `[USER ACTION REQUIRED: insert a 3-6 bullet summary of what changed for this build — new features, fixes, capability declaration changes, new third-party processors, etc. Reviewer-facing text, not the public release notes.]`
- **New entitlements / capabilities introduced this build:** `[USER ACTION REQUIRED: list any new entitlements (HealthKit categories, Push, Live Activities, App Groups, Wallet, Siri, etc.) added since the prior approved build, or write "None" if unchanged]`
- **New third-party processors introduced this build:** `[USER ACTION REQUIRED: list any new sub-processors added since the prior approved build, or write "None" if unchanged]`

---

## Demo Credentials

Please use the following test accounts to review the full app experience. The app gates content by role (member / trainer / gym admin), so three accounts are provided so the reviewer can exercise every privilege tier.

- **Member login (end-user experience):** `[USER ACTION REQUIRED: provide test member email + password — must persist for the full review window, must not be tied to a real person, and must allow the Apple reviewer to test workout logging, social feed, nutrition, rewards, Watch sync, Live Activity, and Wallet pass without hitting any gating]`
- **Trainer login (coach-facing surfaces):** `[USER ACTION REQUIRED: provide test trainer email + password — must persist, must be assigned to the same demo gym as the member account so the reviewer can test trainer-to-member messaging, program assignment, and check-ins]`
- **Gym Admin login (admin surfaces):** `[USER ACTION REQUIRED: provide test gym-admin email + password — must persist, must have admin role on the demo gym so the reviewer can test the dashboard, churn analytics, member management, class scheduling, QR scanner, and reward redemption]`
- **Test invite code (for the fresh signup flow):** `[USER ACTION REQUIRED: provide a long-lived invite code (or QR link) that the reviewer can use to create a brand-new member from scratch — must remain valid through the entire review cycle and not be consumed after first use]`

All test accounts use email + password authentication only (no OAuth, no Sign in with Apple). The admin account exposes the gym dashboard, churn analytics, member management, class scheduling, and QR scanner. The trainer account exposes program authoring, member check-ins, and trainer DMs. The member account exposes the standard end-user experience: workout tracking, social feed, nutrition, rewards, Watch sync, Live Activity, and Wallet pass.

---

## What TuGymPR Is — Business Model and Monetization

TuGymPR is a **B2B SaaS platform sold directly to gym operators and health club chains.** Each gym pays TuGymPR a recurring license fee outside of the App Store, and TuGymPR provides their members with a white-labeled retention and engagement app at no cost to the member.

**No in-app purchases. No consumer monetization paths. No subscription paywalls.**

**Per Guideline 3.1.3(c) — "Enterprise Services":** the app is licensed B2B to gym organizations who pay outside the app, and their members access the app at no charge as part of their existing gym membership. There is no consumer purchase path inside the app, no upsell, and no premium tier visible to end users. All features are unlocked for any authenticated member of a participating gym. Members cannot become customers of TuGymPR directly — only gyms can.

The "Rewards" and "Store" features inside the app are **gym-funded loyalty redemptions** (e.g., a member redeems points for a free smoothie at the gym's juice bar). They are not digital goods, are not transacted through Apple, and have no real-world monetary value to the member outside the gym's own loyalty program. See `REWARDS_TERMS_TEMPLATE.md` for the disclosure that gyms attach to member onboarding.

---

## AI Photo Analysis Flow and Consent

The app uses OpenAI's Vision API to analyze three categories of user-submitted photos:

1. **Body progress photos** — for body composition / body fat estimation in the Body Metrics page.
2. **Food photos** — for ingredient identification, portion estimation, and macro logging in the Nutrition page.
3. **Restaurant menu photos** (where applicable) — for dish identification.

**Consent flow:**
- The first time a user invokes any AI photo feature, they see a one-time disclosure modal naming OpenAI as the third-party processor and explaining that the photo is uploaded over TLS for analysis and is not used to train AI models.
- EXIF metadata is stripped client-side before upload.
- Photos are not stored on TuGymPR servers. OpenAI retains submitted images for up to 30 days for abuse monitoring per their API terms, and does not use API submissions to train models. Only the resulting structured data (e.g., "120g chicken breast, 198 kcal, 37g protein") is stored on TuGymPR.
- Users may decline AI analysis and continue to log workouts, food, and progress photos manually.

To exercise this in review: open the **Nutrition** tab → tap the camera icon → take a photo of any food item → the app will display the consent modal on first use.

---

## HealthKit Usage Scope

TuGymPR uses Apple HealthKit to enrich the workout and progress tracking experience. Specifically:

**Read permissions** (declared in `NSHealthShareUsageDescription`: *"TuGymPR reads your health data to display steps, sync weight measurements, and track workout activity."*):
- Steps — daily activity ring on the Dashboard
- Heart rate — workout intensity and zones during active sessions
- Body weight — populates body metrics history
- Active energy / calories — energy balance display

**Write permissions** (declared in `NSHealthUpdateUsageDescription`: *"TuGymPR saves your workouts and weight logs to Apple Health so all your fitness data stays in one place."*):
- Workout sessions (HKWorkout) on session completion
- Body weight entries when the user logs a weigh-in

**HealthKit data is NOT used for advertising, NOT shared with any third party, NOT synced to iCloud through TuGymPR, and NOT used by the AI features.** It stays on-device or moves directly between Apple Health and the user's encrypted gym account row. HealthKit data is never sent to OpenAI or PostHog.

Users can disable health sync at any time from Settings → Health Sync.

---

## Live Activities / Dynamic Island

TuGymPR uses Live Activities (with `NSSupportsLiveActivities=true` and `NSSupportsLiveActivitiesFrequentUpdates=true`) to display the active workout session on the lock screen and Dynamic Island. The activity shows:

- Elapsed session time
- Current exercise name
- Sets completed / total
- Rest timer countdown (when resting)
- "LOG NEXT SET" prompt after rest completes

The Live Activity ends automatically when the user finishes the workout or when the iOS system terminates the activity (typically after 8 hours). Frequent updates are required because rest timers tick at 1-second resolution and need to remain accurate on the lock screen.

To exercise: open a routine → tap **Start Workout** → log a set → start the rest timer → lock the device → observe the Live Activity update on the lock screen and Dynamic Island.

---

## Apple Watch Standalone Value

The Apple Watch app (`TuGymPR Watch App`) is a fully native watchOS companion that delivers value independent of the iPhone:

- **Standalone workout logging** — sets, reps, weight, RPE, and rest timer all from the wrist
- **QR check-in** — display the gym QR code on the Watch for scanning at the front desk
- **Heart rate zone visualization** — real-time during workouts
- **Complications** — streak count, last workout, weekly count (4 formats: Circular, Rectangular, Inline, Corner)
- **Siri intents** — "Start my workout", "What's my streak", "Quick check-in"
- **Offline cache** — workout data and routines cached via shared App Group `group.com.tugympr.app`, allowing the Watch app to operate without iPhone connectivity

The Watch app is not a mirror — it provides distinct, gloves-on-equipment-friendly utility designed for use during a real workout when the iPhone is in a locker.

---

## Apple Wallet Pass Purpose

TuGymPR generates a `.pkpass` file (via `PKAddPassesViewController` and the `generate-apple-pass` edge function) for two purposes:

1. **Gym membership card** — barcode the member shows at the gym front desk (HMAC-SHA256 signed payload, scanned by the gym admin's in-app QR scanner)
2. **Punch card** — visual stamp tracker for loyalty programs (e.g., 10 visits → free smoothie)

These passes are **functional access credentials, not promotional/marketing passes.** They do not contain coupons, offers, or third-party advertising. Pass updates are pushed via APNs through the `apple-wallet-webhook` edge function only when stamp counts change or membership status updates.

To exercise: open the member account → **My Gym** → **Add to Apple Wallet**.

---

## Rewards / Referral Flow

**Rewards (Member account):**
1. Open **Profile** → **Points & Rewards**
2. Browse the catalog (smoothie, guest pass, merchandise, PT session, free month)
3. Tap **Redeem** on any item the member has enough points for
4. The app generates a one-time QR code; the gym admin scans it to fulfill

**Referrals (Member account):**
1. Open **Profile** → **Referrals**
2. Copy the unique referral code or share via the native share sheet
3. (Reviewer test:) Sign up a second test member using the referral code → both accounts receive the gym-configured referral reward

**Important for review:** The referral program is **not** a financial incentive program under Apple's interpretation. No money changes hands. Rewards are entirely gym-funded loyalty perks (e.g., a smoothie). See `REWARDS_TERMS_TEMPLATE.md`.

---

## OTA / Live Updates Disclosure (Guideline 4.7)

TuGymPR uses Capgo (a Capacitor-compatible OTA update channel) to deliver bug fixes and content updates between App Store releases. **All OTA updates serve the same purpose, contain the same features, and respect the same age rating as the version of the app you approved.** No new functionality, executable code from third parties, or rating-changing content is introduced via OTA. Major feature additions go through the standard App Store review process.

---

## Authentication (Guideline 5.1.1(iv) — N/A)

TuGymPR offers **only email + password sign-in** via Supabase Auth. The app does NOT offer Google, Facebook, X, LinkedIn, Amazon, WeChat, or any other third-party social login. Per Apple Guideline 5.1.1(iv), Sign in with Apple is therefore not required and is not implemented.

---

## User-Generated Content and Moderation (Guideline 1.2)

**Confirmation:** The app contains user-generated content (social feed posts, comments, direct messages, and member profile fields). The following moderation flow is implemented and active in this build:

- **Report:** Every post, comment, direct message, and profile exposes a "Report" action that routes to the gym admin and to the TuGymPR moderation queue.
- **Block:** Members can block any other member of their gym. Blocking hides all posts, comments, and direct messages from the blocked account in both directions and prevents future interactions.
- **Hide:** Members can hide individual posts from their own feed without blocking the author.
- **EULA acceptance:** Each member must accept the End-User License Agreement at signup. The EULA prohibits objectionable content, harassment, hate speech, sexual content, and impersonation.
- **24-hour SLA:** Reports flagged as objectionable content are reviewed and acted upon within 24 hours. Repeat offenders are removed from the platform.

To exercise during review: open the **Feed** tab → tap the three-dot menu on any post → choose **Report**, **Hide**, or **Block user**.

---

## Encryption Declaration

`ITSAppUsesNonExemptEncryption` is set to `false` in Info.plist. The app uses only standard HTTPS/TLS, Apple-provided cryptographic frameworks for HealthKit, and the Web Crypto API's AES-256-GCM (used to encrypt direct messages between members at rest in the database — exempt under category 5A002 (b) ANS/CNSA).

---

## Background Location Mode — Outdoor Cardio Sessions Only

`Info.plist` declares the `location` background mode (`UIBackgroundModes`), but the app uses `requestWhenInUseAuthorization` rather than `requestAlwaysAuthorization`. This is intentional and conforms to Guideline 2.5.4.

**Purpose:** The app provides live outdoor cardio session tracking (running, cycling, walking workouts) for members who choose to log a cardio session from the **Workouts → Start Cardio** flow. While that session is active, we plot the route, distance, pace, and elapsed time in real time. To keep the route polyline accurate when the user locks the screen mid-run, we briefly enable background location updates **only for the duration of that session**.

**Lifecycle:**
- Background location is `OFF` at app launch and at all other times.
- When the user explicitly taps **Start Cardio**, `BackgroundLocationPlugin.start()` is called, which sets `CLLocationManager.allowsBackgroundLocationUpdates = true`.
- When the user taps **End Workout** (or cancels the session), `stop()` is called, which sets `allowsBackgroundLocationUpdates = false` and tears down the `CLLocationManager`.
- Location data is used only to render the route on-device and store the finished session's polyline + summary stats (distance, pace, calories) in the user's workout history. It is **not** sent to advertisers, **not** shared with other gym members, and **not** used for marketing or analytics.

**Why `WhenInUse` and not `Always`:** the user is necessarily interacting with an active workout when this runs. We don't need or want to track the user when they aren't recording a session, so the lighter `WhenInUse` authorization is the correct fit. iOS's standard "blue bar" indicator surfaces during the workout, giving the user clear feedback that location is active.

The implementation lives in `ios/App/App/BackgroundLocationPlugin.swift`. Search that file for `allowsBackgroundLocationUpdates` to confirm it is only ever set inside `start()` (with a fix-warm path) and is unconditionally cleared in `stop()`.

To exercise during review: open **Workouts** → tap **Start Cardio** → permit location → start a short session → lock the device → unlock → tap **End Workout** and confirm the route polyline is saved.

---

## Content Moderation

TuGymPR ships with: (1) automated pre-publication wordlist filter on feed posts and comments via Postgres trigger, (2) full report flow on every UGC surface (posts, comments, DMs, profiles), (3) bidirectional user blocking with RLS-enforced cutoffs (no DMs, friendship, comments to/from blocked users), (4) per-user post hiding, (5) admin moderation dashboard with auto-flag badge, (6) 24-hour SLA monitor that pages support if reports go unreviewed, (7) explicit Terms acceptance at signup with mandatory checkboxes. Reviewers can test the full flow with the demo accounts above.

---

## Privacy Policy

Full privacy policy is hosted at: `https://tugympr.com/privacy`
Web account deletion (no login required): `https://tugympr.com/eliminar-cuenta`

---

## Reviewer Contact

For any questions during review, please contact: `support@tugympr.com`
We typically respond within 4 business hours.

Thank you for reviewing TuGymPR.

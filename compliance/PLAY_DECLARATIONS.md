# Google Play Console — Declarations Pack

Pre-written justifications and Data Safety answers for the Play Console submission of TuGymPR (`com.tugympr.app`). Paste each section into the corresponding form.

---

## 1. Permissions Declaration Form

### 1.1 Photos and Media — `READ_MEDIA_VISUAL_USER_SELECTED`

**Declared use:** Allow members to upload progress photos and food photos from their device gallery.

**Feature description:**
TuGymPR is a B2B fitness retention platform. Two member-facing features require gallery access:
- **Body progress photos** (Body Metrics page): members upload photos to track visual changes over time. Photos are stored gym-private in Supabase Storage, never shared to public feeds.
- **Food photos** (Nutrition page): members upload meal photos for AI-powered macro analysis (OpenAI Vision API).

We use Capacitor Camera with the system Photo Picker on Android 13+. We declare **only** `READ_MEDIA_VISUAL_USER_SELECTED` so partial-photo selection (Android 14+) is treated as granted. We do **not** declare `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO` — full-gallery access is not required because every upload flows through the system Photo Picker, which returns user-selected items only. No background or full-gallery enumeration occurs. Legacy `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are scoped to API ≤32 and ≤29 respectively.

### 1.2 `ACTIVITY_RECOGNITION` — NOT declared (removed)

The app does **not** declare `ACTIVITY_RECOGNITION`. Daily step data is read from Google Health Connect (`health.READ_STEPS`), which does **not** require the `ACTIVITY_RECOGNITION` runtime permission, and the app performs no on-device activity recognition. The permission was removed from the manifest to avoid declaring an unused sensitive permission.

### 1.3 Health Connect Permissions (per-type justification)

| Permission | Justification |
|---|---|
| `health.READ_STEPS` | Daily activity ring on Dashboard. Aggregates daily step totals only. |
| `health.READ_HEART_RATE` | Workout intensity tracking and heart-rate zone visualization during active sessions. |
| `health.READ_TOTAL_CALORIES_BURNED` | Daily calorie expenditure for the energy-balance display in Nutrition (calories in vs calories out). |
| `health.READ_WEIGHT` | Populates the member's weight history chart in Body Metrics. |
| `health.READ_HEIGHT` | Read once during onboarding to seed the BMI / macro calculator. |
| `health.READ_SLEEP` | Recovery / readiness score (ReadinessModal): sleep duration informs training-readiness guidance. |
| `health.READ_HEART_RATE_VARIABILITY` | Recovery / readiness score: HRV is a recovery input. |
| `health.READ_RESTING_HEART_RATE` | Recovery / readiness score: resting heart rate is a recovery input. |
| `health.READ_EXERCISE` | Imports cardio/exercise sessions logged in other apps so the member's history and Dashboard stay unified. |
| `health.WRITE_TOTAL_CALORIES_BURNED` | Estimated calories for completed workouts are written to Health Connect. |
| `health.WRITE_WEIGHT` | When the member logs a manual weigh-in inside TuGymPR, the value is written to Health Connect so it propagates to other apps the user has connected. |

**Declared at signup:** Health Connect access is requested only after the member explicitly enables "Health Sync" during onboarding (step 8 of 9) or in Settings → Health Sync. Users can revoke at any time in Health Connect's permission manager.

**No advertising use. No sharing with third parties. No model training.** Health Connect data stays between the user's device, Health Connect, and the member's gym-scoped row in our Supabase database.

### 1.4 `CAMERA`

**Declared use:** QR code check-in scanning + progress photos + food photos + barcode scanning for nutrition.

**Feature description:**
The camera is invoked in four user-initiated flows only:
- **Gym check-in:** member opens "Check-In" → camera opens to scan the gym's QR code at the front desk.
- **Progress photos:** member taps the camera button in Body Metrics to capture a body photo.
- **Food photos:** member taps the camera button in Nutrition to capture a meal for AI analysis.
- **Barcode scanning:** member scans a food product barcode in Nutrition (via `@capacitor-mlkit/barcode-scanning`).

The camera is never invoked in the background. No video recording, no streaming, no facial recognition.

### 1.6 Other Permissions (Lower Sensitivity)

- `INTERNET`, `ACCESS_NETWORK_STATE` — required for Supabase API calls and offline-detection banner
- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` — GPS-based gym check-in (auto-detect when within geofence) and outdoor cardio route mapping. Foreground only.
- `POST_NOTIFICATIONS` — push notifications (workout reminders, social activity, gym announcements)
- `VIBRATE` — haptic feedback on PR detection and rest-timer completion
- `RECEIVE_BOOT_COMPLETED` — re-arms scheduled local notifications (rest reminders, workout-day prompts)

---

## 2. Data Safety Form Answers

### 2.1 Personal Info — Name, Email Address

- **Collected?** Yes
- **Shared with third parties?** No
- **Processed in transit, encrypted?** Yes (TLS 1.2+ to Supabase)
- **Encrypted at rest?** Yes (Supabase Postgres at-rest encryption)
- **Required or optional?** Required (email for account, name optional but prompted)
- **Purpose:** Account management; gym admin uses name to identify member for in-person services
- **Can users request deletion?** Yes — in-app at Settings → Delete Account, or via web at https://tugympr.com/eliminar-cuenta (no login required)

### 2.2 Health and Fitness — Workouts, Weight, Heart Rate, Steps, Calories, Body Measurements

- **Collected?** Yes
- **Shared with third parties?** No
- **Processed in transit, encrypted?** Yes (TLS to Supabase; HealthConnect data flows on-device only between HC and our app, then TLS to our server)
- **Encrypted at rest?** Yes
- **Required or optional?** Optional (Health Connect sync is opt-in; manual logging is core to the app)
- **Purpose:** App functionality (progressive overload engine, progress tracking, leaderboards within the user's gym only)
- **Sold?** No
- **Used for advertising?** No
- **Can users request deletion?** Yes

### 2.3 Photos and Videos — Body Progress Photos, Food Photos, Profile Photo

- **Collected?** Yes
- **Shared with third parties?** Yes — see "AI Processing" disclosure below
- **Processed in transit, encrypted?** Yes (TLS to Supabase Storage; TLS to OpenAI for analysis)
- **Encrypted at rest?** Yes
- **Required or optional?** Optional (all photo features can be skipped)
- **Purpose:** App functionality. Body photos: personal progress timeline (gym-private). Food photos: AI macro estimation (OpenAI Vision). Profile photo: user identity in social feed within the user's gym.
- **AI processing disclosure:** Body and food photos are sent to OpenAI's Vision API for analysis. EXIF metadata is stripped before upload. Photos are not retained by OpenAI for training and are not used for advertising.
- **Can users request deletion?** Yes — deleting the photo from the app removes it from Supabase Storage; account deletion removes all photos.

### 2.4 App Activity — Workouts Logged, Sessions, Feature Usage, Onboarding Step Progression

- **Collected?** Yes
- **Shared with third parties?** Yes (PostHog — see below)
- **Processed in transit, encrypted?** Yes
- **Encrypted at rest?** Yes
- **Required or optional?** Required (core to the app; analytics opt-out planned)
- **Purpose:** Analytics, app functionality, churn prediction (gym admin sees aggregated retention metrics for their members only)
- **Third-party processor:** PostHog. User IDs are hashed; no PII is sent to PostHog. Data is processed in EU/US PostHog regions.

### 2.5 Device or Other IDs — APNs / FCM Push Tokens

- **Collected?** Yes
- **Shared with third parties?** Yes (Apple APNs, Google FCM — required for push delivery)
- **Processed in transit, encrypted?** Yes
- **Encrypted at rest?** Yes
- **Required or optional?** Optional (notifications can be disabled)
- **Purpose:** Push notification delivery
- **Can users request deletion?** Yes (revoking notification permission removes the token from our database)

### 2.6 Location — Approximate and Precise (GPS)

- **Collected?** Yes
- **Shared with third parties?** No
- **Processed in transit, encrypted?** Yes
- **Encrypted at rest?** Yes
- **Required or optional?** Optional (GPS check-in and cardio route mapping are opt-in features)
- **Purpose:** App functionality — automatic gym check-in (geofence around the gym address), outdoor cardio route mapping
- **Used for advertising?** No

### 2.7 Messages — Direct Messages Between Members

- **Collected?** Yes
- **Shared with third parties?** No
- **Processed in transit, encrypted?** Yes (TLS) **and** at rest with **AES-256-GCM** (Web Crypto API, server-managed keys derived from a per-conversation seed). Not end-to-end — Supabase service-role access can decrypt for moderation, abuse handling, and lawful-request response.
- **Required or optional?** Optional (DM feature can be ignored)
- **Purpose:** App functionality — friend-to-friend messaging, member-to-trainer communication

### 2.8 Phone Number — Admin SMS to Members

- **Collected?** Yes (only if the member's gym chooses to use the admin SMS tool)
- **Shared with third parties?** Yes — **Twilio** (SMS delivery)
- **Processed in transit, encrypted?** Yes (TLS to Twilio API)
- **Encrypted at rest?** Yes
- **Required or optional?** Optional
- **Purpose:** App functionality — gym admin → member outreach (class reminders, win-back, no-show follow-up)
- **Used for advertising?** No
- **Sold?** No
- **Can users request deletion?** Yes — deleting the account removes the phone number; gym admins can also clear it from the Member detail panel.

### 2.9 Email Messages — Transactional Email

- **Collected?** Email address (already collected as Account Data) plus the subject and body of transactional emails generated by the platform (password resets, admin-initiated emails)
- **Shared with third parties?** Yes — **Resend** (email delivery)
- **Processed in transit, encrypted?** Yes (TLS)
- **Required or optional?** Required for password reset; optional for admin-initiated email
- **Purpose:** App functionality — account recovery, gym → member operational communication
- **Used for advertising?** No

### 2.10 Translation Requests

- **Collected?** No personal data is collected, but the in-app translate feature submits short text snippets (e.g. food names, exercise descriptions) for translation
- **Shared with third parties?** Yes — **DeepL** (machine translation)
- **Processed in transit, encrypted?** Yes (TLS)
- **Required or optional?** Optional (the feature is invoked only when the member requests a translation)
- **Purpose:** App functionality — i18n
- **Used for advertising?** No
- **Note:** No account identifier is attached to the request payload sent to DeepL.

---

## 3. Health Apps Requirements

### 3.1 Health Connect Declared Usage

We declare integration with **Google Health Connect** via the `@capgo/capacitor-health` plugin. The app:

- Reads: steps, heart rate, total calories burned, body weight, height, sleep, heart-rate variability, resting heart rate, exercise sessions
- Writes: body weight, total calories burned (per workout)

The full per-type justification is in section 1.3 above.

We have included the required `<queries>` element in `AndroidManifest.xml` referencing `com.google.android.apps.healthdata` so the system can resolve the Health Connect privacy policy intent.

### 3.2 Verified Organization Account

- **Organization name:** `[USER ACTION REQUIRED: insert the registered legal entity name as it appears on the Play Console developer account — must match the entity name used on the privacy policy and on App Store Connect (e.g., "TuGymPR LLC" or "TuGymPR S.L.")]`
- **D-U-N-S number:** `[USER ACTION REQUIRED: insert the 9-digit D-U-N-S number associated with the registered legal entity above; required for Play Console organization verification and for cross-referencing with App Store Connect]`
- **Verified status:** `[USER ACTION REQUIRED: confirm at time of submission — Play Console Account → Settings → Developer account → Account details → Organization verification — and replace this line with "Verified on YYYY-MM-DD" once the verification is complete]`
- **Privacy policy URL:** https://tugympr.com/privacy
- **Health Connect privacy policy URL:** https://tugympr.com/privacy#health-connect (anchored section in the main privacy policy)
- **Account deletion URL (no-login):** https://tugympr.com/eliminar-cuenta

### 3.3 Privacy Policy Health Connect Section

Required disclosures included in the privacy policy:

- Specific list of Health Connect data types read and written
- Purpose for each data type
- Statement: data is not used for advertising and is not sold
- Statement: data is not transferred to a third party for any purpose
- Retention period and deletion process
- Contact email for privacy inquiries

---

## 4. Sensitive Permission Usage Justifications (Summary Table for Form)

| Permission | Runtime trigger | Background use? | User-facing benefit |
|---|---|---|---|
| `CAMERA` | Tap camera button in Check-In, Body Metrics, or Nutrition | No | QR check-in, progress photos, food/barcode scanning |
| `READ_MEDIA_VISUAL_USER_SELECTED` | Tap "Choose from gallery" in Body Metrics or Nutrition (system Photo Picker, partial-access only) | No | Upload existing photos |
| `ACCESS_FINE_LOCATION` | Tap "Check-In" or start outdoor cardio routine | No (foreground only) | Auto check-in, route mapping |
| `POST_NOTIFICATIONS` | First app launch (Android 13+ system prompt) | N/A | Workout reminders, social activity, gym news |
| Health Connect permissions | Health Sync screen in onboarding/settings | No | Bidirectional sync with unified Health Connect store |

---

## 5. Target Audience and Content (Play Console — App Content)

- **Target age groups (Play Console "Target audience and content"):** **Adults (18+)** as the primary declared audience, with the app open to ages 13+ globally and 16+ in EU member states whose national law applies a higher GDPR-K threshold (see privacy policy Section 8 — Children's Privacy). The app is **not** designed for or directed at children, is **not** in the Play Store "Designed for Families" program, and does **not** appeal primarily to children.
- **Self-attestation:** Each prospective member confirms during account creation that they meet the minimum age threshold applicable to their jurisdiction.
- **Ads in app:** None. The app contains no advertising.
- **In-app purchases:** None. The app contains no consumer in-app purchases or subscriptions. Monetization is B2B SaaS billed outside the Play Store to gym operators.
- **User-generated content:** Yes. The app includes a social feed (posts and comments), direct messages between members, and member profile fields. Moderation flow:
  - **Report:** every post, comment, DM, and profile exposes a "Report" action that routes to the gym admin and to the TuGymPR moderation queue.
  - **Block:** members can block any other member; blocking hides content in both directions.
  - **Hide post:** members can hide individual posts from their own feed without blocking.
  - **EULA acceptance** at signup, prohibiting objectionable content, harassment, hate speech, sexual content, and impersonation.
  - **24-hour SLA** for review and action on reports of objectionable content. Repeat offenders are removed from the platform.
- **Violence, profanity, sexual content, drugs, gambling, real-money gaming:** None.
- **Government / financial / medical app categories:** Health & Fitness only. Not a medical device, not a regulated financial product.
- **News app:** No.
- **Country availability:** `[USER ACTION REQUIRED: confirm the list of countries where the listing should be made available; default proposal is "all countries except those embargoed by US, EU, or UK sanctions" but the listing owner should confirm with legal counsel]`

---

## 6. Account & App Deletion (CRITICAL — Play Required)

- **In-app deletion:** Settings → Account → Delete Account → typed confirmation. Triggers backend cascade across `profiles`, `workouts`, `body_metrics`, `progress_photos`, `direct_messages`, `push_tokens`, etc.
- **Web deletion (no login):** https://tugympr.com/eliminar-cuenta. Email + optional reason → email verification link (`request-account-deletion` edge function) → user clicks link → server-side cascade (`confirm-account-deletion` edge function → `delete_user_account_admin` RPC).
- **Retention:** Audit logs are retained for **90 days** for fraud and regulatory compliance, then deleted. All other personal data is deleted within **30 days** of the verified deletion request.

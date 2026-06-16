# Privacy Policy Outline — tugympr.com/privacy

This is a structured outline for the public privacy policy. Hand to legal counsel for jurisdiction-specific phrasing (GDPR, UK GDPR, CCPA/CPRA, LGPD, etc.) before publishing. Bracketed values are placeholders the listing owner must confirm.

---

## 1. Introduction

- **Who we are:** TuGymPR is a B2B SaaS platform operated by `[USER ACTION REQUIRED: insert the registered legal entity name — e.g., "TuGymPR LLC" or "TuGymPR S.L." — exactly as it appears on the company's registration certificate]`, registered at `[USER ACTION REQUIRED: insert the full registered business address (street, city, postal code, country) as it appears on the company's registration certificate]`. We license our product to gym operators ("Gyms"), who in turn provide it to their members ("Members") at no cost.
- **Scope of this policy:** This policy describes the personal data we (TuGymPR) process when you, as a Member of a participating Gym, use the TuGymPR mobile app or web app. Each Gym is a joint or independent controller for some of the data described here; consult your Gym's own privacy notice for their specific practices.
- **Why we're a B2B service:** TuGymPR does not sell anything to Members. There is no in-app purchase, no consumer subscription, and no advertising. Our customer is your Gym; you are our user.
- **Effective date:** 2026-04-29

---

## 2. Data We Collect

### 2.1 Account Data
- Email address (required)
- Name and username (display)
- Avatar (uploaded photo or generated icon)
- Authentication tokens (Supabase Auth — email + password only)
- Role within the Gym (member, trainer, admin)
- Language preference, theme preference, notification preferences

### 2.2 Health and Fitness Data
- Workouts logged (exercise, sets, reps, weight, RPE, notes, timestamps)
- Estimated 1-rep maxes (calculated from workout history)
- Body measurements (weight, body fat %, chest, waist, hips, arms, thighs)
- Progress photos
- Steps, heart rate, calories burned, weight measurements (optionally synced from Apple HealthKit / Google Health Connect)
- Workout streak history, achievement unlocks, points/rewards balance

### 2.3 Photos
- Profile photo
- Body progress photos (gym-private)
- Food photos (used for AI macro analysis, then discarded)
- Posts shared to the social feed (gym-private)

### 2.4 Location Data
- Precise location (GPS), **only while you are recording an outdoor cardio session** you started (run, walk, bike, hike) — for distance, pace, and route
- Tracking continues in the background (including when the screen is locked) **only for the duration of that session**, and stops when you end it. We do not track your location at any other time.
- Gym check-in does **not** use GPS — it uses signed QR codes
- The session route is saved as part of that workout in your history; deleting the workout deletes its route

### 2.5 Device Data
- Device model, OS version (for crash reporting and compatibility)
- Push notification tokens (APNs for iOS, FCM for Android)
- App version

### 2.5a Communications and Auxiliary Data
- **Phone number** — collected only when a Gym admin sends an SMS to a Member through the in-app admin tool. Sent to **Twilio** for delivery; not retained by TuGymPR beyond the send event log.
- **Email contents** — transactional email bodies (password resets, admin-initiated emails) are processed by **Resend** for delivery.
- **Translation requests** — short text snippets (e.g. food names, exercise descriptions) submitted through the in-app translate feature are sent to **DeepL** for translation. No account identifier is attached to the request.
- **Barcode lookups** — when you scan a food barcode, the EAN/UPC code (no personal data) is sent to **Open Food Facts** to look up nutrition information.
- **Map tile requests** — when viewing or sharing an outdoor cardio route, your route polyline coordinates are sent to **Mapbox** and to either **CartoDB** or **OpenStreetMap** to render the basemap underneath your route.

### 2.6 Usage Data
- Pages visited inside the app, features used, onboarding step progression
- Hashed user identifiers (no plaintext email or name) sent to PostHog for analytics
- Crash and error logs

### 2.7 Messages and Social Content
- Direct messages between Members (stored as ciphertext at rest with AES-256-GCM using server-managed keys; not end-to-end — see Section 10)
- Posts, comments, likes, friend connections within your Gym

### 2.8 Gym-Provided Data
- Your Gym may provide us with your check-in history, class bookings, and membership status as part of operating the platform on their behalf.

---

## 3. Third-Party Processors (Sub-Processors)

We use the following sub-processors. Each is bound by a Data Processing Agreement.

| Processor | Role | Data processed | Region |
|---|---|---|---|
| **Supabase, Inc.** | Backend, database, file storage, authentication, edge compute | All account, health, photo, social, and usage data | United States |
| **OpenAI, L.L.C.** | AI vision analysis of food photos, body progress photos, and menu photos | Photo binary, sent over TLS, not retained for model training | United States |
| **PostHog, Inc.** | Product analytics, onboarding funnel, feature usage | Hashed user IDs, event names, page views — no PII | United States or European Union (depending on workspace region) |
| **Apple, Inc. — APNs** | Push notification delivery (iOS + watchOS) | Push tokens, message body of push notifications | United States |
| **Google LLC — FCM** | Push notification delivery (Android) | Push tokens, message body of push notifications | United States |
| **Apple HealthKit** | On-device storage at Apple Health (Apple's framework) | On-device storage at Apple Health (Apple's framework). TuGymPR does not transmit HealthKit reads back to Apple. Data is mirrored into the user's TuGymPR account row in Supabase per Section 5 — that mirroring is what makes the data visible across devices and to the gym admin. | On-device |
| **Google Health Connect** | On-device storage of health data (Android) | All Health Connect reads/writes occur on the user's device; no transmission to Google by TuGymPR | On-device |
| **Capgo SAS** | Over-the-air (OTA) JavaScript bundle updates | App version metadata only; no user data | European Union |
| **Twilio, Inc.** | SMS delivery (admin-initiated outbound SMS to Members) | Recipient phone number, message body, send timestamp | United States |
| **DeepL SE** | Machine translation of in-app text snippets (e.g. food names, exercise descriptions) | Source text only; no account identifier attached | European Union (Germany) |
| **Resend, Inc.** | Transactional email delivery (password resets, admin-initiated emails) | Recipient email, subject, message body | United States |
| **Mapbox, Inc.** | Map tile rendering for outdoor cardio share cards | Tile-coordinate requests; route polyline coordinates derived from foreground GPS | United States |
| **CartoDB, Inc. (Carto)** | Fallback basemap tiles for cardio share cards | Tile-coordinate requests only | European Union (Spain) |
| **OpenStreetMap Foundation** | Fallback basemap tiles for cardio share cards | Tile-coordinate requests only | European Union (United Kingdom) |
| **Open Food Facts** | Barcode-to-nutrition lookups for the Nutrition feature | Submitted EAN/UPC barcode only; no account identifier | European Union (France) |
| **goQR.me (QR Server GmbH)** | Renders reward-voucher QR images embedded in gym-sent emails | The voucher code only; no name or email | European Union (Germany) |
| **Have I Been Pwned (Cloudflare, Inc.)** | Breached-password check at signup | First 5 chars of the SHA-1 hash of the password (k-anonymity); never the password or any identifier | United States / global CDN |

We do **not** use third-party advertising networks, do **not** participate in adtech RTB, and do **not** sell or share personal information for cross-context behavioral advertising (CCPA/CPRA terminology).

---

## 4. AI Photo Processing Disclosure

When you use the AI-powered features inside TuGymPR — body composition analysis (Body Metrics), food identification (Nutrition), or menu OCR — your photo is processed as follows:

1. **Server-side EXIF stripping at our edge function before transmitting to any third party (specifically: before forwarding to OpenAI Vision). Avatar uploads and social-feed photos are EXIF-stripped client-side.**
2. **TLS upload:** The photo is sent over TLS to a TuGymPR edge function (Supabase Edge Functions, US region).
3. **OpenAI Vision call:** The photo is forwarded to **OpenAI's** Vision API for analysis. Per our agreement with OpenAI, photos sent through the API are **not used to train OpenAI models** and are retained by OpenAI for at most 30 days for abuse monitoring before deletion.
4. **Result stored, photo discarded:** Only the structured analysis result (e.g., "120g chicken breast, 198 kcal") is stored against your account. The photo binary is not retained on TuGymPR servers for AI features (food, menu); body progress photos are retained because the timeline view is itself a feature.
5. **Opt-out:** You may use the app without invoking AI features. You can log workouts, food, and progress entirely manually.

---

## 5. Apple HealthKit and Google Health Connect Disclosure

When you enable Health Sync (opt-in during onboarding or in Settings):

- **Read access requested:** steps, heart rate, body weight, total calories burned
- **Write access requested:** exercise sessions, body weight, total calories burned (per workout)

**HealthKit and Health Connect data is:**
- **Never used for advertising or marketing**
- **Never sold or shared** with third parties
- **Never used to train AI models**
- **Never synced to TuGymPR-controlled iCloud storage** (HealthKit data syncs through Apple's iCloud only if **you** have enabled HealthKit iCloud sync in your Apple ID settings — this is between you and Apple, not TuGymPR)
- **Synced to your Gym account row** in our database so your Dashboard, leaderboard position, and workout history reflect the same data on every device you use to log in

You can revoke access at any time:
- **iOS:** Settings → Privacy & Security → Health → TuGymPR
- **Android:** Health Connect app → Permissions → TuGymPR

---

## 6. Data Retention

- **Active accounts:** All personal data is retained while your Gym membership is active.
- **Account deletion:** Within **30 days** of a verified deletion request, all personal data (workouts, photos, profile, social activity, messages, push tokens) is permanently deleted from our production database and storage.
- **Audit logs (fraud, security, regulatory):** Retained for **90 days** post-deletion, then permanently purged.
- **Backups:** Encrypted backups are rotated on a 30-day schedule. Deleted personal data ages out of backups within this window.
- **Aggregated/anonymized data** (e.g., total workouts logged across the platform) may be retained indefinitely for product analytics. Such data cannot be linked back to any individual.

---

## 7. Your Rights

Depending on your jurisdiction, you have rights to access, correct, export, restrict, object to, and delete your personal data, and to lodge a complaint with a supervisory authority.

How to exercise:

- **Access / export:** In-app at Settings → Export My Data (CSV download of workouts, PRs, body metrics)
- **Correction:** In-app at Profile → Edit Identity / Body Metrics
- **Deletion (logged in):** In-app at Settings → Delete Account (typed confirmation)
- **Deletion (no login required):** Web form at https://tugympr.com/eliminar-cuenta — required by Google Play, available to anyone who has an account
- **Other rights / questions:** Email `privacy@tugympr.com`

We respond to verified requests within 30 days (or as required by your local law).

---

## 8. Children's Privacy

TuGymPR is intended for users **13 years of age or older** globally. In European Union member states that have set a higher age of digital consent under Article 8 GDPR ("GDPR-K") — including, but not limited to, jurisdictions that apply a 16-year threshold — TuGymPR is intended for users **16 years of age or older** unless verifiable parental consent has been obtained by the participating Gym.

- **Self-attestation at signup:** Each prospective member confirms during account creation that they meet the minimum age threshold applicable to their jurisdiction.
- **No Kids Category:** The app is not in the Apple App Store Kids Category and does not knowingly collect data from children below the applicable threshold.
- **Suspected child accounts:** If you are a parent, guardian, gym operator, or any third party who believes that a child below the applicable threshold has created an account, contact `privacy@tugympr.com`. We will verify the report, delete the account and associated personal data within **30 days** of verification, and confirm the deletion to the requester.
- **No targeted advertising to minors:** We do not run advertising of any kind, and no profile is built for advertising purposes regardless of the user's age.

---

## 9. International Data Transfers

Personal data may be transferred to and processed in countries outside your country of residence, including the **United States**, where our primary infrastructure (Supabase, OpenAI, Apple APNs, Google FCM) is located. We rely on Standard Contractual Clauses (SCCs) and equivalent transfer mechanisms (UK IDTA, Swiss FDPIC) where required. By using the app, you understand that your data will be processed in these jurisdictions.

---

## 10. Security

- TLS 1.2+ for all data in transit
- AES-256-GCM at rest for direct messages, using server-managed keys derived from a per-conversation seed. This protects against database snapshot leaks but is not end-to-end — Supabase service-role access can decrypt.
- HMAC-SHA256 signed QR codes (constant-time comparison) for check-in
- EXIF stripping on photos before AI processing
- Image magic-byte validation and decompression-bomb protection on uploads
- Row-level security (Supabase RLS) on all multi-tenant tables — your data is logically isolated to your Gym

No security program is perfect. We commit to notifying affected users and the relevant supervisory authorities of any qualifying personal-data breach within the timelines required by applicable law.

---

## 11. User-Generated Content and Moderation

The app includes user-generated content ("UGC") features: the social feed (posts and comments), direct messages between Members, and member profile fields. To keep these spaces safe, we operate the following moderation tools and processes:

- **End-User License Agreement (EULA):** Each Member must accept the EULA at signup. The EULA prohibits objectionable content, harassment, hate speech, sexual content, and impersonation, and is enforced through the controls below.
- **Reporting:** Any post, comment, direct message, or profile can be reported in-app via the "Report" action. Reports route to the gym admin and to the TuGymPR moderation queue.
- **Block user:** Members can block any other Member of their Gym. Blocking hides all posts, comments, and direct messages from the blocked account in both directions and prevents future interactions.
- **Hide post:** Members can hide individual posts from their own feed without blocking the author.
- **24-hour SLA:** Reports flagged as objectionable content are reviewed and acted upon within **24 hours**. Action may include removing the content, suspending the offending account, and notifying the gym admin. Repeat offenders are removed from the platform.
- **Retention of moderation records:** Removed content metadata and the corresponding report (without the original payload) are retained for 90 days as part of our audit log to defend against bad-faith reporting and to enable appeal review.

Members can contact `privacy@tugympr.com` for questions about a moderation decision affecting their account.

---

## 12. Changes to This Policy

We may update this policy as our product evolves or as the law changes. Material changes will be communicated in-app and via email to the address on your account at least 30 days before they take effect.

---

## 13. Contact

- **General privacy inquiries:** `privacy@tugympr.com`
- **Account deletion (no login):** https://tugympr.com/eliminar-cuenta
- **Postal address:** `[USER ACTION REQUIRED: insert the postal address where privacy correspondence should be received — usually the registered business address from Section 1]`
- **EU representative (if applicable):** `[USER ACTION REQUIRED: if the controller is established outside the EU, designate an Article 27 GDPR representative inside the EU and insert their full name, postal address, and contact email here. If the controller is established inside the EU, replace this line with "Not applicable — controller established in the EU."]`
- **UK representative (if applicable):** `[USER ACTION REQUIRED: if the controller is established outside the UK and offers the service to UK residents, designate a UK GDPR Article 27 representative and insert their full name, postal address, and contact email. Otherwise replace with "Not applicable."]`
- **Data Protection Officer (if appointed):** `[USER ACTION REQUIRED: if a DPO has been appointed (mandatory under Article 37 GDPR for certain processors), insert the DPO's name and contact email. Otherwise replace with "Not applicable — no DPO appointment is required under Article 37 GDPR for our processing activities."]`

---

**Last updated:** 2026-04-29

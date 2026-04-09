# Google Play Data Safety Section -- TuGymPR

Reference guide for filling out Google Play Console > App content > Data safety.

Last updated: 2026-04-07

---

## Overview Questions

| Question | Answer |
|----------|--------|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS/TLS for all network requests) |
| Do you provide a way for users to request that their data is deleted? | **Yes** |
| Account deletion URL | https://tugympr.com/eliminar-cuenta |
| Privacy policy URL | https://tugympr.com/privacidad |

---

## Data Sharing with Third Parties

| Third Party | Data Shared | Purpose |
|-------------|------------|---------|
| **Supabase** | All user data (auth, profile, workouts, photos, messages) | Data processing -- backend infrastructure (auth, database, storage) |
| **OpenAI** | Food photos, body composition photos only (no user identity, EXIF stripped) | App functionality -- AI-powered nutrition and body analysis |
| **PostHog** | Anonymous usage events, user ID, device info | Analytics -- product usage understanding |
| **Capgo** | Device identifier | App functionality -- OTA update delivery |

> **Note:** Google MLKit (QR scanning) runs entirely on-device and sends no data externally. APNs/FCM tokens are sent to Google/Apple for push delivery (platform infrastructure, not third-party sharing).

---

## Data Types -- Detailed Checklist

### 1. Location

#### Approximate location

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Optional (needed for gym check-in verification)
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Coarse location used only to verify user is at the gym during check-in. Not stored persistently beyond the check-in record.

#### Precise location

- [ ] **Collected:** No

---

### 2. Personal Info

#### Name

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Required
- [ ] **Purpose:** App functionality, Account management
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes

#### Email address

- [ ] **Collected:** Yes
- [ ] **Shared:** No (Supabase is a data processor, not a third-party share)
- [ ] **Required or Optional:** Required
- [ ] **Purpose:** App functionality, Account management
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes

#### User IDs

- [ ] **Collected:** Yes
- [ ] **Shared:** Yes (PostHog -- for analytics identification)
- [ ] **Required or Optional:** Required (auto-generated)
- [ ] **Purpose:** App functionality, Analytics
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes

#### Other personal info (username, age, sex)

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Username required; age and sex optional
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Username for social features. Age and sex for fitness calculations and macro targets.

---

### 3. Financial Info

- [ ] **Collected:** No
- [ ] **Notes:** No payment, purchase, or financial data is collected.

---

### 4. Health and Fitness

#### Health info

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Optional
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Body measurements (chest, waist, hips, arms, thighs, body fat %), height, weight, weight history. Steps, heart rate, calories from Google Fit integration.

#### Fitness info

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Optional (but core to app value)
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Workout data -- exercises, sets, reps, weight lifted. This is the primary app functionality.

---

### 5. Messages

#### Other in-app messages

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Optional
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Direct messages between users. Encrypted at rest using AES-256-GCM.

---

### 6. Photos and Videos

#### Photos

- [ ] **Collected:** Yes
- [ ] **Shared:** Yes (OpenAI -- food photos and body photos only, no user identity attached, EXIF stripped)
- [ ] **Required or Optional:** Optional
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Profile photos (social features), progress photos (personal tracking), food photos (AI nutrition analysis). Only food/body photos are sent to OpenAI for analysis -- no identifying information is included.

#### Videos

- [ ] **Collected:** No

---

### 7. Audio

- [ ] **Collected:** No

---

### 8. Files and Docs

- [ ] **Collected:** No

---

### 9. Calendar

- [ ] **Collected:** No

---

### 10. Contacts

- [ ] **Collected:** No

---

### 11. App Activity

#### App interactions

- [ ] **Collected:** Yes
- [ ] **Shared:** Yes (PostHog -- anonymous feature usage events)
- [ ] **Required or Optional:** Required (automatic)
- [ ] **Purpose:** Analytics
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Anonymous feature usage tracking -- screens viewed, buttons tapped, features used. Sent to PostHog for product analytics.

#### Other user-generated content

- [ ] **Collected:** No

#### In-app search history

- [ ] **Collected:** No

#### Installed apps

- [ ] **Collected:** No

---

### 12. Web Browsing

- [ ] **Collected:** No

---

### 13. Device or Other IDs

#### Device or other IDs

- [ ] **Collected:** Yes
- [ ] **Shared:** Yes (Capgo -- device identifier for OTA updates; FCM -- push token for push delivery)
- [ ] **Required or Optional:** Required (automatic)
- [ ] **Purpose:** App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** FCM push notification token for push delivery. Capgo device identifier for OTA update targeting.

---

### 14. App Performance

#### Crash logs

- [ ] **Collected:** Yes
- [ ] **Shared:** No
- [ ] **Required or Optional:** Required (automatic)
- [ ] **Purpose:** App functionality (debugging)
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Error logs stored in own database.

#### Diagnostics

- [ ] **Collected:** Yes
- [ ] **Shared:** Yes (PostHog -- device platform, app version)
- [ ] **Required or Optional:** Required (automatic)
- [ ] **Purpose:** Analytics, App functionality
- [ ] **Encrypted in transit:** Yes
- [ ] **User can request deletion:** Yes
- [ ] **Notes:** Performance monitoring data. Device info (platform, app version) sent to PostHog.

#### Other app performance data

- [ ] **Collected:** No

---

## Data NOT Collected Checklist

Confirm "No" for all of the following in Play Console:

- [ ] Precise location
- [ ] Phone number
- [ ] Address
- [ ] Race and ethnicity
- [ ] Political or religious beliefs
- [ ] Sexual orientation
- [ ] Financial info (purchase history, credit info, etc.)
- [ ] Audio files
- [ ] Videos
- [ ] Files and docs
- [ ] Calendar events
- [ ] Contacts
- [ ] SMS or MMS
- [ ] Call logs
- [ ] Web browsing history
- [ ] In-app search history
- [ ] Installed apps
- [ ] Advertising ID

---

## Security Practices Summary

Use this when Google asks "Does your app follow security practices?":

| Practice | Status |
|----------|--------|
| Data encrypted in transit | Yes -- all API calls use HTTPS/TLS |
| Data encrypted at rest | Yes -- Supabase encrypts data at rest. Direct messages use AES-256-GCM encryption |
| User can request data deletion | Yes -- via https://tugympr.com/eliminar-cuenta |
| Data deletion is complete | Yes -- account deletion removes all user data from Supabase |
| Built against a security framework | Yes -- Supabase RLS (Row Level Security) policies enforce data access controls |
| Independent security review | No (not required for most apps) |

---

## Important Notes

1. **Data processor vs. third-party sharing:** Google distinguishes between sharing data with third parties and using a service provider as a data processor. Supabase acts as a data processor (processes data on your behalf) -- this is generally NOT considered "sharing" in Google's Data Safety context. OpenAI and PostHog receive specific data subsets and should be disclosed as sharing.

2. **Google Fit:** If the app reads data from Google Fit, this must be disclosed under Health and Fitness. The Google Fit API has additional compliance requirements -- review Google's Health Connect policies.

3. **Camera vs. Photos:** Camera permission is used for QR scanning (Google MLKit, on-device) and food photo capture. The relevant data safety disclosure is about the resulting photos, not the camera permission itself.

4. **Advertising:** The app does not use advertising IDs, does not serve ads, and does not share data for advertising purposes. This should be clearly stated.

5. **EXIF stripping:** When disclosing photo sharing with OpenAI, note that EXIF metadata (which can contain location) is stripped before transmission. This is a positive privacy practice worth noting in the detailed disclosure.

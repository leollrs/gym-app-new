# Apple Privacy Nutrition Labels -- TuGymPR

Reference guide for filling out App Store Connect > App Privacy > Data Collection.

Last updated: 2026-04-07

---

## Top-Level Questions

| Question | Answer |
|----------|--------|
| Do you or your third-party partners collect data from this app? | **Yes** |
| Does this app use data for tracking? | **No** |

> **Tracking** means linking data collected from your app with third-party data for advertising, or sharing data with a data broker. TuGymPR does none of this.

---

## 1. Contact Info

### Name

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** User's display name, collected during account creation. Stored in Supabase.

### Email Address

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Used for authentication (Supabase Auth) and account recovery.

---

## 2. Health & Fitness

### Health

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Steps, heart rate, and calories read from Apple Health (HealthKit). Body measurements (chest, waist, hips, arms, thighs, body fat %). Weight history for trend tracking.

### Fitness

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Workout data (exercises, sets, reps, weight lifted). This is core app functionality.

---

## 3. Financial Info

- [ ] **Collected:** No
- [ ] **Notes:** The app does not collect any financial or payment information.

---

## 4. Location

### Coarse Location

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Used solely for gym check-in verification. Only coarse location is collected, not precise GPS coordinates.

### Precise Location

- [ ] **Collected:** No

---

## 5. Sensitive Info

- [ ] **Collected:** No
- [ ] **Notes:** No sensitive data categories (racial/ethnic data, political opinions, religious beliefs, sexual orientation, etc.) are collected.

---

## 6. Contacts

- [ ] **Collected:** No
- [ ] **Notes:** The app does not access the user's contacts or address book.

---

## 7. User Content

### Photos or Videos

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Profile photos (social features), progress photos (personal tracking), and food photos (AI nutrition analysis via OpenAI). EXIF data is stripped from food photos before sending to OpenAI. No user identity is sent with food/body photos to OpenAI.

### Other User Content

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Direct messages between users. Encrypted at rest using AES-256-GCM in Supabase.

---

## 8. Browsing History

- [ ] **Collected:** No

---

## 9. Search History

- [ ] **Collected:** No

---

## 10. Identifiers

### User ID

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality, Analytics
- [ ] **Notes:** Supabase user UUID used for authentication. Also sent to PostHog for analytics identification (links anonymous events to a user).

### Device ID

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Push notification token (APNs) for push delivery. Capgo device identifier for OTA update targeting.

---

## 11. Usage Data

### Product Interaction

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** No
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** Analytics
- [ ] **Notes:** Anonymous feature usage events sent to PostHog (e.g., screens viewed, buttons tapped, features used). Not linked to identity in the privacy label context because PostHog data is used only for internal product analytics, not advertising or cross-app tracking.

---

## 12. Diagnostics

### Crash Data

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** No
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Error logs stored in own database for debugging. Not linked to identity for privacy label purposes.

### Performance Data

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** No
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Performance monitoring diagnostics.

### Other Diagnostic Data

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** No
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Device info (platform, app version) sent to PostHog for analytics segmentation.

---

## 13. Other Data

### Username

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Unique username chosen during account creation, used for social features.

### Age / Sex / Height / Weight

- [ ] **Collected:** Yes
- [ ] **Linked to User's Identity:** Yes
- [ ] **Used for Tracking:** No
- [ ] **Purpose:** App Functionality
- [ ] **Notes:** Used for fitness calculations and macro nutrient targets. These are entered voluntarily by the user.

---

## Third-Party SDK Summary

When Apple asks about third-party SDKs, reference this table:

| SDK | Data Received | Purpose |
|-----|--------------|---------|
| **Supabase** | All user data (auth, profile, workouts, photos, messages) | Data processor -- authentication, database, file storage |
| **OpenAI** | Food photos, body composition photos (no user identity, EXIF stripped) | AI nutrition analysis, optional body composition analysis |
| **PostHog** | Anonymous usage events, user ID, device info (platform, app version) | Product analytics |
| **Google MLKit** | None (on-device only) | QR code scanning -- all processing is local |
| **Capgo** | Device identifier | OTA app update delivery |
| **APNs** | Push notification token | Push notification delivery |

---

## Data NOT Collected Checklist

Confirm "No" for all of the following in App Store Connect:

- [ ] Precise Location
- [ ] Physical Address
- [ ] Phone Number
- [ ] Payment Info / Credit Card
- [ ] Contacts
- [ ] Emails or Text Messages (the "Messages" Apple category for email/SMS content)
- [ ] Browsing History
- [ ] Search History
- [ ] Audio Data
- [ ] Gameplay Content
- [ ] Customer Support
- [ ] Advertising Data
- [ ] Purchases
- [ ] Sensitive Info
- [ ] Financial Info

---

## Important Notes

1. **HealthKit:** Because TuGymPR reads from Apple Health, the HealthKit usage must be disclosed under Health & Fitness. Apple requires a clear purpose string in Info.plist explaining why the app reads health data.

2. **Camera:** Camera access is used for QR scanning and food photo analysis. Camera usage itself is not a "data type" in Apple's privacy labels -- the relevant data type is the resulting photos/videos.

3. **"Linked to Identity":** Data is linked to identity if it can be associated with a user account. PostHog analytics and diagnostics are marked as NOT linked because they serve internal analytics only and are not used to identify individual users outside of product improvement.

4. **"Used for Tracking":** All items are marked No. Apple defines tracking as linking your app's data with third-party data for advertising purposes, or sharing with data brokers. TuGymPR does neither.

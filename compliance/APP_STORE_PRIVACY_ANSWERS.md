# App Store Connect — "App Privacy" answers (copy/paste)

Go to **App Store Connect → your app → App Privacy → Edit**. These answers mirror the privacy
manifest compiled into the app (`ios/App/App/PrivacyInfo.xcprivacy`), which is what keeps Apple's
automated privacy check from flagging a mismatch.

---

## Step 0 — "Do you or your third-party partners collect data from this app?"
→ **Yes, we collect data.**

## Step 1 — Tick exactly these data types (leave all others unchecked)

**Contact Info**
- ✅ Name
- ✅ Email Address
- ✅ Phone Number

**Health & Fitness**
- ✅ Health
- ✅ Fitness

**Location**
- ✅ Precise Location
- ❌ Coarse Location — do NOT tick

**User Content**
- ✅ Photos or Videos
- ✅ Emails or Text Messages  *(this is the bucket for in-app direct messages)*
- ✅ Other User Content  *(posts, comments, profile fields)*

**Identifiers**
- ✅ User ID
- ❌ Device ID — skip

**Usage Data**
- ✅ Product Interaction

**Diagnostics**
- ✅ Crash Data
- ✅ Performance Data
- ✅ Other Diagnostic Data

> Do NOT tick: Payment/Financial Info, Purchases, Browsing History, Search History, Contacts,
> Audio Data, Sensitive Info. (You don't collect these.)

## Step 2 — For every ticked type Apple asks 3 questions. Answers:

- **Used to track users?** → **No** — for *every* type.
- **Linked to the user's identity?** → **Yes** — for *every* type.
- **Purpose?**
  - Name, Email, Phone, Health, Fitness, Precise Location, Photos or Videos,
    Emails or Text Messages, Other User Content, User ID → **App Functionality**
  - Product Interaction, Crash Data, Performance Data, Other Diagnostic Data → **Analytics**
    (these flow to PostHog / error logging)

## Step 3 — "Do you use data to track users across apps and websites owned by other companies?"
→ **No.**
(You ship no ad SDKs and PostHog uses hashed IDs — so there's no App Tracking Transparency prompt,
and `NSPrivacyTracking=false` in the manifest matches this.)

---

## Export compliance (you probably won't even see this)
During upload Apple reads `ITSAppUsesNonExemptEncryption = false` from `Info.plist` and **skips**
the encryption questions. If you're ever asked anyway: *"Uses standard encryption (HTTPS + standard
AES); qualifies for exemption — no documentation upload required."*

## Privacy Policy URL field
`https://tugympr.com/privacy`

## Account deletion (Apple requires the URL too)
Support URL / review notes already point to in-app deletion (Settings → Delete Account) and the
web form `https://tugympr.com/eliminar-cuenta`.

# TuGymPR Compliance Documentation Pack

This folder contains the compliance and legal documentation required for the TuGymPR app submission to the **Apple App Store** and **Google Play Store**, plus the public-facing privacy and account-deletion artifacts that those stores require to be hosted on `tugympr.com`.

All documents are **drafts/templates**. Bracketed placeholders (`[INSERT ...]`) must be confirmed by the listing owner before publication or submission, and a qualified attorney should review the privacy policy and rewards terms for jurisdiction-specific phrasing.

---

## Index

| File | Purpose |
|---|---|
| [`APP_REVIEW_NOTES.md`](./APP_REVIEW_NOTES.md) | Text to paste into App Store Connect's "Notes for Review" field. Pre-empts the IAP question (Guideline 3.1.3(c) Enterprise Services), explains the AI photo flow, HealthKit scope, Live Activities, Watch app value, Wallet pass purpose, Rewards/Referral test steps, and the Capgo OTA disclosure (Guideline 4.7). |
| [`PLAY_DECLARATIONS.md`](./PLAY_DECLARATIONS.md) | Pre-written justifications for the Google Play Console — sensitive permission declarations (camera, media, activity recognition, foreground service `health`), per-type Health Connect permission justifications, full Data Safety form answers (5 data categories), and Health Apps requirements. |
| [`PRIVACY_POLICY_OUTLINE.md`](./PRIVACY_POLICY_OUTLINE.md) | Section-by-section outline for the privacy policy hosted at `tugympr.com/privacy`. Names every third-party processor (Supabase, OpenAI, PostHog, Apple APNs, Google FCM, Capgo), discloses AI photo handling, HealthKit/Health Connect non-advertising commitment, retention windows, user rights, and links to both in-app and web account-deletion paths. |
| [`REWARDS_TERMS_TEMPLATE.md`](./REWARDS_TERMS_TEMPLATE.md) | Template the gym operator attaches to TuGymPR member onboarding. Clarifies that points have no cash value, may be modified or discontinued, includes sweepstakes/contest disclaimer, frames the referral program as a loyalty perk (not a financial incentive), and addresses tax reporting for high-value rewards. |

The web account-deletion page is hosted directly on `tugympr.com/eliminar-cuenta`. Its form submits to the `request-account-deletion` Supabase edge function, and the verification link routes to `?token=<token>` which calls `confirm-account-deletion`. See `gym-app/supabase/functions/{request,confirm}-account-deletion/index.ts`.

---

## Suggested Submission Workflow

1. **Legal review.** Hand `PRIVACY_POLICY_OUTLINE.md` and `REWARDS_TERMS_TEMPLATE.md` to counsel. Resolve all `[INSERT ...]` placeholders.
2. **Publish public docs.** Host the finalized privacy policy at `https://tugympr.com/privacy`. The `https://tugympr.com/eliminar-cuenta` page should POST its form to the `request-account-deletion` edge function and, when loaded with `?token=<token>`, POST the token to `confirm-account-deletion`.
3. **App Store Connect.** Fill demo credential placeholders in `APP_REVIEW_NOTES.md` and paste the body into the "Notes for Review" field. Confirm `ITSAppUsesNonExemptEncryption=false` is consistent with the encryption export answer.
4. **Play Console.** Use `PLAY_DECLARATIONS.md` to fill the Permissions Declaration form, the Data Safety form, and the Health Apps declaration. Confirm the Verified Organization Account is in place.
5. **Onboarding flow update.** Surface `REWARDS_TERMS_TEMPLATE.md` (gym-customized) inside the in-app onboarding's terms-acceptance step.

---

## Out of Scope (Intentionally Not Included)

- DPA templates with sub-processors (handled directly with Supabase/OpenAI/PostHog under their standard agreements).
- SOC 2 / ISO 27001 documentation.
- Gym-operator B2B Master Services Agreement.
- TuGymPR public Terms of Service for the marketing site.
- Cookie consent banner / cookie policy for `tugympr.com` (separate web compliance).

If any of these are needed, request them as a separate task.

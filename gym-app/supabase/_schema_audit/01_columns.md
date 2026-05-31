<!-- LIVE SCHEMA — public tables + columns, pasted from Supabase SQL editor on 2026-05-30.
     This is GROUND TRUTH (reflects the live DB, BEFORE migrations 0464-0468 are applied).
     Full content is in the conversation; this header marks the file as the audit baseline.
     Re-paste the full markdown table dump below if you want it version-controlled. -->

# Live schema column dump — see conversation for full content

Key facts extracted for the audit:
- profiles has NO `age`, `sex`, `height_inches`, `email`, or `phone` columns. It HAS `phone_number`, `date_of_birth`, `gender`, `bodyweight_lbs`.
- member_onboarding HAS `age`, `sex`, `height_inches`, `gender`, `height_cm`, `weight_kg`, plus fitness fields.
- profile_lookup ALREADY has `additional_roles` (_user_role) in the live DB.

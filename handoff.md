# Retention Machine — Session Handoff

**Date:** 2026-05-20.
**Previous handoff** (from 2026-05-15, covers unrelated loading-screen + recovery-button issues): see `HANDOFF.previous.md`.
**Last commit:** `475096b` — "Retention machine end-to-end..." — pushed to `origin/main`.

This doc captures the full state of the retention build so a fresh Claude session (or you, after a break) can pick up exactly where this one left off. Optimized for a Claude agent to skim in one read.

---

## The thesis (do not violate)

TuGymPR is a white-label B2B SaaS retention platform for ~1,800 Puerto Rico gyms.

**Software is the memory prosthetic. The owner's attention is the actual retention product.** Every auto-feature either:
- Helps the owner deliver real witnessing (queue, print cards, exit survey insights), OR
- Stays clearly system-generated so it doesn't *pretend* to be human (lifecycle pings, win-back, milestone celebrations)

Two specific rules locked in this session:

1. **Print cards are the ideal touchpoint.** The owner physically writes on the card and hands it over. Everything else is "preprogrammed" and lower-thesis. When ranking features by impact, prefer ones that *prompt the owner to deliver attention* over ones that simulate it.
2. **The platform never promises specific gym offers.** "Free month back", "half off", "free trainer session" are gym-owner business decisions, not platform decisions. Default win-back copy is acknowledgment-only. Per-gym templates can layer in specific offers via the editor at `/admin/message-templates`.

**PR economy constraints** (drives "what we can afford"):
- Avg membership ~$50/mo, ~$500 LTV
- <1% revenue ceiling for retention spend per member = ~$5–10/yr max
- Killed: Lob mail, catered events, trainer cash bonuses, paid SMS bursts
- Allowed: digital pushes, in-app notifications, owner-labor analog touches (print-in-gym cards ~$0.07/card)

---

## What got built in this session (migrations 0395 → 0411)

All 17 migrations are deployed to the live Supabase instance and pushed to GitHub.

| # | What | Key tables / functions |
|---|------|------------------------|
| 0395 | Weekly attendance flag (Hormozi ≤2-sessions/wk past day-14) | `member_weekly_attendance_flags` + Mon 03:00 UTC cron |
| 0396 | Cancellation exit survey | `cancellation_reasons` (7-category enum) + `get_cancellation_reason_breakdown` RPC |
| 0397 | `gyms.monthly_price` + `gyms.currency` + LTV math | `get_gym_ltv_estimate` RPC |
| 0398 | Retention orchestrator (the brain) | `member_outreach_state` + `owner_queue_items` + `run_retention_orchestrator()` daily 09:00 UTC |
| 0399 | Print cards queue + daily auto-generation | `print_cards` + `generate_print_cards_daily()` (welcome / milestone_25/100/500 / returning) at 04:00 UTC |
| 0400 | Lifecycle messages V1 (in-app only) | `lifecycle_message_log` + `run_lifecycle_messages_daily()` at 14:00 UTC, Day 1/3/7/14/21/30 |
| 0401 | Lifecycle push delivery (trigger → `pg_net` → `send-push-user`) | `fire_lifecycle_push()` AFTER INSERT trigger |
| 0402 | Win-back automation (Day 7/30/60 post-cancel) | `winback_message_log` + `run_winback_messages_daily()` at 15:00 UTC + push trigger |
| 0403 | Per-gym template overrides | `message_templates` table + refactored `lifecycle_template()` / `winback_template()` lookups |
| 0404 | Effectiveness RPC | `get_retention_effectiveness(gym_id)` returns JSONB |
| 0405 | Status change audit log | `membership_status_history` + AFTER UPDATE trigger on profiles + backfill |
| 0406 | Morning queue push for owner | `send_owner_queue_push()` daily 11:00 UTC (7am AST) |
| 0407 | 12-week trend in effectiveness panel | extends 0404 RPC with weekly bucket array |
| 0408 | Member-facing cancel save flow | `cancellation_save_attempts` table |
| 0409 | Milestone push notifications | `milestone_push_log` (workouts_10/25/50/100/200/500) + daily cron at 16:00 UTC + trigger |
| 0410 | Member-facing reflection of owner attention | `resolve_queue_item(item_id, outcome, note)` RPC — when outcome is `reached_out` or `returned`, inserts "Your gym noticed you" notification for the member |
| 0411 | Template A/B variants | adds `variant_label` to `message_templates` + logs which variant was sent + push triggers pin to the chosen variant |

**Cron prerequisite** (one-time setup in Supabase SQL editor, same as migration 0033 already requires):
```sql
SELECT vault.create_secret('<your-supabase-url>',     'supabase_url',     'Project URL');
SELECT vault.create_secret('<your-service-role-key>', 'service_role_key', 'Service role key');
```
If these aren't set, the push triggers gracefully no-op (in-app notifications still fire). If you suspect push isn't working post-deploy, this is the first thing to check.

---

## UI surfaces shipped

### Admin
- **`/admin`** — `MorningQueuePanel` placed prominently above KPI strip (today's conversations)
- **`/admin/churn`** — 7 tabs: Retention Board, Churned, Win-Back, **Why they left** (new), **Cards** (new), **Effectiveness** (new), Campaigns
- **`/admin/analytics`** → Growth tab — **LTV widget** (new) + **12-week trend chart** (new)
- **`/admin/settings/gym-info`** — Monthly price + Currency fields (new)
- **`/admin/message-templates`** (new route) — template editor with Lifecycle/Win-back tabs, edit modal with live `{{first_name}}` preview, reset-to-default
- **`/admin/print-cards/preview?ids=…`** (new route) — Avery 8371 print layout for selected cards

### Member-facing
- **`MemberSettings`** — `CancellationSaveModal` opens before the typed-DELETE confirm. Three CTAs: stay / pause (→ `membership_status='frozen'`) / proceed-to-cancel
- **`CancellationSurveyModal`** (admin-triggered) — now shows prior-cancellations banner + amber "Repeat reason" callout when same category as last cancellation
- **`CancellationSaveStep`** (admin) — Hormozi-style save attempt with 3 chips, fires before survey modal opens

### Removed in this session
- Admin sidebar "Ir a... ⌘K" search bar trigger
- Mobile top-bar round search icon
- (The underlying `GlobalSearch` modal + ⌘K keyboard shortcut are still wired up — silent. Delete them entirely if user asks.)

---

## Bugs found in the audit pass + fixed live

1. **Admin Cancel button was unreachable.** `getStatusActions()` in `MemberDetail.jsx` didn't expose `'cancel'` for any status. Fixed: added to active/frozen/deactivated.
2. **`PrintCardsView.jsx` hardcoded English** — toolbar, empty state, "Print" button. Fixed: added `useTranslation`, 6 new keys in EN+ES (`admin.printCards.previewDocTitle`, `previewToolbarTitle`, `printBtn`, `previewLoading`, `previewBatchEmpty`, `cardForLabel`).
3. **`admin.cancellationSave.*` keys missing entirely** — `CancellationSaveStep.jsx` referenced 16 keys but the JSON block didn't exist. Modal rendered English defaults regardless of locale. Fixed: added full block to EN+ES.
4. **`tc()` namespace bug** — `CancellationSurveyModal.jsx` and `CancellationSaveStep.jsx` defined `tc = (k) => t('admin.common.${k}')` but `admin.common.*` doesn't exist in pages.json. UI was leaking raw `admin.common.cancel` strings. Fixed: changed both files to `const { t: tc } = useTranslation('common');` matching `MemberDetail`'s pattern.
5. **`outreachSender.js` 400 errors** (fixed earlier in session): was using `notification_type='admin_outreach'` which isn't in the enum. Changed to `'admin_message'`.

---

## Known issues / cosmetic TODOs

Not blocking, but flag-worthy:

- **Plural grammar in AdminOverview**: `"32 miembro en riesgo crítico de baja"` should be `"miembros"`. Fix lives in `NeedsAttentionCard.jsx` — needs `_plural` suffix on the count key.
- **Channel capitalization** in AdminChurn → Win-Back tab → "Atribución de Contacto": `"sms: 1 enviados"` is lowercase while siblings (`Mensaje:`, `Recuperación:`) are capitalized. Should be uppercase `SMS`.
- **"Por qué se fueron" plural**: `"0 cancelación"` → `"0 cancelaciones"`.

---

## What couldn't be tested in this session

- **Member-side `CancellationSaveModal`** — current login (`Leonel Llorens`) is admin-only role. Code-reviewed and verified i18n is correct. To exercise end-to-end you'd need a member login or to use the view switcher.
- **`MorningQueuePanel` resolve flow** — the queue is empty right now. Will populate once `run_retention_orchestrator()` cron fires daily at 09:00 UTC (or you can invoke it manually via service_role: `SELECT * FROM run_retention_orchestrator();`).
- **Win-back end-to-end** — needs a member with status='cancelled' AND a `cancellation_reasons` row. Manually flip one for testing.
- **Print cards rendering on actual Avery 8371 cardstock** — only browser-tested.
- **Trainer + Platform routes** — out of scope this session.

---

## Conventions to respect

- **i18next v3 compat** — pluralization uses `key` + `key_plural` suffix (NOT `_one`/`_other`)
- **Admin components** import from `gym-app/src/components/admin` — `AdminCard`, `AdminModal`, `AdminPageShell`, `PageHeader`, `FadeIn`, `AdminTabs`, `SectionLabel`, `Avatar`
- **TanStack Query** for all data fetching. Cache keys via `adminKeys` in `gym-app/src/lib/adminQueryKeys.js`
- **White-label theming** via CSS variables: `var(--color-accent)`, `var(--color-bg-card)`, `var(--color-text-primary)`, etc. Don't hardcode hex unless intentional (e.g., status colors like `#EF4444` for danger)
- **Push delivery pattern**: trigger fires `pg_net.http_post` to `/functions/v1/send-push-user`, secrets from `vault.decrypted_secrets`. Always wrap in `IF v_url IS NULL OR v_key IS NULL THEN RAISE LOG ...; RETURN NEW; END IF;` so missing vault doesn't break the underlying insert
- **Migration patterns** to mirror:
  - Cron + pg_net + vault: see `0033_churn_cron_jobs.sql`
  - Trigger fires push: see `0401_lifecycle_messages_push.sql`
  - SECURITY DEFINER + auth check: see `0397_gyms_monthly_price.sql`
- **Commit author**: `leollrs <leollorens04@gmail.com>` (don't change git config — pass via `git -c user.email=... -c user.name=...` if needed)

---

## Key file paths cheat sheet

```
Migrations
  gym-app/supabase/migrations/0395_member_weekly_attendance.sql
  ... through 0411_template_ab_variants.sql

Admin pages
  gym-app/src/pages/admin/AdminMessageTemplates.jsx   (NEW route /admin/message-templates)
  gym-app/src/pages/admin/PrintCardsView.jsx          (NEW route /admin/print-cards/preview)
  gym-app/src/pages/admin/AdminChurn.jsx              (added 3 new tabs)
  gym-app/src/pages/admin/AdminAnalytics.jsx          (LTV card + 12-week trend)
  gym-app/src/pages/admin/AdminOverview.jsx           (MorningQueuePanel placement)
  gym-app/src/pages/admin/AdminSettingsGymInfo.jsx    (monthly_price field)

Admin components (all new)
  gym-app/src/pages/admin/components/MorningQueuePanel.jsx
  gym-app/src/pages/admin/components/QueueItemResolveModal.jsx
  gym-app/src/pages/admin/components/CardsToPrintPanel.jsx
  gym-app/src/pages/admin/components/WhyLeftPanel.jsx
  gym-app/src/pages/admin/components/CancellationSaveStep.jsx
  gym-app/src/pages/admin/components/CancellationSurveyModal.jsx
  gym-app/src/pages/admin/components/RetentionEffectivenessPanel.jsx
  gym-app/src/pages/admin/components/analytics/LTVCard.jsx

Member components
  gym-app/src/components/profile/CancellationSaveModal.jsx   (NEW)
  gym-app/src/pages/MemberSettings.jsx                       (wired into cancel flow)

Translations
  gym-app/src/i18n/locales/en/pages.json   ← namespaces: cancellation.saveModal, admin.cancellationSurvey, admin.cancellationSave, admin.messageTemplates, admin.effectiveness, admin.morningQueue, admin.printCards, admin.whyLeft, admin.ltv, admin.churn.tab{Cards,Effectiveness,WhyLeft}
  gym-app/src/i18n/locales/es/pages.json   ← mirrored
  gym-app/src/i18n/locales/en/common.json  ← adminNav.messageTemplates + advancedDesc.messageTemplates
  gym-app/src/i18n/locales/es/common.json  ← mirrored

Routing / layout
  gym-app/src/App.jsx                      ← added /admin/message-templates + /admin/print-cards/preview
  gym-app/src/layouts/AdminLayout.jsx      ← added message-templates to ADVANCED_PAGES, REMOVED search bar
  gym-app/src/lib/adminQueryKeys.js        ← added ownerQueue, printCards, messageTemplates keys
```

---

## How to resume

If you're a fresh Claude session being briefed, read this order:

1. **`gym-app/CLAUDE.md`** — full app context
2. **`memory/MEMORY.md`** then `memory/project_retention_thesis.md` + `memory/project_pr_gym_economics.md` — the locked thesis
3. **This file (`HANDOFF.md`)** — what's been built and what's pending
4. **`gym-app/supabase/migrations/0395_*.sql` through `0411_*.sql`** — read the header comments of each migration in order. They explain the *why* alongside the schema.

Quick "what should I work on next?" decision tree:

- **Is the app deployed and tested end-to-end?** Migrations are deployed. UI is live. What's *not* tested yet: member-side cancel save flow (need a non-admin login), queue resolve flow (queue is empty until cron fires), win-back end-to-end (need a cancelled test member).
- **Most-impactful follow-ups:**
  - The 3 cosmetic plural/capitalization fixes flagged above
  - Behavioral triggers: "missed Day 5 workout", "haven't logged after lifecycle Day 7"
  - Effectiveness cohort view (using migration 0405's status history)
  - Owner queue effectiveness drill-down (per-owner resolution rate)
  - Template A/B test results display in `AdminMessageTemplates`

Lower-priority / explicitly out of scope unless asked:
- A/B test framework UI (foundation exists in 0411, no admin UI yet)
- Trainer-side retention work
- Native push for member-facing reflection (currently in-app only)

---

## Last incident in this session

User reported `ERR_NAME_NOT_RESOLVED` for `erdhnixjnjullhjzmvpm.supabase.co` AND `us.i.posthog.com` simultaneously while trying to send a push via `/admin/outreach`. **That's a local DNS/network issue, not a code bug.** Both unrelated external services failing at DNS lookup → user's machine can't resolve hostnames. Fix: check internet → toggle WiFi → `ipconfig /flushdns` → disconnect VPN if any. Vite dev server also moved ports (`:5173` → `:5175`) during that incident, so a hard refresh was also needed.

If you see similar symptoms again, don't go hunting for a code bug — it's the network.

# HANDOFF — Member Pages Debugging Session

Paste this into a fresh session to work on the **member-facing app**. Admin side is
done (fully restyled + debugged). This session = go through the member pages,
fix bugs/rough edges, then later wire member ↔ admin flows.

---

## 0. How we work (STANDING RULES — do not break)

- **You (Claude) WRITE migrations + edge functions; the USER applies/deploys them.** Never connect to the DB directly, never ask for or handle `sbp_`/service-role tokens in the shell.
- **Build from the project dir:** `cd /Users/leollorens/gym-app-new/gym-app` first (cwd resets between Bash calls — always prefix `cd`).
- **Verify every change with a green build before declaring done:** `npm run build` → expect `✓ NNNN modules transformed` (currently ~4818). The Supabase dynamic-import warning is pre-existing/harmless — ignore it.
- **Everything stays UNCOMMITTED** — the user commits on their own cadence. Don't commit/push unless asked.
- **Workflow for this session:** the USER drives. They navigate the member app page-by-page and report what's wrong (bug, broken/empty state, ugly spacing, wrong copy, console error). You fix that one thing, build-verify, move on. Don't go restyle everything unprompted — wait for instructions per page.
- **No design handoff for member pages** (unlike admin). The member app already has its own shipped design — this is a **debug/polish pass**, not a restyle, unless the user says otherwise.

---

## 1. Project

- **TuGymPR** — white-label B2B gym churn-reduction SaaS. React 18 + Vite + Tailwind + Supabase. i18n EN/ES (i18next, `compatibilityJSON: 'v3'`).
- Roles: member · trainer · admin · super_admin. Multi-tenant by `gym_id`, RLS on all tables.
- Full product reference: **`CLAUDE.md`** at the project root (read it — it's the source of truth for features).

---

## 2. Member app map

**Member nav (Strava-style bottom bar / desktop sidebar):** `src/components/Navigation.jsx`
Primary tabs: Home `/` · Workouts `/workouts` · **Record `/record`** (center primary) · Progress `/progress` · Community `/community`.

**Routing:** `src/App.jsx` — member routes live under the `/*` `<ProtectedRoute>` → `<MemberRoutes>`; there's a route→component map (~line 890). Member pages are lazy-loaded.

**Top-level member pages (`src/pages/*.jsx`):**
Dashboard (home `/`) · Workouts · WorkoutBuilder · ActiveSession · SessionSummary · WorkoutLog · ExerciseLibrary · QuickStart (`/record`) · Progress · BodyMetrics · Strength · PersonalRecords · Nutrition · LiveCardio · CardioSessionDetail · Challenges · Leaderboard · Community · SocialFeed · Messages · Notifications · NotificationSettings · Rewards · Referrals · CheckIn · Classes · MyGym · HealthSync · Profile · PersonalInfo · MemberSettings · Support · LegalViewer · Onboarding · Login · Signup · ResetPassword · PublicTrainerProfile · TVDisplay.

> Note: `Challenges.jsx`, `TVDisplay.jsx`, `Login.jsx`, `Classes.jsx`, etc. were touched late in the admin session (see §5) — they build green but member-side behavior is worth a sanity check.

---

## 3. Design system (MEMBER side)

- Member pages use the **general** theme CSS vars (warm palette): `--color-bg`, `--color-bg-card`, `--color-text-primary` (#1C1917), `--color-text-secondary/-muted/-subtle`, `--color-border-subtle/-default`, `--color-bg-hover/-active`, plus `--color-accent` (white-label, per-gym), `--color-danger/-success/-warning`.
- Fonts: **Barlow** (body) + **Barlow Condensed** (headings). Dark/light via `html.dark` class (ThemeContext).
- **`retosKit` (`src/pages/admin/components/retosKit.jsx`) is ADMIN-ONLY** — it maps to the cooler `--color-admin-*` family. Do NOT pull retosKit into member pages. Member pages have their own components/styling.
- Shared admin pagination component `src/components/admin/AdminPagination.jsx` exists (Miembros style) — admin-only; member lists have their own patterns.
- White-label: per-gym colors injected at runtime (`applyBranding`/`applyGymTheme`). Never hardcode the accent — use `var(--color-accent)`.

---

## 4. Conventions / gotchas

- **i18n files:** `src/i18n/locales/{en,es}/pages.json` and `.../common.json`. Canonical **2-space, NO trailing newline**. Edit via Node round-trip (`JSON.parse` → `JSON.stringify(obj, null, 2)`) so the diff is additive-only. After a Node script rewrites a file, a follow-up Edit tool call fails "modified since read" → re-Read first.
- **RECURRING BUG — English-in-ES:** a `t('key', 'Default')` whose key is NOT in the JSON renders the *default* in BOTH locales. Whenever you add a `t()` call, add the key to **both** en + es. To sweep a page: extract its `t('...')` keys and check each exists in es (and en).
- **Data/state:** TanStack React Query via `src/hooks/useSupabaseQuery.js` (domain hooks, e.g. `useNotifications(userId, audience)`). `AuthContext` exposes `user`, `profile`, `gymName`, branding, `unreadNotifications`, `refreshNotifications`, `unreadAdminNotifs`/`refreshAdminNotifications`, `availableRoles`, `activeView`. Supabase client is `src/lib/supabase.js` (always sends apikey — a "No API key" error means a raw REST URL opened in the browser, NOT an app bug).
- **Resilient writes:** when a new DB column may not be deployed yet, try-with-new-col then retry-without on `isMissingColumn` (Postgres `42703` / PostgREST `PGRST204`).
- **Card gotcha (admin only, but be aware):** retosKit `Card` hardcodes its own className — a passed `className` is ignored; wrap in an outer div for responsive classes.

---

## 5. Safety nets shipped this session (member-relevant)

- **App-wide error recovery:** `src/components/ErrorBoundary.jsx` (themed, bilingual "Hubo un error" / "Reiniciar") + `src/components/RouteErrorBoundary.jsx` (returns user to last good page via `src/lib/lastGoodPath.js`). A page crash shows the recovery screen, logs to `error_logs`, and notifies super admins (migration 0517). So if you crash a member page while testing, you'll see "Hubo un error" — that's expected, tap Reiniciar.
- **Deep-link through auth:** logged-out user hitting a protected route → `RedirectToLogin` stores the path in `sessionStorage('postLoginRedirect')` → after login, `PublicRoute` restores it. `Login.jsx` no longer self-navigates (PublicRoute owns post-login redirect). Member `/challenges?challenge=<id>` deep-link focusing already wired (Challenges.jsx scrolls to `#ch-<id>`).
- **TV challenge QR** uses canonical URL (`PROD_WEB_URL` in dev, real origin in prod) from `src/lib/appUrls.js`.

---

## 6. ⚠️ Pending — USER must apply migrations

Supabase migrations **0512 → 0518** are written but NOT applied yet (assistant writes, user applies):
- 0516 gym_closures special hours, 0517 super-admin crash alerts trigger, 0518 TV leaderboard period (+ `admin_set_tv_period`), plus 0512–0515.
After deploying, **hard-refresh once** (service worker caches the JS bundle — a fix can look "not applied" until the cached bundle swaps).

---

## 7. Roadmap (where this fits)

1. **Member pages** ← *you are here* (debug/polish, page by page)
2. member ↔ admin cross-role flows (admin creates challenge/announcement/program → member sees & acts)
3. trainer: trainer ↔ member, trainer ↔ admin
4. super admin: permissions audit (every role boundary holds)
5. Privacy policy + T&C + website
6. Publish iOS + Android
7. Ads / promo → first gym

---

## 8. Continuity / memory

Persistent project memory lives at `/Users/leollorens/.claude/projects/-Users-leollorens-gym-app-new/memory/` — `MEMORY.md` (index) + topic files (`project_admin_restyle.md`, `project_error_recovery.md`, `reference_full_schema_map.md`, etc.). It auto-loads each session; skim the index for prior decisions. (It's over its size budget — consider running the consolidate-memory skill at some point, not urgent.)

---

**First move in the new session:** confirm a green build (`cd /Users/leollorens/gym-app-new/gym-app && npm run build`), then say you're ready and wait for the user to report the first member-page issue.

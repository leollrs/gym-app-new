# Handoff — TuGymPR

Last updated: 2026-05-15. Picks up mid-session work after repeated chat resets.

---

## Recently shipped (on `main`, on device)

| Commit | What |
| ------ | ---- |
| `f0527fc` | Personal Info save: missing column + wrong table name. New migration `0392_profiles_metric_units.sql` adds `profiles.metric_units`, `get_auth_context` returns it, AuthContext fallback select + `PATCHABLE_FIELDS` updated, `body_metrics` → `body_weight_logs` (upsert on `profile_id,logged_at`), `.error` checks on all 3 writes so failures surface instead of false "Saved". |
| `042dcc3` | Personal Info save: send `gym_id` in `member_onboarding` upsert. `member_onboarding.gym_id` is NOT NULL with no default — caused 23502 on insert path. |
| `cbb7e4c` | (Superseded) First pass at female muscle map — shared bucket map with relabelled JSON. |
| `08c5ae4` | (NOT mine — landed between my commits) Switched female mapping to **separate `*_FEMALE` bucket maps**, so `src/data/muscleRegionsFemale.json` consumes raw trace IDs (no relabel). This is the current design. |
| `1dbc855` | Female muscle trace: re-sync user's polygon line fixes (straight copy of `public/` → `src/data/`). |

iOS device install state: latest `1dbc855` is installed on device UDID `00008140-00141DA03E13801C`.

---

## Open issues (user just raised, NOT done)

### 1. Loading screen loop → black screen (HIGH priority)

User report verbatim:
> "the taking longer, checking connection... rn it shows that, resets after a couple seconds, shows it again and then when it resets goes to that black screen. if i close the app and restart its fixed but that shouldn't happen."

**What we built earlier (working as intended in the happy path):**
- `AuthContext.jsx:584` — `initLoadTimeout = setTimeout(() => setLoading(false), 6000)` hard cap on init loading gate
- `App.jsx:198-295` — `LoadingScreen` with internal 4s `slow` timer that shows the "Taking longer than usual — check your connection" hint
- `StuckLoadingRecovery.jsx` — 10s watchdog that auto-resets caches + reloads with `?reset=<ts>`. Falls back to manual "Restablecer" banner if it already auto-recovered within 120s
- `main.jsx` — top-level `<ErrorBoundary>` wraps the provider tree

**Root-cause hypothesis (not yet verified):**

The "show → reset → show again → black" pattern is `LoadingScreen` mounting → unmounting → remounting. Each remount restarts its own 4s `slow` countdown, hence "shows it again."

Suspect path:
1. Cold boot, `loading=true`, LoadingScreen mounts → 4s in, "taking longer" appears
2. 6s `initLoadTimeout` fires → `setLoading(false)` → LoadingScreen unmounts ("resets after a couple seconds")
3. `onAuthStateChange` fires `SIGNED_IN` event (e.g. session restore on slow wifi) → `AuthContext.jsx:664` calls `setLoading(true)` → LoadingScreen remounts ("shows it again")
4. `fetchProfile` (`AuthContext.jsx:148`) hangs or errors → the `try/finally` at line 538-540 should always `setLoading(false)`, but if the RPC times out silently and the finally runs after the user already navigated, the rendered tree might be partial → black
5. Alternatively: `StuckLoadingRecovery` is detecting empty `#root` (its threshold is 10s, `MIN_MEANINGFUL_TEXT=60`) and triggering `resetAppCaches()` → blank background flash during reload = "black screen"

**Fix candidates (pick after verifying):**
- Gate `setLoading(true)` on `SIGNED_IN` so it only fires when there's no current user (genuine sign-in, not session-restore re-emission). Today it re-sets unconditionally.
- If `cachedProfile` exists, never gate the app on `loading` — show the app immediately, refresh in background. Currently `AuthContext.jsx:111` only does this if cache is <24h old.
- Wrap `fetchProfile` in a hard `AbortController` timeout so it can't dangle.
- Investigate whether `StuckLoadingRecovery` is misfiring on slow-but-progressing boot (raise threshold, or skip auto-recover if `loading===true` from useAuth).

**Original symptom (from earlier session):** `[reject] Lock was stolen by another request` — gotrue auth lock contention, probably caused by SW + main thread both attempting token refresh, or a route reload happening during refresh.

**Key files for the next session:**
- `gym-app/src/contexts/AuthContext.jsx` — lines 111 (initial state), 148 (`fetchProfile`), 538-540 (finally setLoading false), 584 (6s timeout), 657-666 (SIGNED_IN handler)
- `gym-app/src/App.jsx` — lines 198-295 (LoadingScreen), line ~650 (`if (loading) return <LoadingScreen />`)
- `gym-app/src/components/StuckLoadingRecovery.jsx` — full file, especially `STUCK_THRESHOLD_MS=10_000` and `rootIsEmpty()`
- `gym-app/src/main.jsx` — ErrorBoundary mount point
- `gym-app/src/lib/resetAppCaches.js` — what gets wiped on auto-recover

### 2. Recovery button on rest days

User report verbatim:
> "In rest days, at the top next to the restore workout button, we should have the recovery page button"

**Investigation findings:**
- Dashboard recovery pill: `gym-app/src/pages/Dashboard.jsx:1463-1481` — `<button onClick={() => setReadinessOpen(true)}>` with `Activity` icon. **Only renders when `isToday && hasTrainedToday`** — so it's hidden on rest days because `hasTrainedToday` is false.
- Next to it at lines 1481-1494: "Recently deleted" button (History icon) opening `setShowDeletedModal(true)`. **This is almost certainly the "restore workout" the user means** — restore a recently-deleted workout.
- Rest-day card lower in the file: `gym-app/src/pages/Dashboard.jsx:2056-2070`. Inside the card there's an "Assign Workout Instead" button.

**Likely fix:** Drop the `isToday && hasTrainedToday` gate on the recovery pill (or add a `|| isRestDay` branch) so the pill renders on rest days too, next to the existing History/Recently-Deleted button. The recovery score makes sense on rest days — that's exactly when the user wants to see how rested they are.

**Tiny scope** — one JSX condition change. Don't over-engineer. Verify there isn't another rest-day-specific top-bar block that hides the whole row before changing.

---

## Conventions / gotchas this codebase has

- **Bash cwd persists between calls.** Earlier session's iOS pipeline left cwd at `gym-app/ios/App`; later git commands needed `cd /Users/leollorens/Downloads/gym-app-new-main` first. Use absolute paths or be intentional.
- **Commit hooks rewrite messages and may auto-stage related files.** My exact heredoc commit messages have been rewritten and additional related files staged automatically in past commits. Verify with `git show --stat <sha>` before assuming what's in.
- **Working-tree noise:** `.claude/worktrees/agent-*` always show as modified submodules in `git status`. Ignore. Also `gym-app/public/readiness/muscle-regions-2.json` is locally deleted — pre-existing, unrelated.
- **iOS build pipeline** (when needed; pods unchanged → use `cap copy` not `cap sync`):
  ```
  cd gym-app
  CAPACITOR_BUILD=true npm run build
  npx cap copy ios
  cd ios/App
  # stale build dir — find+delete first, then rm
  chmod -R 777 build 2>/dev/null
  find build -type f -delete 2>/dev/null
  find build -depth -type d -delete 2>/dev/null
  rm -rf build
  rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
    -destination 'id=00008140-00141DA03E13801C' \
    -derivedDataPath build -allowProvisioningUpdates clean build
  xcrun devicectl device install app --device 00008140-00141DA03E13801C \
    build/Build/Products/Debug-iphoneos/App.app
  ```
  Required env: `export PATH="/opt/homebrew/bin:$PATH"; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8`. CocoaPods will crash without LANG.
- **Female muscle map design (current — `08c5ae4`)**: `musclePolygons.js` has `FRONT_POLY_BUCKET_FEMALE` and `BACK_POLY_BUCKET_FEMALE` that spread the male maps and override divergent cells. `src/data/muscleRegionsFemale.json` is a **straight copy** of `public/readiness/muscle-regions-female.json` — NO relabel. If you re-sync after the user re-traces, just `cp` — do not transform.
- **Supabase migrations** are applied by the user via the SQL editor in the dashboard (don't `supabase db push` blindly — migration history is likely out of sync with manually-applied dashboard SQL).
- **Auth-memory `MEMORY.md`** at `/Users/leollorens/.claude/projects/-Users-leollorens-Downloads-gym-app-new-main/memory/` has the user's role/feedback notes. Read it for context.

---

## What I'd do first next session

1. Read `AuthContext.jsx` lines 543-690 and `App.jsx` 180-300 end-to-end. Confirm the SIGNED_IN re-emission hypothesis.
2. Add a console log to count how many times `setLoading(true)` and `LoadingScreen` mounts fire during a slow cold boot, install once on device, get the user to reproduce.
3. Implement the smallest fix that breaks the loop — likely guarding the `SIGNED_IN` setLoading(true) on `!user`.
4. Drop the `hasTrainedToday` gate on the recovery pill (or add `|| isRestDay`).
5. Commit both, rebuild iOS, install.

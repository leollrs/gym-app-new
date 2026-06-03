# Churn Model v3 — Attendance-First Behavioral Retention Model

**Status:** BUILT (2026-06-02), build-green + deno-check clean, uncommitted. Awaiting user
deploy (apply migrations 0508 + 0509 + deploy compute-churn-scores edge fn). v1 deferrals below.

**v3.1 edge-case hardening (per external review):** three new behaviors beyond the spec below —
(1) **`paused` state** (vacation/hold): `membership_status='frozen'` OR `profiles.churn_pause_until > now`
→ excluded from the queue, with a Pause/Resume toggle in the member panel (migration 0509);
(2) **`churned` state**: dormant split into 30–60d *dormant* (95, still in the action queue) vs
≥60d *churned* (100, "Lost", removed from the action queue → Churned tab); (3) **low-frequency
dampening**: Layer A frequency-level penalty ×0.55 when the member is stable at their own cadence,
so a consistent low-frequency member isn't over-penalized by the 3×/wk anchor.

**v1 deferrals (neutral-safe — never produce wrong-direction risk):**
- **Streak integrity (A4)** — engine passes `streakActive:false`/`brokenStreakLen:0`
  (no `streak_cache` fetch wired) → contributes 0. Recency+frequency+velocity already
  capture the "stopped coming" signal. TODO: fetch `streak_cache`.
- **Rewards/card dormancy (Layer B)** — `rewards.baseline:null` → neutral. TODO: wire
  `reward_redemptions`/points-history baseline-vs-recent.
- **Score-history velocity** — edge fn persists `velocity:0` (the meaningful signal is the
  new attendance `trend` column). Live engine still computes it for `velocityLabel`.
- **calibrate-churn-weights edge fn** — NOT rewritten. It writes the old v2 weight columns;
  the v3 scorer reads the new `w_*` columns (NULL → research default 1.0), so calibration is
  simply dormant until that fn is updated. No breakage. TODO when a gym hits ~200 outcomes.
**Supersedes:** v2 (12 flat signals, 100-pt budget, ~45 pts app-dependent) in
`churnSignalsV2.js` + `compute-churn-scores/index.ts`.

---

## 0. Why v3

v2 put **45 of 100 points on optional in-app behavior** (social, goals, nutrition,
app opens, referrals, variety). Two failure modes:

1. **Punishes the old-school member** who just shows up, trains, leaves, and never
   touches the app — they read as "disengaged" when they're a model retained member.
2. **Flags new/imported members Critical** because history-dependent signals can't fire.

v3 fixes both by anchoring on **attendance** (near-universal, the clearest churn
signal) and re-framing engagement as a **signed, baseline-relative** axis:

> **active now = bonus (−) · never adopted = neutral (0) · used before then stopped = risk (+)**

This is the core idea. It rewards engagement, warns on *withdrawal*, and never
penalizes non-adoption. The result is a behavioral retention model, not a usage tracker.

---

## 1. Total budget

| Pool | Range | Notes |
|---|---|---|
| Attendance core (Layer A) | 0 … +70 | the spine — dominant |
| Engagement decline (Layer B) | 0 … +30 | fires ONLY on decline from member's own baseline |
| **Risk subtotal** | **0 … +100** | |
| Protective bonus (Layer C) | −20 … 0 | active engagement only; never penalizes absence |
| Tenure lifecycle multiplier | ×0.85 … ×1.15 | applied to risk subtotal |
| **Final (clamped)** | **0 … 100** | → tier |

Effective swing ≈ −20 to +115 before clamping. Attendance = 70% of risk weight
(per the research: it should support neither be overpowered by engagement).

---

## 2. Layer A — Attendance core (steady-state, tenure ≥ 75 days) — 70 pts

### A1. Recency — 25 pts
Days since last activity `d` = max(last check-in, last session, `last_active_at`).
Exponential growth, τ = 18 days:

```
risk_R = 25 * (1 - e^(-d / 18))
```

| d (days) | risk |
|---|---|
| 0 | 0 |
| 7 | ~8 |
| 14 | ~14 |
| 21 | ~17.5 |
| 30 | ~20 |
| 45+ | ~24 (→ override at 30, see §6) |

### A2. Frequency level — 18 pts
`f` = visits/week over trailing 4 weeks. Anchor = 3×/wk (Hormozi: ≥3 sticks, <2 churns).
Ratio `r = f / max(goal, 3)`:

| r | risk | meaning |
|---|---|---|
| ≥1.0 | 0 | meeting goal |
| 0.66–1.0 | 4 | slightly under |
| 0.50–0.66 | 7 | **2×/wk intervention line** |
| 0.33–0.50 | 11 | |
| 0.16–0.33 | 14 | |
| <0.16 | 18 | |

**Cohort adjustment:** shift the effective anchor by the gym's own frequency
distribution — bottom-quartile attenders +2, top-quartile −2 (self-tunes per gym).
Keep light; absolute anchor dominates.

### A3. Frequency trend / velocity — 17 pts  *(revives the dead `velocity` field)*
`v` = (avg weekly rate, last 2 weeks) / (baseline rate, trailing 8–12 weeks).

| v | risk | trend arrow |
|---|---|---|
| ≥1.0 | 0 | ↑ / → |
| 0.75–1.0 | 4 | → |
| 0.50–0.75 | 9 | ↓ |
| 0.25–0.50 | 13 | ↓↓ |
| <0.25 | 17 | ↓↓↓ |

Persist `velocity` (the ratio) and `velocityTrend` so the admin UI shows real arrows.

### A4. Streak integrity — 10 pts
- Active / intact streak → 0
- **Never had a streak → 0** (no penalty)
- Broke an *established* streak (≥7 protected-day-aware days) recently →
  `10 * min(brokenStreakLen / 30, 1)` (longer the streak was, bigger the signal)

---

## 3. Layer A (onboarding regime, tenure < 75 days) — 70 pts

Replaces A1–A4. New members have no baseline, so we score **habit formation**, not
deviation. (Kaushal & Rhodes 2015: ~4 bouts/wk × 6 wks ≈ habit; PushPress: 12+
check-ins → ~2%/mo churn.)

### O1. Habit-formation gap — 30 pts
Expected cumulative visits by member age (target ramp to ~12 by week 6) vs actual.
`gap = clamp((expected - actual) / expected, 0, 1)` → `risk = 30 * gap`.
Also fold in current weekly rate vs 3×/wk.

### O2. Recency — 28 pts (steeper, τ = 10 days)
Early no-shows are very predictive (first-30-day churn often >20%).

### O3. Activation milestone — 12 pts
First workout/visit logged within first ~7–10 days? If not → full 12.

Engagement decline (Layer B) does **not** apply in onboarding (no baseline).
Bonuses (Layer C) and the insufficient-data grace (§6) still apply.

---

## 4. Layer B — Engagement decline (tenure ≥ 75 days) — 30 pts

Per surface: `baseline` = activity in prior window (days 30–90), `recent` = last 21 days.

```
if baseline < minBaseline[surface]:  contribution = 0   // never adopted / trivial → NEUTRAL
elif recent >= baseline:             contribution = 0   // stable or growing (may earn Layer C)
else: contribution = maxPts[surface] * clamp((baseline - recent) / baseline, 0, 1)
```

| Surface | Max | Source |
|---|---|---|
| App-activity decline | 8 | `last_active_at`, session/open count, notif reads |
| Challenge drop-off | 6 | `challenge_participants` over time |
| Workout-logging drop-off | 6 | `workout_sessions` logged |
| Rewards / card dormancy | 4 | points history, punch-card stamps, wallet |
| Social withdrawal | 3 | friendships, feed activity, DMs |
| Goal / PR dormancy | 3 | goals, personal_records |

**Calibration tag:** Layer B is the plausible-but-literature-untested layer. Tag
these signals; if calibration shows e.g. "stopped logging" just means "trains but
doesn't log," weights shrink toward 0.

---

## 5. Layer C — Protective bonus — cap −20

Active engagement only. **Subtracts** risk; absence is never a penalty. This is the
sales story: the app *creates* churn-protective behavior.

| Bonus | Pts | Active when… |
|---|---|---|
| Active referrer | −5 | referral in last 90d / referred member still active |
| Active in a live challenge | −5 | currently joined an ongoing challenge |
| Recent PRs / milestones | −4 | PR or achievement in last 30d |
| Strong app + card engagement | −4 | app opens above gym median + reward/card activity |
| Active social | −2 | friend interactions in last 30d |

Sum, floor at −20.

---

## 6. Overrides, states & tenure multiplier

**Insufficient-data grace (NEW — fixes the import problem).**
`tenure < 14 days` OR `lifetime check-ins < 4` → state `insufficient_data`.
Display a distinct **"Not enough data"** badge. **Never Critical.**

**Dormant override (baked into the persisted score, unlike v2's read-time patch).**
Never-active past grace, OR `days_since_activity ≥ 30` → `score = 95`, tier `critical`,
driver `dormant`. (>21d ≈ churning per operator data; 30 = hard floor.)

**Tenure lifecycle multiplier** (steady-state only; onboarding uses ×1.0):

| Tenure | × | Rationale |
|---|---|---|
| 75–95 days (~2.5–3 mo) | 1.15 | the month 2–3 valley — highest-value intervention window |
| 3–6 mo | 1.05 | |
| 6–12 mo | 0.95 | |
| 12 mo+ | 0.85 | veterans need a bigger drop to alarm |

---

## 7. The Attendance Gate  *(RULE #2 — guards engagement false positives)*

> "If attendance is strong, engagement decline can raise concern, but not push the
> member above Medium unless attendance also weakens."

Protects the member who stops logging because they switched to freestyle training
but still checks in 4–5×/week — they should never read High/Critical on engagement alone.

```
attendanceStrong = (Layer A risk ≤ 18 of 70)     // attending regularly, recently, no sharp drop
if attendanceStrong: finalRisk = min(finalRisk, 54)   // 54 = top of Medium (High starts at 55)
```

Applied **after** the tenure multiplier, **before** the bonus (bonus only lowers).
When attendance also weakens (Layer A risk > 18), the cap lifts and engagement +
attendance compound normally into High/Critical.

---

## 8. Composition algorithm

```
1. grace:    if tenure < 14d OR checkIns < 4 → {state:'insufficient_data'}; STOP
2. dormant:  if neverActive(past grace) OR daysSinceActivity ≥ 30 → {score:95, tier:'critical', driver:'dormant'}; STOP
3. attRisk = Σ Layer A   (onboarding regime if tenure < 75d)        // 0..70
4. engRisk = (tenure ≥ 75d) ? Σ Layer B : 0                         // 0..30
5. bonus   = Σ Layer C                                              // -20..0
6. risk    = (attRisk + engRisk) * tenureMultiplier
7. if attRisk ≤ 18:  risk = min(risk, 54)                           // §7 attendance gate
8. risk    = clamp(risk + bonus, 0, 100)
9. score   = round(risk, 1)
10. tier   = band(score)                  // ≥80 critical · ≥55 high · ≥30 medium · <30 low
11. driver = classify(attRisk, engRisk)   // §9
12. explanation = build(driver, topSignals)   // §9 — REQUIRED for UI trust
```

Per-gym weights (`gym_churn_weights`) multiply each signal before summing, blended
with defaults via Bayesian shrinkage `learned·c + default·(1−c)`, `c = min(1, labeled/200)`.

---

## 9. Tiers, labels & explanation  *(RULES #5 + #6)*

**Bands:** ≥80 Critical · ≥55 High · ≥30 Medium · <30 Low · + `insufficient_data`.

**Rename (RULE #5):** internal field stays `churnScore` / `risk_tier`. **Display label**
to gym owners = **"Retention Risk"** (EN). ES keeps **"Riesgo de baja"** (already correct
business framing). Page title unchanged ("Inteligencia de Churn" / "Riesgo de Baja").

**Primary driver classification:**
```
attRisk ≥ 30 && engRisk ≥ 12  → 'both'
attRisk ≥ 25                  → 'attendance'
engRisk ≥ 12                  → 'engagement'
score < 30                    → 'healthy'
else                          → 'attendance'
```

**Explanation string (REQUIRED — RULE #6). Trust comes from showing the reason.**
The flagship case: a member at 3×/week marked Medium must show *why*, or the owner
thinks the model is wrong.

| Driver | EN explanation | ES |
|---|---|---|
| engagement (attendance strong) | "Attendance is stable, but engagement dropped sharply from previous behavior." | "La asistencia es estable, pero la participación cayó bruscamente frente a su comportamiento anterior." |
| attendance | "Hasn't checked in for {d} days (was {f}×/week)." | "No asiste hace {d} días (antes {f}×/semana)." |
| both | "Attendance is falling and app engagement has dropped." | "La asistencia está bajando y la participación en la app cayó." |
| dormant | "No activity for {d}+ days." | "Sin actividad hace más de {d} días." |
| new (onboarding) | "New member — not yet building a routine ({v} visits in {w} weeks)." | "Miembro nuevo — aún no establece rutina ({v} visitas en {w} semanas)." |

---

## 10. Data sources

All already fetched by the current engine — v3 is mostly **recomposition**, not new pipelines.

| Signal | Tables |
|---|---|
| Recency / Frequency / Velocity | `check_ins`, `workout_sessions`, `profiles.last_active_at` |
| Streak | `streak_cache` |
| Tenure | `profiles.membership_started_at` / `created_at` |
| App-activity | `profiles.last_active_at`, `notifications` (read), session count |
| Challenge | `challenge_participants` |
| Logging | `workout_sessions` |
| Rewards/card | points history, punch-card stamps, wallet pass |
| Social | `friendships`, activity feed, `direct_messages` |
| Goals/PRs | `goals`, `personal_records` |
| Referral | `referrals` |
| Cohort percentile | gym-wide frequency distribution |

---

## 11. Implementation checklist (NO CODE YET)

- [ ] `supabase/functions/compute-churn-scores/index.ts` — rewrite signal set, composition,
      attendance gate, baked dormant override, grace, velocity, driver + explanation
- [ ] `src/lib/churn/churnSignalsV3.js` — new (mirror of edge fn)
- [ ] `src/lib/churn/riskScoring.js` — composition, tiers, gate, driver, fallback
- [ ] `src/lib/churn/loadScores.js` — drop read-time override (now in score), add
      `insufficient_data`, surface velocity + driver + explanation
- [ ] `src/lib/churn/retention.js` — live engine mirror
- [ ] `supabase/migrations/0508_churn_model_v3.sql` — `gym_churn_weights` restructure to
      new signal set, `churn_model_version`, persist velocity/driver/explanation on
      `churn_risk_scores`
- [ ] `src/lib/churn/signalI18n.js` — new signal labels + explanation builders
- [ ] `src/i18n/locales/{en,es}/pages.json` — "Retention Risk", explanations,
      "Not enough data", driver reasons
- [ ] `src/pages/admin/AdminChurn.jsx` + components — trend arrows, "Not enough data"
      badge, per-member explanation line, label rename
- [ ] `supabase/functions/calibrate-churn-weights/index.ts` — new signal set

---

## 12. Tunable parameters (priors — calibrate against real outcomes)

| Param | Value | Note |
|---|---|---|
| Recency τ (steady / onboarding) | 18 / 10 days | |
| Frequency anchor | 3×/wk | Hormozi |
| Gate threshold (attendance strong) | Layer A ≤ 18 / 70 | |
| Medium cap (gate) | 54 | High starts 55 |
| Onboarding cutoff | 75 days | |
| Grace cutoff | <14 days OR <4 check-ins | |
| Dormant override | ≥30 days | |
| Layer B baseline / recent windows | 30–90d / 21d | |
| Tier bands | 80 / 55 / 30 | revisit per-gym percentile later |

> Expect "shake the three" (Hormozi): once interventions are wired to this, *measured*
> churn may rise ~50% in month 1 (flushing already-checked-out members) before dropping.
> Judge the model on month 2–3 retention lift, not first-cycle red-flag count.

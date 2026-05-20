# Retention Timeline — single source of truth

Every member-facing touchpoint in the system, on one page, in tenure order.
Four systems fire concurrently:

- **Lifecycle messages** — push + in-app notification, fixed schedule from signup
- **Print cards** — physical card the owner signs + hands over in person
- **Milestone push** — phone push when a workout count threshold crosses
- **Hormozi attendance flag** — admin-only signal (no member message)

Plus secondary: **Win-back drips** (post-cancel), **Owner admin notifications** (churn, password reset, NPS, moderation).

When tuning anything below, **check this file first** to see what else fires near it. Most of the resonance comes from how these channels layer — not from any single touch.

---

## At a glance — first year

```
TENURE     LIFECYCLE PUSH               PRINT CARD                  MILESTONE PUSH
─────────  ───────────────────────────  ──────────────────────────  ──────────────────
Day 0      signup → onboarding (9 step funnel, drop-off tracked in PostHog)
Day 1      "Welcome aboard"
Day 1      + first ever workout      →  welcome card "You showed up."
Day 3      "Day 3 — keep momentum"
Day 7      "One week down 🔥"
Day 14     "Two weeks in"                                           [Hormozi flag if <2/wk → MorningQueuePanel]
Day 21     "21 days — habit territory"
Day 30     "One month strong 💪"        tenure_30 "One month in."   ← intentional digital+physical layering
Day 30+    (silence — gap)
Day 90                                  tenure_90 "Past the cliff."
Day 365                                 tenure_365 "One year here."

(activity-triggered, fire whenever the member hits them)
+ 9 workouts in last 42 days        →   habit_9in6 card             [no push companion — gap]
+ Workout 10                                                        "10 workouts 🏆"
+ Workout 25                                                        "25 workouts 🏆"
+ Workout 50                                                        "50 workouts 🏆"
+ Workout 100                       →   milestone_100 card          "100 workouts 🏆"
+ Workout 200                                                       "200 workouts 🏆"
+ Workout 250                       →   milestone_250 card          [no push companion — gap]
+ Workout 500                       →   milestone_500 card          "500 workouts 🏆"
+ Birthday (next 3 days)            →   birthday card               [no push companion]
+ Returning (21+ days silent)       →   returning card              [no push — intentional, never reward absence]
```

---

## Detailed timeline by tenure day

### Day 0 — Signup
- 9-step onboarding flow (invite code → language → fitness level → goal → schedule → equipment → injuries → health sync → body metrics)
- Each step tracked in PostHog + `profiles.onboarding_step`
- Admin sees the funnel + drop-off % at `/admin/analytics` Engagement tab
- **No message fires.** This is pure data collection.

### Day 1 — First contact
- Lifecycle push + in-app: `"Welcome aboard, {{first_name}}" / "Your first workout is the hardest. Let's get it on the board this week."`
- If first workout completed today → welcome card queued (next morning): `"You showed up." / "That was the hard part."`

### Day 3 — Early nudge
- Lifecycle push + in-app: `"Day 3 — keep the momentum" / "Most people quit before day 5. Get one more session in and you've already beaten the average."`

### Day 5 — **GAP** (proposal below)

### Day 7 — Week one
- Lifecycle push + in-app: `"One week down 🔥" / "You stuck with it past the first week. Statistically that's the hardest part — it gets easier from here."`

### Day 14 — Hormozi cliff
- Lifecycle push + in-app: `"Two weeks in, {{first_name}}" / "You're past the cliff where most people drop off. The work is starting to compound."`
- **Admin-side:** Hormozi flag fires if member has logged <2 sessions/week → appears in MorningQueuePanel. Owner decides whether to reach out. Member sees no auto-message about being flagged.

### Day 21 — Habit anchor
- Lifecycle push + in-app: `"21 days — habit territory" / "Research says 21 days is when a behavior starts to stick. You did it. Now it's about consistency."`

### Day 30 — One month
- Lifecycle push + in-app: `"One month strong 💪" / "A full month of showing up, {{first_name}}. That's further than 80% of new members ever get. Proud of you."`
- Print card: tenure_30 `"One month in." / "Past the trial-period brain — you're a regular now."`
- **Intentional layering**: digital ping arrives on phone; physical card waiting at front desk on next visit.

### Day 60 — **GAP** (proposal below)

### Day 90 — The cliff
- Print card: tenure_90 `"Ninety days strong." / "You're past the cliff. This is your gym."`
- No lifecycle push at this point (gap — proposal below).

### Day 365 — Anniversary
- Print card: tenure_365 `"One year here." / "Twelve months of showing up. Few do this."`
- Folded card format (per design spec). Owner adds personal note inside.

---

## Triggered by activity (any tenure day)

### Workout count crossings
| At workout # | Push title | Card |
|---|---|---|
| 1 | (none) | `welcome` — see Day 1 |
| 10 | `"10 workouts logged 🏆"` | none |
| 25 | `"25 workouts logged 🏆"` | **none** (dropped — was milestone_25, devalued the system) |
| 50 | `"50 workouts logged 🏆"` | none |
| 100 | `"100 workouts logged 🏆"` | `milestone_100` |
| 200 | `"200 workouts logged 🏆"` | none |
| 250 | (none — gap) | `milestone_250` |
| 500 | `"500 workouts logged 🏆"` | `milestone_500` (folded card) |

### 9-in-6 habit
- Trigger: 9 completed workouts in trailing 42 days (per-gym tunable in `gym_card_settings`)
- Card: `habit_9in6 "You're building the habit." / "Nine sessions in six weeks — keep going."`
- Dedup: 90 days from any prior habit_9in6 card
- **No push companion** — gap.

### Birthday
- Trigger: `date_of_birth` MM-DD within next 3 days (per-gym tunable)
- Card: `birthday "Happy birthday." / "On the house today. Take it easy."`

### Returning
- Trigger: came back after 21+ days silent (per-gym tunable)
- Card: `returning "Good to see you back." / "It's been {{absence_days}} days. No pressure — just glad you're here."`
- **No push companion — intentional**. Never reward absence with a digital ping.

---

## Owner-only signals (member never sees)

- **Hormozi attendance flag** — `member_weekly_attendance_flags` table, fires day 14 if <2 sessions/wk → admin sees in MorningQueuePanel
- **Critical churn risk crossing** — `member_churn_alert` admin notification (migration 0412) fires when a member crosses INTO `critical` risk tier
- **Pending password reset** — admin notification (0412) fires on new pending request
- **Moderation flag** — admin notification (0412) fires when content is reported
- **NPS detractor** — admin notification (0412) fires when member responds score 1-2

---

## Win-back layer (post-cancel only)

Fires only after `membership_status` flips to `cancelled`:

- **Day 7** post-cancel — soft "we miss you"
- **Day 30** post-cancel — second touch, optional offer
- **Day 60** post-cancel — final touch, optional offer

Tunable per gym via `/admin/message-templates`. A/B variants tracked in `winback_message_log`.

---

## The layering pattern — digital + physical

Where a tenure or milestone has BOTH a lifecycle push AND a print card:
- The push lands instantly on the member's phone — the moment is acknowledged
- The card is waiting at the front desk on their NEXT visit — the moment is celebrated in person
- Pattern: **software remembers, software pings, owner delivers the human acknowledgment**

This works because:
1. The push doesn't promise a physical object (gym may not have printed yet)
2. The card is a SURPRISE when handed over — push doesn't preempt it
3. Both reference the same moment so the member feels remembered twice

**Don't break this pattern by adding "stop by the front desk" CTAs to pushes** — they create a promise the owner may not have prepped for.

---

## Overlaps to be aware of

1. **Day 30 lifecycle + tenure_30 card** — intentional layering (above). Both fire same day. Keep.
2. **Workout 100 push + milestone_100 card** — intentional layering. Keep.
3. **Workout 500 push + milestone_500 card** — intentional layering. Folded card is the actual ceremony.

These are by design. Members getting both reinforces the moment.

## Identified gaps

### Day 5 — silence between Day 3 nudge and Day 7 win
If member hasn't worked out by Day 5, there's no signal. **Proposal:** soft `"Still here when you're ready"` push, but only fire if they haven't logged a workout yet (don't pester active members). Could be a conditional lifecycle message.

### Day 60 — silence between tenure_30 and tenure_90
Two months with no scheduled touch outside of activity-based triggers. **Proposal:** lifecycle push at day 60 `"Two months — you're not testing anymore"`. No card needed (tenure_90 is close enough).

### Workout 25 / 50 push without card
Intentional after refactor (cards stay rare for big moments). The push alone is fine. **No action.**

### Workout 250 push companion
Card fires but no push. Asymmetric vs 100/500 which both have pushes. **Proposal:** add `workouts_250` to milestone_template (0409).

### habit_9in6 push companion
The biggest gap — habit milestone is arguably the most thesis-aligned trigger (rewards consistency) but has zero digital signal. Member just gets a card at the gym with no anticipation. **Proposal:** add a push trigger on `print_cards INSERT` for occasion=habit_9in6, sending `"You've built the habit / Nine sessions in six weeks."` without promising anything physical.

### First PR after 30 days of logging
Dropped from cards because new-account noise. But "first verified PR after first 30 days of logging" is a real signal that's currently unused. **Proposal:** push-only, no card. Fire from the existing PR detection in `complete_workout`.

---

## Where to tune what

| What | File | Function/table |
|---|---|---|
| Lifecycle push copy (Day 1-30) | `gym-app/supabase/migrations/0400_lifecycle_messages.sql` | `lifecycle_template(step_key, lang)` |
| Lifecycle push schedule | `gym-app/supabase/migrations/0400_lifecycle_messages.sql` | `lifecycle_steps` table seed |
| Milestone push copy (workouts) | `gym-app/supabase/migrations/0409_milestone_push_cron.sql` | `milestone_template(milestone_key, lang)` |
| Milestone thresholds | `gym-app/supabase/migrations/0409_milestone_push_cron.sql` | `milestone_thresholds` table seed |
| Print card copy + occasions | `gym-app/supabase/migrations/0415_print_cards_v2_occasions_and_rewards.sql` | `generate_print_cards_daily()` |
| Print card per-gym tuning | `gym_card_settings` table | `habit_window_days`, `habit_target_count`, `habit_dedup_days`, `returning_silence_days`, `birthday_lookahead_days`, `enable_*` toggles |
| Win-back drip copy | `gym-app/src/pages/admin/AdminMessageTemplates.jsx` | `message_templates` table, per-gym overrides |
| Admin notification triggers | `gym-app/supabase/migrations/0412_admin_notification_producers.sql` | `fire_admin_*` trigger functions |
| Member-facing template overrides | per-gym at `/admin/message-templates` | `message_templates` table |

---

## Cron schedules

| When (UTC) | Cron name | What |
|---|---|---|
| 03:00 daily | `weekly-attendance-flag` | Hormozi <2/wk flag (0395) |
| 04:00 daily | `generate-print-cards` | All print card occasions (0399 + 0415) |
| 09:00 daily | `run-retention-orchestrator` | MorningQueuePanel + owner queue items (0398) |
| 11:00 daily | `owner-morning-queue-push` | Push to owner with day's queue (0406) |
| 14:00 daily | `run-lifecycle-messages` | Day 1/3/7/14/21/30 fires (0400) |
| 15:00 daily | `run-winback-messages` | Day 7/30/60 post-cancel (0402) |
| 16:00 daily | `milestone-push-cron` | Workout count crossings (0409) |
| Real-time | trigger on `member_churn_alert` | Admin notification fanout (0412) |

If you change a cron timing or add a new trigger, update this table.

---

## How to use this doc

- **Before adding a new touchpoint**: scan for what fires near the same tenure/event. Is there layering benefit or noise risk?
- **Before tuning copy**: check the layering note — does the change preserve the digital+physical pattern?
- **Before disabling something via `gym_card_settings`**: read the overlap section — what else does this leave unaddressed?
- **Before promising a member an artifact in a push**: don't. Read the layering section.

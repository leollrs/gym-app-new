/**
 * onboardingGoals.js — turn the onboarding "Your Targets" selections into valid,
 * trackable member_goals rows, and normalize them for the workout generator.
 *
 * Keeps all goal-construction logic OUT of the (already huge) Onboarding.jsx:
 *   • buildOnboardingGoals(selections, context)   → pure: baselines, direction,
 *       realistic target dates, near-term milestone (for display), titles.
 *   • detectConflicts(selections, context)        → pure: inline coaching warnings.
 *   • persistOnboardingGoals(goals, muscles, ctx) → idempotent DB write.
 *   • mapGoalsForProgramGenerator(goals)          → shape the generator expects.
 *
 * Baselines at signup come from what the member just entered — their onboarding
 * body weight and the current values captured per target — so this stays pure
 * (no DB reads). A goal with NO baseline is NOT created (no misleading 0→target
 * progress); the Targets UI collects current+target so a baseline always exists.
 */

import { supabase } from './supabase';
import { realisticBand, milestone, DEFAULT_BAND } from './goalRealism';

const UNIT = { body_weight: 'lb', body_fat: '%', lift_1rm: 'lb' };

const numOrNull = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function titleFor(goalType, { targetValue, startValue, exerciseName }) {
  const up = targetValue > startValue;
  if (goalType === 'body_weight') return up ? `Reach ${targetValue} lb` : `Cut to ${targetValue} lb`;
  if (goalType === 'body_fat')    return `Reach ${targetValue}% body fat`;
  if (goalType === 'lift_1rm')    return `${exerciseName || 'Lift'}: ${targetValue} lb`;
  return `Goal: ${targetValue}`;
}

// Build one goal from a {current, target, band} selection + type/exercise.
function buildOne({ goalType, exerciseId, exerciseName, current, target, band, fitnessLevel }) {
  const startValue = numOrNull(current);
  const targetValue = numOrNull(target);
  // No baseline OR no target → don't create a tracked goal (would show a
  // misleading percentage). The caller/UI is responsible for collecting both.
  if (startValue == null || targetValue == null || startValue === targetValue) return null;

  const selBand = band || DEFAULT_BAND;
  const gap = targetValue - startValue;
  const bands = realisticBand({ goalType, gap, fitnessLevel, exerciseName });
  const targetDate = bands?.[selBand]?.date || null;
  const ms = milestone({ goalType, startValue, targetValue, fitnessLevel, exerciseName, band: selBand });

  return {
    goalType,
    exerciseId: exerciseId || null,
    exerciseName: exerciseName || null,
    title: titleFor(goalType, { targetValue, startValue, exerciseName }),
    startValue,
    targetValue,
    currentValue: startValue,
    unit: UNIT[goalType] || null,
    band: selBand,
    direction: gap > 0 ? 'up' : 'down',
    targetDate,
    milestone: ms, // display-only (near-term proximal target); not a separate DB row
  };
}

/**
 * selections shape (all optional — "pick what matters"):
 *   {
 *     priorityMuscles: string[],                        // muscle emphasis
 *     bodyWeight: { current, target, band } | null,
 *     bodyFat:    { current, target, band } | null,
 *     lifts: [{ exerciseId, exerciseName, current, target, band }],
 *   }
 * context: { fitnessLevel, onboardingWeightLbs, primaryGoal }
 *
 * Returns an array of built goals (baseline-valid only).
 */
export function buildOnboardingGoals(selections, context = {}) {
  const { fitnessLevel = 'intermediate', onboardingWeightLbs } = context;
  const out = [];
  if (!selections) return out;

  if (selections.bodyWeight) {
    const g = buildOne({
      goalType: 'body_weight',
      // Fall back to the weight they just entered in onboarding as the baseline.
      current: selections.bodyWeight.current ?? onboardingWeightLbs,
      target: selections.bodyWeight.target,
      band: selections.bodyWeight.band,
      fitnessLevel,
    });
    if (g) out.push(g);
  }

  if (selections.bodyFat) {
    const g = buildOne({
      goalType: 'body_fat',
      current: selections.bodyFat.current,
      target: selections.bodyFat.target,
      band: selections.bodyFat.band,
      fitnessLevel,
    });
    if (g) out.push(g);
  }

  for (const lift of (selections.lifts || [])) {
    if (!lift?.exerciseId) continue;
    const g = buildOne({
      goalType: 'lift_1rm',
      exerciseId: lift.exerciseId,
      exerciseName: lift.exerciseName,
      current: lift.current,
      target: lift.target,
      band: lift.band,
      fitnessLevel,
    });
    if (g) out.push(g);
  }

  return out;
}

/**
 * Lightweight coaching warnings for contradictory combos. Specific numeric
 * targets still win (we don't block); the UI just surfaces the warning.
 * Returns an array of stable i18n-friendly keys.
 */
export function detectConflicts(selections, { primaryGoal } = {}) {
  const warnings = [];
  const bw = selections?.bodyWeight;
  const cur = numOrNull(bw?.current);
  const tgt = numOrNull(bw?.target);
  if (cur != null && tgt != null && cur !== tgt) {
    const gaining = tgt > cur;
    if (primaryGoal === 'fat_loss' && gaining) warnings.push('fatLossButGaining');
    if (primaryGoal === 'muscle_gain' && !gaining) warnings.push('muscleGainButLosing');
  }
  return warnings;
}

/**
 * Persist built goals to member_goals (idempotent) + save priority_muscles.
 *
 * Idempotency: member_goals' UNIQUE(profile_id, goal_type, exercise_id) treats a
 * NULL exercise_id as DISTINCT, so a plain upsert would DUPLICATE body_weight /
 * body_fat goals on a re-run. We match NULL-safely and update-or-insert per goal.
 */
// NULL-safe upsert of one member_goals row keyed on
// (profile_id, goal_type, exercise_id, is_milestone). Returns the row id so a
// milestone can link to its parent. Idempotent — re-running updates in place.
async function upsertMemberGoal(row) {
  let q = supabase.from('member_goals').select('id')
    .eq('profile_id', row.profile_id)
    .eq('goal_type', row.goal_type)
    .eq('is_milestone', row.is_milestone);
  q = row.exercise_id ? q.eq('exercise_id', row.exercise_id) : q.is('exercise_id', null);
  const { data: existing } = await q.maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('member_goals').update(row).eq('id', existing.id);
    return { id: existing.id, error };
  }
  const { data, error } = await supabase.from('member_goals').insert(row).select('id').maybeSingle();
  return { id: data?.id || null, error };
}

// Clean value title — the is_milestone badge in the UI conveys "milestone",
// and the completion/deadline notifications frame it in context.
const milestoneTitle = (g) => `${g.milestone.value}${g.unit ? ` ${g.unit}` : ''}`;

export async function persistOnboardingGoals(builtGoals, priorityMuscles, { profileId, gymId }) {
  if (!profileId || !gymId) return { error: new Error('missing profile/gym') };
  let firstError = null;

  for (const g of (builtGoals || [])) {
    const base = {
      profile_id: profileId,
      gym_id: gymId,
      exercise_id: g.exerciseId ?? null,
      goal_type: g.goalType,
      unit: g.unit ?? null,
    };
    try {
      // Long-term (parent) goal.
      const { id: parentId, error: pErr } = await upsertMemberGoal({
        ...base,
        is_milestone: false,
        parent_goal_id: null,
        target_value: g.targetValue,
        current_value: g.startValue,
        start_value: g.startValue,
        title: g.title,
        target_date: g.targetDate ?? null,
      });
      if (pErr && !firstError) firstError = pErr;

      // Near-term milestone, linked to the parent (only for big goals — goalRealism
      // returns null when the honest timeline is already short). Its own target +
      // date, so goalUpdater completes it independently of the long-term goal.
      if (g.milestone && parentId) {
        const { error: mErr } = await upsertMemberGoal({
          ...base,
          is_milestone: true,
          parent_goal_id: parentId,
          target_value: g.milestone.value,
          current_value: g.startValue,
          start_value: g.startValue,
          title: milestoneTitle(g),
          target_date: g.milestone.date ?? null,
        });
        if (mErr && !firstError) firstError = mErr;
      }
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }

  // priority_muscles (additive TEXT[] column on member_onboarding). Empty → null.
  if (Array.isArray(priorityMuscles)) {
    const { error } = await supabase
      .from('member_onboarding')
      .update({ priority_muscles: priorityMuscles.length ? priorityMuscles : null })
      .eq('profile_id', profileId);
    if (error && !firstError) firstError = error;
  }

  return { error: firstError };
}

/**
 * Normalize built goals to the minimal shape generateProgram(onboarding, goals)
 * reads: it only looks at goal_type === 'lift_1rm' && exercise_id to boost the
 * matching lifts (+1 set / prefer the exercise). Body-comp goals correctly pass
 * through as no-ops for the generator; muscle emphasis rides priority_muscles.
 */
export function mapGoalsForProgramGenerator(builtGoals) {
  return (builtGoals || []).map((g) => ({ goal_type: g.goalType, exercise_id: g.exerciseId ?? null }));
}

/**
 * A short, goal-anchored program name from the member's targets — the MISSION,
 * not the split. "The 160 Build" / "Cut to 175" / "225 Club" / "Arms Build".
 * Feels personal in a way "1RM Push/Pull/Legs" never does. Returns null when
 * there's no specific signal (caller falls back to the creative name pool).
 */
export function goalAnchoredName(selections, { primaryGoal } = {}) {
  if (!selections) return null;
  const bwT = numOrNull(selections.bodyWeight?.target);
  const bwC = numOrNull(selections.bodyWeight?.current);
  if (bwT != null) {
    const up = bwC != null ? bwT > bwC : primaryGoal !== 'fat_loss';
    return up ? `The ${bwT} Build` : `Cut to ${bwT}`;
  }
  const topLift = (selections.lifts || [])
    .map((l) => numOrNull(l.target)).filter(Boolean).sort((a, b) => b - a)[0];
  if (topLift) return `${topLift} Club`;
  const bfT = numOrNull(selections.bodyFat?.target);
  if (bfT != null) return `Lean ${bfT}%`;
  const m = (selections.priorityMuscles || [])[0];
  if (m) return `${m} Build`;
  return null;
}

/**
 * One-line "why this plan" caption for the program preview — makes the tailoring
 * VISIBLE (the plan's core retention lever). e.g. "Muscle gain · extra arms &
 * chest · toward 160 lb". Returns null when there's nothing specific to say.
 */
export function whyThisPlanCaption(selections, { primaryGoalLabel } = {}) {
  if (!selections) return null;
  const parts = [];
  if (primaryGoalLabel) parts.push(primaryGoalLabel);
  if (selections.priorityMuscles?.length) {
    parts.push(`extra ${selections.priorityMuscles.slice(0, 2).map((m) => m.toLowerCase()).join(' & ')}`);
  }
  const bwT = numOrNull(selections.bodyWeight?.target);
  if (bwT != null) parts.push(`toward ${bwT} lb`);
  else {
    const topLift = (selections.lifts || []).map((l) => numOrNull(l.target)).filter(Boolean).sort((a, b) => b - a)[0];
    if (topLift) parts.push(`toward ${topLift} lb`);
  }
  return parts.length ? parts.join(' · ') : null;
}

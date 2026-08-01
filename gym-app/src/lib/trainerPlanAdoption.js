/**
 * Adopting a coach's plan (or a trainer-assigned gym program) as the member's
 * current program.
 *
 * The plan is MATERIALIZED — real routines plus a real generated_programs row
 * plus workout_schedule — rather than rendered as a second kind of program.
 * Every surface (Workouts hero, the Dashboard "My Plan" sheet, the week strip,
 * session start, the overload engine) already reads those three, so making the
 * plan one of them makes all of them work at once.
 *
 * The invariants below are the ones every OTHER creation path
 * (personalProgramService, MemberProgramBuilder, GenerateWorkoutModal) follows.
 * The first version of this file skipped three of them and corrupted state:
 *
 *   1. EXPIRE the program you are replacing. Leaving two active trips the
 *      dedupe in Workouts, which expires the older one destructively — and the
 *      member could never get it back.
 *   2. WIPE workout_schedule before seeding. Upserting only the coach's days
 *      leaves the previous program's other days live on Home.
 *   3. Week 1 is only the days LEFT in this calendar week. Days that wrap go to
 *      a compensating final week. Assigning on a Saturday otherwise buries most
 *      of week 1 in days that already passed.
 */
import { supabase } from './supabase';
import logger from './logger';
import { isSchemaMiss } from './schemaMiss';

/** A materialized program is identifiable by this key in its schedule_map. */
export const adoptedPlanId = (program) => program?.schedule_map?.trainer_plan_id || null;

/** Mon-first week order — the steady-state (week 2+) day preference. */
const PACKED_WEEK = [1, 2, 3, 4, 5, 6, 0];

const dayList = (weeks, key) => (weeks?.[String(key)] || [])
  .filter(d => (d.exercises || []).length > 0);

const normalizeExercises = (day) => (day?.exercises || [])
  .map(e => (typeof e === 'string' ? { id: e } : e))
  .filter(e => e?.id);

/**
 * Create one routine per day. Returns the created ids in day order.
 * Throws on any write failure — the caller decides what to do about it.
 */
async function createRoutines({ days, planName, userId, gymId, dayLabel, variant }) {
  const ids = [];
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    const exs = normalizeExercises(day);
    if (!exs.length) continue;

    // The `Auto:` prefix is load-bearing, not cosmetic: getRoutinesForWeek
    // filters `routines.filter(r => r.name.startsWith('Auto:'))`, so a routine
    // without it never matches and the hero renders "No preview available for
    // this week" over a program whose routines exist and work everywhere else.
    const suffix = variant === 'B' ? ' B' : '';
    const routineName = `Auto: ${planName} · ${day.name || `${dayLabel} ${i + 1}`}${suffix}`.slice(0, 90);
    const { data: created, error: rErr } = await supabase
      .from('routines')
      .insert({ name: routineName, gym_id: gymId, created_by: userId })
      .select('id')
      .single();
    if (rErr) throw rErr;

    // Consecutive exercises sharing a non-null `ss` token were authored as a
    // superset in the trainer builder — keep the grouping so ActiveSession
    // pairs them.
    const groupIdFor = {};
    for (let a = 0; a < exs.length;) {
      const ss = exs[a].ss;
      if (ss) {
        let b = a + 1;
        while (b < exs.length && exs[b].ss === ss) b += 1;
        if (b - a >= 2) {
          const gid = `ssg-${created.id}-${a}`;
          for (let k = a; k < b; k += 1) groupIdFor[k] = gid;
        }
        a = b;
      } else { a += 1; }
    }

    const { error: xErr } = await supabase.from('routine_exercises').insert(
      exs.map((ex, xi) => ({
        routine_id: created.id,
        exercise_id: ex.id,
        position: xi + 1,
        target_sets: Number(ex.sets) || 3,
        target_reps: String(ex.reps || '8-12'),
        rest_seconds: Number.isFinite(Number(ex.rest_seconds)) ? Number(ex.rest_seconds) : 60,
        group_id: groupIdFor[xi] || null,
        group_type: groupIdFor[xi] ? 'superset' : null,
      })),
    );
    if (xErr) throw xErr;
    ids.push(created.id);
  }
  return ids;
}

/**
 * @param {object}  o
 * @param {object}  o.plan        { id, name, weeks, duration_weeks, coachName?, kind? }
 * @param {string}  o.userId
 * @param {string}  o.gymId
 * @param {string}  o.dayLabel
 * @param {boolean} o.startToday  true (default) = week 1 begins today, wrapping
 *                                the rest into a compensating final week.
 *                                false = the plan starts next Monday, whole.
 * @returns {Promise<{ ok: boolean, reason?: 'empty' }>} throws on a real failure.
 */
export async function adoptTrainerPlan({
  plan, userId, gymId, dayLabel = 'Day', startToday = true, replacesAdopted = null,
}) {
  const weeks = plan?.weeks || {};
  const weekKeys = Object.keys(weeks).map(Number).filter(n => n > 0).sort((a, b) => a - b);
  const weekADays = dayList(weeks, weekKeys[0] ?? 1).slice(0, 7);
  if (!weekADays.length) return { ok: false, reason: 'empty' };

  // A second authored week becomes the B variant — that is exactly what
  // routine_ids_b is for. Beyond two the app's model alternates A/B; the full
  // per-week content still reaches the viewer through template_weeks below.
  const weekBDays = weekKeys.length > 1 ? dayList(weeks, weekKeys[1]).slice(0, 7) : [];

  const idsA = await createRoutines({
    days: weekADays, planName: plan.name, userId, gymId, dayLabel, variant: 'A',
  });
  if (!idsA.length) return { ok: false, reason: 'empty' };
  const idsB = weekBDays.length
    ? await createRoutines({
      days: weekBDays, planName: plan.name, userId, gymId, dayLabel, variant: 'B',
    })
    : [];

  const N = idsA.length;
  const start = new Date();
  const startDow = start.getDay();
  const packedDays = PACKED_WEEK.slice(0, N);

  // Week 1 runs from today; whatever no longer fits in THIS calendar week wraps
  // into an extra final week. Without this, adopting on a Saturday puts most of
  // week 1 on days the member already lived through.
  const week1All = startToday
    ? Array.from({ length: N }, (_, i) => (startDow + i) % 7)
    : packedDays;
  const week1Dows = week1All.filter(d => d >= startDow);
  const wrappedDows = startToday ? week1All.filter(d => d < startDow) : [];
  const needsExtraWeek = wrappedDows.length > 0;

  const planWeeks = Math.max(1, plan.duration_weeks || weekKeys.length || 1);
  const totalWeeks = planWeeks + (needsExtraWeek ? 1 : 0);

  const scheduleMap = {
    routine_day_map: packedDays.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
    week1_map: week1Dows.map(dow => ({ routine_index: week1All.indexOf(dow), day_of_week: dow })),
    last_week_map: wrappedDows.map((d, i) => ({
      routine_index: week1All.indexOf(d), day_of_week: packedDays[i],
    })),
    start_dow: startDow,
    week1_dows: week1Dows,
    wrapped_dows: wrappedDows,
    normal_dows: packedDays,
    routine_ids: [...idsA, ...idsB],
    routine_ids_a: idsA,
    routine_ids_b: idsB.length ? idsB : idsA,
    total_calendar_weeks: totalWeeks,
    display_name: plan.name,
    // Provenance: marks the hero as the coach's, and lets release undo exactly
    // these rows.
    trainer_plan_id: plan.id,
    trainer_plan_coach: plan.coachName || null,
    trainer_plan_kind: plan.kind || 'trainer',
    // The coach's plan version at the moment we materialized. An edit changes
    // updated_at, which is how the member's app knows to rebuild.
    trainer_plan_v: plan.updated_at || null,
  };

  // Expire whatever the member was on, and REMEMBER it so release can undo
  // this. Two active programs trip the dedupe in Workouts, which expires the
  // older one with no record — the member's own program would be unrecoverable.
  const nowIso = new Date().toISOString();
  if (replacesAdopted) {
    // REBUILD of an already-adopted plan (the coach edited it). Carry the
    // ORIGINAL superseded list forward — recording the adopted program we're
    // about to delete would chain, and "back to my program" would restore a
    // coach plan instead of the member's own.
    scheduleMap.superseded_programs = replacesAdopted.schedule_map?.superseded_programs || [];
  } else {
    const { data: live, error: liveErr } = await supabase
      .from('generated_programs')
      .select('id, expires_at')
      .eq('profile_id', userId)
      .gt('expires_at', nowIso);
    if (liveErr) throw liveErr;
    const superseded = (live || []).map(p => ({ id: p.id, expires_at: p.expires_at }));
    scheduleMap.superseded_programs = superseded;

    if (superseded.length) {
      const { error: expErr } = await supabase
        .from('generated_programs')
        .update({ expires_at: nowIso })
        .in('id', superseded.map(p => p.id));
      if (expErr) throw expErr;
    }
  }

  const expiresAt = new Date(start);
  expiresAt.setDate(expiresAt.getDate() + totalWeeks * 7);

  const { error: gpErr } = await supabase.from('generated_programs').insert({
    profile_id: userId,
    gym_id: gymId,
    split_type: 'custom',
    program_start: start.toISOString(),
    expires_at: expiresAt.toISOString(),
    routines_a_count: N,
    duration_weeks: totalWeeks,
    schedule_map: scheduleMap,
    // Real per-week content for the week navigator, so an 8-week plan doesn't
    // preview as week 1 eight times.
    template_weeks: weeks,
  });
  if (gpErr) throw gpErr;

  // The superseded adopted program is removed only NOW, once its replacement
  // exists — a failure above leaves the member on the old one rather than on
  // nothing. Routines they actually trained are kept.
  if (replacesAdopted?.id) {
    const { error: delErr } = await supabase
      .from('generated_programs').delete().eq('id', replacesAdopted.id);
    if (delErr) logger.error('trainerPlanAdoption: could not retire the old build:', delErr);
    const oldIds = [...new Set([
      ...(replacesAdopted.schedule_map?.routine_ids || []),
      ...(replacesAdopted.schedule_map?.routine_ids_a || []),
      ...(replacesAdopted.schedule_map?.routine_ids_b || []),
    ])];
    if (oldIds.length) {
      const { data: used } = await supabase
        .from('workout_sessions').select('routine_id').in('routine_id', oldIds);
      const trained = new Set((used || []).map(x => x.routine_id));
      const drop = oldIds.filter(r => !trained.has(r));
      if (drop.length) {
        await supabase.from('routine_exercises').delete().in('routine_id', drop);
        await supabase.from('workout_schedule').delete().in('routine_id', drop);
        await supabase.from('routines').delete().in('id', drop);
      }
    }
  }

  // WIPE then seed. Upserting only the coach's days left the previous
  // program's other weekdays live, and Home rendered them verbatim.
  const { error: wipeErr } = await supabase
    .from('workout_schedule').delete().eq('profile_id', userId);
  if (wipeErr) throw wipeErr;
  for (let i = 0; i < idsA.length; i += 1) {
    const { error: schErr } = await supabase.from('workout_schedule').upsert({
      profile_id: userId,
      gym_id: gymId,
      day_of_week: packedDays[i],
      routine_id: idsA[i],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,day_of_week' });
    if (schErr) throw schErr;
  }

  // The marker is a FK to trainer_workout_plans, so it can only hold a trainer
  // plan id. A gym program's provenance lives in schedule_map.trainer_plan_kind
  // instead — writing its id here raised 23503, which was swallowed, leaving
  // the program as the hero AND still offered as "Use as my program".
  let marked = false;
  if ((plan.kind || 'trainer') === 'trainer') {
    const { error: markErr } = await supabase
      .from('profiles').update({ active_trainer_plan_id: plan.id }).eq('id', userId);
    if (markErr && !isSchemaMiss(markErr)) {
      logger.error('trainerPlanAdoption: could not mark active plan:', markErr);
    }
    marked = !markErr;
  }
  return { ok: true, marked };
}

/**
 * Drop every materialized coach program, restore the program it superseded,
 * and rebuild the week from whatever is active afterwards.
 */
export async function releaseTrainerPlan({ userId, gymId }) {
  // The error is CHECKED. Discarding it made a failed read look like "nothing
  // adopted": every repair below was skipped and the function still reported
  // success while clearing the marker, which hid the plan with no way back.
  const { data: mine, error: readErr } = await supabase
    .from('generated_programs')
    .select('id, schedule_map')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (readErr) throw readErr;

  const rows = mine || [];
  const adopted = rows.filter(p => adoptedPlanId(p));
  const ids = adopted.map(p => p.id);

  if (ids.length) {
    // Un-expire what adoption superseded, BEFORE deleting the adopted rows —
    // if the delete fails the member is still left with a working program.
    const restore = adopted.flatMap(p => p.schedule_map?.superseded_programs || []);
    for (const r of restore) {
      if (!r?.id || !r?.expires_at) continue;
      const { error: resErr } = await supabase
        .from('generated_programs').update({ expires_at: r.expires_at }).eq('id', r.id);
      if (resErr) logger.error('releaseTrainerPlan: could not restore program:', resErr);
    }

    const { error: delErr } = await supabase.from('generated_programs').delete().in('id', ids);
    if (delErr) throw delErr;

    // Only routines no SURVIVING program claims AND that were never trained on.
    // The canonical sweeper checks workout_sessions too; without that this
    // severed the routine link on sessions the member actually performed.
    const claimed = new Set();
    rows.filter(p => !ids.includes(p.id)).forEach((p) => {
      const m = p.schedule_map || {};
      [...(m.routine_ids || []), ...(m.routine_ids_a || []), ...(m.routine_ids_b || [])]
        .forEach(r => claimed.add(r));
    });
    const mineIds = [...new Set(adopted.flatMap((p) => {
      const m = p.schedule_map || {};
      return [...(m.routine_ids || []), ...(m.routine_ids_a || []), ...(m.routine_ids_b || [])];
    }))];
    let orphans = mineIds.filter(r => !claimed.has(r));
    if (orphans.length) {
      const { data: used } = await supabase
        .from('workout_sessions').select('routine_id').in('routine_id', orphans);
      const trained = new Set((used || []).map(s => s.routine_id));
      orphans = orphans.filter(r => !trained.has(r));
    }
    if (orphans.length) {
      const { error: reErr } = await supabase.from('routine_exercises').delete().in('routine_id', orphans);
      if (reErr) logger.error('releaseTrainerPlan: routine_exercises cleanup failed:', reErr);
      const { error: wsErr } = await supabase.from('workout_schedule').delete().in('routine_id', orphans);
      if (wsErr) logger.error('releaseTrainerPlan: workout_schedule cleanup failed:', wsErr);
      const { error: rErr } = await supabase.from('routines').delete().in('id', orphans);
      if (rErr) logger.error('releaseTrainerPlan: routines cleanup failed:', rErr);
    }

    // Rebuild the week from whatever program is live now.
    const { data: after, error: afterErr } = await supabase
      .from('generated_programs')
      .select('id, schedule_map')
      .eq('profile_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (afterErr) logger.error('releaseTrainerPlan: could not read the restored program:', afterErr);

    const sMap = after?.schedule_map;
    const rids = sMap?.routine_ids_a?.length ? sMap.routine_ids_a : (sMap?.routine_ids || []);
    const dayMap = sMap?.routine_day_map || [];
    const { error: clrErr } = await supabase
      .from('workout_schedule').delete().eq('profile_id', userId);
    if (clrErr) logger.error('releaseTrainerPlan: could not clear the week:', clrErr);
    for (const entry of dayMap) {
      const rid = rids[entry.routine_index];
      if (!rid) continue;
      const { error: seedErr } = await supabase.from('workout_schedule').upsert({
        profile_id: userId,
        gym_id: gymId,
        day_of_week: entry.day_of_week,
        routine_id: rid,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,day_of_week' });
      if (seedErr) logger.error('releaseTrainerPlan: could not seed the week:', seedErr);
    }
  }

  const { error: markErr } = await supabase
    .from('profiles').update({ active_trainer_plan_id: null }).eq('id', userId);
  if (markErr) logger.error('releaseTrainerPlan: could not clear the marker:', markErr);
  return { ok: true, marked: !markErr };
}

/** Both surfaces need the hero AND the week strip to refresh. */
export function announceProgramChange() {
  try {
    window.dispatchEvent(new CustomEvent('tugympr:programs-changed'));
    window.dispatchEvent(new CustomEvent('tugympr:schedule-changed'));
  } catch { /* ignore */ }
}

// Personal-program lifecycle (generate / regenerate), extracted from
// Onboarding.jsx so the same flow can be triggered from a "Regenerate
// Program" button in My Programs.
//
// Side effects in `generateAndSavePersonalProgram`:
//   - Inserts new rows into `routines` (named "Auto: …")
//   - Inserts new rows into `routine_exercises`
//   - Inserts a new row into `generated_programs` with proper schedule_map
//     (week1_map / last_week_map / wrapped_dows / total_calendar_weeks).
//   - Upserts rows into `workout_schedule` for each picked weekday.

import { generateProgram } from './workoutGenerator';
import { generateProgramName, generateRoutineName } from './programNaming';
import { exercises as exerciseLibrary } from '../data/exercises';

const getExerciseById = (id) => exerciseLibrary.find((e) => e.id === id);

const DAY_TO_DOW = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};
const FALLBACK_DOWS_BY_N = {
  1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6],
};

const DURATION_WEEKS = 12;

export async function generateAndSavePersonalProgram({ supabase, user, gymId, snapshot, posthog }) {
  if (!user?.id) throw new Error('user is required');
  if (!gymId)    throw new Error('gymId is required');
  if (!snapshot) throw new Error('snapshot is required');

  const onboardingForGenerator = {
    fitness_level: snapshot.fitness_level || 'beginner',
    primary_goal:  snapshot.primary_goal  || 'general_fitness',
    training_days_per_week: snapshot.training_days_per_week || 3,
    available_equipment: snapshot.available_equipment?.length > 0
      ? snapshot.available_equipment
      : ['Bodyweight'],
    injuries_notes: snapshot.injury_areas?.length > 0
      ? snapshot.injury_areas.join(', ')
      : (snapshot.injuries_notes || ''),
    sex: snapshot.sex || 'male',
    age: snapshot.age ? parseInt(snapshot.age, 10) : 30,
    workout_duration_min: snapshot.workout_duration_min || 60,
  };

  const result = generateProgram(onboardingForGenerator);

  const startDate = new Date();
  startDate.setSeconds(startDate.getSeconds() - 5);

  // 1. Create routines + their exercises ─────────────────────────────────
  // Use creative slug-driven names ("Apex Build" instead of "Auto: Upper A")
  // so the My Routines list and program detail read like a real program a
  // person would buy, not a debug dump from the generator. The seed is
  // per-generation (returned by `generateProgram`) so regenerating gives
  // different names AND different exercises rather than a deterministic
  // copy of the previous program.
  const nameSeed = result.seed || Math.floor(Math.random() * 100000);
  // We persist BOTH variant A and variant B routines (different exercises +
  // different names). The program view alternates them by week parity so the
  // user trains a different rotation on odd vs. even weeks instead of the
  // same 4 routines every single week.
  // Variant B's name index is bumped past the half-pool so its routines pull
  // a different name from the shuffled pool — Apex Build (A) vs Steel Build (B).
  const insertVariant = async (routines, variantOffsetForName) => {
    const ids = [];
    for (const routine of routines) {
      const creativeName = generateRoutineName(
        routine.slotsKey,
        routine.variantIndex + variantOffsetForName,
        nameSeed
      );
      const { data: saved, error: rErr } = await supabase
        .from('routines')
        .insert({ name: `Auto: ${creativeName}`, gym_id: gymId, created_by: user.id })
        .select('id')
        .single();
      if (rErr) throw rErr;
      ids.push(saved.id);

      if (routine.exercises.length > 0) {
        const rows = routine.exercises.map((ex, i) => ({
          routine_id: saved.id,
          exercise_id: ex.exerciseId,
          position: i + 1,
          target_sets: ex.sets,
          target_reps: ex.reps,
          rest_seconds: ex.restSeconds,
        }));
        const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
        if (exErr) throw exErr;
      }
    }
    return ids;
  };
  const createdRoutineIdsA = await insertVariant(result.routinesA, 0);
  const createdRoutineIdsB = await insertVariant(result.routinesB, 5);
  const createdRoutineIds = [...createdRoutineIdsA, ...createdRoutineIdsB];

  // 2. Pick weekdays (respecting gym closures) ───────────────────────────
  const { data: gymHoursData } = await supabase
    .from('gym_hours')
    .select('day_of_week, is_closed')
    .eq('gym_id', gymId);
  const closedDays = new Set((gymHoursData || []).filter((h) => h.is_closed).map((h) => h.day_of_week));

  const userDows = (snapshot.preferred_training_days || [])
    .map((d) => DAY_TO_DOW[d])
    .filter((n) => typeof n === 'number' && !closedDays.has(n))
    .sort((a, b) => a - b);

  // N is the number of training slots per week (one per DOW). Each slot has
  // an A and a B routine that alternate weekly — N is the per-variant count,
  // not the combined total.
  const N = createdRoutineIdsA.length;
  let pickedDows = userDows.length >= N
    ? userDows.slice(0, N)
    : (FALLBACK_DOWS_BY_N[N] || [1, 3, 5]).filter((d) => !closedDays.has(d)).slice(0, N);

  if (pickedDows.length < N) {
    const allOpenDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !closedDays.has(d));
    const used = new Set(pickedDows);
    for (const d of allOpenDays) {
      if (pickedDows.length >= N) break;
      if (!used.has(d)) { pickedDows.push(d); used.add(d); }
    }
    pickedDows.sort((a, b) => a - b);
  }

  // "Start today" option (regenerate): guarantee today is one of the training
  // days so the first workout is available immediately instead of waiting for
  // the next preferred day. When off, the schedule follows preferred days only.
  const startTodayDow = startDate.getDay();
  if (snapshot.start_today && !closedDays.has(startTodayDow) && !pickedDows.includes(startTodayDow)) {
    // Swap today in for the latest-in-week pick, keeping N distinct days.
    pickedDows[pickedDows.length - 1] = startTodayDow;
    pickedDows = Array.from(new Set(pickedDows)).sort((a, b) => a - b);
    if (pickedDows.length < N) {
      const used = new Set(pickedDows);
      for (const d of [0, 1, 2, 3, 4, 5, 6]) {
        if (pickedDows.length >= N) break;
        if (!used.has(d) && !closedDays.has(d)) { pickedDows.push(d); used.add(d); }
      }
      pickedDows.sort((a, b) => a - b);
    }
  }

  // 3. Partial-week scheduling (signup mid-week) ─────────────────────────
  // For a Thu signup with M/W/F/S over 12 training-weeks:
  //   week 0:    [Fri, Sat]                       2 sessions
  //   weeks 1-11: [Mon, Wed, Fri, Sat]            44 sessions
  //   final wk:   [Mon, Wed]                      2 sessions
  //   total:                                       48 = 12 × 4
  const startDow = startDate.getDay();
  const week1Dows = pickedDows.filter((d) => d >= startDow);
  const sessionsPerWeek = pickedDows.length;
  const totalSessionsTarget = DURATION_WEEKS * sessionsPerWeek;
  const sessionsAfterWeek1 = totalSessionsTarget - week1Dows.length;
  const fullMidWeeks = Math.floor(sessionsAfterWeek1 / sessionsPerWeek);
  const lastWeekSessionCount = sessionsAfterWeek1 - fullMidWeeks * sessionsPerWeek;
  const lastWeekDows = pickedDows.slice(0, lastWeekSessionCount);

  const dowToRoutineIdx = new Map(pickedDows.map((dow, i) => [dow, i]));
  const week1Map    = week1Dows.map((dow) => ({ routine_index: dowToRoutineIdx.get(dow), day_of_week: dow }));
  const lastWeekMap = lastWeekDows.map((dow) => ({ routine_index: dowToRoutineIdx.get(dow), day_of_week: dow }));

  const totalCalendarWeeks = 1 + fullMidWeeks + (lastWeekSessionCount > 0 ? 1 : 0);
  const expiresAt = new Date(startDate);
  const lastDow = lastWeekSessionCount > 0
    ? lastWeekDows[lastWeekDows.length - 1]
    : pickedDows[pickedDows.length - 1];
  const daysToEnd = (totalCalendarWeeks - 1) * 7 + (lastDow - startDow);
  expiresAt.setDate(expiresAt.getDate() + daysToEnd + 1);

  // Creative program name (e.g. "Apex Build" instead of "Upper Lower").
  // Persisted in schedule_map so the same name shows everywhere the program
  // appears. Dedup against the user's existing program names so the same
  // name doesn't appear twice in their My Programs list.
  const { data: priorPrograms } = await supabase
    .from('generated_programs')
    .select('schedule_map, split_type')
    .eq('profile_id', user.id);
  const usedNames = (priorPrograms || [])
    .map((p) => p.schedule_map?.display_name)
    .filter(Boolean);
  const displayName = generateProgramName(
    result.split,
    snapshot.primary_goal || 'general_fitness',
    usedNames,
  );

  const scheduleMapData = {
    display_name:    displayName,
    // Combined list — used by orphan cleanup + Reactivate.
    routine_ids:     createdRoutineIds,
    // Variant-specific lists — getRoutinesForWeek picks A for odd weeks and
    // B for even weeks so the user rotates between two distinct sets of
    // exercises rather than running the same routines every single week.
    routine_ids_a:   createdRoutineIdsA,
    routine_ids_b:   createdRoutineIdsB,
    routine_day_map: pickedDows.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
    week1_map:       week1Map,
    last_week_map:   lastWeekMap,
    start_dow:       startDow,
    week1_dows:      week1Dows,
    wrapped_dows:    lastWeekDows,
    normal_dows:     pickedDows,
    total_calendar_weeks: totalCalendarWeeks,
  };

  const { data: insertedProg, error: progErr } = await supabase
    .from('generated_programs')
    .insert({
      profile_id:       user.id,
      gym_id:           gymId,
      split_type:       result.split,
      program_start:    startDate.toISOString(),
      expires_at:       expiresAt.toISOString(),
      routines_a_count: N,
      duration_weeks:   DURATION_WEEKS,
      schedule_map:     scheduleMapData,
    })
    .select('id')
    .single();
  if (progErr) console.warn('generated_programs insert failed:', progErr.message);

  // Defensive cleanup: expire ANY other active program for this profile.
  // `regenerateMemberProgram` already expires by `.gt('expires_at', NOW)`
  // before the insert, but using `.neq('id', new_id)` here guarantees a
  // single active row even if the pre-insert update was a no-op (clock
  // skew, transient error, or onboarding double-submit).
  if (insertedProg?.id) {
    await supabase
      .from('generated_programs')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('profile_id', user.id)
      .neq('id', insertedProg.id)
      .gt('expires_at', new Date().toISOString());
  }

  // 4. Per-day workout_schedule (canonical mapping for the week) ─────────
  // Wipe stale rows first. Without this, days from a prior program that
  // aren't in the new pickedDows survive and the dashboard's "My Plan"
  // keeps suggesting routines from the expired program on those DOWs.
  // Upsert alone can't clear DOWs that the new program no longer covers.
  await supabase.from('workout_schedule').delete().eq('profile_id', user.id);

  // Only seed variant A here. The Workouts page resolves the correct variant
  // per week from schedule_map.routine_ids_a/_b. Dashboard / notifications
  // that read workout_schedule directly will show variant A for that DOW,
  // which is still a valid program routine for that slot.
  for (let i = 0; i < createdRoutineIdsA.length; i++) {
    await supabase.from('workout_schedule').upsert({
      profile_id:  user.id,
      gym_id:      gymId,
      day_of_week: pickedDows[i],
      routine_id:  createdRoutineIdsA[i],
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'profile_id,day_of_week' });
  }

  posthog?.capture?.('program_generated', {
    split: result.splitLabel,
    goal: snapshot.primary_goal,
    days: snapshot.training_days_per_week,
    routines_count: createdRoutineIds.length,
    variants: 2,
    duration_weeks: DURATION_WEEKS,
  });

  return {
    routines: result.routinesA.map((r) => ({
      // Match what we wrote to DB so any UI consuming this return value
      // shows the creative name, not the generator's raw "Upper A" label.
      name: generateRoutineName(r.slotsKey, r.variantIndex, nameSeed),
      exercises: r.exercises.map((ex) => {
        const info = getExerciseById(ex.exerciseId);
        return { ...ex, name: info?.name || ex.exerciseId, name_es: info?.name_es || null, muscle: info?.muscle || '' };
      }),
    })),
  };
}

// Regenerate from existing profile + member_onboarding state. Used by the
// "Regenerate Program" button so the user doesn't need to re-do onboarding.
//
// The previous generated_program is expired (history kept). Orphan Auto:
// routines — those that aren't claimed by any non-expired program AND have
// no logged sessions referencing them — are deleted so the user's My
// Routines list doesn't pile up with stale "Auto: Upper A"-style cruft from
// pre-creative-naming generations.
export async function regenerateMemberProgram({ supabase, user, posthog, startToday = false }) {
  if (!user?.id) throw new Error('user is required');

  const [{ data: profileRow }, { data: onbRow }] = await Promise.all([
    supabase
      .from('profiles')
      .select('gym_id, preferred_training_days')
      .eq('id', user.id)
      .single(),
    supabase
      .from('member_onboarding')
      .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes, sex, age, workout_duration_min')
      .eq('profile_id', user.id)
      .maybeSingle(),
  ]);

  if (!profileRow?.gym_id) throw new Error('No gym attached to profile');
  if (!onbRow)             throw new Error('No onboarding data found — finish onboarding first');

  // Expire any currently active program (don't delete history).
  await supabase
    .from('generated_programs')
    .update({ expires_at: new Date().toISOString() })
    .eq('profile_id', user.id)
    .gt('expires_at', new Date().toISOString());

  // Sweep orphan Auto: routines: any "Auto: ..."-named routine owned by this
  // user that (a) is not referenced by ANY generated_program's
  // schedule_map.routine_ids and (b) has no workout_sessions logged against
  // it. Cleans up the residual "Upper A / Lower B" rows from old generations
  // so the new creative names are the only thing in the My Routines list.
  try {
    const [{ data: allUserPrograms }, { data: userAutoRoutines }] = await Promise.all([
      supabase.from('generated_programs').select('schedule_map').eq('profile_id', user.id),
      supabase.from('routines').select('id').eq('created_by', user.id).like('name', 'Auto:%'),
    ]);
    const claimed = new Set();
    for (const p of allUserPrograms || []) {
      for (const rid of p.schedule_map?.routine_ids || []) claimed.add(rid);
    }
    const orphanIds = (userAutoRoutines || []).map((r) => r.id).filter((id) => !claimed.has(id));
    if (orphanIds.length > 0) {
      const { data: sessionsReferencing } = await supabase
        .from('workout_sessions')
        .select('routine_id')
        .in('routine_id', orphanIds);
      const referenced = new Set((sessionsReferencing || []).map((s) => s.routine_id));
      const safeToDelete = orphanIds.filter((id) => !referenced.has(id));
      if (safeToDelete.length > 0) {
        await supabase.from('routine_exercises').delete().in('routine_id', safeToDelete);
        await supabase.from('workout_schedule').delete().in('routine_id', safeToDelete);
        await supabase.from('routines').delete().in('id', safeToDelete);
      }
    }
  } catch (cleanupErr) {
    console.warn('regenerate orphan cleanup failed (non-fatal):', cleanupErr?.message);
  }

  const snapshot = {
    fitness_level: onbRow.fitness_level,
    primary_goal:  onbRow.primary_goal,
    training_days_per_week: onbRow.training_days_per_week,
    available_equipment: onbRow.available_equipment,
    injuries_notes:  onbRow.injuries_notes,
    sex: onbRow.sex,
    age: onbRow.age,
    workout_duration_min: onbRow.workout_duration_min,
    preferred_training_days: profileRow.preferred_training_days,
    start_today: !!startToday,
  };

  return generateAndSavePersonalProgram({
    supabase,
    user,
    gymId: profileRow.gym_id,
    snapshot,
    posthog,
  });
}

// Reactivate a past program: copy the routines + schedule_map from
// `sourceProgram` into a NEW generated_programs row whose program_start =
// today and remaining duration = weeks the user still owed. The user
// resumes at the week they paused on rather than restarting from week 1.
//
// Returns { newProgramId, resumedAtWeek } on success.
// Returns { error: '...' } if the source program's routines no longer exist.
export async function reactivatePersonalProgram({ supabase, user, sourceProgram, posthog }) {
  if (!user?.id)        throw new Error('user is required');
  if (!sourceProgram)   throw new Error('sourceProgram is required');

  // Fetch current profile.gym_id so the new program row uses the gym the
  // member is currently enrolled in, not the gym from when the old program
  // was created (which may differ after a gym transfer).
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('gym_id')
    .eq('id', user.id)
    .single();
  const currentGymId = profileRow?.gym_id || sourceProgram.gym_id;

  const schedMap = sourceProgram.schedule_map || {};
  const routineIds = Array.isArray(schedMap.routine_ids) ? schedMap.routine_ids : [];
  if (routineIds.length === 0) {
    return { error: 'no_routines_linked' };
  }

  // Verify routines still exist (user may have deleted them).
  const { data: existingRoutines } = await supabase
    .from('routines')
    .select('id')
    .in('id', routineIds);
  const existingIds = new Set((existingRoutines || []).map((r) => r.id));
  const liveRoutineIds = routineIds.filter((id) => existingIds.has(id));
  if (liveRoutineIds.length === 0) {
    return { error: 'routines_deleted' };
  }

  // Compute where the user paused. Calendar-week based math mirrors the
  // display logic (`getProgramWeekNum` in programWeek.js).
  const totalCalendarWeeks = schedMap.total_calendar_weeks
    || sourceProgram.duration_weeks
    || 12;
  const origStart = sourceProgram.program_start ? new Date(sourceProgram.program_start) : new Date();
  const origStartSunday = new Date(origStart);
  origStartSunday.setHours(0, 0, 0, 0);
  origStartSunday.setDate(origStartSunday.getDate() - origStartSunday.getDay());
  const pauseDate = sourceProgram.expires_at ? new Date(sourceProgram.expires_at) : new Date();
  const daysPaused = Math.floor((pauseDate - origStartSunday) / 86400000);
  const pausedAtWeek = Math.min(
    Math.max(Math.floor(daysPaused / 7) + 1, 1),
    Math.max(totalCalendarWeeks - 1, 1) // leave at least 1 week ahead
  );
  const remainingWeeks = totalCalendarWeeks - pausedAtWeek + 1;

  // Build new schedule_map. Drop the original week1/last_week partial-week
  // logic — resume always lands on a normal full-pattern week. Keep
  // total_calendar_weeks at the ORIGINAL value so the pill reads e.g.
  // "Week 5 of 13" — that's what "resume where left off" should feel like
  // (resumed near the end, not back to a fresh counter).
  const newScheduleMap = {
    ...schedMap,
    week1_map:        [],
    last_week_map:    [],
    week1_dows:       [],
    wrapped_dows:     [],
    total_calendar_weeks: totalCalendarWeeks,
    resumed_from:     sourceProgram.id,
    resumed_at_week:  pausedAtWeek,
  };

  // Compute new program_start so calendar-week math returns `pausedAtWeek`
  // today. We backdate program_start to the Sunday (pausedAtWeek - 1)
  // weeks before this week's Sunday — the user sees "Week pausedAtWeek of
  // totalCalendarWeeks" the moment they reactivate, and has
  // `remainingWeeks` calendar weeks of training ahead of them.
  const now = new Date();
  const todaySunday = new Date(now);
  todaySunday.setHours(0, 0, 0, 0);
  todaySunday.setDate(todaySunday.getDate() - todaySunday.getDay());
  const newProgramStart = new Date(todaySunday);
  newProgramStart.setDate(newProgramStart.getDate() - (pausedAtWeek - 1) * 7);
  newProgramStart.setHours(now.getHours(), now.getMinutes(), now.getSeconds());

  // expires_at = end of week `totalCalendarWeeks` from new program_start.
  // remainingWeeks is reported via analytics only, not used for date math.
  const newExpiresAt = new Date(newProgramStart);
  newExpiresAt.setDate(newExpiresAt.getDate() + totalCalendarWeeks * 7);

  // Expire any currently active program so we land at exactly one active row.
  await supabase
    .from('generated_programs')
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq('profile_id', user.id)
    .gt('expires_at', new Date().toISOString());

  const { data: inserted, error: insErr } = await supabase
    .from('generated_programs')
    .insert({
      profile_id:       user.id,
      gym_id:           currentGymId,
      split_type:       sourceProgram.split_type,
      program_start:    newProgramStart.toISOString(),
      expires_at:       newExpiresAt.toISOString(),
      routines_a_count: liveRoutineIds.length,
      duration_weeks:   sourceProgram.duration_weeks || 12,
      schedule_map:     newScheduleMap,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;

  // Wipe stale workout_schedule rows for this profile so getRoutinesForWeek
  // doesn't mix the just-expired program's days into the reactivated one.
  // The previously-active program's schedule rows would otherwise survive
  // under different DOWs and double up the week.
  await supabase.from('workout_schedule').delete().eq('profile_id', user.id);

  // Insert workout_schedule for these routines on their original DOWs.
  const dayMap = Array.isArray(schedMap.routine_day_map) ? schedMap.routine_day_map : [];
  for (const entry of dayMap) {
    const routineId = routineIds[entry.routine_index];
    if (!routineId || !existingIds.has(routineId)) continue;
    await supabase.from('workout_schedule').upsert({
      profile_id:  user.id,
      gym_id:      currentGymId,
      day_of_week: entry.day_of_week,
      routine_id:  routineId,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'profile_id,day_of_week' });
  }

  posthog?.capture?.('program_reactivated', {
    source_program_id: sourceProgram.id,
    resumed_at_week:   pausedAtWeek,
    remaining_weeks:   remainingWeeks,
  });

  return { newProgramId: inserted.id, resumedAtWeek: pausedAtWeek };
}

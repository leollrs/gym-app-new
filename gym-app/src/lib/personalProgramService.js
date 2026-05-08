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
  const createdRoutineIds = [];
  for (const routine of result.routinesA) {
    const { data: saved, error: rErr } = await supabase
      .from('routines')
      .insert({ name: `Auto: ${routine.name}`, gym_id: gymId, created_by: user.id })
      .select('id')
      .single();
    if (rErr) throw rErr;
    createdRoutineIds.push(saved.id);

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

  const N = createdRoutineIds.length;
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

  const scheduleMapData = {
    routine_day_map: pickedDows.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
    week1_map:       week1Map,
    last_week_map:   lastWeekMap,
    start_dow:       startDow,
    week1_dows:      week1Dows,
    wrapped_dows:    lastWeekDows,
    normal_dows:     pickedDows,
    total_calendar_weeks: totalCalendarWeeks,
  };

  const { error: progErr } = await supabase.from('generated_programs').insert({
    profile_id:       user.id,
    gym_id:           gymId,
    split_type:       result.split,
    program_start:    startDate.toISOString(),
    expires_at:       expiresAt.toISOString(),
    routines_a_count: N,
    duration_weeks:   DURATION_WEEKS,
    schedule_map:     scheduleMapData,
  });
  if (progErr) console.warn('generated_programs insert failed:', progErr.message);

  // 4. Per-day workout_schedule (canonical mapping for the week) ─────────
  for (let i = 0; i < createdRoutineIds.length; i++) {
    await supabase.from('workout_schedule').upsert({
      profile_id:  user.id,
      gym_id:      gymId,
      day_of_week: pickedDows[i],
      routine_id:  createdRoutineIds[i],
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'profile_id,day_of_week' });
  }

  posthog?.capture?.('program_generated', {
    split: result.splitLabel,
    goal: snapshot.primary_goal,
    days: snapshot.training_days_per_week,
    routines_count: result.routinesA.length,
    duration_weeks: DURATION_WEEKS,
  });

  return {
    routines: result.routinesA.map((r) => ({
      name: r.name,
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
// Existing Auto: routines stay in the user's library (preserves history of
// any logged sessions). The previous generated_program is expired but kept
// for history. workout_schedule rows are upserted onto the new picks.
export async function regenerateMemberProgram({ supabase, user, posthog }) {
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
  };

  return generateAndSavePersonalProgram({
    supabase,
    user,
    gymId: profileRow.gym_id,
    snapshot,
    posthog,
  });
}

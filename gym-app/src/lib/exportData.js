import { supabase } from './supabase';

// ── Helper: trigger CSV download in browser ─────────────────────────────────
export function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Helper: escape a CSV field ──────────────────────────────────────────────
function esc(value) {
  if (value == null || value === '') return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Helper: format ISO date to YYYY-MM-DD ───────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD
}

// ── Export Workout History ───────────────────────────────────────────────────
export async function exportWorkoutHistory(userId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`
      id, name, completed_at, duration_seconds, total_volume_lbs,
      session_exercises(
        id, snapshot_name, position,
        session_sets(set_number, weight_lbs, reps, rpe, is_completed)
      )
    `)
    .eq('profile_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(5000);

  if (error) throw error;

  const header = ['Date', 'Routine Name', 'Exercise', 'Set #', 'Weight (lbs)', 'Reps', 'RPE', 'Duration (min)', 'Total Volume'].map(esc).join(',');
  const rows = [];

  for (const session of (data ?? [])) {
    const date = fmtDate(session.completed_at);
    const routineName = session.name || '';
    const durationMin = session.duration_seconds ? Math.round(session.duration_seconds / 60) : '';
    const totalVolume = session.total_volume_lbs ?? '';
    const exercises = (session.session_exercises ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    for (const ex of exercises) {
      const sets = (ex.session_sets ?? []).filter(s => s.is_completed).sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
      for (const set of sets) {
        rows.push([
          date,
          routineName,
          ex.snapshot_name || '',
          set.set_number ?? '',
          set.weight_lbs ?? '',
          set.reps ?? '',
          set.rpe ?? '',
          durationMin,
          totalVolume,
        ].map(esc).join(','));
      }
    }
  }

  const csv = [header, ...rows].join('\n');
  downloadCSV(`workout_history_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Export Personal Records ─────────────────────────────────────────────────
export async function exportPersonalRecords(userId) {
  const { data, error } = await supabase
    .from('personal_records')
    .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
    .eq('profile_id', userId)
    .order('estimated_1rm', { ascending: false })
    .limit(1000);

  if (error) throw error;

  const header = ['Exercise', 'Muscle Group', 'Weight (lbs)', 'Reps', 'Estimated 1RM', 'Date Achieved'].map(esc).join(',');
  const rows = (data ?? []).map(pr => [
    pr.exercises?.name || '',
    pr.exercises?.muscle_group || '',
    pr.weight_lbs ?? '',
    pr.reps ?? '',
    pr.estimated_1rm ?? '',
    fmtDate(pr.achieved_at),
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  downloadCSV(`personal_records_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Admin: Export All Workout History (per-gym) ─────────────────────────────
export async function exportGymWorkoutHistory(gymId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`
      profile_id, name, completed_at, duration_seconds, total_volume_lbs, status,
      profiles!inner(full_name),
      session_exercises(id)
    `)
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(10000);

  if (error) throw error;

  const header = ['Member', 'Date', 'Routine', 'Duration (min)', 'Total Volume (lbs)', 'Sets Completed', 'Status'].map(esc).join(',');
  const rows = (data ?? []).map(s => [
    s.profiles?.full_name || '',
    fmtDate(s.completed_at),
    s.name || '',
    s.duration_seconds ? Math.round(s.duration_seconds / 60) : '',
    s.total_volume_lbs ?? '',
    (s.session_exercises ?? []).length,
    s.status || '',
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  downloadCSV(`gym_workout_history_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Admin: Export All PRs (per-gym) ─────────────────────────────────────────
export async function exportGymPersonalRecords(gymId) {
  const { data, error } = await supabase
    .from('personal_records')
    .select('weight_lbs, reps, estimated_1rm, achieved_at, profiles!inner(full_name, gym_id), exercises(name)')
    .eq('profiles.gym_id', gymId)
    .order('estimated_1rm', { ascending: false })
    .limit(10000);

  if (error) throw error;

  const header = ['Member', 'Exercise', 'Weight (lbs)', 'Reps', 'Estimated 1RM', 'Date Achieved'].map(esc).join(',');
  const rows = (data ?? []).map(pr => [
    pr.profiles?.full_name || '',
    pr.exercises?.name || '',
    pr.weight_lbs ?? '',
    pr.reps ?? '',
    pr.estimated_1rm ?? '',
    fmtDate(pr.achieved_at),
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  downloadCSV(`gym_personal_records_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Admin: Export All Body Metrics (per-gym) ────────────────────────────────
export async function exportGymBodyMetrics(gymId) {
  const [{ data: weights, error: wErr }, { data: measurements, error: mErr }] = await Promise.all([
    supabase
      .from('body_weight_logs')
      .select('weight_lbs, logged_at, profiles!inner(full_name, gym_id)')
      .eq('profiles.gym_id', gymId)
      .order('logged_at', { ascending: true })
      .limit(10000),
    supabase
      .from('body_measurements')
      .select('measured_at, body_fat_pct, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm, profiles!inner(full_name, gym_id)')
      .eq('profiles.gym_id', gymId)
      .order('measured_at', { ascending: true })
      .limit(10000),
  ]);

  if (wErr) throw wErr;
  if (mErr) throw mErr;

  // Combine weight logs
  const weightRows = (weights ?? []).map(w => ({
    member: w.profiles?.full_name || '',
    date: fmtDate(w.logged_at),
    weight_lbs: w.weight_lbs,
  }));

  // Combine measurement rows
  const measurementRows = (measurements ?? []).map(m => ({
    member: m.profiles?.full_name || '',
    date: fmtDate(m.measured_at),
    body_fat_pct: m.body_fat_pct,
    chest_cm: m.chest_cm,
    waist_cm: m.waist_cm,
    hips_cm: m.hips_cm,
    left_arm_cm: m.left_arm_cm,
    right_arm_cm: m.right_arm_cm,
    left_thigh_cm: m.left_thigh_cm,
    right_thigh_cm: m.right_thigh_cm,
  }));

  // Merge by member+date
  const byKey = {};
  for (const w of weightRows) {
    const k = `${w.member}||${w.date}`;
    if (!byKey[k]) byKey[k] = { member: w.member, date: w.date };
    byKey[k].weight_lbs = w.weight_lbs;
  }
  for (const m of measurementRows) {
    const k = `${m.member}||${m.date}`;
    if (!byKey[k]) byKey[k] = { member: m.member, date: m.date };
    Object.assign(byKey[k], {
      body_fat_pct: m.body_fat_pct,
      chest_cm: m.chest_cm,
      waist_cm: m.waist_cm,
      hips_cm: m.hips_cm,
      left_arm_cm: m.left_arm_cm,
      right_arm_cm: m.right_arm_cm,
      left_thigh_cm: m.left_thigh_cm,
      right_thigh_cm: m.right_thigh_cm,
    });
  }

  const sorted = Object.values(byKey).sort((a, b) => a.member.localeCompare(b.member) || a.date.localeCompare(b.date));

  const header = ['Member', 'Date', 'Weight (lbs)', 'Body Fat %', 'Chest (cm)', 'Waist (cm)', 'Hips (cm)', 'Left Arm (cm)', 'Right Arm (cm)', 'Left Thigh (cm)', 'Right Thigh (cm)'].map(esc).join(',');
  const rows = sorted.map(r => [
    r.member,
    r.date,
    r.weight_lbs ?? '',
    r.body_fat_pct ?? '',
    r.chest_cm ?? '',
    r.waist_cm ?? '',
    r.hips_cm ?? '',
    r.left_arm_cm ?? '',
    r.right_arm_cm ?? '',
    r.left_thigh_cm ?? '',
    r.right_thigh_cm ?? '',
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  downloadCSV(`gym_body_metrics_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Export Body Metrics ─────────────────────────────────────────────────────
export async function exportBodyMetrics(userId) {
  const [{ data: weights, error: wErr }, { data: measurements, error: mErr }] = await Promise.all([
    supabase
      .from('body_weight_logs')
      .select('weight_lbs, logged_at')
      .eq('profile_id', userId)
      .order('logged_at', { ascending: true })
      .limit(5000),
    supabase
      .from('body_measurements')
      .select('measured_at, body_fat_pct, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm')
      .eq('profile_id', userId)
      .order('measured_at', { ascending: true })
      .limit(5000),
  ]);

  if (wErr) throw wErr;
  if (mErr) throw mErr;

  // Merge weight logs and measurements by date
  const byDate = {};

  for (const w of (weights ?? [])) {
    const d = fmtDate(w.logged_at);
    if (!byDate[d]) byDate[d] = {};
    byDate[d].weight_lbs = w.weight_lbs;
  }

  for (const m of (measurements ?? [])) {
    const d = fmtDate(m.measured_at);
    if (!byDate[d]) byDate[d] = {};
    Object.assign(byDate[d], {
      body_fat_pct: m.body_fat_pct,
      chest_cm: m.chest_cm,
      waist_cm: m.waist_cm,
      hips_cm: m.hips_cm,
      left_arm_cm: m.left_arm_cm,
      right_arm_cm: m.right_arm_cm,
      left_thigh_cm: m.left_thigh_cm,
      right_thigh_cm: m.right_thigh_cm,
    });
  }

  const header = ['Date', 'Weight (lbs)', 'Body Fat %', 'Chest (cm)', 'Waist (cm)', 'Hips (cm)', 'Left Arm (cm)', 'Right Arm (cm)', 'Left Thigh (cm)', 'Right Thigh (cm)'].map(esc).join(',');
  const sortedDates = Object.keys(byDate).sort();
  const rows = sortedDates.map(date => {
    const r = byDate[date];
    return [
      date,
      r.weight_lbs ?? '',
      r.body_fat_pct ?? '',
      r.chest_cm ?? '',
      r.waist_cm ?? '',
      r.hips_cm ?? '',
      r.left_arm_cm ?? '',
      r.right_arm_cm ?? '',
      r.left_thigh_cm ?? '',
      r.right_thigh_cm ?? '',
    ].map(esc).join(',');
  });

  const csv = [header, ...rows].join('\n');
  downloadCSV(`body_metrics_${fmtDate(new Date().toISOString())}.csv`, csv);
}

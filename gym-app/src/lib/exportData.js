import { supabase } from './supabase';
import { downloadCSVString } from './csvExport';

// ── Helper: trigger CSV download (native + web) ─────────────────────────────
export async function downloadCSV(filename, csvContent) {
  await downloadCSVString(filename, csvContent);
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

// ── Admin: Export Selected Members CSV (by IDs) ────────────────────────────
// Used by bulk-export action in AdminMembers. Pulls fresh data so the export
// is consistent regardless of what's currently rendered in the table.
export async function exportSelectedMembersCSV(selectedIds) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [...(selectedIds || [])];
  if (ids.length === 0) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, membership_status, created_at, last_active_at')
    .in('id', ids)
    .limit(10000);

  if (error) throw error;

  const header = ['Name', 'Username', 'Status', 'Joined', 'Last Active'].map(esc).join(',');
  const rows = (data ?? []).map(m => [
    m.full_name || '',
    m.username || '',
    m.membership_status || 'active',
    fmtDate(m.created_at),
    fmtDate(m.last_active_at),
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  await downloadCSV(`selected_members_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Admin: Export Challenge Results (per-gym) ──────────────────────────────
// Note: challenge_participants doesn't track per-participant completion
// timestamps; we use joined_at as a proxy. TODO: if a `completed_at` column
// is added to challenge_participants, prefer that.
export async function exportChallengeResults(gymId) {
  const { data, error } = await supabase
    .from('challenge_participants')
    .select('score, joined_at, challenges!inner(name, type, status, end_date, gym_id), profiles!inner(full_name)')
    .eq('challenges.gym_id', gymId)
    .order('score', { ascending: false })
    .limit(10000);

  if (error) throw error;

  const header = ['Challenge', 'Member', 'Score', 'Completed At'].map(esc).join(',');
  const rows = (data ?? []).map(cp => [
    cp.challenges?.name || '',
    cp.profiles?.full_name || '',
    cp.score ?? '',
    // Use end_date if challenge is completed, else joined_at as proxy.
    fmtDate(cp.challenges?.status === 'completed' ? cp.challenges?.end_date : cp.joined_at),
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  await downloadCSV(`challenge_results_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Admin: Export Store Purchases / Reward Redemptions (per-gym) ───────────
// Reads from member_purchases (the reward/store purchase table per the
// 0081_gym_store_purchases migration). points_earned is per the schema
// (positive points awarded for the purchase).
export async function exportStorePurchases(gymId) {
  const { data, error } = await supabase
    .from('member_purchases')
    .select('quantity, total_price, points_earned, created_at, profiles!inner(full_name, gym_id), gym_products!inner(name)')
    .eq('profiles.gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) throw error;

  const header = ['Member', 'Item', 'Points', 'Redeemed At'].map(esc).join(',');
  const rows = (data ?? []).map(p => [
    p.profiles?.full_name || '',
    p.gym_products?.name || '',
    p.points_earned ?? '',
    fmtDate(p.created_at),
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  await downloadCSV(`store_purchases_${fmtDate(new Date().toISOString())}.csv`, csv);
}

// ── Admin: Export Class Bookings (per-gym) ─────────────────────────────────
// Reads from gym_class_bookings (per migration 0157_class_booking).
// "attended" is derived from the booking status enum
// (status IN ('confirmed', 'cancelled', 'attended')).
export async function exportClassBookings(gymId) {
  const { data, error } = await supabase
    .from('gym_class_bookings')
    .select('status, booked_at, gym_class_schedules!inner(gym_classes!inner(name, gym_id)), profiles!inner(full_name)')
    .eq('gym_class_schedules.gym_classes.gym_id', gymId)
    .order('booked_at', { ascending: false })
    .limit(10000);

  if (error) throw error;

  const header = ['Class Name', 'Member', 'Booked At', 'Attended'].map(esc).join(',');
  const rows = (data ?? []).map(b => [
    b.gym_class_schedules?.gym_classes?.name || '',
    b.profiles?.full_name || '',
    fmtDate(b.booked_at),
    b.status === 'attended' ? 'yes' : 'no',
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  await downloadCSV(`class_bookings_${fmtDate(new Date().toISOString())}.csv`, csv);
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

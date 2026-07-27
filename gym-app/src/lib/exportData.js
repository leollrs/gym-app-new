import { supabase } from './supabase';
import { downloadCSVString } from './csvExport';
import { selectInBatches, selectAllRows } from './churn/batchedSelect';
import logger from './logger';

// ── Helper: trigger CSV download (native + web) ─────────────────────────────
export async function downloadCSV(filename, csvContent) {
  await downloadCSVString(filename, csvContent);
}

/**
 * Hard ceiling on rows pulled into ANY single export.
 *
 * Every query in this file used to carry `.limit(10000)` / `.limit(5000)`, which
 * read as a safeguard but was a no-op: PostgREST is configured with
 * `max_rows = 1000` and applies LEAST(limit, max_rows), so each of these silently
 * returned the first 1000 rows and the CSV shipped a fraction of the data — the
 * GDPR member-data export included. Verified live: `content-range: 0-999/1275`.
 *
 * They now page via `selectAllRows`, but "page until done" is its own hazard: a
 * multi-year gym export can be 100k+ rows and OOM the Capacitor WebView while it
 * builds the CSV string. So we page to an EXPLICIT bound and, when we hit it,
 * make the truncation visible (logged warning + `truncated: true` on the return)
 * instead of handing the admin a short file that looks complete.
 */
export const EXPORT_MAX_ROWS = 25000;

// Report when an export stopped at the ceiling rather than at the end of the
// data. `count` is the row count that actually made it into the CSV.
//
// Deliberately logger.error, not logger.warn: warn/log/info are no-ops in
// production builds (see lib/logger.js), so a warning here would be invisible
// exactly where it matters. error routes through trackError → the error_logs
// table, which is the only channel that surfaces a silently-short GDPR export.
// Each export also returns `{ rows, truncated }` so a caller can show a toast.
function reportTruncation(label, count) {
  const truncated = count >= EXPORT_MAX_ROWS;
  if (truncated) {
    logger.error(`[export] ${label}: hit the ${EXPORT_MAX_ROWS}-row export ceiling — CSV is TRUNCATED. Narrow the date range or export in slices.`);
  }
  return truncated;
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
  // GDPR "give me my data" export. Was `.limit(5000)` → 1000 sessions max, so a
  // long-tenured member's history was cut off with no indication. Paged, with a
  // (completed_at desc, id asc) stable order so OFFSET paging can't skip or
  // duplicate a session when two finish in the same second.
  const { data, error } = await selectAllRows((lo, hi) => supabase
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
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('workout_history', (data ?? []).length);

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
  await downloadCSV(`workout_history_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Export Personal Records ─────────────────────────────────────────────────
export async function exportPersonalRecords(userId) {
  // `.limit(1000)` sat exactly ON the PostgREST cap — it looked deliberate but
  // meant a member with more than 1000 PR rows got a silently short file. Paged,
  // with `id` as the tiebreaker under the estimated_1rm sort (ties are common —
  // every rep of the same weight computes the same 1RM).
  const { data, error } = await selectAllRows((lo, hi) => supabase
    .from('personal_records')
    .select('id, exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
    .eq('profile_id', userId)
    .order('estimated_1rm', { ascending: false })
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('personal_records', (data ?? []).length);

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
  await downloadCSV(`personal_records_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Admin: Export All Workout History (per-gym) ─────────────────────────────
export async function exportGymWorkoutHistory(gymId) {
  // Gym-wide, so this is the export most likely to have been wrong: `.limit(10000)`
  // returned 1000 rows. A 300-member gym logs that in ~a month — the "all workout
  // history" CSV was effectively "the last month, cut mid-day".
  const { data, error } = await selectAllRows((lo, hi) => supabase
    .from('workout_sessions')
    .select(`
      id, profile_id, name, completed_at, duration_seconds, total_volume_lbs, status,
      profiles!inner(full_name),
      session_exercises(id)
    `)
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('gym_workout_history', (data ?? []).length);

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
  await downloadCSV(`gym_workout_history_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Admin: Export All PRs (per-gym) ─────────────────────────────────────────
export async function exportGymPersonalRecords(gymId) {
  // `.limit(10000)` → 1000. Sorted by estimated_1rm DESC, so what survived was the
  // gym's 1000 heaviest lifts — the CSV looked plausible while omitting every
  // ordinary PR, which is exactly the data an owner exports this for.
  const { data, error } = await selectAllRows((lo, hi) => supabase
    .from('personal_records')
    .select('id, weight_lbs, reps, estimated_1rm, achieved_at, profiles!inner(full_name, gym_id), exercises(name)')
    .eq('profiles.gym_id', gymId)
    .order('estimated_1rm', { ascending: false })
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('gym_personal_records', (data ?? []).length);

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
  await downloadCSV(`gym_personal_records_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Admin: Export All Body Metrics (per-gym) ────────────────────────────────
export async function exportGymBodyMetrics(gymId) {
  // Both `.limit(10000)` calls returned 1000 rows. Sorted ASCENDING here, so the
  // export kept the OLDEST 1000 weigh-ins and dropped everything recent — the
  // opposite of what an owner reviewing current progress expects.
  const [{ data: weights, error: wErr }, { data: measurements, error: mErr }] = await Promise.all([
    selectAllRows((lo, hi) => supabase
      .from('body_weight_logs')
      .select('id, weight_lbs, logged_at, profiles!inner(full_name, gym_id)')
      .eq('profiles.gym_id', gymId)
      .order('logged_at', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi), { maxRows: EXPORT_MAX_ROWS }),
    selectAllRows((lo, hi) => supabase
      .from('body_measurements')
      .select('id, measured_at, body_fat_pct, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm, profiles!inner(full_name, gym_id)')
      .eq('profiles.gym_id', gymId)
      .order('measured_at', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi), { maxRows: EXPORT_MAX_ROWS }),
  ]);

  if (wErr) throw wErr;
  if (mErr) throw mErr;
  // Both reported separately (not short-circuited) so each ceiling hit gets logged.
  const wTruncated = reportTruncation('gym_body_metrics_weights', (weights ?? []).length);
  const mTruncated = reportTruncation('gym_body_metrics_measurements', (measurements ?? []).length);
  const truncated = wTruncated || mTruncated;

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
  await downloadCSV(`gym_body_metrics_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Admin: Export Selected Members CSV (by IDs) ────────────────────────────
// Used by bulk-export action in AdminMembers. Pulls fresh data so the export
// is consistent regardless of what's currently rendered in the table.
export async function exportSelectedMembersCSV(selectedIds) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [...(selectedIds || [])];
  if (ids.length === 0) return;

  // One row per selected id, so a 200-id chunk can never exceed the 1000-row cap
  // — plain selectInBatches (URL-length chunking only) is correct here.
  const { data, error } = await selectInBatches(
    (chunk) => supabase
      .from('profiles')
      .select('id, full_name, username, membership_status, created_at, last_active_at')
      .in('id', chunk),
    ids
  );

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
  // `.limit(10000)` → 1000. Sorted by score DESC and scores tie constantly
  // (everyone who did 0 workouts scores 0), so without a tiebreaker OFFSET paging
  // could also reshuffle across pages — `id` pins the order.
  const { data, error } = await selectAllRows((lo, hi) => supabase
    .from('challenge_participants')
    .select('id, score, joined_at, challenges!inner(name, type, status, end_date, gym_id), profiles!inner(full_name)')
    .eq('challenges.gym_id', gymId)
    .order('score', { ascending: false })
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('challenge_results', (data ?? []).length);

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
  return { rows: rows.length, truncated };
}

// ── Admin: Export Store Purchases / Reward Redemptions (per-gym) ───────────
// Reads from member_purchases (the reward/store purchase table per the
// 0081_gym_store_purchases migration). points_earned is per the schema
// (positive points awarded for the purchase).
export async function exportStorePurchases(gymId) {
  // `.limit(10000)` → 1000 most recent purchases. Accounting-facing export, so a
  // silently short file is the worst failure mode here.
  const { data, error } = await selectAllRows((lo, hi) => supabase
    .from('member_purchases')
    .select('id, quantity, total_price, points_earned, created_at, profiles!inner(full_name, gym_id), gym_products!inner(name)')
    .eq('profiles.gym_id', gymId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('store_purchases', (data ?? []).length);

  const header = ['Member', 'Item', 'Points', 'Redeemed At'].map(esc).join(',');
  const rows = (data ?? []).map(p => [
    p.profiles?.full_name || '',
    p.gym_products?.name || '',
    p.points_earned ?? '',
    fmtDate(p.created_at),
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  await downloadCSV(`store_purchases_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Admin: Export Class Bookings (per-gym) ─────────────────────────────────
// Reads from gym_class_bookings (per migration 0157_class_booking).
// "attended" is derived from the booking status enum
// (status IN ('confirmed', 'cancelled', 'attended')).
export async function exportClassBookings(gymId) {
  // `.limit(10000)` → 1000. A gym running a full class timetable books that in
  // weeks, so the "attendance" column below was being tallied off a partial file.
  const { data, error } = await selectAllRows((lo, hi) => supabase
    .from('gym_class_bookings')
    .select('id, status, booked_at, gym_class_schedules!inner(gym_classes!inner(name, gym_id)), profiles!inner(full_name)')
    .eq('gym_class_schedules.gym_classes.gym_id', gymId)
    .order('booked_at', { ascending: false })
    .order('id', { ascending: true })
    .range(lo, hi), { maxRows: EXPORT_MAX_ROWS });

  if (error) throw error;
  const truncated = reportTruncation('class_bookings', (data ?? []).length);

  const header = ['Class Name', 'Member', 'Booked At', 'Attended'].map(esc).join(',');
  const rows = (data ?? []).map(b => [
    b.gym_class_schedules?.gym_classes?.name || '',
    b.profiles?.full_name || '',
    fmtDate(b.booked_at),
    b.status === 'attended' ? 'yes' : 'no',
  ].map(esc).join(','));

  const csv = [header, ...rows].join('\n');
  await downloadCSV(`class_bookings_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

// ── Export Body Metrics ─────────────────────────────────────────────────────
export async function exportBodyMetrics(userId) {
  // Member-facing GDPR export. Both `.limit(5000)` calls were no-ops (→1000) and
  // sorted ASC, so a daily weigher lost everything past their first ~2.7 years.
  const [{ data: weights, error: wErr }, { data: measurements, error: mErr }] = await Promise.all([
    selectAllRows((lo, hi) => supabase
      .from('body_weight_logs')
      .select('id, weight_lbs, logged_at')
      .eq('profile_id', userId)
      .order('logged_at', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi), { maxRows: EXPORT_MAX_ROWS }),
    selectAllRows((lo, hi) => supabase
      .from('body_measurements')
      .select('id, measured_at, body_fat_pct, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm')
      .eq('profile_id', userId)
      .order('measured_at', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi), { maxRows: EXPORT_MAX_ROWS }),
  ]);

  if (wErr) throw wErr;
  if (mErr) throw mErr;
  const wTruncated = reportTruncation('body_metrics_weights', (weights ?? []).length);
  const mTruncated = reportTruncation('body_metrics_measurements', (measurements ?? []).length);
  const truncated = wTruncated || mTruncated;

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
  await downloadCSV(`body_metrics_${fmtDate(new Date().toISOString())}.csv`, csv);
  return { rows: rows.length, truncated };
}

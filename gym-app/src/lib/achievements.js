// ── Achievement Definitions ───────────────────────────────────────────────────
// data shape: { totalSessions, currentStreak, totalPRs, friendCount,
//               sessionsInFirst6Weeks, challengesCompleted, totalVolumeLbs }
// icon: lucide-react icon name (rendered as SVG in UI)

export const ACHIEVEMENT_DEFS = [
  // Workouts
  {
    key: 'first_workout',
    label: 'First Rep',
    labelKey: 'milestones.first_workout.label',
    icon: 'Dumbbell',
    desc: 'Log your very first workout',
    descKey: 'milestones.first_workout.desc',
    color: '#D4AF37',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 1,
    progressOf: null,
  },
  {
    key: 'sessions_10',
    label: '10 Sessions',
    labelKey: 'milestones.sessions_10.label',
    icon: 'Flame',
    desc: 'Complete 10 workouts',
    descKey: 'milestones.sessions_10.desc',
    color: '#D4AF37',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 10,
    progressOf: { key: 'totalSessions', target: 10 },
  },
  {
    key: 'sessions_25',
    label: '25 Sessions',
    labelKey: 'milestones.sessions_25.label',
    icon: 'Zap',
    desc: 'Complete 25 workouts',
    descKey: 'milestones.sessions_25.desc',
    color: '#F97316',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 25,
    progressOf: { key: 'totalSessions', target: 25 },
  },
  {
    key: 'sessions_50',
    label: 'Half Century',
    labelKey: 'milestones.sessions_50.label',
    icon: 'Star',
    desc: 'Complete 50 workouts',
    descKey: 'milestones.sessions_50.desc',
    color: '#A78BFA',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 50,
    progressOf: { key: 'totalSessions', target: 50 },
  },
  {
    key: 'century_club',
    label: 'Century Club',
    labelKey: 'milestones.century_club.label',
    icon: 'Trophy',
    desc: '100 workouts completed',
    descKey: 'milestones.century_club.desc',
    color: '#EF4444',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 100,
    progressOf: { key: 'totalSessions', target: 100 },
  },
  { key: 'sessions_200', label: 'Iron Veteran', labelKey: 'milestones.sessions_200.label', icon: 'Shield', desc: 'Complete 200 workouts', descKey: 'milestones.sessions_200.desc', color: '#EF4444', category: 'Workouts', check: (d) => d.totalSessions >= 200, progressOf: { key: 'totalSessions', target: 200 } },
  { key: 'sessions_500', label: 'Legend', labelKey: 'milestones.sessions_500.label', icon: 'Crown', desc: 'Complete 500 workouts', descKey: 'milestones.sessions_500.desc', color: '#D4AF37', category: 'Workouts', check: (d) => d.totalSessions >= 500, progressOf: { key: 'totalSessions', target: 500 } },
  // Streaks
  {
    key: 'streak_7',
    label: 'Week Warrior',
    labelKey: 'milestones.streak_7.label',
    icon: 'CalendarCheck',
    desc: 'Train 7 days in a row',
    descKey: 'milestones.streak_7.desc',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 7,
    progressOf: { key: 'currentStreak', target: 7 },
  },
  {
    key: 'streak_30',
    label: 'Monthly Machine',
    labelKey: 'milestones.streak_30.label',
    icon: 'RotateCw',
    desc: 'Train 30 days in a row',
    descKey: 'milestones.streak_30.desc',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 30,
    progressOf: { key: 'currentStreak', target: 30 },
  },
  {
    key: 'streak_90',
    label: 'Unstoppable',
    labelKey: 'milestones.streak_90.label',
    icon: 'Rocket',
    desc: '90-day training streak',
    descKey: 'milestones.streak_90.desc',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 90,
    progressOf: { key: 'currentStreak', target: 90 },
  },
  { key: 'streak_14', label: 'Two Week Terror', labelKey: 'milestones.streak_14.label', icon: 'Flame', desc: 'Train 14 days in a row', descKey: 'milestones.streak_14.desc', color: '#10B981', category: 'Streaks', check: (d) => d.currentStreak >= 14, progressOf: { key: 'currentStreak', target: 14 } },
  { key: 'streak_180', label: 'Half Year Hero', labelKey: 'milestones.streak_180.label', icon: 'Mountain', desc: '180-day training streak', descKey: 'milestones.streak_180.desc', color: '#10B981', category: 'Streaks', check: (d) => d.currentStreak >= 180, progressOf: { key: 'currentStreak', target: 180 } },
  { key: 'streak_365', label: 'Year of Iron', labelKey: 'milestones.streak_365.label', icon: 'Trophy', desc: '365-day training streak — absolute legend', descKey: 'milestones.streak_365.desc', color: '#D4AF37', category: 'Streaks', check: (d) => d.currentStreak >= 365, progressOf: { key: 'currentStreak', target: 365 } },
  // PRs
  {
    key: 'first_pr',
    label: 'Personal Best',
    labelKey: 'milestones.first_pr.label',
    icon: 'Target',
    desc: 'Set your first personal record',
    descKey: 'milestones.first_pr.desc',
    color: '#D4AF37',
    category: 'PRs',
    check: (d) => d.totalPRs >= 1,
    progressOf: null,
  },
  {
    key: 'prs_10',
    label: 'PR Machine',
    labelKey: 'milestones.prs_10.label',
    icon: 'TrendingUp',
    desc: 'Set 10 personal records',
    descKey: 'milestones.prs_10.desc',
    color: '#D4AF37',
    category: 'PRs',
    check: (d) => d.totalPRs >= 10,
    progressOf: { key: 'totalPRs', target: 10 },
  },
  { key: 'prs_25', label: 'Record Breaker', labelKey: 'milestones.prs_25.label', icon: 'Award', desc: 'Set 25 personal records', descKey: 'milestones.prs_25.desc', color: '#F97316', category: 'PRs', check: (d) => d.totalPRs >= 25, progressOf: { key: 'totalPRs', target: 25 } },
  { key: 'prs_50', label: 'PR Legend', labelKey: 'milestones.prs_50.label', icon: 'Crown', desc: 'Set 50 personal records', descKey: 'milestones.prs_50.desc', color: '#EF4444', category: 'PRs', check: (d) => d.totalPRs >= 50, progressOf: { key: 'totalPRs', target: 50 } },
  // Social
  {
    key: 'first_friend',
    label: 'Better Together',
    labelKey: 'milestones.first_friend.label',
    icon: 'UserPlus',
    desc: 'Add your first gym friend',
    descKey: 'milestones.first_friend.desc',
    color: '#3B82F6',
    category: 'Social',
    check: (d) => d.friendCount >= 1,
    progressOf: null,
  },
  {
    key: 'social_5',
    label: 'Squad Goals',
    labelKey: 'milestones.social_5.label',
    icon: 'Users',
    desc: 'Have 5 friends in the gym',
    descKey: 'milestones.social_5.desc',
    color: '#3B82F6',
    category: 'Social',
    check: (d) => d.friendCount >= 5,
    progressOf: { key: 'friendCount', target: 5 },
  },
  { key: 'social_10', label: 'Popular', labelKey: 'milestones.social_10.label', icon: 'Heart', desc: 'Have 10 friends in the gym', descKey: 'milestones.social_10.desc', color: '#3B82F6', category: 'Social', check: (d) => d.friendCount >= 10, progressOf: { key: 'friendCount', target: 10 } },
  { key: 'social_20', label: 'Influencer', labelKey: 'milestones.social_20.label', icon: 'Megaphone', desc: 'Have 20 friends in the gym', descKey: 'milestones.social_20.desc', color: '#8B5CF6', category: 'Social', check: (d) => d.friendCount >= 20, progressOf: { key: 'friendCount', target: 20 } },
  // Special
  {
    key: 'habit_formed',
    label: 'Habit Formed',
    labelKey: 'milestones.habit_formed.label',
    icon: 'Brain',
    desc: 'Complete 9 workouts in your first 6 weeks',
    descKey: 'milestones.habit_formed.desc',
    color: '#8B5CF6',
    category: 'Special',
    check: (d) => d.sessionsInFirst6Weeks >= 9,
    progressOf: { key: 'sessionsInFirst6Weeks', target: 9 },
  },
  {
    key: 'first_challenge',
    label: 'Competitor',
    labelKey: 'milestones.first_challenge.label',
    icon: 'Medal',
    desc: 'Complete your first challenge',
    descKey: 'milestones.first_challenge.desc',
    color: '#F59E0B',
    category: 'Special',
    check: (d) => d.challengesCompleted >= 1,
    progressOf: null,
  },
  { key: 'challenges_5', label: 'Challenge Addict', labelKey: 'milestones.challenges_5.label', icon: 'Swords', desc: 'Complete 5 challenges', descKey: 'milestones.challenges_5.desc', color: '#F59E0B', category: 'Special', check: (d) => d.challengesCompleted >= 5, progressOf: { key: 'challengesCompleted', target: 5 } },
  { key: 'checkins_10', label: 'Regular', labelKey: 'milestones.checkins_10.label', icon: 'MapPin', desc: 'Check in 10 times in a month', descKey: 'milestones.checkins_10.desc', color: '#10B981', category: 'Special', check: (d) => d.monthlyCheckins >= 10, progressOf: { key: 'monthlyCheckins', target: 10 } },
  { key: 'first_nutrition', label: 'Fuel Up', labelKey: 'milestones.first_nutrition.label', icon: 'Apple', desc: 'Log your first meal', descKey: 'milestones.first_nutrition.desc', color: '#34D399', category: 'Special', check: (d) => d.hasNutritionLog, progressOf: null },
  // Volume
  {
    key: 'volume_10k',
    label: '10K Club',
    labelKey: 'milestones.volume_10k.label',
    icon: 'Weight',
    desc: 'Lift 10,000 lbs total',
    descKey: 'milestones.volume_10k.desc',
    color: '#6B7280',
    category: 'Volume',
    check: (d) => d.totalVolumeLbs >= 10000,
    progressOf: { key: 'totalVolumeLbs', target: 10000 },
  },
  {
    key: 'volume_100k',
    label: '100K Strong',
    labelKey: 'milestones.volume_100k.label',
    icon: 'Gem',
    desc: 'Lift 100,000 lbs total',
    descKey: 'milestones.volume_100k.desc',
    color: '#D4AF37',
    category: 'Volume',
    check: (d) => d.totalVolumeLbs >= 100000,
    progressOf: { key: 'totalVolumeLbs', target: 100000 },
  },
  { key: 'volume_500k', label: 'Half Ton Hero', labelKey: 'milestones.volume_500k.label', icon: 'Mountain', desc: 'Lift 500,000 lbs total', descKey: 'milestones.volume_500k.desc', color: '#A78BFA', category: 'Volume', check: (d) => d.totalVolumeLbs >= 500000, progressOf: { key: 'totalVolumeLbs', target: 500000 } },
  { key: 'volume_1m', label: 'Million Pound Club', labelKey: 'milestones.volume_1m.label', icon: 'Crown', desc: 'Lift 1,000,000 lbs total', descKey: 'milestones.volume_1m.desc', color: '#D4AF37', category: 'Volume', check: (d) => d.totalVolumeLbs >= 1000000, progressOf: { key: 'totalVolumeLbs', target: 1000000 } },
];

// ── Category order for display ────────────────────────────────────────────────
export const ACHIEVEMENT_CATEGORIES = ['Workouts', 'Streaks', 'PRs', 'Volume', 'Social', 'Special'];

// ── Check which achievements are newly earned ─────────────────────────────────
// data: { totalSessions, currentStreak, totalPRs, friendCount,
//         sessionsInFirst6Weeks, challengesCompleted, totalVolumeLbs }
// earnedKeys: string[] of already-earned achievement keys
// Returns: array of newly earned achievement defs
export function checkNewAchievements(data, earnedKeys) {
  const earnedSet = new Set(earnedKeys);
  return ACHIEVEMENT_DEFS.filter(
    (def) => !earnedSet.has(def.key) && def.check(data)
  );
}

// ── Compute streak from an array of session objects with completed_at ─────────
// Options:
//   restDays: number[]      — days of week with no workout scheduled (0=Sun..6=Sat)
//   closureDates: string[]  — specific dates the gym is closed ('YYYY-MM-DD')
//   gymClosedDays: number[] — recurring day-of-week closures (0=Sun..6=Sat)
//   freezesUsed: number     — how many freezes already used this month (from DB)
//   freezesMax: number      — max freezes allowed this month (from DB)
export function computeStreakFromSessions(sessions, {
  restDays = [],
  closureDates = [],
  gymClosedDays = [],
  freezesUsed = 0,
  freezesMax = 2,
} = {}) {
  const dates = new Set(
    sessions.map((s) => new Date(s.completed_at).toDateString())
  );

  // Build a Set for fast closure-date lookups
  const closureDateSet = new Set(closureDates);

  // Only use freeze/rest-day logic if user has specific training days set
  const hasSchedule = restDays.length > 0;
  let freezesRemaining = hasSchedule ? Math.max(0, freezesMax - freezesUsed) : 0;

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dow = d.getDay();
    const dateStr = d.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    if (dates.has(d.toDateString())) {
      streak++;
    } else if (i === 0) {
      continue;
    } else if (closureDateSet.has(dateStr)) {
      // Specific closure date (holiday, maintenance, etc.) — counts toward streak
      streak++;
    } else if (hasSchedule && restDays.includes(dow)) {
      // Scheduled rest day — only counts if user has specific training days
      streak++;
    } else if (gymClosedDays.includes(dow)) {
      streak++;
    } else if (hasSchedule && freezesRemaining > 0) {
      // Freeze only available when user has a specific schedule
      freezesRemaining--;
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ── Helper: fetch streak with all protections from DB ──────────────────────────
// Fetches gym closures, freeze usage, and workout schedule, then computes streak.
// Requires supabase client as parameter. Gracefully falls back if tables don't exist.
export async function getStreakWithProtections(userId, gymId, sessions, supabase, prefetched = {}) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  let closureDates = [];
  let freezesUsed = 0;
  let freezesMax = 2;
  let restDays = [];
  let gymClosedDays = [];

  try {
    // Build the list of queries, skipping any that have pre-fetched data
    const closuresPromise = supabase
      .from('gym_closures')
      .select('closure_date')
      .eq('gym_id', gymId)
      .gte('closure_date', oneYearAgo);
    const freezePromise = supabase
      .from('streak_freezes')
      .select('used_count, max_allowed')
      .eq('profile_id', userId)
      .eq('month', currentMonth)
      .maybeSingle();
    const schedulePromise = prefetched.scheduleData != null
      ? Promise.resolve({ data: prefetched.scheduleData })
      : supabase
          .from('workout_schedule')
          .select('day_of_week')
          .eq('profile_id', userId);
    const gymPromise = supabase
      .from('gyms')
      .select('open_days')
      .eq('id', gymId)
      .maybeSingle();

    const [closuresRes, freezeRes, scheduleRes, gymRes] = await Promise.all([
      closuresPromise,
      freezePromise,
      schedulePromise,
      gymPromise,
    ]);

    closureDates = (closuresRes.data || []).map(c => c.closure_date);

    const freeze = freezeRes.data;
    freezesUsed = freeze?.used_count || 0;
    freezesMax = freeze?.max_allowed || 2;

    const scheduledDays = (scheduleRes.data || []).map(s => s.day_of_week);
    restDays = scheduledDays.length > 0
      ? [0, 1, 2, 3, 4, 5, 6].filter(d => !scheduledDays.includes(d))
      : [];

    const gymOpenDays = gymRes.data?.open_days || [];
    gymClosedDays = gymOpenDays.length > 0
      ? [0, 1, 2, 3, 4, 5, 6].filter(d => !gymOpenDays.includes(d))
      : [];
  } catch (err) {
    // Gracefully fall back if tables don't exist yet (e.g. migration not applied)
    console.warn('getStreakWithProtections: falling back to basic streak', err?.message);
  }

  return computeStreakFromSessions(sessions, {
    restDays,
    closureDates,
    gymClosedDays,
    freezesUsed,
    freezesMax,
  });
}

// ── Use a streak freeze (database-backed) ────────────────────────────────────
// Upserts the current month's freeze row, incrementing used_count by 1.
// Returns true if freeze was applied, false if none remaining.
export async function useStreakFreeze(userId, supabase) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  try {
    // Fetch current freeze data
    const { data: existing } = await supabase
      .from('streak_freezes')
      .select('id, used_count, max_allowed')
      .eq('profile_id', userId)
      .eq('month', currentMonth)
      .maybeSingle();

    const usedCount = existing?.used_count || 0;
    const maxAllowed = existing?.max_allowed || 2;

    if (usedCount >= maxAllowed) return false;

    if (existing) {
      await supabase
        .from('streak_freezes')
        .update({ used_count: usedCount + 1 })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('streak_freezes')
        .insert({ profile_id: userId, month: currentMonth, used_count: 1, max_allowed: 2 });
    }
    return true;
  } catch (err) {
    console.warn('useStreakFreeze failed:', err?.message);
    return false;
  }
}

// ── Fetch all data needed for achievement checking ────────────────────────────
export async function fetchAchievementData(userId, gymId, supabase) {
  const [
    { data: sessionRows },
    { data: prRows },
    { data: friendRows },
    { data: challengeRows },
    { data: profileRow },
  ] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id, completed_at, total_volume_lbs')
      .eq('profile_id', userId)
      .eq('status', 'completed'),
    supabase
      .from('personal_records')
      .select('id')
      .eq('profile_id', userId),
    supabase
      .from('friendships')
      .select('id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase
      .from('challenge_participants')
      .select('id, challenges(status, end_date)')
      .eq('profile_id', userId)
      .eq('gym_id', gymId),
    supabase
      .from('profiles')
      .select('created_at')
      .eq('id', userId)
      .single(),
  ]);

  const sessions = sessionRows ?? [];
  const totalSessions = sessions.length;
  const currentStreak = await getStreakWithProtections(userId, gymId, sessions, supabase);
  const totalPRs = (prRows ?? []).length;
  const friendCount = (friendRows ?? []).length;
  const totalVolumeLbs = sessions.reduce(
    (sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0),
    0
  );

  let sessionsInFirst6Weeks = 0;
  if (profileRow?.created_at) {
    const joinDate = new Date(profileRow.created_at);
    const cutoff = new Date(joinDate.getTime() + 42 * 24 * 60 * 60 * 1000);
    sessionsInFirst6Weeks = sessions.filter((s) => {
      const d = new Date(s.completed_at);
      return d >= joinDate && d <= cutoff;
    }).length;
  }

  const now = new Date();
  const challengesCompleted = (challengeRows ?? []).filter((p) => {
    const c = p.challenges;
    if (!c) return false;
    return c.status === 'ended' || new Date(c.end_date) < now;
  }).length;

  return {
    totalSessions,
    currentStreak,
    totalPRs,
    friendCount,
    sessionsInFirst6Weeks,
    challengesCompleted,
    totalVolumeLbs,
  };
}

// ── Award new achievements ────────────────────────────────────────────────────
export async function awardAchievements(userId, gymId, supabase) {
  if (!userId || !gymId) return [];

  const { data: existingRows, error: selectErr } = await supabase
    .from('user_achievements')
    .select('achievement_key, earned_at')
    .eq('user_id', userId)
    .eq('gym_id', gymId);

  if (selectErr) console.warn('Achievement select error:', selectErr.message);

  const existingKeys = (existingRows ?? []).map((r) => r.achievement_key);
  const data = await fetchAchievementData(userId, gymId, supabase);
  const newDefs = checkNewAchievements(data, existingKeys);
  if (newDefs.length === 0) return [];

  const now = new Date().toISOString();
  const inserts = newDefs.map((def) => ({
    user_id: userId,
    profile_id: userId,
    gym_id: gymId,
    achievement_key: def.key,
    earned_at: now,
    unlocked_at: now,
  }));

  const { error } = await supabase
    .from('user_achievements')
    .upsert(inserts, { onConflict: 'user_id,achievement_key', ignoreDuplicates: true });

  if (error) console.warn('Achievement upsert error:', error.message);

  return newDefs;
}

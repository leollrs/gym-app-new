// ── Achievement Definitions ───────────────────────────────────────────────────
// data shape: { totalSessions, currentStreak, totalPRs, friendCount,
//               sessionsInFirst6Weeks, challengesCompleted, totalVolumeLbs }
// icon: lucide-react icon name (rendered as SVG in UI)

export const ACHIEVEMENT_DEFS = [
  // Workouts
  {
    key: 'first_workout',
    label: 'First Rep',
    icon: 'Dumbbell',
    desc: 'Log your very first workout',
    color: '#D4AF37',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 1,
    progressOf: null,
  },
  {
    key: 'sessions_10',
    label: '10 Sessions',
    icon: 'Flame',
    desc: 'Complete 10 workouts',
    color: '#D4AF37',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 10,
    progressOf: { key: 'totalSessions', target: 10 },
  },
  {
    key: 'sessions_25',
    label: '25 Sessions',
    icon: 'Zap',
    desc: 'Complete 25 workouts',
    color: '#F97316',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 25,
    progressOf: { key: 'totalSessions', target: 25 },
  },
  {
    key: 'sessions_50',
    label: 'Half Century',
    icon: 'Star',
    desc: 'Complete 50 workouts',
    color: '#A78BFA',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 50,
    progressOf: { key: 'totalSessions', target: 50 },
  },
  {
    key: 'century_club',
    label: 'Century Club',
    icon: 'Trophy',
    desc: '100 workouts completed',
    color: '#EF4444',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 100,
    progressOf: { key: 'totalSessions', target: 100 },
  },
  { key: 'sessions_200', label: 'Iron Veteran', icon: 'Shield', desc: 'Complete 200 workouts', color: '#EF4444', category: 'Workouts', check: (d) => d.totalSessions >= 200, progressOf: { key: 'totalSessions', target: 200 } },
  { key: 'sessions_500', label: 'Legend', icon: 'Crown', desc: 'Complete 500 workouts', color: '#D4AF37', category: 'Workouts', check: (d) => d.totalSessions >= 500, progressOf: { key: 'totalSessions', target: 500 } },
  // Streaks
  {
    key: 'streak_7',
    label: 'Week Warrior',
    icon: 'CalendarCheck',
    desc: 'Train 7 days in a row',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 7,
    progressOf: { key: 'currentStreak', target: 7 },
  },
  {
    key: 'streak_30',
    label: 'Monthly Machine',
    icon: 'RotateCw',
    desc: 'Train 30 days in a row',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 30,
    progressOf: { key: 'currentStreak', target: 30 },
  },
  {
    key: 'streak_90',
    label: 'Unstoppable',
    icon: 'Rocket',
    desc: '90-day training streak',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 90,
    progressOf: { key: 'currentStreak', target: 90 },
  },
  { key: 'streak_14', label: 'Two Week Terror', icon: 'Flame', desc: 'Train 14 days in a row', color: '#10B981', category: 'Streaks', check: (d) => d.currentStreak >= 14, progressOf: { key: 'currentStreak', target: 14 } },
  { key: 'streak_180', label: 'Half Year Hero', icon: 'Mountain', desc: '180-day training streak', color: '#10B981', category: 'Streaks', check: (d) => d.currentStreak >= 180, progressOf: { key: 'currentStreak', target: 180 } },
  { key: 'streak_365', label: 'Year of Iron', icon: 'Trophy', desc: '365-day training streak — absolute legend', color: '#D4AF37', category: 'Streaks', check: (d) => d.currentStreak >= 365, progressOf: { key: 'currentStreak', target: 365 } },
  // PRs
  {
    key: 'first_pr',
    label: 'Personal Best',
    icon: 'Target',
    desc: 'Set your first personal record',
    color: '#D4AF37',
    category: 'PRs',
    check: (d) => d.totalPRs >= 1,
    progressOf: null,
  },
  {
    key: 'prs_10',
    label: 'PR Machine',
    icon: 'TrendingUp',
    desc: 'Set 10 personal records',
    color: '#D4AF37',
    category: 'PRs',
    check: (d) => d.totalPRs >= 10,
    progressOf: { key: 'totalPRs', target: 10 },
  },
  { key: 'prs_25', label: 'Record Breaker', icon: 'Award', desc: 'Set 25 personal records', color: '#F97316', category: 'PRs', check: (d) => d.totalPRs >= 25, progressOf: { key: 'totalPRs', target: 25 } },
  { key: 'prs_50', label: 'PR Legend', icon: 'Crown', desc: 'Set 50 personal records', color: '#EF4444', category: 'PRs', check: (d) => d.totalPRs >= 50, progressOf: { key: 'totalPRs', target: 50 } },
  // Social
  {
    key: 'first_friend',
    label: 'Better Together',
    icon: 'UserPlus',
    desc: 'Add your first gym friend',
    color: '#3B82F6',
    category: 'Social',
    check: (d) => d.friendCount >= 1,
    progressOf: null,
  },
  {
    key: 'social_5',
    label: 'Squad Goals',
    icon: 'Users',
    desc: 'Have 5 friends in the gym',
    color: '#3B82F6',
    category: 'Social',
    check: (d) => d.friendCount >= 5,
    progressOf: { key: 'friendCount', target: 5 },
  },
  { key: 'social_10', label: 'Popular', icon: 'Heart', desc: 'Have 10 friends in the gym', color: '#3B82F6', category: 'Social', check: (d) => d.friendCount >= 10, progressOf: { key: 'friendCount', target: 10 } },
  { key: 'social_20', label: 'Influencer', icon: 'Megaphone', desc: 'Have 20 friends in the gym', color: '#8B5CF6', category: 'Social', check: (d) => d.friendCount >= 20, progressOf: { key: 'friendCount', target: 20 } },
  // Special
  {
    key: 'habit_formed',
    label: 'Habit Formed',
    icon: 'Brain',
    desc: 'Complete 9 workouts in your first 6 weeks',
    color: '#8B5CF6',
    category: 'Special',
    check: (d) => d.sessionsInFirst6Weeks >= 9,
    progressOf: { key: 'sessionsInFirst6Weeks', target: 9 },
  },
  {
    key: 'first_challenge',
    label: 'Competitor',
    icon: 'Medal',
    desc: 'Complete your first challenge',
    color: '#F59E0B',
    category: 'Special',
    check: (d) => d.challengesCompleted >= 1,
    progressOf: null,
  },
  { key: 'challenges_5', label: 'Challenge Addict', icon: 'Swords', desc: 'Complete 5 challenges', color: '#F59E0B', category: 'Special', check: (d) => d.challengesCompleted >= 5, progressOf: { key: 'challengesCompleted', target: 5 } },
  { key: 'checkins_10', label: 'Regular', icon: 'MapPin', desc: 'Check in 10 times in a month', color: '#10B981', category: 'Special', check: (d) => d.monthlyCheckins >= 10, progressOf: { key: 'monthlyCheckins', target: 10 } },
  { key: 'first_nutrition', label: 'Fuel Up', icon: 'Apple', desc: 'Log your first meal', color: '#34D399', category: 'Special', check: (d) => d.hasNutritionLog, progressOf: null },
  // Volume
  {
    key: 'volume_10k',
    label: '10K Club',
    icon: 'Weight',
    desc: 'Lift 10,000 lbs total',
    color: '#6B7280',
    category: 'Volume',
    check: (d) => d.totalVolumeLbs >= 10000,
    progressOf: { key: 'totalVolumeLbs', target: 10000 },
  },
  {
    key: 'volume_100k',
    label: '100K Strong',
    icon: 'Gem',
    desc: 'Lift 100,000 lbs total',
    color: '#D4AF37',
    category: 'Volume',
    check: (d) => d.totalVolumeLbs >= 100000,
    progressOf: { key: 'totalVolumeLbs', target: 100000 },
  },
  { key: 'volume_500k', label: 'Half Ton Hero', icon: 'Mountain', desc: 'Lift 500,000 lbs total', color: '#A78BFA', category: 'Volume', check: (d) => d.totalVolumeLbs >= 500000, progressOf: { key: 'totalVolumeLbs', target: 500000 } },
  { key: 'volume_1m', label: 'Million Pound Club', icon: 'Crown', desc: 'Lift 1,000,000 lbs total', color: '#D4AF37', category: 'Volume', check: (d) => d.totalVolumeLbs >= 1000000, progressOf: { key: 'totalVolumeLbs', target: 1000000 } },
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

// ── Streak freeze config ─────────────────────────────────────────────────────
const FREEZES_PER_MONTH = 2;

// Get or initialize freeze data for the current month from localStorage
export function getStreakFreezes(userId) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storageKey = `streak_freezes_${userId}_${monthKey}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) return JSON.parse(stored);
  return { month: monthKey, total: FREEZES_PER_MONTH, used: 0 };
}

export function useStreakFreeze(userId) {
  const freezes = getStreakFreezes(userId);
  if (freezes.used >= freezes.total) return false;
  freezes.used += 1;
  const storageKey = `streak_freezes_${userId}_${freezes.month}`;
  localStorage.setItem(storageKey, JSON.stringify(freezes));
  return true;
}

// ── Compute streak from an array of session objects with completed_at ─────────
// Options:
//   restDays: number[] — days of week with no workout scheduled (0=Sun..6=Sat)
//   userId: string — for freeze tracking
export function computeStreakFromSessions(sessions, { restDays = [], userId = null } = {}) {
  const dates = new Set(
    sessions.map((s) => new Date(s.completed_at).toDateString())
  );

  const freezes = userId ? getStreakFreezes(userId) : { total: 0, used: 0 };
  let freezesRemaining = freezes.total - freezes.used;

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);

    if (dates.has(d.toDateString())) {
      streak++;
    } else if (i === 0) {
      // Today — haven't worked out yet, don't break
      continue;
    } else if (restDays.includes(d.getDay())) {
      // Scheduled rest day — skip, doesn't break streak
      streak++;
    } else if (freezesRemaining > 0) {
      // Use a freeze for this missed day
      freezesRemaining--;
      streak++;
    } else {
      break;
    }
  }
  return streak;
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
  const currentStreak = computeStreakFromSessions(sessions);
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

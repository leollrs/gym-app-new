// ── Achievement Definitions ───────────────────────────────────────────────────
// data shape: { totalSessions, currentStreak, totalPRs, friendCount,
//               sessionsInFirst6Weeks, challengesCompleted, totalVolumeLbs }

export const ACHIEVEMENT_DEFS = [
  // Workouts
  {
    key: 'first_workout',
    label: 'First Rep',
    icon: '🏋️',
    desc: 'Log your very first workout',
    color: '#D4AF37',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 1,
    progressOf: null,
  },
  {
    key: 'sessions_10',
    label: '10 Sessions',
    icon: '💪',
    desc: 'Complete 10 workouts',
    color: '#D4AF37',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 10,
    progressOf: { key: 'totalSessions', target: 10 },
  },
  {
    key: 'sessions_25',
    label: '25 Sessions',
    icon: '🔥',
    desc: 'Complete 25 workouts',
    color: '#F97316',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 25,
    progressOf: { key: 'totalSessions', target: 25 },
  },
  {
    key: 'sessions_50',
    label: 'Half Century',
    icon: '⚡',
    desc: 'Complete 50 workouts',
    color: '#A78BFA',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 50,
    progressOf: { key: 'totalSessions', target: 50 },
  },
  {
    key: 'century_club',
    label: 'Century Club',
    icon: '🏆',
    desc: '100 workouts completed',
    color: '#EF4444',
    category: 'Workouts',
    check: (d) => d.totalSessions >= 100,
    progressOf: { key: 'totalSessions', target: 100 },
  },
  // Streaks
  {
    key: 'streak_7',
    label: 'Week Warrior',
    icon: '📅',
    desc: 'Train 7 days in a row',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 7,
    progressOf: { key: 'currentStreak', target: 7 },
  },
  {
    key: 'streak_30',
    label: 'Monthly Machine',
    icon: '🔁',
    desc: 'Train 30 days in a row',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 30,
    progressOf: { key: 'currentStreak', target: 30 },
  },
  {
    key: 'streak_90',
    label: 'Unstoppable',
    icon: '🚀',
    desc: '90-day training streak',
    color: '#10B981',
    category: 'Streaks',
    check: (d) => d.currentStreak >= 90,
    progressOf: { key: 'currentStreak', target: 90 },
  },
  // PRs
  {
    key: 'first_pr',
    label: 'Personal Best',
    icon: '🎯',
    desc: 'Set your first personal record',
    color: '#D4AF37',
    category: 'PRs',
    check: (d) => d.totalPRs >= 1,
    progressOf: null,
  },
  {
    key: 'prs_10',
    label: 'PR Machine',
    icon: '📈',
    desc: 'Set 10 personal records',
    color: '#D4AF37',
    category: 'PRs',
    check: (d) => d.totalPRs >= 10,
    progressOf: { key: 'totalPRs', target: 10 },
  },
  // Social
  {
    key: 'first_friend',
    label: 'Better Together',
    icon: '🤝',
    desc: 'Add your first gym friend',
    color: '#3B82F6',
    category: 'Social',
    check: (d) => d.friendCount >= 1,
    progressOf: null,
  },
  {
    key: 'social_5',
    label: 'Squad Goals',
    icon: '👥',
    desc: 'Have 5 friends in the gym',
    color: '#3B82F6',
    category: 'Social',
    check: (d) => d.friendCount >= 5,
    progressOf: { key: 'friendCount', target: 5 },
  },
  // Special
  {
    key: 'habit_formed',
    label: 'Habit Formed',
    icon: '🧠',
    desc: 'Complete 9 workouts in your first 6 weeks',
    color: '#8B5CF6',
    category: 'Special',
    check: (d) => d.sessionsInFirst6Weeks >= 9,
    progressOf: { key: 'sessionsInFirst6Weeks', target: 9 },
  },
  {
    key: 'first_challenge',
    label: 'Competitor',
    icon: '🏅',
    desc: 'Complete your first challenge',
    color: '#F59E0B',
    category: 'Special',
    check: (d) => d.challengesCompleted >= 1,
    progressOf: null,
  },
  // Volume
  {
    key: 'volume_10k',
    label: '10K Club',
    icon: '⚖️',
    desc: 'Lift 10,000 lbs total',
    color: '#6B7280',
    category: 'Volume',
    check: (d) => d.totalVolumeLbs >= 10000,
    progressOf: { key: 'totalVolumeLbs', target: 10000 },
  },
  {
    key: 'volume_100k',
    label: '100K Strong',
    icon: '💎',
    desc: 'Lift 100,000 lbs total',
    color: '#D4AF37',
    category: 'Volume',
    check: (d) => d.totalVolumeLbs >= 100000,
    progressOf: { key: 'totalVolumeLbs', target: 100000 },
  },
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
function computeStreakFromSessions(sessions) {
  const dates = new Set(
    sessions.map((s) => new Date(s.completed_at).toDateString())
  );
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (dates.has(d.toDateString())) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

// ── Fetch all data needed for achievement checking ────────────────────────────
// Returns: { totalSessions, currentStreak, totalPRs, friendCount,
//            sessionsInFirst6Weeks, challengesCompleted, totalVolumeLbs }
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

  // Sessions in first 6 weeks (42 days from profile created_at)
  let sessionsInFirst6Weeks = 0;
  if (profileRow?.created_at) {
    const joinDate = new Date(profileRow.created_at);
    const cutoff = new Date(joinDate.getTime() + 42 * 24 * 60 * 60 * 1000);
    sessionsInFirst6Weeks = sessions.filter((s) => {
      const d = new Date(s.completed_at);
      return d >= joinDate && d <= cutoff;
    }).length;
  }

  // Completed challenges: participant in a challenge that has ended (status = 'ended' or end_date in the past)
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
// 1. Fetch current earned keys from user_achievements
// 2. Fetch achievement data
// 3. Check for newly earned ones
// 4. Insert new ones into user_achievements
// 5. Return newly earned defs
export async function awardAchievements(userId, gymId, supabase) {
  if (!userId || !gymId) return [];

  // 1. Load already-earned keys
  const { data: existingRows } = await supabase
    .from('user_achievements')
    .select('achievement_key, earned_at')
    .eq('user_id', userId)
    .eq('gym_id', gymId);

  const existingKeys = (existingRows ?? []).map((r) => r.achievement_key);

  // 2. Fetch live data
  const data = await fetchAchievementData(userId, gymId, supabase);

  // 3. Check for new achievements
  const newDefs = checkNewAchievements(data, existingKeys);
  if (newDefs.length === 0) return [];

  // 4. Insert new achievements
  const now = new Date().toISOString();
  const inserts = newDefs.map((def) => ({
    user_id: userId,
    gym_id: gymId,
    achievement_key: def.key,
    earned_at: now,
  }));

  await supabase
    .from('user_achievements')
    .upsert(inserts, { onConflict: 'user_id,achievement_key', ignoreDuplicates: true });

  // 5. Return newly earned defs
  return newDefs;
}

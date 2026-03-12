/**
 * Churn Intelligence Library
 * Rule-based churn risk scoring for gym member retention.
 * Higher score = higher churn risk (0–100).
 */

/**
 * Calculate churn risk score for a single member.
 *
 * @param {Object} member
 * @param {string}  member.id
 * @param {string}  member.full_name
 * @param {string}  member.created_at
 * @param {number|null} member.daysSinceLastCheckIn   — null if never checked in
 * @param {number}  member.avgWeeklyVisits            — last 30 days
 * @param {number}  member.prevAvgWeeklyVisits        — 30 days prior (for trend)
 * @param {number}  member.tenureMonths
 * @param {boolean} member.challengeParticipation
 * @param {number}  member.friendCount
 * @param {number}  member.totalSessions
 * @returns {number} 0–100
 */
export function calculateChurnScore(member) {
  const {
    daysSinceLastCheckIn,
    avgWeeklyVisits = 0,
    prevAvgWeeklyVisits = 0,
    tenureMonths = 0,
    challengeParticipation = false,
    friendCount = 0,
    totalSessions = 0,
  } = member;

  let score = 0;

  // ── 1. Recency — days since last check-in (35 pts max) ────────────────
  const days = daysSinceLastCheckIn ?? 999;
  if (days >= 21)      score += 35;
  else if (days >= 14) score += 28;
  else if (days >= 7)  score += 17;
  // 0–6 days = 0 pts

  // ── 2. Frequency trend (25 pts max) ───────────────────────────────────
  if (prevAvgWeeklyVisits > 0) {
    const dropPct = (prevAvgWeeklyVisits - avgWeeklyVisits) / prevAvgWeeklyVisits;
    if (dropPct >= 0.5)      score += 25; // dropped 50%+
    else if (dropPct >= 0.25) score += 15; // dropped 25–50%
    else if (dropPct < 0)    score -= 5;  // frequency increased — good sign
  } else if (avgWeeklyVisits === 0) {
    // Never established a frequency pattern
    score += 10;
  }

  // ── 3. Tenure (15 pts max) ────────────────────────────────────────────
  // 1–3 months is the highest-risk "honeymoon ending" period
  if (tenureMonths < 1)       score += 10; // brand new — uncertain
  else if (tenureMonths <= 3) score += 15; // danger zone: honeymoon ending
  else if (tenureMonths <= 6) score += 12; // still early, some risk
  else if (tenureMonths <= 12) score += 8; // established but can still churn
  else                         score += 3; // long-tenure = lower base risk

  // ── 4. Challenge participation (10 pts) ───────────────────────────────
  if (!challengeParticipation) score += 10;

  // ── 5. Social connections (10 pts) ────────────────────────────────────
  if (friendCount === 0)      score += 10;
  else if (friendCount === 1) score += 5;
  // 2+ friends = socially anchored, no penalty

  // ── 6. App engagement — sessions relative to tenure (5 pts) ──────────
  const expectedSessions = Math.max(1, tenureMonths * 4); // ~1 session/week baseline
  const engagementRatio = totalSessions / expectedSessions;
  if (engagementRatio < 0.25) score += 5;

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Map a churn score to a risk tier with display properties.
 * @param {number} score
 * @returns {{ label: string, color: string, bg: string, dot: string }}
 */
export function getRiskTier(score) {
  if (score >= 70) return {
    label: 'High Risk',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.12)',
    dot: '🔴',
    textClass: 'text-[#EF4444]',
    bgClass: 'bg-[#EF4444]/10',
    borderClass: 'border-[#EF4444]/20',
  };
  if (score >= 40) return {
    label: 'Medium Risk',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.12)',
    dot: '🟡',
    textClass: 'text-[#F59E0B]',
    bgClass: 'bg-[#F59E0B]/10',
    borderClass: 'border-[#F59E0B]/20',
  };
  return {
    label: 'Low Risk',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.12)',
    dot: '🟢',
    textClass: 'text-[#10B981]',
    bgClass: 'bg-[#10B981]/10',
    borderClass: 'border-[#10B981]/20',
  };
}

/**
 * Fetch all members for a gym, compute churn metrics and scores.
 * Returns array sorted by churnScore descending.
 *
 * @param {string} gymId
 * @param {Object} supabase  — supabase client
 * @returns {Promise<Array>}
 */
export async function fetchMembersWithChurnScores(gymId, supabase) {
  const now = new Date();
  const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Member profiles ───────────────────────────────────────────────
  const { data: memberRows, error: membersError } = await supabase
    .from('profiles')
    .select('id, full_name, username, created_at, gym_id, training_frequency')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .order('full_name', { ascending: true });

  if (membersError || !memberRows?.length) return [];

  const memberIds = memberRows.map(m => m.id);

  // ── 2. Attendance — last 60 days ────────────────────────────────────
  const { data: attendanceRows } = await supabase
    .from('attendance')
    .select('user_id, checked_in_at')
    .eq('gym_id', gymId)
    .gte('checked_in_at', sixtyDaysAgo)
    .in('user_id', memberIds)
    .order('checked_in_at', { ascending: false });

  // ── 3. Workout sessions — last 60 days ──────────────────────────────
  const { data: sessionRows } = await supabase
    .from('workout_sessions')
    .select('user_id, completed_at')
    .eq('gym_id', gymId)
    .gte('completed_at', sixtyDaysAgo)
    .in('user_id', memberIds)
    .order('completed_at', { ascending: false });

  // ── 4. Total session count (all time) per member ─────────────────────
  // Use a separate query to count all-time sessions
  const { data: allSessionRows } = await supabase
    .from('workout_sessions')
    .select('user_id')
    .eq('gym_id', gymId)
    .in('user_id', memberIds);

  // ── 5. Friend counts ─────────────────────────────────────────────────
  const { data: friendshipRows } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(
      memberIds.map(id => `requester_id.eq.${id}`).join(',') +
      ',' +
      memberIds.map(id => `addressee_id.eq.${id}`).join(',')
    );

  // ── 6. Challenge participation ───────────────────────────────────────
  const { data: challengeRows } = await supabase
    .from('challenge_participants')
    .select('user_id')
    .in('user_id', memberIds);

  // ── Build lookup maps ────────────────────────────────────────────────

  // Last check-in per member
  const lastCheckInMap = {};
  (attendanceRows || []).forEach(row => {
    if (!lastCheckInMap[row.user_id]) {
      lastCheckInMap[row.user_id] = row.checked_in_at;
    }
  });

  // Check-ins bucketed by 30-day windows for frequency trend
  const checkInsLast30 = {};
  const checkInsPrior30 = {};
  (attendanceRows || []).forEach(row => {
    const uid = row.user_id;
    if (row.checked_in_at >= thirtyDaysAgo) {
      checkInsLast30[uid] = (checkInsLast30[uid] || 0) + 1;
    } else {
      checkInsPrior30[uid] = (checkInsPrior30[uid] || 0) + 1;
    }
  });

  // Total sessions (all time) per member
  const totalSessionsMap = {};
  (allSessionRows || []).forEach(row => {
    totalSessionsMap[row.user_id] = (totalSessionsMap[row.user_id] || 0) + 1;
  });

  // Friend count per member
  const friendCountMap = {};
  (friendshipRows || []).forEach(row => {
    friendCountMap[row.requester_id] = (friendCountMap[row.requester_id] || 0) + 1;
    friendCountMap[row.addressee_id] = (friendCountMap[row.addressee_id] || 0) + 1;
  });

  // Challenge participation (bool) per member
  const challengeSet = new Set((challengeRows || []).map(r => r.user_id));

  // ── Compute metrics and scores for each member ───────────────────────
  const scored = memberRows.map(m => {
    const createdAt = new Date(m.created_at);
    const tenureMs = now - createdAt;
    const tenureMonths = tenureMs / (1000 * 60 * 60 * 24 * 30.44);

    const lastCheckIn = lastCheckInMap[m.id] ?? null;
    const daysSinceLastCheckIn = lastCheckIn
      ? (now - new Date(lastCheckIn)) / (1000 * 60 * 60 * 24)
      : null;

    // Weekly visit average = count in 30 days / 4.33 weeks
    const avgWeeklyVisits = (checkInsLast30[m.id] || 0) / 4.33;
    const prevAvgWeeklyVisits = (checkInsPrior30[m.id] || 0) / 4.33;

    const memberData = {
      id: m.id,
      full_name: m.full_name,
      created_at: m.created_at,
      daysSinceLastCheckIn,
      avgWeeklyVisits,
      prevAvgWeeklyVisits,
      tenureMonths,
      challengeParticipation: challengeSet.has(m.id),
      friendCount: friendCountMap[m.id] || 0,
      totalSessions: totalSessionsMap[m.id] || 0,
    };

    const churnScore = calculateChurnScore(memberData);
    const riskTier = getRiskTier(churnScore);

    // Build a human-readable "key signal" string
    let keySignal = 'Engagement looks healthy';
    if (daysSinceLastCheckIn === null) {
      keySignal = 'Never checked in';
    } else if (daysSinceLastCheckIn >= 21) {
      keySignal = `No check-in in ${Math.round(daysSinceLastCheckIn)} days`;
    } else if (daysSinceLastCheckIn >= 14) {
      keySignal = `No check-in in ${Math.round(daysSinceLastCheckIn)} days`;
    } else if (prevAvgWeeklyVisits > 0 && avgWeeklyVisits < prevAvgWeeklyVisits * 0.5) {
      keySignal = 'Visit frequency dropped 50%+';
    } else if (!challengeSet.has(m.id) && (friendCountMap[m.id] || 0) === 0) {
      keySignal = 'No challenges or social connections';
    } else if (!challengeSet.has(m.id)) {
      keySignal = 'Not participating in challenges';
    } else if ((friendCountMap[m.id] || 0) === 0) {
      keySignal = 'No gym connections';
    }

    return {
      ...m,
      username: m.username || m.full_name,
      tenureMonths,
      daysSinceLastCheckIn,
      lastCheckInAt: lastCheckIn,
      avgWeeklyVisits,
      prevAvgWeeklyVisits,
      challengeParticipation: challengeSet.has(m.id),
      friendCount: friendCountMap[m.id] || 0,
      totalSessions: totalSessionsMap[m.id] || 0,
      churnScore,
      riskTier,
      keySignal,
    };
  });

  return scored.sort((a, b) => b.churnScore - a.churnScore);
}

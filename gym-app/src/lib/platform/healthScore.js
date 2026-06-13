// Canonical gym health score for the platform tier — single source of truth.
// GymsOverview, GymHealth, and GymWellnessTab previously each computed their
// own variant (the list could say "Thriving" while the detail tab scored 40).
// This is the six-factor formula (originally GymHealth.jsx / migration 0281).
//
// Inputs map 1:1 to platform_gym_stats RPC columns:
//   member_count, active_30d, sessions_30d, checkedin_30d,
//   onboarded_count, avg_churn_score, new_30d

export function computeHealthScore({
  totalMembers,
  activeMembers30d,
  totalSessions30d,
  checkedInMembers30d,
  onboardedMembers,
  avgChurnScore,
  newMembers30d,
}) {
  if (!totalMembers || totalMembers <= 0) return null; // no members = unscored, not "Critical"

  const retention = (activeMembers30d / totalMembers) * 25;
  const sessionsPerMember = Math.min(totalSessions30d / totalMembers, 12);
  const engagement = (sessionsPerMember / 12) * 20;
  const checkinRate = (checkedInMembers30d / totalMembers) * 15;
  const onboarding = (onboardedMembers / totalMembers) * 15;
  const churnHealth = ((100 - (avgChurnScore || 0)) / 100) * 15;
  const growthRatio = Math.min((newMembers30d || 0) / totalMembers, 0.3);
  const growth = (growthRatio / 0.3) * 10;

  return Math.round(Math.min(retention + engagement + checkinRate + onboarding + churnHealth + growth, 100));
}

// Convenience adapter for a platform_gym_stats row.
export function healthScoreFromStatsRow(row) {
  if (!row) return null;
  return computeHealthScore({
    totalMembers: row.member_count ?? 0,
    activeMembers30d: row.active_30d ?? 0,
    totalSessions30d: row.sessions_30d ?? 0,
    checkedInMembers30d: row.checkedin_30d ?? 0,
    onboardedMembers: row.onboarded_count ?? 0,
    avgChurnScore: row.avg_churn_score ?? 0,
    newMembers30d: row.new_30d ?? 0,
  });
}

// Shared tier mapping. `score === null` → 'new' (unscored), never "Critical".
export function healthTier(score) {
  if (score == null) return 'new';
  if (score >= 75) return 'thriving';
  if (score >= 55) return 'healthy';
  if (score >= 40) return 'watch';
  return 'critical';
}

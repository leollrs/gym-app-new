// Maps hardcoded English signal strings (from DB or fallback scoring) to i18n keys.
// Used across AtRiskPreview, AdminChurn, and AdminMembers.
const SIGNAL_I18N = {
  'Never logged a workout': 'admin.churnSignals.neverLogged',
  'No activity in 30+ days': 'admin.churnSignals.noActivity30',
  'No activity in 14+ days': 'admin.churnSignals.noActivity14',
  'No workouts in last 14 days': 'admin.churnSignals.noWorkouts14',
  'Engagement looks healthy': 'admin.churnSignals.engagementHealthy',
  'Not enough history': 'admin.churnSignals.notEnoughHistory',
  'Stable': 'admin.churnSignals.stable',
  'Stable variety': 'admin.churnSignals.stableVariety',
};

/** Translate a churn signal string using i18n. Falls back to the raw string. */
export function translateSignal(t, sig) {
  const key = SIGNAL_I18N[sig];
  return key ? t(key) : sig;
}

/** Maps signal keys (from riskScoring.js) to i18n display name keys. */
const SIGNAL_NAME_I18N = {
  visit_frequency: 'admin.churnSignals.nameVisitFrequency',
  attendance_trend: 'admin.churnSignals.nameAttendanceTrend',
  tenure_risk: 'admin.churnSignals.nameTenureRisk',
  social_engagement: 'admin.churnSignals.nameSocialEngagement',
  session_gaps: 'admin.churnSignals.nameSessionGaps',
  goal_progress: 'admin.churnSignals.nameGoalProgress',
  engagement_depth: 'admin.churnSignals.nameEngagementDepth',
  anchor_day: 'admin.churnSignals.nameAnchorDay',
  app_engagement: 'admin.churnSignals.nameAppEngagement',
  comms_responsiveness: 'admin.churnSignals.nameCommsResponsiveness',
  referral_activity: 'admin.churnSignals.nameReferralActivity',
  workout_type_shift: 'admin.churnSignals.nameWorkoutTypeShift',
};

/** Translate a signal key (e.g. 'visit_frequency') to a human-readable display name. */
export function translateSignalName(t, key) {
  const i18nKey = SIGNAL_NAME_I18N[key];
  return i18nKey ? t(i18nKey) : key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

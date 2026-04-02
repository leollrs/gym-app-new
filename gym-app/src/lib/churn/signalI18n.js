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

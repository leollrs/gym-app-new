// Maps the English signal strings emitted by the churn scoring edge function
// (supabase/functions/compute-churn-scores/index.ts) AND the client fallback
// (src/lib/churn/riskScoring.js) to their i18n keys in pages.json.
//
// Used by AtRiskPreview, AdminOverview watchlist modal, AdminChurn, AdminMembers.
//
// If you add a new `label:` value in the edge function, add it here too —
// otherwise it'll render raw English on the Spanish side.
const SIGNAL_I18N = {
  // ── v3 model labels (churnSignalsV3.js + compute-churn-scores edge fn) ──
  'No recent activity':            'admin.churnSignals.noRecentActivity',
  'Active recently':               'admin.churnSignals.recentlyActive',
  'Attendance stable':             'admin.churnSignals.stable',
  'Streak active':                 'admin.churnSignals.streakActive',
  'No active streak':              'admin.churnSignals.noStreak',
  'Building a routine':            'admin.churnSignals.buildingHabit',
  'Too early to tell':             'admin.churnSignals.tooEarly',
  'Completed first workout':       'admin.churnSignals.activated',
  'No first workout yet':          'admin.churnSignals.notActivatedYet',
  'No workout in first week':      'admin.churnSignals.noFirstWorkout',
  'App activity dropped off':      'admin.churnSignals.appActivityDropped',
  'Active in app':                 'admin.churnSignals.appActive',
  'Stopped joining challenges':    'admin.churnSignals.challengeStopped',
  'Challenge engagement ok':       'admin.churnSignals.challengeOk',
  'Stopped logging workouts':      'admin.churnSignals.loggingStopped',
  'Logging workouts':              'admin.churnSignals.loggingOk',
  'Stopped using rewards':         'admin.churnSignals.rewardsDormant',
  'Rewards engaged':               'admin.churnSignals.rewardsOk',
  'Pulled back socially':          'admin.churnSignals.socialWithdrew',
  'Goal/PR activity stalled':      'admin.churnSignals.goalsDormant',
  'New member — not enough data yet': 'admin.churnSignals.newMemberNoData',
  'Never activated':                  'admin.churnSignals.neverActivated',

  // ── Client-side fallback strings (lib/churn/riskScoring.js) ──
  'Never logged a workout':        'admin.churnSignals.neverLogged',
  'No activity in 30+ days':       'admin.churnSignals.noActivity30',
  'No activity in 14+ days':       'admin.churnSignals.noActivity14',
  'No workouts in last 14 days':   'admin.churnSignals.noWorkouts14',
  'Engagement looks healthy':      'admin.churnSignals.engagementHealthy',
  'Not enough history':            'admin.churnSignals.notEnoughHistory',

  // ── Visit frequency ──
  'Zero visits in last 30 days':   'admin.churnSignals.zeroVisits30',
  'Meeting visit goal':            'admin.churnSignals.meetingGoal',

  // ── Attendance trend ──
  'Attendance trending up':        'admin.churnSignals.attendanceUp',
  'Stable':                        'admin.churnSignals.stable',

  // ── Tenure risk ──
  'Brand new (< 1 month)':         'admin.churnSignals.brandNew',
  '90-day window — hit milestone': 'admin.churnSignals.window90Hit',
  'Critical 90-day dropout window':'admin.churnSignals.critical90Dropout',
  'Early risk (3-6mo)':            'admin.churnSignals.earlyRisk',
  'Established (6-12mo)':          'admin.churnSignals.established',
  'Long-tenure':                   'admin.churnSignals.longTenure',

  // ── Session gaps ──
  'Not enough gap data':           'admin.churnSignals.notEnoughGapData',
  'Consistent timing':             'admin.churnSignals.consistentTiming',
  'Session gaps doubled':          'admin.churnSignals.sessionGapsDoubled',
  'Gaps growing fast':             'admin.churnSignals.gapsGrowingFast',
  'Gaps widening':                 'admin.churnSignals.gapsWidening',
  'Gaps shrinking':                'admin.churnSignals.gapsShrinking',
  'Consistent spacing':            'admin.churnSignals.consistentSpacing',

  // ── Goal progress / milestones ──
  'No recent milestones':          'admin.churnSignals.noRecentMilestones',
  'Hitting milestones':            'admin.churnSignals.hittingMilestones',

  // ── Anchor day ──
  'No schedule set':               'admin.churnSignals.noScheduleSet',
  'Insufficient data':             'admin.churnSignals.insufficientData',
  'Missed ALL anchor days 3 weeks straight': 'admin.churnSignals.missedAllAnchor3w',
  'Missed most anchor days recently':        'admin.churnSignals.missedMostAnchor',
  'Missing anchor days frequently':          'admin.churnSignals.missingAnchorFreq',
  'Occasionally missing anchor days':        'admin.churnSignals.occasionallyMissing',
  'Hitting anchor days':           'admin.churnSignals.hittingAnchor',

  // ── Outreach responsiveness ──
  'No outreach sent':              'admin.churnSignals.noOutreachSent',
  'No response to 2+ outreach':    'admin.churnSignals.noResponse2plus',
  'Low outreach response rate':    'admin.churnSignals.lowResponseRate',
  'Responsive to outreach':        'admin.churnSignals.responsiveOutreach',

  // ── Referral activity ──
  'Active referrer':               'admin.churnSignals.activeReferrer',
  '1 referral — engaged':          'admin.churnSignals.oneReferralEngaged',
  'No referrals':                  'admin.churnSignals.noReferrals',

  // ── Workout-type shift ──
  'No exercises logged recently':  'admin.churnSignals.noExercisesRecent',
  'Narrowing exercise variety':    'admin.churnSignals.narrowingVariety',
  'Expanding variety':             'admin.churnSignals.expandingVariety',
  'Stable variety':                'admin.churnSignals.stableVariety',

  // ── Legacy strings from migration 0079_churn_scoring_rpc.sql ──
  // (still landing in churn_risk_scores.key_signals if the SQL RPC ran
  // before the edge function took over, or if any code path still calls it).
  'No workouts in 30+ days':       'admin.churnSignals.noWorkouts30',
  'Declining workout frequency':   'admin.churnSignals.decliningWorkoutFreq',
  'Streak broken recently':        'admin.churnSignals.streakBrokenRecently',
  'Never completed onboarding':    'admin.churnSignals.neverOnboarded',
};

// Snake_case signal CODES emitted by the retention orchestrator
// (0398_retention_orchestrator.sql) — top_signal / member_outreach_state.
// These leak into owner_queue_items.reason whenever the signals JSON has no
// human 'label' for the code (see line 264 of 0398), so they must be mapped
// here too or they render raw (e.g. "low_attendance") on the Spanish side.
const SIGNAL_CODE_I18N = {
  low_attendance: 'admin.churnSignals.codeLowAttendance',
  absent:         'admin.churnSignals.codeAbsent',
  cooling:        'admin.churnSignals.codeCooling',
  recency:        'admin.churnSignals.codeRecency',
  frequency_drop: 'admin.churnSignals.codeFrequencyDrop',
  streak_broken:  'admin.churnSignals.codeStreakBroken',
};

/**
 * Translate a churn signal — handles three shapes so nothing leaks raw:
 *   1. a known human label  ("Zero visits in last 30 days")  → mapped
 *   2. a known snake_case code ("low_attendance")            → mapped
 *   3. an unknown snake_case code                            → humanized
 *      ("frequency_drop" → "Frequency Drop") rather than shown raw
 * Leading bullets/dashes the SQL may have joined on are stripped first.
 */
export function translateSignal(t, sig) {
  if (!sig) return '';
  const raw = String(sig).trim();
  if (SIGNAL_I18N[raw]) return t(SIGNAL_I18N[raw]);

  // Dynamic day-count strings emitted by loadScores.js / retention.js
  // (e.g. "No activity in 47+ days") — the day count varies per member, so
  // they can't be static map keys. Match the shape and interpolate.
  const dm = raw.match(/^No activity in (\d+)\+ days$/i);
  if (dm) return t('admin.churnSignals.noActivityNDays', { n: Number(dm[1]), defaultValue: `No activity in ${dm[1]}+ days` });

  // v3 dynamic labels (numbers vary per member → can't be static map keys).
  let m2;
  if ((m2 = raw.match(/^(\d+) days since last visit$/i)))
    return t('admin.churnSignals.daysSinceVisit', { d: Number(m2[1]), defaultValue: raw });
  if ((m2 = raw.match(/^Visiting ([\d.]+)[×x]\/week$/i)))
    return t('admin.churnSignals.visitingXWeek', { n: m2[1], defaultValue: raw });
  if ((m2 = raw.match(/^Visits down (\d+)% vs usual$/i)))
    return t('admin.churnSignals.visitsDownPct', { pct: Number(m2[1]), defaultValue: raw });
  if ((m2 = raw.match(/^Broke a (\d+)-day streak$/i)))
    return t('admin.churnSignals.streakBroken', { n: Number(m2[1]), defaultValue: raw });
  if ((m2 = raw.match(/^Not building a routine \((\d+) visits in (\d+)w\)$/i)))
    return t('admin.churnSignals.notBuildingHabit', { v: Number(m2[1]), w: Number(m2[2]), defaultValue: raw });

  const code = raw.replace(/^[-•·\s]+/, '').toLowerCase();
  if (SIGNAL_CODE_I18N[code]) return t(SIGNAL_CODE_I18N[code]);

  // Unknown snake_case code → humanize so we never surface a raw enum value.
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(code)) {
    return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return raw;
}

/** Maps signal keys (from riskScoring.js) to i18n display name keys. */
const SIGNAL_NAME_I18N = {
  // ── v3 signal keys ──
  recency:              'admin.churnSignals.nameRecency',
  frequency:            'admin.churnSignals.nameFrequency',
  trend:                'admin.churnSignals.nameTrend',
  streak:               'admin.churnSignals.nameStreak',
  habit_formation:      'admin.churnSignals.nameHabitFormation',
  activation:           'admin.churnSignals.nameActivation',
  app_decline:          'admin.churnSignals.nameAppDecline',
  challenge_decline:    'admin.churnSignals.nameChallengeDecline',
  logging_decline:      'admin.churnSignals.nameLoggingDecline',
  rewards_decline:      'admin.churnSignals.nameRewardsDecline',
  social_decline:       'admin.churnSignals.nameSocialDecline',
  goals_decline:        'admin.churnSignals.nameGoalsDecline',
  // ── v2 legacy keys (still mapped for old persisted rows) ──
  visit_frequency:      'admin.churnSignals.nameVisitFrequency',
  attendance_trend:     'admin.churnSignals.nameAttendanceTrend',
  tenure_risk:          'admin.churnSignals.nameTenureRisk',
  social_engagement:    'admin.churnSignals.nameSocialEngagement',
  session_gaps:         'admin.churnSignals.nameSessionGaps',
  goal_progress:        'admin.churnSignals.nameGoalProgress',
  engagement_depth:     'admin.churnSignals.nameEngagementDepth',
  anchor_day:           'admin.churnSignals.nameAnchorDay',
  app_engagement:       'admin.churnSignals.nameAppEngagement',
  comms_responsiveness: 'admin.churnSignals.nameCommsResponsiveness',
  referral_activity:    'admin.churnSignals.nameReferralActivity',
  workout_type_shift:   'admin.churnSignals.nameWorkoutTypeShift',
};

/** Translate a signal key (e.g. 'visit_frequency') to a human-readable display name. */
export function translateSignalName(t, key) {
  const i18nKey = SIGNAL_NAME_I18N[key];
  return i18nKey ? t(i18nKey) : key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Owner-queue segments → i18n keys (used inside "Check in (X)" fallback).
const SEGMENT_I18N = {
  critical: 'admin.queueReason.segmentCritical',
  at_risk:  'admin.queueReason.segmentAtRisk',
  cooling:  'admin.queueReason.segmentCooling',
  healthy:  'admin.queueReason.segmentHealthy',
  churned:  'admin.queueReason.segmentChurned',
};

/**
 * Translate an owner_queue_items.reason string. The reason is composed in
 * SQL by 0398_retention_orchestrator.sql by joining fragments with ' · ':
 *   - "Never trained"                (when days_since_session IS NULL)
 *   - "{N}d silent"                  (days_since_session >= 14)
 *   - "{N}d quiet"                   (days_since_session >= 7)
 *   - "{N} sessions this week"       (when flagged_this_week)
 *   - <signal_label>                 (from compute-churn-scores edge function,
 *                                     translated via translateSignal())
 *   - "Check in ({segment})"         (default fallback when nothing else fires)
 *
 * Splits the reason on ' · ', recognizes each fragment shape, translates,
 * and re-joins. Unknown fragments fall through to raw English so we never
 * lose information.
 */
export function translateQueueReason(t, reason) {
  if (!reason) return '';

  // Default-fallback shape — handled whole-string because it's never composed
  // with other fragments (orchestrator emits it only when CONCAT_WS returns '').
  const fallbackMatch = reason.match(/^Check in \((\w+)\)$/);
  if (fallbackMatch) {
    const segKey = SEGMENT_I18N[fallbackMatch[1]];
    const segName = segKey ? t(segKey) : fallbackMatch[1];
    return t('admin.queueReason.checkInSegment', { segment: segName, defaultValue: `Check in (${segName})` });
  }

  return reason
    .split(' · ')
    .map((raw) => {
      const frag = raw.trim();
      if (!frag) return frag;

      if (frag === 'Never trained') {
        return t('admin.queueReason.neverTrained', { defaultValue: 'Never trained' });
      }
      let m = frag.match(/^(\d+)d silent$/);
      if (m) return t('admin.queueReason.daysSilent', { count: Number(m[1]), defaultValue: `${m[1]}d silent` });
      m = frag.match(/^(\d+)d quiet$/);
      if (m) return t('admin.queueReason.daysQuiet', { count: Number(m[1]), defaultValue: `${m[1]}d quiet` });
      m = frag.match(/^(\d+) sessions this week$/);
      if (m) {
        const n = Number(m[1]);
        const key = n === 1 ? 'admin.queueReason.sessionsThisWeek_one' : 'admin.queueReason.sessionsThisWeek_other';
        return t(key, { count: n, defaultValue: `${n} session${n === 1 ? '' : 's'} this week` });
      }

      // Anything else is a signal_label from the edge function — route
      // through the same SIGNAL_I18N map AtRiskPreview uses.
      return translateSignal(t, frag);
    })
    .join(' · ');
}

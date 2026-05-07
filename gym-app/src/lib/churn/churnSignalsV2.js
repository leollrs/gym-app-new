/**
 * Churn signals v2 — matches supabase/functions/compute-churn-scores/index.ts
 * 12 signals, 100-point raw budget before weights.
 */
import i18n from 'i18next';

const tt = (key, fallback, params = {}) =>
  i18n.t(key, { ns: 'pages', defaultValue: fallback, ...params });

export function signalVisitFrequencyV2(avgWeekly, goal) {
  const MAX = 22;
  const target = Math.max(goal || 3, 2);
  const ratio = target > 0 ? avgWeekly / target : 0;
  if (avgWeekly === 0) return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.zeroVisits30', 'Zero visits in last 30 days') };
  if (ratio < 0.25) return { score: Math.round(MAX * 0.85), maxPts: MAX, label: tt('admin.churnSignals.onlyXPerWeek', 'Only {{n}}x/week', { n: avgWeekly.toFixed(1) }) };
  if (ratio < 0.5) return { score: Math.round(MAX * 0.65), maxPts: MAX, label: tt('admin.churnSignals.visitingBelow50', 'Visiting {{n}}x/week (50% below goal)', { n: avgWeekly.toFixed(1) }) };
  if (ratio < 0.75) return { score: Math.round(MAX * 0.35), maxPts: MAX, label: tt('admin.churnSignals.belowGoal', 'Below visit goal') };
  if (ratio < 1.0) return { score: Math.round(MAX * 0.15), maxPts: MAX, label: tt('admin.churnSignals.nearlyGoal', 'Nearly hitting visit goal') };
  return { score: ratio >= 1.25 ? -3 : 0, maxPts: MAX, label: tt('admin.churnSignals.meetingGoal', 'Meeting visit goal') };
}

export function signalAttendanceTrendV2(avg, prev) {
  const MAX = 14;
  if (prev <= 0.2) {
    return { score: avg === 0 ? 8 : 0, maxPts: MAX, label: avg === 0 ? tt('admin.churnSignals.noVisitPattern', 'No visit pattern') : tt('admin.churnSignals.buildingBaseline', 'Building baseline') };
  }
  const drop = (prev - avg) / prev;
  if (drop >= 0.75) return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.visitsCrashed', 'Visits crashed {{pct}}%', { pct: Math.round(drop * 100) }) };
  if (drop >= 0.5) return { score: Math.round(MAX * 0.75), maxPts: MAX, label: tt('admin.churnSignals.visitsDropped', 'Visits dropped {{pct}}%', { pct: Math.round(drop * 100) }) };
  if (drop >= 0.3) return { score: Math.round(MAX * 0.5), maxPts: MAX, label: tt('admin.churnSignals.visitsDeclined', 'Visits declined {{pct}}%', { pct: Math.round(drop * 100) }) };
  if (drop >= 0.15) return { score: Math.round(MAX * 0.25), maxPts: MAX, label: tt('admin.churnSignals.slightDip', 'Slight dip') };
  if (drop < -0.15) return { score: -3, maxPts: MAX, label: tt('admin.churnSignals.attendanceUp', 'Attendance trending up') };
  return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.stable', 'Stable') };
}

export function signalTenureRiskV2(months, first90Sessions) {
  const MAX = 12;
  if (months < 1) return { score: Math.round(MAX * 0.55), maxPts: MAX, label: tt('admin.churnSignals.brandNew', 'Brand new (< 1 month)') };
  if (months <= 3) {
    if (first90Sessions !== null && first90Sessions >= 24) {
      return { score: Math.round(MAX * 0.25), maxPts: MAX, label: tt('admin.churnSignals.window90Hit', '90-day window — hit milestone') };
    }
    return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.critical90Dropout', 'Critical 90-day dropout window') };
  }
  if (months <= 6) return { score: Math.round(MAX * 0.55), maxPts: MAX, label: tt('admin.churnSignals.earlyRisk', 'Early risk (3-6mo)') };
  if (months <= 12) return { score: Math.round(MAX * 0.25), maxPts: MAX, label: tt('admin.churnSignals.established', 'Established (6-12mo)') };
  return { score: Math.round(MAX * 0.07), maxPts: MAX, label: tt('admin.churnSignals.longTenure', 'Long-tenure') };
}

export function signalSocialEngagementV2(friends, inChallenge, hasTrainer) {
  const MAX = 10;
  let score = 0;
  const parts = [];
  if (friends === 0) { score += 4; parts.push(tt('admin.churnSignals.noConnections', 'No connections')); }
  else if (friends === 1) { score += 2; parts.push(tt('admin.churnSignals.oneConnection', '1 connection')); }
  if (!inChallenge) { score += 4; parts.push(tt('admin.churnSignals.noChallenges', 'No challenges')); }
  if (!hasTrainer) { score += 2; parts.push(tt('admin.churnSignals.noTrainer', 'No trainer')); }
  return { score: Math.min(MAX, score), maxPts: MAX, label: parts.length ? parts.join('; ') : tt('admin.churnSignals.sociallyEngaged', 'Socially engaged') };
}

export function signalSessionGapsV2(gaps) {
  const MAX = 7;
  if (!gaps || gaps.length < 4) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.notEnoughGapData', 'Not enough gap data') };
  const mid = Math.floor(gaps.length / 2);
  const recentAvg = gaps.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const olderAvg = gaps.slice(mid).reduce((a, b) => a + b, 0) / (gaps.length - mid);
  if (olderAvg <= 0.5) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.consistentTiming', 'Consistent timing') };
  const accel = (recentAvg - olderAvg) / olderAvg;
  if (accel >= 1.0) return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.sessionGapsDoubled', 'Session gaps doubled') };
  if (accel >= 0.5) return { score: Math.round(MAX * 0.7), maxPts: MAX, label: tt('admin.churnSignals.gapsGrowingFast', 'Gaps growing fast') };
  if (accel >= 0.25) return { score: Math.round(MAX * 0.4), maxPts: MAX, label: tt('admin.churnSignals.gapsWidening', 'Gaps widening') };
  if (accel < -0.15) return { score: -2, maxPts: MAX, label: tt('admin.churnSignals.gapsShrinking', 'Gaps shrinking') };
  return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.consistentSpacing', 'Consistent spacing') };
}

export function signalGoalProgressV2(hasPRs, hasBody, tenureMonths) {
  const MAX = 7;
  if (tenureMonths > 6) {
    return (!hasPRs && !hasBody)
      ? { score: 3, maxPts: MAX, label: tt('admin.churnSignals.noRecentMilestones', 'No recent milestones') }
      : { score: 0, maxPts: MAX, label: tt('admin.churnSignals.hittingMilestones', 'Hitting milestones') };
  }
  let score = 0;
  const parts = [];
  if (!hasPRs) { score += 3; parts.push(tt('admin.churnSignals.noRecentPRs', 'No recent PRs')); }
  if (!hasBody) { score += 2; parts.push(tt('admin.churnSignals.noBodyTracking', 'No body tracking')); }
  return { score: Math.min(MAX, score), maxPts: MAX, label: parts.length ? parts.join('; ') : tt('admin.churnSignals.onTrack', 'On track') };
}

export function signalEngagementDepthV2(completed, abandoned, durLast, durPrior) {
  const MAX = 5;
  let score = 0;
  const parts = [];
  const total = completed + abandoned;
  if (total >= 3) {
    const rate = abandoned / total;
    if (rate >= 0.4) { score += 3; parts.push(tt('admin.churnSignals.pctAbandoned', '{{pct}}% abandoned', { pct: Math.round(rate * 100) })); }
    else if (rate >= 0.2) { score += 1; parts.push(tt('admin.churnSignals.someIncomplete', 'Some incomplete')); }
  }
  if (durPrior > 0 && durLast > 0) {
    const change = (durLast - durPrior) / durPrior;
    if (change <= -0.35) { score += 2; parts.push(tt('admin.churnSignals.sessionsMuchShorter', 'Sessions much shorter')); }
    else if (change <= -0.2) { score += 1; parts.push(tt('admin.churnSignals.sessionsSlightlyShorter', 'Sessions slightly shorter')); }
  }
  return { score: Math.min(MAX, score), maxPts: MAX, label: parts.length ? parts.join('; ') : tt('admin.churnSignals.goodDepth', 'Good depth') };
}

export function signalAnchorDayV2(scheduledDays, recentSessionDays) {
  const MAX = 8;
  if (!scheduledDays?.length) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.noScheduleSet', 'No schedule set') };

  let totalMissedWeeks = 0;
  let totalChecked = 0;
  let consecutiveMissAll = true;

  for (const day of scheduledDays) {
    let missedConsecutive = 0;
    for (let w = 0; w < recentSessionDays.length; w++) {
      if (!recentSessionDays[w].includes(day)) {
        missedConsecutive++;
        totalMissedWeeks++;
      }
    }
    totalChecked += recentSessionDays.length;
    if (missedConsecutive < 3) consecutiveMissAll = false;
  }

  if (totalChecked === 0) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.insufficientData', 'Insufficient data') };

  const missRate = totalMissedWeeks / totalChecked;

  if (consecutiveMissAll && scheduledDays.length >= 2) {
    return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.missedAllAnchor3w', 'Missed ALL anchor days 3 weeks straight') };
  }
  if (missRate >= 0.8) return { score: Math.round(MAX * 0.85), maxPts: MAX, label: tt('admin.churnSignals.missedMostAnchor', 'Missed most anchor days recently') };
  if (missRate >= 0.5) return { score: Math.round(MAX * 0.5), maxPts: MAX, label: tt('admin.churnSignals.missingAnchorFreq', 'Missing anchor days frequently') };
  if (missRate >= 0.3) return { score: Math.round(MAX * 0.25), maxPts: MAX, label: tt('admin.churnSignals.occasionallyMissing', 'Occasionally missing anchor days') };
  return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.hittingAnchor', 'Hitting anchor days') };
}

export function signalAppEngagementV2(notifTotal, notifRead, daysSinceLastAction) {
  const MAX = 5;
  let score = 0;
  const parts = [];

  if (notifTotal >= 5) {
    const openRate = notifRead / notifTotal;
    if (openRate < 0.1) { score += 3; parts.push(tt('admin.churnSignals.notifOpenRate', '{{pct}}% notif open rate', { pct: Math.round(openRate * 100) })); }
    else if (openRate < 0.2) { score += 2; parts.push(tt('admin.churnSignals.lowNotifEngagement', 'Low notification engagement')); }
    else if (openRate < 0.35) { score += 1; parts.push(tt('admin.churnSignals.belowAvgNotif', 'Below-avg notification engagement')); }
  }

  // riskScoring.js seeds daysSinceLastAction with the sentinel 999 when the
  // member has no app activity on record. Anything past 90 days is effectively
  // "never used the app" — show a sane label instead of "999d since last action".
  if (daysSinceLastAction >= 90) {
    score += 2;
    parts.push(tt('admin.churnSignals.neverUsedApp', 'Never used the app'));
  } else if (daysSinceLastAction >= 14) {
    score += 2;
    parts.push(tt('admin.churnSignals.daysSinceAction', '{{n}}d since last action', { n: daysSinceLastAction }));
  } else if (daysSinceLastAction >= 7) {
    score += 1;
    parts.push(tt('admin.churnSignals.quietRecently', 'Quiet in app recently'));
  }

  return { score: Math.min(MAX, score), maxPts: MAX, label: parts.length ? parts.join('; ') : tt('admin.churnSignals.engagedWithApp', 'Engaged with app') };
}

export function signalCommsResponsivenessV2(outreachCount, respondedCount) {
  const MAX = 4;
  if (outreachCount === 0) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.noOutreachSent', 'No outreach sent') };

  const responseRate = respondedCount / outreachCount;
  const unresponsive = outreachCount - respondedCount;

  if (unresponsive >= 3) return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.ignoredOutreach', 'Ignored {{n}} outreach attempts', { n: unresponsive }) };
  if (unresponsive >= 2) return { score: Math.round(MAX * 0.75), maxPts: MAX, label: tt('admin.churnSignals.noResponse2plus', 'No response to 2+ outreach') };
  if (responseRate < 0.5) return { score: Math.round(MAX * 0.5), maxPts: MAX, label: tt('admin.churnSignals.lowResponseRate', 'Low outreach response rate') };
  return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.responsiveOutreach', 'Responsive to outreach') };
}

export function signalReferralActivityV2(referralCount) {
  const MAX = 3;
  if (referralCount >= 2) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.activeReferrer', 'Active referrer') };
  if (referralCount === 1) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.oneReferralEngaged', '1 referral — engaged') };
  return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.noReferrals', 'No referrals') };
}

export function signalWorkoutTypeShiftV2(muscleGroupsLast30, muscleGroupsPrev30) {
  const MAX = 3;
  if (muscleGroupsPrev30 <= 1) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.notEnoughHistory', 'Not enough history') };

  const drop = (muscleGroupsPrev30 - muscleGroupsLast30) / muscleGroupsPrev30;

  if (muscleGroupsLast30 === 0) return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.noExercisesRecent', 'No exercises logged recently') };
  if (drop >= 0.5) return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.varietyDropped', 'Training variety dropped {{pct}}%', { pct: Math.round(drop * 100) }) };
  if (drop >= 0.3) return { score: Math.round(MAX * 0.6), maxPts: MAX, label: tt('admin.churnSignals.narrowingVariety', 'Narrowing exercise variety') };
  if (drop < -0.2) return { score: -1, maxPts: MAX, label: tt('admin.churnSignals.expandingVariety', 'Expanding variety') };
  return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.stableVariety', 'Stable variety') };
}

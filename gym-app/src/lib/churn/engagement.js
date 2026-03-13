/**
 * Churn Intelligence — Engagement Signal Calculators
 * ─────────────────────────────────────────────────────────────
 * Each signal function returns { value, score, maxPts, label }
 *
 * Evidence-based weights derived from published research:
 *   - RandomForest feature importance (Bolotov 2024; PerfectGym ML)
 *   - "dayswfreq" predictor (Gomez-Gallego et al., 2021)
 *   - IHRSA / GymMaster / SmartHealthClubs / FitnessKPI studies
 *
 * Score 0-100. Higher = higher churn risk.
 */

/**
 * 1. VISIT FREQUENCY (28 pts)
 * Research: "dayswfreq" is the single most reliable dropout predictor.
 * Members visiting 2+/week are 50% less likely to cancel.
 * Members visiting <1x/week in first month -> 80% cancel within 6 months.
 */
export function signalVisitFrequency(avgWeeklyVisits, trainingFrequencyGoal) {
  const MAX = 28;
  // Compare actual visits to either their stated goal or 2x/week baseline
  const target = Math.max(trainingFrequencyGoal || 3, 2);
  const ratio = target > 0 ? avgWeeklyVisits / target : 0;

  let score, label;
  if (avgWeeklyVisits === 0) {
    score = MAX;
    label = 'Zero visits in last 30 days';
  } else if (ratio < 0.25) {
    score = Math.round(MAX * 0.85); // 24
    label = `Only ${avgWeeklyVisits.toFixed(1)}x/week (goal: ${target}x)`;
  } else if (ratio < 0.5) {
    score = Math.round(MAX * 0.65); // 18
    label = `Visiting ${avgWeeklyVisits.toFixed(1)}x/week (50% below goal)`;
  } else if (ratio < 0.75) {
    score = Math.round(MAX * 0.35); // 10
    label = `Visiting ${avgWeeklyVisits.toFixed(1)}x/week (below goal)`;
  } else if (ratio < 1.0) {
    score = Math.round(MAX * 0.15); // 4
    label = `Nearly hitting visit goal (${avgWeeklyVisits.toFixed(1)}x/week)`;
  } else {
    score = 0;
    label = 'Meeting or exceeding visit frequency goal';
    // Bonus: consistent visitors reduce overall risk
    if (ratio >= 1.25) score = -3;
  }

  return { value: avgWeeklyVisits, score, maxPts: MAX, label };
}

/**
 * 2. RECENT ATTENDANCE TREND (17 pts)
 * Research: Behavior changes detectable 60-90 days before churn.
 * Current-month class frequency has ~17% feature importance.
 */
export function signalAttendanceTrend(avgWeeklyVisits, prevAvgWeeklyVisits) {
  const MAX = 17;

  if (prevAvgWeeklyVisits <= 0.2) {
    // No meaningful prior baseline to compare
    if (avgWeeklyVisits === 0) {
      return { value: null, score: 8, maxPts: MAX, label: 'No established visit pattern' };
    }
    return { value: null, score: 0, maxPts: MAX, label: 'New — building baseline' };
  }

  const dropPct = (prevAvgWeeklyVisits - avgWeeklyVisits) / prevAvgWeeklyVisits;

  let score, label;
  if (dropPct >= 0.75) {
    score = MAX;
    label = `Visit frequency crashed ${Math.round(dropPct * 100)}%`;
  } else if (dropPct >= 0.5) {
    score = Math.round(MAX * 0.75); // 13
    label = `Visit frequency dropped ${Math.round(dropPct * 100)}%`;
  } else if (dropPct >= 0.3) {
    score = Math.round(MAX * 0.5); // 9
    label = `Visit frequency declined ${Math.round(dropPct * 100)}%`;
  } else if (dropPct >= 0.15) {
    score = Math.round(MAX * 0.25); // 4
    label = `Slight attendance dip (${Math.round(dropPct * 100)}%)`;
  } else if (dropPct < -0.15) {
    score = -3; // frequency *increasing* — protective factor
    label = 'Attendance trending up';
  } else {
    score = 0;
    label = 'Attendance stable';
  }

  return { value: dropPct, score, maxPts: MAX, label };
}

/**
 * 4. SOCIAL & GROUP ENGAGEMENT (14 pts)
 * Research: Group class participants are 56% less likely to cancel.
 * Members with a gym friend are 40% less likely to cancel.
 * Personal trainer clients are 40% more likely to stay.
 *
 * Split: friends (6 pts) + challenges/group (5 pts) + trainer (3 pts)
 */
export function signalSocialEngagement(friendCount, challengeParticipation, hasTrainer) {
  const MAX = 14;
  let score = 0;
  const parts = [];

  // Friends (6 pts) — 40% less likely to cancel with a friend
  if (friendCount === 0) {
    score += 6;
    parts.push('No gym connections');
  } else if (friendCount === 1) {
    score += 3;
    parts.push('Only 1 gym connection');
  }
  // 2+ friends = socially anchored

  // Challenge/group participation (5 pts) — 56% less likely to cancel
  if (!challengeParticipation) {
    score += 5;
    parts.push('Not in any challenges');
  }

  // Trainer relationship (3 pts) — 40% more likely to stay
  if (!hasTrainer) {
    score += 3;
    parts.push('No trainer relationship');
  }

  const label = parts.length > 0
    ? parts.join('; ')
    : 'Socially connected & engaged';

  return { value: { friendCount, challengeParticipation, hasTrainer }, score, maxPts: MAX, label };
}

/**
 * 5. SESSION GAP PATTERN (10 pts)
 * Research: Growing intervals between visits is an early behavioral
 * warning signal, detectable before frequency metrics fully reflect it.
 */
export function signalSessionGaps(sessionGaps) {
  const MAX = 10;

  if (!sessionGaps || sessionGaps.length < 4) {
    return { value: null, score: 0, maxPts: MAX, label: 'Not enough data for gap analysis' };
  }

  // Compare average gap of recent sessions vs older sessions
  const mid = Math.floor(sessionGaps.length / 2);
  const recentAvg = sessionGaps.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const olderAvg = sessionGaps.slice(mid).reduce((a, b) => a + b, 0) / (sessionGaps.length - mid);

  if (olderAvg <= 0.5) {
    return { value: null, score: 0, maxPts: MAX, label: 'Consistent session timing' };
  }

  const acceleration = (recentAvg - olderAvg) / olderAvg;

  let score, label;
  if (acceleration >= 1.0) {
    score = MAX;
    label = `Session gaps doubled (${recentAvg.toFixed(1)} vs ${olderAvg.toFixed(1)} days)`;
  } else if (acceleration >= 0.5) {
    score = Math.round(MAX * 0.7); // 7
    label = 'Session gaps growing significantly';
  } else if (acceleration >= 0.25) {
    score = Math.round(MAX * 0.4); // 4
    label = 'Session gaps widening';
  } else if (acceleration < -0.15) {
    score = -2; // gaps shrinking — protective
    label = 'Session gaps getting shorter';
  } else {
    score = 0;
    label = 'Consistent session spacing';
  }

  return { value: acceleration, score, maxPts: MAX, label };
}

/**
 * 6. GOAL PROGRESS / MILESTONES (9 pts)
 * Research: Members achieving early fitness milestones in the first
 * 90 days are 60% more likely to stay. PRs, body metric progress,
 * and program completion are measurable milestones.
 */
export function signalGoalProgress(hasPRsRecently, hasBodyProgress, completedProgramPct, tenureMonths) {
  const MAX = 9;

  // This signal is most important in the first 6 months
  if (tenureMonths > 6) {
    // For established members, lack of progress is a weaker signal
    if (!hasPRsRecently && !hasBodyProgress) {
      return { value: false, score: 3, maxPts: MAX, label: 'No recent milestones (established member)' };
    }
    return { value: true, score: 0, maxPts: MAX, label: 'Hitting milestones' };
  }

  let score = 0;
  const parts = [];

  if (!hasPRsRecently) {
    score += 4;
    parts.push('No recent PRs');
  }

  if (!hasBodyProgress) {
    score += 3;
    parts.push('No body metric tracking');
  }

  if (completedProgramPct !== null && completedProgramPct < 0.3) {
    score += 2;
    parts.push('Low program completion');
  }

  // Cap at max
  score = Math.min(MAX, score);

  const label = parts.length > 0
    ? parts.join('; ')
    : 'On track with milestones';

  return { value: { hasPRsRecently, hasBodyProgress }, score, maxPts: MAX, label };
}

/**
 * 7. ENGAGEMENT DEPTH (7 pts)
 * Research: Secondary behavioral signals — workout completion rate,
 * session duration trends, and body metric logging frequency.
 */
export function signalEngagementDepth(completedSessions, abandonedSessions, avgDurLast30, avgDurPrior30) {
  const MAX = 7;
  let score = 0;
  const parts = [];

  // Workout completion rate (4 pts)
  const totalRecent = completedSessions + abandonedSessions;
  if (totalRecent >= 3) {
    const abandonRate = abandonedSessions / totalRecent;
    if (abandonRate >= 0.4) {
      score += 4;
      parts.push(`${Math.round(abandonRate * 100)}% sessions abandoned`);
    } else if (abandonRate >= 0.2) {
      score += 2;
      parts.push('Some sessions left incomplete');
    }
  }

  // Session duration trend (3 pts)
  if (avgDurPrior30 > 0 && avgDurLast30 > 0) {
    const durChange = (avgDurLast30 - avgDurPrior30) / avgDurPrior30;
    if (durChange <= -0.35) {
      score += 3;
      parts.push('Sessions getting much shorter');
    } else if (durChange <= -0.2) {
      score += 1;
      parts.push('Sessions slightly shorter');
    }
  }

  score = Math.min(MAX, score);

  const label = parts.length > 0
    ? parts.join('; ')
    : 'Good engagement depth';

  return { value: { completedSessions, abandonedSessions }, score, maxPts: MAX, label };
}

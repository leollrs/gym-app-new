// ── Daily Challenges (shared between Dashboard + Challenges page) ────────────
export const DAILY_CHALLENGES = [
  { name: 'Volume Crusher',    desc: 'Hit 10,000 lbs total volume today',     target: 10000, unit: 'lbs',       metric: 'volume',    nameKey: 'volume_crusher',    descKey: 'volume_crusher'    },
  { name: 'Rep Master',        desc: 'Complete 100 total reps today',          target: 100,   unit: 'reps',      metric: 'reps',      nameKey: 'rep_master',        descKey: 'rep_master'        },
  { name: 'Iron Will',         desc: 'Log at least 3 exercises today',         target: 3,     unit: 'exercises', metric: 'exercises', nameKey: 'iron_will',         descKey: 'iron_will'         },
  { name: 'Speed Demon',       desc: 'Finish a workout in under 30 minutes',  target: 1,     unit: 'workout',   metric: 'speed',     nameKey: 'speed_demon',       descKey: 'speed_demon'       },
  { name: 'Consistency King',  desc: 'Check in at the gym today',             target: 1,     unit: 'check-in',  metric: 'checkin',   nameKey: 'consistency_king',  descKey: 'consistency_king'  },
  { name: 'PR Hunter',         desc: 'Hit a new personal record today',        target: 1,     unit: 'PR',        metric: 'pr',        nameKey: 'pr_hunter',         descKey: 'pr_hunter'         },
  { name: 'Early Bird',        desc: 'Complete a workout before noon',         target: 1,     unit: 'workout',   metric: 'early',     nameKey: 'early_bird',        descKey: 'early_bird'        },
];

export function seededIndex(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % DAILY_CHALLENGES.length;
}

export function getTodayChallenge() {
  const dateString = new Date().toISOString().slice(0, 10);
  return DAILY_CHALLENGES[seededIndex(dateString)];
}

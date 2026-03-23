/**
 * Shared data helpers, constants, and templates for the Programs admin page.
 */

export const DEFAULT_SETS = 3;
export const DEFAULT_REST = 60;

export const normalizeExercise = (ex) => {
  if (typeof ex === 'string') return { id: ex, sets: DEFAULT_SETS, rest_seconds: DEFAULT_REST };
  return { id: ex.id, sets: ex.sets ?? DEFAULT_SETS, rest_seconds: ex.rest_seconds ?? DEFAULT_REST };
};

export const normalizeWeeks = (raw) => {
  const result = {};
  Object.entries(raw || {}).forEach(([wk, val]) => {
    if (!Array.isArray(val) || val.length === 0) { result[wk] = []; return; }
    if (typeof val[0] === 'string') {
      result[wk] = [{ name: 'Day 1', exercises: val.map(normalizeExercise) }];
    } else {
      result[wk] = val.map(day => ({
        ...day,
        exercises: (day.exercises || []).map(normalizeExercise),
      }));
    }
  });
  return result;
};

export const calcDaySeconds = (day) =>
  (day.exercises || []).reduce((sum, ex) => {
    const s = ex.sets ?? DEFAULT_SETS;
    const r = ex.rest_seconds ?? DEFAULT_REST;
    return sum + s * 45 + (s - 1) * r;
  }, 0);

export const fmtTime = (secs) => {
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const buildWeeksFromPattern = (pattern, durationWeeks) => {
  const weeks = {};
  for (let w = 1; w <= durationWeeks; w++) {
    weeks[w] = JSON.parse(JSON.stringify(pattern));
  }
  return weeks;
};

// ── Goal badge colors ──
export const GOAL_BADGE = {
  'Muscle Gain':      'bg-purple-500/15 text-purple-400',
  'Strength':         'bg-red-500/15 text-red-400',
  'General Fitness':  'bg-emerald-500/15 text-emerald-400',
  'Strength & Size':  'bg-blue-500/15 text-blue-400',
};

// ── Program Templates ──
export const PROGRAM_TEMPLATES = [
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    description: 'Classic 6-day split targeting all muscle groups twice per week. Best for intermediate lifters focused on hypertrophy.',
    goal: 'Muscle Gain',
    level: 'Intermediate',
    daysPerWeek: 6,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Push', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 120 },
        { id: 'ex_ibp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_dbp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_ohp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_ske',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Pull', exercises: [
        { id: 'ex_dl',   sets: 3, rest_seconds: 180 },
        { id: 'ex_bbr',  sets: 4, rest_seconds: 120 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_hc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_rdl',  sets: 3, rest_seconds: 120 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Push', exercises: [
        { id: 'ex_idbp', sets: 4, rest_seconds: 90 },
        { id: 'ex_dfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_fr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',   sets: 3, rest_seconds: 60 },
        { id: 'ex_cgp',  sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Pull', exercises: [
        { id: 'ex_pu',   sets: 4, rest_seconds: 120 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_cc',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_bdl',  sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',  sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_secr', sets: 4, rest_seconds: 45 },
      ]},
    ],
  },
  {
    id: 'upper_lower',
    name: 'Upper / Lower Split',
    description: '4-day split alternating upper and lower body. Balances strength and hypertrophy. Great for beginners and intermediates.',
    goal: 'Strength & Size',
    level: 'Beginner\u2013Intermediate',
    daysPerWeek: 4,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Upper A (Strength)', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 120 },
        { id: 'ex_bbr',  sets: 4, rest_seconds: 120 },
        { id: 'ex_ohp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_pu',   sets: 3, rest_seconds: 120 },
        { id: 'ex_bbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_cgp',  sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Lower A (Strength)', exercises: [
        { id: 'ex_sq',    sets: 4, rest_seconds: 180 },
        { id: 'ex_rdl',   sets: 3, rest_seconds: 120 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 90 },
        { id: 'ex_lc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',   sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Upper B (Hypertrophy)', exercises: [
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Lower B (Hypertrophy)', exercises: [
        { id: 'ex_lp_l', sets: 4, rest_seconds: 90 },
        { id: 'ex_bdl',  sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',  sets: 4, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_secr', sets: 4, rest_seconds: 45 },
      ]},
    ],
  },
  {
    id: 'full_body',
    name: 'Full Body 3\u00d7/Week',
    description: 'Three full-body sessions per week. Ideal for beginners, time-crunched members, or anyone building a base.',
    goal: 'General Fitness',
    level: 'Beginner',
    daysPerWeek: 3,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Full Body A', exercises: [
        { id: 'ex_sq',  sets: 3, rest_seconds: 180 },
        { id: 'ex_bp',  sets: 3, rest_seconds: 120 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc', sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Full Body B', exercises: [
        { id: 'ex_dl',  sets: 3, rest_seconds: 180 },
        { id: 'ex_dbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_pu',  sets: 3, rest_seconds: 120 },
        { id: 'ex_rdl', sets: 3, rest_seconds: 120 },
        { id: 'ex_hc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Full Body C', exercises: [
        { id: 'ex_sq',   sets: 3, rest_seconds: 180 },
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_lunge',sets: 3, rest_seconds: 60 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_plank',sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'strength_531',
    name: '5/3/1 Strength',
    description: "Jim Wendler's proven powerlifting-style program built around the squat, bench, deadlift, and overhead press. 4 days/week.",
    goal: 'Strength',
    level: 'Intermediate\u2013Advanced',
    daysPerWeek: 4,
    durationWeeks: 12,
    weekPattern: [
      { name: 'Squat Day', exercises: [
        { id: 'ex_sq',    sets: 5, rest_seconds: 180 },
        { id: 'ex_lp_l',  sets: 3, rest_seconds: 90 },
        { id: 'ex_le',    sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_plank', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Bench Day', exercises: [
        { id: 'ex_bp',   sets: 5, rest_seconds: 180 },
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_bbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Deadlift Day', exercises: [
        { id: 'ex_dl',  sets: 5, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
        { id: 'ex_cbr', sets: 3, rest_seconds: 90 },
        { id: 'ex_hc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_llr', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'OHP Day', exercises: [
        { id: 'ex_ohp',  sets: 5, rest_seconds: 180 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
        { id: 'ex_ske',  sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'bro_split',
    name: 'Classic Bro Split',
    description: 'One muscle group per day. High volume isolation work. 5 days/week. Popular for dedicated gym-goers focused on aesthetics.',
    goal: 'Muscle Gain',
    level: 'Intermediate',
    daysPerWeek: 5,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Chest', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 120 },
        { id: 'ex_ibp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_cfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Back', exercises: [
        { id: 'ex_dl',  sets: 4, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 4, rest_seconds: 120 },
        { id: 'ex_pu',  sets: 3, rest_seconds: 120 },
        { id: 'ex_lp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_cbr', sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Shoulders', exercises: [
        { id: 'ex_ohp',  sets: 4, rest_seconds: 120 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_lr',   sets: 4, rest_seconds: 60 },
        { id: 'ex_fr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Arms', exercises: [
        { id: 'ex_bbc', sets: 4, rest_seconds: 60 },
        { id: 'ex_dbc', sets: 3, rest_seconds: 60 },
        { id: 'ex_hc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd', sets: 4, rest_seconds: 60 },
        { id: 'ex_ske', sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_rdl',  sets: 3, rest_seconds: 120 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_hth',  sets: 3, rest_seconds: 90 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 45 },
      ]},
    ],
  },
];

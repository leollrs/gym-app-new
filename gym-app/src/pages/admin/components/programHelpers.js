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

// ── Template Categories ──
export const TEMPLATE_CATEGORIES = [
  { key: 'all', labelKey: 'admin.programs.categories.all', label: 'All' },
  { key: 'hypertrophy', labelKey: 'admin.programs.categories.hypertrophy', label: 'Hypertrophy' },
  { key: 'strength', labelKey: 'admin.programs.categories.strength', label: 'Strength' },
  { key: 'general', labelKey: 'admin.programs.categories.general', label: 'General Fitness' },
  { key: 'sport', labelKey: 'admin.programs.categories.sport', label: 'Athletic' },
  { key: 'home', labelKey: 'admin.programs.categories.home', label: 'Home / Minimal' },
  { key: 'advanced', labelKey: 'admin.programs.categories.advanced', label: 'Advanced' },
];

// ── Program Templates ──
export const PROGRAM_TEMPLATES = [
  {
    id: 'ppl',
    nameKey: 'admin.programs.tpl.ppl.name',
    descKey: 'admin.programs.tpl.ppl.desc',
    name: 'Push / Pull / Legs',
    category: 'hypertrophy',
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
    nameKey: 'admin.programs.tpl.upper_lower.name',
    descKey: 'admin.programs.tpl.upper_lower.desc',
    name: 'Upper / Lower Split',
    category: 'hypertrophy',
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
    nameKey: 'admin.programs.tpl.full_body.name',
    descKey: 'admin.programs.tpl.full_body.desc',
    name: 'Full Body 3\u00d7/Week',
    category: 'general',
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
    nameKey: 'admin.programs.tpl.strength_531.name',
    descKey: 'admin.programs.tpl.strength_531.desc',
    name: '5/3/1 Strength',
    category: 'strength',
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
    nameKey: 'admin.programs.tpl.bro_split.name',
    descKey: 'admin.programs.tpl.bro_split.desc',
    name: 'Classic Bro Split',
    category: 'hypertrophy',
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

  // ── STRENGTH ──────────────────────────────────────
  {
    id: 'starting_strength',
    nameKey: 'admin.programs.tpl.starting_strength.name',
    descKey: 'admin.programs.tpl.starting_strength.desc',
    name: 'Starting Strength',
    category: 'strength',
    description: 'Mark Rippetoe\'s beginner barbell program. 3 days/week, alternating A/B workouts. Focus on linear progression with squat, bench, deadlift, press.',
    goal: 'Strength',
    level: 'Beginner',
    daysPerWeek: 3,
    durationWeeks: 12,
    weekPattern: [
      { name: 'Workout A', exercises: [
        { id: 'ex_sq',  sets: 3, rest_seconds: 180 },
        { id: 'ex_bp',  sets: 3, rest_seconds: 180 },
        { id: 'ex_dl',  sets: 1, rest_seconds: 180 },
      ]},
      { name: 'Workout B', exercises: [
        { id: 'ex_sq',  sets: 3, rest_seconds: 180 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 180 },
        { id: 'ex_dl',  sets: 1, rest_seconds: 180 },
      ]},
      { name: 'Workout A', exercises: [
        { id: 'ex_sq',  sets: 3, rest_seconds: 180 },
        { id: 'ex_bp',  sets: 3, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
      ]},
    ],
  },
  {
    id: 'powerbuilding',
    nameKey: 'admin.programs.tpl.powerbuilding.name',
    descKey: 'admin.programs.tpl.powerbuilding.desc',
    name: 'Powerbuilding',
    category: 'strength',
    description: 'Hybrid strength + hypertrophy. Heavy compounds at low reps, then accessory work at higher reps. 4 days/week.',
    goal: 'Strength & Size',
    level: 'Intermediate',
    daysPerWeek: 4,
    durationWeeks: 10,
    weekPattern: [
      { name: 'Heavy Upper', exercises: [
        { id: 'ex_bp',  sets: 5, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 4, rest_seconds: 120 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 120 },
        { id: 'ex_pu',  sets: 3, rest_seconds: 120 },
        { id: 'ex_bbc', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Heavy Lower', exercises: [
        { id: 'ex_sq',  sets: 5, rest_seconds: 180 },
        { id: 'ex_dl',  sets: 3, rest_seconds: 180 },
        { id: 'ex_rdl', sets: 3, rest_seconds: 120 },
        { id: 'ex_le',  sets: 3, rest_seconds: 60 },
        { id: 'ex_scr', sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Volume Upper', exercises: [
        { id: 'ex_idbp', sets: 4, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_lr',   sets: 4, rest_seconds: 60 },
        { id: 'ex_cfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Volume Lower', exercises: [
        { id: 'ex_lp_l',  sets: 4, rest_seconds: 90 },
        { id: 'ex_bdl',   sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',   sets: 4, rest_seconds: 90 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_secr',  sets: 4, rest_seconds: 45 },
      ]},
    ],
  },

  // ── GENERAL FITNESS ───────────────────────────────
  {
    id: 'minimalist',
    nameKey: 'admin.programs.tpl.minimalist.name',
    descKey: 'admin.programs.tpl.minimalist.desc',
    name: 'Minimalist 2×/Week',
    category: 'general',
    description: 'For members who can only train twice per week. Two full-body sessions hitting all major groups with compound movements.',
    goal: 'General Fitness',
    level: 'Beginner',
    daysPerWeek: 2,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Session A', exercises: [
        { id: 'ex_sq',  sets: 3, rest_seconds: 120 },
        { id: 'ex_bp',  sets: 3, rest_seconds: 120 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 90 },
        { id: 'ex_plank', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Session B', exercises: [
        { id: 'ex_dl',    sets: 3, rest_seconds: 120 },
        { id: 'ex_idbp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_lp',    sets: 3, rest_seconds: 90 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 60 },
        { id: 'ex_bbc',   sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'fat_loss_circuit',
    nameKey: 'admin.programs.tpl.fat_loss_circuit.name',
    descKey: 'admin.programs.tpl.fat_loss_circuit.desc',
    name: 'Fat Loss Circuit',
    category: 'general',
    description: 'High-intensity circuit-style training with short rest. Full body every session, 3 days/week. Designed to burn calories and build endurance.',
    goal: 'General Fitness',
    level: 'Beginner\u2013Intermediate',
    daysPerWeek: 3,
    durationWeeks: 6,
    weekPattern: [
      { name: 'Circuit A', exercises: [
        { id: 'ex_sq',    sets: 3, rest_seconds: 30 },
        { id: 'ex_pup',   sets: 3, rest_seconds: 30 },
        { id: 'ex_dbr',   sets: 3, rest_seconds: 30 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 30 },
        { id: 'ex_plank', sets: 3, rest_seconds: 30 },
      ]},
      { name: 'Circuit B', exercises: [
        { id: 'ex_dl',    sets: 3, rest_seconds: 30 },
        { id: 'ex_dbp',   sets: 3, rest_seconds: 30 },
        { id: 'ex_cbr',   sets: 3, rest_seconds: 30 },
        { id: 'ex_hth',   sets: 3, rest_seconds: 30 },
        { id: 'ex_llr',   sets: 3, rest_seconds: 30 },
      ]},
      { name: 'Circuit C', exercises: [
        { id: 'ex_lp_l',  sets: 3, rest_seconds: 30 },
        { id: 'ex_idbp',  sets: 3, rest_seconds: 30 },
        { id: 'ex_lp',    sets: 3, rest_seconds: 30 },
        { id: 'ex_rdl',   sets: 3, rest_seconds: 30 },
        { id: 'ex_vc',    sets: 3, rest_seconds: 30 },
      ]},
    ],
  },

  // ── ATHLETIC ──────────────────────────────────────
  {
    id: 'athletic_performance',
    nameKey: 'admin.programs.tpl.athletic_performance.name',
    descKey: 'admin.programs.tpl.athletic_performance.desc',
    name: 'Athletic Performance',
    category: 'sport',
    description: 'Power, speed, and functional strength. Compound lifts + explosive movements. 4 days/week for athletes.',
    goal: 'Strength',
    level: 'Intermediate\u2013Advanced',
    daysPerWeek: 4,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Power Upper', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 150 },
        { id: 'ex_bbr',  sets: 4, rest_seconds: 120 },
        { id: 'ex_ohp',  sets: 3, rest_seconds: 120 },
        { id: 'ex_pu',   sets: 3, rest_seconds: 120 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Power Lower', exercises: [
        { id: 'ex_sq',    sets: 4, rest_seconds: 180 },
        { id: 'ex_dl',    sets: 3, rest_seconds: 180 },
        { id: 'ex_hth',   sets: 3, rest_seconds: 90 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',   sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Speed Upper', exercises: [
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Speed Lower', exercises: [
        { id: 'ex_lp_l',  sets: 3, rest_seconds: 90 },
        { id: 'ex_bdl',   sets: 3, rest_seconds: 90 },
        { id: 'ex_le',    sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_secr',  sets: 4, rest_seconds: 45 },
      ]},
    ],
  },

  // ── HOME / MINIMAL EQUIPMENT ──────────────────────
  {
    id: 'bodyweight',
    nameKey: 'admin.programs.tpl.bodyweight.name',
    descKey: 'admin.programs.tpl.bodyweight.desc',
    name: 'Bodyweight Only',
    category: 'home',
    description: 'No equipment needed. Perfect for home workouts or traveling. 3 days/week, progressive bodyweight exercises.',
    goal: 'General Fitness',
    level: 'Beginner',
    daysPerWeek: 3,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Upper Body', exercises: [
        { id: 'ex_pup',   sets: 4, rest_seconds: 60 },
        { id: 'ex_dips',  sets: 3, rest_seconds: 60 },
        { id: 'ex_pu',    sets: 3, rest_seconds: 90 },
        { id: 'ex_plank', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Lower Body', exercises: [
        { id: 'ex_bsq',   sets: 4, rest_seconds: 60 },
        { id: 'ex_lunge',  sets: 3, rest_seconds: 60 },
        { id: 'ex_hth',   sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',   sets: 4, rest_seconds: 45 },
        { id: 'ex_llr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Full Body', exercises: [
        { id: 'ex_pup',   sets: 3, rest_seconds: 60 },
        { id: 'ex_bsq',   sets: 3, rest_seconds: 60 },
        { id: 'ex_pu',    sets: 3, rest_seconds: 90 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 60 },
        { id: 'ex_plank', sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'dumbbell_only',
    nameKey: 'admin.programs.tpl.dumbbell_only.name',
    descKey: 'admin.programs.tpl.dumbbell_only.desc',
    name: 'Dumbbell Only',
    category: 'home',
    description: 'Full program using only dumbbells. Great for home gyms with limited equipment. 4 days/week upper/lower split.',
    goal: 'Muscle Gain',
    level: 'Beginner\u2013Intermediate',
    daysPerWeek: 4,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Upper A', exercises: [
        { id: 'ex_dbp',  sets: 4, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Lower A', exercises: [
        { id: 'ex_dbs',   sets: 4, rest_seconds: 90 },
        { id: 'ex_rdl',   sets: 3, rest_seconds: 90 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',   sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Upper B', exercises: [
        { id: 'ex_idbp',  sets: 4, rest_seconds: 90 },
        { id: 'ex_dbr',   sets: 3, rest_seconds: 90 },
        { id: 'ex_dfly',  sets: 3, rest_seconds: 60 },
        { id: 'ex_hc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',    sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Lower B', exercises: [
        { id: 'ex_dbs',   sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',   sets: 4, rest_seconds: 90 },
        { id: 'ex_bdl',   sets: 3, rest_seconds: 90 },
        { id: 'ex_secr',  sets: 4, rest_seconds: 45 },
      ]},
    ],
  },

  // ── ADVANCED ──────────────────────────────────────
  {
    id: 'phul',
    nameKey: 'admin.programs.tpl.phul.name',
    descKey: 'admin.programs.tpl.phul.desc',
    name: 'PHUL (Power Hypertrophy Upper Lower)',
    category: 'hypertrophy',
    description: 'Power Hypertrophy Upper Lower — 4-day split combining heavy strength work with high-volume hypertrophy sessions. For advanced lifters.',
    goal: 'Muscle Gain',
    level: 'Advanced',
    daysPerWeek: 4,
    durationWeeks: 10,
    weekPattern: [
      { name: 'Power Upper', exercises: [
        { id: 'ex_bp',  sets: 5, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 4, rest_seconds: 120 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 120 },
        { id: 'ex_cgp', sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Power Lower', exercises: [
        { id: 'ex_sq',   sets: 5, rest_seconds: 180 },
        { id: 'ex_dl',   sets: 3, rest_seconds: 180 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 60 },
      ]},
      { name: 'Hypertrophy Upper', exercises: [
        { id: 'ex_idbp', sets: 4, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_cfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 4, rest_seconds: 60 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',   sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Hypertrophy Lower', exercises: [
        { id: 'ex_lp_l', sets: 4, rest_seconds: 90 },
        { id: 'ex_rdl',  sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',  sets: 4, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_secr', sets: 4, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'phat',
    nameKey: 'admin.programs.tpl.phat.name',
    descKey: 'admin.programs.tpl.phat.desc',
    name: 'PHAT (Power Hypertrophy Adaptive Training)',
    category: 'hypertrophy',
    description: 'Layne Norton\'s 5-day program blending heavy power days with high-rep hypertrophy days. For experienced lifters seeking both strength and size.',
    goal: 'Muscle Gain',
    level: 'Advanced',
    daysPerWeek: 5,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Power Upper', exercises: [
        { id: 'ex_bp',   sets: 5, rest_seconds: 180 },
        { id: 'ex_bbr',  sets: 5, rest_seconds: 180 },
        { id: 'ex_ohp',  sets: 3, rest_seconds: 120 },
        { id: 'ex_pu',   sets: 3, rest_seconds: 120 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Power Lower', exercises: [
        { id: 'ex_sq',   sets: 5, rest_seconds: 180 },
        { id: 'ex_rdl',  sets: 4, rest_seconds: 120 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 60 },
      ]},
      { name: 'Hypertrophy Back/Shoulders', exercises: [
        { id: 'ex_lp',   sets: 4, rest_seconds: 90 },
        { id: 'ex_cbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 4, rest_seconds: 60 },
        { id: 'ex_fr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Hypertrophy Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 120 },
        { id: 'ex_hth',  sets: 4, rest_seconds: 90 },
        { id: 'ex_le',   sets: 4, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_bdl',  sets: 3, rest_seconds: 90 },
        { id: 'ex_secr', sets: 4, rest_seconds: 60 },
      ]},
      { name: 'Hypertrophy Chest/Arms', exercises: [
        { id: 'ex_idbp', sets: 4, rest_seconds: 90 },
        { id: 'ex_cfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc',  sets: 4, rest_seconds: 60 },
        { id: 'ex_hc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_ske',  sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'advanced_ppl',
    nameKey: 'admin.programs.tpl.advanced_ppl.name',
    descKey: 'admin.programs.tpl.advanced_ppl.desc',
    name: 'Advanced PPL (High Volume)',
    category: 'hypertrophy',
    description: 'High-volume 6-day Push/Pull/Legs with A/B variants for maximum muscle growth. For advanced lifters who can handle high training volume.',
    goal: 'Muscle Gain',
    level: 'Advanced',
    daysPerWeek: 6,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Push A', exercises: [
        { id: 'ex_bp',  sets: 5, rest_seconds: 180 },
        { id: 'ex_ibp', sets: 4, rest_seconds: 120 },
        { id: 'ex_dbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 120 },
        { id: 'ex_lr',  sets: 4, rest_seconds: 60 },
        { id: 'ex_tpd', sets: 4, rest_seconds: 60 },
        { id: 'ex_oe',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Pull A', exercises: [
        { id: 'ex_dl',   sets: 4, rest_seconds: 180 },
        { id: 'ex_bbr',  sets: 4, rest_seconds: 120 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc',  sets: 4, rest_seconds: 60 },
        { id: 'ex_hc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs A', exercises: [
        { id: 'ex_sq',   sets: 5, rest_seconds: 180 },
        { id: 'ex_rdl',  sets: 4, rest_seconds: 120 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 4, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 4, rest_seconds: 60 },
        { id: 'ex_hth',  sets: 3, rest_seconds: 90 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 60 },
      ]},
      { name: 'Push B', exercises: [
        { id: 'ex_idbp', sets: 4, rest_seconds: 90 },
        { id: 'ex_dfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_dips', sets: 4, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_cgp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_fr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Pull B', exercises: [
        { id: 'ex_pu',   sets: 4, rest_seconds: 120 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_cglp', sets: 3, rest_seconds: 90 },
        { id: 'ex_sap',  sets: 3, rest_seconds: 90 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_cc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs B', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_bdl',  sets: 4, rest_seconds: 120 },
        { id: 'ex_hth',  sets: 4, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_secr', sets: 4, rest_seconds: 60 },
        { id: 'ex_adm',  sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'strength_peaking',
    nameKey: 'admin.programs.tpl.strength_peaking.name',
    descKey: 'admin.programs.tpl.strength_peaking.desc',
    name: 'Strength Peaking',
    category: 'strength',
    description: 'Competition-style peaking program focused on the big 4 lifts. High intensity, low accessories. 4 days/week, 6 weeks. For advanced powerlifters.',
    goal: 'Strength',
    level: 'Advanced',
    daysPerWeek: 4,
    durationWeeks: 6,
    weekPattern: [
      { name: 'Heavy Squat', exercises: [
        { id: 'ex_sq',    sets: 6, rest_seconds: 180 },
        { id: 'ex_lp_l',  sets: 3, rest_seconds: 90 },
        { id: 'ex_le',    sets: 3, rest_seconds: 60 },
        { id: 'ex_plank', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Heavy Bench', exercises: [
        { id: 'ex_bp',  sets: 6, rest_seconds: 180 },
        { id: 'ex_cgp', sets: 3, rest_seconds: 90 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
        { id: 'ex_tpd', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Heavy Deadlift', exercises: [
        { id: 'ex_dl',  sets: 5, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
        { id: 'ex_rdl', sets: 3, rest_seconds: 90 },
        { id: 'ex_hyp', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Heavy OHP', exercises: [
        { id: 'ex_ohp', sets: 5, rest_seconds: 180 },
        { id: 'ex_ibp', sets: 3, rest_seconds: 120 },
        { id: 'ex_lr',  sets: 3, rest_seconds: 60 },
        { id: 'ex_fr',  sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
];

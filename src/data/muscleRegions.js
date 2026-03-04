// Canonical muscle region definitions used by BodyDiagram

export const BODY_REGION_DEFINITIONS = [
  // ── Chest ────────────────────────────────────────────────
  { id: 'upper_chest',   label: 'Upper Chest',     group: 'Chest',           emphasis: 'primary'   },
  { id: 'mid_chest',     label: 'Mid Chest',        group: 'Chest',           emphasis: 'primary'   },
  { id: 'lower_chest',   label: 'Lower Chest',      group: 'Chest',           emphasis: 'primary'   },

  // ── Shoulders ────────────────────────────────────────────
  { id: 'front_delts',   label: 'Front Delts',      group: 'Shoulders',       emphasis: 'primary'   },
  { id: 'side_delts',    label: 'Side Delts',        group: 'Shoulders',       emphasis: 'primary'   },
  { id: 'rear_delts',    label: 'Rear Delts',        group: 'Shoulders',       emphasis: 'primary'   },

  // ── Arms ─────────────────────────────────────────────────
  { id: 'biceps',        label: 'Biceps',            group: 'Arms',            emphasis: 'primary'   },
  { id: 'triceps',       label: 'Triceps',           group: 'Arms',            emphasis: 'primary'   },
  { id: 'forearms',      label: 'Forearms',          group: 'Arms',            emphasis: 'secondary' },
  { id: 'brachialis',    label: 'Brachialis',        group: 'Arms',            emphasis: 'secondary' },

  // ── Core ─────────────────────────────────────────────────
  { id: 'upper_abs',     label: 'Upper Abs',         group: 'Core',            emphasis: 'primary'   },
  { id: 'mid_abs',       label: 'Mid Abs',           group: 'Core',            emphasis: 'primary'   },
  { id: 'lower_abs',     label: 'Lower Abs',         group: 'Core',            emphasis: 'primary'   },
  { id: 'obliques',      label: 'Obliques',          group: 'Core',            emphasis: 'primary'   },
  { id: 'serratus',      label: 'Serratus',          group: 'Core',            emphasis: 'secondary' },
  { id: 'abs',           label: 'Abs',               group: 'Core',            emphasis: 'primary'   }, // general fallback

  // ── Back ─────────────────────────────────────────────────
  { id: 'traps',         label: 'Traps',             group: 'Back',            emphasis: 'primary'   },
  { id: 'upper_back',    label: 'Upper Back',        group: 'Back',            emphasis: 'primary'   },
  { id: 'mid_back',      label: 'Mid Back',          group: 'Back',            emphasis: 'primary'   },
  { id: 'lats',          label: 'Lats',              group: 'Back',            emphasis: 'primary'   },
  { id: 'lower_back',    label: 'Lower Back',        group: 'Back',            emphasis: 'primary'   },

  // ── Glutes ───────────────────────────────────────────────
  { id: 'glutes',        label: 'Glutes',            group: 'Glutes',          emphasis: 'primary'   },
  { id: 'glute_med',     label: 'Glute Med',         group: 'Glutes',          emphasis: 'primary'   },

  // ── Upper Legs ───────────────────────────────────────────
  { id: 'quads',         label: 'Quads',             group: 'Upper Legs',      emphasis: 'primary'   },
  { id: 'hamstrings',    label: 'Hamstrings',        group: 'Upper Legs',      emphasis: 'primary'   },
  { id: 'adductors',     label: 'Adductors',         group: 'Upper Legs',      emphasis: 'secondary' },
  { id: 'abductors',     label: 'Abductors',         group: 'Upper Legs',      emphasis: 'secondary' },
  { id: 'hip_flexors',   label: 'Hip Flexors',       group: 'Upper Legs',      emphasis: 'secondary' },

  // ── Lower Legs ───────────────────────────────────────────
  { id: 'calves',        label: 'Calves',            group: 'Lower Legs',      emphasis: 'primary'   },
  { id: 'soleus',        label: 'Soleus',            group: 'Lower Legs',      emphasis: 'secondary' },
  { id: 'tibialis',      label: 'Tibialis',          group: 'Lower Legs',      emphasis: 'secondary' },
];

// ── Shared constants and helpers for Progress sub-components ──────────────

export const tooltipStyle = {
  contentStyle: {
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: '#9CA3AF' },
  itemStyle: { color: '#D4AF37' },
};

// ── Strength standards ──────────────────────────────────────────────────────
export const STANDARDS = [
  { exerciseId: 'ex_bp', name: 'Bench Press', tiers: [0.5, 0.75, 1.25, 1.75, 2.0] },
  { exerciseId: 'ex_sq', name: 'Back Squat', tiers: [0.75, 1.25, 1.75, 2.25, 2.75] },
  { exerciseId: 'ex_dl', name: 'Deadlift', tiers: [1.0, 1.5, 2.0, 2.5, 3.0] },
  { exerciseId: 'ex_ohp', name: 'Overhead Press', tiers: [0.35, 0.55, 0.75, 1.1, 1.4] },
  { exerciseId: 'ex_bbr', name: 'Barbell Row', tiers: [0.5, 0.75, 1.0, 1.5, 1.75] },
];
export const TIER_LABELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
export const TIER_COLORS = ['#6B7280', '#60A5FA', '#10B981', '#D4AF37', '#EF4444'];

export const getTier = (orm, bw, tiers) => {
  if (!bw) return -1;
  const ratio = orm / bw;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (ratio >= tiers[i]) return i;
  }
  return -1;
};

export const getTierProgress = (orm, bw, tiers, tier) => {
  if (!bw || tier < 0) return 0;
  if (tier >= tiers.length - 1) return 100;
  const lo = tier < 0 ? 0 : tiers[tier] * bw;
  const hi = tiers[tier + 1] * bw;
  return Math.min(100, Math.round(((orm - lo) / (hi - lo)) * 100));
};

// ── Body metrics constants ──────────────────────────────────────────────────
export const MEASUREMENT_FIELDS = [
  { key: 'chest_cm', label: 'Chest', unit: 'cm' },
  { key: 'waist_cm', label: 'Waist', unit: 'cm' },
  { key: 'hips_cm', label: 'Hips', unit: 'cm' },
  { key: 'left_arm_cm', label: 'Left Arm', unit: 'cm' },
  { key: 'right_arm_cm', label: 'Right Arm', unit: 'cm' },
  { key: 'left_thigh_cm', label: 'Left Thigh', unit: 'cm' },
  { key: 'right_thigh_cm', label: 'Right Thigh', unit: 'cm' },
  { key: 'body_fat_pct', label: 'Body Fat', unit: '%' },
];

export const PERIOD_OPTIONS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
export const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const formatMonthYear = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export const fmtW = (w) => (w != null ? `${parseFloat(w).toFixed(1)}` : '—');
export const today = () => new Date().toISOString().slice(0, 10);

export const TABS = ['Overview', 'History', 'Strength', 'Body'];

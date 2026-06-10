// Trainer design tokens — fixed palette extracted from the redesign reference
// HTMLs in docs/trainer-redesign/. Member/admin sides keep gym white-label
// branding; trainer side has its own visual identity (warm cream + teal).

export const TT = {
  // ── Chrome — THEME-AWARE via --tt-* CSS vars (light in :root, dark in
  //    html.dark; see index.css). The trainer side now follows the app's
  //    dark/light toggle. These resolve fine in inline `style` / className,
  //    but NOT in raw SVG/lucide attributes (var() doesn't resolve there) —
  //    use the fixed hues below for `stroke=`/`fill=`/lucide `color=`. ──
  bg:           'var(--tt-bg)',
  bgElev:       'var(--tt-bg-elev)',
  surface:      'var(--tt-surface)',
  surface2:     'var(--tt-surface-2)',
  border:       'var(--tt-border)',
  borderSolid:  'var(--tt-border-solid)',
  borderStrong: 'var(--tt-border-strong)',
  text:         'var(--tt-text)',
  textSub:      'var(--tt-text-sub)',
  onInverse:    'var(--tt-on-inverse)',   // on a TT.text-colored button: white (light) / near-black (dark)
  accentSoft:   'var(--tt-accent-soft)',
  accentInk:    'var(--tt-accent-ink)',
  hotSoft:      'var(--tt-hot-soft)',
  warnSoft:     'var(--tt-warn-soft)',
  warnInk:      'var(--tt-warn-ink)',
  goodSoft:     'var(--tt-good-soft)',
  goodInk:      'var(--tt-good-ink)',
  coachSoft:    'var(--tt-coach-soft)',
  shadow:       'var(--tt-shadow)',
  shadowLg:     'var(--tt-shadow-lg)',

  // ── Fixed hues — identical in BOTH themes (legible on light AND dark) and
  //    safe inside SVG/lucide attributes + hex-alpha concat (`${TT.accent}25`).
  surfaceDk:    '#0E1316',   // intentionally-dark hero block (THeroDark), both themes
  surfaceDk2:   '#161C20',
  textInv:      '#F5F2EC',
  textMute:     '#96A0AA',   // mid-grey — chart axes / icon strokes
  textFaint:    '#b8bec5',
  accent:       '#19B8B8',
  accentDark:   '#0F9E9E',
  hot:          '#FF5A2E',
  warn:         '#E8A93A',
  coach:        '#6D5FDB',
  good:         '#2FA66B',
};

export const TFont = {
  display: '"Archivo", "Familjen Grotesk", system-ui, sans-serif',
  body:    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  mono:    '"JetBrains Mono", ui-monospace, monospace',
};

const STATUS_TONE = {
  churn: TT.hot, risk: TT.warn, on: TT.accent,
  on_track: TT.accent, at_risk: TT.warn, behind: TT.hot, inactive: TT.textMute,
};
export const statusTone = (status) => STATUS_TONE[status] || TT.accent;

export const AVATAR_PALETTES = [
  ['#FFB86B', '#FF7A3D'],
  ['#7FE3C4', '#19B8B8'],
  ['#D0C6FF', '#6D5FDB'],
  ['#FFD166', '#F2A23A'],
  ['#B8E8A8', '#5EAA5E'],
  ['#FFB8B8', '#E87171'],
  ['#C8D8FF', '#6B8FE8'],
];

// Stable index from any string id (uuid, profile id, name).
export const avatarIdx = (id) => {
  if (!id) return 0;
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % AVATAR_PALETTES.length;
};

export const avatarGradient = (idx) => AVATAR_PALETTES[idx % AVATAR_PALETTES.length];

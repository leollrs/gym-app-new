// Trainer design tokens — fixed palette extracted from the redesign reference
// HTMLs in docs/trainer-redesign/. Member/admin sides keep gym white-label
// branding; trainer side has its own visual identity (warm cream + teal).

export const TT = {
  bg:           '#f0eee9',
  bgElev:       '#faf8f3',
  surface:      '#ffffff',
  surface2:     '#f7f5f0',
  surfaceDk:    '#0E1316',
  surfaceDk2:   '#161C20',
  border:       'rgba(15,20,25,0.07)',
  borderSolid:  '#e8e4db',
  borderStrong: 'rgba(15,20,25,0.14)',
  text:         '#0B0F12',
  textInv:      '#F5F2EC',
  textSub:      '#5A6570',
  textMute:     '#96A0AA',
  textFaint:    '#b8bec5',
  accent:       '#19B8B8',
  accentDark:   '#0F9E9E',
  accentSoft:   '#D9F1F1',
  accentInk:    '#08585A',
  hot:          '#FF5A2E',
  hotSoft:      '#FFE3D6',
  warn:         '#E8A93A',
  warnSoft:     '#FBEED4',
  warnInk:      '#9A6C10',
  coach:        '#6D5FDB',
  coachSoft:    '#EDEAFB',
  good:         '#2FA66B',
  goodSoft:     '#DFF1E6',
  goodInk:      '#1E7A4E',
  shadow:       '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
  shadowLg:     '0 2px 4px rgba(15,20,25,0.05), 0 16px 40px rgba(15,20,25,0.08)',
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

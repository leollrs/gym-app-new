/* ============================================================
   TuGymPR · Reward symbols
   A small curated set of line icons used in place of emoji for
   gym_rewards. The chosen symbol's KEY is stored in the existing
   `gym_rewards.emoji_icon` column (no migration needed). Legacy
   rows that still hold an actual emoji fall back to rendering that
   emoji as text, so nothing breaks during the transition.
   gym_products keep their emoji_icon — this is rewards-only.
   ============================================================ */

function S({ ch, size = 20, color = 'currentColor', stroke = 1.9, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>{ch}</svg>
  );
}

export const REWARD_SYMBOLS = [
  { key: 'gift',     ch: <><rect x="3.5" y="9" width="17" height="12" rx="1.6" /><path d="M3.5 13h17M12 9v12" /><path d="M12 9S10.7 4.5 8 5.2 12 9 12 9ZM12 9s1.3-4.5 4-3.8S12 9 12 9Z" /></> },
  { key: 'star',     ch: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6-4.5-4.2 6.1-.7L12 3Z" /> },
  { key: 'trophy',   ch: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" /><path d="M9.5 14.5 9 18h6l-.5-3.5M8 21h8M12 18v3" /></> },
  { key: 'medal',    ch: <><path d="m8 4-3 .6 2 4.4M16 4l3 .6-2 4.4" /><circle cx="12" cy="14.5" r="5.5" /><path d="M12 12v2l1.4 1" /></> },
  { key: 'crown',    ch: <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z" /> },
  { key: 'ticket',   ch: <><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" /><path d="M15 6v12" strokeDasharray="2 2" /></> },
  { key: 'tag',      ch: <><path d="M3 7v5.5a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l5.5-5.5a2 2 0 0 0 0-2.8l-7-7A2 2 0 0 0 12.5 3H7a4 4 0 0 0-4 4Z" /><circle cx="8" cy="8" r="1.4" /></> },
  { key: 'percent',  ch: <><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></> },
  { key: 'dumbbell', ch: <><path d="M6.5 6.5 17.5 17.5M3 7v10M21 7v10M6 4v16M18 4v16M2 12h2M20 12h2" /></> },
  { key: 'bolt',     ch: <path d="M13 2 4 14h7l-2 8 9-12h-7l2-8Z" /> },
  { key: 'flame',    ch: <path d="M12 2c1 3.5 4 5.2 4 9a4 4 0 0 1-8 0c0-1.4.5-2.4 1-3 .2 1 .8 1.7 1.6 1.9C10 8 11 5 12 2Z" /> },
  { key: 'heart',    ch: <path d="M12 20s-7-4.6-9.3-9C1.2 8 2.6 4.8 5.8 4.8c2 0 3.2 1.3 4.2 2.6 1-1.3 2.2-2.6 4.2-2.6 3.2 0 4.6 3.2 3.1 6.2C19 15.4 12 20 12 20Z" /> },
  { key: 'cup',      ch: <><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M17 9h2.2a2.5 2.5 0 0 1 0 5H17" /><path d="M7 3v2M11 3v2" /></> },
  { key: 'cake',     ch: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="M5 15c1.2 0 1.2 1 2.3 1s1.2-1 2.3-1 1.2 1 2.4 1 1.2-1 2.3-1 1.2 1 2.4 1" /><path d="M9 8.5V6M12 8.5V6M15 8.5V6" /></> },
  { key: 'bag',      ch: <><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></> },
  { key: 'shirt',    ch: <path d="M7 4 4 7l2 2 1-1v11h10V8l1 1 2-2-3-3-3 1a2 2 0 0 1-4 0L7 4Z" /> },
];

const KEYS = new Set(REWARD_SYMBOLS.map(s => s.key));
const BY_KEY = Object.fromEntries(REWARD_SYMBOLS.map(s => [s.key, s.ch]));

export const DEFAULT_REWARD_SYMBOL = 'gift';
export const isRewardSymbol = (v) => typeof v === 'string' && KEYS.has(v);

/**
 * Renders a reward's symbol. If `value` is a known symbol key → line icon.
 * If it's a legacy emoji/text → render it as text. If empty → default gift icon.
 */
export function RewardSymbol({ value, size = 20, color = 'currentColor', stroke = 1.9, style = {} }) {
  if (isRewardSymbol(value)) return <S ch={BY_KEY[value]} size={size} color={color} stroke={stroke} style={style} />;
  if (value) return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{value}</span>;
  return <S ch={BY_KEY[DEFAULT_REWARD_SYMBOL]} size={size} color={color} stroke={stroke} style={style} />;
}

/**
 * Plain-text label for <option>/text contexts where an icon can't render.
 * Symbol keys are dropped (just the name); legacy emojis keep their prefix.
 */
export function rewardLabelText(value, name) {
  if (!value || isRewardSymbol(value)) return name;
  return `${value} ${name}`;
}

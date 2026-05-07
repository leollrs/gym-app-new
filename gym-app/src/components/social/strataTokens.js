// Strata post style — shared design tokens.
// Strava-leaning, metrics-first. Uses theme CSS vars so dark mode + white-label
// branding still work; adds a few literal accents (PR orange, gold) that the
// brand system doesn't own.

export const STRATA_FONT_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
export const STRATA_FONT_MONO = '"SF Mono", ui-monospace, "Roboto Mono", monospace';

export const STRATA_HOT = '#FF5A2E';        // PR / streak signal
export const STRATA_HOT_SOFT = 'rgba(255,90,46,0.12)';
export const STRATA_GOLD = '#E8C547';

export const STRATA_RADIUS_CARD = 22;
export const STRATA_RADIUS_INNER = 14;

// Card surface — uses the existing card token so theming works.
export const STRATA_CARD_SHADOW =
  '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)';

// Divider color used between stat columns and at row separators.
export const STRATA_DIVIDER = 'var(--color-border-subtle, rgba(127,127,127,0.08))';
export const STRATA_DIVIDER_STRONG = 'var(--color-border-default, rgba(127,127,127,0.14))';

// Map a metric name → tabular tone.
export const STRATA_STAT_LABEL = {
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: 1.1,
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
};

export const STRATA_STAT_VALUE = {
  fontFamily: STRATA_FONT_DISPLAY,
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: -0.8,
  lineHeight: 1.1,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--color-text-primary)',
};

// Volume formatter shared with the card.
export const fmtVolume = (lbs, unit = 'lbs') => {
  if (!lbs) return { value: '0', unit };
  return lbs >= 1000
    ? { value: (lbs / 1000).toFixed(1), unit: `k ${unit}` }
    : { value: String(Math.round(lbs)), unit };
};

export const fmtDurationStrip = (seconds) => {
  if (!seconds) return { value: '—', unit: '' };
  const m = Math.round(seconds / 60);
  if (m < 60) return { value: String(m), unit: 'min' };
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return { value: `${h}:${String(rem).padStart(2, '0')}`, unit: '' };
};

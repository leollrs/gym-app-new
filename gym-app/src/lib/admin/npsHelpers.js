/**
 * Pure presentation helpers for the Admin → NPS page. Color decisions are
 * keyed to the 1-5 raw score (`scoreColor`/`scoreBg`) and the computed NPS
 * value (`npsColor`/`npsBarColor`/`npsGaugePercent`). Kept here so the page
 * file only deals with layout + data fetching.
 */

export const PERIODS = [
  { labelKey: '30d', days: 30 },
  { labelKey: '90d', days: 90 },
  { labelKey: '180d', days: 180 },
  { labelKey: 'allTime', days: null },
];

export function scoreColor(score) {
  if (score <= 2) return 'text-red-400';
  if (score <= 3) return 'text-amber-400';
  return 'text-emerald-400';
}

export function scoreBg(score) {
  if (score <= 2) return 'bg-red-400/20 text-red-400';
  if (score <= 3) return 'bg-amber-400/20 text-amber-400';
  return 'bg-emerald-400/20 text-emerald-400';
}

export function npsColor(nps) {
  if (nps < 0) return 'var(--color-danger)';
  if (nps < 30) return 'var(--color-danger)';
  if (nps < 70) return 'var(--color-success)';
  return 'var(--color-success)';
}

export function npsBarColor(nps) {
  if (nps < 0) return 'bg-red-400';
  if (nps < 30) return 'bg-amber-400';
  if (nps < 70) return 'bg-lime-400';
  return 'bg-emerald-400';
}

export function npsGaugePercent(nps) {
  return ((nps + 100) / 200) * 100;
}

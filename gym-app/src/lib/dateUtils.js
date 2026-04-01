// ── Shared Date / Time Formatting Utilities ─────────────────────────────────

/**
 * Format seconds as MM:SS (zero-padded).
 * Used for timers (rest timer, session elapsed).
 */
export const formatTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Format seconds as a human-readable duration string (e.g. "1h 23m", "45m", "30s").
 * Includes seconds granularity when duration is short.
 */
export const formatDurationLong = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec > 0 ? `${sec}s` : ''}`.trim();
  return `${sec}s`;
};

/**
 * Format seconds as a compact duration string (e.g. "1h 23m", "45m").
 * No seconds granularity — suited for summaries and reports.
 */
export const fmtDuration = (seconds) => {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Relative time from an ISO date string, day-level granularity.
 * Returns: 'Today', 'Yesterday', '3d ago', '2w ago', '1mo ago'.
 * Returns 'Never' for falsy input.
 */
export const timeAgo = (iso) => {
  try {
    const i18n = require('i18next').default;
    const t = (key, def) => i18n?.t?.(`common:timeAgo.${key}`, def) || def;
    if (!iso) return t('never', 'Never');
    const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (d === 0) return t('today', 'Today');
    if (d === 1) return t('yesterday', 'Yesterday');
    if (d < 7)  return t('daysAgo', { defaultValue: '{{d}}d ago', d });
    if (d < 30) return t('weeksAgo', { defaultValue: '{{w}}w ago', w: Math.floor(d / 7) });
    return t('monthsAgo', { defaultValue: '{{m}}mo ago', m: Math.floor(d / 30) });
  } catch {
    if (!iso) return 'Never';
    const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d < 7)  return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }
};

/**
 * Relative time from an ISO date string, minute-level granularity.
 * Returns: 'just now', '5m ago', '3h ago', '2d ago', or a formatted date.
 * Best for social feeds / activity timelines.
 */
export const timeAgoFine = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

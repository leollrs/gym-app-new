/**
 * Color-coded session status pill (trainer calendar / detail).
 *   scheduled = slate
 *   confirmed = emerald (light) / accent (depending on app)
 *   completed = blue
 *   no_show   = rose
 *   cancelled = zinc
 *
 * Theme-aware via inline style + color-mix(). Works in dark + light.
 */

import { useTranslation } from 'react-i18next';

const STATUS_TOKENS = {
  scheduled: { color: 'var(--color-text-muted)', tint: 'var(--color-bg-elevated)' },
  confirmed: { color: '#10B981', tint: 'rgba(16,185,129,0.15)' },
  completed: { color: 'var(--color-blue, #3B82F6)', tint: 'color-mix(in srgb, var(--color-blue, #3B82F6) 15%, transparent)' },
  no_show:   { color: '#F43F5E', tint: 'rgba(244,63,94,0.15)' },
  cancelled: { color: 'var(--color-text-faint)', tint: 'var(--color-bg-subtle)' },
};

const STATUS_DEFAULTS = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export default function TrainerSessionPill({ status, label, size = 'sm' }) {
  const { t } = useTranslation(['pages']);
  const tok = STATUS_TOKENS[status] || STATUS_TOKENS.scheduled;
  const text = label || t(`trainerCalendar.status.${status}`, STATUS_DEFAULTS[status] || status);
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const fontSize = size === 'sm' ? '10px' : '11px';

  return (
    <span
      className={`inline-flex items-center gap-1 ${padding} rounded-full font-bold uppercase tracking-wider whitespace-nowrap`}
      style={{ background: tok.tint, color: tok.color, fontSize, letterSpacing: '0.06em' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: 'currentColor' }}
      />
      {text}
    </span>
  );
}

export { STATUS_TOKENS as TRAINER_STATUS_TOKENS };

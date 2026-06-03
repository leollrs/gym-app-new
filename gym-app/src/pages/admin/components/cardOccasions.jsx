// Shared occasion metadata + tonal styling for the Tarjetas Impresas
// (print cards) admin page. Both UpcomingCardsPanel (hero grid) and
// CardsToPrintPanel (queue) read from here so the occasion → icon → color
// language stays identical across "upcoming", "to print", "to deliver".
//
// Tones map onto the admin design-system semantic tokens (success / warning /
// coach / accent) rather than hardcoded hex, so the page tracks the gym's
// brand accent and the light/dark admin theme automatically.

import {
  PartyPopper, Sparkles, Calendar, Award, ArrowLeftRight, Cake, Gift,
} from 'lucide-react';

const DISPLAY_FONT = "var(--admin-font-display, 'Archivo', 'Barlow', sans-serif)";

// occasion → { Icon, tone }. Legacy occasions (milestone_25, first_pr) stay
// mapped so pre-v2 cards still render an icon during the cutover.
export const OCCASION_META = {
  welcome:       { Icon: PartyPopper,    tone: 'teal'    },
  habit_9in6:    { Icon: Sparkles,       tone: 'good'    },
  tenure_30:     { Icon: Calendar,       tone: 'coach'   },
  tenure_90:     { Icon: Calendar,       tone: 'warn'    },
  tenure_365:    { Icon: Calendar,       tone: 'coach'   },
  milestone_100: { Icon: Award,          tone: 'warn'    },
  milestone_250: { Icon: Award,          tone: 'warn'    },
  milestone_500: { Icon: Award,          tone: 'warn'    },
  returning:     { Icon: ArrowLeftRight, tone: 'good'    },
  birthday:      { Icon: Cake,           tone: 'coach'   },
  custom:        { Icon: Gift,           tone: 'neutral' },
  milestone_25:  { Icon: Award,          tone: 'warn'    },
  first_pr:      { Icon: Sparkles,       tone: 'warn'    },
};

export function occasionMeta(occasion) {
  return OCCASION_META[occasion] || { Icon: Gift, tone: 'neutral' };
}

// tone → soft background + ink text (admin semantic tokens).
export const TONE_STYLE = {
  teal:    { soft: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', ink: 'var(--color-accent)' },
  good:    { soft: 'var(--color-success-soft)', ink: 'var(--color-success-ink)' },
  warn:    { soft: 'var(--color-warning-soft)', ink: 'var(--color-warning-ink)' },
  coach:   { soft: 'var(--color-coach-soft)',   ink: 'var(--color-coach-ink)' },
  neutral: { soft: 'var(--color-admin-panel)',  ink: 'var(--color-admin-text-sub)' },
};

export function toneStyle(tone) {
  return TONE_STYLE[tone] || TONE_STYLE.neutral;
}

/**
 * Occasion-tinted member avatar — photo when available, otherwise the initial
 * on a soft tonal disc keyed to the occasion (so a wall of cards reads as a
 * spread of milestones at a glance).
 */
export function CardAvatar({ name, src, tone = 'neutral', size = 34 }) {
  const s = toneStyle(tone);
  if (src) {
    return (
      <img
        src={src}
        alt={name || ''}
        style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 999, flexShrink: 0,
        background: s.soft, color: s.ink,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: DISPLAY_FONT, fontWeight: 700,
        fontSize: Math.round(size * 0.42), letterSpacing: -0.3,
      }}
    >
      {initial}
    </div>
  );
}

/**
 * Small uppercase occasion pill — icon + localized label on a soft tonal chip.
 * `label` is passed in already-translated so this stays i18n-agnostic.
 */
export function OccasionPill({ occasion, label, style }) {
  const { Icon, tone } = occasionMeta(occasion);
  const s = toneStyle(tone);
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 999,
        background: s.soft, color: s.ink,
        fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase',
        whiteSpace: 'nowrap', flexShrink: 0,
        ...style,
      }}
    >
      <Icon size={10} />
      {label}
    </span>
  );
}

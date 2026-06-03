import { Users, BarChart3, Activity, Megaphone, Bell, Pencil } from 'lucide-react';

/**
 * Shared template-kind → icon + tone taxonomy for the "Plantillas de Email"
 * restyle (gallery cards + editor type picker).
 *
 * Each `template.type` maps to a line icon and a semantic tone. Tones resolve to
 * the admin theme's EXISTING CSS variables, so every colour is dark-mode-safe and
 * white-label-aware out of the box:
 *   teal    → the gym's brand accent (--color-accent)
 *   coach   → --color-coach     warn → --color-warning
 *   hot     → --color-danger    good → --color-success
 *   neutral → admin panel surface
 *
 * (Mirrors the design mock's KINDS/TONE maps, but pointed at real tokens.)
 */
export const KIND_META = {
  welcome:       { Icon: Users,     tone: 'teal'    },
  digest:        { Icon: BarChart3, tone: 'coach'   },
  winback:       { Icon: Activity,  tone: 'warn'    },
  announcement:  { Icon: Megaphone, tone: 'hot'     },
  classReminder: { Icon: Bell,      tone: 'coach'   },
  custom:        { Icon: Pencil,    tone: 'neutral' },
};

export function kindMeta(type) {
  return KIND_META[type] || KIND_META.custom;
}

/** tone → { bg (soft fill), fg (icon), ink (text) } using theme tokens. */
export function toneStyles(tone) {
  switch (tone) {
    case 'teal':
      return {
        bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
        fg: 'var(--color-accent)',
        ink: 'var(--color-accent)',
      };
    case 'coach':
      return { bg: 'var(--color-coach-soft)', fg: 'var(--color-coach)', ink: 'var(--color-coach-ink)' };
    case 'warn':
      return { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)', ink: 'var(--color-warning-ink)' };
    case 'hot':
      return { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)', ink: 'var(--color-danger-ink)' };
    case 'good':
      return { bg: 'var(--color-success-soft)', fg: 'var(--color-success)', ink: 'var(--color-success-ink)' };
    case 'info':
      // No --color-info-ink token exists; the saturated blue reads fine as text.
      return { bg: 'var(--color-info-soft)', fg: 'var(--color-info)', ink: 'var(--color-info)' };
    default:
      return { bg: 'var(--color-admin-panel)', fg: 'var(--color-admin-text-sub)', ink: 'var(--color-admin-text-sub)' };
  }
}

/** Generic tinted icon chip — explicit icon + tone (the design's IconChip). */
export function ToneIconChip({ icon: Icon, tone = 'neutral', size = 40, radius = 11 }) {
  const c = toneStyles(tone);
  return (
    <div
      style={{ width: size, height: size, borderRadius: radius, background: c.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} style={{ color: c.fg }} />
    </div>
  );
}

/** Tinted icon chip keyed off a template type. */
export function KindIconChip({ type, size = 40, radius = 11 }) {
  const { Icon, tone } = kindMeta(type);
  return <ToneIconChip icon={Icon} tone={tone} size={size} radius={radius} />;
}

/** Tinted kind pill; label comes from i18n (admin.emailTemplates.types.<type>). */
export function KindPill({ type, t }) {
  const { tone } = kindMeta(type);
  const c = toneStyles(tone);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: c.ink, background: c.bg, padding: '3px 9px', borderRadius: 999, letterSpacing: 0.1 }}
    >
      {t(`admin.emailTemplates.types.${type}`)}
    </span>
  );
}

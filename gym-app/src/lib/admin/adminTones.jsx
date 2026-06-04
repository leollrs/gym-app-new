/**
 * Shared "tone" system for the admin Restyle design language — one source of truth
 * so pages stop re-defining it. Maps a semantic tone → the admin theme's existing
 * CSS variables (dark-mode + white-label safe; nothing hardcoded), plus the tinted
 * icon chip and uppercase status pill built on top.
 *
 * tones: teal (gym brand accent) · coach · warn · hot · good · info · neutral.
 */
export function toneStyles(tone) {
  switch (tone) {
    case 'teal':
      return { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', fg: 'var(--color-accent)', ink: 'var(--color-accent)' };
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

/** Rounded tinted icon chip — explicit icon + tone. */
export function ToneIconChip({ icon: Icon, tone = 'neutral', size = 40, radius = 12, iconScale = 0.5 }) {
  const c = toneStyles(tone);
  return (
    <div className="grid place-items-center flex-shrink-0" style={{ width: size, height: size, borderRadius: radius, background: c.bg }}>
      <Icon size={Math.round(size * iconScale)} strokeWidth={2} style={{ color: c.fg }} />
    </div>
  );
}

/** Uppercase status pill, optional leading icon (icon inherits the pill's ink color). */
export function TonePill({ children, tone = 'neutral', icon: Icon }) {
  const c = toneStyles(tone);
  return (
    <span className="inline-flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: 800, color: c.ink, background: c.bg, padding: '3px 9px', borderRadius: 999, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

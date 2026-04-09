/**
 * Shared Toggle switch for admin pages.
 *
 * Props:
 *   checked  – boolean, current state (aliases: value, enabled)
 *   onChange  – (newValue: boolean) => void
 *   label    – accessible label (alias: ariaLabel)
 *   disabled – disables interaction
 *   size     – 'sm' (default) | 'md'
 */
export default function Toggle({
  checked,
  value,
  enabled,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  size = 'sm',
}) {
  const on = checked ?? value ?? enabled ?? false;
  const accessibleLabel = label ?? ariaLabel;

  const isMd = size === 'md' || size === 'lg';
  const trackClass = isMd ? 'w-12 h-7' : 'w-9 h-5';
  const knobClass  = isMd ? 'w-5 h-5'  : 'w-4 h-4';
  const offLeft    = isMd ? '3px'       : '2px';
  const onLeft     = isMd ? 'calc(100% - 23px)' : 'calc(100% - 18px)';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={accessibleLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className={`${trackClass} rounded-full relative flex-shrink-0 transition-colors focus:ring-2 focus:ring-[var(--color-accent)]/40 focus:outline-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ backgroundColor: on ? 'var(--color-accent, #D4AF37)' : '#6B7280' }}
    >
      <span
        className={`absolute top-0.5 ${knobClass} rounded-full bg-white shadow transition-transform`}
        style={{ left: on ? onLeft : offLeft }}
      />
    </button>
  );
}

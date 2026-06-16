/**
 * Pill-tab filter bar for admin list pages.
 */

export default function FilterBar({ options, active, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => {
        const on = active === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            aria-label={`Filter by ${opt.label}`}
            aria-pressed={on}
            className="px-3 py-2 rounded-xl text-[12px] font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            style={{
              background: on ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'var(--color-admin-panel)',
              color: on ? 'var(--color-accent)' : 'var(--color-admin-text-muted)',
              border: `1px solid ${on ? 'color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'var(--color-admin-border)'}`,
            }}
          >
            {opt.label}
            {opt.count != null && ` (${opt.count})`}
          </button>
        );
      })}
    </div>
  );
}

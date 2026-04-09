export default function PageHeader({ title, subtitle, accentLabel, children }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur-2xl border-b border-white/6" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)' }}>
      <div className="max-w-[720px] md:max-w-5xl mx-auto px-4 md:px-6 pt-3 pb-3">
        {accentLabel && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
            {accentLabel}
          </p>
        )}
        <h1
          className="text-[18px] font-black tracking-tight truncate"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{subtitle}</p>
        )}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}

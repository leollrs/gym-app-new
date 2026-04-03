export default function ChartTooltip({ active, payload, label, formatter, nameLabel }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle,rgba(255,255,255,0.08))] rounded-2xl px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-sm text-[12px] min-w-[120px]">
      {label && <p className="text-[var(--color-text-muted)] text-[10px] font-medium uppercase tracking-wider mb-1.5 opacity-70">{label}</p>}
      {payload.map((entry, i) => (
        <p key={entry.dataKey || entry.name || i} className="font-semibold leading-snug" style={{ color: entry.color || 'var(--color-accent)' }}>
          {nameLabel || entry.name}: {formatter ? formatter(entry.value) : entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

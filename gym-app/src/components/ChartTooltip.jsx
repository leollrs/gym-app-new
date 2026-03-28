export default function ChartTooltip({ active, payload, label, formatter, nameLabel }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[var(--color-bg-card)] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
      {label && <p className="text-[var(--color-text-muted)] text-[11px] mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="font-semibold" style={{ color: entry.color || 'var(--color-accent)' }}>
          {nameLabel || entry.name}: {formatter ? formatter(entry.value) : entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

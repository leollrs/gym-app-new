export default function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
      {label && <p className="text-[#6B7280] text-[11px] mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="font-semibold" style={{ color: entry.color || '#D4AF37' }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

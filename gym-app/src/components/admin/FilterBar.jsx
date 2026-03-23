/**
 * Pill-tab filter bar for admin list pages.
 */

export default function FilterBar({ options, active, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
            active === opt.key
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'
          }`}
        >
          {opt.label}
          {opt.count != null && ` (${opt.count})`}
        </button>
      ))}
    </div>
  );
}

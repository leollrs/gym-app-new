/**
 * Section heading label — the consistent 11px uppercase pattern.
 */

export default function SectionLabel({ icon: Icon, children, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {Icon && <Icon size={14} className="text-[#9CA3AF]" />}
      <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em]">
        {children}
      </p>
    </div>
  );
}

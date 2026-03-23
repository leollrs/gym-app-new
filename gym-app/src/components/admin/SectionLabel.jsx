/**
 * Section heading label — the consistent 11px uppercase pattern.
 */

export default function SectionLabel({ icon: Icon, children, className = '' }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {Icon && <Icon size={12} className="text-[#6B7280]" />}
      <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
        {children}
      </p>
    </div>
  );
}

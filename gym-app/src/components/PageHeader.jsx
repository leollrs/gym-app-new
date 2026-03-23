export default function PageHeader({ title, subtitle, children }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[#05070B]/95 border-b border-white/6">
      <div className="max-w-[720px] md:max-w-5xl mx-auto px-4 md:px-6 pt-3 pb-3">
        <h1
          className="text-[22px] font-black text-[#E5E7EB] tracking-tight"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] text-[#6B7280] mt-0.5">{subtitle}</p>
        )}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}

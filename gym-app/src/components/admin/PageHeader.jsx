/**
 * Page header with title, subtitle, and optional action buttons.
 */

export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 ${className}`}>
      <div className="min-w-0 flex-1">
        <h1 className="text-[24px] md:text-[28px] leading-tight font-bold text-[#E5E7EB] truncate">{title}</h1>
        {subtitle && <p className="text-[14px] text-[#9CA3AF] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>}
    </div>
  );
}

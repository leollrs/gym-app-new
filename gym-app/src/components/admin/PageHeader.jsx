/**
 * Page header with title, subtitle, and optional action buttons.
 */

export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}>
      <div>
        <h1 className="text-[18px] font-bold text-[#E5E7EB]">{title}</h1>
        {subtitle && <p className="text-[13px] text-[#6B7280] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

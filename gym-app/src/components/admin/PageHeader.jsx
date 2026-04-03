/**
 * Page header with title, subtitle, and optional action buttons.
 */

export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <h1 className="admin-page-title text-[26px] md:text-[30px] truncate">{title}</h1>
        {subtitle && <p className="text-[14px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5 flex-wrap flex-shrink-0 self-end lg:self-auto">{actions}</div>}
    </div>
  );
}

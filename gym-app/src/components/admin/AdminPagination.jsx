import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Windowed page-number list: 1 … (cur-1) cur (cur+1) … N, collapsing long runs.
// Mirrors AdminMembers.getPageWindow so every paginated table looks identical.
function getPageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push('ellipsis-l');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('ellipsis-r');
  out.push(total);
  return out;
}

/**
 * Shared admin pagination — the canonical "Miembros" style:
 *   "X–Y of Z"   [‹] [1] [2] … [N] [›]
 *
 * Props:
 *   - page         1-based current page
 *   - pageSize     items per page
 *   - total        total item count (across all pages)
 *   - onPageChange (n) => void  — called with the new 1-based page
 *   - colors       optional palette override for non-CSS-var contexts
 *                  (e.g. the fixed-dark platform pages). Defaults to the
 *                  admin theme CSS variables.
 *   - className    extra classes on the wrapper
 *
 * Renders nothing when there is only one page.
 */
export default function AdminPagination({ page, pageSize, total, onPageChange, colors = {}, className = '' }) {
  const { t } = useTranslation('pages');
  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)));
  if (totalPages <= 1) return null;

  const c = {
    border: 'var(--color-border-subtle)',
    muted: 'var(--color-text-muted)',
    secondary: 'var(--color-text-secondary)',
    faint: 'var(--color-text-faint)',
    accent: 'var(--color-accent)',
    onAccent: 'var(--color-text-on-accent, #fff)',
    ...colors,
  };

  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const from = total === 0 ? 0 : startIdx + 1;
  const to = Math.min(startIdx + pageSize, total);

  return (
    <div
      className={`flex items-center justify-between gap-3 flex-wrap mt-4 pt-3 ${className}`}
      style={{ borderTop: `1px solid ${c.border}` }}
    >
      <span className="text-[12px] tabular-nums" style={{ color: c.muted }}>
        {t('admin.members.showingRange', { from, to, total, defaultValue: '{{from}}–{{to}} of {{total}}' })}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage === 1}
          aria-label={t('admin.members.pagePrev', 'Previous page')}
          className="w-8 h-8 flex items-center justify-center rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
          style={{ border: `1px solid ${c.border}`, color: c.muted }}
        >
          <ChevronLeft size={15} />
        </button>
        {getPageWindow(safePage, totalPages).map((n) =>
          typeof n === 'string' ? (
            <span key={n} className="w-7 h-8 flex items-center justify-center text-[12px]" style={{ color: c.faint }}>
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => onPageChange(n)}
              aria-current={n === safePage ? 'page' : undefined}
              className="min-w-[32px] h-8 px-2 flex items-center justify-center rounded-lg text-[12px] font-semibold transition-colors"
              style={
                n === safePage
                  ? { backgroundColor: c.accent, color: c.onAccent, border: `1px solid ${c.accent}` }
                  : { border: `1px solid ${c.border}`, color: c.secondary }
              }
            >
              {n}
            </button>
          ),
        )}
        <button
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          disabled={safePage === totalPages}
          aria-label={t('admin.members.pageNext', 'Next page')}
          className="w-8 h-8 flex items-center justify-center rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
          style={{ border: `1px solid ${c.border}`, color: c.muted }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

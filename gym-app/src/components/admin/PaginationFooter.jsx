import { useTranslation } from 'react-i18next';

/**
 * Standard "Showing X of Y" + Load more / Collapse footer used by paginated
 * admin lists. Pair with the `usePagedVisible` hook — pass the hook return
 * value as `pager` plus the total count.
 *
 * Renders nothing when `total <= pager.visibleCount && total <= initial`
 * (i.e. there's no point in showing controls when everything fits).
 */
export default function PaginationFooter({ pager, total, className = '' }) {
  const { t } = useTranslation('pages');
  // Hide entirely if there's nothing past the initial view.
  if (total <= pager.visibleCount && !pager.isCollapsible(total)) return null;
  const canMore = pager.canLoadMore(total);
  const collapsible = pager.isCollapsible(total);
  if (!canMore && !collapsible) return null;

  return (
    <div
      className={`mt-4 pt-3 flex items-center justify-between gap-3 flex-wrap ${className}`}
      style={{ borderTop: '1px solid var(--color-admin-border)' }}
    >
      <span className="text-[12px] tabular-nums" style={{ color: 'var(--color-admin-text-muted)' }}>
        {t('admin.common.showingCount', {
          shown: Math.min(pager.visibleCount, total),
          total,
          defaultValue: 'Showing {{shown}} of {{total}}',
        })}
      </span>
      {canMore ? (
        <button
          onClick={pager.loadMore}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
            color: 'var(--color-accent)',
          }}
        >
          {t('admin.common.loadMore', {
            count: pager.nextStepSize(total),
            defaultValue: 'Load {{count}} more',
          })}
        </button>
      ) : (
        <button
          onClick={pager.collapse}
          className="text-[12px] font-semibold transition-colors"
          style={{ color: 'var(--color-admin-text-muted)' }}
        >
          {t('admin.common.collapse', 'Collapse')}
        </button>
      )}
    </div>
  );
}

/**
 * Shared table component for admin list pages.
 * Supports sortable columns, skeleton loading, empty state, and row hover.
 *
 * Column options:
 *   - key, label, sortable, sortValue, render, width
 *   - headerClassName, className  — extra Tailwind classes
 *   - numeric: true               — right-align + tabular-nums
 */
import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { TableSkeleton } from './Skeleton';

export default function AdminTable({
  columns,
  data,
  loading = false,
  emptyState,
  onRowClick,
  activeRowId,
  keyField = 'id',
  stickyHeader = false,
  skeletonRows = 5,
  sort: sortProp,
  onSortChange,
  fixedLayout = false,
}) {
  const [internalSort, setInternalSort] = useState({ key: null, dir: 'asc' });
  // Controlled-sort mode: when the parent passes `onSortChange`, it owns the
  // sort state and sorts the FULL dataset itself (e.g. so it can sort-then-
  // paginate). We then render `data` as-is and only surface the indicator +
  // forward header clicks. Uncontrolled (no onSortChange) keeps the original
  // self-sorting behavior so existing callers are unaffected.
  const controlled = typeof onSortChange === 'function';
  const sort = controlled ? (sortProp || { key: null, dir: 'asc' }) : internalSort;

  const handleSort = (key) => {
    if (!key) return;
    if (controlled) { onSortChange(key); return; }
    setInternalSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const sortedData = (() => {
    if (controlled) return data || [];
    if (!sort.key || !data?.length) return data || [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortable) return data;
    return [...data].sort((a, b) => {
      const aVal = col.sortValue ? col.sortValue(a) : a[sort.key];
      const bVal = col.sortValue ? col.sortValue(b) : b[sort.key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  })();

  if (loading) return <TableSkeleton rows={skeletonRows} />;

  if (!data?.length && emptyState) {
    return (
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-8">
        {emptyState}
      </div>
    );
  }

  const isActive = (row) => activeRowId != null && row[keyField] === activeRowId;

  return (
    <div className="bg-[#0F172A] border border-white/[0.06] rounded-[14px] overflow-hidden">
      <div className={`overflow-x-auto ${stickyHeader ? 'max-h-[600px] overflow-y-auto' : ''}`}>
        <table className="w-full border-collapse" style={fixedLayout ? { tableLayout: 'fixed' } : undefined}>

          {/* ── Header ──────────────────────────────────────────────── */}
          <thead>
            <tr
              className={`border-b border-white/8 ${
                stickyHeader
                  ? 'sticky top-0 z-10'
                  : ''
              }`}
              style={{
                backgroundColor: 'var(--color-bg-elevated)',
              }}
            >
              {columns.map((col) => {
                const isSorted = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={[
                      fixedLayout ? 'px-3 py-3.5' : 'px-5 py-3.5',
                      'text-[11px] font-bold uppercase tracking-[0.06em]',
                      fixedLayout ? 'align-bottom' : 'whitespace-nowrap',
                      'transition-colors duration-200',
                      isSorted ? 'text-[#E5E7EB]' : 'text-[#6B7280]',
                      col.sortable
                        ? 'cursor-pointer select-none hover:text-[#E5E7EB]'
                        : '',
                      col.align === 'center' ? 'text-center' : col.numeric ? 'text-right' : 'text-left',
                      col.headerClassName || '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div
                      className={`flex items-center gap-1.5 ${
                        col.align === 'center' ? 'justify-center' : col.numeric ? 'justify-end' : ''
                      }`}
                    >
                      {col.label}
                      {col.sortable && isSorted && (
                        <span className="inline-flex opacity-90">
                          {sort.dir === 'asc' ? (
                            <ChevronUp size={13} className="text-[#D4AF37]" />
                          ) : (
                            <ChevronDown size={13} className="text-[#D4AF37]" />
                          )}
                        </span>
                      )}
                      {col.sortable && !isSorted && (
                        <span className="inline-flex opacity-0 group-hover/th:opacity-40 transition-opacity duration-200">
                          <ChevronDown size={13} className="text-[#6B7280]" />
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* ── Body ────────────────────────────────────────────────── */}
          <tbody>
            {sortedData.map((row, i) => {
              const active = isActive(row);
              return (
                <tr
                  key={row[keyField] || i}
                  className={[
                    /* Divider — very subtle, last row none */
                    'border-b border-white/[0.06] last:border-b-0',
                    /* Smooth transition for bg, shadow, border */
                    'transition-all duration-[250ms] ease-[cubic-bezier(.4,0,.2,1)]',
                    /* ── Active / selected row ── */
                    active
                      ? 'border-l-2 border-l-[#D4AF37]'
                      : 'border-l-2 border-l-transparent',
                    /* ── Clickable rows ── */
                    onRowClick && !active ? 'cursor-pointer' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={
                    active
                      ? {
                          backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 7%, var(--color-bg-card, #141B2E))',
                        }
                      : undefined
                  }
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor =
                        'var(--color-bg-elevated, #101828)';
                      e.currentTarget.style.boxShadow =
                        '0 1px 4px rgba(0,0,0,0.08)';
                      if (onRowClick) {
                        e.currentTarget.style.borderLeftColor =
                          'color-mix(in srgb, var(--color-accent, #D4AF37) 35%, transparent)';
                      }
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = '';
                      e.currentTarget.style.boxShadow = '';
                      e.currentTarget.style.borderLeftColor = 'transparent';
                    }
                  }}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        fixedLayout ? 'px-3 py-3.5 text-[13px] leading-relaxed align-middle' : 'px-5 py-3.5 text-[13px] leading-relaxed',
                        col.align === 'center'
                          ? 'text-center'
                          : col.numeric
                          ? 'text-right tabular-nums font-medium'
                          : '',
                        col.className || 'text-[#E5E7EB]',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

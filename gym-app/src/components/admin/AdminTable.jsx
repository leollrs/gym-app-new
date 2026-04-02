/**
 * Shared table component for admin list pages.
 * Supports sortable columns, skeleton loading, empty state, and row hover.
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
}) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' });

  const handleSort = (key) => {
    if (!key) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const sortedData = (() => {
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

  return (
    <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
      <div className={`overflow-x-auto ${stickyHeader ? 'max-h-[600px] overflow-y-auto' : ''}`}>
        <table className="w-full">
          <thead>
            <tr className={`border-b border-white/6 ${stickyHeader ? 'sticky top-0 bg-[#0F172A] z-10' : ''}`}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left px-4 py-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider ${
                    col.sortable ? 'cursor-pointer select-none hover:text-[#9CA3AF] transition-colors' : ''
                  } ${col.headerClassName || ''}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sort.key === col.key && (
                      sort.dir === 'asc'
                        ? <ChevronUp size={12} className="text-[#D4AF37]" />
                        : <ChevronDown size={12} className="text-[#D4AF37]" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, i) => (
              <tr
                key={row[keyField] || i}
                className={`border-b border-white/4 last:border-0 transition-colors ${
                  activeRowId != null && row[keyField] === activeRowId
                    ? 'bg-[#D4AF37]/[0.07] border-l-2 border-l-[#D4AF37]'
                    : onRowClick
                      ? 'cursor-pointer hover:bg-[#111827] hover:border-l-2 hover:border-l-[#D4AF37]/40'
                      : 'hover:bg-white/[0.02]'
                }`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-[13px] ${col.className || 'text-[#E5E7EB]'}`}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

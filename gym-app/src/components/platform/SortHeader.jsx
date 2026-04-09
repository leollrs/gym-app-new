import { ArrowUpDown } from 'lucide-react';

/**
 * Sortable table header cell for platform tables.
 *
 * Props:
 *   label     — column header text
 *   field     — sort key identifier
 *   sortKey   — currently active sort field
 *   sortDir   — current sort direction ('asc' | 'desc')
 *   onSort    — callback: (field) => void
 *   className — optional extra classes
 */
const SortHeader = ({ label, field, sortKey, sortDir, onSort, className = '' }) => (
  <th
    className={`text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none hover:text-[#9CA3AF] transition-colors ${className}`}
    onClick={() => onSort(field)}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      <ArrowUpDown className="w-3 h-3 opacity-40" />
      {sortKey === field && (
        <span className="text-[#D4AF37] text-[9px]">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
      )}
    </span>
  </th>
);

export default SortHeader;

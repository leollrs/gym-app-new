/**
 * CSV Export Utility
 *
 * Accepts an array of objects + column config and triggers a browser download.
 *
 * Usage:
 *   exportCSV({
 *     filename: 'members-export',
 *     columns: [
 *       { key: 'full_name', label: 'Name' },
 *       { key: 'score',     label: 'Churn Score', format: v => `${v}%` },
 *     ],
 *     data: membersArray,
 *   });
 */

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCSV({ filename, columns, data }) {
  if (!data?.length) return;

  const header = columns.map(c => escapeCSV(c.label)).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      let val = row[col.key];
      if (col.format) val = col.format(val, row);
      return escapeCSV(val);
    }).join(',')
  );

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

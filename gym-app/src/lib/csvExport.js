/**
 * CSV Export Utility
 *
 * Works in both browser and Capacitor native (iOS/Android).
 * On native: writes to device cache directory and opens share sheet.
 * On web: triggers a standard browser download.
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

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Cells that begin with `=`, `+`, `-`, `@`, tab, or carriage return are interpreted
// as formulas by Excel/Sheets/LibreOffice. Prefix with a single quote to neutralize.
// Reference: OWASP "CSV Injection".
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function escapeCSV(value) {
  if (value == null) return '';
  let str = String(value);
  if (FORMULA_PREFIX_RE.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Download a CSV string as a file. Works on native + web.
 */
export async function downloadCSVString(filename, csvContent) {
  if (Capacitor.isNativePlatform()) {
    try {
      const fname = filename.endsWith('.csv') ? filename : `${filename}.csv`;
      const result = await Filesystem.writeFile({
        path: fname,
        data: btoa(unescape(encodeURIComponent(csvContent))),
        directory: Directory.Cache,
      });
      await Share.share({
        title: fname,
        url: result.uri,
      });
    } catch (e) {
      console.error('Native CSV export failed:', e);
    }
  } else {
    // Browser fallback
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export async function exportCSV({ filename, columns, data }) {
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
  const fname = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  await downloadCSVString(fname, csv);
}

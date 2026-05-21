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

import { saveBlob } from './saveBlob';

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
 * Download a CSV string as a file. Works on native + web via the shared
 * saveBlob helper (which handles Capacitor Filesystem+Share on native and
 * a defer-revoke blob+anchor pattern on web — earlier code revoked the
 * object URL too fast, which sometimes produced files with garbled names).
 */
export async function downloadCSVString(filename, csvContent) {
  const fname = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  // Prepend a UTF-8 BOM so Excel opens the file with the right encoding
  // (otherwise accented characters render as mojibake on Windows Excel).
  const blob = new Blob(['﻿', csvContent], { type: 'text/csv;charset=utf-8' });
  await saveBlob(fname, blob);
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

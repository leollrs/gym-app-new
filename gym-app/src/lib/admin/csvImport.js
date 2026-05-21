/**
 * Tight CSV parser + row validator for the gym onboarding bulk import.
 *
 * The user hand-cleans CSVs before upload (so we're not in column-mapping
 * territory), but we still need to handle:
 *   - UTF-8 with optional BOM
 *   - Quoted fields with embedded commas, quotes ("foo, ""bar"""), newlines
 *   - CRLF and LF line endings
 *   - Trimming, empty rows
 *
 * Not designed for the full RFC 4180 surface — strict cases like nested
 * Excel-style escape patterns aren't expected from a pre-cleaned file.
 * The user's instructions: hand off a CSV with the canonical column set,
 * known encoding (UTF-8), and known delimiter (comma). This parser exists
 * to turn that into typed row objects + run the same validation rules the
 * server RPC uses, so the preview table can show per-row status before
 * commit.
 */

// Canonical column set. Order doesn't matter; lookup by name.
export const CANONICAL_COLUMNS = [
  'full_name',
  'status',
  'phone',
  'email',
  'join_date',
  'cancellation_date',
  'plan_name',
  'birthday',
  'external_id',
];

// Required column names that MUST be present in the CSV header.
export const REQUIRED_COLUMNS = ['full_name', 'status', 'join_date'];

/**
 * Parse a CSV string into a list of row objects keyed by header name.
 * Returns { headers, rows, errors } — errors is for upload-level problems
 * (missing header columns, malformed file). Per-row validation lives in
 * validateImportRow below.
 */
export function parseCSV(text) {
  if (typeof text !== 'string') {
    return { headers: [], rows: [], errors: [{ kind: 'invalid_input' }] };
  }

  // Strip UTF-8 BOM if present so the first header doesn't get prefixed
  // with the invisible ﻿ byte and silently mismatch our canonical
  // column names.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Normalize line endings.
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const records = splitCSVRecords(text);
  if (records.length === 0) {
    return { headers: [], rows: [], errors: [{ kind: 'empty' }] };
  }

  const headers = records[0].map((h) => h.trim().toLowerCase());
  const errors = [];

  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      errors.push({ kind: 'missing_required_column', column: col });
    }
  }

  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i];
    if (fields.length === 1 && fields[0].trim() === '') continue; // blank line
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (fields[idx] ?? '').trim();
    });
    rows.push(obj);
  }

  return { headers, rows, errors };
}

/**
 * Splits a CSV body into an array of record arrays. Handles quoted fields,
 * embedded commas, embedded quotes (escaped as ""), and embedded newlines.
 */
function splitCSVRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside a quoted field
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  // Tail flush
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

/**
 * Validate a parsed row against the same rules the server RPC enforces.
 * Returns null if the row is OK to import, or { reason, detail } otherwise.
 * Mirrors bulk_import_members in 0422 so the preview table doesn't lie.
 */
export function validateImportRow(row) {
  const fullName = (row.full_name || '').trim();
  const status = (row.status || '').trim().toLowerCase();
  const phone = (row.phone || '').trim();
  const joinDate = (row.join_date || '').trim();

  if (!fullName) return { reason: 'missing_full_name' };
  if (status !== 'active' && status !== 'archived') {
    return { reason: 'invalid_status', detail: status || '(empty)' };
  }
  if (!joinDate || !/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) {
    return { reason: 'missing_or_invalid_join_date', detail: joinDate || '(empty)' };
  }
  if (status === 'active' && !phone) {
    return { reason: 'active_requires_phone' };
  }
  return null;
}

/**
 * Bucket parsed rows into import-ready / skipped, with summary counts and
 * the original row index attached so the preview table can show row N's
 * reason for being skipped.
 */
export function bucketRows(rows) {
  const ready = [];
  const skipped = [];
  rows.forEach((row, i) => {
    const err = validateImportRow(row);
    if (err) {
      skipped.push({ row, index: i + 2, ...err }); // +2 = +1 header, +1 1-based
    } else {
      ready.push({ row, index: i + 2 });
    }
  });

  const activeCount = ready.filter(r => r.row.status?.toLowerCase() === 'active').length;
  const archivedCount = ready.filter(r => r.row.status?.toLowerCase() === 'archived').length;

  return {
    ready,
    skipped,
    summary: {
      total: rows.length,
      activeCount,
      archivedCount,
      skippedCount: skipped.length,
    },
  };
}

import { useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X,
  Loader2, Download, Microscope, RotateCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { selectInBatches } from '../../lib/churn/batchedSelect';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { logAdminAction } from '../../lib/adminAudit';
import FadeIn from '../../components/platform/FadeIn';
import {
  parseCSV, bucketRows, CANONICAL_COLUMNS, REQUIRED_COLUMNS,
} from '../../lib/admin/csvImport';

// ── Skip-reason → human label ──────────────────────────────────
// Mirrors the reasons that bulk_import_members RPC emits + the client-side
// validateImportRow checks. Kept inline (not i18n) for the super-admin
// surface since this UI is operator-facing and bilingual would just clutter.
const SKIP_REASON_LABEL = {
  missing_full_name:            'Missing full_name',
  invalid_status:               'status must be "active" or "archived"',
  missing_or_invalid_join_date: 'Missing or invalid join_date (YYYY-MM-DD)',
  active_requires_phone:        'Active members require phone',
  duplicate_phone_or_email:     'Duplicate of an existing live member',
};

export default function GymImport() {
  const { gymId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const fileInputRef = useRef(null);

  const [phase, setPhase] = useState('upload'); // 'upload' | 'preview' | 'result'
  const [filename, setFilename] = useState('');
  const [label, setLabel] = useState('');
  const [parseResult, setParseResult] = useState(null); // { headers, rows, errors }
  const [bucketed, setBucketed] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [importResult, setImportResult] = useState(null);

  // Gym name lookup so the page header is contextual.
  const { data: gym } = useQuery({
    queryKey: ['platform-gym-name', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gyms')
        .select('id, name, slug')
        .eq('id', gymId)
        .single();
      return data;
    },
    enabled: !!gymId,
  });

  // Past batches for this gym — surfaces "yes you've already imported once,
  // here's what happened" so the operator doesn't double-import by accident.
  const { data: pastBatches = [] } = useQuery({
    queryKey: ['platform-gym-batches', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_import_batches')
        .select('id, label, source_filename, created_at, row_count, imported_active_count, imported_archived_count, skipped_count')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── File handling ─────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setParseError(null);
    setFilename(file.name);

    try {
      const text = await file.text();
      const result = parseCSV(text);
      if (result.errors.length > 0) {
        const missing = result.errors
          .filter((e) => e.kind === 'missing_required_column')
          .map((e) => e.column);
        if (missing.length > 0) {
          setParseError(`CSV is missing required column(s): ${missing.join(', ')}. Required: ${REQUIRED_COLUMNS.join(', ')}.`);
          return;
        }
        setParseError('CSV could not be parsed. Check encoding (must be UTF-8) and structure.');
        return;
      }
      if (result.rows.length === 0) {
        setParseError('CSV has no data rows.');
        return;
      }
      setParseResult(result);
      setBucketed(bucketRows(result.rows));
      setPhase('preview');
    } catch (err) {
      logger.error('CSV parse failed:', err);
      setParseError(err?.message || 'Failed to read file');
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Commit mutation ───────────────────────────────────────────
  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!bucketed) throw new Error('No data to import');
      // Send only the ready rows — skipped ones don't go to the server.
      // Server re-validates anyway (defense in depth) so this is purely
      // to keep the payload tight on large imports.
      const rowsPayload = bucketed.ready.map((r) => ({
        full_name:         r.row.full_name,
        status:            r.row.status?.toLowerCase(),
        phone:             r.row.phone || null,
        email:             r.row.email || null,
        join_date:         r.row.join_date,
        cancellation_date: r.row.cancellation_date || null,
        plan_name:         r.row.plan_name || null,
        birthday:          r.row.birthday || null,
        external_id:       r.row.external_id || null,
      }));

      const { data, error } = await supabase.rpc('bulk_import_members', {
        p_gym_id:   gymId,
        p_rows:     rowsPayload,
        p_label:    label || null,
        p_filename: filename || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      logAdminAction('gym_import', 'gym', gymId, {
        batch_id: data.batch_id,
        active: data.imported_active,
        archived: data.imported_archived,
      });
      setImportResult(data);
      setPhase('result');
    },
    onError: (err) => {
      logger.error('Bulk import RPC failed:', err);
    },
  });

  const handleReset = () => {
    setPhase('upload');
    setParseResult(null);
    setBucketed(null);
    setFilename('');
    setLabel('');
    setParseError(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Download codes sheet (post-import) ────────────────────────
  // Pulls the freshly-imported active members + their generated codes and
  // builds a printable CSV the operator can hand to the front desk. CSV
  // (not PDF) keeps the build small; the gym can paste into Word/Sheets
  // and format however they want.
  const handleDownloadCodes = async () => {
    if (!importResult?.batch_id) return;
    // Two-query join via phone. We can't FK-join because imported invites
    // have used_by=NULL (no profile linked until the member claims at
    // signup). Phone is the durable bridge between the imported profile
    // and the invite the front desk needs to hand over.
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .eq('gym_id', gymId)
      .eq('import_batch_id', importResult.batch_id)
      .eq('imported_archived', false);

    if (error || !data) {
      logger.error('Codes sheet fetch failed:', error);
      return;
    }

    const phones = data.map((p) => p.phone).filter(Boolean);
    const { data: invites } = await selectInBatches(
      (chunk) => supabase
        .from('gym_invites')
        .select('phone, member_name, invite_code')
        .eq('gym_id', gymId)
        .in('phone', chunk),
      phones
    );

    const inviteByPhone = new Map((invites || []).map((i) => [i.phone, i.invite_code]));

    const rows = data.map((p) => ({
      name: p.full_name || '',
      phone: p.phone || '',
      code: inviteByPhone.get(p.phone) || '',
    }));

    const header = 'Name,Phone,Code\n';
    const body = rows.map((r) =>
      [r.name, r.phone, r.code].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const { saveBlob } = await import('../../lib/saveBlob');
    const blob = new Blob([header, body], { type: 'text/csv;charset=utf-8' });
    const safeGymName = (gym?.name || 'gym').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    await saveBlob(`${safeGymName}-member-codes.csv`, blob);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/platform/gym/${gymId}`)}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#6B7280] mb-0.5">CSV Import</p>
          <h1 className="text-[18px] font-bold text-[#E5E7EB] truncate">
            {gym?.name || 'Gym'}
          </h1>
        </div>
      </div>

      {/* Past batches strip */}
      {pastBatches.length > 0 && phase === 'upload' && (
        <FadeIn>
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-amber-400" />
              <p className="text-[12px] font-semibold text-amber-400">
                This gym already has {pastBatches.length} prior import{pastBatches.length === 1 ? '' : 's'}
              </p>
            </div>
            <ul className="space-y-1">
              {pastBatches.map((b) => (
                <li key={b.id} className="text-[11px] text-[#9CA3AF] flex items-center gap-2 flex-wrap">
                  <span className="text-[#E5E7EB]">{b.label || b.source_filename || 'Unlabeled'}</span>
                  <span className="text-[#6B7280]">·</span>
                  <span>{new Date(b.created_at).toLocaleDateString()}</span>
                  <span className="text-[#6B7280]">·</span>
                  <span>{b.imported_active_count + b.imported_archived_count} imported</span>
                  {b.skipped_count > 0 && (
                    <>
                      <span className="text-[#6B7280]">·</span>
                      <span className="text-amber-400">{b.skipped_count} skipped</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </FadeIn>
      )}

      {/* ── PHASE: UPLOAD ────────────────────────────────────────── */}
      {phase === 'upload' && (
        <FadeIn>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-2xl border-2 border-dashed border-white/10 bg-[#0F172A] p-10 text-center hover:border-white/20 transition-colors"
          >
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/5 mb-4">
              <Upload size={22} className="text-[#9CA3AF]" />
            </div>
            <h2 className="text-[15px] font-bold text-[#E5E7EB] mb-1.5">Upload CSV</h2>
            <p className="text-[12px] text-[#9CA3AF] mb-5 max-w-md mx-auto leading-relaxed">
              Drag a .csv file here or click to browse. Encoding must be UTF-8.
              Required columns: <span className="font-mono text-[#E5E7EB]">{REQUIRED_COLUMNS.join(', ')}</span>.
              Optional: <span className="font-mono text-[#6B7280]">{CANONICAL_COLUMNS.filter(c => !REQUIRED_COLUMNS.includes(c)).join(', ')}</span>.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[13px] font-bold transition-colors"
            >
              Choose file
            </button>

            {parseError && (
              <div className="mt-5 mx-auto max-w-lg rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-left">
                <p className="text-[12px] font-semibold text-red-400 mb-1">Parse failed</p>
                <p className="text-[11px] text-[#FCA5A5] leading-relaxed">{parseError}</p>
              </div>
            )}
          </div>
        </FadeIn>
      )}

      {/* ── PHASE: PREVIEW ───────────────────────────────────────── */}
      {phase === 'preview' && bucketed && (
        <FadeIn>
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <SummaryTile label="Total rows" value={bucketed.summary.total} />
            <SummaryTile label="Active import" value={bucketed.summary.activeCount} accent="emerald" />
            <SummaryTile label="Archived import" value={bucketed.summary.archivedCount} accent="slate" />
            <SummaryTile label="Skipped" value={bucketed.summary.skippedCount} accent={bucketed.summary.skippedCount > 0 ? 'amber' : null} />
          </div>

          {/* Label + filename */}
          <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="import-label" className="block text-[11px] uppercase tracking-wider text-[#6B7280] mb-1.5">Batch label (optional)</label>
              <input
                id="import-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`${gym?.name || 'Gym'} — initial import`}
                className="w-full rounded-xl bg-[#0F172A] border border-white/10 px-3 py-2.5 text-[13px] text-[#E5E7EB] focus:border-emerald-500/40 focus:outline-none"
              />
            </div>
            <div>
              <p className="block text-[11px] uppercase tracking-wider text-[#6B7280] mb-1.5">Source file</p>
              <p className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-[13px] text-[#9CA3AF] truncate">
                <FileSpreadsheet size={12} className="inline-block mr-2" />
                {filename}
              </p>
            </div>
          </div>

          {/* Skipped rows panel — only if there are any */}
          {bucketed.skipped.length > 0 && (
            <details className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-[12px] font-semibold text-amber-400 hover:bg-amber-500/10">
                {bucketed.skipped.length} row{bucketed.skipped.length === 1 ? '' : 's'} will be skipped — click to inspect
              </summary>
              <div className="px-4 pb-3 max-h-64 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-left text-[#9CA3AF] border-b border-white/5">
                    <tr><th className="py-1.5 font-semibold">Row</th><th className="py-1.5 font-semibold">Name</th><th className="py-1.5 font-semibold">Reason</th></tr>
                  </thead>
                  <tbody>
                    {bucketed.skipped.map((s, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="py-1.5 pr-3 font-mono text-[#6B7280]">{s.index}</td>
                        <td className="py-1.5 pr-3 text-[#E5E7EB] truncate max-w-[200px]">{s.row.full_name || '—'}</td>
                        <td className="py-1.5 text-amber-400">{SKIP_REASON_LABEL[s.reason] || s.reason}{s.detail ? ` (${s.detail})` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Ready rows table */}
          <div className="rounded-xl border border-white/10 bg-[#0F172A] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[#E5E7EB]">{bucketed.ready.length} rows to import</p>
              <p className="text-[11px] text-[#6B7280]">Showing first 50</p>
            </div>
            <div className="max-h-[400px] overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-[#0F172A] text-left text-[#9CA3AF] border-b border-white/5">
                  <tr>
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Status</th>
                    <th className="py-2 px-3 font-semibold">Name</th>
                    <th className="py-2 px-3 font-semibold">Phone</th>
                    <th className="py-2 px-3 font-semibold">Join</th>
                    <th className="py-2 px-3 font-semibold">Cancelled</th>
                    <th className="py-2 px-3 font-semibold">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketed.ready.slice(0, 50).map((r, i) => {
                    const isActive = r.row.status?.toLowerCase() === 'active';
                    return (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-1.5 px-3 font-mono text-[#6B7280]">{r.index}</td>
                        <td className="py-1.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
                            {isActive ? 'Active' : 'Archive'}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-[#E5E7EB] truncate max-w-[200px]">{r.row.full_name}</td>
                        <td className="py-1.5 px-3 text-[#9CA3AF] truncate max-w-[140px]">{r.row.phone || '—'}</td>
                        <td className="py-1.5 px-3 text-[#9CA3AF]">{r.row.join_date}</td>
                        <td className="py-1.5 px-3 text-[#9CA3AF]">{r.row.cancellation_date || '—'}</td>
                        <td className="py-1.5 px-3 text-[#6B7280] truncate max-w-[120px]">{r.row.plan_name || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          {commitMutation.isError && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-[11px] text-red-400">Import failed: {commitMutation.error?.message}</p>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3 justify-end">
            <button
              onClick={handleReset}
              disabled={commitMutation.isPending}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#9CA3AF] text-[12px] font-semibold transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending || bucketed.ready.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[13px] font-bold transition-colors disabled:opacity-40"
            >
              {commitMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Commit import ({bucketed.ready.length} rows)
            </button>
          </div>
        </FadeIn>
      )}

      {/* ── PHASE: RESULT ────────────────────────────────────────── */}
      {phase === 'result' && importResult && (
        <FadeIn>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 mb-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 size={18} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-emerald-400">Import complete</p>
                <p className="text-[11px] text-[#9CA3AF]">Batch ID: <span className="font-mono">{importResult.batch_id?.slice(0, 8)}…</span></p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SummaryTile label="Active" value={importResult.imported_active} accent="emerald" />
              <SummaryTile label="Archived" value={importResult.imported_archived} accent="slate" />
              <SummaryTile label="Skipped" value={importResult.skipped} accent={importResult.skipped > 0 ? 'amber' : null} />
            </div>

            {importResult.errors && importResult.errors.length > 0 && (
              <details className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 overflow-hidden">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-amber-400">
                  Server skip reasons ({importResult.errors.length})
                </summary>
                <ul className="px-3 pb-2 text-[10.5px] text-[#FCD34D] space-y-0.5 max-h-48 overflow-auto">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>Row {e.row_index}: {SKIP_REASON_LABEL[e.reason] || e.reason}{e.detail ? ` (${e.detail})` : ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate(`/platform/gym/${gymId}/diagnostic`)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[13px] font-bold transition-colors"
            >
              <Microscope size={14} />
              View retention diagnostic
            </button>
            <button
              onClick={handleDownloadCodes}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#E5E7EB] text-[12px] font-semibold transition-colors"
            >
              <Download size={13} />
              Download codes sheet
            </button>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#9CA3AF] text-[12px] font-semibold transition-colors"
            >
              <RotateCw size={13} />
              Import another file
            </button>
          </div>
        </FadeIn>
      )}
    </div>
  );
}

// ── Small reusable summary tile ────────────────────────────────
function SummaryTile({ label, value, accent }) {
  const accentClasses = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400',
    amber:   'border-amber-500/20 bg-amber-500/5 text-amber-400',
    slate:   'border-slate-500/20 bg-slate-500/5 text-slate-300',
  }[accent] || 'border-white/10 bg-[#0F172A] text-[#E5E7EB]';

  return (
    <div className={`rounded-xl border ${accentClasses} p-3.5`}>
      <p className="text-[10.5px] uppercase tracking-wider opacity-70 mb-1">{label}</p>
      <p className="text-[24px] font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

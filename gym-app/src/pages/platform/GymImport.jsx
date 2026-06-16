import { useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Loader2, Download, Microscope, RotateCw, Undo2,
} from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { selectInBatches } from '../../lib/churn/batchedSelect';
import { useToast } from '../../contexts/ToastContext';
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
  const { showToast } = useToast();
  const fileInputRef = useRef(null);

  const [phase, setPhase] = useState('upload'); // 'upload' | 'preview' | 'result'
  const [filename, setFilename] = useState('');
  const [label, setLabel] = useState('');
  const [, setParseResult] = useState(null); // { headers, rows, errors }
  const [bucketed, setBucketed] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [codesError, setCodesError] = useState(null);
  const [rollbackBatch, setRollbackBatch] = useState(null); // batch row pending confirm
  const [rollbackConfirmSlug, setRollbackConfirmSlug] = useState('');

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
  // select('*') (not an explicit column list) so the strip keeps working
  // before migration 0545 adds rolled_back_at.
  const { data: pastBatches = [], refetch: refetchBatches } = useQuery({
    queryKey: ['platform-gym-batches', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_import_batches')
        .select('*')
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

  // ── Rollback mutation ─────────────────────────────────────────
  // rollback_import_batch (migration 0545) removes the batch's UNCLAIMED
  // shell profiles + their unused invite codes; claimed members are kept.
  const rollbackMutation = useMutation({
    mutationFn: async (batchId) => {
      const { data, error } = await supabase.rpc('rollback_import_batch', {
        p_batch_id: batchId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      logAdminAction('rollback_import_batch', 'gym', gymId, {
        batch_id: data?.batch_id,
        profiles_deleted: data?.profiles_deleted,
        invites_deleted: data?.invites_deleted,
        claimed_kept: data?.claimed_kept,
      });
      showToast(
        `Rollback complete — ${data?.profiles_deleted ?? 0} unclaimed profiles and ${data?.invites_deleted ?? 0} invite codes removed`
        + (data?.claimed_kept > 0 ? ` (${data.claimed_kept} already-claimed members kept)` : ''),
        'success'
      );
      setRollbackBatch(null);
      setRollbackConfirmSlug('');
      refetchBatches();
    },
    onError: (err) => {
      logger.error('Import rollback failed:', err);
      // Surfaced inline in the confirm modal via rollbackMutation.error.
    },
  });

  // PostgREST PGRST202 = function not in the schema cache → migration 0545
  // hasn't been applied yet. Surface that honestly instead of a raw error.
  const isMissingRollbackRpc = (err) =>
    err?.code === 'PGRST202'
    || /could not find the function|function .*rollback_import_batch.* does not exist/i.test(err?.message || '');

  const handleReset = () => {
    setPhase('upload');
    setParseResult(null);
    setBucketed(null);
    setFilename('');
    setLabel('');
    setParseError(null);
    setImportResult(null);
    setCodesError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Download codes sheet (post-import) ────────────────────────
  // Pulls the freshly-imported active members + their generated codes and
  // builds a printable CSV the operator can hand to the front desk. CSV
  // (not PDF) keeps the build small; the gym can paste into Word/Sheets
  // and format however they want.
  const handleDownloadCodes = async () => {
    if (!importResult?.batch_id) return;
    setCodesError(null);
    // Two-query join via phone. We can't FK-join because imported invites
    // have used_by=NULL (no profile linked until the member claims at
    // signup). Phone is the durable bridge between the imported profile
    // (profiles.phone_number, 0080/0466) and the invite (gym_invites.phone)
    // the front desk needs to hand over.
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone_number')
      .eq('gym_id', gymId)
      .eq('import_batch_id', importResult.batch_id)
      .eq('imported_archived', false);

    if (error || !data) {
      logger.error('Codes sheet fetch failed:', error);
      setCodesError(`Couldn't build the codes sheet: ${error?.message || 'no data returned'}`);
      showToast('Codes sheet export failed', 'error');
      return;
    }

    const phones = data.map((p) => p.phone_number).filter(Boolean);
    const { data: invites, error: invitesError } = await selectInBatches(
      (chunk) => supabase
        .from('gym_invites')
        .select('phone, member_name, invite_code')
        .eq('gym_id', gymId)
        .in('phone', chunk),
      phones
    );

    if (invitesError) {
      logger.error('Codes sheet invite fetch failed:', invitesError);
      setCodesError(`Couldn't load the invite codes: ${invitesError.message}`);
      showToast('Codes sheet export failed', 'error');
      return;
    }

    const inviteByPhone = new Map((invites || []).map((i) => [i.phone, i.invite_code]));

    const rows = data.map((p) => ({
      name: p.full_name || '',
      phone: p.phone_number || '',
      code: inviteByPhone.get(p.phone_number) || '',
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
                  {b.rolled_back_at ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-500/15 text-slate-400">
                      Rolled back
                    </span>
                  ) : (
                    <button
                      onClick={() => { setRollbackBatch(b); setRollbackConfirmSlug(''); rollbackMutation.reset(); }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                    >
                      <Undo2 size={10} />
                      Rollback this import
                    </button>
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
              className="px-5 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
              style={{ background: '#10b981', color: '#000' }}
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

          <p className="mt-4 text-[11px] text-[#9CA3AF] leading-relaxed">
            Heads up: the final import skips any row whose phone or email already belongs to a live member of this gym
            (deduplication runs server-side), so the number actually imported may be lower than the {bucketed.ready.length} previewed here.
            Any skipped duplicates are itemized on the result screen.
          </p>
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
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-40"
              style={{ background: '#10b981', color: '#000' }}
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

          {codesError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-[12px] font-semibold text-red-400 mb-0.5">Codes sheet export failed</p>
              <p className="text-[11px] text-[#FCA5A5] leading-relaxed">{codesError}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate(`/platform/gym/${gymId}/diagnostic`)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
              style={{ background: '#10b981', color: '#000' }}
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

      {/* ── Rollback confirmation modal ──────────────────────────── */}
      {rollbackBatch && (
        <RollbackConfirmModal
          batch={rollbackBatch}
          gymSlug={gym?.slug || ''}
          confirmSlug={rollbackConfirmSlug}
          onChangeConfirmSlug={setRollbackConfirmSlug}
          isPending={rollbackMutation.isPending}
          error={rollbackMutation.error}
          missingRpc={rollbackMutation.error ? isMissingRollbackRpc(rollbackMutation.error) : false}
          onCancel={() => { setRollbackBatch(null); setRollbackConfirmSlug(''); rollbackMutation.reset(); }}
          onConfirm={() => rollbackMutation.mutate(rollbackBatch.id)}
        />
      )}
    </div>
  );
}

// ── Rollback confirmation modal ────────────────────────────────
// Same typed-slug pattern as GymOps' hard-delete modal: the operator must
// type the gym slug before the destructive RPC fires. If migration 0545
// isn't applied yet (PGRST202), the modal says so instead of a raw error.
function RollbackConfirmModal({ batch, gymSlug, confirmSlug, onChangeConfirmSlug, isPending, error, missingRpc, onCancel, onConfirm }) {
  const slugMatches = gymSlug !== '' && confirmSlug === gymSlug;
  const importedCount = (batch.imported_active_count ?? 0) + (batch.imported_archived_count ?? 0);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="max-w-md w-full rounded-2xl p-6 bg-[#0F172A] border border-red-500/30">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-red-500/15">
            <Undo2 size={18} className="text-red-400" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-white">Roll back this import?</p>
            <p className="text-[12.5px] mt-1 leading-relaxed text-[#9CA3AF]">
              <span className="text-[#E5E7EB]">{batch.label || batch.source_filename || 'Unlabeled'}</span>
              {' '}({importedCount} imported on {new Date(batch.created_at).toLocaleDateString()}).
              Removes the batch&apos;s <span className="text-[#E5E7EB]">unclaimed</span> shell profiles and their
              unused invite codes. Members who already claimed their account are kept.{' '}
              <span className="text-red-400 font-semibold">No undo.</span>
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="rollback-slug-confirm" className="block text-[11px] uppercase tracking-wider text-[#6B7280] mb-1.5">
            Type <code className="font-mono text-[#E5E7EB]">{gymSlug || '…'}</code> to confirm
          </label>
          <input
            id="rollback-slug-confirm"
            type="text"
            value={confirmSlug}
            onChange={(e) => onChangeConfirmSlug(e.target.value)}
            placeholder={gymSlug}
            className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-[13px] font-mono text-white focus:border-red-500/40 focus:outline-none"
            autoFocus
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            {missingRpc ? (
              <p className="text-[11.5px] text-amber-300 leading-relaxed">
                Rollback isn&apos;t available yet — migration <span className="font-mono">0545_platform_lifecycle_snapshots.sql</span>{' '}
                (which adds <span className="font-mono">rollback_import_batch</span>) hasn&apos;t been applied to this database.
              </p>
            ) : (
              <p className="text-[11.5px] text-red-400 leading-relaxed">Rollback failed: {error.message}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 rounded-xl text-[12.5px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!slugMatches || isPending || missingRpc}
            className="px-4 py-2 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-2 disabled:opacity-30"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            {isPending ? 'Rolling back…' : 'Roll back import'}
          </button>
        </div>
      </div>
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

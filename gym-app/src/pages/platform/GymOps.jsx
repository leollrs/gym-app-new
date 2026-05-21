import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Download, Trash2, RotateCcw, AlertTriangle, DollarSign,
  Database, HardDrive, Users, Activity, CheckCircle2, Clock, Loader2,
  AlertOctagon,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { saveBlob } from '../../lib/saveBlob';
import { logAdminAction } from '../../lib/adminAudit';
import FadeIn from '../../components/platform/FadeIn';

/**
 * GymOps — super-admin "data & cost" surface for a single gym.
 *
 * Surfaces:
 *   - Current lifecycle state badge (active / paused / pending_deletion)
 *   - Full data export (one-click JSON download of every gym-scoped table)
 *   - Schedule deletion (90-day grace by default) + cancel deletion
 *   - Hard-delete-now (with slug confirmation)
 *   - Recent lifecycle audit events
 *   - Cost estimate widget: row counts, storage, DB GB, $/month projection
 *
 * All actions route through migration 0424 RPCs which gate on super_admin.
 * The page is its own route (not a tab) because these are vendor-management
 * ops that don't belong next to the daily-operations tabs.
 */
export default function GymOps() {
  const { gymId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [scheduleDays, setScheduleDays] = useState(90);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // ── Gym row ───────────────────────────────────────────────────
  const { data: gym, isLoading: gymLoading } = useQuery({
    queryKey: ['platform-gym-ops', gymId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('id, name, slug, is_active, lifecycle_state, scheduled_deletion_at, created_at')
        .eq('id', gymId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!gymId,
  });

  // ── Audit log ─────────────────────────────────────────────────
  const { data: events = [] } = useQuery({
    queryKey: ['platform-gym-lifecycle-events', gymId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_lifecycle_events')
        .select('id, event_type, performed_at, performed_by, metadata, profiles:performed_by(full_name)')
        .eq('gym_id', gymId)
        .order('performed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Cost estimate ─────────────────────────────────────────────
  // Heavier to compute (row counts × tables) so we cache 5 minutes.
  const { data: costs, isFetching: costsLoading } = useQuery({
    queryKey: ['platform-gym-costs', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('super_admin_compute_gym_costs', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  // ── Export ────────────────────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('super_admin_export_gym_data', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      // Stream the JSON straight to a download. saveBlob already handles
      // the cross-platform CSV/PDF download pattern; reusing it here.
      const filename = `${(gym?.slug || 'gym')}-export-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
      const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: 'application/json' },
      );
      await saveBlob(filename, blob);
      logAdminAction('super_admin_export', 'gym', gymId, {
        total_rows: data?.row_summary?.total,
      });
      showToast(`Exported ${data?.row_summary?.total ?? 0} rows`, 'success');
      queryClient.invalidateQueries({ queryKey: ['platform-gym-lifecycle-events', gymId] });
    },
    onError: (err) => {
      showToast(`Export failed: ${err.message}`, 'error');
    },
  });

  // ── Schedule deletion ────────────────────────────────────────
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('super_admin_schedule_gym_deletion', {
        p_gym_id: gymId,
        p_days_grace: scheduleDays,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      logAdminAction('super_admin_schedule_deletion', 'gym', gymId, {
        scheduled_at: data.scheduled_deletion_at,
        days_grace: data.days_grace,
      });
      showToast(`Deletion scheduled for ${format(new Date(data.scheduled_deletion_at), 'PPP')}`, 'success');
      queryClient.invalidateQueries({ queryKey: ['platform-gym-ops', gymId] });
      queryClient.invalidateQueries({ queryKey: ['platform-gym-lifecycle-events', gymId] });
    },
    onError: (err) => showToast(`Schedule failed: ${err.message}`, 'error'),
  });

  // ── Cancel deletion ──────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('super_admin_cancel_gym_deletion', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      logAdminAction('super_admin_cancel_deletion', 'gym', gymId);
      showToast('Deletion cancelled — gym restored to active', 'success');
      queryClient.invalidateQueries({ queryKey: ['platform-gym-ops', gymId] });
      queryClient.invalidateQueries({ queryKey: ['platform-gym-lifecycle-events', gymId] });
    },
    onError: (err) => showToast(`Cancel failed: ${err.message}`, 'error'),
  });

  // ── Hard delete now ──────────────────────────────────────────
  const deleteNowMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('super_admin_delete_gym_now', {
        p_gym_id: gymId,
        p_confirm_slug: deleteConfirmSlug,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      logAdminAction('super_admin_delete_gym_now', 'gym', gymId, {
        gym_slug: data.gym_slug,
        profiles_deleted: data.profiles_deleted,
      });
      showToast(`Gym deleted — ${data.profiles_deleted} profiles removed`, 'success');
      // The gym is gone — bounce back to the overview.
      navigate('/platform');
    },
    onError: (err) => showToast(`Delete failed: ${err.message}`, 'error'),
  });

  if (gymLoading || !gym) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
      </div>
    );
  }

  const isPending = gym.lifecycle_state === 'pending_deletion';
  const lifecycleColor = isPending ? 'red' : gym.lifecycle_state === 'paused' ? 'amber' : 'emerald';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/platform/gym/${gymId}`)}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#6B7280] mb-0.5">Data & costs</p>
          <h1 className="text-[18px] font-bold text-[#E5E7EB] truncate">{gym.name}</h1>
        </div>
        <span
          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-${lifecycleColor}-500/10 text-${lifecycleColor}-400 border-${lifecycleColor}-500/20`}
        >
          {gym.lifecycle_state.replace('_', ' ')}
        </span>
      </div>

      {/* ── Pending deletion banner ─────────────────────────── */}
      {isPending && gym.scheduled_deletion_at && (
        <FadeIn>
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
            <AlertOctagon size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-red-400">Scheduled for deletion</p>
              <p className="text-[12px] text-[#FCA5A5] mt-1">
                All data will be permanently deleted on{' '}
                <span className="font-semibold">
                  {format(new Date(gym.scheduled_deletion_at), 'PPP')}
                </span>{' '}
                ({formatDistanceToNow(new Date(gym.scheduled_deletion_at), { addSuffix: true })}).
              </p>
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[12px] font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
              >
                <RotateCcw size={13} />
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel deletion / restore'}
              </button>
            </div>
          </div>
        </FadeIn>
      )}

      {/* ── Data ops row ──────────────────────────────────── */}
      <FadeIn delay={40}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Export card */}
          <OpsCard
            icon={Download}
            title="Export gym data"
            sub="Download a single JSON file with every gym-scoped table (profiles, sessions, check-ins, PRs, body metrics, invites, challenges)."
            actionLabel={exportMutation.isPending ? 'Exporting…' : 'Export now'}
            actionLoading={exportMutation.isPending}
            actionIcon={Download}
            actionTone="accent"
            onClick={() => exportMutation.mutate()}
          />

          {/* Schedule deletion card */}
          {!isPending && (
            <OpsCard
              icon={Clock}
              title="Schedule deletion"
              sub="Soft-delete with a grace window. Members lose access immediately; data is preserved for restore until the deletion date."
              actionLabel={scheduleMutation.isPending ? 'Scheduling…' : `Schedule (${scheduleDays} days)`}
              actionLoading={scheduleMutation.isPending}
              actionIcon={Clock}
              actionTone="warning"
              onClick={() => scheduleMutation.mutate()}
              extra={
                <div className="flex items-center gap-2 mt-2">
                  <label htmlFor="grace-days" className="text-[11px] text-[#9CA3AF]">Grace days:</label>
                  <input
                    id="grace-days"
                    type="number"
                    min={0}
                    max={365}
                    value={scheduleDays}
                    onChange={(e) => setScheduleDays(Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)))}
                    className="w-20 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[12px] text-white"
                  />
                </div>
              }
            />
          )}

          {/* Delete now card */}
          <OpsCard
            icon={Trash2}
            title="Delete immediately"
            sub="Hard delete. Wipes profiles, sessions, check-ins, storage objects, and shadow auth users from bulk imports. Irreversible."
            actionLabel="Delete now"
            actionIcon={Trash2}
            actionTone="danger"
            onClick={() => setShowDeleteModal(true)}
          />
        </div>
      </FadeIn>

      {/* ── Cost estimate ────────────────────────────────── */}
      <FadeIn delay={80}>
        <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={16} className="text-emerald-400" />
            <p className="text-[14px] font-bold text-[#E5E7EB]">Cost estimate</p>
            {costsLoading && <Loader2 size={12} className="animate-spin text-[#6B7280]" />}
            <span className="ml-auto text-[10px] uppercase tracking-wider text-[#6B7280]">
              {costs ? `as of ${formatDistanceToNow(new Date(costs.computed_at), { addSuffix: true })}` : ''}
            </span>
          </div>

          {costs && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <MiniMetric label="Profiles"           value={costs.counts.profiles.toLocaleString()}        icon={Users} />
                <MiniMetric label="Sessions"           value={costs.counts.workout_sessions.toLocaleString()} icon={Activity} />
                <MiniMetric label="Check-ins"          value={costs.counts.check_ins.toLocaleString()}        icon={CheckCircle2} />
                <MiniMetric label="Active (30d)"       value={costs.counts.active_last_30_days.toLocaleString()} icon={Users} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                <MiniMetric label="DB storage"       value={`${costs.storage.db_gb.toFixed(3)} GB`}         icon={Database} />
                <MiniMetric label="Object storage"   value={`${costs.storage.storage_gb.toFixed(3)} GB`}    icon={HardDrive} />
                <MiniMetric label="Total $/mo (est)" value={`$${costs.estimated_monthly_cost_usd.total.toFixed(2)}`} icon={DollarSign} accent="emerald" />
              </div>

              <div className="rounded-xl bg-black/30 border border-white/5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280] mb-2">Monthly cost breakdown (est.)</p>
                <ul className="space-y-1 text-[12px]">
                  <CostRow label="Database storage" value={costs.estimated_monthly_cost_usd.db} />
                  <CostRow label="Object storage"   value={costs.estimated_monthly_cost_usd.storage} />
                  <CostRow label="Egress (estimate)" value={costs.estimated_monthly_cost_usd.egress_estimate} />
                  <CostRow label="MAU"              value={costs.estimated_monthly_cost_usd.mau} />
                </ul>
                <p className="text-[10.5px] text-[#6B7280] mt-3 leading-relaxed italic">{costs.notes}</p>
              </div>
            </>
          )}

          {!costs && !costsLoading && (
            <p className="text-[12px] text-[#9CA3AF]">Cost estimate unavailable.</p>
          )}
        </div>
      </FadeIn>

      {/* ── Audit log ─────────────────────────────────────── */}
      <FadeIn delay={120}>
        <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-5">
          <p className="text-[14px] font-bold text-[#E5E7EB] mb-4">Recent lifecycle events</p>
          {events.length === 0 ? (
            <p className="text-[12px] text-[#6B7280]">No events recorded yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <span className="text-[16px] flex-shrink-0">{EVENT_ICON[e.event_type] || '•'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-semibold text-[#E5E7EB]">
                      {EVENT_LABEL[e.event_type] || e.event_type}
                    </p>
                    <p className="text-[10.5px] text-[#6B7280]">
                      {e.profiles?.full_name || 'system'} ·{' '}
                      {formatDistanceToNow(new Date(e.performed_at), { addSuffix: true })}
                      {e.metadata?.total_rows ? ` · ${e.metadata.total_rows} rows` : ''}
                      {e.metadata?.days_grace != null ? ` · ${e.metadata.days_grace}-day grace` : ''}
                      {e.metadata?.profiles_deleted != null ? ` · ${e.metadata.profiles_deleted} profiles wiped` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FadeIn>

      {/* ── Delete confirmation modal ───────────────────────── */}
      {showDeleteModal && (
        <DeleteConfirmModal
          gym={gym}
          confirmSlug={deleteConfirmSlug}
          onChangeConfirmSlug={setDeleteConfirmSlug}
          isPending={deleteNowMutation.isPending}
          onCancel={() => { setShowDeleteModal(false); setDeleteConfirmSlug(''); }}
          onConfirm={() => deleteNowMutation.mutate()}
        />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────
function OpsCard({ icon: Icon, title, sub, actionLabel, actionIcon: ActionIcon, actionTone, actionLoading, onClick, extra }) {
  const toneClasses = {
    accent:  'bg-emerald-500 text-black hover:bg-emerald-400',
    warning: 'bg-amber-500 text-black hover:bg-amber-400',
    danger:  'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30',
  }[actionTone] || 'bg-white/5 text-white hover:bg-white/10';

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} className="text-[#9CA3AF]" />
        <p className="text-[13px] font-bold text-[#E5E7EB]">{title}</p>
      </div>
      <p className="text-[11.5px] text-[#9CA3AF] mb-4 leading-relaxed">{sub}</p>
      {extra}
      <button
        onClick={onClick}
        disabled={actionLoading}
        className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-colors disabled:opacity-40 ${toneClasses}`}
      >
        {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <ActionIcon size={13} />}
        {actionLabel}
      </button>
    </div>
  );
}

function MiniMetric({ label, value, icon: Icon, accent }) {
  const accentClass = accent === 'emerald' ? 'text-emerald-400' : 'text-[#E5E7EB]';
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} className="text-[#6B7280]" />
        <p className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">{label}</p>
      </div>
      <p className={`text-[18px] font-extrabold tabular-nums leading-tight ${accentClass}`}>{value}</p>
    </div>
  );
}

function CostRow({ label, value }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-[#9CA3AF]">{label}</span>
      <span className="font-mono text-[#E5E7EB] tabular-nums">${value.toFixed(4)}</span>
    </li>
  );
}

function DeleteConfirmModal({ gym, confirmSlug, onChangeConfirmSlug, isPending, onCancel, onConfirm }) {
  const slugMatches = confirmSlug === gym.slug;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="max-w-md w-full rounded-2xl p-6 bg-[#0F172A] border border-red-500/30">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-red-500/15">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-white">Permanently delete <span className="font-mono">{gym.slug}</span>?</p>
            <p className="text-[12.5px] mt-1 leading-relaxed text-[#9CA3AF]">
              This wipes profiles, sessions, check-ins, body metrics, PRs, storage objects, and shadow auth users.{' '}
              <span className="text-red-400 font-semibold">No undo.</span>
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="slug-confirm" className="block text-[11px] uppercase tracking-wider text-[#6B7280] mb-1.5">
            Type <code className="font-mono text-[#E5E7EB]">{gym.slug}</code> to confirm
          </label>
          <input
            id="slug-confirm"
            type="text"
            value={confirmSlug}
            onChange={(e) => onChangeConfirmSlug(e.target.value)}
            placeholder={gym.slug}
            className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-[13px] font-mono text-white focus:border-red-500/40 focus:outline-none"
            autoFocus
          />
        </div>

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
            disabled={!slugMatches || isPending}
            className="px-4 py-2 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-2 bg-red-500 text-white disabled:opacity-30"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {isPending ? 'Deleting…' : 'Delete forever'}
          </button>
        </div>
      </div>
    </div>
  );
}

const EVENT_LABEL = {
  created:                'Created',
  paused:                 'Paused',
  reactivated:            'Reactivated',
  export_run:             'Data exported',
  deletion_scheduled:     'Deletion scheduled',
  deletion_cancelled:     'Deletion cancelled',
  deletion_executed:      'Hard deleted',
  restored_from_pending:  'Restored from pending',
};
const EVENT_ICON = {
  created:                '🟢',
  paused:                 '⏸️',
  reactivated:            '▶️',
  export_run:             '📤',
  deletion_scheduled:     '⏳',
  deletion_cancelled:     '↩️',
  deletion_executed:      '🗑️',
  restored_from_pending:  '✅',
};

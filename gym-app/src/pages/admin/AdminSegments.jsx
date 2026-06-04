import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Filter, Plus, Pin, PinOff, Pencil, Trash2, Users, Search,
  RefreshCw, Download, MessageSquare, Sparkles,
  Shield, AlertTriangle, Zap, Clock, UserPlus, Target,
  Activity, Flame, Heart, Star, Eye, Send,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, subDays, subMonths } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { selectInBatches } from '../../lib/churn/batchedSelect.js';
import { encryptMessage } from '../../lib/messageEncryption';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { exportCSV } from '../../lib/csvExport';
import logger from '../../lib/logger';
import { logAdminAction } from '../../lib/adminAudit';

import {
  PageHeader, AdminCard, SectionLabel, FadeIn, StatCard,
  AdminModal, Avatar, AdminPageShell,
} from '../../components/admin';
import { ICON_MAP, ICON_OPTIONS, COLOR_OPTIONS } from './components/segmentConstants';
import { applySegmentFilters } from '../../lib/admin/segmentFilters';
import SegmentEditorModal from './components/SegmentEditorModal';
import AdminPagination from '../../components/admin/AdminPagination';

// ICON_MAP / ICON_OPTIONS / COLOR_OPTIONS extracted to ./components/segmentConstants

// ── Pre-built segment suggestions ───────────────────────────
const PREBUILT_SEGMENTS = [
  {
    name: 'At Risk — No workout in 2 weeks',
    nameKey: 'admin.segments.prebuilt.atRisk',
    description: 'Members who haven\'t logged a workout in 14+ days',
    descriptionKey: 'admin.segments.prebuilt.atRiskDesc',
    filters: { last_workout_days_ago_gt: 14 },
    color: 'var(--color-danger)',
    icon: 'alert-triangle',
  },
  {
    name: 'New Members (last 30 days)',
    nameKey: 'admin.segments.prebuilt.newMembers',
    description: 'Members who joined in the last 30 days',
    descriptionKey: 'admin.segments.prebuilt.newMembersDesc',
    filters: { joined_after: format(subDays(new Date(), 30), 'yyyy-MM-dd') },
    color: 'var(--color-info)',
    icon: 'user-plus',
  },
  {
    name: 'Power Users',
    nameKey: 'admin.segments.prebuilt.powerUsers',
    description: '10+ workouts with an active streak',
    descriptionKey: 'admin.segments.prebuilt.powerUsersDesc',
    filters: { workout_count_gt: 10, streak_gt: 3 },
    color: 'var(--color-success)',
    icon: 'zap',
  },
  {
    name: 'Inactive (30+ days)',
    nameKey: 'admin.segments.prebuilt.inactive',
    description: 'No workout in 30+ days — high churn risk',
    descriptionKey: 'admin.segments.prebuilt.inactiveDesc',
    filters: { last_workout_days_ago_gt: 30 },
    color: 'var(--color-danger)',
    icon: 'clock',
  },
  {
    name: 'Consistent Trainers',
    nameKey: 'admin.segments.prebuilt.consistentTrainers',
    description: 'Members with a 7+ day streak',
    descriptionKey: 'admin.segments.prebuilt.consistentTrainersDesc',
    filters: { streak_gt: 7 },
    color: 'var(--color-success)',
    icon: 'flame',
  },
  {
    name: 'At Risk — Critical',
    nameKey: 'admin.segments.prebuilt.atRiskCritical',
    description: 'Churn score critical tier',
    descriptionKey: 'admin.segments.prebuilt.atRiskCriticalDesc',
    filters: { churn_tier: ['critical'] },
    color: 'var(--color-danger)',
    icon: 'shield',
  },
  {
    name: 'At Risk — High',
    nameKey: 'admin.segments.prebuilt.atRiskHigh',
    description: 'Churn score high tier',
    descriptionKey: 'admin.segments.prebuilt.atRiskHighDesc',
    filters: { churn_tier: ['high'] },
    color: 'var(--color-danger)',
    icon: 'alert-triangle',
  },
  {
    name: 'Beginners',
    nameKey: 'admin.segments.prebuilt.beginners',
    description: 'Fitness level beginner',
    descriptionKey: 'admin.segments.prebuilt.beginnersDesc',
    filters: { fitness_level: ['beginner'] },
    color: 'var(--color-info)',
    icon: 'target',
  },
  {
    name: 'Advanced Athletes',
    nameKey: 'admin.segments.prebuilt.advancedAthletes',
    description: 'Fitness level advanced',
    descriptionKey: 'admin.segments.prebuilt.advancedAthletesDesc',
    filters: { fitness_level: ['advanced'] },
    color: 'var(--color-coach)',
    icon: 'star',
  },
  {
    name: 'Recently Active',
    nameKey: 'admin.segments.prebuilt.recentlyActive',
    description: 'Last workout within 3 days',
    descriptionKey: 'admin.segments.prebuilt.recentlyActiveDesc',
    filters: { last_workout_days_ago_lt: 3 },
    color: 'var(--color-info)',
    icon: 'activity',
  },
  {
    name: 'No Workouts Yet',
    nameKey: 'admin.segments.prebuilt.noWorkouts',
    description: 'Members who never logged a workout',
    descriptionKey: 'admin.segments.prebuilt.noWorkoutsDesc',
    filters: { workout_count_lt: 1 },
    color: 'var(--color-coach)',
    icon: 'eye',
  },
  {
    name: 'Long-term Members',
    nameKey: 'admin.segments.prebuilt.longTermMembers',
    description: 'Joined 6+ months ago',
    descriptionKey: 'admin.segments.prebuilt.longTermMembersDesc',
    filters: { joined_before: format(subMonths(new Date(), 6), 'yyyy-MM-dd') },
    color: 'var(--color-accent)',
    icon: 'heart',
  },
];


// ── Fetch segments + counts ─────────────────────────────────
async function fetchSegments(gymId) {
  const { data, error } = await supabase
    .from('member_segments')
    .select('*')
    .eq('gym_id', gymId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('fetchSegments:', error);
    return [];
  }

  // Compute counts in parallel
  const withCounts = await Promise.all(
    (data || []).map(async (seg) => {
      const members = await applySegmentFilters(gymId, seg.filters || {});
      return { ...seg, _count: members.length };
    })
  );

  return withCounts;
}

// ── Main component ──────────────────────────────────────────
export default function AdminSegments() {
  const { t } = useTranslation('pages');
  const { user: authUser, profile } = useAuth();
  const gymId = profile?.gym_id;
  const adminId = profile?.id;
  const queryClient = useQueryClient();

  const [editModal, setEditModal] = useState(null); // null | 'new' | segment object
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { showToast } = useToast();

  const { data: segments = [], isLoading, refetch } = useQuery({
    queryKey: adminKeys.segments.all(gymId),
    queryFn: () => fetchSegments(gymId),
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const pinnedCount = segments.filter(s => s.is_pinned).length;
  const totalMembers = segments.reduce((sum, s) => sum + (s._count || 0), 0);
  // Avg Segment Size is more honest than "Members Tracked" — that summed across
  // overlapping segments (one member in 3 segments was counted 3 times).
  const avgSegmentSize = segments.length > 0 ? Math.round(totalMembers / segments.length) : null;

  async function handleDelete(segmentId) {
    if (!confirm(t('admin.segments.confirmDelete', 'Delete this segment?'))) return;
    try {
      const { error } = await supabase.from('member_segments').delete().eq('id', segmentId).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('delete_segment', 'member_segment', segmentId);
      if (selectedSegment?.id === segmentId) setSelectedSegment(null);
      showToast(t('admin.segments.segmentDeleted', 'Segment deleted'), 'success');
      refetch();
    } catch (err) {
      logger.error('handleDelete:', err);
      showToast(err.message || t('admin.segments.deleteError', 'Failed to delete segment'), 'error');
    }
  }

  async function handleTogglePin(segment) {
    try {
      const { error } = await supabase.from('member_segments').update({ is_pinned: !segment.is_pinned, updated_at: new Date().toISOString() }).eq('id', segment.id).eq('gym_id', gymId);
      if (error) throw error;
      refetch();
    } catch (err) {
      logger.error('handleTogglePin:', err);
      showToast(err.message || t('admin.segments.pinError', 'Failed to update pin'), 'error');
    }
  }

  return (
    <AdminPageShell>
      {/* ── Header ─────────────────────────────────────────── */}
      <FadeIn>
        <PageHeader
          title={t('admin.segments.title', 'Segments')}
          subtitle={t('admin.segments.subtitle', 'Create member groups based on behavior, activity, or risk level. Use segments to send targeted messages, run campaigns, or export lists.')}
          actions={
            <div className="flex items-center gap-2">
              {segments.length > 0 && (
                <button
                  onClick={() => setShowSuggestions(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-all rounded-lg"
                  style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)' }}
                >
                  <Sparkles size={14} />
                  {t('admin.segments.suggestions', 'Suggestions')}
                </button>
              )}
              <button
                onClick={() => setEditModal('new')}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}
              >
                <Plus size={16} strokeWidth={2.6} />
                {t('admin.segments.create', 'New Segment')}
              </button>
            </div>
          }
        />
      </FadeIn>

      {/* ── Stats row ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2.5 md:gap-3 mt-5">
        <StatCard label={t('admin.segments.totalSegments', 'Segments')} value={segments.length} icon={Filter} borderColor="var(--color-accent)" delay={0} />
        <StatCard label={t('admin.segments.pinned', 'Pinned')} value={pinnedCount} icon={Pin} borderColor="var(--color-admin-text-faint)" delay={50} />
        <StatCard label={t('admin.segments.statAvgSize', 'Avg segment size')} value={avgSegmentSize ?? '—'} icon={Users} borderColor="var(--color-coach)" delay={100} />
      </div>

      {/* ── Main layout: segment list + detail ───────────── */}
      <div className="mt-6">
        {/* Empty state */}
        {!isLoading && segments.length === 0 && (
          <FadeIn>
            {/* "No segments yet" hero card */}
            <div className="admin-card text-center mb-4" style={{ padding: 22 }}>
              <div
                className="flex items-center justify-center mx-auto mb-3"
                style={{ width: 52, height: 52, borderRadius: 14, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
              >
                <Filter size={22} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div
                className="mb-1"
                style={{ fontFamily: 'Archivo, sans-serif', fontSize: 15, fontWeight: 800, color: 'var(--color-admin-text)' }}
              >
                {t('admin.segments.emptyTitle', 'No segments yet')}
              </div>
              <div className="text-[12.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.segments.emptyDesc', 'Create your first segment to group members by behavior or attributes')}
              </div>
            </div>

            {/* "Use template" eyebrow with divider */}
            <div className="flex items-center gap-2 mt-[18px] mb-2.5">
              <Sparkles size={12} style={{ color: 'var(--color-admin-text-muted)' }} />
              <span className="admin-eyebrow">{t('admin.segments.quickStart', 'Use template')}</span>
              <div className="flex-1 h-px" style={{ background: 'var(--color-admin-border)' }} />
            </div>

            {/* 2-col template grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PREBUILT_SEGMENTS.map((seg, i) => (
                <PrebuiltCard key={i} segment={seg} gymId={gymId} adminId={adminId} onCreated={refetch} t={t} />
              ))}
            </div>
          </FadeIn>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 animate-pulse">
                  <div className="h-4 bg-white/5 rounded w-2/3 mb-3" />
                  <div className="h-3 bg-white/5 rounded w-1/2 mb-4" />
                  <div className="h-8 bg-white/5 rounded w-1/3" />
                </div>
              ))}
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-6 animate-pulse hidden lg:block">
              <div className="h-5 bg-white/5 rounded w-1/3 mb-4" />
              <div className="h-3 bg-white/5 rounded w-2/3 mb-6" />
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-white/5" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-white/5 rounded w-1/3" />
                      <div className="h-2.5 bg-white/5 rounded w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Segment list + detail panel */}
        {segments.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            {/* Left: segment list */}
            <div className="space-y-2 lg:max-h-[calc(100vh-250px)] lg:overflow-y-auto lg:pr-1">
              <SectionLabel className="px-0.5 mb-0.5">{t('admin.segments.yourSegments', 'Your segments')} · {segments.length}</SectionLabel>
              {segments.map((seg, i) => (
                <FadeIn key={seg.id} delay={i * 30}>
                  <SegmentListItem
                    segment={seg}
                    isActive={selectedSegment?.id === seg.id}
                    onSelect={() => setSelectedSegment(seg)}
                    onEdit={() => setEditModal(seg)}
                    onDelete={() => handleDelete(seg.id)}
                    onTogglePin={() => handleTogglePin(seg)}
                    t={t}
                  />
                </FadeIn>
              ))}
              <button
                onClick={() => setEditModal('new')}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}
              >
                <Plus size={16} strokeWidth={2.6} />
                {t('admin.segments.newSegment', 'New segment')}
              </button>
            </div>

            {/* Right: detail / members preview */}
            <div className="min-h-[400px]">
              {selectedSegment ? (
                <SegmentDetailPanel
                  segment={selectedSegment}
                  gymId={gymId}
                  adminId={adminId}
                  onEdit={() => setEditModal(selectedSegment)}
                  t={t}
                />
              ) : (
                <AdminCard className="h-full flex items-center justify-center">
                  <div className="text-center py-12">
                    <Users size={28} className="mx-auto text-[#6B7280]/30 mb-3" />
                    <p className="text-[14px] font-medium text-[#6B7280]">
                      {t('admin.segments.selectSegment', 'Select a segment to view members')}
                    </p>
                  </div>
                </AdminCard>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Suggestions modal ────────────────────────────── */}
      {showSuggestions && (
        <AdminModal isOpen onClose={() => setShowSuggestions(false)} title={t('admin.segments.suggestionsTitle', 'Suggested Segments')} titleIcon={Sparkles} size="lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PREBUILT_SEGMENTS.map((seg, i) => (
              <PrebuiltCard key={i} segment={seg} gymId={gymId} adminId={adminId} onCreated={() => { refetch(); setShowSuggestions(false); }} t={t} />
            ))}
          </div>
        </AdminModal>
      )}

      {/* ── Create / Edit modal ──────────────────────────── */}
      {editModal && (
        <SegmentEditorModal
          segment={editModal === 'new' ? null : editModal}
          gymId={gymId}
          adminId={adminId}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); refetch(); }}
        />
      )}
    </AdminPageShell>
  );
}

// ── Segment List Item ──────────────────────────────────────
function SegmentListItem({ segment, isActive, onSelect, onEdit, onDelete, onTogglePin, t }) {
  const IconComp = ICON_MAP[segment.icon] || Users;
  const tone = segment.color || 'var(--color-accent)';

  return (
    <div
      onClick={onSelect}
      className="relative cursor-pointer overflow-hidden transition-all"
      style={{
        background: isActive ? 'var(--color-admin-panel)' : 'var(--color-bg-card)',
        border: `1px solid ${isActive ? 'transparent' : 'var(--color-admin-border)'}`,
        boxShadow: isActive
          ? `0 0 0 1.5px ${tone}, 0 1px 2px rgba(15,20,25,0.04), 0 8px 22px rgba(15,20,25,0.06)`
          : 'none',
        borderRadius: 14,
        padding: '14px 15px 12px',
      }}
    >
      {/* active accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: 3, background: isActive ? tone : 'transparent' }} />

      <div className="flex items-start gap-[11px]">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 34, height: 34, borderRadius: 11, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}
        >
          <IconComp size={17} style={{ color: tone }} />
        </div>
        <div className="min-w-0 flex-1">
          <div style={{ fontFamily: 'var(--admin-font-display)', fontSize: 13.5, fontWeight: 800, color: 'var(--color-admin-text)', letterSpacing: -0.2, lineHeight: 1.25 }}>{segment.name}</div>
          {segment.description && (
            <div style={{ fontSize: 11.5, color: 'var(--color-admin-text-muted)', marginTop: 3, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{segment.description}</div>
          )}
        </div>
        {segment.is_pinned && <Pin size={12} style={{ color: tone, flexShrink: 0, marginTop: 2 }} />}
      </div>

      <div className="flex items-center justify-between" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--color-admin-border)' }}>
        <div className="inline-flex items-center gap-1.5">
          <Users size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
          <span style={{ fontFamily: 'var(--admin-font-mono)', fontSize: 12.5, fontWeight: 700, color: 'var(--color-admin-text)' }}>{segment._count ?? '\u2014'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-admin-text-muted)' }}>{t('admin.segments.members', 'members')}</span>
        </div>

        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <SegIconBtn icon={segment.is_pinned ? PinOff : Pin} tone="soft" size={28} onClick={onTogglePin} hoverColor="var(--color-accent)" title={segment.is_pinned ? t('admin.segments.unpin', 'Unpin') : t('admin.segments.pin', 'Pin')} />
          <SegIconBtn icon={Pencil} tone="soft" size={28} onClick={onEdit} hoverColor="var(--color-info)" title={t('admin.segments.edit', 'Edit')} />
          <SegIconBtn icon={Trash2} tone="soft" size={28} onClick={onDelete} hoverColor="var(--color-danger)" title={t('admin.segments.delete', 'Delete')} />
        </div>
      </div>
    </div>
  );
}

// \u2500\u2500 Small square icon button (token-styled) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function SegIconBtn({ icon: Icon, onClick, title, tone = 'ghost', size = 32, hoverColor = 'var(--color-accent)', disabled = false }) {
  const tones = {
    ghost: { background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' },
    soft:  { background: 'var(--color-bg-subtle)',   border: '1px solid transparent' },
  };
  const ts = tones[tone] || tones.ghost;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ width: size, height: size, borderRadius: 9, color: 'var(--color-admin-text-sub)', cursor: disabled ? 'not-allowed' : 'pointer', ...ts }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = hoverColor; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-admin-text-sub)'; }}
    >
      <Icon size={Math.round(size * 0.47)} />
    </button>
  );
}

// ── Segment Detail Panel ───────────────────────────────────
function SegmentDetailPanel({ segment, gymId, adminId, onEdit, t }) {
  const { i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  // Message-all uses a proper modal (was window.prompt(), which is unreliable in
  // the Capacitor/iOS WKWebView — see project memory on native nav/dialogs).
  const [msgModalOpen, setMsgModalOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);

  const { data: members = [], isLoading } = useQuery({
    queryKey: [...adminKeys.segments.members(gymId, segment.id), refreshKey],
    queryFn: () => applySegmentFilters(gymId, segment.filters || {}),
    enabled: !!gymId,
  });

  // Enrich with churn data
  const { data: churnData = {} } = useQuery({
    queryKey: [...adminKeys.segments.members(gymId, segment.id), 'churn', refreshKey],
    queryFn: async () => {
      const ids = members.map(m => m.id);
      if (!ids.length) return {};
      // Segment can match all gym members — batch to avoid HTTP 414.
      const { data } = await selectInBatches(
        (chunk) => supabase
          .from('churn_risk_scores')
          .select('profile_id, risk_tier, score')
          .eq('gym_id', gymId)
          .in('profile_id', chunk),
        ids
      );
      const map = {};
      (data || []).forEach(r => { map[r.profile_id] = r; });
      return map;
    },
    enabled: !!members.length,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m =>
      (m.full_name || '').toLowerCase().includes(q) ||
      (m.username || '').toLowerCase().includes(q)
    );
  }, [members, search]);

  // Paginate the member list: 10 per page, no internal scroll. Reset to
  // page 1 whenever the result set changes (segment switch, search, refresh).
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, segment.id, refreshKey]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const IconComp = ICON_MAP[segment.icon] || Users;

  const handleExport = () => {
    exportCSV({
      filename: `segment-${segment.name.replace(/\s+/g, '-').toLowerCase()}`,
      columns: [
        { key: 'full_name', label: t('admin.segments.csvName', 'Name') },
        { key: 'username', label: t('admin.segments.csvUsername', 'Username') },
        { key: 'created_at', label: t('admin.segments.csvJoined', 'Joined'), format: v => v ? format(new Date(v), 'yyyy-MM-dd') : '' },
        { key: '_lastWorkoutAt', label: t('admin.segments.csvLastWorkout', 'Last Workout'), format: v => v ? format(new Date(v), 'yyyy-MM-dd') : t('admin.segments.never', 'Never') },
        { key: '_workoutCount', label: t('admin.segments.csvWorkouts', 'Workouts'), format: v => v ?? 0 },
        { key: '_currentStreak', label: t('admin.segments.csvStreak', 'Streak'), format: v => v ?? 0 },
      ],
      data: filtered,
    });
  };

  const handleSendMessage = async () => {
    const message = msgText.trim();
    if (!filtered.length || !message) return;
    setSending(true);

    // Throttle: send in batches of 10 in parallel, then a short pause before the
    // next batch. This avoids hammering Supabase with hundreds of sequential
    // RPC calls and keeps the gym from looking like a spam source.
    const BATCH_SIZE = 10;
    const PAUSE_MS = 250;
    const total = filtered.length;
    let sent = 0;
    let failed = 0;

    const sendOne = async (m) => {
      try {
        const { data: convoId } = await supabase.rpc('get_or_create_conversation', { p_other_user: m.id });
        if (!convoId) { failed++; return; }
        const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
        const seed = convo?.encryption_seed || convoId;
        const encrypted = await encryptMessage(message, convoId, seed);
        await supabase.from('direct_messages').insert({ conversation_id: convoId, sender_id: adminId, body: encrypted });
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);
        sent++;
      } catch (err) {
        failed++;
        logger.error('Segment DM failed for:', m.id, err);
      }
    };

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(sendOne));
      if (i + BATCH_SIZE < total) {
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    }

    setSending(false);
    setMsgModalOpen(false);
    setMsgText('');

    // Surface partial failures so the admin can retry rather than discover later.
    if (failed > 0) {
      showToast(
        t('admin.segments.bulkPartialFailure', { sent, failed, total, defaultValue: 'Sent {{sent}}/{{total}} — {{failed}} failed' }),
        'warning'
      );
    } else {
      showToast(
        t('admin.segments.bulkSent', { count: sent, defaultValue: 'Sent to {{count}} members' }),
        'success'
      );
    }
  };

  const RISK_COLORS = { low: 'var(--color-success)', medium: 'var(--color-warning)', high: 'var(--color-danger)', critical: 'var(--color-danger)' };

  return (
    <AdminCard padding="p-0" className="overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center gap-3" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-admin-border)' }}>
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 11, background: `color-mix(in srgb, ${segment.color || 'var(--color-accent)'} 16%, transparent)` }}>
          <IconComp size={20} style={{ color: segment.color || 'var(--color-accent)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontFamily: 'var(--admin-font-display)', fontSize: 16, fontWeight: 800, color: 'var(--color-admin-text)', letterSpacing: -0.3 }}>{segment.name}</div>
          {segment.description && <div className="truncate" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)', marginTop: 2 }}>{segment.description}</div>}
        </div>
        <div className="text-right flex-shrink-0">
          <div style={{ fontFamily: 'var(--admin-font-display)', fontSize: 30, fontWeight: 800, color: 'var(--color-admin-text)', letterSpacing: -1, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{members.length}</div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--color-admin-text-muted)', marginTop: 3 }}>{t('admin.segments.members', 'members')}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2.5" style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-admin-border)', background: 'var(--color-bg-subtle)' }}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0" style={{ height: 38, padding: '0 13px', background: 'var(--color-admin-panel)', borderRadius: 10, border: '1px solid var(--color-admin-border)' }}>
          <Search size={15} className="flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('admin.segments.searchMembers', 'Search members...')}
            aria-label={t('admin.segments.searchMembers', 'Search members')}
            className="w-full bg-transparent outline-none"
            style={{ fontSize: 13, color: 'var(--color-admin-text)' }}
          />
        </div>
        <SegIconBtn icon={RefreshCw} size={38} onClick={() => setRefreshKey(k => k + 1)} title={t('admin.segments.refresh', 'Refresh')} />
        <SegIconBtn icon={Send} size={38} disabled={!filtered.length} onClick={() => setMsgModalOpen(true)} title={t('admin.segments.sendMessage', 'Message All')} />
        <SegIconBtn icon={Download} size={38} disabled={!filtered.length} onClick={handleExport} title={t('admin.segments.export', 'Export CSV')} />
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 flex-shrink-0 transition-opacity hover:opacity-90"
          style={{ height: 38, padding: '0 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          <Pencil size={14} /> {t('admin.segments.edit', 'Edit')}
        </button>
      </div>

      {/* Message-all modal (replaces window.prompt — native-safe) */}
      {msgModalOpen && (
        <AdminModal
          isOpen
          onClose={() => { if (!sending) { setMsgModalOpen(false); setMsgText(''); } }}
          title={t('admin.segments.sendMessage', 'Message All')}
          titleIcon={Send}
          size="md"
        >
          <div className="space-y-4">
            <p className="text-[13px] text-[#9CA3AF]">
              {t('admin.segments.messageModalDesc', {
                count: filtered.length,
                defaultValue: 'This sends a direct message to all {{count}} members in this segment.',
              })}
            </p>
            <textarea
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              rows={4}
              maxLength={1000}
              autoFocus
              placeholder={t('admin.segments.messagePlaceholder', 'Write your message…')}
              className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setMsgModalOpen(false); setMsgText(''); }}
                disabled={sending}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                onClick={handleSendMessage}
                disabled={sending || !msgText.trim()}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {sending
                  ? t('admin.segments.sending', 'Sending…')
                  : t('admin.segments.sendToCount', { count: filtered.length, defaultValue: 'Send to {{count}}' })}
              </button>
            </div>
          </div>
        </AdminModal>
      )}

      {/* Member list */}
      <div>
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-white/5" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-white/5 rounded w-1/3" />
                  <div className="h-2.5 bg-white/5 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users size={24} className="mx-auto text-[#4B5563] mb-2" />
            <p className="text-[13px] text-[#6B7280]">{t('admin.segments.noMembers', 'No members match these filters')}</p>
          </div>
        ) : (
          <div>
            {pageItems.map((member, i) => {
              const churn = churnData[member.id];
              const tier = churn?.risk_tier;
              const riskColor = tier ? RISK_COLORS[tier] : null;
              const avatarTone = (tier === 'critical' || tier === 'high') ? 'hot' : tier === 'medium' ? 'warn' : undefined;
              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ padding: '11px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--color-admin-border)' }}
                >
                  <Avatar name={member.full_name || member.username} size="md" tone={avatarTone} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-admin-text)', letterSpacing: -0.1 }}>{member.full_name || member.username || t('admin.segments.unknown', 'Unknown')}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-admin-text-muted)', marginTop: 1 }}>
                      {t('admin.segments.joined', 'Joined')} {member.created_at ? format(new Date(member.created_at), 'MMM d, yyyy', dateFnsLocale) : '\u2014'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {member._currentStreak > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-warning-ink, var(--color-warning))' }}>{t('admin.segments.streakDays', '{{count}}d', { count: member._currentStreak })}</span>
                    )}
                    {churn && riskColor && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: riskColor, background: `color-mix(in srgb, ${riskColor} 15%, transparent)` }}>
                        {t(`admin.riskLabels.${tier}`, tier)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination — 10 per page (shared Miembros-style component) */}
      {filtered.length > PAGE_SIZE && (
        <div style={{ padding: '4px 18px 12px', background: 'var(--color-bg-subtle)' }}>
          <AdminPagination
            page={safePage}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </div>
      )}
    </AdminCard>
  );
}

// ── Pre-built Suggestion Card ───────────────────────────────
function PrebuiltCard({ segment, gymId, adminId, onCreated, t }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const IconComp = ICON_MAP[segment.icon] || Users;

  const name = segment.nameKey ? t(segment.nameKey, segment.name) : segment.name;
  const desc = segment.descriptionKey ? t(segment.descriptionKey, segment.description) : segment.description;

  const handleOpen = () => {
    setEditName(name);
    setEditDesc(desc);
    setModalOpen(true);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await supabase.from('member_segments').insert({
        gym_id: gymId,
        name: editName || name,
        description: editDesc || desc,
        filters: segment.filters,
        color: segment.color,
        icon: segment.icon,
        created_by: adminId,
      });
      setModalOpen(false);
      onCreated();
    } catch (err) {
      logger.error('PrebuiltCard create:', err);
    } finally {
      setSaving(false);
    }
  };

  // Filter summary
  const filterLabels = [];
  const f = segment.filters;
  if (f.last_workout_days_ago_gt) filterLabels.push(`${f.last_workout_days_ago_gt}d+ ${t('admin.segments.filterInactive', 'inactive')}`);
  if (f.last_workout_days_ago_lt) filterLabels.push(`<${f.last_workout_days_ago_lt}d ${t('admin.segments.filterActive', 'active')}`);
  if (f.workout_count_gt) filterLabels.push(`${f.workout_count_gt}+ ${t('admin.segments.filterWorkouts', 'workouts')}`);
  if (f.workout_count_lt != null) filterLabels.push(`<${f.workout_count_lt} ${t('admin.segments.filterWorkouts', 'workouts')}`);
  if (f.streak_gt) filterLabels.push(`${f.streak_gt}+ ${t('admin.segments.filterStreak', 'day streak')}`);
  if (f.churn_tier?.length) filterLabels.push(f.churn_tier.map(tier => t(`admin.riskLabels.${tier}`, tier)).join(', '));
  if (f.fitness_level?.length) filterLabels.push(f.fitness_level.map(level => t(`admin.segments.fitnessLevel.${level}`, level)).join(', '));
  if (f.joined_after) filterLabels.push(t('admin.segments.filterJoinedAfter', 'Joined recently'));
  if (f.joined_before) filterLabels.push(t('admin.segments.filterLongTerm', 'Long-term'));

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full text-left rounded-xl transition-all duration-200 group hover:-translate-y-0.5"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-admin-border)',
          borderLeft: `3px solid ${segment.color}`,
          padding: 14,
          display: 'flex',
          gap: 12,
        }}
      >
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 34, height: 34, borderRadius: 9, background: `color-mix(in srgb, ${segment.color} 18%, transparent)` }}
        >
          <IconComp size={15} style={{ color: segment.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="mb-[3px]"
            style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-admin-text)' }}
          >
            {name}
          </div>
          <div className="mb-[7px] text-[11.5px] leading-[1.4]" style={{ color: 'var(--color-admin-text-muted)' }}>
            {desc}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filterLabels.map((fl, i) => (
              <span
                key={i}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                style={{ color: segment.color, background: `color-mix(in srgb, ${segment.color} 12%, transparent)` }}
              >
                {fl}
              </span>
            ))}
          </div>
        </div>
        <div
          className="flex-shrink-0 flex items-center justify-center"
          style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--color-admin-text-muted)' }}
        >
          <Plus size={14} />
        </div>
      </button>

      {modalOpen && (
        <AdminModal isOpen onClose={() => setModalOpen(false)} title={t('admin.segments.previewSegment', 'Segment Preview')} size="sm">
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl border border-white/6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${segment.color}15` }}>
                <IconComp size={18} style={{ color: segment.color }} />
              </div>
              <div>
                <p className="text-[13px] font-bold text-[#E5E7EB]">{name}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {filterLabels.map((fl, i) => (
                    <span key={i} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ color: segment.color, background: `${segment.color}10` }}>{fl}</span>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.segments.segmentName', 'Name')}</label>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                maxLength={80}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.segments.segmentDescription', 'Description')}</label>
              <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 transition-colors resize-none" />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors">
                {t('common:cancel', 'Cancel')}
              </button>
              <button onClick={handleCreate} disabled={saving || !editName.trim()}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black disabled:opacity-50 transition-opacity">
                {saving ? '...' : t('admin.segments.createSegment', 'Create Segment')}
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </>
  );
}


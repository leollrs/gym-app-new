import { useState, useMemo, useCallback } from 'react';
import {
  Filter, Plus, Pin, PinOff, Pencil, Trash2, Users, Search,
  RefreshCw, Download, MessageSquare, ChevronLeft, Sparkles,
  Shield, AlertTriangle, Zap, Clock, UserPlus, Target,
  Activity, Flame, Heart, Star, Eye, Send,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, subDays, subMonths } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
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

// ── Icon map for segment cards ──────────────────────────────
const ICON_MAP = {
  users: Users, shield: Shield, 'alert-triangle': AlertTriangle,
  zap: Zap, clock: Clock, 'user-plus': UserPlus, target: Target,
  activity: Activity, flame: Flame, heart: Heart, star: Star, eye: Eye,
};

const ICON_OPTIONS = Object.keys(ICON_MAP);

const COLOR_OPTIONS = [
  '#D4AF37', '#EF4444', '#F97316', '#22C55E', '#3B82F6',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#6366F1',
];

// ── Pre-built segment suggestions ───────────────────────────
const PREBUILT_SEGMENTS = [
  {
    name: 'At Risk — No workout in 2 weeks',
    nameKey: 'admin.segments.prebuilt.atRisk',
    description: 'Members who haven\'t logged a workout in 14+ days',
    descriptionKey: 'admin.segments.prebuilt.atRiskDesc',
    filters: { last_workout_days_ago_gt: 14 },
    color: '#EF4444',
    icon: 'alert-triangle',
  },
  {
    name: 'New Members (last 30 days)',
    nameKey: 'admin.segments.prebuilt.newMembers',
    description: 'Members who joined in the last 30 days',
    descriptionKey: 'admin.segments.prebuilt.newMembersDesc',
    filters: { joined_after: format(subDays(new Date(), 30), 'yyyy-MM-dd') },
    color: '#3B82F6',
    icon: 'user-plus',
  },
  {
    name: 'Power Users',
    nameKey: 'admin.segments.prebuilt.powerUsers',
    description: '10+ workouts with an active streak',
    descriptionKey: 'admin.segments.prebuilt.powerUsersDesc',
    filters: { workout_count_gt: 10, streak_gt: 3 },
    color: '#22C55E',
    icon: 'zap',
  },
  {
    name: 'Inactive (30+ days)',
    nameKey: 'admin.segments.prebuilt.inactive',
    description: 'No workout in 30+ days — high churn risk',
    descriptionKey: 'admin.segments.prebuilt.inactiveDesc',
    filters: { last_workout_days_ago_gt: 30 },
    color: '#F97316',
    icon: 'clock',
  },
  {
    name: 'Consistent Trainers',
    nameKey: 'admin.segments.prebuilt.consistentTrainers',
    description: 'Members with a 7+ day streak',
    descriptionKey: 'admin.segments.prebuilt.consistentTrainersDesc',
    filters: { streak_gt: 7 },
    color: '#22C55E',
    icon: 'flame',
  },
  {
    name: 'At Risk — Critical',
    nameKey: 'admin.segments.prebuilt.atRiskCritical',
    description: 'Churn score critical tier',
    descriptionKey: 'admin.segments.prebuilt.atRiskCriticalDesc',
    filters: { churn_tier: ['critical'] },
    color: '#EF4444',
    icon: 'shield',
  },
  {
    name: 'At Risk — High',
    nameKey: 'admin.segments.prebuilt.atRiskHigh',
    description: 'Churn score high tier',
    descriptionKey: 'admin.segments.prebuilt.atRiskHighDesc',
    filters: { churn_tier: ['high'] },
    color: '#F97316',
    icon: 'alert-triangle',
  },
  {
    name: 'Beginners',
    nameKey: 'admin.segments.prebuilt.beginners',
    description: 'Fitness level beginner',
    descriptionKey: 'admin.segments.prebuilt.beginnersDesc',
    filters: { fitness_level: ['beginner'] },
    color: '#3B82F6',
    icon: 'target',
  },
  {
    name: 'Advanced Athletes',
    nameKey: 'admin.segments.prebuilt.advancedAthletes',
    description: 'Fitness level advanced',
    descriptionKey: 'admin.segments.prebuilt.advancedAthletesDesc',
    filters: { fitness_level: ['advanced'] },
    color: '#8B5CF6',
    icon: 'star',
  },
  {
    name: 'Recently Active',
    nameKey: 'admin.segments.prebuilt.recentlyActive',
    description: 'Last workout within 3 days',
    descriptionKey: 'admin.segments.prebuilt.recentlyActiveDesc',
    filters: { last_workout_days_ago_lt: 3 },
    color: '#14B8A6',
    icon: 'activity',
  },
  {
    name: 'No Workouts Yet',
    nameKey: 'admin.segments.prebuilt.noWorkouts',
    description: 'Members who never logged a workout',
    descriptionKey: 'admin.segments.prebuilt.noWorkoutsDesc',
    filters: { workout_count_lt: 1 },
    color: '#6366F1',
    icon: 'eye',
  },
  {
    name: 'Long-term Members',
    nameKey: 'admin.segments.prebuilt.longTermMembers',
    description: 'Joined 6+ months ago',
    descriptionKey: 'admin.segments.prebuilt.longTermMembersDesc',
    filters: { joined_before: format(subMonths(new Date(), 6), 'yyyy-MM-dd') },
    color: '#D4AF37',
    icon: 'heart',
  },
];

// ── Apply segment filters to build Supabase query ───────────
async function applySegmentFilters(gymId, filters) {
  let query = supabase
    .from('profiles')
    .select('id, full_name, username, created_at, last_active_at, fitness_level, avatar_type, avatar_value')
    .eq('gym_id', gymId)
    .eq('role', 'member');

  if (filters.joined_after) {
    query = query.gte('created_at', filters.joined_after);
  }
  if (filters.joined_before) {
    query = query.lte('created_at', filters.joined_before);
  }
  if (filters.fitness_level?.length) {
    query = query.in('fitness_level', filters.fitness_level);
  }
  // Note: streak filtering requires join to streak_cache table
  // These filters are applied client-side after fetch if needed

  const { data: members, error } = await query.order('full_name').limit(500);
  if (error) {
    logger.error('applySegmentFilters: profiles query', error);
    return [];
  }

  let filtered = members || [];

  // Post-query filters that need join data
  if (
    filters.last_workout_days_ago_gt != null ||
    filters.last_workout_days_ago_lt != null ||
    filters.workout_count_lt != null ||
    filters.workout_count_gt != null
  ) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, started_at')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .in('profile_id', memberIds);

      const sessionMap = {};
      const lastSessionMap = {};
      (sessions || []).forEach(s => {
        sessionMap[s.profile_id] = (sessionMap[s.profile_id] || 0) + 1;
        if (!lastSessionMap[s.profile_id] || s.started_at > lastSessionMap[s.profile_id]) {
          lastSessionMap[s.profile_id] = s.started_at;
        }
      });

      const now = Date.now();
      const MS_PER_DAY = 86400000;

      filtered = filtered.filter(m => {
        const count = sessionMap[m.id] || 0;
        const lastSession = lastSessionMap[m.id];
        const daysSinceWorkout = lastSession
          ? Math.floor((now - new Date(lastSession).getTime()) / MS_PER_DAY)
          : 9999;

        if (filters.last_workout_days_ago_gt != null && daysSinceWorkout <= filters.last_workout_days_ago_gt) return false;
        if (filters.last_workout_days_ago_lt != null && daysSinceWorkout >= filters.last_workout_days_ago_lt) return false;
        if (filters.workout_count_lt != null && count >= filters.workout_count_lt) return false;
        if (filters.workout_count_gt != null && count <= filters.workout_count_gt) return false;
        return true;
      });

      // Attach computed data
      filtered = filtered.map(m => ({
        ...m,
        _workoutCount: sessionMap[m.id] || 0,
        _lastWorkoutAt: lastSessionMap[m.id] || null,
      }));
    }
  }

  // Churn tier filter
  if (filters.churn_tier?.length) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const { data: churnRows } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, risk_tier')
        .eq('gym_id', gymId)
        .in('profile_id', memberIds)
        .in('risk_tier', filters.churn_tier);

      const churnSet = new Set((churnRows || []).map(r => r.profile_id));
      filtered = filtered.filter(m => churnSet.has(m.id));
    }
  }

  // Referral filter
  if (filters.has_referral === true || filters.has_referral === false) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const { data: referrals } = await supabase
        .from('referrals')
        .select('referrer_id')
        .eq('gym_id', gymId)
        .in('referrer_id', memberIds);

      const referrerSet = new Set((referrals || []).map(r => r.referrer_id));
      filtered = filtered.filter(m =>
        filters.has_referral ? referrerSet.has(m.id) : !referrerSet.has(m.id)
      );
    }
  }

  return filtered;
}

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
                  className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] bg-white/[0.03] hover:bg-white/[0.06] border border-white/6 rounded-lg transition-all"
                >
                  <Sparkles size={14} />
                  {t('admin.segments.suggestions', 'Suggestions')}
                </button>
              )}
              <button
                onClick={() => setEditModal('new')}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold text-[#05070B] bg-[#D4AF37] hover:bg-[#C5A028] rounded-lg transition-colors"
              >
                <Plus size={14} />
                {t('admin.segments.create', 'New Segment')}
              </button>
            </div>
          }
        />
      </FadeIn>

      {/* ── Stats row ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mt-5">
        <StatCard label={t('admin.segments.totalSegments', 'Segments')} value={segments.length} icon={Filter} borderColor="#D4AF37" delay={0} />
        <StatCard label={t('admin.segments.pinned', 'Pinned')} value={pinnedCount} icon={Pin} borderColor="#3B82F6" delay={50} />
        <StatCard label={t('admin.segments.totalTracked', 'Members Tracked')} value={totalMembers} icon={Users} borderColor="#22C55E" delay={100} />
      </div>

      {/* ── Main layout: segment list + detail ───────────── */}
      <div className="mt-6">
        {/* Empty state */}
        {!isLoading && segments.length === 0 && (
          <FadeIn>
            <AdminCard className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4">
                <Filter size={24} className="text-[#D4AF37]" />
              </div>
              <p className="text-[15px] font-bold text-[#E5E7EB] mb-1">
                {t('admin.segments.emptyTitle', 'No segments yet')}
              </p>
              <p className="text-[13px] text-[#6B7280] mb-6 max-w-sm mx-auto">
                {t('admin.segments.emptyDesc', 'Create smart lists to group members by behavior, risk level, or activity patterns.')}
              </p>

              <SectionLabel icon={Sparkles} className="justify-center mb-3">
                {t('admin.segments.quickStart', 'Quick Start')}
              </SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PREBUILT_SEGMENTS.map((seg, i) => (
                  <PrebuiltCard key={i} segment={seg} gymId={gymId} adminId={adminId} onCreated={refetch} t={t} />
                ))}
              </div>
            </AdminCard>
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
            <div className="space-y-2 lg:max-h-[calc(100vh-280px)] lg:overflow-y-auto lg:pr-1">
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

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-[14px] border p-3.5 transition-all ${
        isActive
          ? 'bg-[#0F172A] border-[#D4AF37]/30 ring-1 ring-[#D4AF37]/15'
          : 'bg-[#0F172A] border-white/6 hover:border-white/10'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${segment.color}18` }}
          >
            <IconComp size={15} style={{ color: segment.color }} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-[#E5E7EB] truncate">{segment.name}</p>
            {segment.description && (
              <p className="text-[11px] text-[#6B7280] truncate">{segment.description}</p>
            )}
          </div>
        </div>
        {segment.is_pinned && <Pin size={12} className="text-[#D4AF37] flex-shrink-0 mt-1" />}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users size={12} className="text-[#6B7280]" />
          <span className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">
            {segment._count ?? '\u2014'}
          </span>
          <span className="text-[11px] text-[#6B7280]">{t('admin.segments.members', 'members')}</span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 sm:opacity-100" onClick={e => e.stopPropagation()}>
          <button
            onClick={onTogglePin}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:text-[#D4AF37] hover:bg-white/[0.04] transition-all"
            title={segment.is_pinned ? t('admin.segments.unpin', 'Unpin') : t('admin.segments.pin', 'Pin')}
            aria-label={segment.is_pinned ? t('admin.segments.unpin', 'Unpin') : t('admin.segments.pin', 'Pin')}
          >
            {segment.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button
            onClick={onEdit}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:text-[#3B82F6] hover:bg-white/[0.04] transition-all"
            title={t('admin.segments.edit', 'Edit')}
            aria-label={t('admin.segments.edit', 'Edit')}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:text-[#EF4444] hover:bg-white/[0.04] transition-all"
            title={t('admin.segments.delete', 'Delete')}
            aria-label={t('admin.segments.delete', 'Delete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Segment Detail Panel ───────────────────────────────────
function SegmentDetailPanel({ segment, gymId, adminId, onEdit, t }) {
  const { i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

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
      const { data } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, risk_tier, score')
        .eq('gym_id', gymId)
        .in('profile_id', ids);
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
        { key: 'current_streak', label: t('admin.segments.csvStreak', 'Streak'), format: v => v ?? 0 },
      ],
      data: filtered,
    });
  };

  const handleSendMessage = async () => {
    if (!filtered.length) return;
    const message = prompt(t('admin.segments.messagePrompt', 'Message to send to all members in this segment:'));
    if (!message?.trim()) return;

    for (const m of filtered) {
      try {
        const { data: convoId } = await supabase.rpc('get_or_create_conversation', { p_other_user: m.id });
        if (!convoId) continue;
        const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
        const seed = convo?.encryption_seed || convoId;
        const encrypted = await encryptMessage(message.trim(), convoId, seed);
        await supabase.from('direct_messages').insert({ conversation_id: convoId, sender_id: authUser?.id, body: encrypted });
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);
      } catch (err) {
        logger.error('Segment DM failed for:', m.id, err);
      }
    }
  };

  const RISK_COLORS = { low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444' };

  return (
    <AdminCard padding="p-0" className="overflow-hidden">
      {/* Panel header */}
      <div className="px-5 py-4 border-b border-white/[0.04]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${segment.color}18` }}>
            <IconComp size={18} style={{ color: segment.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold text-[#E5E7EB] truncate">{segment.name}</p>
            {segment.description && <p className="text-[12px] text-[#6B7280] truncate">{segment.description}</p>}
          </div>
          <span className="text-[22px] font-bold text-[#E5E7EB] tabular-nums flex-shrink-0">{members.length}</span>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('admin.segments.searchMembers', 'Search members...')}
              aria-label={t('admin.segments.searchMembers', 'Search members')}
              className="w-full bg-white/[0.04] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/40"
            />
          </div>
          <button onClick={() => setRefreshKey(k => k + 1)} className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] bg-white/[0.03] hover:bg-white/[0.06] border border-white/6 rounded-lg transition-all" title={t('admin.segments.refresh', 'Refresh')} aria-label={t('admin.segments.refresh', 'Refresh')}>
            <RefreshCw size={13} />
          </button>
          <button onClick={handleSendMessage} disabled={!filtered.length} className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] bg-white/[0.03] hover:bg-white/[0.06] border border-white/6 rounded-lg transition-all disabled:opacity-40" title={t('admin.segments.sendMessage', 'Message All')} aria-label={t('admin.segments.sendMessage', 'Message All')}>
            <Send size={13} />
          </button>
          <button onClick={handleExport} disabled={!filtered.length} className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] bg-white/[0.03] hover:bg-white/[0.06] border border-white/6 rounded-lg transition-all disabled:opacity-40" title={t('admin.segments.export', 'Export CSV')} aria-label={t('admin.segments.export', 'Export CSV')}>
            <Download size={13} />
          </button>
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#D4AF37] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/18 rounded-lg transition-colors">
            <Pencil size={13} /> {t('admin.segments.edit', 'Edit')}
          </button>
        </div>
      </div>

      {/* Member list */}
      <div className="lg:max-h-[calc(100vh-420px)] overflow-y-auto">
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
          <div className="divide-y divide-white/[0.04]">
            {filtered.map(member => {
              const churn = churnData[member.id];
              const riskColor = churn ? RISK_COLORS[churn.risk_tier] : null;
              return (
                <div key={member.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <Avatar name={member.full_name || member.username} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{member.full_name || member.username || t('admin.segments.unknown', 'Unknown')}</p>
                    <p className="text-[11px] text-[#6B7280] truncate">
                      {t('admin.segments.joined', 'Joined')} {member.created_at ? format(new Date(member.created_at), 'MMM d, yyyy', dateFnsLocale) : '\u2014'}
                      {member._lastWorkoutAt && (
                        <> &middot; {t('admin.segments.lastWorkout', 'Last workout')} {format(new Date(member._lastWorkoutAt), 'MMM d', dateFnsLocale)}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {member.current_streak > 0 && (
                      <span className="text-[11px] text-[#F59E0B] font-medium">{member.current_streak}d</span>
                    )}
                    {churn && (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border"
                        style={{ color: riskColor, background: `${riskColor}15`, borderColor: `${riskColor}30` }}
                      >
                        {churn.risk_tier}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
  if (f.churn_tier?.length) filterLabels.push(f.churn_tier.join(', '));
  if (f.fitness_level?.length) filterLabels.push(f.fitness_level.join(', '));
  if (f.joined_after) filterLabels.push(t('admin.segments.filterJoinedAfter', 'Joined recently'));
  if (f.joined_before) filterLabels.push(t('admin.segments.filterLongTerm', 'Long-term'));

  return (
    <>
      <button onClick={handleOpen} className="w-full text-left bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden hover:border-white/12 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 group">
        {/* Colored top accent bar */}
        <div className="h-1" style={{ background: segment.color }} />

        {/* Header: icon + name */}
        <div className="flex items-center gap-3 px-4 pt-3.5 pb-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${segment.color}15` }}
          >
            <IconComp size={16} style={{ color: segment.color }} />
          </div>
          <p className="text-[14px] font-bold text-[#E5E7EB]">{name}</p>
        </div>

        {/* Description */}
        <div className="px-4 pb-3 border-b border-white/4">
          <p className="text-[12px] text-[#9CA3AF] leading-relaxed">{desc}</p>
        </div>

        {/* Filters */}
        <div className="px-4 py-2.5 bg-white/[0.015]">
          <div className="flex flex-wrap gap-1.5">
            {filterLabels.map((fl, i) => (
              <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ color: segment.color, background: `${segment.color}12` }}>
                {fl}
              </span>
            ))}
          </div>
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

// ── Segment Editor Modal ────────────────────────────────────
function SegmentEditorModal({ segment, gymId, adminId, onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const isEditing = !!segment;

  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [color, setColor] = useState(segment?.color || '#D4AF37');
  const [icon, setIcon] = useState(segment?.icon || 'users');
  const [filters, setFilters] = useState(segment?.filters || {});
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const updateFilter = (key, value) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    setPreviewCount(null);
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const members = await applySegmentFilters(gymId, filters);
      setPreviewCount(members.length);
    } catch {
      setPreviewCount(0);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await supabase.from('member_segments').update({
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          filters,
          updated_at: new Date().toISOString(),
        }).eq('id', segment.id).eq('gym_id', gymId);
      } else {
        await supabase.from('member_segments').insert({
          gym_id: gymId,
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          filters,
          created_by: adminId,
        });
      }
      onSaved();
    } catch (err) {
      logger.error('SegmentEditorModal save:', err);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full bg-white/[0.04] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37]/30 transition-all';

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={isEditing ? t('admin.segments.editSegment', 'Edit Segment') : t('admin.segments.createSegment', 'Create Segment')}
      titleIcon={Filter}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="flex-1 py-2.5 text-[13px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] bg-white/[0.04] hover:bg-white/[0.06] border border-white/6 rounded-lg transition-all">
            {t('admin.segments.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 text-[13px] font-bold text-[#05070B] bg-[#D4AF37] hover:bg-[#C5A028] rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? '...' : isEditing ? t('admin.segments.save', 'Save Changes') : t('admin.segments.create', 'Create Segment')}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Name + Description */}
        <div className="space-y-3">
          <SectionLabel icon={Pencil}>{t('admin.segments.details', 'Details')}</SectionLabel>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('admin.segments.namePlaceholder', 'Segment name...')}
            aria-label={t('admin.segments.namePlaceholder', 'Segment name')}
            className={inputClass}
            maxLength={80}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('admin.segments.descPlaceholder', 'Optional description...')}
            aria-label={t('admin.segments.descPlaceholder', 'Optional description')}
            className={inputClass}
            maxLength={200}
          />
        </div>

        {/* Color + Icon */}
        <div className="space-y-3">
          <SectionLabel icon={Star}>{t('admin.segments.appearance', 'Appearance')}</SectionLabel>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-[11px] text-[#6B7280] mb-1.5">{t('admin.segments.color', 'Color')}</p>
              <div className="flex items-center gap-1.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white/30 ring-offset-1 ring-offset-[#0F172A] scale-110' : 'hover:scale-105'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-[#6B7280] mb-1.5">{t('admin.segments.icon', 'Icon')}</p>
              <div className="flex items-center gap-1 flex-wrap">
                {ICON_OPTIONS.map(ic => {
                  const IC = ICON_MAP[ic];
                  return (
                    <button
                      key={ic}
                      onClick={() => setIcon(ic)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${icon === ic ? 'bg-white/10 text-[#E5E7EB]' : 'text-[#4B5563] hover:text-[#6B7280] hover:bg-white/[0.04]'}`}
                    >
                      <IC size={14} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <SectionLabel icon={Filter}>{t('admin.segments.filters', 'Filters')}</SectionLabel>

          {/* Joined date range */}
          <FilterRow label={t('admin.segments.filterJoinedAfter', 'Joined after')}>
            <input
              type="date"
              value={filters.joined_after || ''}
              onChange={e => updateFilter('joined_after', e.target.value)}
              className={inputClass}
            />
          </FilterRow>
          <FilterRow label={t('admin.segments.filterJoinedBefore', 'Joined before')}>
            <input
              type="date"
              value={filters.joined_before || ''}
              onChange={e => updateFilter('joined_before', e.target.value)}
              className={inputClass}
            />
          </FilterRow>

          {/* Last workout */}
          <FilterRow label={t('admin.segments.filterLastWorkout', 'No workout in X+ days')}>
            <input
              type="number"
              min="1"
              value={filters.last_workout_days_ago_gt ?? ''}
              onChange={e => updateFilter('last_workout_days_ago_gt', e.target.value ? Number(e.target.value) : null)}
              placeholder="14"
              className={inputClass}
            />
          </FilterRow>

          {/* Total workouts */}
          <FilterRow label={t('admin.segments.filterWorkoutsLt', 'Total workouts less than')}>
            <input
              type="number"
              min="0"
              value={filters.workout_count_lt ?? ''}
              onChange={e => updateFilter('workout_count_lt', e.target.value ? Number(e.target.value) : null)}
              placeholder="5"
              className={inputClass}
            />
          </FilterRow>
          <FilterRow label={t('admin.segments.filterWorkoutsGt', 'Total workouts greater than')}>
            <input
              type="number"
              min="0"
              value={filters.workout_count_gt ?? ''}
              onChange={e => updateFilter('workout_count_gt', e.target.value ? Number(e.target.value) : null)}
              placeholder="10"
              className={inputClass}
            />
          </FilterRow>

          {/* Streak */}
          <FilterRow label={t('admin.segments.filterStreakLt', 'Streak less than')}>
            <input
              type="number"
              min="0"
              value={filters.streak_lt ?? ''}
              onChange={e => updateFilter('streak_lt', e.target.value ? Number(e.target.value) : null)}
              placeholder="3"
              className={inputClass}
            />
          </FilterRow>
          <FilterRow label={t('admin.segments.filterStreakGt', 'Streak greater than')}>
            <input
              type="number"
              min="0"
              value={filters.streak_gt ?? ''}
              onChange={e => updateFilter('streak_gt', e.target.value ? Number(e.target.value) : null)}
              placeholder="7"
              className={inputClass}
            />
          </FilterRow>

          {/* Churn tier */}
          <FilterRow label={t('admin.segments.filterChurnTier', 'Churn risk tier')}>
            <div className="flex flex-wrap gap-1.5">
              {['low', 'medium', 'high', 'critical'].map(tier => {
                const active = (filters.churn_tier || []).includes(tier);
                const tierColors = { low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444' };
                return (
                  <button
                    key={tier}
                    onClick={() => {
                      const prev = filters.churn_tier || [];
                      updateFilter('churn_tier', active ? prev.filter(t => t !== tier) : [...prev, tier]);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                      active
                        ? 'border-white/10 text-[#E5E7EB]'
                        : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] hover:border-white/8'
                    }`}
                    style={active ? { background: `${tierColors[tier]}20`, borderColor: `${tierColors[tier]}40` } : {}}
                  >
                    {t(`admin.riskLabels.${tier}`, tier)}
                  </button>
                );
              })}
            </div>
          </FilterRow>

          {/* Fitness level */}
          <FilterRow label={t('admin.segments.filterFitnessLevel', 'Fitness level')}>
            <div className="flex flex-wrap gap-1.5">
              {['beginner', 'intermediate', 'advanced'].map(level => {
                const active = (filters.fitness_level || []).includes(level);
                return (
                  <button
                    key={level}
                    onClick={() => {
                      const prev = filters.fitness_level || [];
                      updateFilter('fitness_level', active ? prev.filter(l => l !== level) : [...prev, level]);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                      active
                        ? 'bg-[#D4AF37]/15 border-[#D4AF37]/30 text-[#E5E7EB]'
                        : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] hover:border-white/8'
                    }`}
                  >
                    {t(`admin.segments.fitnessLevels.${level}`, level)}
                  </button>
                );
              })}
            </div>
          </FilterRow>

          {/* Has referral */}
          <FilterRow label={t('admin.segments.filterReferral', 'Has made referral')}>
            <div className="flex items-center gap-2">
              {[
                { label: t('admin.segments.any', 'Any'), value: undefined },
                { label: t('admin.segments.yes', 'Yes'), value: true },
                { label: t('admin.segments.no', 'No'), value: false },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => updateFilter('has_referral', opt.value)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                    filters.has_referral === opt.value
                      ? 'bg-[#D4AF37]/15 border-[#D4AF37]/30 text-[#E5E7EB]'
                      : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] hover:border-white/8'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FilterRow>
        </div>

        {/* Live preview */}
        <div className="flex items-center gap-3 pt-2 border-t border-white/6">
          <button
            onClick={handlePreview}
            disabled={previewLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#D4AF37] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/18 rounded-lg transition-colors disabled:opacity-50"
          >
            <Eye size={13} />
            {previewLoading ? '...' : t('admin.segments.preview', 'Preview Count')}
          </button>
          {previewCount !== null && (
            <span className="text-[13px] font-bold text-[#E5E7EB]">
              {previewCount} {t('admin.segments.matchingMembers', 'matching members')}
            </span>
          )}
        </div>
      </div>
    </AdminModal>
  );
}

// ── Filter Row ──────────────────────────────────────────────
function FilterRow({ label, children }) {
  return (
    <label className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 items-start">
      <span className="text-[12px] text-[#9CA3AF] font-medium pt-2 sm:text-right">{label}</span>
      <div>{children}</div>
    </label>
  );
}

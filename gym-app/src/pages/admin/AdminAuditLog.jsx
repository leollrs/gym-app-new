import { useState, useMemo, useCallback, useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ClipboardList, Download, ChevronDown, ChevronUp, Filter,
  User, Settings, FileText, ShieldAlert, Calendar,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, FadeIn, CardSkeleton } from '../../components/admin';

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const ACTION_TYPES = [
  'member_invited',
  'member_deleted',
  'role_changed',
  'setting_updated',
  'challenge_created',
  'announcement_published',
  'class_created',
  'program_created',
  'store_item_created',
  'trainer_added',
  'trainer_demoted',
  'moderation_action',
];

const DATE_PRESETS = [
  { key: 'today', days: 0 },
  { key: '7d',    days: 7 },
  { key: '30d',   days: 30 },
  { key: '90d',   days: 90 },
];

// Action type → color category
const ACTION_COLORS = {
  member_invited:          'text-blue-400 bg-blue-500/10 border-blue-500/20',
  member_deleted:          'text-blue-400 bg-blue-500/10 border-blue-500/20',
  role_changed:            'text-red-400 bg-red-500/10 border-red-500/20',
  setting_updated:         'text-amber-400 bg-amber-500/10 border-amber-500/20',
  challenge_created:       'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  announcement_published:  'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  class_created:           'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  program_created:         'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  store_item_created:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  trainer_added:           'text-blue-400 bg-blue-500/10 border-blue-500/20',
  trainer_demoted:         'text-red-400 bg-red-500/10 border-red-500/20',
  moderation_action:       'text-red-400 bg-red-500/10 border-red-500/20',
};

const fallbackColor = 'text-[#9CA3AF] bg-white/6 border-white/10';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getActionColor(action) {
  return ACTION_COLORS[action] || fallbackColor;
}

function relativeTime(ts) {
  if (!ts) return '—';
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return '—'; }
}

function absoluteTime(ts) {
  if (!ts) return '';
  try { return format(new Date(ts), 'MMM d, yyyy HH:mm:ss'); }
  catch { return ''; }
}

function formatDetails(details) {
  if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return null;
  return JSON.stringify(details, null, 2);
}

function buildCSVRows(pages) {
  const rows = [];
  for (const page of pages) {
    for (const entry of page) {
      rows.push({
        date: entry.created_at ? format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
        actor: entry.profiles?.full_name || entry.actor_id,
        action: entry.action,
        entity_type: entry.entity_type || '',
        entity_id: entry.entity_id || '',
        details: entry.details ? JSON.stringify(entry.details) : '',
      });
    }
  }
  return rows;
}

function downloadCSV(rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_log_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminAuditLog() {
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');

  const [actionFilter, setActionFilter] = useState('all');
  const [datePreset, setDatePreset] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { document.title = 'Admin - Audit Log | TuGymPR'; }, []);

  // Compute date range
  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : null,
        to: customTo ? new Date(customTo + 'T23:59:59').toISOString() : null,
      };
    }
    const preset = DATE_PRESETS.find(p => p.key === datePreset);
    if (!preset) return { from: null, to: null };
    if (preset.days === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return { from: today.toISOString(), to: null };
    }
    return { from: subDays(new Date(), preset.days).toISOString(), to: null };
  }, [datePreset, customFrom, customTo]);

  // ── Infinite query ──
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: adminKeys.auditLog.list(gymId, actionFilter, datePreset, customFrom, customTo),
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from('admin_audit_log')
        .select('id, gym_id, actor_id, action, entity_type, entity_id, details, created_at, profiles!admin_audit_log_actor_id_fkey(full_name, avatar_url)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (actionFilter !== 'all') {
        query = query.eq('action', actionFilter);
      }
      if (dateRange.from) {
        query = query.gte('created_at', dateRange.from);
      }
      if (dateRange.to) {
        query = query.lte('created_at', dateRange.to);
      }

      const { data: rows, error } = await query;
      if (error) throw error;
      return rows || [];
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((sum, p) => sum + p.length, 0);
    },
    enabled: !!gymId,
  });

  const entries = useMemo(() => data?.pages?.flat() || [], [data]);

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    if (!data?.pages) return;
    const rows = buildCSVRows(data.pages);
    downloadCSV(rows);
  }, [data]);

  // ── Render ──

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6 sm:px-6 space-y-6">
      <PageHeader
        title={t('admin.audit.title')}
        subtitle={t('admin.audit.subtitle')}
        icon={ClipboardList}
      />

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <FadeIn>
        <AdminCard>
          <div className="flex flex-wrap items-center gap-3">
            {/* Filter toggle (mobile) */}
            <button
              onClick={() => setShowFilters(f => !f)}
              className="sm:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] border border-white/6 hover:border-white/10 transition-colors"
            >
              <Filter size={14} />
              {tc('filters')}
            </button>

            {/* Action filter */}
            <div className={`${showFilters ? 'flex' : 'hidden'} sm:flex items-center gap-2 flex-wrap`}>
              <select
                value={actionFilter}
                onChange={e => setActionFilter(e.target.value)}
                className="bg-white/[0.04] border border-white/6 rounded-lg px-3 py-1.5 text-[13px] text-[#E5E7EB] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
              >
                <option value="all">{t('admin.audit.allActions')}</option>
                {ACTION_TYPES.map(a => (
                  <option key={a} value={a}>{t(`admin.audit.actions.${a}`)}</option>
                ))}
              </select>

              {/* Date presets */}
              <div className="flex items-center gap-1">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setDatePreset(p.key)}
                    className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                      datePreset === p.key
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                        : 'text-[#6B7280] hover:text-[#9CA3AF] border border-white/6 hover:border-white/10'
                    }`}
                  >
                    {t(`admin.audit.date.${p.key}`)}
                  </button>
                ))}
                <button
                  onClick={() => setDatePreset('custom')}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                    datePreset === 'custom'
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                      : 'text-[#6B7280] hover:text-[#9CA3AF] border border-white/6 hover:border-white/10'
                  }`}
                >
                  {t('admin.audit.date.custom')}
                </button>
              </div>
            </div>

            {/* Export */}
            <button
              onClick={handleExport}
              disabled={!entries.length}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] border border-white/6 hover:border-white/10 hover:text-[#E5E7EB] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Download size={14} />
              {t('admin.audit.exportCSV')}
            </button>
          </div>

          {/* Custom date inputs */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/6">
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-[#6B7280]">{t('admin.audit.date.from')}</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="bg-white/[0.04] border border-white/6 rounded-lg px-2.5 py-1 text-[13px] text-[#E5E7EB] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-[#6B7280]">{t('admin.audit.date.to')}</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="bg-white/[0.04] border border-white/6 rounded-lg px-2.5 py-1 text-[13px] text-[#E5E7EB] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                />
              </div>
            </div>
          )}
        </AdminCard>
      </FadeIn>

      {/* ── Timeline ─────────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : entries.length === 0 ? (
          <AdminCard>
            <div className="py-12 text-center">
              <ClipboardList size={32} className="mx-auto mb-3 text-[#6B7280]" />
              <p className="text-[14px] text-[#6B7280]">{t('admin.audit.empty')}</p>
            </div>
          </AdminCard>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const isExpanded = expandedIds.has(entry.id);
              const details = formatDetails(entry.details);
              const colorClass = getActionColor(entry.action);

              return (
                <AdminCard key={entry.id} hover padding="p-0">
                  <div className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="flex-shrink-0 mt-0.5">
                        {entry.profiles?.avatar_url ? (
                          <img
                            src={entry.profiles.avatar_url}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover border border-white/8"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center border border-white/8">
                            <span className="text-[11px] font-bold text-[#D4AF37]">
                              {entry.profiles?.full_name?.[0]?.toUpperCase() ?? 'A'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                            {entry.profiles?.full_name || t('admin.audit.unknownUser')}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${colorClass}`}>
                            {t(`admin.audit.actions.${entry.action}`, { defaultValue: entry.action })}
                          </span>
                        </div>

                        {/* Entity info */}
                        {entry.entity_type && (
                          <p className="text-[12px] text-[#6B7280] mt-0.5">
                            {t('admin.audit.entity')}: {entry.entity_type}
                            {entry.entity_id && (
                              <span className="ml-1 text-[#9CA3AF] font-mono text-[11px]">
                                {entry.entity_id.slice(0, 8)}...
                              </span>
                            )}
                          </p>
                        )}

                        {/* Timestamp */}
                        <p className="text-[11px] text-[#6B7280] mt-1" title={absoluteTime(entry.created_at)}>
                          {relativeTime(entry.created_at)}
                        </p>
                      </div>

                      {/* Expand toggle */}
                      {details && (
                        <button
                          onClick={() => toggleExpand(entry.id)}
                          className="flex-shrink-0 p-1.5 rounded-lg text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.04] transition-colors"
                          aria-label={isExpanded ? tc('collapse') : tc('expand')}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                    </div>

                    {/* Expanded details */}
                    {isExpanded && details && (
                      <div className="mt-3 pt-3 border-t border-white/6">
                        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">
                          {t('admin.audit.details')}
                        </p>
                        <pre className="text-[12px] text-[#9CA3AF] bg-white/[0.02] rounded-lg p-3 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all">
                          {details}
                        </pre>
                      </div>
                    )}
                  </div>
                </AdminCard>
              );
            })}

            {/* Load more */}
            {hasNextPage && (
              <div className="pt-2 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-5 py-2 rounded-lg text-[13px] font-medium text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/20 hover:bg-[#D4AF37]/15 transition-colors disabled:opacity-50"
                >
                  {isFetchingNextPage ? t('admin.audit.loading') : t('admin.audit.loadMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </FadeIn>
    </div>
  );
}

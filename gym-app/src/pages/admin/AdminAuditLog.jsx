import { useState, useMemo, useCallback, useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ClipboardList, Download, ChevronDown, ChevronUp, Filter,
  User, Settings, FileText, ShieldAlert, Calendar, Search, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader, AdminCard, AdminPageShell, AdminTable,
  AdminModal, FadeIn, SectionLabel, StatCard, CardSkeleton,
} from '../../components/admin';

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

// Action type color mapping
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

// Action type icon mapping
const ACTION_ICONS = {
  member_invited:          User,
  member_deleted:          User,
  role_changed:            ShieldAlert,
  setting_updated:         Settings,
  challenge_created:       FileText,
  announcement_published:  FileText,
  class_created:           Calendar,
  program_created:         FileText,
  store_item_created:      FileText,
  trainer_added:           User,
  trainer_demoted:         User,
  moderation_action:       ShieldAlert,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getActionColor(action) {
  return ACTION_COLORS[action] || fallbackColor;
}

function relativeTime(ts, dateFnsLocale) {
  if (!ts) return '\u2014';
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true, ...dateFnsLocale }); }
  catch { return '\u2014'; }
}

function absoluteTime(ts, dateFnsLocale) {
  if (!ts) return '';
  try { return format(new Date(ts), 'MMM d, yyyy HH:mm:ss', dateFnsLocale || {}); }
  catch { return ''; }
}

function formatDetails(details) {
  if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return null;
  return JSON.stringify(details, null, 2);
}

function sanitizeDetailsForExport(details) {
  if (!details || typeof details !== 'object') return '';
  // Strip internal IDs and metadata, keep only human-readable fields
  const sanitized = {};
  const sensitiveKeys = ['id', 'actor_id', 'entity_id', 'gym_id', 'user_id', 'member_id', 'profile_id', 'token', 'secret', 'password', 'ip_address'];
  for (const [key, value] of Object.entries(details)) {
    if (sensitiveKeys.includes(key)) continue;
    // Skip any value that looks like a UUID
    if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue;
    sanitized[key] = value;
  }
  return Object.keys(sanitized).length > 0 ? JSON.stringify(sanitized) : '';
}

function buildCSVRows(pages) {
  const rows = [];
  for (const page of pages) {
    for (const entry of page) {
      rows.push({
        date: entry.created_at ? format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
        actor: entry.profiles?.full_name || 'Unknown user',
        action: entry.action,
        entity_type: entry.entity_type || '',
        entity_ref: entry.entity_type && entry.entity_id
          ? `${entry.entity_type}#${entry.entity_id.slice(0, 6)}`
          : '',
        details: sanitizeDetailsForExport(entry.details),
      });
    }
  }
  return rows;
}

async function downloadCSVRows(rows) {
  if (!rows.length) return;
  const { downloadCSVString } = await import('../../lib/csvExport');
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  await downloadCSVString(`audit_log_${format(new Date(), 'yyyy-MM-dd')}.csv`, lines.join('\n'));
}

// ── Detail Modal ─────────────────────────────────────────────────────────────

function AuditDetailModal({ entry, isOpen, onClose, t, dateFnsOpts }) {
  if (!entry) return null;
  const details = formatDetails(entry.details);
  const colorClass = getActionColor(entry.action);

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.audit.details')}
      titleIcon={ClipboardList}
      size="md"
    >
      <div className="space-y-5">
        {/* Action badge */}
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1 rounded-lg text-[12px] font-semibold border ${colorClass}`}>
            {t(`admin.audit.actions.${entry.action}`, { defaultValue: entry.action })}
          </span>
          <span className="text-[12px] text-[#6B7280]" title={absoluteTime(entry.created_at, dateFnsOpts)}>
            {relativeTime(entry.created_at, dateFnsOpts)}
          </span>
        </div>

        {/* Actor */}
        <div>
          <SectionLabel icon={User}>{t('admin.audit.actor', { defaultValue: 'Actor' })}</SectionLabel>
          <div className="mt-2 flex items-center gap-3">
            {entry.profiles?.avatar_url ? (
              <img src={entry.profiles.avatar_url} alt={entry.profiles.full_name || "User avatar"} className="w-9 h-9 rounded-full object-cover border border-white/8" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#D4AF37]/15 flex items-center justify-center border border-white/8">
                <span className="text-[12px] font-bold text-[#D4AF37]">
                  {entry.profiles?.full_name?.[0]?.toUpperCase() ?? 'A'}
                </span>
              </div>
            )}
            <p className="text-[14px] font-semibold text-[#E5E7EB]">
              {entry.profiles?.full_name || t('admin.audit.unknownUser')}
            </p>
          </div>
        </div>

        {/* Entity info */}
        {entry.entity_type && (
          <div>
            <SectionLabel>{t('admin.audit.entity')}</SectionLabel>
            <div className="mt-2 bg-white/[0.03] rounded-xl p-3 border border-white/6">
              <p className="text-[13px] text-[#E5E7EB]">{entry.entity_type}</p>
              {entry.entity_id && (
                <p className="text-[11px] text-[#6B7280] font-mono mt-0.5">{entry.entity_id}</p>
              )}
            </div>
          </div>
        )}

        {/* Timestamp */}
        <div>
          <SectionLabel icon={Calendar}>{t('admin.audit.timestamp', { defaultValue: 'Timestamp' })}</SectionLabel>
          <p className="mt-2 text-[13px] text-[#E5E7EB]">{absoluteTime(entry.created_at, dateFnsOpts)}</p>
        </div>

        {/* Details JSON */}
        {details && (
          <div>
            <SectionLabel>{t('admin.audit.details')}</SectionLabel>
            <pre className="mt-2 text-[12px] text-[#9CA3AF] bg-white/[0.02] rounded-xl p-4 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all border border-white/6">
              {details}
            </pre>
          </div>
        )}
      </div>
    </AdminModal>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminAuditLog() {
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsOpts = isEs ? { locale: esLocale } : undefined;

  const [actionFilter, setActionFilter] = useState('all');
  const [datePreset, setDatePreset] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { document.title = `Admin - Audit Log | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

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

  const allEntries = useMemo(() => data?.pages?.flat() || [], [data]);

  // Client-side user search filter
  const entries = useMemo(() => {
    if (!userSearch.trim()) return allEntries;
    const q = userSearch.toLowerCase();
    return allEntries.filter(e =>
      e.profiles?.full_name?.toLowerCase().includes(q)
    );
  }, [allEntries, userSearch]);

  const handleExport = useCallback(() => {
    if (!data?.pages) return;
    const rows = buildCSVRows(data.pages);
    downloadCSVRows(rows);
  }, [data]);



  // ── Table columns ──
  const columns = [
    {
      key: 'actor',
      label: t('admin.audit.actor', { defaultValue: 'Actor' }),
      render: (row) => (
        <div className="flex items-center gap-2.5">
          {row.profiles?.avatar_url ? (
            <img src={row.profiles.avatar_url} alt={row.profiles.full_name || "User avatar"} className="w-7 h-7 rounded-full object-cover border border-white/8" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#D4AF37]/15 flex items-center justify-center border border-white/8">
              <span className="text-[10px] font-bold text-[#D4AF37]">
                {row.profiles?.full_name?.[0]?.toUpperCase() ?? 'A'}
              </span>
            </div>
          )}
          <span className="text-[13px] font-semibold text-[#E5E7EB] truncate">
            {row.profiles?.full_name || t('admin.audit.unknownUser')}
          </span>
        </div>
      ),
    },
    {
      key: 'action',
      label: t('admin.audit.actionLabel', { defaultValue: 'Action' }),
      sortable: true,
      render: (row) => {
        const colorClass = getActionColor(row.action);
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${colorClass}`}>
            {t(`admin.audit.actions.${row.action}`, { defaultValue: row.action })}
          </span>
        );
      },
    },
    {
      key: 'entity_type',
      label: t('admin.audit.entity'),
      render: (row) => row.entity_type ? (
        <div className="min-w-0">
          <p className="text-[12px] text-[#E5E7EB]">{row.entity_type}</p>
          {row.entity_id && (
            <p className="text-[10px] text-[#6B7280] font-mono truncate max-w-[120px]">{row.entity_id.slice(0, 8)}...</p>
          )}
        </div>
      ) : <span className="text-[11px] text-[#6B7280]">\u2014</span>,
    },
    {
      key: 'created_at',
      label: t('admin.audit.date', { defaultValue: 'Date' }),
      sortable: true,
      sortValue: (row) => new Date(row.created_at).getTime(),
      render: (row) => (
        <div>
          <p className="text-[12px] text-[#E5E7EB]">{relativeTime(row.created_at, dateFnsOpts)}</p>
          <p className="text-[10px] text-[#6B7280]">{absoluteTime(row.created_at, dateFnsOpts)}</p>
        </div>
      ),
    },
    {
      key: 'details_indicator',
      label: '',
      headerClassName: 'w-10',
      render: (row) => {
        const details = formatDetails(row.details);
        return details ? (
          <ChevronDown size={14} className="text-[#6B7280]" />
        ) : null;
      },
    },
  ];

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.audit.title')}
        subtitle={t('admin.audit.subtitle')}
        actions={
          <button
            onClick={handleExport}
            disabled={!entries.length}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-[#E5E7EB] bg-white/[0.04] border border-white/6 hover:border-white/10 hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Download size={14} />
            {t('admin.audit.exportCSV')}
          </button>
        }
      />

      {/* ── Filters ──────────────────────────────────────────── */}
      <FadeIn>
        <AdminCard className="mt-5 mb-5">
          {/* Mobile filter toggle */}
          <div className="sm:hidden flex items-center justify-between mb-3">
            <button
              onClick={() => setShowFilters(f => !f)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] border border-white/6 hover:border-white/10 transition-colors"
            >
              <Filter size={14} />
              {tc('filters')}
            </button>
          </div>

          <div className={`${showFilters ? 'block' : 'hidden'} sm:block space-y-3`}>
            {/* Row 1: Date presets + Action filter */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Date presets */}
              <div className="flex items-center gap-1">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setDatePreset(p.key)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
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
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                    datePreset === 'custom'
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                      : 'text-[#6B7280] hover:text-[#9CA3AF] border border-white/6 hover:border-white/10'
                  }`}
                >
                  {t('admin.audit.date.custom')}
                </button>
              </div>

              {/* Action type select */}
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

              {/* User search */}
              <div className="relative ml-auto">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder={t('admin.audit.searchUser', { defaultValue: 'Search user...' })}
                  aria-label={t('admin.audit.searchUser', { defaultValue: 'Search user...' })}
                  className="bg-white/[0.04] border border-white/6 rounded-lg pl-8 pr-8 py-1.5 text-[13px] text-[#E5E7EB] placeholder:text-[#6B7280] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50 w-[180px]"
                />
                {userSearch && (
                  <button
                    onClick={() => setUserSearch('')}
                    aria-label={t('admin.audit.clearSearch', { defaultValue: 'Clear search' })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#9CA3AF]"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Custom date inputs */}
            {datePreset === 'custom' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-3 border-t border-white/6">
                <div className="flex items-center gap-2">
                  <label className="text-[12px] text-[#6B7280] flex-shrink-0">{t('admin.audit.date.from')}</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="w-full sm:w-auto bg-white/[0.04] border border-white/6 rounded-lg px-2.5 py-1.5 text-[13px] text-[#E5E7EB] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[12px] text-[#6B7280] flex-shrink-0">{t('admin.audit.date.to')}</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="w-full sm:w-auto bg-white/[0.04] border border-white/6 rounded-lg px-2.5 py-1.5 text-[13px] text-[#E5E7EB] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                  />
                </div>
              </div>
            )}
          </div>
        </AdminCard>
      </FadeIn>

      {/* ── Audit Table ─────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : entries.length === 0 ? (
          <AdminCard>
            <div className="py-16 text-center">
              <ClipboardList size={32} className="mx-auto mb-3 text-[#6B7280]" />
              <p className="text-[14px] text-[#6B7280]">{t('admin.audit.empty')}</p>
            </div>
          </AdminCard>
        ) : (
          <div className="space-y-4">
            <AdminTable
              columns={columns}
              data={entries}
              loading={false}
              onRowClick={(row) => setSelectedEntry(row)}
              stickyHeader
            />

            {/* Load more */}
            {hasNextPage && (
              <div className="pt-2 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-5 py-2 rounded-xl text-[13px] font-semibold text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/20 hover:bg-[#D4AF37]/15 transition-colors disabled:opacity-50"
                >
                  {isFetchingNextPage ? t('admin.audit.loading') : t('admin.audit.loadMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </FadeIn>

      {/* Detail modal */}
      {selectedEntry && <AuditDetailModal
        entry={selectedEntry}
        isOpen={!!selectedEntry}
        onClose={() => setSelectedEntry(null)}
        t={t}
        dateFnsOpts={dateFnsOpts}
      />}
    </AdminPageShell>
  );
}

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ClipboardList, Download, ChevronDown, ChevronUp, Filter,
  User, Calendar, Search, X,
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

// Bumped from 20 to 50 — high-volume audits don't want to click "load more" twice as often.
const PAGE_SIZE = 50;

// Curated filter options — these are REAL action strings written by
// logAdminAction(...) across the app (verified against every call site). The
// full action set is ~90; this is the subset admins actually filter by. Any
// action not listed still shows under the "All" view and still gets a sensible
// tone + icon from the prefix resolvers below. (The previous list used invented
// names like 'setting_updated'/'role_changed' that NEVER matched a real row, so
// every filter returned nothing — that's the bug this fixes.)
const ACTION_TYPES = [
  'add_member',
  'invite_member',
  'change_status',
  'deactivate_member',
  'delete_account',
  'change_role',
  'add_trainer',
  'demote_trainer',
  'update_settings',
  'settings_cards_updated',
  'update_hours',
  'create_challenge',
  'create_program',
  'create_class',
  'create_product',
  'create_announcement',
  'outreach_send',
  'send_email',
  'send_sms',
  'award_prizes',
  'moderation',
  'print_cards_marked',
  'print_cards_delivered',
];

const DATE_PRESETS = [
  { key: 'today', days: 0 },
  { key: '7d',    days: 7 },
  { key: '30d',   days: 30 },
  { key: '90d',   days: 90 },
];

const fallbackColor = 'admin-pill admin-pill--outline';

// Tone/icon are resolved by PREFIX so all ~90 real action strings (and any new
// ones added later) get a sensible treatment without enumerating each. Explicit
// overrides handle the handful that don't follow the verb_noun prefix pattern.
const TONE_OVERRIDES = {
  moderation: 'hot',
  block_user: 'hot',
  unblock_user: 'good',
  change_role: 'hot',
  add_trainer: 'coach',
  demote_trainer: 'hot',
  outreach_send: 'coach',
  gym_import: 'warn',
};

// First matching prefix wins — order matters (more specific first).
const TONE_PREFIXES = [
  ['permanently_', 'hot'],
  ['super_admin_delete', 'hot'],
  ['super_admin_schedule', 'hot'],
  ['delete_', 'hot'],
  ['revoke_', 'hot'],
  ['deactivate_', 'hot'],
  ['pause_', 'hot'],
  ['expire_', 'hot'],
  ['create_', 'good'],
  ['add_', 'good'],
  ['award_', 'good'],
  ['claim_', 'good'],
  ['redeem_', 'good'],
  ['reactivate_', 'good'],
  ['resolve_', 'good'],
  ['invite_', 'coach'],
  ['resend_', 'coach'],
  ['send_', 'coach'],
  ['bulk_', 'coach'],
  ['quick_', 'coach'],
  ['update_', 'warn'],
  ['change_', 'warn'],
  ['set_', 'warn'],
  ['save_', 'warn'],
  ['toggle_', 'warn'],
  ['settings_', 'warn'],
  ['reset_', 'warn'],
  ['print_card', 'info'],
  ['checkin_', 'info'],
  ['purchase_', 'info'],
  ['referral', 'info'],
  ['tv_', 'info'],
];

function getActionTone(action) {
  if (!action) return null;
  if (TONE_OVERRIDES[action]) return TONE_OVERRIDES[action];
  for (const [prefix, tone] of TONE_PREFIXES) {
    if (action.startsWith(prefix)) return tone;
  }
  return null;
}

function getActionColor(action) {
  const tone = getActionTone(action);
  return tone ? `admin-pill admin-pill--${tone}` : fallbackColor;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function buildCSVRows(pages, t) {
  const rows = [];
  for (const page of pages) {
    for (const entry of page) {
      rows.push({
        date: entry.created_at ? format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
        actor: entry.profiles?.full_name || t('admin.audit.unknownUser', 'Unknown user'),
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
          <span className={colorClass}>
            {t(`admin.audit.actions.${entry.action}`, { defaultValue: entry.action })}
          </span>
          <span className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }} title={absoluteTime(entry.created_at, dateFnsOpts)}>
            {relativeTime(entry.created_at, dateFnsOpts)}
          </span>
        </div>

        {/* Actor */}
        <div>
          <SectionLabel icon={User}>{t('admin.audit.actor', { defaultValue: 'Actor' })}</SectionLabel>
          <div className="mt-2 flex items-center gap-3">
            {entry.profiles?.avatar_url ? (
              <img src={entry.profiles.avatar_url} alt={entry.profiles.full_name || t('admin.audit.userAvatarAlt', 'User avatar')} className="w-9 h-9 rounded-full object-cover border border-white/8" />
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

  useEffect(() => { document.title = `${t('admin.audit.title', 'Admin - Audit Log')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

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
    const rows = buildCSVRows(data.pages, t);
    downloadCSVRows(rows);
  }, [data, t]);



  // ── Table columns ──
  const columns = [
    {
      key: 'actor',
      label: t('admin.audit.actor', { defaultValue: 'Actor' }),
      render: (row) => (
        <div className="flex items-center gap-2.5">
          {row.profiles?.avatar_url ? (
            <img src={row.profiles.avatar_url} alt={row.profiles.full_name || t('admin.audit.userAvatarAlt', 'User avatar')} className="w-7 h-7 rounded-full object-cover border border-white/8" />
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
          <span className={colorClass}>
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
      ) : <span className="text-[11px] text-[#6B7280]">{'\u2014'}</span>,
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
              style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)' }}
            >
              <Filter size={14} />
              {tc('filters')}
            </button>
          </div>

          <div className={`${showFilters ? 'block' : 'hidden'} sm:block space-y-3`}>
            {/* Row 1: Date presets + Action filter */}
            <div className="flex sm:flex-wrap items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible pb-1 sm:pb-0">
              {/* Date presets as pills */}
              {DATE_PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setDatePreset(p.key)}
                  className={`admin-pill flex-shrink-0 ${datePreset === p.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                  style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  {t(`admin.audit.date.${p.key}`)}
                </button>
              ))}
              <button
                onClick={() => setDatePreset('custom')}
                className={`admin-pill flex-shrink-0 ${datePreset === 'custom' ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                {t('admin.audit.date.custom')}
              </button>

              {/* Action type select */}
              <select
                value={actionFilter}
                onChange={e => setActionFilter(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-[13px] focus:outline-none flex-shrink-0"
                style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
              >
                <option value="all">{t('admin.audit.allActions')}</option>
                {ACTION_TYPES.map(a => (
                  <option key={a} value={a}>{t(`admin.audit.actions.${a}`)}</option>
                ))}
              </select>

              {/* User search */}
              <div className="relative sm:ml-auto flex-shrink-0">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-admin-text-muted)' }} />
                <input
                  type="text"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder={t('admin.audit.searchUser', { defaultValue: 'Search user...' })}
                  aria-label={t('admin.audit.searchUser', { defaultValue: 'Search user...' })}
                  className="rounded-lg pl-8 pr-8 py-1.5 text-[13px] focus:outline-none w-[180px]"
                  style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                />
                {userSearch && (
                  <button
                    onClick={() => setUserSearch('')}
                    aria-label={t('admin.audit.clearSearch', { defaultValue: 'Clear search' })}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-admin-text-muted)' }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Custom date inputs */}
            {datePreset === 'custom' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-3" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                <div className="flex items-center gap-2">
                  <label className="text-[12px] flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.audit.date.from')}</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="w-full sm:w-auto rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none"
                    style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[12px] flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.audit.date.to')}</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="w-full sm:w-auto rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none"
                    style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
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
            {/* Desktop table */}
            <div className="hidden md:block">
              <AdminTable
                columns={columns}
                data={entries}
                loading={false}
                onRowClick={(row) => setSelectedEntry(row)}
                stickyHeader
              />
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {entries.map(row => {
                const colorClass = getActionColor(row.action);
                return (
                  <div
                    key={row.id}
                    onClick={() => setSelectedEntry(row)}
                    className="admin-card p-3 cursor-pointer"
                  >
                    <div className="flex items-start gap-2.5 mb-2">
                      {row.profiles?.avatar_url ? (
                        <img src={row.profiles.avatar_url} alt={row.profiles.full_name || t('admin.audit.userAvatarAlt', 'User avatar')} className="w-8 h-8 rounded-full object-cover border border-white/8 flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center border border-white/8 flex-shrink-0">
                          <span className="text-[11px] font-bold text-[#D4AF37]">
                            {row.profiles?.full_name?.[0]?.toUpperCase() ?? 'A'}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                          {row.profiles?.full_name || t('admin.audit.unknownUser')}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                          {relativeTime(row.created_at, dateFnsOpts)}
                        </p>
                      </div>
                      <ChevronDown size={14} className="text-[#6B7280] flex-shrink-0 mt-1" />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={colorClass}>
                        {t(`admin.audit.actions.${row.action}`, { defaultValue: row.action })}
                      </span>
                      {row.entity_type && (
                        <span className="text-[10.5px] font-mono truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                          {row.entity_type}{row.entity_id ? `#${row.entity_id.slice(0, 6)}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            {hasNextPage && (
              <div className="pt-2 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-5 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
                  style={{
                    color: 'var(--color-accent)',
                    background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
                  }}
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

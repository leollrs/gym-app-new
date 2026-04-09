import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Bug, AlertTriangle, Search, Filter, ChevronDown, ChevronRight,
  Monitor, Smartphone, Clock, Building2, Loader2,
} from 'lucide-react';
import { formatDistanceToNow, subDays, subHours } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

const PAGE_SIZE = 50;

const TYPE_CONFIG = {
  react_crash:        { color: 'red',    labelKey: 'platform.errors.typeReactCrash',       fallback: 'React Crash' },
  js_error:           { color: 'orange', labelKey: 'platform.errors.typeJsError',          fallback: 'JS Error' },
  promise_rejection:  { color: 'yellow', labelKey: 'platform.errors.typePromiseRejection', fallback: 'Promise Rejection' },
  api_error:          { color: 'blue',   labelKey: 'platform.errors.typeApiError',         fallback: 'API Error' },
  network_error:      { color: 'gray',   labelKey: 'platform.errors.typeNetworkError',     fallback: 'Network Error' },
  slow_api:           { color: 'purple', labelKey: 'platform.errors.typeSlowApi',          fallback: 'Slow API' },
  auth_error:         { color: 'red',    labelKey: 'platform.errors.typeAuthError',        fallback: 'Auth Error' },
  http_error:         { color: 'orange', labelKey: 'platform.errors.typeHttpError',        fallback: 'HTTP Error' },
  action_failed:      { color: 'amber',  labelKey: 'platform.errors.typeActionFailed',     fallback: 'Action Failed' },
};

const COLOR_MAP = {
  red:    { bg: 'bg-red-500/15',    text: 'text-red-400' },
  orange: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  yellow: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  blue:   { bg: 'bg-blue-500/15',   text: 'text-blue-400' },
  gray:   { bg: 'bg-gray-500/15',   text: 'text-gray-400' },
  purple: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  amber:  { bg: 'bg-amber-500/15',  text: 'text-amber-400' },
};

const DATE_RANGES = [
  { labelKey: 'platform.errors.dateRange24h', fallback: 'Last 24h', value: '24h' },
  { labelKey: 'platform.errors.dateRange7d',  fallback: '7 days',   value: '7d' },
  { labelKey: 'platform.errors.dateRange30d', fallback: '30 days',  value: '30d' },
  { labelKey: 'platform.errors.dateRangeAll', fallback: 'All time', value: 'all' },
];

const ERROR_TYPES = [
  { labelKey: 'platform.errors.typeAll',              fallback: 'All Types',         value: 'all' },
  { labelKey: 'platform.errors.typeReactCrash',       fallback: 'React Crash',       value: 'react_crash' },
  { labelKey: 'platform.errors.typeJsError',          fallback: 'JS Error',          value: 'js_error' },
  { labelKey: 'platform.errors.typePromiseRejection', fallback: 'Promise Rejection', value: 'promise_rejection' },
  { labelKey: 'platform.errors.typeApiError',         fallback: 'API Error',         value: 'api_error' },
  { labelKey: 'platform.errors.typeNetworkError',     fallback: 'Network Error',     value: 'network_error' },
  { labelKey: 'platform.errors.typeSlowApi',          fallback: 'Slow API',          value: 'slow_api' },
  { labelKey: 'platform.errors.typeAuthError',        fallback: 'Auth Error',        value: 'auth_error' },
  { labelKey: 'platform.errors.typeHttpError',        fallback: 'HTTP Error',        value: 'http_error' },
  { labelKey: 'platform.errors.typeActionFailed',     fallback: 'Action Failed',     value: 'action_failed' },
];

function ErrorRow({ entry, t }) {
  const [expanded, setExpanded] = useState(false);
  const config = TYPE_CONFIG[entry.type] || { color: 'blue', labelKey: null, fallback: entry.type };
  const colors = COLOR_MAP[config.color] || COLOR_MAP.blue;
  const typeLabel = config.labelKey ? t(config.labelKey, config.fallback) : config.fallback;
  const userName = entry.user?.full_name || entry.user?.username || t('platform.errors.unknown', 'Unknown');
  const gymName = entry.gym?.name || (entry.gym_id ? t('platform.errors.unknownGym', 'Unknown Gym') : '—');
  const createdAt = new Date(entry.created_at);
  const message = entry.message || t('platform.errors.noMessage', 'No message');
  const truncatedMessage = message.length > 120 ? message.slice(0, 120) + '...' : message;

  return (
    <div className="border-b border-white/4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 py-3 text-left hover:bg-white/[0.02] transition-colors px-1"
      >
        <div className="mt-1 flex-shrink-0">
          {expanded ? (
            <ChevronDown size={14} className="text-[#6B7280]" />
          ) : (
            <ChevronRight size={14} className="text-[#6B7280]" />
          )}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[100px_100px_100px_80px_1fr_80px] gap-1 md:gap-3 items-start">
          {/* Time */}
          <div className="flex items-center gap-1">
            <Clock size={12} className="text-[#6B7280] flex-shrink-0 hidden md:block" />
            <span className="text-[11px] text-[#9CA3AF] truncate">
              {formatDistanceToNow(createdAt, { addSuffix: true })}
            </span>
          </div>

          {/* Gym */}
          <div className="flex items-center gap-1">
            <Building2 size={12} className="text-[#6B7280] flex-shrink-0 hidden md:block" />
            <span className="text-[11px] text-[#9CA3AF] truncate">{gymName}</span>
          </div>

          {/* User */}
          <span className="text-[11px] text-[#E5E7EB] truncate">{userName}</span>

          {/* Type badge */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium w-fit ${colors.bg} ${colors.text}`}>
            {typeLabel}
          </span>

          {/* Message */}
          <span className="text-[11px] text-[#9CA3AF] truncate">{truncatedMessage}</span>

          {/* Page */}
          <span className="text-[10px] text-[#6B7280] truncate">{entry.page || '—'}</span>
        </div>
      </button>

      {expanded && (
        <div className="pl-8 pr-4 pb-4 space-y-3">
          {/* Full message */}
          <div>
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1 font-medium">{t('platform.errors.fullMessage', 'Full Message')}</p>
            <div className="bg-[#111827]/60 rounded-lg p-3">
              <p className="text-[11px] text-[#E5E7EB] whitespace-pre-wrap break-all font-mono leading-relaxed">
                {message}
              </p>
            </div>
          </div>

          {/* Stack trace */}
          {entry.stack && (
            <div>
              <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1 font-medium">{t('platform.errors.stackTrace', 'Stack Trace')}</p>
              <div className="bg-[#111827]/60 rounded-lg p-3 max-h-[300px] overflow-y-auto">
                <pre className="text-[11px] text-[#9CA3AF] whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {entry.stack}
                </pre>
              </div>
            </div>
          )}

          {/* Device info */}
          {entry.device_info && (
            <div>
              <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1 font-medium flex items-center gap-1">
                {entry.device_info?.platform === 'mobile' ? <Smartphone size={12} /> : <Monitor size={12} />}
                {t('platform.errors.deviceInfo', 'Device Info')}
              </p>
              <div className="bg-[#111827]/60 rounded-lg p-3">
                <pre className="text-[11px] text-[#9CA3AF] whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {JSON.stringify(entry.device_info, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Metadata */}
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div>
              <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1 font-medium">{t('platform.errors.metadata', 'Metadata')}</p>
              <div className="bg-[#111827]/60 rounded-lg p-3">
                <pre className="text-[11px] text-[#9CA3AF] whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ErrorLogs() {
  const { user } = useAuth();
  const { t } = useTranslation('pages');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const [dateRange, setDateRange] = useState('7d');
  const [errorType, setErrorType] = useState('all');
  const [gymFilter, setGymFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef(null);

  const [gyms, setGyms] = useState([]);

  // Fetch gyms for the filter dropdown
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('gyms')
        .select('id, name')
        .order('name');
      if (data) setGyms(data);
    })();
  }, []);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchTerm]);

  const fetchEntries = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    let query = supabase
      .from('error_logs')
      .select(`
        id, gym_id, profile_id, type, message, stack, page, component, device_info, metadata, created_at,
        user:profiles!error_logs_profile_id_fkey ( id, full_name, username ),
        gym:gyms!error_logs_gym_id_fkey ( id, name )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    // Date range filter
    if (dateRange === '24h') {
      query = query.gte('created_at', subHours(new Date(), 24).toISOString());
    } else if (dateRange === '7d') {
      query = query.gte('created_at', subDays(new Date(), 7).toISOString());
    } else if (dateRange === '30d') {
      query = query.gte('created_at', subDays(new Date(), 30).toISOString());
    }

    // Error type filter
    if (errorType !== 'all') {
      query = query.eq('type', errorType);
    }

    // Gym filter
    if (gymFilter !== 'all') {
      query = query.eq('gym_id', gymFilter);
    }

    // Server-side search by message
    if (debouncedSearch.trim()) {
      query = query.ilike('message', `%${debouncedSearch.trim()}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching error logs:', error);
      if (!append) setLoading(false);
      else setLoadingMore(false);
      return;
    }

    const results = data || [];

    if (append) {
      setEntries((prev) => [...prev, ...results]);
    } else {
      setEntries(results);
    }

    if (count !== null && !append) setTotalCount(count);
    setHasMore(results.length === PAGE_SIZE);
    if (!append) setLoading(false);
    else setLoadingMore(false);
  }, [dateRange, errorType, gymFilter, debouncedSearch]);

  // Re-fetch when filters change
  useEffect(() => {
    fetchEntries(0, false);
  }, [fetchEntries]);

  const handleLoadMore = () => {
    fetchEntries(entries.length, true);
  };

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{t('platform.errors.title', 'Errors')}</h1>
          <p className="text-[12px] text-[#6B7280] mt-0.5">{t('platform.errors.subtitle', 'Platform failures and crash analysis')}</p>
        </div>
        <button
          onClick={() => window.open('/platform/operations', '_self')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors flex-shrink-0"
        >
          {t('platform.errors.openOperations', 'Open Operations')}
        </button>
      </div>

      {/* Failure summary */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-6">
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{totalCount.toLocaleString()}</p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.errors.totalErrors', 'Total Errors')}</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">
              {[...new Set(entries.map(e => e.gym_id).filter(Boolean))].length}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.errors.gymsAffected', 'Gyms Affected')}</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">
              {[...new Set(entries.map(e => e.profile_id).filter(Boolean))].length}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.errors.usersAffected', 'Users Affected')}</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-red-400 tabular-nums">
              {entries.filter(e => e.type === 'react_crash' || e.type === 'auth_error').length}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.errors.criticalErrors', 'Critical Errors')}</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums truncate">
              {(() => {
                const typeCounts = {};
                entries.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
                const top = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
                const cfg = top ? TYPE_CONFIG[top[0]] : null;
                return cfg ? t(cfg.labelKey, cfg.fallback) : '—';
              })()}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.errors.topErrorType', 'Top Error Type')}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-[#6B7280]" />
          <span className="text-[12px] text-[#6B7280] font-medium uppercase tracking-wider">{t('platform.errors.filters', 'Filters')}</span>
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Date range */}
          <div className="flex gap-1 flex-wrap">
            {DATE_RANGES.map((dr) => (
              <button
                key={dr.value}
                onClick={() => setDateRange(dr.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] border transition-colors ${
                  dateRange === dr.value
                    ? 'bg-white/[0.06] text-[#E5E7EB] border-white/10'
                    : 'text-[#6B7280] border-white/6 hover:text-[#9CA3AF]'
                }`}
              >
                {t(dr.labelKey, dr.fallback)}
              </button>
            ))}
          </div>

          {/* Error type */}
          <select
            value={errorType}
            onChange={(e) => setErrorType(e.target.value)}
            className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none"
          >
            {ERROR_TYPES.map((et) => (
              <option key={et.value} value={et.value}>{t(et.labelKey, et.fallback)}</option>
            ))}
          </select>

          {/* Gym filter */}
          <select
            value={gymFilter}
            onChange={(e) => setGymFilter(e.target.value)}
            className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none"
          >
            <option value="all">{t('platform.errors.allGyms', 'All Gyms')}</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="text"
              placeholder={t('platform.errors.searchPlaceholder', 'Search by error message...')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Table header (desktop) */}
      <div className="hidden md:block bg-[#0F172A] border border-white/6 rounded-t-xl px-5 py-2.5 border-b-0">
        <div className="grid grid-cols-[24px_100px_100px_100px_80px_1fr_80px] gap-3 items-center">
          <span />
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.errors.headerTime', 'Time')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.errors.headerGym', 'Gym')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.errors.headerUser', 'User')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.errors.headerType', 'Type')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.errors.headerMessage', 'Message')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.errors.headerPage', 'Page')}</span>
        </div>
      </div>

      {/* Log entries */}
      <div className="bg-[#0F172A] border border-white/6 rounded-b-xl md:rounded-t-none rounded-xl md:rounded-xl p-4 md:border-t-0 md:rounded-t-none overflow-hidden">
        {loading ? (
          <PlatformSpinner />
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Bug size={32} className="mx-auto text-[#6B7280] mb-3" />
            <p className="text-[14px] text-[#6B7280]">{t('platform.errors.noErrors', 'No errors found')}</p>
            <p className="text-[12px] text-[#6B7280]/60 mt-1">
              {t('platform.errors.noErrorsHint', 'Errors from across the platform will appear here')}
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/4">
              {entries.map((entry) => (
                <ErrorRow key={entry.id} entry={entry} t={t} />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-4 mt-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-5 py-2 rounded-lg text-[13px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/10 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t('platform.errors.loading', 'Loading...')}
                    </>
                  ) : (
                    t('platform.errors.loadMore', 'Load more')
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

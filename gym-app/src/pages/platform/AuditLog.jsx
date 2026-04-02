import { useEffect, useState, useCallback } from 'react';
import {
  Building2, UserCog, Shield, Snowflake, Settings, Dumbbell, Trophy,
  ChevronDown, Search, Filter, Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays, subHours } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';

const PAGE_SIZE = 50;

const ACTION_CONFIG = {
  gym_created:       { icon: Building2, color: 'emerald', label: 'Gym Created' },
  gym_deactivated:   { icon: Building2, color: 'red',     label: 'Gym Deactivated' },
  role_changed:      { icon: UserCog,   color: 'purple',  label: 'Role Changed' },
  member_banned:     { icon: Shield,    color: 'red',     label: 'Member Banned' },
  member_frozen:     { icon: Snowflake, color: 'amber',   label: 'Member Frozen' },
  settings_updated:  { icon: Settings,  color: 'blue',    label: 'Settings Updated' },
  exercise_created:  { icon: Dumbbell,  color: 'gold',    label: 'Exercise Created' },
  challenge_created: { icon: Trophy,    color: 'amber',   label: 'Challenge Created' },
};

const COLOR_MAP = {
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  red:     { bg: 'bg-red-500/15',     text: 'text-red-400' },
  purple:  { bg: 'bg-purple-500/15',  text: 'text-purple-400' },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-400' },
  blue:    { bg: 'bg-blue-500/15',    text: 'text-blue-400' },
  gold:    { bg: 'bg-[#D4AF37]/15',   text: 'text-[#D4AF37]' },
};

const DATE_RANGES = [
  { label: 'Last 24h', value: '24h' },
  { label: '7 days',   value: '7d' },
  { label: '30 days',  value: '30d' },
  { label: 'All time', value: 'all' },
];

const ACTION_TYPES = [
  { label: 'All Actions',       value: 'all' },
  { label: 'Gym Created',       value: 'gym_created' },
  { label: 'Gym Deactivated',   value: 'gym_deactivated' },
  { label: 'Role Changed',      value: 'role_changed' },
  { label: 'Member Banned',     value: 'member_banned' },
  { label: 'Member Frozen',     value: 'member_frozen' },
  { label: 'Settings Updated',  value: 'settings_updated' },
  { label: 'Exercise Created',  value: 'exercise_created' },
  { label: 'Challenge Created', value: 'challenge_created' },
];

function buildDescription(action, metadata) {
  switch (action) {
    case 'gym_created':
      return `created gym "${metadata?.gym_name || 'Unknown'}"`;
    case 'gym_deactivated':
      return `deactivated gym "${metadata?.gym_name || 'Unknown'}"`;
    case 'role_changed':
      return `changed role of ${metadata?.target_name || 'a member'} from ${metadata?.old_role || '?'} to ${metadata?.new_role || '?'}`;
    case 'member_banned':
      return `banned ${metadata?.target_name || 'a member'}${metadata?.reason ? ` — ${metadata.reason}` : ''}`;
    case 'member_frozen':
      return `froze membership of ${metadata?.target_name || 'a member'}`;
    case 'settings_updated':
      return `updated ${metadata?.setting || 'settings'}`;
    case 'exercise_created':
      return `created exercise "${metadata?.exercise_name || 'Unknown'}"`;
    case 'challenge_created':
      return `created challenge "${metadata?.challenge_name || 'Unknown'}"`;
    default:
      return `performed action: ${action}`;
  }
}

function LogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const config = ACTION_CONFIG[entry.action] || { icon: Settings, color: 'blue', label: entry.action };
  const colors = COLOR_MAP[config.color] || COLOR_MAP.blue;
  const Icon = config.icon;
  const actorName = entry.actor?.full_name || entry.actor?.username || 'System';
  const gymName = entry.gym?.name || (entry.gym_id ? 'Unknown Gym' : 'Platform');
  const description = buildDescription(entry.action, entry.metadata);
  const createdAt = new Date(entry.created_at);

  return (
    <div className="flex gap-3 py-3 border-b border-white/4">
      <div className={`w-8 h-8 rounded-full ${colors.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon size={14} className={colors.text} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-[#E5E7EB]">
          <span className="font-medium">{actorName}</span>{' '}
          {description}
        </p>
        <p className="text-[10px] text-[#6B7280] mt-0.5">
          {formatDistanceToNow(createdAt, { addSuffix: true })} · {gymName}
        </p>
        <p className="text-[10px] text-[#6B7280] mt-0.5">
          {format(createdAt, 'MMM d, yyyy · HH:mm:ss')}
        </p>

        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-1.5 text-[10px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
          >
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
            {expanded ? 'Hide' : 'Show'} details
          </button>
        )}

        {expanded && entry.metadata && (
          <div className="bg-[#111827]/60 rounded-lg p-3 mt-2">
            <pre className="text-[11px] text-[#9CA3AF] whitespace-pre-wrap break-all font-mono leading-relaxed">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditLog() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [dateRange, setDateRange] = useState('7d');
  const [actionType, setActionType] = useState('all');
  const [gymFilter, setGymFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

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

  const fetchEntries = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    let query = supabase
      .from('audit_log')
      .select(`
        id, gym_id, actor_id, action, target_type, target_id, metadata, created_at,
        actor:profiles!audit_log_actor_id_fkey ( id, full_name, username ),
        gym:gyms!audit_log_gym_id_fkey ( id, name )
      `)
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

    // Action type filter
    if (actionType !== 'all') {
      query = query.eq('action', actionType);
    }

    // Gym filter
    if (gymFilter !== 'all') {
      query = query.eq('gym_id', gymFilter);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching audit log:', error);
      if (!append) setLoading(false);
      else setLoadingMore(false);
      return;
    }

    let results = data || [];

    // Client-side search by actor name
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      results = results.filter((e) => {
        const name = e.actor?.full_name || e.actor?.email || '';
        return name.toLowerCase().includes(term);
      });
    }

    if (append) {
      setEntries((prev) => [...prev, ...results]);
    } else {
      setEntries(results);
    }

    setHasMore(results.length === PAGE_SIZE);
    if (!append) setLoading(false);
    else setLoadingMore(false);
  }, [dateRange, actionType, gymFilter, searchTerm]);

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
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">Audit Log</h1>
        <p className="text-[12px] text-[#6B7280] mt-0.5">Important platform actions and changes</p>
      </div>

      {/* Summary strip */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-3 gap-2.5 mb-6">
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{totalCount}</p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">Total Actions</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">
              {[...new Set(entries.map(e => e.actor?.full_name).filter(Boolean))].length}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">Active Actors</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums truncate">
              {(() => {
                const actionCounts = {};
                entries.forEach(e => { actionCounts[e.action] = (actionCounts[e.action] || 0) + 1; });
                const top = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0];
                return top ? (ACTION_CONFIG[top[0]]?.label || top[0]) : '—';
              })()}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">Top Action</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-[#6B7280]" />
          <span className="text-[12px] text-[#6B7280] font-medium uppercase tracking-wider">Filters</span>
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
                {dr.label}
              </button>
            ))}
          </div>

          {/* Action type */}
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none"
          >
            {ACTION_TYPES.map((at) => (
              <option key={at.value} value={at.value}>{at.label}</option>
            ))}
          </select>

          {/* Gym filter */}
          <select
            value={gymFilter}
            onChange={(e) => setGymFilter(e.target.value)}
            className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none"
          >
            <option value="all">All Gyms</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="text"
              placeholder="Search by actor name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Log entries */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Settings size={32} className="mx-auto text-[#6B7280] mb-3" />
            <p className="text-[14px] text-[#6B7280]">No audit log entries yet</p>
            <p className="text-[12px] text-[#6B7280]/60 mt-1">
              Actions performed across the platform will appear here
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/4">
              {entries.map((entry) => (
                <LogEntry key={entry.id} entry={entry} />
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
                      Loading...
                    </>
                  ) : (
                    'Load more'
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

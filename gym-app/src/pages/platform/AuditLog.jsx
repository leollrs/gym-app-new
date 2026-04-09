import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2, UserCog, Shield, Snowflake, Settings, Dumbbell, Trophy,
  ChevronDown, Search, Filter, Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays, subHours } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

const PAGE_SIZE = 50;

const ACTION_CONFIG = {
  // Platform actions
  gym_created:       { icon: Building2, color: 'emerald', labelKey: 'platform.audit.actions.gymCreated' },
  gym_deactivated:   { icon: Building2, color: 'red',     labelKey: 'platform.audit.actions.gymDeactivated' },
  role_changed:      { icon: UserCog,   color: 'purple',  labelKey: 'platform.audit.actions.roleChanged' },
  member_banned:     { icon: Shield,    color: 'red',     labelKey: 'platform.audit.actions.memberBanned' },
  member_frozen:     { icon: Snowflake, color: 'amber',   labelKey: 'platform.audit.actions.memberFrozen' },
  settings_updated:  { icon: Settings,  color: 'blue',    labelKey: 'platform.audit.actions.settingsUpdated' },
  exercise_created:  { icon: Dumbbell,  color: 'gold',    labelKey: 'platform.audit.actions.exerciseCreated' },
  challenge_created: { icon: Trophy,    color: 'amber',   labelKey: 'platform.audit.actions.challengeCreated' },
  // Admin actions
  send_message:      { icon: UserCog,   color: 'blue',    labelKey: 'platform.audit.actions.sendMessage' },
  send_sms:          { icon: UserCog,   color: 'amber',   labelKey: 'platform.audit.actions.sendSms' },
  send_email:        { icon: UserCog,   color: 'blue',    labelKey: 'platform.audit.actions.sendEmail' },
  send_winback:      { icon: UserCog,   color: 'purple',  labelKey: 'platform.audit.actions.sendWinback' },
  send_followup:     { icon: UserCog,   color: 'blue',    labelKey: 'platform.audit.actions.sendFollowup' },
  change_status:     { icon: Shield,    color: 'amber',   labelKey: 'platform.audit.actions.changeStatus' },
  update_note:       { icon: Settings,  color: 'blue',    labelKey: 'platform.audit.actions.updateNote' },
  update_info:       { icon: Settings,  color: 'blue',    labelKey: 'platform.audit.actions.updateInfo' },
  set_outcome:       { icon: Settings,  color: 'emerald', labelKey: 'platform.audit.actions.setOutcome' },
  revoke_invite:     { icon: Shield,    color: 'red',     labelKey: 'platform.audit.actions.revokeInvite' },
  bulk_followup:     { icon: UserCog,   color: 'purple',  labelKey: 'platform.audit.actions.bulkFollowup' },
  bulk_freeze:       { icon: Snowflake, color: 'amber',   labelKey: 'platform.audit.actions.bulkFreeze' },
  bulk_message:      { icon: UserCog,   color: 'blue',    labelKey: 'platform.audit.actions.bulkMessage' },
  quick_message:     { icon: UserCog,   color: 'blue',    labelKey: 'platform.audit.actions.quickMessage' },
  create_challenge:  { icon: Trophy,    color: 'amber',   labelKey: 'platform.audit.actions.createChallenge' },
  update_challenge:  { icon: Trophy,    color: 'blue',    labelKey: 'platform.audit.actions.updateChallenge' },
  delete_challenge:  { icon: Trophy,    color: 'red',     labelKey: 'platform.audit.actions.deleteChallenge' },
  award_prizes:      { icon: Trophy,    color: 'gold',    labelKey: 'platform.audit.actions.awardPrizes' },
  create_announcement: { icon: Settings, color: 'emerald', labelKey: 'platform.audit.actions.createAnnouncement' },
  create_product:    { icon: Settings,  color: 'emerald', labelKey: 'platform.audit.actions.createProduct' },
  update_product:    { icon: Settings,  color: 'blue',    labelKey: 'platform.audit.actions.updateProduct' },
  toggle_product:    { icon: Settings,  color: 'amber',   labelKey: 'platform.audit.actions.toggleProduct' },
  delete_product:    { icon: Settings,  color: 'red',     labelKey: 'platform.audit.actions.deleteProduct' },
  add_trainer:       { icon: UserCog,   color: 'emerald', labelKey: 'platform.audit.actions.addTrainer' },
  demote_trainer:    { icon: UserCog,   color: 'red',     labelKey: 'platform.audit.actions.demoteTrainer' },
  moderate_post:     { icon: Shield,    color: 'amber',   labelKey: 'platform.audit.actions.moderatePost' },
  moderate_comment:  { icon: Shield,    color: 'amber',   labelKey: 'platform.audit.actions.moderateComment' },
  action_report:     { icon: Shield,    color: 'purple',  labelKey: 'platform.audit.actions.actionReport' },
  create_reward:     { icon: Trophy,    color: 'gold',    labelKey: 'platform.audit.actions.createReward' },
  update_reward:     { icon: Trophy,    color: 'blue',    labelKey: 'platform.audit.actions.updateReward' },
  delete_reward:     { icon: Trophy,    color: 'red',     labelKey: 'platform.audit.actions.deleteReward' },
  create_milestone:  { icon: Trophy,    color: 'emerald', labelKey: 'platform.audit.actions.createMilestone' },
  delete_milestone:  { icon: Trophy,    color: 'red',     labelKey: 'platform.audit.actions.deleteMilestone' },
  update_settings:   { icon: Settings,  color: 'blue',    labelKey: 'platform.audit.actions.updateSettings' },
  update_hours:      { icon: Settings,  color: 'blue',    labelKey: 'platform.audit.actions.updateHours' },
  update_closures:   { icon: Settings,  color: 'amber',   labelKey: 'platform.audit.actions.updateClosures' },
  create_class:      { icon: Dumbbell,  color: 'emerald', labelKey: 'platform.audit.actions.createClass' },
  update_class:      { icon: Dumbbell,  color: 'blue',    labelKey: 'platform.audit.actions.updateClass' },
  delete_class:      { icon: Dumbbell,  color: 'red',     labelKey: 'platform.audit.actions.deleteClass' },
  create_program:    { icon: Dumbbell,  color: 'emerald', labelKey: 'platform.audit.actions.createProgram' },
  update_program:    { icon: Dumbbell,  color: 'blue',    labelKey: 'platform.audit.actions.updateProgram' },
  delete_program:    { icon: Dumbbell,  color: 'red',     labelKey: 'platform.audit.actions.deleteProgram' },
  checkin_scan:      { icon: Shield,    color: 'emerald', labelKey: 'platform.audit.actions.checkinScan' },
  purchase_scan:     { icon: Settings,  color: 'gold',    labelKey: 'platform.audit.actions.purchaseScan' },
  claim_reward:      { icon: Trophy,    color: 'gold',    labelKey: 'platform.audit.actions.claimReward' },
  referral_scan:     { icon: UserCog,   color: 'emerald', labelKey: 'platform.audit.actions.referralScan' },
};

const COLOR_MAP = {
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  red:     { bg: 'bg-red-500/15',     text: 'text-red-400' },
  purple:  { bg: 'bg-purple-500/15',  text: 'text-purple-400' },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-400' },
  blue:    { bg: 'bg-blue-500/15',    text: 'text-blue-400' },
  gold:    { bg: 'bg-[#D4AF37]/15',   text: 'text-[#D4AF37]' },
};

const DATE_RANGE_KEYS = [
  { labelKey: 'platform.audit.dateRange.last24h', fallback: 'Last 24h', value: '24h' },
  { labelKey: 'platform.audit.dateRange.7days',   fallback: '7 days',   value: '7d' },
  { labelKey: 'platform.audit.dateRange.30days',  fallback: '30 days',  value: '30d' },
  { labelKey: 'platform.audit.dateRange.allTime', fallback: 'All time', value: 'all' },
];

const ACTION_TYPE_KEYS = [
  { labelKey: 'platform.audit.filter.allActions',          fallback: 'All Actions',        value: 'all' },
  { labelKey: 'platform.audit.actions.sendMessage',        fallback: 'Message Sent',       value: 'send_message' },
  { labelKey: 'platform.audit.actions.sendSms',            fallback: 'SMS Sent',           value: 'send_sms' },
  { labelKey: 'platform.audit.actions.sendEmail',          fallback: 'Email Sent',         value: 'send_email' },
  { labelKey: 'platform.audit.actions.sendWinback',        fallback: 'Win-Back Sent',      value: 'send_winback' },
  { labelKey: 'platform.audit.actions.changeStatus',       fallback: 'Status Changed',     value: 'change_status' },
  { labelKey: 'platform.audit.actions.checkinScan',        fallback: 'Check-in Scan',      value: 'checkin_scan' },
  { labelKey: 'platform.audit.actions.purchaseScan',       fallback: 'Purchase Scan',      value: 'purchase_scan' },
  { labelKey: 'platform.audit.actions.claimReward',        fallback: 'Reward Claimed',     value: 'claim_reward' },
  { labelKey: 'platform.audit.actions.createAnnouncement', fallback: 'Announcement',       value: 'create_announcement' },
  { labelKey: 'platform.audit.actions.createChallenge',    fallback: 'Challenge Created',  value: 'create_challenge' },
  { labelKey: 'platform.audit.actions.addTrainer',         fallback: 'Trainer Added',      value: 'add_trainer' },
  { labelKey: 'platform.audit.actions.moderatePost',       fallback: 'Post Moderated',     value: 'moderate_post' },
  { labelKey: 'platform.audit.actions.updateSettings',     fallback: 'Settings Updated',   value: 'update_settings' },
  { labelKey: 'platform.audit.actions.gymCreated',         fallback: 'Gym Created',        value: 'gym_created' },
  { labelKey: 'platform.audit.actions.roleChanged',        fallback: 'Role Changed',       value: 'role_changed' },
];

function buildDescription(action, metadata, t) {
  switch (action) {
    case 'gym_created':
      return t('platform.audit.desc.gymCreated', { name: metadata?.gym_name || t('platform.audit.unknown', 'Unknown'), defaultValue: 'created gym "{{name}}"' });
    case 'gym_deactivated':
      return t('platform.audit.desc.gymDeactivated', { name: metadata?.gym_name || t('platform.audit.unknown', 'Unknown'), defaultValue: 'deactivated gym "{{name}}"' });
    case 'role_changed':
      return t('platform.audit.desc.roleChanged', { target: metadata?.target_name || t('platform.audit.aMember', 'a member'), oldRole: metadata?.old_role || '?', newRole: metadata?.new_role || '?', defaultValue: 'changed role of {{target}} from {{oldRole}} to {{newRole}}' });
    case 'member_banned':
      return t('platform.audit.desc.memberBanned', { target: metadata?.target_name || t('platform.audit.aMember', 'a member'), defaultValue: 'banned {{target}}' }) + (metadata?.reason ? ` — ${metadata.reason}` : '');
    case 'member_frozen':
      return t('platform.audit.desc.memberFrozen', { target: metadata?.target_name || t('platform.audit.aMember', 'a member'), defaultValue: 'froze membership of {{target}}' });
    case 'settings_updated':
      return t('platform.audit.desc.settingsUpdated', { setting: metadata?.setting || t('platform.audit.settings', 'settings'), defaultValue: 'updated {{setting}}' });
    case 'exercise_created':
      return t('platform.audit.desc.exerciseCreated', { name: metadata?.exercise_name || t('platform.audit.unknown', 'Unknown'), defaultValue: 'created exercise "{{name}}"' });
    case 'challenge_created':
      return t('platform.audit.desc.challengeCreated', { name: metadata?.challenge_name || t('platform.audit.unknown', 'Unknown'), defaultValue: 'created challenge "{{name}}"' });
    default:
      return t('platform.audit.desc.genericAction', { action, defaultValue: 'performed action: {{action}}' });
  }
}

function LogEntry({ entry, t, dateFnsLocale }) {
  const [expanded, setExpanded] = useState(false);
  const config = ACTION_CONFIG[entry.action] || { icon: Settings, color: 'blue', labelKey: null };
  const colors = COLOR_MAP[config.color] || COLOR_MAP.blue;
  const Icon = config.icon;
  const actorName = entry.actor?.full_name || entry.actor?.username || t('platform.audit.system', 'System');
  const gymName = entry.gym?.name || (entry.gym_id ? t('platform.audit.unknownGym', 'Unknown Gym') : t('platform.audit.platform', 'Platform'));
  const description = buildDescription(entry.action, entry.metadata, t);
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
          {formatDistanceToNow(createdAt, { addSuffix: true, ...(dateFnsLocale || {}) })} · {gymName}
        </p>
        <p className="text-[10px] text-[#6B7280] mt-0.5">
          {format(createdAt, 'MMM d, yyyy · HH:mm:ss', dateFnsLocale || {})}
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
            {expanded ? t('platform.audit.hideDetails', 'Hide details') : t('platform.audit.showDetails', 'Show details')}
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
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [uniqueActors, setUniqueActors] = useState(0);

  const [dateRange, setDateRange] = useState('7d');
  const [actionType, setActionType] = useState('all');
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

  // Helper to apply shared filters to a query builder
  const applyFilters = useCallback((query) => {
    if (dateRange === '24h') {
      query = query.gte('created_at', subHours(new Date(), 24).toISOString());
    } else if (dateRange === '7d') {
      query = query.gte('created_at', subDays(new Date(), 7).toISOString());
    } else if (dateRange === '30d') {
      query = query.gte('created_at', subDays(new Date(), 30).toISOString());
    }
    if (actionType !== 'all') {
      query = query.eq('action', actionType);
    }
    if (gymFilter !== 'all') {
      query = query.eq('gym_id', gymFilter);
    }
    if (debouncedSearch.trim()) {
      query = query.ilike('action', `%${debouncedSearch.trim()}%`);
    }
    return query;
  }, [dateRange, actionType, gymFilter, debouncedSearch]);

  const fetchEntries = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    // Main data query
    let query = supabase
      .from('audit_log')
      .select(`
        id, gym_id, actor_id, action, target_type, target_id, metadata, created_at,
        actor:profiles!audit_log_actor_id_fkey ( id, full_name, username ),
        gym:gyms!audit_log_gym_id_fkey ( id, name )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    query = applyFilters(query);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching audit log:', error);
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

    // Fetch distinct actor count server-side (only on first page load)
    if (!append) {
      let actorListQuery = supabase
        .from('audit_log')
        .select('actor_id');
      actorListQuery = applyFilters(actorListQuery);
      const { data: actorData } = await actorListQuery;
      if (actorData) {
        setUniqueActors([...new Set(actorData.map(r => r.actor_id).filter(Boolean))].length);
      }
    }
  }, [applyFilters]);

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
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{t('platform.audit.title', 'Audit Log')}</h1>
        <p className="text-[12px] text-[#6B7280] mt-0.5">{t('platform.audit.subtitle', 'Important platform actions and changes')}</p>
      </div>

      {/* Summary strip */}
      {!loading && (totalCount > 0 || entries.length > 0) && (
        <div className="grid grid-cols-3 md:grid-cols-3 gap-2.5 mb-6">
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{totalCount.toLocaleString()}</p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.audit.totalActions', 'Total Actions')}</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">
              {uniqueActors}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.audit.activeActors', 'Active Actors')}</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
            <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums truncate">
              {(() => {
                const actionCounts = {};
                entries.forEach(e => { actionCounts[e.action] = (actionCounts[e.action] || 0) + 1; });
                const top = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0];
                return top ? (ACTION_CONFIG[top[0]]?.labelKey ? t(ACTION_CONFIG[top[0]].labelKey) : top[0]) : '—';
              })()}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.audit.topAction', 'Top Action')}{entries.length < totalCount ? ` (${t('platform.audit.fromLoaded', 'from loaded')})` : ''}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-[#6B7280]" />
          <span className="text-[12px] text-[#6B7280] font-medium uppercase tracking-wider">{t('platform.audit.filters', 'Filters')}</span>
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Date range */}
          <div className="flex gap-1 flex-wrap">
            {DATE_RANGE_KEYS.map((dr) => (
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

          {/* Action type */}
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none"
          >
            {ACTION_TYPE_KEYS.map((at) => (
              <option key={at.value} value={at.value}>{t(at.labelKey, at.fallback)}</option>
            ))}
          </select>

          {/* Gym filter */}
          <select
            value={gymFilter}
            onChange={(e) => setGymFilter(e.target.value)}
            className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none"
          >
            <option value="all">{t('platform.audit.allGyms', 'All Gyms')}</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="text"
              placeholder={t('platform.audit.searchPlaceholder', 'Search by actor name...')}
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
          <PlatformSpinner />
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Settings size={32} className="mx-auto text-[#6B7280] mb-3" />
            <p className="text-[14px] text-[#6B7280]">{t('platform.audit.empty', 'No audit log entries yet')}</p>
            <p className="text-[12px] text-[#6B7280]/60 mt-1">
              {t('platform.audit.emptyHint', 'Actions performed across the platform will appear here')}
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/4">
              {entries.map((entry) => (
                <LogEntry key={entry.id} entry={entry} t={t} dateFnsLocale={dateFnsLocale} />
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
                      {t('platform.audit.loading', 'Loading...')}
                    </>
                  ) : (
                    t('platform.audit.loadMore', 'Load more')
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

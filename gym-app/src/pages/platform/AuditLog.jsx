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
  const unknown = () => t('platform.audit.unknown', 'Unknown');
  const aMember = () => t('platform.audit.aMember', 'a member');
  const target = metadata?.target_name || metadata?.member_name || aMember();
  const setting = metadata?.setting || metadata?.field;
  const flag = metadata?.flag;
  const banReason = metadata?.reason ? ` — ${metadata.reason}` : '';

  switch (action) {
    // Platform-level
    case 'gym_created':
    case 'create_gym':
      return t('platform.audit.desc.gymCreated', { name: metadata?.gym_name || metadata?.name || unknown(), defaultValue: 'created gym "{{name}}"' });
    case 'gym_deactivated':
    case 'permanently_deactivate_gym':
      return t('platform.audit.desc.gymDeactivated', { name: metadata?.gym_name || unknown(), defaultValue: 'deactivated gym "{{name}}"' });
    case 'pause_gym':
      return t('platform.audit.desc.gymPaused', { name: metadata?.gym_name || unknown(), defaultValue: 'paused gym "{{name}}"' });
    case 'reactivate_gym':
      return t('platform.audit.desc.gymReactivated', { name: metadata?.gym_name || unknown(), defaultValue: 'reactivated gym "{{name}}"' });
    case 'toggle_feature_flag':
      return t('platform.audit.desc.toggleFlag', { flag: flag || unknown(), state: metadata?.enabled ? t('platform.audit.on', 'on') : t('platform.audit.off', 'off'), defaultValue: 'turned {{state}} feature flag "{{flag}}"' });
    case 'toggle_email_flag':
      return t('platform.audit.desc.toggleEmail', { flag: flag || unknown(), state: metadata?.enabled ? t('platform.audit.on', 'on') : t('platform.audit.off', 'off'), defaultValue: 'turned {{state}} email "{{flag}}"' });
    case 'save_gym_defaults':
      return t('platform.audit.desc.saveDefaults', 'updated default gym configuration');

    // Member status
    case 'role_changed':
    case 'change_role':
      return t('platform.audit.desc.roleChanged', { target, oldRole: metadata?.from || metadata?.old_role || '?', newRole: metadata?.to || metadata?.new_role || '?', defaultValue: 'changed role of {{target}} from {{oldRole}} to {{newRole}}' });
    case 'change_status':
      return t('platform.audit.desc.statusChanged', { target, oldStatus: metadata?.from || '?', newStatus: metadata?.to || '?', defaultValue: 'changed {{target}} status from {{oldStatus}} to {{newStatus}}' });
    case 'member_banned':
      return t('platform.audit.desc.memberBanned', { target, defaultValue: 'banned {{target}}' }) + banReason;
    case 'member_frozen':
      return t('platform.audit.desc.memberFrozen', { target, defaultValue: 'froze membership of {{target}}' });
    case 'deactivate_member':
      return t('platform.audit.desc.memberDeactivated', { target, defaultValue: 'deactivated {{target}}' });
    case 'reset_password':
      return t('platform.audit.desc.resetPassword', { target, defaultValue: 'generated a password reset for {{target}}' });
    case 'resend_invite':
      return t('platform.audit.desc.resendInvite', { target, defaultValue: 'resent invite to {{target}}' });
    case 'revoke_invite':
      return t('platform.audit.desc.revokeInvite', { target, defaultValue: 'revoked invite for {{target}}' });

    // Communications
    case 'send_message':
    case 'quick_message':
    case 'bulk_message':
      return t('platform.audit.desc.sendMessage', { target, defaultValue: 'messaged {{target}}' });
    case 'send_sms':
      return t('platform.audit.desc.sendSms', { target, defaultValue: 'texted {{target}}' });
    case 'send_email':
      return t('platform.audit.desc.sendEmail', { target, defaultValue: 'emailed {{target}}' });
    case 'send_winback':
      return t('platform.audit.desc.sendWinback', { target, defaultValue: 'sent win-back to {{target}}' });
    case 'send_followup':
      return t('platform.audit.desc.sendFollowup', { target, defaultValue: 'sent follow-up to {{target}}' });
    case 'bulk_followup':
      return t('platform.audit.desc.bulkFollowup', { count: metadata?.count || '?', defaultValue: 'sent follow-ups to {{count}} members' });
    case 'bulk_freeze':
      return t('platform.audit.desc.bulkFreeze', { count: metadata?.count || '?', defaultValue: 'froze {{count}} memberships' });
    case 'set_outcome':
      return t('platform.audit.desc.setOutcome', { target, outcome: metadata?.outcome || '?', defaultValue: 'set follow-up outcome for {{target}}: {{outcome}}' });
    case 'update_note':
      return t('platform.audit.desc.updateNote', { target, defaultValue: 'updated note on {{target}}' });
    case 'update_info':
      return t('platform.audit.desc.updateInfo', { target, defaultValue: 'updated profile info for {{target}}' });

    // Settings
    case 'settings_updated':
    case 'update_settings':
      return t('platform.audit.desc.settingsUpdated', { setting: setting || t('platform.audit.settings', 'settings'), defaultValue: 'updated {{setting}}' });
    case 'update_hours':
      return t('platform.audit.desc.updateHours', 'updated gym hours');
    case 'update_closures':
      return t('platform.audit.desc.updateClosures', 'updated gym closures');

    // Content
    case 'exercise_created':
      return t('platform.audit.desc.exerciseCreated', { name: metadata?.exercise_name || metadata?.name || unknown(), defaultValue: 'created exercise "{{name}}"' });
    case 'create_announcement':
      return t('platform.audit.desc.createAnnouncement', { title: metadata?.title || unknown(), defaultValue: 'posted announcement "{{title}}"' });
    case 'create_class':
      return t('platform.audit.desc.createClass', { name: metadata?.class_name || metadata?.name || unknown(), defaultValue: 'created class "{{name}}"' });
    case 'update_class':
      return t('platform.audit.desc.updateClass', { name: metadata?.class_name || metadata?.name || unknown(), defaultValue: 'updated class "{{name}}"' });
    case 'delete_class':
      return t('platform.audit.desc.deleteClass', { name: metadata?.class_name || metadata?.name || unknown(), defaultValue: 'deleted class "{{name}}"' });
    case 'delete_schedule_slot':
      return t('platform.audit.desc.deleteSlot', 'removed a class schedule slot');
    case 'create_program':
      return t('platform.audit.desc.createProgram', { name: metadata?.program_name || metadata?.name || unknown(), defaultValue: 'created program "{{name}}"' });
    case 'update_program':
      return t('platform.audit.desc.updateProgram', { name: metadata?.program_name || metadata?.name || unknown(), defaultValue: 'updated program "{{name}}"' });
    case 'delete_program':
      return t('platform.audit.desc.deleteProgram', { name: metadata?.program_name || metadata?.name || unknown(), defaultValue: 'deleted program "{{name}}"' });

    // Challenges
    case 'challenge_created':
    case 'create_challenge':
      return t('platform.audit.desc.challengeCreated', { name: metadata?.challenge_name || metadata?.name || unknown(), defaultValue: 'created challenge "{{name}}"' });
    case 'update_challenge':
      return t('platform.audit.desc.challengeUpdated', { name: metadata?.challenge_name || metadata?.name || unknown(), defaultValue: 'updated challenge "{{name}}"' });
    case 'delete_challenge':
      return t('platform.audit.desc.challengeDeleted', { name: metadata?.challenge_name || metadata?.name || unknown(), defaultValue: 'deleted challenge "{{name}}"' });
    case 'award_prizes':
      return t('platform.audit.desc.awardPrizes', { name: metadata?.challenge_name || unknown(), defaultValue: 'awarded prizes for "{{name}}"' });

    // Store / rewards
    case 'create_product':
      return t('platform.audit.desc.createProduct', { name: metadata?.name || unknown(), defaultValue: 'created product "{{name}}"' });
    case 'update_product':
      return t('platform.audit.desc.updateProduct', { name: metadata?.name || unknown(), defaultValue: 'updated product "{{name}}"' });
    case 'toggle_product':
      return t('platform.audit.desc.toggleProduct', { name: metadata?.name || unknown(), state: metadata?.is_active ? t('platform.audit.on', 'on') : t('platform.audit.off', 'off'), defaultValue: 'turned {{state}} product "{{name}}"' });
    case 'delete_product':
      return t('platform.audit.desc.deleteProduct', { name: metadata?.name || unknown(), defaultValue: 'deleted product "{{name}}"' });
    case 'create_reward':
      return t('platform.audit.desc.createReward', { name: metadata?.name || unknown(), defaultValue: 'created reward "{{name}}"' });
    case 'update_reward':
      return t('platform.audit.desc.updateReward', { name: metadata?.name || unknown(), defaultValue: 'updated reward "{{name}}"' });
    case 'delete_reward':
      return t('platform.audit.desc.deleteReward', { name: metadata?.name || unknown(), defaultValue: 'deleted reward "{{name}}"' });
    case 'create_milestone':
      return t('platform.audit.desc.createMilestone', { name: metadata?.name || unknown(), defaultValue: 'created milestone "{{name}}"' });
    case 'delete_milestone':
      return t('platform.audit.desc.deleteMilestone', { name: metadata?.name || unknown(), defaultValue: 'deleted milestone "{{name}}"' });
    case 'claim_reward':
      return t('platform.audit.desc.claimReward', { name: metadata?.name || metadata?.reward || unknown(), defaultValue: 'claimed reward "{{name}}"' });

    // Trainers
    case 'add_trainer':
      return t('platform.audit.desc.addTrainer', { target, defaultValue: 'promoted {{target}} to trainer' });
    case 'demote_trainer':
      return t('platform.audit.desc.demoteTrainer', { target, defaultValue: 'demoted trainer {{target}}' });

    // Moderation
    case 'moderate_post':
      return t('platform.audit.desc.moderatePost', { action: metadata?.moderation_action || metadata?.outcome || 'reviewed', defaultValue: 'moderated a post: {{action}}' });
    case 'moderate_comment':
      return t('platform.audit.desc.moderateComment', { action: metadata?.moderation_action || metadata?.outcome || 'reviewed', defaultValue: 'moderated a comment: {{action}}' });
    case 'action_report':
      return t('platform.audit.desc.actionReport', { outcome: metadata?.outcome || 'reviewed', defaultValue: 'actioned report: {{outcome}}' });

    // Scans
    case 'checkin_scan':
      return t('platform.audit.desc.checkinScan', { target, defaultValue: 'scanned check-in for {{target}}' });
    case 'purchase_scan':
      return t('platform.audit.desc.purchaseScan', { target, defaultValue: 'scanned purchase for {{target}}' });
    case 'referral_scan':
      return t('platform.audit.desc.referralScan', { target, defaultValue: 'scanned referral for {{target}}' });

    default:
      // Last resort — use the action name verbatim, but at least translate the wrapper
      return t('platform.audit.desc.genericAction', { action: action.replace(/_/g, ' '), defaultValue: 'performed action: {{action}}' });
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

  useEffect(() => {
    document.title = `${t('platform.audit.title', 'Audit Log')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

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
    const now = new Date();
    if (dateRange === '24h') {
      query = query
        .gte('created_at', subHours(now, 24).toISOString())
        .lte('created_at', now.toISOString());
    } else if (dateRange === '7d') {
      query = query
        .gte('created_at', subDays(now, 7).toISOString())
        .lte('created_at', now.toISOString());
    } else if (dateRange === '30d') {
      query = query
        .gte('created_at', subDays(now, 30).toISOString())
        .lte('created_at', now.toISOString());
    }
    if (actionType !== 'all') {
      query = query.eq('action', actionType);
    }
    if (gymFilter !== 'all') {
      query = query.eq('gym_id', gymFilter);
    }
    if (debouncedSearch.trim()) {
      // Search action key (actor name search would require joining profiles via RPC)
      const safe = debouncedSearch.trim().replace(/[%_\\,()."']/g, '');
      query = query.ilike('action', `%${safe}%`);
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
              placeholder={t('platform.audit.searchPlaceholder', 'Search by action...')}
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

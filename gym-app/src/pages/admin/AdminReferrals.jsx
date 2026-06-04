import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useTranslation } from 'react-i18next';
import { AdminPageShell, FadeIn, CardSkeleton } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import ReferralProgramConfig from './components/ReferralProgramConfig';
import ReferralMilestonesCard from './components/ReferralMilestonesCard';
import { TK, FK, Ico, ICON, Card, IconChip, Pill, Avatar } from './components/retosKit';

const PERIODS = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: null },
];

const MEDAL = [
  { col: '#E0A82E', bg: 'color-mix(in srgb, #E0A82E 18%, transparent)' },
  { col: '#9AA4AE', bg: 'color-mix(in srgb, #9AA4AE 20%, transparent)' },
  { col: '#C77B3E', bg: 'color-mix(in srgb, #C77B3E 18%, transparent)' },
];

// Renders a referral reward (points OR inventory item) as a readable string.
// Replaces the old banner that printed "[object Object] pts" for the object shape.
function formatReward(r, rewards, isEs, t) {
  if (r == null) return '—';
  if (typeof r === 'number') return `${r.toLocaleString()} ${t('admin.referrals.pointsLabel', 'pts')}`;
  if (typeof r !== 'object') return String(r);
  if (r.type === 'gym_reward') {
    const rw = (rewards || []).find(x => x.id === r.reward_id);
    if (rw) return (isEs && rw.name_es) ? rw.name_es : rw.name;
    return t('admin.referrals.aReward', 'Reward');
  }
  const v = Number(r.value ?? r.points ?? 0) || 0;
  return `${v.toLocaleString()} ${t('admin.referrals.pointsLabel', 'pts')}`;
}

// circular initial disc (accent-tinted)
function InitialDisc({ name, size = 34 }) {
  const ch = (name || '?').charAt(0).toUpperCase();
  return (
    <span style={{ width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.accentSoft, color: TK.accent, fontFamily: FK.display, fontSize: size * 0.41, fontWeight: 800 }}>{ch}</span>
  );
}

// stat card with colored left rail
function RefStat({ value, label, icon, rail, tone }) {
  return (
    <Card style={{ position: 'relative', overflow: 'hidden', padding: '20px 22px' }}>
      <span style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3.5, borderRadius: 99, background: rail }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: TK.text }}>{value}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 8 }}>{label}</div>
        </div>
        <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: tone.bg, border: `1px solid ${tone.line}` }}>
          <Ico ch={icon} size={19} color={tone.ink} stroke={2} />
        </span>
      </div>
    </Card>
  );
}

// banner reward meta
function Meta({ label, value }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: FK.body, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.accent, opacity: 0.75 }}>{label}</span>
      <span style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, letterSpacing: -0.4, color: TK.accentInk, whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  );
}

// status pill for a referral row
function RefStatusPill({ status, t }) {
  const map = {
    completed: { tone: 'good', icon: ICON.checkCircle, color: 'var(--color-success)', bg: 'var(--color-success-soft)', line: 'color-mix(in srgb, var(--color-success) 30%, transparent)', ink: 'var(--color-success-ink, var(--color-success))' },
    pending: { tone: 'warn', icon: ICON.clock, color: 'var(--color-warning)', bg: 'var(--color-warning-soft)', line: 'color-mix(in srgb, var(--color-warning) 30%, transparent)', ink: 'var(--color-warning-ink, var(--color-warning))' },
    expired: { tone: 'hot', icon: ICON.x, color: 'var(--color-danger)', bg: 'var(--color-danger-soft)', line: 'color-mix(in srgb, var(--color-danger) 30%, transparent)', ink: 'var(--color-danger-ink, var(--color-danger))' },
  };
  const c = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: c.bg, border: `1px solid ${c.line}`, flexShrink: 0 }}>
      <Ico ch={c.icon} size={13} color={c.color} stroke={2.2} />
      <span style={{ fontFamily: FK.body, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: c.ink }}>
        {t(`admin.referrals.status.${status}`, status)}
      </span>
    </span>
  );
}

export default function AdminReferrals() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  const [tab, setTab] = useState('activity');
  const [period, setPeriod] = useState(PERIODS[1]);
  const [search, setSearch] = useState('');
  const [showApprovalQueue, setShowApprovalQueue] = useState(true);

  useEffect(() => { document.title = t('admin.referrals.pageTitle', 'Referrals · Admin'); }, [t]);

  // Referral config (gyms.referral_config JSONB)
  const { data: config } = useQuery({
    queryKey: adminKeys.referrals?.config?.(gymId) ?? ['admin', 'referral-config', gymId],
    queryFn: async () => {
      const { data } = await supabase.from('gyms').select('referral_config').eq('id', gymId).single();
      return data?.referral_config ?? null;
    },
    enabled: !!gymId,
  });

  // Active rewards inventory — used to resolve gym_reward names in the banner.
  // Same key as the config/milestones cards → dedup + shared cache.
  const { data: rewards = [] } = useQuery({
    queryKey: ['admin', 'rewards', gymId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, emoji_icon, is_active, sort_order')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // Referrals list
  const { data: referrals = [], isLoading } = useQuery({
    queryKey: [...(adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId]), period.key],
    queryFn: async () => {
      let query = supabase
        .from('referrals')
        .select('*, referrer:profiles!referrals_referrer_id_fkey(id, full_name, avatar_url, avatar_type, avatar_value), referred:profiles!referrals_referred_id_fkey(id, full_name)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (period.days) query = query.gte('created_at', subDays(new Date(), period.days).toISOString());
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter(r => r.referrer);
    },
    enabled: !!gymId,
  });

  const approveMutation = useMutation({
    mutationFn: async (referralId) => {
      const { error } = await supabase
        .from('referrals')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', referralId)
        .eq('gym_id', gymId); // defense-in-depth: scope to this gym, not RLS alone
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId] });
      showToast(t('admin.referrals.approvedToast', 'Referral approved'), 'success');
    },
    onError: () => showToast(t('admin.referrals.approveFailedToast', 'Failed to approve referral'), 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (referralId) => {
      const { error } = await supabase
        .from('referrals')
        .update({ status: 'expired' })
        .eq('id', referralId)
        .eq('gym_id', gymId); // defense-in-depth: scope to this gym, not RLS alone
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId] });
      showToast(t('admin.referrals.rejectedToast', 'Referral rejected'), 'success');
    },
    onError: () => showToast(t('admin.referrals.rejectFailedToast', 'Failed to reject referral'), 'error'),
  });

  // Self-referral filter applied to ALL metrics + lists (referrer.id === referred.id).
  const validReferrals = referrals.filter(r => !r.referrer?.id || r.referrer.id !== r.referred?.id);

  const total = validReferrals.length;
  const completed = validReferrals.filter(r => r.status === 'completed').length;
  const pending = validReferrals.filter(r => r.status === 'pending').length;
  const pointsAwarded = validReferrals
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.points_awarded || 0), 0);

  const topReferrers = Object.values(
    validReferrals
      .filter(r => r.status === 'completed' && r.referrer?.id)
      .reduce((acc, r) => {
        const id = r.referrer?.id;
        if (!id) return acc;
        if (!acc[id]) acc[id] = { ...r.referrer, count: 0 };
        acc[id].count++;
        return acc;
      }, {})
  ).sort((a, b) => b.count - a.count).slice(0, 10);

  const pendingApproval = validReferrals.filter(r => r.status === 'pending');

  const filtered = validReferrals.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.referrer?.full_name?.toLowerCase().includes(q) ||
      r.referred?.full_name?.toLowerCase().includes(q)
    );
  });

  const handleExportCSV = async () => {
    const { exportCSV } = await import('../../lib/csvExport');
    await exportCSV({
      filename: 'referrals',
      columns: [
        { key: 'referrer', label: t('admin.referrals.csvReferrer', 'Referrer') },
        { key: 'referred', label: t('admin.referrals.csvReferred', 'Referred') },
        { key: 'status', label: t('admin.referrals.csvStatus', 'Status') },
        { key: 'date', label: t('admin.referrals.csvDate', 'Date') },
        { key: 'points', label: t('admin.referrals.csvPoints', 'Points') },
      ],
      data: filtered.map(r => ({
        referrer: r.referrer?.full_name || '',
        referred: r.referred?.full_name || '',
        status: r.status,
        date: format(new Date(r.created_at), 'yyyy-MM-dd'),
        points: r.points_awarded || 0,
      })),
    });
  };

  const tabOptions = useMemo(() => [
    { key: 'activity', label: t('admin.referrals.tabActivity', 'Activity') },
    { key: 'config', label: t('admin.referrals.tabConfig', 'Configuration') },
  ], [t]);

  // Banner values (resilient to legacy shapes)
  const referrerStr = formatReward(config?.referrer_reward ?? config?.points_per_referral, rewards, isEs, t);
  const friendStr = formatReward(config?.referred_reward, rewards, isEs, t);
  const approvalStr = config?.require_admin_approval ? t('admin.referrals.bannerManual', 'Manual') : t('admin.referrals.bannerAuto', 'Automatic');
  const programOn = config?.enabled !== false;

  const exportDisabled = isLoading || !filtered.length;

  const ActivityTab = (
    <div style={{ paddingTop: 4 }}>
      {/* program banner — live summary */}
      {config && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4" style={{ marginTop: 18, padding: '16px 22px', borderRadius: 14, background: TK.accentWash, border: `1px solid ${TK.accentLine}` }}>
          <div className="flex items-center gap-4" style={{ flex: 1, minWidth: 0 }}>
            <IconChip ch={ICON.gift} tone="accent" size={42} r={12} strokeW={2} />
            <div className="flex flex-wrap items-center" style={{ gap: '12px 28px' }}>
              <Meta label={t('admin.referrals.bannerReferrer', 'Referrer reward')} value={referrerStr} />
              <Meta label={t('admin.referrals.bannerFriend', 'Friend reward')} value={friendStr} />
              <Meta label={t('admin.referrals.bannerApproval', 'Approval')} value={approvalStr} />
            </div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 999, flexShrink: 0, alignSelf: 'flex-start', background: programOn ? 'var(--color-success-soft)' : TK.surface3, border: `1px solid ${programOn ? 'color-mix(in srgb, var(--color-success) 30%, transparent)' : TK.borderSolid}` }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: programOn ? 'var(--color-success)' : TK.textFaint, boxShadow: programOn ? '0 0 0 3px color-mix(in srgb, var(--color-success) 22%, transparent)' : 'none' }} />
            <span style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: programOn ? 'var(--color-success-ink, var(--color-success))' : TK.textMute }}>
              {programOn ? t('admin.referrals.statusActive', 'Active') : t('admin.referrals.statusPaused', 'Paused')}
            </span>
          </span>
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] md:gap-[18px]" style={{ marginTop: 18 }}>
        <RefStat value={total} label={t('admin.referrals.totalReferrals', 'Total Referrals')} icon={ICON.gift} rail={TK.accent} tone={{ bg: TK.accentSoft, line: TK.accentLine, ink: TK.accent }} />
        <RefStat value={completed} label={t('admin.referrals.completed', 'Completed')} icon={ICON.checkCircle} rail="var(--color-success)" tone={{ bg: 'var(--color-success-soft)', line: 'color-mix(in srgb, var(--color-success) 32%, transparent)', ink: 'var(--color-success)' }} />
        <RefStat value={pending} label={t('admin.referrals.pending', 'Pending')} icon={ICON.clock} rail="var(--color-info)" tone={{ bg: 'var(--color-info-soft)', line: 'color-mix(in srgb, var(--color-info) 32%, transparent)', ink: 'var(--color-info)' }} />
        <RefStat value={pointsAwarded} label={t('admin.referrals.pointsAwarded', 'Points Awarded')} icon={ICON.trend} rail="var(--color-coach)" tone={{ bg: 'var(--color-coach-soft)', line: 'color-mix(in srgb, var(--color-coach) 32%, transparent)', ink: 'var(--color-coach)' }} />
      </div>

      {/* approval queue */}
      {config?.require_admin_approval && pendingApproval.length > 0 && (
        <Card style={{ overflow: 'hidden', marginTop: 18 }}>
          <button type="button" onClick={() => setShowApprovalQueue(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <IconChip ch={ICON.clock} tone="warn" size={34} r={10} strokeW={2} />
            <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text }}>{t('admin.referrals.approvalQueue', 'Approval Queue')}</span>
            <Pill tone="warn">{pendingApproval.length}</Pill>
            <span style={{ marginLeft: 'auto' }}><Ico ch={showApprovalQueue ? ICON.chevU : ICON.chevD} size={16} color={TK.textMute} stroke={2.2} /></span>
          </button>
          {showApprovalQueue && pendingApproval.map((ref) => (
            <div key={ref.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderTop: `1px solid ${TK.divider}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <InitialDisc name={ref.referrer?.full_name} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}</div>
                  <div style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute }}>{t('admin.referrals.referred', 'referred')} {ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => approveMutation.mutate(ref.id)} disabled={approveMutation.isPending}
                  style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)', cursor: 'pointer', background: 'var(--color-success-soft)', color: 'var(--color-success-ink, var(--color-success))', fontFamily: FK.body, fontSize: 12.5, fontWeight: 800 }}>
                  {t('admin.referrals.approve', 'Approve')}
                </button>
                <button type="button" onClick={() => rejectMutation.mutate(ref.id)} disabled={rejectMutation.isPending}
                  style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)', cursor: 'pointer', background: 'var(--color-danger-soft)', color: 'var(--color-danger-ink, var(--color-danger))', fontFamily: FK.body, fontSize: 12.5, fontWeight: 800 }}>
                  {t('admin.referrals.reject', 'Reject')}
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3" style={{ marginTop: 18 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '12px 16px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow }}>
          <Ico ch={ICON.search} size={17} color={TK.textMute} stroke={2} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('admin.referrals.searchByName', 'Search by name...')}
            aria-label={t('admin.referrals.searchByName', 'Search by name...')}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: FK.body, fontSize: 14.5, color: TK.text }}
          />
        </div>
        <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', gap: 4, background: TK.surface3, padding: 4, borderRadius: 999, border: `1px solid ${TK.borderSolid}` }}>
            {PERIODS.map(p => {
              const on = period.key === p.key;
              return (
                <button key={p.key} type="button" onClick={() => setPeriod(p)}
                  style={{ padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : 'transparent' }}>
                  {t(`admin.referrals.period.${p.key}`, p.key)}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={handleExportCSV} disabled={exportDisabled}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 17px', borderRadius: 12, cursor: exportDisabled ? 'default' : 'pointer', background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.textSub, opacity: exportDisabled ? 0.45 : 1 }}>
            <Ico ch={ICON.download} size={16} color={TK.accent} stroke={2.1} />{t('admin.referrals.export', 'Export')}
          </button>
        </div>
      </div>

      {/* list + leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-[18px] items-start" style={{ marginTop: 18 }}>
        {/* all referrals */}
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px 16px' }}>
            <Ico ch={ICON.users} size={17} color={TK.accent} stroke={2} />
            <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.referrals.allReferrals', 'All Referrals')}</span>
            <span style={{ fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint, marginLeft: 2 }}>{filtered.length}</span>
          </div>
          {isLoading ? (
            <div style={{ padding: '8px 16px 16px' }}>{[0, 1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', borderTop: `1px solid ${TK.divider}` }}>
              <Ico ch={ICON.gift} size={28} color={TK.textFaint} stroke={1.6} style={{ margin: '0 auto 10px' }} />
              <p style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, margin: 0 }}>
                {search ? t('admin.referrals.noSearchResults', 'No referrals match your search') : t('admin.referrals.noReferrals', 'No referrals yet')}
              </p>
            </div>
          ) : (
            filtered.map((ref, idx) => (
              <FadeIn key={ref.id} delay={idx * 30}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderTop: `1px solid ${TK.divider}` }}>
                  <InitialDisc name={ref.referrer?.full_name} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text }}>{ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}</span>
                      <Ico ch={ICON.arrowR} size={14} color={TK.textFaint} stroke={2} />
                      <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>{ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}</span>
                    </div>
                    <span style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint }}>
                      {formatDistanceToNow(new Date(ref.created_at), { addSuffix: true, ...dateFnsLocale })}
                      {ref.points_awarded > 0 && ` · +${ref.points_awarded} ${t('admin.referrals.pointsLabel', 'pts')}`}
                    </span>
                  </div>
                  <RefStatusPill status={ref.status} t={t} />
                </div>
              </FadeIn>
            ))
          )}
        </Card>

        {/* top referrers */}
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px 16px' }}>
            <Ico ch={ICON.trophy} size={17} color={TK.accent} stroke={2} />
            <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.referrals.topReferrers', 'Top Referrers')}</span>
          </div>
          {topReferrers.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', borderTop: `1px solid ${TK.divider}` }}>
              <Ico ch={ICON.users} size={26} color={TK.textFaint} stroke={1.6} style={{ margin: '0 auto 10px' }} />
              <p style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, margin: 0 }}>{t('admin.referrals.noReferrers', 'No top referrers yet')}</p>
            </div>
          ) : (
            topReferrers.map((member, idx) => {
              const medal = MEDAL[idx];
              return (
                <FadeIn key={member.id} delay={idx * 30}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 22px', borderTop: `1px solid ${TK.divider}`, background: idx === 0 ? TK.accentWash : 'transparent' }}>
                    {medal ? (
                      <span style={{ width: 30, height: 30, borderRadius: 99, background: medal.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Ico ch={ICON.medal} size={17} color={medal.col} stroke={2} />
                      </span>
                    ) : (
                      <span style={{ width: 30, textAlign: 'center', fontFamily: FK.mono, fontSize: 13, fontWeight: 700, color: TK.textMute, flexShrink: 0 }}>{idx + 1}</span>
                    )}
                    <Avatar initials={(member.full_name || '?').charAt(0).toUpperCase()} size={34} hue={0} />
                    <span style={{ flex: 1, minWidth: 0, fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {member.full_name || t('admin.referrals.unknown', 'Unknown')}
                    </span>
                    <Pill tone="accent">{member.count} {member.count === 1 ? t('admin.referrals.referralSingular', 'referral') : t('admin.referrals.referralPlural', 'referrals')}</Pill>
                  </div>
                </FadeIn>
              );
            })
          )}
        </Card>
      </div>
    </div>
  );

  const ConfigTab = (
    <div className="flex flex-col gap-[18px]" style={{ paddingTop: 18 }}>
      <ReferralProgramConfig gymId={gymId} config={config} t={t} isEs={isEs} />
      <ReferralMilestonesCard gymId={gymId} t={t} isEs={isEs} />
    </div>
  );

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.referrals.title', 'Referrals')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.referrals.subtitle', 'Track and manage member referrals')}</div>
        </div>
      </div>

      {/* tab bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', borderBottom: `1px solid ${TK.borderSolid}`, marginTop: 22 }}>
        {tabOptions.map(tb => {
          const on = tab === tb.key;
          return (
            <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
              style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 16px', position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none' }}>
              <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute }}>{tb.label}</span>
              {on && <span style={{ position: 'absolute', left: '42%', right: '42%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
            </button>
          );
        })}
      </div>

      <SwipeableTabContent tabs={tabOptions} active={tab} onChange={setTab}>
        {(tabKey) => (tabKey === 'activity' ? ActivityTab : ConfigTab)}
      </SwipeableTabContent>
    </AdminPageShell>
  );
}

import { useState, useEffect } from 'react';
import { Gift, Users, TrendingUp, CheckCircle, Clock, XCircle, Search, Download, Eye, ChevronDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useTranslation } from 'react-i18next';
import { PageHeader, AdminCard, FadeIn, CardSkeleton, AdminPageShell, StatCard } from '../../components/admin';
import ReferralProgramConfig from './components/ReferralProgramConfig';
import ReferralMilestonesCard from './components/ReferralMilestonesCard';

const PERIODS = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: null },
];

const STATUS_TONE = {
  pending: 'warn',
  completed: 'good',
  expired: 'hot',
};

function StatusBadge({ status, t }) {
  const tone = STATUS_TONE[status] || 'warn';
  return (
    <span className={`admin-pill admin-pill--${tone}`}>
      {t(`admin.referrals.status.${status}`, status)}
    </span>
  );
}

function AvatarInitial({ name }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
      style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}
    >
      {initial}
    </div>
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

  const [period, setPeriod] = useState(PERIODS[1]);
  const [search, setSearch] = useState('');
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);

  useEffect(() => { document.title = t('admin.referrals.pageTitle', 'Referrals · Admin'); }, [t]);

  // Fetch referral config from gyms.referral_config JSONB column
  const { data: config } = useQuery({
    queryKey: adminKeys.referrals?.config?.(gymId) ?? ['admin', 'referral-config', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gyms')
        .select('referral_config')
        .eq('id', gymId)
        .single();
      return data?.referral_config ?? null;
    },
    enabled: !!gymId,
  });

  // Fetch referrals
  const { data: referrals = [], isLoading } = useQuery({
    queryKey: [...(adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId]), period.key],
    queryFn: async () => {
      let query = supabase
        .from('referrals')
        .select('*, referrer:profiles!referrals_referrer_id_fkey(id, full_name, avatar_url, avatar_type, avatar_value), referred:profiles!referrals_referred_id_fkey(id, full_name)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });

      if (period.days) {
        query = query.gte('created_at', subDays(new Date(), period.days).toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter(r => r.referrer);
    },
    enabled: !!gymId,
  });

  // Approve mutation
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

  // Reject mutation — mark the referral 'expired' (valid per the status CHECK).
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

  // Self-referral filter applied to ALL metrics + lists (not just leaderboard).
  // A self-referral is when `referrer.id === referred.id`. The DB doesn't reject these
  // server-side yet, so we filter consistently on the client for honest counts.
  const validReferrals = referrals.filter(r => !r.referrer?.id || r.referrer.id !== r.referred?.id);

  // Computed stats — based on validReferrals, NOT raw `referrals`.
  const total = validReferrals.length;
  const completed = validReferrals.filter(r => r.status === 'completed').length;
  const pending = validReferrals.filter(r => r.status === 'pending').length;
  const pointsAwarded = validReferrals
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.points_awarded || 0), 0);

  // Top referrers — already filtered self-referrals; now also reads from validReferrals.
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
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Pending approval list (still excludes self-referrals).
  const pendingApproval = validReferrals.filter(r => r.status === 'pending');

  // Search filter
  const filtered = validReferrals.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.referrer?.full_name?.toLowerCase().includes(q) ||
      r.referred?.full_name?.toLowerCase().includes(q)
    );
  });

  // CSV export — uses the shared exportCSV helper so values get formula-prefix
  // sanitization + proper escaping for embedded commas/quotes/newlines.
  const handleExportCSV = async () => {
    const { exportCSV } = await import('../../lib/csvExport');
    await exportCSV({
      filename: 'referrals',
      columns: [
        { key: 'referrer', label: t('admin.referrals.csvReferrer', 'Referrer') },
        { key: 'referred', label: t('admin.referrals.csvReferred', 'Referred') },
        { key: 'status',   label: t('admin.referrals.csvStatus', 'Status') },
        { key: 'date',     label: t('admin.referrals.csvDate', 'Date') },
        { key: 'points',   label: t('admin.referrals.csvPoints', 'Points') },
      ],
      data: filtered.map(r => ({
        referrer: r.referrer?.full_name || '',
        referred: r.referred?.full_name || '',
        status:   r.status,
        date:     format(new Date(r.created_at), 'yyyy-MM-dd'),
        points:   r.points_awarded || 0,
      })),
    });
  };

  const MEDALS = ['🥇', '🥈', '🥉'];

  // One-line program status banner — surfaces the current config so admins
  // see "what's running" before scrolling through the list. Hidden when
  // config hasn't loaded yet to avoid a flicker.
  const referrerReward = config?.referrer_reward ?? config?.points_per_referral ?? null;
  const approvalMode = config?.require_admin_approval
    ? t('admin.referrals.approvalManual', 'manual')
    : t('admin.referrals.approvalAuto', 'auto');
  const programActive = !!config;

  return (
    <AdminPageShell>
      <PageHeader title={t('admin.referrals.title', 'Referrals')} subtitle={t('admin.referrals.subtitle', 'Track and manage member referrals')} />

      {/* Status banner — visible before stats so admins know what's live. */}
      {programActive && (
        <div
          className="flex items-center gap-2 mt-5 px-3.5 py-2 rounded-xl text-[12px] font-semibold flex-wrap"
          style={{
            background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            color: 'var(--color-admin-text-sub)',
          }}
        >
          <Gift size={13} style={{ color: 'var(--color-accent)' }} />
          <span>
            {t('admin.referrals.statusReward', 'Reward')}:{' '}
            <span style={{ color: 'var(--color-admin-text)' }}>
              {referrerReward != null ? `${referrerReward} ${t('admin.referrals.pts', 'pts')}` : '—'}
            </span>
          </span>
          <span style={{ color: 'var(--color-admin-text-muted)' }}>·</span>
          <span>
            {t('admin.referrals.statusApproval', 'Approval')}:{' '}
            <span style={{ color: 'var(--color-admin-text)' }}>{approvalMode}</span>
          </span>
          <span style={{ color: 'var(--color-admin-text-muted)' }}>·</span>
          <span
            className="admin-pill admin-pill--good"
            style={{ padding: '1px 8px', fontSize: 10 }}
          >
            {t('admin.referrals.statusActive', 'Active')}
          </span>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mt-4 mb-4">
        <StatCard label={t('admin.referrals.totalReferrals', 'Total Referrals')} value={total} icon={Gift} borderColor="var(--color-accent)" delay={0} />
        <StatCard label={t('admin.referrals.completed', 'Completed')} value={completed} icon={CheckCircle} borderColor="var(--color-success)" delay={30} />
        <StatCard label={t('admin.referrals.pending', 'Pending')} value={pending} icon={Clock} borderColor="var(--color-warning)" delay={60} />
        <StatCard label={t('admin.referrals.pointsAwarded', 'Points Awarded')} value={pointsAwarded} icon={TrendingUp} borderColor="var(--color-coach)" delay={90} />
      </div>

      {/* Config + milestones moved up — new gyms can configure before scrolling past empty lists */}
      <ReferralProgramConfig gymId={gymId} config={config} t={t} isEs={isEs} />
      <ReferralMilestonesCard gymId={gymId} t={t} isEs={isEs} />

      {/* Filters Row */}
      <div className="flex flex-col md:flex-row gap-2.5 mb-4 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] w-full md:w-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-admin-text-muted)' }} />
          <input
            type="text"
            placeholder={t('admin.referrals.searchByName')}
            aria-label={t('admin.referrals.searchByName')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-[10px] pl-9 pr-4 py-2 text-[13px] outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-admin-border)',
              color: 'var(--color-admin-text)',
            }}
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:overflow-visible">
          {/* Period filter as pills */}
          <div className="flex gap-1.5 flex-shrink-0 md:flex-wrap">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p)}
                className={`admin-pill flex-shrink-0 ${period.key === p.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {t(`admin.referrals.period.${p.key}`, p.key)}
              </button>
            ))}
          </div>

          {/* Export */}
          <button
            onClick={handleExportCSV}
            disabled={isLoading || !filtered.length}
            className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Download size={12} />
            {t('admin.referrals.export', 'Export')}
          </button>
        </div>
      </div>

      {/* Approval Queue */}
      {config?.require_admin_approval && pendingApproval.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowApprovalQueue(!showApprovalQueue)}
            className="flex items-center gap-2 mb-3"
          >
            <span className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.referrals.approvalQueue', 'Approval Queue')}
            </span>
            <span className="bg-amber-500/15 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {pendingApproval.length}
            </span>
            <ChevronDown
              size={14}
              className={`text-[#6B7280] transition-transform ${showApprovalQueue ? 'rotate-180' : ''}`}
            />
          </button>

          {showApprovalQueue && (
            <div className="space-y-2 mb-6">
              {pendingApproval.map((ref, idx) => (
                <FadeIn key={ref.id} delay={idx * 40}>
                  <AdminCard hover>
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <AvatarInitial name={ref.referrer?.full_name} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                            {ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            {t('admin.referrals.referred', 'referred')} {ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => approveMutation.mutate(ref.id)}
                          disabled={approveMutation.isPending}
                          className="bg-emerald-500/15 text-emerald-400 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-500/25 transition-colors"
                        >
                          {t('admin.referrals.approve', 'Approve')}
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(ref.id)}
                          disabled={rejectMutation.isPending}
                          className="bg-red-500/15 text-red-400 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-red-500/25 transition-colors"
                        >
                          {t('admin.referrals.reject', 'Reject')}
                        </button>
                      </div>
                    </div>
                  </AdminCard>
                </FadeIn>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Two-col: All Referrals + Top Referrers */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1fr] gap-4">
        {/* Referral List */}
        <div className="admin-card overflow-hidden" style={{ padding: 0 }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
            <span className="text-[13.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.referrals.allReferrals', 'All Referrals')}
            </span>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <Gift size={28} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {search ? t('admin.referrals.noSearchResults', 'No referrals match your search') : t('admin.referrals.noReferrals', 'No referrals yet')}
              </p>
            </div>
          ) : (
            filtered.map((ref, idx) => (
              <FadeIn key={ref.id} delay={idx * 40}>
                <div
                  className="flex items-center gap-3 px-[18px] py-[14px]"
                  style={{ borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--color-admin-border)' }}
                >
                  <div className="w-[30px] h-[30px]">
                    <AvatarInitial name={ref.referrer?.full_name} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                        {ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}
                      </span>
                      <span className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>→</span>
                      <span className="text-[13px]" style={{ color: 'var(--color-admin-text-sub)' }}>
                        {ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}
                      </span>
                    </div>
                    <div className="text-[11.5px] mt-[2px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {formatDistanceToNow(new Date(ref.created_at), { addSuffix: true, ...dateFnsLocale })}
                      {ref.points_awarded > 0 && ` · +${ref.points_awarded} pts`}
                    </div>
                  </div>
                  <StatusBadge status={ref.status} t={t} />
                </div>
              </FadeIn>
            ))
          )}
        </div>

        {/* Top Referrers */}
        <div className="admin-card overflow-hidden" style={{ padding: 0 }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
            <Users size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-[13.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.referrals.topReferrers', 'Top Referrers')}
            </span>
          </div>

          {topReferrers.length === 0 ? (
            <div className="p-8 text-center">
              <Users size={24} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.referrals.noReferrers', 'No top referrers yet')}
              </p>
            </div>
          ) : (
            topReferrers.map((member, idx) => (
              <FadeIn key={member.id} delay={idx * 40}>
                <div
                  className="flex items-center gap-3 px-[18px] py-[13px]"
                  style={{ borderBottom: idx === topReferrers.length - 1 ? 'none' : '1px solid var(--color-admin-border)' }}
                >
                  <span className="text-[18px] w-6 text-center shrink-0">
                    {idx < 3 ? MEDALS[idx] : (
                      <span className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{idx + 1}</span>
                    )}
                  </span>
                  <AvatarInitial name={member.full_name} />
                  <span className="flex-1 text-[13px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>
                    {member.full_name || t('admin.referrals.unknown', 'Unknown')}
                  </span>
                  <span className="admin-pill" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
                    {member.count} {member.count === 1 ? t('admin.referrals.referralSingular', 'referral') : t('admin.referrals.referralPlural', 'referrals')}
                  </span>
                </div>
              </FadeIn>
            ))
          )}
        </div>
      </div>

    </AdminPageShell>
  );
}

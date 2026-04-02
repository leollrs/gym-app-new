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
import { PageHeader, AdminCard, FadeIn, CardSkeleton } from '../../components/admin';

const PERIODS = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: null },
];

const STATUS_STYLES = {
  pending:   { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  expired:   { bg: 'bg-red-500/15', text: 'text-red-400' },
};

function StatusBadge({ status, t }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span className={`${s.bg} ${s.text} text-[10px] font-bold px-2 py-0.5 rounded-full`}>
      {t(`admin.referrals.status.${status}`, status)}
    </span>
  );
}

function AvatarInitial({ name, avatarUrl }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-[#D4AF37]/15 flex items-center justify-center text-[11px] font-bold text-[#D4AF37] shrink-0">
      {initial}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={15} className={accent ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
        <span className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-[22px] font-bold text-[#E5E7EB]">{value}</span>
    </div>
  );
}

export default function AdminReferrals() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  const [period, setPeriod] = useState(PERIODS[1]);
  const [search, setSearch] = useState('');
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);

  useEffect(() => { document.title = 'Referrals · Admin'; }, []);

  // Fetch referral config
  const { data: config } = useQuery({
    queryKey: adminKeys.referrals?.config?.(gymId) ?? ['admin', 'referral-config', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('referral_config')
        .select('*')
        .eq('gym_id', gymId)
        .single();
      return data;
    },
    enabled: !!gymId,
  });

  // Fetch referrals
  const { data: referrals = [], isLoading } = useQuery({
    queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId, period.key],
    queryFn: async () => {
      let query = supabase
        .from('referrals')
        .select('*, referrer:profiles!referrals_referrer_id_fkey(id, full_name, avatar_url, avatar_type, avatar_value), referred:profiles!referrals_referred_id_fkey(id, full_name)')
        .eq('referrer.gym_id', gymId)
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
        .eq('id', referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId] });
      toast(t('admin.referrals.approvedToast', 'Referral approved'), 'success');
    },
    onError: () => toast(t('admin.referrals.approveFailedToast', 'Failed to approve referral'), 'error'),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (referralId) => {
      const { error } = await supabase
        .from('referrals')
        .update({ status: 'expired' })
        .eq('id', referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId] });
      toast(t('admin.referrals.rejectedToast', 'Referral rejected'), 'success');
    },
    onError: () => toast(t('admin.referrals.rejectFailedToast', 'Failed to reject referral'), 'error'),
  });

  // Computed stats
  const total = referrals.length;
  const completed = referrals.filter(r => r.status === 'completed').length;
  const pending = referrals.filter(r => r.status === 'pending').length;
  const pointsAwarded = referrals
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.points_awarded || 0), 0);

  // Top referrers
  const topReferrers = Object.values(
    referrals
      .filter(r => r.status === 'completed')
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

  // Pending approval list
  const pendingApproval = referrals.filter(r => r.status === 'pending');

  // Search filter
  const filtered = referrals.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.referrer?.full_name?.toLowerCase().includes(q) ||
      r.referred?.full_name?.toLowerCase().includes(q)
    );
  });

  // CSV export
  const exportCSV = () => {
    const header = `${t('admin.referrals.csvReferrer', 'Referrer')},${t('admin.referrals.csvReferred', 'Referred')},${t('admin.referrals.csvStatus', 'Status')},${t('admin.referrals.csvDate', 'Date')},${t('admin.referrals.csvPoints', 'Points')}\n`;
    const rows = filtered.map(r =>
      `"${r.referrer?.full_name || ''}","${r.referred?.full_name || ''}","${r.status}","${format(new Date(r.created_at), 'yyyy-MM-dd')}","${r.points_awarded || 0}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `referrals-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader title={t('admin.referrals.title', 'Referrals')} subtitle={t('admin.referrals.subtitle', 'Track and manage member referrals')} />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
        <StatCard icon={Gift} label={t('admin.referrals.totalReferrals', 'Total Referrals')} value={total} accent />
        <StatCard icon={CheckCircle} label={t('admin.referrals.completed', 'Completed')} value={completed} />
        <StatCard icon={Clock} label={t('admin.referrals.pending', 'Pending')} value={pending} />
        <StatCard icon={TrendingUp} label={t('admin.referrals.pointsAwarded', 'Points Awarded')} value={pointsAwarded.toLocaleString()} />
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mt-6">
        {/* Period filter */}
        <div className="flex bg-[#111827]/60 border border-white/[0.04] rounded-xl overflow-hidden">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                period.key === p.key
                  ? 'bg-[#D4AF37] text-black'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              {t(`admin.referrals.period.${p.key}`, p.key)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            placeholder={t('admin.referrals.searchByName')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/30"
          />
        </div>

        {/* Export */}
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 bg-[#111827]/60 border border-white/[0.04] rounded-xl px-3 py-2.5 text-[12px] font-semibold text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
        >
          <Download size={13} />
          {t('admin.referrals.export', 'Export')}
        </button>
      </div>

      {/* Approval Queue */}
      {config?.require_approval && pendingApproval.length > 0 && (
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

      {/* Referral List */}
      <div className="mt-6">
        <h2 className="text-[14px] font-bold text-[#E5E7EB] mb-3">{t('admin.referrals.allReferrals', 'All Referrals')}</h2>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-8 text-center">
            <Gift size={28} className="mx-auto mb-2 text-[#6B7280]" />
            <p className="text-[13px] text-[#6B7280]">
              {search ? t('admin.referrals.noSearchResults', 'No referrals match your search') : t('admin.referrals.noReferrals', 'No referrals yet')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((ref, idx) => (
              <FadeIn key={ref.id} delay={idx * 40}>
                <AdminCard hover>
                  <div className="flex items-center gap-3 p-3">
                    <AvatarInitial name={ref.referrer?.full_name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                          {ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}
                        </p>
                        <span className="text-[11px] text-[#6B7280]">→</span>
                        <p className="text-[13px] text-[#9CA3AF] truncate">
                          {ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}
                        </p>
                      </div>
                      <p className="text-[11px] text-[#6B7280] mt-0.5">
                        {formatDistanceToNow(new Date(ref.created_at), { addSuffix: true, ...dateFnsLocale })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {ref.points_awarded > 0 && (
                        <span className="text-[11px] font-bold text-[#D4AF37]">
                          +{ref.points_awarded} pts
                        </span>
                      )}
                      <StatusBadge status={ref.status} t={t} />
                    </div>
                  </div>
                </AdminCard>
              </FadeIn>
            ))}
          </div>
        )}
      </div>

      {/* Top Referrers Leaderboard */}
      {topReferrers.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[14px] font-bold text-[#E5E7EB] mb-3 flex items-center gap-2">
            <Users size={15} className="text-[#D4AF37]" />
            {t('admin.referrals.topReferrers', 'Top Referrers')}
          </h2>
          <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl overflow-hidden">
            {topReferrers.map((member, idx) => (
              <FadeIn key={member.id} delay={idx * 40}>
                <div
                  className={`flex items-center gap-3 px-4 py-3 ${
                    idx < topReferrers.length - 1 ? 'border-b border-white/[0.04]' : ''
                  }`}
                >
                  <span className="w-6 text-center text-[13px] font-bold shrink-0">
                    {idx < 3 ? MEDALS[idx] : (
                      <span className="text-[#6B7280]">{idx + 1}</span>
                    )}
                  </span>
                  <AvatarInitial name={member.full_name} />
                  <p className="text-[13px] font-semibold text-[#E5E7EB] flex-1 truncate">
                    {member.full_name || t('admin.referrals.unknown', 'Unknown')}
                  </p>
                  <span className="text-[12px] font-bold text-[#D4AF37]">
                    {member.count} {member.count === 1 ? t('admin.referrals.referralSingular', 'referral') : t('admin.referrals.referralPlural', 'referrals')}
                  </span>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

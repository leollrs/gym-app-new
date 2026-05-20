import { useState } from 'react';
import { Clock, Gift, Trophy, Mail } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { logAdminAction } from '../../../lib/adminAudit';
import logger from '../../../lib/logger';
import { AdminCard, FadeIn, SectionLabel } from '../../../components/admin';
import { rewardKeys } from './rewardConstants';

/**
 * Unified activity log surface for AdminRewards — pulls from three
 * tables (`challenge_prizes`, `email_reward_vouchers`,
 * `reward_redemptions`) in parallel and merges them into one
 * date-sorted feed.
 *
 * Each row supports an "Expire" action for entries that haven't been
 * claimed yet. For `reward_redemptions.pending`, the expire flow
 * additionally calls the `add_reward_points` RPC to refund the points
 * the member spent — that's the authoritative balance-mutation path,
 * matching what the original redemption flow uses to deduct.
 */
export default function RewardLog({ gymId, isEs, t }) {
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const handleDeactivate = async (entry) => {
    setDeactivating(entry.id);
    try {
      // If cancelling a pending redemption, refund the points by calling the
      // server-side `add_reward_points` RPC (which is the authoritative way to
      // mutate balances — same RPC the redemption flow uses to deduct).
      // Doing it here means the toast copy "points returned" is actually true.
      if (entry.table === 'reward_redemptions' && entry.status === 'pending') {
        const { data: redemption } = await supabase
          .from('reward_redemptions')
          .select('profile_id, points_spent')
          .eq('id', entry.dbId)
          .single();
        if (redemption?.profile_id && (redemption.points_spent || 0) > 0) {
          const { error: refundErr } = await supabase.rpc('add_reward_points', {
            p_profile_id: redemption.profile_id,
            p_points: redemption.points_spent,
            p_source: 'redemption_refund',
            p_metadata: { redemption_id: entry.dbId, expired_by_admin: true },
          });
          // Don't block the expire on a refund-RPC missing — fall back to logging.
          if (refundErr) logger.error('Refund failed for redemption', entry.dbId, refundErr);
        }
      }

      const { error } = await supabase
        .from(entry.table)
        .update({ status: 'expired' })
        .eq('id', entry.dbId);
      if (error) throw error;
      logAdminAction('expire_reward_redemption', entry.table, entry.dbId);
      queryClient.invalidateQueries({ queryKey: [...rewardKeys.all(gymId), 'activity-log'] });
      showToast(t('admin.rewards.rewardCancelled', 'Reward cancelled — points returned'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeactivating(null);
    }
  };

  const { data: logEntries = [], isLoading } = useQuery({
    queryKey: [...rewardKeys.all(gymId), 'activity-log'],
    queryFn: async () => {
      // Fetch from 3 sources in parallel
      const [challengeRes, voucherRes, redemptionRes] = await Promise.all([
        supabase
          .from('challenge_prizes')
          .select('id, profile_id, placement, reward_label, points_awarded, status, created_at, redeemed_at, challenges(name), profiles!challenge_prizes_profile_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('email_reward_vouchers')
          .select('id, member_id, reward_label, reward_type, status, created_at, redeemed_at, profiles!email_reward_vouchers_member_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('reward_redemptions')
          .select('id, profile_id, reward_name, points_spent, status, created_at, claimed_at, profiles!reward_redemptions_profile_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const entries = [];

      (challengeRes.data || []).forEach(p => {
        const medals = ['🥇', '🥈', '🥉'];
        entries.push({
          id: `cp-${p.id}`,
          dbId: p.id,
          table: 'challenge_prizes',
          type: 'challenge',
          member: p.profiles?.full_name || '?',
          label: `${medals[p.placement - 1] || ''} ${p.challenges?.name || 'Challenge'}`,
          reward: p.reward_label,
          status: p.status,
          date: p.redeemed_at || p.created_at,
          canDeactivate: p.status === 'pending',
        });
      });

      (voucherRes.data || []).forEach(v => {
        entries.push({
          id: `ev-${v.id}`,
          dbId: v.id,
          table: 'email_reward_vouchers',
          type: 'email',
          member: v.profiles?.full_name || '?',
          label: t('admin.rewards.logEmailCampaign', 'Email campaign'),
          reward: v.reward_label,
          status: v.status,
          date: v.redeemed_at || v.created_at,
          canDeactivate: v.status === 'active',
        });
      });

      (redemptionRes.data || []).forEach(r => {
        entries.push({
          id: `rd-${r.id}`,
          dbId: r.id,
          table: 'reward_redemptions',
          type: 'redemption',
          member: r.profiles?.full_name || '?',
          label: t('admin.rewards.logPointsRedemption', 'Points redemption'),
          reward: r.reward_name,
          status: r.status,
          date: r.claimed_at || r.created_at,
          canDeactivate: r.status === 'pending',
        });
      });

      return entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const sourceIcon = { challenge: Trophy, email: Mail, redemption: Gift };
  const sourceColor = { challenge: 'var(--color-accent)', email: 'var(--color-info)', redemption: 'var(--color-success, #10B981)' };
  const statusStyle = {
    pending: 'text-amber-400 bg-amber-500/10',
    active: 'text-amber-400 bg-amber-500/10',
    redeemed: 'text-emerald-400 bg-emerald-500/10',
    claimed: 'text-emerald-400 bg-emerald-500/10',
    expired: 'text-[#6B7280] bg-white/6',
  };

  const visible = showAll ? logEntries : logEntries.slice(0, 10);

  return (
    <>
      <SectionLabel>
        <Clock size={14} className="inline mr-1.5 -mt-px" />
        {t('admin.rewards.activityLog', 'Activity Log')}
      </SectionLabel>

      <FadeIn>
        <AdminCard className="mt-4">
          {isLoading ? (
            <div className="py-8 text-center text-[12px] text-[#6B7280]">{t('common:loading')}</div>
          ) : logEntries.length === 0 ? (
            <div className="py-8 text-center">
              <Clock size={24} className="mx-auto text-[#4B5563] mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.rewards.noActivity', 'No reward activity yet')}</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-white/4">
                {visible.map(entry => {
                  const Icon = sourceIcon[entry.type] || Gift;
                  const color = sourceColor[entry.type] || 'var(--color-admin-text-sub)';
                  return (
                    <div key={entry.id} className="flex items-start gap-3 py-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${color}15` }}>
                        <Icon size={13} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[12px] text-[#E5E7EB] truncate min-w-0">
                            <span className="font-semibold">{entry.member}</span>
                            <span className="text-[#6B7280] mx-1.5">·</span>
                            <span className="text-[#9CA3AF]">{entry.label}</span>
                          </p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${statusStyle[entry.status] || statusStyle.pending}`}>
                            {t(`admin.rewards.statusPill.${entry.status}`, entry.status)}
                          </span>
                          <span className="text-[10px] text-[#4B5563] tabular-nums whitespace-nowrap flex-shrink-0 ml-auto">
                            {format(new Date(entry.date), 'MMM d', dateFnsLocale)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#6B7280] mt-0.5 line-clamp-2 break-words">{entry.reward}</p>
                        {entry.canDeactivate && (
                          <button
                            onClick={() => handleDeactivate(entry)}
                            disabled={deactivating === entry.id}
                            className="mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                          >
                            {deactivating === entry.id ? '...' : t('admin.rewards.expire', 'Expire')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {logEntries.length > 10 && (
                <button onClick={() => setShowAll(p => !p)}
                  className="w-full mt-3 py-2 rounded-xl text-[12px] font-semibold text-[#D4AF37] bg-[#D4AF37]/8 hover:bg-[#D4AF37]/15 transition-colors">
                  {showAll ? t('admin.rewards.showLess', 'Show less') : t('admin.rewards.showAll', { count: logEntries.length, defaultValue: `Show all (${logEntries.length})` })}
                </button>
              )}
            </>
          )}
        </AdminCard>
      </FadeIn>
    </>
  );
}

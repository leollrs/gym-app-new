import { useState } from 'react';
import { Megaphone, Radio, AlertTriangle, Clock, Users } from 'lucide-react';
import { format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import logger from '../../../lib/logger';
import { AdminCard, FadeIn } from '../../../components/admin';

/**
 * "Broadcast" tab of AdminMessaging — sends a push + in-app notification
 * to every member of the gym in one shot.
 *
 * Two operations on submit: invokes the `send-push` edge function for the
 * push notification, then calls the `broadcast_notification` RPC which
 * inserts the in-app notification row server-side (gym scope is derived
 * from auth context — passing p_gym_id is silently ignored).
 *
 * Right-side panel surfaces the last 20 broadcasts from `admin_push_log`.
 */
export default function BroadcastTab({ gymId, adminId, gym, t, dateFnsLocale }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // ── Fetch recent broadcast history ────────────────────
  const { data: broadcastHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: adminKeys.messaging.broadcastHistory(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_push_log')
        .select('*')
        .eq('gym_id', gymId)
        .order('sent_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Send broadcast mutation ───────────────────────────
  const broadcastMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !body.trim()) throw new Error(t('admin.messaging.titleBodyRequired', 'Title and body are required'));

      // Send push notification to all gym members
      const { error: pushError } = await supabase.functions.invoke('send-push', {
        body: { gym_id: gymId, title: title.trim(), body: body.trim() },
      });
      if (pushError) logger.error('Broadcast push error:', pushError);

      // Create in-app notifications via RPC.
      // RPC derives gym from auth context (current_gym_id()) — passing p_gym_id is silently ignored.
      const { error: rpcError } = await supabase.rpc('broadcast_notification', {
        p_title: title.trim(),
        p_body: body.trim(),
        p_type: 'announcement',
      });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.broadcastHistory(gymId) });
      showToast(t('admin.messaging.broadcastSent'), 'success');
      setTitle('');
      setBody('');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  return (
    <FadeIn>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Compose panel ──────────────────────────────── */}
        <AdminCard>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
              <Megaphone size={15} className="text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#E5E7EB]">{t('admin.messaging.sendBroadcast')}</h2>
              <p className="text-[11px] text-[#6B7280]">{t('admin.messaging.sendBroadcastDesc')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                {t('admin.messaging.broadcastTitle')}
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('admin.messaging.broadcastTitlePlaceholder')}
                maxLength={100}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                {t('admin.messaging.broadcastBody')}
              </label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={t('admin.messaging.broadcastBodyPlaceholder')}
                rows={5}
                maxLength={500}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
              <p className="text-[11px] text-[#6B7280] mt-1 text-right">{body.length}/500</p>
            </div>

            {/* Rate limit warning */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/10">
              <AlertTriangle size={14} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#F59E0B]/80">{t('admin.messaging.rateLimitWarning')}</p>
            </div>

            <button
              onClick={() => broadcastMutation.mutate()}
              disabled={broadcastMutation.isPending || !title.trim() || !body.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 text-[13px] font-semibold hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              {broadcastMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
              ) : (
                <Radio size={15} />
              )}
              {broadcastMutation.isPending ? t('admin.messaging.sending') : t('admin.messaging.sendPushToAll')}
            </button>
          </div>
        </AdminCard>

        {/* ── Broadcast history ──────────────────────────── */}
        <AdminCard>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-white/4 flex items-center justify-center">
              <Clock size={15} className="text-[#6B7280]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#E5E7EB]">{t('admin.messaging.broadcastHistory')}</h2>
              <p className="text-[11px] text-[#6B7280]">{t('admin.messaging.recentBroadcasts')}</p>
            </div>
          </div>

          {historyLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-white/4 rounded-lg animate-pulse" />)}
            </div>
          ) : broadcastHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Radio size={24} className="text-[#6B7280] mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.messaging.noBroadcastsYet')}</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {broadcastHistory.map(log => (
                <div key={log.id} className="px-4 py-3 rounded-lg bg-white/[0.02] border border-white/4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users size={12} className="text-[#6B7280]" />
                      <span className="text-[12px] font-semibold text-[#E5E7EB]">
                        {log.total_sent ?? '?'} {t('admin.messaging.recipients')}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#6B7280]">
                      {log.sent_at ? format(new Date(log.sent_at), 'MMM d, h:mm a', dateFnsLocale) : '-'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </FadeIn>
  );
}

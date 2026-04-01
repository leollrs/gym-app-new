import { useState, useEffect, useMemo } from 'react';
import { MessageCircle, TrendingUp, Users, Send, ThumbsUp, Minus, ThumbsDown, BarChart3, Clock, ChevronDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { broadcastNotification } from '../../lib/notifications';
import { PageHeader, AdminCard, AdminModal, FadeIn, CardSkeleton } from '../../components/admin';

const GOLD = '#D4AF37';

const PERIODS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: 'All time', days: null },
];

function scoreColor(score) {
  if (score <= 6) return 'text-red-400';
  if (score <= 8) return 'text-amber-400';
  return 'text-emerald-400';
}

function scoreBg(score) {
  if (score <= 6) return 'bg-red-400/20 text-red-400';
  if (score <= 8) return 'bg-amber-400/20 text-amber-400';
  return 'bg-emerald-400/20 text-emerald-400';
}

function npsColor(nps) {
  if (nps < 0) return 'text-red-400';
  if (nps < 30) return 'text-amber-400';
  if (nps < 70) return 'text-lime-400';
  return 'text-emerald-400';
}

function npsBarColor(nps) {
  if (nps < 0) return 'bg-red-400';
  if (nps < 30) return 'bg-amber-400';
  if (nps < 70) return 'bg-lime-400';
  return 'bg-emerald-400';
}

function npsGaugePercent(nps) {
  return ((nps + 100) / 200) * 100;
}

export default function AdminNPS() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [days, setDays] = useState(30);
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  useEffect(() => {
    document.title = 'Member Feedback | Admin';
  }, []);

  const statsKey = ['admin', 'nps', gymId, 'stats', days];
  const responsesKey = ['admin', 'nps', gymId, 'responses', days];

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: statsKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_nps_stats', {
        p_gym_id: gymId,
        p_days: days,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!gymId,
  });

  const { data: responses, isLoading: responsesLoading } = useQuery({
    queryKey: responsesKey,
    queryFn: async () => {
      let query = supabase
        .from('nps_responses')
        .select('id, score, feedback, created_at, profiles:user_id(full_name, avatar_url, avatar_preset)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        query = query.gte('created_at', since.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const sendSurvey = useMutation({
    mutationFn: async () => {
      const { data: existing } = await supabase
        .from('nps_surveys')
        .select('id')
        .eq('gym_id', gymId)
        .eq('status', 'active')
        .maybeSingle();

      if (existing) throw new Error('There is already an active survey running.');

      const { error: insertError } = await supabase
        .from('nps_surveys')
        .insert({ gym_id: gymId, status: 'active', sent_by: profile.id });

      if (insertError) throw insertError;

      await broadcastNotification({
        gymId,
        type: 'nps_survey',
        title: 'How likely are you to recommend us?',
        body: 'Take a quick 1-question survey and help us improve!',
      });
    },
    onSuccess: () => {
      showToast('Survey sent to all members', 'success');
      setShowSurveyModal(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => {
      showToast(err.message || 'Failed to send survey', 'error');
    },
  });

  const nps = stats?.nps ?? 0;
  const totalResponses = stats?.total_responses ?? 0;
  const responseRate = stats?.response_rate ?? 0;
  const promoters = stats?.promoters ?? 0;
  const passives = stats?.passives ?? 0;
  const detractors = stats?.detractors ?? 0;
  const distribution = stats?.distribution ?? Array(11).fill(0);

  const maxDistribution = useMemo(
    () => Math.max(...(Array.isArray(distribution) ? distribution : []), 1),
    [distribution],
  );

  const feedbackResponses = useMemo(
    () => (responses || []).filter((r) => r.feedback?.trim()),
    [responses],
  );

  const total = promoters + passives + detractors || 1;
  const promoterPct = Math.round((promoters / total) * 100);
  const passivePct = Math.round((passives / total) * 100);
  const detractorPct = Math.round((detractors / total) * 100);

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title="Member Feedback"
        subtitle="NPS surveys and satisfaction tracking"
      />

      {/* Period filter + Send survey */}
      <FadeIn>
        <div className="flex items-center justify-between mt-6 mb-4">
          <div className="flex gap-1.5 bg-[#111827]/60 rounded-xl p-1 border border-white/[0.04]">
            {PERIODS.map((p) => (
              <button
                key={p.label}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  days === p.days
                    ? 'bg-[#D4AF37]/20 text-[#D4AF37]'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowSurveyModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: `${GOLD}20`, color: GOLD }}
          >
            <Send size={14} />
            Send Survey
          </button>
        </div>
      </FadeIn>

      {statsLoading ? (
        <CardSkeleton count={3} />
      ) : (
        <>
          {/* NPS Hero Card */}
          <FadeIn delay={0.05}>
            <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-6 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} style={{ color: GOLD }} />
                <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
                  Net Promoter Score
                </span>
              </div>

              <div className="flex flex-col items-center">
                <span className={`text-[48px] font-black leading-none ${npsColor(nps)}`}>
                  {nps > 0 ? '+' : ''}{nps}
                </span>

                {/* Gauge bar */}
                <div className="w-full max-w-[280px] mt-4 mb-3">
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden relative">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${npsBarColor(nps)}`}
                      style={{ width: `${npsGaugePercent(nps)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-[#6B7280]">-100</span>
                    <span className="text-[10px] text-[#6B7280]">0</span>
                    <span className="text-[10px] text-[#6B7280]">+100</span>
                  </div>
                </div>

                <div className="flex gap-6 text-center">
                  <div>
                    <p className="text-lg font-bold text-[#E5E7EB]">{totalResponses}</p>
                    <p className="text-[10px] text-[#6B7280]">Responses</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-[#E5E7EB]">{responseRate}%</p>
                    <p className="text-[10px] text-[#6B7280]">Response rate</p>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Breakdown row */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4 text-center">
                <ThumbsUp size={16} className="mx-auto mb-2 text-emerald-400" />
                <p className="text-lg font-bold text-emerald-400">{promoters}</p>
                <p className="text-[10px] text-[#6B7280]">Promoters (9-10)</p>
                <p className="text-xs font-semibold text-emerald-400 mt-1">{promoterPct}%</p>
              </div>
              <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4 text-center">
                <Minus size={16} className="mx-auto mb-2 text-amber-400" />
                <p className="text-lg font-bold text-amber-400">{passives}</p>
                <p className="text-[10px] text-[#6B7280]">Passives (7-8)</p>
                <p className="text-xs font-semibold text-amber-400 mt-1">{passivePct}%</p>
              </div>
              <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4 text-center">
                <ThumbsDown size={16} className="mx-auto mb-2 text-red-400" />
                <p className="text-lg font-bold text-red-400">{detractors}</p>
                <p className="text-[10px] text-[#6B7280]">Detractors (0-6)</p>
                <p className="text-xs font-semibold text-red-400 mt-1">{detractorPct}%</p>
              </div>
            </div>
          </FadeIn>

          {/* Score Distribution Chart */}
          <FadeIn delay={0.15}>
            <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={16} style={{ color: GOLD }} />
                <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
                  Score Distribution
                </span>
              </div>

              <div className="flex items-end justify-between gap-1.5 h-32">
                {(Array.isArray(distribution) ? distribution : Array(11).fill(0)).map((count, i) => {
                  const height = maxDistribution > 0 ? (count / maxDistribution) * 100 : 0;
                  let barColor = 'bg-red-400';
                  if (i >= 7 && i <= 8) barColor = 'bg-amber-400';
                  if (i >= 9) barColor = 'bg-emerald-400';

                  return (
                    <div key={i} className="flex flex-col items-center flex-1">
                      <span className="text-[9px] text-[#6B7280] mb-1">{count || ''}</span>
                      <div className="w-full flex justify-center">
                        <div
                          className={`w-full max-w-[28px] rounded-t-md transition-all duration-500 ${barColor}`}
                          style={{ height: `${Math.max(height, 2)}%`, minHeight: '2px' }}
                        />
                      </div>
                      <span className="text-[10px] text-[#9CA3AF] mt-1.5 font-medium">{i}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </FadeIn>
        </>
      )}

      {/* Recent Responses */}
      <FadeIn delay={0.2}>
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} style={{ color: GOLD }} />
            <h3 className="text-sm font-semibold text-[#E5E7EB]">Recent Responses</h3>
          </div>

          {responsesLoading ? (
            <CardSkeleton count={3} />
          ) : !responses?.length ? (
            <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-6 text-center">
              <MessageCircle size={24} className="mx-auto mb-2 text-[#6B7280]" />
              <p className="text-sm text-[#6B7280]">No responses yet</p>
              <p className="text-xs text-[#6B7280] mt-1">Send a survey to start collecting feedback</p>
            </div>
          ) : (
            <div className="space-y-2">
              {responses.map((r) => {
                const name = r.profiles?.full_name || 'Member';
                const initial = name.charAt(0).toUpperCase();

                return (
                  <AdminCard key={r.id}>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold text-[#9CA3AF] flex-shrink-0">
                        {initial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[#E5E7EB] truncate">{name}</span>
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${scoreBg(r.score)}`}
                          >
                            {r.score}
                          </span>
                        </div>
                        {r.feedback && (
                          <p className="text-xs text-[#9CA3AF] mt-1 line-clamp-2">{r.feedback}</p>
                        )}
                        <p className="text-[10px] text-[#6B7280] mt-1">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </AdminCard>
                );
              })}
            </div>
          )}
        </div>
      </FadeIn>

      {/* Feedback Highlights */}
      {feedbackResponses.length > 0 && (
        <FadeIn delay={0.25}>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={14} style={{ color: GOLD }} />
              <h3 className="text-sm font-semibold text-[#E5E7EB]">Feedback Highlights</h3>
            </div>

            <div className="space-y-2">
              {feedbackResponses.slice(0, 10).map((r) => {
                const name = r.profiles?.full_name || 'Member';

                return (
                  <div
                    key={r.id}
                    className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scoreBg(r.score)}`}
                      >
                        {r.score}/10
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-[#E5E7EB] italic leading-relaxed">
                      &ldquo;{r.feedback}&rdquo;
                    </p>
                    <p className="text-[10px] text-[#6B7280] mt-2">&mdash; {name}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Send Survey Modal */}
      <AdminModal
        open={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        title="Send NPS Survey"
      >
        <div className="space-y-4">
          <div className="bg-[#111827]/60 border border-white/[0.04] rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${GOLD}20` }}
              >
                <Send size={18} style={{ color: GOLD }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#E5E7EB]">NPS Survey</p>
                <p className="text-xs text-[#6B7280]">
                  &ldquo;How likely are you to recommend us?&rdquo;
                </p>
              </div>
            </div>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              This will send a push notification to all active gym members asking them to rate
              their experience on a scale of 0-10. Members can also leave optional written
              feedback.
            </p>
          </div>

          <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-3">
            <p className="text-xs text-amber-400">
              Only one survey can be active at a time. Members who have already responded will
              not receive a duplicate notification.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowSurveyModal(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => sendSurvey.mutate()}
              disabled={sendSurvey.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: `${GOLD}20`, color: GOLD }}
            >
              {sendSurvey.isPending ? 'Sending...' : 'Send to All Members'}
            </button>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
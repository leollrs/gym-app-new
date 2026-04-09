import { useState, useEffect, useMemo } from 'react';
import { MessageCircle, TrendingUp, Users, Send, ThumbsUp, Minus, ThumbsDown, BarChart3, Clock, ChevronDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { broadcastNotification } from '../../lib/notifications';
import {
  AdminPageShell,
  PageHeader,
  StatCard,
  AdminCard,
  AdminModal,
  FadeIn,
  SectionLabel,
  CardSkeleton,
} from '../../components/admin';

const GOLD = 'var(--color-accent)';

const PERIODS = [
  { labelKey: '30d', days: 30 },
  { labelKey: '90d', days: 90 },
  { labelKey: '180d', days: 180 },
  { labelKey: 'allTime', days: null },
];

function scoreColor(score) {
  if (score <= 2) return 'text-red-400';
  if (score <= 3) return 'text-amber-400';
  return 'text-emerald-400';
}

function scoreBg(score) {
  if (score <= 2) return 'bg-red-400/20 text-red-400';
  if (score <= 3) return 'bg-amber-400/20 text-amber-400';
  return 'bg-emerald-400/20 text-emerald-400';
}

function npsColor(nps) {
  if (nps < 0) return '#EF4444';
  if (nps < 30) return '#F97316';
  if (nps < 70) return '#10B981';
  return '#10B981';
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
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [days, setDays] = useState(30);
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  useEffect(() => {
    document.title = t('admin.nps.pageTitle', 'Member Feedback | Admin');
  }, [t]);

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
        .eq('is_active', true)
        .maybeSingle();

      if (existing) throw new Error(t('admin.nps.activeSurveyError', 'There is already an active survey running.'));

      const { error: insertError } = await supabase
        .from('nps_surveys')
        .insert({ gym_id: gymId, is_active: true, created_by: profile.id });

      if (insertError) throw insertError;

      await broadcastNotification({
        gymId,
        type: 'nps_survey',
        title: t('admin.nps.surveyNotifTitle', 'How likely are you to recommend us?'),
        body: t('admin.nps.surveyNotifBody', 'Take a quick 1-question survey and help us improve!'),
      });
    },
    onSuccess: () => {
      showToast(t('admin.nps.surveySent', 'Survey sent to all members'), 'success');
      setShowSurveyModal(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => {
      showToast(err.message || t('admin.nps.sendFailed', 'Failed to send survey'), 'error');
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
    <AdminPageShell>
      <PageHeader
        title={t('admin.nps.title', 'Member Feedback')}
        subtitle={t('admin.nps.subtitle', 'NPS surveys and satisfaction tracking')}
        actions={
          <button
            onClick={() => setShowSurveyModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:brightness-110"
            style={{ background: `${GOLD}20`, color: GOLD }}
          >
            <Send size={14} />
            {t('admin.nps.sendSurvey', 'Send Survey')}
          </button>
        }
      />

      {/* Period filter */}
      <FadeIn>
        <div className="flex gap-1.5 rounded-xl p-1 border border-white/[0.04] mt-6 mb-5 w-fit" style={{ background: 'var(--color-bg-card)' }}>
          {PERIODS.map((p) => (
            <button
              key={p.labelKey}
              onClick={() => setDays(p.days)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
              style={
                days === p.days
                  ? { background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)' }
                  : { color: 'var(--color-text-muted)' }
              }
            >
              {t(`admin.nps.period.${p.labelKey}`, p.labelKey)}
            </button>
          ))}
        </div>
      </FadeIn>

      {statsLoading ? (
        <CardSkeleton count={4} />
      ) : (
        <>
          {/* NPS Hero Score */}
          <FadeIn delay={0.05}>
            <AdminCard padding="p-6" className="mb-5">
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                {/* Left: Big NPS number */}
                <div className="flex flex-col items-center md:items-start md:flex-1">
                  <SectionLabel icon={BarChart3}>
                    {t('admin.nps.npsLabel', 'Net Promoter Score')}
                  </SectionLabel>
                  <span
                    className="text-[56px] md:text-[64px] font-black leading-none mt-3 tabular-nums"
                    style={{ color: npsColor(nps) }}
                  >
                    {nps > 0 ? '+' : ''}{nps}
                  </span>

                  {/* Gauge bar */}
                  <div className="w-full max-w-[300px] mt-4">
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden relative">
                      <div
                        className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${npsBarColor(nps)}`}
                        style={{ width: `${npsGaugePercent(nps)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>-100</span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>0</span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>+100</span>
                    </div>
                  </div>
                </div>

                {/* Right: Quick stats */}
                <div className="flex gap-6 justify-center md:justify-end">
                  <div className="text-center">
                    <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{totalResponses}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.nps.responses', 'Responses')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{responseRate}%</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.nps.responseRate', 'Response rate')}</p>
                  </div>
                </div>
              </div>
            </AdminCard>
          </FadeIn>

          {/* Promoters / Passives / Detractors breakdown */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <StatCard
                label={t('admin.nps.promoters', 'Promoters (4-5)')}
                value={promoters}
                sub={`${promoterPct}%`}
                borderColor="#10B981"
                icon={ThumbsUp}
                delay={0}
              />
              <StatCard
                label={t('admin.nps.passives', 'Passives (3)')}
                value={passives}
                sub={`${passivePct}%`}
                borderColor="#F97316"
                icon={Minus}
                delay={0.05}
              />
              <StatCard
                label={t('admin.nps.detractors', 'Detractors (1-2)')}
                value={detractors}
                sub={`${detractorPct}%`}
                borderColor="#EF4444"
                icon={ThumbsDown}
                delay={0.1}
              />
            </div>
          </FadeIn>

          {/* Stacked breakdown bar (visual) */}
          <FadeIn delay={0.12}>
            <AdminCard padding="p-4" className="mb-5">
              <SectionLabel icon={TrendingUp} className="mb-3">
                {t('admin.nps.breakdownBar', 'Response Breakdown')}
              </SectionLabel>
              <div className="flex rounded-lg overflow-hidden h-5">
                {promoterPct > 0 && (
                  <div
                    className="bg-emerald-400 flex items-center justify-center transition-all duration-500"
                    style={{ width: `${promoterPct}%` }}
                  >
                    {promoterPct >= 10 && (
                      <span className="text-[10px] font-bold text-emerald-950">{promoterPct}%</span>
                    )}
                  </div>
                )}
                {passivePct > 0 && (
                  <div
                    className="bg-amber-400 flex items-center justify-center transition-all duration-500"
                    style={{ width: `${passivePct}%` }}
                  >
                    {passivePct >= 10 && (
                      <span className="text-[10px] font-bold text-amber-950">{passivePct}%</span>
                    )}
                  </div>
                )}
                {detractorPct > 0 && (
                  <div
                    className="bg-red-400 flex items-center justify-center transition-all duration-500"
                    style={{ width: `${detractorPct}%` }}
                  >
                    {detractorPct >= 10 && (
                      <span className="text-[10px] font-bold text-red-950">{detractorPct}%</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-4 mt-2">
                <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> {t('admin.nps.promotersShort', 'Promoters')}
                </span>
                <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> {t('admin.nps.passivesShort', 'Passives')}
                </span>
                <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-red-400" /> {t('admin.nps.detractorsShort', 'Detractors')}
                </span>
              </div>
            </AdminCard>
          </FadeIn>

          {/* Score Distribution Chart */}
          <FadeIn delay={0.15}>
            <AdminCard padding="p-4" className="mb-5">
              <SectionLabel icon={BarChart3} className="mb-4">
                {t('admin.nps.distribution', 'Score Distribution')}
              </SectionLabel>

              <div className="flex items-end justify-between gap-1.5 h-32">
                {(Array.isArray(distribution) ? distribution : Array(11).fill(0)).map((count, i) => {
                  const height = maxDistribution > 0 ? (count / maxDistribution) * 100 : 0;
                  let barColor = 'bg-red-400';
                  if (i >= 7 && i <= 8) barColor = 'bg-amber-400';
                  if (i >= 9) barColor = 'bg-emerald-400';

                  return (
                    <div key={i} className="flex flex-col items-center flex-1">
                      <span className="text-[9px] mb-1" style={{ color: 'var(--color-text-muted)' }}>{count || ''}</span>
                      <div className="w-full flex justify-center">
                        <div
                          className={`w-full max-w-[28px] rounded-t-md transition-all duration-500 ${barColor}`}
                          style={{ height: `${Math.max(height, 2)}%`, minHeight: '2px' }}
                        />
                      </div>
                      <span className="text-[10px] mt-1.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{i}</span>
                    </div>
                  );
                })}
              </div>
            </AdminCard>
          </FadeIn>
        </>
      )}

      {/* Recent Responses */}
      <FadeIn delay={0.2}>
        <SectionLabel icon={Clock} className="mb-3">
          {t('admin.nps.recentResponses', 'Recent Responses')}
        </SectionLabel>

        {responsesLoading ? (
          <CardSkeleton count={3} />
        ) : !responses?.length ? (
          <AdminCard padding="p-8" className="text-center mb-5">
            <MessageCircle size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('admin.nps.noResponses', 'No responses yet')}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.nps.sendToCollect', 'Send a survey to start collecting feedback')}
            </p>
          </AdminCard>
        ) : (
          <div className="space-y-2 mb-5">
            {responses.map((r) => {
              const name = r.profiles?.full_name || t('admin.nps.member', 'Member');
              const initial = name.charAt(0).toUpperCase();

              return (
                <AdminCard key={r.id} hover>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{name}</span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${scoreBg(r.score)}`}
                        >
                          {r.score}
                        </span>
                      </div>
                      {r.feedback && (
                        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>{r.feedback}</p>
                      )}
                      <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, ...dateFnsLocale })}
                      </p>
                    </div>
                  </div>
                </AdminCard>
              );
            })}
          </div>
        )}
      </FadeIn>

      {/* Feedback Highlights */}
      {feedbackResponses.length > 0 && (
        <FadeIn delay={0.25}>
          <SectionLabel icon={MessageCircle} className="mb-3">
            {t('admin.nps.feedbackHighlights', 'Feedback Highlights')}
          </SectionLabel>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            {feedbackResponses.slice(0, 10).map((r) => {
              const name = r.profiles?.full_name || t('admin.nps.member', 'Member');

              return (
                <AdminCard key={r.id} borderLeft={r.score >= 4 ? '#10B981' : r.score >= 3 ? '#F97316' : '#EF4444'}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scoreBg(r.score)}`}
                    >
                      {r.score}/10
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, ...dateFnsLocale })}
                    </span>
                  </div>
                  <p className="text-sm italic leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
                    &ldquo;{r.feedback}&rdquo;
                  </p>
                  <p className="text-[10px] mt-2" style={{ color: 'var(--color-text-muted)' }}>&mdash; {name}</p>
                </AdminCard>
              );
            })}
          </div>
        </FadeIn>
      )}

      {/* Send Survey Modal */}
      <AdminModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        title={t('admin.nps.sendNpsSurvey', 'Send NPS Survey')}
        titleIcon={Send}
        footer={
          <>
            <button
              onClick={() => setShowSurveyModal(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('admin.nps.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => sendSurvey.mutate()}
              disabled={sendSurvey.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 hover:brightness-110"
              style={{ background: `${GOLD}20`, color: GOLD }}
            >
              {sendSurvey.isPending
                ? t('admin.nps.sending', 'Sending...')
                : t('admin.nps.sendToAll', 'Send to All Members')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <AdminCard>
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${GOLD}20` }}
              >
                <Send size={18} style={{ color: GOLD }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('admin.nps.npsSurveyLabel', 'NPS Survey')}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  &ldquo;{t('admin.nps.surveyQuestion', 'How likely are you to recommend us?')}&rdquo;
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {t(
                'admin.nps.surveyDesc',
                'This will send a push notification to all active gym members asking them to rate their experience on a scale of 0-10. Members can also leave optional written feedback.',
              )}
            </p>
          </AdminCard>

          <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-3">
            <p className="text-xs text-amber-400">
              {t(
                'admin.nps.surveyWarning',
                'Only one survey can be active at a time. Members who have already responded will not receive a duplicate notification.',
              )}
            </p>
          </div>
        </div>
      </AdminModal>
    </AdminPageShell>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { MessageCircle, TrendingUp, Users, Send, ThumbsUp, Minus, ThumbsDown, BarChart3, Clock, ChevronDown, Power } from 'lucide-react';
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
  if (nps < 0) return 'var(--color-danger)';
  if (nps < 30) return 'var(--color-danger)';
  if (nps < 70) return 'var(--color-success)';
  return 'var(--color-success)';
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
  const [editingSurvey, setEditingSurvey] = useState(null); // active survey row currently being edited
  const [editTitle, setEditTitle] = useState('');

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
      // FK is profile_id, not user_id — old code referenced a column that
      // doesn't exist so the embed silently returned null and member names
      // never showed up. avatar_preset doesn't exist either; profiles uses
      // avatar_value + avatar_type (set in 0133).
      // Also exclude score = -1 (dismissals — see 0180_nps_allow_dismissal_score).
      let query = supabase
        .from('nps_responses')
        .select('id, score, feedback, created_at, profiles:profile_id(full_name, avatar_url, avatar_type, avatar_value)')
        .eq('gym_id', gymId)
        .gte('score', 1)
        .order('created_at', { ascending: false })
        .limit(1000);

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

  // Active surveys list — admin needs to see what's running and be able
  // to deactivate before sending a new one.
  const activeSurveysKey = ['admin', 'nps', gymId, 'active-surveys'];
  const { data: activeSurveys = [] } = useQuery({
    queryKey: activeSurveysKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nps_surveys')
        .select('id, title, created_at, created_by')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const deactivateSurvey = useMutation({
    mutationFn: async (surveyId) => {
      const { error } = await supabase
        .from('nps_surveys')
        .update({ is_active: false })
        .eq('id', surveyId)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      showToast(t('admin.nps.surveyDeactivated', 'Encuesta desactivada'), 'success');
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => {
      showToast(err.message || t('admin.nps.deactivateFailed', 'No se pudo desactivar'), 'error');
    },
  });

  const updateSurvey = useMutation({
    mutationFn: async ({ id, title }) => {
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) throw new Error(t('admin.nps.titleRequired', 'La pregunta no puede estar vacía'));
      const { error } = await supabase
        .from('nps_surveys')
        .update({ title: cleanTitle })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      showToast(t('admin.nps.surveyUpdated', 'Encuesta actualizada'), 'success');
      setEditingSurvey(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => {
      showToast(err.message || t('admin.nps.updateFailed', 'No se pudo guardar'), 'error');
    },
  });

  const sendSurvey = useMutation({
    mutationFn: async () => {
      // Auto-close any active surveys instead of erroring out — admin
      // can launch a new one in one click. They still see what's active
      // in the management card and can deactivate manually if they want
      // to keep collecting on the old one.
      await supabase
        .from('nps_surveys')
        .update({ is_active: false })
        .eq('gym_id', gymId)
        .eq('is_active', true);

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

  // Compute the 1-5 bucketing CLIENT-SIDE from the response rows we already
  // loaded. The RPC (get_nps_stats) returns numbers based on the 0-10 NPS
  // bucketing in migration 0169 unless 0373 has been applied — so a real "5"
  // would land in detractors (5 < 7) and the page lied. Computing here makes
  // it correct regardless of which RPC version is deployed, and exact for any
  // gym with ≤1000 responses in the selected window (see query .limit above).
  const computed = useMemo(() => {
    const dist = [0, 0, 0, 0, 0]; // scores 1..5
    let promoters = 0, passives = 0, detractors = 0;
    for (const r of responses || []) {
      const s = Number(r.score);
      if (!Number.isFinite(s) || s < 1 || s > 5) continue;
      dist[s - 1] += 1;
      if (s >= 4) promoters += 1;
      else if (s === 3) passives += 1;
      else detractors += 1;
    }
    const total = promoters + passives + detractors;
    const nps = total === 0 ? 0 : Math.round(((promoters / total) - (detractors / total)) * 100);
    return { dist, promoters, passives, detractors, total, nps };
  }, [responses]);

  const nps = computed.nps;
  // Always trust the client-side count over the RPC. The old get_nps_stats
  // (migration 0169, before 0373) buckets on the 0-10 NPS scale and returns
  // bogus numbers when members are submitting on the 1-5 scale — including
  // a wrong total when p_days is NULL. Recompute everything from the rows
  // we actually rendered.
  const totalResponses = computed.total;
  const responseRate = stats?.response_rate ?? 0;
  const promoters = computed.promoters;
  const passives = computed.passives;
  const detractors = computed.detractors;
  const distribution = computed.dist;

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
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              background: GOLD,
              color: 'var(--color-bg-base)',
              border: '1px solid var(--color-accent)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            <Send size={14} />
            {t('admin.nps.sendSurvey', 'Send Survey')}
          </button>
        }
      />

      {/* Active surveys — admin can see what's currently running and turn them off */}
      {activeSurveys.length > 0 && (
        <FadeIn>
          <AdminCard className="mt-6 p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-3">
              <Send size={14} style={{ color: 'var(--color-accent)' }} />
              <span className="admin-eyebrow">
                {t('admin.nps.activeSurveys', 'Encuestas activas')}
                <span className="ml-2 admin-pill admin-pill--outline" style={{ fontSize: 10 }}>
                  {activeSurveys.length}
                </span>
              </span>
            </div>
            <div className="space-y-2">
              {activeSurveys.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setEditingSurvey(s);
                    setEditTitle(s.title || '');
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors hover:brightness-110"
                  style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>
                      {s.title || t('admin.nps.npsSurveyLabel', 'NPS Survey')}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {t('admin.nps.startedAgo', 'Started')} {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, ...dateFnsLocale })}
                      <span className="mx-1.5">·</span>
                      <span style={{ color: 'var(--color-accent)' }}>{t('admin.nps.tapToEdit', 'Tocar para ver / editar')}</span>
                    </p>
                  </div>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      deactivateSurvey.mutate(s.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        deactivateSurvey.mutate(s.id);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold transition-all hover:brightness-110 active:scale-[0.98] flex-shrink-0 cursor-pointer"
                    style={{
                      background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
                      color: 'var(--color-danger)',
                      border: '1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)',
                      opacity: deactivateSurvey.isPending ? 0.5 : 1,
                      pointerEvents: deactivateSurvey.isPending ? 'none' : 'auto',
                    }}
                  >
                    <Power size={12} />
                    {t('admin.nps.deactivate', 'Desactivar')}
                  </span>
                </button>
              ))}
            </div>
          </AdminCard>
        </FadeIn>
      )}

      {/* Period filter as pills */}
      <FadeIn>
        <div className="flex gap-1.5 mt-6 mb-4 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.labelKey}
              onClick={() => setDays(p.days)}
              className={`admin-pill flex-shrink-0 ${days === p.days ? 'admin-pill--dark' : 'admin-pill--outline'}`}
              style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {t(`admin.nps.period.${p.labelKey}`, p.labelKey)}
            </button>
          ))}
        </div>
      </FadeIn>

      {/* Bucket counts + breakdown + distribution all come from client-side
          computation over `responses` now, so gate on responsesLoading rather
          than statsLoading (which is moot since we ignore most of stats). */}
      {responsesLoading ? (
        <CardSkeleton count={4} />
      ) : (
        <>
          {/* NPS Hero Score */}
          <FadeIn delay={0.05}>
            <div className="admin-card p-3 sm:p-4 md:p-[18px] mb-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={14} style={{ color: 'var(--color-accent)' }} />
                <span className="admin-eyebrow">{t('admin.nps.npsLabel', 'Net Promoter Score')}</span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
                {/* Left: Big NPS + gauge */}
                <div className="text-center md:text-left">
                  <div
                    className="admin-kpi text-[56px] sm:text-[72px] leading-none tabular-nums"
                    style={{ color: npsColor(nps), letterSpacing: '-2px', fontWeight: 800 }}
                  >
                    {nps > 0 ? '+' : ''}{nps}
                  </div>
                  <div
                    className="h-[6px] rounded-full overflow-hidden relative mt-2.5 w-full max-w-[260px] mx-auto md:mx-0"
                    style={{ background: 'var(--color-admin-panel)' }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(90deg, var(--color-danger), var(--color-warning) 50%, var(--color-success))',
                      }}
                    />
                    <div
                      className="absolute -top-1 -bottom-1 w-[3px] rounded-[3px]"
                      style={{ left: `${npsGaugePercent(nps)}%`, background: 'var(--color-admin-text)' }}
                    />
                  </div>
                  <div
                    className="flex justify-between mt-1 text-[10px] font-bold w-full max-w-[260px] mx-auto md:mx-0"
                    style={{ color: 'var(--color-admin-text-muted)' }}
                  >
                    <span>-100</span><span>0</span><span>+100</span>
                  </div>
                </div>

                <div className="hidden md:block flex-1" />

                {/* Right: Responses + Response rate — 2-col grid on mobile */}
                <div className="grid grid-cols-2 gap-3 md:contents">
                  <div className="text-center md:text-right">
                    <div className="admin-kpi text-[26px] sm:text-[34px] leading-none">{totalResponses}</div>
                    <div
                      className="text-[10px] sm:text-[11px] font-bold uppercase mt-1"
                      style={{ letterSpacing: '0.5px', color: 'var(--color-admin-text-muted)' }}
                    >
                      {t('admin.nps.responses', 'Responses')}
                    </div>
                  </div>
                  <div className="text-center md:text-right">
                    <div className="admin-kpi text-[26px] sm:text-[34px] leading-none">{responseRate}%</div>
                    <div
                      className="text-[10px] sm:text-[11px] font-bold uppercase mt-1"
                      style={{ letterSpacing: '0.5px', color: 'var(--color-admin-text-muted)' }}
                    >
                      {t('admin.nps.responseRate', 'Response rate')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Promoters / Passives / Detractors breakdown */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
              <StatCard
                label={t('admin.nps.promoters', 'Promoters (4-5)')}
                value={promoters}
                sub={t('admin.nps.percentOfRespondents', '{{pct}}% of respondents', { pct: promoterPct })}
                borderColor="var(--color-success)"
                icon={ThumbsUp}
                delay={0}
              />
              <StatCard
                label={t('admin.nps.passives', 'Passives (3)')}
                value={passives}
                sub={t('admin.nps.percentOfRespondents', '{{pct}}% of respondents', { pct: passivePct })}
                borderColor="var(--color-warning)"
                icon={Minus}
                delay={50}
              />
              <StatCard
                label={t('admin.nps.detractors', 'Detractors (1-2)')}
                value={detractors}
                sub={t('admin.nps.percentOfRespondents', '{{pct}}% of respondents', { pct: detractorPct })}
                borderColor="var(--color-danger)"
                icon={ThumbsDown}
                delay={100}
              />
            </div>
          </FadeIn>

          {/* Stacked breakdown bar */}
          <FadeIn delay={0.12}>
            <div className="admin-card p-3 sm:p-4 md:p-[18px] mb-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} style={{ color: 'var(--color-accent)' }} />
                <span className="admin-eyebrow">{t('admin.nps.breakdownBar', 'Response Breakdown')}</span>
              </div>
              <div
                className="flex rounded-full overflow-hidden h-[22px] gap-[2px]"
                style={{ background: 'var(--color-admin-panel)' }}
              >
                {promoterPct > 0 && (
                  <div
                    className="flex items-center justify-center transition-all duration-500"
                    style={{ width: `${promoterPct}%`, background: 'var(--color-success)' }}
                  >
                    {promoterPct >= 10 && (
                      <span className="text-[11px] font-bold text-white">{promoterPct}%</span>
                    )}
                  </div>
                )}
                {passivePct > 0 && (
                  <div
                    className="flex items-center justify-center transition-all duration-500"
                    style={{ width: `${passivePct}%`, background: 'var(--color-warning)' }}
                  >
                    {passivePct >= 10 && (
                      <span className="text-[11px] font-bold text-white">{passivePct}%</span>
                    )}
                  </div>
                )}
                {detractorPct > 0 && (
                  <div
                    className="flex items-center justify-center transition-all duration-500"
                    style={{ width: `${detractorPct}%`, background: 'var(--color-danger)' }}
                  >
                    {detractorPct >= 10 && (
                      <span className="text-[11px] font-bold text-white">{detractorPct}%</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3 sm:gap-5 mt-3 text-[11.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--color-success)' }} /> {t('admin.nps.promotersShort', 'Promoters')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--color-warning)' }} /> {t('admin.nps.passivesShort', 'Passives')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--color-danger)' }} /> {t('admin.nps.detractorsShort', 'Detractors')}
                </span>
              </div>
            </div>
          </FadeIn>

          {/* Score Distribution Chart — 11-col bar chart */}
          <FadeIn delay={0.15}>
            <div className="admin-card p-3 sm:p-4 md:p-[18px] mb-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={14} style={{ color: 'var(--color-accent)' }} />
                <span className="admin-eyebrow">{t('admin.nps.distribution', 'Score Distribution')}</span>
              </div>

              <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
                {/* 5-bucket distribution: array indices 0..4 → scores 1..5.
                    Each cell is a 3-row flex column so the count sits above
                    the bar and the score sits below. The bar grows from the
                    bottom of its row to a height proportional to count /
                    max(distribution). */}
                <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                  {(Array.isArray(distribution) ? distribution : Array(5).fill(0)).slice(0, 5).map((count, i) => {
                    const score = i + 1; // 1..5
                    const height = maxDistribution > 0 ? (count / maxDistribution) * 100 : 0;
                    const barBg = score <= 2 ? 'var(--color-danger)' : score === 3 ? 'var(--color-warning)' : 'var(--color-success)';
                    const isEmpty = !count;
                    return (
                      <div key={score} className="flex flex-col items-center">
                        {/* Count */}
                        <div
                          className="admin-mono text-[12px] font-bold mb-1 tabular-nums"
                          style={{ color: isEmpty ? 'var(--color-admin-text-muted)' : 'var(--color-admin-text)', opacity: isEmpty ? 0.45 : 1 }}
                        >
                          {count}
                        </div>
                        {/* Bar — fixed-height row, fills bottom-up */}
                        <div className="w-full flex items-end" style={{ height: 110 }}>
                          <div
                            className="rounded-t-[5px] transition-all duration-500 w-full"
                            style={{
                              height: `${Math.max(height, count ? 4 : 2)}%`,
                              minHeight: count ? '6px' : '3px',
                              background: barBg,
                              opacity: isEmpty ? 0.15 : 1,
                            }}
                          />
                        </div>
                        {/* Score label */}
                        <div
                          className="admin-mono text-[11px] font-bold mt-1.5 tabular-nums"
                          style={{ color: 'var(--color-admin-text-muted)' }}
                        >
                          {score}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
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

              // 1-5 tiers: promoters 4-5 (success), passive 3 (warning), detractors 1-2 (danger).
              const borderColor = r.score >= 4
                ? 'var(--color-success)'
                : r.score === 3
                  ? 'var(--color-warning)'
                  : 'var(--color-danger)';
              return (
                <AdminCard key={r.id} borderLeft={borderColor}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scoreBg(r.score)}`}
                    >
                      {r.score}/5
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
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.98]"
              style={{
                background: GOLD,
                color: 'var(--color-bg-base)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }}
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
                style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}
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
                'This will send a push notification to all active gym members asking them to rate their experience on a scale of 1 to 5. Members can also leave optional written feedback.',
              )}
            </p>
          </AdminCard>

          <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-3">
            <p className="text-xs text-amber-400">
              {activeSurveys.length > 0
                ? t(
                    'admin.nps.surveyWarningReplace',
                    'Sending will deactivate the {{count}} active survey(s) currently running. Existing responses are preserved.',
                    { count: activeSurveys.length },
                  )
                : t(
                    'admin.nps.surveyWarning',
                    'Members who have already responded to past surveys will not receive a duplicate notification.',
                  )}
            </p>
          </div>
        </div>
      </AdminModal>

      {/* Edit Active Survey Modal — view + edit the question, or deactivate. */}
      <AdminModal
        isOpen={!!editingSurvey}
        onClose={() => setEditingSurvey(null)}
        title={t('admin.nps.editSurvey', 'Editar encuesta activa')}
        titleIcon={Send}
        footer={
          <>
            <button
              onClick={() => {
                if (editingSurvey) deactivateSurvey.mutate(editingSurvey.id);
                setEditingSurvey(null);
              }}
              disabled={deactivateSurvey.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 hover:brightness-110"
              style={{
                background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
                color: 'var(--color-danger)',
                border: '1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)',
              }}
            >
              {t('admin.nps.deactivate', 'Desactivar')}
            </button>
            <button
              onClick={() => editingSurvey && updateSurvey.mutate({ id: editingSurvey.id, title: editTitle })}
              disabled={updateSurvey.isPending || !editTitle.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.98]"
              style={{
                background: GOLD,
                color: 'var(--color-bg-base)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }}
            >
              {updateSurvey.isPending
                ? t('admin.nps.saving', 'Guardando...')
                : t('admin.nps.save', 'Guardar')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label
              className="block text-[11px] font-bold uppercase tracking-wider mb-2"
              style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '0.1em' }}
            >
              {t('admin.nps.surveyQuestionLabel', 'Pregunta de la encuesta')}
            </label>
            <textarea
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder={t('admin.nps.surveyQuestion', '¿Qué tan probable es que nos recomiendes?')}
              className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none resize-none"
              style={{
                background: 'var(--color-bg-deep)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.nps.surveyQuestionHint', 'Esta es la pregunta que ven los miembros. Las respuestas se califican del 1 al 5.')}
            </p>
          </div>

          {editingSurvey && (
            <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.nps.startedAgo', 'Started')}{' '}
              {formatDistanceToNow(new Date(editingSurvey.created_at), { addSuffix: true, ...dateFnsLocale })}
            </p>
          )}
        </div>
      </AdminModal>
    </AdminPageShell>
  );
}

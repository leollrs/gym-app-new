import { useState, useEffect, useMemo } from 'react';
import { MessageCircle, Send, ThumbsUp, Minus, ThumbsDown, BarChart3, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { broadcastNotification } from '../../lib/notifications';
import {
  AdminPageShell,
  PageHeader,
  AdminCard,
  FadeIn,
  SectionLabel,
  CardSkeleton,
} from '../../components/admin';
import { PERIODS, scoreColor, scoreBg, npsColor, npsBarColor, npsGaugePercent } from '../../lib/admin/npsHelpers';
import { SendSurveyModal, EditSurveyModal } from './components/NpsSurveyModals';

const GOLD = 'var(--color-accent)';

export default function AdminNPS() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  // Period shared across Insights pages — see InsightsRangeContext.
  // NPS uses `days` (number) directly; "all time" is represented as null.
  // If the context's value isn't one of this page's choices (e.g. 7d from
  // Analytics), fall back to 30 for display + queries.
  const { periodDays: ctxPeriodDays, setPeriodDays } = useInsightsRange();
  const NPS_DAY_VALUES = PERIODS.map((p) => p.days);
  const days = NPS_DAY_VALUES.includes(ctxPeriodDays) ? ctxPeriodDays : 30;
  const setDays = (next) => setPeriodDays(next);
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
    () => (responses || []).filter((r) => {
      if (!r.feedback?.trim()) return false;
      const s = Number(r.score);
      // Drop out-of-range scores (legacy 0-10 data or stray writes); scale is 1-5.
      return Number.isFinite(s) && s >= 1 && s <= 5;
    }),
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

      {/* Active surveys — compact one-line banner. Tap to open the edit modal for the most recent one. */}
      {activeSurveys.length > 0 && (
        <FadeIn>
          <div
            className="mt-6 flex items-center gap-3 px-3 py-2 rounded-xl"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
            }}
          >
            <Send size={14} style={{ color: 'var(--color-accent)' }} className="flex-shrink-0" />
            <span className="text-[12.5px] font-semibold flex-1 min-w-0 truncate" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.nps.activeSurveysBanner', {
                count: activeSurveys.length,
                defaultValue: '{{count}} survey(s) active',
              })}
            </span>
            <button
              onClick={() => {
                const s = activeSurveys[0];
                setEditingSurvey(s);
                setEditTitle(s.title || '');
              }}
              className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-bg-base)',
              }}
            >
              {t('admin.nps.manage', 'Manage')}
            </button>
          </div>
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
          {/* NPS Hero Score — now with inline P/Pa/D chips at bottom */}
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

              {/* Inline P/Pa/D chips — embedded so the hero owns the whole breakdown story */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <ThumbsUp size={14} style={{ color: 'var(--color-success)' }} className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold tabular-nums" style={{ color: 'var(--color-admin-text)' }}>
                      {promoters} <span className="font-normal" style={{ color: 'var(--color-admin-text-muted)' }}>({promoterPct}%)</span>
                    </div>
                    <div className="text-[10px] font-semibold truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {t('admin.nps.promotersShort', 'Promoters')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <Minus size={14} style={{ color: 'var(--color-warning)' }} className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold tabular-nums" style={{ color: 'var(--color-admin-text)' }}>
                      {passives} <span className="font-normal" style={{ color: 'var(--color-admin-text-muted)' }}>({passivePct}%)</span>
                    </div>
                    <div className="text-[10px] font-semibold truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {t('admin.nps.passivesShort', 'Passives')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <ThumbsDown size={14} style={{ color: 'var(--color-danger)' }} className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold tabular-nums" style={{ color: 'var(--color-admin-text)' }}>
                      {detractors} <span className="font-normal" style={{ color: 'var(--color-admin-text-muted)' }}>({detractorPct}%)</span>
                    </div>
                    <div className="text-[10px] font-semibold truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {t('admin.nps.detractorsShort', 'Detractors')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Feedback Highlights — moved up: verbatim quotes are the highest action-driving content */}
          {feedbackResponses.length > 0 && (
            <FadeIn delay={0.08}>
              <SectionLabel icon={MessageCircle} className="mb-3">
                {t('admin.nps.feedbackHighlights', 'Feedback Highlights')}
              </SectionLabel>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                {feedbackResponses.slice(0, 10).map((r) => {
                  const name = r.profiles?.full_name || t('admin.nps.member', 'Member');
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
            <p className="text-xs mt-1 mb-4" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.nps.sendToCollect', 'Send a survey to start collecting feedback')}
            </p>
            <button
              onClick={() => setShowSurveyModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors hover:brightness-110"
              style={{ background: GOLD, color: 'var(--color-bg-base)' }}
            >
              <Send size={14} /> {t('admin.nps.sendFirstSurvey', 'Send your first survey')}
            </button>
          </AdminCard>
        ) : (
          <div className="space-y-2 mb-5">
            {responses.filter(r => {
              const s = Number(r.score);
              return Number.isFinite(s) && s >= 1 && s <= 5;
            }).map((r) => {
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

      <SendSurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        onSend={() => sendSurvey.mutate()}
        activeSurveys={activeSurveys}
        isPending={sendSurvey.isPending}
      />

      <EditSurveyModal
        editingSurvey={editingSurvey}
        onClose={() => setEditingSurvey(null)}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        onDeactivate={(id) => deactivateSurvey.mutate(id)}
        onUpdate={(args) => updateSurvey.mutate(args)}
        deactivatePending={deactivateSurvey.isPending}
        updatePending={updateSurvey.isPending}
        dateFnsLocale={dateFnsLocale}
      />
    </AdminPageShell>
  );
}

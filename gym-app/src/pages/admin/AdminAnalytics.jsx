import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { FadeIn, AdminPageShell } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { adminKeys } from '../../lib/adminQueryKeys';
import { suggestTarget, checkRealism } from '../../lib/admin/realisticTargets';
import { fetchCurrentKPIs } from '../../lib/admin/currentKPIs';
import { TK, FK, Ico, Card, AICON, SectionLabel } from './components/analytics/analyticsKit';

import GrowthChart from './components/analytics/GrowthChart';
import RetentionChart from './components/analytics/RetentionChart';
import ActivityChart from './components/analytics/ActivityChart';
import CohortTable from './components/analytics/CohortTable';
import ChallengeStats from './components/analytics/ChallengeStats';
import OnboardingFunnel from './components/analytics/OnboardingFunnel';
import LifecycleStages from './components/analytics/LifecycleStages';
import TrainerPerformance from './components/analytics/TrainerPerformance';
import MonthlySummary from './components/analytics/MonthlySummary';
import WhyLeftPanel from './components/WhyLeftPanel';
import RetentionEffectivenessPanel from './components/RetentionEffectivenessPanel';

const KPI_METRICS = [
  { key: 'retention_rate', labelKey: 'admin.analytics.retentionRate', unit: '%', icon: AICON.chart },
  { key: 'new_members', labelKey: 'admin.analytics.newMembers', unit: '', icon: AICON.users },
  { key: 'active_rate', labelKey: 'admin.analytics.activeRate', unit: '%', icon: AICON.flame },
  { key: 'avg_workouts', labelKey: 'admin.analytics.avgWorkouts', unit: '', icon: AICON.dumbbell },
  { key: 'checkin_rate', labelKey: 'admin.analytics.checkinRate', unit: '%', icon: AICON.pin },
  { key: 'churn_rate', labelKey: 'admin.analytics.churnRate', unit: '%', icon: AICON.warn, invertColor: true },
];

// status → semantic tone (used for value text + progress bar)
function kpiTone(current, target, invert) {
  if (current == null || target == null) return null;
  const ratio = current / target;
  if (invert) return ratio <= 1 ? 'success' : ratio <= 1.25 ? 'warning' : 'danger';
  return ratio >= 1 ? 'success' : ratio >= 0.8 ? 'warning' : 'danger';
}
const toneColor = (tone) => (tone ? `var(--color-${tone})` : TK.text);

function KPITargets({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const month = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  const { data: targets = {} } = useQuery({
    queryKey: [...adminKeys.analytics.all(gymId), 'kpi-targets', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('admin_kpi_targets')
        .select('metric, target_value')
        .eq('gym_id', gymId)
        .eq('month', month);
      const map = {};
      (data || []).forEach((r) => { map[r.metric] = r; });
      return map;
    },
    enabled: !!gymId,
  });

  // Current KPI values, derived live from profiles/sessions/check_ins. Feeds
  // both the "current vs target" display and the realistic-target advisor.
  const { data: currentKPIs = {} } = useQuery({
    queryKey: [...adminKeys.analytics.all(gymId), 'kpi-current'],
    queryFn: () => fetchCurrentKPIs(gymId),
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  const upsert = useMutation({
    mutationFn: async ({ metric, value }) => {
      const { error } = await supabase
        .from('admin_kpi_targets')
        .upsert({ gym_id: gymId, month, metric, target_value: value }, { onConflict: 'gym_id,month,metric' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.analytics.all(gymId) });
      showToast(t('admin.analytics.targetSaved', 'Target saved'), 'success');
      setEditing(null);
    },
    onError: () => showToast(t('admin.analytics.targetSaveFailed', 'Failed to save target'), 'error'),
  });

  const save = (metric) => {
    const val = parseFloat(draft);
    if (isNaN(val) || val < 0) return;
    upsert.mutate({ metric, value: val });
  };

  const inputStyle = {
    flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 10, background: TK.surface,
    border: `1px solid ${TK.borderSolid}`, fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, outline: 'none',
  };
  const sqBtn = (bg, line) => ({ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, background: bg, border: `1px solid ${line}` });

  return (
    <div>
      {/* section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Ico ch={AICON.target} size={18} color={TK.accent} stroke={2} />
          <span style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.analytics.kpiTargets', 'KPI Targets')}</span>
        </div>
        <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint }}>{format(new Date(), 'MMMM yyyy', dateFnsLocale)}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] md:gap-[18px]">
        {KPI_METRICS.map((m) => {
          const row = targets[m.key];
          const current = currentKPIs?.[m.key] ?? null;
          const target = row?.target_value;
          const pct = target ? Math.min(((current ?? 0) / target) * 100, 100) : 0;
          const isEditing = editing === m.key;
          const suggested = suggestTarget(m.key, current);
          const draftNum = parseFloat(draft);
          const realism = isEditing && Number.isFinite(draftNum) ? checkRealism(m.key, current, draftNum) : null;
          const tone = kpiTone(current, target, m.invertColor);

          return (
            <Card key={m.key} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* label row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, flexShrink: 0 }}>
                  <Ico ch={m.icon} size={16} color={TK.accent} stroke={2} />
                </span>
                <span style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', color: TK.textSub }}>{t(m.labelKey)}</span>
              </div>

              {/* value */}
              <div style={{ fontFamily: FK.display, fontSize: 38, fontWeight: 800, letterSpacing: -1.4, lineHeight: 1, margin: '16px 0 12px', color: toneColor(tone) }}>
                {current != null ? `${current}${m.unit}` : '——'}
              </div>

              {/* progress bar */}
              <div style={{ height: 6, borderRadius: 99, background: TK.surface3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: toneColor(tone) === TK.text ? TK.accent : toneColor(tone), transition: 'width .6s ease' }} />
              </div>

              <div style={{ height: 1, background: TK.divider }} />

              {/* footer */}
              {isEditing ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="number" min="0" max="100000" autoFocus
                      aria-label={t('admin.analytics.targetInput', { metric: t(m.labelKey), defaultValue: 'Target value for {{metric}}' })}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && save(m.key)}
                      style={inputStyle}
                    />
                    <button type="button" onClick={() => save(m.key)} aria-label={t('admin.analytics.saveTarget', 'Save target')}
                      style={sqBtn('var(--color-success-soft)', 'color-mix(in srgb, var(--color-success) 32%, transparent)')}>
                      <Ico ch={AICON.check} size={16} color="var(--color-success)" stroke={2.2} />
                    </button>
                    <button type="button" onClick={() => setEditing(null)} aria-label={t('admin.analytics.cancelEdit', 'Cancel editing')}
                      style={sqBtn(TK.surface2, TK.borderSolid)}>
                      <Ico ch={AICON.x} size={15} color={TK.textMute} stroke={2.2} />
                    </button>
                  </div>
                  {suggested != null && (
                    <button type="button" onClick={() => setDraft(String(suggested))}
                      style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 11.5, fontWeight: 700, color: TK.accent, cursor: 'pointer' }}>
                      <Ico ch={AICON.sparkle} size={12} color={TK.accent} stroke={2} />
                      {t('admin.analytics.suggestedTarget', { value: suggested, unit: m.unit, defaultValue: 'Suggested: {{value}}{{unit}}' })}
                    </button>
                  )}
                  {realism && (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--color-warning-soft)', border: '1px solid color-mix(in srgb, var(--color-warning) 28%, transparent)' }}>
                      <Ico ch={AICON.warn} size={13} color="var(--color-warning)" stroke={2} style={{ marginTop: 1, flexShrink: 0 }} />
                      <span style={{ fontFamily: FK.body, fontSize: 11, lineHeight: 1.4, color: 'var(--color-warning-ink, var(--color-warning))' }}>
                        {t('admin.analytics.unrealisticWarning', { baseline: realism.baseline, delta: realism.monthlyDelta, suggested: realism.suggested, unit: realism.unit, defaultValue: 'From {{baseline}}{{unit}} baseline, gyms typically improve ~{{delta}}{{unit}}/month. Suggested: {{suggested}}{{unit}}.' })}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => { setEditing(m.key); setDraft(target ?? ''); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: TK.textMute, cursor: 'pointer', background: 'transparent', border: 'none' }}>
                    <Ico ch={AICON.plus} size={13} color={TK.textMute} stroke={2.2} />
                    {target != null
                      ? t('admin.analytics.targetLabel', { value: target, unit: m.unit, defaultValue: 'Target: {{value}}{{unit}}' })
                      : t('admin.analytics.setTarget', 'Set Target')}
                  </button>
                  {suggested != null && (
                    <button type="button" onClick={() => { setEditing(m.key); setDraft(String(target ?? suggested)); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: TK.accent, cursor: 'pointer' }}>
                      <Ico ch={AICON.sparkle} size={12} color={TK.accent} stroke={2} />
                      {t('admin.analytics.suggestedTarget', { value: suggested, unit: m.unit, defaultValue: 'Suggested: {{value}}{{unit}}' })}
                    </button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Month-span selector. months drives the trend charts; days keeps the shared
// InsightsRangeContext interoperable with day-based sibling pages.
const PERIODS = [
  { key: '3m', labelKey: 'admin.analytics.period3m', fallback: '3M', days: 90, months: 3 },
  { key: '6m', labelKey: 'admin.analytics.period6m', fallback: '6M', days: 180, months: 6 },
  { key: '12m', labelKey: 'admin.analytics.period12m', fallback: '12M', days: 365, months: 12 },
  { key: 'all', labelKey: 'admin.analytics.periodAll', fallback: 'All', days: null, months: null },
];

const ANALYTICS_TAB_KEYS = [
  { key: 'overview', labelKey: 'admin.analytics.tabThisMonth', fallback: 'This Month', icon: AICON.grid },
  { key: 'growth', labelKey: 'admin.analytics.tabGrowth', fallback: 'Growth', icon: AICON.sprout },
  { key: 'engagement', labelKey: 'admin.analytics.tabEngagement', fallback: 'Engagement', icon: AICON.bolt },
  { key: 'retention', labelKey: 'admin.analytics.tabRetention', fallback: 'Retention', icon: AICON.heart },
  { key: 'deep-dives', labelKey: 'admin.analytics.tabDeepDives', fallback: 'Deep Dives', icon: AICON.scope },
];

export default function AdminAnalytics() {
  const { t } = useTranslation('pages');
  const { profile, availableRoles } = useAuth();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = useCallback((tab) => { setSearchParams({ tab }, { replace: true }); }, [setSearchParams]);

  const { periodDays: ctxPeriodDays, setPeriodDays } = useInsightsRange();
  const matchedPeriod = PERIODS.find((p) => p.days === ctxPeriodDays) ?? PERIODS.find((p) => p.key === '6m');
  const period = matchedPeriod.key;
  const setPeriod = (key) => setPeriodDays((PERIODS.find((p) => p.key === key) || {}).days ?? null);

  const ANALYTICS_TABS = ANALYTICS_TAB_KEYS.map(tab => ({ ...tab, label: t(tab.labelKey, tab.fallback) }));

  useEffect(() => { document.title = t('admin.analytics.title', 'Analytics') + ' | ' + (window.__APP_NAME || 'TuGymPR'); }, [t]);

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p style={{ color: 'var(--color-danger)', fontFamily: FK.body, fontSize: 14, fontWeight: 600 }}>{t('admin.overview.accessDenied')}</p>
      </div>
    );
  }

  const selectedPeriod = PERIODS.find((p) => p.key === period) || {};
  const monthsBack = selectedPeriod.months ?? null;

  return (
    <AdminPageShell>
      {/* header + range pills */}
      <FadeIn>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.analytics.title', 'Analytics')}</h1>
            <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.analytics.subtitle', 'Retention, growth, and engagement metrics')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PERIODS.map((p) => {
              const on = period === p.key;
              return (
                <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                  style={{ padding: '9px 16px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : TK.surface, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, whiteSpace: 'nowrap' }}>
                  {t(p.labelKey, p.fallback)}
                </button>
              );
            })}
          </div>
        </div>
      </FadeIn>

      {/* icon tab nav */}
      <FadeIn delay={20}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ANALYTICS_TABS.length},1fr)`, borderBottom: `1px solid ${TK.borderSolid}`, margin: '22px 0 4px' }}>
          {ANALYTICS_TABS.map((tab) => {
            const on = tab.key === activeTab;
            return (
              <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '14px 4px 16px', position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none' }}>
                <Ico ch={tab.icon} size={19} color={on ? TK.accent : TK.textMute} stroke={on ? 2.1 : 1.9} />
                <span style={{ fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute, textAlign: 'center', lineHeight: 1.1 }}>{tab.label}</span>
                {on && <span style={{ position: 'absolute', left: '30%', right: '30%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
              </button>
            );
          })}
        </div>
      </FadeIn>

      <SwipeableTabContent tabs={ANALYTICS_TABS} active={activeTab} onChange={setActiveTab}>
        {(tabKey) => {
          if (tabKey === 'overview') return (
            <div style={{ paddingTop: 24 }}>
              <FadeIn delay={30}><KPITargets gymId={gymId} /></FadeIn>
              <FadeIn delay={50}><SectionLabel>{t('admin.analytics.sectionLifecycle', 'Lifecycle')}</SectionLabel></FadeIn>
              <FadeIn delay={60}><LifecycleStages gymId={gymId} /></FadeIn>
            </div>
          );
          if (tabKey === 'growth') return (
            <div style={{ paddingTop: 24 }}>
              <FadeIn delay={30}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
                  <GrowthChart gymId={gymId} monthsBack={monthsBack} />
                  <RetentionChart gymId={gymId} monthsBack={monthsBack} />
                </div>
              </FadeIn>
            </div>
          );
          if (tabKey === 'engagement') return (
            <div style={{ paddingTop: 8 }}>
              <FadeIn delay={30}><SectionLabel>{t('admin.analytics.sectionOnboarding', 'Onboarding & Challenges')}</SectionLabel></FadeIn>
              <FadeIn delay={40}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] items-start">
                  <OnboardingFunnel gymId={gymId} />
                  <ChallengeStats gymId={gymId} />
                </div>
              </FadeIn>
              <FadeIn delay={60}><SectionLabel>{t('admin.analytics.sectionActivity', 'Activity')}</SectionLabel></FadeIn>
              <FadeIn delay={70}><ActivityChart gymId={gymId} monthsBack={monthsBack} /></FadeIn>
            </div>
          );
          if (tabKey === 'retention') return (
            <div style={{ paddingTop: 8 }}>
              <FadeIn delay={30}><SectionLabel>{t('admin.analytics.sectionWhyLeft', 'Why members leave')}</SectionLabel></FadeIn>
              <FadeIn delay={40}><WhyLeftPanel gymId={gymId} /></FadeIn>
              <FadeIn delay={60}><SectionLabel>{t('admin.analytics.sectionEffectiveness', 'Retention machine effectiveness')}</SectionLabel></FadeIn>
              <FadeIn delay={70}><RetentionEffectivenessPanel gymId={gymId} /></FadeIn>
            </div>
          );
          if (tabKey === 'deep-dives') return (
            <div style={{ paddingTop: 8 }}>
              <FadeIn delay={30}><SectionLabel>{t('admin.analytics.sectionCohortRetention', 'Cohort Retention')}</SectionLabel></FadeIn>
              <FadeIn delay={40}><CohortTable gymId={gymId} monthsBack={monthsBack} /></FadeIn>
              <FadeIn delay={60}><SectionLabel>{t('admin.analytics.sectionTrainerPerformance', 'Trainer Performance')}</SectionLabel></FadeIn>
              <FadeIn delay={70}><TrainerPerformance gymId={gymId} /></FadeIn>
              <FadeIn delay={90}><SectionLabel>{t('admin.analytics.sectionMonthlySummary', 'Monthly Summary')}</SectionLabel></FadeIn>
              <FadeIn delay={100}><MonthlySummary gymId={gymId} /></FadeIn>
            </div>
          );
          return null;
        }}
      </SwipeableTabContent>
    </AdminPageShell>
  );
}

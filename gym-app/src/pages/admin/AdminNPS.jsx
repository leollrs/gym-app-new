import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { broadcastNotification } from '../../lib/notifications';
import { AdminPageShell, FadeIn, CardSkeleton } from '../../components/admin';
import { PERIODS, npsColor, npsGaugePercent } from '../../lib/admin/npsHelpers';
import { SurveyManagerModal } from './components/NpsSurveyModals';
import { TK, FK, TONE, Ico, Card, PrimaryBtn } from './components/retosKit';

// page-local icon paths (from the Opinión de Miembros design)
const OIC = {
  send: <path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z" />,
  bars: <><path d="M3 21h18" /><rect x="5" y="11" width="3.5" height="7" rx="1" /><rect x="10.5" y="6" width="3.5" height="12" rx="1" /><rect x="16" y="13" width="3.5" height="5" rx="1" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  up: <><path d="M7 10v11M14 4l-1 6h6.5a1.5 1.5 0 0 1 1.5 1.8l-1.4 8A2 2 0 0 1 17 21H7V10l3.5-7A2.2 2.2 0 0 1 14 4Z" /></>,
  down: <><path d="M17 14V3M10 20l1-6H4.5a1.5 1.5 0 0 1-1.5-1.8l1.4-8A2 2 0 0 1 7 3h10v11l-3.5 7A2.2 2.2 0 0 1 10 20Z" /></>,
  minus: <path d="M5 12h14" />,
  chevU: <path d="m6 15 6-6 6 6" />,
  chevD: <path d="m6 9 6 6 6-6" />,
  chevL: <path d="m15 6-6 6 6 6" />,
  chevR: <path d="m9 6 6 6-6 6" />,
};

// score → semantic tone (aligned with promoter/passive/detractor bucketing)
const scoreTone = (score) => (score >= 4 ? 'good' : score === 3 ? 'warn' : 'hot');
const scoreColorVar = (score) => (score >= 4 ? 'var(--color-success)' : score === 3 ? 'var(--color-warning)' : 'var(--color-danger)');

// NPS gradient gauge with marker
function NpsGauge({ score = 0 }) {
  const pct = npsGaugePercent(score);
  return (
    <div style={{ maxWidth: 280 }}>
      <div style={{ position: 'relative', height: 10, borderRadius: 99, background: 'linear-gradient(90deg, var(--color-danger), var(--color-warning), var(--color-success))' }}>
        <span style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%,-50%)', width: 18, height: 18, borderRadius: 99, background: '#fff', border: `3px solid ${TK.text}`, boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontFamily: FK.mono, fontSize: 12, color: TK.textFaint }}>
        <span>-100</span><span>0</span><span>+100</span>
      </div>
    </div>
  );
}

// promoter/passive/detractor legend item
function NpsLeg({ icon, color, count, pct, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${color} 14%, transparent)`, flexShrink: 0 }}>
        <Ico ch={icon} size={16} color={color} stroke={2} />
      </span>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, color: TK.text }}>{count}</span>
          <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint }}>({pct}%)</span>
        </div>
        <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 1 }}>{label}</div>
      </div>
    </div>
  );
}

// vertical score distribution bars (1..5)
function ScoreDist({ data }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const colFor = (i) => (i <= 1 ? 'var(--color-danger)' : i === 2 ? 'var(--color-warning)' : 'var(--color-success)');
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, height: 240, padding: '20px 6px 0' }}>
      {data.map((d, i) => {
        const c = colFor(i);
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, height: '100%', justifyContent: 'flex-end' }}>
            <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: d.value > 0 ? TK.text : TK.textFaint }}>{d.value}</span>
            <div style={{ width: '78%', maxWidth: 120, height: `${Math.max(1.5, (d.value / max) * 100)}%`, borderRadius: '8px 8px 3px 3px', background: d.value > 0 ? `linear-gradient(180deg, ${c}, color-mix(in srgb, ${c} 78%, transparent))` : TK.surface3, minHeight: 5, boxShadow: d.value > 0 ? `0 2px 10px color-mix(in srgb, ${c} 25%, transparent)` : 'none' }} />
            <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.textMute }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const OpLabel = ({ icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '26px 0 14px' }}>
    {icon && <Ico ch={icon} size={15} color={TK.textMute} stroke={2} />}
    <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase', color: TK.textFaint }}>{children}</span>
  </div>
);

export default function AdminNPS() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  // Period shared across Insights pages — see InsightsRangeContext.
  const { periodDays: ctxPeriodDays, setPeriodDays } = useInsightsRange();
  const NPS_DAY_VALUES = PERIODS.map((p) => p.days);
  const days = NPS_DAY_VALUES.includes(ctxPeriodDays) ? ctxPeriodDays : 30;
  const setDays = (next) => setPeriodDays(next);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const openSurvey = (preset) => { setQuestion(preset || ''); setSurveyOpen(true); };

  useEffect(() => {
    document.title = t('admin.nps.pageTitle', 'Member Feedback | Admin');
  }, [t]);

  const statsKey = ['admin', 'nps', gymId, 'stats', days];
  const responsesKey = ['admin', 'nps', gymId, 'responses', days];

  const { data: stats } = useQuery({
    queryKey: statsKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_nps_stats', { p_gym_id: gymId, p_days: days });
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
      const { error } = await supabase.from('nps_surveys').update({ is_active: false }).eq('id', surveyId).eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      showToast(t('admin.nps.surveyDeactivated', 'Encuesta desactivada'), 'success');
      setSurveyOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => showToast(err.message || t('admin.nps.deactivateFailed', 'No se pudo desactivar'), 'error'),
  });

  const updateSurvey = useMutation({
    mutationFn: async ({ id, title }) => {
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) throw new Error(t('admin.nps.titleRequired', 'La pregunta no puede estar vacía'));
      const { error } = await supabase.from('nps_surveys').update({ title: cleanTitle }).eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      showToast(t('admin.nps.surveyUpdated', 'Encuesta actualizada'), 'success');
      setSurveyOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => showToast(err.message || t('admin.nps.updateFailed', 'No se pudo guardar'), 'error'),
  });

  const sendSurvey = useMutation({
    mutationFn: async (title) => {
      const q = (title || '').trim();
      await supabase.from('nps_surveys').update({ is_active: false }).eq('gym_id', gymId).eq('is_active', true);
      const { error: insertError } = await supabase
        .from('nps_surveys')
        .insert({ gym_id: gymId, is_active: true, created_by: profile.id, ...(q ? { title: q } : {}) });
      if (insertError) throw insertError;
      // Best-effort member nudge — the survey row is already committed above, so a
      // notification failure (e.g. notification_type enum missing 'nps_survey'
      // before migration 0515 is applied, or push errors) must NOT fail the send.
      try {
        await broadcastNotification({
          gymId,
          type: 'nps_survey',
          title: q || t('admin.nps.surveyNotifTitle', 'How likely are you to recommend us?'),
          body: t('admin.nps.surveyNotifBody', 'Take a quick 1-question survey and help us improve!'),
        });
      } catch (notifyErr) {
        console.warn('NPS survey notification failed (survey still created):', notifyErr);
      }
    },
    onSuccess: () => {
      showToast(t('admin.nps.surveySent', 'Survey sent to all members'), 'success');
      setSurveyOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'nps', gymId] });
    },
    onError: (err) => showToast(err.message || t('admin.nps.sendFailed', 'Failed to send survey'), 'error'),
  });

  // Client-side 1-5 bucketing (correct regardless of which get_nps_stats RPC is deployed).
  const computed = useMemo(() => {
    const dist = [0, 0, 0, 0, 0];
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
  const totalResponses = computed.total;
  const responseRate = stats?.response_rate ?? 0;
  const promoters = computed.promoters;
  const passives = computed.passives;
  const detractors = computed.detractors;
  const distribution = computed.dist;

  const feedbackResponses = useMemo(
    () => (responses || []).filter((r) => {
      if (!r.feedback?.trim()) return false;
      const s = Number(r.score);
      return Number.isFinite(s) && s >= 1 && s <= 5;
    }),
    [responses],
  );

  const total = promoters + passives + detractors || 1;
  const promoterPct = Math.round((promoters / total) * 100);
  const passivePct = Math.round((passives / total) * 100);
  const detractorPct = Math.round((detractors / total) * 100);

  const validResponses = useMemo(
    () => (responses || []).filter(r => {
      const s = Number(r.score);
      return Number.isFinite(s) && s >= 1 && s <= 5;
    }),
    [responses],
  );

  // ── recent responses: paginated month → year collapsible timeline ──
  const RESP_PAGE_SIZE = 20;
  const [respPage, setRespPage] = useState(0);
  useEffect(() => { setRespPage(0); }, [days]);
  const respPageCount = Math.max(1, Math.ceil(validResponses.length / RESP_PAGE_SIZE));
  const rp = Math.min(respPage, respPageCount - 1);
  const pageSlice = useMemo(() => validResponses.slice(rp * RESP_PAGE_SIZE, rp * RESP_PAGE_SIZE + RESP_PAGE_SIZE), [validResponses, rp]);

  const lang = isEs ? 'es' : 'en';
  const curY = new Date().getFullYear();
  const [openYears, setOpenYears] = useState(() => new Set([new Date().getFullYear()]));
  const [openMonths, setOpenMonths] = useState(() => new Set([`${new Date().getFullYear()}-${new Date().getMonth()}`]));
  const toggleYear = (y) => setOpenYears(s => { const n = new Set(s); n.has(y) ? n.delete(y) : n.add(y); return n; });
  const toggleMonth = (k) => setOpenMonths(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // seed the top group of each page open when the page changes
  useEffect(() => {
    const first = pageSlice[0];
    if (!first) return;
    const d = new Date(first.created_at);
    const y = d.getFullYear(), m = d.getMonth();
    setOpenYears(s => new Set(s).add(y));
    setOpenMonths(s => new Set(s).add(`${y}-${m}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp]);

  const respGroups = useMemo(() => {
    const byYear = new Map();
    pageSlice.forEach(e => {
      const d = new Date(e.created_at);
      const y = d.getFullYear(), m = d.getMonth();
      if (!byYear.has(y)) byYear.set(y, new Map());
      const months = byYear.get(y);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(e);
    });
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, months]) => ({
      year,
      count: [...months.values()].reduce((n, a) => n + a.length, 0),
      months: [...months.entries()].sort((a, b) => b[0] - a[0]).map(([month, items]) => ({ month, items })),
    }));
  }, [pageSlice]);

  const monthName = (y, m) => { const s = new Date(y, m, 1).toLocaleDateString(lang, { month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const respItems = [];
  respGroups.forEach(yg => {
    const isCurrentYear = yg.year === curY;
    const yearOpen = isCurrentYear || openYears.has(yg.year);
    if (!isCurrentYear) respItems.push({ kind: 'year', year: yg.year, count: yg.count, open: yearOpen });
    if (yearOpen) {
      yg.months.forEach(mg => {
        const key = `${yg.year}-${mg.month}`;
        const monthOpen = openMonths.has(key);
        respItems.push({ kind: 'month', key, name: monthName(yg.year, mg.month), count: mg.items.length, open: monthOpen, nested: !isCurrentYear });
        if (monthOpen) mg.items.forEach(entry => respItems.push({ kind: 'row', entry, nested: !isCurrentYear }));
      });
    }
  });

  const renderRespRow = (r, topBorder, nested) => {
    const name = r.profiles?.full_name || t('admin.nps.member', 'Member');
    const c = TONE[scoreTone(r.score)];
    return (
      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: `16px 22px 16px ${nested ? 40 : 22}px`, borderTop: topBorder ? `1px solid ${TK.divider}` : 'none' }}>
        <span style={{ width: 36, height: 36, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, color: TK.textSub, fontFamily: FK.display, fontSize: 14, fontWeight: 800 }}>{name.charAt(0).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          {r.feedback && <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.feedback}</div>}
          <div style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, marginTop: 2 }}>{formatDistanceToNow(new Date(r.created_at), { addSuffix: true, ...dateFnsLocale })}</div>
        </div>
        <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: c.bg, border: `1px solid ${c.line}`, fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: c.ink }}>{r.score}</span>
      </div>
    );
  };

  const pagerBtn = (disabled) => ({ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', cursor: disabled ? 'default' : 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, opacity: disabled ? 0.4 : 1 });

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.nps.title', 'Member Feedback')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.nps.subtitle', 'NPS surveys and satisfaction tracking')}</div>
        </div>
        <PrimaryBtn icon={OIC.send} onClick={() => openSurvey(activeSurveys[0]?.title)}>{t('admin.nps.sendSurvey', 'Send Survey')}</PrimaryBtn>
      </div>

      {/* active survey banner */}
      {activeSurveys.length > 0 && (
        <FadeIn>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 20, padding: '14px 20px', borderRadius: 14, background: TK.accentWash, border: `1px solid ${TK.accentLine}` }}>
            <Ico ch={OIC.send} size={17} color={TK.accent} stroke={2} />
            <span style={{ flex: 1, minWidth: 0, fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.accentInk }}>
              {t('admin.nps.activeSurveysBanner', { count: activeSurveys.length, defaultValue: '{{count}} survey(s) active' })}
            </span>
            <button type="button" onClick={() => openSurvey(activeSurveys[0]?.title)}
              style={{ padding: '8px 16px', borderRadius: 999, cursor: 'pointer', border: 'none', background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
              {t('admin.nps.manage', 'Manage')}
            </button>
          </div>
        </FadeIn>
      )}

      {/* range pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
        {PERIODS.map((p) => {
          const on = days === p.days;
          return (
            <button key={p.labelKey} type="button" onClick={() => setDays(p.days)}
              style={{ padding: '9px 17px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : TK.surface, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, whiteSpace: 'nowrap' }}>
              {t(`admin.nps.period.${p.labelKey}`, p.labelKey)}
            </button>
          );
        })}
      </div>

      {responsesLoading ? (
        <div style={{ marginTop: 22 }}><CardSkeleton count={4} /></div>
      ) : (
        <>
          {/* NPS hero card */}
          <FadeIn delay={40}>
            <Card style={{ padding: '24px 26px', marginTop: 22 }}>
              <OpLabel icon={OIC.bars}>{t('admin.nps.npsLabel', 'Net Promoter Score')}</OpLabel>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between" style={{ gap: 24 }}>
                <div>
                  <div style={{ fontFamily: FK.display, fontSize: 60, fontWeight: 900, letterSpacing: -3, lineHeight: 0.9, color: npsColor(nps) }}>{nps > 0 ? '+' : ''}{nps}</div>
                  <div style={{ marginTop: 16 }}><NpsGauge score={nps} /></div>
                </div>
                <div style={{ display: 'flex', gap: 42, paddingTop: 8 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: FK.display, fontSize: 32, fontWeight: 800, color: TK.text, letterSpacing: -1 }}>{totalResponses}</div>
                    <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.textFaint, marginTop: 4 }}>{t('admin.nps.responses', 'Responses')}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: FK.display, fontSize: 32, fontWeight: 800, color: TK.text, letterSpacing: -1 }}>{responseRate}%</div>
                    <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.textFaint, marginTop: 4 }}>{t('admin.nps.responseRate', 'Response rate')}</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 20, marginTop: 22, paddingTop: 20, borderTop: `1px solid ${TK.divider}` }}>
                <NpsLeg icon={OIC.up} color="var(--color-success)" count={promoters} pct={promoterPct} label={t('admin.nps.promotersShort', 'Promoters')} />
                <NpsLeg icon={OIC.minus} color={TK.textMute} count={passives} pct={passivePct} label={t('admin.nps.passivesShort', 'Passives')} />
                <NpsLeg icon={OIC.down} color="var(--color-danger)" count={detractors} pct={detractorPct} label={t('admin.nps.detractorsShort', 'Detractors')} />
              </div>
            </Card>
          </FadeIn>

          {/* Feedback highlights */}
          {feedbackResponses.length > 0 && (
            <FadeIn delay={60}>
              <OpLabel icon={OIC.chat}>{t('admin.nps.feedbackHighlights', 'Feedback Highlights')}</OpLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
                {feedbackResponses.slice(0, 10).map((r) => {
                  const name = r.profiles?.full_name || t('admin.nps.member', 'Member');
                  return (
                    <Card key={r.id} style={{ padding: '18px 22px', position: 'relative', overflow: 'hidden' }}>
                      <span style={{ position: 'absolute', left: 0, top: 16, bottom: 16, width: 3.5, borderRadius: 99, background: scoreColorVar(r.score) }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 999, background: TONE[scoreTone(r.score)].bg, border: `1px solid ${TONE[scoreTone(r.score)].line}`, fontFamily: FK.display, fontSize: 13, fontWeight: 800, color: TONE[scoreTone(r.score)].ink }}>{r.score}/5</span>
                        <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint }}>{formatDistanceToNow(new Date(r.created_at), { addSuffix: true, ...dateFnsLocale })}</span>
                      </div>
                      <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 700, fontStyle: 'italic', color: TK.text, margin: '12px 0 8px', letterSpacing: -0.3, lineHeight: 1.35 }}>&ldquo;{r.feedback}&rdquo;</div>
                      <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>— {name}</div>
                    </Card>
                  );
                })}
              </div>
            </FadeIn>
          )}

          {/* Score distribution */}
          <FadeIn delay={90}>
            <OpLabel icon={OIC.bars}>{t('admin.nps.distribution', 'Score Distribution')}</OpLabel>
            <Card style={{ padding: '22px 26px', overflowX: 'auto' }}>
              <div style={{ minWidth: 380 }}>
                <ScoreDist data={(Array.isArray(distribution) ? distribution : [0, 0, 0, 0, 0]).slice(0, 5).map((value, i) => ({ label: String(i + 1), value }))} />
              </div>
            </Card>
          </FadeIn>
        </>
      )}

      {/* Recent responses */}
      <OpLabel icon={OIC.clock}>{t('admin.nps.recentResponses', 'Recent Responses')}</OpLabel>
      {responsesLoading ? (
        <CardSkeleton count={3} />
      ) : !validResponses.length ? (
        <Card style={{ padding: '40px 24px', textAlign: 'center' }}>
          <Ico ch={OIC.chat} size={28} color={TK.textFaint} stroke={1.6} style={{ margin: '0 auto 10px' }} />
          <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute, margin: 0 }}>{t('admin.nps.noResponses', 'No responses yet')}</p>
          <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textFaint, margin: '4px 0 16px' }}>{t('admin.nps.sendToCollect', 'Send a survey to start collecting feedback')}</p>
          <div style={{ display: 'inline-flex' }}>
            <PrimaryBtn icon={OIC.send} onClick={() => openSurvey(activeSurveys[0]?.title)}>{t('admin.nps.sendFirstSurvey', 'Send your first survey')}</PrimaryBtn>
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ overflow: 'hidden' }}>
            {respItems.map((it, i) => {
              if (it.kind === 'year') {
                return (
                  <button key={`y-${it.year}`} type="button" onClick={() => toggleYear(it.year)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 22px', background: TK.surface2, border: 'none', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none', cursor: 'pointer' }}>
                    <Ico ch={it.open ? OIC.chevU : OIC.chevD} size={16} color={TK.textMute} stroke={2.2} />
                    <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, letterSpacing: -0.2 }}>{it.year}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint }}>{it.count}</span>
                  </button>
                );
              }
              if (it.kind === 'month') {
                return (
                  <button key={`m-${it.key}`} type="button" onClick={() => toggleMonth(it.key)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: `11px 22px 11px ${it.nested ? 40 : 22}px`, background: 'transparent', border: 'none', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none', cursor: 'pointer' }}>
                    <Ico ch={it.open ? OIC.chevU : OIC.chevD} size={15} color={TK.textMute} stroke={2.2} />
                    <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 800, letterSpacing: 0.3, color: it.open ? TK.text : TK.textSub }}>{it.name}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint }}>{it.count}</span>
                  </button>
                );
              }
              return renderRespRow(it.entry, i > 0, it.nested);
            })}
          </Card>
          {respPageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
              <button type="button" disabled={rp <= 0} onClick={() => setRespPage(rp - 1)} style={pagerBtn(rp <= 0)} aria-label="Previous"><Ico ch={OIC.chevL} size={16} color={TK.textSub} stroke={2.2} /></button>
              <span style={{ fontFamily: FK.mono, fontSize: 12.5, fontWeight: 700, color: TK.textMute }}>{rp + 1} / {respPageCount}</span>
              <button type="button" disabled={rp >= respPageCount - 1} onClick={() => setRespPage(rp + 1)} style={pagerBtn(rp >= respPageCount - 1)} aria-label="Next"><Ico ch={OIC.chevR} size={16} color={TK.textSub} stroke={2.2} /></button>
            </div>
          )}
        </>
      )}

      <SurveyManagerModal
        isOpen={surveyOpen}
        onClose={() => setSurveyOpen(false)}
        activeSurvey={activeSurveys[0] || null}
        question={question}
        setQuestion={setQuestion}
        onSend={(q) => sendSurvey.mutate(q)}
        onSaveQuestion={(q) => { const s = activeSurveys[0]; if (s) updateSurvey.mutate({ id: s.id, title: q }); }}
        onDeactivate={(id) => deactivateSurvey.mutate(id)}
        sending={sendSurvey.isPending}
        saving={updateSurvey.isPending}
        deactivating={deactivateSurvey.isPending}
        dateFnsLocale={dateFnsLocale}
      />
    </AdminPageShell>
  );
}

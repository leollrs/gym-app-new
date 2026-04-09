import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, ChevronLeft, ChevronRight, Dumbbell, Users, TrendingUp, Zap, CalendarCheck, Trophy as TrophyIcon, X, FileText } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import logger from '../../../../lib/logger';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchSummaryData(gymId, summaryMonth) {
  const now = new Date();
  const target = subMonths(now, summaryMonth);
  const mStart = startOfMonth(target).toISOString();
  const mEnd   = endOfMonth(target).toISOString();

  const [dailyStatsRes, challengePartsRes, allMembersRes, sessionsRes] = await Promise.all([
    supabase.from('mv_gym_stats_daily').select('*').eq('gym_id', gymId).gte('stat_date', mStart.slice(0, 10)).lte('stat_date', mEnd.slice(0, 10)),
    supabase.from('challenge_participants').select('id').eq('gym_id', gymId).gte('joined_at', mStart).lte('joined_at', mEnd).limit(2000),
    supabase.from('profiles').select('id, created_at').eq('gym_id', gymId).eq('role', 'member').limit(2000),
    supabase.from('workout_sessions').select('profile_id, duration_seconds').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', mStart).lte('started_at', mEnd).limit(5000),
  ]);
  if (dailyStatsRes.error) logger.error('MonthlySummary: daily stats error:', dailyStatsRes.error);
  if (challengePartsRes.error) logger.error('MonthlySummary: challenge participants error:', challengePartsRes.error);
  if (allMembersRes.error) logger.error('MonthlySummary: all members error:', allMembersRes.error);
  if (sessionsRes.error) logger.error('MonthlySummary: sessions error:', sessionsRes.error);

  const dailyStats = dailyStatsRes.data || [];
  const challengeParts = challengePartsRes.data;
  const allMembers = allMembersRes.data;
  const sessions = sessionsRes.data || [];

  const totalWorkouts = dailyStats.reduce((sum, d) => sum + (d.total_sessions || 0), 0);
  const totalVolume = dailyStats.reduce((sum, d) => sum + (parseFloat(d.total_volume_lbs) || 0), 0);
  const totalCheckIns = dailyStats.reduce((sum, d) => sum + (d.total_check_ins || 0), 0);
  const newMemberCount = dailyStats.reduce((sum, d) => sum + (d.new_members || 0), 0);
  const totalPrs = dailyStats.reduce((sum, d) => sum + (d.new_prs || 0), 0);

  const uniqueActive = new Set(sessions.map(s => s.profile_id)).size;
  const totalDuration = sessions.reduce((sum, s) => sum + (Math.round((parseFloat(s.duration_seconds) || 0) / 60)), 0);
  const avgWorkoutsPerActive = uniqueActive > 0 ? (totalWorkouts / uniqueActive).toFixed(1) : '0';
  const totalMembersAtEnd = (allMembers || []).filter(m => new Date(m.created_at) <= new Date(mEnd)).length;
  const activeRate = totalMembersAtEnd > 0 ? Math.round((uniqueActive / totalMembersAtEnd) * 100) : 0;

  return {
    label: format(target, 'MMMM yyyy'),
    newMembers: newMemberCount,
    totalWorkouts,
    uniqueActive,
    totalVolume: Math.round(totalVolume),
    totalDuration: Math.round(totalDuration),
    avgWorkoutsPerActive,
    checkIns: totalCheckIns,
    prs: totalPrs,
    challengeJoins: (challengeParts || []).length,
    totalMembers: totalMembersAtEnd,
    activeRate,
  };
}

// Muted, cohesive stat colors
const STAT_COLORS = {
  gold:    '#C9A84C',
  emerald: '#34D399',
  blue:    '#7B9EFF',
  amber:   '#F0C050',
  violet:  '#9B8AFB',
  rose:    '#F87171',
  teal:    '#5EEAD4',
};

export default function MonthlySummary({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [summaryMonth, setSummaryMonth] = useState(0);
  const [showReport, setShowReport] = useState(false);

  const { data: summary, isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.summary(gymId, summaryMonth),
    queryFn: () => fetchSummaryData(gymId, summaryMonth),
    enabled: !!gymId,
  });

  const handleDownloadReport = () => {
    if (!summary) return;
    const s = summary;
    const fmtVol = s.totalVolume >= 1_000_000 ? `${(s.totalVolume / 1_000_000).toFixed(1)}M` : s.totalVolume >= 1_000 ? `${(s.totalVolume / 1_000).toFixed(1)}K` : s.totalVolume.toLocaleString();
    const fmtTime = s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)}h ${s.totalDuration % 60}min` : `${s.totalDuration} min`;
    const generated = format(new Date(), isEs ? 'd MMMM yyyy' : 'MMMM d, yyyy', dateFnsLocale);

    const esc = (v) => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    const L = {
      title: isEs ? 'Reporte de Rendimiento Mensual' : 'Monthly Performance Report',
      generated: isEs ? 'Generado' : 'Generated',
      totalMembers: isEs ? 'Miembros Totales' : 'Total Members',
      activeMembers: isEs ? 'Miembros Activos' : 'Active Members',
      newMembers: isEs ? 'Nuevos Miembros' : 'New Members',
      checkIns: isEs ? 'Check-ins' : 'Gym Check-ins',
      ofTotal: isEs ? 'del total' : 'of total',
      training: isEs ? 'Actividad de Entrenamiento' : 'Training Activity',
      metric: isEs ? 'Métrica' : 'Metric',
      value: isEs ? 'Valor' : 'Value',
      workouts: isEs ? 'Entrenos Completados' : 'Workouts Completed',
      avgPerActive: isEs ? 'Promedio por Miembro Activo' : 'Avg per Active Member',
      totalVolume: isEs ? 'Volumen Total Levantado' : 'Total Volume Lifted',
      totalTime: isEs ? 'Tiempo Total de Entreno' : 'Total Training Time',
      prs: isEs ? 'Récords Personales' : 'Personal Records Hit',
      engagement: isEs ? 'Compromiso' : 'Engagement',
      activeRate: isEs ? 'Tasa de Actividad' : 'Active Rate',
      challengeParts: isEs ? 'Participaciones en Retos' : 'Challenge Participations',
      highlights: isEs ? 'Resumen' : 'Key Highlights',
      confidential: isEs ? 'Confidencial — Solo para uso interno' : 'Confidential — For internal use only',
    };

    const highlightText = isEs
      ? `${esc(s.uniqueActive)} de ${esc(s.totalMembers)} miembros estuvieron activos este mes (${esc(s.activeRate)}% tasa de actividad). Completaron ${esc(s.totalWorkouts.toLocaleString())} entrenos con un volumen total de ${esc(fmtVol)} lbs y ${esc(fmtTime)} de entrenamiento. Se establecieron ${esc(s.prs)} récords personales y se unieron ${esc(s.newMembers)} miembro${s.newMembers !== 1 ? 's' : ''} nuevo${s.newMembers !== 1 ? 's' : ''}.`
      : `${esc(s.uniqueActive)} of ${esc(s.totalMembers)} members were active this month (${esc(s.activeRate)}% active rate). Members completed ${esc(s.totalWorkouts.toLocaleString())} workouts totaling ${esc(fmtVol)} lbs of volume and ${esc(fmtTime)} of training. ${esc(s.prs)} personal record${s.prs !== 1 ? 's were' : ' was'} set and ${esc(s.newMembers)} new member${s.newMembers !== 1 ? 's' : ''} joined.`;

    const html = `<!DOCTYPE html><html lang="${isEs ? 'es' : 'en'}"><head><meta charset="utf-8"><title>${esc(L.title)} — ${esc(s.label)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#0f172a;background:#fff;padding:48px;max-width:820px;margin:0 auto}
.header{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:3px solid #D4AF37;padding-bottom:20px;margin-bottom:36px}
.header h1{font-size:26px;font-weight:800;color:#0A0D14;letter-spacing:-0.5px}
.header .period{font-size:15px;color:#334155;margin-top:4px;font-weight:600}
.header .meta{text-align:right;font-size:11px;color:#94a3b8;line-height:1.6}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:36px}
.kpi{border:1.5px solid #e2e8f0;border-radius:12px;padding:18px 16px;text-align:center;background:#fafbfc}
.kpi .value{font-size:32px;font-weight:800;color:#0f172a;line-height:1}
.kpi .label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-top:6px;font-weight:600}
.kpi .sub{font-size:10px;color:#94a3b8;margin-top:3px}
.kpi.gold{background:linear-gradient(135deg,#fffbeb,#fef3c7);border-color:#D4AF37}
.kpi.gold .value{color:#78350f}
.section{margin-bottom:30px}
.section h2{font-size:14px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:14px;padding-bottom:8px;border-bottom:1.5px solid #e2e8f0}
table{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
table th{text-align:left;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;padding:10px 16px;background:#f1f5f9;font-weight:600}
table th:last-child{text-align:right}
table td{padding:11px 16px;font-size:13px;color:#1e293b;border-top:1px solid #f1f5f9}
table td:last-child{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:#0f172a}
table tr:nth-child(even){background:#f8fafc}
.callout{background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1.5px solid #86efac;border-radius:10px;padding:16px 20px;margin-top:28px}
.callout h3{font-size:12px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.callout p{font-size:12px;color:#166534;line-height:1.7}
.footer{margin-top:44px;padding-top:14px;border-top:1.5px solid #e2e8f0;text-align:center;font-size:9px;color:#94a3b8;letter-spacing:0.3px}
@media print{body{padding:32px 40px}@page{size:letter;margin:0.6in}}
</style></head><body>

<div class="header">
  <div>
    <h1>${esc(L.title)}</h1>
    <div class="period">${esc(s.label)}</div>
  </div>
  <div class="meta">${esc(L.generated)} ${esc(generated)}</div>
</div>

<div class="kpi-row">
  <div class="kpi gold"><div class="value">${esc(s.totalMembers)}</div><div class="label">${esc(L.totalMembers)}</div></div>
  <div class="kpi"><div class="value">${esc(s.uniqueActive)}</div><div class="label">${esc(L.activeMembers)}</div><div class="sub">${esc(s.activeRate)}% ${esc(L.ofTotal)}</div></div>
  <div class="kpi"><div class="value">${esc(s.newMembers)}</div><div class="label">${esc(L.newMembers)}</div></div>
  <div class="kpi"><div class="value">${esc(s.checkIns.toLocaleString())}</div><div class="label">${esc(L.checkIns)}</div></div>
</div>

<div class="section">
  <h2>${esc(L.training)}</h2>
  <table>
    <thead><tr><th>${esc(L.metric)}</th><th>${esc(L.value)}</th></tr></thead>
    <tbody>
      <tr><td>${esc(L.workouts)}</td><td>${esc(s.totalWorkouts.toLocaleString())}</td></tr>
      <tr><td>${esc(L.avgPerActive)}</td><td>${esc(s.avgWorkoutsPerActive)}</td></tr>
      <tr><td>${esc(L.totalVolume)}</td><td>${esc(fmtVol)} lbs</td></tr>
      <tr><td>${esc(L.totalTime)}</td><td>${esc(fmtTime)}</td></tr>
      <tr><td>${esc(L.prs)}</td><td>${esc(s.prs)}</td></tr>
    </tbody>
  </table>
</div>

<div class="section">
  <h2>${esc(L.engagement)}</h2>
  <table>
    <thead><tr><th>${esc(L.metric)}</th><th>${esc(L.value)}</th></tr></thead>
    <tbody>
      <tr><td>${esc(L.activeRate)}</td><td>${esc(s.activeRate)}%</td></tr>
      <tr><td>${esc(L.challengeParts)}</td><td>${esc(s.challengeJoins)}</td></tr>
      <tr><td>${esc(L.checkIns)}</td><td>${esc(s.checkIns.toLocaleString())}</td></tr>
      <tr><td>${esc(L.prs)}</td><td>${esc(s.prs)}</td></tr>
    </tbody>
  </table>
</div>

<div class="callout">
  <h3>${esc(L.highlights)}</h3>
  <p>${esc(highlightText)}</p>
</div>

<div class="footer">${esc(L.confidential)}</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=860,height=1060');
    w.document.open();
    w.document.close();
    w.document.documentElement.innerHTML = html;
    setTimeout(() => w.print(), 400);
  };

  if (isLoading) return <CardSkeleton h="h-[200px]" />;
  if (isError) return <ErrorCard message={t('admin.analytics.summaryError', 'Failed to load summary data')} onRetry={refetch} />;
  if (!summary) return null;

  const s = summary;

  return (
    <>
      <AdminCard hover className="mb-6 hover:border-white/10 transition-colors duration-300">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight truncate">{t('admin.analytics.summaryTitle', 'Monthly Summary')}</p>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed truncate">{t('admin.analytics.summarySubtitle', 'Key metrics at a glance')}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setSummaryMonth(m => m + 1)}
              className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
              <ChevronLeft size={14} className="text-[var(--color-text-muted)]" />
            </button>
            <span className="text-[12px] md:text-[13px] font-medium text-[var(--color-text-primary)] min-w-[80px] md:min-w-[120px] text-center">{s.label}</span>
            <button onClick={() => setSummaryMonth(m => Math.max(0, m - 1))} disabled={summaryMonth === 0}
              className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30">
              <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
            </button>
            <button
              onClick={() => setShowReport(true)}
              className="ml-2 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium bg-[var(--color-accent)]/12 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors whitespace-nowrap"
            >
              <FileText size={13} />
              {t('admin.analytics.generateReport', 'Generate Report')}
            </button>
          </div>
        </div>

        {/* Headline metric row */}
        <div className="flex items-baseline gap-3 mb-5">
          <span className="text-[28px] font-bold text-[var(--color-accent)] leading-none tracking-tight">{s.activeRate}%</span>
          <span className="text-[12px] text-[var(--color-text-muted)]">{t('admin.analytics.summaryActiveRate', { active: s.uniqueActive, total: s.totalMembers, defaultValue: 'active rate — {{active}} of {{total}} members' })}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Dumbbell, label: t('admin.analytics.summaryWorkouts', 'Workouts'), value: s.totalWorkouts.toLocaleString(), sub: t('admin.analytics.summaryPerActiveMember', { value: s.avgWorkoutsPerActive, defaultValue: '{{value}}/active member' }), color: STAT_COLORS.gold },
            { icon: Users, label: t('admin.analytics.summaryActiveMembers', 'Active Members'), value: s.uniqueActive, sub: t('admin.analytics.summaryOfTotal', { pct: s.activeRate, total: s.totalMembers, defaultValue: '{{pct}}% of {{total}}' }), color: STAT_COLORS.emerald },
            { icon: TrendingUp, label: t('admin.analytics.summaryNewMembers', 'New Members'), value: s.newMembers, sub: t('admin.analytics.summaryJoinedThisMonth', 'joined this month'), color: STAT_COLORS.blue },
            { icon: Zap, label: t('admin.analytics.summaryTotalVolume', 'Total Volume'), value: s.totalVolume >= 1000000 ? `${(s.totalVolume / 1000000).toFixed(1)}M` : s.totalVolume >= 1000 ? `${(s.totalVolume / 1000).toFixed(1)}K` : s.totalVolume.toLocaleString(), sub: t('admin.analytics.summaryLbsLifted', 'lbs lifted'), color: STAT_COLORS.amber },
            { icon: CalendarCheck, label: t('admin.analytics.summaryCheckins', 'Check-ins'), value: s.checkIns.toLocaleString(), sub: t('admin.analytics.summaryGymVisits', 'gym visits'), color: STAT_COLORS.violet },
            { icon: TrophyIcon, label: t('admin.analytics.summaryPRsHit', 'PRs Hit'), value: s.prs, sub: t('admin.analytics.summaryPersonalRecords', 'personal records'), color: STAT_COLORS.rose },
            { icon: TrophyIcon, label: t('admin.analytics.summaryChallengeJoins', 'Challenge Joins'), value: s.challengeJoins, sub: t('admin.analytics.summaryNewParticipants', 'new participants'), color: STAT_COLORS.gold },
            { icon: Dumbbell, label: t('admin.analytics.summaryTotalTime', 'Total Time'), value: s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)}h` : `${s.totalDuration}m`, sub: t('admin.analytics.summaryTrainingTime', 'training time'), color: STAT_COLORS.teal },
          ].map((stat, i) => (
            <div key={i} className="bg-[var(--color-bg-elevated,var(--color-bg-card))] rounded-xl p-3.5 border border-white/[0.04] overflow-hidden transition-colors hover:border-white/[0.08]">
              <div className="flex items-center gap-2 mb-2.5">
                <stat.icon size={13} style={{ color: stat.color }} className="flex-shrink-0 opacity-80" />
                <span className="text-[10px] text-[var(--color-text-muted)] font-semibold uppercase tracking-wider truncate">{stat.label}</span>
              </div>
              <p className="text-[20px] font-bold text-[var(--color-text-primary)] leading-none tabular-nums truncate">{stat.value}</p>
              <p className="text-[10px] text-[var(--color-text-subtle)] mt-1.5 truncate">{stat.sub}</p>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Monthly Report Modal */}
      {showReport && (() => {
        const fmtVol = s.totalVolume >= 1_000_000 ? `${(s.totalVolume / 1_000_000).toFixed(1)}M` : s.totalVolume >= 1_000 ? `${(s.totalVolume / 1_000).toFixed(1)}K` : s.totalVolume.toLocaleString();
        const fmtTime = s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)} hours` : `${s.totalDuration} min`;
        return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4" onClick={() => setShowReport(false)}>
          <div className="w-full max-w-2xl md:max-w-3xl my-4 md:my-10" onClick={e => e.stopPropagation()}>

            <div className="bg-[#fafbfc] rounded-2xl overflow-hidden shadow-2xl">

              {/* Report header */}
              <div className="bg-gradient-to-r from-[#D4AF37] to-[#B8941F] px-6 py-5 flex items-start justify-between">
                <div>
                  <h2 className="text-[18px] font-extrabold text-[#0A0D14] tracking-tight truncate">{t('admin.analytics.reportTitle', 'Monthly Performance Report')}</h2>
                  <p className="text-[13px] text-[#0A0D14]/70 mt-0.5">{s.label}</p>
                </div>
                <button onClick={() => setShowReport(false)} className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 transition-colors mt-0.5">
                  <X size={16} className="text-[#0A0D14]" />
                </button>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border-b border-[#e2e8f0]">
                {[
                  { label: t('admin.analytics.reportTotalMembers', 'Total Members'), value: s.totalMembers, accent: false },
                  { label: t('admin.analytics.reportActiveMembers', 'Active Members'), value: s.uniqueActive, sub: t('admin.analytics.reportActiveOf', { pct: s.activeRate, defaultValue: '{{pct}}% active' }), accent: true },
                  { label: t('admin.analytics.reportNewMembers', 'New Members'), value: s.newMembers, accent: false },
                  { label: t('admin.analytics.reportGymCheckins', 'Gym Check-ins'), value: s.checkIns.toLocaleString(), accent: false },
                ].map((k, i) => (
                  <div key={i} className={`px-4 md:px-5 py-3 md:py-4 text-center ${i < 3 ? 'sm:border-r border-[#e2e8f0]' : ''} ${i < 2 ? 'border-b sm:border-b-0 border-[#e2e8f0]' : ''} ${k.accent ? 'bg-[#fefce8]' : ''}`}>
                    <p className="text-[20px] md:text-[24px] font-extrabold text-[#0f172a] leading-none tabular-nums truncate">{k.value}</p>
                    <p className="text-[10px] text-[#64748b] uppercase tracking-wider font-semibold mt-1.5 truncate">{k.label}</p>
                    {k.sub && <p className="text-[10px] text-[#92700c] font-medium mt-0.5">{k.sub}</p>}
                  </div>
                ))}
              </div>

              <div className="px-6 py-5 space-y-5">

                {/* Training Activity table */}
                <div>
                  <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Dumbbell size={14} className="text-[#D4AF37]" />
                    {t('admin.analytics.reportTrainingActivity', 'Training Activity')}
                  </h3>
                  <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#f1f5f9]">
                          <th className="text-left text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">{t('admin.analytics.reportMetric', 'Metric')}</th>
                          <th className="text-right text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">{t('admin.analytics.reportValue', 'Value')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          [t('admin.analytics.reportWorkoutsCompleted', 'Workouts Completed'), s.totalWorkouts.toLocaleString()],
                          [t('admin.analytics.reportAvgPerActive', 'Avg per Active Member'), s.avgWorkoutsPerActive],
                          [t('admin.analytics.reportTotalVolume', 'Total Volume Lifted'), `${fmtVol} lbs`],
                          [t('admin.analytics.reportTotalTime', 'Total Training Time'), fmtTime],
                          [t('admin.analytics.reportPRsHit', 'Personal Records Hit'), s.prs],
                        ].map(([label, val], i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                            <td className="px-4 py-2.5 text-[12px] text-[#334155]">{label}</td>
                            <td className="px-4 py-2.5 text-[12px] text-[#0f172a] font-semibold text-right tabular-nums">{val}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Engagement table */}
                <div>
                  <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <TrendingUp size={14} className="text-[#D4AF37]" />
                    {t('admin.analytics.reportEngagement', 'Engagement')}
                  </h3>
                  <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#f1f5f9]">
                          <th className="text-left text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">{t('admin.analytics.reportMetric', 'Metric')}</th>
                          <th className="text-right text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">{t('admin.analytics.reportValue', 'Value')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          [t('admin.analytics.reportActiveRate', 'Active Rate'), `${s.activeRate}%`],
                          [t('admin.analytics.reportChallengeParticipations', 'Challenge Participations'), s.challengeJoins],
                          [t('admin.analytics.reportGymCheckins', 'Gym Check-ins'), s.checkIns.toLocaleString()],
                          [t('admin.analytics.reportPersonalRecords', 'Personal Records'), s.prs],
                        ].map(([label, val], i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                            <td className="px-4 py-2.5 text-[12px] text-[#334155]">{label}</td>
                            <td className="px-4 py-2.5 text-[12px] text-[#0f172a] font-semibold text-right tabular-nums">{val}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Highlights callout */}
                <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-4 py-3.5">
                  <p className="text-[11px] font-semibold text-[#14532d] mb-1">{t('admin.analytics.reportKeyHighlights', 'Key Highlights')}</p>
                  <p className="text-[11px] text-[#166534] leading-relaxed">
                    {isEs
                      ? `${s.uniqueActive} de ${s.totalMembers} miembros estuvieron activos este mes (${s.activeRate}% tasa de actividad). Completaron ${s.totalWorkouts.toLocaleString()} entrenos con un volumen total de ${fmtVol} lbs y ${fmtTime} de entrenamiento. Se establecieron ${s.prs} récords personales y se unieron ${s.newMembers} miembro${s.newMembers !== 1 ? 's' : ''} nuevo${s.newMembers !== 1 ? 's' : ''}.`
                      : `${s.uniqueActive} of ${s.totalMembers} members were active this month (${s.activeRate}% active rate). Members completed ${s.totalWorkouts.toLocaleString()} workouts totaling ${fmtVol} lbs of volume and ${fmtTime} of training. ${s.prs} personal record${s.prs !== 1 ? 's were' : ' was'} set and ${s.newMembers} new member${s.newMembers !== 1 ? 's' : ''} joined.`
                    }
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-[#e2e8f0] bg-[#f8fafc] flex items-center justify-between">
                <p className="text-[10px] text-[#94a3b8]">{t('admin.analytics.reportGenerated', { date: format(new Date(), 'MMMM d, yyyy', dateFnsLocale), defaultValue: 'Generated {{date}}' })} \u2014 {t('admin.analytics.reportConfidential', 'Confidential')}</p>
                <button
                  onClick={handleDownloadReport}
                  className="flex-shrink-0 flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-semibold bg-[#0f172a] text-white hover:bg-[#1e293b] transition-colors whitespace-nowrap"
                >
                  <Download size={14} />
                  {t('admin.analytics.downloadPdf', 'Download PDF')}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}

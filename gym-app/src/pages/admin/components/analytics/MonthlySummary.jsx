import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ChevronLeft, ChevronRight, Dumbbell, Users, TrendingUp, Zap, CalendarCheck, Trophy as TrophyIcon, X, FileText } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
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

export default function MonthlySummary({ gymId }) {
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
    const fmtTime = s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)} hours` : `${s.totalDuration} min`;
    const generated = format(new Date(), 'MMMM d, yyyy');

    const esc = (v) => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Monthly Report \u2013 ${esc(s.label)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;background:#fff;padding:48px 56px;max-width:800px;margin:0 auto}
.header{border-bottom:3px solid #D4AF37;padding-bottom:20px;margin-bottom:32px}
.header h1{font-size:28px;font-weight:800;color:#0A0D14;letter-spacing:-0.5px}
.header .subtitle{font-size:14px;color:#64748b;margin-top:4px}
.header .date{font-size:11px;color:#94a3b8;margin-top:8px}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}
.kpi .value{font-size:28px;font-weight:800;color:#0A0D14}
.kpi .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
.kpi .sub{font-size:10px;color:#94a3b8;margin-top:2px}
.kpi.highlight{background:linear-gradient(135deg,#fefce8,#fef9c3);border-color:#D4AF37}
.kpi.highlight .value{color:#92700c}
.section{margin-bottom:28px}
.section h2{font-size:16px;font-weight:700;color:#0A0D14;margin-bottom:14px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse}
table th{text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;padding:8px 12px;border-bottom:2px solid #e2e8f0}
table td{padding:10px 12px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9}
table td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.insight{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-top:20px}
.insight p{font-size:12px;color:#166534;line-height:1.5}
.insight strong{color:#14532d}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8}
@media print{body{padding:32px 40px}@page{margin:0.5in}}
</style></head><body>
<div class="header">
  <h1>Monthly Performance Report</h1>
  <div class="subtitle">${esc(s.label)}</div>
  <div class="date">Generated ${esc(generated)}</div>
</div>

<div class="kpi-row">
  <div class="kpi highlight"><div class="value">${esc(s.totalMembers)}</div><div class="label">Total Members</div></div>
  <div class="kpi"><div class="value">${esc(s.uniqueActive)}</div><div class="label">Active Members</div><div class="sub">${esc(s.activeRate)}% of total</div></div>
  <div class="kpi"><div class="value">${esc(s.newMembers)}</div><div class="label">New Members</div></div>
  <div class="kpi"><div class="value">${esc(s.checkIns.toLocaleString())}</div><div class="label">Gym Check-ins</div></div>
</div>

<div class="section">
  <h2>Training Activity</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Workouts Completed</td><td>${esc(s.totalWorkouts.toLocaleString())}</td></tr>
      <tr><td>Average per Active Member</td><td>${esc(s.avgWorkoutsPerActive)}</td></tr>
      <tr><td>Total Volume Lifted</td><td>${esc(fmtVol)} lbs</td></tr>
      <tr><td>Total Training Time</td><td>${esc(fmtTime)}</td></tr>
      <tr><td>Personal Records Hit</td><td>${esc(s.prs)}</td></tr>
    </tbody>
  </table>
</div>

<div class="section">
  <h2>Engagement</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Active Rate</td><td>${esc(s.activeRate)}%</td></tr>
      <tr><td>Challenge Participations</td><td>${esc(s.challengeJoins)}</td></tr>
      <tr><td>Check-ins</td><td>${esc(s.checkIns.toLocaleString())}</td></tr>
      <tr><td>Personal Records</td><td>${esc(s.prs)}</td></tr>
    </tbody>
  </table>
</div>

<div class="insight">
  <p><strong>Highlights:</strong> ${esc(s.uniqueActive)} of ${esc(s.totalMembers)} members were active this month (${esc(s.activeRate)}% active rate). Members completed ${esc(s.totalWorkouts.toLocaleString())} workouts totaling ${esc(fmtVol)} lbs of volume and ${esc(fmtTime)} of training. ${esc(s.prs)} personal records were set and ${esc(s.newMembers)} new member${s.newMembers !== 1 ? 's' : ''} joined.</p>
</div>

<div class="footer">Confidential \u2014 For internal use only</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=820,height=1000');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  if (isLoading) return <CardSkeleton h="h-[200px]" />;
  if (isError) return <ErrorCard message="Failed to load summary data" onRetry={refetch} />;
  if (!summary) return null;

  const s = summary;

  return (
    <>
      <AdminCard hover className="mb-6 hover:border-white/10 transition-colors duration-300">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">Monthly Summary</p>
            <p className="text-[11px] text-[#6B7280] truncate">Key metrics at a glance</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setSummaryMonth(m => m + 1)}
              className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
              <ChevronLeft size={14} className="text-[#9CA3AF]" />
            </button>
            <span className="text-[13px] font-medium text-[#E5E7EB] min-w-[120px] text-center">{s.label}</span>
            <button onClick={() => setSummaryMonth(m => Math.max(0, m - 1))} disabled={summaryMonth === 0}
              className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30">
              <ChevronRight size={14} className="text-[#9CA3AF]" />
            </button>
            <button
              onClick={() => setShowReport(true)}
              className="ml-2 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 transition-colors whitespace-nowrap"
            >
              <FileText size={13} />
              Generate Report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { icon: Dumbbell, label: 'Workouts', value: s.totalWorkouts.toLocaleString(), sub: `${s.avgWorkoutsPerActive}/active member`, color: '#D4AF37' },
            { icon: Users, label: 'Active Members', value: s.uniqueActive, sub: `${s.activeRate}% of ${s.totalMembers}`, color: '#10B981' },
            { icon: TrendingUp, label: 'New Members', value: s.newMembers, sub: 'joined this month', color: '#60A5FA' },
            { icon: Zap, label: 'Total Volume', value: s.totalVolume >= 1000000 ? `${(s.totalVolume / 1000000).toFixed(1)}M` : s.totalVolume >= 1000 ? `${(s.totalVolume / 1000).toFixed(1)}K` : s.totalVolume.toLocaleString(), sub: 'lbs lifted', color: '#F59E0B' },
            { icon: CalendarCheck, label: 'Check-ins', value: s.checkIns.toLocaleString(), sub: 'gym visits', color: '#8B5CF6' },
            { icon: TrophyIcon, label: 'PRs Hit', value: s.prs, sub: 'personal records', color: '#EF4444' },
            { icon: TrophyIcon, label: 'Challenge Joins', value: s.challengeJoins, sub: 'new participants', color: '#D4AF37' },
            { icon: Dumbbell, label: 'Total Time', value: s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)}h` : `${s.totalDuration}m`, sub: 'training time', color: '#14B8A6' },
          ].map((stat, i) => (
            <div key={i} className="bg-[#111827] rounded-xl p-3 border border-white/4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon size={13} style={{ color: stat.color }} className="flex-shrink-0" />
                <span className="text-[11px] text-[#6B7280] font-medium truncate">{stat.label}</span>
              </div>
              <p className="text-[20px] font-bold text-[#E5E7EB] leading-none tabular-nums truncate">{stat.value}</p>
              <p className="text-[10px] text-[#4B5563] mt-1 truncate">{stat.sub}</p>
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

            <div className="bg-[#fafbfc] rounded-xl overflow-hidden shadow-2xl">

              {/* Report header */}
              <div className="bg-gradient-to-r from-[#D4AF37] to-[#B8941F] px-6 py-5 flex items-start justify-between">
                <div>
                  <h2 className="text-[18px] font-extrabold text-[#0A0D14] tracking-tight truncate">Monthly Performance Report</h2>
                  <p className="text-[13px] text-[#0A0D14]/70 mt-0.5">{s.label}</p>
                </div>
                <button onClick={() => setShowReport(false)} className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 transition-colors mt-0.5">
                  <X size={16} className="text-[#0A0D14]" />
                </button>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-4 gap-0 border-b border-[#e2e8f0]">
                {[
                  { label: 'Total Members', value: s.totalMembers, accent: false },
                  { label: 'Active Members', value: s.uniqueActive, sub: `${s.activeRate}% active`, accent: true },
                  { label: 'New Members', value: s.newMembers, accent: false },
                  { label: 'Gym Check-ins', value: s.checkIns.toLocaleString(), accent: false },
                ].map((k, i) => (
                  <div key={i} className={`px-5 py-4 text-center ${i < 3 ? 'border-r border-[#e2e8f0]' : ''} ${k.accent ? 'bg-[#fefce8]' : ''}`}>
                    <p className="text-[24px] font-extrabold text-[#0f172a] leading-none tabular-nums truncate">{k.value}</p>
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
                    Training Activity
                  </h3>
                  <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#f1f5f9]">
                          <th className="text-left text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Metric</th>
                          <th className="text-right text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Workouts Completed', s.totalWorkouts.toLocaleString()],
                          ['Avg per Active Member', s.avgWorkoutsPerActive],
                          ['Total Volume Lifted', `${fmtVol} lbs`],
                          ['Total Training Time', fmtTime],
                          ['Personal Records Hit', s.prs],
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
                    Engagement
                  </h3>
                  <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#f1f5f9]">
                          <th className="text-left text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Metric</th>
                          <th className="text-right text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Active Rate', `${s.activeRate}%`],
                          ['Challenge Participations', s.challengeJoins],
                          ['Gym Check-ins', s.checkIns.toLocaleString()],
                          ['Personal Records', s.prs],
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
                  <p className="text-[11px] font-semibold text-[#14532d] mb-1">Key Highlights</p>
                  <p className="text-[11px] text-[#166534] leading-relaxed">
                    {s.uniqueActive} of {s.totalMembers} members were active this month ({s.activeRate}% active rate).
                    Members completed {s.totalWorkouts.toLocaleString()} workouts totaling {fmtVol} lbs of volume
                    and {fmtTime} of training. {s.prs} personal record{s.prs !== 1 ? 's were' : ' was'} set
                    and {s.newMembers} new member{s.newMembers !== 1 ? 's' : ''} joined.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-[#e2e8f0] bg-[#f8fafc] flex items-center justify-between">
                <p className="text-[10px] text-[#94a3b8]">Generated {format(new Date(), 'MMMM d, yyyy')} \u2014 Confidential</p>
                <button
                  onClick={handleDownloadReport}
                  className="flex-shrink-0 flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-semibold bg-[#0f172a] text-white hover:bg-[#1e293b] transition-colors whitespace-nowrap"
                >
                  <Download size={14} />
                  Download PDF
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

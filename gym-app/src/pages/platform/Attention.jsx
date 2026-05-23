/**
 * Attention — the super-admin's daily triage board. For every active gym it
 * turns the retention signals we already compute (platform_gym_attention RPC)
 * into a plain-language list of "what's wrong here and what to do about it,"
 * grouped BY GYM and sorted worst-first. The point is to open this page and
 * immediately see "este gimnasio tiene este problema y ese problema" — and
 * fix it before it costs the gym its members.
 *
 * No new tracking: every problem is derived from existing data (members,
 * onboarding, activity rollup, churn scores, admin presence, error logs).
 */
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ListChecks, Building2, ChevronRight, CheckCircle2, Moon, UserX,
  UserPlus, Flame, AlertTriangle, Bug, Users, ArrowRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import FadeIn from '../../components/platform/FadeIn';
import StatCard from '../../components/platform/StatCard';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

const SEV = { high: 3, med: 2, low: 1 };
const SEV_DOT = { high: '#EF4444', med: '#F59E0B', low: '#6B7280' };

const daysSince = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Math.floor((new Date().getTime() - d.getTime()) / 86400000);
};

// Turn one gym's raw signals into its list of problems (each with the fix).
function deriveProblems(g, t) {
  const out = [];
  const gymRoute = `/platform/gym/${g.gym_id}`;
  const members = g.member_count || 0;

  // No members yet — nothing else matters; this is the whole problem.
  if (members === 0) {
    const ageDays = daysSince(g.created_at ? g.created_at.slice(0, 10) : null) ?? 0;
    out.push({
      key: 'no_members',
      severity: ageDays > 30 ? 'high' : 'med',
      icon: Users,
      label: t('platform.attention.p.noMembers', 'No members yet'),
      fix: t('platform.attention.f.noMembers', 'Help them import their roster or share invite codes.'),
      route: gymRoute,
    });
    return out;
  }

  const onboardRate = Math.round((g.onboarded_count / members) * 100);
  const activeRate = Math.round((g.active_30d / members) * 100);
  const atRisk = (g.churn_critical || 0) + (g.churn_high || 0);
  const since = daysSince(g.last_activity);
  const adminSince = g.last_admin_seen
    ? Math.floor((new Date().getTime() - new Date(g.last_admin_seen).getTime()) / 86400000)
    : null;

  // Members joined but the gym is dead (no activity ever / in a long time).
  if (since === null) {
    out.push({
      key: 'never_active', severity: 'high', icon: UserX,
      label: t('platform.attention.p.neverActive', 'Members signed up but never trained'),
      fix: t('platform.attention.f.neverActive', 'Turn on check-in and get the first workouts logged.'),
      route: gymRoute,
    });
  } else if (since >= 7 || (g.prior_activity >= 3 && g.cur_activity <= g.prior_activity * 0.6)) {
    const hard = since >= 14 || (g.prior_activity >= 3 && g.cur_activity <= g.prior_activity * 0.4);
    out.push({
      key: 'going_quiet', severity: hard ? 'high' : 'med', icon: Moon,
      label: since >= 7
        ? t('platform.attention.p.silent', { count: since, defaultValue: 'Members quiet — {{count}}d since last activity' })
        : t('platform.attention.p.cooling', 'Member activity dropping vs the prior 2 weeks'),
      fix: t('platform.attention.f.goingQuiet', 'Nudge the owner to run a challenge or message inactive members.'),
      route: gymRoute,
    });
  }

  // Members at risk of leaving (membership churn — what the app exists to fight).
  if (atRisk >= Math.max(3, Math.ceil(members * 0.15))) {
    out.push({
      key: 'members_at_risk', severity: g.churn_critical > 0 ? 'high' : 'med', icon: AlertTriangle,
      label: t('platform.attention.p.atRisk', { count: atRisk, defaultValue: '{{count}} members at risk of leaving' }),
      fix: t('platform.attention.f.atRisk', 'Owner should work the retention queue this week.'),
      route: gymRoute,
    });
  }

  // Onboarding gap — members who never finished setup don't stick.
  if (members >= 3 && onboardRate < 60) {
    out.push({
      key: 'onboarding', severity: onboardRate < 35 ? 'high' : 'med', icon: UserPlus,
      label: t('platform.attention.p.onboarding', { rate: onboardRate, defaultValue: 'Onboarding only {{rate}}%' }),
      fix: t('platform.attention.f.onboarding', { count: members - g.onboarded_count, defaultValue: 'Remind {{count}} members to finish their profile.' }),
      route: gymRoute,
    });
  }

  // Low overall engagement.
  if (members >= 5 && activeRate < 30) {
    out.push({
      key: 'low_engagement', severity: 'med', icon: Flame,
      label: t('platform.attention.p.lowEngagement', { rate: activeRate, defaultValue: 'Only {{rate}}% active (30d)' }),
      fix: t('platform.attention.f.lowEngagement', 'Suggest an announcement or challenge to bring people back.'),
      route: gymRoute,
    });
  }

  // Owner not checking their dashboard — they can't retain what they don't watch.
  if (adminSince === null || adminSince >= 7) {
    out.push({
      key: 'admin_idle', severity: (adminSince === null || adminSince >= 14) ? 'high' : 'med', icon: UserX,
      label: adminSince === null
        ? t('platform.attention.p.adminNever', 'Owner has never opened their dashboard')
        : t('platform.attention.p.adminIdle', { count: adminSince, defaultValue: "Owner hasn't logged in for {{count}}d" }),
      fix: t('platform.attention.f.adminIdle', 'Reach out so they check their members this week.'),
      route: gymRoute,
    });
  }

  // Technical errors hitting this gym's members.
  if (g.errors_7d >= 5) {
    out.push({
      key: 'errors', severity: 'high', icon: Bug,
      label: t('platform.attention.p.errors', { count: g.errors_7d, defaultValue: '{{count}} technical errors (7d)' }),
      fix: t('platform.attention.f.errors', 'Check the error log and resolve before members notice.'),
      route: `/platform/error-logs`,
    });
  }

  return out;
}

const weight = (problems) => problems.reduce((s, p) => s + SEV[p.severity], 0);

export default function Attention() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `${t('platform.attention.title', 'Needs Attention')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['platform', 'gym-attention'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('platform_gym_attention');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const { flagged, allGood, highCount } = useMemo(() => {
    const withProblems = rows
      .map((g) => ({ gym: g, problems: deriveProblems(g, t) }))
      .filter((r) => r.problems.length > 0)
      .sort((a, b) => weight(b.problems) - weight(a.problems));
    const clean = rows.length - withProblems.length;
    const highs = withProblems.reduce((s, r) => s + r.problems.filter((p) => p.severity === 'high').length, 0);
    return { flagged: withProblems, allGood: clean, highCount: highs };
  }, [rows, t]);

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      <FadeIn>
        <div className="flex items-center gap-2 mb-0.5">
          <ListChecks size={20} className="text-[#D4AF37]" />
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('platform.attention.title', 'Needs Attention')}</h1>
        </div>
        <p className="text-[12px] text-[#6B7280] mb-6">
          {t('platform.attention.subtitle', "What's going wrong at each gym — and how to fix it before it costs members.")}
        </p>
      </FadeIn>

      {isLoading ? (
        <PlatformSpinner />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2.5 mb-6">
            <StatCard label={t('platform.attention.statGyms', 'Gyms to review')} value={flagged.length} icon={Building2} borderColor="#F59E0B" />
            <StatCard label={t('platform.attention.statHigh', 'Urgent issues')} value={highCount} icon={AlertTriangle} borderColor="#EF4444" />
            <StatCard label={t('platform.attention.statGood', 'All good')} value={allGood} icon={CheckCircle2} borderColor="#10B981" />
          </div>

          {flagged.length === 0 ? (
            <div className="text-center py-16 bg-[#0F172A] border border-emerald-500/20 rounded-xl">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-3" />
              <p className="text-[14px] font-medium text-emerald-400">{t('platform.attention.allClear', 'Every gym looks healthy')}</p>
              <p className="text-[12px] text-[#6B7280] mt-1">{t('platform.attention.allClearHint', 'No retention problems detected right now.')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {flagged.map(({ gym, problems }) => (
                <FadeIn key={gym.gym_id}>
                  <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
                    {/* Gym header row */}
                    <button
                      onClick={() => navigate(`/platform/gym/${gym.gym_id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/6 hover:bg-white/[0.02] transition-colors text-left"
                    >
                      <Building2 size={15} className="text-[#9CA3AF] flex-shrink-0" />
                      <span className="text-[14px] font-semibold text-[#E5E7EB] truncate flex-1">{gym.gym_name}</span>
                      {problems.some((p) => p.severity === 'high') && (
                        <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                      )}
                      <span className="text-[11px] font-bold text-[#9CA3AF] tabular-nums">
                        {t('platform.attention.problemCount', { count: problems.length, defaultValue: '{{count}} issues' })}
                      </span>
                      <ChevronRight size={14} className="text-[#4B5563] flex-shrink-0" />
                    </button>
                    <ul className="divide-y divide-white/[0.04]">
                      {problems.map((p) => {
                        const PIcon = p.icon;
                        return (
                          <li key={p.key} className="px-4 py-3">
                            <div className="flex items-start gap-2.5">
                              <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: SEV_DOT[p.severity] }} />
                              <PIcon size={14} className="text-[#9CA3AF] flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-[#E5E7EB]">{p.label}</p>
                                <button
                                  onClick={() => navigate(p.route)}
                                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#D4AF37] transition-colors text-left"
                                >
                                  {p.fix}
                                  <ArrowRight size={11} className="flex-shrink-0" />
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </FadeIn>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

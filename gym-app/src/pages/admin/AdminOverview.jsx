import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, AlertTriangle, ChevronRight, Activity,
  UserPlus, Clock, RefreshCw, CalendarCheck, Dumbbell,
  CheckCircle, KeyRound, MessageSquare, BookOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';
import { getRiskTier } from '../../lib/churnScore';
import { translateSignal } from '../../lib/churn/signalI18n';

// Shared admin components
import { FadeIn, StatCard, AdminCard, Avatar, AdminPageShell, PageHeader, AdminModal } from '../../components/admin';

// Sub-components
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';
import {
  OverviewSkeleton, AlertBanner, ActivityItem, WatchlistRow,
  formatDelta, DeltaSub, QuickActionButton,
} from './components/OverviewSubcomponents';
import { fetchOverviewData } from '../../lib/admin/overviewQuery';
import NeedsAttentionCard from './components/NeedsAttentionCard';
import AdminFirstRunChecklist from './components/AdminFirstRunChecklist';
import MorningQueuePanel from './components/MorningQueuePanel';
import AdminWelcomeModal from './components/AdminWelcomeModal';


export default function AdminOverview() {
  const { profile, gymConfig, gymName, availableRoles } = useAuth();
  const navigate = useNavigate();

  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  // First-time welcome modal — explains the retention thesis and the first
  // 3 actions. Per gym + per admin profile localStorage flag (so a 2nd
  // admin on the same gym still gets the explainer on their first login).
  // Tracked here so the modal mounts immediately when the user lands on
  // the dashboard; the AdminFirstRunChecklist that lives below it is the
  // ongoing setup tracker — different concept, different lifecycle.
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window === 'undefined' || !gymId || !profile?.id) return false;
    try {
      return localStorage.getItem(`admin_welcome_shown_${gymId}_${profile.id}`) !== '1';
    } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !gymId || !profile?.id) return;
    try {
      setShowWelcome(localStorage.getItem(`admin_welcome_shown_${gymId}_${profile.id}`) !== '1');
    } catch { /* ignore */ }
  }, [gymId, profile?.id]);

  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [resetApprovalId, setResetApprovalId] = useState(null);
  const [activityDetail, setActivityDetail] = useState(null);
  const [watchlistDetail, setWatchlistDetail] = useState(null);

  // Fetch pending password reset requests
  const { data: pendingResets = [], refetch: refetchResets } = useQuery({
    queryKey: [...adminKeys.overview(gymId), 'pending-resets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('id, profile_id, status, created_at, expires_at, profiles!inner(full_name, username, avatar_url)')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return [];
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => { document.title = `${t('admin.overview.pageTitle', 'Admin - Overview')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: adminKeys.overview(gymId),
    queryFn: () => fetchOverviewData(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Auto-trigger server-side churn scoring once when most members lack DB scores
  const churnComputeTriggered = useRef(false);
  useEffect(() => {
    if (!gymId || !data || data._totalMembers === 0 || churnComputeTriggered.current) return;
    if (data._dbScoreCount < data._totalMembers * 0.5) {
      churnComputeTriggered.current = true;
      supabase.rpc('compute_churn_scores', { p_gym_id: gymId })
        .then(({ error }) => {
          if (error) logger.error('Auto compute_churn_scores:', error);
          else refetch();
        });
    }
  }, [gymId, data?._dbScoreCount, data?._totalMembers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard: only admins/super_admins with a valid gym_id
  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger)' }}>{t('admin.overview.accessDenied')}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <AdminPageShell>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--color-danger-soft)' }}>
            <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} />
          </div>
          <div className="text-center">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--color-danger)' }}>{t('admin.overview.loadError', 'Failed to load overview data')}</p>
            <p className="text-[12.5px] max-w-md mt-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>{error?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="admin-pill admin-pill--outline flex items-center gap-2"
          >
            <RefreshCw size={13} />
            {t('admin.overview.refresh')}
          </button>
        </div>
      </AdminPageShell>
    );
  }

  if (isLoading || !data) return <OverviewSkeleton />;

  const { stats, atRisk, recentActivity, onboardingCount } = data;
  const classesEnabled = gymConfig?.classesEnabled ?? false;

  // Determine if today's check-ins are unusually low
  const checkInsBelowAvg = stats.avgDailyCheckins > 0 && stats.checkInsToday < stats.avgDailyCheckins * 0.5;

  // Anomaly alerts that don't fit "needs your attention" (which is for
  // explicit pending tasks). A drop in check-ins is more of an FYI banner
  // than a to-do.
  const alerts = [];
  if (checkInsBelowAvg) {
    alerts.push({
      icon: Activity,
      text: t('admin.overview.unusualActivityDesc', { avg: stats.avgDailyCheckins, today: stats.checkInsToday }),
      actionLabel: t('admin.overview.viewAction'),
      color: 'var(--color-danger)',
      onClick: () => navigate('/admin/attendance'),
    });
  }

  return (
    <AdminPageShell>
      {/* ── First-time welcome modal ─────────────────────── */}
      {showWelcome && (
        <AdminWelcomeModal
          gymId={gymId}
          gymName={gymName}
          profileId={profile?.id}
          onClose={() => setShowWelcome(false)}
        />
      )}

      {/* ── Password reset approval modal ────────────────── */}
      {resetApprovalId && (
        <PasswordResetApprovalModal
          requestId={resetApprovalId}
          onClose={() => setResetApprovalId(null)}
          onComplete={() => {
            setResetApprovalId(null);
            refetchResets();
          }}
        />
      )}

      {/* ════════════════════════════════════════════════════
           SECTION 1 -- HEADER + QUICK-ACTION BUTTONS
         ════════════════════════════════════════════════════ */}
      <FadeIn>
        <PageHeader
          title={t('admin.overview.title')}
          subtitle={`${format(new Date(), 'EEEE, MMMM d, yyyy', dateFnsLocale)} · ${stats.checkInsToday} ${t('admin.overview.glanceCheckins').toLowerCase()}`}
          actions={
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap pb-1 md:pb-0">
              <QuickActionButton icon={Users} label={t('admin.overview.navMembers')} onClick={() => navigate('/admin/members')} />
              <QuickActionButton icon={AlertTriangle} label={t('admin.overview.navChurn')} onClick={() => navigate('/admin/churn')} />
              {classesEnabled && (
                <QuickActionButton icon={BookOpen} label={t('admin.overview.navClasses')} onClick={() => navigate('/admin/classes')} />
              )}
              <QuickActionButton icon={MessageSquare} label={t('admin.overview.navMessages')} onClick={() => navigate('/admin/messages')} />
            </div>
          }
          className="mb-8"
        />
      </FadeIn>

      {/* First-run setup checklist for new gyms — auto-hides when complete.
          Stays at the very top because nothing else on this page makes sense
          until the gym is configured. */}
      <AdminFirstRunChecklist gymId={gymId} />

      {/* ════════════════════════════════════════════════════
           SECTION 2 -- HERO KPI STRIP ("Today at a Glance")
           Leads the page so the owner gets the daily pulse first,
           then drops into the action queue below.
         ════════════════════════════════════════════════════ */}
      <FadeIn delay={40}>
        <span className="admin-eyebrow block mb-3">
          {t('admin.overview.todayGlance', 'Today at a Glance')}
        </span>
      </FadeIn>
      <div className={`grid gap-2.5 md:gap-4 mb-8 grid-cols-2 md:grid-cols-3 ${classesEnabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <FadeIn delay={60}>
          <StatCard
            label={t('admin.overview.glanceCheckins')}
            value={stats.checkInsToday}
            icon={CalendarCheck}
            borderColor="var(--color-coach)"
            sub={<DeltaSub delta={formatDelta(stats.checkInsToday, stats.checkInsYesterday, t('admin.overview.vsYesterday', 'vs yesterday'))} />}
            benchmark={t('admin.overview.benchmarkCheckins', {
              avg: stats.avgDailyCheckins || 0,
              defaultValue: 'Healthy gym: ~30–40% of members check in on any given day. Your gym\'s avg/day: {{avg}}.',
            })}
            onClick={() => navigate('/admin/attendance')}
          />
        </FadeIn>
        {classesEnabled && (
          <FadeIn delay={80}>
            <StatCard
              label={t('admin.overview.glanceClasses')}
              value={stats.classesToday}
              icon={BookOpen}
              borderColor="var(--color-accent)"
              benchmark={t('admin.overview.benchmarkClasses', {
                defaultValue: 'Strong gyms run 3–6 classes/day. Empty days = under-utilized real estate.',
              })}
              onClick={() => navigate('/admin/classes')}
            />
          </FadeIn>
        )}
        <FadeIn delay={100}>
          <StatCard
            label={t('admin.overview.glanceNewMonth')}
            value={stats.newMembersMonth}
            icon={UserPlus}
            borderColor="var(--color-success)"
            sub={<DeltaSub delta={formatDelta(stats.newMembersMonth, stats.newMembersPrevMonth, t('admin.overview.vsLastMonth', 'vs last month'))} />}
            benchmark={t('admin.overview.benchmarkNewMonth', {
              defaultValue: 'A growing PR gym signs 3–5% of its base in new members each month. Below 2%? Look at referrals + signage.',
            })}
            onClick={() => navigate('/admin/members')}
          />
        </FadeIn>
        <FadeIn delay={120}>
          <StatCard
            label={t('admin.overview.glanceTotal')}
            value={stats.totalMembers}
            icon={Users}
            borderColor="var(--color-coach)"
            benchmark={t('admin.overview.benchmarkTotal', {
              defaultValue: 'Total active members. Doesn\'t include archived imports or cancelled accounts — only live, payable members.',
            })}
            onClick={() => navigate('/admin/members')}
          />
        </FadeIn>
      </div>

      {/* Transient anomaly alert — drops in only when check-ins are unusually low. */}
      {alerts.length > 0 && (
        <FadeIn delay={120}>
          <div className="space-y-2 mb-5">
            {alerts.map((a, i) => (
              <AlertBanner key={i} icon={a.icon} text={a.text} actionLabel={a.actionLabel} color={a.color} onClick={a.onClick} />
            ))}
          </div>
        </FadeIn>
      )}

      {/* ════════════════════════════════════════════════════
           SECTION 3 -- "NEEDS ATTENTION NOW"
           Unified inbox: pending resets, churn risk, moderation reports,
           referral approvals, onboarding gaps. Action items follow the
           daily pulse so the owner reads the situation before acting.
         ════════════════════════════════════════════════════ */}
      <NeedsAttentionCard
        gymId={gymId}
        atRiskCount={stats.criticalCount}
        pendingResetsCount={pendingResets.length}
        onboardingCount={onboardingCount}
        firstPendingResetId={pendingResets[0]?.id}
        onResetClick={setResetApprovalId}
      />

      {/* ════════════════════════════════════════════════════
           SECTION 4 -- MORNING RETENTION QUEUE
           "Today's conversations" — produced by the daily orchestrator
           cron. The longer-form follow-up list, after the inbox.
         ════════════════════════════════════════════════════ */}
      <FadeIn delay={20}>
        <div className="mb-8">
          <MorningQueuePanel gymId={gymId} />
        </div>
      </FadeIn>

      {/* ════════════════════════════════════════════════════
           SECTION 5 -- RECENT ACTIVITY + FULL WATCHLIST
           Two-column operational view
         ════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 md:gap-5">
        {/* Recent Activity Feed */}
        <FadeIn delay={200}>
          <AdminCard hover padding="p-3 sm:p-4 md:p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-admin-panel)' }}>
                <Activity size={13} style={{ color: 'var(--color-admin-text-sub)' }} />
              </div>
              <p className="text-[13.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.overview.recentActivity')}
              </p>
              {recentActivity.length > 0 && (
                <span className="admin-eyebrow ml-auto">
                  {t('admin.overview.lastNCount', 'LAST {{count}}', { count: recentActivity.length })}
                </span>
              )}
            </div>
            {recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: 'var(--color-admin-panel)' }}>
                  <Clock size={18} style={{ color: 'var(--color-admin-text-faint)' }} />
                </div>
                <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.overview.noActivity')}</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                {recentActivity.map((item, i) => (
                  <ActivityItem key={`${item.type}-${item.profile_id}-${item.timestamp}-${i}`} item={item} dateFnsLocale={dateFnsLocale} t={t} onClick={setActivityDetail} />
                ))}
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Full Watchlist */}
        <FadeIn delay={240}>
          <AdminCard hover padding="p-3 sm:p-4 md:p-5">
            {/* Watchlist header. The Spanish heading "Lista de Seguimiento"
                used to wrap to 3 lines at 340px because the pill + "Ver todo"
                link were eating the row width. Layout now: title truncates,
                pill + link sit on a single shrink-0 cluster. */}
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--color-warning-soft)' }}>
                  <AlertTriangle size={13} style={{ color: 'var(--color-warning)' }} />
                </div>
                <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>
                  {t('admin.overview.watchlist')}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="admin-pill admin-pill--hot whitespace-nowrap">
                  {t('admin.overview.atRiskPill', 'AT RISK · {{count}}', { count: stats.atRiskCount })}
                </span>
                <button
                  onClick={() => navigate('/admin/churn')}
                  className="flex-shrink-0 text-[11px] flex items-center gap-0.5 whitespace-nowrap transition-colors duration-200"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {t('admin.overview.viewAll')} <ChevronRight size={12} />
                </button>
              </div>
            </div>

            {atRisk.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: 'var(--color-success-soft)' }}>
                  <CheckCircle size={18} style={{ color: 'var(--color-success)' }} />
                </div>
                <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.overview.noAtRisk')}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>{t('admin.overview.everyoneActive')}</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                {atRisk.map(m => (
                  <WatchlistRow key={m.id} member={m} t={t} onMessage={() => navigate('/admin/churn')} onClick={setWatchlistDetail} />
                ))}
              </div>
            )}
          </AdminCard>
        </FadeIn>
      </div>

      {/* ── Activity detail modal ─────────────────────────── */}
      <AdminModal
        isOpen={!!activityDetail}
        onClose={() => setActivityDetail(null)}
        title={
          activityDetail
            ? (activityDetail.type === 'workout' ? t('admin.overview.actions.workout', 'completed workout')
              : activityDetail.type === 'signup' ? t('admin.overview.actions.joined', 'joined')
              : t('admin.overview.actions.checkin', 'checked in'))
            : ''
        }
        titleIcon={
          activityDetail?.type === 'workout' ? Dumbbell
          : activityDetail?.type === 'signup' ? UserPlus
          : CalendarCheck
        }
        size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button
              onClick={() => setActivityDetail(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
            >
              {t('admin.overview.close', 'Close')}
            </button>
            <button
              onClick={() => { const id = activityDetail?.profile_id; setActivityDetail(null); if (id) navigate(`/admin/members?member=${id}`); }}
              className="px-4 py-2 rounded-xl text-[13px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
            >
              {t('admin.overview.viewMember', 'View member')}
            </button>
          </div>
        }
      >
        {activityDetail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar name={activityDetail.memberName} size="md" src={activityDetail.avatarUrl} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {activityDetail.memberName || t('admin.overview.unknownMember', 'Unknown')}
                </p>
                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                  {formatDistanceToNow(new Date(activityDetail.timestamp), { addSuffix: true, ...(dateFnsLocale || {}) })}
                </p>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.overview.eventTime', 'Time')}
              </p>
              <p className="text-[13px] font-mono" style={{ color: 'var(--color-text-primary)' }}>
                {format(new Date(activityDetail.timestamp), 'PPp', dateFnsLocale)}
              </p>
              {/* The activity row carries the workout volume as `total_volume_lbs`
                  (DB column shape). Coerce to number defensively so a null/string
                  never reaches Math.round (which would render `NaN lbs`). */}
              {activityDetail.type === 'workout' && (() => {
                const raw = activityDetail.total_volume_lbs ?? activityDetail.totalVolume;
                const vol = Number(raw);
                if (!Number.isFinite(vol) || vol <= 0) return null;
                return (
                  <>
                    <p className="text-[11px] uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('admin.overview.totalVolume', 'Total volume')}
                    </p>
                    <p className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
                      {Math.round(vol).toLocaleString()} lbs
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Watchlist detail modal ────────────────────────── */}
      <AdminModal
        isOpen={!!watchlistDetail}
        onClose={() => setWatchlistDetail(null)}
        title={watchlistDetail?.full_name || ''}
        titleIcon={AlertTriangle}
        subtitle={t('admin.overview.atRiskSub', 'At-risk member')}
        size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button
              onClick={() => setWatchlistDetail(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
            >
              {t('admin.overview.close', 'Close')}
            </button>
            <button
              onClick={() => { setWatchlistDetail(null); navigate('/admin/churn'); }}
              className="px-4 py-2 rounded-xl text-[13px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
            >
              {t('admin.overview.openWinBack', 'Open win-back')}
            </button>
          </div>
        }
      >
        {watchlistDetail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar name={watchlistDetail.full_name} size="md" src={watchlistDetail.avatar_url} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{watchlistDetail.full_name}</p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{watchlistDetail.username || ''}</p>
              </div>
              <span className="ml-auto admin-pill admin-pill--hot admin-mono">{watchlistDetail.score}%</span>
            </div>
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.overview.daysInactiveLabel', 'Days inactive')}
                </span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {watchlistDetail.neverActive ? t('admin.overview.neverLogged') : watchlistDetail.daysInactive}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.overview.riskTier', 'Risk tier')}
                </span>
                <span className="text-[13px] font-semibold capitalize" style={{ color: 'var(--color-warning)' }}>
                  {(() => {
                    const tierKey = watchlistDetail.risk_tier || getRiskTier(watchlistDetail.score).tier;
                    return t(`admin.members.riskTier.${tierKey}`, tierKey);
                  })()}
                </span>
              </div>
              {Array.isArray(watchlistDetail.key_signals) && watchlistDetail.key_signals.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('admin.overview.signals', 'Signals')}
                  </p>
                  <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--color-text-primary)' }}>
                    {watchlistDetail.key_signals.slice(0, 4).map((s, i) => (
                      <li key={i}>• {translateSignal(t, s)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </AdminModal>
    </AdminPageShell>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import logger from '../../../../lib/logger';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Card, LifecycleBar } from './analyticsKit';

/**
 * True when an RPC failed *because the function isn't on this database* —
 * PGRST202 is PostgREST "not found in the schema cache", 42883 is Postgres
 * "function does not exist", and some gateways surface a bare 404. Anything
 * else (including the RPC's own "Access denied: gym boundary violation") is a
 * real failure and must propagate to the ErrorCard.
 *
 * The app ships to web AND to installed native builds, so a client running
 * against a DB without migration 0649 — an old install, or a rolled-back
 * database — has to degrade to the legacy path, not white-screen the page.
 */
const isRpcMissing = (err) => {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  if (err.status === 404 || err.statusCode === 404) return true;
  return /could not find .*function|schema cache/i.test(err.message || '');
};

// Display metadata for the six buckets. Shared by both fetch paths so the
// order, colours and i18n keys can never drift between them.
const STAGE_META = [
  { key: 'new',        labelKey: 'lifecycleNew',        color: 'var(--color-info)' },
  { key: 'onboarding', labelKey: 'lifecycleOnboarding', color: 'var(--color-coach)' },
  { key: 'active',     labelKey: 'lifecycleActive',     color: 'var(--color-success)' },
  { key: 'atRisk',     labelKey: 'lifecycleAtRisk',     color: 'var(--color-warning)' },
  { key: 'churned',    labelKey: 'lifecycleChurned',    color: 'var(--color-danger)' },
  { key: 'wonBack',    labelKey: 'lifecycleWonBack',    color: 'var(--color-accent)' },
];

const toStages = (counts, total) =>
  STAGE_META.map(s => ({
    ...s,
    count: counts[s.key] || 0,
    pct: total > 0 ? Math.round(((counts[s.key] || 0) / total) * 100) : 0,
  }));

/**
 * Member lifecycle histogram.
 *
 * Aggregated SERVER-SIDE by `admin_lifecycle_stages` (migration 0649).
 * PostgREST clamps every response to max_rows (1000 here — verified in prod)
 * and `.limit(20000)` cannot raise it, so the legacy client path below
 * classified a truncated roster against truncated 30/90-day session counts:
 * "At Risk" understated and "Active" overstated, on the one panel whose whole
 * job is warning about churn. The SQL replicates the branch priority
 * (churned > wonBack > atRisk > active > onboarding > new > active) exactly so
 * no member silently moves bucket; its one deliberate correction is taking the
 * LATEST churn_risk_scores row per member instead of an arbitrary historical
 * one, which is what this chart always meant.
 */
async function fetchLifecycleData(gymId) {
  const { data: rows, error } = await supabase.rpc('admin_lifecycle_stages', { p_gym_id: gymId });

  if (!error) {
    // TABLE-returning function → one-row array.
    const r = (rows || [])[0] || {};
    const counts = {
      new:        Number(r.stage_new)        || 0,
      onboarding: Number(r.stage_onboarding) || 0,
      active:     Number(r.stage_active)     || 0,
      atRisk:     Number(r.stage_at_risk)    || 0,
      churned:    Number(r.stage_churned)    || 0,
      wonBack:    Number(r.stage_won_back)   || 0,
    };
    // The buckets partition the roster, so total_members === sum(counts) — the
    // same denominator the legacy path used (`members.length`).
    return toStages(counts, Number(r.total_members) || 0);
  }

  if (!isRpcMissing(error)) throw error;
  return fetchLifecycleDataClientSide(gymId);
}

/**
 * LEGACY fallback — the original in-browser classification, kept verbatim so a
 * client on a pre-0649 database still renders the bar (truncated at max_rows,
 * i.e. At Risk under-counted, but never a crash). Do not delete: it is the
 * only path an old installed native build has.
 */
async function fetchLifecycleDataClientSide(gymId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [membersRes, recentSessRes, churnScoresRes, winBacksRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, created_at, is_onboarded, membership_status')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .eq('imported_archived', false),
    supabase
      .from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .gte('started_at', thirtyDaysAgo),
    supabase
      .from('churn_risk_scores')
      .select('profile_id, risk_tier')
      .eq('gym_id', gymId)
      .limit(2000),
    supabase
      .from('win_back_attempts')
      .select('user_id')
      .eq('gym_id', gymId)
      .eq('outcome', 'returned')
      .limit(1000),
  ]);

  if (membersRes.error) throw membersRes.error;
  if (recentSessRes.error) logger.error('LifecycleStages: failed to load sessions:', recentSessRes.error);
  if (churnScoresRes.error) logger.error('LifecycleStages: failed to load churn scores:', churnScoresRes.error);
  if (winBacksRes.error) logger.error('LifecycleStages: failed to load win-backs:', winBacksRes.error);

  const members = membersRes.data;
  const recentSessions = recentSessRes.data;
  const churnScores = churnScoresRes.data;
  const winBacks = winBacksRes.data;

  const sessionCountMap = {};
  (recentSessions || []).forEach(s => { sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1; });

  const churnMap = {};
  (churnScores || []).forEach(s => { churnMap[s.profile_id] = s.risk_tier; });

  const wonBackSet = new Set((winBacks || []).map(w => w.user_id));

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: allSessions, error: allSessError } = await supabase
    .from('workout_sessions')
    .select('profile_id')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', ninetyDaysAgo)
    .limit(20000);
  if (allSessError) logger.error('LifecycleStages: failed to load all sessions:', allSessError);

  const totalSessionMap = {};
  (allSessions || []).forEach(s => { totalSessionMap[s.profile_id] = (totalSessionMap[s.profile_id] || 0) + 1; });

  const counts = { new: 0, onboarding: 0, active: 0, atRisk: 0, churned: 0, wonBack: 0 };

  (members || []).forEach(m => {
    const status = m.membership_status;
    const recentCount = sessionCountMap[m.id] || 0;
    const totalCount = totalSessionMap[m.id] || 0;
    const riskTier = churnMap[m.id];
    const joinedRecently = m.created_at >= fourteenDaysAgo;

    if (status === 'cancelled' || status === 'frozen') counts.churned++;
    else if (wonBackSet.has(m.id)) counts.wonBack++;
    else if (riskTier && ['critical', 'high', 'medium'].includes(riskTier)) counts.atRisk++;
    else if (recentCount >= 3) counts.active++;
    else if (m.is_onboarded && totalCount < 3) counts.onboarding++;
    else if (!m.is_onboarded || (joinedRecently && totalCount === 0)) counts.new++;
    else counts.active++;
  });

  const total = (members || []).length;
  return toStages(counts, total);
}

export default function LifecycleStages({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: stages = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.lifecycle(gymId),
    queryFn: () => fetchLifecycleData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton h="h-[160px]" />;
  if (isError) return <ErrorCard message={t('admin.analytics.lifecycleError', 'Failed to load lifecycle data')} onRetry={refetch} />;
  if (stages.length === 0) return null;

  const totalMembers = stages.reduce((sum, s) => sum + s.count, 0);
  const activeStage = stages.find(s => s.key === 'active');
  const activePct = activeStage ? activeStage.pct : 0;
  const segs = stages.map(s => ({ label: t(`admin.analytics.${s.labelKey}`, s.labelKey), value: s.count, color: s.color, pct: s.pct }));

  return (
    <Card style={{ padding: '24px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.analytics.lifecycleTitle', 'Member Lifecycle')}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 4 }}>{t('admin.analytics.lifecycleSubtitle', 'Where your members are right now')}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 30, fontWeight: 800, color: 'var(--color-success)', letterSpacing: -1, lineHeight: 1 }}>{activePct}%</div>
          <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, marginTop: 3 }}>{t('admin.analytics.lifecycleActiveLabel', { count: totalMembers, defaultValue: 'active of {{count}}' })}</div>
        </div>
      </div>

      <LifecycleBar segs={segs} />

      <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: '16px 28px', marginTop: 22 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: 99, background: s.color, flexShrink: 0 }} />
            <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textSub, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text }}>{s.value}</span>
            <span style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, width: 42, textAlign: 'right' }}>({s.pct}%)</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

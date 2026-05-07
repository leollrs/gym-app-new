import { useEffect, useState } from 'react';
import { Trophy, RefreshCw, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, FadeIn, FilterBar, AdminTabs, AdminPageShell, ErrorCard, Avatar } from '../../components/admin';

const METRIC_KEYS = ['volume', 'workouts', 'pr_count', 'checkins', 'improved', 'consistency'];
const PERIOD_KEYS = ['7', '30', 'all'];
const TIER_KEYS = ['all', 'beginner', 'intermediate', 'advanced'];

const MEDAL = ['🥇', '🥈', '🥉'];

export default function AdminLeaderboard() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const [metric, setMetric] = useState('volume');
  const [period, setPeriod] = useState('30');
  const [tier, setTier]     = useState('all');

  useEffect(() => { document.title = `${t('admin.leaderboard.title', 'Admin - Leaderboard')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Clamp period for boards that don't support all-time
  const effectivePeriod = (['improved', 'consistency'].includes(metric) && period === 'all') ? '30' : period;
  const from = effectivePeriod !== 'all' ? subDays(new Date(), parseInt(effectivePeriod)).toISOString() : null;
  const tierParam = tier === 'all' ? null : tier;
  const periodLabel = effectivePeriod === '7' ? 'weekly' : 'monthly';

  // ── Fetch leaderboard ──
  const { data: entries = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.leaderboard(gymId), metric, effectivePeriod, tier],
    queryFn: async () => {
      if (metric === 'pr_count') {
        const { data } = await supabase.rpc('get_leaderboard_prs', {
          p_gym_id: gymId, p_start_date: from, p_limit: 20, p_tier: tierParam,
        });
        return data || [];
      }
      if (metric === 'checkins') {
        const { data } = await supabase.rpc('get_leaderboard_checkins', {
          p_gym_id: gymId, p_start_date: from, p_tier: tierParam, p_limit: 20,
        });
        return data || [];
      }
      if (metric === 'improved') {
        const { data } = await supabase.rpc('get_leaderboard_most_improved', {
          p_gym_id: gymId, p_metric: 'volume', p_period: periodLabel,
          p_tier: tierParam, p_limit: 20,
        });
        return data || [];
      }
      if (metric === 'consistency') {
        const { data } = await supabase.rpc('get_leaderboard_consistency', {
          p_gym_id: gymId, p_period: periodLabel, p_tier: tierParam, p_limit: 20,
        });
        return data || [];
      }
      const { data } = await supabase.rpc('get_leaderboard_volume', {
        p_gym_id: gymId, p_metric: metric, p_start_date: from, p_limit: 20, p_tier: tierParam,
      });
      return data || [];
    },
    enabled: !!gymId,
  });

  // Total member count for context
  const { data: totalMembers } = useQuery({
    queryKey: [...adminKeys.leaderboard(gymId), 'member-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId);
      return count || 0;
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // Realtime subscription
  useEffect(() => {
    if (!gymId) return;
    const channel = supabase.channel('leaderboard-realtime')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'workout_sessions',
        filter: `gym_id=eq.${gymId}`,
      }, () => queryClient.invalidateQueries({ queryKey: adminKeys.leaderboard(gymId) }))
      .subscribe((status, err) => {
        if (err) console.error('Realtime subscription error:', err);
      });
    return () => supabase.removeChannel(channel);
  }, [gymId, queryClient]);

  const scoreLabel = t(`admin.leaderboard.scoreLabel.${metric}`, 'pts');
  const metricLabel = t(`admin.leaderboard.metrics.${metric}`, metric);

  // Unit label for score column header
  const metricUnitMap = {
    volume: t('admin.leaderboard.unitVolume', 'Volume (lbs)'),
    workouts: t('admin.leaderboard.unitWorkouts', 'Workouts (#)'),
    pr_count: t('admin.leaderboard.unitPRs', 'PRs (#)'),
    checkins: t('admin.leaderboard.unitCheckins', 'Check-ins (#)'),
    improved: t('admin.leaderboard.unitImproved', 'Improvement (%)'),
    consistency: t('admin.leaderboard.unitConsistency', 'Consistency (%)'),
  };
  const columnUnit = metricUnitMap[metric] || metricLabel;

  const formatScore = (e) => {
    if (metric === 'improved') return `+${e.score}%`;
    if (metric === 'consistency') return `${e.score}%`;
    return e.score.toLocaleString();
  };

  const handleExport = () => {
    exportCSV({
      filename: 'leaderboard',
      columns: [
        { key: 'rank', label: t('admin.leaderboard.csvRank', 'Rank') },
        { key: 'name', label: t('admin.leaderboard.csvName', 'Name') },
        { key: 'score', label: metricLabel },
        { key: 'tier', label: t('admin.leaderboard.csvTier', 'Tier') },
      ],
      data: entries.map((e, i) => ({ ...e, rank: i + 1, tier: e.tier ?? '—' })),
    });
  };

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.leaderboard.title', 'Leaderboard')}
        subtitle={t('admin.leaderboard.subtitle', 'Live gym rankings')}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium whitespace-nowrap transition-colors"
              style={{ border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-card)' }}
            >
              <Download size={13} />
              {t('admin.leaderboard.export')}
            </button>
            <button
              onClick={() => refetch()}
              aria-label={t('admin.leaderboard.refresh', 'Refresh')}
              className="p-2 rounded-xl transition-colors"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        }
        className="mb-6"
      />

      {/* Primary selector — metric category */}
      <AdminTabs
        tabs={METRIC_KEYS.map(k => ({ key: k, label: t(`admin.leaderboard.metrics.${k}`, k) }))}
        active={metric}
        onChange={setMetric}
        className="mb-5"
      />

      {/* Secondary filters — period & tier */}
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3 md:gap-x-6 md:gap-y-3 mb-4">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
          <span className="admin-eyebrow shrink-0">
            {t('admin.leaderboard.periodLabel', 'Period')}
          </span>
          <FilterBar
            options={PERIOD_KEYS.map(k => ({ key: k, label: t(`admin.leaderboard.periods.${k}`, k) }))}
            active={effectivePeriod}
            onChange={setPeriod}
          />
        </div>
        <div className="hidden md:block w-px h-5" style={{ background: 'var(--color-admin-border)' }} />
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
          <span className="admin-eyebrow shrink-0">
            {t('admin.leaderboard.tierLabel', 'Tier')}
          </span>
          <FilterBar
            options={TIER_KEYS.map(k => ({ key: k, label: t(`admin.leaderboard.tiers.${k}`, k) }))}
            active={tier}
            onChange={setTier}
          />
        </div>
      </div>

      {/* Member count context */}
      {!isLoading && entries.length > 0 && totalMembers != null && (
        <p className="text-[11px] mb-3" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.leaderboard.showingContext', {
            defaultValue: 'Showing top {{count}} of {{total}} members',
            count: entries.length,
            total: totalMembers,
          })}
        </p>
      )}

      {/* Podium — top 3 */}
      {!isLoading && !isError && entries.length >= 3 && (
        <FadeIn>
          <div className="grid gap-2 sm:gap-[14px] mb-[18px] items-end" style={{ gridTemplateColumns: '1fr 1.1fr 1fr' }}>
            {[entries[1], entries[0], entries[2]].map((r, i) => {
              const order = [1, 0, 2][i];
              const h = [140, 170, 120][i];
              const mobileH = [100, 120, 88][i];
              const bg = order === 0
                ? 'linear-gradient(180deg, #F2D07A, #E2B84A)'
                : order === 1
                  ? 'linear-gradient(180deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 75%, black))'
                  : 'linear-gradient(180deg, #D4AF88, #B88A60)';
              return (
                <div key={i} className="text-center">
                  <div className="flex flex-col items-center gap-1.5 mb-2.5">
                    <span style={{ fontSize: 28 }}>{MEDAL[order]}</span>
                    <Avatar name={r.name} size="lg" variant={order === 0 ? 'warn' : order === 1 ? 'accent' : 'neutral'} />
                    <div style={{ fontFamily: 'Archivo, sans-serif', fontSize: 14, fontWeight: 800, color: 'var(--color-admin-text)' }}>
                      {r.name}
                    </div>
                    {r.tier && (
                      <span className="admin-pill admin-pill--outline" style={{ fontSize: 9.5 }}>
                        {t(`admin.leaderboard.tiers.${r.tier}`, r.tier)}
                      </span>
                    )}
                  </div>
                  <div
                    className="flex flex-col items-center justify-center text-white font-extrabold"
                    style={{ height: `clamp(${mobileH}px, ${h * 0.6}px + 5vw, ${h}px)`, borderRadius: '14px 14px 6px 6px', background: bg, padding: '10px 8px' }}
                  >
                    <div style={{ fontFamily: 'Archivo, sans-serif', fontSize: 'clamp(15px, 4vw, 22px)', lineHeight: 1 }} className="admin-mono">
                      {formatScore(r)}
                    </div>
                    <div className="hidden sm:block" style={{ fontSize: 11, letterSpacing: 0.8, opacity: 0.8, marginTop: 4 }}>{scoreLabel.toUpperCase()}</div>
                    <div style={{ fontFamily: 'Archivo, sans-serif', fontSize: 'clamp(20px, 5vw, 32px)', fontWeight: 800, marginTop: 6 }}>{order + 1}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </FadeIn>
      )}

      {/* Ranked list */}
      <FadeIn>
        <div className="admin-card overflow-hidden" style={{ padding: 0 }}>
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : isError ? (
            <div className="p-4"><ErrorCard message={t('common:failedToLoadData')} onRetry={refetch} /></div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <Trophy size={28} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.leaderboard.noData', 'No data yet for this period')}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <div
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: '40px 1fr 1.5fr 110px',
                    padding: '11px 16px',
                    background: 'var(--color-admin-panel)',
                    borderBottom: '1px solid var(--color-admin-border)',
                  }}
                >
                  <span className="admin-eyebrow">#</span>
                  <span className="admin-eyebrow">{t('admin.leaderboard.member', 'Member')}</span>
                  <span className="admin-eyebrow">{columnUnit}</span>
                  <span />
                </div>
                {entries.map((e, i) => (
                  <div
                    key={e.id}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: '40px 1fr 1.5fr 110px',
                      padding: '11px 16px',
                      borderBottom: i === entries.length - 1 ? 'none' : '1px solid var(--color-admin-border)',
                    }}
                  >
                    <span className="admin-mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-admin-text-muted)' }}>
                      {i + 1}
                    </span>
                    <div className="flex gap-2.5 items-center">
                      <Avatar name={e.name} size="sm" variant={i < 3 ? 'accent' : 'neutral'} />
                      <div>
                        <div className="text-[13px] font-bold" style={{ color: i < 3 ? 'var(--color-accent)' : 'var(--color-admin-text)' }}>
                          {e.name}
                        </div>
                        {e.tier && (
                          <div className="text-[10.5px] font-semibold" style={{ color: 'var(--color-admin-text-muted)' }}>
                            {t(`admin.leaderboard.tiers.${e.tier}`, e.tier)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-admin-panel)', maxWidth: 280 }}>
                        <div
                          className="h-full"
                          style={{
                            width: `${entries[0]?.score ? Math.round((e.score / entries[0].score) * 100) : 0}%`,
                            background: 'linear-gradient(90deg, var(--color-accent), var(--color-coach))',
                            opacity: e.score ? 1 : 0,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      className="admin-mono text-right"
                      style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-admin-text)' }}
                    >
                      {formatScore(e)}
                      {!['improved', 'consistency'].includes(metric) && (
                        <span className="text-[11px] font-normal ml-1" style={{ color: 'var(--color-admin-text-muted)' }}>{scoreLabel}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Mobile card list */}
              <div className="md:hidden">
                {entries.map((e, i) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 px-3 py-3"
                    style={{
                      borderBottom: i === entries.length - 1 ? 'none' : '1px solid var(--color-admin-border)',
                    }}
                  >
                    <span
                      className="admin-mono flex-shrink-0 w-6 text-center"
                      style={{ fontSize: 13, fontWeight: 800, color: i < 3 ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }}
                    >
                      {i + 1}
                    </span>
                    <Avatar name={e.name} size="sm" variant={i < 3 ? 'accent' : 'neutral'} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold truncate" style={{ color: i < 3 ? 'var(--color-accent)' : 'var(--color-admin-text)' }}>
                        {e.name}
                      </div>
                      {e.tier && (
                        <div className="text-[10.5px] font-semibold" style={{ color: 'var(--color-admin-text-muted)' }}>
                          {t(`admin.leaderboard.tiers.${e.tier}`, e.tier)}
                        </div>
                      )}
                    </div>
                    <span
                      className="admin-mono text-right flex-shrink-0"
                      style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-admin-text)' }}
                    >
                      {formatScore(e)}
                      {!['improved', 'consistency'].includes(metric) && (
                        <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--color-admin-text-muted)' }}>{scoreLabel}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </FadeIn>

      <p className="text-[11px] text-center mt-3" style={{ color: 'var(--color-admin-text-faint)' }}>
        {t('admin.leaderboard.realtimeHint', 'Updates in real time as members log workouts')}
      </p>
    </AdminPageShell>
  );
}

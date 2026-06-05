import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import { FadeIn, AdminPageShell, ErrorCard } from '../../components/admin';
import { TK, FK, Ico, ICON, Card, GhostBtn } from './components/retosKit';

const METRIC_KEYS = ['volume', 'workouts', 'pr_count', 'checkins', 'improved', 'consistency'];
const PERIOD_KEYS = ['7', '30', 'all'];
const TIER_KEYS = ['all', 'beginner', 'intermediate', 'advanced'];

// metric → kit icon (matches the Clasificación mock's METRICS icon assignment)
const METRIC_ICON = {
  volume: ICON.dumbbell,
  workouts: ICON.checkin,
  pr_count: ICON.trophy,
  checkins: ICON.target,
  improved: ICON.trend,
  consistency: ICON.steady,
};

const eyebrow = { fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: TK.textFaint };
const COLS = '56px 1fr minmax(200px,1.1fr) 150px';
const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase();

// rank token — gold/silver/bronze medal for top 3, mono number otherwise
function RankToken({ n }) {
  const med = {
    1: { c: '#E0A82E', bg: 'color-mix(in srgb, #E0A82E 18%, transparent)' },
    2: { c: '#9AA4AE', bg: 'color-mix(in srgb, #9AA4AE 22%, transparent)' },
    3: { c: '#C77B3E', bg: 'color-mix(in srgb, #C77B3E 18%, transparent)' },
  }[n];
  if (med) return (
    <span style={{ width: 30, height: 30, borderRadius: 99, background: med.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Ico ch={ICON.medal} size={17} color={med.c} stroke={2} />
    </span>
  );
  return <span style={{ width: 30, textAlign: 'center', fontFamily: FK.mono, fontSize: 14, fontWeight: 700, color: TK.textFaint }}>{n}</span>;
}

// peach accent-tinted avatar; leader variant gets a gradient + stronger ring
function CAvatar({ initials, size = 40, lead = false }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center',
      background: lead
        ? 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 22%, transparent), color-mix(in srgb, var(--color-accent) 36%, transparent))'
        : 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
      color: 'var(--color-accent)', fontFamily: FK.display, fontSize: size * 0.4, fontWeight: 800,
      boxShadow: lead
        ? '0 2px 8px color-mix(in srgb, var(--color-accent) 28%, transparent), inset 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 26%, transparent)'
        : 'inset 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 16%, transparent)',
    }}>{initials}</span>
  );
}

// labelled pill segmented filter (Período / Nivel)
function FilterGroup({ label, items, activeKey, onPick, disabledKeys = [], disabledTitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
      <span style={{ ...eyebrow, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ display: 'inline-flex', gap: 7, background: TK.surface3, padding: 4, borderRadius: 999, border: `1px solid ${TK.borderSolid}`, flexWrap: 'wrap' }}>
        {items.map(it => {
          const on = it.key === activeKey;
          const dis = disabledKeys.includes(it.key);
          return (
            <button key={it.key} type="button" disabled={dis} title={dis ? disabledTitle : undefined}
              onClick={() => { if (!dis) onPick(it.key); }} style={{
                padding: '8px 15px', borderRadius: 999, border: 'none', cursor: dis ? 'not-allowed' : 'pointer', fontFamily: FK.body, fontSize: 13.5,
                fontWeight: on ? 700 : 600, whiteSpace: 'nowrap', opacity: dis ? 0.4 : 1,
                color: on ? '#fff' : (dis ? TK.textFaint : TK.textSub),
                background: on ? TK.accent : 'transparent',
                boxShadow: on ? '0 2px 8px color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'none',
              }}>{it.label}</button>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminLeaderboard() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const [metric, setMetric] = useState('volume');
  const [period, setPeriod] = useState('30');
  const [tier, setTier]     = useState('all');
  const [metricOpen, setMetricOpen] = useState(false);

  useEffect(() => { document.title = `${t('admin.leaderboard.title', 'Admin - Leaderboard')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Clamp period for boards that don't support all-time
  const effectivePeriod = (['improved', 'consistency'].includes(metric) && period === 'all') ? '30' : period;
  const from = effectivePeriod !== 'all' ? subDays(new Date(), parseInt(effectivePeriod)).toISOString() : null;
  const tierParam = tier === 'all' ? null : tier;
  const periodLabel = effectivePeriod === '7' ? 'weekly' : 'monthly';

  // ── Fetch leaderboard ──
  const { data: entries = [], isLoading, isError, refetch, isFetching } = useQuery({
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

  const formatScore = (e) => {
    if (metric === 'improved') return `+${e.score}%`;
    if (metric === 'consistency') return `${e.score}%`;
    return e.score.toLocaleString();
  };
  const showUnit = !['improved', 'consistency'].includes(metric);

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

  const renderLead = (e, i) => {
    const lead = i === 0;
    const pct = entries[0]?.score ? Math.max(0, Math.min(100, Math.round((e.score / entries[0].score) * 100))) : 0;
    const tierLabel = e.tier ? t(`admin.leaderboard.tiers.${e.tier}`, e.tier) : null;
    return (
      <div key={e.id} style={{
        display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 18, padding: '17px 22px', position: 'relative',
        background: lead ? 'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-card)), var(--color-bg-card) 60%)' : 'transparent',
        borderTop: `1px solid ${TK.divider}`,
      }}>
        {lead && <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3.5, borderRadius: 99, background: TK.accent }} />}
        <div style={{ display: 'flex', justifyContent: 'center' }}><RankToken n={i + 1} /></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
          <div style={{ position: 'relative' }}>
            <CAvatar initials={initialOf(e.name)} size={lead ? 44 : 40} lead={lead} />
            {lead && <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%) rotate(-8deg)' }}>
              <Ico ch={ICON.crown} size={18} color="#E0A82E" stroke={2} /></span>}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FK.display, fontSize: lead ? 17 : 16, fontWeight: 800, color: TK.accent, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
            {tierLabel && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: TK.textFaint }} />
                <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: TK.textMute }}>{tierLabel}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 11, borderRadius: 99, background: TK.surface3, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 99, opacity: e.score ? 1 : 0, background: 'linear-gradient(90deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 60%, var(--color-coach)) 50%, var(--color-coach) 100%)' }} />
        </div>

        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: FK.display, fontSize: lead ? 23 : 20, fontWeight: 800, color: TK.text, letterSpacing: -0.5 }}>{formatScore(e)}</span>
          {showUnit && <span style={{ fontFamily: FK.mono, fontSize: 12, fontWeight: 600, color: TK.textFaint, marginLeft: 6 }}>{scoreLabel}</span>}
        </div>
      </div>
    );
  };

  const renderMobile = (e, i) => {
    const tierLabel = e.tier ? t(`admin.leaderboard.tiers.${e.tier}`, e.tier) : null;
    return (
      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: i === 0 ? 'none' : `1px solid ${TK.divider}` }}>
        <RankToken n={i + 1} />
        <CAvatar initials={initialOf(e.name)} size={36} lead={i === 0} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 14.5, fontWeight: 800, color: TK.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
          {tierLabel && <div style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute, marginTop: 2 }}>{tierLabel}</div>}
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text }}>{formatScore(e)}</span>
          {showUnit && <span style={{ fontFamily: FK.mono, fontSize: 11, fontWeight: 600, color: TK.textFaint, marginLeft: 5 }}>{scoreLabel}</span>}
        </div>
      </div>
    );
  };

  return (
    <AdminPageShell>
      {/* header */}
      <div data-admin-tour="leaderboard" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.leaderboard.title', 'Leaderboard')}</h1>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--color-success)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-success) 18%, transparent)' }} />
            <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub }}>{t('admin.leaderboard.subtitle', 'Live gym rankings')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <GhostBtn icon={ICON.download} accentIcon onClick={handleExport}>{t('admin.leaderboard.export')}</GhostBtn>
          <button type="button" onClick={() => refetch()} disabled={isFetching} aria-label={t('admin.leaderboard.refresh', 'Refresh')}
            style={{ width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', cursor: isFetching ? 'default' : 'pointer', background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow, opacity: isFetching ? 0.65 : 1 }}>
            <span className={isFetching ? 'animate-spin' : undefined} style={{ display: 'grid', placeItems: 'center' }}>
              <Ico ch={ICON.refresh} size={17} color={TK.textMute} stroke={2.1} />
            </span>
          </button>
        </div>
      </div>

      {/* "Ordenado por" + metric dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24, flexWrap: 'wrap' }}>
        <span style={eyebrow}>{t('admin.leaderboard.rankedBy', 'Ranked by')}</span>
        <div style={{ position: 'relative' }}>
          <button type="button" onClick={() => setMetricOpen(o => !o)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderRadius: 12, cursor: 'pointer', minWidth: 230,
            background: TK.surface, border: `1.5px solid ${metricOpen ? TK.accent : TK.borderSolid}`,
            boxShadow: metricOpen ? `0 0 0 3px color-mix(in srgb, var(--color-accent) 12%, transparent), ${TK.shadow}` : TK.shadow,
          }}>
            <Ico ch={METRIC_ICON[metric]} size={17} color={TK.accent} stroke={2} />
            <span style={{ flex: 1, textAlign: 'left', fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text }}>{metricLabel}</span>
            <Ico ch={metricOpen ? ICON.chevU : ICON.chevD} size={16} color={TK.textMute} stroke={2.4} />
          </button>
          {metricOpen && (
            <>
              <div onClick={() => setMetricOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 41, width: 300, background: TK.surface, borderRadius: 14, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadowLg, padding: 7 }}>
                {METRIC_KEYS.map(k => {
                  const on = k === metric;
                  return (
                    <button key={k} type="button" onClick={() => { setMetric(k); setMetricOpen(false); }} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', border: 'none',
                      background: on ? TK.accentWash : 'transparent',
                    }}>
                      <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: on ? TK.accentSoft : TK.surface2, border: `1px solid ${on ? TK.accentLine : TK.borderSolid}` }}>
                        <Ico ch={METRIC_ICON[k]} size={16} color={on ? TK.accent : TK.textMute} stroke={2} />
                      </span>
                      <span style={{ flex: 1, textAlign: 'left', fontFamily: FK.body, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? TK.accentInk : TK.text }}>{t(`admin.leaderboard.metrics.${k}`, k)}</span>
                      {on && <Ico ch={ICON.check} size={17} color={TK.accent} stroke={2.6} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Período / Nivel filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 30, marginTop: 20, flexWrap: 'wrap' }}>
        <FilterGroup
          label={t('admin.leaderboard.periodLabel', 'Period')}
          items={PERIOD_KEYS.map(k => ({ key: k, label: t(`admin.leaderboard.periods.${k}`, k) }))}
          activeKey={effectivePeriod}
          onPick={setPeriod}
          disabledKeys={['improved', 'consistency'].includes(metric) ? ['all'] : []}
          disabledTitle={t('admin.leaderboard.allTimeUnavailable', 'All-time isn’t available for this metric')}
        />
        <FilterGroup
          label={t('admin.leaderboard.tierLabel', 'Tier')}
          items={TIER_KEYS.map(k => ({ key: k, label: t(`admin.leaderboard.tiers.${k}`, k) }))}
          activeKey={tier}
          onPick={setTier}
        />
      </div>

      {/* count context + live */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
        {!isLoading && entries.length > 0 && totalMembers != null ? (
          <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>
            {t('admin.leaderboard.showingContext', { defaultValue: 'Showing top {{count}} of {{total}} members', count: entries.length, total: totalMembers })}
          </span>
        ) : <span />}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: 'var(--color-success)' }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--color-success)' }} />{t('admin.leaderboard.live', 'Live')}
        </span>
      </div>

      {/* leaderboard */}
      <FadeIn>
        <Card style={{ overflow: 'hidden', marginTop: 16 }}>
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
              <span className="animate-spin" style={{ width: 30, height: 30, borderRadius: 99, border: `3px solid ${TK.borderSolid}`, borderTopColor: TK.accent, display: 'inline-block' }} />
            </div>
          ) : isError ? (
            <div style={{ padding: 16 }}><ErrorCard message={t('common:failedToLoadData')} onRetry={refetch} /></div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 0' }}>
              <Ico ch={ICON.trophy} size={30} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 10px' }} />
              <p style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, margin: 0 }}>{t('admin.leaderboard.noData', 'No data yet for this period')}</p>
            </div>
          ) : (
            <>
              {/* desktop */}
              <div className="hidden md:block">
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 18, padding: '14px 22px', background: TK.surface2 }}>
                  <div style={{ textAlign: 'center', fontFamily: FK.mono, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: TK.textFaint }}>#</div>
                  <div style={eyebrow}>{t('admin.leaderboard.member', 'Member')}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Ico ch={METRIC_ICON[metric]} size={13} color={TK.textMute} stroke={2} />
                    <span style={eyebrow}>{metricLabel}</span>
                  </div>
                  <div style={{ ...eyebrow, textAlign: 'right' }}>{scoreLabel}</div>
                </div>
                {entries.map((e, i) => renderLead(e, i))}
              </div>
              {/* mobile */}
              <div className="md:hidden">
                {entries.map((e, i) => renderMobile(e, i))}
              </div>
            </>
          )}
        </Card>
      </FadeIn>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 }}>
        <Ico ch={ICON.bolt} size={14} color={TK.textFaint} stroke={2} />
        <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textFaint, textAlign: 'center' }}>{t('admin.leaderboard.realtimeHint', 'Updates in real time as members log workouts')}</span>
      </div>
    </AdminPageShell>
  );
}

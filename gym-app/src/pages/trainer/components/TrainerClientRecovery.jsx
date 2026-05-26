import { useEffect, useState } from 'react';
import { Activity, Flame, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { computeReadiness, computeDashboardReadiness } from '../../../lib/readinessEngine';
import { TT, TFont } from './designTokens';

// readiness region id → major muscle group
const GROUP_OF = {
  upper_chest: 'chest', mid_chest: 'chest', lower_chest: 'chest', serratus: 'chest',
  upper_back: 'back', mid_back: 'back', lats: 'back', lower_back: 'back', traps: 'back',
  quads: 'legs', hamstrings: 'legs', glutes: 'legs', glute_med: 'legs', calves: 'legs',
  soleus: 'legs', tibialis: 'legs', abductors: 'legs', adductors: 'legs', hip_flexors: 'legs',
  front_delts: 'shoulders', side_delts: 'shoulders', rear_delts: 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms', brachialis: 'arms',
  upper_abs: 'core', mid_abs: 'core', lower_abs: 'core', obliques: 'core', abs: 'core',
};
const GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];

// Trainer-facing recovery + "what to train" panel. Pulls the client's recent
// training load + latest soreness + goal via get_client_recovery, reuses the
// member readiness engine so the number matches what the client sees, then
// surfaces which muscle groups are BURNT (recovering) vs MISSING (not trained
// this week — i.e. what to program next toward the client's goal).
export default function TrainerClientRecovery({ clientId }) {
  const { t } = useTranslation('pages');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: r, error } = await supabase.rpc('get_client_recovery', { p_client_id: clientId });
        if (cancelled) return;
        if (error) throw error;
        setData(r || {});
      } catch (e) {
        logger.error(e);
        if (!cancelled) setData({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading || !data) return null;

  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const soreness = typeof data.soreness === 'number' ? data.soreness : null;
  const goal = data.goal || null;
  const score = computeDashboardReadiness({ sessions, recoveryMetrics: null, soreness });
  const map = computeReadiness(sessions, { windowDays: 7 });

  // Aggregate per-region readiness into major groups.
  const agg = {};
  GROUPS.forEach(g => { agg[g] = { sets: 0, recW: 0 }; });
  for (const [id, r] of map.entries()) {
    const g = GROUP_OF[id];
    if (!g) continue;
    agg[g].sets += r.sets;
    if (r.sets > 0) agg[g].recW += r.recovery * r.sets;
  }
  const groups = GROUPS.map(g => ({
    g,
    sets: agg[g].sets,
    recovery: agg[g].sets > 0 ? Math.round(agg[g].recW / agg[g].sets) : null,
  }));
  const burnt = groups.filter(x => x.sets >= 1 && x.recovery != null && x.recovery < 60)
    .sort((a, b) => a.recovery - b.recovery).slice(0, 3);
  const missing = groups.filter(x => x.sets < 1);

  const tone = score >= 80 ? TT.good : score >= 50 ? TT.warn : TT.hot;
  const groupLabel = (g) => t(`trainerRecovery.group.${g}`, g);

  return (
    <>
      <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.2, marginBottom: 8 }}>
        {t('trainerRecovery.title', 'Recovery')}
      </div>
      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 18, boxShadow: TT.shadow, padding: 14, marginBottom: 14 }}>
        {/* Score + status + goal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: `color-mix(in srgb, ${tone} 14%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: TFont.display, fontWeight: 900, fontSize: 22, letterSpacing: -1, color: tone, lineHeight: 1 }}>{score}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={13} style={{ color: tone }} />
              <span style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 15, color: TT.text, letterSpacing: -0.3 }}>
                {score >= 80 ? t('trainerRecovery.ready', 'Ready') : score >= 50 ? t('trainerRecovery.moderate', 'Moderate') : t('trainerRecovery.fatigued', 'Fatigued')}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>
              {t('trainerRecovery.last14', '{{n}} sessions · 14 days', { n: sessions.length })}
              {soreness != null && ` · ${t('trainerRecovery.soreness', 'soreness {{s}}/10', { s: soreness })}`}
            </div>
            {goal && (
              <div style={{ marginTop: 5, display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: 0.3, color: TT.accentInk, background: TT.accentSoft, padding: '3px 8px', borderRadius: 999 }}>
                {t('trainerRecovery.goalLabel', 'Goal')}: {t(`trainerRecovery.goal.${goal}`, goal)}
              </div>
            )}
          </div>
        </div>

        {sessions.length === 0 ? (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}`, fontSize: 12.5, color: TT.textSub, lineHeight: 1.4 }}>
            {t('trainerRecovery.noSessions', 'No sessions logged in 14 days — check in with this client.')}
          </div>
        ) : (
          <>
            {/* Burnt — recovering, ease off */}
            {burnt.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
                  <Flame size={12} style={{ color: TT.hot }} />
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.hot, textTransform: 'uppercase' }}>{t('trainerRecovery.burnt', 'Burnt — let it recover')}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {burnt.map(x => (
                    <span key={x.g} style={{ fontSize: 11.5, fontWeight: 700, color: TT.hot, background: TT.hotSoft, padding: '4px 9px', borderRadius: 999 }}>
                      {groupLabel(x.g)} · {x.recovery}%
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing — not trained this week, program next */}
            {missing.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
                  <Plus size={12} style={{ color: TT.accentInk }} />
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.accentInk, textTransform: 'uppercase' }}>{t('trainerRecovery.missing', 'Missing — train next')}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {missing.map(x => (
                    <span key={x.g} style={{ fontSize: 11.5, fontWeight: 700, color: TT.accentInk, background: TT.accentSoft, padding: '4px 9px', borderRadius: 999 }}>
                      {groupLabel(x.g)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

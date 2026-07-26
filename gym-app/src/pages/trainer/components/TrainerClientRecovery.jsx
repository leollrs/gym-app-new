import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Flame, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { computeReadiness, computeDashboardReadiness, aggregateRegions, bucketExerciseBreakdown } from '../../../lib/readinessEngine';
import { BUCKET_BY_ID, STATE_HEX } from '../../../lib/readinessBuckets';
import { exName } from '../../../lib/exerciseName';
import MuscleFigure from '../../../components/MuscleFigure';
import ExerciseVideoThumb from '../../../components/ExerciseVideoThumb';
import { useScrollLock } from '../../../hooks/useScrollLock';
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
export default function TrainerClientRecovery({ clientId, hideHeader = false }) {
  const { t } = useTranslation('pages');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState(null);
  // Freeze the page behind the portaled bucket-detail sheet.
  useScrollLock(!!selectedBucket);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: r, error } = await supabase.rpc('get_client_recovery', { p_client_id: clientId });
        if (cancelled) return;
        if (error) throw error;
        setData(r || {});
        setFailed(false);
      } catch (e) {
        logger.error(e);
        // A failed read must NOT fall through to the {} fallback — that
        // renders a fake "Ready · 100". Quiet "—" state instead.
        if (!cancelled) { setData(null); setFailed(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return null;

  if (failed || !data) {
    return (
      <>
        {!hideHeader && (
          <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.2, marginBottom: 8 }}>
            {t('trainerRecovery.title', 'Recovery')}
          </div>
        )}
        <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 18, boxShadow: TT.shadow, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: TT.surface2, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: TFont.display, fontWeight: 900, fontSize: 22, letterSpacing: -1, color: TT.textMute, lineHeight: 1 }}>—</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 14, color: TT.textSub, letterSpacing: -0.2 }}>
                {t('trainerRecovery.unavailable', 'Recovery unavailable')}
              </div>
              <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>
                {t('trainerRecovery.unavailableHint', "Couldn't load this client's recovery data right now.")}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

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
      {!hideHeader && (
        <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.2, marginBottom: 8 }}>
          {t('trainerRecovery.title', 'Recovery')}
        </div>
      )}
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

        {/* Muscle map — same anatomical visualization the client sees */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
          <MuscleFigure readiness={map} accent={TT.accent} labels={{ front: t('trainerRecovery.front', 'Front'), back: t('trainerRecovery.back', 'Back') }} onMuscleTap={setSelectedBucket} selectedBucketId={selectedBucket} />
          <p style={{ textAlign: 'center', fontSize: 10.5, color: TT.textMute, marginTop: 6 }}>{t('trainerRecovery.tapHint', 'Tap a muscle to see this week’s work')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 10 }}>
            {[['fresh', '#3DAD7C', 'Fresh'], ['moderate', '#E0A042', 'Recovering'], ['fatigued', '#E26B5C', 'Sore'], ['rest', '#9CA3AB', 'Untrained']].map(([k, c, def]) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: TT.textSub, fontWeight: 600 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} /> {t(`trainerRecovery.state.${k}`, def)}
              </span>
            ))}
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

      {/* Muscle drill-down — what the client actually trained for this muscle this
          week + the recovery effect, so the coach can plan the next session. */}
      {selectedBucket && (() => {
        const bucket = BUCKET_BY_ID.get(selectedBucket);
        if (!bucket) return null;
        const agg = aggregateRegions(map, bucket.regionIds);
        const bd = bucketExerciseBreakdown(sessions, bucket.regionIds, { windowDays: 7 });
        const trained = bd.totalSets > 0;
        const stateColor = STATE_HEX[agg.state] || STATE_HEX.rest;
        const stateLabel = !trained ? t('trainerRecovery.state.rest', 'Untrained')
          : agg.state === 'moderate' ? t('trainerRecovery.state.moderate', 'Recovering')
          : agg.state === 'fatigued' ? t('trainerRecovery.state.fatigued', 'Sore')
          : t('trainerRecovery.state.fresh', 'Fresh');
        const daysAgo = trained && Number.isFinite(agg.daysSince) ? Math.round(agg.daysSince) : null;
        return createPortal(
          <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 16 }} onClick={() => setSelectedBucket(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: TT.bg, borderRadius: 22, border: `1px solid ${TT.borderSolid}`, width: '100%', maxWidth: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>{t(`readinessBuckets.${bucket.id}`, bucket.label)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: stateColor }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: TT.textSub }}>
                      {stateLabel}{trained && ` · ${agg.recovery}%`}{daysAgo != null ? ` · ${t('trainerRecovery.trainedAgo', { defaultValue: '{{d}}d ago', d: daysAgo })}` : ''}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedBucket(null)} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}><X size={16} /></button>
              </div>
              <div style={{ overflowY: 'auto', padding: 16 }}>
                {trained ? (
                  <>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                      <div style={{ flex: 1, background: TT.surface2, borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ fontFamily: TFont.display, fontSize: 20, fontWeight: 900, color: TT.text, lineHeight: 1 }}>{Math.round(bd.totalSets)}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>{t('trainerRecovery.setsThisWeek', 'Sets this week')}</div>
                      </div>
                      <div style={{ flex: 1, background: TT.surface2, borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ fontFamily: TFont.display, fontSize: 20, fontWeight: 900, color: TT.text, lineHeight: 1 }}>{bd.totalVolume.toLocaleString()}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>{t('trainerRecovery.volumeLbs', 'Volume (lbs)')}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: TT.textSub, textTransform: 'uppercase', marginBottom: 8 }}>{t('trainerRecovery.exercisesDone', 'What they trained')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {bd.exercises.map((e) => (
                        <div key={e.exerciseId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 9px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}` }}>
                          <ExerciseVideoThumb exercise={{ videoUrl: e.exercise?.videoUrl, muscle: e.exercise?.muscle }} size={38} radius={10} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exName(e.exercise) || t('trainerNotes.overview.unknownExercise', 'Exercise')}</div>
                            <div style={{ fontSize: 11, color: TT.textSub }}>{e.sets} {t('trainerRecovery.setsShort', 'sets')} · {Math.round(e.volume).toLocaleString()} {t('trainerRecovery.lbs', 'lbs')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 10.5, color: TT.textMute, marginTop: 12, lineHeight: 1.4 }}>{t('trainerRecovery.effectHint', 'Recovery reflects this load plus days since — plan the next session around it.')}</p>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px 8px' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, marginBottom: 4 }}>{t('trainerRecovery.notTrainedTitle', 'Not trained this week')}</div>
                    <p style={{ fontSize: 12, color: TT.textSub, lineHeight: 1.5 }}>{t('trainerRecovery.notTrainedBody', 'No logged work hit this muscle in the last 7 days — a good candidate to program next.')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}

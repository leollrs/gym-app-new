import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Check, Edit3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { TT, TFont, avatarIdx } from './components/designTokens';
import { TAvatar } from './components/designPrimitives';

// ────────────────────────────────────────────────────────────────────
// TrainerLiveSession — live view + coaching cues for a client's
// in-progress workout. Subscribes to Supabase realtime on the client's
// session_drafts row to mirror their state. The coach toolbar fires
// `trainer_send_cue` RPCs (migration 0357) that land in the member's
// ActiveSession via realtime on session_cues.
//
// Bidirectional set logging (writing to the member's session_drafts on
// their behalf) is still off — that's high-risk and needs more thought.
// ────────────────────────────────────────────────────────────────────

const ELAPSED_TICK_MS = 1000;

function formatElapsed(seconds) {
  if (!seconds || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function TrainerLiveSession() {
  const { sessionId } = useParams(); // route: /trainer/live/:sessionId  (we treat this as profile_id of the client)
  const navigate = useNavigate();
  // useAuth() is intentionally consumed for the side-effect of ensuring a
  // valid trainer session is loaded; the profile itself is not used here.
  useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');

  const [client, setClient] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // forces elapsed re-render
  const tickRef = useRef();
  // Mirror the current routine id into a ref so the realtime subscription can
  // compare against incoming draft updates WITHOUT taking `routine` as a
  // dependency — see the subscription effect below.
  const routineIdRef = useRef(null);
  useEffect(() => { routineIdRef.current = routine?.id ?? null; }, [routine?.id]);

  // Hide bottom nav while live session is active
  useEffect(() => {
    document.body.classList.add('live-session-active');
    return () => document.body.classList.remove('live-session-active');
  }, []);

  // Document title
  useEffect(() => {
    document.title = t('trainerLive.documentTitle', 'Live session');
  }, [t]);

  // Fetch client profile + their active draft
  const loadSession = useMemo(() => async () => {
    if (!sessionId) return;
    try {
      // Defense-in-depth: confirm this client is actually assigned to this trainer
      // before exposing any session data. RLS should already enforce this, but a
      // direct check gives a clearer redirect when a trainer hits the URL of a
      // non-assigned member.
      const { data: assignment } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('client_id', sessionId)
        .eq('is_active', true)
        .maybeSingle();
      if (!assignment) {
        setClient(null);
        setDraft(null);
        setRoutine(null);
        setLoading(false);
        return;
      }

      const { data: clientProfile } = await supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
        .eq('id', sessionId)
        .maybeSingle();
      setClient(clientProfile);

      const { data: draftRow } = await supabase
        .from('session_drafts')
        .select('routine_id, logged_sets, current_exercise_index, elapsed_time, started_at, is_paused, updated_at')
        .eq('profile_id', sessionId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (draftRow?.routine_id) {
        setDraft(draftRow);
        const { data: r } = await supabase
          .from('routines')
          .select(`
            id, name,
            routine_exercises(
              exercise_id, position, target_sets, target_reps, rest_seconds,
              exercises(id, name, name_es)
            )
          `)
          .eq('id', draftRow.routine_id)
          .maybeSingle();
        if (r?.routine_exercises) {
          r.routine_exercises.sort((a, b) => a.position - b.position);
        }
        setRoutine(r);
      } else {
        setDraft(null);
        setRoutine(null);
      }
    } catch (err) {
      logger.error('TrainerLiveSession: load failed', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Realtime subscription on session_drafts for this client
  useEffect(() => {
    if (!sessionId) return undefined;
    const channel = supabase
      .channel(`trainer-live-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_drafts', filter: `profile_id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setDraft(null);
            return;
          }
          const next = payload.new;
          if (next?.routine_id) {
            setDraft(prev => ({ ...(prev || {}), ...next }));
            // If routine_id changed, refetch routine. Otherwise just keep latest
            // draft. Read the current routine id from a ref so this handler
            // doesn't need `routine` in the effect deps.
            if (routineIdRef.current !== next.routine_id) loadSession();
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // Subscribe ONCE per session. `routine` was previously a dep, which tore
    // down + recreated the WebSocket channel on every routine change — socket
    // churn that could thrash re-renders and, on flaky native sockets, reset
    // the app. `loadSession` is a useMemo keyed on [sessionId], so it's stable.
  }, [sessionId, loadSession]);

  // Elapsed ticker (1s) — drift-free re-render based on started_at
  useEffect(() => {
    if (!draft?.started_at || draft?.is_paused) return undefined;
    tickRef.current = setInterval(() => setTick(n => n + 1), ELAPSED_TICK_MS);
    return () => clearInterval(tickRef.current);
  }, [draft?.started_at, draft?.is_paused]);

  // ── Derive view state ─────────────
  const exercises = routine?.routine_exercises || [];
  const exerciseCount = exercises.length;
  const currentExIdx = Math.min(draft?.current_exercise_index ?? 0, Math.max(0, exerciseCount - 1));
  const currentEx = exercises[currentExIdx] || null;
  const currentExName = currentEx?.exercises?.name_es || currentEx?.exercises?.name || '—';

  // Sets-completed counts
  const totalTargetSets = exercises.reduce((sum, ex) => sum + (ex.target_sets || 0), 0);
  const loggedSetsObj = draft?.logged_sets || {};
  const completedSets = Object.values(loggedSetsObj).reduce(
    (sum, sets) => sum + (Array.isArray(sets) ? sets.filter(s => s?.completed && !s?.skipped).length : 0),
    0
  );
  const progressPct = totalTargetSets > 0 ? (completedSets / totalTargetSets) * 100 : 0;

  // Sets for the currently-displayed exercise
  const currentSets = (currentEx && Array.isArray(loggedSetsObj[currentEx.exercise_id]))
    ? loggedSetsObj[currentEx.exercise_id]
    : [];
  const targetSetsForCurrent = currentEx?.target_sets || 0;
  const setRows = Array.from({ length: targetSetsForCurrent }, (_, i) => {
    const logged = currentSets[i];
    return {
      n: i + 1,
      w: logged?.weight ?? '—',
      r: logged?.reps ?? '—',
      rpe: logged?.rpe ?? '—',
      done: !!(logged?.completed && !logged?.skipped),
      current: !logged?.completed && (i === 0 || currentSets[i - 1]?.completed),
    };
  });

  const currentSetIdx = setRows.findIndex(s => s.current);
  const currentSetN = currentSetIdx >= 0 ? setRows[currentSetIdx].n : (setRows.length || 1);

  // Up next list
  const upNext = exercises.slice(currentExIdx + 1, currentExIdx + 5).map((ex, i) => ({
    n: currentExIdx + 2 + i,
    name: ex.exercises?.name_es || ex.exercises?.name || '—',
    spec: `${ex.target_sets} × ${ex.target_reps || '—'}`,
  }));

  // Live-elapsed math.
  // The member persists `elapsed_time` as their cumulative pause-aware seconds
  // up to `updated_at`. So the trainer's clock = (now - updated_at) + that
  // saved value. The original code used `started_at` instead of `updated_at`
  // and double-counted, which made the timer drift far ahead of reality.
  const elapsedSec = useMemo(() => {
    void tick;
    const stored = draft?.elapsed_time || 0;
    if (!draft?.updated_at) return stored;
    if (draft?.is_paused) return stored;
    const updatedMs = new Date(draft.updated_at).getTime();
    return stored + Math.floor((Date.now() - updatedMs) / 1000);
  }, [draft?.updated_at, draft?.is_paused, draft?.elapsed_time, tick]);

  // ── Coach toolbar handlers — fire trainer_send_cue RPC ────────────────
  const [sending, setSending] = useState(false);
  const sendCue = async (cueType, payload, label) => {
    if (!sessionId || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc('trainer_send_cue', {
        p_client_id: sessionId,
        p_cue_type:  cueType,
        p_payload:   payload || null,
      });
      if (error) {
        logger.error('trainer_send_cue failed', error);
        showToast(t('trainerLive.cueFailed', 'Could not send cue'), 'error');
      } else {
        showToast(t('trainerLive.cueSent', 'Cue sent to client') + ` · ${label}`, 'success');
      }
    } finally {
      setSending(false);
    }
  };

  const handleNoteCue = async () => {
    const text = window.prompt(t('trainerLive.notePrompt', 'Note for client:'));
    if (!text || !text.trim()) return;
    await sendCue('note', { text: text.trim() }, text.trim().slice(0, 24));
  };

  const clientName = client?.full_name || client?.username || t('trainerMessages.list.clientFallback', 'Client');
  const planName = routine?.name || '—';

  // ── Render ──────────────
  return (
    <div style={{
      background: TT.surfaceDk,
      minHeight: '100%',
      color: '#fff',
      paddingBottom: 100,
      fontFamily: TFont.body,
    }}>
      {/* Header strip */}
      <div style={{
        padding: '12px 16px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('trainerLive.back', 'Back')}
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,255,255,0.08)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={18} color="#fff" />
        </button>
        <TAvatar
          name={clientName}
          size={36}
          idx={avatarIdx(client?.id || sessionId)}
          src={client?.avatar_url}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {clientName}
          </div>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.6)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: TT.good }} />
            {t('trainerLive.bothViewing', 'Both viewing')} · {planName}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 999,
          background: 'rgba(255,90,46,0.15)', color: TT.hot,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: TT.hot }} />
          <span style={{ fontSize: 11, fontWeight: 800, fontFamily: TFont.mono }}>
            {formatElapsed(elapsedSec)}
          </span>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Eyebrow */}
        <div style={{
          fontSize: 11, fontWeight: 800, color: TT.accent,
          letterSpacing: 1.4, textTransform: 'uppercase',
        }}>
          {t('trainerLive.eyebrow', 'Trainer view · live')}
        </div>

        {/* Empty state — no draft */}
        {!loading && !draft && (
          <div style={{
            marginTop: 30, padding: '24px 18px',
            background: 'rgba(255,255,255,0.03)', borderRadius: 18,
            border: '1px solid rgba(255,255,255,0.08)',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 22, fontWeight: 800,
              color: '#fff', letterSpacing: -0.6, lineHeight: 1.1,
            }}>
              {t('trainerLive.noSessionTitle', 'No live session')}
            </div>
            <div style={{
              fontSize: 13, color: 'rgba(255,255,255,0.6)',
              marginTop: 8, lineHeight: 1.5,
            }}>
              {t('trainerLive.noSessionDesc', "When this client starts a workout, you'll see it here in real time.")}
            </div>
          </div>
        )}

        {loading && (
          <div style={{ marginTop: 30, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            {t('trainerLive.loading', 'Loading session…')}
          </div>
        )}

        {/* Live session view */}
        {!loading && draft && currentEx && (
          <>
            {/* Progress */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginTop: 10, marginBottom: 8,
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                {t('trainerLive.exerciseProgress', 'Exercise {{current}} of {{total}}', { current: currentExIdx + 1, total: exerciseCount })}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: TFont.mono }}>
                {t('trainerLive.setsProgress', '{{logged}}/{{total}} sets', { logged: completedSets, total: totalTargetSets })}
              </div>
            </div>
            <div style={{
              height: 4, borderRadius: 999, overflow: 'hidden',
              background: 'rgba(255,255,255,0.08)', marginBottom: 18,
            }}>
              <div style={{
                width: `${Math.min(100, progressPct)}%`, height: '100%',
                background: TT.hot,
                transition: 'width 200ms ease',
              }} />
            </div>

            {/* Current exercise hero */}
            <div style={{
              background: 'rgba(255,255,255,0.04)', borderRadius: 18, padding: 18,
              border: '1px solid rgba(255,255,255,0.08)', marginBottom: 12,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: TT.accent,
                letterSpacing: 1.4, textTransform: 'uppercase',
              }}>
                {t('trainerLive.now', 'Now')}
              </div>
              <div style={{
                fontFamily: TFont.display, fontSize: 26, fontWeight: 800,
                letterSpacing: -1, lineHeight: 1.05, marginTop: 4, color: '#fff',
              }}>
                {currentExName}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                {t('trainerLive.setsRepsSpec', '{{sets}} × {{reps}}', { sets: currentEx.target_sets, reps: currentEx.target_reps || '—' })}
              </div>

              {/* Set log */}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {setRows.map((set) => (
                  <div key={set.n} style={{
                    display: 'grid', gridTemplateColumns: '24px 1fr 1fr 1fr 32px',
                    gap: 8, padding: '10px 12px', borderRadius: 10,
                    background: set.current ? 'rgba(46,224,224,0.12)' : 'rgba(255,255,255,0.02)',
                    border: set.current ? `1px solid ${TT.accent}` : '1px solid transparent',
                    opacity: !set.done && !set.current ? 0.45 : 1,
                    alignItems: 'center',
                  }}>
                    <div style={{ fontFamily: TFont.mono, fontSize: 12, color: TT.accent, fontWeight: 800 }}>
                      S{set.n}
                    </div>
                    <div>
                      <div style={{
                        fontSize: 9, color: 'rgba(255,255,255,0.4)',
                        letterSpacing: 0.5, fontWeight: 700, textTransform: 'uppercase',
                      }}>
                        {t('trainerLive.weightShort', 'WT')}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 800, fontFamily: TFont.mono,
                        color: set.done ? '#fff' : (set.current ? TT.accent : 'rgba(255,255,255,0.3)'),
                      }}>{set.w}</div>
                    </div>
                    <div>
                      <div style={{
                        fontSize: 9, color: 'rgba(255,255,255,0.4)',
                        letterSpacing: 0.5, fontWeight: 700, textTransform: 'uppercase',
                      }}>
                        {t('trainerLive.repsShort', 'REPS')}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 800, fontFamily: TFont.mono,
                        color: set.done ? '#fff' : (set.current ? TT.accent : 'rgba(255,255,255,0.3)'),
                      }}>{set.r}</div>
                    </div>
                    <div>
                      <div style={{
                        fontSize: 9, color: 'rgba(255,255,255,0.4)',
                        letterSpacing: 0.5, fontWeight: 700, textTransform: 'uppercase',
                      }}>
                        {t('trainerLive.rpeShort', 'RPE')}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 800, fontFamily: TFont.mono,
                        color: set.done ? '#fff' : (set.current ? TT.accent : 'rgba(255,255,255,0.3)'),
                      }}>{set.rpe}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {set.done ? (
                        <Check size={16} color={TT.good} strokeWidth={2.5} />
                      ) : set.current ? (
                        <div style={{ width: 16, height: 16, borderRadius: 999, border: `2px solid ${TT.accent}` }} />
                      ) : (
                        <div style={{ width: 16, height: 16, borderRadius: 999, border: '1.5px solid rgba(255,255,255,0.15)' }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Coach toolbar */}
              <div style={{
                marginTop: 14, padding: 10, borderRadius: 10,
                background: 'rgba(46,224,224,0.06)',
                border: `1px solid ${TT.accent}33`,
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 800, color: TT.accent,
                  letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
                }}>
                  {t('trainerLive.coach', 'Coach')}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[
                    {
                      label: t('trainerLive.coachActions.dropSet', 'Drop set'),
                      onClick: () => sendCue('drop_set', {}, t('trainerLive.coachActions.dropSet', 'Drop set')),
                    },
                    {
                      label: t('trainerLive.coachActions.restPlus30', 'Rest +30s'),
                      onClick: () => sendCue('rest_extend', { seconds: 30 }, t('trainerLive.coachActions.restPlus30', 'Rest +30s')),
                    },
                    {
                      label: t('trainerLive.coachActions.restPlus60', 'Rest +60s'),
                      onClick: () => sendCue('rest_extend', { seconds: 60 }, t('trainerLive.coachActions.restPlus60', 'Rest +60s')),
                    },
                    {
                      label: t('trainerLive.coachActions.reduce10', 'Reduce 10%'),
                      onClick: () => sendCue('weight_adjust', { percent: -10 }, t('trainerLive.coachActions.reduce10', 'Reduce 10%')),
                    },
                    {
                      label: t('trainerLive.coachActions.addNote', '+ Note'),
                      onClick: handleNoteCue,
                    },
                  ].map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={sending}
                      onClick={action.onClick}
                      style={{
                        padding: '6px 10px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.06)',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                        border: 'none', cursor: sending ? 'wait' : 'pointer',
                        minHeight: 32,
                        opacity: sending ? 0.5 : 1,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Log button row — spectator-mode (disabled, full bidirectional logging is a v2 RPC) */}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  onClick={() => showToast(t('trainerLive.spectatorMode', 'Spectator mode'), 'info')}
                  title={t('trainerLive.comingSoon', 'Coming soon')}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, border: 'none',
                    background: TT.accent, color: '#06363B',
                    fontFamily: TFont.display, fontWeight: 800, fontSize: 14,
                    cursor: 'not-allowed', opacity: 0.5,
                  }}
                  aria-label={t('trainerLive.logSet', 'Log set {{n}}', { n: currentSetN })}
                >
                  {t('trainerLive.logSet', 'Log set {{n}}', { n: currentSetN })}
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={handleNoteCue}
                  style={{
                    width: 44, height: 44, borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'transparent', color: '#fff',
                    cursor: sending ? 'wait' : 'pointer',
                    opacity: sending ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  aria-label={t('trainerLive.addNote', 'Add note')}
                >
                  <Edit3 size={18} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Up next */}
            {upNext.length > 0 && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.6)',
                  letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8,
                }}>
                  {t('trainerLive.upNext', 'Up next')}
                </div>
                {upNext.map((ex) => (
                  <div key={ex.n} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', marginBottom: 6,
                    background: 'rgba(255,255,255,0.03)', borderRadius: 10,
                  }}>
                    <div style={{
                      fontFamily: TFont.mono, fontSize: 11,
                      color: TT.textMute, fontWeight: 800, width: 18,
                    }}>
                      {ex.n}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>{ex.spec}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

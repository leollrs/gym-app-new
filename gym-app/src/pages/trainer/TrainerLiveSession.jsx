import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Check, Edit3, StickyNote } from 'lucide-react';
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
// Set logging (0549): the trainer taps a set, types weight/reps and
// sends a 'set_log' cue. The member's ActiveSession applies it through
// its normal completion path and persists the draft, which echoes the
// confirmed values back here. We never write session_drafts directly —
// the member app owns that row and writes it constantly.
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

  // End-of-workout detection: the member app DELETEs session_drafts on
  // finish, so "we were watching a draft and now it's gone" = the session
  // ended. lastDraftRef snapshots what we knew; endedInfo drives the
  // "Workout completed" card (stats come from the workout_sessions row the
  // completion wrote, when readable).
  const lastDraftRef = useRef(null);
  const [endedInfo, setEndedInfo] = useState(null);

  // Set-entry editor (cue 'set_log', migration 0549) — which row is being
  // edited + its inputs, and optimistic values shown until the member's
  // draft echoes the confirmed log back.
  const [editIdx, setEditIdx] = useState(null);
  const [editW, setEditW] = useState('');
  const [editR, setEditR] = useState('');
  const [pendingLogs, setPendingLogs] = useState({}); // `${exerciseId}:${setIdx}` → { w, r }

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

      // ≤6h freshness window (same as TrainerClientDetail's live pill) — a
      // 3-day-old abandoned draft used to render as a "live" session with an
      // absurd running timer.
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: draftRow } = await supabase
        .from('session_drafts')
        .select('routine_id, routine_name, exercises, logged_sets, current_exercise_index, elapsed_time, started_at, is_paused, updated_at')
        .eq('profile_id', sessionId)
        .gte('updated_at', sixHoursAgo)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (draftRow?.routine_id) {
        lastDraftRef.current = draftRow;
        setEndedInfo(null);
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
        // Draft gone while we were watching one → the client just finished
        // (or discarded). Check for the completed workout_sessions row the
        // finish wrote: found → real stats; not found → neutral "ended".
        const prev = lastDraftRef.current;
        if (prev) {
          lastDraftRef.current = null;
          const sinceIso = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
          const { data: done } = await supabase
            .from('workout_sessions')
            .select('id, name, status, duration_seconds, total_volume_lbs, started_at')
            .eq('profile_id', sessionId)
            .gte('started_at', sinceIso)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (done?.status === 'completed') {
            setEndedInfo({
              completed: true,
              name: done.name || prev.routine_name || null,
              durationSec: done.duration_seconds || prev.elapsed_time || 0,
              volumeLbs: done.total_volume_lbs || 0,
            });
          } else {
            setEndedInfo({
              completed: false,
              name: prev.routine_name || null,
              durationSec: prev.elapsed_time || 0,
              volumeLbs: null,
            });
          }
        }
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

  // Realtime subscription on session_drafts for this client.
  // DELETE payloads only carry the PK (no profile_id), so they can never match
  // the row filter — patching state from payloads froze this view when the
  // client finished. Instead, ANY received event re-runs loadSession(), and a
  // 30s poll covers DELETEs + the window before session_drafts joins the
  // realtime publication (migration 0527). When the draft row is gone,
  // loadSession clears `draft` and the "no active session" empty state shows.
  useEffect(() => {
    if (!sessionId) return undefined;
    let reloadDebounce = null;
    const queueReload = () => {
      if (reloadDebounce) clearTimeout(reloadDebounce);
      reloadDebounce = setTimeout(() => { loadSession(); }, 250);
    };
    const channel = supabase
      .channel(`trainer-live-${sessionId}`)
      .on(
        'postgres_changes',
        // UNFILTERED on purpose: DELETE payloads only carry the PK, so a
        // profile_id server filter can never match them — the watched
        // draft's deletion (= workout finished) used to surface only via
        // the 30s poll. INSERT/UPDATE gate on profile_id client-side;
        // any DELETE just triggers a cheap debounced reload.
        { event: '*', schema: 'public', table: 'session_drafts' },
        (payload) => {
          if (payload?.eventType !== 'DELETE' && payload?.new?.profile_id !== sessionId) return;
          queueReload();
        }
      )
      // Cue acknowledgements: the member's ActiveSession flips
      // session_cues.acknowledged when a cue lands (columns + ack policy from
      // 0357 — written since then, never read back here until now). Trainer
      // RLS only exposes cues they sent, so this just mirrors our own cues.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'session_cues', filter: `client_id=eq.${sessionId}` },
        (payload) => {
          const row = payload?.new;
          if (!row?.id || !row.acknowledged) return;
          setSentCues(prev => prev.map(c => (c.id === row.id ? { ...c, acknowledged: true } : c)));
        }
      )
      .subscribe();
    const poll = setInterval(() => { loadSession(); }, 30_000);
    return () => {
      if (reloadDebounce) clearTimeout(reloadDebounce);
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
    // Subscribe ONCE per session — tearing down the WebSocket channel on every
    // routine change caused socket churn that could thrash re-renders and, on
    // flaky native sockets, reset the app. `loadSession` is a useMemo keyed on
    // [sessionId], so it's stable.
  }, [sessionId, loadSession]);

  // Elapsed ticker (1s) — drift-free re-render based on started_at
  useEffect(() => {
    if (!draft?.started_at || draft?.is_paused) return undefined;
    tickRef.current = setInterval(() => setTick(n => n + 1), ELAPSED_TICK_MS);
    return () => clearInterval(tickRef.current);
  }, [draft?.started_at, draft?.is_paused]);

  // ── Derive view state ─────────────
  // Prefer the client's LIVE exercise list from the draft — ActiveSession
  // persists swaps/adds/removals to session_drafts.exercises as
  // { id, name, name_es, targetSets, targetReps, restSeconds, … } with
  // logged_sets keyed by that same id (= exercise_id), and the draft's
  // current_exercise_index indexes into THAT array. Map it onto the
  // routine_exercises row shape this view renders; routine_exercises stays
  // as the fallback for drafts written before migration 0368 added the column.
  const exercises = useMemo(() => {
    if (Array.isArray(draft?.exercises) && draft.exercises.length > 0) {
      return draft.exercises.map(ex => ({
        exercise_id: ex.id ?? ex.exercise_id,
        target_sets: ex.targetSets ?? ex.target_sets ?? 0,
        target_reps: ex.targetReps ?? ex.target_reps ?? null,
        rest_seconds: ex.restSeconds ?? ex.rest_seconds ?? null,
        exercises: {
          id: ex.id ?? ex.exercise_id,
          name: ex.name || null,
          name_es: ex.name_es || null,
        },
      }));
    }
    return routine?.routine_exercises || [];
  }, [draft?.exercises, routine?.routine_exercises]);
  const exerciseCount = exercises.length;
  const currentExIdx = Math.min(draft?.current_exercise_index ?? 0, Math.max(0, exerciseCount - 1));
  const currentEx = exercises[currentExIdx] || null;
  const currentExName = currentEx?.exercises?.name_es || currentEx?.exercises?.name || '—';

  // Close the set editor whenever the displayed exercise changes (the member
  // moved on — a half-typed entry would target the wrong exercise).
  useEffect(() => { setEditIdx(null); }, [currentExIdx, draft?.routine_id]);

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
  const fmtVal = (v) => (v == null || v === '' ? '—' : v);
  const setRows = Array.from({ length: targetSetsForCurrent }, (_, i) => {
    const logged = currentSets[i];
    const done = !!(logged?.completed && !logged?.skipped);
    // While a sent log hasn't echoed back through the member's draft yet,
    // show the trainer's own numbers (dashed ring marks them unconfirmed).
    const pend = !done ? pendingLogs[`${currentEx?.exercise_id}:${i}`] : null;
    return {
      n: i + 1,
      w: fmtVal(pend ? pend.w : logged?.weight),
      r: fmtVal(pend ? pend.r : logged?.reps),
      rpe: logged?.rpe ?? '—',
      done,
      pending: !!pend,
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

  // Breadcrumb shown on the progress line: current exercise → next two.
  const breadcrumb = exercises
    .slice(currentExIdx, currentExIdx + 3)
    .map(ex => ex.exercises?.name_es || ex.exercises?.name || '—')
    .join(' → ');

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
  // Cues sent this visit ({ id, label, acknowledged }) — the realtime
  // subscription above flips `acknowledged` when the client sees the cue.
  const [sentCues, setSentCues] = useState([]);
  const sendCue = async (cueType, payload, label) => {
    if (!sessionId || sending) return false;
    setSending(true);
    try {
      const { data: cueId, error } = await supabase.rpc('trainer_send_cue', {
        p_client_id: sessionId,
        p_cue_type:  cueType,
        p_payload:   payload || null,
      });
      if (error) {
        logger.error('trainer_send_cue failed', error);
        showToast(t('trainerLive.cueFailed', 'Could not send cue'), 'error');
        return false;
      }
      showToast(t('trainerLive.cueSent', 'Cue sent to client') + ` · ${label}`, 'success');
      if (cueId) {
        setSentCues(prev => [...prev.slice(-3), { id: cueId, label, acknowledged: false }]);
      }
      return true;
    } finally {
      setSending(false);
    }
  };

  const handleNoteCue = async () => {
    const text = window.prompt(t('trainerLive.notePrompt', 'Note for client:'));
    if (!text || !text.trim()) return;
    await sendCue('note', { text: text.trim() }, text.trim().slice(0, 24));
  };

  // ── Set entry: trainer types weight/reps for a set (0549) ────────────────
  const startEdit = (i) => {
    if (!currentEx || sending) return;
    const logged = currentSets[i];
    const pend = pendingLogs[`${currentEx.exercise_id}:${i}`];
    // Prefill: a pending/typed value wins; else the member's own numbers
    // (ActiveSession prefills from history); else last logged weight + target reps.
    let w = pend?.w ?? logged?.weight ?? '';
    let r = pend?.r ?? logged?.reps ?? '';
    if (!w || w === '—') {
      for (let k = i - 1; k >= 0; k--) {
        const prevW = pendingLogs[`${currentEx.exercise_id}:${k}`]?.w ?? currentSets[k]?.weight;
        if (prevW && prevW !== '—') { w = prevW; break; }
      }
    }
    if (!r || r === '—') {
      const targetReps = parseInt(currentEx.target_reps, 10);
      r = Number.isFinite(targetReps) && targetReps > 0 ? String(targetReps) : '';
    }
    setEditW(w === '—' ? '' : String(w));
    setEditR(r === '—' ? '' : String(r));
    setEditIdx(i);
  };

  const handleSendSet = async () => {
    if (editIdx == null || !currentEx || sending) return;
    const weight = editW.trim().slice(0, 8);
    const reps = editR.trim().slice(0, 5);
    if (!(parseInt(reps, 10) > 0)) {
      showToast(t('trainerLive.needReps', 'Enter the reps first'), 'error');
      return;
    }
    const idx = editIdx;
    const label = `S${idx + 1} · ${weight || '—'}×${reps}`;
    const ok = await sendCue('set_log', {
      exercise_id: currentEx.exercise_id,
      set_index:   idx,
      weight,
      reps,
    }, label);
    if (!ok) return;
    setPendingLogs(prev => ({ ...prev, [`${currentEx.exercise_id}:${idx}`]: { w: weight, r: reps } }));
    setEditIdx(null);
  };

  const clientName = client?.full_name || client?.username || t('trainerMessages.list.clientFallback', 'Client');
  // The routine row can be RLS-hidden (e.g. admin-created class template) —
  // the draft's own routine_name still names the plan.
  const planName = routine?.name || draft?.routine_name || '—';

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
          padding: '7px 12px', borderRadius: 999,
          background: 'rgba(255,255,255,0.07)', color: '#F3F0E9',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: 999,
            background: '#27B0A0', boxShadow: '0 0 0 3px rgba(39,176,160,0.25)',
          }} />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.5, fontFamily: TFont.mono }}>
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

        {/* Session ended — the draft we were watching disappeared */}
        {!loading && !draft && endedInfo && (
          <div style={{
            marginTop: 30, padding: '28px 18px',
            background: 'rgba(255,255,255,0.03)', borderRadius: 18,
            border: '1px solid rgba(39,176,160,0.25)',
            textAlign: 'center',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 999, margin: '0 auto',
              background: 'rgba(39,176,160,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={26} color="#27B0A0" strokeWidth={2.6} />
            </div>
            <div style={{
              fontFamily: TFont.display, fontSize: 22, fontWeight: 800,
              color: '#fff', letterSpacing: -0.6, lineHeight: 1.1, marginTop: 14,
            }}>
              {endedInfo.completed
                ? t('trainerLive.endedTitle', 'Workout completed!')
                : t('trainerLive.endedNeutralTitle', 'Session ended')}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 8, lineHeight: 1.5 }}>
              {endedInfo.completed
                ? t('trainerLive.endedDesc', '{{name}} finished this session.', { name: clientName })
                : t('trainerLive.endedNeutralDesc', "There's no active workout anymore.")}
              {endedInfo.name ? ` · ${endedInfo.name}` : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 16 }}>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(243,240,233,0.45)' }}>
                  {t('trainerLive.endedDuration', 'Duration')}
                </div>
                <div style={{ fontFamily: TFont.mono, fontSize: 17, fontWeight: 700, color: '#F3F0E9', marginTop: 3 }}>
                  {formatElapsed(endedInfo.durationSec)}
                </div>
              </div>
              {endedInfo.volumeLbs != null && (
                <div>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(243,240,233,0.45)' }}>
                    {t('trainerLive.endedVolume', 'Volume')}
                  </div>
                  <div style={{ fontFamily: TFont.mono, fontSize: 17, fontWeight: 700, color: '#F3F0E9', marginTop: 3 }}>
                    {endedInfo.volumeLbs >= 1000 ? `${(endedInfo.volumeLbs / 1000).toFixed(1)}k` : (endedInfo.volumeLbs || 0)} lb
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate(`/trainer/clients/${sessionId}`)}
              className="tt-btn"
              style={{
                marginTop: 20, width: '100%', height: 48, borderRadius: 14,
                background: 'linear-gradient(180deg,#2EC9B7,#178C7E)',
                color: '#06363B', fontSize: 14, fontWeight: 800,
                border: 'none', cursor: 'pointer',
              }}
            >
              {t('trainerLive.viewClient', 'View client')}
            </button>
          </div>
        )}

        {/* Empty state — no draft, none watched this visit */}
        {!loading && !draft && !endedInfo && (
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

        {/* Draft exists but the exercise details are unreadable/empty (e.g.
            an admin-created class template hidden by routines RLS, with no
            exercises snapshot on the draft) — show a minimal live card
            instead of a blank page. */}
        {!loading && draft && !currentEx && (
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
              {t('trainerLive.workingOutTitle', '{{name}} is working out', { name: clientName })}
            </div>
            <div style={{
              fontSize: 13, color: 'rgba(255,255,255,0.6)',
              marginTop: 8, lineHeight: 1.5,
            }}>
              {t('trainerLive.noRoutineDetails', "The workout details aren't available for this session.")}
            </div>
            <div style={{
              marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 999,
              background: 'rgba(255,255,255,0.07)', color: '#F3F0E9',
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: 999,
                background: '#27B0A0', boxShadow: '0 0 0 3px rgba(39,176,160,0.25)',
              }} />
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.5, fontFamily: TFont.mono }}>
                {formatElapsed(elapsedSec)}
              </span>
            </div>
          </div>
        )}

        {/* Live session view */}
        {!loading && draft && currentEx && (
          <>
            {/* Progress */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              gap: 12, marginTop: 10, marginBottom: 7,
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(243,240,233,0.55)', flexShrink: 0 }}>
                {t('trainerLive.exerciseProgress', 'Exercise {{current}} of {{total}}', { current: currentExIdx + 1, total: exerciseCount })}
              </div>
              <div style={{
                fontSize: 11.5, fontWeight: 600, color: 'rgba(243,240,233,0.55)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textAlign: 'right', minWidth: 0,
              }}>
                {breadcrumb}
              </div>
            </div>
            <div style={{
              height: 4, borderRadius: 999, overflow: 'hidden',
              background: 'rgba(255,255,255,0.1)', marginBottom: 18,
            }}>
              <div style={{
                width: `${Math.min(100, progressPct)}%`, height: '100%',
                background: '#27B0A0',
                transition: 'width 200ms ease',
              }} />
            </div>

            {/* Current exercise card */}
            <div style={{
              borderRadius: 22, background: '#15191C',
              border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
              marginBottom: 12,
            }}>
              {/* Card header: exercise name + target spec + note icon-box */}
              <div style={{
                padding: '16px 16px 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: TFont.display, fontSize: 19, fontWeight: 800,
                    letterSpacing: -0.4, color: '#F3F0E9', lineHeight: 1.1,
                  }}>
                    {currentExName}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(243,240,233,0.55)', marginTop: 2 }}>
                    {t('trainerLive.targetSpec', 'Target {{sets}} × {{reps}}', { sets: currentEx.target_sets, reps: currentEx.target_reps || '—' })}
                    {currentEx.rest_seconds ? ` · ${t('trainerLive.restSpec', '{{sec}}s rest', { sec: currentEx.rest_seconds })}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={sending}
                  onClick={handleNoteCue}
                  aria-label={t('trainerLive.addNote', 'Add note')}
                  className="tt-tap"
                  style={{
                    width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                    background: 'rgba(255,255,255,0.06)', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.5 : 1,
                  }}
                >
                  <StickyNote size={18} color="rgba(243,240,233,0.7)" strokeWidth={2} />
                </button>
              </div>

              {/* Set table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '34px 1fr 1fr 1fr 44px',
                gap: 8, padding: '6px 16px',
                fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
                textTransform: 'uppercase', color: 'rgba(243,240,233,0.4)',
              }}>
                <span>{t('trainerLive.setShort', 'Set')}</span>
                <span>{t('trainerLive.rpeShort', 'RPE')}</span>
                <span>{t('trainerLive.weightShort', 'WT')}</span>
                <span>{t('trainerLive.repsShort', 'Reps')}</span>
                <span />
              </div>

              {/* Set rows — tap a row to type weight/reps for the client (0549) */}
              {setRows.map((set) => {
                const i = set.n - 1;
                const isEditing = editIdx === i;
                const cellInput = (value, onChange, mode, label) => (
                  <input
                    value={value}
                    onChange={(e) => onChange(e.target.value.slice(0, mode === 'decimal' ? 7 : 4))}
                    onClick={(e) => e.stopPropagation()}
                    inputMode={mode}
                    type="text"
                    autoFocus={mode === 'decimal'}
                    enterKeyHint="done"
                    aria-label={label}
                    placeholder="—"
                    style={{
                      width: '100%', height: 34, borderRadius: 9, border: 'none', outline: 'none',
                      background: 'rgba(255,255,255,0.12)', boxShadow: 'inset 0 0 0 1.5px #27B0A0',
                      textAlign: 'center', fontFamily: TFont.mono, fontWeight: 700, fontSize: 14,
                      color: '#fff', minWidth: 0,
                    }}
                  />
                );
                return (
                <div
                  key={set.n}
                  onClick={() => (isEditing ? setEditIdx(null) : startEdit(i))}
                  style={{
                    display: 'grid', gridTemplateColumns: '34px 1fr 1fr 1fr 44px',
                    gap: 8, padding: '10px 16px', alignItems: 'center',
                    background: isEditing ? 'rgba(39,176,160,0.16)' : set.current ? 'rgba(39,176,160,0.10)' : 'transparent',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{
                    fontFamily: TFont.display, fontWeight: 800, fontSize: 15,
                    color: set.current || isEditing ? '#27B0A0' : '#F3F0E9',
                  }}>{set.n}</span>
                  <span style={{
                    fontSize: 12.5, fontFamily: TFont.mono,
                    color: 'rgba(243,240,233,0.45)',
                  }}>{set.rpe}</span>
                  {isEditing ? cellInput(editW, setEditW, 'decimal', t('trainerLive.weightShort', 'WT')) : (
                    <div style={{
                      height: 34, borderRadius: 9,
                      background: set.done ? 'transparent' : 'rgba(255,255,255,0.07)',
                      boxShadow: set.pending
                        ? 'inset 0 0 0 1.5px rgba(39,176,160,0.55)'
                        : set.current ? 'inset 0 0 0 1.5px #27B0A0' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: TFont.mono, fontWeight: 700, fontSize: 14,
                      color: set.pending ? 'rgba(243,240,233,0.75)' : '#F3F0E9',
                    }}>{set.w}</div>
                  )}
                  {isEditing ? cellInput(editR, setEditR, 'numeric', t('trainerLive.repsShort', 'Reps')) : (
                    <div style={{
                      height: 34, borderRadius: 9,
                      background: set.done ? 'transparent' : 'rgba(255,255,255,0.07)',
                      boxShadow: set.pending
                        ? 'inset 0 0 0 1.5px rgba(39,176,160,0.55)'
                        : set.current ? 'inset 0 0 0 1.5px #27B0A0' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: TFont.mono, fontWeight: 700, fontSize: 14,
                      color: set.pending ? 'rgba(243,240,233,0.75)' : set.r !== '—' ? '#F3F0E9' : 'rgba(243,240,233,0.3)',
                    }}>{set.r}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {isEditing ? (
                      <button
                        type="button"
                        disabled={sending}
                        onClick={(e) => { e.stopPropagation(); handleSendSet(); }}
                        aria-label={t('trainerLive.sendSet', 'Send set {{n}}', { n: set.n })}
                        className="tt-tap"
                        style={{
                          width: 30, height: 30, borderRadius: 9, border: 'none',
                          background: '#27B0A0', cursor: sending ? 'wait' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: sending ? 0.6 : 1,
                        }}
                      >
                        <Check size={16} color="#06363B" strokeWidth={3} />
                      </button>
                    ) : (
                      <div style={{
                        width: 30, height: 30, borderRadius: 9,
                        background: set.done ? '#27B0A0' : 'rgba(255,255,255,0.07)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: set.pending ? 0.75 : 1,
                      }}>
                        {set.pending ? (
                          <span style={{ fontSize: 12, color: 'rgba(243,240,233,0.7)', fontWeight: 800 }}>…</span>
                        ) : (
                          <Check size={16} color={set.done ? '#06363B' : 'rgba(243,240,233,0.4)'} strokeWidth={3} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}

              {/* Tap-to-edit hint */}
              <div style={{ padding: '7px 16px 0', fontSize: 10.5, color: 'rgba(243,240,233,0.45)' }}>
                {t('trainerLive.tapToEdit', 'Tap any set to log weight & reps for your client')}
              </div>

              {/* Coach toolbar (inset, padded inside the card) */}
              <div style={{ padding: '0 16px 16px' }}>
                <div style={{
                  marginTop: 14, padding: 10, borderRadius: 12,
                  background: 'rgba(39,176,160,0.06)',
                  border: '1px solid rgba(39,176,160,0.20)',
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 800, color: TT.accent,
                    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
                  }}>
                    {t('trainerLive.coach', 'Coach')}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                        className="tt-tap"
                        style={{
                          padding: '7px 11px', borderRadius: 999,
                          background: 'rgba(255,255,255,0.07)',
                          color: '#F3F0E9', fontSize: 11.5, fontWeight: 700,
                          border: 'none', cursor: sending ? 'wait' : 'pointer',
                          minHeight: 32,
                          opacity: sending ? 0.5 : 1,
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>

                  {/* Sent cues + seen state (session_cues.acknowledged) */}
                  {sentCues.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {sentCues.map((c) => (
                        <span
                          key={c.id}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '4px 9px', borderRadius: 999,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.10)',
                            fontSize: 10.5, fontWeight: 700,
                            color: 'rgba(243,240,233,0.65)',
                          }}
                        >
                          {c.label}
                          {c.acknowledged ? (
                            <span style={{ color: '#27B0A0', fontWeight: 800 }}>
                              ✓ {t('trainerLive.cueSeen', 'Seen')}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.45 }}>…</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer actions — log/send the selected set (0549) + note quick-action */}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  if (editIdx != null) handleSendSet();
                  else startEdit(currentSetIdx >= 0 ? currentSetIdx : Math.max(0, setRows.length - 1));
                }}
                className="tt-btn"
                style={{
                  flex: 1, height: 52, borderRadius: 14,
                  background: 'linear-gradient(180deg,#2EC9B7,#178C7E)',
                  color: '#06363B', fontSize: 15,
                  boxShadow: '0 8px 18px -6px rgba(10,90,82,0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
                  cursor: sending ? 'wait' : 'pointer',
                  opacity: sending ? 0.6 : 1,
                }}
                aria-label={t('trainerLive.logSet', 'Log set {{n}}', { n: currentSetN })}
              >
                <Check size={18} color="#06363B" strokeWidth={2.6} />
                {editIdx != null
                  ? (setRows[editIdx]?.done
                    ? t('trainerLive.updateSet', 'Update set {{n}}', { n: editIdx + 1 })
                    : t('trainerLive.sendSet', 'Send set {{n}}', { n: editIdx + 1 }))
                  : t('trainerLive.logSet', 'Log set {{n}}', { n: currentSetN })}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={handleNoteCue}
                className="tt-tap"
                style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: 'rgba(255,255,255,0.08)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
                  border: 'none', color: '#fff',
                  cursor: sending ? 'wait' : 'pointer',
                  opacity: sending ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                aria-label={t('trainerLive.addNote', 'Add note')}
              >
                <Edit3 size={20} strokeWidth={2.2} />
              </button>
            </div>

            {/* Up next */}
            {upNext.length > 0 && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 800, color: 'rgba(243,240,233,0.6)',
                  letterSpacing: 1.4, textTransform: 'uppercase',
                  marginTop: 22, marginBottom: 8,
                }}>
                  {t('trainerLive.upNext', 'Up next')}
                </div>
                {upNext.map((ex) => (
                  <div key={ex.n} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', marginBottom: 6,
                    background: 'rgba(255,255,255,0.03)', borderRadius: 12,
                  }}>
                    <div style={{
                      fontFamily: TFont.mono, fontSize: 11,
                      color: TT.textMute, fontWeight: 800, width: 18,
                    }}>
                      {ex.n}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#F3F0E9' }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(243,240,233,0.5)', marginTop: 1 }}>{ex.spec}</div>
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

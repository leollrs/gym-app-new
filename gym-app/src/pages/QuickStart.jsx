import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Play, Plus, Dumbbell, ChevronRight, ChevronDown, Clock, X, CheckCircle2, Zap, Pencil, Trophy, Moon, Activity } from 'lucide-react';
import { useScrollLock } from '../hooks/useScrollLock';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { timeAgo as formatTimeAgo } from '../lib/dateUtils';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import { getExercises } from '../lib/exerciseStore';
const exerciseLibrary = getExercises();
import { localizeRoutineName } from '../lib/exerciseName';
import { hasCardioLoggedAfter, hasRecentCardioLog } from '../lib/cardioLedger';
import { useTranslation } from 'react-i18next';
import CreateRoutineModal from '../components/CreateRoutineModal';

/** Read active draft sessions from localStorage */
const readActiveDrafts = () => {
  const sessions = [];
  try {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('gym_session_')) continue;
      const data = JSON.parse(localStorage.getItem(key));
      if (data?.loggedSets && data?.startedAt && new Date(data.startedAt).getTime() > oneDayAgo) {
        sessions.push({ routineId: key.replace('gym_session_', ''), ...data });
      }
    }
  } catch { }
  return sessions;
};

/** Read the live cardio draft (mirrors Dashboard's logic).
 *  Entries are killed if the per-user cardio ledger has any "logged" event
 *  newer than the draft's startedAt — that ledger is an append-only tombstone
 *  written every time LiveCardio.handleSubmit succeeds, so a finished run
 *  can't come back from the dead even if its localStorage draft persists. */
const LIVE_CARDIO_STALE_MS = 12 * 60 * 60 * 1000;
const readLiveCardio = (uid) => {
  try {
    const lc = JSON.parse(localStorage.getItem('tugympr_live_cardio'));
    if (!lc) return null;
    const isLive = (lc.accumulatedSec > 0 || lc.running) && lc.phase === 'tracking';
    const isFresh = lc.lastUpdate && (Date.now() - lc.lastUpdate) < LIVE_CARDIO_STALE_MS;
    const supersededByLog = lc.startedAt
      ? hasCardioLoggedAfter(uid, lc.startedAt)
      : hasRecentCardioLog(uid, 6 * 60 * 60 * 1000);
    if (!isLive || !isFresh || supersededByLog) {
      localStorage.removeItem('tugympr_live_cardio');
      return null;
    }
    return lc;
  } catch {
    return null;
  }
};

const fmtElapsed = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (m < 60) return `${m}:${ss}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${ss}`;
};

// Video lookup
const videoMap = {};
for (const ex of exerciseLibrary) {
  if (ex.videoUrl) videoMap[ex.id] = ex.videoUrl;
}

const CYCLE_MS = 3500;

/* ── Routine picker ─────────────────────────────────────────────────────────
   Choosing a routine used to expand a list UNDER the three cards, at the very
   bottom of the page — so tapping "Choose Routine" scrolled you away from the
   thing you tapped, and with 100+ routines the list ran forever inside the
   page. It's a modal now: it opens over everything, it has its own scroll, and
   it can be searched. */
function RoutinePickerModal({ routines, onClose, onStart, onEdit, t }) {
  useScrollLock(true);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routines;
    return routines.filter(r => localizeRoutineName(r.name).toLowerCase().includes(q));
  }, [routines, query]);

  const exercisesFor = (r) => [...(r.routine_exercises || [])]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map(ex => ({ name: ex.exercises?.name || 'Exercise', sets: ex.target_sets, reps: ex.target_reps }));

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      role="button"
      tabIndex={0}
      aria-label={t('quickStart.close', 'Close')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('quickStart.chooseRoutine')}
        className="w-full sm:max-w-md rounded-t-[24px] sm:rounded-[24px] flex flex-col"
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-subtle)',
          maxHeight: '86vh',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-black truncate" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui', letterSpacing: -0.3 }}>
              {t('quickStart.chooseRoutine')}
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {routines.length} {t('quickStart.available')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('quickStart.close', 'Close')}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 active:scale-[0.94] transition-transform"
            style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
          >
            <X size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('quickStart.searchRoutines', 'Search routines')}
            className="w-full px-4 h-11 rounded-xl text-[14px] focus:outline-none focus:ring-2"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
              '--tw-ring-color': 'var(--color-accent)',
            }}
          />
        </div>

        {/* List */}
        <div className="px-5 pb-5 overflow-y-auto space-y-1.5" style={{ WebkitOverflowScrolling: 'touch' }}>
          {filtered.length === 0 ? (
            <p className="text-[13px] text-center py-10" style={{ color: 'var(--color-text-subtle)' }}>
              {t('quickStart.noRoutinesFound', 'No routines match that search.')}
            </p>
          ) : filtered.map(r => {
            const isExpanded = expandedId === r.id;
            const exs = isExpanded ? exercisesFor(r) : [];
            return (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  aria-expanded={isExpanded}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-colors text-left active:scale-[0.99]"
                  style={{
                    background: 'var(--color-bg-card)',
                    borderColor: isExpanded ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border-subtle)',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
                  >
                    <Dumbbell size={16} style={{ color: 'var(--color-text-subtle)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {localizeRoutineName(r.name).replace(/ [AB]$/, '')}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                      {r.exerciseCount} {t('quickStart.exercises')}
                      {r.lastPerformedAt && ` · ${formatTimeAgo(r.lastPerformedAt)}`}
                    </p>
                  </div>
                  <ChevronDown
                    size={15}
                    className="shrink-0 transition-transform duration-200"
                    style={{ color: 'var(--color-text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {isExpanded && (
                  <div className="mt-1 mx-2 rounded-xl p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                    {exs.length === 0 ? (
                      <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
                        {t('quickStart.noExercisesYet', 'No exercises yet. Tap Edit to add some.')}
                      </p>
                    ) : (
                      <div className="space-y-1.5 mb-4">
                        {exs.map((ex, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <p className="text-[13px] truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>{ex.name}</p>
                            <p className="text-[12px] ml-3 shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{ex.sets}&times;{ex.reps}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => onEdit(r.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-xl text-[13px] font-semibold active:scale-[0.97] transition-transform"
                        style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      >
                        <Pencil size={14} />
                        {t('quickStart.edit', 'Edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onStart(r.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-xl text-[13px] font-bold active:scale-[0.97] transition-transform"
                        style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }}
                      >
                        <Play size={14} fill="currentColor" strokeWidth={0} />
                        {t('quickStart.start', 'Start')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Stale-while-revalidate cache — painted on mount so the page feels instant
// on repeat visits. Background fetch replaces the data once complete.
const cacheKey = (userId) => `qs_cache_v1_${userId}`;
const readCache = (userId) => {
  if (!userId) return null;
  try { return JSON.parse(localStorage.getItem(cacheKey(userId))); } catch { return null; }
};
const writeCache = (userId, payload) => {
  if (!userId) return;
  try { localStorage.setItem(cacheKey(userId), JSON.stringify(payload)); } catch {}
};

const QuickStart = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('pages');
  const onRecordRoute = location.pathname === '/record';
  // Hydrate from cache synchronously so the initial paint has real data and
  // `loading` starts false whenever we have any cached state at all.
  const cachedInit = typeof user?.id === 'string' ? readCache(user.id) : null;
  const [routines, setRoutines] = useState(cachedInit?.routines || []);
  const [todayRoutine, setTodayRoutine] = useState(cachedInit?.todayRoutine || null);
  const [todayExercises, setTodayExercises] = useState(cachedInit?.todayExercises || []);
  const [loading, setLoading] = useState(!cachedInit);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeDrafts] = useState(() => readActiveDrafts());
  const [liveCardio, setLiveCardio] = useState(() => readLiveCardio(user?.id));
  // Refresh on visibility — handles returning from the LiveCardio screen.
  useEffect(() => {
    const refresh = () => setLiveCardio(readLiveCardio(user?.id));
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [user?.id]);
  const [showOther, setShowOther] = useState(false);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [todayCompleted, setTodayCompleted] = useState(false);
  const [completedSession, setCompletedSession] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isRestDay, setIsRestDay] = useState(false);
  const [isGymClosed, setIsGymClosed] = useState(false);
  const [includeWarmUp, setIncludeWarmUp] = useState(true);

  useEffect(() => {
    if (!user) return;
    // QuickStart is in KEEP_ALIVE_MAP (App.jsx), so it stays mounted for the whole
    // session and `location.key` changes on EVERY navigation anywhere in the app —
    // including ones navigating AWAY from here. That re-ran this 5-query load for
    // pages the user isn't even looking at. Bail unless /record is the route being
    // shown; coming back here changes location.key again and the load runs then.
    if (!onRecordRoute) return;

    const load = async () => {
      const todayDow = new Date().getDay();
      const _todayStart = new Date(); _todayStart.setHours(0, 0, 0, 0);
      const todayStartISO = _todayStart.toISOString();

      const [{ data: routineData }, { data: lastPerfData }, { data: todaySessionData }, scheduleRes, progRes] = await Promise.all([
        supabase
          .from('routines')
          .select('id, name, created_at, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name, video_url))')
          .eq('created_by', user.id)
          .eq('is_template', false)
          .order('created_at', { ascending: false }),
        // Last-performed per routine: server-side aggregate (one row/routine via
        // get_routine_last_performed) instead of pulling the member's entire
        // completed-session history down just to fold it to a date per routine.
        supabase.rpc('get_routine_last_performed', { p_profile_id: user.id }),
        // Today's completed sessions only — powers the "already done today"
        // check below (needs full session fields). Bounded to today.
        supabase
          .from('workout_sessions')
          .select('id, routine_id, name, completed_at, duration_seconds, total_volume_lbs')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', todayStartISO)
          .order('completed_at', { ascending: false }),
        supabase
          .from('workout_schedule')
          .select('day_of_week, routine_id')
          .eq('profile_id', user.id),
        supabase
          .from('generated_programs')
          // schedule_map carries routine_ids_a/_b — needed to alternate the A/B
          // rotation per week (see the variant resolution below).
          .select('id, program_start, split_type, expires_at, routines_a_count, schedule_map')
          .eq('profile_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const allRoutines = routineData || [];
      const todaySessions = todaySessionData || [];
      const fetchedProgram = !progRes.error ? progRes.data : null;
      const programStart = fetchedProgram ? new Date(fetchedProgram.program_start) : null;

      // Build last-performed map — RPC returns one row per routine:
      // { routine_id, last_performed_at }.
      const lastPerformed = {};
      (lastPerfData || []).forEach(r => {
        if (r.routine_id) lastPerformed[r.routine_id] = r.last_performed_at;
      });

      const enriched = allRoutines.map(r => ({
        ...r,
        exerciseCount: r.routine_exercises?.length ?? 0,
        lastPerformedAt: lastPerformed[r.id] || null,
      }));
      setRoutines(enriched);

      // Build schedule map (same logic as Dashboard).
      //
      // `workout_schedule` is authoritative. The old `Auto:` + created-after-
      // program filter here threw away exactly the rows the member chose
      // themselves: swapping a program day to one of their own routines made
      // this hero read the day as a REST DAY, with no way to start the workout
      // they had just scheduled. Every program-creation path wipes
      // `workout_schedule` first, so there are no stale rows to filter out.
      //
      // Variant resolution: generation seeds `workout_schedule` with variant A
      // only, so without this the Record tab offered week 1's routine on every
      // week of the program. Substitute B on even weeks, by slot index, and
      // only for days still holding their variant-A routine so a hand-picked
      // day keeps what the member chose.
      const scheduleData = !scheduleRes.error ? (scheduleRes.data || []) : [];
      const sMap = fetchedProgram?.schedule_map || null;
      const variantA = Array.isArray(sMap?.routine_ids_a) ? sMap.routine_ids_a : [];
      const variantB = Array.isArray(sMap?.routine_ids_b) ? sMap.routine_ids_b : [];
      const programWeekNum = (() => {
        if (!fetchedProgram || !programStart) return 0;
        const start = new Date(programStart); start.setHours(0, 0, 0, 0);
        const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
        if (sMap) {
          const startSunday = new Date(start);
          startSunday.setDate(startSunday.getDate() - startSunday.getDay());
          return Math.max(1, Math.floor((todayMid - startSunday) / 86400000 / 7) + 1);
        }
        return Math.max(1, Math.floor((todayMid - start) / 86400000 / 7) + 1);
      })();
      // Clamped like My Programs' `currentWeekNum` so all three surfaces agree
      // on the A/B parity even in the tail week of a program.
      const totalProgramWeeks = sMap?.total_calendar_weeks ?? Infinity;
      const variantWeekNum = Math.min(programWeekNum, totalProgramWeeks);
      const useVariantB = variantA.length > 0 && variantB.length > 0 && variantWeekNum % 2 === 0;
      const scheduleMap = {};
      for (const row of scheduleData) {
        let routineId = row.routine_id;
        if (useVariantB) {
          const slot = variantA.indexOf(routineId);
          if (slot >= 0 && variantB[slot]) routineId = variantB[slot];
        }
        if (allRoutines.some(r => r.id === routineId)) {
          scheduleMap[row.day_of_week] = routineId;
        }
      }

      // Find today's scheduled routine using schedule map
      let todayR = null;
      if (scheduleMap[todayDow]) {
        todayR = allRoutines.find(r => r.id === scheduleMap[todayDow]) || null;
      }

      // ── ACTIVE-DRAFT OVERRIDE ────────────────────────────────────────
      // A workout IN PROGRESS beats the schedule. If the member started a
      // routine that isn't today's scheduled one (off-day session, rest day,
      // gym closed), the hero must surface THAT routine with the Resume
      // state — previously drafts were only honored when they matched the
      // scheduled routine, so off-schedule sessions vanished from /record.
      const freshDraft = (activeDrafts || [])
        .slice()
        .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))[0] || null;
      if (freshDraft && String(freshDraft.routineId) !== String(todayR?.id ?? '')) {
        let draftRoutine = allRoutines.find(r => String(r.id) === String(freshDraft.routineId)) || null;
        if (!draftRoutine) {
          // Not one of the member's own routines (class template, friend's
          // routine, pre-regenerate program routine) — fetch it directly.
          const { data: ext } = await supabase
            .from('routines')
            .select('id, name, created_at, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name, video_url))')
            .eq('id', freshDraft.routineId)
            .maybeSingle();
          draftRoutine = ext || null;
        }
        if (draftRoutine) {
          todayR = draftRoutine;
          // An in-progress session also overrides the rest-day / closed
          // states from a previous load pass.
          setIsRestDay(false);
          setIsGymClosed(false);
        }
      }

      // Check if gym is closed today
      // Only show gym closed / rest day if there's NO scheduled workout for today
      if (!todayR) {
        try {
          const { data: gymHours } = await supabase
            .from('gym_hours')
            .select('is_closed')
            .eq('gym_id', profile?.gym_id)
            .eq('day_of_week', todayDow)
            .maybeSingle();
          if (gymHours?.is_closed) {
            setIsGymClosed(true);
          }
        } catch { /* table may not exist */ }

        const hasAnySchedule = Object.keys(scheduleMap).length > 0;
        if (hasAnySchedule) {
          setIsRestDay(true);
        }
      }

      if (todayR) {
        setTodayRoutine(todayR);
        const exs = (todayR.routine_exercises || [])
          .sort((a, b) => (a.position || 0) - (b.position || 0))
          .map(ex => {
            // Resolve video: DB video_url first, then local videoMap fallback
            const rawVideo = ex.exercises?.video_url || videoMap[ex.exercise_id] || null;
            let video = null;
            if (rawVideo) {
              if (rawVideo.startsWith('/') || rawVideo.startsWith('http')) {
                video = rawVideo;
              } else {
                const { data } = supabase.storage.from('exercise-videos').getPublicUrl(rawVideo);
                video = data?.publicUrl || null;
              }
            }
            return {
              name: ex.exercises?.name || 'Exercise',
              sets: ex.target_sets,
              reps: ex.target_reps,
              video,
            };
          });
        setTodayExercises(exs);

        // Check if this routine was already completed today
        const todayStr = new Date().toDateString();
        const doneSession = todaySessions.find(
          s => s.routine_id === todayR.id && new Date(s.completed_at).toDateString() === todayStr
        );
        setTodayCompleted(!!doneSession);
        if (doneSession) setCompletedSession(doneSession);

        // Snapshot to localStorage for the next mount — makes the page feel
        // instant (no spinner) when the user returns to /record.
        writeCache(user.id, {
          routines: enriched,
          todayRoutine: todayR,
          todayExercises: exs,
        });
      } else {
        // No today routine — still cache routines list so picker paints fast
        writeCache(user.id, {
          routines: enriched,
          todayRoutine: null,
          todayExercises: [],
        });
      }

      setLoading(false);
    };

    load();
  }, [user, location.key, onRecordRoute, refreshKey]);

  // Stay in sync with the Home tab when the program is (re)generated elsewhere.
  // generate / regenerate broadcast 'tugympr:programs-changed' — clear the SWR
  // cache and refetch so /record reflects the new schedule immediately instead
  // of waiting for the next navigation.
  useEffect(() => {
    if (!user?.id) return;
    const onProgramsChanged = () => {
      try { localStorage.removeItem(cacheKey(user.id)); } catch { /* ignore */ }
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener('tugympr:programs-changed', onProgramsChanged);
    return () => window.removeEventListener('tugympr:programs-changed', onProgramsChanged);
  }, [user?.id]);

  // Also revalidate whenever the tab becomes visible again (e.g. user returns
  // to the app after finishing a workout so the completed state shows up).
  useEffect(() => {
    if (!user) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        // Trigger re-run by bumping a dummy state via location key is cleanest
        // but location.key doesn't change on visibilitychange. Instead, fetch
        // only the completion status here — cheap query.
        (async () => {
          const todayStr = new Date().toDateString();
          const { data } = await supabase
            .from('workout_sessions')
            .select('id, routine_id, name, completed_at, duration_seconds, total_volume_lbs')
            .eq('profile_id', user.id)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(10);
          const sessions = data || [];
          const done = sessions.find(
            s => s.routine_id === todayRoutine?.id && new Date(s.completed_at).toDateString() === todayStr
          );
          if (done) {
            setTodayCompleted(true);
            setCompletedSession(done);
          }
        })();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user, todayRoutine?.id]);

  // Cycle through exercises for hero preview
  useEffect(() => {
    if (todayExercises.length <= 1) return;
    const timer = setInterval(() => {
      setCycleIndex(prev => (prev + 1) % todayExercises.length);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [todayExercises.length]);

  const currentEx = todayExercises[cycleIndex] || {};
  const otherRoutines = routines.filter(r => r.id !== todayRoutine?.id);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <Skeleton variant="page" />
      </div>
    );
  }

  return (
    <FadeIn>
    <div className="min-h-screen px-4 pt-4 pb-28 md:pb-12" style={{ background: 'var(--color-bg-primary)' }}>
      <div className="max-w-[480px] md:max-w-4xl lg:max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div data-tour="tour-quickstart-page">
          <h1 className="text-[22px] font-black tracking-tight truncate" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.startWorkout')}</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
            {isGymClosed ? t('dashboard.gymClosed', 'Gym Closed') : todayCompleted ? t('quickStart.greatWorkToday') : isRestDay && !todayRoutine ? t('quickStart.noWorkoutScheduled', 'No workout scheduled today') : todayRoutine ? t('quickStart.todaysWorkoutReady') : t('quickStart.pickRoutineAndGo')}
          </p>
        </div>

        {/* ── TODAY'S WORKOUT HERO ─────────────────────────────── */}
        {isGymClosed ? (
          /* ── GYM CLOSED STATE ── */
          <div className="w-full rounded-2xl bg-red-500/5 border border-red-500/15 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-[28px]">🔒</span>
            </div>
            <p className="font-bold text-[18px] text-red-400">{t('dashboard.gymClosed', 'Gym Closed')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('dashboard.gymClosedMessage', 'The gym is closed today. Rest up and come back stronger!')}
            </p>
            <button
              onClick={() => setShowOther(v => !v)}
              className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-[13px] font-bold text-[var(--color-text-on-accent,#000)] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Dumbbell size={15} />
              {t('dashboard.trainOutsideGym', 'Want to train outside the gym?')}
            </button>
          </div>
        ) : isRestDay && !todayRoutine ? (
          /* ── REST DAY STATE ── */
          <div className="w-full rounded-2xl bg-gradient-to-br from-[#6B7280]/8 to-[#6B7280]/[0.01] border border-white/[0.06] p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
              <Moon size={28} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="font-bold text-[18px]" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.restDay', 'Rest Day')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('quickStart.restDayMessage', 'No workout scheduled for today. Rest up and come back stronger!')}
            </p>
            <button
              onClick={() => setShowOther(v => !v)}
              className="w-full py-3.5 rounded-2xl text-[13px] font-bold bg-white/[0.06] hover:bg-white/[0.10] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t('quickStart.startAnywayButton', 'Start a Workout Anyway')}
            </button>
          </div>
        ) : todayRoutine && todayCompleted && completedSession ? (
          /* ── COMPLETED STATE — matches Dashboard hero ── */
          <div className="w-full rounded-2xl bg-gradient-to-br from-[#10B981]/8 to-[#10B981]/[0.01] border border-[#10B981]/15 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-[#10B981]" />
            </div>
            <p className="font-bold text-[18px]" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.workoutAlreadyCompleted', 'Workout Already Completed')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('quickStart.greatJobPrefix', 'Great job today! Your')} <span className="text-[#10B981] font-semibold">{localizeRoutineName(todayRoutine.name || '').replace(/ [AB]$/, '')}</span> {t('quickStart.greatJobSuffix', 'session is done.')}
            </p>

            {/* Link to session summary */}
            {(() => {
              const vol = parseFloat(completedSession.total_volume_lbs) || 0;
              const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
              return (
                <Link
                  to="/session-summary"
                  state={{
                    routineName: completedSession.name || todayRoutine.name,
                    elapsedTime: completedSession.duration_seconds,
                    totalVolume: vol,
                    completedSets: 0,
                    sessionId: completedSession.id,
                    completedAt: completedSession.completed_at,
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-3 text-left focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                    <Trophy size={16} className="text-[#10B981]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{completedSession.name || todayRoutine.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                      <span>{Math.round((completedSession.duration_seconds || 0) / 60)}m</span>
                      <span className="text-white/[0.06]">&middot;</span>
                      <span>{volStr} lbs</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-[#10B981]">{t('quickStart.viewSummary', 'View summary')}</span>
                </Link>
              );
            })()}

            <button
              onClick={() => navigate('/workouts')}
              className="w-full py-3.5 rounded-2xl text-[13px] font-bold bg-white/[0.06] hover:bg-white/[0.10] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t('quickStart.doAnotherWorkout', 'Do Another Workout')}
            </button>
          </div>
        ) : todayRoutine ? (
          <button
            type="button"
            onClick={() => navigate(`/session/${todayRoutine.id}`, { state: { skipWarmUp: !includeWarmUp } })}
            className="relative w-full rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ aspectRatio: '4 / 3', color: '#ffffff' }}
          >
            {/* Background: gradient + all videos stacked (no unmount flash) */}
            <div className="absolute inset-0">
              <div className="w-full h-full bg-gradient-to-br from-[#1a1f35] to-[#0a0f1a]" />
              {todayExercises.map((ex, i) => ex.video && (
                <video
                  key={i}
                  src={ex.video}
                  autoPlay loop muted playsInline preload="auto"
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
                  style={{ opacity: i === cycleIndex ? 1 : 0 }}
                />
              ))}
            </div>

            {/* Overlay — strong enough so white text is always readable */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/40 z-[1]" />
            <div className="absolute top-0 left-0 right-0 h-[2px] z-[2] bg-gradient-to-r from-transparent via-[#D4AF37]/40 to-transparent" />

            {/* Exercise dots */}
            {todayExercises.length > 1 && (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1" role="tablist" aria-label={t('quickStart.exerciseIndicators', 'Exercise indicators')}>
                {todayExercises.map((ex, i) => (
                  <div
                    key={i}
                    role="tab"
                    aria-selected={i === cycleIndex}
                    aria-label={`${ex.name || `Exercise ${i + 1}`}`}
                    className={`rounded-full transition-all duration-300 ${
                      i === cycleIndex ? 'w-4 h-1.5 bg-white/80' : 'w-1.5 h-1.5 bg-white/25'
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Content */}
            <div className="relative z-10 h-full flex flex-col justify-end p-5 force-white">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] mb-2 text-[#D4AF37]">
                {t('quickStart.todaysWorkout')}
              </p>
              <h2 className="text-[18px] font-black tracking-tight leading-tight truncate"
                ref={el => { if (el) el.style.setProperty('color', '#ffffff', 'important'); }}>
                {localizeRoutineName(todayRoutine.name || '').replace(/ [AB]$/, '')}
              </h2>

              {/* Current exercise info */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={cycleIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="text-[13px] mt-1"
                  ref={el => { if (el) el.style.setProperty('color', 'rgba(255,255,255,0.7)', 'important'); }}
                >
                  {currentEx.name} — {currentEx.sets}×{currentEx.reps}
                </motion.p>
              </AnimatePresence>

              <p className="text-[12px] mt-1 mb-4" ref={el => { if (el) el.style.setProperty('color', 'rgba(255,255,255,0.6)', 'important'); }}>
                {todayExercises.length} {t('quickStart.exercises')}
              </p>

              {/* CTA */}
              {(() => {
                const draft = activeDrafts.find(d => d.routineId === String(todayRoutine.id));
                const isResume = !!draft;
                const draftSets = draft ? Object.values(draft.loggedSets || {}).flat() : [];
                const completed = draftSets.filter(s => s.completed).length;
                const total = draftSets.length;
                return (
                  <div className={`w-full py-5 rounded-2xl flex items-center justify-center gap-2.5 shadow-[0_4px_24px_rgba(212,175,55,0.3)] ${isResume ? 'bg-emerald-500 text-black' : 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)]'}`}>
                    <Play size={20} fill="currentColor" strokeWidth={0} />
                    <span className="text-[14px] font-black tracking-wide uppercase whitespace-nowrap">
                      {isResume
                        ? `${t('quickStart.resumeWorkout', 'Resume Workout')} · ${completed}/${total}`
                        : t('quickStart.startWorkout')}
                    </span>
                  </div>
                );
              })()}
            </div>
          </button>
        ) : (
          /* No routines at all */
          <div className="rounded-2xl border border-white/[0.06] p-8 text-center" style={{ background: 'var(--color-bg-card)' }}>
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Dumbbell size={28} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="font-bold text-[16px]" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.noRoutinesYet')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>{t('quickStart.createToGetStarted')}</p>
            <button
              onClick={() => navigate('/workouts')}
              className="inline-block py-3 px-8 rounded-2xl text-black font-bold text-[14px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ background: '#D4AF37' }}
            >
              {t('quickStart.createRoutine')}
            </button>
          </div>
        )}

        {/* ── WARM-UP TOGGLE ─────────────────────────────────── */}
        <label className="flex items-center justify-between px-4 py-3 rounded-2xl border border-white/[0.06] cursor-pointer" style={{ background: 'var(--color-bg-card)' }}>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('quickStart.includeWarmUp', 'Include Warm-Up')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={includeWarmUp}
            onClick={() => setIncludeWarmUp(v => !v)}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: includeWarmUp ? '#D4AF37' : 'rgba(255,255,255,0.12)' }}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${includeWarmUp ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </label>

        {/* ── START ANOTHER — three cards ────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {/* Choose Existing — opens the picker modal */}
          <button
            type="button"
            onClick={() => setShowOther(true)}
            className="rounded-[16px] p-3.5 text-left active:scale-[0.97] focus:ring-2 focus:outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
              '--tw-ring-color': 'var(--color-accent)',
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-2.5"
              style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
            >
              <Dumbbell size={18} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="text-[13px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui', fontWeight: 800, letterSpacing: -0.2 }}>
              {t('quickStart.chooseRoutine')}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {otherRoutines.length} {t('quickStart.available')}
            </p>
          </button>

          {/* Quick Start Empty */}
          <button
            type="button"
            onClick={() => navigate('/session/empty', { state: { skipWarmUp: !includeWarmUp } })}
            className="rounded-[16px] p-3.5 text-left active:scale-[0.97] focus:ring-2 focus:outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1.5px dashed color-mix(in srgb, var(--color-accent) 35%, transparent)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
              '--tw-ring-color': 'var(--color-accent)',
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-2.5"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
            >
              <Zap size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <p className="text-[13px]" style={{ color: 'var(--color-accent)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui', fontWeight: 800, letterSpacing: -0.2 }}>
              {t('quickStart.startEmptyWorkout')}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('quickStart.addExercisesAsYouGo')}
            </p>
          </button>

          {/* Cardio Session — GPS-tracked runs, walks, bikes.
              When a live cardio session is in progress, this card flips to a
              "Resume" state so the user can jump back into the run instead of
              starting a new one. */}
          <button
            type="button"
            onClick={() => navigate('/cardio-live')}
            className="rounded-[16px] p-3.5 text-left active:scale-[0.97] focus:ring-2 focus:outline-none relative overflow-hidden"
            style={{
              background: liveCardio
                ? 'color-mix(in srgb, #FF5A2E 12%, var(--color-bg-card))'
                : 'var(--color-bg-card)',
              border: '1px solid color-mix(in srgb, #FF5A2E ' + (liveCardio ? '50' : '22') + '%, transparent)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
              '--tw-ring-color': '#FF5A2E',
            }}
          >
            {liveCardio && (
              <div
                className="absolute top-3 right-3 flex items-center gap-1"
                style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: '#FF5A2E', textTransform: 'uppercase' }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: 999, background: '#FF5A2E',
                    boxShadow: '0 0 0 0 rgba(255,90,46,0.6)',
                    animation: 'qs-pulse 1.6s ease-out infinite',
                  }}
                />
                Live
              </div>
            )}
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-2.5"
              style={{ background: 'color-mix(in srgb, #FF5A2E 10%, transparent)', border: '1px solid color-mix(in srgb, #FF5A2E 20%, transparent)' }}
            >
              <Activity size={18} style={{ color: '#FF5A2E' }} />
            </div>
            <p className="text-[13px]" style={{ color: '#FF5A2E', fontFamily: '"Familjen Grotesk", "Archivo", system-ui', fontWeight: 800, letterSpacing: -0.2 }}>
              {liveCardio
                ? t('quickStart.resumeCardio', 'Resume Cardio')
                : t('quickStart.cardioSession', 'Cardio Session')}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: liveCardio ? '#FF5A2E' : 'var(--color-text-subtle)' }}>
              {liveCardio
                ? `${fmtElapsed(liveCardio.accumulatedSec)} · ${liveCardio.running ? t('quickStart.cardioRunning', 'running') : t('quickStart.cardioPaused', 'paused')}`
                : t('quickStart.runBikeTrack', 'Run, bike, track GPS')}
            </p>
            <style>{`
              @keyframes qs-pulse {
                0% { box-shadow: 0 0 0 0 rgba(255,90,46,0.5); }
                70% { box-shadow: 0 0 0 6px rgba(255,90,46,0); }
                100% { box-shadow: 0 0 0 0 rgba(255,90,46,0); }
              }
            `}</style>
          </button>
        </div>

      </div>
    </div>

    {showOther && otherRoutines.length > 0 && (
      <RoutinePickerModal
        routines={otherRoutines}
        onClose={() => setShowOther(false)}
        onEdit={(routineId) => { setShowOther(false); navigate(`/workouts/${routineId}/edit?from=/quick-start`); }}
        onStart={(routineId) => { setShowOther(false); navigate(`/session/${routineId}`, { state: { skipWarmUp: !includeWarmUp } }); }}
        t={t}
      />
    )}

    {showCreateModal && (
      <CreateRoutineModal
        onClose={() => setShowCreateModal(false)}
        onSave={async ({ name, exercises: exs }) => {
          // Create routine in DB
          const { data: routine, error: routineErr } = await supabase
            .from('routines')
            .insert({ name, created_by: user.id, gym_id: profile.gym_id, is_template: false })
            .select('id')
            .single();
          if (routineErr) throw routineErr;

          // Insert exercises if any
          if (exs?.length > 0) {
            const rows = exs.map((ex, i) => ({
              routine_id: routine.id, exercise_id: ex.id, position: i + 1,
              target_sets: ex.sets, target_reps: ex.reps, rest_seconds: ex.restSeconds,
            }));
            await supabase.from('routine_exercises').insert(rows);
          }

          // Route based on whether exercises were added
          if (exs?.length > 0) {
            navigate(`/session/${routine.id}`);
          } else {
            navigate(`/workouts/${routine.id}/edit?from=/quick-start`);
          }
        }}
      />
    )}
    </FadeIn>
  );
};

export default QuickStart;

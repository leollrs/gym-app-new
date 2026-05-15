import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, Share2, Trophy, Zap, Flame, Trash2 } from 'lucide-react';
import { AppleHealthSyncedChip } from '../components/AppleHealthBadge';
import { supabase } from '../lib/supabase';
import { writeWorkout } from '../lib/healthSync';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { sendNotification } from '../lib/notifications';
import { awardAchievements } from '../lib/achievements';
import AchievementToast from '../components/AchievementToast';
import WellnessCheckinModal from '../components/WellnessCheckinModal';
import ShareSheet from '../components/share/ShareSheet';
import { SharePRSheet } from '../components/share/QuickShareSheets';
import { sanitize } from '../lib/sanitize';
import { localizeRoutineName } from '../lib/exerciseName';
import { formatStatNumber } from '../lib/formatStatValue';
import { analyzeAndAdapt, saveAdaptationSuggestions } from '../lib/programAdaptation';
import { updateGoalsAfterWorkout } from '../lib/goalUpdater';
import { updateWorkoutSchedulePattern } from '../lib/workoutScheduleTracker';

import { useTranslation } from 'react-i18next';

const MILESTONES = [1, 10, 25, 50, 100, 200, 365];

// Brand palette
const T = {
  ink: '#0A0D10',
  gold: '#D4A835',
  goldSoft: '#F5EACF',
  warm: '#FF7A3D',
  purple: '#6D5FDB',
  teal: '#2EC4C4',
  tealDeep: '#0E8A8A',
  tealSoft: '#DBF3F3',
};

// Format seconds -> "58m 17s"
const fmtDurationShort = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${String(mm).padStart(2, '0')}m`;
};

// Format seconds -> "58:17" for stat strip
const fmtDurationColon = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

// Uppercase date like "WED · APR 22 · 2026"
const fmtTicketDate = (iso, lang) => {
  try {
    const d = new Date(iso);
    const locale = lang === 'es' ? 'es-ES' : 'en-US';
    const dow = d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase().replace('.', '');
    const mon = d.toLocaleDateString(locale, { month: 'short' }).toUpperCase().replace('.', '');
    const day = d.getDate();
    const yr = d.getFullYear();
    return `${dow} · ${mon} ${day} · ${yr}`;
  } catch {
    return '';
  }
};

const SessionSummary = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, profile, gymName, gymLogoUrl } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const [visible, setVisible] = useState(false);
  const [newAchievements, setNewAchievements] = useState([]);
  const [healthSynced, setHealthSynced] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Per-PR share: holds the pr object for the currently-shareable PR.
  // Tapping the small share-circle on a PR card opens SharePRSheet for
  // just that single PR — separate from the whole-session ShareSheet so
  // users can broadcast just the headline lift instead of the full
  // workout breakdown.
  const [prShareTarget, setPrShareTarget] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Data passed from ActiveSession via navigate state
  const {
    routineName    = 'Workout',
    elapsedTime    = 0,
    totalVolume    = 0,
    completedSets: initialCompletedSets  = 0,
    totalSets: initialTotalSets      = 0,
    totalExercises: initialTotalExercises = 0,
    sessionPRs     = [],
    completedAt    = new Date().toISOString(),
    xpEarned       = 0,
    heartRate      = null,
    streak: initialStreak = 0,
    workedMuscleGroups = [],
    sessionId      = null,
  } = location.state ?? {};

  // If navigate state has 0 sets but we have a sessionId, fetch from DB + pull per-exercise volume
  const [completedSets, setCompletedSets] = useState(initialCompletedSets);
  const [totalSets, setTotalSets] = useState(initialTotalSets);
  const [totalExercises, setTotalExercises] = useState(initialTotalExercises);
  const [exerciseBreakdown, setExerciseBreakdown] = useState([]); // [{name, vol}]
  const [volumeDeltaPct, setVolumeDeltaPct] = useState(null); // vs last session of same routine
  const [streak, setStreak] = useState(initialStreak || 0);
  const [streakWeek, setStreakWeek] = useState([0, 0, 0, 0, 0, 0, 0]); // past 7 days: 1 if trained
  const fetchedRef = useRef(false);

  // ── Fetch session breakdown + volume delta + streak ──────────────────────
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      // Per-exercise volume breakdown (from session_sets joined to session_exercises joined to exercises)
      if (sessionId) {
        try {
          const { data } = await supabase
            .from('session_exercises')
            .select('id, exercise_id, exercises(name, name_es), session_sets(weight_lbs, reps, is_completed)')
            .eq('session_id', sessionId);
          if (data?.length) {
            let setCount = 0;
            const rows = data.map(ex => {
              const sets = ex.session_sets || [];
              const done = sets.filter(s => s.is_completed !== false);
              setCount += done.length;
              const vol = done.reduce((sum, s) => sum + (s.weight_lbs || 0) * (s.reps || 0), 0);
              const name = (i18n.language === 'es' && ex.exercises?.name_es) || ex.exercises?.name || 'Exercise';
              return { name, vol };
            }).filter(r => r.vol > 0).sort((a, b) => b.vol - a.vol).slice(0, 5);
            setExerciseBreakdown(rows);
            if (initialCompletedSets === 0 && setCount > 0) {
              setCompletedSets(setCount);
              setTotalSets(setCount);
              setTotalExercises(data.length);
            }
          }
        } catch {}
      }

      // Volume delta vs previous completed session of same routine name
      if (user?.id && routineName && totalVolume > 0) {
        try {
          const { data: prev } = await supabase
            .from('workout_sessions')
            .select('total_volume_lbs, started_at')
            .eq('profile_id', user.id)
            .eq('status', 'completed')
            .eq('name', routineName)
            .lt('started_at', completedAt)
            .order('started_at', { ascending: false })
            .limit(1);
          const lastVol = prev?.[0]?.total_volume_lbs;
          if (lastVol && lastVol > 0) {
            const pct = Math.round(((totalVolume - lastVol) / lastVol) * 100);
            setVolumeDeltaPct(pct);
          }
        } catch {}
      }

      // Streak + 7-day dot row
      if (user?.id) {
        try {
          const { data: sc } = await supabase
            .from('streak_cache')
            .select('current_streak_days')
            .eq('profile_id', user.id)
            .maybeSingle();
          if (sc?.current_streak_days != null) setStreak(sc.current_streak_days);

          // Look at the last 7 calendar days, mark ones with a completed session
          const since = new Date();
          since.setDate(since.getDate() - 6);
          since.setHours(0, 0, 0, 0);
          const { data: recent } = await supabase
            .from('workout_sessions')
            .select('started_at')
            .eq('profile_id', user.id)
            .eq('status', 'completed')
            .gte('started_at', since.toISOString());
          const days = Array(7).fill(0);
          const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
          (recent || []).forEach(r => {
            const d = new Date(r.started_at); d.setHours(0, 0, 0, 0);
            const idx = 6 - Math.round((todayMid - d) / 86400000);
            if (idx >= 0 && idx < 7) days[idx] = 1;
          });
          setStreakWeek(days);
        } catch {}
      }
    })();
  }, [sessionId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entrance animation
  useEffect(() => {
    const tm = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(tm);
  }, []);

  // Daily wellness check-in: prompt once the session lands on this screen,
  // unless the user already logged today's soreness. Slight delay so the
  // confetti / PR celebration plays first.
  const [showWellnessCheckin, setShowWellnessCheckin] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const dateKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    // Local cache short-circuit: if we already have a check-in for today
    // recorded locally (e.g. offline save), don't re-prompt.
    try {
      const raw = localStorage.getItem('tugympr_wellness_last_checkin');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === dateKey && typeof parsed.soreness === 'number') return;
      }
    } catch {}
    (async () => {
      const { data } = await supabase
        .from('wellness_checkins')
        .select('soreness')
        .eq('profile_id', user.id)
        .eq('checkin_date', dateKey)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setTimeout(() => { if (!cancelled) setShowWellnessCheckin(true); }, 2200);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Sync completed workout to Apple Health / Health Connect if enabled
  useEffect(() => {
    try {
      const hs = JSON.parse(localStorage.getItem('tugympr_health_settings') || '{}');
      if (hs.syncWorkouts) {
        const end = completedAt ? new Date(completedAt) : new Date();
        const start = new Date(end.getTime() - (elapsedTime || 0) * 1000);
        writeWorkout({
          name: routineName || 'Workout',
          startDate: start,
          endDate: end,
          calories: undefined,
        }).then(() => setHealthSynced(true)).catch(() => {});
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Milestone + PR notifications, challenges, achievements, adaptation, goals, schedule
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (!user?.id || !profile?.gym_id) return;
    firedRef.current = true;
    const fire = async () => {
      const { count } = await supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('status', 'completed');

      if (MILESTONES.includes(count)) {
        await sendNotification(user.id, profile.gym_id, {
          type:     'workout_reminder',
          title:    count === 1
            ? i18n.t('notifications.workoutsCompletedSingular', { ns: 'common', count, defaultValue: `${count} workout completed!` })
            : i18n.t('notifications.workoutsCompletedPlural', { ns: 'common', count, defaultValue: `${count} workouts completed!` }),
          body:     count === 1
            ? i18n.t('notifications.welcomeJourney', { ns: 'common', defaultValue: 'Welcome to your fitness journey. Keep it up!' })
            : i18n.t('notifications.hitWorkoutsConsistency', { ns: 'common', count, defaultValue: `You've hit ${count} workouts. Consistency is everything.` }),
          dedupKey: `milestone_${count}_${user.id}`,
        });
      }

      if (sessionPRs?.length > 0) {
        await sendNotification(user.id, profile.gym_id, {
          type:     'pr_beaten',
          title:    sessionPRs.length > 1
            ? i18n.t('notifications.newPRsPlural', { ns: 'common', count: sessionPRs.length, defaultValue: `${sessionPRs.length} new PRs this session!` })
            : i18n.t('notifications.newPRsSingular', { ns: 'common', count: sessionPRs.length, defaultValue: `${sessionPRs.length} new PR this session!` }),
          body:     sessionPRs.slice(0, 3).map(p => p.exerciseName ?? p.exercise_name ?? i18n.t('social.feedContent.exercise', { ns: 'pages', defaultValue: 'Exercise' })).join(', '),
          dedupKey: `pr_session_${completedAt}_${user.id}`,
        });
      }

      const now = new Date().toISOString();
      const { data: myParticipations } = await supabase
        .from('challenge_participants')
        .select('id, challenge_id, score, challenges(type, start_date, end_date, status, exercise_id, scoring_metric, exercise_ids, milestone_target)')
        .eq('profile_id', user.id)
        .eq('gym_id', profile.gym_id);

      const active = (myParticipations || []).filter(p => {
        const c = p.challenges;
        if (!c) return false;
        return new Date(c.start_date) <= new Date(now) && new Date(c.end_date) >= new Date(now);
      });

      for (const p of active) {
        const c = p.challenges;
        const type = c.type;
        let delta = 0;

        if (type === 'consistency') {
          delta = 1;
        } else if (type === 'volume') {
          delta = totalVolume ?? 0;
        } else if (type === 'pr_count') {
          delta = sessionPRs?.length ?? 0;
        } else if (type === 'team') {
          const metric = c.scoring_metric || 'consistency';
          if (metric === 'consistency') delta = 1;
          else if (metric === 'volume')  delta = totalVolume ?? 0;
          else if (metric === 'pr_count') delta = sessionPRs?.length ?? 0;
        } else if (type === 'specific_lift' && c.exercise_id) {
          const metric = c.scoring_metric || 'volume';
          if (metric === 'volume' && sessionId) {
            const { data: exSets } = await supabase
              .from('session_sets')
              .select('weight_lbs, reps, session_exercises!inner(exercise_id)')
              .eq('session_exercises.session_id', sessionId)
              .eq('session_exercises.exercise_id', c.exercise_id)
              .eq('is_completed', true);
            delta = (exSets || []).reduce((sum, s) => sum + (s.weight_lbs || 0) * (s.reps || 0), 0);
          } else if (metric === '1rm') {
            const matchingPRs = (sessionPRs || []).filter(pr => pr.exerciseId === c.exercise_id);
            delta = matchingPRs.length;
          }
        } else if (type === 'milestone' && c.exercise_ids?.length > 0) {
          const { data: prs } = await supabase
            .from('personal_records')
            .select('exercise_id, estimated_1rm')
            .eq('profile_id', user.id)
            .in('exercise_id', c.exercise_ids);
          const combinedTotal = (prs || []).reduce((sum, pr) => sum + (pr.estimated_1rm || 0), 0);
          if (combinedTotal > 0) {
            await supabase.rpc('set_challenge_score', {
              p_participant_id: p.id,
              p_score: combinedTotal,
            });
          }
          continue;
        }

        if (delta === 0) continue;
        await supabase.rpc('increment_challenge_score', {
          p_participant_id: p.id,
          p_delta: delta,
        });
      }

      const newlyEarned = await awardAchievements(user.id, profile.gym_id, supabase);

      for (const ach of newlyEarned) {
        await supabase.from('activity_feed_items').insert({
          gym_id:    profile.gym_id,
          actor_id:  user.id,
          type:      'achievement_unlocked',
          is_public: true,
          data: {
            achievement_key:  ach.key,
            achievement_name: ach.label,
            achievement_name_key: ach.labelKey,
            achievement_desc: ach.desc,
            achievement_desc_key: ach.descKey,
          },
        });

        const achLabel = ach.labelKey ? i18n.t(ach.labelKey, { ns: 'common', defaultValue: ach.label }) : ach.label;
        const achDesc  = ach.descKey ? i18n.t(ach.descKey, { ns: 'common', defaultValue: ach.desc }) : ach.desc;
        const quotedLabel = i18n.language === 'es' ? `\u00AB${achLabel}\u00BB` : `\u201C${achLabel}\u201D`;
        await sendNotification(user.id, profile.gym_id, {
          type:     'achievement',
          title:    i18n.t('notifications.achievementUnlocked', { ns: 'common', label: quotedLabel, defaultValue: `Achievement Unlocked: ${quotedLabel}` }),
          body:     achDesc,
          dedupKey: `achievement_${ach.key}_${user.id}`,
        });
      }

      if (newlyEarned.length > 0) setNewAchievements(newlyEarned);

      try {
        const adaptations = await analyzeAndAdapt(user.id, profile.gym_id);
        if (adaptations) saveAdaptationSuggestions(adaptations);
      } catch {}

      try {
        const prData = (sessionPRs || []).map(pr => ({
          exerciseId: pr.exercise_id ?? pr.exerciseId ?? null,
          estimated1RM: pr.estimated1RM ?? pr.weight ?? 0,
        }));
        await updateGoalsAfterWorkout(user.id, profile.gym_id, {
          totalVolume: totalVolume ?? 0,
          sessionPRs: prData,
        });
      } catch {}

      try {
        await updateWorkoutSchedulePattern(user.id, profile.gym_id);
      } catch {}
    };
    fire();
  }, [user?.id, profile?.gym_id]); // eslint-disable-line

  const firstName = (profile?.full_name || '').split(' ')[0] || profile?.username || '';
  const dateLocale = i18n.language === 'es' ? 'es-ES' : 'en-US';
  const dateStr = new Date(completedAt).toLocaleDateString(dateLocale, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const ticketDate = fmtTicketDate(completedAt, i18n.language);

  // Headline: "You earned it, <name>." | fallback "You earned it, cabrón."
  const earnedHeadlinePre  = t('sessionSummary.earnedHeadlinePre',  { defaultValue: 'You earned' });
  const earnedHeadlinePost = firstName
    ? t('sessionSummary.earnedHeadlinePost', { defaultValue: 'it, {{name}}.', name: firstName })
    : t('sessionSummary.earnedHeadlineCabron', { defaultValue: 'it, cabrón.' });
  const showedUpHeadline = t('sessionSummary.showedUpHeadline', { defaultValue: 'You showed up.' });

  const maxVol = useMemo(() => Math.max(1, ...exerciseBreakdown.map(e => e.vol)), [exerciseBreakdown]);

  // Trust the RPC return (complete_workout_v2 surfaces xp_earned canonically).
  // Fallback is intentionally just 0 — no fabricated formula that disagrees
  // with the server-side XP rules.
  const xpDisplay = xpEarned > 0 ? xpEarned : 0;

  const subtitle = `${localizeRoutineName(routineName)} · ${fmtDurationShort(elapsedTime)}`;
  const prCount = sessionPRs?.length || 0;

  const accentCss = typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || T.teal
    : T.teal;

  const handleDeleteWorkout = async () => {
    if (!sessionId || deleting) return;
    setDeleting(true);
    try {
      await supabase
        .from('workout_sessions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', sessionId);
      showToast(
        t('sessionSummary.deleteSuccess', { defaultValue: 'Workout discarded' }),
        'success'
      );
      navigate('/');
    } catch {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] overflow-y-auto"
      style={{
        background: 'var(--color-bg-primary, #0B0E11)',
        color: 'var(--color-text-primary)',
        fontFamily: "'Familjen Grotesk', 'Archivo', system-ui, sans-serif",
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      {newAchievements.length > 0 && (
        <AchievementToast
          achievements={newAchievements}
          onDone={() => setNewAchievements([])}
        />
      )}

      <div
        className="relative mx-auto max-w-[480px] pb-10"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(14px)',
          transition: 'opacity .35s ease, transform .35s ease',
        }}
      >
        {/* ── HERO POSTER ─────────────────────────────────────────────── */}
        <div
          style={{
            margin: '24px 16px 0',
            background: T.ink,
            borderRadius: 28,
            overflow: 'hidden',
            position: 'relative',
            color: '#fff',
          }}
        >
          <div style={{
            position: 'absolute', top: -60, right: -60, width: 220, height: 220, borderRadius: 999,
            background: `radial-gradient(circle, ${accentCss}73 0%, transparent 60%)`,
            pointerEvents: 'none',
          }}/>
          <div style={{
            position: 'absolute', bottom: -40, left: -40, width: 180, height: 180, borderRadius: 999,
            background: `radial-gradient(circle, ${T.gold}52 0%, transparent 60%)`,
            pointerEvents: 'none',
          }}/>

          {/* Top bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 14px 0', position: 'relative' }}>
            <button
              onClick={() => navigate(-1)}
              aria-label={t('sessionSummary.back', { defaultValue: 'Back' })}
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(255,255,255,0.1)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <ChevronLeft size={18} color="#fff" strokeWidth={2.2}/>
            </button>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
              {ticketDate}
            </div>
            <button
              onClick={() => setShareOpen(true)}
              aria-label={t('sessionSummary.shareAria', { defaultValue: 'Share' })}
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(255,255,255,0.1)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <Share2 size={14} color="#fff" strokeWidth={2}/>
            </button>
          </div>

          {/* Headline */}
          <div style={{ position: 'relative', padding: '28px 22px 20px' }}>
            {prCount > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                background: T.goldSoft, color: '#6F4F14', borderRadius: 999,
                fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
              }}>
                <Trophy size={11} color="#6F4F14" strokeWidth={2.2}/>
                {prCount} {prCount === 1
                  ? t('sessionSummary.newPRChip', { defaultValue: 'NEW PR' })
                  : t('sessionSummary.newPRsChip', { defaultValue: 'NEW PR' })}
              </div>
            )}
            <div style={{
              fontSize: 44, fontWeight: 700, letterSpacing: -1.8, lineHeight: 0.95,
              marginTop: 14, fontFamily: "'Familjen Grotesk', 'Archivo', system-ui, sans-serif",
            }}>
              {prCount > 0 ? (
                <>
                  {earnedHeadlinePre}<br/>
                  <span style={{ color: accentCss }}>{earnedHeadlinePost}</span>
                </>
              ) : (
                <>
                  {showedUpHeadline}<br/>
                  <span style={{ color: accentCss }}>{t('sessionSummary.thatCounts', { defaultValue: 'That counts.' })}</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 10 }}>
              {subtitle}
            </div>
          </div>

          {/* Perforated divider */}
          <div style={{ position: 'relative', height: 20 }}>
            <div style={{ position: 'absolute', left: -10, top: 5, width: 20, height: 20, borderRadius: 999, background: 'var(--color-bg-primary, #0B0E11)' }}/>
            <div style={{ position: 'absolute', right: -10, top: 5, width: 20, height: 20, borderRadius: 999, background: 'var(--color-bg-primary, #0B0E11)' }}/>
            <div style={{
              position: 'absolute', left: 18, right: 18, top: 14,
              borderTop: '1.5px dashed rgba(255,255,255,0.18)',
            }}/>
          </div>

          {/* Stats strip */}
          <div style={{ display: 'flex', padding: '4px 6px 22px', position: 'relative' }}>
            {[
              { label: t('sessionSummary.duration').toUpperCase(), value: fmtDurationColon(elapsedTime), sub: 'min' },
              { label: t('sessionSummary.volume').toUpperCase(), value: formatStatNumber(Math.round(totalVolume || 0)), sub: 'lbs' },
              { label: t('sessionSummary.setsDone').toUpperCase(), value: totalSets > 0 ? `${completedSets}/${totalSets}` : `${completedSets}`, sub: t('sessionSummary.done', { defaultValue: 'done' }) },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, padding: '14px 10px', position: 'relative' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 1.4 }}>{s.label}</div>
                <div style={{
                  fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: -0.8, marginTop: 4,
                  fontVariantNumeric: 'tabular-nums',
                }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>{s.sub}</div>
                {i < 2 && <div style={{ position: 'absolute', right: 0, top: 18, bottom: 18, width: 1, background: 'rgba(255,255,255,0.1)' }}/>}
              </div>
            ))}
          </div>
        </div>

        {/* ── PR SECTION ──────────────────────────────────────────────── */}
        {prCount > 0 && (
          <div style={{ padding: '18px 16px 0' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 10, padding: '0 4px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'rgba(255,255,255,0.5)' }}>
                {t('sessionSummary.personalRecords', { defaultValue: 'PERSONAL RECORDS' })}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                {prCount} {t('sessionSummary.of', { defaultValue: 'of' })} {totalExercises || prCount}
              </div>
            </div>

            {sessionPRs.map((pr, i) => {
              const name = sanitize(pr.exercise || pr.exerciseName || 'Lift');
              const w = pr.weight || 0;
              const reps = pr.reps || 0;
              const prevW = pr.previousWeight ?? pr.prev_weight ?? null;
              const prevReps = pr.previousReps ?? pr.prev_reps ?? null;
              const deltaW = prevW != null ? w - prevW : null;
              const deltaReps = prevReps != null ? reps - prevReps : null;
              const prevText = prevW != null && prevReps != null ? `${prevW} × ${prevReps}` : null;
              const deltaParts = [];
              if (deltaW != null && deltaW !== 0) deltaParts.push(`${deltaW > 0 ? '+' : ''}${deltaW} lb`);
              if (deltaReps != null && deltaReps !== 0) deltaParts.push(`${deltaReps > 0 ? '+' : ''}${deltaReps} reps`);
              const deltaText = deltaParts.join(' · ');
              return (
                <div
                  key={`pr-${i}-${name}`}
                  style={{
                    background: 'var(--color-bg-card, #FFFFFF)', borderRadius: 20, padding: 16, marginBottom: 10,
                    border: '1px solid var(--color-border-subtle, rgba(10,13,16,0.08))',
                    display: 'flex', alignItems: 'center', gap: 12,
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: T.gold }}/>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, background: T.goldSoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 4,
                  }}>
                    <Trophy size={18} color="#8E6A1A" strokeWidth={2}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: -0.3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {name}
                    </div>
                    {prevText && deltaText ? (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {t('sessionSummary.was', { defaultValue: 'was' })}{' '}
                        <span style={{ color: 'var(--color-text-subtle)' }}>{prevText}</span>
                        {' · '}
                        {t('sessionSummary.now', { defaultValue: 'now' })}{' '}
                        <span style={{ color: T.gold, fontWeight: 700 }}>{deltaText}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {t('sessionSummary.freshRecord', { defaultValue: 'Fresh record' })}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)',
                      letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                    }}>
                      {w}<span style={{ fontSize: 12, color: 'var(--color-text-subtle)', marginLeft: 2 }}>lb</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>× {reps} {t('sessionSummary.reps', { defaultValue: 'reps' })}</div>
                  </div>
                  {/* Per-PR share. Opens SharePRSheet so the user can post
                      just this one PR — the headline moment most people
                      actually want to broadcast — instead of the entire
                      session breakdown. */}
                  <button
                    type="button"
                    onClick={() => setPrShareTarget({
                      id: pr.id || `pr-${i}`,
                      value: w,
                      unit: 'lbs',
                      exerciseName: name,
                      previousBest: prevW,
                    })}
                    aria-label={t('sessionSummary.sharePR', { defaultValue: 'Share PR' })}
                    style={{
                      marginLeft: 8, flexShrink: 0,
                      width: 36, height: 36, borderRadius: 999,
                      background: 'var(--color-surface-hover, rgba(255,255,255,0.08))',
                      border: '1px solid var(--color-border-subtle, rgba(0,0,0,0.06))',
                      color: 'var(--color-text-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Share2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── VOLUME BREAKDOWN ────────────────────────────────────────── */}
        {totalVolume > 0 && (
          <div style={{ padding: '14px 16px 0' }}>
            <div style={{
              background: 'var(--color-bg-card, #FFFFFF)', borderRadius: 20, padding: 18,
              border: '1px solid var(--color-border-subtle, rgba(10,13,16,0.08))',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'var(--color-text-muted)' }}>
                    {t('sessionSummary.totalVolume', { defaultValue: 'TOTAL VOLUME' })}
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: -0.8, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {formatStatNumber(Math.round(totalVolume))}
                    <span style={{ fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600, marginLeft: 4 }}>lb</span>
                  </div>
                </div>
                {volumeDeltaPct !== null && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                    background: volumeDeltaPct >= 0 ? T.tealSoft : 'rgba(255,122,61,0.15)',
                    borderRadius: 8,
                    color: volumeDeltaPct >= 0 ? T.tealDeep : '#B5501F',
                    fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
                  }}>
                    {volumeDeltaPct >= 0 ? '↑' : '↓'} {Math.abs(volumeDeltaPct)}% {t('sessionSummary.vsLast', { defaultValue: 'vs last' })}
                  </div>
                )}
              </div>

              {exerciseBreakdown.map((e, i) => {
                const color = i === 0 ? T.teal : i === 1 ? T.tealDeep : i === 2 ? T.purple : 'var(--color-text-subtle)';
                return (
                  <div key={i} style={{ marginTop: i === 0 ? 0 : 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                      <span style={{
                        fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        maxWidth: '60%',
                      }}>{e.name}</span>
                      <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(e.vol).toLocaleString()} lb
                      </span>
                    </div>
                    <div style={{ height: 6, background: 'var(--color-surface-hover, #EDEAE3)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{
                        width: `${(e.vol / maxVol) * 100}%`, height: '100%',
                        background: color, borderRadius: 999,
                        transition: 'width .6s ease',
                      }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── XP + STREAK ─────────────────────────────────────────────── */}
        <div style={{ padding: '14px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{
            background: 'var(--color-bg-card, #FFFFFF)', borderRadius: 18, padding: 16,
            border: '1px solid var(--color-border-subtle, rgba(10,13,16,0.08))',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Zap size={14} color={T.purple} fill={T.purple}/>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 1 }}>
                {t('sessionSummary.xpEarnedLabel', { defaultValue: 'XP EARNED' })}
              </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: -0.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              +{xpDisplay}
            </div>
            <div style={{ height: 4, background: 'var(--color-surface-hover, #EDEAE3)', borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (xpDisplay % 500) / 5)}%`, height: '100%', background: T.purple, transition: 'width .6s ease' }}/>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 5, letterSpacing: 0.3 }}>
              {t('sessionSummary.keepTraining')}
            </div>
          </div>

          <div style={{
            background: 'var(--color-bg-card, #FFFFFF)', borderRadius: 18, padding: 16,
            border: '1px solid var(--color-border-subtle, rgba(10,13,16,0.08))',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Flame size={14} color={T.warm} fill={T.warm}/>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 1 }}>
                {t('sessionSummary.streakLabel', { defaultValue: 'STREAK' })}
              </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: -0.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {streak}
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500, marginLeft: 4 }}>
                {streak === 1
                  ? t('sessionSummary.day', { defaultValue: 'day' })
                  : t('sessionSummary.days', { defaultValue: 'days' })}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 3, marginTop: 10 }}>
              {streakWeek.map((d, i) => (
                <div key={i} style={{
                  flex: 1, height: 6, borderRadius: 2,
                  background: d ? T.warm : 'var(--color-surface-hover, #EDEAE3)',
                }}/>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 5, letterSpacing: 0.3 }}>
              {(() => {
                const trained = streakWeek.filter(Boolean).length;
                const remaining = Math.max(0, 3 - trained);
                return remaining > 0
                  ? t('sessionSummary.moreThisWeek', { count: remaining, defaultValue: `${remaining} more this week` })
                  : t('sessionSummary.weekOnFire', { defaultValue: 'Week on fire' });
              })()}
            </div>
          </div>
        </div>

        {/* Apple Health sync confirmation */}
        {healthSynced && /iphone|ipad/i.test(navigator.userAgent) && (
          <div style={{ padding: '14px 16px 0' }}>
            <AppleHealthSyncedChip label={t('sessionSummary.savedToAppleHealth', 'Saved to Apple Health')} />
          </div>
        )}

        {/* ── ACTIONS ─────────────────────────────────────────────────── */}
        <div style={{ padding: '18px 16px 32px' }}>
          <button
            onClick={() => setShareOpen(true)}
            style={{
              width: '100%', height: 56, borderRadius: 18, background: T.ink,
              border: 'none', cursor: 'pointer', color: '#fff',
              fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              marginBottom: 10, transition: 'transform .1s ease, background .2s ease',
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <Share2 size={16} color="#fff" strokeWidth={2.2}/>
            {t('sessionSummary.share.shareWorkout', 'Share this workout')}
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => navigate('/')}
              style={{
                flex: 1, height: 48, borderRadius: 14, background: 'var(--color-bg-card, #FFFFFF)',
                border: '1px solid var(--color-border-subtle, rgba(10,13,16,0.08))', cursor: 'pointer', color: 'var(--color-text-primary)',
                fontSize: 14, fontWeight: 700,
              }}
            >
              {t('sessionSummary.backToTheGrind')}
            </button>
            <button
              onClick={() => navigate('/workouts')}
              style={{
                flex: 1, height: 48, borderRadius: 14, background: 'transparent',
                border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)',
                fontSize: 14, fontWeight: 600,
              }}
            >
              {t('sessionSummary.viewWorkouts')}
            </button>
          </div>
          {sessionId && (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              style={{
                width: '100%', height: 44, borderRadius: 12, background: 'transparent',
                border: '1px solid var(--color-border-subtle, rgba(10,13,16,0.08))',
                cursor: 'pointer', color: 'var(--color-danger, #B5501F)',
                fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginTop: 10,
              }}
            >
              <Trash2 size={14} strokeWidth={2}/>
              {t('sessionSummary.deleteWorkout', { defaultValue: 'Delete workout' })}
            </button>
          )}
        </div>
      </div>

      {/* ── Delete Confirmation Modal ───────────────────────────── */}
      {deleteConfirmOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            paddingTop: 'calc(env(safe-area-inset-top) + 20px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
          }}
          onClick={() => !deleting && setDeleteConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 360,
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
              borderRadius: 18, padding: 22,
              color: 'var(--color-text-primary)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14,
            }}>
              <Trash2 size={20} color="var(--color-danger)" strokeWidth={2.2}/>
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, letterSpacing: -0.4,
              color: 'var(--color-text-primary)', marginBottom: 6,
            }}>
              {t('sessionSummary.deleteWorkout', { defaultValue: 'Delete workout' })}
            </div>
            <div style={{
              fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.4,
              marginBottom: 18,
            }}>
              {t('sessionSummary.deleteConfirm', { defaultValue: 'Delete this workout? This cannot be undone.' })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
                style={{
                  flex: 1, height: 44, borderRadius: 12,
                  background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                  border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
                  color: 'var(--color-text-primary)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {t('sessionSummary.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                disabled={deleting}
                onClick={handleDeleteWorkout}
                style={{
                  flex: 1, height: 44, borderRadius: 12,
                  background: 'var(--color-danger, #B5501F)',
                  border: 'none', color: '#fff',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting
                  ? t('sessionSummary.deleting', { defaultValue: 'Deleting…' })
                  : t('sessionSummary.confirmDelete', { defaultValue: 'Delete' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share Sheet (modal) ─────────────────────────────────── */}
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        accent={accentCss}
        data={{
          sessionId,
          name: localizeRoutineName(routineName),
          date: dateStr,
          user: profile?.full_name || profile?.username || 'You',
          userHandle: profile?.username || '',
          duration: Math.round((elapsedTime || 0) / 60),
          durationSeconds: elapsedTime || 0,
          volume: Math.round(totalVolume || 0),
          sets: completedSets,
          reps: completedSets * 8,
          kcal: heartRate?.calories || Math.round((elapsedTime || 0) / 60 * 8),
          sessionNo: null,
          gym: gymName ? { name: gymName, location: '' } : null,
          gymLogoUrl: gymLogoUrl || null,
          muscleSummary: (workedMuscleGroups || []).slice(0, 3).join(' · '),
          muscles: (workedMuscleGroups || []).reduce((acc, m) => {
            const key = String(m).toLowerCase();
            if (/chest/.test(key)) acc.chest = 1;
            else if (/back/.test(key)) acc.back = 1;
            else if (/shoulder/.test(key)) acc.shoulders = 1;
            else if (/arm|bicep|tricep/.test(key)) acc.arms = 1;
            else if (/core|ab/.test(key)) acc.core = 1;
            else if (/quad|leg/.test(key)) acc.quads = 1;
            else if (/calf|calv/.test(key)) acc.calves = 1;
            else if (/glute|hip|hamstring/.test(key)) acc.quads = Math.max(acc.quads || 0, 0.6);
            return acc;
          }, {}),
          prs: (sessionPRs || []).map(pr => ({
            lift: pr.exercise || pr.exerciseName || 'Lift',
            weight: pr.weight || 0,
            reps: pr.reps || 0,
          })),
          exercises: [],
        }}
      />
      <WellnessCheckinModal
        open={showWellnessCheckin}
        onClose={() => setShowWellnessCheckin(false)}
      />
      <SharePRSheet
        open={!!prShareTarget}
        onClose={() => setPrShareTarget(null)}
        pr={prShareTarget}
        user={profile}
        gym={gymName}
        gymLogo={gymLogoUrl}
      />
    </div>
  );
};

export default SessionSummary;

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  X, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus,
  Trophy, Flame, Dumbbell, Calendar, Clock, Target, Award,
  Camera, Weight, BarChart3, Zap, Copy,
  Star, Shield, Crown, CalendarCheck, RotateCw, Rocket, Mountain,
  UserPlus, Users, Heart, Megaphone, Brain, Medal, Swords, MapPin, Apple, Gem,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { epley1RM } from '../lib/overloadEngine';
import { ACHIEVEMENT_DEFS } from '../lib/achievements';

import Skeleton from './Skeleton';
import FadeIn from './FadeIn';
import ChartTooltip from './ChartTooltip';
import { fmtDuration } from '../lib/dateUtils';
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, subMonths, addMonths, isAfter, isBefore, differenceInDays,
  getDay,
} from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';

// ── Design tokens ────────────────────────────────────────────────────────────
const GOLD = '#D4AF37';
const GREEN = '#10B981';
const RED = '#EF4444';
const CARD = 'bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)]';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n) => {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
};

const pctChange = (current, previous) => {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const ChangeIndicator = ({ current, previous, suffix = '', invert = false }) => {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (diff === 0 || (!current && !previous)) return <span className="text-[var(--color-text-subtle)] text-xs">—</span>;
  const isPositive = invert ? diff < 0 : diff > 0;
  const color = isPositive ? GREEN : RED;
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon size={12} />
      {diff > 0 ? '+' : ''}{pct}%{suffix}
    </span>
  );
};

// ── Major lifts to track ─────────────────────────────────────────────────────
const MAJOR_LIFT_IDS = [
  { id: 'ex_bp', key: 'benchPress' },
  { id: 'ex_sq', key: 'backSquat' },
  { id: 'ex_dl', key: 'deadlift' },
];

// ── Section wrapper with staggered animation ─────────────────────────────────
const Section = ({ title, icon: Icon, children, index = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.08 * index, duration: 0.4, ease: 'easeOut' }}
    className={`${CARD} p-5`}
  >
    <div className="flex items-center gap-2 mb-4">
      {Icon && <Icon size={18} style={{ color: GOLD }} />}
      <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
    </div>
    {children}
  </motion.div>
);

// ── Stat pill ────────────────────────────────────────────────────────────────
const StatPill = ({ label, value, prev, suffix, invert }) => (
  <div className="flex-1 min-w-[120px] bg-[var(--color-bg-deep)] rounded-xl p-3 text-center">
    <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">{label}</p>
    <p className="text-lg font-bold text-[var(--color-text-primary)]">{value}{suffix && <span className="text-xs text-[var(--color-text-muted)] ml-0.5">{suffix}</span>}</p>
    {prev !== undefined && <ChangeIndicator current={parseFloat(value?.toString().replace(/,/g, '')) || 0} previous={prev} invert={invert} />}
  </div>
);

// ── Calendar heatmap ─────────────────────────────────────────────────────────
const CalendarHeatmap = ({ days, trainedDates }) => {
  const trainedSet = new Set(trainedDates.map(d => d.slice(0, 10)));
  const firstDay = getDay(days[0]); // 0=Sun
  const cells = [];
  // Pad with empty cells for alignment
  for (let i = 0; i < firstDay; i++) cells.push(null);
  days.forEach(d => cells.push(d));

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {[t('monthlyReport.daySun'), t('monthlyReport.dayMon'), t('monthlyReport.dayTue'), t('monthlyReport.dayWed'), t('monthlyReport.dayThu'), t('monthlyReport.dayFri'), t('monthlyReport.daySat')].map((d, i) => (
          <div key={i} className="text-[10px] text-[var(--color-text-subtle)] text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="w-full aspect-square" />;
          const dateStr = format(day, 'yyyy-MM-dd');
          const trained = trainedSet.has(dateStr);
          const isFuture = isAfter(day, new Date());
          return (
            <div
              key={dateStr}
              className={`w-full aspect-square rounded-[4px] transition-colors ${
                isFuture
                  ? 'bg-[var(--color-bg-hover)]'
                  : trained
                    ? 'bg-[#D4AF37]/80'
                    : 'bg-[var(--color-bg-active)]'
              }`}
              title={`${format(day, 'MMM d')}${trained ? ' — Trained' : ''}`}
            />
          );
        })}
      </div>
    </div>
  );
};

// ── Icon string → component map for achievements ────────────────────────────
const ICON_MAP = {
  Dumbbell, Flame, Zap, Star, Trophy, Shield, Crown, CalendarCheck,
  RotateCw, Rocket, Mountain, Target, TrendingUp, Award, UserPlus,
  Users, Heart, Megaphone, Brain, Medal, Swords, MapPin, Apple, Weight, Gem,
};

// ── Angle label translations ────────────────────────────────────────────────
const ANGLE_LABELS = {
  en: { front: 'Front', side: 'Side', back: 'Back' },
  es: { front: 'Frontal', side: 'Lateral', back: 'Espalda' },
};

// ══════════════════════════════════════════════════════════════════════════════
// ══ MonthlyProgressReport ════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
const MonthlyProgressReport = ({ isOpen, onClose, profileId: profileIdProp }) => {
  const { t, i18n } = useTranslation('pages');
  const { user, profile, gymName, gymLogoUrl } = useAuth();
  const targetId = profileIdProp || user?.id;
  const dateFnsLocale = i18n.language === 'es' ? { locale: esLocale } : undefined;
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  // Don't allow navigating into the future
  const canGoNext = isAfter(startOfMonth(new Date()), addMonths(month, 1)) ||
    isSameDay(startOfMonth(new Date()), addMonths(month, 1));

  // ── Fetch all data for selected month ────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);

    const monthStart = startOfMonth(month).toISOString();
    const monthEnd = endOfMonth(month).toISOString();
    const prevMonthStart = startOfMonth(subMonths(month, 1)).toISOString();
    const prevMonthEnd = endOfMonth(subMonths(month, 1)).toISOString();

    try {
      const [
        { data: sessions },
        { data: prevSessions },
        { data: prHistory },
        { data: prevPrHistory },
        { data: bodyWeightLogs },
        { data: measurements },
        { data: photos },
        { data: achievements },
        { data: checkIns },
        { data: sessionExercises },
      ] = await Promise.all([
        // Current month sessions
        supabase
          .from('workout_sessions')
          .select('id, completed_at, total_volume_lbs, duration_seconds, status')
          .eq('profile_id', targetId)
          .eq('status', 'completed')
          .gte('completed_at', monthStart)
          .lte('completed_at', monthEnd)
          .order('completed_at', { ascending: true }),
        // Previous month sessions (for comparison)
        supabase
          .from('workout_sessions')
          .select('id, completed_at, total_volume_lbs, duration_seconds, status')
          .eq('profile_id', targetId)
          .eq('status', 'completed')
          .gte('completed_at', prevMonthStart)
          .lte('completed_at', prevMonthEnd),
        // PR history for this month
        supabase
          .from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', targetId)
          .gte('achieved_at', monthStart)
          .lte('achieved_at', monthEnd)
          .order('achieved_at', { ascending: true }),
        // PR history for previous month (for 1RM comparison)
        supabase
          .from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', targetId)
          .gte('achieved_at', prevMonthStart)
          .lte('achieved_at', prevMonthEnd)
          .order('achieved_at', { ascending: true }),
        // Body weight logs for this month
        supabase
          .from('body_weight_logs')
          .select('weight_lbs, logged_at')
          .eq('profile_id', targetId)
          .gte('logged_at', monthStart.slice(0, 10))
          .lte('logged_at', monthEnd.slice(0, 10))
          .order('logged_at', { ascending: true }),
        // Body measurements for this month
        supabase
          .from('body_measurements')
          .select('*')
          .eq('profile_id', targetId)
          .gte('measured_at', monthStart.slice(0, 10))
          .lte('measured_at', monthEnd.slice(0, 10))
          .order('measured_at', { ascending: true }),
        // Progress photos for this month
        supabase
          .from('progress_photos')
          .select('id, storage_path, view_angle, taken_at')
          .eq('profile_id', targetId)
          .gte('taken_at', monthStart.slice(0, 10))
          .lte('taken_at', monthEnd.slice(0, 10))
          .order('taken_at', { ascending: true }),
        // Achievements for this month
        supabase
          .from('user_achievements')
          .select('achievement_key, earned_at')
          .eq('user_id', targetId)
          .gte('earned_at', monthStart)
          .lte('earned_at', monthEnd)
          .order('earned_at', { ascending: true }),
        // Check-ins for this month
        supabase
          .from('check_ins')
          .select('checked_in_at')
          .eq('profile_id', targetId)
          .gte('checked_in_at', monthStart)
          .lte('checked_in_at', monthEnd),
        // Session exercises with sets for volume-by-exercise
        supabase
          .from('session_exercises')
          .select(`
            exercise_id, snapshot_name, position,
            session_sets ( weight_lbs, reps, is_completed ),
            workout_sessions!inner ( profile_id, completed_at, status )
          `)
          .eq('workout_sessions.profile_id', user.id)
          .eq('workout_sessions.status', 'completed')
          .gte('workout_sessions.completed_at', monthStart)
          .lte('workout_sessions.completed_at', monthEnd),
      ]);

      // ── Exercise names lookup for PRs ──────────────────────────────────────
      const prExerciseIds = [...new Set((prHistory ?? []).map(p => p.exercise_id))];
      let exerciseNames = {};
      if (prExerciseIds.length > 0) {
        const { data: exData } = await supabase
          .from('exercises')
          .select('id, name')
          .in('id', prExerciseIds);
        (exData ?? []).forEach(e => { exerciseNames[e.id] = e.name; });
      }

      // ── Signed URLs for progress photos ────────────────────────────────────
      const photosWithUrls = await Promise.all(
        (photos ?? []).map(async (p) => {
          const { data: signed } = await supabase.storage
            .from('progress-photos')
            .createSignedUrl(p.storage_path, 3600);
          return { ...p, url: signed?.signedUrl ?? '' };
        })
      );

      // ── Compile data ──────────────────────────────────────────────────────
      const s = sessions ?? [];
      const ps = prevSessions ?? [];

      // Training summary
      const totalWorkouts = s.length;
      const prevTotalWorkouts = ps.length;
      const totalVolume = s.reduce((sum, ss) => sum + (parseFloat(ss.total_volume_lbs) || 0), 0);
      const prevTotalVolume = ps.reduce((sum, ss) => sum + (parseFloat(ss.total_volume_lbs) || 0), 0);
      const totalTime = s.reduce((sum, ss) => sum + (ss.duration_seconds || 0), 0);
      const prevTotalTime = ps.reduce((sum, ss) => sum + (ss.duration_seconds || 0), 0);
      const avgDuration = totalWorkouts > 0 ? Math.round(totalTime / totalWorkouts) : 0;
      const prevAvgDuration = prevTotalWorkouts > 0 ? Math.round(prevTotalTime / prevTotalWorkouts) : 0;

      // Consistency
      const monthDays = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
      const trainedDates = s.map(ss => ss.completed_at.slice(0, 10));
      const uniqueTrainedDays = [...new Set(trainedDates)];
      const daysPlanned = (profile?.training_days_per_week || 4) * Math.ceil(monthDays.length / 7);
      const attendanceRate = daysPlanned > 0 ? Math.round((uniqueTrainedDays.length / daysPlanned) * 100) : 0;

      // Best streak
      const sortedDays = uniqueTrainedDays.sort();
      let bestStreak = 0;
      let currentStreak = 0;
      let lastDate = null;
      sortedDays.forEach(d => {
        const date = parseISO(d);
        if (lastDate && differenceInDays(date, lastDate) === 1) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }
        bestStreak = Math.max(bestStreak, currentStreak);
        lastDate = date;
      });

      // Volume by week (for bar chart)
      const weeklyVolume = [];
      let weekStart = startOfMonth(month);
      let weekNum = 1;
      while (isBefore(weekStart, endOfMonth(month)) || isSameDay(weekStart, endOfMonth(month))) {
        const weekEnd = new Date(Math.min(
          new Date(weekStart).setDate(weekStart.getDate() + 6),
          endOfMonth(month).getTime()
        ));
        const weekSessions = s.filter(ss => {
          const d = new Date(ss.completed_at);
          return d >= weekStart && d <= weekEnd;
        });
        const vol = weekSessions.reduce((sum, ss) => sum + (parseFloat(ss.total_volume_lbs) || 0), 0);
        weeklyVolume.push({ name: `${t('monthlyReport.wkAbbr')} ${weekNum}`, volume: Math.round(vol), count: weekSessions.length });
        weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() + 1);
        weekNum++;
      }

      // PRs this month
      const prs = (prHistory ?? []).map(p => ({
        ...p,
        exerciseName: exerciseNames[p.exercise_id] || p.exercise_id,
        e1rm: parseFloat(p.estimated_1rm) || epley1RM(parseFloat(p.weight_lbs), p.reps),
      }));

      // Top 3 exercises by volume
      const volumeByExercise = {};
      (sessionExercises ?? []).forEach(se => {
        const name = se.snapshot_name || se.exercise_id;
        const vol = (se.session_sets ?? [])
          .filter(s => s.is_completed)
          .reduce((sum, s) => sum + (parseFloat(s.weight_lbs) || 0) * (s.reps || 0), 0);
        volumeByExercise[name] = (volumeByExercise[name] || 0) + vol;
      });
      const topExercises = Object.entries(volumeByExercise)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, vol]) => ({ name, volume: Math.round(vol) }));

      // 1RM changes for major lifts
      const liftChanges = MAJOR_LIFT_IDS.map(lift => {
        const thisMonthPRs = (prHistory ?? []).filter(p => p.exercise_id === lift.id);
        const prevMonthPRs = (prevPrHistory ?? []).filter(p => p.exercise_id === lift.id);
        const endE1RM = thisMonthPRs.length > 0
          ? Math.max(...thisMonthPRs.map(p => parseFloat(p.estimated_1rm) || 0))
          : null;
        const startE1RM = prevMonthPRs.length > 0
          ? Math.max(...prevMonthPRs.map(p => parseFloat(p.estimated_1rm) || 0))
          : null;
        return {
          ...lift,
          start: startE1RM ? Math.round(startE1RM) : null,
          end: endE1RM ? Math.round(endE1RM) : null,
          change: startE1RM && endE1RM ? Math.round(endE1RM - startE1RM) : null,
        };
      }).filter(l => l.start !== null || l.end !== null);

      // Body composition
      const bwLogs = bodyWeightLogs ?? [];
      const startWeight = bwLogs.length > 0 ? parseFloat(bwLogs[0].weight_lbs) : null;
      const endWeight = bwLogs.length > 0 ? parseFloat(bwLogs[bwLogs.length - 1].weight_lbs) : null;
      const weightChange = startWeight && endWeight ? (endWeight - startWeight).toFixed(1) : null;

      const meas = measurements ?? [];
      const startMeas = meas.length > 0 ? meas[0] : null;
      const endMeas = meas.length > 1 ? meas[meas.length - 1] : null;

      // Group photos by view_angle
      const earliestPhotos = {};
      const latestPhotos = {};
      (photosWithUrls).forEach(p => {
        const angle = p.view_angle || 'front';
        if (!earliestPhotos[angle] || p.taken_at < earliestPhotos[angle].taken_at) {
          earliestPhotos[angle] = p;
        }
        if (!latestPhotos[angle] || p.taken_at > latestPhotos[angle].taken_at) {
          latestPhotos[angle] = p;
        }
      });
      const photoComparisons = Object.keys(latestPhotos)
        .filter(angle => earliestPhotos[angle] && latestPhotos[angle] &&
          earliestPhotos[angle].id !== latestPhotos[angle].id)
        .map(angle => ({
          angle,
          before: earliestPhotos[angle],
          after: latestPhotos[angle],
        }));

      // Achievements
      const earnedKeys = (achievements ?? []).map(a => a.achievement_key);
      const achievementsList = earnedKeys.map(key => {
        const def = ACHIEVEMENT_DEFS.find(d => d.key === key);
        return def || { key, label: key, icon: 'Medal', desc: '', color: GOLD };
      });

      setData({
        totalWorkouts, prevTotalWorkouts,
        totalVolume, prevTotalVolume,
        totalTime, prevTotalTime,
        avgDuration, prevAvgDuration,
        monthDays, trainedDates: uniqueTrainedDays, daysPlanned,
        attendanceRate, bestStreak,
        weeklyVolume,
        prs, topExercises, liftChanges,
        startWeight, endWeight, weightChange,
        startMeas, endMeas,
        photoComparisons,
        achievementsList,
        checkInCount: (checkIns ?? []).length,
      });
    } catch (err) {
      logger.error('MonthlyProgressReport fetch error:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [targetId, profile, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Lock body scroll immediately when modal opens (not after data loads)
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // ── Motivational summary ─────────────────────────────────────────────────
  const motivationalText = useMemo(() => {
    if (!data) return '';
    const parts = [];

    if (data.totalWorkouts === 0) {
      return t('monthlyReport.noWorkoutsLogged');
    }

    if (data.totalWorkouts >= 16) parts.push(t('monthlyReport.incredibleConsistency'));
    else if (data.totalWorkouts >= 12) parts.push(t('monthlyReport.greatMonth'));
    else if (data.totalWorkouts >= 8) parts.push(t('monthlyReport.solidWork'));
    else if (data.totalWorkouts >= 4) parts.push(t('monthlyReport.goodStart'));
    else parts.push(t('monthlyReport.everyWorkoutCounts'));

    if (data.prs.length > 0) {
      parts.push(t('monthlyReport.youHitPRs', { count: data.prs.length }));
    }

    parts.push(t('monthlyReport.youTrainedDays', { days: data.trainedDates.length, volume: fmtNum(Math.round(data.totalVolume)) }));

    if (data.bestStreak >= 5) {
      parts.push(t('monthlyReport.bestStreakWas', { count: data.bestStreak }));
    }

    const benchChange = data.liftChanges.find(l => l.id === 'ex_bp');
    if (benchChange?.change && benchChange.change > 0) {
      parts.push(t('monthlyReport.benchE1rmUp', { change: benchChange.change }));
    }

    if (data.weightChange) {
      const wc = parseFloat(data.weightChange);
      if (wc < -1) parts.push(t('monthlyReport.droppedWeight', { amount: Math.abs(wc) }));
      else if (wc > 1) parts.push(t('monthlyReport.gainedWeight', { amount: wc }));
    }

    if (data.achievementsList.length > 0) {
      parts.push(t('monthlyReport.achievementsUnlockedCount', { count: data.achievementsList.length }));
    }

    parts.push(t('monthlyReport.keepPushing'));

    return parts.join(' ');
  }, [data, t]);

  // ── Render logic ─────────────────────────────────────────────────────────
  // If used as a controlled modal, respect isOpen
  const isModal = isOpen !== undefined;
  if (isModal && !isOpen) return null;

  const content = (
    <div className={`${isModal ? 'fixed inset-0 z-50 backdrop-blur-xl bg-black/60 flex items-start justify-center overflow-y-auto pt-[env(safe-area-inset-top)]' : 'w-full bg-[var(--color-bg-primary)]'}`}>
      <div className={`w-full ${isModal ? 'max-w-2xl mx-auto mt-12 mb-4 md:my-8 px-3' : 'max-w-2xl mx-auto'}`}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={`${CARD} p-5 mb-3`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 size={20} style={{ color: GOLD }} />
              <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)]">{t('monthlyReport.title')}</h2>
            </div>
            <div className="flex items-center gap-2">
              {isModal && onClose && (
                <button onClick={onClose} className="p-2 rounded-lg bg-[var(--color-bg-hover)] hover:bg-[var(--color-bg-active)] transition-colors">
                  <X size={16} className="text-[var(--color-text-muted)]" />
                </button>
              )}
            </div>
          </div>

          {/* Month selector */}
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              onClick={() => setMonth(m => startOfMonth(subMonths(m, 1)))}
              className="p-1.5 rounded-lg bg-[var(--color-bg-hover)] hover:bg-[var(--color-bg-active)] transition-colors"
            >
              <ChevronLeft size={16} className="text-[var(--color-text-muted)]" />
            </button>
            <span className="text-[15px] font-semibold text-[var(--color-text-primary)] min-w-[160px] text-center">
              {format(month, 'MMMM yyyy', dateFnsLocale)}
            </span>
            <button
              onClick={() => canGoNext && setMonth(m => startOfMonth(addMonths(m, 1)))}
              disabled={!canGoNext}
              className={`p-1.5 rounded-lg transition-colors ${canGoNext ? 'bg-[var(--color-bg-hover)] hover:bg-[var(--color-bg-active)]' : 'opacity-30 cursor-not-allowed'}`}
            >
              <ChevronRight size={16} className="text-[var(--color-text-muted)]" />
            </button>
          </div>
        </motion.div>

        {/* ── Loading / empty states ─────────────────────────────────────── */}
        {loading && (
          <Skeleton variant="card" height="h-[200px]" />
        )}

        {!loading && !data && (
          <div className={`${CARD} p-8 text-center`}>
            <p className="text-[var(--color-text-muted)]">{t('monthlyReport.couldNotLoad')}</p>
          </div>
        )}

        {!loading && data && (
          <FadeIn><div className="flex flex-col gap-6 pb-8">
            {/* ══ 1. Training Summary ════════════════════════════════════════ */}
            <Section title={t('monthlyReport.trainingSummary')} icon={Dumbbell} index={0}>
              <div className="flex flex-wrap gap-2 mb-4">
                <StatPill label={t('monthlyReport.workouts')} value={data.totalWorkouts} prev={data.prevTotalWorkouts} />
                <StatPill label={t('monthlyReport.volume')} value={fmtNum(Math.round(data.totalVolume))} prev={data.prevTotalVolume} suffix={t('monthlyReport.lbs')} />
                <StatPill label={t('monthlyReport.totalTime')} value={fmtDuration(data.totalTime)} prev={data.prevTotalTime} />
                <StatPill label={t('monthlyReport.avgSession')} value={fmtDuration(data.avgDuration)} prev={data.prevAvgDuration} />
              </div>

              {/* Weekly volume bar chart */}
              {data.weeklyVolume.some(w => w.volume > 0) && (
                <div className="h-[160px] mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.weeklyVolume} barSize={32}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => fmtNum(v)} />
                      <Tooltip content={<ChartTooltip formatter={(v) => `${fmtNum(v)} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                      <Bar dataKey="volume" name={t('monthlyReport.volume')} fill={GOLD} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            {/* ══ 2. Consistency Score ════════════════════════════════════════ */}
            <Section title={t('monthlyReport.consistency')} icon={Calendar} index={1}>
              <div className="flex flex-wrap gap-2 mb-4">
                <div className="flex-1 min-w-[100px] bg-[var(--color-bg-deep)] rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">{t('monthlyReport.daysTrained')}</p>
                  <p className="text-lg font-bold text-[var(--color-text-primary)]">
                    {data.trainedDates.length}<span className="text-xs text-[var(--color-text-subtle)]">/{data.daysPlanned}</span>
                  </p>
                </div>
                <div className="flex-1 min-w-[100px] bg-[var(--color-bg-deep)] rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">{t('monthlyReport.attendance')}</p>
                  <p className="text-lg font-bold" style={{ color: data.attendanceRate >= 80 ? GREEN : data.attendanceRate >= 50 ? GOLD : RED }}>
                    {Math.min(data.attendanceRate, 100)}%
                  </p>
                </div>
                <div className="flex-1 min-w-[100px] bg-[var(--color-bg-deep)] rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">{t('monthlyReport.bestStreak')}</p>
                  <p className="text-lg font-bold text-[var(--color-text-primary)]">
                    {data.bestStreak} <span className="text-xs text-[var(--color-text-subtle)]">{t('monthlyReport.days', { count: data.bestStreak })}</span>
                  </p>
                </div>
              </div>

              <CalendarHeatmap days={data.monthDays} trainedDates={data.trainedDates} />
            </Section>

            {/* ══ 3. Strength Gains ══════════════════════════════════════════ */}
            <Section title={t('monthlyReport.strengthGains')} icon={Zap} index={2}>
              {/* PRs hit */}
              {data.prs.length > 0 ? (
                <div className="mb-4">
                  <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-2">
                    {t('monthlyReport.prsHit')} ({data.prs.length})
                  </p>
                  <div className="space-y-1.5">
                    {data.prs.map((pr, i) => (
                      <div key={i} className="flex items-center justify-between bg-[var(--color-bg-deep)] rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Trophy size={14} style={{ color: GOLD }} />
                          <span className="text-[13px] text-[var(--color-text-primary)]">{pr.exerciseName}</span>
                        </div>
                        <span className="text-[13px] text-[var(--color-text-muted)]">
                          {pr.weight_lbs} x {pr.reps}
                          <span className="text-[var(--color-text-subtle)] ml-1">(e1RM: {Math.round(pr.e1rm)})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-[var(--color-text-subtle)] mb-4">{t('monthlyReport.noNewPRs')}</p>
              )}

              {/* Top exercises by volume */}
              {data.topExercises.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-2">{t('monthlyReport.topExercisesByVolume')}</p>
                  <div className="space-y-1.5">
                    {data.topExercises.map((ex, i) => {
                      const maxVol = data.topExercises[0].volume;
                      return (
                        <div key={i} className="bg-[var(--color-bg-deep)] rounded-lg px-3 py-2">
                          <div className="flex justify-between mb-1">
                            <span className="text-[13px] text-[var(--color-text-primary)]">{ex.name}</span>
                            <span className="text-[13px] text-[var(--color-text-muted)]">{fmtNum(ex.volume)} {t('monthlyReport.lbs')}</span>
                          </div>
                          <div className="w-full h-1.5 bg-[var(--color-bg-active)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${(ex.volume / maxVol) * 100}%`, background: GOLD }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 1RM changes for major lifts */}
              {data.liftChanges.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-2">{t('monthlyReport.estimated1rmChanges')}</p>
                  <div className="space-y-1.5">
                    {data.liftChanges.map((lift, i) => (
                      <div key={i} className="flex items-center justify-between bg-[var(--color-bg-deep)] rounded-lg px-3 py-2">
                        <span className="text-[13px] text-[var(--color-text-primary)]">{t(`monthlyReport.lifts.${lift.key}`)}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[13px] text-[var(--color-text-subtle)]">
                            {lift.start ?? '—'} <span className="mx-1">→</span> {lift.end ?? '—'}
                          </span>
                          {lift.change !== null && (
                            <span className={`text-xs font-medium ${lift.change > 0 ? 'text-[#10B981]' : lift.change < 0 ? 'text-[#EF4444]' : 'text-[var(--color-text-subtle)]'}`}>
                              {lift.change > 0 ? '+' : ''}{lift.change} {t('monthlyReport.lbs')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.prs.length === 0 && data.topExercises.length === 0 && data.liftChanges.length === 0 && (
                <p className="text-[13px] text-[var(--color-text-subtle)]">{t('monthlyReport.noStrengthData')}</p>
              )}
            </Section>

            {/* ══ 4. Body Composition ════════════════════════════════════════ */}
            {(data.startWeight || data.startMeas || data.photoComparisons.length > 0) && (
              <Section title={t('monthlyReport.bodyComposition')} icon={Weight} index={3}>
                {/* Weight change */}
                {data.startWeight && data.endWeight && (
                  <div className="flex items-center gap-3 bg-[var(--color-bg-deep)] rounded-lg px-3 py-2 mb-3">
                    <span className="text-[13px] text-[var(--color-text-muted)]">{t('monthlyReport.weight')}</span>
                    <span className="text-[13px] text-[var(--color-text-primary)] ml-auto">
                      {data.startWeight.toFixed(1)} → {data.endWeight.toFixed(1)} {t('monthlyReport.lbs')}
                    </span>
                    {data.weightChange && (
                      <span className={`text-xs font-medium ${parseFloat(data.weightChange) < 0 ? 'text-[#10B981]' : parseFloat(data.weightChange) > 0 ? 'text-[#EF4444]' : 'text-[var(--color-text-subtle)]'}`}>
                        {parseFloat(data.weightChange) > 0 ? '+' : ''}{data.weightChange} {t('monthlyReport.lbs')}
                      </span>
                    )}
                  </div>
                )}

                {/* Measurement changes */}
                {data.startMeas && data.endMeas && (
                  <div className="mb-3">
                    <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-2">{t('monthlyReport.measurementChanges')}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { key: 'chest_cm', labelKey: 'chest' },
                        { key: 'waist_cm', labelKey: 'waist' },
                        { key: 'hips_cm', labelKey: 'hips' },
                        { key: 'left_arm_cm', labelKey: 'leftArm' },
                        { key: 'right_arm_cm', labelKey: 'rightArm' },
                        { key: 'body_fat_pct', labelKey: 'bodyFat' },
                      ].map(({ key, labelKey }) => {
                        const label = t(`monthlyReport.${labelKey}`);
                        const s = data.startMeas[key];
                        const e = data.endMeas[key];
                        if (s == null && e == null) return null;
                        const diff = s != null && e != null ? (e - s).toFixed(1) : null;
                        const unit = key === 'body_fat_pct' ? '%' : 'cm';
                        return (
                          <div key={key} className="bg-[var(--color-bg-deep)] rounded-lg px-3 py-2 flex justify-between items-center">
                            <span className="text-[12px] text-[var(--color-text-subtle)]">{label}</span>
                            <div className="text-right">
                              <span className="text-[12px] text-[var(--color-text-primary)]">{e != null ? e : s}{unit}</span>
                              {diff && parseFloat(diff) !== 0 && (
                                <span className={`text-[10px] ml-1 ${parseFloat(diff) < 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                                  ({parseFloat(diff) > 0 ? '+' : ''}{diff})
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Photo comparisons */}
                {data.photoComparisons.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-2">{t('monthlyReport.progressPhotos')}</p>
                    <div className="space-y-3">
                      {data.photoComparisons.map(({ angle, before, after }) => (
                        <div key={angle}>
                          <p className="text-[11px] text-[var(--color-text-subtle)] uppercase mb-1 capitalize">{(ANGLE_LABELS[i18n.language] || ANGLE_LABELS.en)[angle] || angle}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="aspect-[3/4] bg-[var(--color-bg-deep)] rounded-lg overflow-hidden">
                                {before.url ? (
                                  <img src={before.url} alt={`${angle} before`} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-subtle)]">
                                    <Camera size={20} />
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] text-[var(--color-text-subtle)] text-center mt-1">
                                {format(parseISO(before.taken_at), 'MMM d', dateFnsLocale)}
                              </p>
                            </div>
                            <div>
                              <div className="aspect-[3/4] bg-[var(--color-bg-deep)] rounded-lg overflow-hidden">
                                {after.url ? (
                                  <img src={after.url} alt={`${angle} after`} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-subtle)]">
                                    <Camera size={20} />
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] text-[var(--color-text-subtle)] text-center mt-1">
                                {format(parseISO(after.taken_at), 'MMM d', dateFnsLocale)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            )}

            {/* ══ 5. Achievements Unlocked ═══════════════════════════════════ */}
            {data.achievementsList.length > 0 && (
              <Section title={t('monthlyReport.achievementsUnlocked')} icon={Award} index={4}>
                <div className="grid grid-cols-2 gap-2">
                  {data.achievementsList.map((a, i) => {
                    const AIcon = ICON_MAP[a.icon] || Medal;
                    return (
                    <div key={i} className="bg-[var(--color-bg-deep)] rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                      <AIcon size={20} style={{ color: a.color || GOLD }} />
                      <div>
                        <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{t(a.labelKey, a.label)}</p>
                        <p className="text-[11px] text-[var(--color-text-subtle)]">{t(a.descKey, a.desc)}</p>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* ══ 6. Motivational Summary ════════════════════════════════════ */}
            <Section title={t('monthlyReport.summary')} icon={Flame} index={5}>
              <p className="text-[14px] text-[var(--color-text-primary)] leading-relaxed">{motivationalText}</p>
            </Section>
          </div></FadeIn>
        )}
      </div>
    </div>
  );

  // Wrap modal version with AnimatePresence
  if (isModal) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return content;
};

export default MonthlyProgressReport;

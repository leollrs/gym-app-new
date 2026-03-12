import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus,
  Trophy, Flame, Dumbbell, Calendar, Clock, Target, Share2, Award,
  Camera, Weight, BarChart3, Zap, Check, Copy,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { epley1RM } from '../lib/overloadEngine';
import { ACHIEVEMENT_DEFS } from '../lib/achievements';
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, subMonths, addMonths, isAfter, isBefore, differenceInDays,
  getDay,
} from 'date-fns';

// ── Design tokens ────────────────────────────────────────────────────────────
const GOLD = '#D4AF37';
const GREEN = '#10B981';
const RED = '#EF4444';
const CARD = 'bg-[#0F172A] rounded-[14px] border border-white/[0.08]';
const tooltipStyle = {
  contentStyle: {
    background: '#111827', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, fontSize: 12,
  },
  labelStyle: { color: '#9CA3AF' },
  itemStyle: { color: GOLD },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n) => {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
};

const fmtDuration = (seconds) => {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const pctChange = (current, previous) => {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const ChangeIndicator = ({ current, previous, suffix = '', invert = false }) => {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (diff === 0 || (!current && !previous)) return <span className="text-[#6B7280] text-xs">—</span>;
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
const MAJOR_LIFTS = [
  { id: 'ex_bp', name: 'Bench Press' },
  { id: 'ex_sq', name: 'Back Squat' },
  { id: 'ex_dl', name: 'Deadlift' },
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
      <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{title}</h3>
    </div>
    {children}
  </motion.div>
);

// ── Stat pill ────────────────────────────────────────────────────────────────
const StatPill = ({ label, value, prev, suffix, invert }) => (
  <div className="flex-1 min-w-[120px] bg-[#111827] rounded-xl p-3 text-center">
    <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">{label}</p>
    <p className="text-lg font-bold text-[#E5E7EB]">{value}{suffix && <span className="text-xs text-[#9CA3AF] ml-0.5">{suffix}</span>}</p>
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
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-[10px] text-[#6B7280] text-center">{d}</div>
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
                  ? 'bg-white/[0.03]'
                  : trained
                    ? 'bg-[#D4AF37]/80'
                    : 'bg-white/[0.06]'
              }`}
              title={`${format(day, 'MMM d')}${trained ? ' — Trained' : ''}`}
            />
          );
        })}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ══ MonthlyProgressReport ════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
const MonthlyProgressReport = ({ isOpen, onClose }) => {
  const { user, profile } = useAuth();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  // Don't allow navigating into the future
  const canGoNext = isAfter(startOfMonth(new Date()), addMonths(month, 1)) ||
    isSameDay(startOfMonth(new Date()), addMonths(month, 1));

  // ── Fetch all data for selected month ────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
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
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', monthStart)
          .lte('completed_at', monthEnd)
          .order('completed_at', { ascending: true }),
        // Previous month sessions (for comparison)
        supabase
          .from('workout_sessions')
          .select('id, completed_at, total_volume_lbs, duration_seconds, status')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', prevMonthStart)
          .lte('completed_at', prevMonthEnd),
        // PR history for this month
        supabase
          .from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', user.id)
          .gte('achieved_at', monthStart)
          .lte('achieved_at', monthEnd)
          .order('achieved_at', { ascending: true }),
        // PR history for previous month (for 1RM comparison)
        supabase
          .from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', user.id)
          .gte('achieved_at', prevMonthStart)
          .lte('achieved_at', prevMonthEnd)
          .order('achieved_at', { ascending: true }),
        // Body weight logs for this month
        supabase
          .from('body_weight_logs')
          .select('weight_lbs, logged_at')
          .eq('profile_id', user.id)
          .gte('logged_at', monthStart.slice(0, 10))
          .lte('logged_at', monthEnd.slice(0, 10))
          .order('logged_at', { ascending: true }),
        // Body measurements for this month
        supabase
          .from('body_measurements')
          .select('*')
          .eq('profile_id', user.id)
          .gte('measured_at', monthStart.slice(0, 10))
          .lte('measured_at', monthEnd.slice(0, 10))
          .order('measured_at', { ascending: true }),
        // Progress photos for this month
        supabase
          .from('progress_photos')
          .select('id, storage_path, view_angle, taken_at')
          .eq('profile_id', user.id)
          .gte('taken_at', monthStart.slice(0, 10))
          .lte('taken_at', monthEnd.slice(0, 10))
          .order('taken_at', { ascending: true }),
        // Achievements for this month
        supabase
          .from('user_achievements')
          .select('achievement_key, earned_at')
          .eq('user_id', user.id)
          .gte('earned_at', monthStart)
          .lte('earned_at', monthEnd)
          .order('earned_at', { ascending: true }),
        // Check-ins for this month
        supabase
          .from('check_ins')
          .select('checked_in_at')
          .eq('profile_id', user.id)
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
        weeklyVolume.push({ name: `Wk ${weekNum}`, volume: Math.round(vol) });
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
      const liftChanges = MAJOR_LIFTS.map(lift => {
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
        return def || { key, label: key, icon: '🏅', desc: '', color: GOLD };
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
      console.error('MonthlyProgressReport fetch error:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, profile, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Share (copy text summary to clipboard) ───────────────────────────────
  const handleShare = useCallback(async () => {
    if (!data) return;
    const lines = [
      `Monthly Progress Report — ${format(month, 'MMMM yyyy')}`,
      '',
      `Workouts: ${data.totalWorkouts}`,
      `Volume: ${fmtNum(Math.round(data.totalVolume))} lbs`,
      `Time: ${fmtDuration(data.totalTime)}`,
      `Consistency: ${data.attendanceRate}%`,
      `Best Streak: ${data.bestStreak} day${data.bestStreak !== 1 ? 's' : ''}`,
    ];
    if (data.prs.length > 0) {
      lines.push('', `PRs Hit: ${data.prs.length}`);
      data.prs.slice(0, 5).forEach(pr => {
        lines.push(`  ${pr.exerciseName}: ${pr.weight_lbs} lbs x ${pr.reps} (e1RM: ${Math.round(pr.e1rm)} lbs)`);
      });
    }
    if (data.weightChange) {
      lines.push('', `Weight: ${data.weightChange > 0 ? '+' : ''}${data.weightChange} lbs`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  }, [data, month]);

  // ── Motivational summary ─────────────────────────────────────────────────
  const motivationalText = useMemo(() => {
    if (!data) return '';
    const parts = [];

    if (data.totalWorkouts === 0) {
      return "No workouts logged this month. Every journey has slow stretches — the important thing is showing up next time.";
    }

    if (data.totalWorkouts >= 16) parts.push("Incredible consistency this month!");
    else if (data.totalWorkouts >= 12) parts.push("Great month of training!");
    else if (data.totalWorkouts >= 8) parts.push("Solid work this month!");
    else if (data.totalWorkouts >= 4) parts.push("Good start this month.");
    else parts.push("Every workout counts.");

    if (data.prs.length > 0) {
      parts.push(`You hit ${data.prs.length} new PR${data.prs.length > 1 ? 's' : ''}.`);
    }

    parts.push(`You trained ${data.trainedDates.length} day${data.trainedDates.length !== 1 ? 's' : ''} and lifted ${fmtNum(Math.round(data.totalVolume))} lbs total.`);

    if (data.bestStreak >= 5) {
      parts.push(`Your best streak was ${data.bestStreak} days in a row — impressive.`);
    }

    const benchChange = data.liftChanges.find(l => l.id === 'ex_bp');
    if (benchChange?.change && benchChange.change > 0) {
      parts.push(`Your bench press e1RM is up ${benchChange.change} lbs.`);
    }

    if (data.weightChange) {
      const wc = parseFloat(data.weightChange);
      if (wc < -1) parts.push(`You dropped ${Math.abs(wc)} lbs of bodyweight.`);
      else if (wc > 1) parts.push(`You gained ${wc} lbs of bodyweight.`);
    }

    if (data.achievementsList.length > 0) {
      parts.push(`Plus ${data.achievementsList.length} achievement${data.achievementsList.length > 1 ? 's' : ''} unlocked.`);
    }

    parts.push("Keep pushing.");

    return parts.join(' ');
  }, [data]);

  // ── Render logic ─────────────────────────────────────────────────────────
  // If used as a controlled modal, respect isOpen
  const isModal = isOpen !== undefined;
  if (isModal && !isOpen) return null;

  const content = (
    <div className={`${isModal ? 'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto' : 'w-full'}`}>
      <div className={`w-full ${isModal ? 'max-w-2xl mx-auto my-4 md:my-8' : 'max-w-2xl mx-auto'}`}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={`${CARD} p-4 mb-3 sticky top-0 z-10 backdrop-blur-2xl bg-[#0F172A]/95`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 size={20} style={{ color: GOLD }} />
              <h2 className="text-[17px] font-bold text-[#E5E7EB]">Monthly Report</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleShare}
                className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors"
                title="Copy summary to clipboard"
              >
                {copied ? <Check size={16} className="text-[#10B981]" /> : <Share2 size={16} className="text-[#9CA3AF]" />}
              </button>
              {isModal && onClose && (
                <button onClick={onClose} className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors">
                  <X size={16} className="text-[#9CA3AF]" />
                </button>
              )}
            </div>
          </div>

          {/* Month selector */}
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              onClick={() => setMonth(m => startOfMonth(subMonths(m, 1)))}
              className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors"
            >
              <ChevronLeft size={16} className="text-[#9CA3AF]" />
            </button>
            <span className="text-[15px] font-semibold text-[#E5E7EB] min-w-[160px] text-center">
              {format(month, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => canGoNext && setMonth(m => startOfMonth(addMonths(m, 1)))}
              disabled={!canGoNext}
              className={`p-1.5 rounded-lg transition-colors ${canGoNext ? 'bg-white/[0.06] hover:bg-white/[0.1]' : 'opacity-30 cursor-not-allowed'}`}
            >
              <ChevronRight size={16} className="text-[#9CA3AF]" />
            </button>
          </div>
        </motion.div>

        {/* ── Loading / empty states ─────────────────────────────────────── */}
        {loading && (
          <div className={`${CARD} p-12 flex items-center justify-center`}>
            <div className="w-6 h-6 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && !data && (
          <div className={`${CARD} p-8 text-center`}>
            <p className="text-[#9CA3AF]">Could not load report data.</p>
          </div>
        )}

        {!loading && data && (
          <div className="flex flex-col gap-3 pb-8">
            {/* ══ 1. Training Summary ════════════════════════════════════════ */}
            <Section title="Training Summary" icon={Dumbbell} index={0}>
              <div className="flex flex-wrap gap-2 mb-4">
                <StatPill label="Workouts" value={data.totalWorkouts} prev={data.prevTotalWorkouts} />
                <StatPill label="Volume" value={fmtNum(Math.round(data.totalVolume))} prev={data.prevTotalVolume} suffix="lbs" />
                <StatPill label="Total Time" value={fmtDuration(data.totalTime)} prev={data.prevTotalTime} />
                <StatPill label="Avg Session" value={fmtDuration(data.avgDuration)} prev={data.prevAvgDuration} />
              </div>

              {/* Weekly volume bar chart */}
              {data.weeklyVolume.some(w => w.volume > 0) && (
                <div className="h-[160px] mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.weeklyVolume} barSize={32}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => fmtNum(v)} />
                      <Tooltip {...tooltipStyle} formatter={(v) => [`${fmtNum(v)} lbs`, 'Volume']} />
                      <Bar dataKey="volume" fill={GOLD} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            {/* ══ 2. Consistency Score ════════════════════════════════════════ */}
            <Section title="Consistency" icon={Calendar} index={1}>
              <div className="flex flex-wrap gap-2 mb-4">
                <div className="flex-1 min-w-[100px] bg-[#111827] rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Days Trained</p>
                  <p className="text-lg font-bold text-[#E5E7EB]">
                    {data.trainedDates.length}<span className="text-xs text-[#6B7280]">/{data.daysPlanned}</span>
                  </p>
                </div>
                <div className="flex-1 min-w-[100px] bg-[#111827] rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Attendance</p>
                  <p className="text-lg font-bold" style={{ color: data.attendanceRate >= 80 ? GREEN : data.attendanceRate >= 50 ? GOLD : RED }}>
                    {Math.min(data.attendanceRate, 100)}%
                  </p>
                </div>
                <div className="flex-1 min-w-[100px] bg-[#111827] rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Best Streak</p>
                  <p className="text-lg font-bold text-[#E5E7EB]">
                    {data.bestStreak} <span className="text-xs text-[#6B7280]">day{data.bestStreak !== 1 ? 's' : ''}</span>
                  </p>
                </div>
              </div>

              <CalendarHeatmap days={data.monthDays} trainedDates={data.trainedDates} />
            </Section>

            {/* ══ 3. Strength Gains ══════════════════════════════════════════ */}
            <Section title="Strength Gains" icon={Zap} index={2}>
              {/* PRs hit */}
              {data.prs.length > 0 ? (
                <div className="mb-4">
                  <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">
                    PRs Hit ({data.prs.length})
                  </p>
                  <div className="space-y-1.5">
                    {data.prs.map((pr, i) => (
                      <div key={i} className="flex items-center justify-between bg-[#111827] rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Trophy size={14} style={{ color: GOLD }} />
                          <span className="text-[13px] text-[#E5E7EB]">{pr.exerciseName}</span>
                        </div>
                        <span className="text-[13px] text-[#9CA3AF]">
                          {pr.weight_lbs} x {pr.reps}
                          <span className="text-[#6B7280] ml-1">(e1RM: {Math.round(pr.e1rm)})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-[#6B7280] mb-4">No new PRs this month.</p>
              )}

              {/* Top exercises by volume */}
              {data.topExercises.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">Top Exercises by Volume</p>
                  <div className="space-y-1.5">
                    {data.topExercises.map((ex, i) => {
                      const maxVol = data.topExercises[0].volume;
                      return (
                        <div key={i} className="bg-[#111827] rounded-lg px-3 py-2">
                          <div className="flex justify-between mb-1">
                            <span className="text-[13px] text-[#E5E7EB]">{ex.name}</span>
                            <span className="text-[13px] text-[#9CA3AF]">{fmtNum(ex.volume)} lbs</span>
                          </div>
                          <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
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
                  <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">Estimated 1RM Changes</p>
                  <div className="space-y-1.5">
                    {data.liftChanges.map((lift, i) => (
                      <div key={i} className="flex items-center justify-between bg-[#111827] rounded-lg px-3 py-2">
                        <span className="text-[13px] text-[#E5E7EB]">{lift.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[13px] text-[#6B7280]">
                            {lift.start ?? '—'} <span className="mx-1">→</span> {lift.end ?? '—'}
                          </span>
                          {lift.change !== null && (
                            <span className={`text-xs font-medium ${lift.change > 0 ? 'text-[#10B981]' : lift.change < 0 ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>
                              {lift.change > 0 ? '+' : ''}{lift.change} lbs
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.prs.length === 0 && data.topExercises.length === 0 && data.liftChanges.length === 0 && (
                <p className="text-[13px] text-[#6B7280]">No strength data for this month.</p>
              )}
            </Section>

            {/* ══ 4. Body Composition ════════════════════════════════════════ */}
            {(data.startWeight || data.startMeas || data.photoComparisons.length > 0) && (
              <Section title="Body Composition" icon={Weight} index={3}>
                {/* Weight change */}
                {data.startWeight && data.endWeight && (
                  <div className="flex items-center gap-3 bg-[#111827] rounded-lg px-3 py-2 mb-3">
                    <span className="text-[13px] text-[#9CA3AF]">Weight</span>
                    <span className="text-[13px] text-[#E5E7EB] ml-auto">
                      {data.startWeight.toFixed(1)} → {data.endWeight.toFixed(1)} lbs
                    </span>
                    {data.weightChange && (
                      <span className={`text-xs font-medium ${parseFloat(data.weightChange) < 0 ? 'text-[#10B981]' : parseFloat(data.weightChange) > 0 ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>
                        {parseFloat(data.weightChange) > 0 ? '+' : ''}{data.weightChange} lbs
                      </span>
                    )}
                  </div>
                )}

                {/* Measurement changes */}
                {data.startMeas && data.endMeas && (
                  <div className="mb-3">
                    <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">Measurement Changes</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { key: 'chest_cm', label: 'Chest' },
                        { key: 'waist_cm', label: 'Waist' },
                        { key: 'hips_cm', label: 'Hips' },
                        { key: 'left_arm_cm', label: 'L. Arm' },
                        { key: 'right_arm_cm', label: 'R. Arm' },
                        { key: 'body_fat_pct', label: 'Body Fat' },
                      ].map(({ key, label }) => {
                        const s = data.startMeas[key];
                        const e = data.endMeas[key];
                        if (s == null && e == null) return null;
                        const diff = s != null && e != null ? (e - s).toFixed(1) : null;
                        const unit = key === 'body_fat_pct' ? '%' : 'cm';
                        return (
                          <div key={key} className="bg-[#111827] rounded-lg px-3 py-2 flex justify-between items-center">
                            <span className="text-[12px] text-[#6B7280]">{label}</span>
                            <div className="text-right">
                              <span className="text-[12px] text-[#E5E7EB]">{e != null ? e : s}{unit}</span>
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
                    <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">Progress Photos</p>
                    <div className="space-y-3">
                      {data.photoComparisons.map(({ angle, before, after }) => (
                        <div key={angle}>
                          <p className="text-[11px] text-[#6B7280] uppercase mb-1 capitalize">{angle}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="aspect-[3/4] bg-[#111827] rounded-lg overflow-hidden">
                                {before.url ? (
                                  <img src={before.url} alt={`${angle} before`} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[#6B7280]">
                                    <Camera size={20} />
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] text-[#6B7280] text-center mt-1">
                                {format(parseISO(before.taken_at), 'MMM d')}
                              </p>
                            </div>
                            <div>
                              <div className="aspect-[3/4] bg-[#111827] rounded-lg overflow-hidden">
                                {after.url ? (
                                  <img src={after.url} alt={`${angle} after`} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[#6B7280]">
                                    <Camera size={20} />
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] text-[#6B7280] text-center mt-1">
                                {format(parseISO(after.taken_at), 'MMM d')}
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
              <Section title="Achievements Unlocked" icon={Award} index={4}>
                <div className="grid grid-cols-2 gap-2">
                  {data.achievementsList.map((a, i) => (
                    <div key={i} className="bg-[#111827] rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                      <span className="text-xl">{a.icon}</span>
                      <div>
                        <p className="text-[13px] font-medium text-[#E5E7EB]">{a.label}</p>
                        <p className="text-[11px] text-[#6B7280]">{a.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ══ 6. Motivational Summary ════════════════════════════════════ */}
            <Section title="Summary" icon={Flame} index={5}>
              <p className="text-[14px] text-[#E5E7EB] leading-relaxed">{motivationalText}</p>
            </Section>
          </div>
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

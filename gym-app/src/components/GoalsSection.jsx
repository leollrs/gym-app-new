import { useState, useEffect, useRef } from 'react';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Target, Plus, Trophy, Dumbbell, Scale, Flame, TrendingUp,
  Calendar, Check, X, Zap, Activity, Search,
  Pencil, Trash2, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import logger from '../lib/logger';
import { useAuth } from '../contexts/AuthContext';
import { exName } from '../lib/exerciseName';
import Confetti from './Confetti';
import posthogClient from 'posthog-js';

// ── Warm-paper onboarding-aligned design tokens ───────────────────────────
const OB_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const OB_BODY    = '"Familjen Grotesk", -apple-system, system-ui, sans-serif';
const OB_TEAL    = '#2EC4C4';
const OB_TEAL_DEEP = '#0FA5A5';
const OB_TEAL_SOFT = '#D7F1F1';
const OB_ORANGE  = '#FF5A2E';
const OB_ORANGE_SOFT = '#FBE0D3';
const OB_SUB     = '#6B6A63';
const OB_LINE    = 'rgba(11,15,18,0.08)';
const OB_LINE_STRONG = 'rgba(11,15,18,0.14)';

// ── Goal type config ─────────────────────────────────────────────────────
const GOAL_TYPES = [
  { key: 'lift_1rm',       icon: Dumbbell,    color: '#E8C547', soft: '#F6ECB6', needsExercise: true },
  { key: 'body_weight',    icon: Scale,        color: '#60A5FA', soft: '#DBEAFE', needsExercise: false },
  { key: 'body_fat',       icon: Activity,     color: '#34D399', soft: '#D1FAE5', needsExercise: false },
  { key: 'workout_count',  icon: TrendingUp,   color: '#6D5FDB', soft: '#E0DCF5', needsExercise: false },
  { key: 'streak',         icon: Flame,        color: '#FF5A2E', soft: '#FBE0D3', needsExercise: false },
  { key: 'volume',         icon: Zap,          color: '#EF4444', soft: '#FEE2E2', needsExercise: false },
];

const UNIT_MAP = {
  lift_1rm: 'lbs',
  body_weight: 'lbs',
  body_fat: '%',
  workout_count: 'workouts',
  streak: 'days',
  volume: 'lbs',
};

// Localized unit label for display. The DB still stores the canonical UNIT_MAP
// value, but we render the locale-appropriate string in the UI.
function unitLabel(goalType, t) {
  const u = UNIT_MAP[goalType];
  if (!u) return '';
  return t(`goals.units.${u}`, u);
}

/**
 * Suggest a realistic but motivating target date for a goal.
 * Returns an ISO date string or null when we can't make a confident estimate.
 *
 * Heuristics:
 *  - lift_1rm: use the existing PROGRESSION_RATES * gap, clamped to 8-16 weeks
 *  - body_weight: 1-2 lb/week → clamped to 4-12 weeks
 *  - body_fat: ~0.5%/week (2%/month) → clamped to 6-12 weeks
 *  - workout_count: 3 sessions/week → at least 4 weeks
 *  - streak: target days + a small buffer
 *  - volume: 4-8 weeks (not enough signal to estimate precisely)
 */
function suggestTargetDate({ goalType, targetValue, currentValue, fitnessLevel, exerciseName }) {
  const target = parseFloat(targetValue);
  if (!target || isNaN(target) || target <= 0) return null;
  const current = parseFloat(currentValue);
  const gap = !isNaN(current) ? target - current : null;

  let weeks = null;
  if (goalType === 'lift_1rm' && gap != null && gap > 0) {
    const level = fitnessLevel || 'intermediate';
    const rates = PROGRESSION_RATES[level] || PROGRESSION_RATES.intermediate;
    const isIso = isIsolationExercise(exerciseName);
    const weeklyRate = isIso ? rates.isolation : rates.compound;
    weeks = Math.max(8, Math.min(16, Math.ceil(gap / weeklyRate)));
  } else if (goalType === 'body_weight') {
    // 1.5 lb/week (midpoint of 1-2 lb/week). Without a current value we can't
    // estimate the gap, so default to 8 weeks.
    weeks = (gap != null && gap !== 0)
      ? Math.max(4, Math.min(12, Math.ceil(Math.abs(gap) / 1.5)))
      : 8;
  } else if (goalType === 'body_fat') {
    // 0.5%/week (2%/month). Default to 8 weeks if no current value.
    weeks = (gap != null && gap !== 0)
      ? Math.max(6, Math.min(12, Math.ceil(Math.abs(gap) / 0.5)))
      : 8;
  } else if (goalType === 'workout_count') {
    // assume 3 sessions/week
    weeks = Math.max(4, Math.ceil(target / 3));
  } else if (goalType === 'streak') {
    // streak goal in days → days from today, capped at 1 year
    const days = Math.max(7, Math.min(365, Math.ceil(target)));
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  } else if (goalType === 'volume') {
    weeks = 6; // 4-8 week midpoint
  }

  if (!weeks) return null;
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split('T')[0];
}

// Progression rates in lbs/week (intermediate defaults)
const PROGRESSION_RATES = {
  beginner:     { compound: 5,    isolation: 2.5 },
  intermediate: { compound: 2.5,  isolation: 1.25 },
  advanced:     { compound: 1.25, isolation: 0.5 },
};

const ISOLATION_KEYWORDS = [
  'curl', 'extension', 'fly', 'flye', 'raise', 'kickback',
  'pullover', 'shrug', 'wrist', 'calf', 'forearm',
];

function isIsolationExercise(exerciseName) {
  if (!exerciseName) return false;
  const lower = exerciseName.toLowerCase();
  return ISOLATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getGoalMeta(goalType) {
  return GOAL_TYPES.find(g => g.key === goalType) || GOAL_TYPES[0];
}

/**
 * Direction-aware progress percentage (0–100).
 *
 * The naive current/target formula only works for goals that count UP toward
 * the target (lift_1rm, workout_count, volume, streak). body_weight / body_fat
 * goals start ABOVE the target and move DOWN, so current/target is >1 and pins
 * the bar at 100% from day one.
 *
 * When a baseline (start_value) is recorded we measure distance covered,
 * (start - current) / (start - target), which is correct in BOTH directions —
 * losing weight (200→170) or gaining it (100→150) both read 0% at the start and
 * 100% at the target. Legacy goals with no start_value fall back to the original
 * current/target ratio.
 */
function goalProgressPct(goal) {
  const current = parseFloat(goal.current_value);
  const target = parseFloat(goal.target_value);
  const start = goal.start_value != null ? parseFloat(goal.start_value) : NaN;
  let raw;
  if (!isNaN(start) && start !== target) {
    raw = ((start - current) / (start - target)) * 100;
  } else {
    raw = (current / target) * 100;
  }
  if (!isFinite(raw)) return 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

// ── Main Goals Section ───────────────────────────────────────────────────
export default function GoalsSection() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const goalsCacheKey = `goals-${user?.id || 'anon'}`;
  const [goals, setGoals] = useCachedState(goalsCacheKey, []);
  // Skip the loading skeleton on re-mount if we already have cached goals — data
  // will refresh in the background but the UI stays populated instead of flashing empty.
  const [loading, setLoading] = useState(!hasCachedState(goalsCacheKey));
  const [showModal, setShowModal] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [celebrateGoal, setCelebrateGoal] = useState(null);
  // Past completed goals live behind a collapsible "Completed" section so they
  // don't clutter the active grid (they used to render inline forever).
  const [showCompleted, setShowCompleted] = useState(false);

  const loadGoals = async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from('member_goals')
        .select('*, exercises(name, name_es, muscle_group, equipment)')
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false });
      setGoals(data ?? []);
    } finally {
      // Clear the skeleton even if the query rejects on a first visit.
      setLoading(false);
    }
  };

  useEffect(() => { loadGoals(); }, [user?.id]);

  const handleGoalTap = (goal) => {
    if (goal.achieved_at) {
      setCelebrateGoal(goal);
      setTimeout(() => setCelebrateGoal(null), 2500);
    }
    setEditGoal(goal);
  };

  const handleDelete = async (goalId) => {
    const { error } = await supabase.from('member_goals').delete().eq('id', goalId);
    if (error) { logger.error('GoalsSection delete error', error); return; }
    posthogClient?.capture('goal_deleted');
    setGoals(prev => prev.filter(g => g.id !== goalId));
    setEditGoal(null);
  };

  // Returns the supabase error (null on success) so the detail modal can show
  // feedback instead of silently staying open when the update fails.
  const handleUpdate = async (goalId, updates) => {
    const { error } = await supabase
      .from('member_goals')
      .update(updates)
      .eq('id', goalId);
    if (error) {
      logger.error('GoalsSection update error', error);
      return error;
    }
    posthogClient?.capture('goal_updated');
    setEditGoal(null);
    loadGoals();
    return null;
  };

  if (loading) return null;

  const activeGoals = goals.filter(g => !g.achieved_at);
  const achievedGoals = goals.filter(g => g.achieved_at);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Target size={16} style={{ color: 'var(--color-accent, ' + OB_TEAL + ')' }} strokeWidth={2} />
          <p style={{ fontFamily: OB_DISPLAY, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
            {t('goals.title')}
          </p>
          {activeGoals.length > 0 && (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent, ' + OB_TEAL + ')' }}>
              {activeGoals.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1 text-[12px] font-bold px-2.5 py-1 rounded-full transition-colors"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent, ' + OB_TEAL + ')' }}
        >
          <Plus size={12} strokeWidth={2.4} />
          {t('goals.addGoal')}
        </button>
      </div>

      {/* Empty suggestion state */}
      {goals.length === 0 ? (
        <div className="rounded-[22px] p-[18px]" style={{ background: 'var(--color-bg-card)', boxShadow: 'var(--color-shadow-card, 0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05))' }}>
          <div className="flex gap-3.5">
            {[
              { icon: Dumbbell, label: t('goals.suggestTrain', 'Train 3\u00d7/wk'), color: 'var(--color-accent, ' + OB_TEAL + ')' },
              { icon: Scale, label: t('goals.suggestWeight', 'Drop 5 lbs'), color: '#6D5FDB' },
              { icon: Trophy, label: t('goals.suggestLift', 'Squat 225'), color: '#FF5A2E' },
            ].map(({ icon: SIcon, label, color }) => (
              <button key={label} onClick={() => setShowModal(true)} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-[14px] flex items-center justify-center"
                  style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                  <SIcon size={20} style={{ color }} strokeWidth={2} />
                </div>
                <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.1 }}>{label}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-center mt-3.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('goals.suggestionHint', 'Pick one to get started, or tap Add Goal')}
          </p>
        </div>
      ) : (
        <>
          {/* Active goals */}
          {activeGoals.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {activeGoals.map(goal => (
                <GoalCard key={goal.id} goal={goal} onTap={handleGoalTap} />
              ))}
            </div>
          ) : (
            <div className="rounded-[18px] px-4 py-3.5 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border, ' + OB_LINE + ')' }}>
              <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                {t('goals.noActiveGoals', 'No active goals — add one to keep the momentum.')}
              </p>
            </div>
          )}

          {/* Completed goals — collapsed behind a toggle so they don't clutter
              the active grid but stay viewable as a history. */}
          {achievedGoals.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setShowCompleted(s => !s)}
                aria-expanded={showCompleted}
                className="w-full flex items-center justify-between px-1 py-1.5"
              >
                <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  <Check size={13} strokeWidth={2.6} style={{ color: 'var(--color-success, #10B981)' }} />
                  {t('goals.completed', 'Completed')}
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-success, #10B981) 16%, transparent)', color: 'var(--color-success, #10B981)' }}>
                    {achievedGoals.length}
                  </span>
                </span>
                <ChevronDown size={16} className={`transition-transform duration-200 ${showCompleted ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
              {showCompleted && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {achievedGoals.map(goal => (
                    <GoalCard key={goal.id} goal={goal} onTap={handleGoalTap} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Confetti active={!!celebrateGoal} particleCount={80} duration={2500} />

      {/* Achieved celebrate overlay */}
      {celebrateGoal && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setCelebrateGoal(null)}
        >
          <div
            className="rounded-3xl p-8 flex flex-col items-center gap-4 max-w-[280px] mx-4 animate-fade-in"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border, ' + OB_LINE + ')' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-card))', boxShadow: '0 0 40px color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
            >
              <Trophy size={32} style={{ color: OB_TEAL_DEEP }} />
            </div>
            <p className="text-[18px] font-bold text-center" style={{ fontFamily: OB_DISPLAY, color: 'var(--color-text-primary)' }}>
              {t('goals.goalAchieved')}
            </p>
            <p className="text-[14px] text-center" style={{ color: 'var(--color-text-muted)' }}>{celebrateGoal.title}</p>
          </div>
        </div>,
        document.body
      )}

      {/* Create modal */}
      {showModal && createPortal(
        <GoalModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); loadGoals(); }}
          gymId={profile?.gym_id}
          fitnessLevel={profile?.fitness_level}
        />,
        document.body
      )}

      {/* Detail/Edit modal */}
      {editGoal && createPortal(
        <GoalDetailModal
          goal={editGoal}
          onClose={() => setEditGoal(null)}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          fitnessLevel={profile?.fitness_level}
        />,
        document.body
      )}
    </div>
  );
}

// ── Goal Card (compact 2-col, tap-to-edit) ────────────────────────────────
function GoalCard({ goal, onTap }) {
  const { t } = useTranslation('pages');
  const isAchieved = !!goal.achieved_at;
  const pct = goalProgressPct(goal);
  const meta = getGoalMeta(goal.goal_type);
  const Icon = meta.icon;
  const color = meta.color;
  const soft = meta.soft;

  const delta = parseFloat(goal.target_value) - parseFloat(goal.current_value);
  const unit = goal.unit || UNIT_MAP[goal.goal_type] || '';

  let daysLeft = null;
  if (goal.target_date && !isAchieved) {
    // target_date is a DATE column — parse at local midnight (the modal already
    // does this at line ~641) so AST evenings don't undercount by a day.
    const diff = Math.ceil((new Date(`${String(goal.target_date).slice(0, 10)}T00:00:00`) - new Date()) / (1000 * 60 * 60 * 24));
    daysLeft = diff > 0 ? diff : 0;
  }

  return (
    <button
      onClick={() => onTap(goal)}
      className="relative text-left group transition-transform active:scale-[0.98]"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid ' + (isAchieved ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'var(--color-border, ' + OB_LINE + ')'),
        borderRadius: 18,
        padding: 12,
        display: 'flex', flexDirection: 'column', gap: 8,
        fontFamily: OB_BODY,
      }}
    >
      {/* Icon tile + title */}
      <div className="flex items-start gap-2">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 32, height: 32, borderRadius: 10, background: soft }}
        >
          {isAchieved
            ? <Check size={15} style={{ color }} strokeWidth={2.5} />
            : <Icon size={15} style={{ color }} strokeWidth={2.2} />}
        </div>
        <div className="flex-1 min-w-0">
          {goal.is_milestone && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 1 }}>
              🎯 {t('goals.milestoneBadge', { defaultValue: 'Milestone' })}
            </span>
          )}
          <p className="text-[12px] leading-tight line-clamp-2" style={{ fontFamily: OB_DISPLAY, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.1 }}>
            {goal.title}
          </p>
          {goal.exercises?.name && (
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>{exName(goal.exercises)}</p>
          )}
        </div>
      </div>

      {/* Target + delta */}
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {parseFloat(goal.current_value).toLocaleString()} / {parseFloat(goal.target_value).toLocaleString()}
        </span>
        {!isAchieved && delta > 0 && (
          <span className="text-[10px] font-bold" style={{ color, fontVariantNumeric: 'tabular-nums' }}>
            +{delta.toLocaleString()} {unit}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ width: '100%' }}>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--color-surface-hover, rgba(0,0,0,0.06))', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%', borderRadius: 999,
              width: `${pct}%`,
              background: isAchieved ? 'var(--color-success, #10B981)' : color,
              transition: 'width 0.6s ease-out',
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        {isAchieved ? (
          <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: 'var(--color-success, #10B981)' }}>
            <Check size={10} /> {t('goals.achieved')}
          </span>
        ) : daysLeft !== null ? (
          <span className="text-[10px] font-semibold flex items-center gap-1" style={{ color: 'var(--color-text-subtle)' }}>
            <Calendar size={10} /> {t('goals.daysLeft', { count: daysLeft })}
          </span>
        ) : (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-subtle)' }}>{t('goals.openEnded')}</span>
        )}
        <span className="text-[10px] font-bold" style={{ color: isAchieved ? 'var(--color-success, #10B981)' : color, fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </span>
      </div>
    </button>
  );
}

// ── Shared modal shell (warm-paper aesthetic, bottom-sheet mobile) ───────
function ModalShell({ onClose, children }) {
  // Lock background scroll on both <html> and <body> — iOS WebView ignores
  // body-only locks when there's an outer scroll container, which let the
  // Profile/Progress page scroll behind the modal.
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      document.body.style.touchAction = prevTouch;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center animate-fade-in p-4"
      style={{ background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="animate-fade-in-up w-full sm:max-w-[460px] overflow-y-auto overflow-x-hidden"
        style={{
          // dvh accounts for the iOS browser chrome (URL/toolbar) — vh would
          // overshoot the visible viewport on a phone and clip the modal.
          // The 32px subtraction matches the parent's p-4 padding on both axes.
          maxHeight: 'min(calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)), 720px)',
          background: 'var(--color-bg-card)',
          borderRadius: 28,
          padding: '22px 22px 28px',
          fontFamily: OB_BODY,
          border: '1px solid var(--color-border, ' + OB_LINE + ')',
          boxShadow: '0 16px 48px rgba(11,15,18,0.18)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </div>
      <style>{`
        @media (min-width: 640px) {
          [data-ob-modal] { border-radius: 28px !important; }
        }
      `}</style>
    </div>
  );
}

// ── Reusable label ────────────────────────────────────────────────────────
function OBLabel({ children, optional }) {
  return (
    <p style={{
      fontFamily: OB_DISPLAY, fontSize: 11, fontWeight: 800, letterSpacing: 1.2,
      textTransform: 'uppercase', color: 'var(--color-text-muted)',
      marginBottom: 8,
    }}>
      {children}
      {optional && <span style={{ fontWeight: 600, letterSpacing: 0.4, textTransform: 'none', color: 'var(--color-text-subtle)', marginLeft: 6 }}>({optional})</span>}
    </p>
  );
}

// ── Reusable 54px input surface ───────────────────────────────────────────
const OB_INPUT_STYLE = {
  height: 54,
  width: '100%',
  // border-box so the 18px horizontal padding + 1px border don't push the
  // computed width past 100% — iOS native date input was overflowing the
  // modal because the default boxSizing is content-box for inputs.
  boxSizing: 'border-box',
  maxWidth: '100%',
  padding: '0 18px',
  borderRadius: 16,
  background: 'var(--color-bg-input, var(--color-surface-hover, rgba(0,0,0,0.03)))',
  border: '1px solid var(--color-border, ' + OB_LINE + ')',
  fontFamily: OB_BODY,
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  outline: 'none',
};

// ── Goal Detail / Edit Modal ─────────────────────────────────────────────
function GoalDetailModal({ goal, onClose, onDelete, onUpdate, fitnessLevel }) {
  const { t } = useTranslation('pages');
  const [editing, setEditing] = useState(false);
  const [targetValue, setTargetValue] = useState(String(goal.target_value));
  const [targetDate, setTargetDate] = useState(goal.target_date ?? '');
  const [title, setTitle] = useState(goal.title);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dateWarning, setDateWarning] = useState(null);
  const [realisticCaption, setRealisticCaption] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAchieved = !!goal.achieved_at;
  const pct = goalProgressPct(goal);
  const meta = getGoalMeta(goal.goal_type);
  const Icon = meta.icon;
  const color = meta.color;
  const soft = meta.soft;

  useEffect(() => {
    if (goal.goal_type !== 'lift_1rm' || !targetDate || !targetValue) {
      setDateWarning(null); setRealisticCaption(''); return;
    }
    const currentVal = parseFloat(goal.current_value);
    if (!currentVal || currentVal <= 0) { setDateWarning(null); setRealisticCaption(''); return; }
    const gap = parseFloat(targetValue) - currentVal;
    if (gap <= 0) { setDateWarning(null); setRealisticCaption(''); return; }

    const level = fitnessLevel || 'intermediate';
    const rates = PROGRESSION_RATES[level] || PROGRESSION_RATES.intermediate;
    const isIso = isIsolationExercise(goal.exercises?.name);
    const weeklyRate = isIso ? rates.isolation : rates.compound;
    const minWeeks = Math.ceil(gap / weeklyRate);
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + minWeeks * 7);
    const picked = new Date(targetDate + 'T00:00:00');

    if (picked < minDate) {
      const suggestedISO = minDate.toISOString().split('T')[0];
      const suggestedShort = minDate.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
      const goalUnit = goal.unit || 'lb';
      setDateWarning({
        suggestedDate: suggestedISO,
        suggestedLabel: suggestedShort,
        weeks: minWeeks,
        weeklyRate,
        unit: goalUnit,
        plan: t('goals.suggestedPlan', {
          rate: weeklyRate,
          unit: goalUnit,
          weeks: minWeeks,
          defaultValue: '+{{rate}} {{unit}}/week × {{weeks}} weeks',
        }),
      });
      setRealisticCaption('');
    } else {
      setDateWarning(null);
      const shortDate = picked.toLocaleDateString('default', { month: 'short', day: 'numeric' });
      setRealisticCaption(t('goals.realisticBy', { date: shortDate, defaultValue: 'Realistic · {{date}}' }));
    }
  }, [targetDate, targetValue, goal.goal_type, goal.current_value, goal.unit, fitnessLevel, goal.exercises?.name, t]);

  const handleSave = async () => {
    if (!targetValue || !title.trim()) return;
    setSaving(true);
    setSaveError('');
    const err = await onUpdate(goal.id, {
      target_value: parseFloat(targetValue),
      target_date: targetDate || null,
      title: title.trim(),
    });
    setSaving(false);
    if (err) {
      // Never render raw DB errors — PG/PostgREST code = server reject,
      // code-less = network ("TypeError: Load failed").
      const code = String(err?.code || '').trim();
      const isServerReject = /^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code);
      setSaveError(isServerReject
        ? t('goals.saveFailed', "Couldn't save your goal. Please try again.")
        : t('progress.body.connectionError', 'No connection — try again when you’re back online.'));
    }
  };

  return (
    <ModalShell onClose={onClose}>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center"
            style={{ width: 46, height: 46, borderRadius: 14, background: soft }}
          >
            {isAchieved
              ? <Trophy size={22} style={{ color }} strokeWidth={2.2} />
              : <Icon size={22} style={{ color }} strokeWidth={2.2} />}
          </div>
          <div>
            <h2 style={{ fontFamily: OB_DISPLAY, fontSize: 22, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -0.4, lineHeight: 1.1 }}>
              {editing ? t('goals.editGoal') : goal.title}
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {t(`goals.types.${goal.goal_type}`)}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-full transition-colors"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}
        >
          <X size={16} style={{ color: 'var(--color-text-subtle)' }} />
        </button>
      </div>

      {/* Exercise info */}
      {goal.exercises?.name && (
        <div className="flex items-center gap-2 mb-4" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))', borderRadius: 14, padding: '10px 14px' }}>
          <Dumbbell size={14} style={{ color: 'var(--color-text-subtle)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{exName(goal.exercises)}</span>
          {goal.exercises.muscle_group && (
            <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-subtle)' }}>{goal.exercises.muscle_group}</span>
          )}
        </div>
      )}

      {/* Progress */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {parseFloat(goal.current_value).toLocaleString()} / {parseFloat(goal.target_value).toLocaleString()} {goal.unit}
          </span>
          <span className="text-[16px] font-bold" style={{ fontFamily: OB_DISPLAY, color: isAchieved ? 'var(--color-success, #10B981)' : color, fontVariantNumeric: 'tabular-nums' }}>
            {pct}%
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--color-surface-hover, rgba(0,0,0,0.06))', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 999, width: `${pct}%`, background: isAchieved ? 'var(--color-success, #10B981)' : color, transition: 'width 0.6s ease-out' }} />
        </div>
        {isAchieved && (
          <p className="text-[12px] mt-2 flex items-center gap-1 font-semibold" style={{ color: 'var(--color-success, #10B981)' }}>
            <Check size={12} /> {t('goals.achieved')} — {new Date(goal.achieved_at).toLocaleDateString()}
          </p>
        )}
        {goal.target_date && !isAchieved && (
          <p className="text-[12px] mt-2 flex items-center gap-1" style={{ color: 'var(--color-text-subtle)' }}>
            <Calendar size={12} /> {t('goals.targetDate')}: {new Date(goal.target_date + 'T00:00:00').toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Edit form */}
      {editing && (
        <div className="flex flex-col gap-4 mb-5">
          <div>
            <OBLabel>{t('goals.goalTitle')}</OBLabel>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={80}
              style={OB_INPUT_STYLE}
            />
          </div>
          <div>
            <OBLabel>{t('goals.targetValue')}</OBLabel>
            <div className="flex items-center gap-2 max-w-full">
              <input
                type="number"
                inputMode="decimal"
                value={targetValue}
                onChange={e => setTargetValue(e.target.value)}
                className="min-w-0 flex-1"
                style={{ ...OB_INPUT_STYLE, width: 'auto', fontFamily: OB_DISPLAY, fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: 17 }}
              />
              <span className="text-[12px] font-bold flex-shrink-0" style={{ minWidth: 56, maxWidth: 110, textAlign: 'center', color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {unitLabel(goal.goal_type, t) || goal.unit}
              </span>
            </div>
          </div>
          <div>
            <OBLabel optional={t('goals.optional')}>{t('goals.targetDate')}</OBLabel>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              style={OB_INPUT_STYLE}
            />
            {realisticCaption && !dateWarning && (
              <p className="text-[11px] mt-1.5 flex items-center gap-1.5" style={{ color: OB_TEAL_DEEP, fontWeight: 700 }}>
                <Check size={11} strokeWidth={2.8} /> {realisticCaption}
              </p>
            )}
          </div>
          {dateWarning && (
            <div
              style={{
                background: 'color-mix(in srgb, #FF5A2E 12%, var(--color-bg-card))',
                border: '1px solid ' + OB_ORANGE + '33',
                borderRadius: 14,
                padding: '12px 14px',
              }}
            >
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={14} style={{ color: OB_ORANGE, flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="text-[12px] leading-snug" style={{ color: OB_ORANGE, fontWeight: 700 }}>
                    {t('goals.tooAggressiveTitle', 'That date is too aggressive')}
                  </p>
                  <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
                    {t('goals.suggestRealistic', {
                      date: dateWarning.suggestedLabel,
                      defaultValue: 'Realistic target: {{date}}',
                    })}
                    {' · '}
                    <span style={{ fontWeight: 700 }}>{dateWarning.plan}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTargetDate(dateWarning.suggestedDate)}
                className="w-full"
                style={{
                  height: 36,
                  borderRadius: 10,
                  background: OB_ORANGE,
                  color: '#fff',
                  border: 'none',
                  fontFamily: OB_DISPLAY,
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: 0.3,
                }}
              >
                {t('goals.useRealisticDate', 'Use this date instead')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="mb-4 animate-fade-in" style={{ background: 'color-mix(in srgb, #FF5A2E 12%, var(--color-bg-card))', border: '1px solid ' + OB_ORANGE + '33', borderRadius: 16, padding: 14 }}>
          <p className="text-[13px] font-bold mb-3" style={{ color: OB_ORANGE, fontFamily: OB_DISPLAY }}>
            {t('goals.confirmDelete', 'Delete this goal? This cannot be undone.')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 transition-colors"
              style={{ height: 42, borderRadius: 999, background: 'var(--color-bg-hover)', border: '1px solid ' + OB_ORANGE + '44', fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 13, color: 'var(--color-text-primary)' }}
            >
              {t('goals.cancel')}
            </button>
            <button
              onClick={() => onDelete(goal.id)}
              className="flex-1"
              style={{ height: 42, borderRadius: 999, background: OB_ORANGE, color: '#fff', fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 13 }}
            >
              {t('goals.deleteGoal')}
            </button>
          </div>
        </div>
      )}

      {/* Save error (kept inline so the modal stays open with feedback) */}
      {saveError && editing && !confirmDelete && (
        <p className="text-[12px] font-semibold mb-2.5 text-center" style={{ color: OB_ORANGE }}>
          {saveError}
        </p>
      )}

      {/* Actions */}
      {!confirmDelete && (
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 transition-colors"
                style={{ height: 54, borderRadius: 999, background: 'transparent', border: '1px solid ' + OB_LINE_STRONG, fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 15, color: 'var(--color-text-muted)' }}
              >
                {t('goals.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !targetValue || !title.trim()}
                className="flex-1 transition-colors"
                style={{
                  height: 54, borderRadius: 999,
                  background: saving || !targetValue || !title.trim() ? 'color-mix(in srgb, var(--color-accent) 25%, var(--color-bg-card))' : OB_TEAL,
                  color: saving || !targetValue || !title.trim() ? 'var(--color-text-muted)' : '#0A2A2A',
                  fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 15,
                }}
              >
                {saving ? t('goals.saving') : t('goals.saveChanges')}
              </button>
            </>
          ) : (
            <>
              {!isAchieved && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 transition-colors"
                  style={{ height: 54, borderRadius: 999, background: 'transparent', border: '1px solid ' + OB_LINE_STRONG, fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 15, color: 'var(--color-text-primary)' }}
                >
                  <Pencil size={14} /> {t('goals.editGoal')}
                </button>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex-1 flex items-center justify-center gap-1.5"
                style={{ height: 54, borderRadius: 999, background: 'transparent', border: '1px solid ' + OB_ORANGE + '55', fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 15, color: OB_ORANGE }}
              >
                <Trash2 size={14} /> {t('goals.deleteGoal')}
              </button>
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ── Goal Creation Modal (warm-paper redesign) ────────────────────────────
function GoalModal({ onClose, onCreated, gymId, fitnessLevel }) {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [stage, setStage] = useState('type'); // 'type' | 'details'
  const [goalType, setGoalType] = useState(null);
  const [exerciseId, setExerciseId] = useState('');
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [targetValue, setTargetValue] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [current1RM, setCurrent1RM] = useState(null);
  const [dateWarning, setDateWarning] = useState('');
  const [realisticCaption, setRealisticCaption] = useState('');
  // True when targetDate was filled by the auto-suggestion heuristic. Cleared
  // as soon as the user touches the field manually.
  const [dateIsSuggested, setDateIsSuggested] = useState(false);
  const searchTimerRef = useRef(null);

  const meta = goalType ? getGoalMeta(goalType) : null;
  const needsExercise = meta?.needsExercise;
  // Stored unit (canonical, ASCII) goes into the DB; displayUnit is shown in UI.
  const unit = goalType ? UNIT_MAP[goalType] : '';
  const displayUnit = goalType ? unitLabel(goalType, t) : '';

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Load exercises
  useEffect(() => {
    if (!needsExercise) return;
    const load = async () => {
      setLoadingExercises(true);
      let query = supabase
        .from('exercises')
        .select('id, name, name_es, muscle_group, equipment')
        .eq('is_active', true)
        .order('name');

      if (debouncedQuery.trim()) {
        const safeQuery = debouncedQuery.trim().replace(/[%_\\,()."']/g, '');
        const q = `%${safeQuery}%`;
        query = query.or(`name.ilike.${q},name_es.ilike.${q}`);
      }

      const { data } = await query.limit(200);
      setExercises(data ?? []);
      setLoadingExercises(false);
    };
    load();
  }, [needsExercise, debouncedQuery]);

  // Fetch current 1RM
  useEffect(() => {
    if (!exerciseId || goalType !== 'lift_1rm') { setCurrent1RM(null); return; }
    const fetchCurrent = async () => {
      const { data } = await supabase
        .from('personal_records')
        .select('estimated_1rm')
        .eq('profile_id', user.id)
        .eq('exercise_id', exerciseId)
        .order('estimated_1rm', { ascending: false })
        .limit(1)
        .maybeSingle();
      setCurrent1RM(data?.estimated_1rm ?? null);
    };
    fetchCurrent();
  }, [exerciseId, goalType, user?.id]);

  // Date validation. Instead of bare "too aggressive" text, surface a
  // suggested realistic date plus a one-line plan (rate × weeks). The
  // dateWarning state goes from a string to an object so the render block
  // can offer a one-tap "Use this date" action.
  useEffect(() => {
    if (goalType !== 'lift_1rm' || !targetDate || !targetValue) {
      setDateWarning(null); setRealisticCaption(''); return;
    }
    if (!current1RM || current1RM <= 0) { setDateWarning(null); setRealisticCaption(''); return; }
    const gap = parseFloat(targetValue) - current1RM;
    if (gap <= 0) { setDateWarning(null); setRealisticCaption(''); return; }

    const level = fitnessLevel || 'intermediate';
    const rates = PROGRESSION_RATES[level] || PROGRESSION_RATES.intermediate;
    const isIso = isIsolationExercise(selectedExercise?.name);
    const weeklyRate = isIso ? rates.isolation : rates.compound;
    const minWeeks = Math.ceil(gap / weeklyRate);
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + minWeeks * 7);
    const picked = new Date(targetDate + 'T00:00:00');

    if (picked < minDate) {
      const suggestedISO = minDate.toISOString().split('T')[0];
      const suggestedShort = minDate.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
      setDateWarning({
        suggestedDate: suggestedISO,
        suggestedLabel: suggestedShort,
        weeks: minWeeks,
        weeklyRate,
        unit,
        plan: t('goals.suggestedPlan', {
          rate: weeklyRate,
          unit,
          weeks: minWeeks,
          defaultValue: '+{{rate}} {{unit}}/week × {{weeks}} weeks',
        }),
      });
      setRealisticCaption('');
    } else {
      setDateWarning(null);
      const shortDate = picked.toLocaleDateString('default', { month: 'short', day: 'numeric' });
      setRealisticCaption(t('goals.realisticBy', { date: shortDate, defaultValue: 'Realistic · {{date}}' }));
    }
  }, [targetDate, targetValue, goalType, current1RM, fitnessLevel, selectedExercise?.name, unit, t]);

  // Auto-suggest a target date when the user enters a target value. We only
  // overwrite the date when it's empty OR when it was previously filled by us
  // (dateIsSuggested) — never if the user picked their own date.
  useEffect(() => {
    if (!goalType || !targetValue) return;
    if (targetDate && !dateIsSuggested) return; // user picked their own date
    const suggested = suggestTargetDate({
      goalType,
      targetValue,
      currentValue: goalType === 'lift_1rm' ? current1RM : null,
      fitnessLevel,
      exerciseName: selectedExercise?.name,
    });
    if (suggested && suggested !== targetDate) {
      setTargetDate(suggested);
      setDateIsSuggested(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalType, targetValue, current1RM, fitnessLevel, selectedExercise?.name]);

  // Auto-generate title
  useEffect(() => {
    if (!goalType) return;
    const ex = selectedExercise;
    const typeLabels = {
      lift_1rm: ex ? `${exName(ex)} ${targetValue || '?'} ${displayUnit}` : '',
      body_weight: `${t('goals.types.body_weight')} ${targetValue || '?'} ${displayUnit}`,
      body_fat: `${t('goals.types.body_fat')} ${targetValue || '?'}${displayUnit}`,
      workout_count: `${targetValue || '?'} ${t('goals.types.workout_count')}`,
      streak: `${targetValue || '?'} ${t('goals.types.streak')}`,
      volume: `${targetValue || '?'} ${displayUnit} ${t('goals.types.volume')}`,
    };
    const auto = typeLabels[goalType] || '';
    if (targetDate) {
      const d = new Date(targetDate + 'T00:00:00');
      const month = d.toLocaleString('default', { month: 'short' });
      setTitle(`${auto} ${t('goals.by')} ${month}`);
    } else {
      setTitle(auto);
    }
  }, [goalType, exerciseId, targetValue, targetDate, selectedExercise, unit, t]);

  const pickType = (key) => {
    setGoalType(key);
    setExerciseId('');
    setSelectedExercise(null);
    setSearchQuery('');
    setCurrent1RM(null);
    setStage('details');
  };

  const handleSave = async () => {
    if (!targetValue || !title.trim()) return;
    if (needsExercise && !exerciseId) return;
    setSaving(true);
    setSaveError('');

    // Seed BOTH current_value and start_value with the member's current metric so
    // the progress bar measures distance covered from where they started (see
    // goalProgressPct). lift goals start from current 1RM; body goals from the
    // latest logged weight / body-fat; count/streak/volume from 0. Body goals
    // created before any metric exists seed 0 and get backfilled on the first
    // body-metric log (lib/goalUpdater.js updateBodyMetricGoals).
    let seedValue = 0;
    if (goalType === 'lift_1rm') {
      seedValue = current1RM ?? 0;
    } else if (goalType === 'body_weight') {
      const { data } = await supabase
        .from('body_weight_logs')
        .select('weight_lbs')
        .eq('profile_id', user.id)
        .order('logged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      seedValue = data?.weight_lbs != null ? parseFloat(data.weight_lbs) : 0;
    } else if (goalType === 'body_fat') {
      const { data } = await supabase
        .from('body_measurements')
        .select('body_fat_pct')
        .eq('profile_id', user.id)
        .not('body_fat_pct', 'is', null)
        .order('measured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      seedValue = data?.body_fat_pct != null ? parseFloat(data.body_fat_pct) : 0;
    }

    const payload = {
      profile_id: user.id,
      gym_id: gymId,
      goal_type: goalType,
      target_value: parseFloat(targetValue),
      current_value: seedValue,
      start_value: seedValue,
      unit,
      title: title.trim(),
      target_date: targetDate || null,
      exercise_id: needsExercise ? exerciseId : null,
    };

    let { error } = await supabase.from('member_goals').upsert(payload, {
      onConflict: 'profile_id,goal_type,exercise_id',
    });
    // start_value ships in migration 0557, which may not be applied yet. If the
    // column is missing, retry without the baseline so goal creation still works
    // — progress falls back to the legacy current/target formula until the
    // migration lands. (Same resilient-write pattern as GymClosuresCard.)
    if (error && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist/i.test(error.message || ''))) {
      const { start_value, ...base } = payload;
      ({ error } = await supabase.from('member_goals').upsert(base, {
        onConflict: 'profile_id,goal_type,exercise_id',
      }));
    }

    setSaving(false);
    if (!error) {
      posthogClient?.capture('goal_created', { goal_type: goalType });
      onCreated();
      return;
    }
    // Never render raw DB errors — PG/PostgREST code = server reject,
    // code-less = network ("TypeError: Load failed").
    logger.error('GoalsSection create error', error);
    const code = String(error?.code || '').trim();
    const isServerReject = /^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code);
    setSaveError(isServerReject
      ? t('goals.saveFailed', "Couldn't save your goal. Please try again.")
      : t('progress.body.connectionError', 'No connection — try again when you’re back online.'));
  };

  const canSave = targetValue && title.trim() && (!needsExercise || exerciseId);

  return (
    <ModalShell onClose={onClose}>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p style={{ fontFamily: OB_DISPLAY, fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: OB_TEAL_DEEP, marginBottom: 4 }}>
            {t('goals.newGoal')}
          </p>
          <h2 style={{
            fontFamily: OB_DISPLAY, fontWeight: 900,
            fontSize: 27, letterSpacing: -0.6, lineHeight: 1.05,
            color: 'var(--color-text-primary)',
          }}>
            {stage === 'type'
              ? t('goals.whatsYourGoal', "What's your goal?")
              : meta ? t(`goals.types.${goalType}`) : ''}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-full transition-colors"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', flexShrink: 0 }}
        >
          <X size={16} style={{ color: 'var(--color-text-subtle)' }} />
        </button>
      </div>

      {/* Stage 1: Goal type picker */}
      {stage === 'type' && (
        <div className="animate-fade-in">
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            {GOAL_TYPES.map(({ key, icon: TypeIcon, color, soft }) => (
              <button
                key={key}
                onClick={() => pickType(key)}
                className="transition-transform active:scale-[0.97] min-w-0"
                style={{
                  padding: 14,
                  borderRadius: 18,
                  background: 'var(--color-surface-hover, rgba(0,0,0,0.02))',
                  border: '1px solid var(--color-border, ' + OB_LINE + ')',
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                  textAlign: 'left',
                  minHeight: 118,
                  // Prevent long localized labels (e.g. "Conteo de entrenamientos")
                  // from overflowing the grid track and pushing the modal wider
                  // than the viewport.
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: soft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <TypeIcon size={20} style={{ color }} strokeWidth={2.2} />
                </div>
                <div className="min-w-0 w-full">
                  <p
                    style={{
                      fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 14,
                      color: 'var(--color-text-primary)', letterSpacing: -0.2,
                      lineHeight: 1.15,
                      wordBreak: 'break-word',
                      hyphens: 'auto',
                    }}
                  >
                    {t(`goals.types.${key}`)}
                  </p>
                  <p
                    style={{
                      fontSize: 11, color: 'var(--color-text-subtle)',
                      marginTop: 3, lineHeight: 1.25,
                      wordBreak: 'break-word',
                    }}
                  >
                    {t(`goals.typeSub.${key}`, {
                      defaultValue: {
                        lift_1rm: 'Hit a new 1RM',
                        body_weight: 'Reach a target weight',
                        body_fat: 'Lean down',
                        workout_count: 'Sessions goal',
                        streak: 'Consecutive days',
                        volume: 'Total pounds moved',
                      }[key],
                    })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stage 2: Details form */}
      {stage === 'details' && meta && (
        <div className="animate-fade-in">
          {/* Exercise picker */}
          {needsExercise && (
            <div className="mb-4">
              <OBLabel>{t('goals.exercise')}</OBLabel>
              <div className="relative mb-2">
                <Search size={15} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder={t('goals.searchExercise')}
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); if (exerciseId) { setExerciseId(''); setSelectedExercise(null); } }}
                  maxLength={100}
                  style={{ ...OB_INPUT_STYLE, paddingLeft: 44 }}
                />
              </div>
              {selectedExercise ? (
                <div className="flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-card))', border: '1px solid ' + OB_TEAL + '55', borderRadius: 14, padding: '10px 14px' }}>
                  <Check size={14} style={{ color: OB_TEAL_DEEP }} strokeWidth={2.6} />
                  <span className="text-[13px] font-bold" style={{ color: OB_TEAL_DEEP, fontFamily: OB_DISPLAY }}>{exName(selectedExercise)}</span>
                  {selectedExercise.muscle_group && (
                    <span className="text-[11px] ml-auto" style={{ color: OB_TEAL_DEEP, opacity: 0.7 }}>{selectedExercise.muscle_group}</span>
                  )}
                  <button onClick={() => { setExerciseId(''); setSelectedExercise(null); setSearchQuery(''); }} style={{ marginLeft: 4, padding: 2, borderRadius: 999 }}>
                    <X size={12} style={{ color: OB_TEAL_DEEP }} />
                  </button>
                </div>
              ) : (
                <div className="max-h-[200px] overflow-y-auto" style={{ background: 'var(--color-bg-input, var(--color-surface-hover, rgba(0,0,0,0.03)))', borderRadius: 14, border: '1px solid var(--color-border, ' + OB_LINE + ')' }}>
                  {loadingExercises ? (
                    <div className="px-4 py-3 text-[12px] text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('goals.loading')}</div>
                  ) : exercises.length === 0 ? (
                    <div className="px-4 py-3 text-[12px] text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('goals.noExercisesFound')}</div>
                  ) : (
                    exercises.map(ex => (
                      <button
                        key={ex.id}
                        onClick={() => { setExerciseId(ex.id); setSelectedExercise(ex); setSearchQuery(exName(ex)); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] transition-colors flex items-center justify-between"
                        style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border, ' + OB_LINE + ')' }}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="truncate font-semibold">{exName(ex)}</span>
                          {(ex.muscle_group || ex.equipment) && (
                            <span className="text-[10px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
                              {[ex.muscle_group, ex.equipment].filter(Boolean).join(' \u00B7 ')}
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
              {current1RM !== null && (
                <p className="text-[11px] mt-2 font-semibold" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('goals.current1RM')}: <span style={{ color: 'var(--color-text-primary)', fontFamily: OB_DISPLAY, fontWeight: 800 }}>{Math.round(current1RM)} {unit}</span>
                </p>
              )}
            </div>
          )}

          {/* Target value */}
          <div className="mb-4">
            <OBLabel>{t('goals.targetValue')}</OBLabel>
            <div className="flex items-center gap-2 max-w-full">
              <input
                type="number"
                inputMode="decimal"
                value={targetValue}
                onChange={e => setTargetValue(e.target.value)}
                placeholder="0"
                className="min-w-0 flex-1"
                style={{ ...OB_INPUT_STYLE, width: 'auto', fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}
              />
              <span className="flex-shrink-0" style={{ minWidth: 56, maxWidth: 110, textAlign: 'center', fontSize: 12, fontWeight: 800, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayUnit}
              </span>
            </div>
          </div>

          {/* Target date */}
          <div className="mb-4">
            <div className="flex items-center justify-between" style={{ marginBottom: -4 }}>
              <OBLabel optional={t('goals.optional')}>{t('goals.targetDate')}</OBLabel>
              {dateIsSuggested && targetDate && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-card))', color: 'var(--color-accent)', letterSpacing: 0.3, marginBottom: 8 }}
                >
                  {t('goals.suggestedChip', 'Sugerido')}
                </span>
              )}
            </div>
            <input
              type="date"
              value={targetDate}
              onChange={e => { setTargetDate(e.target.value); setDateIsSuggested(false); }}
              min={new Date().toISOString().split('T')[0]}
              style={{ ...OB_INPUT_STYLE, maxWidth: '100%', boxSizing: 'border-box' }}
            />
            {realisticCaption && !dateWarning && (
              <p className="text-[11px] mt-1.5 flex items-center gap-1.5 font-bold" style={{ color: OB_TEAL_DEEP }}>
                <Check size={11} strokeWidth={2.8} /> {realisticCaption}
              </p>
            )}
            {dateWarning && (
              <div
                className="mt-2"
                style={{
                  background: 'color-mix(in srgb, #FF5A2E 12%, var(--color-bg-card))',
                  border: '1px solid ' + OB_ORANGE + '33',
                  borderRadius: 14,
                  padding: '12px 14px',
                }}
              >
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle size={14} style={{ color: OB_ORANGE, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="text-[12px] leading-snug" style={{ color: OB_ORANGE, fontWeight: 700 }}>
                      {t('goals.tooAggressiveTitle', 'That date is too aggressive')}
                    </p>
                    <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
                      {t('goals.suggestRealistic', {
                        date: dateWarning.suggestedLabel,
                        defaultValue: 'Realistic target: {{date}}',
                      })}
                      {' · '}
                      <span style={{ fontWeight: 700 }}>{dateWarning.plan}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTargetDate(dateWarning.suggestedDate)}
                  className="w-full"
                  style={{
                    height: 36,
                    borderRadius: 10,
                    background: OB_ORANGE,
                    color: '#fff',
                    border: 'none',
                    fontFamily: OB_DISPLAY,
                    fontWeight: 800,
                    fontSize: 12,
                    letterSpacing: 0.3,
                  }}
                >
                  {t('goals.useRealisticDate', 'Use this date instead')}
                </button>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="mb-5">
            <OBLabel>{t('goals.goalTitle')}</OBLabel>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={80}
              style={OB_INPUT_STYLE}
            />
          </div>

          {/* Save error (kept inline so the modal stays open with feedback) */}
          {saveError && (
            <p className="text-[12px] font-semibold mb-2.5 text-center" style={{ color: OB_ORANGE }}>
              {saveError}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setStage('type')}
              className="transition-colors"
              style={{ height: 54, padding: '0 20px', borderRadius: 999, background: 'transparent', border: '1px solid ' + OB_LINE_STRONG, fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 15, color: 'var(--color-text-muted)' }}
            >
              {t('goals.back', 'Back')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="flex-1 transition-colors"
              style={{
                height: 54, borderRadius: 999,
                background: saving || !canSave ? 'color-mix(in srgb, var(--color-accent) 25%, var(--color-bg-card))' : OB_TEAL,
                color: saving || !canSave ? 'var(--color-text-muted)' : '#0A2A2A',
                fontFamily: OB_DISPLAY, fontWeight: 800, fontSize: 15,
              }}
            >
              {saving ? t('goals.saving') : t('goals.createGoal')}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

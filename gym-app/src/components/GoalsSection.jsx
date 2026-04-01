import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Target, Plus, Trophy, Dumbbell, Scale, Flame, TrendingUp,
  Calendar, Check, X, ChevronRight, Zap, Activity, Search,
  Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { exName } from '../lib/exerciseName';
import Confetti from './Confetti';

// ── Goal type config ─────────────────────────────────────────────────────
const GOAL_TYPES = [
  { key: 'lift_1rm',       icon: Dumbbell,    color: '#D4AF37', needsExercise: true },
  { key: 'body_weight',    icon: Scale,        color: '#60A5FA', needsExercise: false },
  { key: 'body_fat',       icon: Activity,     color: '#34D399', needsExercise: false },
  { key: 'workout_count',  icon: TrendingUp,   color: '#A78BFA', needsExercise: false },
  { key: 'streak',         icon: Flame,        color: '#F97316', needsExercise: false },
  { key: 'volume',         icon: Zap,          color: '#EF4444', needsExercise: false },
];

const UNIT_MAP = {
  lift_1rm: 'lbs',
  body_weight: 'lbs',
  body_fat: '%',
  workout_count: 'workouts',
  streak: 'days',
  volume: 'lbs',
};

// Progression rates in lbs/week (intermediate defaults)
const PROGRESSION_RATES = {
  beginner:     { compound: 5,    isolation: 2.5 },
  intermediate: { compound: 2.5,  isolation: 1.25 },
  advanced:     { compound: 1.25, isolation: 0.5 },
};

// Exercises commonly considered isolation (match by partial name)
const ISOLATION_KEYWORDS = [
  'curl', 'extension', 'fly', 'flye', 'raise', 'kickback',
  'pullover', 'shrug', 'wrist', 'calf', 'forearm',
];

function isIsolationExercise(exerciseName) {
  if (!exerciseName) return false;
  const lower = exerciseName.toLowerCase();
  return ISOLATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getGoalIcon(goalType) {
  return GOAL_TYPES.find(g => g.key === goalType)?.icon ?? Target;
}
function getGoalColor(goalType) {
  return GOAL_TYPES.find(g => g.key === goalType)?.color ?? 'var(--color-accent)';
}

// ── Main Goals Section ───────────────────────────────────────────────────
export default function GoalsSection() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editGoal, setEditGoal] = useState(null); // goal object for edit/detail modal
  const [celebrateGoal, setCelebrateGoal] = useState(null);

  const loadGoals = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('member_goals')
      .select('*, exercises(name, name_es, muscle_group, equipment)')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false });
    setGoals(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadGoals(); }, [user?.id]);

  const handleGoalTap = (goal) => {
    if (goal.achieved_at) {
      setCelebrateGoal(goal);
      setTimeout(() => setCelebrateGoal(null), 2500);
    }
    // Always open detail modal
    setEditGoal(goal);
  };

  const handleDelete = async (goalId) => {
    await supabase.from('member_goals').delete().eq('id', goalId);
    setGoals(prev => prev.filter(g => g.id !== goalId));
    setEditGoal(null);
  };

  const handleUpdate = async (goalId, updates) => {
    const { error } = await supabase
      .from('member_goals')
      .update(updates)
      .eq('id', goalId);
    if (!error) {
      setEditGoal(null);
      loadGoals();
    }
  };

  if (loading) return null;

  const activeGoals = goals.filter(g => !g.achieved_at);
  const achievedGoals = goals.filter(g => g.achieved_at);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={16} style={{ color: 'var(--color-accent)' }} />
          <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('goals.title')}</p>
          {activeGoals.length > 0 && (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
              {activeGoals.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
        >
          <Plus size={14} />
          {t('goals.addGoal')}
        </button>
      </div>

      {/* Goal cards — 2-column grid */}
      {goals.length === 0 ? (
        <button
          onClick={() => setShowModal(true)}
          className="rounded-2xl border border-dashed border-white/[0.1] p-6 flex flex-col items-center gap-2 hover:bg-white/[0.04] transition-colors"
          style={{ background: 'var(--color-bg-card)' }}
        >
          <Target size={28} style={{ color: 'var(--color-text-subtle)' }} />
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('goals.noGoalsYet')}</p>
          <p className="text-[12px] font-semibold text-[#D4AF37]">{t('goals.setYourFirstGoal')}</p>
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {activeGoals.map(goal => (
            <GoalCard key={goal.id} goal={goal} onTap={handleGoalTap} onDelete={handleDelete} />
          ))}
          {achievedGoals.map(goal => (
            <GoalCard key={goal.id} goal={goal} onTap={handleGoalTap} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Confetti for achieved goal */}
      <Confetti active={!!celebrateGoal} particleCount={80} duration={2500} />

      {/* Celebrate overlay */}
      <AnimatePresence>
        {celebrateGoal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setCelebrateGoal(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="border border-[#D4AF37]/30 rounded-3xl p-8 flex flex-col items-center gap-4 max-w-[280px] mx-4"
              style={{ background: 'var(--color-bg-card)' }}
              onClick={e => e.stopPropagation()}
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', boxShadow: '0 0 40px var(--color-accent-glow)' }}
              >
                <Trophy size={32} className="text-[#D4AF37]" />
              </div>
              <p className="text-[18px] font-bold text-center" style={{ color: 'var(--color-text-primary)' }}>{t('goals.goalAchieved')}</p>
              <p className="text-[14px] text-center" style={{ color: 'var(--color-text-muted)' }}>{celebrateGoal.title}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

// ── Goal Card (compact for 2-col grid) ───────────────────────────────────
function GoalCard({ goal, onTap, onDelete }) {
  const { t } = useTranslation('pages');
  const isAchieved = !!goal.achieved_at;
  const pct = Math.min(100, Math.round((parseFloat(goal.current_value) / parseFloat(goal.target_value)) * 100));
  const Icon = getGoalIcon(goal.goal_type);
  const color = getGoalColor(goal.goal_type);

  // Days remaining
  let daysLeft = null;
  if (goal.target_date && !isAchieved) {
    const diff = Math.ceil((new Date(goal.target_date) - new Date()) / (1000 * 60 * 60 * 24));
    daysLeft = diff > 0 ? diff : 0;
  }

  return (
    <motion.button
      layout
      onClick={() => onTap(goal)}
      className="relative rounded-xl border border-white/[0.06] p-3 flex flex-col gap-2 text-left group transition-colors hover:bg-white/[0.04]"
      style={{
        background: 'var(--color-bg-card)',
        ...(isAchieved ? { borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' } : {}),
      }}
      whileTap={{ scale: 0.97 }}
    >
      {/* Icon + title */}
      <div className="flex items-start gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}15` }}
        >
          {isAchieved ? <Check size={14} style={{ color }} /> : <Icon size={14} style={{ color }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold leading-tight line-clamp-2" style={{ color: 'var(--color-text-primary)' }}>{goal.title}</p>
          {goal.exercises?.name && (
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>{exName(goal.exercises)}</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {parseFloat(goal.current_value).toLocaleString()} / {parseFloat(goal.target_value).toLocaleString()}
          </span>
          <span className="text-[10px] font-bold" style={{ color: isAchieved ? 'var(--color-success)' : color, fontVariantNumeric: 'tabular-nums' }}>
            {pct}%
          </span>
        </div>
        <div className="h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: isAchieved ? 'var(--color-success)' : color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Footer: days left or achieved */}
      <div className="flex items-center gap-1">
        {isAchieved ? (
          <span className="text-[9px] font-semibold text-[#10B981] flex items-center gap-1">
            <Check size={9} /> {t('goals.achieved')}
          </span>
        ) : daysLeft !== null ? (
          <span className="text-[9px] font-semibold flex items-center gap-1" style={{ color: 'var(--color-text-subtle)' }}>
            <Calendar size={9} /> {t('goals.daysLeft', { count: daysLeft })}
          </span>
        ) : (
          <span className="text-[9px] font-semibold" style={{ color: 'var(--color-text-subtle)' }}>{t('goals.openEnded')}</span>
        )}
      </div>
    </motion.button>
  );
}

// ── Goal Detail / Edit Modal ─────────────────────────────────────────────
function GoalDetailModal({ goal, onClose, onDelete, onUpdate, fitnessLevel }) {
  const { t } = useTranslation('pages');
  const [editing, setEditing] = useState(false);
  const [targetValue, setTargetValue] = useState(String(goal.target_value));
  const [targetDate, setTargetDate] = useState(goal.target_date ?? '');
  const [title, setTitle] = useState(goal.title);
  const [saving, setSaving] = useState(false);
  const [dateWarning, setDateWarning] = useState('');

  const isAchieved = !!goal.achieved_at;
  const pct = Math.min(100, Math.round((parseFloat(goal.current_value) / parseFloat(goal.target_value)) * 100));
  const Icon = getGoalIcon(goal.goal_type);
  const color = getGoalColor(goal.goal_type);

  // Prevent background page scrolling while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Date validation for lift goals
  useEffect(() => {
    if (goal.goal_type !== 'lift_1rm' || !targetDate || !targetValue) {
      setDateWarning('');
      return;
    }
    // If we don't have a current value, we can't estimate a realistic date
    const currentVal = parseFloat(goal.current_value);
    if (!currentVal || currentVal <= 0) { setDateWarning(''); return; }
    const gap = parseFloat(targetValue) - currentVal;
    if (gap <= 0) { setDateWarning(''); return; }

    const level = fitnessLevel || 'intermediate';
    const rates = PROGRESSION_RATES[level] || PROGRESSION_RATES.intermediate;
    const isIso = isIsolationExercise(goal.exercises?.name);
    const weeklyRate = isIso ? rates.isolation : rates.compound;
    const minWeeks = Math.ceil(gap / weeklyRate);
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + minWeeks * 7);
    const picked = new Date(targetDate + 'T00:00:00');

    if (picked < minDate) {
      const minDateStr = minDate.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
      setDateWarning(t('goals.dateWarning', { date: minDateStr, weeks: minWeeks, rate: weeklyRate }));
    } else {
      setDateWarning('');
    }
  }, [targetDate, targetValue, goal.goal_type, goal.current_value, fitnessLevel, goal.exercises?.name]);

  const handleSave = async () => {
    if (!targetValue || !title.trim()) return;
    setSaving(true);
    await onUpdate(goal.id, {
      target_value: parseFloat(targetValue),
      target_date: targetDate || null,
      title: title.trim(),
    });
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="border border-white/[0.08] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto overflow-x-hidden p-6 pb-8"
        style={{ background: 'var(--color-bg-card)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${color}15` }}
            >
              {isAchieved ? <Trophy size={20} style={{ color }} /> : <Icon size={20} style={{ color }} />}
            </div>
            <div>
              <h2 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{editing ? t('goals.editGoal') : goal.title}</h2>
              <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t(`goals.types.${goal.goal_type}`)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/[0.06] transition-colors">
            <X size={18} style={{ color: 'var(--color-text-subtle)' }} />
          </button>
        </div>

        {/* Exercise info */}
        {goal.exercises?.name && (
          <div className="flex items-center gap-2 mb-4 bg-white/[0.03] rounded-xl px-3 py-2">
            <Dumbbell size={14} style={{ color: 'var(--color-text-subtle)' }} />
            <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>{exName(goal.exercises)}</span>
            {goal.exercises.muscle_group && (
              <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-subtle)' }}>{goal.exercises.muscle_group}</span>
            )}
          </div>
        )}

        {/* Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {parseFloat(goal.current_value).toLocaleString()} / {parseFloat(goal.target_value).toLocaleString()} {goal.unit}
            </span>
            <span className="text-[14px] font-bold" style={{ color: isAchieved ? 'var(--color-success)' : color, fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </span>
          </div>
          <div className="h-[8px] rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: isAchieved ? 'var(--color-success)' : color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          {isAchieved && (
            <p className="text-[12px] text-[#10B981] mt-1 flex items-center gap-1 font-semibold">
              <Check size={12} /> {t('goals.achieved')} — {new Date(goal.achieved_at).toLocaleDateString()}
            </p>
          )}
          {goal.target_date && !isAchieved && (
            <p className="text-[12px] mt-1 flex items-center gap-1" style={{ color: 'var(--color-text-subtle)' }}>
              <Calendar size={12} /> {t('goals.targetDate')}: {new Date(goal.target_date + 'T00:00:00').toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Edit form */}
        {editing && (
          <div className="flex flex-col gap-4 mb-5">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('goals.goalTitle')}</p>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full border border-white/[0.08] rounded-xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
                style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)' }}
              />
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('goals.targetValue')}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={targetValue}
                  onChange={e => setTargetValue(e.target.value)}
                  className="flex-1 border border-white/[0.08] rounded-xl px-4 py-2.5 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
                  style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}
                />
                <span className="text-[13px] font-semibold w-14" style={{ color: 'var(--color-text-subtle)' }}>{goal.unit}</span>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('goals.targetDate')} <span className="normal-case" style={{ color: 'var(--color-text-subtle)' }}>({t('goals.optional')})</span>
              </p>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full border border-white/[0.08] rounded-xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
                style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)' }}
              />
            </div>
            {dateWarning && (
              <div className="flex items-start gap-2 bg-[#F97316]/10 border border-[#F97316]/20 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="text-[#F97316] flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#F97316] leading-relaxed">{dateWarning}</p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold border border-white/[0.08] hover:bg-white/[0.04] transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('goals.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !targetValue || !title.trim()}
                className="flex-1 py-3 rounded-xl text-[13px] font-bold bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-40 text-black transition-colors"
              >
                {saving ? t('goals.saving') : t('goals.saveChanges')}
              </button>
            </>
          ) : (
            <>
              {!isAchieved && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-semibold border border-white/[0.08] hover:bg-white/[0.04] transition-colors"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <Pencil size={14} /> {t('goals.editGoal')}
                </button>
              )}
              <button
                onClick={() => onDelete(goal.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-semibold border border-[#EF4444]/20 hover:bg-[#EF4444]/10 transition-colors text-[#EF4444]"
              >
                <Trash2 size={14} /> {t('goals.deleteGoal')}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Goal Creation Modal ──────────────────────────────────────────────────
function GoalModal({ onClose, onCreated, gymId, fitnessLevel }) {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [goalType, setGoalType] = useState('lift_1rm');
  const [exerciseId, setExerciseId] = useState('');
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [targetValue, setTargetValue] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [current1RM, setCurrent1RM] = useState(null);
  const [dateWarning, setDateWarning] = useState('');
  const searchTimerRef = useRef(null);

  // Prevent background page scrolling while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const needsExercise = GOAL_TYPES.find(g => g.key === goalType)?.needsExercise;
  const unit = UNIT_MAP[goalType];

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Load exercises from DB with server-side search
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
        const q = `%${debouncedQuery.trim()}%`;
        query = query.or(`name.ilike.${q},name_es.ilike.${q}`);
      }

      const { data } = await query.limit(200);
      setExercises(data ?? []);
      setLoadingExercises(false);
    };
    load();
  }, [needsExercise, debouncedQuery]);

  // Fetch current 1RM when exercise is selected (for date validation)
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

  // Realistic date validation for lift goals
  useEffect(() => {
    if (goalType !== 'lift_1rm' || !targetDate || !targetValue) {
      setDateWarning('');
      return;
    }
    // If we don't have a current 1RM, we can't estimate a realistic date
    if (!current1RM || current1RM <= 0) { setDateWarning(''); return; }
    const gap = parseFloat(targetValue) - current1RM;
    if (gap <= 0) { setDateWarning(''); return; }

    const level = fitnessLevel || 'intermediate';
    const rates = PROGRESSION_RATES[level] || PROGRESSION_RATES.intermediate;
    const isIso = isIsolationExercise(selectedExercise?.name);
    const weeklyRate = isIso ? rates.isolation : rates.compound;
    const minWeeks = Math.ceil(gap / weeklyRate);
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + minWeeks * 7);
    const picked = new Date(targetDate + 'T00:00:00');

    if (picked < minDate) {
      const minDateStr = minDate.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
      setDateWarning(t('goals.dateWarning', { date: minDateStr, weeks: minWeeks, rate: weeklyRate }));
    } else {
      setDateWarning('');
    }
  }, [targetDate, targetValue, goalType, current1RM, fitnessLevel, selectedExercise?.name]);

  // Auto-generate title
  useEffect(() => {
    const ex = selectedExercise;
    const typeLabels = {
      lift_1rm: ex ? `${exName(ex)} ${targetValue || '?'} ${unit}` : '',
      body_weight: `${t('goals.types.body_weight')} ${targetValue || '?'} ${unit}`,
      body_fat: `${t('goals.types.body_fat')} ${targetValue || '?'}${unit}`,
      workout_count: `${targetValue || '?'} ${t('goals.types.workout_count')}`,
      streak: `${targetValue || '?'} ${t('goals.types.streak')}`,
      volume: `${targetValue || '?'} ${unit} ${t('goals.types.volume')}`,
    };
    const auto = typeLabels[goalType] || '';
    if (targetDate) {
      const d = new Date(targetDate + 'T00:00:00');
      const month = d.toLocaleString('default', { month: 'short' });
      setTitle(`${auto} ${t('goals.by')} ${month}`);
    } else {
      setTitle(auto);
    }
  }, [goalType, exerciseId, targetValue, targetDate, selectedExercise]);

  const handleSave = async () => {
    if (!targetValue || !title.trim()) return;
    if (needsExercise && !exerciseId) return;
    setSaving(true);

    const payload = {
      profile_id: user.id,
      gym_id: gymId,
      goal_type: goalType,
      target_value: parseFloat(targetValue),
      current_value: current1RM ?? 0,
      unit,
      title: title.trim(),
      target_date: targetDate || null,
      exercise_id: needsExercise ? exerciseId : null,
    };

    const { error } = await supabase.from('member_goals').upsert(payload, {
      onConflict: 'profile_id,goal_type,exercise_id',
    });

    setSaving(false);
    if (!error) onCreated();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="border border-white/[0.08] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto overflow-x-hidden p-6 pb-8"
        style={{ background: 'var(--color-bg-card, #0F172A)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('goals.newGoal')}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/[0.06] transition-colors">
            <X size={18} style={{ color: 'var(--color-text-subtle)' }} />
          </button>
        </div>

        {/* Goal type selector */}
        <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('goals.goalType')}</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {GOAL_TYPES.map(({ key, icon: TypeIcon, color }) => (
            <button
              key={key}
              onClick={() => { setGoalType(key); setExerciseId(''); setSelectedExercise(null); setSearchQuery(''); setCurrent1RM(null); }}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
              style={goalType === key
                ? { background: `${color}15`, borderColor: `${color}40`, color }
                : { background: 'transparent', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
              }
            >
              <TypeIcon size={18} />
              <span className="text-[10px] font-semibold leading-tight text-center">
                {t(`goals.types.${key}`)}
              </span>
            </button>
          ))}
        </div>

        {/* Exercise picker (for lift goals) */}
        {needsExercise && (
          <div className="mb-5">
            <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('goals.exercise')}</p>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-subtle)' }} />
              <input
                type="text"
                placeholder={t('goals.searchExercise')}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (exerciseId) { setExerciseId(''); setSelectedExercise(null); } }}
                className="w-full border border-white/[0.08] rounded-xl pl-9 pr-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
                style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)', '--tw-placeholder-color': 'var(--color-text-subtle)' }}
              />
            </div>
            {/* Selected exercise chip */}
            {selectedExercise && (
              <div className="flex items-center gap-2 mb-2 bg-white/[0.04] border border-[#D4AF37]/20 rounded-xl px-3 py-2">
                <Check size={14} className="text-[#D4AF37]" />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{exName(selectedExercise)}</span>
                {selectedExercise.muscle_group && (
                  <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-subtle)' }}>{selectedExercise.muscle_group}</span>
                )}
                <button onClick={() => { setExerciseId(''); setSelectedExercise(null); setSearchQuery(''); }} className="ml-1 p-0.5 rounded-full hover:bg-white/[0.1]">
                  <X size={12} style={{ color: 'var(--color-text-subtle)' }} />
                </button>
              </div>
            )}
            {/* Exercise list */}
            {!selectedExercise && (
              <div className="max-h-[200px] overflow-y-auto rounded-xl border border-white/[0.06]" style={{ background: 'var(--color-bg-input, #111827)' }}>
                {loadingExercises ? (
                  <div className="px-4 py-3 text-[12px] text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('goals.loading')}</div>
                ) : exercises.length === 0 ? (
                  <div className="px-4 py-3 text-[12px] text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('goals.noExercisesFound')}</div>
                ) : (
                  exercises.map(ex => (
                    <button
                      key={ex.id}
                      onClick={() => { setExerciseId(ex.id); setSelectedExercise(ex); setSearchQuery(exName(ex)); }}
                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-white/[0.04] transition-colors flex items-center justify-between border-b border-white/[0.03] last:border-b-0"
                      style={{ color: exerciseId === ex.id ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{exName(ex)}</span>
                        {(ex.muscle_group || ex.equipment) && (
                          <span className="text-[10px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
                            {[ex.muscle_group, ex.equipment].filter(Boolean).join(' \u00B7 ')}
                          </span>
                        )}
                      </div>
                      {exerciseId === ex.id && <Check size={14} style={{ color: 'var(--color-accent)' }} className="flex-shrink-0 ml-2" />}
                    </button>
                  ))
                )}
              </div>
            )}
            {/* Current 1RM display */}
            {current1RM !== null && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-subtle)' }}>
                {t('goals.current1RM')}: <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{Math.round(current1RM)} {unit}</span>
              </p>
            )}
          </div>
        )}

        {/* Target value */}
        <div className="mb-5">
          <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('goals.targetValue')}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={targetValue}
              onChange={e => setTargetValue(e.target.value)}
              placeholder="0"
              className="flex-1 border border-white/[0.08] rounded-xl px-4 py-3 text-[16px] font-bold focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
              style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}
            />
            <span className="text-[14px] font-semibold w-16" style={{ color: 'var(--color-text-subtle)' }}>{unit}</span>
          </div>
        </div>

        {/* Target date (optional) */}
        <div className="mb-5">
          <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('goals.targetDate')} <span className="normal-case" style={{ color: 'var(--color-text-subtle)' }}>({t('goals.optional')})</span>
          </p>
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="w-full border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
            style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)' }}
          />
          {dateWarning && (
            <div className="flex items-start gap-2 mt-2 bg-[#F97316]/10 border border-[#F97316]/20 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="text-[#F97316] flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#F97316] leading-relaxed">{dateWarning}</p>
            </div>
          )}
        </div>

        {/* Title (auto-generated but editable) */}
        <div className="mb-6">
          <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('goals.goalTitle')}</p>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
            style={{ background: 'var(--color-bg-input, #111827)', color: 'var(--color-text-primary)' }}
          />
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || !targetValue || !title.trim() || (needsExercise && !exerciseId)}
          className="w-full bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-[14px] py-4 rounded-2xl transition-colors duration-200"
        >
          {saving ? t('goals.saving') : t('goals.createGoal')}
        </button>
      </motion.div>
    </motion.div>
  );
}

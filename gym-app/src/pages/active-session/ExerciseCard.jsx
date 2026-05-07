import React, { useMemo, useState, useEffect, useRef, memo } from 'react';
import {
  Check, Trophy, Plus, Minus, Clock, Play, X, MessageSquare,
  ArrowLeftRight, SkipForward, TrendingUp, Pencil,
} from 'lucide-react';
import { exercises as exerciseLibrary } from '../../data/exercises';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import CoachMark from '../../components/CoachMark';
import { useTranslation } from 'react-i18next';
import { exName, exInstructions } from '../../lib/exerciseName';

const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const REP_QUICK_SELECT = [6, 8, 10, 12, 15];

const resolveVideoSrc = (path) => {
  if (!path) return null;
  if (path.startsWith('/') || path.startsWith('http')) return path;
  const { data } = supabase.storage.from('exercise-videos').getPublicUrl(path);
  return data?.publicUrl || null;
};

// Local video fallback map (only used when no DB video exists)
const videoMap = {};
for (const ex of exerciseLibrary) {
  if (ex.videoUrl) videoMap[ex.id] = ex.videoUrl;
}

/* ── RPE color helpers ─────────────────────────────────────── */
const rpeColor = (v) => {
  if (v <= 3) return { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30', bgFaint: 'bg-emerald-500/10' };
  if (v <= 6) return { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30', bgFaint: 'bg-yellow-500/10' };
  if (v <= 8) return { bg: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-500/30', bgFaint: 'bg-orange-500/10' };
  return { bg: 'bg-red-500', text: 'text-red-400', border: 'border-red-500/30', bgFaint: 'bg-red-500/10' };
};

/* ── RPE Selector (horizontal 0–5 circles) ────────────────── */
const RpeSelector = React.memo(({ value, onChange, t }) => (
  <div
    className="rounded-2xl px-3 py-3"
    style={{
      backgroundColor: 'var(--color-bg-card)',
      border: '1px solid var(--color-border-subtle)',
    }}
  >
    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--color-text-subtle)' }}>
      {t?.('activeSession.rpeLabel') ?? 'RPE — How hard was it?'}
    </p>
    <div className="flex items-center justify-between gap-2">
      {[0, 1, 2, 3, 4, 5].map(n => {
        const c = rpeColor(n * 2);
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(selected ? null : n)}
            className={`flex-1 h-[44px] rounded-xl text-[13px] font-bold transition-all duration-150 flex items-center justify-center ${
              selected ? `${c.bg} text-white scale-105 shadow-lg` : ''
            }`}
            style={!selected ? {
              backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-subtle)',
            } : undefined}
            aria-label={`RPE ${n}`}
          >
            {n}
          </button>
        );
      })}
    </div>
    <div className="flex justify-between mt-1.5 px-0.5">
      <span className="text-[9px] text-emerald-400/70 font-medium">{t?.('activeSession.rpeEasy') ?? 'Easy'}</span>
      <span className="text-[9px] text-red-400/70 font-medium">{t?.('activeSession.rpeMax') ?? 'Max'}</span>
    </div>
  </div>
));

/* ── Set Note Input ────────────────────────────────────────── */
const SetNoteInput = ({ value, onChange, onClose, t }) => (
  <div
    className="rounded-xl px-3 py-2 mt-1"
    style={{
      backgroundColor: 'var(--color-bg-card)',
      border: '1px solid var(--color-border-subtle)',
    }}
  >
    <div className="flex items-center gap-2">
      <MessageSquare size={12} className="shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
      <input
        type="text"
        maxLength={100}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={t?.('activeSession.notePlaceholder') ?? 'Add a note...'}
        aria-label={t?.('activeSession.notePlaceholder') ?? 'Set note'}
        className="flex-1 text-[12px] bg-transparent focus:outline-none"
        style={{ color: 'var(--color-text-primary)' }}
        autoFocus
      />
      <button
        type="button"
        onClick={onClose}
        className="hover:opacity-80 transition-colors p-1"
        style={{ color: 'var(--color-text-subtle)' }}
        aria-label="Close note"
      >
        <X size={12} />
      </button>
    </div>
  </div>
);

/* ── Stepper (big = weight, small = reps) ─────────────────── */
const Stepper = ({ value, onChange, step = 1, big = false, min = 0, max = 9999, placeholder, inputId, onInputChange }) => {
  const parsedValue = value === '' || value == null ? 0 : Number(value);
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, parsedValue - step))}
        className="rounded-2xl active:scale-95 transition-transform focus:outline-none shrink-0"
        style={{
          width: 52,
          height: 52,
          backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-subtle)',
        }}
        aria-label="Decrease"
      >
        <Minus size={20} strokeWidth={2.6} className="mx-auto" />
      </button>
      <input
        id={inputId}
        type="number"
        inputMode={big ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        value={value === '' ? '' : value}
        onChange={(e) => {
          let v = e.target.value;
          if (v !== '' && (Number(v) < min || Number(v) > max)) return;
          if (v.length > 1 && v[0] === '0' && v[1] !== '.') v = String(Number(v));
          onInputChange ? onInputChange(v) : onChange(Number(v));
        }}
        onFocus={(e) => {
          const el = e.target;
          setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        }}
        placeholder={placeholder}
        className="flex-1 h-[52px] text-center rounded-2xl focus:outline-none tabular-nums"
        style={{
          backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-subtle)',
          fontFamily: DISPLAY_FONT,
          fontSize: big ? 34 : 30,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, parsedValue + step))}
        className="rounded-2xl active:scale-95 transition-transform focus:outline-none shrink-0"
        style={{
          width: 52,
          height: 52,
          backgroundColor: 'var(--color-accent)',
          color: '#001512',
          border: 'none',
        }}
        aria-label="Increase"
      >
        <Plus size={20} strokeWidth={2.6} className="mx-auto" />
      </button>
    </div>
  );
};

/* ── Exercise Header Card — demo thumbnail, muscle, name, meta, swap ── */
const ExerciseHeaderCard = ({ exercise, muscle, videoUrl, knownPR, t, onSwap, onSkip, onRemoveExercise, adjustedRestSeconds }) => {
  const [showVideo, setShowVideo] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const confirmTimerRef = useRef(null);
  const resolvedSrc = videoUrl ? resolveVideoSrc(videoUrl) : null;
  const rest = adjustedRestSeconds ?? exercise.restSeconds ?? 90;
  const restMin = Math.floor(rest / 60);
  const restSec = rest % 60;
  const restStr = `${restMin}:${String(restSec).padStart(2, '0')}`;
  const targetRepsLabel = exercise.targetReps;

  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);

  const handleRemoveClick = () => {
    if (!onRemoveExercise) return;
    if (confirmRemove) {
      if (confirmTimerRef.current) { clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
      setConfirmRemove(false);
      onRemoveExercise();
    } else {
      setConfirmRemove(true);
      confirmTimerRef.current = setTimeout(() => setConfirmRemove(false), 3000);
    }
  };

  // Premium 36x36 icon-tile shared style
  const iconTileStyle = (tone = 'neutral') => ({
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: tone === 'danger'
      ? 'color-mix(in srgb, #EF4444 16%, transparent)'
      : 'var(--color-surface-hover)',
    color: tone === 'danger' ? '#EF4444' : 'var(--color-text-muted)',
    border: `1px solid ${tone === 'danger' ? 'color-mix(in srgb, #EF4444 30%, transparent)' : 'var(--color-border-subtle)'}`,
  });

  return (
    <div
      className="rounded-[22px] overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Expanded video (toggle) */}
      {showVideo && resolvedSrc && (
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
          <video src={resolvedSrc} autoPlay loop muted playsInline className="w-full h-full object-cover" />
          <button
            onClick={(e) => { e.stopPropagation(); setShowVideo(false); }}
            className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full bg-black/70 flex items-center justify-center text-white active:scale-90 transition-transform"
            aria-label="Hide demo"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 p-4">
        {/* Demo thumbnail tile */}
        <button
          type="button"
          onClick={() => videoUrl && setShowVideo(v => !v)}
          disabled={!videoUrl}
          className="relative shrink-0 overflow-hidden rounded-2xl flex items-center justify-center"
          style={{
            width: 68,
            height: 68,
            background: 'repeating-linear-gradient(135deg, #2a2f36 0 2px, #1e232a 2px 8px)',
            opacity: videoUrl ? 1 : 0.55,
            cursor: videoUrl ? 'pointer' : 'default',
          }}
          aria-label={showVideo ? 'Hide demo' : 'Show demo'}
        >
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 30, height: 30, backgroundColor: 'rgba(255,255,255,0.96)' }}
          >
            <Play size={12} fill="#0A0D10" color="#0A0D10" strokeWidth={0} style={{ marginLeft: 1 }} />
          </div>
        </button>

        {/* Info column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="inline-block rounded-full"
              style={{ width: 6, height: 6, backgroundColor: 'var(--color-accent)' }}
            />
            <span
              className="text-[10px] font-bold uppercase truncate"
              style={{ color: 'var(--color-text-muted)', letterSpacing: 1 }}
            >
              {muscle || '\u00A0'}
            </span>
            {knownPR && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                }}
              >
                <Trophy size={9} style={{ color: 'var(--color-accent)' }} />
                <span className="text-[9px] font-bold tabular-nums" style={{ color: 'var(--color-accent)' }}>{knownPR.weight}×{knownPR.reps}</span>
              </span>
            )}
          </div>
          <div
            className="truncate"
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: -0.4,
              lineHeight: 1.1,
            }}
          >
            {exName(exercise)}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {t?.('activeSession.setsTimes', { sets: exercise.targetSets, reps: targetRepsLabel, defaultValue: `${exercise.targetSets} sets × ${targetRepsLabel}` })}
            </span>
            <span className="text-[12px]" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>·</span>
            <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {t?.('activeSession.rest', 'Rest')} {restStr}
            </span>
          </div>
        </div>

        {/* Action cluster — swap/skip + remove (premium icon tiles) */}
        <div className="shrink-0 flex items-center gap-1.5">
          {onSwap ? (
            <button
              onClick={onSwap}
              className="flex items-center justify-center active:scale-95 transition-transform focus:outline-none"
              style={iconTileStyle('neutral')}
              aria-label={t?.('activeSession.swapExercise') ?? 'Swap exercise'}
            >
              <ArrowLeftRight size={16} strokeWidth={2} />
            </button>
          ) : onSkip ? (
            <button
              onClick={onSkip}
              className="flex items-center justify-center active:scale-95 transition-transform focus:outline-none"
              style={iconTileStyle('neutral')}
              aria-label={t?.('activeSession.skipExercise') ?? 'Skip exercise'}
            >
              <SkipForward size={16} strokeWidth={2} />
            </button>
          ) : null}
          {onRemoveExercise && (
            <button
              onClick={handleRemoveClick}
              className="flex items-center justify-center active:scale-95 transition-transform focus:outline-none"
              style={iconTileStyle(confirmRemove ? 'danger' : 'neutral')}
              aria-label={confirmRemove
                ? (t?.('activeSession.confirmRemove', 'Tap again to remove'))
                : (t?.('activeSession.remove', 'Remove'))}
              title={confirmRemove ? t?.('activeSession.confirmRemove', 'Tap again to confirm') : undefined}
            >
              {confirmRemove
                ? <Check size={16} strokeWidth={2.4} />
                : <X size={16} strokeWidth={2.4} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Set Tracker — horizontal cards ────────────────────────── */
const SetTracker = ({ currentSets, activeSetIndex, targetReps, t }) => {
  return (
    <div className="flex gap-2">
      {currentSets.map((s, i) => {
        const isDone = s.completed && !s.skipped;
        const isSkipped = s.skipped;
        const isCurrent = i === activeSetIndex;
        const isUpcoming = !isDone && !isSkipped && !isCurrent;

        const flex = isCurrent ? '2.2 1 0' : '1 1 0';

        if (isCurrent) {
          return (
            <div
              key={i}
              className="rounded-[18px] relative overflow-hidden"
              style={{
                flex,
                minWidth: 0,
                padding: '14px 16px',
                backgroundColor: '#0A0D10',
                border: 'none',
              }}
            >
              <div className="text-[10px] font-bold uppercase" style={{ color: 'rgba(255,255,255,0.55)', letterSpacing: 1 }}>
                {t?.('activeSession.set', 'Set')} {i + 1}
              </div>
              <div
                className="mt-1"
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#fff',
                  letterSpacing: -0.5,
                  lineHeight: 1,
                }}
              >
                {t?.('activeSession.now', 'Now')}
              </div>
              {targetReps && (
                <div
                  className="mt-1 text-[11px] font-semibold"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {t?.('activeSession.targetReps', 'target')} {targetReps}
                </div>
              )}
            </div>
          );
        }

        if (isDone) {
          return (
            <div
              key={i}
              className="rounded-[18px] relative"
              style={{
                flex,
                minWidth: 0,
                padding: '14px 12px',
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
                border: 'none',
              }}
            >
              <div className="text-[10px] font-bold uppercase" style={{ color: 'color-mix(in srgb, var(--color-accent) 85%, #000)', letterSpacing: 1 }}>
                {t?.('activeSession.set', 'Set')} {i + 1}
              </div>
              <div
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'color-mix(in srgb, var(--color-accent) 95%, #000)',
                  letterSpacing: -0.4,
                  marginTop: 4,
                  lineHeight: 1,
                }}
              >
                {s.weight || 0}
                <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 3 }}>{t?.('activeSession.lbShort', 'lb')}</span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'color-mix(in srgb, var(--color-accent) 90%, #000)' }}>
                {s.reps || 0} {t?.('activeSession.repsSuffix', 'reps')}
              </div>
              <div
                className="absolute flex items-center justify-center rounded-full"
                style={{
                  top: 12,
                  right: 12,
                  width: 16,
                  height: 16,
                  backgroundColor: 'color-mix(in srgb, var(--color-accent) 95%, #000)',
                }}
              >
                <Check size={10} color="#fff" strokeWidth={3} />
              </div>
              {s.isPR && (
                <Trophy size={10} className="absolute bottom-2 right-2" style={{ color: 'var(--color-accent)' }} />
              )}
            </div>
          );
        }

        if (isSkipped) {
          return (
            <div
              key={i}
              className="rounded-[18px] opacity-50"
              style={{
                flex,
                minWidth: 0,
                padding: '14px 12px',
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-subtle)', letterSpacing: 1 }}>
                {t?.('activeSession.set', 'Set')} {i + 1}
              </div>
              <div className="text-[11px] mt-1 italic" style={{ color: 'var(--color-text-subtle)' }}>
                {t?.('activeSession.skipped', 'Skipped')}
              </div>
            </div>
          );
        }

        // Upcoming
        return (
          <div
            key={i}
            className="rounded-[18px]"
            style={{
              flex,
              minWidth: 0,
              padding: '14px 12px',
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-subtle)', letterSpacing: 1 }}>
              {t?.('activeSession.set', 'Set')} {i + 1}
            </div>
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--color-text-subtle)',
                letterSpacing: -0.4,
                marginTop: 4,
                lineHeight: 1,
              }}
            >
              —
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {t?.('activeSession.upNext', 'up next')}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LB_PER_KG = 2.20462;

// Round a kg value to a sensible step (0.5 kg) so display values look clean
const roundKgDisplay = (lb) => Math.round((lb / LB_PER_KG) * 2) / 2;

const ExerciseCard = ({
  exercise,
  currentSets,
  knownPR,
  onUpdateSet,
  onToggleComplete,
  onAddSet,
  onRemoveSet,
  onDuplicateLastSet,
  onFillSuggestion,
  onSwap,
  onSkip,
  onAddExercise,
  onRemoveExercise,
  // Display unit for weights — 'lb' (default) or 'kg'. The DB always stores
  // pounds; we convert at the input/display boundary so backend stats stay
  // consistent regardless of what unit the user sees.
  unit = 'lb',
  onToggleUnit,
  // Accept but don't use — keeps parent compat
  showPlateCalc, onTogglePlateCalc, showHeatmap, onToggleHeatmap,
  workedRegions, completedSetsCount, expandedNotesSet, onSetExpandedNotesSet,
  showProgressChart, onShowProgressChart, isPRCheck, livePRs, touchStartXRef,
  // Superset/circuit context
  nextInGroup, groupType,
  adjustedRestSeconds,
}) => {
  const { t } = useTranslation('pages');
  const { user } = useAuth();

  // Track which sets just completed for pulse animation
  const [justCompleted, setJustCompleted] = useState(new Set());
  const prevCompletedRef = useRef(new Set());
  const [openNoteIndex, setOpenNoteIndex] = useState(null);
  const [showRpeForSet, setShowRpeForSet] = useState(null);
  const [userBodyWeight, setUserBodyWeight] = useState(null);
  // Inline edit-past-set affordance — fix #F. Tapping the pencil opens a small
  // weight/reps editor on the row; saving writes back through onUpdateSet.
  const [editingSet, setEditingSet] = useState(null); // { index, weight, reps } | null

  useEffect(() => {
    if (!user) return;
    supabase.from('body_metrics')
      .select('weight_lbs')
      .eq('profile_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.weight_lbs) setUserBodyWeight(parseFloat(data.weight_lbs));
      });
  }, [user]);

  useEffect(() => {
    const nowCompleted = new Set();
    currentSets.forEach((s, i) => { if (s.completed) nowCompleted.add(i); });
    const newlyDone = new Set();
    nowCompleted.forEach(i => { if (!prevCompletedRef.current.has(i)) newlyDone.add(i); });
    prevCompletedRef.current = nowCompleted;
    if (newlyDone.size > 0) {
      setJustCompleted(newlyDone);
      const lastDone = Math.max(...newlyDone);
      setShowRpeForSet(lastDone);
      const to = setTimeout(() => setJustCompleted(new Set()), 350);
      return () => clearTimeout(to);
    }
  }, [currentSets]);

  const videoUrl = exercise.videoUrl || videoMap[exercise.id] || null;
  const localEx = exerciseLibrary.find(e => e.id === exercise.id);
  const rawMuscle = localEx?.muscle || '';
  const muscle = rawMuscle ? t(`muscleGroups.${rawMuscle}`, rawMuscle) : '';
  const isBodyweight = localEx?.equipment === 'Bodyweight';

  // Find current active set
  const activeSetIndex = currentSets.findIndex(s => !s.completed && !s.skipped);
  const allComplete = activeSetIndex === -1;

  const suggestion = exercise.suggestion;
  const suggestedWeight = suggestion?.suggestedWeight;
  const suggestedReps = suggestion?.suggestedReps;

  const historyArr = Array.isArray(exercise.history) ? exercise.history : [];
  const historyForActiveSet = historyArr[activeSetIndex] || historyArr[historyArr.length - 1] || null;

  // Compute delta vs last time for "+X lb" indicator
  const activeSet = activeSetIndex >= 0 ? currentSets[activeSetIndex] : null;
  const currentWeightNum = activeSet ? Number(activeSet.weight) || 0 : 0;
  const currentRepsNum = activeSet ? Number(activeSet.reps) || 0 : 0;
  const lastWeight = historyForActiveSet ? Number(historyForActiveSet.weight) || 0 : null;
  const weightDelta = lastWeight != null && currentWeightNum > 0 ? currentWeightNum - lastWeight : null;

  const handleCompleteSet = () => {
    if (!activeSet) return;
    const rest = adjustedRestSeconds ?? exercise.restSeconds ?? 90;
    onToggleComplete(exercise.id, activeSetIndex, exName(exercise), rest);
  };

  const handleSkipSet = () => {
    if (activeSetIndex < 0) return;
    if (currentSets.length > 1) {
      onRemoveSet(exercise.id, activeSetIndex);
    }
  };

  return (
    <>
      {/* Scrollable content — parent ActiveSession.jsx renders the sticky
          bottom CTA bar, so we no longer need the 120px reserve we used to
          set aside for our own (now removed) fixed Complete Bar. A small
          buffer keeps the last set tile from kissing the parent CTA. */}
      <div className="px-4 pt-3 space-y-3" style={{ paddingBottom: 24 }}>

        {/* ── Exercise header card ── */}
        <ExerciseHeaderCard
          exercise={exercise}
          muscle={muscle}
          videoUrl={videoUrl}
          knownPR={knownPR}
          t={t}
          onSwap={onSwap}
          onSkip={onSkip}
          onRemoveExercise={onRemoveExercise}
          adjustedRestSeconds={adjustedRestSeconds}
        />

        {/* ── Set Tracker ── */}
        <SetTracker
          currentSets={currentSets}
          activeSetIndex={activeSetIndex}
          targetReps={exercise.targetReps}
          t={t}
        />

        {/* ── Input panel ── */}
        {!allComplete && activeSet && (
          <div
            className="rounded-[24px] p-[18px]"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            {/* Last time row */}
            {(historyForActiveSet || suggestedWeight) && (
              <div
                className="flex items-center justify-between mb-3 px-3 py-2 rounded-xl"
                style={{ backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={12} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                    {historyForActiveSet
                      ? (t?.('activeSession.lastTime', 'Last time') || 'Last time')
                      : (t?.('activeSession.suggested', 'Suggested') || 'Suggested')}
                  </span>
                  <span
                    className="text-[12px] font-bold tabular-nums"
                    style={{ color: 'var(--color-text-primary)', fontFamily: DISPLAY_FONT }}
                  >
                    {historyForActiveSet
                      ? `${historyForActiveSet.weight} × ${historyForActiveSet.reps}`
                      : `${suggestedWeight}${suggestedReps ? ` × ${suggestedReps}` : ''}`}
                  </span>
                </div>
                {weightDelta != null && weightDelta !== 0 && (
                  <CoachMark
                    id="active-session-suggestion"
                    title={t('activeSession.smartSuggestions')}
                    description={suggestion?.note === 'first_time_estimated'
                      ? t('activeSession.suggestionFirstTime')
                      : suggestion?.note === 'intra_session_bump'
                        ? t('activeSession.suggestionBump')
                        : t('activeSession.suggestionOverload')}
                    position="bottom"
                    dismissLabel={t('activeSession.gotIt')}
                  >
                    <div className="flex items-center gap-1">
                      <TrendingUp size={12} style={{ color: weightDelta > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)' }} strokeWidth={2.4} />
                      <span
                        className="text-[11px] font-bold"
                        style={{ color: weightDelta > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                      >
                        {weightDelta > 0 ? '+' : ''}{unit === 'kg' ? roundKgDisplay(weightDelta) : weightDelta} {unit}
                      </span>
                    </div>
                  </CoachMark>
                )}
              </div>
            )}

            {/* Weight */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: 1.2, color: 'var(--color-text-muted)' }}>
                  {t('activeSession.weight', 'WEIGHT')}
                </div>
                {/* Unit toggle pill — replaces the static "LB" label so the
                    user can flip lb⇄kg in-session without leaving the screen.
                    Storage stays in lb; conversion happens at the input. */}
                <button
                  type="button"
                  onClick={onToggleUnit}
                  disabled={!onToggleUnit}
                  aria-label={`Switch to ${unit === 'kg' ? 'pounds' : 'kilograms'}`}
                  className="active:scale-95 transition-transform"
                  style={{
                    padding: '3px 9px', borderRadius: 999,
                    background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                    color: 'var(--color-accent)',
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                    textTransform: 'uppercase',
                    cursor: onToggleUnit ? 'pointer' : 'default',
                  }}
                >
                  {unit === 'kg' ? 'KG' : 'LB'}
                </button>
              </div>
              {(() => {
                // Convert stored lb → display unit. Empty string stays empty so
                // the placeholder shows the suggested weight.
                const lbVal = activeSet.weight;
                const displayVal = (unit === 'kg' && lbVal !== '' && lbVal != null)
                  ? String(roundKgDisplay(Number(lbVal)))
                  : lbVal;
                const writeWeight = (v) => {
                  if (v === '' || v == null) {
                    onUpdateSet(exercise.id, activeSetIndex, 'weight', '');
                    return;
                  }
                  const num = parseFloat(v);
                  if (!Number.isFinite(num)) {
                    onUpdateSet(exercise.id, activeSetIndex, 'weight', String(v));
                    return;
                  }
                  const lbStored = unit === 'kg' ? Math.round(num * LB_PER_KG * 10) / 10 : num;
                  onUpdateSet(exercise.id, activeSetIndex, 'weight', String(lbStored));
                };
                const placeholderVal = suggestedWeight
                  ? String(unit === 'kg' ? roundKgDisplay(suggestedWeight) : suggestedWeight)
                  : '0';
                return (
                  <Stepper
                    value={displayVal}
                    onChange={writeWeight}
                    onInputChange={writeWeight}
                    step={unit === 'kg' ? 2.5 : 5}
                    big
                    min={0}
                    max={9999}
                    placeholder={placeholderVal}
                    inputId={`weight-${exercise.id}`}
                  />
                );
              })()}
              {/* BW for bodyweight */}
              {isBodyweight && userBodyWeight && (() => {
                const bwLb = Math.round(userBodyWeight);
                const bwDisplay = unit === 'kg' ? roundKgDisplay(bwLb) : bwLb;
                const isSelected = String(activeSet.weight) === String(bwLb);
                return (
                  <button
                    type="button"
                    onClick={() => onUpdateSet(exercise.id, activeSetIndex, 'weight', String(bwLb))}
                    className="mt-3 mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors focus:outline-none"
                    style={
                      isSelected
                        ? { backgroundColor: 'var(--color-accent)', color: '#001512' }
                        : {
                            backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                            border: '1px solid var(--color-border-subtle)',
                            color: 'var(--color-text-primary)',
                          }
                    }
                  >
                    BW — {bwDisplay} {unit}
                  </button>
                );
              })()}
            </div>

            {/* Divider */}
            <div
              style={{
                height: 1,
                backgroundColor: 'var(--color-border-subtle)',
                margin: '18px 0 14px',
              }}
            />

            {/* Reps */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: 1.2, color: 'var(--color-text-muted)' }}>
                  {t('activeSession.reps', 'REPS')}
                </div>
                <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: 0.4, color: 'var(--color-accent)' }}>
                  {t('activeSession.target', 'TARGET')} {exercise.targetReps}
                </div>
              </div>
              <Stepper
                value={activeSet.reps}
                onChange={(v) => onUpdateSet(exercise.id, activeSetIndex, 'reps', String(v))}
                onInputChange={(v) => onUpdateSet(exercise.id, activeSetIndex, 'reps', v)}
                step={1}
                big={false}
                min={0}
                max={999}
                placeholder={suggestedReps ? String(suggestedReps) : '0'}
                inputId={`reps-${exercise.id}`}
              />
              {/* Quick pick chips */}
              <div className="flex gap-1.5 mt-3">
                {REP_QUICK_SELECT.map((n) => {
                  const selected = String(activeSet.reps) === String(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onUpdateSet(exercise.id, activeSetIndex, 'reps', String(n))}
                      className="flex-1 rounded-[10px] transition-colors focus:outline-none"
                      style={{
                        height: 34,
                        backgroundColor: selected ? '#0A0D10' : 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                        color: selected ? '#fff' : 'var(--color-text-primary)',
                        border: selected ? 'none' : '1px solid var(--color-border-subtle)',
                        fontFamily: DISPLAY_FONT,
                        fontSize: 14,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                      aria-label={`${n} reps`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Completed sets log — RPE + note inputs, PR indicators ── */}
        {currentSets.some(s => s.completed) && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('activeSession.completed', 'Completed')}
            </p>
            {currentSets.map((set, i) => {
              if (!set.completed) return null;
              if (set.skipped) {
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl opacity-50"
                    style={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <SkipForward size={16} className="shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                    <span className="text-[13px] font-semibold flex-1 truncate line-through" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('activeSession.set', 'Set')} {i + 1}
                    </span>
                    <span className="text-[11px] italic" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('activeSession.skipped', 'Skipped')}
                    </span>
                  </div>
                );
              }
              const c = set.rpe ? rpeColor(set.rpe) : null;
              return (
                <div key={i} className="space-y-0">
                  <div
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl${justCompleted.has(i) ? ' animate-set-complete' : ''}`}
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 85%, #000)' }}
                    >
                      <Check size={12} color="#fff" strokeWidth={3} />
                    </div>
                    <span className="text-[13px] font-semibold flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {t('activeSession.set', 'Set')} {i + 1}
                    </span>
                    <span className="text-[13px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                      {unit === 'kg' ? roundKgDisplay(Number(set.weight) || 0) : set.weight} {unit} × {set.reps}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRpeForSet(showRpeForSet === i ? null : i)}
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
                        set.rpe ? `${c.bgFaint} ${c.text} ${c.border}` : ''
                      }`}
                      style={!set.rpe ? {
                        backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                        borderColor: 'var(--color-border-subtle)',
                        color: 'var(--color-text-subtle)',
                      } : undefined}
                      aria-label={set.rpe ? t('activeSession.rpeAria', { value: set.rpe, defaultValue: `RPE ${set.rpe}` }) : t('activeSession.addRpe', 'Add RPE')}
                    >
                      {set.rpe ? `RPE ${set.rpe}` : 'RPE'}
                    </button>
                    {set.isPR && <Trophy size={12} className="shrink-0" style={{ color: 'var(--color-accent)' }} />}
                    <button
                      type="button"
                      onClick={() => setOpenNoteIndex(openNoteIndex === i ? null : i)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0"
                      style={{
                        backgroundColor: set.notes
                          ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                          : 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                        color: set.notes ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                      }}
                      aria-label={t('activeSession.addNote') ?? 'Add note'}
                    >
                      <MessageSquare size={12} />
                    </button>
                    {/* Edit affordance — open inline editor for this past set (fix #F) */}
                    <button
                      type="button"
                      onClick={() => setEditingSet(editingSet?.index === i
                        ? null
                        : { index: i, weight: String(set.weight ?? ''), reps: String(set.reps ?? '') })}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0"
                      style={{
                        backgroundColor: editingSet?.index === i
                          ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                          : 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                        color: editingSet?.index === i ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                      }}
                      aria-label={t('activeSession.editSet', 'Edit set')}
                    >
                      <Pencil size={12} />
                    </button>
                  </div>

                  {/* Inline edit editor for past completed sets (fix #F) */}
                  {editingSet?.index === i && (
                    <div className="mt-1.5 animate-fade-in rounded-2xl p-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--color-text-subtle)' }}>
                        {t('activeSession.editSetTitle', { n: i + 1, defaultValue: `Edit set ${i + 1}` })}
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold uppercase block mb-1" style={{ letterSpacing: 1.2, color: 'var(--color-text-muted)' }}>
                            {t('activeSession.weight', 'WEIGHT')}
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={editingSet.weight}
                            onChange={(e) => setEditingSet({ ...editingSet, weight: e.target.value })}
                            className="w-full text-[14px] font-bold tabular-nums rounded-lg px-3 py-2 focus:outline-none"
                            style={{
                              backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                              border: '1px solid var(--color-border-subtle)',
                              color: 'var(--color-text-primary)',
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-bold uppercase block mb-1" style={{ letterSpacing: 1.2, color: 'var(--color-text-muted)' }}>
                            {t('activeSession.reps', 'REPS')}
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={editingSet.reps}
                            onChange={(e) => setEditingSet({ ...editingSet, reps: e.target.value })}
                            className="w-full text-[14px] font-bold tabular-nums rounded-lg px-3 py-2 focus:outline-none"
                            style={{
                              backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                              border: '1px solid var(--color-border-subtle)',
                              color: 'var(--color-text-primary)',
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={() => setEditingSet(null)}
                          className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                          style={{
                            backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                            color: 'var(--color-text-subtle)',
                            border: '1px solid var(--color-border-subtle)',
                          }}
                        >
                          {t('activeSession.cancel', 'Cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Push edits back through the parent setter. Empty
                            // string falls back to the prior value so we never
                            // accidentally null out a logged set.
                            const w = editingSet.weight === '' ? set.weight : editingSet.weight;
                            const r = editingSet.reps === '' ? set.reps : editingSet.reps;
                            onUpdateSet(exercise.id, i, 'weight', String(w));
                            onUpdateSet(exercise.id, i, 'reps', String(r));
                            setEditingSet(null);
                          }}
                          className="flex-1 py-2 rounded-lg text-[12px] font-bold transition-colors"
                          style={{ backgroundColor: 'var(--color-accent)', color: '#001512' }}
                        >
                          {t('activeSession.save', 'Save')}
                        </button>
                      </div>
                    </div>
                  )}

                  {showRpeForSet === i && (
                    <div className="mt-1.5 animate-fade-in">
                      <RpeSelector value={set.rpe} onChange={(v) => onUpdateSet(exercise.id, i, 'rpe', v)} t={t} />
                    </div>
                  )}
                  {openNoteIndex === i && (
                    <div className="animate-fade-in">
                      <SetNoteInput
                        value={set.notes}
                        onChange={(v) => onUpdateSet(exercise.id, i, 'notes', v)}
                        onClose={() => setOpenNoteIndex(null)}
                        t={t}
                      />
                    </div>
                  )}
                  {set.notes && openNoteIndex !== i && (
                    <p className="text-[11px] italic pl-9 mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>
                      {set.notes}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Add set (when all complete) ── */}
        {allComplete && (
          <button
            onClick={() => onAddSet(exercise.id)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-colors focus:outline-none"
            style={{
              border: '1px dashed var(--color-border-subtle)',
              color: 'var(--color-text-subtle)',
              minHeight: 44,
            }}
          >
            <Plus size={16} />
            <span className="text-[13px] font-semibold">{t('activeSession.addSet')}</span>
          </button>
        )}

        {/* ── Next-in-group indicator ── */}
        {nextInGroup && groupType && !allComplete && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{
              backgroundColor: groupType === 'superset'
                ? 'rgba(109, 95, 219, 0.08)'
                : 'rgba(59, 130, 246, 0.08)',
              border: `1px solid ${groupType === 'superset' ? 'rgba(109, 95, 219, 0.25)' : 'rgba(59, 130, 246, 0.25)'}`,
            }}
          >
            <div
              className="w-0.5 h-4 rounded-full"
              style={{
                backgroundColor: groupType === 'superset' ? 'rgba(109, 95, 219, 0.5)' : 'rgba(59, 130, 246, 0.5)',
              }}
            />
            <span
              className="text-[11px] font-semibold"
              style={{ color: groupType === 'superset' ? '#6D5FDB' : '#60A5FA' }}
            >
              {t('activeSession.nextInSuperset', { name: exName(nextInGroup) })}
            </span>
          </div>
        )}
      </div>

      {/* The fixed-bottom Complete Bar that used to live here was duplicating
          the sticky CTA the parent ActiveSession.jsx already renders, which
          made the "Complete set" button appear behind the set list and showed
          two identical bars stacked at the bottom (fix #3). Parent owns the
          single source of truth now — keep this component focused on the
          scrollable exercise body. */}
    </>
  );
};

// memo: ActiveSession ticks the elapsed timer every second, which previously
// re-rendered the entire ExerciseCard tree on every tick. Equality skips that
// when none of the props changed.
export default memo(ExerciseCard);

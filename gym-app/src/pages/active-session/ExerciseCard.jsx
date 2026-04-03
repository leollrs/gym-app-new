import React, { useMemo, useState, useEffect, useRef } from 'react';
import { CheckCircle, Trophy, Plus, Clock, Play, X, MessageSquare, ArrowLeftRight } from 'lucide-react';
import { exercises as exerciseLibrary } from '../../data/exercises';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import CoachMark from '../../components/CoachMark';
import { useTranslation } from 'react-i18next';
import { exName, exInstructions } from '../../lib/exerciseName';

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

const REP_QUICK_SELECT = [6, 8, 10, 12, 15];

/* ── RPE color helpers ─────────────────────────────────────── */
const rpeColor = (v) => {
  if (v <= 3) return { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30', bgFaint: 'bg-emerald-500/10' };
  if (v <= 6) return { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30', bgFaint: 'bg-yellow-500/10' };
  if (v <= 8) return { bg: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-500/30', bgFaint: 'bg-orange-500/10' };
  return { bg: 'bg-red-500', text: 'text-red-400', border: 'border-red-500/30', bgFaint: 'bg-red-500/10' };
};

const rpeLabel = (v, t) => {
  if (v <= 3) return t?.('activeSession.rpeEasy') ?? 'Easy';
  if (v <= 6) return t?.('activeSession.rpeModerate') ?? 'Moderate';
  if (v <= 8) return t?.('activeSession.rpeHard') ?? 'Hard';
  return t?.('activeSession.rpeMax') ?? 'Max';
};

/* ── RPE Selector (horizontal 1–10 circles) ───────────────── */
const RpeSelector = React.memo(({ value, onChange, t }) => (
  <div className="rounded-2xl border border-white/[0.06] px-3 py-3" style={{ background: 'var(--color-bg-card)' }}>
    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--color-text-subtle)' }}>
      {t?.('activeSession.rpeLabel') ?? 'RPE — How hard was it?'}
    </p>
    <div className="flex items-center justify-between gap-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
        const c = rpeColor(n);
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(selected ? null : n)}
            className={`w-[28px] h-[28px] rounded-full text-[11px] font-bold transition-all duration-150 flex items-center justify-center ${
              selected
                ? `${c.bg} text-white scale-110 shadow-lg`
                : 'bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12]'
            }`}
            style={!selected ? { color: 'var(--color-text-subtle)' } : undefined}
            aria-label={`RPE ${n}`}
          >
            {n}
          </button>
        );
      })}
    </div>
    {/* Labels row */}
    <div className="flex justify-between mt-1.5 px-0.5">
      <span className="text-[9px] text-emerald-400/70 font-medium w-[84px]">{t?.('activeSession.rpeEasy') ?? 'Easy'}</span>
      <span className="text-[9px] text-yellow-400/70 font-medium w-[84px] text-center">{t?.('activeSession.rpeModerate') ?? 'Moderate'}</span>
      <span className="text-[9px] text-orange-400/70 font-medium w-[56px] text-center">{t?.('activeSession.rpeHard') ?? 'Hard'}</span>
      <span className="text-[9px] text-red-400/70 font-medium w-[56px] text-right">{t?.('activeSession.rpeMax') ?? 'Max'}</span>
    </div>
  </div>
));

/* ── Set Note Input ────────────────────────────────────────── */
const SetNoteInput = ({ value, onChange, onClose, t }) => (
  <div className="rounded-xl border border-white/[0.06] px-3 py-2 mt-1" style={{ background: 'var(--color-bg-card)' }}>
    <div className="flex items-center gap-2">
      <MessageSquare size={12} className="shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
      <input
        type="text"
        maxLength={100}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={t?.('activeSession.notePlaceholder') ?? 'Add a note... (e.g. "felt easy", "elbow pain")'}
        className="flex-1 text-[12px] bg-transparent placeholder:text-[#4B5563] focus:outline-none"
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

/* ── Exercise Info Card (video hidden by default) ─────────────── */
const ExerciseInfoCard = ({ exercise, muscle, videoUrl, knownPR, t, onSwap }) => {
  const [showVideo, setShowVideo] = useState(false);
  const resolvedSrc = showVideo ? resolveVideoSrc(videoUrl) : null;

  return (
    <div className="rounded-2xl border border-white/[0.06] overflow-hidden" style={{ background: 'var(--color-bg-card)' }}>
      {/* Expanded: full video */}
      {showVideo && resolvedSrc && (
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
          <video
            src={resolvedSrc}
            autoPlay loop muted playsInline
            className="w-full h-full object-cover"
          />
          <button
            onClick={(e) => { e.stopPropagation(); setShowVideo(false); }}
            className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full bg-black/70 flex items-center justify-center text-white active:scale-90 transition-transform"
            aria-label="Hide demo"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
      )}
      {/* Exercise details — centered layout */}
      <div className="px-4 py-3.5 text-center">
        <h2 className="text-[18px] font-black leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
          {exName(exercise)}
        </h2>
        <div className="flex items-center justify-center gap-2 mt-1">
          {muscle && (
            <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{muscle}</span>
          )}
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>•</span>
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            {exercise.targetSets} sets × {exercise.targetReps} reps
          </span>
          {knownPR && (
            <>
              <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>•</span>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#D4AF37]/10 border border-[#D4AF37]/20">
                <Trophy size={10} className="text-[#D4AF37]" />
                <span className="text-[10px] font-bold text-[#D4AF37]">{knownPR.weight}×{knownPR.reps}</span>
              </div>
            </>
          )}
        </div>
        {/* Action buttons — centered below */}
        <div className="flex items-center justify-center gap-2 mt-3">
          {videoUrl && (
            <button
              onClick={() => setShowVideo(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-colors active:scale-95"
            >
              {showVideo ? (
                <>
                  <X size={13} style={{ color: 'var(--color-text-primary)' }} />
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t?.('activeSession.hide') ?? 'Hide'}</span>
                </>
              ) : (
                <>
                  <Play size={13} style={{ color: 'var(--color-text-primary)' }} fill="var(--color-text-primary)" strokeWidth={0} />
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t?.('activeSession.demo') ?? 'Demo'}</span>
                </>
              )}
            </button>
          )}
          {onSwap && (
            <button
              onClick={onSwap}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.06] hover:border-[#D4AF37]/30 transition-colors active:scale-95"
              aria-label={t?.('activeSession.swapExercise') ?? 'Swap exercise'}
            >
              <ArrowLeftRight size={13} style={{ color: 'var(--color-text-primary)' }} />
              <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t?.('activeSession.swap') ?? 'Swap'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

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
  // Track which completed set has an open note input
  const [openNoteIndex, setOpenNoteIndex] = useState(null);
  // Show RPE selector for the most recently completed set
  const [showRpeForSet, setShowRpeForSet] = useState(null);
  // User body weight for BW button
  const [userBodyWeight, setUserBodyWeight] = useState(null);

  // Fetch user's latest body weight for bodyweight exercises
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
      // Auto-show RPE selector for the newly completed set
      const lastDone = Math.max(...newlyDone);
      setShowRpeForSet(lastDone);
      const t = setTimeout(() => setJustCompleted(new Set()), 350);
      return () => clearTimeout(t);
    }
  }, [currentSets]);
  // DB video takes priority over local fallback
  const videoUrl = exercise.videoUrl || videoMap[exercise.id] || null;
  const localEx = exerciseLibrary.find(e => e.id === exercise.id);
  const muscle = localEx?.muscle || '';
  const isBodyweight = localEx?.equipment === 'Bodyweight';

  // Find the current active set (first incomplete)
  const activeSetIndex = currentSets.findIndex(s => !s.completed);
  const completedCount = currentSets.filter(s => s.completed).length;
  const totalSetsForExercise = currentSets.length;
  const allComplete = activeSetIndex === -1;

  // Suggestion
  const suggestion = exercise.suggestion;
  const suggestedWeight = suggestion?.suggestedWeight;
  const suggestedReps = suggestion?.suggestedReps;

  // Last session data for active set
  const historyForActiveSet = exercise.history?.[activeSetIndex] || exercise.history?.[exercise.history.length - 1] || null;

  return (
    <div className="px-4 py-4 space-y-6">

      {/* ── EXERCISE INFO CARD ────────────────────────────────── */}
      <ExerciseInfoCard
        exercise={exercise}
        muscle={muscle}
        videoUrl={videoUrl}
        knownPR={knownPR}
        t={t}
        onSwap={onSwap}
      />

      {/* ── MAIN INSTRUCTION ──────────────────────────────────── */}
      <div className="text-center py-2">
        {allComplete ? (
          <>
            <p className="text-[24px] font-black text-emerald-400 tracking-tight truncate">
              {t('activeSession.allSetsDone')}
            </p>
            <p className="text-[14px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('activeSession.swipeToNext')}
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-semibold uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('activeSession.currentSet')}
            </p>
            <p className="text-[24px] font-black tracking-tight leading-none" style={{ color: 'var(--color-text-primary)' }}>
              {t('activeSession.set')} {activeSetIndex + 1}
              <span style={{ color: 'var(--color-text-muted)' }}> / {totalSetsForExercise}</span>
            </p>
            <p className="text-[15px] text-[#D4AF37] font-semibold mt-2">
              {t('activeSession.target')}: {exercise.targetReps} {t('activeSession.reps')}
            </p>
            {totalSetsForExercise > 1 && (
              <button
                type="button"
                onClick={() => onRemoveSet(exercise.id, activeSetIndex)}
                className="mt-3 text-[12px] font-medium hover:text-red-400 transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('activeSession.skipThisSet')}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── LOGGING SECTION (only for active set) ─────────────── */}
      {!allComplete && activeSetIndex >= 0 && (() => {
        const set = currentSets[activeSetIndex];
        const activeExId = exercise.id;

        return (
          <div className="space-y-4">

            {/* Last session reference + suggestion */}
            {(historyForActiveSet || suggestedWeight) && (
              <div className="text-center">
                {historyForActiveSet && (
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {t('activeSession.lastSession')}: <span className="font-semibold" style={{ color: 'var(--color-text-muted)' }}>{historyForActiveSet.reps} reps @ {historyForActiveSet.weight} lb</span>
                  </p>
                )}
                {suggestedWeight && (
                  <CoachMark
                    id="active-session-suggestion"
                    title="Smart Suggestions"
                    description={suggestion?.note === 'first_time_estimated'
                      ? "Estimated starting weight based on your body weight, fitness level, and goal."
                      : suggestion?.note === 'intra_session_bump'
                        ? "You crushed the last set! Try bumping up the weight."
                        : "This is your target weight based on your last performance and progressive overload."}
                    position="bottom"
                  >
                    <p className="text-[11px] text-[#D4AF37]/70 mt-0.5">
                      {t('activeSession.suggested')}: <span className="font-semibold text-[#D4AF37]">{suggestedWeight} lb</span>
                      {suggestion?.note === 'intra_session_bump' && (
                        <span className="ml-1 text-emerald-400">&#x2191;</span>
                      )}
                    </p>
                  </CoachMark>
                )}
              </div>
            )}

            {/* Weight input */}
            <div className="rounded-2xl border border-white/[0.06] p-4" style={{ background: 'var(--color-bg-card)' }}>
              <label htmlFor={`weight-${activeExId}`} className="text-[11px] font-semibold uppercase tracking-wider block mb-2" style={{ color: 'var(--color-text-subtle)' }}>
                {t('activeSession.weightLbs')}
              </label>
              <input
                id={`weight-${activeExId}`}
                type="number"
                inputMode="decimal"
                min="0"
                max="9999"
                value={set.weight}
                onChange={e => {
                  let v = e.target.value;
                  if (v !== '' && (Number(v) < 0 || Number(v) > 9999)) return;
                  // Strip leading zeros (e.g. "01" → "1") but allow plain "0"
                  if (v.length > 1 && v[0] === '0' && v[1] !== '.') v = String(Number(v));
                  onUpdateSet(activeExId, activeSetIndex, 'weight', v);
                }}
                placeholder={suggestedWeight ? String(suggestedWeight) : '0'}
                className="w-full text-center text-[24px] font-black bg-transparent tabular-nums focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
                style={{ color: 'var(--color-text-primary)' }}
              />
              {/* BW (bodyweight) button for bodyweight exercises */}
              {isBodyweight && userBodyWeight && (
                <button
                  type="button"
                  onClick={() => onUpdateSet(activeExId, activeSetIndex, 'weight', String(Math.round(userBodyWeight)))}
                  className={`mt-2 mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                    String(set.weight) === String(Math.round(userBodyWeight))
                      ? 'bg-[#D4AF37] text-black'
                      : 'bg-white/[0.06] border border-white/[0.06] hover:border-[#D4AF37]/30'
                  }`}
                  style={String(set.weight) !== String(Math.round(userBodyWeight)) ? { color: 'var(--color-text-primary)' } : undefined}
                >
                  BW — {Math.round(userBodyWeight)} lb
                </button>
              )}
            </div>

            {/* Reps input + quick select */}
            <div className="rounded-2xl border border-white/[0.06] p-4" style={{ background: 'var(--color-bg-card)' }}>
              <label htmlFor={`reps-${activeExId}`} className="text-[11px] font-semibold uppercase tracking-wider block mb-2" style={{ color: 'var(--color-text-subtle)' }}>
                {t('activeSession.repsCompleted')}
              </label>
              <input
                id={`reps-${activeExId}`}
                type="number"
                inputMode="numeric"
                min="0"
                max="999"
                value={set.reps}
                onChange={e => {
                  let v = e.target.value;
                  if (v !== '' && (Number(v) < 0 || Number(v) > 999)) return;
                  // Strip leading zeros (e.g. "01" → "1") but allow plain "0"
                  if (v.length > 1 && v[0] === '0' && v[1] !== '.') v = String(Number(v));
                  onUpdateSet(activeExId, activeSetIndex, 'reps', v);
                }}
                placeholder={suggestedReps ? String(suggestedReps) : '0'}
                className="w-full text-center text-[24px] font-black bg-transparent tabular-nums focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
                style={{ color: 'var(--color-text-primary)' }}
              />
              {/* Quick select */}
              <div className="flex items-center justify-center gap-2 mt-3">
                {REP_QUICK_SELECT.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onUpdateSet(activeExId, activeSetIndex, 'reps', String(r))}
                    aria-label={`${r} reps`}
                    className={`min-w-[44px] min-h-[44px] rounded-lg text-[13px] font-bold transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                      String(set.reps) === String(r)
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-white/[0.04] border border-white/[0.06]'
                    }`}
                    style={String(set.reps) !== String(r) ? { color: 'var(--color-text-muted)' } : undefined}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── COMING UP NEXT ────────────────────────────────────── */}
      {!allComplete && (
        <div className="rounded-2xl border border-white/[0.06] px-4 py-3" style={{ background: 'var(--color-bg-card)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('activeSession.comingUpNext')}</p>
          <div className="flex items-center gap-3">
            {nextInGroup && groupType ? (
              <>
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
                  groupType === 'superset' ? 'bg-purple-500/10' : 'bg-blue-500/10'
                }`}>
                  <Play size={12} className={groupType === 'superset' ? 'text-purple-400' : 'text-blue-400'} fill="currentColor" strokeWidth={0} />
                  <span className={`text-[12px] font-semibold ${groupType === 'superset' ? 'text-purple-400' : 'text-blue-400'}`}>
                    {groupType === 'superset' ? t('activeSession.noRestSuperset') : t('activeSession.noRestCircuit')}
                  </span>
                </div>
              </>
            ) : (
              <>
                {(() => {
                  const rest = adjustedRestSeconds ?? exercise.restSeconds ?? 90;
                  return (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06]">
                      <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {t('activeSession.rest')} {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}
                      </span>
                    </div>
                  );
                })()}
                {activeSetIndex < totalSetsForExercise - 1 ? (
                  <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                    → {t('activeSession.set')} {activeSetIndex + 2}
                  </span>
                ) : (
                  <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                    → {t('activeSession.nextExercise')}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── COMPLETED SETS LOG ─────────────────────────────────── */}
      {completedCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('activeSession.completed')}
          </p>
          {currentSets.map((set, i) => {
            if (!set.completed) return null;
            const c = set.rpe ? rpeColor(set.rpe) : null;
            return (
              <div key={i} className="space-y-0">
                {/* Set row */}
                <div
                  className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/10${justCompleted.has(i) ? ' animate-set-complete' : ''}`}
                >
                  <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                  <span className="text-[13px] font-semibold flex-1 min-w-0 truncate" style={{ color: 'var(--color-text-primary)' }}>
                    Set {i + 1}
                  </span>
                  <span className="text-[13px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    {set.weight} lb × {set.reps}
                  </span>
                  {/* RPE badge */}
                  {set.rpe && (
                    <button
                      type="button"
                      onClick={() => setShowRpeForSet(showRpeForSet === i ? null : i)}
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${c.bgFaint} ${c.text} ${c.border} border`}
                      aria-label={`RPE ${set.rpe}`}
                    >
                      RPE {set.rpe}
                    </button>
                  )}
                  {set.isPR && (
                    <Trophy size={12} className="text-[#D4AF37] shrink-0" />
                  )}
                  {/* Note icon toggle */}
                  <button
                    type="button"
                    onClick={() => setOpenNoteIndex(openNoteIndex === i ? null : i)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                      set.notes ? 'bg-[#D4AF37]/10 text-[#D4AF37]' : 'bg-white/[0.04] hover:opacity-80'
                    }`}
                    style={!set.notes ? { color: 'var(--color-text-subtle)' } : undefined}
                    aria-label={t('activeSession.addNote') ?? 'Add note'}
                  >
                    <MessageSquare size={12} />
                  </button>
                </div>

                {/* RPE selector — shown for the most recently completed set or when tapped */}
                {showRpeForSet === i && (
                  <div className="mt-1.5 animate-fade-in">
                    <RpeSelector
                      value={set.rpe}
                      onChange={(v) => onUpdateSet(exercise.id, i, 'rpe', v)}
                      t={t}
                    />
                  </div>
                )}

                {/* Note input */}
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

                {/* Show existing note text below the set row */}
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

      {/* ── ADD SET ────────────────────────────────────────────── */}
      {allComplete && (
        <button
          onClick={() => onAddSet(exercise.id)}
          className="w-full flex items-center justify-center gap-2 min-h-[44px] py-3 rounded-2xl border border-dashed border-white/[0.1] hover:border-[#D4AF37]/30 hover:text-[#D4AF37] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <Plus size={16} />
          <span className="text-[13px] font-semibold">{t('activeSession.addSet')}</span>
        </button>
      )}
    </div>
  );
};

export default ExerciseCard;

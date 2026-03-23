import React, { useMemo, useState, useEffect, useRef } from 'react';
import { CheckCircle, Trophy, Plus, Clock, Play, X } from 'lucide-react';
import { exercises as exerciseLibrary } from '../../data/exercises';
import { supabase } from '../../lib/supabase';
import CoachMark from '../../components/CoachMark';
import { useTranslation } from 'react-i18next';

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

/* ── Exercise Info Card (video hidden by default) ─────────────── */
const ExerciseInfoCard = ({ exercise, muscle, videoUrl, knownPR, t }) => {
  const [showVideo, setShowVideo] = useState(false);
  const resolvedSrc = showVideo ? resolveVideoSrc(videoUrl) : null;

  return (
    <div className="rounded-2xl bg-[#0F172A] border border-white/[0.06] overflow-hidden">
      {/* Expanded: full video */}
      {showVideo && resolvedSrc && (
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
          <video
            src={resolvedSrc}
            autoPlay loop muted playsInline
            className="w-full h-full object-cover"
          />
          {/* Close button — high z-index, large tap target */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowVideo(false); }}
            className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full bg-black/70 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform"
            aria-label="Hide demo"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0F172A] to-transparent z-10" />
        </div>
      )}
      {/* Exercise details row */}
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[18px] font-black text-[#E5E7EB] leading-tight">
              {exercise.name}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {muscle && (
                <span className="text-[12px] text-[#9CA3AF] font-medium">{muscle}</span>
              )}
              <span className="text-[12px] text-[#4B5563]">•</span>
              <span className="text-[12px] text-[#6B7280]">
                {exercise.targetSets} sets × {exercise.targetReps} reps
              </span>
            </div>
          </div>

          {/* Right side: PR badge or Demo button */}
          <div className="flex items-center gap-2 shrink-0">
            {knownPR && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/20">
                <Trophy size={11} className="text-[#D4AF37]" />
                <span className="text-[10px] font-bold text-[#D4AF37]">
                  {knownPR.weight}×{knownPR.reps}
                </span>
              </div>
            )}
            {videoUrl && (
              <button
                onClick={() => setShowVideo(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] transition-colors active:scale-95"
              >
                {showVideo ? (
                  <>
                    <X size={12} className="text-[#9CA3AF]" />
                    <span className="text-[11px] font-semibold text-[#9CA3AF]">{t?.('activeSession.hide') ?? 'Hide'}</span>
                  </>
                ) : (
                  <>
                    <Play size={12} className="text-[#9CA3AF]" fill="#9CA3AF" strokeWidth={0} />
                    <span className="text-[11px] font-semibold text-[#9CA3AF]">{t?.('activeSession.demo') ?? 'Demo'}</span>
                  </>
                )}
              </button>
            )}
          </div>
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
  // Accept but don't use — keeps parent compat
  showPlateCalc, onTogglePlateCalc, showHeatmap, onToggleHeatmap,
  workedRegions, completedSetsCount, expandedNotesSet, onSetExpandedNotesSet,
  showProgressChart, onShowProgressChart, isPRCheck, livePRs, touchStartXRef,
}) => {
  const { t } = useTranslation('pages');
  // Track which sets just completed for pulse animation
  const [justCompleted, setJustCompleted] = useState(new Set());
  const prevCompletedRef = useRef(new Set());

  useEffect(() => {
    const nowCompleted = new Set();
    currentSets.forEach((s, i) => { if (s.completed) nowCompleted.add(i); });
    const newlyDone = new Set();
    nowCompleted.forEach(i => { if (!prevCompletedRef.current.has(i)) newlyDone.add(i); });
    prevCompletedRef.current = nowCompleted;
    if (newlyDone.size > 0) {
      setJustCompleted(newlyDone);
      const t = setTimeout(() => setJustCompleted(new Set()), 350);
      return () => clearTimeout(t);
    }
  }, [currentSets]);
  // DB video takes priority over local fallback
  const videoUrl = exercise.videoUrl || videoMap[exercise.id] || null;
  const localEx = exerciseLibrary.find(e => e.id === exercise.id);
  const muscle = localEx?.muscle || '';

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
      />

      {/* ── MAIN INSTRUCTION ──────────────────────────────────── */}
      <div className="text-center py-2">
        {allComplete ? (
          <>
            <p className="text-[32px] font-black text-emerald-400 tracking-tight">
              {t('activeSession.allSetsDone')}
            </p>
            <p className="text-[14px] text-[#6B7280] mt-1">
              {t('activeSession.swipeToNext')}
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-[0.15em] mb-1">
              {t('activeSession.currentSet')}
            </p>
            <p className="text-[40px] font-black text-[#E5E7EB] tracking-tight leading-none">
              {t('activeSession.set')} {activeSetIndex + 1}
              <span className="text-[#4B5563]"> / {totalSetsForExercise}</span>
            </p>
            <p className="text-[15px] text-[#D4AF37] font-semibold mt-2">
              {t('activeSession.target')}: {exercise.targetReps} {t('activeSession.reps')}
            </p>
            {totalSetsForExercise > 1 && (
              <button
                type="button"
                onClick={() => onRemoveSet(exercise.id, activeSetIndex)}
                className="mt-3 text-[12px] font-medium text-[#4B5563] hover:text-red-400 transition-colors"
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

            {/* Last session reference */}
            {historyForActiveSet && (
              <div className="text-center">
                <p className="text-[11px] text-[#4B5563]">
                  {t('activeSession.lastSession')}: <span className="text-[#9CA3AF] font-semibold">{historyForActiveSet.reps} reps @ {historyForActiveSet.weight} lb</span>
                </p>
                {suggestedWeight && (
                  <CoachMark
                    id="active-session-suggestion"
                    title="Smart Suggestions"
                    description="This is your target weight based on your last performance and progressive overload."
                    position="bottom"
                  >
                    <p className="text-[11px] text-[#D4AF37]/70 mt-0.5">
                      {t('activeSession.suggested')}: <span className="font-semibold text-[#D4AF37]">{suggestedWeight} lb</span>
                    </p>
                  </CoachMark>
                )}
              </div>
            )}

            {/* Weight input */}
            <div className="rounded-2xl bg-[#0F172A] border border-white/[0.06] p-4">
              <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider block mb-2">
                {t('activeSession.weightLbs')}
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={set.weight}
                onChange={e => onUpdateSet(activeExId, activeSetIndex, 'weight', e.target.value)}
                placeholder={suggestedWeight ? String(suggestedWeight) : '0'}
                className="w-full text-center text-[32px] font-black text-[#E5E7EB] bg-transparent outline-none placeholder:text-[#4B5563] tabular-nums"
              />
            </div>

            {/* Reps input + quick select */}
            <div className="rounded-2xl bg-[#0F172A] border border-white/[0.06] p-4">
              <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider block mb-2">
                {t('activeSession.repsCompleted')}
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={set.reps}
                onChange={e => onUpdateSet(activeExId, activeSetIndex, 'reps', e.target.value)}
                placeholder={suggestedReps ? String(suggestedReps) : '0'}
                className="w-full text-center text-[32px] font-black text-[#E5E7EB] bg-transparent outline-none placeholder:text-[#4B5563] tabular-nums"
              />
              {/* Quick select */}
              <div className="flex items-center justify-center gap-2 mt-3">
                {REP_QUICK_SELECT.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onUpdateSet(activeExId, activeSetIndex, 'reps', String(r))}
                    className={`w-10 h-8 rounded-lg text-[13px] font-bold transition-colors ${
                      String(set.reps) === String(r)
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-white/[0.04] text-[#9CA3AF] border border-white/[0.06]'
                    }`}
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
        <div className="rounded-2xl bg-[#0F172A]/60 border border-white/[0.04] px-4 py-3">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-2">{t('activeSession.comingUpNext')}</p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04]">
              <Clock size={12} className="text-[#6B7280]" />
              <span className="text-[12px] font-semibold text-[#9CA3AF]">
                REST {exercise.restSeconds ? `${Math.floor(exercise.restSeconds / 60)}:${String(exercise.restSeconds % 60).padStart(2, '0')}` : '1:30'}
              </span>
            </div>
            {activeSetIndex < totalSetsForExercise - 1 ? (
              <span className="text-[12px] text-[#6B7280]">
                → Set {activeSetIndex + 2}
              </span>
            ) : (
              <span className="text-[12px] text-[#6B7280]">
                → {t('activeSession.nextExercise')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── COMPLETED SETS LOG ─────────────────────────────────── */}
      {completedCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider px-1">
            {t('activeSession.completed')}
          </p>
          {currentSets.map((set, i) => {
            if (!set.completed) return null;
            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/10${justCompleted.has(i) ? ' animate-set-complete' : ''}`}
              >
                <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                <span className="text-[13px] font-semibold text-[#E5E7EB] flex-1">
                  Set {i + 1}
                </span>
                <span className="text-[13px] text-[#9CA3AF] tabular-nums">
                  {set.weight} lb × {set.reps}
                </span>
                {set.isPR && (
                  <Trophy size={12} className="text-[#D4AF37]" />
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
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-white/[0.1] text-[#6B7280] hover:border-[#D4AF37]/30 hover:text-[#D4AF37] transition-colors"
        >
          <Plus size={16} />
          <span className="text-[13px] font-semibold">{t('activeSession.addSet')}</span>
        </button>
      )}
    </div>
  );
};

export default ExerciseCard;

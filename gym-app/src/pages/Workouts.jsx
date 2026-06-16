import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Dumbbell, Clock, ChevronRight, ChevronLeft, Pencil, X, Trash2, CheckCircle2, Circle, Lock,
  Calendar, Zap, Heart, BookOpen, AlertTriangle, Activity, Target, Info, RotateCcw,
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { useCachedState, hasCachedState, useSyncedCachedState } from '../hooks/useCachedState';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import GenerateWorkoutModal from '../components/GenerateWorkoutModal';
import CreateRoutineModal from '../components/CreateRoutineModal';
import MemberProgramBuilder from '../components/MemberProgramBuilder';
import TrainerPlanSection from '../components/TrainerPlanSection';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { timeAgo } from '../lib/dateUtils';
// programTemplates + PROGRAM_CATEGORIES loaded dynamically to avoid 396KB eager bundle cost
import { exercises as exerciseLibrary } from '../data/exercises';
import { useTranslation } from 'react-i18next';
import { exName, localizeRoutineName } from '../lib/exerciseName';
import { translateCreativeName } from '../lib/programNaming';
import { getCurrentWeekClamped, getTotalProgramWeeks } from '../lib/programWeek';
import { regenerateMemberProgram, reactivatePersonalProgram } from '../lib/personalProgramService';
import { clearCache } from '../lib/queryCache';
import { loadAdaptationSuggestions, dismissAdaptationSuggestions } from '../lib/programAdaptation';
import { usePostHog } from '@posthog/react';
import { programImageUrl } from '../lib/imageUrl';
import { CLASS_COVERS } from './admin/components/CoverPreview';
import { classImageUrl } from '../lib/classImageUrl';
import { getExerciseReasoning } from '../lib/exerciseReasoning';
import { selectInBatches } from '../lib/churn/batchedSelect';

// Expandable description text — shows 2 lines with "Read more" toggle
const ExpandableText = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('pages');
  if (!text) return null;
  return (
    <div className="mt-2">
      <p className={`text-[13px] leading-relaxed ${expanded ? '' : 'line-clamp-2'}`} style={{ color: 'var(--color-text-subtle)' }}>
        {text}
      </p>
      {text.length > 120 && (
        <button onClick={() => setExpanded(!expanded)} className="text-[12px] font-semibold mt-1 min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded" style={{ color: 'var(--color-accent)' }}>
          {expanded ? t('exerciseLibrary.showLess', 'Show less') : t('exerciseLibrary.readMore', 'Read more')}
        </button>
      )}
    </div>
  );
};

// Local fallback map (English only — used until DB data loads)
const localExerciseMap = (() => {
  const map = {};
  exerciseLibrary.forEach(e => { map[e.id] = e; });
  return map;
})();

// ── Program detail modal (gym programs) ──────────────────
const ExerciseWhyTooltip = ({ exercise, onboarding, lang }) => {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  const localEx = exerciseLibrary.find(e => e.id === exercise?.id);
  const merged = { ...localEx, ...exercise };
  const reasons = getExerciseReasoning(merged, onboarding, lang);
  if (reasons.length === 0) return null;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-[#D4AF37] before:absolute before:inset-[-13px] before:content-['']"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
        aria-label={t('workouts.whyThisExercise')}
      >
        <Info size={10} style={{ color: 'var(--color-accent)' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseTooltip', 'Close tooltip')} onClick={(e) => { e.stopPropagation(); setOpen(false); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setOpen(false); } }} />
          <div className="absolute left-0 top-full mt-1 z-[61] w-[240px] rounded-xl p-3 shadow-xl border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-accent)' }}>{t('workouts.whyThisExercise')}</p>
            <div className="flex flex-col gap-1.5">
              {reasons.map((r, i) => (
                <p key={i} className="text-[11px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>{r}</p>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
};

const ProgramModal = ({ program, isEnrolled, onClose, onEnroll, onLeave }) => {
  const { t, i18n } = useTranslation('pages');
  const { user } = useAuth();
  const progName = (tmpl) => i18n.language === 'es' && tmpl.name_es ? tmpl.name_es : tmpl.name;
  const progDesc = (tmpl) => i18n.language === 'es' && tmpl.description_es ? tmpl.description_es : tmpl.description;
  const dayName = (day) => i18n.language === 'es' && day.name_es ? day.name_es : day.name;
  const [exercises, setExercises] = useState({});
  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [acting, setActing]       = useState(false);

  useEffect(() => {
    const weeks = program.weeks ?? {};
    const resolveId = (ex) => (typeof ex === 'string' ? ex : ex?.id);
    const allIds = [...new Set(
      Object.values(weeks).flatMap(val => {
        if (!Array.isArray(val) || val.length === 0) return [];
        if (typeof val[0] === 'string') return val;
        return val.flatMap(d => (d.exercises ?? []).map(resolveId));
      })
    )].filter(Boolean);

    const loadData = async () => {
      const promises = [];
      if (allIds.length > 0) {
        // Batched: a multi-week program with many exercise IDs can exceed the
        // ~390-element URL limit on a plain .in() call.
        promises.push(
          selectInBatches(
            (ids) => supabase.from('exercises').select('id, name, name_es, muscle_group, equipment').in('id', ids),
            allIds,
          ).then(({ data }) => {
            const map = {};
            (data || []).forEach(ex => { map[ex.id] = { ...ex, muscle: ex.muscle_group, equipment: ex.equipment }; });
            setExercises(map);
          })
        );
      }
      if (user?.id) {
        promises.push(
          supabase.from('member_onboarding').select('primary_goal, available_equipment, injuries_notes, fitness_level').eq('profile_id', user.id).maybeSingle()
            .then(({ data }) => { if (data) setOnboarding(data); })
        );
      }
      await Promise.all(promises);
      setLoading(false);
    };
    loadData();
  }, [program.id, user?.id]);

  const handleEnroll = async () => { setActing(true); await onEnroll(program.id); setActing(false); };
  const handleLeave  = async () => { setActing(true); await onLeave(program.id); setActing(false); };
  const weeks = program.weeks ?? {};
  const weekNums = Object.keys(weeks).map(Number).sort((a, b) => a - b);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseProgramDetails', 'Close program details')} onClick={onClose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}>
      <div role="dialog" aria-modal="true" className="rounded-[20px] w-full max-w-lg md:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{progName(program)}</p>
            <p className="text-[12px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-subtle)' }}>
              <Calendar size={11} /> {t('workouts.weekProgram', { count: program.duration_weeks })}
            </p>
          </div>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)' }} aria-label={t('workouts.ariaClose', 'Close')}><X size={16} style={{ color: 'var(--color-text-subtle)' }} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {program.description && <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{progDesc(program)}</p>}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.programOverview')}</p>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }} />)}</div>
            ) : weekNums.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noExercisesAssigned')}</p>
            ) : (
              <div className="space-y-3">
                {weekNums.map(wk => {
                  const rawVal = weeks[wk];
                  const days = Array.isArray(rawVal) && rawVal.length > 0 && typeof rawVal[0] === 'string'
                    ? [{ name: t('workouts.dayN', { n: 1 }), exercises: rawVal }] : (rawVal || []);
                  const resolveId = (ex) => typeof ex === 'string' ? ex : ex?.id;
                  return (
                    <div key={wk} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 border-b" style={{ color: 'var(--color-text-subtle)', borderColor: 'var(--color-border-subtle)' }}>{t('workouts.weekN', { n: wk })}</p>
                      {days.length === 0 ? (
                        <p className="text-[12px] px-3 py-2" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p>
                      ) : (
                        <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                          {days.map((day, di) => (
                            <div key={di} className="px-3 py-2.5">
                              <p className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>{dayName(day) || t('workouts.dayN', { n: di + 1 })}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(day.exercises || []).map((ex, i) => {
                                  const exId = resolveId(ex);
                                  return (
                                    <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>
                                      {exName(exercises[exId]) ?? exId}
                                      {onboarding && exercises[exId] && <ExerciseWhyTooltip exercise={exercises[exId]} onboarding={onboarding} lang={i18n.language} />}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="p-5 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {isEnrolled ? (
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 py-3 px-4 rounded-xl bg-[#10B981]/10">
                <CheckCircle2 size={16} className="text-[#10B981] flex-shrink-0" />
                <p className="text-[13px] font-semibold text-[#10B981]">{t('workouts.enrolled')}</p>
              </div>
              <button onClick={handleLeave} disabled={acting} className="px-4 py-3 text-[12px] font-semibold rounded-xl border hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>{t('challenges.leave')}</button>
            </div>
          ) : (
            <>
              {/* Hollow program guard: same condition as the "no exercises
                  assigned" empty state above (weekNums.length === 0 — e.g. a
                  platform-created shell the gym hasn't filled yet). Enrolling
                  would start a program with nothing to do. */}
              <button onClick={handleEnroll} disabled={acting || weekNums.length === 0} className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-secondary,#fff)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#10B981' }}>
                {acting ? t('workouts.enrolling') : t('workouts.startThisProgram')}
              </button>
              {weekNums.length === 0 && (
                <p className="text-[11px] text-center mt-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('workouts.programEmptyHint', 'This program has no workouts yet — ask your gym to finish it.')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Routine detail (expandable) ──────────────────────────
// ── Session-level routine exercise cache ────────────────────────────────────
// Survives unmount/remount, cleared on full page refresh.
const routineExerciseCache = new Map();

/** Preload exercises for multiple routines in a single query */
async function preloadRoutineExercises(routineIds) {
  const uncached = routineIds.filter(id => !routineExerciseCache.has(id));
  if (uncached.length === 0) return;
  const { data } = await supabase
    .from('routine_exercises')
    .select('id, routine_id, position, target_sets, target_reps, rest_seconds, exercises(name, name_es)')
    .in('routine_id', uncached)
    .order('position');
  // Group by routine_id and cache
  const grouped = {};
  for (const row of (data || [])) {
    if (!grouped[row.routine_id]) grouped[row.routine_id] = [];
    grouped[row.routine_id].push(row);
  }
  for (const id of uncached) {
    const rows = grouped[id];
    // Only cache routines that actually have exercises. `createRoutine`
    // refetches the routine list BEFORE the caller inserts its
    // `routine_exercises`, so a preload triggered in that window fetches an
    // empty set. Caching that empty would be sticky — we only ever fetch
    // *uncached* ids — so the preview modal (RoutineDetail) would show "no
    // exercises" until a page refresh, even though the live session has them.
    // Skipping empties lets the next read (expand / re-preload) refetch.
    if (rows && rows.length > 0) routineExerciseCache.set(id, rows);
  }
}

const RoutineDetail = ({ routineId, onEdit, onDelete, deletingId, onStart }) => {
  const { t } = useTranslation('pages');
  const [exercises, setExercises] = useState(() => routineExerciseCache.get(routineId) || []);
  const [loaded, setLoaded] = useState(() => routineExerciseCache.has(routineId));

  useEffect(() => {
    if (routineExerciseCache.has(routineId)) {
      setExercises(routineExerciseCache.get(routineId));
      setLoaded(true);
      return;
    }
    supabase
      .from('routine_exercises')
      .select('id, position, target_sets, target_reps, rest_seconds, exercises(name, name_es)')
      .eq('routine_id', routineId)
      .order('position')
      .then(({ data }) => {
        const result = data || [];
        routineExerciseCache.set(routineId, result);
        setExercises(result);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [routineId]);

  return (
    <div className="mx-4 mb-2 px-4 py-3 rounded-xl border" style={{ backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)' }}>
      {!loaded ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }} />)}
        </div>
      ) : exercises.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noExercisesAddedYet')}</p>
      ) : (
        <div className="space-y-1.5">
          {exercises.map((ex, i) => (
            <div key={ex.id} className="flex items-center justify-between">
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                <span style={{ color: 'var(--color-text-subtle)' }} className="mr-1.5">{i + 1}.</span>
                {exName(ex.exercises) || t('workouts.unknown')}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                {ex.target_sets}×{ex.target_reps}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 mt-3 pt-2.5 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <Link
          to={`/session/${routineId}`}
          onClick={onStart}
          className="w-full flex items-center justify-center py-3 rounded-2xl text-[13px] font-bold transition-colors active:scale-[0.98]"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}
        >
          {t('workouts.startWorkout')}
        </Link>
        <button
          onClick={onEdit}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold transition-colors"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface-hover)' }}
        >
          <Pencil size={11} /> {t('workouts.edit')}
        </button>
      </div>
    </div>
  );
};

// ── Design tokens ──────────────────────────────────────────
const TU_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const TU_ACCENT = 'var(--color-accent, #2EC4C4)';

// Estimated per-session minute ranges for the "Por Tiempo" browse buckets.
const TIME_BUCKETS = {
  express:  [0, 20],
  rapidas:  [21, 40],
  estandar: [41, 65],
  largas:   [66, 9999],
};

// App-provided "Gym Quick Routines". Tapping "add" creates a real (deletable)
// routine in the user's library. Built from trainer-style circuits using real
// catalog exercises. Tuples: [exercise_id, sets, reps, restSeconds].
const STARTER_ROUTINES = [
  // Trainer HIIT circuit (burpees / KB swing / thruster / box jump), short rest, 4 rounds.
  { key: 'hiit', nameEn: 'HIIT Circuit', nameEs: 'Circuito HIIT', subKey: 'starterSubHiit',
    ex: [['ex_burp', 4, 15, 20], ['ex_kg', 4, 15, 20], ['ex_thrst', 4, 12, 20], ['ex_bxjp', 4, 12, 30]] },
  // Cardio conditioning circuit (jump rope, high knees, boxing, jumping jacks).
  { key: 'cardio', nameEn: 'Cardio Conditioning', nameEs: 'Cardio', subKey: 'starterSubCardio',
    ex: [['ex_cd_jumprope', 3, 40, 30], ['ex_wu_hw', 3, 30, 20], ['ex_kg', 3, 20, 20], ['ex_cd_boxing', 3, 30, 30], ['ex_wu_jj', 3, 30, 20]] },
  // Quick full-body strength.
  { key: 'full', nameEn: 'Quick Full Body', nameEs: 'Cuerpo Completo Rápido', subKey: 'starterSubFull',
    ex: [['ex_sq', 3, 10, 60], ['ex_bp', 3, 10, 60], ['ex_bbr', 3, 10, 60], ['ex_ohp', 3, 10, 60], ['ex_bcr', 3, 20, 45]] },
];

// ── Main page ──────────────────────────────────────────────
const Workouts = () => {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const { routines, loading, createRoutine, deleteRoutine, refetch } = useRoutines();
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();

  useEffect(() => { document.title = `${t('workouts.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Dynamically loaded program templates (~396KB)
  const [programTemplates, setProgramTemplates] = useState([]);
  const [PROGRAM_CATEGORIES, setProgramCategories] = useState(['All']);
  useEffect(() => {
    import('../data/programTemplates').then(m => {
      setProgramTemplates(m.programTemplates || m.default?.programTemplates || []);
      setProgramCategories(m.PROGRAM_CATEGORIES || m.default?.PROGRAM_CATEGORIES || ['All']);
    });
  }, []);
  const progName = (tmpl) => i18n.language === 'es' && tmpl.name_es ? tmpl.name_es : tmpl.name;
  const progDesc = (tmpl) => i18n.language === 'es' && tmpl.description_es ? tmpl.description_es : tmpl.description;
  const dayName = (day) => i18n.language === 'es' && day.name_es ? day.name_es : day.name;
  // Resolve localized name for a generated_programs record (uses template name_es when available)
  const gpName = (prog) => {
    if (prog.template_id) {
      const tmpl = programTemplates.find(t => t.id === prog.template_id);
      if (tmpl) return progName(tmpl);
    }
    // Personal programs persist a creative EN name in schedule_map.display_name
    // (e.g. "Apex Build"). `translateCreativeName` swaps to the locale-active
    // version at render time so the user sees Spanish in Spanish, English in
    // English without rewriting DB rows on locale switch.
    if (prog.schedule_map?.display_name) return translateCreativeName(prog.schedule_map.display_name);
    return prog.split_type ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Custom';
  };

  // Exercise name map — fetched from DB only when a modal opens, for bilingual support
  const [exerciseNameMap, setExerciseNameMap] = useState(localExerciseMap);
  const exerciseMapLoaded = useRef(false);
  const loadExerciseNames = useCallback(() => {
    if (exerciseMapLoaded.current) return;
    exerciseMapLoaded.current = true;
    supabase.from('exercises').select('id, name, name_es').eq('is_active', true)
      .then(({ data }) => {
        if (data?.length) {
          const map = { ...localExerciseMap };
          data.forEach(e => { map[e.id] = { ...map[e.id], ...e }; });
          setExerciseNameMap(map);
        }
      });
  }, []);

  // ── Program Recommendation Engine ──
  const scoreProgram = useCallback((template, onboarding) => {
    let score = 0;

    // Goal match (most important — 40 points)
    const goalMap = {
      muscle_gain: ['Muscle Growth', 'Powerlifting'],
      fat_loss: ['Fat Loss'],
      strength: ['Strength', 'Powerlifting'],
      endurance: ['Athletic', 'Fat Loss'],
      general_fitness: ['Beginner', 'Athletic', 'Muscle Growth'],
    };
    const matchingCategories = goalMap[onboarding?.primary_goal] || [];
    if (matchingCategories.includes(template.category)) score += 40;

    // Level match (30 points)
    const levelMap = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
    if (template.level === levelMap[onboarding?.fitness_level]) score += 30;
    // Adjacent level: small bonus
    if (template.level === 'Intermediate' && onboarding?.fitness_level === 'beginner') score += 10;
    if (template.level === 'Intermediate' && onboarding?.fitness_level === 'advanced') score += 10;

    // Days per week match (20 points)
    const userDays = onboarding?.training_days_per_week || 3;
    const dayDiff = Math.abs(template.daysPerWeek - userDays);
    if (dayDiff === 0) score += 20;
    else if (dayDiff === 1) score += 10;

    // Equipment match (10 points)
    const userEquipment = onboarding?.available_equipment || [];
    if (template.equipment?.every(eq => userEquipment.includes(eq))) score += 10;

    return score;
  }, []);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [leaveProgramConfirm, setLeaveProgramConfirm] = useState(null); // { id, name, source } or null
  const [regenerateConfirm, setRegenerateConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenStartToday, setRegenStartToday] = useState(true);
  const [reactivateConfirm, setReactivateConfirm] = useState(null); // program object or null
  const [reactivating, setReactivating] = useState(false);
  const [deleteRoutineConfirm, setDeleteRoutineConfirm] = useState(null); // { id, name } or null
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState(null); // { reason } or null — alert() doesn't render in Capacitor WebView
  const [deletingId, setDeletingId]           = useState(null);
  const [showGenerator, setShowGenerator]     = useState(false);
  const [showBuilder, setShowBuilder]         = useState(false);
  const [builderProgram, setBuilderProgram]   = useState(null); // null = create your own, program = edit
  const [programCategoryFilter, setProgramCategoryFilter] = useState('All');
  const [programLevelFilter, setProgramLevelFilter] = useState('All');
  const [programDurationFilter, setProgramDurationFilter] = useState('all'); // 'all' | 'quick'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateWeek, setTemplateWeek] = useState('1');
  // Switch program confirmation flow: null | 'confirm' | 'final'
  const [switchStep, setSwitchStep] = useState(null);
  const [switchingProgram, setSwitchingProgram] = useState(false);
  const [startModeChoice, setStartModeChoice] = useState(null); // null | 'choosing' — show start mode modal
  const [startMode, setStartMode] = useState('today'); // 'today' | 'normal'
  const [expandedRoutineId, setExpandedRoutineId] = useState(null);
  const [expandedProgramRoutineId, setExpandedProgramRoutineId] = useState(null);
  const [programViewWeek, setProgramViewWeek] = useState(null);
  const [todayCompletedRoutineIds, setTodayCompletedRoutineIds] = useState(new Set());
  const [programCompletedDays, setProgramCompletedDays] = useState(0);
  const [showAllRoutines, setShowAllRoutines] = useState(false);
  const [showAllMyPrograms, setShowAllMyPrograms] = useState(false);
  const [selectedMyProgram, setSelectedMyProgram] = useState(null);
  const [myProgWeek, setMyProgWeek] = useState('1');
  const [dayCompressionWarning, setDayCompressionWarning] = useState(null);
  const [goalMismatchWarning, setGoalMismatchWarning] = useState(null);
  // Multi-select bulk delete for My Routines + My Programs. The active routine
  // (part of the running program) and the active program can't be selected.
  const [routineSelectMode, setRoutineSelectMode] = useState(false);
  const [selectedRoutineIds, setSelectedRoutineIds] = useState(() => new Set());
  const [programSelectMode, setProgramSelectMode] = useState(false);
  const [selectedProgramIds, setSelectedProgramIds] = useState(() => new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(null); // { kind:'routines'|'programs', count } | null
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Page→page navigation within Workouts: a hub (today + entry cards) that
  // drills into focused pages. Decluttered from the old single long scroll.
  const [workoutsView, setWorkoutsView] = useState('hub'); // 'hub' | 'routines' | 'myPrograms' | 'browse'
  // Browse drill-down: null = show the section boxes; a key = show that section's programs.
  const [browseSection, setBrowseSection] = useState(null); // null | 'all' | 'gym' | 'Beginner' | 'Intermediate' | 'Advanced' | 'quick'

  // Gym programs — cached across unmount / app-restart so tab switches paint instantly
  const wCacheKey = `workouts-${user?.id}`;
  const [gymPrograms, setGymPrograms]       = useCachedState(`${wCacheKey}-gymPrograms`, []);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [enrolledIds, setEnrolledIds]       = useCachedState(`${wCacheKey}-enrolled`, new Set());
  const [selectedProgram, setSelectedProgram] = useState(null);

  // Generated programs
  // useSyncedCachedState — if `user?.id` stabilizes AFTER first render, the
  // cache key changes from `workouts-undefined-gp` to `workouts-<id>-gp`.
  // Regular `useCachedState`'s lazy init only runs once, so the program would
  // be stuck at null until the load effect finishes. `useSyncedCachedState`
  // re-syncs from cache whenever the key changes, so the already-cached
  // program hydrates instantly once user.id is known.
  const [generatedProgram, setGeneratedProgram] = useSyncedCachedState(`${wCacheKey}-gp`, null);
  const [allPrograms, setAllPrograms]           = useSyncedCachedState(`${wCacheKey}-allPrograms`, []);
  const [programLoading, setProgramLoading]     = useState(!hasCachedState(`${wCacheKey}-gp`));
  const [onboardingData, setOnboardingData]     = useCachedState(`${wCacheKey}-onboarding`, null);
  const [goalsMismatch, setGoalsMismatch]       = useState(false);
  const [adaptationSuggestions, setAdaptationSuggestions] = useState(null);
  // Workout schedule: maps routine_id -> day_of_week (0=Sun..6=Sat)
  const [workoutScheduleMap, setWorkoutScheduleMap] = useCachedState(`${wCacheKey}-schedule`, {});

  // Load adaptation suggestions from localStorage on mount
  useEffect(() => {
    const suggestions = loadAdaptationSuggestions();
    if (suggestions) setAdaptationSuggestions(suggestions);
  }, []);

  // Load gym programs (with offline cache fallback)
  const loadPrograms = useCallback(async () => {
    if (!profile?.gym_id) return;
    // Only spin if we have no cached gym programs yet — cached data paints
    // instantly and revalidates silently in the background.
    if (!hasCachedState(`${wCacheKey}-gymPrograms`)) setProgramsLoading(true);
    try {
      const enrolledP = supabase.from('gym_program_enrollments').select('program_id').eq('profile_id', user.id).limit(50);
      // Prefer the bilingual columns; retry without them on pre-0513 schemas.
      let { data: progs, error: progErr } = await supabase
        .from('gym_programs')
        .select('id, name, name_es, description, description_es, cover_preset, image_path, duration_weeks, weeks, created_at')
        .eq('gym_id', profile.gym_id).eq('is_published', true).order('created_at', { ascending: false }).limit(50);
      if (progErr && /name_es|description_es|cover_preset|image_path|does not exist/i.test(progErr.message || '')) {
        ({ data: progs } = await supabase
          .from('gym_programs')
          .select('id, name, description, duration_weeks, weeks, created_at')
          .eq('gym_id', profile.gym_id).eq('is_published', true).order('created_at', { ascending: false }).limit(50));
      }
      const { data: enrolled } = await enrolledP;
      setGymPrograms(progs || []);
      setEnrolledIds(new Set((enrolled || []).map(r => r.program_id)));
      try { localStorage.setItem('offline_gym_programs', JSON.stringify(progs || [])); } catch {}
    } catch {
      // Offline fallback
      try {
        const cached = JSON.parse(localStorage.getItem('offline_gym_programs') || '[]');
        if (cached.length) setGymPrograms(cached);
      } catch {}
    }
    setProgramsLoading(false);
  }, [profile?.gym_id, user?.id]);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  // Scroll locking for modals
  useEffect(() => {
    if (selectedMyProgram) {
      document.body.style.overflow = 'hidden';
      // Personal/auto programs are week-navigable in the modal — open on the
      // program's CURRENT week so the user lands where they actually are.
      // Template programs keep week 1 (myProgWeek indexes template_weeks there).
      const active = selectedMyProgram.id === generatedProgram?.id
        && new Date(selectedMyProgram.expires_at) > new Date();
      if (active && !selectedMyProgram.template_weeks) {
        setMyProgWeek(String(getCurrentWeekClamped(selectedMyProgram)));
      } else {
        setMyProgWeek('1');
      }
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedMyProgram]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedTemplate) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedTemplate]);
  useEffect(() => {
    if (selectedProgram) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedProgram]);
  useEffect(() => {
    if (switchStep) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [switchStep]);
  useEffect(() => {
    if (showCreateModal) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showCreateModal]);
  useEffect(() => {
    if (showGenerator) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showGenerator]);
  useEffect(() => {
    if (dayCompressionWarning) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [dayCompressionWarning]);
  useEffect(() => {
    if (goalMismatchWarning) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [goalMismatchWarning]);
  useEffect(() => {
    if (expandedRoutineId) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [expandedRoutineId]);
  useEffect(() => {
    if (startModeChoice === 'choosing') {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [startModeChoice]);
  useEffect(() => {
    if (leaveProgramConfirm) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [leaveProgramConfirm]);

  // Load generated programs + onboarding
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
    const load = async () => {
      const [gpRes, obRes, lwRes] = await Promise.all([
        supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('member_onboarding').select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes, height_inches, initial_weight_lbs, age, sex, height_cm, weight_kg, gender, priority_muscles').eq('profile_id', user.id).maybeSingle(),
        supabase.from('body_weight_logs').select('weight_lbs').eq('profile_id', user.id).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const { data: allGp, error: gpErr } = gpRes;
      const { data: ob } = obRes;
      const { data: latestWeight } = lwRes;
      // Only replace cached program state when the fetch succeeded.
      // A transient network hiccup that returns an error MUST NOT downgrade
      // an active program back to "no program chosen" — keep the cache value.
      if (!gpErr) {
        const programs = allGp || [];
        setAllPrograms(programs);
        const latest = programs[0] || null;
        setGeneratedProgram(latest);
      } else {
        logger.warn('Workouts: generated_programs fetch failed, keeping cached state:', gpErr);
      }
      const latest = (!gpErr && (allGp?.[0] || null)) || generatedProgram;
      // Enrich onboarding data with latest actual body weight if available
      const enriched = ob ? { ...ob } : null;
      if (enriched && latestWeight?.weight_lbs) {
        enriched.initial_weight_lbs = latestWeight.weight_lbs;
        enriched.weight_kg = Math.round(latestWeight.weight_lbs / 2.205);
      }
      setOnboardingData(enriched);
      setProgramLoading(false);
      if (latest && ob && new Date(latest.expires_at) > new Date()) {
        const programCreated = new Date(latest.created_at);
        const onboardingUpdated = ob.updated_at ? new Date(ob.updated_at) : new Date(ob.created_at);
        if (onboardingUpdated > programCreated) setGoalsMismatch(true);
      }
      if (latest && new Date(latest.expires_at) <= new Date() && !latest.expiry_notified) {
        supabase.from('notifications').insert({
          profile_id: user.id, gym_id: profile.gym_id, type: 'milestone',
          title: t('workouts.programEnded'),
          body: t('workouts.programEndedBody'),
          dedup_key: `program_ended_${latest.id}_${user.id}`,
        }).then(() => supabase.from('generated_programs').update({ expiry_notified: true }).eq('id', latest.id));
      }
    };
    load();
  }, [user?.id, profile?.gym_id]);

  // Load workout schedule (routine -> day mapping)
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('workout_schedule')
      .select('routine_id, day_of_week')
      .eq('profile_id', user.id)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(s => { map[s.routine_id] = s.day_of_week; });
        setWorkoutScheduleMap(map);
      });
  }, [user?.id]);

  // Fetch today's completed workout sessions
  useEffect(() => {
    if (!user?.id) return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    supabase
      .from('workout_sessions')
      .select('routine_id')
      .eq('profile_id', user.id)
      .eq('status', 'completed')
      .gte('completed_at', todayStart.toISOString())
      .then(({ data }) => {
        setTodayCompletedRoutineIds(new Set((data || []).map(s => s.routine_id)));
      });
  }, [user?.id]);

  // ── Per-week completion map for the program view ───────────────────────
  // Lets the program card show green checks on routines actually completed
  // in the viewed week (past or current), matching MyPlan's behavior.
  // Keyed: `${week_number}::${routine_id}` → true.
  const [completedByWeek, setCompletedByWeek] = useState(new Map());
  useEffect(() => {
    if (!user?.id || !generatedProgram?.program_start) { setCompletedByWeek(new Map()); return; }
    const progStart = new Date(generatedProgram.program_start);
    supabase
      .from('workout_sessions')
      .select('routine_id, completed_at')
      .eq('profile_id', user.id)
      .eq('status', 'completed')
      .gte('completed_at', progStart.toISOString())
      // Defensive ceiling: this is bounded by program length (~weeks × sessions/wk),
      // but a long/backdated/reactivated program could push progStart far back.
      // 500 covers any realistic program without dropping a displayable week.
      .order('completed_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        const map = new Map();
        for (const s of (data || [])) {
          const completedDate = new Date(s.completed_at);
          // Week index = floor((completed - progStart) / 7d) + 1, 1-based
          const weekN = Math.floor((completedDate - progStart) / (7 * 86400000)) + 1;
          map.set(`${weekN}::${s.routine_id}`, true);
        }
        setCompletedByWeek(map);
      });
  }, [user?.id, generatedProgram?.program_start, programCompletedDays]);

  // Count completed workout days for the **viewing** program week. When the
  // user navigates back via the prev/next buttons in the hero card, the
  // "X/Y sessions" label needs to reflect that week's history, not the
  // current calendar week. We compute the date range using program_start as
  // the anchor (program weeks are 7-day blocks from program_start, not
  // strictly Sunday-Saturday).
  useEffect(() => {
    if (!user?.id || !generatedProgram) return;
    const progStart = generatedProgram.program_start;
    if (!progStart) return;

    const totalWeeks = generatedProgram.duration_weeks || 6;
    const progStartMs = new Date(progStart).getTime();
    const nowMs = Date.now();
    const currentWeekIdx = Math.min(
      Math.floor((nowMs - progStartMs) / (7 * 86400000)) + 1,
      totalWeeks
    );
    const targetWeek = programViewWeek || currentWeekIdx;
    const isCurrent = targetWeek === currentWeekIdx;

    // Program-week window: [program_start + (w-1)*7d, program_start + w*7d)
    const winStart = new Date(progStartMs + (targetWeek - 1) * 7 * 86400000);
    const winEnd   = new Date(progStartMs + targetWeek * 7 * 86400000);
    // Cap upper bound at "now" for the current week so the count doesn't
    // include sessions that haven't happened yet (it can't, but keeps the
    // intent explicit).
    const upperBound = isCurrent && winEnd.getTime() > nowMs ? new Date(nowMs) : winEnd;

    supabase
      .from('workout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id)
      .eq('status', 'completed')
      .gte('completed_at', winStart.toISOString())
      .lt('completed_at', upperBound.toISOString())
      .then(({ count }) => setProgramCompletedDays(count || 0));
  }, [user?.id, generatedProgram, programViewWeek]);

  // Enforce single active program — deactivate all but the latest
  useEffect(() => {
    if (allPrograms.length <= 1) return;
    const activePrograms = allPrograms.filter(p => new Date(p.expires_at) > new Date());
    if (activePrograms.length <= 1) return;
    // Keep the most recent, deactivate the rest
    const [keep, ...deactivate] = activePrograms;
    const ids = deactivate.map(p => p.id);
    supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).in('id', ids).then(() => {
      setAllPrograms(prev => prev.map(p => ids.includes(p.id) ? { ...p, expires_at: new Date().toISOString() } : p));
    });
  }, [allPrograms.length]);

  // Program state
  const today = new Date();
  const programActive  = generatedProgram && new Date(generatedProgram.expires_at) > today;
  const programExpired = generatedProgram && new Date(generatedProgram.expires_at) <= today;
  // Routines belonging to the CURRENT active program — these are locked from
  // deletion + shown highlighted. Resolved precisely via the active program's
  // persisted routine_ids, so routines left over from a regenerated/replaced
  // program are NOT treated as active. Falls back to the legacy "Auto:" name
  // prefix only for older active programs that never persisted routine_ids.
  const activeProgramRoutineIds = useMemo(() => {
    if (!programActive) return new Set();
    const sm = generatedProgram?.schedule_map || {};
    // routine_ids is the combined list; _a/_b cover A/B-split programs. Union
    // all three so every routine the active program owns is recognized.
    return new Set([
      ...(Array.isArray(sm.routine_ids) ? sm.routine_ids : []),
      ...(Array.isArray(sm.routine_ids_a) ? sm.routine_ids_a : []),
      ...(Array.isArray(sm.routine_ids_b) ? sm.routine_ids_b : []),
    ]);
  }, [programActive, generatedProgram]);
  const isActiveRoutine = useCallback((routine) => {
    if (!programActive || !routine) return false;
    if (activeProgramRoutineIds.size > 0) return activeProgramRoutineIds.has(routine.id);
    return !!routine.name?.startsWith('Auto:');
  }, [programActive, activeProgramRoutineIds]);
  // Use schedule_map from generated_programs (authoritative)
  const schedMap = generatedProgram?.schedule_map || null;
  const programStartDow = schedMap?.start_dow ?? (programActive ? new Date(generatedProgram.program_start).getDay() : 1);
  const hasWrappedDays = (schedMap?.wrapped_dows?.length ?? 0) > 0;
  // Total weeks the user sees on the "Semana X de Y" pill. With partial-week
  // scheduling there are typically `duration_weeks + 1` calendar weeks because
  // mid-week signups bleed into a 13th week. `total_calendar_weeks` is set by
  // the onboarding generator; older programs without it fall back to
  // `duration_weeks`.
  const totalProgramWeeks = schedMap?.total_calendar_weeks ?? generatedProgram?.duration_weeks ?? 6;
  // Week number = calendar weeks (Sun-Sat) since the calendar week containing
  // program_start. Anniversary-based math broke for mid-week signups: a Thu
  // start kept the user on "Week 1" through the following Wednesday, even
  // though the Sun→Sat boundary clearly rolled them into Week 2.
  const rawWeekNum = (() => {
    if (!programActive) return 0;
    const start = new Date(generatedProgram.program_start);
    start.setHours(0, 0, 0, 0);
    const todayMidnight = new Date(today);
    todayMidnight.setHours(0, 0, 0, 0);
    // schedule_map programs use calendar-week anchoring (Sun→Sat) for mid-week
    // signup handling. Programs WITHOUT one (the auto-generator / regenerate
    // path) roll a full 7-day week from program_start, so a freshly generated
    // plan is Week 1 for its first 7 days instead of flipping to Week 2 the
    // next Sunday. Clamp >=1 for any near-future start.
    if (schedMap) {
      const startSunday = new Date(start);
      startSunday.setDate(startSunday.getDate() - startSunday.getDay());
      return Math.max(1, Math.floor((todayMidnight - startSunday) / 86400000 / 7) + 1);
    }
    return Math.max(1, Math.floor((todayMidnight - start) / 86400000 / 7) + 1);
  })();
  const currentWeekNum = Math.min(rawWeekNum, totalProgramWeeks);
  const isWeekA = currentWeekNum % 2 === 1;

  // Build DOW→routine_index maps for each week type
  const normalDowToIdx = {}; // week 2+ (steady state)
  const week1DowToIdx = {};  // week 1 (partial, shifted)
  const lastWeekDowToIdx = {}; // last week (partial, wrapped)
  if (schedMap?.routine_day_map) {
    for (const e of schedMap.routine_day_map) normalDowToIdx[e.day_of_week] = e.routine_index;
  }
  if (schedMap?.week1_map) {
    for (const e of schedMap.week1_map) week1DowToIdx[e.day_of_week] = e.routine_index;
  }
  if (schedMap?.last_week_map) {
    for (const e of schedMap.last_week_map) lastWeekDowToIdx[e.day_of_week] = e.routine_index;
  }

  // Fallback: if no schedule_map, build normalDowToIdx from workoutScheduleMap
  if (!schedMap && Object.keys(workoutScheduleMap).length > 0) {
    const dows = [...new Set(Object.values(workoutScheduleMap))].sort((a, b) => a - b);
    dows.forEach((d, i) => { normalDowToIdx[d] = i; });
  }

  // Reverse map: DOW → routine_id (using workoutScheduleMap which is routine_id→dow).
  // If multiple routine_ids share the same DOW (orphan rows from a prior
  // program), prefer the routine that's actually still in `routines` (i.e.
  // not orphaned) so the rendered list reflects the live program.
  const routineIdByNormalDow = {};
  const liveRoutineIds = new Set(routines.map((r) => r.id));
  for (const [rid, dow] of Object.entries(workoutScheduleMap)) {
    const key = String(dow);
    const existing = routineIdByNormalDow[key];
    if (existing && liveRoutineIds.has(existing) && !liveRoutineIds.has(rid)) continue;
    routineIdByNormalDow[key] = rid;
  }

  // Get routines for a specific week, with correct DOW labels per week.
  //
  // Variant alternation: each program persists TWO routine sets in
  // schedule_map (routine_ids_a + routine_ids_b) with different exercises and
  // different names. Odd weeks (1, 3, 5…) run variant A; even weeks (2, 4, 6…)
  // run variant B. This gives the user a real rotation instead of the same
  // 4 routines repeated week after week.
  //
  // Backwards compat: older programs without routine_ids_a/_b fall back to
  // the workout_schedule mapping (single variant for every week).
  const getRoutinesForWeek = (weekNum) => {
    if (!programActive) return [];
    const autoRoutines = routines.filter(r => r.name.startsWith('Auto:'));

    // Determine which DOW map to use for this week
    // Week 1 ALWAYS uses week1 map (handles "Start Today" on non-standard days)
    let dowMap;
    if (weekNum === 1 && Object.keys(week1DowToIdx).length > 0) {
      dowMap = week1DowToIdx; // first week (may differ from packed schedule)
    } else if (hasWrappedDays && weekNum === totalProgramWeeks) {
      dowMap = lastWeekDowToIdx; // partial last week
    } else {
      dowMap = normalDowToIdx; // full weeks (week 2 through N)
    }

    // Pick the variant for this week. variantIds is the per-week mapping
    // from routine_index → routine_id. Falls back to the combined
    // routine_ids array if the program predates A/B splits.
    const variantIdsA = schedMap?.routine_ids_a;
    const variantIdsB = schedMap?.routine_ids_b;
    const hasVariants = Array.isArray(variantIdsA) && variantIdsA.length > 0
      && Array.isArray(variantIdsB) && variantIdsB.length > 0;
    const variantIds = hasVariants
      ? (weekNum % 2 === 1 ? variantIdsA : variantIdsB)
      : null;

    // Build the list: for each DOW in this week's map, find the matching routine.
    // Defensive deduping below — orphan rows in `workout_schedule` from prior
    // program adjustments can leave the same routine.id mapped to multiple
    // DOWs (or multiple routine_ids on the same DOW). Without this guard the
    // user sees stacked "Mondays" pile up across navigation. We dedupe on
    // both axes: each DOW appears once, and each routine.id appears once.
    const result = [];
    const seenDow = new Set();
    const seenRoutineId = new Set();
    const dowEntries = Object.entries(dowMap).map(([d, idx]) => [Number(d), idx]).sort((a, b) => a[0] - b[0]);
    for (const [dow, routineIdx] of dowEntries) {
      if (seenDow.has(dow)) continue;
      let routine;
      if (variantIds) {
        // A/B variant-aware lookup: routine_index → variantIds[index] → routine.
        const rid = variantIds[routineIdx];
        routine = rid ? autoRoutines.find(r => r.id === rid) : null;
      } else if (weekNum === 1 || (hasWrappedDays && weekNum === totalProgramWeeks)) {
        const normalDow = schedMap?.normal_dows?.[routineIdx];
        const rid = normalDow !== undefined ? routineIdByNormalDow[String(normalDow)] : null;
        routine = rid ? autoRoutines.find(r => r.id === rid) : null;
        if (!routine && routineIdx < autoRoutines.length) {
          routine = autoRoutines[routineIdx];
        }
      } else {
        const rid = routineIdByNormalDow[String(dow)];
        routine = rid ? autoRoutines.find(r => r.id === rid) : null;
      }
      if (routine && !seenRoutineId.has(routine.id)) {
        seenDow.add(dow);
        seenRoutineId.add(routine.id);
        result.push({ ...routine, _displayDow: dow });
      }
    }
    return result;
  };

  const thisWeekRoutines = getRoutinesForWeek(currentWeekNum);

  // Preload routine exercises for the current week's routines (instant expand)
  useEffect(() => {
    if (thisWeekRoutines.length > 0) {
      preloadRoutineExercises(thisWeekRoutines.map(r => r.id));
    }
  }, [thisWeekRoutines.map(r => r.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also preload when user changes week in the program view
  useEffect(() => {
    if (!programActive || !programViewWeek) return;
    const weekRoutines = getRoutinesForWeek(programViewWeek);
    if (weekRoutines.length > 0) {
      preloadRoutineExercises(weekRoutines.map(r => r.id));
    }
  }, [programViewWeek]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload all user routines (My Routines section) on mount
  useEffect(() => {
    if (routines.length > 0) {
      preloadRoutineExercises(routines.map(r => r.id));
    }
  }, [routines.map(r => r.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handlers
  const handleEnroll = async (programId) => {
    const { error } = await supabase.from('gym_program_enrollments').insert({ program_id: programId, profile_id: user.id, gym_id: profile.gym_id });
    if (error) {
      console.error('[enroll program] failed:', error);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
      return;
    }
    setEnrolledIds(prev => new Set([...prev, programId]));
  };
  const handleLeave = async (programId) => {
    const { error } = await supabase.from('gym_program_enrollments').delete().eq('program_id', programId).eq('profile_id', user.id);
    if (error) {
      console.error('[leave program] failed:', error);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
      return;
    }
    setEnrolledIds(prev => { const s = new Set(prev); s.delete(programId); return s; });
  };
  // Regenerate the active personal program from the user's stored
  // onboarding/profile data. The previous program is expired (history kept).
  // workout_schedule rows are upserted onto the new picks.
  const handleRegenerateProgram = async () => {
    setRegenerating(true);
    try {
      await regenerateMemberProgram({ supabase, user, posthog, startToday: regenStartToday });
      // Invalidate cached dashboard + routines payloads so the Home tab
      // hydrates with the new program (otherwise the home page sticks on the
      // stale cache snapshot until the next visibility-change refresh lands).
      try { clearCache(`dash:${user.id}`); } catch {}
      try { clearCache(`routines:${user.id}`); } catch {}
      try { localStorage.removeItem(`qs_cache_v1_${user.id}`); } catch {}
      // Refetch programs + routines so the UI reflects the new program.
      const { data: allGp } = await supabase.from('generated_programs')
        .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified')
        .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
      const programs = allGp || [];
      setAllPrograms(programs);
      setGeneratedProgram(programs[0] || null);
      // workoutScheduleMap is only loaded once on mount — refetch so the new
      // routine→DOW mapping populates immediately. Otherwise the routineId
      // lookup in `getRoutinesForWeek` resolves to deleted orphan ids and
      // weeks 2+ render empty until the user refreshes the app.
      const { data: schedRows } = await supabase
        .from('workout_schedule')
        .select('routine_id, day_of_week')
        .eq('profile_id', user.id);
      const schedMap = {};
      (schedRows || []).forEach((s) => { schedMap[s.routine_id] = s.day_of_week; });
      setWorkoutScheduleMap(schedMap);
      await refetch?.();
      // Dashboard is a keep-alive route — it stays mounted while the user is
      // on Workouts, so clearing the cache alone won't force it to refetch.
      // Broadcast a programs-changed event; Dashboard listens for it and
      // bumps its refreshKey so the next render shows the new program even
      // if the user navigates back fast (before/while regenerate finishes).
      try { window.dispatchEvent(new CustomEvent('tugympr:programs-changed')); } catch {}
      setRegenerateConfirm(false);
    } catch (err) {
      console.error('[regenerate program] failed:', err);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
    } finally {
      setRegenerating(false);
    }
  };

  // Reactivate a past program — copies its routines + schedule into a NEW
  // generated_program with program_start backdated so the user resumes at
  // the calendar week they paused on. Falls back with an alert if the
  // source routines no longer exist.
  const handleReactivateProgram = async (sourceProgram) => {
    if (!sourceProgram) return;
    setReactivating(true);
    try {
      const result = await reactivatePersonalProgram({ supabase, user, sourceProgram, posthog });
      if (result?.error === 'no_routines_linked' || result?.error === 'routines_deleted') {
        alert(t('workouts.reactivateUnavailable', { defaultValue: 'Routines for this program are no longer available. Generate a new program instead.' }));
        setReactivateConfirm(null);
        return;
      }
      const { data: allGp } = await supabase.from('generated_programs')
        .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified')
        .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
      const programs = allGp || [];
      setAllPrograms(programs);
      setGeneratedProgram(programs[0] || null);
      // workoutScheduleMap is only loaded once on mount — refetch so the new
      // routine→DOW mapping populates immediately. Otherwise the routineId
      // lookup in `getRoutinesForWeek` resolves to deleted orphan ids and
      // weeks 2+ render empty until the user refreshes the app.
      const { data: schedRows } = await supabase
        .from('workout_schedule')
        .select('routine_id, day_of_week')
        .eq('profile_id', user.id);
      const schedMap = {};
      (schedRows || []).forEach((s) => { schedMap[s.routine_id] = s.day_of_week; });
      setWorkoutScheduleMap(schedMap);
      await refetch?.();
      try { clearCache(`dash:${user.id}`); } catch {}
      try { clearCache(`routines:${user.id}`); } catch {}
      try { window.dispatchEvent(new CustomEvent('tugympr:programs-changed')); } catch {}
      setSelectedMyProgram(null);
      setReactivateConfirm(null);
    } catch (err) {
      console.error('[reactivate program] failed:', err);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
    } finally {
      setReactivating(false);
    }
  };

  // Confirmed leave/end program — called after "Are you sure?" modal
  const handleConfirmLeaveProgram = async () => {
    if (!leaveProgramConfirm) return;
    const { id, isActive } = leaveProgramConfirm;
    if (isActive) {
      await supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).eq('id', id);
    } else {
      await supabase.from('generated_programs').delete().eq('id', id);
    }
    const { data: allGp } = await supabase.from('generated_programs')
      .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified')
      .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
    const programs = allGp || [];
    setAllPrograms(programs);
    setGeneratedProgram(programs[0] || null);
    setLeaveProgramConfirm(null);
    setSelectedMyProgram(null);
  };

  // Add an app-provided starter routine as a real, deletable routine.
  const [addingStarter, setAddingStarter] = useState(null);
  const handleAddStarter = async (starter) => {
    if (addingStarter) return;
    setAddingStarter(starter.key);
    try {
      const name = i18n.language === 'es' ? starter.nameEs : starter.nameEn;
      const routine = await createRoutine(name);
      const rows = starter.ex.map(([id, sets, reps, rest], i) => ({
        routine_id: routine.id, exercise_id: id, position: i + 1,
        target_sets: sets, target_reps: reps, rest_seconds: rest,
      }));
      await supabase.from('routine_exercises').insert(rows);
      routineExerciseCache.delete(routine.id); // drop any empty cached during the create→insert window
      posthog?.capture('starter_routine_added', { starter: starter.key });
      await refetch();
    } catch (err) {
      logger.error(err);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
    } finally {
      setAddingStarter(null);
    }
  };

  const handleSaveCreateModal = async ({ name, exercises }) => {
    const routine = await createRoutine(name);
    posthog?.capture('routine_created');
    if (exercises?.length > 0) {
      const rows = exercises.map((ex, i) => ({
        routine_id: routine.id, exercise_id: ex.id, position: i + 1,
        target_sets: ex.sets, target_reps: ex.reps, rest_seconds: ex.restSeconds,
      }));
      await supabase.from('routine_exercises').insert(rows);
      routineExerciseCache.delete(routine.id); // drop any empty cached during the create→insert window
      refetch();
      navigate(`/session/${routine.id}`);
    } else {
      refetch();
      navigate(`/workouts/${routine.id}/edit`);
    }
  };
  const handleDelete = (e, id) => {
    e.preventDefault(); e.stopPropagation();
    // Prevent deleting routines that belong to the CURRENT active program only.
    const routine = routines.find(r => r.id === id);
    if (isActiveRoutine(routine)) {
      // alert() is silently dropped in Capacitor iOS WebView, which made the
      // delete button feel broken. Show an in-app info modal instead.
      setDeleteBlockedInfo({ reason: 'active_program' });
      return;
    }
    setDeleteRoutineConfirm({ id, name: routine?.name || '' });
  };

  const handleConfirmDeleteRoutine = async () => {
    if (!deleteRoutineConfirm) return;
    const { id } = deleteRoutineConfirm;
    setDeletingId(id);
    try {
      await deleteRoutine(id);
    } catch (err) {
      logger.error(err);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
    } finally {
      setDeletingId(null);
      setDeleteRoutineConfirm(null);
    }
  };

  // ── Multi-select bulk delete ──
  const toggleRoutineSel = useCallback((id) => {
    setSelectedRoutineIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleProgramSel = useCallback((id) => {
    setSelectedProgramIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const exitRoutineSelect = useCallback(() => { setRoutineSelectMode(false); setSelectedRoutineIds(new Set()); }, []);
  const exitProgramSelect = useCallback(() => { setProgramSelectMode(false); setSelectedProgramIds(new Set()); }, []);

  // Switch hub view + reset scroll to the top. The member scroll container is
  // #main-content (App.jsx scrolls it on route change); an in-page view swap
  // has to do the same or you land mid-page. rAF runs it after the new view paints.
  const goToView = useCallback((v) => {
    setBrowseSection(null); // entering a top-level view resets the browse drill-down
    setWorkoutsView(v);
  }, []);

  // Reset scroll to the very top after the new view/section actually commits.
  // (A rAF inside the click handler fired before render, so pages landed
  // mid-scroll — that was the bug.) Mirrors the targets App.jsx resets on a
  // route change: window + documentElement + body + #main-content.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.getElementById('main-content')?.scrollTo(0, 0);
  }, [workoutsView, browseSection]);

  // Tapping the "Entrenos" footer tab while already on a sub-page returns to
  // the hub (the route doesn't change, so Navigation fires this event instead).
  useEffect(() => {
    const onHub = () => goToView('hub');
    window.addEventListener('workouts:hub', onHub);
    return () => window.removeEventListener('workouts:hub', onHub);
  }, [goToView]);

  // Rough per-session minutes for a template's representative day. Templates
  // store sets + rest only (no reps), so we use the same constants the app's
  // estimateDuration uses (10 reps × 7s + ~10s setup + rest, + warmup/cooldown).
  // Enough to bucket "quick" (~30 min) sessions.
  const estimateTemplateSessionMin = useCallback((tmpl) => {
    const exs = tmpl?.weeks?.['1']?.[0]?.exercises;
    if (!Array.isArray(exs) || exs.length === 0) return null;
    let secs = 0;
    for (const ex of exs) {
      const sets = ex.sets || 3;
      const rest = ex.rest_seconds ?? 90;
      secs += sets * (10 * 7 + 10 + rest);
    }
    return Math.round(secs / 60 + 8);
  }, []);

  // Open a Browse section: set the underlying filters the program grid reads,
  // then switch from the magazine landing to the filtered list.
  const openBrowseSection = useCallback((key) => {
    const isLevel = ['Beginner', 'Intermediate', 'Advanced'].includes(key);
    const isTime = Object.prototype.hasOwnProperty.call(TIME_BUCKETS, key);
    setProgramCategoryFilter(key === 'gym' ? 'Gym Exclusive' : 'All');
    setProgramLevelFilter(isLevel ? key : 'All');
    setProgramDurationFilter(isTime ? key : 'all');
    setBrowseSection(key);
  }, []);

  // Templates ranked best-fit first (drives the recommended hero + "Para ti").
  const scoredTemplates = useMemo(() => (
    [...programTemplates]
      .map(t => ({ t, score: scoreProgram(t, onboardingData) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.t)
  ), [programTemplates, onboardingData, scoreProgram]);
  const recommendedTemplate = scoredTemplates[0] || null;
  const levelCounts = useMemo(() => {
    const c = { Beginner: 0, Intermediate: 0, Advanced: 0 };
    programTemplates.forEach(t => { if (c[t.level] !== undefined) c[t.level] += 1; });
    return c;
  }, [programTemplates]);
  const timeCounts = useMemo(() => {
    const c = { express: 0, rapidas: 0, estandar: 0, largas: 0 };
    programTemplates.forEach(t => {
      const m = estimateTemplateSessionMin(t) ?? 999;
      if (m <= 20) c.express += 1; else if (m <= 40) c.rapidas += 1; else if (m <= 65) c.estandar += 1; else c.largas += 1;
    });
    return c;
  }, [programTemplates, estimateTemplateSessionMin]);

  // Title for the Programas page — reflects the open section so you know where
  // you are (e.g. "Principiante", "Rápidas") instead of always "Programas".
  const browseTitle = (() => {
    if (!browseSection) return t('workouts.programs');
    if (browseSection === 'all') return t('workouts.browseAll', 'All programs');
    if (browseSection === 'gym') return t('workouts.gymExclusive', 'Gym Exclusive');
    if (['Beginner', 'Intermediate', 'Advanced'].includes(browseSection)) {
      return t(`workouts.programLevels.${browseSection}`, browseSection);
    }
    const tl = {
      express: t('workouts.timeExpressLabel', 'Express'),
      rapidas: t('workouts.timeRapidasLabel', 'Quick'),
      estandar: t('workouts.timeEstandarLabel', 'Standard'),
      largas: t('workouts.timeLargasLabel', 'Long'),
    };
    return tl[browseSection] || t('workouts.programs');
  })();

  const handleBulkDeleteRoutines = async () => {
    setBulkDeleting(true);
    try {
      // Never delete active-program routines, even if somehow selected.
      const ids = [...selectedRoutineIds].filter(id => !isActiveRoutine(routines.find(r => r.id === id)));
      for (const id of ids) {
        await deleteRoutine(id);
      }
    } catch (err) {
      logger.error(err);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirm(null);
      exitRoutineSelect();
    }
  };

  const handleBulkDeletePrograms = async () => {
    setBulkDeleting(true);
    try {
      // Never delete the active program.
      const activeProgId = (generatedProgram && new Date(generatedProgram.expires_at) > new Date()) ? generatedProgram.id : null;
      const ids = [...selectedProgramIds].filter(id => id !== activeProgId);
      if (ids.length) {
        await supabase.from('generated_programs').delete().in('id', ids);
      }
      const { data: allGp } = await supabase.from('generated_programs')
        .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified')
        .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
      const programs = allGp || [];
      setAllPrograms(programs);
      setGeneratedProgram(programs[0] || null);
    } catch (err) {
      logger.error(err);
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirm(null);
      exitProgramSelect();
    }
  };

  // ── Template program enrollment ──
  const handleStartTemplate = () => {
    if (!selectedTemplate) return;
    const templateScore = scoreProgram(selectedTemplate, onboardingData);

    // Goal validation warning (non-blocking, shown first if score < 30)
    if (templateScore < 30 && onboardingData?.primary_goal) {
      setGoalMismatchWarning({
        programGoal: selectedTemplate.goal || selectedTemplate.category,
        userGoal: onboardingData.primary_goal,
      });
      return;
    }

    // Day compression warning
    const userDays = onboardingData?.training_days_per_week || 0;
    if (userDays > 0 && selectedTemplate.daysPerWeek > userDays) {
      setDayCompressionWarning({
        programDays: selectedTemplate.daysPerWeek,
        userDays,
      });
      return;
    }

    // Show start mode choice
    setStartModeChoice('choosing');
  };

  const proceedAfterWarnings = () => {
    setGoalMismatchWarning(null);
    setDayCompressionWarning(null);
    // Show start mode choice
    setStartModeChoice('choosing');
  };

  const proceedWithStartMode = (mode) => {
    setStartMode(mode);
    setStartModeChoice(null);
    if (programActive) {
      setSwitchStep('confirm');
    } else {
      enrollInTemplate(mode);
    }
  };

  const [gymHoursWarnings, setGymHoursWarnings] = useState([]);

  const enrollInTemplate = async (mode) => {
    const useStartMode = mode || startMode;
    if (!selectedTemplate || !user?.id || !profile?.gym_id) return;
    setSwitchingProgram(true);
    setGymHoursWarnings([]);

    try {
      // 1. Deactivate current program (don't delete — just expire it)
      if (generatedProgram && new Date(generatedProgram.expires_at) > new Date()) {
        await supabase.from('generated_programs')
          .update({ expires_at: new Date().toISOString() })
          .eq('id', generatedProgram.id);
      }

      // Fetch gym hours to know which days are closed
      const { data: gymHours } = await supabase
        .from('gym_hours')
        .select('day_of_week, open_time, close_time, is_closed')
        .eq('gym_id', profile.gym_id);

      const closedDays = new Set((gymHours || []).filter(h => h.is_closed).map(h => h.day_of_week));
      const gymSchedule = Object.fromEntries((gymHours || []).map(h => [h.day_of_week, h]));

      // Fetch user's average session duration (last 10 sessions) for closing-time warnings
      const { data: recentSessions } = await supabase
        .from('workout_sessions')
        .select('duration_seconds')
        .eq('profile_id', user.id)
        .not('duration_seconds', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(10);

      const avgDuration = recentSessions?.length > 0
        ? recentSessions.reduce((s, x) => s + x.duration_seconds, 0) / recentSessions.length
        : 3600; // default 60 min if no history

      // 2. Snapshot old Auto: routine IDs — cleanup deferred to after new routines
      //    are fully created so there is no window with zero active routines.
      const { data: oldAutoRoutines } = await supabase
        .from('routines')
        .select('id')
        .eq('created_by', user.id)
        .like('name', 'Auto:%');
      const oldAutoRoutineIds = (oldAutoRoutines || []).map(r => r.id);

      // 3. Create a generated_programs entry (inserted after scheduleDays is computed below)
      const startDate = new Date();

      // 3. Create routines from the first week's workouts
      const fullFirstWeek = selectedTemplate.weeks['1'] || [];
      // Day compression: if user trains fewer days than the program requires, limit routines
      const userTrainingDays = onboardingData?.training_days_per_week || 0;
      const firstWeek = (userTrainingDays > 0 && userTrainingDays < fullFirstWeek.length)
        ? fullFirstWeek.slice(0, userTrainingDays)
        : fullFirstWeek;
      const createdRoutineIds = [];

      // Smart day alignment: use user's preferred training days, skip closed gym days
      // DB day_of_week: Sunday=0, Monday=1, ..., Saturday=6
      const dayNameToDbNum = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const dbNumToDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const preferredDayNames = profile?.preferred_training_days || [];
      const userDbDays = preferredDayNames
        .map(d => dayNameToDbNum[d.toLowerCase()])
        .filter(n => n !== undefined)
        .sort((a, b) => a - b);
      const fallbackPattern = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

      // Schedule on the MEMBER'S preferred training days (gym-open only). This is
      // what they picked in onboarding — e.g. Mon/Wed/Fri instead of a forced
      // Mon-Tue-Wed block — which also gives natural rest spacing. Only when they
      // haven't set enough preferred days to cover the N routines do we top up
      // with other open days (Monday-first) so every routine still lands a slot.
      const allOpenDays = [1, 2, 3, 4, 5, 6, 0].filter(d => !closedDays.has(d));
      const preferredOpen = userDbDays.filter(d => !closedDays.has(d));
      let allAvailableDays = [];
      if (preferredOpen.length >= firstWeek.length) {
        allAvailableDays = preferredOpen.slice(0, firstWeek.length);
      } else {
        allAvailableDays = [...preferredOpen];
        for (const d of allOpenDays) {
          if (allAvailableDays.length >= firstWeek.length) break;
          if (!allAvailableDays.includes(d)) allAvailableDays.push(d);
        }
      }
      allAvailableDays.sort((a, b) => a - b);

      // 'normal' = clean, FULL week 1 aligned to THEIR schedule: start on the next
      // occurrence of their earliest training day (today if today is that day).
      // This gives a full first week of their actual days — no collapsed stub
      // week and no instant jump to "week 2" — without forcing an arbitrary
      // Monday. 'today' keeps the start-now path (partial shifted week 1).
      if (useStartMode === 'normal' && allAvailableDays.length > 0) {
        const firstDow = allAvailableDays[0];
        startDate.setDate(startDate.getDate() + ((firstDow - startDate.getDay() + 7) % 7));
        startDate.setHours(0, 0, 0, 0);
      }

      // Schedule mappings: week 1 (shifted), week 2+ (packed Mon-start), last week (remainder)
      const startDow = startDate.getDay();
      const N = firstWeek.length;

      // Rotate from start date to pick the N closest training days for week 1
      // "Start Today" means today is ALWAYS included, even if gym is closed
      const sorted = [...allAvailableDays].sort((a, b) => a - b);
      const week1Pool = useStartMode === 'today' && !sorted.includes(startDow)
        ? [startDow, ...sorted].sort((a, b) => a - b)
        : sorted;
      const fromStart = week1Pool.filter(d => d >= startDow);
      const beforeStart = week1Pool.filter(d => d < startDow);
      const rotated = [...fromStart, ...beforeStart];
      const week1AllDays = rotated.slice(0, N);

      // Week 1 only contains days from startDow onward (this calendar week)
      const week1Dows = week1AllDays.filter(d => d >= startDow);
      // Wrapped days → last week (routines that couldn't fit in week 1's calendar week)
      const wrappedDows = week1AllDays.filter(d => d < startDow);
      const needsExtraWeek = wrappedDows.length > 0;
      // Enforce minimum of 8 weeks to hit the 6-week stickiness target with buffer.
      const baseDuration = Math.max(8, selectedTemplate.durationWeeks || 8);
      const totalDurationWeeks = baseDuration + (needsExtraWeek ? 1 : 0);

      // Week 2+ (packed): fill first N gym-open days starting from Monday
      // Routine order: rotate so the routine that was on Monday in the shifted schedule comes first
      const packedDays = sorted.slice(0, N); // first N open days in calendar order (Mon-start)
      const monIdxInRotation = week1AllDays.indexOf(packedDays[0]); // where Monday's routine sits in shifted order
      const rotationOffset = monIdxInRotation >= 0 ? monIdxInRotation : 0;

      // normalDays[i] = the DOW for routine i in week 2+ (packed schedule)
      const normalDays = Array.from({ length: N }, (_, i) =>
        packedDays[(i - rotationOffset + N) % N]
      );

      // The DB workout_schedule uses normalDays (the steady-state week 2+ mapping)
      let scheduleDays = normalDays;

      // last_week_map: the wrapped routines placed on the first open days of that week
      const wrappedRoutineIndices = wrappedDows.map(d => week1AllDays.indexOf(d));
      const lastWeekEntries = wrappedRoutineIndices.map((routineIdx, i) => ({
        routine_index: routineIdx,
        day_of_week: packedDays[i], // first N_wrapped packed days
      }));

      // Build schedule_map with all three mappings
      const scheduleMapData = {
        // routine_day_map = PACKED (week 2+) DOW assignments
        routine_day_map: normalDays.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
        // week1_map = shifted DOW assignments for week 1 only
        week1_map: week1Dows.map((dow) => {
          const rotatedIdx = week1AllDays.indexOf(dow);
          return { routine_index: rotatedIdx, day_of_week: dow };
        }),
        // last_week_map = remaining routines from week 1 placed on first packed days
        last_week_map: lastWeekEntries,
        start_dow: startDow,
        week1_dows: week1Dows,
        wrapped_dows: wrappedDows,
        normal_dows: normalDays,
      };

      const expiresAt = new Date(startDate);
      expiresAt.setDate(expiresAt.getDate() + totalDurationWeeks * 7);

      const insertData = {
        profile_id: user.id,
        gym_id: profile.gym_id,
        split_type: selectedTemplate.id.replace('tmpl_', ''),
        program_start: startDate.toISOString(),
        expires_at: expiresAt.toISOString(),
        routines_a_count: selectedTemplate.daysPerWeek,
        duration_weeks: totalDurationWeeks,
        schedule_map: scheduleMapData,
      };

      let insertRes = await supabase.from('generated_programs').insert({
        ...insertData,
        template_id: selectedTemplate.id,
        template_weeks: selectedTemplate.weeks,
      }).select().single();

      if (insertRes.error) {
        logger.warn('Template columns not available, inserting without them:', insertRes.error.message);
        insertRes = await supabase.from('generated_programs').insert(insertData).select().single();
      }

      if (insertRes.error) {
        throw new Error('Failed to create program entry: ' + insertRes.error.message);
      }

      logger.log('Created program:', insertRes.data?.id);

      // Check if workouts might extend past closing time (soft warning)
      const warnings = [];
      for (const dayNum of scheduleDays) {
        const hourInfo = gymSchedule[dayNum];
        if (hourInfo && hourInfo.close_time && !hourInfo.is_closed) {
          const [closeH, closeM] = hourInfo.close_time.split(':').map(Number);
          const closeMins = closeH * 60 + closeM;
          const avgDurMins = Math.ceil(avgDuration / 60);
          const latestStartMins = closeMins - avgDurMins;
          if (latestStartMins < closeMins && avgDurMins > 0) {
            const latestH = Math.floor(Math.max(0, latestStartMins) / 60);
            const latestM = Math.max(0, latestStartMins) % 60;
            const latestStart = `${String(latestH).padStart(2, '0')}:${String(latestM).padStart(2, '0')}`;
            if (latestStartMins < closeMins - 30) {
              warnings.push(
                t('workouts.closingTimeWarning', {
                  day: dbNumToDayName[dayNum],
                  closeTime: hourInfo.close_time,
                  defaultValue: `Your workout on ${dbNumToDayName[dayNum]} may run past closing time (${hourInfo.close_time}). Start before ${latestStart}.`,
                })
              );
            }
          }
        }
      }
      if (warnings.length > 0) {
        setGymHoursWarnings(warnings);
      }

      for (let i = 0; i < firstWeek.length; i++) {
        const day = firstWeek[i];
        const localizedDayName = i18n.language === 'es' && day.name_es ? day.name_es : day.name;
        const routineName = `Auto: ${localizedDayName}`;

        let routine;
        try {
          routine = await createRoutine(routineName);
        } catch (err) {
          logger.error('Failed to create routine:', routineName, err);
          continue;
        }

        if (!routine?.id) {
          logger.error('No routine ID returned for:', routineName);
          continue;
        }

        createdRoutineIds.push(routine.id);
        logger.log(`Created routine ${i + 1}/${firstWeek.length}: ${routineName} (${routine.id})`);

        if (day.exercises?.length > 0) {
          // Carry the admin-authored prescription through to the live session:
          // reps + supersets/circuits (group_id/group_type exist since 0128).
          const baseRows = day.exercises.map((ex, pos) => ({
            routine_id: routine.id,
            exercise_id: ex.id,
            position: pos + 1,
            target_sets: ex.sets || 3,
            target_reps: ex.reps || '8-12',
            rest_seconds: ex.rest_seconds || 90,
            group_id: ex.group_id || null,
            group_type: ex.group_type || null,
          }));
          // Drop-set marker (0513). Retry without it on pre-migration schemas.
          const rows = baseRows.map((r, pos) => ({ ...r, is_drop_set: !!day.exercises[pos].drop_set }));
          let { error: exErr } = await supabase.from('routine_exercises').insert(rows);
          if (exErr && /is_drop_set|does not exist/i.test(exErr.message || '')) {
            ({ error: exErr } = await supabase.from('routine_exercises').insert(baseRows));
          }
          if (exErr) logger.error('Failed to insert exercises for routine:', routineName, exErr);
        }

        // Assign to workout_schedule using preferred day mapping
        const dayOfWeek = scheduleDays[i] !== undefined ? scheduleDays[i] : (i + 1) % 7;
        const { error: schedErr } = await supabase.from('workout_schedule').upsert({
          profile_id: user.id,
          gym_id: profile.gym_id,
          day_of_week: dayOfWeek,
          routine_id: routine.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,day_of_week' });
        if (schedErr) logger.warn('Schedule upsert failed (table may not exist):', schedErr.message);
      }

      logger.log(`Enrollment complete: ${createdRoutineIds.length} routines created`);

      // Now that new routines + program row are fully committed, safely clean up
      // the old Auto: routines. Doing this AFTER creation prevents a window where
      // the user has no active program routines if the network fails mid-creation.
      if (oldAutoRoutineIds.length > 0) {
        // Exclude any old IDs that overlap with the new routines (shouldn't happen,
        // but guards against accidental deletion if IDs were recycled).
        const newIds = new Set(createdRoutineIds);
        const safeToDelete = oldAutoRoutineIds.filter(id => !newIds.has(id));
        if (safeToDelete.length > 0) {
          await supabase.from('routine_exercises').delete().in('routine_id', safeToDelete);
          await supabase.from('workout_schedule').delete().in('routine_id', safeToDelete).then(() => {}).catch(() => {});
          await supabase.from('routines').delete().in('id', safeToDelete);
          logger.log(`Cleaned up ${safeToDelete.length} old Auto: routines`);
        }
      }

      // 4. Refresh state — programs, routines, AND workout schedule
      const [{ data: allGp }, { data: schedData }] = await Promise.all([
        supabase.from('generated_programs')
          .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified')
          .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('workout_schedule')
          .select('routine_id, day_of_week')
          .eq('profile_id', user.id),
      ]);
      const programs = allGp || [];
      setAllPrograms(programs);
      setGeneratedProgram(programs[0] || null);
      // Refresh workout schedule map so DOW→routine mapping is current
      const map = {};
      (schedData || []).forEach(s => { map[s.routine_id] = s.day_of_week; });
      setWorkoutScheduleMap(map);
      await refetch();

      // Close everything
      setSwitchStep(null);
      setSelectedTemplate(null);
    } catch (err) {
      logger.error('Failed to enroll in template:', err);
      alert(t('workouts.actionFailed', "That didn't go through. Check your connection and try again."));
    } finally {
      setSwitchingProgram(false);
    }
  };

  return (
    <>
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 lg:px-8 pt-4 pb-28 md:pb-12">

      {/* ── Header ─────────────────────────────────────────── */}
      {workoutsView === 'hub' ? (
      <div className="flex items-center justify-between mb-6 gap-2 min-w-0" data-tour="tour-workouts-page">
        <h1 className="min-w-0 truncate flex-shrink" style={{ fontFamily: TU_DISPLAY, fontSize: 28, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>{t('workouts.title')}</h1>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Link
            to="/exercises"
            aria-label={t('workouts.library')}
            className="flex items-center gap-1.5 px-2.5 py-2 min-h-[44px] rounded-full text-[12px] font-semibold transition-colors whitespace-nowrap"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <BookOpen size={14} />
            <span>{t('workouts.library')}</span>
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            aria-label={t('workouts.newRoutine', 'New routine')}
            className="flex items-center gap-1 px-2.5 py-2 min-h-[44px] rounded-full text-[12px] font-bold transition-colors whitespace-nowrap"
            style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-primary)' }}
          >
            <Plus size={14} />
            <span>{t('workouts.newRoutine', 'New routine')}</span>
          </button>
        </div>
      </div>
      ) : (
        <button
          onClick={() => { if (workoutsView === 'browse' && browseSection) { setBrowseSection(null); } else { goToView('hub'); } }}
          className="flex items-center gap-1 mb-6 -ml-1 pr-2 min-h-[44px] text-[15px] font-bold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <ChevronLeft size={22} />
          {workoutsView === 'browse' && browseSection ? t('workouts.programs') : t('workouts.title')}
        </button>
      )}

      {/* ── HUB VIEW: today's hero + entry cards into the focused pages ── */}
      {workoutsView === 'hub' && (<>
      {/* Trainer-assigned plan (renders nothing when the member has none) */}
      <TrainerPlanSection />
      {/* ════════════════════════════════════════════════════════
          SECTION 1: CURRENT PROGRAM — Hero
         ════════════════════════════════════════════════════════ */}
      {programLoading && (
        <section className="mb-10">
          <div className="h-3 w-32 rounded animate-pulse mb-3" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
          <div className="rounded-2xl p-6 animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
            <div className="h-6 w-40 rounded mb-4" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            <div className="h-1 w-full rounded-full mb-6" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            <div className="space-y-2">
              <div className="h-14 rounded-2xl" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
              <div className="h-14 rounded-2xl" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            </div>
          </div>
        </section>
      )}
      {/* Adaptation suggestions banner */}
      {!programLoading && programActive && adaptationSuggestions && (
        <section className="mb-4">
          <div className="rounded-2xl p-4 border" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-bg-card))', borderColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                <Activity size={15} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                  {adaptationSuggestions.shouldDeload
                    ? t('workouts.adaptDeloadTitle', 'Consider a deload week')
                    : adaptationSuggestions.shouldIncrease
                    ? t('workouts.adaptIncreaseTitle', 'You\'re progressing well!')
                    : t('workouts.adaptInsightTitle', 'Program insight')}
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-subtle)' }}>
                  {adaptationSuggestions.shouldDeload
                    ? t('workouts.adaptDeloadBody', 'Your volume has dropped recently. A lighter week may help you recover and come back stronger.')
                    : adaptationSuggestions.shouldIncrease
                    ? t('workouts.adaptIncreaseBody', 'Your volume is trending up. Keep pushing and trust the process.')
                    : adaptationSuggestions.underperformingExercises?.length > 0
                    ? t('workouts.adaptUnderperformBody', { count: adaptationSuggestions.underperformingExercises.length, defaultValue: `${adaptationSuggestions.underperformingExercises.length} exercise(s) have low completion. Consider reducing weight or swapping them.` })
                    : t('workouts.adaptGeneralBody', 'Your program is on track. Keep showing up.')}
                </p>
              </div>
              <button
                onClick={() => {
                  dismissAdaptationSuggestions();
                  setAdaptationSuggestions(null);
                }}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                aria-label={t('workouts.ariaDismissAdaptation', 'Dismiss adaptation suggestion')}
              >
                <X size={14} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
            </div>
          </div>
        </section>
      )}
      {!programLoading && programActive && (() => {
        const viewWeek = programViewWeek || currentWeekNum;
        const isViewingCurrentWeek = viewWeek === currentWeekNum;
        // For non-current weeks, show template exercises if available
        const templateWeeks = generatedProgram?.template_weeks || null;
        const viewWeekDays = (!isViewingCurrentWeek && templateWeeks) ? (templateWeeks[String(viewWeek)] || []) : null;

        return (
        <section className="mb-10">
          {/* ── HERO: Current Program Card ─────────────────────── */}
          <div
            className="rounded-[22px] overflow-hidden"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}
          >
            <div className="px-5 pt-5 pb-2">
              {/* Program name + icon */}
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-[10px] font-bold uppercase mb-1.5" style={{ color: TU_ACCENT, letterSpacing: '0.12em' }}>{t('workouts.currentProgram')}</p>
                  <h2 style={{ fontFamily: TU_DISPLAY, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1.15 }}>
                    {gpName(generatedProgram)}
                  </h2>
                </div>
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0"
                  style={{ background: `color-mix(in srgb, ${TU_ACCENT} 12%, transparent)` }}>
                  <Zap size={20} style={{ color: TU_ACCENT }} strokeWidth={2} />
                </div>
              </div>

              {/* Progress bar + stats */}
              {(() => {
                const schedPerWeek = generatedProgram?.schedule_map?.routine_day_map?.length || generatedProgram?.routines_a_count || 3;
                // Sessions THIS week — partial weeks (Wed start → 2 sessions
                // instead of 4) need the actual count from week1_map/
                // last_week_map, not the full-week target, so the pill reads
                // "0/2" instead of a confusing "0/4".
                let weekSessions = schedPerWeek;
                if (viewWeek === 1 && schedMap?.week1_map?.length > 0) {
                  weekSessions = schedMap.week1_map.length;
                } else if (schedMap?.wrapped_dows?.length > 0 && viewWeek === totalProgramWeeks) {
                  weekSessions = schedMap.last_week_map?.length ?? schedPerWeek;
                }
                const totalExpected = schedPerWeek * totalProgramWeeks;
                const pct = totalExpected > 0 ? Math.min(Math.round((programCompletedDays / totalExpected) * 100), 100) : 0;
                return (
                  <div className="my-4">
                    <div className="flex items-end justify-between mb-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                          {t('workouts.weekXOfY', { current: Math.min(viewWeek, totalProgramWeeks), total: totalProgramWeeks })}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          {isViewingCurrentWeek
                            ? t('workouts.sessionsThisWeekCount', { count: programCompletedDays, total: weekSessions, defaultValue: '{{count}}/{{total}} sessions this week' })
                            : `${programCompletedDays} / ${weekSessions} ${t('workouts.sessionsLogged', 'sessions logged')}`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <span className="text-[24px] font-extrabold leading-none tabular-nums" style={{ color: TU_ACCENT, letterSpacing: '-0.02em' }}>
                          {pct}%
                        </span>
                        <p className="text-[9px] font-bold uppercase mt-0.5" style={{ color: 'var(--color-text-subtle)', letterSpacing: '0.12em' }}>
                          {t('workouts.pctComplete', 'complete')}
                        </p>
                      </div>
                    </div>
                    <div className="w-full h-[5px] rounded-full" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%`, background: TU_ACCENT }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Week navigator — minimal */}
              <div className="flex items-center justify-between mb-2 -mx-1">
                <button onClick={() => { setProgramViewWeek(w => Math.max(1, (w || currentWeekNum) - 1)); setExpandedProgramRoutineId(null); }} disabled={viewWeek <= 1} className="min-w-[44px] min-h-[44px] w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-20" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-subtle)' }} aria-label={t('workouts.ariaPreviousWeek', 'Previous week')}><ChevronLeft size={16} strokeWidth={2} /></button>
                <div className="text-center">
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                    {isViewingCurrentWeek ? t('workouts.currentWeekRoutine', { variant: isWeekA ? 'A' : 'B' }) : t('workouts.weekN', { n: viewWeek })}
                  </p>
                </div>
                <button onClick={() => { setProgramViewWeek(w => Math.min(totalProgramWeeks, (w || currentWeekNum) + 1)); setExpandedProgramRoutineId(null); }} disabled={viewWeek >= totalProgramWeeks} className="min-w-[44px] min-h-[44px] w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-20" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-subtle)' }} aria-label={t('workouts.ariaNextWeek', 'Next week')}><ChevronRight size={16} strokeWidth={2} /></button>
              </div>

            </div>

            {/* Routine list area with subtle separator */}
            <div className="px-5 pb-5">

            {/* Week content — use getRoutinesForWeek for all weeks so partial first/last weeks are respected */}
            {(() => {
              const weekRoutines = isViewingCurrentWeek ? thisWeekRoutines : getRoutinesForWeek(viewWeek);
              if (weekRoutines.length === 0) {
                return viewWeekDays && viewWeekDays.length > 0 ? (
                  <div className="space-y-2">
                    {viewWeekDays.map((day, di) => {
                      const dayExpanded = expandedProgramRoutineId === `week-${viewWeek}-${di}`;
                      return (
                        <div key={di}>
                          <button type="button" onClick={() => setExpandedProgramRoutineId(dayExpanded ? null : `week-${viewWeek}-${di}`)} className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}><Dumbbell size={15} style={{ color: 'var(--color-text-muted)' }} /></div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{dayName(day) || t('workouts.dayN', { n: di + 1 })}</p>
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{(day.exercises || []).length} {t('workouts.exercises')}</p>
                            </div>
                            <ChevronRight size={16} className={`flex-shrink-0 transition-transform duration-200 ${dayExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
                          </button>
                          {dayExpanded && (
                            <div className="mx-4 mb-2 px-4 py-3 rounded-xl border" style={{ backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)' }}>
                              <div className="space-y-1.5">
                                {(day.exercises || []).map((ex, i) => {
                                  const exId = typeof ex === 'string' ? ex : ex?.id;
                                  return (
                                    <div key={i} className="flex items-center justify-between">
                                      <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}><span className="mr-1.5" style={{ color: 'var(--color-text-subtle)' }}>{i + 1}.</span>{exName(exerciseNameMap[exId]) ?? exId}</p>
                                      {ex.sets && <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{ex.sets} {t('workouts.sets')}</p>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl py-10 text-center flex flex-col items-center gap-2" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                    <Dumbbell size={24} style={{ color: 'var(--color-text-subtle)', opacity: 0.4 }} />
                    <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noPreviewAvailable')}</p>
                  </div>
                );
              }
              return (
              <>
                {weekRoutines.length > 0 && (
                  <div className="space-y-2">
                    {weekRoutines.map(routine => {
                      const isExpanded = expandedProgramRoutineId === routine.id;
                      const scheduledDow = routine._displayDow ?? workoutScheduleMap[routine.id];
                      const DOW_LABELS = [
                        t('days.sun', { ns: 'common' }), t('days.mon', { ns: 'common' }), t('days.tue', { ns: 'common' }),
                        t('days.wed', { ns: 'common' }), t('days.thu', { ns: 'common' }), t('days.fri', { ns: 'common' }), t('days.sat', { ns: 'common' }),
                      ];
                      const dayLabel = scheduledDow !== undefined ? DOW_LABELS[scheduledDow] : null;
                      const isToday = isViewingCurrentWeek && scheduledDow !== undefined && scheduledDow === new Date().getDay();
                      // Look up completion for THIS specific viewed week, not just today.
                      // Past weeks now show green checks for routines done that week.
                      const isCompleted = completedByWeek.has(`${viewWeek}::${routine.id}`)
                        || (isViewingCurrentWeek && todayCompletedRoutineIds.has(routine.id));

                      // Today's routine → dark "UP NEXT" card
                      if (isToday && !isCompleted) {
                        return (
                          <div key={routine.id}>
                            <div className="rounded-[18px] p-4" style={{ background: '#1a1a1e', color: '#fff' }}>
                              <div className="flex items-center gap-1.5 mb-2">
                                <p className="text-[10px] font-bold uppercase" style={{ color: TU_ACCENT, letterSpacing: '0.08em' }}>
                                  {t('workouts.upNext', 'UP NEXT')} {'\u00B7'} {t('workouts.today', 'TODAY')}
                                </p>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
                                    style={{ background: 'rgba(255,255,255,0.1)' }}>
                                    <Dumbbell size={16} style={{ color: 'rgba(255,255,255,0.7)' }} strokeWidth={2} />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-bold text-[15px] truncate" style={{ color: '#fff', letterSpacing: -0.2 }}>{localizeRoutineName(routine.name)}</p>
                                    <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{routine.exerciseCount} {t('workouts.exercises')} {'\u00B7'} {routine.estimatedMin || '~45'} {t('dashboard.min', 'min')}</p>
                                  </div>
                                </div>
                                <Link
                                  to={`/session/${routine.id}`}
                                  onClick={() => posthog?.capture('routine_started', { routine_name: routine.name })}
                                  className="px-5 py-2.5 rounded-[12px] text-[13px] font-bold flex-shrink-0 active:scale-95 transition-all"
                                  style={{ background: TU_ACCENT, color: 'var(--color-text-on-accent, #001512)' }}
                                >
                                  {t('workouts.start', 'START')}
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Other routines → clean row with day on right
                      return (
                        <div key={routine.id}>
                          <button
                            type="button"
                            onClick={() => setExpandedProgramRoutineId(isExpanded ? null : routine.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-[16px] transition-colors duration-200 text-left"
                            style={{ background: isExpanded ? 'var(--color-surface-hover, rgba(0,0,0,0.04))' : 'transparent' }}
                          >
                            {/* Completed check or dumbbell */}
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ background: isCompleted ? `color-mix(in srgb, ${TU_ACCENT} 15%, transparent)` : 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                              {isCompleted
                                ? <CheckCircle2 size={16} style={{ color: TU_ACCENT }} strokeWidth={2} />
                                : <Dumbbell size={14} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{localizeRoutineName(routine.name)}</p>
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{routine.exerciseCount} {t('workouts.exercises')}</p>
                            </div>
                            {dayLabel && (
                              <span className="text-[11px] font-bold uppercase flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                                {dayLabel}
                              </span>
                            )}
                            <ChevronRight size={14} className={`flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-subtle)' }} strokeWidth={2} />
                          </button>
                          {isExpanded && (
                            <RoutineDetail routineId={routine.id} onEdit={() => navigate(`/workouts/${routine.id}/edit`)} onDelete={(e) => handleDelete(e, routine.id)} deletingId={deletingId} onStart={() => posthog?.capture('routine_started', { routine_name: routine.name })} />
                          )}
                        </div>
                      );
                    })}
                    {generatedProgram?.cardio_days?.daysPerWeek > 0 && (
                      <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                          <Heart size={15} style={{ color: 'var(--color-text-muted)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.activeRecovery')}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{generatedProgram.cardio_days.description}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </>
              );
            })()}
            </div>
            {/* Regenerate this program — small footer link inside the card */}
            <div className="px-5 pb-4 pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setRegenerateConfirm(true)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] rounded-md px-2 py-1"
                style={{ color: 'var(--color-text-muted)', letterSpacing: 0.4 }}
              >
                <RotateCcw size={12} strokeWidth={2.4} />
                {t('workouts.regenerateProgram', 'Regenerar programa')}
              </button>
            </div>
          </div>
        </section>
        );
      })()}

      {/* ── No program / expired — two options ──────────────── */}
      {!programLoading && !programActive && (
        <section className="mb-10">
          <p className="text-[10px] font-bold uppercase mb-3 px-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
            {programExpired ? t('workouts.programEndedWhatsNext') : t('workouts.getStarted')}
          </p>

          {/* Primary CTA — Generate a program */}
          <button
            onClick={() => setShowGenerator(true)}
            className="w-full text-left rounded-[22px] p-5 mb-3 active:scale-[0.98] transition-transform duration-150"
            style={{ background: `color-mix(in srgb, ${TU_ACCENT} 6%, var(--color-bg-card))`, boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0"
                style={{ background: `color-mix(in srgb, ${TU_ACCENT} 15%, transparent)` }}>
                <Zap size={22} style={{ color: TU_ACCENT }} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{t('workouts.customProgram')}</p>
                <p className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--color-text-muted)' }}>{t('workouts.builtAroundGoals')}</p>
              </div>
              <ChevronRight size={16} style={{ color: TU_ACCENT }} strokeWidth={2} className="flex-shrink-0" />
            </div>
          </button>

          {/* Secondary — Browse templates */}
          <button
            onClick={() => goToView('browse')}
            className="w-full flex items-center gap-3 px-5 py-3.5 rounded-[16px] text-left active:scale-[0.98] transition-transform duration-150"
            style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}
          >
            <BookOpen size={16} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t('workouts.browsePrograms')}</p>
            <ChevronRight size={14} style={{ color: 'var(--color-text-subtle)' }} strokeWidth={2} className="ml-auto flex-shrink-0" />
          </button>
        </section>
      )}

      {/* Hub entry — A2: two count cards with name-peek + ACTIVO badge */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {[
          { key: 'routines', label: t('workouts.myRoutines'), n: routines.length, accentNum: false,
            peek: routines.slice(0, 3).map(r => localizeRoutineName(r.name)) },
          { key: 'myPrograms', label: t('workouts.myPrograms'), n: allPrograms.length, accentNum: true,
            peek: allPrograms.slice(0, 3).map(p => gpName(p)), active: programActive },
        ].map((card) => (
          <button
            key={card.key}
            onClick={() => goToView(card.key)}
            className="flex flex-col gap-2.5 p-3.5 rounded-3xl text-left active:scale-[0.98] transition-transform duration-150"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
          >
            <div className="flex items-baseline justify-between">
              <span style={{ fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 38, lineHeight: 0.9, letterSpacing: -1.3, color: card.accentNum ? TU_ACCENT : 'var(--color-text-primary)' }}>{card.n}</span>
              {card.active && (
                <span className="px-2 py-1 rounded-full" style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: '#10B981', background: 'rgba(16,185,129,0.14)' }}>1 ACTIVO</span>
              )}
            </div>
            <span style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 15, letterSpacing: -0.3, color: 'var(--color-text-primary)' }}>{card.label}</span>
            <div className="pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              {(card.peek.length ? card.peek : ['—']).map((p, i) => (
                <p key={i} className="truncate" style={{ fontSize: 11, padding: '3px 0', fontWeight: i === 0 ? 700 : 500, color: i === 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{p}</p>
              ))}
            </div>
            <span className="flex items-center gap-1" style={{ fontSize: 11, fontWeight: 700, color: TU_ACCENT }}>
              {t('workouts.viewAll', 'View all')} <ChevronRight size={12} strokeWidth={2.4} />
            </span>
          </button>
        ))}
      </div>

      {/* Explorar Programas — bold CTA (dark + accent glow) */}
      <button
        onClick={() => goToView('browse')}
        className="relative w-full overflow-hidden flex items-center gap-3.5 p-5 rounded-3xl text-left active:scale-[0.99] transition-transform duration-150 mb-10"
        style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 18%, var(--color-bg-card)), var(--color-bg-card))', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' }}
      >
        <div className="absolute pointer-events-none" style={{ top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 40%, transparent) 0%, transparent 70%)' }} />
        <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 48, height: 48, borderRadius: 14, background: TU_ACCENT, color: 'var(--color-text-on-accent, var(--color-bg-primary))' }}>
          <BookOpen size={22} strokeWidth={2.4} />
        </div>
        <div className="relative flex-1 min-w-0">
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1.6, textTransform: 'uppercase', color: TU_ACCENT }}>{t('workouts.discover', 'Discover')}</p>
          <p style={{ fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 19, letterSpacing: -0.5, marginTop: 3, color: 'var(--color-text-primary)' }}>{t('workouts.browsePrograms', 'Browse programs')}</p>
          <p style={{ fontSize: 11, marginTop: 2, color: 'var(--color-text-muted)' }}>{t('workouts.browseSubCount', { count: programTemplates.length || 0, defaultValue: '{{count}} available · 4 to 16 weeks' })}</p>
        </div>
        <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 999, background: TU_ACCENT, color: 'var(--color-text-on-accent, var(--color-bg-primary))' }}>
          <ChevronRight size={18} strokeWidth={2.6} />
        </div>
      </button>
      </>)}

      {/* ── ROUTINES VIEW ── */}
      {workoutsView === 'routines' && (<>
      {/* ════════════════════════════════════════════════════════
          SECTION 2: MY ROUTINES
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4 px-1">
          <p style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{t('workouts.myRoutines')}</p>
          <div className="flex items-center gap-1.5">
            {routineSelectMode ? (
              <>
                <button
                  onClick={() => selectedRoutineIds.size > 0 && setBulkDeleteConfirm({ kind: 'routines', count: selectedRoutineIds.size })}
                  disabled={selectedRoutineIds.size === 0}
                  className="flex items-center gap-1 text-[12px] font-bold min-h-[44px] px-2.5 py-1 rounded-full whitespace-nowrap disabled:opacity-40"
                  style={{ color: '#F87171', background: 'rgba(248,113,113,0.12)' }}
                >
                  <Trash2 size={12} strokeWidth={2.4} />
                  {t('workouts.deleteSelected', { count: selectedRoutineIds.size, defaultValue: 'Delete ({{count}})' })}
                </button>
                <button
                  onClick={exitRoutineSelect}
                  className="text-[12px] font-bold min-h-[44px] px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.cancel', 'Cancel')}
                </button>
              </>
            ) : (
              <>
                {routines.length > 0 && (
                  <button
                    onClick={() => setRoutineSelectMode(true)}
                    className="text-[12px] font-bold min-h-[44px] px-2.5 py-1 rounded-full whitespace-nowrap"
                    style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover)' }}
                  >
                    {t('workouts.select', 'Select')}
                  </button>
                )}
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1 text-[12px] font-bold min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ color: TU_ACCENT, background: `color-mix(in srgb, ${TU_ACCENT} 12%, transparent)` }}
                >
                  <Plus size={12} strokeWidth={2.4} />
                  {t('workouts.newRoutine', 'New routine')}
                </button>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <Skeleton variant="list-item" count={3} />
        ) : routines.length === 0 ? (
          <EmptyState
            icon={Dumbbell}
            title={t('workouts.emptyTitle')}
            description={t('workouts.emptyDescription')}
            actionLabel={t('workouts.createRoutine')}
            onAction={() => setShowCreateModal(true)}
            compact
          />
        ) : (() => {
          const visible = showAllRoutines ? routines : routines.slice(0, 4);
          const hiddenCount = routines.length - 4;
          return (
            <>
              <div className="grid grid-cols-2 gap-3">
                {visible.map(routine => {
                  const active = isActiveRoutine(routine);
                  const selected = selectedRoutineIds.has(routine.id);
                  return (
                    <div key={routine.id} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (routineSelectMode) { if (!active) toggleRoutineSel(routine.id); return; }
                          setExpandedRoutineId(routine.id);
                        }}
                        className="w-full text-left p-4 rounded-[18px] transition-colors duration-200"
                        style={{
                          background: active ? 'color-mix(in srgb, #10B981 12%, var(--color-bg-card))' : 'var(--color-bg-card)',
                          border: active
                            ? '1px solid color-mix(in srgb, #10B981 45%, transparent)'
                            : (routineSelectMode && selected ? '1px solid var(--color-accent)' : '1px solid transparent'),
                          boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.04)',
                        }}
                      >
                        <div className="w-9 h-9 rounded-[12px] flex items-center justify-center mb-3"
                          style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                          <Dumbbell size={16} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
                        </div>
                        <p className="font-bold text-[14px] truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{localizeRoutineName(routine.name)}</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                          {t('workouts.exercisesPerWeek', { count: routine.exerciseCount, defaultValue: '{{count}} exercises / week' })}
                        </p>
                        {active && (
                          <span className="inline-flex items-center gap-1 mt-2 text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ color: '#10B981', background: 'rgba(16,185,129,0.12)' }}>
                            <Lock size={9} /> {t('workouts.active')}
                          </span>
                        )}
                      </button>
                      {routineSelectMode && (
                        <span className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none" style={{ background: 'var(--color-bg-card)' }}>
                          {active
                            ? <Lock size={14} style={{ color: 'var(--color-text-subtle)' }} />
                            : selected
                              ? <CheckCircle2 size={18} style={{ color: 'var(--color-accent)' }} />
                              : <Circle size={18} style={{ color: 'var(--color-text-subtle)' }} />}
                        </span>
                      )}
                    </div>
                  );
                })}
                {/* New routine card */}
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="p-4 rounded-[18px] border-2 border-dashed flex flex-col items-center justify-center gap-2 min-h-[110px] transition-colors"
                  style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
                >
                  <Plus size={20} strokeWidth={1.5} />
                  <span className="text-[12px] font-semibold">{t('workouts.newRoutine', 'New routine')}</span>
                </button>
              </div>
              {!showAllRoutines && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllRoutines(true)}
                  className="w-full mt-3 py-3 rounded-[16px] text-[12px] font-semibold transition-colors duration-200"
                  style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}
                >
                  {t('workouts.showAllRoutines', { count: routines.length })}
                </button>
              )}
              {showAllRoutines && routines.length > 4 && (
                <button
                  onClick={() => setShowAllRoutines(false)}
                  className="w-full mt-3 py-3 rounded-[16px] text-[12px] font-semibold transition-colors duration-200"
                  style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}
                >
                  {t('workouts.showLess')}
                </button>
              )}
            </>
          );
        })()}

        {/* Sugeridas — app-provided starter routines (become real, deletable routines) */}
        {(() => {
          const existing = new Set(routines.map(r => (r.name || '').toLowerCase()));
          const avail = STARTER_ROUTINES.filter(s => !existing.has((i18n.language === 'es' ? s.nameEs : s.nameEn).toLowerCase()));
          if (avail.length === 0) return null;
          return (
            <div className="mt-8">
              <p className="text-[10px] font-bold uppercase mb-3 px-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>{t('workouts.gymQuickRoutines', 'Gym Quick Routines')}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {avail.map(s => (
                  <button
                    key={s.key}
                    onClick={() => handleAddStarter(s)}
                    disabled={addingStarter === s.key}
                    className="flex flex-col items-start gap-2.5 p-4 rounded-2xl text-left active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 min-h-[132px]"
                    style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${TU_ACCENT} 12%, transparent)`, color: TU_ACCENT }}>
                      <Dumbbell size={18} strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{i18n.language === 'es' ? s.nameEs : s.nameEn}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t(`workouts.${s.subKey}`, s.subKey)} · {s.ex.length} {t('workouts.exercises')}</p>
                    </div>
                    <span className="flex items-center gap-1 mt-auto" style={{ fontSize: 12, fontWeight: 700, color: TU_ACCENT }}>
                      {addingStarter === s.key ? '…' : <><Plus size={13} strokeWidth={2.6} /> {t('workouts.add', 'Add')}</>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

      </>)}

      {/* ── MY PROGRAMS VIEW ── */}
      {workoutsView === 'myPrograms' && (<>
      {/* ════════════════════════════════════════════════════════
          SECTION 3: MY PROGRAMS
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4 px-1">
          <p style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{t('workouts.myPrograms')}</p>
          <div className="flex items-center gap-1.5">
            {programSelectMode ? (
              <>
                <button
                  onClick={() => selectedProgramIds.size > 0 && setBulkDeleteConfirm({ kind: 'programs', count: selectedProgramIds.size })}
                  disabled={selectedProgramIds.size === 0}
                  className="flex items-center gap-1 px-2.5 py-1 min-h-[44px] rounded-full text-[12px] font-bold transition-colors disabled:opacity-40"
                  style={{ color: '#F87171', background: 'rgba(248,113,113,0.12)' }}
                >
                  <Trash2 size={12} strokeWidth={2.4} />
                  {t('workouts.deleteSelected', { count: selectedProgramIds.size, defaultValue: 'Delete ({{count}})' })}
                </button>
                <button
                  onClick={exitProgramSelect}
                  className="px-2.5 py-1 min-h-[44px] rounded-full text-[12px] font-bold whitespace-nowrap"
                  style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.cancel', 'Cancel')}
                </button>
              </>
            ) : (
              <>
                {allPrograms.length > 0 && (
                  <button
                    onClick={() => setProgramSelectMode(true)}
                    className="px-2.5 py-1 min-h-[44px] rounded-full text-[12px] font-bold whitespace-nowrap"
                    style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover)' }}
                  >
                    {t('workouts.select', 'Select')}
                  </button>
                )}
                {programActive && generatedProgram && (
                  <button
                    onClick={() => { setBuilderProgram(generatedProgram); setShowBuilder(true); }}
                    className="flex items-center gap-1 px-2.5 py-1 min-h-[44px] rounded-full text-[12px] font-bold transition-colors whitespace-nowrap"
                    style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
                  >
                    <Pencil size={12} strokeWidth={2.4} />
                    {t('workouts.editProgram', 'Edit')}
                  </button>
                )}
                <button
                  onClick={() => setShowGenerator(true)}
                  className="flex items-center gap-1 px-2.5 py-1 min-h-[44px] rounded-full text-[12px] font-bold transition-colors whitespace-nowrap"
                  style={{ background: `color-mix(in srgb, ${TU_ACCENT} 12%, transparent)`, color: TU_ACCENT }}
                >
                  <Zap size={12} strokeWidth={2.4} />
                  {t('workouts.newProgram')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Goals mismatch alert */}
        {goalsMismatch && programActive && (
          <div className="rounded-2xl bg-amber-500/[0.06] p-4 mb-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.goalsChanged')}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.goalsChangedDesc')}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setShowGenerator(true)} className="px-3 py-1.5 min-h-[44px] rounded-lg text-[11px] font-semibold text-[var(--color-text-on-secondary,#fff)]" style={{ background: '#10B981' }}>
                  {t('workouts.newProgramBtn')}
                </button>
                <button onClick={() => setGoalsMismatch(false)} className="px-3 py-1.5 min-h-[44px] rounded-lg text-[11px] font-medium transition-colors" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('workouts.dismiss')}
                </button>
              </div>
            </div>
          </div>
        )}

        {allPrograms.length === 0 ? (
          <div className="rounded-2xl py-12 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
            <Zap size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-subtle)' }} />
            <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noProgramsYet')}</p>
            <p className="text-[11px] mt-1 mb-4" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.createOneTailored')}</p>
            <button
              onClick={() => setShowGenerator(true)}
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold text-[var(--color-text-on-secondary,#fff)] transition-colors" style={{ background: '#10B981' }}
            >
              {t('workouts.createYourFirstProgram')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {(showAllMyPrograms ? allPrograms : allPrograms.slice(0, 3)).map(prog => {
              // Only the page-canonical current program (newest with future
              // expires_at, mirrored in `generatedProgram`) is rendered as
              // "Activo". Older rows whose DB-level expires_at didn't get
              // pushed back during regenerate stay labeled "completed/
              // unfinished" so the list can't show two active programs.
              const isActive = prog.id === generatedProgram?.id && new Date(prog.expires_at) > new Date();
              const progTotalWeeks = getTotalProgramWeeks(prog) || 6;
              const weekNum = isActive ? getCurrentWeekClamped(prog) : progTotalWeeks;
              const totalDays = progTotalWeeks * 7;
              const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), totalDays);
              const progress = Math.round((daysElapsed / totalDays) * 100);
              const selected = selectedProgramIds.has(prog.id);

              return (
                <div key={prog.id} className="relative rounded-2xl transition-colors duration-200 group" style={{
                  backgroundColor: isActive ? 'color-mix(in srgb, #10B981 10%, var(--color-surface-hover))' : 'var(--color-surface-hover)',
                  border: isActive
                    ? '1px solid color-mix(in srgb, #10B981 40%, transparent)'
                    : (programSelectMode && selected ? '1px solid var(--color-accent)' : '1px solid transparent'),
                }}>
                  <button onClick={() => {
                    if (programSelectMode) { if (!isActive) toggleProgramSel(prog.id); return; }
                    loadExerciseNames(); setSelectedMyProgram(prog); setMyProgWeek('1');
                  }} className="w-full text-left p-5" aria-label={`View program: ${gpName(prog)}`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <p className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {t('workouts.programSuffix', { name: gpName(prog) })}
                        </p>
                        {isActive && (
                          <span className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 px-2 py-0.5 rounded-full flex-shrink-0">{t('workouts.active')}</span>
                        )}
                        {!isActive && (
                          <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${progress >= 95 ? '' : 'text-amber-400 bg-amber-500/10'}`} style={progress >= 95 ? { color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' } : undefined}>
                            {progress >= 95 ? t('workouts.completed') : t('workouts.unfinished')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
                      <span className="flex items-center gap-1"><Calendar size={10} /> {t('workouts.weekProgram', { count: progTotalWeeks })}</span>
                      <span>{isActive ? t('workouts.weekXOfY', { current: weekNum, total: progTotalWeeks }) : t('workouts.finished')}</span>
                      {prog.routines_a_count > 0 && <span>{t('workouts.routinesCount', { count: prog.routines_a_count })}</span>}
                    </div>
                    <div className="w-full h-1 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                      <div
                        className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : ''}`}
                        style={{ width: `${progress}%`, ...(!isActive ? { backgroundColor: 'var(--color-text-subtle)' } : {}) }}
                      />
                    </div>
                  </button>
                  {/* Reactivate (resume) past program — pick up at the
                       calendar week the user was on when it expired.
                       Hidden for the canonical active program and for
                       legacy rows without persisted routine_ids. */}
                  {!programSelectMode && !isActive && (prog.schedule_map?.routine_ids?.length > 0) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setReactivateConfirm(prog);
                      }}
                      className="absolute top-3 right-12 min-w-[44px] min-h-[44px] w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#10B981]/10 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-surface-hover)', color: '#10B981' }}
                      aria-label={t('workouts.ariaReactivateProgram', 'Resume program')}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                  {/* Delete program (single) — hidden in multi-select mode */}
                  {!programSelectMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLeaveProgramConfirm({ id: prog.id, name: prog.split_type, isActive });
                      }}
                      className="absolute top-3 right-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-400 hover:bg-red-500/10 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                      aria-label={t('workouts.ariaDeleteProgram', 'Delete program')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {/* Multi-select checkbox / lock (active program can't be deleted) */}
                  {programSelectMode && (
                    <span className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none" style={{ background: 'var(--color-surface-hover)' }}>
                      {isActive
                        ? <Lock size={15} style={{ color: 'var(--color-text-subtle)' }} />
                        : selected
                          ? <CheckCircle2 size={19} style={{ color: 'var(--color-accent)' }} />
                          : <Circle size={19} style={{ color: 'var(--color-text-subtle)' }} />}
                    </span>
                  )}
                </div>
              );
            })}
            {!showAllMyPrograms && allPrograms.length > 3 && (
              <button
                onClick={() => setShowAllMyPrograms(true)}
                className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold transition-colors duration-200"
                style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
              >
                {t('workouts.showAllPrograms', { count: allPrograms.length })}
              </button>
            )}
            {showAllMyPrograms && allPrograms.length > 3 && (
              <button
                onClick={() => setShowAllMyPrograms(false)}
                className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold transition-colors duration-200"
                style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
              >
                {t('workouts.showLess')}
              </button>
            )}
          </div>
        )}

      </section>

      </>)}

      {/* ── BROWSE PROGRAMS VIEW ── */}
      {workoutsView === 'browse' && (<>
      {/* ════════════════════════════════════════════════════════
          SECTION 4: DISCOVER PROGRAMS
         ════════════════════════════════════════════════════════ */}
      <section id="discover-programs" className="mb-6">
        {/* B1 header — label + big title + small "Todos" link */}
        <div className="mb-4 px-1 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>{t('workouts.discover')}</p>
            <h2 style={{ fontFamily: TU_DISPLAY, fontSize: 32, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>{browseTitle}</h2>
          </div>
          {browseSection === null && programTemplates.length > 0 && (
            <button onClick={() => openBrowseSection('all')} className="flex items-center gap-1 py-1 flex-shrink-0" style={{ fontSize: 11, fontWeight: 700, color: TU_ACCENT }}>
              {t('workouts.browseAll', 'All')} · {programTemplates.length} <ChevronRight size={11} strokeWidth={2.2} />
            </button>
          )}
        </div>

        {/* Magazine landing (no section selected) */}
        {browseSection === null && (
          <>
            {/* Recommended hero */}
            {recommendedTemplate && (
              <button
                onClick={() => { loadExerciseNames(); setSelectedTemplate(recommendedTemplate); setTemplateWeek('1'); }}
                className="relative w-full overflow-hidden rounded-[22px] mb-5 text-left active:scale-[0.99] transition-transform"
                style={{ aspectRatio: '1 / 1', background: 'var(--color-bg-deep, #0e0d0a)' }}
              >
                {recommendedTemplate.image && (
                  <img src={programImageUrl(recommendedTemplate.image)} alt={progName(recommendedTemplate)} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                )}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.88) 100%)' }} />
                <div className="absolute" style={{ top: 14, left: 14 }}>
                  <span style={{ background: TU_ACCENT, color: 'var(--color-text-on-accent, var(--color-bg-primary))', fontSize: 9, fontWeight: 900, letterSpacing: 1, padding: '5px 9px', borderRadius: 999 }}>{t('workouts.recommendedForYou')}</span>
                </div>
                <div className="absolute left-4 right-4" style={{ bottom: 14, color: '#fff' }}>
                  <p style={{ fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 24, letterSpacing: -0.7, lineHeight: 1.05 }}>{progName(recommendedTemplate)}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.78)' }}>
                      {t(`workouts.programLevels.${recommendedTemplate.level}`, recommendedTemplate.level)} · {t('workouts.durationWk', { count: recommendedTemplate.durationWeeks })} · {t('workouts.xPerWeek', { count: recommendedTemplate.daysPerWeek })}
                    </span>
                    <span className="flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 999, background: TU_ACCENT, color: 'var(--color-text-on-accent, var(--color-bg-primary))' }}>
                      <ChevronRight size={16} strokeWidth={2.4} />
                    </span>
                  </div>
                </div>
              </button>
            )}

            {/* POR NIVEL */}
            <div className="mb-3 px-1">
              <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>{t('workouts.byLevel', 'By level')}</p>
              <p style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 17, color: 'var(--color-text-primary)', letterSpacing: -0.4 }}>{t('workouts.startHere', 'Start here')}</p>
            </div>
            <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1 mb-7">
              {[
                { key: 'Beginner', sub: t('workouts.levelSubBeginner', 'Just getting started'), tint: 'rgba(16,185,129,0.14)', col: '#10B981' },
                { key: 'Intermediate', sub: t('workouts.levelSubIntermediate', '6+ months training'), tint: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', col: TU_ACCENT },
                { key: 'Advanced', sub: t('workouts.levelSubAdvanced', '2+ years strong'), tint: 'var(--color-surface-hover)', col: 'var(--color-text-primary)' },
              ].map(c => (
                <button key={c.key} onClick={() => openBrowseSection(c.key)} className="flex-shrink-0 text-left p-3.5 rounded-2xl active:scale-[0.98] transition-transform" style={{ width: 168, background: c.tint }}>
                  <div style={{ fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 32, letterSpacing: -1, lineHeight: 0.95, color: c.col }}>{levelCounts[c.key]}</div>
                  <div style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 15, letterSpacing: -0.3, marginTop: 6, color: 'var(--color-text-primary)' }}>{t(`workouts.programLevels.${c.key}`, c.key)}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{c.sub}</div>
                </button>
              ))}
            </div>

            {/* PARA TI */}
            {scoredTemplates.length > 0 && (
              <>
                <div className="mb-3 px-1">
                  <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>{t('workouts.forYou', 'For you')}</p>
                  <p style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 17, color: 'var(--color-text-primary)', letterSpacing: -0.4 }}>{t('workouts.basedOnGoals', 'Based on your goals')}</p>
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1 mb-7">
                  {scoredTemplates.slice(0, 6).map(tmpl => (
                    <button key={tmpl.id} onClick={() => { loadExerciseNames(); setSelectedTemplate(tmpl); setTemplateWeek('1'); }} className="flex-shrink-0 text-left active:scale-[0.98] transition-transform" style={{ width: 190 }}>
                      <div className="relative rounded-2xl overflow-hidden" style={{ aspectRatio: '3 / 4', background: 'var(--color-bg-deep, #0e0d0a)' }}>
                        {tmpl.image && <img src={programImageUrl(tmpl.image)} alt={progName(tmpl)} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />}
                        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.1) 60%)' }} />
                        <div className="absolute left-3 right-3" style={{ bottom: 12 }}>
                          <p style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: -0.3, lineHeight: 1.1 }}>{progName(tmpl)}</p>
                          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>{t('workouts.durationWk', { count: tmpl.durationWeeks })} · {t('workouts.xPerWeek', { count: tmpl.daysPerWeek })}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* POR TIEMPO */}
            <div className="mb-3 px-1">
              <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>{t('workouts.byTime', 'By time')}</p>
              <p style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 17, color: 'var(--color-text-primary)', letterSpacing: -0.4 }}>{t('workouts.howMuchTime', 'How much can you commit')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 mb-7">
              {[
                { key: 'express', icon: Zap, label: t('workouts.timeExpressLabel', 'Express'), sub: '≤20 min' },
                { key: 'rapidas', icon: Clock, label: t('workouts.timeRapidasLabel', 'Quick'), sub: '~30 min' },
                { key: 'estandar', icon: Target, label: t('workouts.timeEstandarLabel', 'Standard'), sub: '45–60 min' },
                { key: 'largas', icon: Activity, label: t('workouts.timeLargasLabel', 'Long'), sub: '75+ min' },
              ].map(c => (
                <button key={c.key} onClick={() => openBrowseSection(c.key)} className="text-left p-3.5 rounded-2xl active:scale-[0.98] transition-transform" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex items-center justify-between">
                    <c.icon size={18} style={{ color: TU_ACCENT }} />
                    <span style={{ fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 18, color: 'var(--color-text-primary)', letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>{timeCounts[c.key]}</span>
                  </div>
                  <div style={{ fontFamily: TU_DISPLAY, fontWeight: 800, fontSize: 14, letterSpacing: -0.3, marginTop: 6, color: 'var(--color-text-primary)' }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{c.sub}</div>
                </button>
              ))}
            </div>

            {/* GYM EXCLUSIVE — hero treatment */}
            {gymPrograms.length > 0 && (
              <button
                onClick={() => openBrowseSection('gym')}
                className="relative w-full overflow-hidden rounded-[22px] text-left mb-2 active:scale-[0.99] transition-transform"
                style={{ padding: 18, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-card)), var(--color-bg-card))', border: '1.5px solid color-mix(in srgb, var(--color-accent) 45%, transparent)' }}
              >
                <div className="absolute pointer-events-none" style={{ top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 35%, transparent) 0%, transparent 70%)' }} />
                <div className="relative flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: 6, background: TU_ACCENT }}>
                    <Zap size={12} style={{ color: 'var(--color-text-on-accent, var(--color-bg-primary))' }} fill="currentColor" strokeWidth={0} />
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: 1.4, color: TU_ACCENT }}>{t('workouts.exclusiveOfYourGym', 'Exclusive to your gym')}</span>
                </div>
                <p className="relative" style={{ fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 21, letterSpacing: -0.6, lineHeight: 1.12, color: 'var(--color-text-primary)' }}>{t('workouts.gymExclusiveTitle', 'Programs built by your coaches')}</p>
                <p className="relative" style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>{t('workouts.gymExclusiveSub', { count: gymPrograms.length, defaultValue: '{{count}} programs · members only' })}</p>
                <div className="relative mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  {gymPrograms.slice(0, 2).map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2.5 py-2" style={i > 0 ? { borderTop: '1px solid var(--color-border-subtle)' } : undefined}>
                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ fontFamily: TU_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: -0.2, color: 'var(--color-text-primary)' }}>{p.name}</p>
                        <p style={{ fontSize: 10, color: 'var(--color-text-subtle)' }}>{t('workouts.durationWk', { count: p.duration_weeks || 6 })}</p>
                      </div>
                      <ChevronRight size={13} style={{ color: 'var(--color-text-subtle)' }} />
                    </div>
                  ))}
                </div>
                <span className="relative flex items-center justify-center gap-1.5 mt-3.5 w-full" style={{ padding: '11px 14px', borderRadius: 12, background: TU_ACCENT, color: 'var(--color-text-on-accent, var(--color-bg-primary))', fontFamily: TU_DISPLAY, fontWeight: 900, fontSize: 12, letterSpacing: 0.5 }}>
                  {t('workouts.seeAllGymPrograms', { count: gymPrograms.length, defaultValue: 'See all {{count}} programs' })}
                  <ChevronRight size={13} strokeWidth={2.6} />
                </span>
              </button>
            )}
          </>
        )}

        {/* Programs for the selected section */}
        {browseSection !== null && (
        <div className="grid grid-cols-2 gap-4">
          {(() => {
            // Gym Exclusive filter shows only gym programs
            if (programCategoryFilter === 'Gym Exclusive') {
              if (gymPrograms.length === 0) {
                return (
                  <div className="col-span-2 rounded-2xl py-10 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                    <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t('workouts.noGymExclusives', 'No gym exclusive programs available')}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noGymExclusivesHint', 'Check back later for programs from your gym')}</p>
                  </div>
                );
              }
              return gymPrograms.map(prog => {
                // Stable cover: explicit preset, else derived from id so it's never blank/ugly.
                const presetKey = prog.cover_preset || (() => { const id = String(prog.id || ''); let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return CLASS_COVERS[h % CLASS_COVERS.length]?.key; })();
                const cover = CLASS_COVERS.find(c => c.key === presetKey) || CLASS_COVERS[0];
                const CoverIcon = cover.icon;
                const imgUrl = prog.image_path ? classImageUrl(prog.image_path) : null;
                return (
                  <button
                    key={prog.id}
                    onClick={() => { loadExerciseNames(); setSelectedTemplate({ ...prog, id: `gym_${prog.id}`, image: null, level: 'All Levels', daysPerWeek: prog.weeks?.['1']?.length || 5, durationWeeks: prog.duration_weeks || 6, category: 'Gym Exclusive' }); setTemplateWeek('1'); }}
                    className="relative text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-150"
                    style={{ aspectRatio: '3 / 4', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
                    aria-label={`${progName(prog)} - Gym Exclusive program`}
                  >
                    {imgUrl ? (
                      <img src={imgUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <>
                        <div className="absolute inset-0" style={{ background: cover.gradient }} />
                        <CoverIcon size={62} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/15" />
                      </>
                    )}
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.80), rgba(0,0,0,0.18) 55%, rgba(0,0,0,0.05))' }} />
                    <div className="absolute top-3 left-3 z-10">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff' }}>
                        {t('workouts.gymExclusive', 'Gym Exclusive')}
                      </span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
                      <p className="text-[14px] font-bold leading-tight" style={{ color: '#fff' }}>{progName(prog)}</p>
                      {prog.description && <p className="text-[10px] mt-1 line-clamp-2" style={{ color: 'rgba(255,255,255,0.85)' }}>{progDesc(prog)}</p>}
                      <p className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {t('workouts.programDuration', { weeks: prog.duration_weeks || 6, days: prog.weeks?.['1']?.length || '?', defaultValue: '{{weeks}} weeks, {{days}} days/wk' })}
                      </p>
                    </div>
                  </button>
                );
              });
            }

            const filtered = programTemplates
              .filter(p => programCategoryFilter === 'All' || p.category === programCategoryFilter)
              .filter(p => programLevelFilter === 'All' || p.level === programLevelFilter)
              .filter(p => {
                if (programDurationFilter === 'all') return true;
                const [lo, hi] = TIME_BUCKETS[programDurationFilter] || [0, 9999];
                const m = estimateTemplateSessionMin(p) ?? 999;
                return m >= lo && m <= hi;
              });
            // Score and sort: recommended first, then by category
            const scored = filtered.map(tmpl => ({
              tmpl,
              score: scoreProgram(tmpl, onboardingData),
            }));
            scored.sort((a, b) => b.score - a.score);
            // Top 3 with score >= 70 get the recommended badge
            let recommendedCount = 0;
            const withBadge = scored.map(item => ({
              ...item,
              isRecommended: item.score >= 70 && (recommendedCount++ < 3),
            }));
            return withBadge.map(({ tmpl, isRecommended }) => (
              <button
                key={tmpl.id}
                onClick={() => { loadExerciseNames(); setSelectedTemplate(tmpl); setTemplateWeek('1'); }}
                className="relative text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-150 group"
                style={{ aspectRatio: '3 / 4' }}
                aria-label={`${progName(tmpl)} - ${tmpl.level} program`}
              >
                {/* Background image */}
                <div className="absolute inset-0">
                  {tmpl.image && (
                    <img
                      src={programImageUrl(tmpl.image)}
                      alt={progName(tmpl)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom right, var(--color-bg-deep), var(--color-bg-primary))', zIndex: tmpl.image ? -1 : 0 }} />
                </div>

                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/10" />

                {/* Level badge — forced colors because it's on an image */}
                <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 items-start">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-sm"
                    style={{
                      backgroundColor: tmpl.level === 'Beginner' ? 'rgba(16,185,129,0.2)' : tmpl.level === 'Advanced' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)',
                      color: tmpl.level === 'Beginner' ? '#6EE7B7' : tmpl.level === 'Advanced' ? '#FCA5A5' : 'rgba(255,255,255,0.7)',
                    }}>
                    {t(`workouts.programLevels.${tmpl.level}`, tmpl.level)}
                  </span>
                  {isRecommended && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-sm"
                      style={{ backgroundColor: 'rgba(212,175,55,0.25)', color: 'var(--color-accent)' }}>
                      {t('workouts.recommendedForYou')}
                    </span>
                  )}
                </div>

                {/* Content at bottom — forced white because it's on top of a dark gradient over an image */}
                <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
                  <p className="text-[14px] font-bold leading-tight" style={{ color: '#FFFFFF', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{progName(tmpl)}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('workouts.durationWk', { count: tmpl.durationWeeks })}</span>
                    <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('workouts.xPerWeek', { count: tmpl.daysPerWeek })}</span>
                  </div>
                </div>
              </button>
            ));
          })()}
        </div>
        )}
      </section>
      </>)}

    </div>

    {/* ── My Routine Detail Modal ───────────────────────── */}
    {expandedRoutineId && (() => {
      const routine = routines.find(r => r.id === expandedRoutineId);
      if (!routine) return null;
      return (
        // z-[80] so it stacks ABOVE the My Programs modal (z-[70]) when a
        // routine is tapped from inside a program — close it and you're back
        // in the program modal, not dumped to the Workouts page.
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            role="button"
            tabIndex={0}
            aria-label={t('workouts.ariaCloseRoutineDetails', 'Close routine details')}
            onClick={() => setExpandedRoutineId(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedRoutineId(null); }}
          />
          <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-[28px] overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button
                onClick={() => setExpandedRoutineId(null)}
                className="absolute right-4 top-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                aria-label={t('workouts.ariaClose', 'Close')}
              >
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <div className="mb-5">
                <h2 className="text-[24px] font-bold tracking-tight leading-tight" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(routine.name)}</h2>
                <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {routine.exerciseCount} {t('workouts.exercises')}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.exercises')}</p>
                <RoutineDetail
                  routineId={routine.id}
                  onEdit={() => { setExpandedRoutineId(null); navigate(`/workouts/${routine.id}/edit`); }}
                  onDelete={(e) => handleDelete(e, routine.id)}
                  deletingId={deletingId}
                  onStart={() => { posthog?.capture('routine_started', { routine_name: routine.name }); setExpandedRoutineId(null); }}
                />
              </div>
            </div>
            <div className="shrink-0 px-6 pt-4 pb-5" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), var(--color-bg-secondary), transparent)' }}>
              <button
                onClick={(e) => { handleDelete(e, routine.id); setExpandedRoutineId(null); }}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
                disabled={deletingId === routine.id}
              >
                {deletingId === routine.id ? t('workouts.deleting', 'Deleting...') : t('workouts.deleteRoutine', 'Delete routine')}
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* ── My Program Detail Modal ───────────────────────── */}
    {selectedMyProgram && (() => {
      const prog = selectedMyProgram;
      const isActive = prog.id === generatedProgram?.id && new Date(prog.expires_at) > new Date();
      const progTotalWeeks = getTotalProgramWeeks(prog) || 6;
      const weekNum = isActive ? getCurrentWeekClamped(prog) : progTotalWeeks;
      const totalDays = progTotalWeeks * 7;
      const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), totalDays);
      const progress = Math.round((daysElapsed / totalDays) * 100);
      const tmplWeeks = prog.template_weeks || null;
      const tmpl = prog.template_id ? programTemplates.find(t => t.id === prog.template_id) : null;
      const weekKeys = tmplWeeks ? Object.keys(tmplWeeks).sort((a, b) => Number(a) - Number(b)) : [];
      const weekIdx = weekKeys.indexOf(myProgWeek);
      const currentWeekDays = tmplWeeks ? (tmplWeeks[myProgWeek] || []) : [];
      const canPrev = weekIdx > 0;
      const canNext = weekIdx < weekKeys.length - 1;
      // Personal/auto programs (no template_weeks) are week-navigable in this
      // modal. myProgWeek holds the selected week as a numeric string; clamp
      // it to the program's range. Template programs aren't navigated here —
      // they use the template_weeks breakdown section below.
      const isPersonalProgram = !prog.template_weeks;
      const selectedWeek = Math.min(Math.max(parseInt(myProgWeek, 10) || 1, 1), progTotalWeeks);
      const weekCanPrev = selectedWeek > 1;
      const weekCanNext = selectedWeek < progTotalWeeks;
      // For A/B variant programs we have 8 Auto: routines but only 4 should
      // appear in a given week. getRoutinesForWeek returns the correct variant
      // for that week's parity; for legacy programs it falls back to the
      // workout_schedule mapping. Personal programs show the *selected* week;
      // template programs show the current week (their own section handles
      // week-by-week browsing).
      const programRoutines = isActive
        ? getRoutinesForWeek(isPersonalProgram ? selectedWeek : weekNum)
        : [];
      const localProgName = gpName(prog);

      return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseProgramDetails', 'Close program details')} onClick={() => setSelectedMyProgram(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMyProgram(null); }} />
          <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-[28px] overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button onClick={() => setSelectedMyProgram(null)} className="absolute right-4 top-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }} aria-label={t('workouts.ariaClose', 'Close')}>
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Header */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'text-[#10B981] bg-[#10B981]/10' : ''}`} style={!isActive ? { color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' } : undefined}>
                    {isActive ? t('workouts.active') : t('workouts.completed')}
                  </span>
                </div>
                <h2 className="text-[24px] font-bold tracking-tight leading-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.programSuffix', { name: localProgName })}</h2>
                {tmpl?.description && <ExpandableText text={progDesc(tmpl)} />}
              </div>

              {/* Progress */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{isActive ? t('workouts.weekXOfY', { current: weekNum, total: progTotalWeeks }) : t('workouts.programFinished')}</span>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : ''}`} style={{ width: `${progress}%`, ...(!isActive ? { backgroundColor: 'var(--color-text-subtle)' } : {}) }} />
                </div>
              </div>

              {/* Week-navigable routines — active personal/auto programs.
                  Lets the user step through every week of the program; the
                  empty-state still renders so a rest week doesn't strand the
                  navigator. */}
              {isActive && isPersonalProgram && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={() => weekCanPrev && setMyProgWeek(String(selectedWeek - 1))}
                      disabled={!weekCanPrev}
                      className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      style={weekCanPrev ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}
                      aria-label={t('workouts.ariaPreviousWeek', 'Previous week')}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('workouts.weekXOfY', { current: selectedWeek, total: progTotalWeeks })}
                    </span>
                    <button
                      onClick={() => weekCanNext && setMyProgWeek(String(selectedWeek + 1))}
                      disabled={!weekCanNext}
                      className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      style={weekCanNext ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}
                      aria-label={t('workouts.ariaNextWeek', 'Next week')}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  {programRoutines.length > 0 ? (
                    <div className="space-y-2">
                      {programRoutines.map(r => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setExpandedRoutineId(r.id)}
                          className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-colors group"
                          style={{ backgroundColor: 'var(--color-surface-hover)', border: 'none', cursor: 'pointer' }}
                        >
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><Dumbbell size={14} style={{ color: 'var(--color-text-muted)' }} /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(r.name)}</p>
                            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{r.exerciseCount} {t('workouts.exercises')}</p>
                          </div>
                          <ChevronRight size={14} className="transition-colors" style={{ color: 'var(--color-text-subtle)' }} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl py-6 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                      <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* This week's routines — active template programs (their own
                  week-by-week breakdown below handles week browsing). */}
              {isActive && !isPersonalProgram && programRoutines.length > 0 && (
                <div className="mb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.thisWeeksRoutines')}</p>
                  <div className="space-y-2">
                    {programRoutines.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setExpandedRoutineId(r.id)}
                        className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-colors group"
                        style={{ backgroundColor: 'var(--color-surface-hover)', border: 'none', cursor: 'pointer' }}
                      >
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><Dumbbell size={14} style={{ color: 'var(--color-text-muted)' }} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(r.name)}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{r.exerciseCount} {t('workouts.exercises')}</p>
                        </div>
                        <ChevronRight size={14} className="transition-colors" style={{ color: 'var(--color-text-subtle)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Week-by-week breakdown (if template_weeks exists) */}
              {weekKeys.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.programOverview')}</p>
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => canPrev && setMyProgWeek(weekKeys[weekIdx - 1])} disabled={!canPrev} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={canPrev ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }} aria-label={t('workouts.ariaPreviousWeek', 'Previous week')}>
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.weekXOfY', { current: myProgWeek, total: weekKeys.length })}</span>
                    <button onClick={() => canNext && setMyProgWeek(weekKeys[weekIdx + 1])} disabled={!canNext} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={canNext ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }} aria-label={t('workouts.ariaNextWeek', 'Next week')}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentWeekDays.length === 0 ? (
                      <div className="rounded-xl py-6 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p></div>
                    ) : currentWeekDays.map((day, di) => (
                      <div key={di} className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{dayName(day) || t('workouts.dayN', { n: di + 1 })}</p>
                        <div className="space-y-1.5">
                          {(day.exercises || []).map((ex, i) => {
                            const exId = typeof ex === 'string' ? ex : ex?.id;
                            const sets = typeof ex === 'object' ? ex.sets : null;
                            const reps = typeof ex === 'object' ? (ex.reps || ex.target_reps) : null;
                            const rest = typeof ex === 'object' ? ex.rest_seconds : null;
                            return (
                              <div key={i} className="flex items-center justify-between">
                                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                                  <span className="mr-1.5" style={{ color: 'var(--color-text-subtle)' }}>{i + 1}.</span>
                                  {exName(exerciseNameMap[exId]) ?? exId}
                                </p>
                                <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                                  {sets && <span>{sets} {t('workouts.sets')}</span>}
                                  {reps && <span>x {reps}</span>}
                                  {rest && <span style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.sRest', { seconds: rest })}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed / Unfinished state */}
              {!isActive && (() => {
                const wasFullyCompleted = progress >= 95;
                return (
                  <div className="mt-6 text-center">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${wasFullyCompleted ? 'bg-[#10B981]/10' : 'bg-amber-500/10'}`}>
                      {wasFullyCompleted
                        ? <CheckCircle2 size={28} className="text-[#10B981]" />
                        : <AlertTriangle size={28} className="text-amber-400" />
                      }
                    </div>
                    <p className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                      {wasFullyCompleted ? t('workouts.programCompleted') : t('workouts.programEndedEarly')}
                    </p>
                    <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                      {wasFullyCompleted
                        ? t('workouts.allProgressSaved')
                        : t('workouts.endedAtProgress', { progress })
                      }
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* CTA */}
            <div className="shrink-0 px-6 pt-4 pb-5" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), var(--color-bg-secondary), transparent)' }}>
              {isActive ? (
                <button
                  onClick={() => setLeaveProgramConfirm({ id: prog.id, name: prog.split_type, isActive: true })}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
                >
                  {t('workouts.removeProgram')}
                </button>
              ) : (
                <div className="space-y-2">
                  {prog.schedule_map?.routine_ids?.length > 0 && (
                    <button
                      onClick={() => setReactivateConfirm(prog)}
                      className="w-full py-4 rounded-2xl font-bold text-[15px] transition-colors flex items-center justify-center gap-2 text-[var(--color-text-on-secondary,#fff)]"
                      style={{ backgroundColor: 'var(--color-success, #10B981)' }}
                    >
                      <RotateCcw size={15} strokeWidth={2.4} />
                      {t('workouts.resumeProgram', 'Resume Program')}
                    </button>
                  )}
                  <button onClick={() => { setSelectedMyProgram(null); const el = document.getElementById('discover-programs'); el?.scrollIntoView({ behavior: 'smooth' }); }} className="w-full py-4 rounded-2xl font-bold text-[15px] transition-colors" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface-hover)' }}>
                    {t('workouts.browseNewPrograms')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    })()}

    {/* ── Modals ─────────────────────────────────────────── */}
    {selectedProgram && (
      <ProgramModal
        program={selectedProgram}
        isEnrolled={enrolledIds.has(selectedProgram.id)}
        onClose={() => setSelectedProgram(null)}
        onEnroll={handleEnroll}
        onLeave={handleLeave}
      />
    )}

    {/* ── Featured Program Detail Modal ──────────────────── */}
    {selectedTemplate && (() => {
      const weekKeys = Object.keys(selectedTemplate.weeks).sort((a, b) => Number(a) - Number(b));
      const weekIdx = weekKeys.indexOf(templateWeek);
      const currentWeekDays = selectedTemplate.weeks[templateWeek] || [];
      const canPrev = weekIdx > 0;
      const canNext = weekIdx < weekKeys.length - 1;

      return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseProgramDetails', 'Close program details')} onClick={() => setSelectedTemplate(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTemplate(null); }} />
          <div
            className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-[28px] overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
          >
            {/* Handle + Close */}
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button
                onClick={() => setSelectedTemplate(null)}
                className="absolute right-4 top-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                aria-label={t('workouts.ariaClose', 'Close')}
              >
                <X size={15} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Hero */}
              <div className="mb-6">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t(`workouts.programLevels.${selectedTemplate.level}`, selectedTemplate.level)} · {t(`workouts.programCategories.${selectedTemplate.category}`, selectedTemplate.category)}
                </span>
                <h2 className="text-[18px] font-bold tracking-tight leading-tight mt-2 truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {progName(selectedTemplate)}
                </h2>
                <ExpandableText text={progDesc(selectedTemplate)} />
              </div>

              {/* Meta pills */}
              <div className="flex flex-wrap items-center gap-2 mb-8">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <Activity size={11} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.xPerWeek', { count: selectedTemplate.daysPerWeek })}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <Calendar size={11} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.weeksCount', { count: selectedTemplate.durationWeeks })}</span>
                </div>
                {selectedTemplate.goal && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                    <Target size={11} style={{ color: 'var(--color-text-subtle)' }} />
                    <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t(`workouts.programGoals.${selectedTemplate.goal}`)}</span>
                  </div>
                )}
              </div>

              {/* Week navigator */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2.5">
                  <button
                    onClick={() => canPrev && setTemplateWeek(weekKeys[weekIdx - 1])}
                    disabled={!canPrev}
                    className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    style={canPrev ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}
                    aria-label={t('workouts.ariaPreviousWeek', 'Previous week')}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="text-center">
                    <span className="text-[16px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.weekXOfY', { current: templateWeek, total: weekKeys.length })}</span>
                  </div>
                  <button
                    onClick={() => canNext && setTemplateWeek(weekKeys[weekIdx + 1])}
                    disabled={!canNext}
                    className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    style={canNext ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}
                    aria-label={t('workouts.ariaNextWeek', 'Next week')}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="h-[2px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div
                    className="h-full rounded-full bg-[#10B981]/60 transition-all duration-300"
                    style={{ width: `${((weekIdx + 1) / weekKeys.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Workout day cards — pad to 7 days with rest days */}
              <div className="space-y-3">
                {(() => {
                  const DAY_LABELS = [t('days.monday', { ns: 'common' }), t('days.tuesday', { ns: 'common' }), t('days.wednesday', { ns: 'common' }), t('days.thursday', { ns: 'common' }), t('days.friday', { ns: 'common' }), t('days.saturday', { ns: 'common' }), t('days.sunday', { ns: 'common' })];
                  // Build a full 7-day view: workout days first, then rest days fill remaining
                  const fullWeek = DAY_LABELS.map((dayLabel, i) => {
                    const workoutDay = currentWeekDays[i];
                    if (workoutDay) return { ...workoutDay, dayLabel, isRest: false };
                    return { dayLabel, isRest: true, name: dayLabel, exercises: [] };
                  });

                  if (currentWeekDays.length === 0) {
                    return (
                      <div className="rounded-2xl py-8 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <p className="text-[13px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p>
                      </div>
                    );
                  }

                  return fullWeek.map((day, di) => (
                    <div key={di} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                      <div className="flex items-center gap-2.5 mb-1">
                        <h4 className="text-[14px] font-semibold" style={{ color: day.isRest ? 'var(--color-text-subtle)' : 'var(--color-text-primary)' }}>
                          {day.isRest ? day.dayLabel : dayName(day)}
                        </h4>
                        {!day.isRest && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}>
                            {day.exercises.length}
                          </span>
                        )}
                      </div>
                      {day.isRest ? (
                        <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restDay')}</p>
                      ) : (
                        <div className="space-y-1 mt-2">
                          {day.exercises.map((ex, ei) => (
                            <p key={ei} className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
                              {exName(exerciseNameMap[ex.id]) || ex.id}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>

              {/* Equipment */}
              {selectedTemplate.equipment && (
                <p className="text-[10px] mt-5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('workouts.equipmentLabel', { list: selectedTemplate.equipment.join(' · ') })}
                </p>
              )}
            </div>

            {/* Gym hours warnings */}
            {gymHoursWarnings.length > 0 && (
              <div className="px-6 pt-3 space-y-1">
                {gymHoursWarnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            {/* CTA */}
            <div className="shrink-0 px-6 pt-4 pb-5" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), var(--color-bg-secondary), transparent)' }}>
              <button
                onClick={handleStartTemplate}
                disabled={switchingProgram}
                className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.98] transition-all text-[var(--color-text-on-secondary,#fff)] disabled:opacity-50" style={{ background: '#10B981' }}
              >
                {switchingProgram ? t('workouts.settingUp') : t('workouts.startThisProgram')}
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {showCreateModal && (
      <CreateRoutineModal
        onClose={() => setShowCreateModal(false)}
        onSave={handleSaveCreateModal}
      />
    )}



    {showGenerator && (
      <GenerateWorkoutModal
        onboarding={onboardingData}
        onClose={() => setShowGenerator(false)}
        onCreateManual={() => { setBuilderProgram(null); setShowBuilder(true); }}
        onGenerated={() => {
          if (user?.id) {
            supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20)
              .then(({ data }) => {
                const programs = data || [];
                setAllPrograms(programs);
                setGeneratedProgram(programs[0] || null);
                setGoalsMismatch(false);
              });
          }
          refetch();
        }}
      />
    )}

    {showBuilder && (
      <MemberProgramBuilder
        editProgram={builderProgram}
        onClose={() => { setShowBuilder(false); setBuilderProgram(null); }}
        onSaved={() => {
          setShowBuilder(false);
          setBuilderProgram(null);
          if (user?.id) {
            supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20)
              .then(({ data }) => {
                const programs = data || [];
                setAllPrograms(programs);
                setGeneratedProgram(programs[0] || null);
                setGoalsMismatch(false);
              });
          }
          refetch();
        }}
      />
    )}

    {/* ── Start Mode Choice Dialog ────────────── */}
    {startModeChoice === 'choosing' && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseStartMode', 'Close start mode dialog')} onClick={() => setStartModeChoice(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setStartModeChoice(null); }}>
        <div className="rounded-[20px] w-full max-w-sm p-6 border" role="dialog" aria-modal="true" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
          <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4">
            <Calendar size={24} className="text-[#D4AF37]" />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2 truncate" style={{ color: 'var(--color-text-primary)' }}>
            {t('workouts.whenToStart', 'When do you want to start?')}
          </h3>
          <p className="text-[12px] text-center mb-5" style={{ color: 'var(--color-text-muted)' }}>
            {t('workouts.startModeDescription', 'Choose how to align the program with your schedule.')}
          </p>
          <div className="space-y-2.5">
            <button
              onClick={() => proceedWithStartMode('today')}
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-accent,#000)] transition-colors"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {t('workouts.startFromToday', 'Start from today')}
            </button>
            <button
              onClick={() => proceedWithStartMode('normal')}
              className="w-full py-3.5 rounded-2xl font-semibold text-[13px] transition-colors"
              style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
            >
              {t('workouts.startNormally', 'Follow the normal schedule')}
            </button>
            <button
              onClick={() => setStartModeChoice(null)}
              className="w-full py-2 text-[12px] font-medium transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {t('common:cancel', 'Cancel')}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Switch Program Confirmation Dialog ────────────── */}
    {switchStep && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseSwitch', 'Close switch program dialog')} onClick={() => setSwitchStep(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSwitchStep(null); }}>
        <div className="rounded-[20px] w-full max-w-sm p-6 border" role="dialog" aria-modal="true" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
          {switchStep === 'confirm' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={22} className="text-amber-400" />
              </div>
              <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.switchPrograms')}</h3>
              <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.switchProgramsDesc', { name: selectedTemplate ? progName(selectedTemplate) : '' })}
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={() => setSwitchStep('final')}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-secondary,#fff)] transition-colors" style={{ background: '#10B981' }}
                >
                  {t('workouts.yesSwitchProgram')}
                </button>
                <button
                  onClick={() => setSwitchStep(null)}
                  className="w-full py-3 rounded-2xl font-medium text-[13px] transition-colors"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {t('workouts.keepCurrentProgram')}
                </button>
              </div>
            </>
          ) : switchStep === 'final' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={22} className="text-red-400" />
              </div>
              <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.areYouSure')}</h3>
              <p className="text-[13px] text-center leading-relaxed mb-2" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.switchConfirmDesc', { name: selectedTemplate ? progName(selectedTemplate) : '' })}
              </p>
              <p className="text-[11px] text-center mb-6" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.switchConfirmNote')}
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={() => enrollInTemplate(startMode)}
                  disabled={switchingProgram}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {switchingProgram ? t('workouts.switching') : t('workouts.confirmAndSwitch')}
                </button>
                <button
                  onClick={() => setSwitchStep(null)}
                  disabled={switchingProgram}
                  className="w-full py-3 rounded-2xl font-medium text-[13px] transition-colors disabled:opacity-40"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {t('workouts.cancel')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    )}

    {/* ── Day Compression Warning Modal ────────────────── */}
    {dayCompressionWarning && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseDayCompression', 'Close day compression warning')} onClick={() => setDayCompressionWarning(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDayCompressionWarning(null); }}>
        <div className="rounded-[20px] w-full max-w-sm p-6 border" role="dialog" aria-modal="true" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-amber-400" />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.dayCompressionTitle')}</h3>
          <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
            {t('workouts.dayCompressionMessage', { programDays: dayCompressionWarning.programDays, userDays: dayCompressionWarning.userDays })}
          </p>
          <div className="space-y-2.5">
            <button
              onClick={proceedAfterWarnings}
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-secondary,#fff)] transition-colors" style={{ background: '#10B981' }}
            >
              {t('workouts.dayCompressionContinue')}
            </button>
            <button
              onClick={() => setDayCompressionWarning(null)}
              className="w-full py-3 rounded-2xl font-medium text-[13px] transition-colors"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              {t('workouts.cancel')}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Goal Mismatch Warning Modal ─────────────────── */}
    {goalMismatchWarning && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label={t('workouts.ariaCloseGoalMismatch', 'Close goal mismatch warning')} onClick={() => setGoalMismatchWarning(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setGoalMismatchWarning(null); }}>
        <div className="rounded-[20px] w-full max-w-sm p-6 border" role="dialog" aria-modal="true" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-amber-400" />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.goalMismatchTitle')}</h3>
          <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
            {t('workouts.goalMismatchMessage', {
              programGoal: t(`workouts.programGoals.${goalMismatchWarning.programGoal}`, goalMismatchWarning.programGoal),
              userGoal: t(`workouts.userGoals.${goalMismatchWarning.userGoal}`, goalMismatchWarning.userGoal),
            })}
          </p>
          <div className="space-y-2.5">
            <button
              onClick={() => {
                setGoalMismatchWarning(null);
                // After dismissing goal warning, check day compression next
                const userDays = onboardingData?.training_days_per_week || 0;
                if (selectedTemplate && userDays > 0 && selectedTemplate.daysPerWeek > userDays) {
                  setDayCompressionWarning({ programDays: selectedTemplate.daysPerWeek, userDays });
                } else {
                  proceedAfterWarnings();
                }
              }}
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-secondary,#fff)] transition-colors" style={{ background: '#10B981' }}
            >
              {t('workouts.goalMismatchContinue')}
            </button>
            <button
              onClick={() => setGoalMismatchWarning(null)}
              className="w-full py-3 rounded-2xl font-medium text-[13px] transition-colors"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              {t('workouts.cancel')}
            </button>
          </div>
        </div>
      </div>
    )}
    {/* ── Leave / Delete Program confirm ──────────────────────── */}
    {leaveProgramConfirm && (() => {
      // Active program → "Leave" copy (warns about losing progress).
      // Past/expired program → "Delete" copy (just remove from history).
      const isLeaving = !!leaveProgramConfirm.isActive;
      const titleKey  = isLeaving ? 'workouts.leaveProgramTitle' : 'workouts.deleteProgramTitle';
      const descKey   = isLeaving ? 'workouts.leaveProgramDesc'  : 'workouts.deleteProgramDesc';
      const cancelKey = isLeaving ? 'workouts.keepTraining'      : 'workouts.keepIt';
      const confirmKey = isLeaving ? 'workouts.confirmLeave'     : 'workouts.confirmDeleteProgram';
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => setLeaveProgramConfirm(null)}>
          <div className="w-full max-w-sm rounded-[20px] p-6" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={28} className="text-red-400" />
            </div>
            <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t(titleKey)}
            </h3>
            <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-muted)' }}>
              {t(descKey)}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => setLeaveProgramConfirm(null)}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
              >
                {t(cancelKey)}
              </button>
              <button
                onClick={handleConfirmLeaveProgram}
                className="w-full py-3 rounded-2xl font-medium text-[13px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
              >
                {t(confirmKey)}
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    {/* ── Regenerate Program confirm ──────────────────────────────── */}
    {regenerateConfirm && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => !regenerating && setRegenerateConfirm(false)}>
        <div className="w-full max-w-sm rounded-[20px] p-6" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
            <RotateCcw size={26} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {t('workouts.regenerateTitle', 'Regenerar tu programa?')}
          </h3>
          <p className="text-[13px] text-center leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
            {t('workouts.regenerateDesc', 'Crearemos un programa nuevo desde tus respuestas de onboarding. Tu programa actual quedará en el historial y los entrenamientos que ya registraste se mantienen.')}
          </p>
          {/* When should the new program start? */}
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--color-text-subtle)' }}>
            {t('workouts.regenWhenStart', '¿Cuándo empezar?')}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {[
              { v: true,  label: t('workouts.regenStartToday', 'Empezar hoy') },
              { v: false, label: t('workouts.regenStartPreferred', 'En mis días') },
            ].map((opt) => {
              const sel = regenStartToday === opt.v;
              return (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => setRegenStartToday(opt.v)}
                  disabled={regenerating}
                  className="py-2.5 rounded-xl text-[13px] font-bold border transition-all disabled:opacity-50"
                  style={sel
                    ? { background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)', color: 'var(--color-accent)' }
                    : { background: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="space-y-2.5">
            <button
              onClick={handleRegenerateProgram}
              disabled={regenerating}
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
            >
              {regenerating
                ? t('workouts.regenerating', 'Regenerando…')
                : t('workouts.regenerateConfirm', 'Sí, regenerar')}
            </button>
            <button
              onClick={() => setRegenerateConfirm(false)}
              disabled={regenerating}
              className="w-full py-3 rounded-2xl font-medium text-[13px] disabled:opacity-50"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {t('common:cancel', 'Cancelar')}
            </button>
          </div>
        </div>
      </div>
    )}
    {regenerating && (
      <div className="fixed inset-0 z-[210] flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: 'rgba(8,11,18,0.82)', backdropFilter: 'blur(3px)' }}>
        <div className="w-12 h-12 rounded-full border-[3px] animate-spin" style={{ borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'var(--color-accent)' }} />
        <p className="text-[15px] font-bold" style={{ color: '#fff' }}>{t('workouts.regenerating', 'Regenerando…')}</p>
        <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{t('workouts.regenWait', 'Creando tu nuevo programa…')}</p>
      </div>
    )}
    {/* ── Reactivate (resume) Program confirm ─────────────────── */}
    {reactivateConfirm && (() => {
      const src = reactivateConfirm;
      const totalWk = getTotalProgramWeeks(src) || (src.duration_weeks || 12);
      const startSunday = (() => {
        const s = new Date(src.program_start);
        s.setHours(0, 0, 0, 0);
        s.setDate(s.getDate() - s.getDay());
        return s;
      })();
      const pauseDate = new Date(src.expires_at);
      const pausedDays = Math.floor((pauseDate - startSunday) / 86400000);
      const pausedAtWeek = Math.min(
        Math.max(Math.floor(pausedDays / 7) + 1, 1),
        Math.max(totalWk - 1, 1)
      );
      const sourceName = gpName(src);
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => !reactivating && setReactivateConfirm(null)}>
          <div className="w-full max-w-sm rounded-[20px] p-6" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[#10B981]/15">
              <RotateCcw size={26} className="text-[#10B981]" />
            </div>
            <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('workouts.reactivateTitle', 'Resume {{name}}?', { name: sourceName })}
            </h3>
            <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-muted)' }}>
              {t('workouts.reactivateDesc', "You'll pick up at Week {{week}} of {{total}}. Your current program will be expired and history kept.", { week: pausedAtWeek, total: totalWk })}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => handleReactivateProgram(src)}
                disabled={reactivating}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors disabled:opacity-60 text-[var(--color-text-on-secondary,#fff)]"
                style={{ backgroundColor: 'var(--color-success, #10B981)' }}
              >
                {reactivating
                  ? t('workouts.reactivating', 'Resuming…')
                  : t('workouts.reactivateConfirm', 'Yes, resume')}
              </button>
              <button
                onClick={() => setReactivateConfirm(null)}
                disabled={reactivating}
                className="w-full py-3 rounded-2xl font-medium text-[13px] disabled:opacity-50"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('common:cancel', 'Cancelar')}
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    {/* ── Delete Blocked info (active program routine) ───────── */}
    {deleteBlockedInfo && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => setDeleteBlockedInfo(null)}>
        <div className="w-full max-w-sm rounded-[20px] p-6" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
            <Trash2 size={26} className="text-amber-400" />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {t('workouts.deleteBlockedTitle', "Can't delete this routine")}
          </h3>
          <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {t('workouts.deleteRoutineActiveProgram')}
          </p>
          <button
            onClick={() => setDeleteBlockedInfo(null)}
            className="w-full py-3.5 rounded-2xl font-bold text-[14px]"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {t('workouts.gotIt', 'Got it')}
          </button>
        </div>
      </div>
    )}

    {/* ── Delete Routine confirm ──────────────────────────────── */}
    {deleteRoutineConfirm && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => deletingId !== deleteRoutineConfirm.id && setDeleteRoutineConfirm(null)}>
        <div className="w-full max-w-sm rounded-[20px] p-6" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
          <div className="w-14 h-14 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <Trash2 size={26} className="text-red-400" />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {t('workouts.deleteRoutineTitle', 'Delete this routine?')}
          </h3>
          <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {t('workouts.deleteRoutineDesc', 'This will remove the routine from your library. Logged sessions stay in your history.')}
          </p>
          <div className="space-y-2.5">
            <button
              onClick={() => setDeleteRoutineConfirm(null)}
              disabled={deletingId === deleteRoutineConfirm.id}
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
            >
              {t('workouts.keepIt', 'Keep it')}
            </button>
            <button
              onClick={handleConfirmDeleteRoutine}
              disabled={deletingId === deleteRoutineConfirm.id}
              className="w-full py-3 rounded-2xl font-medium text-[13px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors disabled:opacity-50"
            >
              {deletingId === deleteRoutineConfirm.id
                ? t('workouts.deleting', 'Deleting…')
                : t('workouts.confirmDeleteRoutine', 'Yes, delete')}
            </button>
          </div>
        </div>
      </div>
    )}
    {bulkDeleteConfirm && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => !bulkDeleting && setBulkDeleteConfirm(null)}>
        <div className="w-full max-w-sm rounded-[20px] p-6" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
          <div className="w-14 h-14 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <Trash2 size={26} className="text-red-400" />
          </div>
          <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {bulkDeleteConfirm.kind === 'programs'
              ? t('workouts.bulkDeleteProgramsTitle', { count: bulkDeleteConfirm.count, defaultValue: 'Delete {{count}} programs?' })
              : t('workouts.bulkDeleteRoutinesTitle', { count: bulkDeleteConfirm.count, defaultValue: 'Delete {{count}} routines?' })}
          </h3>
          <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {bulkDeleteConfirm.kind === 'programs'
              ? t('workouts.bulkDeleteProgramsDesc', 'Removes the selected past programs. Your logged sessions stay in your history. This cannot be undone.')
              : t('workouts.bulkDeleteRoutinesDesc', 'Removes the selected routines from your library. Logged sessions stay in your history. This cannot be undone.')}
          </p>
          <div className="space-y-2.5">
            <button
              onClick={() => setBulkDeleteConfirm(null)}
              disabled={bulkDeleting}
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
            >
              {t('workouts.cancel', 'Cancel')}
            </button>
            <button
              onClick={bulkDeleteConfirm.kind === 'programs' ? handleBulkDeletePrograms : handleBulkDeleteRoutines}
              disabled={bulkDeleting}
              className="w-full py-3 rounded-2xl font-medium text-[13px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors disabled:opacity-50"
            >
              {bulkDeleting
                ? t('workouts.deleting', 'Deleting…')
                : t('workouts.bulkDeleteConfirmBtn', { count: bulkDeleteConfirm.count, defaultValue: 'Delete {{count}}' })}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Workouts;

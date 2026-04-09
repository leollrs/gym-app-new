import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Dumbbell, Clock, ChevronRight, ChevronLeft, Pencil, X, Trash2, CheckCircle2,
  Calendar, Zap, Heart, BookOpen, AlertTriangle, Activity, Target, Info,
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import GenerateWorkoutModal from '../components/GenerateWorkoutModal';
import CreateRoutineModal from '../components/CreateRoutineModal';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { timeAgo } from '../lib/dateUtils';
// programTemplates + PROGRAM_CATEGORIES loaded dynamically to avoid 396KB eager bundle cost
import { exercises as exerciseLibrary } from '../data/exercises';
import { useTranslation } from 'react-i18next';
import { exName, localizeRoutineName } from '../lib/exerciseName';
import { loadAdaptationSuggestions, dismissAdaptationSuggestions } from '../lib/programAdaptation';
import { usePostHog } from '@posthog/react';
import { programImageUrl } from '../lib/imageUrl';
import { getExerciseReasoning } from '../lib/exerciseReasoning';

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
          <div className="fixed inset-0 z-[60]" role="button" tabIndex={0} aria-label="Close tooltip" onClick={(e) => { e.stopPropagation(); setOpen(false); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setOpen(false); } }} />
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
        promises.push(
          supabase.from('exercises').select('id, name, name_es, muscle_group, equipment').in('id', allIds)
            .then(({ data }) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4" role="button" tabIndex={0} aria-label="Close program details" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}>
      <div role="dialog" aria-modal="true" className="rounded-[20px] w-full max-w-lg md:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{progName(program)}</p>
            <p className="text-[12px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-subtle)' }}>
              <Calendar size={11} /> {t('workouts.weekProgram', { count: program.duration_weeks })}
            </p>
          </div>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)' }} aria-label="Close"><X size={16} style={{ color: 'var(--color-text-subtle)' }} /></button>
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
            <button onClick={handleEnroll} disabled={acting} className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors disabled:opacity-50">
              {acting ? t('workouts.enrolling') : t('workouts.startThisProgram')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Routine detail (expandable) ──────────────────────────
const RoutineDetail = ({ routineId, onEdit, onDelete, deletingId, onStart }) => {
  const { t } = useTranslation('pages');
  const [exercises, setExercises] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from('routine_exercises')
      .select('id, position, target_sets, target_reps, rest_seconds, exercises(name)')
      .eq('routine_id', routineId)
      .order('position')
      .then(({ data }) => {
        setExercises(data || []);
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
          style={{ backgroundColor: 'var(--color-accent)', color: '#000000' }}
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
  const [deletingId, setDeletingId]           = useState(null);
  const [showGenerator, setShowGenerator]     = useState(false);
  const [programCategoryFilter, setProgramCategoryFilter] = useState('All');
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
  const [showAllRoutines, setShowAllRoutines] = useState(false);
  const [showAllMyPrograms, setShowAllMyPrograms] = useState(false);
  const [selectedMyProgram, setSelectedMyProgram] = useState(null);
  const [myProgWeek, setMyProgWeek] = useState('1');
  const [dayCompressionWarning, setDayCompressionWarning] = useState(null);
  const [goalMismatchWarning, setGoalMismatchWarning] = useState(null);

  // Gym programs
  const [gymPrograms, setGymPrograms]       = useState([]);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [enrolledIds, setEnrolledIds]       = useState(new Set());
  const [selectedProgram, setSelectedProgram] = useState(null);

  // Generated programs
  const [generatedProgram, setGeneratedProgram] = useState(null);
  const [allPrograms, setAllPrograms]           = useState([]);
  const [programLoading, setProgramLoading]     = useState(true);
  const [onboardingData, setOnboardingData]     = useState(null);
  const [goalsMismatch, setGoalsMismatch]       = useState(false);
  const [adaptationSuggestions, setAdaptationSuggestions] = useState(null);
  // Workout schedule: maps routine_id -> day_of_week (0=Sun..6=Sat)
  const [workoutScheduleMap, setWorkoutScheduleMap] = useState({});

  // Load adaptation suggestions from localStorage on mount
  useEffect(() => {
    const suggestions = loadAdaptationSuggestions();
    if (suggestions) setAdaptationSuggestions(suggestions);
  }, []);

  // Load gym programs (with offline cache fallback)
  const loadPrograms = useCallback(async () => {
    if (!profile?.gym_id) return;
    setProgramsLoading(true);
    try {
      const [{ data: progs }, { data: enrolled }] = await Promise.all([
        supabase.from('gym_programs').select('id, name, description, duration_weeks, weeks, created_at').eq('gym_id', profile.gym_id).eq('is_published', true).order('created_at', { ascending: false }).limit(50),
        supabase.from('gym_program_enrollments').select('program_id').eq('profile_id', user.id).limit(50),
      ]);
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
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedMyProgram]);
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

  // Load generated programs + onboarding
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
    const load = async () => {
      const [{ data: allGp }, { data: ob }, { data: latestWeight }] = await Promise.all([
        supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('member_onboarding').select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes, height_inches, initial_weight_lbs, age, sex, height_cm, weight_kg, gender, priority_muscles').eq('profile_id', user.id).maybeSingle(),
        supabase.from('body_weight_logs').select('weight_lbs').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const programs = allGp || [];
      setAllPrograms(programs);
      const latest = programs[0] || null;
      setGeneratedProgram(latest);
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
  const totalProgramWeeks = generatedProgram?.duration_weeks || 6;
  const rawWeekNum = programActive ? Math.floor((today - new Date(generatedProgram.program_start)) / (7 * 86400000)) + 1 : 0;
  const currentWeekNum = Math.min(rawWeekNum, totalProgramWeeks);
  const isWeekA = currentWeekNum % 2 === 1;

  // Use schedule_map from generated_programs (authoritative)
  const schedMap = generatedProgram?.schedule_map || null;
  const programStartDow = schedMap?.start_dow ?? (programActive ? new Date(generatedProgram.program_start).getDay() : 1);
  const hasWrappedDays = (schedMap?.wrapped_dows?.length ?? 0) > 0;

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

  // Reverse map: DOW → routine_id (using workoutScheduleMap which is routine_id→dow)
  const routineIdByNormalDow = {};
  for (const [rid, dow] of Object.entries(workoutScheduleMap)) {
    routineIdByNormalDow[String(dow)] = rid; // ensure string key for consistent lookup
  }

  // Get routines for a specific week, with correct DOW labels per week
  const getRoutinesForWeek = (weekNum) => {
    if (!programActive) return [];
    const weekVariant = weekNum % 2 === 1;
    // Check if this program uses A/B alternation at all
    const hasAB = routines.some(r => r.name.startsWith('Auto:') && r.name.endsWith(' B'));
    const autoRoutines = routines.filter(r => {
      if (!r.name.startsWith('Auto:')) return false;
      if (!hasAB) return true; // no A/B variants — include all Auto: routines
      if (weekVariant) return r.name.endsWith(' A');
      return r.name.endsWith(' B');
    });

    // Determine which DOW map to use for this week
    let dowMap;
    if (hasWrappedDays && weekNum === 1) {
      dowMap = week1DowToIdx; // partial first week
    } else if (hasWrappedDays && weekNum === totalProgramWeeks) {
      dowMap = lastWeekDowToIdx; // partial last week
    } else {
      dowMap = normalDowToIdx; // full weeks (week 2 through N-1)
    }

    // Build the list: for each DOW in this week's map, find the matching routine
    const result = [];
    const dowEntries = Object.entries(dowMap).map(([d, idx]) => [Number(d), idx]).sort((a, b) => a[0] - b[0]);
    for (const [dow, routineIdx] of dowEntries) {
      // Find the routine assigned to this DOW in the normal schedule
      // (workout_schedule stores normal DOW, so for week 1 we need to find routine by index)
      let routine;
      if (hasWrappedDays && (weekNum === 1 || weekNum === totalProgramWeeks)) {
        // For partial weeks, find routine by its normal DOW via routine_index
        const normalDow = schedMap?.normal_dows?.[routineIdx];
        const rid = normalDow !== undefined ? routineIdByNormalDow[String(normalDow)] : null;
        routine = rid ? autoRoutines.find(r => r.id === rid) : null;
      } else {
        const rid = routineIdByNormalDow[String(dow)];
        routine = rid ? autoRoutines.find(r => r.id === rid) : null;
      }
      if (routine) {
        result.push({ ...routine, _displayDow: dow });
      }
    }
    return result;
  };

  const thisWeekRoutines = getRoutinesForWeek(currentWeekNum);

  // Handlers
  const handleEnroll = async (programId) => {
    await supabase.from('gym_program_enrollments').insert({ program_id: programId, profile_id: user.id, gym_id: profile.gym_id });
    setEnrolledIds(prev => new Set([...prev, programId]));
  };
  const handleLeave = async (programId) => {
    await supabase.from('gym_program_enrollments').delete().eq('program_id', programId).eq('profile_id', user.id);
    setEnrolledIds(prev => { const s = new Set(prev); s.delete(programId); return s; });
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
      refetch();
      navigate(`/session/${routine.id}`);
    } else {
      refetch();
      navigate(`/workouts/${routine.id}/edit`);
    }
  };
  const handleDelete = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
    // Prevent deleting routines that belong to the active program
    const routine = routines.find(r => r.id === id);
    if (programActive && routine?.name?.startsWith('Auto:')) {
      alert(t('workouts.deleteRoutineActiveProgram'));
      return;
    }
    if (!confirm(t('workouts.deleteRoutineConfirm'))) return;
    setDeletingId(id);
    try { await deleteRoutine(id); } catch (err) { logger.error(err); }
    finally { setDeletingId(null); }
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

      // 2. Delete old Auto: routines (and their exercises + schedule entries)
      const { data: oldAutoRoutines } = await supabase
        .from('routines')
        .select('id')
        .eq('created_by', user.id)
        .like('name', 'Auto:%');

      if (oldAutoRoutines?.length > 0) {
        const oldIds = oldAutoRoutines.map(r => r.id);
        // Delete routine_exercises for these routines
        await supabase.from('routine_exercises').delete().in('routine_id', oldIds);
        // Delete workout_schedule entries pointing to these routines
        await supabase.from('workout_schedule').delete().in('routine_id', oldIds).then(() => {}).catch(() => {});
        // Delete the routines themselves
        await supabase.from('routines').delete().in('id', oldIds);
        logger.log(`Cleaned up ${oldIds.length} old Auto: routines`);
      }

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

      // Pick N consecutive open days (skip only gym-closed days, not user rest days).
      // This ensures a 5-day program gets Mon-Fri (or wraps around closed days),
      // with rest pushed to after the last workout day.
      const allOpenDays = [1, 2, 3, 4, 5, 6, 0].filter(d => !closedDays.has(d));
      let allAvailableDays = [];
      // Start from Monday (1) and take the first N consecutive open days
      for (const d of allOpenDays) {
        if (allAvailableDays.length >= firstWeek.length) break;
        allAvailableDays.push(d);
      }
      allAvailableDays.sort((a, b) => a - b);

      // Schedule mappings: week 1 (shifted), week 2+ (packed Mon-start), last week (remainder)
      const startDow = startDate.getDay();
      const N = firstWeek.length;

      // Rotate from start date to pick the N closest training days for week 1
      const sorted = [...allAvailableDays].sort((a, b) => a - b);
      const fromStart = sorted.filter(d => d >= startDow);
      const beforeStart = sorted.filter(d => d < startDow);
      const rotated = [...fromStart, ...beforeStart];
      const week1AllDays = rotated.slice(0, N);

      // Week 1 only contains days from startDow onward (this calendar week)
      const week1Dows = week1AllDays.filter(d => d >= startDow);
      // Wrapped days → last week (routines that couldn't fit in week 1's calendar week)
      const wrappedDows = week1AllDays.filter(d => d < startDow);
      const needsExtraWeek = wrappedDows.length > 0;
      const baseDuration = selectedTemplate.durationWeeks || 6;
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
          const rows = day.exercises.map((ex, pos) => ({
            routine_id: routine.id,
            exercise_id: ex.id,
            position: pos + 1,
            target_sets: ex.sets || 3,
            target_reps: '8-12',
            rest_seconds: ex.rest_seconds || 90,
          }));
          const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
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

      // 4. Refresh state
      const { data: allGp } = await supabase.from('generated_programs')
        .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
      const programs = allGp || [];
      setAllPrograms(programs);
      setGeneratedProgram(programs[0] || null);
      await refetch();

      // Close everything
      setSwitchStep(null);
      setSelectedTemplate(null);
    } catch (err) {
      logger.error('Failed to enroll in template:', err);
      alert(t('workouts.somethingWentWrong') + err.message);
    } finally {
      setSwitchingProgram(false);
    }
  };

  return (
    <>
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 lg:px-8 pt-4 pb-28 md:pb-12">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8 gap-2" data-tour="tour-workouts-page">
        <h1 className="text-[22px] font-bold tracking-tight truncate min-w-0" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.title')}</h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to="/exercises"
            className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-[12px] font-medium transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <BookOpen size={14} />
            {t('workouts.library')}
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-[12px] font-semibold transition-colors"
            style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
          >
            <Plus size={14} />
            {t('workouts.new')}
          </button>
        </div>
      </div>

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
                    : adaptationSuggestions.suggestReduceDays
                    ? t('workouts.adaptReduceDaysTitle', 'Adjust your training days')
                    : adaptationSuggestions.shouldIncrease
                    ? t('workouts.adaptIncreaseTitle', 'You\'re progressing well!')
                    : t('workouts.adaptInsightTitle', 'Program insight')}
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-subtle)' }}>
                  {adaptationSuggestions.shouldDeload
                    ? t('workouts.adaptDeloadBody', 'Your volume has dropped recently. A lighter week may help you recover and come back stronger.')
                    : adaptationSuggestions.suggestReduceDays
                    ? t('workouts.adaptReduceDaysBody', { days: adaptationSuggestions.suggestedDays, defaultValue: `Based on your attendance, we suggest reducing to ${adaptationSuggestions.suggestedDays} days/week for better consistency.` })
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
                aria-label="Dismiss adaptation suggestion"
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.currentProgram')}</p>
          <div className="rounded-2xl px-4 py-5" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            {/* Title & progress with week navigator */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <button onClick={() => setProgramViewWeek(w => Math.max(1, (w || currentWeekNum) - 1))} disabled={viewWeek <= 1} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }} aria-label="Previous week"><ChevronLeft size={16} /></button>
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                    {t('workouts.weekXOfY', { current: Math.min(viewWeek, totalProgramWeeks), total: totalProgramWeeks })}
                  </h2>
                  <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                    {isViewingCurrentWeek ? t('workouts.currentWeekRoutine', { variant: isWeekA ? 'A' : 'B' }) : ''}
                  </p>
                </div>
                <button onClick={() => setProgramViewWeek(w => Math.min(totalProgramWeeks, (w || currentWeekNum) + 1))} disabled={viewWeek >= totalProgramWeeks} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }} aria-label="Next week"><ChevronRight size={16} /></button>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-[#10B981]/10 flex items-center justify-center">
                <Zap size={18} className="text-[#10B981]" />
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-6">
              <div className="w-full h-1 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                <div
                  className="h-full rounded-full bg-[#10B981] transition-all"
                  style={{ width: `${Math.min((currentWeekNum / totalProgramWeeks) * 100, 100)}%` }}
                />
              </div>
            </div>

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
                  <div className="rounded-xl py-6 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
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
                      // Use _displayDow (per-week DOW) instead of the fixed workoutScheduleMap
                      const scheduledDow = routine._displayDow ?? workoutScheduleMap[routine.id];
                      const DOW_LABELS = [
                        t('days.sun', { ns: 'common' }), t('days.mon', { ns: 'common' }), t('days.tue', { ns: 'common' }),
                        t('days.wed', { ns: 'common' }), t('days.thu', { ns: 'common' }), t('days.fri', { ns: 'common' }), t('days.sat', { ns: 'common' }),
                      ];
                      const dayLabel = scheduledDow !== undefined ? DOW_LABELS[scheduledDow] : null;
                      // Only show "Today" badge when viewing the current week
                      const isToday = isViewingCurrentWeek && scheduledDow !== undefined && scheduledDow === new Date().getDay();
                      return (
                        <div key={routine.id}>
                          <button
                            type="button"
                            onClick={() => setExpandedProgramRoutineId(isExpanded ? null : routine.id)}
                            className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left"
                            style={{ backgroundColor: isToday ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-hover))' : 'var(--color-surface-hover)' }}
                          >
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                              <Dumbbell size={15} style={{ color: 'var(--color-text-muted)' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(routine.name)}</p>
                                {dayLabel && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase`} style={isToday ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' } : { color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}>
                                    {dayLabel}{isToday ? ` - ${t('workouts.today', 'Today')}` : ''}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{routine.exerciseCount} {t('workouts.exercises')}</p>
                            </div>
                            <ChevronRight size={16} className={`flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
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
        </section>
        );
      })()}

      {/* ── No program / expired — two options ──────────────── */}
      {!programLoading && !programActive && (
        <section className="mb-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
            {programExpired ? t('workouts.programEndedWhatsNext') : t('workouts.getStarted')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setShowGenerator(true)}
              className="text-left rounded-2xl bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/[0.02] p-5 active:scale-[0.98] transition-transform duration-150"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mb-4">
                <Zap size={18} className="text-[#10B981]" />
              </div>
              <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.customProgram')}</p>
              <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.builtAroundGoals')}</p>
            </button>
            <button
              onClick={() => {
                const el = document.getElementById('discover-programs');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-left rounded-2xl p-5 active:scale-[0.98] transition-transform duration-150"
              style={{ backgroundColor: 'var(--color-surface-hover)' }}
            >
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                <BookOpen size={18} style={{ color: 'var(--color-text-subtle)' }} />
              </div>
              <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.browsePrograms')}</p>
              <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.provenPrograms')}</p>
            </button>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════
          SECTION 2: MY ROUTINES
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.myRoutines')}</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-[11px] font-medium transition-colors min-h-[44px] min-w-[44px]"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('workouts.addNew')}
          </button>
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
          const visible = showAllRoutines ? routines : routines.slice(0, 3);
          const hiddenCount = routines.length - 3;
          return (
            <>
              <div className="space-y-1 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
                {visible.map(routine => {
                  const isExpanded = expandedRoutineId === routine.id;
                  return (
                    <div key={routine.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setExpandedRoutineId(isExpanded ? null : routine.id)}
                        className="w-full flex items-center gap-3.5 pl-4 pr-14 py-3.5 rounded-2xl transition-colors duration-200 text-left"
                        style={isExpanded ? { backgroundColor: 'var(--color-surface-hover)' } : undefined}
                      >
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                          <Dumbbell size={16} style={{ color: 'var(--color-text-subtle)' }} />
                        </div>
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(routine.name)}</p>
                          <p className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--color-text-subtle)' }}>
                            <span>{routine.exerciseCount} {t('workouts.exercises')}</span>
                            <span style={{ color: 'var(--color-border-subtle)' }}>·</span>
                            <span>{timeAgo(routine.lastPerformedAt)}</span>
                          </p>
                        </div>
                      </button>
                      {/* Delete button on card */}
                      <button
                        onClick={(e) => handleDelete(e, routine.id)}
                        disabled={deletingId === routine.id}
                        className="absolute top-2.5 right-2.5 min-w-[44px] min-h-[44px] w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                        style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)', opacity: 1 }}
                        aria-label="Delete routine"
                      >
                        <Trash2 size={13} />
                      </button>
                      {isExpanded && (
                        <RoutineDetail routineId={routine.id} onEdit={() => navigate(`/workouts/${routine.id}/edit`)} onDelete={(e) => handleDelete(e, routine.id)} deletingId={deletingId} onStart={() => posthog?.capture('routine_started', { routine_name: routine.name })} />
                      )}
                    </div>
                  );
                })}
              </div>
              {!showAllRoutines && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllRoutines(true)}
                  className="w-full mt-2 py-3 rounded-2xl text-[12px] font-medium transition-colors duration-200"
                  style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.showAllRoutines', { count: routines.length })}
                </button>
              )}
              {showAllRoutines && routines.length > 3 && (
                <button
                  onClick={() => setShowAllRoutines(false)}
                  className="w-full mt-2 py-3 rounded-2xl text-[12px] font-medium transition-colors duration-200"
                  style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.showLess')}
                </button>
              )}
            </>
          );
        })()}
      </section>

      {/* ════════════════════════════════════════════════════════
          SECTION 3: MY PROGRAMS
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.myPrograms')}</p>
          <button
            onClick={() => setShowGenerator(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-xl text-[11px] font-semibold transition-colors bg-[#10B981]/10 text-[#10B981]"
          >
            <Zap size={12} />
            {t('workouts.newProgram')}
          </button>
        </div>

        {/* Goals mismatch alert */}
        {goalsMismatch && programActive && (
          <div className="rounded-2xl bg-amber-500/[0.06] p-4 mb-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.goalsChanged')}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.goalsChangedDesc')}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setShowGenerator(true)} className="px-3 py-1.5 min-h-[44px] rounded-lg text-[11px] font-semibold bg-[#10B981] text-white">
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
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold bg-[#10B981] text-white hover:bg-[#0EA572] transition-colors"
            >
              {t('workouts.createYourFirstProgram')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {(showAllMyPrograms ? allPrograms : allPrograms.slice(0, 3)).map(prog => {
              const isActive = new Date(prog.expires_at) > new Date();
              const progTotalWeeks = prog.duration_weeks || 6;
              const weekNum = isActive
                ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, progTotalWeeks) : progTotalWeeks;
              const totalDays = progTotalWeeks * 7;
              const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), totalDays);
              const progress = Math.round((daysElapsed / totalDays) * 100);

              return (
                <div key={prog.id} className="relative rounded-2xl transition-colors duration-200 group" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <button onClick={() => { loadExerciseNames(); setSelectedMyProgram(prog); setMyProgWeek('1'); }} className="w-full text-left p-5" aria-label={`View program: ${gpName(prog)}`}>
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
                      <span className="flex items-center gap-1"><Calendar size={10} /> {t('workouts.sixWeeks')}</span>
                      <span>{isActive ? t('workouts.weekXOfY', { current: weekNum, total: 6 }) : t('workouts.finished')}</span>
                      {prog.routines_a_count > 0 && <span>{t('workouts.routinesCount', { count: prog.routines_a_count })}</span>}
                    </div>
                    <div className="w-full h-1 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                      <div
                        className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : ''}`}
                        style={{ width: `${progress}%`, ...(!isActive ? { backgroundColor: 'var(--color-text-subtle)' } : {}) }}
                      />
                    </div>
                  </button>
                  {/* Delete program */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(t('workouts.removeProgramConfirm'))) return;
                      if (isActive) {
                        await supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).eq('id', prog.id);
                      } else {
                        await supabase.from('generated_programs').delete().eq('id', prog.id);
                      }
                      const { data: allGp } = await supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
                      const programs = allGp || [];
                      setAllPrograms(programs);
                      setGeneratedProgram(programs[0] || null);
                    }}
                    className="absolute top-3 right-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)', opacity: 1 }}
                    aria-label="Delete program"
                  >
                    <Trash2 size={13} />
                  </button>
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

      {/* ════════════════════════════════════════════════════════
          SECTION 4: DISCOVER PROGRAMS
         ════════════════════════════════════════════════════════ */}
      <section id="discover-programs" className="mb-6">
        {/* Visual separator */}
        <div className="h-px mb-10" style={{ background: 'linear-gradient(to right, transparent, var(--color-border-subtle), transparent)' }} />

        <div className="mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.discover')}</p>
          <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.programs')}</h2>
        </div>

        {/* Category filter chips — Gym Exclusive added */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-5 -mx-1 px-1">
          {['Gym Exclusive', ...PROGRAM_CATEGORIES].map(cat => (
            <button
              key={cat}
              onClick={() => setProgramCategoryFilter(cat)}
              className={`shrink-0 px-3.5 py-1.5 min-h-[44px] rounded-full text-[11px] font-medium transition-all ${
                cat === 'Gym Exclusive' ? 'border' : ''
              }`}
              style={programCategoryFilter === cat
                ? cat === 'Gym Exclusive'
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' }
                  : { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }
                : cat === 'Gym Exclusive'
                  ? { color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }
                  : { color: 'var(--color-text-subtle)' }
              }
            >
              {cat === 'Gym Exclusive' ? t('workouts.gymExclusive', 'Gym Exclusive') : t(`workouts.programCategories.${cat}`)}
            </button>
          ))}
        </div>

        {/* Gym Exclusive programs section */}
        {programCategoryFilter !== 'Gym Exclusive' && gymPrograms.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent)' }} />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] shrink-0" style={{ color: 'var(--color-accent)' }}>
                {t('workouts.gymExclusive', 'Gym Exclusive')}
              </p>
              <div className="h-px flex-1" style={{ background: 'linear-gradient(to left, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent)' }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {gymPrograms.slice(0, 2).map(prog => (
                <button
                  key={prog.id}
                  onClick={() => { loadExerciseNames(); setSelectedTemplate({ ...prog, id: `gym_${prog.id}`, image: null, level: 'All Levels', daysPerWeek: prog.weeks?.['1']?.length || 5, durationWeeks: prog.duration_weeks || 6, category: 'Gym Exclusive' }); setTemplateWeek('1'); }}
                  className="relative text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-150"
                  style={{ aspectRatio: '3 / 4', backgroundColor: 'var(--color-bg-card)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
                  aria-label={`${prog.name} - Gym Exclusive program`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-card)), var(--color-bg-card))' }} />
                  <div className="absolute top-3 left-3 z-10">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)' }}>
                      {t('workouts.gymExclusive', 'Gym Exclusive')}
                    </span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
                    <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{prog.name}</p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {prog.duration_weeks || 6} {t('workouts.weeks', 'weeks')} · {prog.weeks?.['1']?.length || '?'} {t('workouts.daysPerWeekShort', 'days/wk')}
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {/* Separator before community programs */}
            <div className="flex items-center gap-3 mt-8">
              <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, var(--color-border-subtle), transparent)' }} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.communityPrograms', 'Programs')}
              </p>
              <div className="h-px flex-1" style={{ background: 'linear-gradient(to left, var(--color-border-subtle), transparent)' }} />
            </div>
          </div>
        )}

        {/* Program cards grid */}
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
              return gymPrograms.map(prog => (
                <button
                  key={prog.id}
                  onClick={() => { loadExerciseNames(); setSelectedTemplate({ ...prog, id: `gym_${prog.id}`, image: null, level: 'All Levels', daysPerWeek: prog.weeks?.['1']?.length || 5, durationWeeks: prog.duration_weeks || 6, category: 'Gym Exclusive' }); setTemplateWeek('1'); }}
                  className="relative text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-150"
                  style={{ aspectRatio: '3 / 4', backgroundColor: 'var(--color-bg-card)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
                  aria-label={`${prog.name} - Gym Exclusive program`}
                >
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-card)), var(--color-bg-card))' }} />
                  <div className="absolute top-3 left-3 z-10">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)' }}>
                      {t('workouts.gymExclusive', 'Gym Exclusive')}
                    </span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
                    <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{prog.name}</p>
                    {prog.description && <p className="text-[10px] mt-1 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>{prog.description}</p>}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                      {prog.duration_weeks || 6} {t('workouts.weeks', 'weeks')} · {prog.weeks?.['1']?.length || '?'} {t('workouts.daysPerWeekShort', 'days/wk')}
                    </p>
                  </div>
                </button>
              ));
            }

            const filtered = programTemplates
              .filter(p => programCategoryFilter === 'All' || p.category === programCategoryFilter);
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
                    {t(`workouts.programLevels.${tmpl.level}`)}
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
      </section>

    </div>

    {/* ── My Program Detail Modal ───────────────────────── */}
    {selectedMyProgram && (() => {
      const prog = selectedMyProgram;
      const isActive = new Date(prog.expires_at) > new Date();
      const progTotalWeeks = prog.duration_weeks || 6;
      const weekNum = isActive ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, progTotalWeeks) : progTotalWeeks;
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
      const programRoutines = isActive ? routines.filter(r => r.name.startsWith('Auto:')) : [];
      const localProgName = gpName(prog);

      return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" role="button" tabIndex={0} aria-label="Close program details" onClick={() => setSelectedMyProgram(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMyProgram(null); }} />
          <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}>
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button onClick={() => setSelectedMyProgram(null)} className="absolute right-4 top-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }} aria-label="Close">
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
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{isActive ? t('workouts.weekXOfY', { current: weekNum, total: 6 }) : t('workouts.programFinished')}</span>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : ''}`} style={{ width: `${progress}%`, ...(!isActive ? { backgroundColor: 'var(--color-text-subtle)' } : {}) }} />
                </div>
              </div>

              {/* This week's routines (if active) */}
              {isActive && programRoutines.length > 0 && (
                <div className="mb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.thisWeeksRoutines')}</p>
                  <div className="space-y-2">
                    {programRoutines.map(r => (
                      <Link key={r.id} to={`/session/${r.id}`} onClick={() => setSelectedMyProgram(null)} className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors group" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><Dumbbell size={14} style={{ color: 'var(--color-text-muted)' }} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(r.name)}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{r.exerciseCount} {t('workouts.exercises')}</p>
                        </div>
                        <ChevronRight size={14} className="transition-colors" style={{ color: 'var(--color-text-subtle)' }} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Week-by-week breakdown (if template_weeks exists) */}
              {weekKeys.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.programOverview')}</p>
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => canPrev && setMyProgWeek(weekKeys[weekIdx - 1])} disabled={!canPrev} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={canPrev ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }} aria-label="Previous week">
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.weekXOfY', { current: myProgWeek, total: weekKeys.length })}</span>
                    <button onClick={() => canNext && setMyProgWeek(weekKeys[weekIdx + 1])} disabled={!canNext} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={canNext ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }} aria-label="Next week">
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
                  onClick={async () => {
                    await supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).eq('id', prog.id);
                    setSelectedMyProgram(null);
                    // Refresh programs
                    const { data: allGp } = await supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, duration_weeks, schedule_map, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
                    const programs = allGp || [];
                    setAllPrograms(programs);
                    setGeneratedProgram(programs[0] || null);
                  }}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
                >
                  {t('workouts.removeProgram')}
                </button>
              ) : (
                <button onClick={() => { setSelectedMyProgram(null); const el = document.getElementById('discover-programs'); el?.scrollIntoView({ behavior: 'smooth' }); }} className="w-full py-4 rounded-2xl font-bold text-[15px] transition-colors" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface-hover)' }}>
                  {t('workouts.browseNewPrograms')}
                </button>
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
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" role="button" tabIndex={0} aria-label="Close program details" onClick={() => setSelectedTemplate(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTemplate(null); }} />
          <div
            className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}
          >
            {/* Handle + Close */}
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button
                onClick={() => setSelectedTemplate(null)}
                className="absolute right-4 top-3 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Hero */}
              <div className="mb-6">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t(`workouts.programLevels.${selectedTemplate.level}`)} · {t(`workouts.programCategories.${selectedTemplate.category}`)}
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
                    aria-label="Previous week"
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
                    aria-label="Next week"
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
                className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.98] transition-all text-white bg-[#10B981] hover:bg-[#0EA572] disabled:opacity-50"
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

    {/* ── Start Mode Choice Dialog ────────────── */}
    {startModeChoice === 'choosing' && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label="Close start mode dialog" onClick={() => setStartModeChoice(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setStartModeChoice(null); }}>
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
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-black transition-colors"
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
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label="Close switch program dialog" onClick={() => setSwitchStep(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSwitchStep(null); }}>
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
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
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
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label="Close day compression warning" onClick={() => setDayCompressionWarning(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDayCompressionWarning(null); }}>
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
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
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
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label="Close goal mismatch warning" onClick={() => setGoalMismatchWarning(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setGoalMismatchWarning(null); }}>
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
              className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
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
    </>
  );
};

export default Workouts;

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronRight, ChevronLeft, Zap, Dumbbell, Heart, Check, AlertTriangle, Pencil } from 'lucide-react';
import posthogClient from 'posthog-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { clearCache } from '../lib/queryCache';
import logger from '../lib/logger';
import { generateProgram } from '../lib/workoutGenerator';
import { generateRoutineName } from '../lib/programNaming';
import useFocusTrap from '../hooks/useFocusTrap';
import { getExercises } from '../lib/exerciseStore';
const ALL_EXERCISES = getExercises();
import { exName, localizeRoutineName } from '../lib/exerciseName';

const exerciseNameMap = Object.fromEntries(ALL_EXERCISES.map(e => [e.id, e]));

const MUSCLE_OPTIONS = [
  { value: 'Chest' },
  { value: 'Back' },
  { value: 'Legs' },
  { value: 'Glutes' },
  { value: 'Shoulders' },
  { value: 'Biceps' },
  { value: 'Core' },
];

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// ── Step 1: Customize Your Program ────────────────────────────────────────
const StepCustomize = ({ form, onChange, onToggleMuscle }) => {
  const { t } = useTranslation('pages');
  const set = (k, v) => onChange(k, v);

  const accentSel = { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)', color: 'var(--color-accent)' };
  const defaultSel = { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-subtle)' };

  return (
    <div className="space-y-4">
      {/* Program type — prominent cards */}
      <div className="flex gap-2">
        {[
          { value: 'strength', icon: Dumbbell, label: t('generateWorkout.typeStrength', 'Strength'), desc: t('generateWorkout.typeStrengthDesc', 'Weight training') },
          { value: 'cardio',   icon: Heart,    label: t('generateWorkout.typeCardio', 'Cardio'), desc: t('generateWorkout.typeCardioDesc', 'Cardio sessions') },
          { value: 'hybrid',   icon: Zap,      label: t('generateWorkout.typeHybrid', 'Hybrid'), desc: t('generateWorkout.typeHybridDesc', 'Lifting + Cardio') },
        ].map(opt => {
          const sel = form.program_type === opt.value;
          return (
            <button key={opt.value} type="button" onClick={() => set('program_type', opt.value)}
              className="flex-1 flex flex-col items-center gap-1.5 py-4 rounded-2xl border-2 transition-all active:scale-[0.97]"
              style={sel ? accentSel : defaultSel}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: sel ? 'color-mix(in srgb, var(--color-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)' }}>
                <opt.icon size={18} style={{ color: sel ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
              </div>
              <span className="text-[13px] font-bold" style={{ color: sel ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{opt.label}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Schedule section — grouped card */}
      <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
        {/* Training days */}
        <div>
          <label className="block text-[12px] uppercase tracking-[0.15em] mb-2" style={{ color: 'var(--color-text-muted)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800 }}>{t('generateWorkout.trainingDays')}</label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <button key={n} type="button" onClick={() => set('training_days', n)}
                className="flex-1 h-10 rounded-xl text-[14px] font-bold border transition-all"
                style={form.training_days === n ? accentSel : defaultSel}
              >{n}</button>
            ))}
          </div>
        </div>

        {/* Duration + Intensity row */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[12px] uppercase tracking-[0.15em] mb-2" style={{ color: 'var(--color-text-muted)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800 }}>{t('generateWorkout.sessionDuration')}</label>
            <div className="relative">
              <input type="number" inputMode="numeric" min="10" max="180" placeholder="60"
                value={form.session_duration_min}
                onChange={e => set('session_duration_min', e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')}
                className="w-full rounded-[14px] px-3 py-2.5 outline-none pr-12 focus:ring-2 focus:ring-[#6D5FDB]"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)', border: 'none', fontSize: '16px' }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>min</span>
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-[12px] uppercase tracking-[0.15em] mb-2" style={{ color: 'var(--color-text-muted)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800 }}>{t('generateWorkout.programLength')}</label>
            <div className="flex gap-1">
              {[4, 6, 8, 12].map(n => (
                <button key={n} type="button" onClick={() => set('program_weeks', n)}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-bold border transition-all"
                  style={form.program_weeks === n ? accentSel : defaultSel}
                >{n}w</button>
              ))}
            </div>
          </div>
        </div>

        {/* Intensity */}
        <div>
          <label className="block text-[12px] uppercase tracking-[0.15em] mb-2" style={{ color: 'var(--color-text-muted)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800 }}>{t('generateWorkout.intensity')}</label>
          <div className="flex gap-2">
            {[
              { value: 'low',      label: t('generateWorkout.intensityLow', 'Low') },
              { value: 'moderate', label: t('generateWorkout.intensityModerate', 'Moderate') },
              { value: 'high',     label: t('generateWorkout.intensityHigh', 'High') },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => set('intensity', opt.value)}
                className="flex-1 py-2.5 rounded-xl text-[12px] font-bold border transition-all"
                style={form.intensity === opt.value ? accentSel : defaultSel}
              >{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Target Areas — strength/hybrid only */}
      {form.program_type !== 'cardio' && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
          <label className="block text-[12px] uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--color-text-muted)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800 }}>{t('generateWorkout.targetAreas')}</label>
          <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.priorityMusclesDesc')}</p>
          <div className="flex flex-wrap gap-1.5">
            {MUSCLE_OPTIONS.map(m => {
              const active = form.priority_muscles.includes(m.value);
              return (
                <button key={m.value} type="button" onClick={() => onToggleMuscle(m.value)}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-all"
                  style={active ? accentSel : defaultSel}
                >{t(`generateWorkout.muscleOptions.${m.value.toLowerCase()}`)}</button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cardio focus — cardio only */}
      {form.program_type === 'cardio' && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
          <label className="block text-[12px] uppercase tracking-[0.15em] mb-2" style={{ color: 'var(--color-text-muted)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800 }}>{t('generateWorkout.cardioFocus', 'Focus')}</label>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: 'mixed', label: t('generateWorkout.cardioMixed', 'Mixed') },
              { value: 'liss', label: 'LISS' },
              { value: 'hiit', label: 'HIIT' },
              { value: 'machines', label: t('generateWorkout.cardioMachines', 'Machines') },
              { value: 'sports', label: t('generateWorkout.cardioSports', 'Sports') },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => set('cardio_focus', opt.value)}
                className="px-3.5 py-2 rounded-xl text-[12px] font-semibold border transition-all"
                style={form.cardio_focus === opt.value ? accentSel : defaultSel}
              >{opt.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Hybrid info */}
      {form.program_type === 'hybrid' && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-bg-card))', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-accent)' }}>{t('generateWorkout.hybridDesc', 'Hybrid program')}</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.hybridDescBody', 'Combines weight training with cardio finishers. Each session ends with 10-15 min cardio.')}</p>
        </div>
      )}
    </div>
  );
};

// ── Step 2: Preview (Expandable Week View) ────────────────────────────────
const StepPreview = ({ result, programWeeks }) => {
  const { t } = useTranslation('pages');
  const [viewWeek, setViewWeek] = useState(1);
  const [expandedDay, setExpandedDay] = useState(null);

  if (!result) return null;
  const { splitLabel, template_weeks } = result;
  const totalWeeks = programWeeks || result.durationWeeks || 6;

  // Get days for the current viewing week
  const weekDays = template_weeks?.[String(viewWeek)] || [];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{localizeRoutineName(splitLabel)}</h2>
        </div>
      </div>

      {/* Week navigator */}
      <div className="rounded-2xl px-4 py-5" style={{ backgroundColor: 'var(--color-bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewWeek(w => Math.max(1, w - 1))}
              disabled={viewWeek <= 1}
              className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20 focus:ring-2 focus:ring-[#6D5FDB] focus:outline-none"
              style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
              aria-label={t('generateWorkout.ariaPreviousWeek', 'Previous week')}
            >
              <ChevronLeft size={16} />
            </button>
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                {t('workouts.weekXOfY', { current: viewWeek, total: totalWeeks })}
              </h2>
              <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                {viewWeek % 2 === 1 ? t('generateWorkout.week1') : t('generateWorkout.week2')}
              </p>
            </div>
            <button
              onClick={() => setViewWeek(w => Math.min(totalWeeks, w + 1))}
              disabled={viewWeek >= totalWeeks}
              className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20 focus:ring-2 focus:ring-[#6D5FDB] focus:outline-none"
              style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
              aria-label={t('generateWorkout.ariaNextWeek', 'Next week')}
            >
              <ChevronRight size={16} />
            </button>
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
              style={{ width: `${Math.min((viewWeek / totalWeeks) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Expandable day list */}
        <div className="space-y-2">
          {weekDays.map((day, di) => {
            const dayExpanded = expandedDay === `week-${viewWeek}-${di}`;
            const exercises = day.exercises || [];
            return (
              <div key={di}>
                <button
                  type="button"
                  onClick={() => setExpandedDay(dayExpanded ? null : `week-${viewWeek}-${di}`)}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left"
                  style={{ backgroundColor: 'var(--color-surface-hover)' }}
                >
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                    <Dumbbell size={15} style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(day.label) || t('workouts.dayN', { n: di + 1, defaultValue: `Day ${di + 1}` })}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{exercises.length} {t('workouts.exercises', 'exercises')}</p>
                  </div>
                  <ChevronRight size={16} className={`flex-shrink-0 transition-transform duration-200 ${dayExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
                </button>
                {dayExpanded && (
                  <div className="mx-4 mb-2 px-4 py-3 rounded-xl border" style={{ backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)' }}>
                    <div className="space-y-1.5">
                      {exercises.map((ex, i) => {
                        const exId = typeof ex === 'string' ? ex : ex?.id || ex?.exerciseId;
                        const resolved = exerciseNameMap[exId];
                        const setsReps = ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : ex.sets ? `${ex.sets} ${t('workouts.sets', 'sets')}` : '';
                        return (
                          <div key={i} className="flex items-center justify-between">
                            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                              <span className="mr-1.5" style={{ color: 'var(--color-text-subtle)' }}>{i + 1}.</span>
                              {exName(resolved) ?? ex.name ?? exId}
                            </p>
                            {setsReps && <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{setsReps}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {weekDays.length === 0 && (
            <div className="rounded-xl py-6 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
              <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.generating')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Cardio note */}
      {result.cardio?.daysPerWeek > 0 && (
        <div className="flex items-start gap-3 bg-emerald-500/6 border border-emerald-500/15 rounded-xl px-4 py-3">
          <Heart size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-emerald-400">{t('generateWorkout.cardioPerWeek', { count: result.cardio.daysPerWeek })}</p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{result.cardio.description}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Helper: build template_weeks from routinesA/routinesB ─────────────────
const buildTemplateWeeks = (routinesA, routinesB, programWeeks, preferredTrainingDays) => {
  const weeks = {};
  const dayNameToPreviewIdx = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
  const userDays = (preferredTrainingDays || [])
    .map(d => dayNameToPreviewIdx[d.toLowerCase()])
    .filter(n => n !== undefined)
    .sort((a, b) => a - b);
  const daysCount = routinesA.length;
  const fallbackPatterns = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
  };
  const dayAssignments = userDays.length >= daysCount
    ? userDays.slice(0, daysCount)
    : (fallbackPatterns[Math.min(daysCount, 7)] || []);

  for (let w = 1; w <= programWeeks; w++) {
    const routines = w % 2 === 1 ? routinesA : routinesB;
    const weekDays = [];
    for (let ri = 0; ri < routines.length; ri++) {
      const r = routines[ri];
      weekDays.push({
        label: r.label || r.name,
        name: r.name,
        name_es: r.name_es,
        exercises: r.exercises.map(ex => ({
          id: ex.exerciseId || ex.id,
          name: ex.name,
          name_es: ex.name_es,
          sets: ex.sets,
          reps: ex.reps,
          restSeconds: ex.restSeconds || ex.rest_seconds,
        })),
      });
    }
    weeks[String(w)] = weekDays;
  }
  return weeks;
};

// ── Main Modal ─────────────────────────────────────────────────────────────
const GenerateWorkoutModal = ({ onboarding, onClose, onGenerated, onCreateManual }) => {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [step, setStep]     = useState(0);
  // 'choose' = the build-it-myself vs auto fork; 'auto' = the customize→preview flow.
  const [mode, setMode]     = useState('choose');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [result, setResult] = useState(null);
  const focusTrapRef = useFocusTrap(true, onClose);

  // Lock body scroll while modal is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [form, setForm] = useState({
    program_type:       'strength',
    training_days:      onboarding?.training_days_per_week || 3,
    session_duration_min: parseInt(localStorage.getItem('tugympr_workout_duration') || '60', 10),
    intensity:          'moderate',
    program_weeks:      6,
    priority_muscles:   onboarding?.priority_muscles || [],
    cardio_focus:       'mixed',
  });

  const onChange = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const onToggleMuscle = (val) => setForm(prev => {
    const list = prev.priority_muscles;
    return {
      ...prev,
      priority_muscles: list.includes(val)
        ? list.filter(m => m !== val)
        : [...list, val],
    };
  });

  // Generate preview when moving to step 1
  useEffect(() => {
    if (step === 1) {
      try {
        if (form.program_type === 'cardio') {
          // Generate cardio-only program using user's settings
          const days = form.training_days;
          const dur = form.session_duration_min || 30;
          const focus = form.cardio_focus || 'mixed';

          // Exercise pools by focus
          const machinePool = [
            { id: 'ex_cd_treadmill', name: 'Treadmill', name_es: 'Caminadora' },
            { id: 'ex_cd_bike', name: 'Stationary Bike', name_es: 'Bicicleta estática' },
            { id: 'ex_cd_elliptical', name: 'Elliptical', name_es: 'Elíptica' },
            { id: 'ex_cd_rower', name: 'Rowing Machine', name_es: 'Máquina de remo' },
            { id: 'ex_cd_stairmaster', name: 'Stairmaster', name_es: 'Escaladora' },
          ];
          const hiitPool = [
            { id: 'ex_cd_hiit', name: 'HIIT', name_es: 'HIIT' },
            { id: 'ex_cd_jumprope', name: 'Jump Rope', name_es: 'Saltar la cuerda' },
            { id: 'ex_cd_boxing', name: 'Boxing', name_es: 'Boxeo' },
          ];
          const lissPool = [
            { id: 'ex_cd_treadmill', name: 'Treadmill', name_es: 'Caminadora' },
            { id: 'ex_cd_bike', name: 'Stationary Bike', name_es: 'Bicicleta estática' },
            { id: 'ex_cd_walking', name: 'Walking', name_es: 'Caminar' },
            { id: 'ex_cd_elliptical', name: 'Elliptical', name_es: 'Elíptica' },
          ];
          const sportsPool = [
            { id: 'ex_cd_basketball', name: 'Basketball', name_es: 'Baloncesto' },
            { id: 'ex_cd_soccer', name: 'Soccer', name_es: 'Fútbol' },
            { id: 'ex_cd_tennis', name: 'Tennis', name_es: 'Tenis' },
            { id: 'ex_cd_boxing', name: 'Boxing', name_es: 'Boxeo' },
            { id: 'ex_cd_dance', name: 'Dance', name_es: 'Baile' },
            { id: 'ex_cd_martial', name: 'Martial Arts', name_es: 'Artes Marciales' },
          ];
          const mixedPool = [...machinePool, ...hiitPool.slice(0, 1), { id: 'ex_cd_jumprope', name: 'Jump Rope', name_es: 'Saltar la cuerda' }];

          const pool = focus === 'machines' ? machinePool : focus === 'hiit' ? hiitPool : focus === 'liss' ? lissPool : focus === 'sports' ? sportsPool : mixedPool;

          // Calculate per-exercise duration
          const exPerDay = dur <= 20 ? 2 : dur <= 30 ? 2 : 3;
          const perExDur = Math.round(dur / exPerDay);

          const routines = [];
          const typesByFocus = {
            mixed: ['Mixed Cardio', 'HIIT Day', 'Endurance', 'Recovery', 'Power Cardio'],
            liss: ['Steady State', 'Easy Pace', 'Long Session', 'Recovery', 'Endurance'],
            hiit: ['HIIT Blast', 'Tabata', 'Circuit', 'Sprint Intervals', 'Power Rounds'],
            machines: ['Machine Circuit', 'Endurance', 'Interval', 'Recovery', 'Challenge'],
            sports: ['Game Day', 'Agility', 'Sport Mix', 'Endurance', 'Active Fun'],
          };
          const types = typesByFocus[focus] || typesByFocus.mixed;

          for (let i = 0; i < days; i++) {
            const dayExercises = [];
            for (let j = 0; j < exPerDay; j++) {
              const ex = pool[(i * exPerDay + j) % pool.length];
              dayExercises.push({ ...ex, sets: 1, reps: `${perExDur}min`, rest_seconds: 0 });
            }
            const typeName = types[i % types.length];
            routines.push({ name: typeName, name_es: typeName, label: typeName, exercises: dayExercises });
          }
          const cardioResult = {
            split: 'cardio',
            splitLabel: 'Cardio Program',
            somatotype: 'balanced',
            recoveryTier: 'standard',
            shortWorkout: false,
            routinesA: routines,
            routinesB: routines,
            cardio: { daysPerWeek: days, description: `${dur}min ${focus} cardio` },
            durationWeeks: form.program_weeks,
          };
          cardioResult.template_weeks = buildTemplateWeeks(cardioResult.routinesA, cardioResult.routinesB, form.program_weeks, profile?.preferred_training_days);
          setResult(cardioResult);
        } else {
          const r = generateProgram({
            ...onboarding,
            training_days_per_week: form.training_days,
            priority_muscles: form.priority_muscles,
            workout_duration_min: form.session_duration_min || 60,
          });
          // For hybrid: append a cardio finisher to each routine
          if (form.program_type === 'hybrid') {
            const cardioFinishers = [
              { id: 'ex_cd_treadmill', name: 'Treadmill', name_es: 'Caminadora', sets: 1, reps: '10min', rest_seconds: 0 },
              { id: 'ex_cd_bike', name: 'Stationary Bike', name_es: 'Bicicleta estática', sets: 1, reps: '10min', rest_seconds: 0 },
              { id: 'ex_cd_rower', name: 'Rowing Machine', name_es: 'Máquina de remo', sets: 1, reps: '10min', rest_seconds: 0 },
            ];
            r.routinesA = r.routinesA.map((routine, i) => ({
              ...routine,
              exercises: [...routine.exercises, { ...cardioFinishers[i % cardioFinishers.length] }],
            }));
            r.routinesB = r.routinesB.map((routine, i) => ({
              ...routine,
              exercises: [...routine.exercises, { ...cardioFinishers[i % cardioFinishers.length] }],
            }));
          }
          r.durationWeeks = form.program_weeks;
          r.template_weeks = buildTemplateWeeks(r.routinesA, r.routinesB, form.program_weeks, profile?.preferred_training_days);
          setResult(r);
        }
      } catch (e) {
        logger.error('Generator error', e);
      }
    }
  }, [step]);

  const [gymHoursWarnings, setGymHoursWarnings] = useState([]);

  const handleGenerate = async () => {
    if (!user?.id || !profile?.gym_id) return;
    if (!result) {
      setError(t('generateWorkout.generating', 'Generating…'));
      return;
    }
    setSaving(true);
    setError('');
    setGymHoursWarnings([]);
    try {
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

      // Delete existing auto-generated routines (only those matching the specific pattern used by the generator)
      const { data: existing } = await supabase
        .from('routines')
        .select('id')
        .eq('created_by', user.id)
        .like('name', 'Auto: Week%');

      if (existing?.length) {
        await supabase.from('routines').delete().in('id', existing.map(r => r.id));
      }

      // Delete existing generated_programs row
      await supabase.from('generated_programs').delete().eq('profile_id', user.id);

      // Compute preferred day mapping for workout_schedule
      // DB day_of_week: Sunday=0, Monday=1, ..., Saturday=6
      const dayNameToDbNum = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const dbNumToDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const preferredDays = profile?.preferred_training_days || [];
      const userDbDays = preferredDays
        .map(d => dayNameToDbNum[d.toLowerCase()])
        .filter(n => n !== undefined)
        .sort((a, b) => a - b);
      const trainingDays = result.routinesA.length;
      const fallbackPattern = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
      const candidateDays = userDbDays.length >= trainingDays
        ? userDbDays.slice(0, trainingDays)
        : (fallbackPattern[trainingDays] || [1, 3, 5]);

      // Remove closed days from candidate schedule
      const availableDays = candidateDays.filter(d => !closedDays.has(d));

      // If closed days reduced available slots, fill from remaining open days
      let scheduleDays = availableDays;
      if (availableDays.length < trainingDays) {
        const allOpenDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !closedDays.has(d));
        const used = new Set(availableDays);
        for (const d of allOpenDays) {
          if (scheduleDays.length >= trainingDays) break;
          if (!used.has(d)) {
            scheduleDays.push(d);
            used.add(d);
          }
        }
        scheduleDays.sort((a, b) => a - b);
      }

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
                t('generateWorkout.closingTimeWarning', {
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

      // Delete existing workout_schedule for this user
      await supabase.from('workout_schedule').delete().eq('profile_id', user.id).then(() => {}).catch(() => {});

      // Save all routines (A + B sets)
      const allRoutines = [...result.routinesA, ...result.routinesB];
      const savedRoutineAIds = [];
      const savedRoutineBIds = [];
      // Creative names ("Auto: Apex Build") to match the regenerate path instead
      // of the generator's raw "Auto: Upper A" labels. Cardio routines (no
      // slotsKey) keep their themed names. Variant B's name index is bumped past
      // the half-pool so A/B pull different names (Apex Build vs Steel Build).
      const nameSeed = result.seed || Math.floor(Math.random() * 100000);
      for (let ri = 0; ri < allRoutines.length; ri++) {
        const routine = allRoutines[ri];
        const isVariantB = ri >= result.routinesA.length;
        const routineName = routine.slotsKey
          ? `Auto: ${generateRoutineName(routine.slotsKey, (routine.variantIndex || 0) + (isVariantB ? 5 : 0), nameSeed)}`
          : routine.name;
        const { data: saved, error: rErr } = await supabase
          .from('routines')
          .insert({
            name:       routineName,
            gym_id:     profile.gym_id,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (rErr) throw rErr;

        // Track Week A and Week B routine IDs separately
        if (isVariantB) {
          savedRoutineBIds.push(saved.id);
        } else {
          savedRoutineAIds.push(saved.id);
        }

        if (routine.exercises.length > 0) {
          const rows = routine.exercises.map((ex, i) => ({
            routine_id:   saved.id,
            exercise_id:  ex.exerciseId,
            position:     i + 1,
            target_sets:  ex.sets,
            target_reps:  ex.reps,
            rest_seconds: ex.restSeconds,
          }));
          const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
          if (exErr) throw exErr;
        }
      }

      // Save workout_schedule entries for Week A routines
      for (let i = 0; i < savedRoutineAIds.length && i < scheduleDays.length; i++) {
        await supabase.from('workout_schedule').upsert({
          profile_id: user.id,
          gym_id:     profile.gym_id,
          day_of_week: scheduleDays[i],
          routine_id:  savedRoutineAIds[i],
          updated_at:  new Date().toISOString(),
        }, { onConflict: 'profile_id,day_of_week' }).then(() => {}).catch(() => {});
      }

      // Save generated_programs row — use form.program_weeks for expiry
      const programStart = new Date().toISOString().split('T')[0];
      const expiresDate  = new Date();
      expiresDate.setDate(expiresDate.getDate() + (form.program_weeks * 7));
      const expiresAt = expiresDate.toISOString().split('T')[0];

      // Build schedule_map matching the personalProgramService structure so
      // activeProgramRoutineIds, A/B week display, and program name all work.
      const scheduleMapPayload = {
        display_name:  result.splitLabel || result.split,
        routine_ids:   [...savedRoutineAIds, ...savedRoutineBIds],
        routine_ids_a: savedRoutineAIds,
        routine_ids_b: savedRoutineBIds,
        routine_day_map: scheduleDays.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
        normal_dows:   scheduleDays,
        start_dow:     new Date().getDay(),
      };

      await supabase.from('generated_programs').insert({
        profile_id:    user.id,
        gym_id:        profile.gym_id,
        program_start: programStart,
        expires_at:    expiresAt,
        duration_weeks: form.program_weeks,
        split_type:    result.split,
        routines_a_count: result.routinesA.length,
        cardio_days:   result.cardio,
        template_weeks: result.template_weeks,
        schedule_map:  scheduleMapPayload,
      });

      // Persist the chosen day count + duration to onboarding so a later
      // "Regenerate" honors them (regenerate reads member_onboarding) instead of
      // reverting to the goal-derived default. Best-effort, non-fatal.
      try {
        await supabase.from('member_onboarding').update({
          training_days_per_week: form.training_days,
          workout_duration_min: form.session_duration_min || 60,
        }).eq('profile_id', user.id);
      } catch { /* non-fatal */ }

      clearCache(`dash:${user.id}`);
      try { clearCache(`routines:${user.id}`); } catch {}
      try { localStorage.removeItem(`qs_cache_v1_${user.id}`); } catch {}
      // Keep the Home tab + QuickStart (/record) in sync — both listen for this.
      try { window.dispatchEvent(new CustomEvent('tugympr:programs-changed')); } catch {}
      // Program-generation conversion. This in-app builder does NOT route through
      // personalProgramService (which fires its own program_generated for the
      // onboarding/regenerate paths), so capture here. Props mirror that event +
      // a `source` discriminator. No PII.
      try {
        posthogClient?.capture('program_generated', {
          source: 'in_app',
          split: result.split,
          goal: onboarding?.primary_goal,
          program_type: form.program_type,
          days: form.training_days,
          routines_count: result.routinesA?.length || 0,
          duration_weeks: form.program_weeks,
        });
      } catch { /* noop */ }
      onGenerated?.();
      onClose();
    } catch (err) {
      // Never render raw DB errors to members. supabase-js failures re-thrown
      // by useRoutines carry a PG/PostgREST code (server reject); code-less
      // errors are network-ish ("TypeError: Load failed").
      console.error('[generate workout] save failed:', err);
      const code = String(err?.code || '').trim();
      const isServerReject = /^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code);
      setError(isServerReject
        ? t('generateWorkout.somethingWentWrong')
        : t('progress.body.connectionError', 'No connection — try again when you’re back online.'));
    } finally {
      setSaving(false);
    }
  };

  // Always allow advance from step 0 — body data comes from onboarding
  const canAdvance = true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-workout-title"
        className="rounded-[22px] w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden relative"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        {saving && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3" style={{ background: 'color-mix(in srgb, var(--color-bg-card) 92%, transparent)', backdropFilter: 'blur(2px)' }}>
            <div className="w-10 h-10 rounded-full border-[3px] animate-spin" style={{ borderColor: 'var(--color-border-subtle)', borderTopColor: 'var(--color-accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('generateWorkout.generating')}</p>
          </div>
        )}
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--color-border-subtle)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(109, 95, 219, 0.12)' }}>
              <Zap size={15} style={{ color: '#6D5FDB' }} />
            </div>
            <div>
              <p id="generate-workout-title" className="text-[15px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('generateWorkout.generateMyProgram')}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{mode === 'choose' ? t('generateWorkout.chooseSubtitle', 'How do you want to build it?') : t('generateWorkout.stepXOfY', { current: step + 1, total: 2 })}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('generateWorkout.ariaCloseDialog', 'Close dialog')} className="w-9 h-9 rounded-full flex items-center justify-center focus:ring-2 focus:ring-[#6D5FDB] focus:outline-none" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
            <X size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        {/* Step indicator (auto flow only) */}
        {mode === 'auto' && (
          <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
            {[0, 1].map(i => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? 'bg-[#6D5FDB]' : ''}`} style={i > step ? { backgroundColor: 'var(--color-border-subtle)' } : undefined} />
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {mode === 'choose' ? (
            <div className="py-1">
              <button
                onClick={() => { onClose(); onCreateManual?.(); }}
                className="w-full flex items-start gap-3 p-4 rounded-2xl mb-3 text-left active:scale-[0.99] transition-transform"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
                  <Pencil size={18} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('generateWorkout.createYourself', 'Build it myself')}</p>
                  <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.createYourselfDesc', 'Pick your days and exercises from scratch.')}</p>
                </div>
              </button>
              <button
                onClick={() => setMode('auto')}
                className="w-full flex items-start gap-3 p-4 rounded-2xl text-left active:scale-[0.99] transition-transform"
                style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(109,95,219,0.14)' }}>
                  <Zap size={18} style={{ color: '#6D5FDB' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('generateWorkout.autoChoice', 'Auto-generate')}</p>
                  <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.autoChoiceDesc', 'We build a program for you from your goals.')}</p>
                </div>
              </button>
            </div>
          ) : (
            <>
              {step === 0 && (
                <StepCustomize form={form} onChange={onChange} onToggleMuscle={onToggleMuscle} />
              )}
              {step === 1 && (
                <StepPreview result={result} programWeeks={form.program_weeks} />
              )}
            </>
          )}
        </div>

        {/* Footer (auto flow only — choose mode has its own buttons) */}
        {mode === 'auto' && (
        <div className="px-5 pb-5 pt-3 border-t flex-shrink-0 space-y-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {gymHoursWarnings.length > 0 && (
            <div className="space-y-1">
              {gymHoursWarnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  {w}
                </p>
              ))}
            </div>
          )}
          {error && <p className="text-[12px] text-red-400">{error}</p>}
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1.5 px-4 py-3 rounded-full transition-colors text-[13px] font-semibold focus:ring-2 focus:ring-[#6D5FDB] focus:outline-none"
                style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface-hover)' }}
              >
                <ChevronLeft size={15} /> {t('generateWorkout.back')}
              </button>
            )}
            {step === 0 ? (
              <button
                onClick={() => setStep(1)}
                disabled={!canAdvance}
                className="flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[14px] py-3 rounded-[16px] transition-all focus:ring-2 focus:ring-[#6D5FDB] focus:outline-none"
                style={{ backgroundColor: '#6D5FDB', fontWeight: 800 }}
              >
                {t('generateWorkout.previewProgram')} <ChevronRight size={15} />
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 disabled:opacity-50 text-white text-[14px] py-3 rounded-[16px] transition-all focus:ring-2 focus:ring-[#6D5FDB] focus:outline-none"
                style={{ backgroundColor: '#6D5FDB', fontWeight: 800 }}
              >
                {saving ? t('generateWorkout.generating') : <><Check size={15} strokeWidth={2.5} /> {t('generateWorkout.generateMyProgram')}</>}
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default GenerateWorkoutModal;

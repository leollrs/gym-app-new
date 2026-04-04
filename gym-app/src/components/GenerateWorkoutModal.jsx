import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronRight, ChevronLeft, Zap, Dumbbell, Heart, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { clearCache } from '../lib/queryCache';
import logger from '../lib/logger';
import { generateProgram } from '../lib/workoutGenerator';
import useFocusTrap from '../hooks/useFocusTrap';
import { exercises as ALL_EXERCISES } from '../data/exercises';
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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-bold mb-0.5" style={{ color: 'var(--color-text-primary)' }}>{t('generateWorkout.customizeProgram')}</h2>
        <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.customizeProgramDesc')}</p>
      </div>

      {/* Program type toggle */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.programType', 'Program Type')}</label>
        <div className="flex gap-2">
          {[
            { value: 'strength', icon: Dumbbell, label: t('generateWorkout.typeStrength', 'Strength'), desc: t('generateWorkout.typeStrengthDesc', 'Weight training') },
            { value: 'cardio',   icon: Heart,    label: t('generateWorkout.typeCardio', 'Cardio'), desc: t('generateWorkout.typeCardioDesc', 'Cardio sessions') },
            { value: 'hybrid',   icon: Zap,      label: t('generateWorkout.typeHybrid', 'Hybrid'), desc: t('generateWorkout.typeHybridDesc', 'Lifting + Cardio') },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('program_type', opt.value)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${
                form.program_type === opt.value ? 'border-opacity-50' : ''
              }`}
              style={form.program_type === opt.value
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)' }
                : { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)' }
              }
            >
              <opt.icon size={16} style={{ color: form.program_type === opt.value ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
              <span className="text-[13px] font-semibold" style={{ color: form.program_type === opt.value ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}>{opt.label}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Training days per week */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.trainingDays')}</label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => set('training_days', n)}
              className="w-10 h-10 rounded-xl text-[14px] font-bold border transition-all flex items-center justify-center"
              style={form.training_days === n
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)', color: 'var(--color-accent)' }
                : { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
              }
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Session duration — free text input */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.sessionDuration')}</label>
        <div className="relative">
          <input
            type="number"
            min="10"
            placeholder="45"
            value={form.session_duration_min}
            onChange={e => set('session_duration_min', e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')}
            className="w-full border rounded-xl px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-[#D4AF37] pr-12"
            style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)', borderColor: 'rgba(255,255,255,0.06)', fontSize: '16px' }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.sessionDurationMin', 'min')}</span>
        </div>
      </div>

      {/* Intensity */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.intensity')}</label>
        <div className="flex gap-2">
          {[
            { value: 'low',      label: t('generateWorkout.intensityLow', 'Low') },
            { value: 'moderate', label: t('generateWorkout.intensityModerate', 'Moderate') },
            { value: 'high',     label: t('generateWorkout.intensityHigh', 'High') },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('intensity', opt.value)}
              className="flex-1 py-2.5 rounded-full text-[13px] font-semibold border transition-all"
              style={form.intensity === opt.value
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)', color: 'var(--color-accent)' }
                : { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Program length */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.programLength')}</label>
        <div className="flex gap-2">
          {[4, 6, 8, 12].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => set('program_weeks', n)}
              className="flex-1 py-2.5 rounded-full text-[13px] font-semibold border transition-all"
              style={form.program_weeks === n
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)', color: 'var(--color-accent)' }
                : { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
              }
            >
              {n} {t('generateWorkout.weeks', 'wk')}
            </button>
          ))}
        </div>
      </div>

      {/* Priority muscles / Target Areas — only for strength/hybrid */}
      {form.program_type !== 'cardio' && (
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.targetAreas')}</label>
        <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.priorityMusclesDesc')}</p>
        <div className="flex flex-wrap gap-2">
          {MUSCLE_OPTIONS.map(m => {
            const active = form.priority_muscles.includes(m.value);
            const atMax  = !active && form.priority_muscles.length >= 3;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => !atMax && onToggleMuscle(m.value)}
                className={`text-[13px] font-semibold px-3 py-1.5 rounded-full border transition-all ${
                  active
                    ? ''
                    : atMax
                    ? 'cursor-not-allowed opacity-40'
                    : ''
                }`}
                style={active
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)', color: 'var(--color-accent)' }
                  : { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
                }
              >
                {t(`generateWorkout.muscleOptions.${m.value.toLowerCase()}`)}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Cardio focus picker — only for cardio */}
      {form.program_type === 'cardio' && (
        <>
          <div className="rounded-xl p-4" style={{ backgroundColor: 'color-mix(in srgb, #10B981 8%, var(--color-bg-card))', border: '1px solid color-mix(in srgb, #10B981 20%, transparent)' }}>
            <p className="text-[13px] font-semibold" style={{ color: '#10B981' }}>{t('generateWorkout.cardioDesc', 'Cardio-focused program')}</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.cardioDescBody', 'Generates a mix of cardio exercises tailored to your schedule.')}</p>
          </div>

          {/* Cardio focus */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.cardioFocus', 'Focus')}</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'mixed', label: t('generateWorkout.cardioMixed', 'Mixed') },
                { value: 'liss', label: 'LISS' },
                { value: 'hiit', label: 'HIIT' },
                { value: 'machines', label: t('generateWorkout.cardioMachines', 'Machines') },
                { value: 'sports', label: t('generateWorkout.cardioSports', 'Sports') },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => set('cardio_focus', opt.value)}
                  className="px-3.5 py-2 rounded-xl text-[12px] font-semibold border transition-all"
                  style={form.cardio_focus === opt.value
                    ? { backgroundColor: 'color-mix(in srgb, #10B981 15%, transparent)', borderColor: 'color-mix(in srgb, #10B981 50%, transparent)', color: '#10B981' }
                    : { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
                  }
                >{opt.label}</button>
              ))}
            </div>
          </div>
        </>
      )}
      {form.program_type === 'hybrid' && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-card))', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
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
          <h2 className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{localizeRoutineName(splitLabel)}</h2>
        </div>
      </div>

      {/* Week navigator */}
      <div className="rounded-2xl px-4 py-5" style={{ backgroundColor: 'var(--color-bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewWeek(w => Math.max(1, w - 1))}
              disabled={viewWeek <= 1}
              className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
              aria-label="Previous week"
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
              className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
              aria-label="Next week"
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
const GenerateWorkoutModal = ({ onboarding, onClose, onGenerated }) => {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [result, setResult] = useState(null);
  const focusTrapRef = useFocusTrap(true, onClose);

  const [form, setForm] = useState({
    program_type:       'strength',
    training_days:      onboarding?.training_days_per_week || 3,
    session_duration_min: 45,
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
          // Map intensity to short_workout flag
          const shortWorkout = form.intensity === 'low';
          const r = generateProgram({
            ...onboarding,
            training_days_per_week: form.training_days,
            priority_muscles: form.priority_muscles,
            short_workout:   shortWorkout,
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
      for (let ri = 0; ri < allRoutines.length; ri++) {
        const routine = allRoutines[ri];
        const { data: saved, error: rErr } = await supabase
          .from('routines')
          .insert({
            name:       routine.name,
            gym_id:     profile.gym_id,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (rErr) throw rErr;

        // Track Week A routine IDs for schedule assignment
        if (ri < result.routinesA.length) {
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
      });

      clearCache(`dash:${user.id}`);
      onGenerated?.();
      onClose();
    } catch (err) {
      setError(err.message || t('generateWorkout.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  // Always allow advance from step 0 — body data comes from onboarding
  const canAdvance = true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-workout-title"
        className="border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
              <Zap size={15} className="text-[#D4AF37]" />
            </div>
            <div>
              <p id="generate-workout-title" className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('generateWorkout.generateMyProgram')}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.stepXOfY', { current: step + 1, total: 2 })}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
            <X size={18} style={{ color: 'var(--color-text-subtle)' }} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          {[0, 1].map(i => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? 'bg-[#D4AF37]' : 'bg-white/10'}`} />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && (
            <StepCustomize form={form} onChange={onChange} onToggleMuscle={onToggleMuscle} />
          )}
          {step === 1 && (
            <StepPreview result={result} programWeeks={form.program_weeks} />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-white/6 flex-shrink-0 space-y-2">
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
                className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-white/10 transition-colors text-[13px] font-semibold focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <ChevronLeft size={15} /> {t('generateWorkout.back')}
              </button>
            )}
            {step === 0 ? (
              <button
                onClick={() => setStep(1)}
                disabled={!canAdvance}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-[14px] py-3 rounded-xl transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              >
                {t('generateWorkout.previewProgram')} <ChevronRight size={15} />
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 text-black font-bold text-[14px] py-3 rounded-xl transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              >
                {saving ? t('generateWorkout.generating') : <><Check size={15} strokeWidth={2.5} /> {t('generateWorkout.generateMyProgram')}</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerateWorkoutModal;

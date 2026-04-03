import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronRight, ChevronLeft, Zap, Dumbbell, Heart, Check, AlertTriangle, Timer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { clearCache } from '../lib/queryCache';
import logger from '../lib/logger';
import { generateProgram, estimateDuration } from '../lib/workoutGenerator';
import useFocusTrap from '../hooks/useFocusTrap';

const GENDER_OPTIONS = [
  { value: 'male' },
  { value: 'female' },
  { value: 'other' },
];

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

// ── Step 1: Body Data ──────────────────────────────────────────────────────
const StepBodyData = ({ form, onChange, onToggleMuscle }) => {
  const { t } = useTranslation('pages');
  const set = (k, v) => onChange(k, v);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-bold mb-0.5" style={{ color: 'var(--color-text-primary)' }}>{t('generateWorkout.bodyProfile')}</h2>
        <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.bodyProfileDesc')}</p>
      </div>

      {/* Session length toggle */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.sessionLength')}</label>
        <div className="flex gap-2">
          {[
            { value: false, icon: Dumbbell, label: t('generateWorkout.sessionStandard'), desc: t('generateWorkout.sessionStandardDesc') },
            { value: true,  icon: Timer,    label: t('generateWorkout.sessionShort'),    desc: t('generateWorkout.sessionShortDesc') },
          ].map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => set('short_workout', opt.value)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${
                form.short_workout === opt.value
                  ? 'bg-[#D4AF37]/15 border-[#D4AF37]/50'
                  : ''
              }`}
              style={form.short_workout !== opt.value ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)' } : undefined}
            >
              <opt.icon size={16} className={form.short_workout === opt.value ? 'text-[#D4AF37]' : ''} style={form.short_workout !== opt.value ? { color: 'var(--color-text-subtle)' } : undefined} />
              <span className={`text-[13px] font-semibold ${form.short_workout === opt.value ? 'text-[#D4AF37]' : ''}`} style={form.short_workout !== opt.value ? { color: 'var(--color-text-subtle)' } : undefined}>{opt.label}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Height (ft + in) + Weight (lbs) */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.heightFt', 'Height (ft)')}</label>
          <input
            type="number" min="3" max="8" placeholder="5"
            value={form.height_ft}
            onChange={e => set('height_ft', e.target.value)}
            className="w-full border border-white/6 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37]"
            style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.heightIn', 'Height (in)')}</label>
          <input
            type="number" min="0" max="11" placeholder="9"
            value={form.height_in}
            onChange={e => set('height_in', e.target.value)}
            className="w-full border border-white/6 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37]"
            style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.weightLbs', 'Weight (lbs)')}</label>
          <input
            type="number" min="60" max="600" placeholder="175"
            value={form.weight_lbs}
            onChange={e => set('weight_lbs', e.target.value)}
            className="w-full border border-white/6 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37]"
            style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
          />
        </div>
      </div>

      {/* Age */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.age')}</label>
        <input
          type="number" min="14" max="90" placeholder="e.g. 28"
          value={form.age}
          onChange={e => set('age', e.target.value)}
          className="w-full border border-white/6 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37]"
            style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
        />
      </div>

      {/* Gender */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.gender')}</label>
        <div className="flex gap-2">
          {GENDER_OPTIONS.map(g => (
            <button
              key={g.value}
              type="button"
              onClick={() => set('gender', g.value)}
              className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                form.gender === g.value
                  ? 'bg-[#D4AF37]/15 border-[#D4AF37]/50 text-[#D4AF37]'
                  : ''
              }`}
              style={form.gender !== g.value ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' } : undefined}
            >
              {t(`generateWorkout.genderOptions.${g.value}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Priority muscles */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.priorityMuscles')}</label>
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
                    ? 'bg-[#D4AF37]/15 border-[#D4AF37]/50 text-[#D4AF37]'
                    : atMax
                    ? 'cursor-not-allowed opacity-40'
                    : ''
                }`}
                style={!active ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' } : undefined}
              >
                {t(`generateWorkout.muscleOptions.${m.value.toLowerCase()}`)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Step 2: Preview ────────────────────────────────────────────────────────
const StepPreview = ({ result, preferredTrainingDays }) => {
  const { t } = useTranslation('pages');
  if (!result) return null;
  const { splitLabel, routinesA, routinesB, cardio, dayTemplates } = result;
  const DAY_LABELS = DAY_KEYS.map(k => t(`days.${k}`, { ns: 'common' }));

  // Build weekly schedule display
  // Map routines to user's actual preferred training days
  // Preview grid: 0=Mon, 1=Tue, ..., 6=Sun (matches DAY_KEYS order)
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

  const week1Days = DAY_LABELS.map((day, i) => {
    const routineIdx = dayAssignments.indexOf(i);
    if (routineIdx === -1) return { day, type: 'rest' };
    return { day, type: 'workout', routine: routinesA[routineIdx % routinesA.length], variant: 'A' };
  });

  const week2Days = DAY_LABELS.map((day, i) => {
    const routineIdx = dayAssignments.indexOf(i);
    if (routineIdx === -1) return { day, type: 'rest' };
    return { day, type: 'workout', routine: routinesB[routineIdx % routinesB.length], variant: 'B' };
  });

  const avgDuration = routinesA.length
    ? Math.round(routinesA.reduce((s, r) => s + estimateDuration(r), 0) / routinesA.length)
    : 0;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <h2 className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{splitLabel}</h2>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37]">
            {routinesA.length} {t('generateWorkout.daysPerWeek')}
          </span>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('generateWorkout.minPerSession', { min: avgDuration })}</p>
      </div>

      {/* Week 1 */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.week1')}</p>
        <div className="grid grid-cols-7 gap-1">
          {week1Days.map(({ day, type, routine }) => (
            <div key={day} className={`flex flex-col items-center rounded-xl py-2 px-1 ${
              type === 'rest' ? 'opacity-40' : 'bg-[#D4AF37]/8 border border-[#D4AF37]/20'
            }`} style={type === 'rest' ? { background: 'var(--color-bg-card)' } : undefined}>
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-subtle)' }}>{day}</span>
              {type === 'workout' ? (
                <span className="text-[8px] font-semibold text-[#D4AF37] text-center leading-tight mt-1">
                  {routine.label.replace(' Day', '')}
                </span>
              ) : (
                <span className="text-[8px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.rest')}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Week 2 */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.week2')}</p>
        <div className="grid grid-cols-7 gap-1">
          {week2Days.map(({ day, type, routine }) => (
            <div key={day} className={`flex flex-col items-center rounded-xl py-2 px-1 ${
              type === 'rest' ? 'opacity-40' : 'bg-white/4 border border-white/8'
            }`} style={type === 'rest' ? { background: 'var(--color-bg-card)' } : undefined}>
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-subtle)' }}>{day}</span>
              {type === 'workout' ? (
                <span className="text-[8px] font-semibold text-center leading-tight mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {routine.label.replace(' Day', '')}
                </span>
              ) : (
                <span className="text-[8px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.rest')}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Routines preview */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('generateWorkout.week1Routines')}</p>
        <div className="space-y-2">
          {routinesA.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--color-bg-card)' }}>
              <div className="w-7 h-7 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                <Dumbbell size={13} className="text-[#D4AF37]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{r.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{r.exercises.length} {t('workouts.exercises')}</p>
              </div>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-subtle)' }}>~{estimateDuration(r)}m</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cardio */}
      {cardio.daysPerWeek > 0 && (
        <div className="flex items-start gap-3 bg-emerald-500/6 border border-emerald-500/15 rounded-xl px-4 py-3">
          <Heart size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-emerald-400">{t('generateWorkout.cardioPerWeek', { count: cardio.daysPerWeek })}</p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{cardio.description}</p>
          </div>
        </div>
      )}
    </div>
  );
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

  // Auto-fill from onboarding data: prefer imperial fields from onboarding, fall back to metric conversion
  const initHeightInches = onboarding?.height_inches
    || (onboarding?.height_cm ? Math.round(onboarding.height_cm / 2.54) : null);
  const initWeightLbs = onboarding?.initial_weight_lbs
    || (onboarding?.weight_kg ? Math.round(onboarding.weight_kg * 2.205) : null);

  const [form, setForm] = useState({
    height_ft:       initHeightInches ? String(Math.floor(initHeightInches / 12)) : '',
    height_in:       initHeightInches ? String(initHeightInches % 12) : '',
    weight_lbs:      initWeightLbs ? String(initWeightLbs) : '',
    age:             onboarding?.age         || '',
    gender:          onboarding?.gender || onboarding?.sex || 'other',
    priority_muscles: onboarding?.priority_muscles || [],
    short_workout:   false,
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

  // Convert imperial form values to metric for the generator
  const formToMetric = () => {
    const totalInches = (parseInt(form.height_ft, 10) || 0) * 12 + (parseInt(form.height_in, 10) || 0);
    const heightCm = totalInches > 0 ? Math.round(totalInches * 2.54) : 170;
    const weightKg = form.weight_lbs ? Math.round(parseFloat(form.weight_lbs) / 2.205) : 70;
    return { heightCm, weightKg };
  };

  // Generate preview when moving to step 1
  useEffect(() => {
    if (step === 1) {
      try {
        const { heightCm, weightKg } = formToMetric();
        const r = generateProgram({
          ...onboarding,
          height_cm:       heightCm,
          weight_kg:       weightKg,
          age:             parseInt(form.age, 10)       || 30,
          gender:          form.gender,
          priority_muscles: form.priority_muscles,
          short_workout:   form.short_workout,
        });
        setResult(r);
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
      // Convert imperial to metric for storage
      const { heightCm, weightKg } = formToMetric();
      const totalInches = (parseInt(form.height_ft, 10) || 0) * 12 + (parseInt(form.height_in, 10) || 0);

      // Save updated body data to member_onboarding (both imperial + metric)
      await supabase.from('member_onboarding').upsert({
        profile_id:      user.id,
        gym_id:          profile.gym_id,
        height_cm:       heightCm || null,
        weight_kg:       weightKg || null,
        height_inches:   totalInches || null,
        initial_weight_lbs: parseFloat(form.weight_lbs) || null,
        age:             parseInt(form.age, 10)       || null,
        gender:          form.gender,
        sex:             form.gender,
        priority_muscles: form.priority_muscles,
      }, { onConflict: 'profile_id' });

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

      // Save generated_programs row
      const programStart = new Date().toISOString().split('T')[0];
      const expiresDate  = new Date();
      expiresDate.setDate(expiresDate.getDate() + 42);
      const expiresAt = expiresDate.toISOString().split('T')[0];

      await supabase.from('generated_programs').insert({
        profile_id:    user.id,
        gym_id:        profile.gym_id,
        program_start: programStart,
        expires_at:    expiresAt,
        split_type:    result.split,
        routines_a_count: result.routinesA.length,
        cardio_days:   result.cardio,
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

  const canAdvance = step === 0
    ? (!!form.height_ft && !!form.weight_lbs && !!form.age)
    : true;

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
            <StepBodyData form={form} onChange={onChange} onToggleMuscle={onToggleMuscle} />
          )}
          {step === 1 && (
            <StepPreview result={result} preferredTrainingDays={profile?.preferred_training_days} />
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

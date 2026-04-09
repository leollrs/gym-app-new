import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, Dumbbell, Users,
  ClipboardList, Search, ToggleLeft, ToggleRight, ArrowLeft, StickyNote,
  ChevronUp, FileText, Calendar, Zap, Loader2, GripVertical, RefreshCw, Pencil,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { generateProgram } from '../../lib/workoutGenerator';
import { calculateMacros } from '../../lib/macroCalculator';
import { generateWeekPlan, generateDayPlan } from '../../lib/mealPlanner';
import { MEALS } from '../../data/meals';
import { foodImageUrl } from '../../lib/imageUrl';
import UnderlineTabs from '../../components/UnderlineTabs';
import SwipeableTabView from '../../components/SwipeableTabView';
import { UtensilsCrossed } from 'lucide-react';

// ── Data helpers ──────────────────────────────────────────
const DEFAULT_SETS = 3;
const DEFAULT_REPS = '8-12';
const DEFAULT_REST = 60;

const normalizeExercise = (ex) => {
  if (typeof ex === 'string') return { id: ex, sets: DEFAULT_SETS, reps: DEFAULT_REPS, rest_seconds: DEFAULT_REST, notes: '' };
  return {
    id: ex.id,
    sets: ex.sets ?? DEFAULT_SETS,
    reps: ex.reps ?? DEFAULT_REPS,
    rest_seconds: ex.rest_seconds ?? DEFAULT_REST,
    notes: ex.notes ?? '',
  };
};

const normalizeWeeks = (raw, t) => {
  const result = {};
  Object.entries(raw || {}).forEach(([wk, val]) => {
    if (!Array.isArray(val) || val.length === 0) { result[wk] = []; return; }
    if (typeof val[0] === 'string') {
      const dayName = t ? t('trainerPlans.dayPrefix', 'Day {{num}}', { num: 1 }) : 'Day 1';
      result[wk] = [{ name: dayName, exercises: val.map(normalizeExercise) }];
    } else {
      result[wk] = val.map(day => ({
        ...day,
        exercises: (day.exercises || []).map(normalizeExercise),
      }));
    }
  });
  return result;
};

const calcDaySeconds = (day) =>
  (day.exercises || []).reduce((sum, ex) => {
    const s = ex.sets ?? DEFAULT_SETS;
    const r = ex.rest_seconds ?? DEFAULT_REST;
    return sum + s * 45 + (s - 1) * r;
  }, 0);

const fmtTime = (secs, t) => {
  if (secs < 60) return t('trainerPlans.timeSeconds', '{{s}}s', { s: secs });
  const m = Math.round(secs / 60);
  return m < 60
    ? t('trainerPlans.timeMinutes', '{{m}} min', { m })
    : t('trainerPlans.timeHoursMinutes', '{{h}}h {{m}}m', { h: Math.floor(m / 60), m: m % 60 });
};

// ── Muscle group color pills ────────────────────────────
const MUSCLE_GROUP_COLORS = {
  chest: { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
  back: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  shoulders: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  legs: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
  arms: { bg: 'rgba(168,85,247,0.15)', text: '#a78bfa' },
  core: { bg: 'rgba(250,204,21,0.15)', text: '#facc15' },
  cardio: { bg: 'rgba(236,72,153,0.15)', text: '#f472b6' },
  glutes: { bg: 'rgba(20,184,166,0.15)', text: '#2dd4bf' },
  full_body: { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' },
};
const getMuscleColor = (group) => {
  if (!group) return { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' };
  const key = group.toLowerCase().replace(/\s+/g, '_');
  return MUSCLE_GROUP_COLORS[key] || { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' };
};

// ── Exercise Search Panel ────────────────────────────────
const ExerciseSearchPanel = ({ exercises, exSearch, setExSearch, onAdd, t }) => {
  const filteredExercises = useMemo(() => {
    if (!exSearch.trim()) return exercises;
    const q = exSearch.toLowerCase();
    return exercises.filter(e =>
      e.name.toLowerCase().includes(q) || e.muscle_group?.toLowerCase().includes(q)
    );
  }, [exercises, exSearch]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          value={exSearch}
          onChange={e => setExSearch(e.target.value)}
          placeholder={t('trainerPlans.searchExercises', 'Search exercises...')}
          className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl pl-9 pr-10 py-3 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]/40"
        />
        {exSearch && (
          <button
            onClick={() => setExSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <X size={10} />
          </button>
        )}
      </div>
      <div className="space-y-0.5 max-h-[320px] overflow-y-auto overscroll-contain">
        {filteredExercises.length === 0 && (
          <p className="text-[12px] text-[var(--color-text-muted)] text-center py-4">{t('trainerPlans.noExercisesFound', 'No exercises found')}</p>
        )}
        {filteredExercises.map(ex => {
          const mc = getMuscleColor(ex.muscle_group);
          return (
            <button
              key={ex.id}
              onClick={() => onAdd(ex.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/6 active:scale-[0.98] transition-all group min-h-[48px]"
            >
              <Plus size={14} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] flex-shrink-0 transition-colors" />
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <p className="text-[13px] text-[var(--color-text-primary)] truncate">{ex.name}</p>
                {ex.muscle_group && (
                  <span
                    className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                    style={{ background: mc.bg, color: mc.text }}
                  >
                    {ex.muscle_group}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Day Card (within builder) ────────────────────────────
const DayCard = ({ day, di, wk, exercises, exName, updateDayName, removeDay, addExercise, removeExercise, updateExercise, copyDayMenu, setCopyDayMenu, setCopyWeekMenu, allDayTargets, copyDayTo, weeks, t }) => {
  const dayTime = calcDaySeconds(day);
  const showCopyDay = copyDayMenu?.wk === wk && copyDayMenu?.di === di;
  const dayTargets = allDayTargets(wk, di);
  const [expanded, setExpanded] = useState(true);
  const [showExSearch, setShowExSearch] = useState(false);
  const [exSearch, setExSearch] = useState('');
  const [expandedNotes, setExpandedNotes] = useState({});

  const toggleNote = (ei) => setExpandedNotes(prev => ({ ...prev, [ei]: !prev[ei] }));

  return (
    <div className="border border-[var(--color-border-subtle)] rounded-2xl overflow-visible bg-[var(--color-bg-card)]/60">
      {/* Day header - whole header tappable for expand/collapse */}
      <div
        className="flex items-center gap-1 md:gap-2 px-3 md:px-4 py-3 bg-[var(--color-bg-secondary)]/40 rounded-t-2xl cursor-pointer active:bg-[var(--color-bg-secondary)]/60 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Drag handle hint */}
        <div className="flex-shrink-0 w-5 flex items-center justify-center -ml-1 text-[var(--color-text-subtle)]">
          <GripVertical size={14} />
        </div>
        <ChevronDown size={14} className={`text-[var(--color-text-muted)] transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} />
        <input value={day.name} onChange={e => updateDayName(wk, di, e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder={t('trainerPlans.dayPrefix', 'Day {{num}}', { num: di + 1 })}
          className="flex-1 bg-transparent text-[14px] font-semibold text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none min-w-0" />
        <span className="text-[11px] text-[var(--color-text-muted)] flex-shrink-0 flex items-center gap-1.5">
          <span>{day.exercises.length} {t('trainerPlans.ex', 'ex')}</span>
          {dayTime > 0 && (
            <>
              <span className="opacity-40">&middot;</span>
              <span className="flex items-center gap-0.5"><Clock size={9} /> ~{fmtTime(dayTime, t)}</span>
            </>
          )}
        </span>
        <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk, di }); setCopyWeekMenu(null); }}
            className="min-w-[36px] min-h-[44px] md:min-w-[44px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors" title={t('trainerPlans.copyDay', 'Copy day')}>
            <Copy size={13} />
          </button>
          {showCopyDay && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-xl shadow-xl overflow-hidden min-w-[180px] max-w-[calc(100vw-2rem)] max-h-48 overflow-y-auto">
              <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest px-3 pt-2 pb-1">{t('trainerPlans.copyDayTo', 'Copy day to...')}</p>
              {dayTargets.map((target, idx) => (
                <button key={idx} onClick={() => copyDayTo(wk, di, target.wk, target.di)}
                  className="w-full text-left px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-white/6 transition-colors min-h-[44px] flex items-center">
                  {target.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); removeDay(wk, di); }}
          className="min-w-[36px] min-h-[44px] md:min-w-[44px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-400 transition-colors flex-shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Exercises */}
      {expanded && (
        <div className="px-3 md:px-4 pb-4 pt-3 space-y-2">
          {/* Empty state */}
          {day.exercises.length === 0 && (
            <div className="py-8 text-center">
              <Dumbbell size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-subtle)' }} />
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('trainerPlans.noExercisesYet', 'No exercises yet')}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.addExercisesHint', 'Add exercises or auto-generate')}</p>
            </div>
          )}

          {day.exercises.map((ex, ei) => (
            <div key={ei} className="bg-[var(--color-bg-deep)] rounded-xl px-3 py-3">
              {/* Exercise name + delete */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 min-w-0 truncate">{exName(ex.id)}</span>
                <button onClick={() => removeExercise(wk, di, ei)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-400 transition-colors flex-shrink-0 -mr-1">
                  <Trash2 size={12} />
                </button>
              </div>
              {/* Sets / Reps / Rest controls - compact row below name */}
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
                {/* Sets */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-[var(--color-text-muted)] mr-0.5">{t('trainerPlans.sets', 'Sets')}:</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                    className="min-w-[36px] min-h-[36px] rounded-lg bg-white/6 text-[var(--color-text-secondary)] hover:bg-white/10 text-[12px] flex items-center justify-center active:scale-95 transition-all">&minus;</button>
                  <span className="text-[12px] font-medium text-[var(--color-text-primary)] w-5 text-center">{ex.sets ?? DEFAULT_SETS}</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'sets', (ex.sets ?? DEFAULT_SETS) + 1)}
                    className="min-w-[36px] min-h-[36px] rounded-lg bg-white/6 text-[var(--color-text-secondary)] hover:bg-white/10 text-[12px] flex items-center justify-center active:scale-95 transition-all">+</button>
                </div>
                {/* Reps */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-[var(--color-text-muted)] mr-0.5">{t('trainerPlans.reps', 'Reps')}:</span>
                  <input value={ex.reps ?? DEFAULT_REPS}
                    onChange={e => updateExercise(wk, di, ei, 'reps', e.target.value)}
                    className="w-16 bg-white/6 rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] text-center outline-none focus:bg-white/10 min-h-[36px]"
                    placeholder="8-12" />
                </div>
                {/* Rest */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-[var(--color-text-muted)] mr-0.5">{t('trainerPlans.rest', 'Rest')}:</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', Math.max(0, (ex.rest_seconds ?? DEFAULT_REST) - 15))}
                    className="min-w-[36px] min-h-[36px] rounded-lg bg-white/6 text-[var(--color-text-secondary)] hover:bg-white/10 text-[12px] flex items-center justify-center active:scale-95 transition-all">&minus;</button>
                  <span className="text-[12px] font-medium text-[var(--color-text-primary)] w-8 text-center">{ex.rest_seconds ?? DEFAULT_REST}s</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', (ex.rest_seconds ?? DEFAULT_REST) + 15)}
                    className="min-w-[36px] min-h-[36px] rounded-lg bg-white/6 text-[var(--color-text-secondary)] hover:bg-white/10 text-[12px] flex items-center justify-center active:scale-95 transition-all">+</button>
                </div>
              </div>
              {/* Exercise notes - collapsible */}
              {expandedNotes[ei] || ex.notes ? (
                <textarea
                  value={ex.notes || ''}
                  onChange={e => updateExercise(wk, di, ei, 'notes', e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder={t('trainerPlans.trainerNotesPlaceholder', 'e.g., Tempo 3-1-2, pause at bottom')}
                  className="mt-2 w-full bg-white/4 rounded-lg px-2.5 py-2 text-[16px] sm:text-[13px] text-[var(--color-text-secondary)] placeholder-[var(--color-text-faint)] outline-none focus:bg-white/6 resize-none transition-colors"
                />
              ) : (
                <button
                  onClick={() => toggleNote(ei)}
                  className="mt-2 flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  <StickyNote size={10} />
                  {t('trainerPlans.addNote', 'Add note')}
                </button>
              )}
            </div>
          ))}

          {/* Add exercise - searchable panel */}
          {showExSearch ? (
            <div className="mt-1 border border-[var(--color-border-default)] rounded-xl p-3 bg-[var(--color-bg-secondary)]/60">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">{t('trainerPlans.addExercise', 'Add Exercise')}</p>
                <button onClick={() => { setShowExSearch(false); setExSearch(''); }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] -mr-2">
                  <X size={14} />
                </button>
              </div>
              <ExerciseSearchPanel
                exercises={exercises}
                exSearch={exSearch}
                setExSearch={setExSearch}
                onAdd={(id) => { addExercise(wk, di, id); }}
                t={t}
              />
            </div>
          ) : (
            <button onClick={() => setShowExSearch(true)}
              className="w-full py-4 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-1 min-h-[44px] hover:border-[var(--color-accent)]/30 active:scale-[0.98]"
              style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
              <Plus size={18} />
              <span className="text-[12px] font-medium">{t('trainerPlans.addExercise', 'Add Exercise')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Plan Builder (full-page workspace) ───────────────────
const PlanBuilder = ({ plan, clients, onClose, onSaved, trainerId, gymId, t }) => {
  const isEdit = !!plan;
  const init = plan || {};
  const [clientId, setClientId]     = useState(init.client_id || '');
  const [name, setName]             = useState(init.name ?? '');
  const [description, setDesc]      = useState(init.description ?? '');
  const [durationWeeks, setDuration]= useState(init.duration_weeks ?? 4);
  const [weeks, setWeeks]           = useState(() => normalizeWeeks(init.weeks, t));
  const [exercises, setExercises]   = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [copyWeekMenu, setCopyWeekMenu]   = useState(null);
  const [copyDayMenu, setCopyDayMenu]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clientProfile, setClientProfile] = useState(null);
  // Trainer overrides for auto-generation
  const [overrideDays, setOverrideDays] = useState(null); // null = use client's
  const [overrideMuscles, setOverrideMuscles] = useState([]); // empty = use client's
  const ALL_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core', 'Glutes'];
  const toggleMuscle = (m) => setOverrideMuscles(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  useEffect(() => {
    supabase.from('exercises').select('id, name, muscle_group').order('name')
      .then(({ data }) => setExercises(data || []));
  }, []);

  // Fetch client profile when client changes
  useEffect(() => {
    if (!clientId) { setClientProfile(null); return; }
    (async () => {
      const { data: ob } = await supabase
        .from('member_onboarding')
        .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes, priority_muscles')
        .eq('profile_id', clientId)
        .maybeSingle();
      const { data: goals } = await supabase
        .from('member_goals')
        .select('goal_type, exercise_id, target_value, current_value')
        .eq('profile_id', clientId)
        .eq('is_completed', false);
      setClientProfile({ onboarding: ob, goals: goals || [] });
    })();
  }, [clientId]);

  // Auto-generate workout plan from client onboarding data
  const handleAutoGenerate = async () => {
    if (!clientId) { setError(t('trainerPlans.selectClientFirst', 'Select a client first.')); return; }
    setGenerating(true);
    setError('');
    try {
      let onb, goals;
      if (clientProfile?.onboarding) {
        onb = clientProfile.onboarding;
        goals = clientProfile.goals;
      } else {
        const [obRes, goalsRes] = await Promise.all([
          supabase.from('member_onboarding')
            .select('*')
            .eq('profile_id', clientId)
            .maybeSingle(),
          supabase.from('member_goals')
            .select('goal_type, exercise_id')
            .eq('profile_id', clientId)
            .eq('is_completed', false),
        ]);
        onb = obRes.data;
        goals = goalsRes.data;
      }
      if (!onb) { setError(t('trainerPlans.noOnboardingData', 'Client has no onboarding data.')); setGenerating(false); return; }

      // Apply trainer overrides
      const onbWithOverrides = { ...onb };
      if (overrideDays) onbWithOverrides.training_days_per_week = overrideDays;
      if (overrideMuscles.length > 0) onbWithOverrides.priority_muscles = overrideMuscles;

      const result = generateProgram(onbWithOverrides, goals || []);
      const clientName = clients.find(c => c.id === clientId)?.full_name || '';

      // Map generator output → plan weeks format
      // routinesA/B: [{ name, exercises: [{ exerciseId, sets, reps, restSeconds }] }]
      const mapRoutine = (routine) => routine.map(day => ({
        name: day.name || day.label || t('trainerPlans.dayPrefix', 'Day {{num}}', { num: '' }).trim(),
        exercises: (day.exercises || []).map(ex => ({
          id: ex.exerciseId || ex.id,
          sets: ex.sets ?? DEFAULT_SETS,
          reps: ex.reps ?? DEFAULT_REPS,
          rest_seconds: ex.restSeconds ?? DEFAULT_REST,
          notes: '',
        })),
      }));

      const routinesA = mapRoutine(result.routinesA || []);
      const routinesB = mapRoutine(result.routinesB || []);
      const newWeeks = {};
      const newDuration = Math.max(durationWeeks, 4);
      for (let wk = 1; wk <= newDuration; wk++) {
        newWeeks[wk] = JSON.parse(JSON.stringify(wk % 2 === 1 ? routinesA : routinesB));
      }

      setWeeks(newWeeks);
      setDuration(newDuration);
      setName(t('trainerPlans.autoNamePrefix', 'Auto: {{splitLabel}} — {{clientName}}', { splitLabel: result.splitLabel || t('trainerPlans.programFallback', 'Program'), clientName }));
      setDesc(t('trainerPlans.autoDescTemplate', '{{split}} split, {{goal}} goal, {{level}} level', { split: result.split, goal: onb.primary_goal || 'general', level: onb.fitness_level || 'intermediate' }));
      setSelectedWeek(1);
    } catch (err) {
      setError(err.message || t('trainerPlans.failedToGenerate', 'Failed to generate plan'));
    } finally {
      setGenerating(false);
    }
  };

  const exName = (id) => exercises.find(e => e.id === id)?.name ?? id;

  // Week operations
  const copyWeekTo = (fromWk, toWk) => {
    setWeeks(prev => ({ ...prev, [toWk]: JSON.parse(JSON.stringify(prev[fromWk] || [])) }));
    setCopyWeekMenu(null);
    setSelectedWeek(toWk);
  };

  // Day operations
  const addDay = (wk) => setWeeks(prev => ({
    ...prev,
    [wk]: [...(prev[wk] || []), { name: t('trainerPlans.dayPrefix', 'Day {{num}}', { num: (prev[wk] || []).length + 1 }), exercises: [] }],
  }));
  const removeDay = (wk, di) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].filter((_, i) => i !== di),
  }));
  const updateDayName = (wk, di, val) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di ? { ...d, name: val } : d),
  }));
  const copyDayTo = (fromWk, fromDi, toWk, toDi) => {
    const cloned = JSON.parse(JSON.stringify(weeks[fromWk][fromDi]));
    setWeeks(prev => {
      const targetDays = [...(prev[toWk] || [])];
      if (toDi === 'new') {
        targetDays.push({ ...cloned, name: t('trainerPlans.dayPrefix', 'Day {{num}}', { num: targetDays.length + 1 }) });
      } else {
        targetDays[toDi] = { ...cloned };
      }
      return { ...prev, [toWk]: targetDays };
    });
    setCopyDayMenu(null);
    setSelectedWeek(toWk);
  };

  // Exercise operations
  const addExercise = (wk, di, id) => {
    if (!id) return;
    setWeeks(prev => ({
      ...prev,
      [wk]: prev[wk].map((d, i) => i === di
        ? { ...d, exercises: [...d.exercises, { id, sets: DEFAULT_SETS, reps: DEFAULT_REPS, rest_seconds: DEFAULT_REST, notes: '' }] }
        : d
      ),
    }));
  };
  const removeExercise = (wk, di, ei) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.filter((_, j) => j !== ei) }
      : d
    ),
  }));
  const updateExercise = (wk, di, ei, field, val) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.map((ex, j) => j === ei ? { ...ex, [field]: val } : ex) }
      : d
    ),
  }));

  // Save
  const handleSave = async () => {
    if (!clientId) { setError(t('trainerPlans.selectClientError', 'Please select a client.')); return; }
    if (!name.trim()) { setError(t('trainerPlans.nameRequired', 'Plan name is required.')); return; }
    setSaving(true);
    setError('');
    const payload = {
      gym_id: gymId,
      trainer_id: trainerId,
      client_id: clientId,
      name: name.trim(),
      description: description.trim(),
      duration_weeks: durationWeeks,
      weeks,
      is_active: plan?.is_active ?? true,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = isEdit
      ? await supabase.from('trainer_workout_plans').update(payload).eq('id', plan.id)
      : await supabase.from('trainer_workout_plans').insert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
  };

  const allWeekNums = Array.from({ length: durationWeeks }, (_, i) => i + 1);

  const allDayTargets = (fromWk, fromDi) => {
    const targets = [];
    allWeekNums.forEach(wk => {
      const days = weeks[wk] || [];
      days.forEach((d, di) => {
        if (wk === fromWk && di === fromDi) return;
        targets.push({ wk, di, label: `${t('trainerPlans.wkAbbrev', 'Wk')} ${wk} · ${d.name || t('trainerPlans.dayPrefix', 'Day {{num}}', { num: di + 1 })}` });
      });
      targets.push({ wk, di: 'new', label: `${t('trainerPlans.wkAbbrev', 'Wk')} ${wk} · ${t('trainerPlans.newDay', 'New day')}` });
    });
    return targets;
  };

  const currentDays = weeks[selectedWeek] || [];
  const showCopyWeek = copyWeekMenu === selectedWeek;

  const closeMenus = () => { setCopyWeekMenu(null); setCopyDayMenu(null); };

  // Stats for week rail
  const weekStats = (wk) => {
    const days = weeks[wk] || [];
    const exCount = days.reduce((s, d) => s + (d.exercises?.length || 0), 0);
    return { dayCount: days.length, exCount };
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-card)] overflow-x-hidden" onClick={closeMenus}>
      {/* ── Sticky top header ── */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl" style={{ background: 'color-mix(in srgb, var(--color-bg-card) 92%, transparent)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        {/* Row 1: Back + Name + Actions */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pt-3 pb-2 flex items-center gap-2 md:gap-3">
          <button onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/6 transition-colors flex-shrink-0"
            aria-label={t('trainerPlans.backToList', 'Back to plans')}>
            <ArrowLeft size={20} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('trainerPlans.planNamePlaceholder', 'Plan name...')}
              className="w-full bg-transparent text-[18px] font-bold outline-none truncate"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2.5 rounded-xl font-bold text-[13px] text-black disabled:opacity-50 transition-colors whitespace-nowrap min-h-[44px]"
            style={{ backgroundColor: 'var(--color-accent)' }}>
            {saving ? t('trainerPlans.saving', 'Saving...') : isEdit ? t('trainerPlans.saveChanges', 'Save') : t('trainerPlans.createPlan', 'Create')}
          </button>
        </div>

        {/* Row 2: Client selector + Status + Auto-generate */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pb-2 flex items-center gap-2 flex-wrap">
          <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={isEdit}
            className="bg-transparent text-[13px] outline-none disabled:opacity-60 max-w-[180px] truncate cursor-pointer py-1"
            style={{ color: 'var(--color-text-secondary)' }}>
            <option value="">{t('trainerPlans.selectClient', 'Select client...')}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
            (plan?.is_active ?? true) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/4'
          }`} style={(plan?.is_active ?? true) ? undefined : { color: 'var(--color-text-muted)' }}>
            {(plan?.is_active ?? true) ? t('trainerPlans.active', 'Active') : t('trainerPlans.inactive', 'Inactive')}
          </span>
          <div className="flex-1" />
          {clientId && clientProfile?.onboarding && (
            <button onClick={handleAutoGenerate} disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-[11px] transition-colors whitespace-nowrap disabled:opacity-40"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
              {generating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              {generating ? t('trainerPlans.generating', 'Generating…') : t('trainerPlans.autoGenerate', 'Auto-Generate')}
            </button>
          )}
        </div>

        {/* Row 3: Collapsible description */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6">
          {showDetails && (
            <div className="pb-3">
              <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
                placeholder={t('trainerPlans.descPlaceholder', 'Goals and approach for this plan...')}
                className="w-full rounded-xl px-4 py-2.5 text-[16px] sm:text-[13px] outline-none resize-none"
                style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
          )}
        </div>

        {error && (
          <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pb-2">
            <p className="text-[12px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          </div>
        )}
      </div>

      {/* ── Client Profile + Duration + Week Nav (scrollable content) ── */}
      <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pt-4">
        {/* Client context + Generation overrides */}
        {clientProfile?.onboarding && (
          <div className="mb-4 rounded-2xl p-4" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--color-accent)' }}>
                {t('trainerPlans.clientProfile', 'Client Profile')}
              </p>
              <button onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-[10px] font-medium transition-colors"
                style={{ color: 'var(--color-text-muted)' }}>
                <FileText size={10} />
                {showDetails ? t('trainerPlans.hideNotes', 'Hide notes') : t('trainerPlans.addNotes', 'Add notes')}
              </button>
            </div>
            {/* Compact client info */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] mb-3">
              <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.level', 'Level')}:</span> <span className="font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }}>{clientProfile.onboarding.fitness_level || '—'}</span></span>
              <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.goal', 'Goal')}:</span> <span className="font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }}>{clientProfile.onboarding.primary_goal?.replace(/_/g, ' ') || '—'}</span></span>
              {clientProfile.onboarding.injuries_notes && (
                <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.injuries', 'Injuries')}:</span> <span className="font-semibold text-red-400">{clientProfile.onboarding.injuries_notes}</span></span>
              )}
            </div>
            {/* Equipment + goals tags */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {clientProfile.onboarding.available_equipment?.map(eq => (
                <span key={eq} className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }}>{eq}</span>
              ))}
              {clientProfile.goals.map((g, i) => (
                <span key={`g${i}`} className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
                  {g.goal_type.replace(/_/g, ' ')}{g.target_value ? ` → ${g.target_value}` : ''}
                </span>
              ))}
            </div>

            {/* ── Trainer overrides for auto-generation ── */}
            <div className="pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
                {t('trainerPlans.generateSettings', 'Generation Settings')}
              </p>

              {/* Days per week override */}
              <div className="mb-3">
                <p className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('trainerPlans.daysPerWeek', 'Days per week')}
                </p>
                <div className="flex gap-1.5">
                  {[2, 3, 4, 5, 6].map(d => {
                    const clientDays = clientProfile.onboarding.training_days_per_week;
                    const isActive = overrideDays ? overrideDays === d : clientDays === d;
                    const isClientDefault = !overrideDays && clientDays === d;
                    return (
                      <button key={d} onClick={() => setOverrideDays(d === clientDays ? null : d)}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all min-h-[36px] relative ${
                          isActive ? 'text-black' : ''
                        }`}
                        style={isActive
                          ? { backgroundColor: 'var(--color-accent)' }
                          : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }
                        }>
                        {d}
                        {isClientDefault && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" title="Client's preference" />}
                      </button>
                    );
                  })}
                  {overrideDays && (
                    <button onClick={() => setOverrideDays(null)}
                      className="px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                      style={{ color: 'var(--color-text-muted)' }}>
                      {t('trainerPlans.reset', 'Reset')}
                    </button>
                  )}
                </div>
              </div>

              {/* Target muscles override */}
              <div>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('trainerPlans.targetMuscles', 'Focus muscles')} <span className="opacity-50">({t('trainerPlans.optional', 'optional')})</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_MUSCLES.map(m => {
                    const isSelected = overrideMuscles.includes(m);
                    const isClientPriority = clientProfile.onboarding.priority_muscles?.includes(m);
                    return (
                      <button key={m} onClick={() => toggleMuscle(m)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all relative ${
                          isSelected ? 'text-black' : ''
                        }`}
                        style={isSelected
                          ? { backgroundColor: '#10B981' }
                          : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }
                        }>
                        {m}
                        {isClientPriority && !isSelected && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" title="Client's priority" />}
                      </button>
                    );
                  })}
                  {overrideMuscles.length > 0 && (
                    <button onClick={() => setOverrideMuscles([])}
                      className="px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                      style={{ color: 'var(--color-text-muted)' }}>
                      {t('trainerPlans.clearAll', 'Clear')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Duration + Week selector (mobile) */}
        <div className="md:hidden mb-4">
          {/* Duration pills */}
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.duration', 'Duration')}</p>
            <div className="flex gap-1.5">
              {[4, 6, 8, 10, 12].map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                    durationWeeks === w ? 'text-black' : ''
                  }`}
                  style={durationWeeks === w
                    ? { backgroundColor: 'var(--color-accent)' }
                    : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }
                  }>
                  {w}w
                </button>
              ))}
            </div>
          </div>
          {/* Week horizontal scroller */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
            {allWeekNums.map(wk => {
              const stats = weekStats(wk);
              return (
                <button key={wk} onClick={() => setSelectedWeek(wk)}
                  className={`shrink-0 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all min-h-[40px] ${
                    selectedWeek === wk ? 'text-black shadow-sm' : ''
                  }`}
                  style={selectedWeek === wk
                    ? { backgroundColor: 'var(--color-accent)' }
                    : { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                  }>
                  {t('trainerPlans.weekAbbrev', 'Wk')} {wk}
                  <span className="text-[10px] ml-1 opacity-70">({stats.dayCount}d · {stats.exCount}ex)</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main content: 2 col desktop, 1 col mobile ── */}
      <div className="max-w-[480px] mx-auto md:max-w-5xl md:flex md:min-h-[calc(100vh-140px)] pb-24 md:pb-0">
        {/* ── Left rail (desktop only) ── */}
        <div className="hidden md:block w-64 flex-shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]/60 sticky top-[140px] self-start max-h-[calc(100vh-140px)] overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Duration selector */}
            <div>
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">{t('trainerPlans.duration', 'Duration')}</p>
              <div className="flex gap-1.5">
                {[4, 6, 8, 10, 12].map(w => (
                  <button key={w} onClick={() => setDuration(w)}
                    className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors min-h-[36px] ${
                      durationWeeks === w ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'bg-[var(--color-bg-card)]/60 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                    }`}>
                    {w}w
                  </button>
                ))}
              </div>
            </div>

            {/* Week list */}
            <div>
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">{t('trainerPlans.weeks', 'Weeks')}</p>
              <div className="space-y-1">
                {allWeekNums.map(wk => {
                  const stats = weekStats(wk);
                  const isActive = selectedWeek === wk;
                  return (
                    <div key={wk} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedWeek(wk)}
                        className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors min-h-[44px] ${
                          isActive
                            ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-l-2 border-[var(--color-accent)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-white/4 border-l-2 border-transparent'
                        }`}
                      >
                        <Calendar size={13} className={isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium">{t('trainerPlans.weekLabel', 'Week')} {wk}</p>
                          <p className="text-[10px] text-[var(--color-text-muted)]">{stats.dayCount} {t('trainerPlans.daysAbbrev', 'days')} · {stats.exCount} {t('trainerPlans.ex', 'ex')}</p>
                        </div>
                      </button>
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyWeekMenu(copyWeekMenu === wk ? null : wk); setCopyDayMenu(null); }}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-lg hover:bg-white/6 transition-colors"
                          title={t('trainerPlans.copyWeek', 'Copy week')}>
                          <Copy size={11} />
                        </button>
                        {copyWeekMenu === wk && (
                          <div className="absolute left-0 top-full mt-1 z-20 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-xl shadow-xl overflow-hidden min-w-[140px]">
                            <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest px-3 pt-2 pb-1">
                              {t('trainerPlans.copyWkTo', 'Copy Wk {{wk}} to...', { wk })}
                            </p>
                            {allWeekNums.filter(w => w !== wk).map(targetWk => (
                              <button key={targetWk} onClick={() => copyWeekTo(wk, targetWk)}
                                className="w-full text-left px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-white/6 transition-colors min-h-[44px] flex items-center">
                                {t('trainerPlans.weekLabel', 'Week')} {targetWk}
                                {(weeks[targetWk] || []).length > 0 && <span className="text-[var(--color-text-muted)] ml-1">({t('trainerPlans.overwrite', 'overwrite')})</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main panel ── */}
        <div className="flex-1 px-4 py-4 md:py-6 md:px-6 pb-28 md:pb-12">
          {/* Week heading + copy action (mobile shows selected week, desktop shows too) */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-bold text-[var(--color-text-primary)] truncate">{t('trainerPlans.weekLabel', 'Week')} {selectedWeek}</h2>
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {currentDays.length} {t('trainerPlans.daysAbbrev', 'days')}
              </span>
            </div>
            {/* Mobile copy week */}
            <div className="relative md:hidden" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => { setCopyWeekMenu(showCopyWeek ? null : selectedWeek); setCopyDayMenu(null); }}
                className="flex items-center gap-1 text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] px-3 py-2 rounded-xl hover:bg-white/6 transition-colors min-h-[44px]">
                <Copy size={12} /> {t('trainerPlans.copy', 'Copy')}
              </button>
              {showCopyWeek && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-xl shadow-xl overflow-hidden min-w-[140px]">
                  <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest px-3 pt-2 pb-1">
                    {t('trainerPlans.copyWkTo', 'Copy Wk {{wk}} to...', { wk: selectedWeek })}
                  </p>
                  {allWeekNums.filter(w => w !== selectedWeek).map(targetWk => (
                    <button key={targetWk} onClick={() => copyWeekTo(selectedWeek, targetWk)}
                      className="w-full text-left px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-white/6 transition-colors min-h-[44px] flex items-center">
                      {t('trainerPlans.weekLabel', 'Week')} {targetWk}
                      {(weeks[targetWk] || []).length > 0 && <span className="text-[var(--color-text-muted)] ml-1">({t('trainerPlans.overwrite', 'overwrite')})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Days for selected week */}
          <div className="space-y-3">
            {currentDays.length === 0 && (
              <div className="text-center py-12">
                <ClipboardList size={28} className="text-[var(--color-text-faint)] mx-auto mb-2" />
                <p className="text-[13px] text-[var(--color-text-muted)] mb-4">{t('trainerPlans.noDaysYet', 'No days yet — add one below')}</p>
                {clientId && (
                  <button
                    onClick={handleAutoGenerate}
                    disabled={generating}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] font-semibold text-[13px] rounded-xl hover:bg-[var(--color-accent)]/20 transition-colors min-h-[44px] disabled:opacity-40"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {t('trainerPlans.autoGenerateFromGoals', 'Auto-Generate from Client Goals')}
                  </button>
                )}
              </div>
            )}

            {currentDays.map((day, di) => (
              <DayCard
                key={di}
                day={day}
                di={di}
                wk={selectedWeek}
                exercises={exercises}
                exName={exName}
                updateDayName={updateDayName}
                removeDay={removeDay}
                addExercise={addExercise}
                removeExercise={removeExercise}
                updateExercise={updateExercise}
                copyDayMenu={copyDayMenu}
                setCopyDayMenu={setCopyDayMenu}
                setCopyWeekMenu={setCopyWeekMenu}
                allDayTargets={allDayTargets}
                copyDayTo={copyDayTo}
                weeks={weeks}
                t={t}
              />
            ))}

            <button onClick={() => addDay(selectedWeek)}
              className="w-full py-3 text-[13px] font-semibold text-[var(--color-accent)] border border-[var(--color-accent)]/20 rounded-2xl hover:bg-[var(--color-accent)]/5 transition-colors min-h-[44px] flex items-center justify-center gap-1.5">
              <Plus size={15} /> {t('trainerPlans.addDay', 'Add Day')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function TrainerPlans() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');

  // Section toggle: Training vs Nutrition
  const SECTION_TABS = [
    { key: 'training', label: t('trainerPlans.training', 'Training') },
    { key: 'nutrition', label: t('trainerPlans.nutrition', 'Nutrition') },
  ];
  const [sectionIndex, setSectionIndex] = useState(0);
  const section = SECTION_TABS[sectionIndex].key;

  // Training plans state
  const [plans, setPlans]       = useState([]);
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [view, setView]         = useState('list'); // 'list' | 'builder'
  const [editing, setEditing]   = useState(null);
  const [filterClient, setFilterClient] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active'); // 'active' | 'all' | 'archived'
  const [expandedPlan, setExpandedPlan] = useState(null);
  const [adherenceMap, setAdherenceMap] = useState({});

  // Nutrition plans state
  const [mealPlans, setMealPlans] = useState([]);
  const [mealPlansLoading, setMealPlansLoading] = useState(true);
  const [mealFilterStatus, setMealFilterStatus] = useState('active');
  const [showMealModal, setShowMealModal] = useState(false);
  const [mealForm, setMealForm] = useState({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '' });
  const [mealSaving, setMealSaving] = useState(false);
  const [mealClientProfile, setMealClientProfile] = useState(null);
  const [mealGoalOverride, setMealGoalOverride] = useState(null);
  const GOAL_OPTIONS = ['fat_loss', 'muscle_gain', 'strength', 'endurance', 'general_fitness'];

  // Fetch client data when meal form client changes
  useEffect(() => {
    const cid = mealForm.client_id;
    if (!cid) { setMealClientProfile(null); setMealGoalOverride(null); return; }
    (async () => {
      const [obRes, weightRes] = await Promise.all([
        supabase.from('member_onboarding')
          .select('fitness_level, primary_goal, training_days_per_week, height_cm, weight_kg, age, gender')
          .eq('profile_id', cid).maybeSingle(),
        supabase.from('body_weight_logs')
          .select('weight_lbs').eq('profile_id', cid).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setMealClientProfile({ onboarding: obRes.data, latestWeight: weightRes.data?.weight_lbs });
    })();
  }, [mealForm.client_id]);

  const [mealStep, setMealStep] = useState('settings'); // 'settings' | 'meals'
  const [generatedMeals, setGeneratedMeals] = useState(null); // 7-day plan
  const [generatingMeals, setGeneratingMeals] = useState(false);
  const [mealPreviewDay, setMealPreviewDay] = useState(0);
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const MEAL_SLOTS = [
    { type: 'breakfast', time: '07:00', label: 'Breakfast', label_es: 'Desayuno', color: '#F97316' },
    { type: 'lunch', time: '12:00', label: 'Lunch', label_es: 'Almuerzo', color: '#EAB308' },
    { type: 'snack', time: '15:30', label: 'Snack', label_es: 'Merienda', color: '#34D399' },
    { type: 'dinner', time: '19:00', label: 'Dinner', label_es: 'Cena', color: '#8B5CF6' },
  ];

  const handleGenerateMeals = () => {
    const cal = parseInt(mealForm.target_calories);
    const pro = parseInt(mealForm.target_protein_g);
    const carb = parseInt(mealForm.target_carbs_g);
    const fat = parseInt(mealForm.target_fat_g);
    if (!cal || !pro) return;
    setGeneratingMeals(true);
    setTimeout(() => {
      const plan = generateWeekPlan({
        targets: { calories: cal, protein: pro, carbs: carb || 200, fat: fat || 60 },
        lang: i18n?.language || 'en',
      });
      // Enrich each meal with slot type and time
      const enriched = plan.map(day => ({
        ...day,
        meals: (day.meals || []).map((meal, mi) => ({
          ...meal,
          slotType: MEAL_SLOTS[mi]?.type || 'snack',
        })),
      }));
      setGeneratedMeals(enriched);
      setMealStep('meals');
      setMealPreviewDay(0);
      setGeneratingMeals(false);
    }, 50);
  };

  const swapMeal = (dayIdx, mealIdx) => {
    const day = generatedMeals[dayIdx];
    if (!day) return;
    const otherMealIds = day.meals.filter((_, i) => i !== mealIdx).map(m => m.id);
    const cal = parseInt(mealForm.target_calories) || 2000;
    const pro = parseInt(mealForm.target_protein_g) || 150;
    const slotBudget = {
      calories: Math.round(cal / day.meals.length),
      protein: Math.round(pro / day.meals.length),
      carbs: Math.round((parseInt(mealForm.target_carbs_g) || 200) / day.meals.length),
      fat: Math.round((parseInt(mealForm.target_fat_g) || 60) / day.meals.length),
    };
    const replacement = generateDayPlan({
      targets: slotBudget,
      slots: 1,
      excludeIds: otherMealIds,
    });
    if (replacement.meals[0]) {
      setGeneratedMeals(prev => prev.map((d, di) => di !== dayIdx ? d : {
        ...d,
        meals: d.meals.map((m, mi) => mi !== mealIdx ? m : {
          ...replacement.meals[0],
          slotType: m.slotType,
        }),
        totals: {
          calories: d.meals.reduce((s, meal, i) => s + (i === mealIdx ? replacement.meals[0].calories : meal.calories), 0),
          protein: d.meals.reduce((s, meal, i) => s + (i === mealIdx ? replacement.meals[0].protein : meal.protein), 0),
          carbs: d.meals.reduce((s, meal, i) => s + (i === mealIdx ? replacement.meals[0].carbs : meal.carbs), 0),
          fat: d.meals.reduce((s, meal, i) => s + (i === mealIdx ? replacement.meals[0].fat : meal.fat), 0),
        },
      }));
    }
  };

  // Manual meal picker state
  const [mealPickerSlot, setMealPickerSlot] = useState(null); // { dayIdx, mealIdx } or null
  const [mealSearch, setMealSearch] = useState('');
  const filteredMeals = mealSearch.trim()
    ? MEALS.filter(m => {
        const q = mealSearch.toLowerCase();
        return (m.title?.toLowerCase().includes(q) || m.title_es?.toLowerCase().includes(q) || m.category?.toLowerCase().includes(q));
      }).slice(0, 30)
    : MEALS.slice(0, 30);

  const pickMeal = (meal) => {
    if (!mealPickerSlot) return;
    const { dayIdx, mealIdx } = mealPickerSlot;
    setGeneratedMeals(prev => {
      const updated = prev.map((d, di) => {
        if (di !== dayIdx) return d;
        const newMeals = d.meals.map((m, mi) => mi !== mealIdx ? m : { ...meal, slotType: m.slotType });
        return {
          ...d,
          meals: newMeals,
          totals: {
            calories: newMeals.reduce((s, m) => s + (m.calories || 0), 0),
            protein: newMeals.reduce((s, m) => s + (m.protein || 0), 0),
            carbs: newMeals.reduce((s, m) => s + (m.carbs || 0), 0),
            fat: newMeals.reduce((s, m) => s + (m.fat || 0), 0),
          },
        };
      });
      return updated;
    });
    setMealPickerSlot(null);
    setMealSearch('');
  };

  const handleAutoCalculateMacros = () => {
    const ob = mealClientProfile?.onboarding;
    if (!ob) return;
    // Use latest logged weight, or convert from onboarding kg, or skip
    const weightLbs = mealClientProfile.latestWeight || (ob.weight_kg ? ob.weight_kg * 2.20462 : null);
    if (!weightLbs) return;
    const heightInches = ob.height_cm ? ob.height_cm / 2.54 : 68; // fallback 5'8"
    const age = ob.age || 30; // fallback 30
    const sex = ob.gender === 'female' ? 'female' : 'male';
    const trainingDays = ob.training_days_per_week || 4;
    const goal = mealGoalOverride || ob.primary_goal || 'general_fitness';

    const result = calculateMacros({ weightLbs, heightInches, age, sex, trainingDays, goal });
    if (!result) return;
    setMealForm(f => ({
      ...f,
      target_calories: String(result.calories),
      target_protein_g: String(result.protein),
      target_carbs_g: String(result.carbs),
      target_fat_g: String(result.fat),
      name: f.name || `${goal.replace(/_/g, ' ')} plan`.replace(/\b\w/g, c => c.toUpperCase()),
    }));
  };

  useEffect(() => { document.title = 'Trainer - Plans | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.id) return;
    loadData();
  }, [profile?.id]);

  const loadData = async () => {
    setLoading(true);
    const [plansRes, clientsRes] = await Promise.all([
      supabase
        .from('trainer_workout_plans')
        .select('*, profiles!trainer_workout_plans_client_id_fkey(full_name)')
        .eq('trainer_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true),
    ]);
    const loadedPlans = plansRes.data || [];
    setPlans(loadedPlans);
    setClients((clientsRes.data || []).map(tc => tc.profiles).filter(Boolean));

    // Compute adherence for active plans with assigned clients
    const activePlans = loadedPlans.filter(p => p.is_active && p.client_id);
    if (activePlans.length > 0) {
      const now = new Date();
      const wkStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const wkEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const clientIds = [...new Set(activePlans.map(p => p.client_id))];

      const { data: weekSessions } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', wkStart)
        .lte('started_at', wkEnd);

      const sessionCounts = {};
      (weekSessions || []).forEach(s => {
        sessionCounts[s.profile_id] = (sessionCounts[s.profile_id] || 0) + 1;
      });

      const newAdherence = {};
      activePlans.forEach(p => {
        const allDays = Object.values(p.weeks || {}).flat();
        const totalWeeks = Object.keys(p.weeks || {}).length || 1;
        const expectedPerWeek = Math.round(allDays.length / totalWeeks) || 3;
        newAdherence[p.id] = {
          completed: sessionCounts[p.client_id] || 0,
          expected: expectedPerWeek,
        };
      });
      setAdherenceMap(newAdherence);
    }

    setLoading(false);
  };

  // Load nutrition plans
  useEffect(() => {
    if (!profile?.id) return;
    loadMealPlans();
  }, [profile?.id]);

  const filteredMealPlans = useMemo(() => {
    if (mealFilterStatus === 'active') return mealPlans.filter(p => p.is_active);
    if (mealFilterStatus === 'past') return mealPlans.filter(p => !p.is_active);
    return mealPlans;
  }, [mealPlans, mealFilterStatus]);

  const loadMealPlans = () => {
    setMealPlansLoading(true);
    supabase
      .from('trainer_meal_plans')
      .select('*, profiles!trainer_meal_plans_client_id_fkey(full_name)')
      .eq('trainer_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setMealPlans(data || []);
        setMealPlansLoading(false);
      });
  };

  const saveMealPlan = async () => {
    if (!mealForm.client_id || !mealForm.name.trim()) return;
    setMealSaving(true);
    // Serialize generated meals into compact JSONB
    const mealsJson = generatedMeals ? generatedMeals.map((day, di) => ({
      day: di + 1,
      meals: (day.meals || []).map(m => ({ id: m.id, title: m.title, title_es: m.title_es, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, category: m.category, prepTime: m.prepTime })),
      totals: day.totals,
    })) : [];
    await supabase.from('trainer_meal_plans').insert({
      gym_id: profile.gym_id,
      trainer_id: profile.id,
      client_id: mealForm.client_id,
      name: mealForm.name.trim(),
      description: mealForm.description.trim() || null,
      target_calories: mealForm.target_calories ? parseInt(mealForm.target_calories) : null,
      target_protein_g: mealForm.target_protein_g ? parseInt(mealForm.target_protein_g) : null,
      target_carbs_g: mealForm.target_carbs_g ? parseInt(mealForm.target_carbs_g) : null,
      target_fat_g: mealForm.target_fat_g ? parseInt(mealForm.target_fat_g) : null,
      meals: mealsJson,
    });
    setMealSaving(false);
    setShowMealModal(false);
    setMealForm({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '' });
    setGeneratedMeals(null);
    setMealStep('settings');
    loadMealPlans();
  };

  const handleSaved = () => {
    setView('list');
    setEditing(null);
    loadData();
  };

  const openBuilder = (plan = null) => {
    setEditing(plan);
    setView('builder');
  };

  const closeBuilder = () => {
    setView('list');
    setEditing(null);
  };

  const toggleActive = async (plan) => {
    await supabase.from('trainer_workout_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    loadData();
  };

  const duplicatePlan = async (plan) => {
    const { id, profiles, created_at, updated_at, ...rest } = plan;
    await supabase.from('trainer_workout_plans').insert({
      ...rest,
      name: `${plan.name} ${t('trainerPlans.copySuffix', '(Copy)')}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    loadData();
  };

  const deletePlan = async (plan) => {
    if (!confirm(t('trainerPlans.confirmDelete', 'Delete "{{name}}"?', { name: plan.name }))) return;
    await supabase.from('trainer_workout_plans').delete().eq('id', plan.id);
    loadData();
  };

  const filtered = useMemo(() => {
    let result = plans;
    // Status filter
    if (filterStatus === 'active') result = result.filter(p => p.is_active);
    else if (filterStatus === 'archived') result = result.filter(p => !p.is_active);
    // Client filter
    if (filterClient !== 'all') result = result.filter(p => p.client_id === filterClient);
    return result;
  }, [plans, filterClient, filterStatus]);

  const countExercises = (plan) => {
    const allDays = Object.values(plan.weeks || {}).flat();
    return allDays.reduce((sum, d) => sum + (d.exercises?.length || 0), 0);
  };

  // ── Builder view ──
  if (view === 'builder') {
    return (
      <PlanBuilder
        plan={editing}
        clients={clients}
        onClose={closeBuilder}
        onSaved={handleSaved}
        trainerId={profile.id}
        gymId={profile.gym_id}
        t={t}
      />
    );
  }

  // ── List view ──
  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 max-w-5xl mx-auto pb-28 md:pb-12">
        <h1 className="text-[22px] font-bold text-[var(--color-text-primary)] mb-6 truncate">{t('trainerPlans.title', 'Workout Plans')}</h1>
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 py-6 max-w-5xl mx-auto pb-28 md:pb-12">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-2xl -mx-4 md:-mx-6 px-4 md:px-6 py-3 mb-4"
        style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 92%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
          {t('trainerPlans.subtitle', 'Training & Nutrition')}
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {t('trainerPlans.title', 'Plans')}
          </h1>
          <button
            onClick={() => section === 'training' ? openBuilder() : setShowMealModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-bold transition-colors flex-shrink-0 whitespace-nowrap min-h-[44px]"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Plus size={16} /> {section === 'training' ? t('trainerPlans.createPlan', 'Create Plan') : t('trainerPlans.createMealPlan', 'Create Meal Plan')}
          </button>
        </div>
      </div>

      {/* Training / Nutrition section toggle */}
      <div className="mb-4">
        <UnderlineTabs
          tabs={SECTION_TABS}
          activeIndex={sectionIndex}
          onChange={setSectionIndex}
        />
      </div>

      <SwipeableTabView activeIndex={sectionIndex} onChangeIndex={setSectionIndex} tabKeys={['training', 'nutrition']}>
        {/* ═══════════ TRAINING SECTION ═══════════ */}
        <div>
      {/* Filters row */}
      <div className="space-y-3 mb-5">
        {/* Status filter */}
        {(() => {
          const STATUS_FILTERS = [
            { key: 'active', label: t('trainerPlans.active', 'Active') },
            { key: 'all', label: t('trainerPlans.statusAll', 'All') },
            { key: 'archived', label: t('trainerPlans.archives', 'Archives') },
          ];
          return (
            <UnderlineTabs
              tabs={STATUS_FILTERS}
              activeIndex={Math.max(0, STATUS_FILTERS.findIndex(s => s.key === filterStatus))}
              onChange={(i) => setFilterStatus(STATUS_FILTERS[i].key)}
            />
          );
        })()}

        {/* Client filter */}
        {clients.length > 0 && plans.length > 0 && (() => {
          const CLIENT_TABS = [
            { key: 'all', label: t('trainerPlans.allClients', 'All Clients') },
            ...clients.map(c => ({ key: c.id, label: c.full_name?.split(' ')[0] })),
          ];
          return (
            <UnderlineTabs
              tabs={CLIENT_TABS}
              activeIndex={Math.max(0, CLIENT_TABS.findIndex(ct => ct.key === filterClient))}
              onChange={(i) => setFilterClient(CLIENT_TABS[i].key)}
              scrollable
            />
          );
        })()}
      </div>

      {/* Plans list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <ClipboardList size={32} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-[14px] text-[var(--color-text-muted)]">
            {plans.length === 0
              ? t('trainerPlans.noPlansYet', 'No workout plans yet')
              : t('trainerPlans.noPlansFiltered', 'No plans match these filters')}
          </p>
          {plans.length === 0 && (
            <p className="text-[12px] text-[var(--color-text-muted)] mt-1">{t('trainerPlans.createHint', 'Create a custom workout plan for your clients')}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(plan => {
            const isExpanded = expandedPlan === plan.id;
            const totalEx = countExercises(plan);
            const allDays = Object.values(plan.weeks || {}).flat();
            const totalDays = allDays.length;

            return (
              <div key={plan.id} className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
                {/* Plan header */}
                <button onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                  className="w-full flex items-center gap-3 p-4 sm:p-5 text-left hover:bg-white/2 transition-colors min-h-[44px]">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    plan.is_active ? 'bg-[var(--color-accent)]/12' : 'bg-white/4'
                  }`}>
                    <Dumbbell size={18} className={plan.is_active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate">{plan.name}</p>
                      {!plan.is_active && (
                        <span className="text-[9px] font-bold text-[var(--color-text-muted)] bg-white/4 px-1.5 py-0.5 rounded-full flex-shrink-0">{t('trainerPlans.inactiveBadge', 'INACTIVE')}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      {plan.profiles?.full_name || t('trainerPlans.client', 'Client')} · {plan.duration_weeks}w · {totalDays} {t('trainerPlans.daysAbbrev', 'days')} · {totalEx} {t('trainerPlans.ex', 'ex')}
                    </p>
                    {/* Adherence indicator */}
                    {adherenceMap[plan.id] && (() => {
                      const { completed, expected } = adherenceMap[plan.id];
                      const pct = expected > 0 ? Math.round((completed / expected) * 100) : 0;
                      const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
                      const dotColor = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <p className={`text-[11px] font-medium ${color} flex items-center gap-1.5 mt-0.5`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
                          {t('trainer.clientCompletedXOfY', '{{completed}} of {{expected}} sessions this week', { completed, expected })}
                        </p>
                      );
                    })()}
                    {/* Last updated */}
                    {plan.updated_at && plan.updated_at !== plan.created_at && (
                      <p className="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                        {t('trainerPlans.updated', 'Updated')} {format(new Date(plan.updated_at), 'MMM d')}
                      </p>
                    )}
                  </div>
                  <ChevronDown size={16} className={`text-[var(--color-text-muted)] transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-white/4 p-4 sm:p-5 space-y-3">
                    {plan.description && (
                      <p className="text-[12px] text-[var(--color-text-secondary)]">{plan.description}</p>
                    )}

                    {/* Week preview */}
                    <div className="space-y-1.5">
                      {Object.entries(plan.weeks || {}).slice(0, 2).map(([wk, days]) => (
                        <div key={wk}>
                          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-1">{t('trainerPlans.weekLabel', 'Week')} {wk}</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {(days || []).map((d, di) => (
                              <span key={di} className="px-2.5 py-1 bg-[var(--color-bg-secondary)] rounded-lg text-[11px] text-[var(--color-text-secondary)]">
                                {d.name || t('trainerPlans.dayPrefix', 'Day {{num}}', { num: di + 1 })}
                                <span className="text-[var(--color-text-muted)] ml-1">({d.exercises?.length || 0} {t('trainerPlans.ex', 'ex')})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {Object.keys(plan.weeks || {}).length > 2 && (
                        <p className="text-[10px] text-[var(--color-text-muted)]">+ {Object.keys(plan.weeks).length - 2} {t('trainerPlans.moreWeeks', 'more weeks')}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-white/4 flex-wrap">
                      <button onClick={() => openBuilder(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 transition-colors min-h-[44px]">
                        {t('trainerPlans.edit', 'Edit')}
                      </button>
                      <button onClick={() => duplicatePlan(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-white/4 text-[var(--color-text-secondary)] hover:bg-white/8 transition-colors flex items-center gap-1 min-h-[44px]">
                        <Copy size={11} /> {t('trainerPlans.duplicate', 'Duplicate')}
                      </button>
                      <button onClick={() => toggleActive(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-white/4 text-[var(--color-text-secondary)] hover:bg-white/8 transition-colors flex items-center gap-1 min-h-[44px]">
                        {plan.is_active
                          ? <><ToggleRight size={12} /> {t('trainerPlans.deactivate', 'Deactivate')}</>
                          : <><ToggleLeft size={12} /> {t('trainerPlans.activate', 'Activate')}</>}
                      </button>
                      <div className="flex-1" />
                      <button onClick={() => deletePlan(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors min-h-[44px]">
                        <Trash2 size={12} />
                      </button>
                    </div>

                    <p className="text-[10px] text-[var(--color-text-faint)]">
                      {t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy')}
                      {plan.updated_at !== plan.created_at && ` · ${t('trainerPlans.updated', 'Updated')} ${format(new Date(plan.updated_at), 'MMM d, yyyy')}`}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </div>

        {/* ═══════════ NUTRITION SECTION ═══════════ */}
        <div>
          {/* Status filter */}
          {(() => {
            const MEAL_FILTERS = [
              { key: 'active', label: t('trainerPlans.active', 'Active') },
              { key: 'past', label: t('trainerPlans.past', 'Past') },
              { key: 'all', label: t('trainerPlans.statusAll', 'All') },
            ];
            return (
              <div className="mb-5">
                <UnderlineTabs
                  tabs={MEAL_FILTERS}
                  activeIndex={Math.max(0, MEAL_FILTERS.findIndex(f => f.key === mealFilterStatus))}
                  onChange={(i) => setMealFilterStatus(MEAL_FILTERS[i].key)}
                />
              </div>
            );
          })()}

          {mealPlansLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid var(--color-border-subtle)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : filteredMealPlans.length === 0 ? (
            <div className="text-center py-20">
              <UtensilsCrossed size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-[14px]" style={{ color: 'var(--color-text-muted)' }}>
                {mealPlans.length === 0
                  ? t('trainerPlans.noMealPlans', 'No meal plans yet')
                  : t('trainerPlans.noMealPlansFiltered', 'No meal plans match this filter')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredMealPlans.map(plan => (
                <div key={plan.id} className="rounded-2xl p-4 sm:p-5 transition-all"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{plan.name}</p>
                      {plan.profiles?.full_name && (
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          {t('trainerPlans.assignedTo', 'Assigned to {{name}}', { name: plan.profiles.full_name })}
                        </p>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      plan.is_active ? 'text-emerald-400 bg-emerald-500/10' : 'text-[var(--color-text-muted)]'
                    }`} style={!plan.is_active ? { background: 'var(--color-bg-subtle)' } : undefined}>
                      {plan.is_active ? t('trainerPlans.active', 'Active') : t('trainerPlans.past', 'Past')}
                    </span>
                  </div>
                  {plan.description && (
                    <p className="text-[12px] mb-2 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>{plan.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {plan.target_calories && <span>{plan.target_calories} cal</span>}
                    {plan.target_protein_g && <span>P: {plan.target_protein_g}g</span>}
                    {plan.target_carbs_g && <span>C: {plan.target_carbs_g}g</span>}
                    {plan.target_fat_g && <span>F: {plan.target_fat_g}g</span>}
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: 'var(--color-text-faint)' }}>
                    {t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </SwipeableTabView>

      {/* ── Meal Plan Creation Modal (2-step: Settings → Meals) ── */}
      {showMealModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setShowMealModal(false); setMealStep('settings'); setGeneratedMeals(null); }}>
          <div className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg overflow-hidden max-h-[92vh] sm:max-h-[88vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-center gap-2">
                {mealStep === 'meals' && (
                  <button onClick={() => setMealStep('settings')} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" style={{ color: 'var(--color-text-muted)' }}>
                    <ArrowLeft size={18} />
                  </button>
                )}
                <h2 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {mealStep === 'settings' ? t('trainerPlans.createMealPlan', 'Create Meal Plan') : t('trainerPlans.weeklyMeals', 'Weekly Meals')}
                </h2>
              </div>
              <button onClick={() => { setShowMealModal(false); setMealStep('settings'); setGeneratedMeals(null); }} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg" style={{ color: 'var(--color-text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* ── STEP 1: Settings ── */}
            {mealStep === 'settings' && (
              <>
                <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                  {/* Client */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>{t('trainerPlans.client', 'Client')}</label>
                    <select value={mealForm.client_id} onChange={e => { setMealForm(f => ({ ...f, client_id: e.target.value })); setMealGoalOverride(null); setGeneratedMeals(null); }}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                      <option value="">{t('trainerPlans.selectClient', 'Select client...')}</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                    </select>
                  </div>

                  {/* Client profile + goal override + auto-calculate */}
                  {mealClientProfile?.onboarding && (
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: 'var(--color-accent)' }}>{t('trainerPlans.clientProfile', 'Client Profile')}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-3">
                        <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.level', 'Level')}:</span> <span className="font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }}>{mealClientProfile.onboarding.fitness_level || '—'}</span></span>
                        <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.goal', 'Goal')}:</span> <span className="font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }}>{mealClientProfile.onboarding.primary_goal?.replace(/_/g, ' ') || '—'}</span></span>
                        <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.daysWeek', 'Days/wk')}:</span> <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{mealClientProfile.onboarding.training_days_per_week || '—'}</span></span>
                        {mealClientProfile.latestWeight && (
                          <span><span style={{ color: 'var(--color-text-subtle)' }}>{t('trainerPlans.weight', 'Weight')}:</span> <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{Math.round(mealClientProfile.latestWeight)} lbs</span></span>
                        )}
                      </div>
                      <div className="pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                        <p className="text-[10px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('trainerPlans.nutritionGoal', 'Nutrition goal')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {GOAL_OPTIONS.map(g => {
                            const clientGoal = mealClientProfile.onboarding.primary_goal;
                            const isActive = mealGoalOverride ? mealGoalOverride === g : clientGoal === g;
                            return (
                              <button key={g} onClick={() => setMealGoalOverride(g === clientGoal ? null : g)}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all relative ${isActive ? 'text-black' : ''}`}
                                style={isActive ? { backgroundColor: 'var(--color-accent)' } : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }}>
                                {g.replace(/_/g, ' ')}
                                {!mealGoalOverride && clientGoal === g && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <button onClick={handleAutoCalculateMacros}
                        className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold transition-colors min-h-[44px]"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
                        <Zap size={14} />
                        {t('trainerPlans.autoCalculateMacros', 'Auto-Calculate Macros')}
                      </button>
                    </div>
                  )}

                  {/* Name */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>{t('trainerPlans.planName', 'Plan Name')}</label>
                    <input value={mealForm.name} onChange={e => setMealForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('trainerPlans.mealPlanNamePlaceholder', 'e.g. Cutting Phase, Bulking Plan')}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>{t('trainerPlans.description', 'Description')}</label>
                    <textarea value={mealForm.description} onChange={e => setMealForm(f => ({ ...f, description: e.target.value }))} rows={2}
                      placeholder={t('trainerPlans.mealDescPlaceholder', 'Optional notes about the plan...')}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none resize-none"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                  </div>

                  {/* Macro targets */}
                  <div>
                    <label className="text-[12px] font-medium mb-2 block" style={{ color: 'var(--color-text-secondary)' }}>{t('trainerPlans.macroTargets', 'Macro Targets')}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: 'target_calories', label: t('trainerPlans.calories', 'Calories'), placeholder: '2200', color: '#D4AF37' },
                        { key: 'target_protein_g', label: t('trainerPlans.proteinG', 'Protein (g)'), placeholder: '180', color: '#60A5FA' },
                        { key: 'target_carbs_g', label: t('trainerPlans.carbsG', 'Carbs (g)'), placeholder: '250', color: '#34D399' },
                        { key: 'target_fat_g', label: t('trainerPlans.fatG', 'Fat (g)'), placeholder: '65', color: '#F472B6' },
                      ].map(({ key, label, placeholder, color }) => (
                        <div key={key} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}>
                          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color }}>{label}</span>
                          <input type="number" inputMode="numeric" value={mealForm[key]} onChange={e => setMealForm(f => ({ ...f, [key]: e.target.value }))}
                            placeholder={placeholder} className="w-full bg-transparent text-[20px] font-bold outline-none" style={{ color: 'var(--color-text-primary)' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer — Step 1 */}
                <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                  <button onClick={() => { setShowMealModal(false); setMealStep('settings'); }}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-medium min-h-[44px]"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    {t('trainerPlans.cancel', 'Cancel')}
                  </button>
                  <button onClick={handleGenerateMeals}
                    disabled={generatingMeals || !mealForm.target_calories || !mealForm.target_protein_g || !mealForm.client_id || !mealForm.name.trim()}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-bold min-h-[44px] transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>
                    {generatingMeals ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                    {generatingMeals ? t('trainerPlans.generating', 'Generating…') : t('trainerPlans.generateMeals', 'Generate Meals')}
                  </button>
                </div>
              </>
            )}

            {/* ── STEP 2: Meal Preview ── */}
            {mealStep === 'meals' && generatedMeals && (
              <>
                <div className="flex-1 overflow-y-auto">
                  {/* Day selector */}
                  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    {DAY_LABELS.map((label, i) => (
                      <button key={i} onClick={() => setMealPreviewDay(i)}
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${mealPreviewDay === i ? 'text-black' : ''}`}
                        style={mealPreviewDay === i ? { backgroundColor: 'var(--color-accent)' } : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Day totals */}
                  {generatedMeals[mealPreviewDay] && (
                    <div className="px-4 pt-3">
                      <div className="flex items-center gap-3 mb-3 text-[11px]">
                        <span style={{ color: '#D4AF37' }} className="font-bold">{generatedMeals[mealPreviewDay].totals?.calories || 0} cal</span>
                        <span style={{ color: '#60A5FA' }} className="font-semibold">{generatedMeals[mealPreviewDay].totals?.protein || 0}g P</span>
                        <span style={{ color: '#34D399' }} className="font-semibold">{generatedMeals[mealPreviewDay].totals?.carbs || 0}g C</span>
                        <span style={{ color: '#F472B6' }} className="font-semibold">{generatedMeals[mealPreviewDay].totals?.fat || 0}g F</span>
                        {generatedMeals[mealPreviewDay].fits && (
                          <span className="text-emerald-400 text-[10px] font-bold ml-auto">✓ {t('trainerPlans.macrosFit', 'Macros fit')}</span>
                        )}
                      </div>

                      {/* Meal cards */}
                      <div className="space-y-2.5 pb-4">
                        {(generatedMeals[mealPreviewDay].meals || []).map((meal, mi) => {
                          const slot = MEAL_SLOTS[mi] || MEAL_SLOTS[3];
                          const mealLabel = i18n.language === 'es' ? slot.label_es : slot.label;
                          const mealColor = slot.color;
                          const mealTitle = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                          return (
                            <div key={mi} className="rounded-xl p-3 flex gap-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}>
                              {/* Meal image */}
                              {foodImageUrl(meal.image) ? (
                                <img src={foodImageUrl(meal.image)} alt={mealTitle} className="w-16 h-16 rounded-xl object-cover shrink-0" style={{ backgroundColor: 'var(--color-bg-deep)' }} loading="lazy" />
                              ) : (
                                <div className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-deep)' }}>
                                  <UtensilsCrossed size={20} style={{ color: 'var(--color-text-subtle)' }} />
                                </div>
                              )}
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: mealColor }}>{mealLabel}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => swapMeal(mealPreviewDay, mi)}
                                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg transition-colors"
                                      style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)' }}
                                      title={t('trainerPlans.swapMeal', 'Swap meal')}>
                                      <RefreshCw size={11} />
                                    </button>
                                    <button onClick={() => { setMealPickerSlot({ dayIdx: mealPreviewDay, mealIdx: mi }); setMealSearch(''); }}
                                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg transition-colors"
                                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}
                                      title={t('trainerPlans.chooseMeal', 'Choose meal')}>
                                      <Pencil size={11} />
                                    </button>
                                  </div>
                                </div>
                                <p className="text-[13px] font-semibold truncate mb-1" style={{ color: 'var(--color-text-primary)' }}>{mealTitle}</p>
                                <div className="flex items-center gap-2.5 text-[10px]">
                                  <span style={{ color: '#D4AF37' }}>{meal.calories} cal</span>
                                  <span style={{ color: '#60A5FA' }}>{meal.protein}g P</span>
                                  <span style={{ color: '#34D399' }}>{meal.carbs}g C</span>
                                  <span style={{ color: '#F472B6' }}>{meal.fat}g F</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* ── Meal Picker Overlay ── */}
                      {mealPickerSlot && (
                        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setMealPickerSlot(null)}>
                          <div className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }} onClick={e => e.stopPropagation()}>
                            <div className="p-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                  {t('trainerPlans.chooseMeal', 'Choose Meal')}
                                </h3>
                                <button onClick={() => setMealPickerSlot(null)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" style={{ color: 'var(--color-text-muted)' }}>
                                  <X size={16} />
                                </button>
                              </div>
                              <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                                <input value={mealSearch} onChange={e => setMealSearch(e.target.value)}
                                  placeholder={t('trainerPlans.searchMeals', 'Search meals...')}
                                  autoFocus
                                  className="w-full rounded-xl pl-10 pr-4 py-2.5 text-[16px] sm:text-[14px] outline-none"
                                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                              </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2">
                              {filteredMeals.map(meal => {
                                const title = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                                return (
                                  <button key={meal.id} onClick={() => pickMeal(meal)}
                                    className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl transition-colors active:scale-[0.98]"
                                    style={{ color: 'var(--color-text-primary)' }}>
                                    {foodImageUrl(meal.image) ? (
                                      <img src={foodImageUrl(meal.image)} alt={title} className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ backgroundColor: 'var(--color-bg-deep)' }} loading="lazy" />
                                    ) : (
                                      <div className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-deep)' }}>
                                        <UtensilsCrossed size={16} style={{ color: 'var(--color-text-subtle)' }} />
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[13px] font-semibold truncate">{title}</p>
                                      <div className="flex items-center gap-2.5 mt-0.5 text-[10px]">
                                        <span style={{ color: '#D4AF37' }}>{meal.calories} cal</span>
                                        <span style={{ color: '#60A5FA' }}>{meal.protein}g P</span>
                                        <span style={{ color: '#34D399' }}>{meal.carbs}g C</span>
                                        <span style={{ color: '#F472B6' }}>{meal.fat}g F</span>
                                      </div>
                                      <span className="text-[9px] font-medium capitalize mt-0.5 block" style={{ color: 'var(--color-text-muted)' }}>
                                        {meal.category?.replace(/_/g, ' ')}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                              {filteredMeals.length === 0 && (
                                <p className="text-center py-8 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('trainerPlans.noMealsFound', 'No meals found')}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer — Step 2 */}
                <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                  <button onClick={handleGenerateMeals} disabled={generatingMeals}
                    className="py-3 sm:py-2.5 px-4 rounded-xl text-[13px] font-semibold min-h-[44px] flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    {generatingMeals ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {t('trainerPlans.regenerate', 'Regenerate')}
                  </button>
                  <button onClick={saveMealPlan} disabled={mealSaving}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-bold min-h-[44px] transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>
                    {mealSaving ? <Loader2 size={16} className="animate-spin" /> : <UtensilsCrossed size={16} />}
                    {mealSaving ? t('trainerPlans.saving', 'Saving...') : t('trainerPlans.assignMealPlan', 'Assign Meal Plan')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

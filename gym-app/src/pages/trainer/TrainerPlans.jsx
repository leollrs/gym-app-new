import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, Dumbbell,
  ClipboardList, Search, ToggleLeft, ToggleRight, ArrowLeft, StickyNote,
  ChevronUp, FileText, Calendar, Zap, Loader2, RefreshCw, Pencil,
  Activity, Target, MoreHorizontal,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { selectAllRows } from '../../lib/churn/batchedSelect';
import { useToast } from '../../contexts/ToastContext';
import posthog from 'posthog-js';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { enUS as enLocale } from 'date-fns/locale/en-US';
import { useTranslation } from 'react-i18next';
import { generateProgram } from '../../lib/workoutGenerator';
import { generateRoutineName, translateCreativeName } from '../../lib/programNaming';
import { calculateMacros } from '../../lib/macroCalculator';
import { generateWeekPlan, generateDayPlan } from '../../lib/mealPlanner';
import { MEALS } from '../../data/meals';
import { foodImageUrl } from '../../lib/imageUrl';
import { motion } from 'framer-motion';
import SwipeableTabView from '../../components/SwipeableTabView';
import { UtensilsCrossed } from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import TrainerEmptyState from './components/TrainerEmptyState';
import { TT, TFont } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TPrimaryButton, TTabPill, TSectionHeader, TPill } from './components/designPrimitives';

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

// ── Meal-slot budgeting + day validation ─────────────────────────────────
// MEAL_SLOT_SHARE mirrors mealPlanner.js's private SLOT_SHARE (breakfast
// lighter, dinner heavier). Keep in sync — the generator doesn't export it.
const MEAL_SLOT_SHARE = { breakfast: 0.28, lunch: 0.34, dinner: 0.38, snack: 0.14 };
const slotShareOf = (slotType, dayMeals) => {
  const shares = dayMeals.map(m => MEAL_SLOT_SHARE[m.slotType] || 1 / dayMeals.length);
  const sum = shares.reduce((s, v) => s + v, 0) || 1;
  return (MEAL_SLOT_SHARE[slotType] || 1 / dayMeals.length) / sum;
};
// Same tolerances the generator validates with (±10% cal, ±15% macros) so
// the "Macros fit" badge stays truthful after swaps/manual picks.
const computeDayFits = (totals, targets) => {
  if (!targets.calories) return false;
  const calOk = Math.abs(totals.calories - targets.calories) / targets.calories <= 0.10;
  const pOk = Math.abs(totals.protein - targets.protein) / Math.max(targets.protein, 1) <= 0.15;
  const cOk = Math.abs(totals.carbs - targets.carbs) / Math.max(targets.carbs, 1) <= 0.15;
  const fOk = Math.abs(totals.fat - targets.fat) / Math.max(targets.fat, 1) <= 0.15;
  return calOk && pOk && cOk && fOk;
};

// ── Muscle group color pills ─────────────────────────────────────────────
// Keyed by the REAL DB muscle_group enum values (0001 + 0044 + 0247),
// lowercased with spaces→_ ('Full Body'→full_body, 'Warm-Up'→warm-up).
// Text blends the hue toward var(--tt-text) so pills stay readable in
// BOTH themes (dark text on light, light text on dark).
const mgTone = (hex, bg) => ({ bg, text: `color-mix(in srgb, ${hex} 58%, var(--tt-text))` });
const MUSCLE_GROUP_COLORS = {
  chest:      mgTone('#C2410C', 'rgba(239,68,68,0.12)'),
  back:       mgTone('#1D4ED8', 'rgba(59,130,246,0.12)'),
  shoulders:  mgTone('#B45309', 'rgba(251,146,60,0.14)'),
  biceps:     mgTone('#7E22CE', 'rgba(168,85,247,0.12)'),
  triceps:    mgTone('#6D28D9', 'rgba(139,92,246,0.12)'),
  legs:       mgTone('#15803D', 'rgba(34,197,94,0.12)'),
  glutes:     mgTone('#0F766E', 'rgba(20,184,166,0.14)'),
  core:       mgTone('#A16207', 'rgba(234,179,8,0.16)'),
  calves:     mgTone('#047857', 'rgba(16,185,129,0.12)'),
  forearms:   mgTone('#9F1239', 'rgba(244,63,94,0.12)'),
  traps:      mgTone('#4338CA', 'rgba(99,102,241,0.12)'),
  full_body:  mgTone('#475569', 'rgba(100,116,139,0.12)'),
  'warm-up':  mgTone('#BE185D', 'rgba(236,72,153,0.12)'),
};
const MUSCLE_FALLBACK = mgTone('#64748B', 'rgba(100,116,139,0.1)');
const getMuscleColor = (group) => {
  if (!group) return MUSCLE_FALLBACK;
  const key = group.toLowerCase().replace(/\s+/g, '_');
  return MUSCLE_GROUP_COLORS[key] || MUSCLE_FALLBACK;
};

// ── Exercise Search Panel ────────────────────────────────
const ExerciseSearchPanel = ({ exercises, exSearch, setExSearch, onAdd, exLabel, muscleLabelFor, t }) => {
  const [muscle, setMuscle] = useState('all');
  const [equipment, setEquipment] = useState('all');
  const equipmentLabelFor = useCallback((eq) => (eq ? t(`equipment.${eq}`, eq) : ''), [t]);

  const muscles = useMemo(() => {
    const present = new Set(exercises.map(e => e.muscle_group).filter(Boolean));
    return ['all', ...[...present].sort()];
  }, [exercises]);
  const equipmentList = useMemo(() => {
    const present = new Set(exercises.map(e => e.equipment).filter(Boolean));
    return ['all', ...[...present].sort()];
  }, [exercises]);

  const filteredExercises = useMemo(() => {
    const q = exSearch.trim().toLowerCase();
    return exercises.filter(e => {
      if (muscle !== 'all' && e.muscle_group !== muscle) return false;
      if (equipment !== 'all' && e.equipment !== equipment) return false;
      if (!q) return true;
      return e.name?.toLowerCase().includes(q) ||
        e.name_es?.toLowerCase().includes(q) ||
        e.muscle_group?.toLowerCase().includes(q) ||
        muscleLabelFor(e.muscle_group)?.toLowerCase().includes(q) ||
        e.equipment?.toLowerCase().includes(q) ||
        equipmentLabelFor(e.equipment)?.toLowerCase().includes(q);
    });
  }, [exercises, exSearch, muscle, equipment, muscleLabelFor, equipmentLabelFor]);

  const chipStyle = (active) => ({
    padding: '5px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
    whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0,
    border: `1px solid ${active ? TT.accent : TT.border}`,
    background: active ? TT.accent : TT.surface2,
    color: active ? '#fff' : TT.textSub,
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: TT.textMute }} />
        <input
          value={exSearch}
          onChange={e => setExSearch(e.target.value)}
          placeholder={t('trainerPlans.searchExercises', 'Search exercises...')}
          className="w-full rounded-xl pl-9 pr-10 py-3 text-[16px] sm:text-[13px] outline-none"
          style={{ background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }}
          onFocus={e => { e.target.style.borderColor = TT.accent; }}
          onBlur={e => { e.target.style.borderColor = TT.border; }}
        />
        {exSearch && (
          <button
            onClick={() => setExSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full transition-colors"
            style={{ background: TT.surface, color: TT.textMute }}
          >
            <X size={10} />
          </button>
        )}
      </div>
      {/* Muscle-group filter chips (member-style) */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {muscles.map(m => (
          <button key={m} type="button" onClick={() => setMuscle(m)} style={chipStyle(muscle === m)}>
            {m === 'all' ? t('trainerPlans.allMuscles', 'All') : muscleLabelFor(m)}
          </button>
        ))}
      </div>
      {/* Equipment filter chips (only when there's a real choice) */}
      {equipmentList.length > 2 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {equipmentList.map(eq => (
            <button key={eq} type="button" onClick={() => setEquipment(eq)} style={chipStyle(equipment === eq)}>
              {eq === 'all' ? t('trainerPlans.allEquipment', 'All equipment') : equipmentLabelFor(eq)}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-0.5 max-h-[320px] overflow-y-auto overscroll-contain">
        {filteredExercises.length === 0 && (
          <p className="text-[12px] text-center py-4" style={{ color: TT.textMute }}>{t('trainerPlans.noExercisesFound', 'No exercises found')}</p>
        )}
        {filteredExercises.map(ex => {
          const mc = getMuscleColor(ex.muscle_group);
          return (
            <button
              key={ex.id}
              onClick={() => onAdd(ex.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left active:scale-[0.98] transition-all group min-h-[48px]"
              onMouseEnter={e => { e.currentTarget.style.background = TT.surface2; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Plus size={14} className="flex-shrink-0 transition-colors" style={{ color: TT.textMute }} />
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <p className="text-[13px] truncate" style={{ color: TT.text }}>{exLabel(ex)}</p>
                {ex.muscle_group && (
                  <span
                    className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                    style={{ background: mc.bg, color: mc.text }}
                  >
                    {muscleLabelFor(ex.muscle_group)}
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
const DayCard = ({ day, di, wk, exercises, exName, exLabel, muscleLabelFor, updateDayName, removeDay, addExercise, removeExercise, updateExercise, moveExercise, copyDayMenu, setCopyDayMenu, setCopyWeekMenu, allDayTargets, copyDayTo, t }) => {
  const dayTime = calcDaySeconds(day);
  const showCopyDay = copyDayMenu?.wk === wk && copyDayMenu?.di === di;
  const dayTargets = allDayTargets(wk, di);
  const [expanded, setExpanded] = useState(true);
  const [showExSearch, setShowExSearch] = useState(false);
  const [exSearch, setExSearch] = useState('');
  const [expandedNotes, setExpandedNotes] = useState({});

  const toggleNote = (ei) => setExpandedNotes(prev => ({ ...prev, [ei]: !prev[ei] }));

  return (
    <div className="rounded-2xl overflow-visible" style={{ border: `1px solid ${TT.border}`, background: TT.surface }}>
      {/* Day header - whole header tappable for expand/collapse */}
      <div
        className="flex items-center gap-1 md:gap-2 px-3 md:px-4 py-3 rounded-t-2xl cursor-pointer transition-colors"
        style={{ background: TT.surface2 }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown size={14} className={`transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} style={{ color: TT.textMute }} />
        <input value={day.name} onChange={e => updateDayName(wk, di, e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder={t('trainerPlans.dayPrefix', 'Day {{num}}', { num: di + 1 })}
          className="flex-1 bg-transparent text-[14px] font-semibold outline-none min-w-0" style={{ color: TT.text }} />
        <span className="text-[11px] flex-shrink-0 flex items-center gap-1.5" style={{ color: TT.textMute }}>
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
            className="min-w-[36px] min-h-[44px] md:min-w-[44px] flex items-center justify-center transition-colors" style={{ color: TT.textMute }} title={t('trainerPlans.copyDay', 'Copy day')}>
            <Copy size={13} />
          </button>
          {showCopyDay && (
            <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[180px] max-w-[calc(100vw-2rem)] max-h-48 overflow-y-auto" style={{ background: TT.bgElev, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
              <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-2 pb-1" style={{ color: TT.textMute }}>{t('trainerPlans.copyDayTo', 'Copy day to...')}</p>
              {dayTargets.map((target, idx) => (
                <button key={idx} onClick={() => copyDayTo(wk, di, target.wk, target.di)}
                  className="w-full text-left px-3 py-2 text-[12px] transition-colors min-h-[44px] flex items-center" style={{ color: TT.text }}
                  onMouseEnter={e => { e.currentTarget.style.background = TT.surface2; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  {target.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); removeDay(wk, di); }}
          className="min-w-[36px] min-h-[44px] md:min-w-[44px] flex items-center justify-center transition-colors flex-shrink-0" style={{ color: TT.textMute }}
          onMouseEnter={e => { e.currentTarget.style.color = TT.hot; }}
          onMouseLeave={e => { e.currentTarget.style.color = TT.textMute; }}>
          <Trash2 size={13} />
        </button>
      </div>

      {/* Exercises */}
      {expanded && (
        <div className="px-3 md:px-4 pb-4 pt-3 space-y-2">
          {/* Empty state */}
          {day.exercises.length === 0 && (
            <div className="py-8 text-center">
              <Dumbbell size={24} className="mx-auto mb-2" style={{ color: TT.textMute }} />
              <p className="text-[12px]" style={{ color: TT.textMute }}>{t('trainerPlans.noExercisesYet', 'No exercises yet')}</p>
              <p className="text-[10px] mt-0.5" style={{ color: TT.textMute }}>{t('trainerPlans.addExercisesHint', 'Add exercises or auto-generate')}</p>
            </div>
          )}

          {day.exercises.map((ex, ei) => (
            <div key={ei} className="rounded-xl px-3 py-3" style={{ background: TT.surface2 }}>
              {/* Exercise name + reorder + delete */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-semibold flex-1 min-w-0 truncate" style={{ color: TT.text }}>{exName(ex.id)}</span>
                {/* Real reorder controls (replaced the decorative drag handle) */}
                <button onClick={() => moveExercise(wk, di, ei, -1)} disabled={ei === 0}
                  aria-label={t('trainerPlans.moveUp', 'Move up')}
                  className="min-w-[32px] min-h-[36px] flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-25"
                  style={{ color: TT.textMute }}>
                  <ChevronUp size={13} />
                </button>
                <button onClick={() => moveExercise(wk, di, ei, 1)} disabled={ei === day.exercises.length - 1}
                  aria-label={t('trainerPlans.moveDown', 'Move down')}
                  className="min-w-[32px] min-h-[36px] flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-25"
                  style={{ color: TT.textMute }}>
                  <ChevronDown size={13} />
                </button>
                <button onClick={() => removeExercise(wk, di, ei)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors flex-shrink-0 -mr-1" style={{ color: TT.textMute }}
                  onMouseEnter={e => { e.currentTarget.style.color = TT.hot; }}
                  onMouseLeave={e => { e.currentTarget.style.color = TT.textMute; }}>
                  <Trash2 size={12} />
                </button>
              </div>
              {/* Sets / Reps / Rest controls - compact row below name */}
              <div className="flex items-center gap-2 flex-wrap pb-0.5">
                {/* Sets */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] mr-0.5" style={{ color: TT.textMute }}>{t('trainerPlans.sets', 'Sets')}:</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                    className="min-w-[36px] min-h-[36px] rounded-lg text-[12px] flex items-center justify-center active:scale-95 transition-all" style={{ background: TT.surface, color: TT.textSub, border: `1px solid ${TT.border}` }}>&minus;</button>
                  <span className="text-[12px] font-medium w-5 text-center" style={{ color: TT.text }}>{ex.sets ?? DEFAULT_SETS}</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'sets', Math.min(10, (ex.sets ?? DEFAULT_SETS) + 1))}
                    className="min-w-[36px] min-h-[36px] rounded-lg text-[12px] flex items-center justify-center active:scale-95 transition-all" style={{ background: TT.surface, color: TT.textSub, border: `1px solid ${TT.border}` }}>+</button>
                </div>
                {/* Reps */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] mr-0.5" style={{ color: TT.textMute }}>{t('trainerPlans.reps', 'Reps')}:</span>
                  <input value={ex.reps ?? DEFAULT_REPS}
                    onChange={e => updateExercise(wk, di, ei, 'reps', e.target.value)}
                    className="w-16 rounded-lg px-2 py-1.5 text-[12px] text-center outline-none min-h-[36px]" style={{ background: TT.surface, color: TT.text, border: `1px solid ${TT.border}` }}
                    placeholder={t('trainerPlans.repsPlaceholder', '8-12')} />
                </div>
                {/* Rest */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] mr-0.5" style={{ color: TT.textMute }}>{t('trainerPlans.rest', 'Rest')}:</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', Math.max(0, (ex.rest_seconds ?? DEFAULT_REST) - 15))}
                    className="min-w-[36px] min-h-[36px] rounded-lg text-[12px] flex items-center justify-center active:scale-95 transition-all" style={{ background: TT.surface, color: TT.textSub, border: `1px solid ${TT.border}` }}>&minus;</button>
                  <span className="text-[12px] font-medium w-8 text-center" style={{ color: TT.text }}>{ex.rest_seconds ?? DEFAULT_REST}s</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', Math.min(600, (ex.rest_seconds ?? DEFAULT_REST) + 15))}
                    className="min-w-[36px] min-h-[36px] rounded-lg text-[12px] flex items-center justify-center active:scale-95 transition-all" style={{ background: TT.surface, color: TT.textSub, border: `1px solid ${TT.border}` }}>+</button>
                </div>
              </div>
              {/* Exercise notes - collapsible. Once visible it stays MOUNTED
                  until blur (expandedNotes pins it), so clearing the text
                  mid-edit no longer unmounts the textarea under the cursor. */}
              {expandedNotes[ei] || ex.notes ? (
                <textarea
                  value={ex.notes || ''}
                  onChange={e => updateExercise(wk, di, ei, 'notes', e.target.value)}
                  onFocus={() => setExpandedNotes(prev => ({ ...prev, [ei]: true }))}
                  onBlur={e => { if (!e.target.value.trim()) setExpandedNotes(prev => ({ ...prev, [ei]: false })); }}
                  maxLength={500}
                  rows={2}
                  placeholder={t('trainerPlans.trainerNotesPlaceholder', 'e.g., Tempo 3-1-2, pause at bottom')}
                  className="mt-2 w-full rounded-lg px-2.5 py-2 text-[16px] sm:text-[13px] outline-none resize-none transition-colors" style={{ background: TT.surface, color: TT.textSub, border: `1px solid ${TT.border}` }}
                />
              ) : (
                <button
                  onClick={() => toggleNote(ei)}
                  className="mt-2 flex items-center gap-1 text-[11px] transition-colors"
                  style={{ color: TT.textMute }}
                >
                  <StickyNote size={10} />
                  {t('trainerPlans.addNote', 'Add note')}
                </button>
              )}
            </div>
          ))}

          {/* Add exercise - searchable panel */}
          {showExSearch ? (
            <div className="mt-1 rounded-xl p-3" style={{ border: `1px solid ${TT.borderSolid}`, background: TT.surface2 }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold" style={{ color: TT.textSub }}>{t('trainerPlans.addExercise', 'Add Exercise')}</p>
                <button onClick={() => { setShowExSearch(false); setExSearch(''); }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2" style={{ color: TT.textMute }}>
                  <X size={14} />
                </button>
              </div>
              <ExerciseSearchPanel
                exercises={exercises}
                exSearch={exSearch}
                setExSearch={setExSearch}
                onAdd={(id) => { addExercise(wk, di, id); }}
                exLabel={exLabel}
                muscleLabelFor={muscleLabelFor}
                t={t}
              />
            </div>
          ) : (
            <button onClick={() => setShowExSearch(true)}
              className="w-full py-4 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-1 min-h-[44px] active:scale-[0.98]"
              style={{ borderColor: TT.borderSolid, color: TT.textMute }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = TT.accent; e.currentTarget.style.color = TT.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = TT.borderSolid; e.currentTarget.style.color = TT.textMute; }}>
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
const PlanBuilder = ({ plan, clients, onClose, onSaved, trainerId, gymId, t, showToast }) => {
  // Only a plan that exists in the DB is an edit. Fast-track templates pass a
  // pre-seeded plan-shaped object WITHOUT an id — that's still a CREATE
  // (otherwise save runs UPDATE … eq('id', undefined) and the client select
  // stays disabled with nothing selected).
  const isEdit = !!plan?.id;
  const init = plan || {};
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith('es');
  const [clientId, setClientId]     = useState(init.client_id || '');
  const [name, setName]             = useState(init.name ?? '');
  const [description, setDesc]      = useState(init.description ?? '');
  const [durationWeeks, setDuration]= useState(init.duration_weeks ?? 4);
  const PRESET_DURATIONS = [4, 6, 8, 10, 12];
  const isCustomDuration = !PRESET_DURATIONS.includes(durationWeeks);
  const setCustomDuration = (raw) => {
    const v = parseInt(raw, 10);
    if (!isNaN(v)) setDuration(Math.max(1, Math.min(52, v)));
  };
  const [weeks, setWeeks]           = useState(() => normalizeWeeks(init.weeks, t));
  const [exercises, setExercises]   = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [copyWeekMenu, setCopyWeekMenu]   = useState(null);
  const [copyDayMenu, setCopyDayMenu]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [isDraftSave, setIsDraftSave] = useState(init.is_draft ?? false);
  const [error, setError]           = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clientProfile, setClientProfile] = useState(null);
  const [confirmPrune, setConfirmPrune] = useState(null); // { prunedWeeks } pending save
  const [confirmDiscard, setConfirmDiscard] = useState(false); // unsaved-changes guard
  // Editing a plan whose client was deactivated: the active-clients list no
  // longer contains them, so the (disabled) select showed "Select client...".
  // Keep the assigned name around for display.
  const [assignedClientName, setAssignedClientName] = useState(init.profiles?.full_name || '');
  // Trainer overrides for auto-generation
  const [overrideDays, setOverrideDays] = useState(null); // null = use client's
  const [overrideMuscles, setOverrideMuscles] = useState([]); // empty = use client's
  const ALL_MUSCLES_KEYS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core', 'glutes'];
  const muscleLabel = (key) => t(`trainerPlans.muscle_${key}`, key.charAt(0).toUpperCase() + key.slice(1));
  const toggleMuscle = (m) => setOverrideMuscles(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  // Localized exercise + muscle-group labels (member side already does this;
  // the trainer builder was English-only — P2-13).
  const exLabel = useCallback((ex) => (isEs && ex?.name_es ? ex.name_es : ex?.name), [isEs]);
  const muscleLabelFor = useCallback(
    (group) => (group ? t(`muscleGroups.${group}`, group) : ''),
    [t],
  );

  // Snapshot of what the builder opened with — compared on back-arrow to
  // warn before discarding unsaved work.
  const initialSnapshot = useRef(null);
  if (initialSnapshot.current === null) {
    initialSnapshot.current = JSON.stringify({
      clientId: init.client_id || '',
      name: init.name ?? '',
      description: init.description ?? '',
      durationWeeks: init.duration_weeks ?? 4,
      weeks: normalizeWeeks(init.weeks, t),
    });
  }
  const isDirty = () => initialSnapshot.current !== JSON.stringify({ clientId, name, description, durationWeeks, weeks });
  const handleBack = () => {
    if (isDirty()) { setConfirmDiscard(true); return; }
    onClose();
  };

  useEffect(() => {
    // exercises table can exceed 1000 rows — paginate to get all of them
    selectAllRows((from, to) =>
      supabase.from('exercises').select('id, name, name_es, muscle_group, equipment').order('name').range(from, to),
    ).then(({ data, error }) => {
      if (error) console.error('[TrainerPlans] Failed to load exercises:', error);
      setExercises(data || []);
    }).catch(err => console.error('[TrainerPlans] Failed to load exercises:', err));
  }, []);

  // Shrinking the duration leaves the selected week out of range — clamp it.
  useEffect(() => {
    if (selectedWeek > durationWeeks) setSelectedWeek(durationWeeks);
  }, [durationWeeks, selectedWeek]);

  // Resolve the assigned client's name even when they're no longer in the
  // active-clients list (deactivated client — the select is disabled on edit
  // and used to fall back to the "Select client..." placeholder).
  useEffect(() => {
    if (!isEdit || !clientId) return;
    if (clients.some(c => c.id === clientId)) return;
    if (assignedClientName) return;
    supabase.from('profiles').select('full_name').eq('id', clientId).maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.error('[TrainerPlans] Failed to load assigned client name:', error); return; }
        if (data?.full_name) setAssignedClientName(data.full_name);
      });
  }, [isEdit, clientId, clients, assignedClientName]);

  // Fetch client profile when client changes
  useEffect(() => {
    if (!clientId) { setClientProfile(null); return; }
    (async () => {
      try {
        const { data: ob } = await supabase
          .from('member_onboarding')
          .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes, priority_muscles, sex, gender, age, height_inches, height_cm, weight_kg, workout_duration_min')
          .eq('profile_id', clientId)
          .maybeSingle();
        // Active goals = not yet achieved (there is no is_completed column).
        const { data: goals, error: goalsErr } = await supabase
          .from('member_goals')
          .select('goal_type, exercise_id, target_value, current_value')
          .eq('profile_id', clientId)
          .is('achieved_at', null);
        if (goalsErr) console.error('[TrainerPlans] Failed to load client goals:', goalsErr);
        setClientProfile({ onboarding: ob, goals: goals || [] });
      } catch (err) {
        console.error('[TrainerPlans] Failed to load client profile:', err);
      }
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
            .is('achieved_at', null),
        ]);
        if (goalsRes.error) console.error('[TrainerPlans] Failed to load client goals:', goalsRes.error);
        onb = obRes.data;
        goals = goalsRes.data;
      }
      if (!onb) { setError(t('trainerPlans.noOnboardingData', 'Client has no onboarding data.')); setGenerating(false); return; }

      // Apply trainer overrides
      const onbWithOverrides = { ...onb };
      // Normalize toward the columns the app actually writes (`sex`,
      // `height_inches`) — the legacy gender/height_cm columns exist but are
      // often NULL, which silently degrades the generator's personalization.
      if (onbWithOverrides.sex && !onbWithOverrides.gender) onbWithOverrides.gender = onbWithOverrides.sex;
      if (!onbWithOverrides.height_cm && onbWithOverrides.height_inches) onbWithOverrides.height_cm = onbWithOverrides.height_inches * 2.54;
      if (overrideDays) onbWithOverrides.training_days_per_week = overrideDays;
      if (overrideMuscles.length > 0) onbWithOverrides.priority_muscles = overrideMuscles.map(m => m.charAt(0).toUpperCase() + m.slice(1));

      const result = generateProgram(onbWithOverrides, goals || []);
      const clientName = clients.find(c => c.id === clientId)?.full_name || '';

      // Map generator output → plan weeks format.
      // Day names use the SAME creative pool as the member generator (Apex Build,
      // Iron Frame, …) instead of "Upper A / Lower B", localized to the current
      // language and with NO "Auto:" prefix — the client shouldn't see that the
      // plan was machine-generated. Cardio/rest days (no slotsKey) keep their
      // themed name. Variant B's name index is bumped past the half-pool so the
      // A/B weeks pull different names.
      const nameSeed = result.seed || Math.floor(Math.random() * 100000);
      const mapRoutine = (routine, isVariantB) => routine.map(day => ({
        name: day.slotsKey
          ? translateCreativeName(generateRoutineName(day.slotsKey, (day.variantIndex || 0) + (isVariantB ? 5 : 0), nameSeed))
          : (day.name || day.label || t('trainerPlans.dayPrefix', 'Day {{num}}', { num: '' }).trim()),
        exercises: (day.exercises || []).map(ex => ({
          id: ex.exerciseId || ex.id,
          sets: ex.sets ?? DEFAULT_SETS,
          reps: ex.reps ?? DEFAULT_REPS,
          rest_seconds: ex.restSeconds ?? DEFAULT_REST,
          notes: '',
        })),
      }));

      const routinesA = mapRoutine(result.routinesA || [], false);
      const routinesB = mapRoutine(result.routinesB || [], true);
      const newWeeks = {};
      const newDuration = Math.max(durationWeeks, 4);
      for (let wk = 1; wk <= newDuration; wk++) {
        newWeeks[wk] = JSON.parse(JSON.stringify(wk % 2 === 1 ? routinesA : routinesB));
      }

      setWeeks(newWeeks);
      setDuration(newDuration);
      // Clean, client-facing name — no "Auto:" prefix.
      const splitLabel = result.splitLabel || t('trainerPlans.programFallback', 'Program');
      setName(clientName ? `${splitLabel} — ${clientName}` : splitLabel);
      setDesc(t('trainerPlans.autoDescTemplate', '{{split}} split, {{goal}} goal, {{level}} level', { split: result.split, goal: onb.primary_goal || 'general', level: onb.fitness_level || 'intermediate' }));
      setSelectedWeek(1);
    } catch (err) {
      setError(err.message || t('trainerPlans.failedToGenerate', 'Failed to generate plan'));
    } finally {
      setGenerating(false);
    }
  };

  const exName = (id) => {
    const ex = exercises.find(e => e.id === id);
    return ex ? exLabel(ex) : id;
  };

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
  const moveExercise = (wk, di, ei, dir) => setWeeks(prev => {
    const days = prev[wk] || [];
    const exs = [...(days[di]?.exercises || [])];
    const target = ei + dir;
    if (target < 0 || target >= exs.length) return prev;
    [exs[ei], exs[target]] = [exs[target], exs[ei]];
    return { ...prev, [wk]: days.map((d, i) => i === di ? { ...d, exercises: exs } : d) };
  });

  // Save. Weeks beyond the chosen duration are PRUNED from the JSON (an
  // 8→4-week shrink used to keep orphan keys 5-8, corrupting counts/chips).
  // If pruned weeks contain exercises we confirm first.
  const buildWeeksPayload = () => {
    const kept = {};
    Object.entries(weeks).forEach(([wk, days]) => {
      if (Number(wk) <= durationWeeks) kept[wk] = days;
    });
    return kept;
  };

  // Client is OPTIONAL — a plan with no client is a generic template/draft.
  const handleSave = (opts = {}) => {
    const draft = !!opts.draft;
    setIsDraftSave(draft);
    if (!name.trim()) { setError(t('trainerPlans.nameRequired', 'Plan name is required.')); return; }
    const prunedWithContent = Object.entries(weeks)
      .filter(([wk, days]) => Number(wk) > durationWeeks
        && (days || []).some(d => (d.exercises || []).length > 0))
      .map(([wk]) => Number(wk))
      .sort((a, b) => a - b);
    if (prunedWithContent.length > 0) {
      setConfirmPrune({ prunedWeeks: prunedWithContent });
      return;
    }
    doSave(draft);
  };

  const doSave = async (draftArg) => {
    // Called directly and from the prune dialog (which passes no boolean) —
    // fall back to the intent captured in handleSave.
    const draft = typeof draftArg === 'boolean' ? draftArg : isDraftSave;
    setConfirmPrune(null);
    setSaving(true);
    setError('');
    try {
      const payload = {
        gym_id: gymId,
        trainer_id: trainerId,
        client_id: clientId || null,
        name: name.trim(),
        description: description.trim(),
        duration_weeks: durationWeeks,
        weeks: buildWeeksPayload(),
        is_draft: draft,
        // A draft is never an active assignment; published plans keep their state.
        is_active: draft ? false : (plan?.is_active ?? true),
        updated_at: new Date().toISOString(),
      };
      const { error: err } = isEdit
        ? await supabase.from('trainer_workout_plans').update(payload).eq('id', plan.id)
        : await supabase.from('trainer_workout_plans').insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
      if (!isEdit) posthog?.capture('trainer_plan_created');
      onSaved();
    } catch (err) {
      console.error('[TrainerPlans] handleSave error:', err);
      const msg = t('trainerPlans.failedToSavePlan', 'Failed to save plan');
      setError(msg);
      showToast?.(msg, 'error');
      setSaving(false);
    }
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
    <div className="min-h-screen overflow-x-hidden" style={{ background: TT.bg }} onClick={closeMenus}>
      {/* ── Sticky top header ── */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl" style={{ background: 'color-mix(in srgb, var(--tt-bg) 92%, transparent)', borderBottom: `1px solid ${TT.border}` }}>
        {/* Row 1: Back + Name + Actions */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pt-3 pb-2 flex items-center gap-2 md:gap-3">
          <button onClick={handleBack}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-colors flex-shrink-0"
            style={{ background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.background = TT.surface2; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            aria-label={t('trainerPlans.backToList', 'Back to plans')}>
            <ArrowLeft size={20} style={{ color: TT.textSub }} />
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('trainerPlans.planNamePlaceholder', 'Plan name...')}
              className="w-full bg-transparent text-[18px] font-bold outline-none truncate"
              style={{ color: TT.text }}
            />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => handleSave({ draft: true })} disabled={saving || !name?.trim()}
              className="px-3 py-2.5 rounded-xl font-bold text-[13px] disabled:opacity-50 transition-colors whitespace-nowrap min-h-[44px]"
              style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
              {t('trainerPlans.saveDraft', 'Draft')}
            </button>
            <button onClick={() => handleSave()} disabled={saving || !name?.trim()}
              className="px-4 py-2.5 rounded-xl font-bold text-[13px] disabled:opacity-50 transition-colors whitespace-nowrap min-h-[44px]"
              style={{ backgroundColor: TT.accent, color: '#06363B' }}>
              {saving ? t('trainerPlans.saving', 'Saving...') : isEdit ? t('trainerPlans.saveChanges', 'Save') : t('trainerPlans.createPlan', 'Create')}
            </button>
          </div>
        </div>

        {/* Row 2: Client selector + Status + Auto-generate */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pb-2 flex items-center gap-2 flex-wrap">
          <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={isEdit}
            className="bg-transparent text-[13px] outline-none disabled:opacity-60 max-w-[200px] sm:max-w-[180px] truncate cursor-pointer py-2 min-h-[44px]"
            style={{ color: TT.textSub }}>
            <option value="">{t('trainerPlans.noClientGeneric', 'No client (generic plan)')}</option>
            {/* Assigned client no longer in the active list (deactivated) —
                keep an option so the select shows their name, not the
                placeholder. The select is disabled on edit anyway. */}
            {clientId && !clients.some(c => c.id === clientId) && (
              <option value={clientId}>
                {(assignedClientName || t('trainerPlans.formerClient', 'Former client'))}{` ${t('trainerPlans.clientInactiveSuffix', '(inactive)')}`}
              </option>
            )}
            {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
            style={isDraftSave
              ? { background: TT.warnSoft, color: TT.warnInk }
              : (plan?.is_active ?? true)
                ? { background: TT.goodSoft, color: TT.goodInk }
                : { background: TT.surface2, color: TT.textMute }}>
            {isDraftSave ? t('trainerPlans.draft', 'Draft') : (plan?.is_active ?? true) ? t('trainerPlans.active', 'Active') : t('trainerPlans.inactive', 'Inactive')}
          </span>
          <div className="flex-1" />
          {clientId && clientProfile?.onboarding && (
            <button onClick={handleAutoGenerate} disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-[11px] transition-colors whitespace-nowrap disabled:opacity-40"
              style={{ backgroundColor: TT.accentSoft, color: TT.accentInk }}>
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
                style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
            </div>
          )}
        </div>

        {error && (
          <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pb-2">
            <p className="text-[12px] rounded-lg px-3 py-2" style={{ color: TT.hot, background: TT.hotSoft }}>{error}</p>
          </div>
        )}
      </div>

      {/* ── Client Profile + Duration + Week Nav (scrollable content) ── */}
      <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pt-4">
        {/* Client context + Generation overrides */}
        {clientProfile?.onboarding && (
          <div className="mb-4 rounded-2xl p-4" style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: TT.accent }}>
                {t('trainerPlans.clientProfile', 'Client Profile')}
              </p>
              <button onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-[10px] font-medium transition-colors"
                style={{ color: TT.textMute }}>
                <FileText size={10} />
                {showDetails ? t('trainerPlans.hideNotes', 'Hide notes') : t('trainerPlans.addNotes', 'Add notes')}
              </button>
            </div>
            {/* Compact client info */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] mb-3">
              <span><span style={{ color: TT.textMute }}>{t('trainerPlans.level', 'Level')}:</span> <span className="font-semibold capitalize" style={{ color: TT.text }}>{clientProfile.onboarding.fitness_level || '—'}</span></span>
              <span><span style={{ color: TT.textMute }}>{t('trainerPlans.goal', 'Goal')}:</span> <span className="font-semibold capitalize" style={{ color: TT.text }}>{clientProfile.onboarding.primary_goal ? t(`trainerNotes.goals.${clientProfile.onboarding.primary_goal}`, clientProfile.onboarding.primary_goal.replace(/_/g, ' ')) : '—'}</span></span>
              {clientProfile.onboarding.injuries_notes && (
                <span><span style={{ color: TT.textMute }}>{t('trainerPlans.injuries', 'Injuries')}:</span> <span className="font-semibold" style={{ color: TT.hot }}>{clientProfile.onboarding.injuries_notes}</span></span>
              )}
            </div>
            {/* Equipment + goals tags */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {clientProfile.onboarding.available_equipment?.map(eq => (
                <span key={eq} className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: TT.surface2, color: TT.textMute }}>{eq}</span>
              ))}
              {clientProfile.goals.map((g, i) => (
                <span key={`g${i}`} className="px-2 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: TT.accentSoft, color: TT.accentInk }}>
                  {t(`trainerNotes.goals.${g.goal_type}`, g.goal_type.replace(/_/g, ' '))}{g.target_value ? ` → ${g.target_value}` : ''}
                </span>
              ))}
            </div>

            {/* ── Trainer overrides for auto-generation ── */}
            <div className="pt-3" style={{ borderTop: `1px solid ${TT.border}` }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: TT.textMute }}>
                {t('trainerPlans.generateSettings', 'Generation Settings')}
              </p>

              {/* Days per week override */}
              <div className="mb-3">
                <p className="text-[11px] font-medium mb-1.5" style={{ color: TT.textMute }}>
                  {t('trainerPlans.daysPerWeek', 'Days per week')}
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {[2, 3, 4, 5, 6].map(d => {
                    const clientDays = clientProfile.onboarding.training_days_per_week;
                    const isActive = overrideDays ? overrideDays === d : clientDays === d;
                    const isClientDefault = !overrideDays && clientDays === d;
                    return (
                      <button key={d} onClick={() => setOverrideDays(d === clientDays ? null : d)}
                        className="px-3 py-2 rounded-lg text-[12px] font-semibold transition-all min-h-[44px] min-w-[44px] relative"
                        style={isActive
                          ? { backgroundColor: TT.accent, color: '#06363B' }
                          : { backgroundColor: TT.surface2, color: TT.textMute }
                        }>
                        {d}
                        {isClientDefault && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full" style={{ background: TT.good }} title={t('trainerPlans.clientPreference', "Client's preference")} />}
                      </button>
                    );
                  })}
                  {overrideDays && (
                    <button onClick={() => setOverrideDays(null)}
                      className="px-3 py-2 rounded-lg text-[11px] font-medium transition-colors min-h-[44px]"
                      style={{ color: TT.textMute }}>
                      {t('trainerPlans.reset', 'Reset')}
                    </button>
                  )}
                </div>
              </div>

              {/* Target muscles override */}
              <div>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: TT.textMute }}>
                  {t('trainerPlans.targetMuscles', 'Focus muscles')} <span className="opacity-50">({t('trainerPlans.optional', 'optional')})</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_MUSCLES_KEYS.map(m => {
                    const isSelected = overrideMuscles.includes(m);
                    const isClientPriority = clientProfile.onboarding.priority_muscles?.map(p => p.toLowerCase()).includes(m);
                    return (
                      <button key={m} onClick={() => toggleMuscle(m)}
                        className="px-3 py-2 rounded-lg text-[11px] font-semibold transition-all relative min-h-[44px]"
                        style={isSelected
                          ? { backgroundColor: TT.good, color: '#fff' }
                          : { backgroundColor: TT.surface2, color: TT.textMute }
                        }>
                        {muscleLabel(m)}
                        {isClientPriority && !isSelected && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full" style={{ background: TT.good }} title={t('trainerPlans.clientPriority', "Client's priority")} />}
                      </button>
                    );
                  })}
                  {overrideMuscles.length > 0 && (
                    <button onClick={() => setOverrideMuscles([])}
                      className="px-3 py-2 rounded-lg text-[11px] font-medium transition-colors min-h-[44px]"
                      style={{ color: TT.textMute }}>
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
            <p className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: TT.textMute }}>{t('trainerPlans.duration', 'Duration')}</p>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_DURATIONS.map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className="px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors min-h-[44px] min-w-[44px]"
                  style={durationWeeks === w
                    ? { backgroundColor: TT.accent, color: '#06363B' }
                    : { backgroundColor: TT.surface2, color: TT.textMute }
                  }>
                  {w}{t('trainerPlans.wSuffix', 'w')}
                </button>
              ))}
              {/* Custom weeks — uneven counts, 12+ */}
              <div className="flex items-center gap-1 px-2.5 rounded-lg min-h-[44px]"
                style={isCustomDuration ? { backgroundColor: TT.accent } : { backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                <input type="number" inputMode="numeric" min={1} max={52} value={durationWeeks}
                  onChange={e => setCustomDuration(e.target.value)}
                  aria-label={t('trainerPlans.customWeeks', 'Custom weeks')}
                  className="w-9 bg-transparent text-center text-[12px] font-semibold outline-none"
                  style={{ color: isCustomDuration ? '#06363B' : TT.text }} />
                <span className="text-[11px] font-semibold" style={{ color: isCustomDuration ? '#06363B' : TT.textMute }}>{t('trainerPlans.wSuffix', 'w')}</span>
              </div>
            </div>
          </div>
          {/* Week horizontal scroller */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
            {allWeekNums.map(wk => {
              const stats = weekStats(wk);
              return (
                <button key={wk} onClick={() => setSelectedWeek(wk)}
                  className="shrink-0 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all min-h-[44px]"
                  style={selectedWeek === wk
                    ? { backgroundColor: TT.accent, color: '#06363B', boxShadow: TT.shadow }
                    : { backgroundColor: TT.surface2, color: TT.textMute, border: `1px solid ${TT.border}` }
                  }>
                  {t('trainerPlans.weekAbbrev', 'Wk')} {wk}
                  <span className="text-[10px] ml-1 opacity-70">({stats.dayCount}{t('trainerPlans.dShort', 'd')} · {stats.exCount}{t('trainerPlans.exShort', 'ex')})</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main content: 2 col desktop, 1 col mobile ── */}
      <div className="max-w-[480px] mx-auto md:max-w-5xl md:flex md:min-h-[calc(100vh-140px)] pb-24 md:pb-0">
        {/* ── Left rail (desktop only) ── */}
        <div className="hidden md:block w-64 flex-shrink-0 sticky top-[140px] self-start max-h-[calc(100vh-140px)] overflow-y-auto" style={{ borderRight: `1px solid ${TT.border}`, background: TT.surface2 }}>
          <div className="p-4 space-y-4">
            {/* Duration selector */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: TT.textMute }}>{t('trainerPlans.duration', 'Duration')}</p>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_DURATIONS.map(w => {
                  const active = durationWeeks === w;
                  return (
                    <button key={w} onClick={() => setDuration(w)}
                      className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors min-h-[44px]"
                      style={active
                        ? { background: TT.accentSoft, color: TT.accentInk }
                        : { background: TT.surface, color: TT.textMute, border: `1px solid ${TT.border}` }}>
                      {w}{t('trainerPlans.wSuffix', 'w')}
                    </button>
                  );
                })}
                {/* Custom weeks — uneven counts, 12+ */}
                <div className="flex items-center gap-1 px-2 rounded-xl min-h-[44px]"
                  style={isCustomDuration ? { background: TT.accentSoft, border: `1px solid ${TT.accent}` } : { background: TT.surface, border: `1px solid ${TT.border}` }}>
                  <input type="number" inputMode="numeric" min={1} max={52} value={durationWeeks}
                    onChange={e => setCustomDuration(e.target.value)}
                    aria-label={t('trainerPlans.customWeeks', 'Custom weeks')}
                    className="w-9 bg-transparent text-center text-[12px] font-semibold outline-none"
                    style={{ color: isCustomDuration ? TT.accentInk : TT.text }} />
                  <span className="text-[11px] font-semibold" style={{ color: isCustomDuration ? TT.accentInk : TT.textMute }}>{t('trainerPlans.wSuffix', 'w')}</span>
                </div>
              </div>
            </div>

            {/* Week list */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: TT.textMute }}>{t('trainerPlans.weeks', 'Weeks')}</p>
              <div className="space-y-1">
                {allWeekNums.map(wk => {
                  const stats = weekStats(wk);
                  const isActive = selectedWeek === wk;
                  return (
                    <div key={wk} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedWeek(wk)}
                        className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors min-h-[44px]"
                        style={isActive
                          ? { background: TT.accentSoft, color: TT.accentInk, borderLeft: `2px solid ${TT.accent}` }
                          : { color: TT.textSub, borderLeft: '2px solid transparent' }}
                      >
                        <Calendar size={13} style={{ color: isActive ? TT.accent : TT.textMute }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium">{t('trainerPlans.weekLabel', 'Week')} {wk}</p>
                          <p className="text-[10px]" style={{ color: TT.textMute }}>{stats.dayCount} {t('trainerPlans.daysAbbrev', 'days')} · {stats.exCount} {t('trainerPlans.ex', 'ex')}</p>
                        </div>
                      </button>
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyWeekMenu(copyWeekMenu === wk ? null : wk); setCopyDayMenu(null); }}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg transition-colors" style={{ color: TT.textMute }}
                          title={t('trainerPlans.copyWeek', 'Copy week')}>
                          <Copy size={11} />
                        </button>
                        {copyWeekMenu === wk && (
                          <div className="absolute left-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[140px]" style={{ background: TT.bgElev, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
                            <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-2 pb-1" style={{ color: TT.textMute }}>
                              {t('trainerPlans.copyWkTo', 'Copy Wk {{wk}} to...', { wk })}
                            </p>
                            {allWeekNums.filter(w => w !== wk).map(targetWk => (
                              <button key={targetWk} onClick={() => copyWeekTo(wk, targetWk)}
                                className="w-full text-left px-3 py-2 text-[12px] transition-colors min-h-[44px] flex items-center" style={{ color: TT.text }}
                                onMouseEnter={e => { e.currentTarget.style.background = TT.surface2; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                                {t('trainerPlans.weekLabel', 'Week')} {targetWk}
                                {(weeks[targetWk] || []).length > 0 && <span className="ml-1" style={{ color: TT.textMute }}>({t('trainerPlans.overwrite', 'overwrite')})</span>}
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
              <h2 className="text-[16px] font-bold truncate" style={{ color: TT.text }}>{t('trainerPlans.weekLabel', 'Week')} {selectedWeek}</h2>
              <span className="text-[12px]" style={{ color: TT.textMute }}>
                {currentDays.length} {t('trainerPlans.daysAbbrev', 'days')}
              </span>
            </div>
            {/* Mobile copy week */}
            <div className="relative md:hidden" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => { setCopyWeekMenu(showCopyWeek ? null : selectedWeek); setCopyDayMenu(null); }}
                className="flex items-center gap-1 text-[12px] font-semibold px-3 py-2 rounded-xl transition-colors min-h-[44px]" style={{ color: TT.textMute }}>
                <Copy size={12} /> {t('trainerPlans.copy', 'Copy')}
              </button>
              {showCopyWeek && (
                <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[140px]" style={{ background: TT.bgElev, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-2 pb-1" style={{ color: TT.textMute }}>
                    {t('trainerPlans.copyWkTo', 'Copy Wk {{wk}} to...', { wk: selectedWeek })}
                  </p>
                  {allWeekNums.filter(w => w !== selectedWeek).map(targetWk => (
                    <button key={targetWk} onClick={() => copyWeekTo(selectedWeek, targetWk)}
                      className="w-full text-left px-3 py-2 text-[12px] transition-colors min-h-[44px] flex items-center" style={{ color: TT.text }}
                      onMouseEnter={e => { e.currentTarget.style.background = TT.surface2; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      {t('trainerPlans.weekLabel', 'Week')} {targetWk}
                      {(weeks[targetWk] || []).length > 0 && <span className="ml-1" style={{ color: TT.textMute }}>({t('trainerPlans.overwrite', 'overwrite')})</span>}
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
                <ClipboardList size={28} className="mx-auto mb-2" style={{ color: TT.textFaint }} />
                <p className="text-[13px] mb-4" style={{ color: TT.textMute }}>{t('trainerPlans.noDaysYet', 'No days yet — add one below')}</p>
                {clientId && (
                  <button
                    onClick={handleAutoGenerate}
                    disabled={generating}
                    className="inline-flex items-center gap-2 px-5 py-2.5 font-semibold text-[13px] rounded-xl transition-colors min-h-[44px] disabled:opacity-40"
                    style={{ background: TT.accentSoft, border: `1px solid ${TT.accent}`, color: TT.accentInk }}
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
                exLabel={exLabel}
                muscleLabelFor={muscleLabelFor}
                updateDayName={updateDayName}
                removeDay={removeDay}
                addExercise={addExercise}
                removeExercise={removeExercise}
                updateExercise={updateExercise}
                moveExercise={moveExercise}
                copyDayMenu={copyDayMenu}
                setCopyDayMenu={setCopyDayMenu}
                setCopyWeekMenu={setCopyWeekMenu}
                allDayTargets={allDayTargets}
                copyDayTo={copyDayTo}
                t={t}
              />
            ))}

            <button onClick={() => addDay(selectedWeek)}
              className="w-full py-3 text-[13px] font-semibold rounded-2xl transition-colors min-h-[44px] flex items-center justify-center gap-1.5"
              style={{ color: TT.accentInk, border: `1px solid ${TT.accent}`, background: TT.accentSoft }}>
              <Plus size={15} /> {t('trainerPlans.addDay', 'Add Day')}
            </button>
          </div>
        </div>
      </div>

      {/* Prune-weeks confirmation (duration shrunk below weeks with content) */}
      {confirmPrune && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" onClick={e => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmPrune(null)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
              {t('trainerPlans.prunedWeeksTitle', 'Remove weeks {{weeks}}?', { weeks: confirmPrune.prunedWeeks.join(', ') })}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.prunedWeeksBody', 'The plan is now {{duration}} weeks, but later weeks still have exercises. Saving will delete them.', { duration: durationWeeks })}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setConfirmPrune(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {t('trainerPlans.cancel', 'Cancel')}
              </button>
              <button onClick={() => doSave()}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                style={{ background: TT.hotSoft, color: TT.hot }}>
                {t('trainerPlans.prunedWeeksConfirm', 'Save and remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-changes guard (back arrow while dirty) */}
      {confirmDiscard && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" onClick={e => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDiscard(false)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
              {t('trainerPlans.discardChangesTitle', 'Discard changes?')}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.discardChangesBody', 'You have unsaved changes in this plan. Leaving now will lose them.')}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setConfirmDiscard(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {t('trainerPlans.keepEditing', 'Keep editing')}
              </button>
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                style={{ background: TT.hotSoft, color: TT.hot }}>
                {t('trainerPlans.discardConfirm', 'Discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function TrainerPlans() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { showToast } = useToast();
  const dateFnsLocale = i18n.language?.startsWith('es') ? esLocale : enLocale;

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
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(null);
  // Duplicate-for-client picker (a straight duplicate locked the copy to the
  // original client, making duplicate-for-another-client impossible)
  const [duplicateTarget, setDuplicateTarget] = useState(null); // plan being duplicated
  const [duplicateClientId, setDuplicateClientId] = useState('');
  const [duplicating, setDuplicating] = useState(false);

  // Nutrition plans state
  const [mealPlans, setMealPlans] = useState([]);
  const [mealPlansLoading, setMealPlansLoading] = useState(true);
  const [mealFilterStatus, setMealFilterStatus] = useState('active');
  const [showMealModal, setShowMealModal] = useState(false);
  const [mealForm, setMealForm] = useState({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '', duration_weeks: 4 });
  const [mealSaving, setMealSaving] = useState(false);
  const [mealClientProfile, setMealClientProfile] = useState(null);
  const [mealGoalOverride, setMealGoalOverride] = useState(null);
  // Saved meal-plan detail viewer (tap a card → day-by-day meals)
  const [mealDetail, setMealDetail] = useState(null);
  const [mealDetailDay, setMealDetailDay] = useState(0);
  const [confirmDeleteMealPlan, setConfirmDeleteMealPlan] = useState(null);
  const GOAL_OPTIONS = ['fat_loss', 'muscle_gain', 'strength', 'endurance', 'general_fitness'];

  // Fetch client data when meal form client changes
  useEffect(() => {
    const cid = mealForm.client_id;
    if (!cid) { setMealClientProfile(null); setMealGoalOverride(null); return; }
    (async () => {
      const [obRes, weightRes] = await Promise.all([
        supabase.from('member_onboarding')
          .select('fitness_level, primary_goal, training_days_per_week, height_cm, height_inches, weight_kg, age, gender, sex')
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
  const DAY_LABELS = [
    t('trainerPlans.dayMon', 'Mon'), t('trainerPlans.dayTue', 'Tue'), t('trainerPlans.dayWed', 'Wed'),
    t('trainerPlans.dayThu', 'Thu'), t('trainerPlans.dayFri', 'Fri'), t('trainerPlans.daySat', 'Sat'), t('trainerPlans.daySun', 'Sun'),
  ];

  const MEAL_SLOTS = [
    { type: 'breakfast', time: '07:00', label: t('trainerPlans.mealBreakfast', 'Breakfast'), color: '#F97316' },
    { type: 'lunch', time: '12:00', label: t('trainerPlans.mealLunch', 'Lunch'), color: '#EAB308' },
    { type: 'snack', time: '15:30', label: t('trainerPlans.mealSnack', 'Snack'), color: '#34D399' },
    { type: 'dinner', time: '19:00', label: t('trainerPlans.mealDinner', 'Dinner'), color: '#8B5CF6' },
  ];

  // Saved meal-plan rows keep only compact meal JSON (no image); recover the
  // full record (image, titles) from the local MEALS catalog by id.
  const mealById = useMemo(() => new Map(MEALS.map(m => [m.id, m])), []);

  const handleGenerateMeals = () => {
    const cal = parseInt(mealForm.target_calories);
    const pro = parseInt(mealForm.target_protein_g);
    const carb = parseInt(mealForm.target_carbs_g);
    const fat = parseInt(mealForm.target_fat_g);
    if (!cal || !pro) return;
    setGeneratingMeals(true);
    setTimeout(() => {
      try {
        // 4 slots to match this view's breakfast/lunch/snack/dinner rows —
        // the generator fills each with slot-appropriate dishes (no more
        // salmon labeled 07:00) and the old 3-meal output left the dinner
        // row permanently empty here.
        const plan = generateWeekPlan({
          targets: { calories: cal, protein: pro, carbs: carb || 200, fat: fat || 60 },
          slots: 4,
          lang: i18n?.language || 'en',
        });
        // Slot type comes from the generator's tag; index fallback for safety.
        const enriched = plan.map(day => ({
          ...day,
          meals: (day.meals || []).map((meal, mi) => ({
            ...meal,
            slotType: meal.slot || MEAL_SLOTS[mi]?.type || 'snack',
          })),
        }));
        setGeneratedMeals(enriched);
        setMealsDirty(false); // fresh generation — nothing manual to protect
        setMealStep('meals');
        setMealPreviewDay(0);
      } catch (err) {
        logger.error('TrainerPlans: meal generation failed:', err);
        showToast(t('trainerPlans.generateMealsFailed', 'Could not generate the meal plan. Try again.'), 'error');
      } finally {
        // Always clear the spinner — a throw used to leave it stuck on "Generating…".
        setGeneratingMeals(false);
      }
    }, 50);
  };

  const dayTargets = () => ({
    calories: parseInt(mealForm.target_calories) || 2000,
    protein: parseInt(mealForm.target_protein_g) || 150,
    carbs: parseInt(mealForm.target_carbs_g) || 200,
    fat: parseInt(mealForm.target_fat_g) || 60,
  });

  const swapMeal = (dayIdx, mealIdx) => {
    const day = generatedMeals[dayIdx];
    if (!day) return;
    const slotType = day.meals[mealIdx]?.slotType || 'lunch';
    const targets = dayTargets();
    // Budget the slot with the generator's realistic meal-time shares
    // (breakfast 28% / lunch 34% / dinner 38% / snack 14%, normalized over
    // the day's slots) instead of a flat 1/n split that over-fed snacks.
    const share = slotShareOf(slotType, day.meals);
    const slotBudget = {
      calories: Math.round(targets.calories * share),
      protein: Math.round(targets.protein * share),
      carbs: Math.round(targets.carbs * share),
      fat: Math.round(targets.fat * share),
    };
    // Exclude every meal used anywhere in the WEEK (not just this day) so a
    // swap can't reintroduce Tuesday's lunch on Thursday.
    const excludeIds = generatedMeals.flatMap((d, di) =>
      (d.meals || []).filter((m, mi) => !(di === dayIdx && mi === mealIdx)).map(m => m.id));
    const replacement = generateDayPlan({
      targets: slotBudget,
      slots: 1,
      // Replacement must fit the slot being swapped (breakfast stays breakfast)
      slotTypes: [slotType],
      excludeIds,
    });
    if (replacement.meals[0]) {
      setMealsDirty(true);
      setGeneratedMeals(prev => prev.map((d, di) => {
        if (di !== dayIdx) return d;
        const newMeals = d.meals.map((m, mi) => mi !== mealIdx ? m : {
          ...replacement.meals[0],
          slotType: m.slotType,
        });
        const totals = {
          calories: newMeals.reduce((s, m) => s + (m.calories || 0), 0),
          protein: newMeals.reduce((s, m) => s + (m.protein || 0), 0),
          carbs: newMeals.reduce((s, m) => s + (m.carbs || 0), 0),
          fat: newMeals.reduce((s, m) => s + (m.fat || 0), 0),
        };
        return { ...d, meals: newMeals, totals, fits: computeDayFits(totals, targets) };
      }));
    }
  };

  // Manual meal picker state
  const [mealPickerSlot, setMealPickerSlot] = useState(null); // { dayIdx, mealIdx } or null
  const [mealSearch, setMealSearch] = useState('');
  // Trainer's private custom meals (custom_meals table) — usable in plans and
  // visible only to the trainer (+ super-admin). Map DB rows to the meal shape.
  const [customMeals, setCustomMeals] = useState([]);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [newMeal, setNewMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '' });
  const [savingNewMeal, setSavingNewMeal] = useState(false);
  const customMealToMeal = (r) => ({
    id: `custom_${r.id}`,
    title: r.name, title_es: r.name_es || r.name,
    calories: Number(r.calories) || 0, protein: Number(r.protein_g) || 0,
    carbs: Number(r.carbs_g) || 0, fat: Number(r.fat_g) || 0,
    category: r.category || 'custom', custom: true, image: null,
  });
  useEffect(() => {
    if (!showMealModal || !profile?.id) return;
    let alive = true;
    supabase.from('custom_meals').select('*').eq('created_by', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setCustomMeals((data || []).map(customMealToMeal)); });
    return () => { alive = false; };
  }, [showMealModal, profile?.id]);
  const addCustomMeal = async () => {
    if (!newMeal.name.trim() || savingNewMeal) return;
    setSavingNewMeal(true);
    const { data, error } = await supabase.from('custom_meals').insert({
      created_by: profile.id, gym_id: profile.gym_id || null,
      name: newMeal.name.trim(),
      calories: Number(newMeal.calories) || 0, protein_g: Number(newMeal.protein) || 0,
      carbs_g: Number(newMeal.carbs) || 0, fat_g: Number(newMeal.fat) || 0,
      category: 'custom',
    }).select('*').single();
    setSavingNewMeal(false);
    if (error) { showToast(t('trainerPlans.addMealFailed', 'Could not add meal'), 'error'); return; }
    const meal = customMealToMeal(data);
    setCustomMeals(prev => [meal, ...prev]);
    setNewMeal({ name: '', calories: '', protein: '', carbs: '', fat: '' });
    setShowAddMeal(false);
    pickMeal(meal); // use the new meal immediately in the open slot
  };
  // True once the trainer swapped/hand-picked a meal — Regenerate confirms
  // before throwing that work away.
  const [mealsDirty, setMealsDirty] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  // Trainer's custom meals first, then the shared catalog.
  const pickableMeals = [...customMeals, ...MEALS];
  const filteredMeals = mealSearch.trim()
    ? pickableMeals.filter(m => {
        const q = mealSearch.toLowerCase();
        return (m.title?.toLowerCase().includes(q) || m.title_es?.toLowerCase().includes(q) || m.category?.toLowerCase().includes(q));
      }).slice(0, 40)
    : pickableMeals.slice(0, 40);

  const pickMeal = (meal) => {
    if (!mealPickerSlot) return;
    const { dayIdx, mealIdx } = mealPickerSlot;
    const targets = dayTargets();
    setMealsDirty(true);
    setGeneratedMeals(prev => {
      const updated = prev.map((d, di) => {
        if (di !== dayIdx) return d;
        const newMeals = d.meals.map((m, mi) => mi !== mealIdx ? m : { ...meal, slotType: m.slotType });
        const totals = {
          calories: newMeals.reduce((s, m) => s + (m.calories || 0), 0),
          protein: newMeals.reduce((s, m) => s + (m.protein || 0), 0),
          carbs: newMeals.reduce((s, m) => s + (m.carbs || 0), 0),
          fat: newMeals.reduce((s, m) => s + (m.fat || 0), 0),
        };
        // Keep the "Macros fit" badge honest after a manual pick
        return { ...d, meals: newMeals, totals, fits: computeDayFits(totals, targets) };
      });
      return updated;
    });
    setMealPickerSlot(null);
    setMealSearch('');
  };

  const handleAutoCalculateMacros = () => {
    const ob = mealClientProfile?.onboarding;
    if (!ob) return;
    // Use latest logged weight, or convert from onboarding kg, or explain why
    // nothing happened (this used to be a silent no-op).
    const weightLbs = mealClientProfile.latestWeight || (ob.weight_kg ? ob.weight_kg * 2.20462 : null);
    if (!weightLbs) {
      showToast(t('trainerPlans.noWeightForMacros', 'No weight on file — ask the client to log their weight first.'), 'error');
      return;
    }
    // Prefer the app-written height_inches; legacy height_cm is the fallback.
    const heightInches = ob.height_inches || (ob.height_cm ? ob.height_cm / 2.54 : 68); // fallback 5'8"
    const age = ob.age || 30; // fallback 30
    // The app writes `sex`; legacy rows may only have `gender`.
    const sex = (ob.sex || ob.gender) === 'female' ? 'female' : 'male';
    const trainingDays = ob.training_days_per_week || 4;
    const goal = mealGoalOverride || ob.primary_goal || 'general_fitness';

    const result = calculateMacros({ weightLbs, heightInches, age, sex, trainingDays, goal });
    if (!result) {
      showToast(t('trainerPlans.macroCalcFailed', "Couldn't calculate macros from this client's data."), 'error');
      return;
    }
    setMealForm(f => ({
      ...f,
      target_calories: String(result.calories),
      target_protein_g: String(result.protein),
      target_carbs_g: String(result.carbs),
      target_fat_g: String(result.fat),
      name: f.name || t('trainerPlans.autoMealPlanName', '{{goal}} Plan', { goal: goal.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }),
    }));
  };

  useEffect(() => { document.title = t('trainerPlans.pageTitle', `Trainer - Plans | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

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
        .order('created_at', { ascending: false })
        .limit(500), // a trainer won't realistically have >500 plans
      supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true),
    ]);
    if (plansRes.error) logger.error('TrainerPlans: failed to load plans:', plansRes.error);
    if (clientsRes.error) logger.error('TrainerPlans: failed to load clients:', clientsRes.error);
    if (plansRes.error || clientsRes.error) {
      showToast(t('trainerPlans.loadFailed', 'Could not load your plans. Try again.'), 'error');
    }
    const loadedPlans = plansRes.data || [];
    setPlans(loadedPlans);
    setClients((clientsRes.data || []).map(tc => tc.profiles).filter(Boolean));
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
      .limit(100)
      .then(({ data, error }) => {
        if (error) {
          logger.error('TrainerPlans: failed to load meal plans:', error);
          showToast(t('trainerPlans.loadMealPlansFailed', 'Could not load meal plans. Try again.'), 'error');
        }
        setMealPlans(data || []);
        setMealPlansLoading(false);
      });
  };

  const saveMealPlan = async () => {
    if (!mealForm.client_id || !mealForm.name.trim()) return;
    setMealSaving(true);
    // Single-active invariant (P2-2): ClientDetail reads the active plan with
    // .maybeSingle() — stacking a second active row breaks it into "No plan".
    // Retire this client's currently-active plans first; abort on failure so
    // we never silently end up with duplicate actives.
    const { error: deactivateErr } = await supabase.from('trainer_meal_plans')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('trainer_id', profile.id)
      .eq('client_id', mealForm.client_id)
      .eq('is_active', true);
    if (deactivateErr) {
      logger.error('TrainerPlans: failed to deactivate previous meal plans:', deactivateErr);
      showToast(t('trainerPlans.errorSavingMealPlan', 'Failed to save meal plan'), 'error');
      setMealSaving(false);
      return;
    }
    // Serialize generated meals into compact JSONB
    const mealsJson = generatedMeals ? generatedMeals.map((day, di) => ({
      day: di + 1,
      meals: (day.meals || []).map(m => ({ id: m.id, slotType: m.slotType || m.slot, title: m.title, title_es: m.title_es, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, category: m.category, prepTime: m.prepTime })),
      totals: day.totals,
    })) : [];
    // Plan length → duration_weeks + an end_date the member view counts against.
    const durWeeks = Math.max(1, Math.min(52, parseInt(mealForm.duration_weeks, 10) || 1));
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durWeeks * 7 * 86400000);
    const { error } = await supabase.from('trainer_meal_plans').insert({
      gym_id: profile.gym_id,
      trainer_id: profile.id,
      client_id: mealForm.client_id,
      name: mealForm.name.trim(),
      description: mealForm.description.trim() || null,
      target_calories: mealForm.target_calories ? parseInt(mealForm.target_calories) : null,
      target_protein_g: mealForm.target_protein_g ? parseInt(mealForm.target_protein_g) : null,
      target_carbs_g: mealForm.target_carbs_g ? parseInt(mealForm.target_carbs_g) : null,
      target_fat_g: mealForm.target_fat_g ? parseInt(mealForm.target_fat_g) : null,
      duration_weeks: durWeeks,
      end_date: endDate.toISOString().split('T')[0],
      meals: mealsJson,
    });
    if (error) {
      setMealSaving(false);
      showToast(t('trainerPlans.errorSavingMealPlan', 'Failed to save meal plan'), 'error');
      return;
    }
    setMealSaving(false);
    setShowMealModal(false);
    setMealForm({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '', duration_weeks: 4 });
    setGeneratedMeals(null);
    setMealStep('settings');
    loadMealPlans();
  };

  const toggleMealPlanActive = async (plan) => {
    // Activating a plan retires the client's other active plans first
    // (single-active invariant, P2-2). Abort on failure — never stack actives.
    if (!plan.is_active && plan.client_id) {
      const { error: deactivateErr } = await supabase.from('trainer_meal_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('trainer_id', profile.id)
        .eq('client_id', plan.client_id)
        .eq('is_active', true)
        .neq('id', plan.id);
      if (deactivateErr) {
        logger.error('TrainerPlans: failed to deactivate other meal plans:', deactivateErr);
        showToast(t('trainerPlans.errorToggleActive', 'Failed to update plan status'), 'error');
        return;
      }
    }
    const { error } = await supabase.from('trainer_meal_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    if (error) {
      showToast(t('trainerPlans.errorToggleActive', 'Failed to update plan status'), 'error');
      return;
    }
    setMealDetail(d => (d && d.id === plan.id ? { ...d, is_active: !plan.is_active } : d));
    loadMealPlans();
  };

  const deleteMealPlan = async (plan) => {
    const { error } = await supabase.from('trainer_meal_plans').delete().eq('id', plan.id);
    if (error) {
      showToast(t('trainerPlans.errorDeletePlan', 'Failed to delete plan'), 'error');
      return;
    }
    setConfirmDeleteMealPlan(null);
    setMealDetail(null);
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
    const { error } = await supabase.from('trainer_workout_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    if (error) {
      showToast(t('trainerPlans.errorToggleActive', 'Failed to update plan status'), 'error');
      return;
    }
    loadData();
  };

  // Duplicate opens a small "which client?" picker — the copy used to be
  // hard-locked to the original client (and the client select is disabled on
  // edit), which made duplicate-for-another-client impossible.
  const duplicatePlan = (plan) => {
    setDuplicateTarget(plan);
    setDuplicateClientId(plan.client_id || '');
  };

  const confirmDuplicatePlan = async () => {
    const plan = duplicateTarget;
    if (!plan || !duplicateClientId) return;
    setDuplicating(true);
    const { id, profiles, created_at, updated_at, ...rest } = plan;
    const { error } = await supabase.from('trainer_workout_plans').insert({
      ...rest,
      client_id: duplicateClientId,
      name: `${plan.name} ${t('trainerPlans.copySuffix', '(Copy)')}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setDuplicating(false);
    if (error) {
      logger.error('TrainerPlans: failed to duplicate plan:', error);
      showToast(t('trainerPlans.errorDuplicatePlan', 'Failed to duplicate plan'), 'error');
      return;
    }
    setDuplicateTarget(null);
    setDuplicateClientId('');
    loadData();
  };

  const deletePlan = async (plan) => {
    const { error } = await supabase.from('trainer_workout_plans').delete().eq('id', plan.id);
    if (error) {
      showToast(t('trainerPlans.errorDeletePlan', 'Failed to delete plan'), 'error');
      return;
    }
    setConfirmDeletePlan(null);
    loadData();
  };

  const filtered = useMemo(() => {
    let result = plans;
    // Status filter — drafts are their own bucket, excluded from active/archived.
    if (filterStatus === 'active') result = result.filter(p => p.is_active && !p.is_draft);
    else if (filterStatus === 'archived') result = result.filter(p => !p.is_active && !p.is_draft);
    else if (filterStatus === 'draft') result = result.filter(p => p.is_draft);
    // Client filter
    if (filterClient !== 'all') result = result.filter(p => p.client_id === filterClient);
    return result;
  }, [plans, filterClient, filterStatus]);

  // Client-filter options: active clients ∪ clients that appear on plans
  // (covers plans assigned to since-deactivated clients).
  const clientFilterOptions = useMemo(() => {
    const map = new Map();
    clients.forEach(c => map.set(c.id, c.full_name));
    plans.forEach(p => {
      if (p.client_id && !map.has(p.client_id)) {
        map.set(p.client_id, p.profiles?.full_name || t('trainerPlans.formerClient', 'Former client'));
      }
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [clients, plans, t]);

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
        showToast={showToast}
      />
    );
  }

  // ── Plan tone mapping (Strength/Hypertrophy/Conditioning/Onboarding) ──
  const planTone = (plan) => {
    const dur = plan.duration_weeks || 0;
    const totalEx = countExercises(plan);
    const days = Object.values(plan.weeks || {}).flat().length;
    if (dur >= 8 && totalEx > 30) {
      return { tone: TT.accent, soft: TT.accentSoft, type: t('trainerPlans.typeStrength', 'Strength') };
    }
    if (dur >= 8) {
      return { tone: TT.coach, soft: TT.coachSoft, type: t('trainerPlans.typeHypertrophy', 'Hypertrophy') };
    }
    if (days <= 8) {
      return { tone: TT.warn, soft: TT.warnSoft, type: t('trainerPlans.typeOnboarding', 'Onboarding') };
    }
    return { tone: TT.hot, soft: TT.hotSoft, type: t('trainerPlans.typeConditioning', 'Conditioning') };
  };

  // ── Fast track templates → opens the builder pre-seeded ─────
  // Each entry returns a starter plan-shaped object that pre-fills the builder
  // with a name, duration, and labelled day scaffolding for each week. The
  // trainer fills in actual exercises from there.
  const buildScaffold = (durationWeeks, dayLabels) => {
    const weeks = {};
    for (let w = 1; w <= durationWeeks; w++) {
      weeks[String(w)] = dayLabels.map(label => ({ name: label, exercises: [] }));
    }
    return weeks;
  };

  const FAST_TRACK = [
    {
      l: t('trainerPlans.tplPPL', 'PPL'),
      s: t('trainerPlans.tplPPLSub', '8wk · strength'),
      icon: Dumbbell, c: TT.accent,
      makePlan: () => ({
        name: t('trainerPlans.tplPPLName', 'Push / Pull / Legs'),
        description: t('trainerPlans.tplPPLDesc', '6-day push/pull/legs split for hypertrophy & strength.'),
        duration_weeks: 8,
        weeks: buildScaffold(8, [
          t('trainerPlans.day_push', 'Push'),
          t('trainerPlans.day_pull', 'Pull'),
          t('trainerPlans.day_legs', 'Legs'),
          t('trainerPlans.day_push', 'Push'),
          t('trainerPlans.day_pull', 'Pull'),
          t('trainerPlans.day_legs', 'Legs'),
        ]),
      }),
    },
    {
      l: t('trainerPlans.tplUL', 'Upper/Lower'),
      s: t('trainerPlans.tplULSub', '6wk · hypertrophy'),
      icon: Activity, c: TT.coach,
      makePlan: () => ({
        name: t('trainerPlans.tplULName', 'Upper / Lower'),
        description: t('trainerPlans.tplULDesc', '4-day upper/lower split for balanced hypertrophy.'),
        duration_weeks: 6,
        weeks: buildScaffold(6, [
          t('trainerPlans.day_upper', 'Upper'),
          t('trainerPlans.day_lower', 'Lower'),
          t('trainerPlans.day_upper', 'Upper'),
          t('trainerPlans.day_lower', 'Lower'),
        ]),
      }),
    },
    {
      l: t('trainerPlans.tplBoot', 'Bootcamp'),
      s: t('trainerPlans.tplBootSub', '4wk · group'),
      icon: Zap, c: TT.hot,
      makePlan: () => ({
        name: t('trainerPlans.tplBootName', 'Bootcamp'),
        description: t('trainerPlans.tplBootDesc', '4-week group conditioning circuit.'),
        duration_weeks: 4,
        weeks: buildScaffold(4, [
          t('trainerPlans.day_strength', 'Strength'),
          t('trainerPlans.day_conditioning', 'Conditioning'),
          t('trainerPlans.day_circuit', 'Circuit'),
        ]),
      }),
    },
    {
      l: t('trainerPlans.tplBeg', 'Beginner'),
      s: t('trainerPlans.tplBegSub', '4wk · onboard'),
      icon: Target, c: TT.warn,
      makePlan: () => ({
        name: t('trainerPlans.tplBegName', 'Beginner Foundations'),
        description: t('trainerPlans.tplBegDesc', '4-week onboarding plan to build movement patterns.'),
        duration_weeks: 4,
        weeks: buildScaffold(4, [
          t('trainerPlans.day_fullBodyA', 'Full Body A'),
          t('trainerPlans.day_fullBodyB', 'Full Body B'),
          t('trainerPlans.day_fullBodyC', 'Full Body C'),
        ]),
      }),
    },
  ];

  // ── List view ──
  if (loading) {
    return (
      <div style={{ background: TT.bg, minHeight: '100%' }} className="pb-2">
        <div style={{ padding: '8px 20px 12px' }}>
          <TEyebrow color={TT.accent}>{t('trainerPlans.heroLabel', 'Library')}</TEyebrow>
          <TPageTitle style={{ fontSize: 30 }}>{t('trainerPlans.title', 'Plans')}</TPageTitle>
          <div className="space-y-3 mt-4">
            <Skeleton variant="card" height="h-[120px]" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }} className="pb-2">
      <div style={{ padding: '8px 20px 12px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <TEyebrow color={TT.accent}>{t('trainerPlans.heroLabel', 'Library')}</TEyebrow>
            <TPageTitle style={{ fontSize: 30 }}>
              {section === 'training'
                ? t('trainerPlans.titleTraining', 'Training Plans')
                : t('trainerPlans.titleNutrition', 'Nutrition Plans')}
            </TPageTitle>
          </div>
          <TPrimaryButton
            onClick={() => section === 'training' ? openBuilder() : setShowMealModal(true)}
            aria-label={section === 'training' ? t('trainerPlans.createPlan', 'New plan') : t('trainerPlans.createMealPlan', 'New meal plan')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <Plus size={15} strokeWidth={2.4} />
            {section === 'training'
              ? t('trainerPlans.newPlan', 'New plan')
              : t('trainerPlans.newMealPlan', 'New meal plan')}
          </TPrimaryButton>
        </div>

        {/* Section tabs (Training / Nutrition) */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {SECTION_TABS.map((tab, i) => (
            <TTabPill
              key={tab.key}
              active={sectionIndex === i}
              accent={sectionIndex === i}
              onClick={() => setSectionIndex(i)}
            >
              {tab.label}
            </TTabPill>
          ))}
        </div>

        <SwipeableTabView activeIndex={sectionIndex} onChangeIndex={setSectionIndex} tabKeys={['training', 'nutrition']}>
          {/* ═══════════ TRAINING SECTION ═══════════ */}
          <div>
            {/* Start from a template — horizontal-scroll template cards */}
            <div style={{ marginBottom: 18 }}>
              <TSectionHeader title={t('trainerPlans.fastTrackTitle', 'Start from a template')} />
              <div
                style={{ display: 'flex', gap: 12, overflowX: 'auto', marginLeft: -20, marginRight: -20, padding: '0 20px 4px' }}
                className="scrollbar-hide"
              >
                {FAST_TRACK.map((tmpl, i) => {
                  const Icon = tmpl.icon;
                  return (
                    <TCard
                      key={i}
                      padded={16}
                      role="button"
                      tabIndex={0}
                      onClick={() => openBuilder(tmpl.makePlan ? tmpl.makePlan() : null)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBuilder(tmpl.makePlan ? tmpl.makePlan() : null); } }}
                      className="tt-tap"
                      style={{ minWidth: 168, flexShrink: 0, cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: 12,
                        background: `${tmpl.c}1F`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon size={20} color={tmpl.c} strokeWidth={2.2} />
                      </div>
                      <div style={{
                        fontFamily: TFont.display, fontSize: 15, fontWeight: 800,
                        color: TT.text, letterSpacing: -0.3, marginTop: 14, lineHeight: 1.15,
                      }}>{tmpl.l}</div>
                      <div style={{ fontSize: 12, color: TT.textSub, marginTop: 4 }}>{tmpl.s}</div>
                    </TCard>
                  );
                })}
              </div>
            </div>

            {/* Status + client filter strip (small, above plans) */}
            {plans.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', alignItems: 'center' }} className="scrollbar-hide">
                {[
                  { key: 'active',   label: t('trainerPlans.active', 'Active') },
                  { key: 'draft',    label: t('trainerPlans.drafts', 'Drafts') },
                  { key: 'all',      label: t('trainerPlans.statusAll', 'All') },
                  { key: 'archived', label: t('trainerPlans.archives', 'Archives') },
                ].map((tab) => (
                  <TTabPill
                    key={tab.key}
                    active={filterStatus === tab.key}
                    onClick={() => setFilterStatus(tab.key)}
                  >
                    {tab.label}
                  </TTabPill>
                ))}
                {/* Client filter — feeds the same memo the status pills do */}
                {clientFilterOptions.length > 0 && (
                  <select
                    value={filterClient}
                    onChange={e => setFilterClient(e.target.value)}
                    aria-label={t('trainerPlans.filterByClient', 'Filter by client')}
                    style={{
                      marginLeft: 'auto', flexShrink: 0, maxWidth: 160,
                      padding: '7px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      background: filterClient === 'all' ? TT.surface : TT.accentSoft,
                      color: filterClient === 'all' ? TT.textSub : TT.accentInk,
                      border: `1px solid ${filterClient === 'all' ? TT.border : TT.accent}`,
                      outline: 'none', cursor: 'pointer',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden',
                    }}
                  >
                    <option value="all">{t('trainerPlans.filterAllClients', 'All clients')}</option>
                    {clientFilterOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* "Your library · n" section header */}
            <TSectionHeader
              title={t('trainerPlans.yourLibrary', 'Your library')}
              action={filtered.length > 0 ? `${filtered.length}` : null}
            />

            {/* Plans list */}
            {filtered.length === 0 ? (
              plans.length === 0 ? (
                <TrainerEmptyState
                  icon={ClipboardList}
                  title={t('trainerPlans.noPlansYet', 'No workout plans yet')}
                  description={t('trainerPlans.createHint', 'Create a custom workout plan for your clients')}
                  actionLabel={t('trainerPlans.createPlan', 'Create plan')}
                  actionIcon={Plus}
                  onAction={() => openBuilder()}
                />
              ) : (
                <TrainerEmptyState
                  icon={ClipboardList}
                  title={t('trainerPlans.noPlansFiltered', 'No plans match these filters')}
                  description={t('trainerPlans.tryAdjustingFilters', 'Try adjusting the status or client filter to see more.')}
                  compact
                />
              )
            ) : (
              <TCard padded={0} style={{ overflow: 'hidden' }}>
                {filtered.map((plan, idx) => {
                  const { tone, type } = planTone(plan);
                  const allDays = Object.values(plan.weeks || {}).flat();
                  const totalDays = allDays.length;
                  // Assigned clients = unique client_ids from this plan + (single client from plan.client_id if present)
                  const assignedIds = plan.client_id ? [plan.client_id] : [];
                  const assignedNames = plan.profiles?.full_name ? [plan.profiles.full_name] : [];
                  const assignedCount = assignedIds.length;
                  const isExpanded = expandedPlan === plan.id;
                  return (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: Math.min(idx * 0.03, 0.3) }}
                      style={{ borderTop: idx > 0 ? `1px solid ${TT.border}` : 'none' }}
                    >
                      {/* Library row — tap to edit, trailing button toggles options */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openBuilder(plan)}
                        onKeyDown={(e) => { if (e.key === 'Enter') openBuilder(plan); }}
                        className="tt-tap"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 13,
                          padding: '13px 15px', cursor: 'pointer',
                        }}
                      >
                        <div style={{
                          width: 38, height: 38, borderRadius: 11,
                          background: `${tone}1F`, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <ClipboardList size={18} color={tone} strokeWidth={2} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}>
                            <span style={{
                              fontSize: 14.5, fontWeight: 700, color: TT.text,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              minWidth: 0,
                            }}>{plan.name}</span>
                            {plan.is_draft ? (
                              <TPill tone="warn" size="s" style={{ flexShrink: 0 }}>
                                {t('trainerPlans.draftBadge', 'DRAFT')}
                              </TPill>
                            ) : !plan.is_active && (
                              <TPill tone="neutral" size="s" style={{ flexShrink: 0 }}>
                                {t('trainerPlans.inactiveBadge', 'INACTIVE')}
                              </TPill>
                            )}
                          </div>
                          <div style={{
                            fontSize: 11.5, color: TT.textSub, marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {type} · {plan.duration_weeks || 0} {t('trainerPlans.weeks', 'weeks')} · {totalDays} {t('trainerPlans.daysAbbrev', 'days')} · {assignedCount === 0
                              ? t('trainerPlans.genericPlan', 'Generic')
                              : assignedCount === 1
                                ? t('trainerPlans.assigned_one', '{{count}} client', { count: assignedCount })
                                : t('trainerPlans.assigned_other', '{{count}} clients', { count: assignedCount })}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setExpandedPlan(isExpanded ? null : plan.id); }}
                          aria-label={t('trainerPlans.moreOptions', 'More options')}
                          aria-expanded={isExpanded}
                          style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: isExpanded ? TT.surface2 : 'transparent', border: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: TT.textMute, cursor: 'pointer', flexShrink: 0,
                          }}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <MoreHorizontal size={16} />}
                        </button>
                      </div>

                      {/* Expanded action strip — keeps every option accessible */}
                      {isExpanded && (
                        <div style={{
                          padding: '4px 15px 14px 66px',
                          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                        }}>
                          <button
                            type="button"
                            onClick={() => openBuilder(plan)}
                            style={{
                              padding: '6px 10px', borderRadius: 8, border: 'none',
                              background: TT.accent, fontSize: 11, fontWeight: 700,
                              color: '#06363B', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            <Pencil size={11} /> {t('trainerPlans.edit', 'Edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicatePlan(plan)}
                            style={{
                              padding: '6px 10px', borderRadius: 8,
                              border: `1px solid ${TT.borderSolid}`,
                              background: TT.surface2, fontSize: 11, fontWeight: 700,
                              color: TT.text, cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            <Copy size={11} /> {t('trainerPlans.duplicate', 'Duplicate')}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(plan)}
                            style={{
                              padding: '6px 10px', borderRadius: 8,
                              border: `1px solid ${TT.borderSolid}`,
                              background: TT.surface2, fontSize: 11, fontWeight: 700,
                              color: TT.text, cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            {plan.is_active
                              ? <><ToggleRight size={11} /> {t('trainerPlans.deactivate', 'Deactivate')}</>
                              : <><ToggleLeft size={11} /> {t('trainerPlans.activate', 'Activate')}</>}
                          </button>
                          <div style={{ flex: 1 }} />
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePlan(plan)}
                            aria-label={t('trainerPlans.delete', 'Delete')}
                            style={{
                              padding: '6px 10px', borderRadius: 8, border: 'none',
                              background: TT.hotSoft, fontSize: 11, fontWeight: 700,
                              color: TT.hot, cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                          <p style={{
                            width: '100%', fontSize: 10, color: TT.textMute, marginTop: 4,
                          }}>
                            {t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy', { locale: dateFnsLocale })}
                            {plan.updated_at !== plan.created_at && ` · ${t('trainerPlans.updated', 'Updated')} ${format(new Date(plan.updated_at), 'MMM d, yyyy', { locale: dateFnsLocale })}`}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </TCard>
            )}
          </div>

        {/* ═══════════ NUTRITION SECTION ═══════════ */}
        <div>
          {/* Status filter — Atelier pill row */}
          {(() => {
            const MEAL_FILTERS = [
              { key: 'active', label: t('trainerPlans.active', 'Active') },
              { key: 'past', label: t('trainerPlans.past', 'Past') },
              { key: 'all', label: t('trainerPlans.statusAll', 'All') },
            ];
            return (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }} className="scrollbar-hide">
                {MEAL_FILTERS.map((tab) => (
                  <TTabPill
                    key={tab.key}
                    active={mealFilterStatus === tab.key}
                    onClick={() => setMealFilterStatus(tab.key)}
                  >
                    {tab.label}
                  </TTabPill>
                ))}
              </div>
            );
          })()}

          {/* "Meal plans · n" section header */}
          {!mealPlansLoading && filteredMealPlans.length > 0 && (
            <TSectionHeader
              title={t('trainerPlans.mealPlansHeader', 'Meal plans')}
              action={`${filteredMealPlans.length}`}
            />
          )}

          {mealPlansLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 rounded-full animate-spin" style={{ border: `2px solid ${TT.border}`, borderTopColor: TT.accent }} />
            </div>
          ) : filteredMealPlans.length === 0 ? (
            <div className="text-center py-20">
              <UtensilsCrossed size={32} className="mx-auto mb-3" style={{ color: TT.textMute }} />
              <p className="text-[14px]" style={{ color: TT.textMute }}>
                {mealPlans.length === 0
                  ? t('trainerPlans.noMealPlans', 'No meal plans yet')
                  : t('trainerPlans.noMealPlansFiltered', 'No meal plans match this filter')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredMealPlans.map(plan => (
                <TCard key={plan.id} padded={16}
                  role="button" tabIndex={0}
                  onClick={() => { setMealDetail(plan); setMealDetailDay(0); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setMealDetail(plan); setMealDetailDay(0); } }}
                  className="tt-tap"
                  style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: `${TT.accent}1F`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <UtensilsCrossed size={20} color={TT.accent} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14.5px] font-bold truncate" style={{ color: TT.text }}>{plan.name}</p>
                          {plan.profiles?.full_name && (
                            <p className="text-[11.5px] mt-0.5" style={{ color: TT.textSub }}>
                              {t('trainerPlans.assignedTo', 'Assigned to {{name}}', { name: plan.profiles.full_name })}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <TPill tone={plan.is_active ? 'good' : 'neutral'} size="s">
                            {plan.is_active ? t('trainerPlans.active', 'Active') : t('trainerPlans.past', 'Past')}
                          </TPill>
                          <ChevronRight size={16} style={{ color: TT.textMute }} />
                        </div>
                      </div>
                      {plan.description && (
                        <p className="text-[12px] mt-2 line-clamp-2" style={{ color: TT.textSub }}>{plan.description}</p>
                      )}
                      <div className="flex items-center gap-3.5 mt-2 text-[11px]">
                        {plan.target_calories ? <span style={{ color: TT.accent }} className="font-semibold">{plan.target_calories} {t('common:cal', 'cal')}</span> : null}
                        {plan.target_protein_g ? <span style={{ color: '#60A5FA' }}>{t('trainerPlans.proteinShort', 'P:')} {plan.target_protein_g}g</span> : null}
                        {plan.target_carbs_g ? <span style={{ color: '#34D399' }}>{t('trainerPlans.carbsShort', 'C:')} {plan.target_carbs_g}g</span> : null}
                        {plan.target_fat_g ? <span style={{ color: '#F472B6' }}>{t('trainerPlans.fatShort', 'F:')} {plan.target_fat_g}g</span> : null}
                      </div>
                      <p className="text-[10px] mt-2" style={{ color: TT.textFaint }}>
                        {t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy', { locale: dateFnsLocale })}
                      </p>
                    </div>
                  </div>
                </TCard>
              ))}
            </div>
          )}
        </div>
      </SwipeableTabView>
        {/* Clear the bottom nav */}
        <div style={{ height: 90 }} />
      </div>

      {/* ── Meal Plan Creation Modal (2-step: Settings → Meals) ──
          Portaled to <body> so it escapes any ancestor stacking context and
          always sits above the trainer header + bottom nav (was rendering
          "behind" them). */}
      {showMealModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={() => { setShowMealModal(false); setMealStep('settings'); setGeneratedMeals(null); }}>
          <div className="rounded-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col" style={{ backgroundColor: TT.surface, border: `1px solid ${TT.borderSolid}` }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: `1px solid ${TT.border}` }}>
              <div className="flex items-center gap-2">
                {mealStep === 'meals' && (
                  <button onClick={() => setMealStep('settings')} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" style={{ color: TT.textMute }}>
                    <ArrowLeft size={18} />
                  </button>
                )}
                <h2 className="text-[16px] font-bold" style={{ color: TT.text }}>
                  {mealStep === 'settings' ? t('trainerPlans.createMealPlan', 'Create Meal Plan') : t('trainerPlans.weeklyMeals', 'Weekly Meals')}
                </h2>
              </div>
              <button onClick={() => { setShowMealModal(false); setMealStep('settings'); setGeneratedMeals(null); }} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg" style={{ color: TT.textMute }}>
                <X size={18} />
              </button>
            </div>

            {/* ── STEP 1: Settings ── */}
            {mealStep === 'settings' && (
              <>
                <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                  {/* Client */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: TT.textSub }}>{t('trainerPlans.client', 'Client')}</label>
                    <select value={mealForm.client_id} onChange={e => { setMealForm(f => ({ ...f, client_id: e.target.value })); setMealGoalOverride(null); setGeneratedMeals(null); }}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
                      style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }}>
                      <option value="">{t('trainerPlans.selectClient', 'Select client...')}</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                    </select>
                  </div>

                  {/* Client profile + goal override + auto-calculate */}
                  {mealClientProfile?.onboarding && (
                    <div className="rounded-xl p-3" style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: TT.accent }}>{t('trainerPlans.clientProfile', 'Client Profile')}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-3">
                        <span><span style={{ color: TT.textMute }}>{t('trainerPlans.level', 'Level')}:</span> <span className="font-semibold capitalize" style={{ color: TT.text }}>{mealClientProfile.onboarding.fitness_level || '—'}</span></span>
                        <span><span style={{ color: TT.textMute }}>{t('trainerPlans.goal', 'Goal')}:</span> <span className="font-semibold capitalize" style={{ color: TT.text }}>{mealClientProfile.onboarding.primary_goal ? t(`trainerNotes.goals.${mealClientProfile.onboarding.primary_goal}`, mealClientProfile.onboarding.primary_goal.replace(/_/g, ' ')) : '—'}</span></span>
                        <span><span style={{ color: TT.textMute }}>{t('trainerPlans.daysWeek', 'Days/wk')}:</span> <span className="font-semibold" style={{ color: TT.text }}>{mealClientProfile.onboarding.training_days_per_week || '—'}</span></span>
                        {mealClientProfile.latestWeight && (
                          <span><span style={{ color: TT.textMute }}>{t('trainerPlans.weight', 'Weight')}:</span> <span className="font-semibold" style={{ color: TT.text }}>{Math.round(mealClientProfile.latestWeight)} {t('common:lbs', 'lbs')}</span></span>
                        )}
                      </div>
                      <div className="pt-2" style={{ borderTop: `1px solid ${TT.border}` }}>
                        <p className="text-[10px] font-medium mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.nutritionGoal', 'Nutrition goal')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {GOAL_OPTIONS.map(g => {
                            const clientGoal = mealClientProfile.onboarding.primary_goal;
                            const isActive = mealGoalOverride ? mealGoalOverride === g : clientGoal === g;
                            return (
                              <button key={g} onClick={() => setMealGoalOverride(g === clientGoal ? null : g)}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all relative"
                                style={isActive ? { backgroundColor: TT.accent, color: '#06363B' } : { backgroundColor: TT.surface2, color: TT.textMute }}>
                                {t(`trainerNotes.goals.${g}`, g.replace(/_/g, ' '))}
                                {!mealGoalOverride && clientGoal === g && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: TT.good }} />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <button onClick={handleAutoCalculateMacros}
                        className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold transition-colors min-h-[44px]"
                        style={{ backgroundColor: TT.accentSoft, color: TT.accentInk }}>
                        <Zap size={14} />
                        {t('trainerPlans.autoCalculateMacros', 'Auto-Calculate Macros')}
                      </button>
                    </div>
                  )}

                  {/* Name */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: TT.textSub }}>{t('trainerPlans.planName', 'Plan Name')}</label>
                    <input value={mealForm.name} onChange={e => setMealForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('trainerPlans.mealPlanNamePlaceholder', 'e.g. Cutting Phase, Bulking Plan')}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
                      style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: TT.textSub }}>{t('trainerPlans.description', 'Description')}</label>
                    <textarea value={mealForm.description} onChange={e => setMealForm(f => ({ ...f, description: e.target.value }))} rows={2}
                      placeholder={t('trainerPlans.mealDescPlaceholder', 'Optional notes about the plan...')}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none resize-none"
                      style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
                  </div>

                  {/* Macro targets */}
                  <div>
                    <label className="text-[12px] font-medium mb-2 block" style={{ color: TT.textSub }}>{t('trainerPlans.macroTargets', 'Macro Targets')}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: 'target_calories', label: t('trainerPlans.calories', 'Calories'), placeholder: '2200', color: TT.accent },
                        { key: 'target_protein_g', label: t('trainerPlans.proteinG', 'Protein (g)'), placeholder: '180', color: '#60A5FA' },
                        { key: 'target_carbs_g', label: t('trainerPlans.carbsG', 'Carbs (g)'), placeholder: '250', color: '#34D399' },
                        { key: 'target_fat_g', label: t('trainerPlans.fatG', 'Fat (g)'), placeholder: '65', color: '#F472B6' },
                      ].map(({ key, label, placeholder, color }) => (
                        <div key={key} className="rounded-xl p-3" style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color }}>{label}</span>
                          <input type="number" inputMode="numeric" value={mealForm[key]} onChange={e => setMealForm(f => ({ ...f, [key]: e.target.value }))}
                            placeholder={placeholder} className="w-full bg-transparent text-[20px] font-bold outline-none" style={{ color: TT.text }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Plan length — how many weeks the client follows this plan */}
                  <div>
                    <label className="text-[12px] font-medium mb-2 block" style={{ color: TT.textSub }}>{t('trainerPlans.planLength', 'Plan length')}</label>
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {[1, 2, 4, 6, 8, 12].map(w => (
                        <button key={w} type="button" onClick={() => setMealForm(f => ({ ...f, duration_weeks: w }))}
                          className="px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors min-h-[44px] min-w-[44px]"
                          style={Number(mealForm.duration_weeks) === w
                            ? { backgroundColor: TT.accent, color: '#06363B' }
                            : { backgroundColor: TT.surface2, color: TT.textMute, border: `1px solid ${TT.border}` }}>
                          {w}{t('trainerPlans.wSuffix', 'w')}
                        </button>
                      ))}
                      <div className="flex items-center gap-1 px-2.5 rounded-lg min-h-[44px]"
                        style={![1, 2, 4, 6, 8, 12].includes(Number(mealForm.duration_weeks)) ? { backgroundColor: TT.accent } : { backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                        <input type="number" inputMode="numeric" min={1} max={52} value={mealForm.duration_weeks}
                          onChange={e => { const v = parseInt(e.target.value, 10); setMealForm(f => ({ ...f, duration_weeks: isNaN(v) ? '' : Math.max(1, Math.min(52, v)) })); }}
                          aria-label={t('trainerPlans.customWeeks', 'Custom weeks')}
                          className="w-9 bg-transparent text-center text-[12px] font-semibold outline-none"
                          style={{ color: ![1, 2, 4, 6, 8, 12].includes(Number(mealForm.duration_weeks)) ? '#06363B' : TT.text }} />
                        <span className="text-[11px] font-semibold" style={{ color: ![1, 2, 4, 6, 8, 12].includes(Number(mealForm.duration_weeks)) ? '#06363B' : TT.textMute }}>{t('trainerPlans.wSuffix', 'w')}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer — Step 1 */}
                <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderTop: `1px solid ${TT.border}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                  <button onClick={() => { setShowMealModal(false); setMealStep('settings'); }}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-medium min-h-[44px]"
                    style={{ backgroundColor: TT.surface2, color: TT.textSub }}>
                    {t('trainerPlans.cancel', 'Cancel')}
                  </button>
                  <button onClick={handleGenerateMeals}
                    disabled={generatingMeals || !mealForm.target_calories || !mealForm.target_protein_g || !mealForm.client_id || !mealForm.name.trim()}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-bold min-h-[44px] transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: TT.accent, color: '#06363B' }}>
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
                  {/* Day selector — Atelier filter chips */}
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-3" style={{ borderBottom: `1px solid ${TT.border}` }}>
                    {DAY_LABELS.map((label, i) => (
                      <button key={i} onClick={() => setMealPreviewDay(i)}
                        className="shrink-0 tt-tap"
                        style={{
                          padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                          whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                          ...(mealPreviewDay === i
                            ? { background: TT.text, color: TT.onInverse }
                            : { background: TT.surface, color: TT.textSub, boxShadow: 'inset 0 0 0 1px var(--tt-border)' }),
                        }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Day totals */}
                  {generatedMeals[mealPreviewDay] && (
                    <div className="px-4 pt-3">
                      <div className="flex items-center gap-3 mb-3 text-[11px]">
                        <span style={{ color: TT.accent }} className="font-bold">{generatedMeals[mealPreviewDay].totals?.calories || 0} {t('common:cal', 'cal')}</span>
                        <span style={{ color: '#60A5FA' }} className="font-semibold">{generatedMeals[mealPreviewDay].totals?.protein || 0}g {t('trainerClientDetail.macros.gramsProtein', 'P')}</span>
                        <span style={{ color: '#34D399' }} className="font-semibold">{generatedMeals[mealPreviewDay].totals?.carbs || 0}g {t('trainerClientDetail.macros.gramsCarbs', 'C')}</span>
                        <span style={{ color: '#F472B6' }} className="font-semibold">{generatedMeals[mealPreviewDay].totals?.fat || 0}g {t('trainerClientDetail.macros.gramsFat', 'F')}</span>
                        {generatedMeals[mealPreviewDay].fits && (
                          <span className="text-[10px] font-bold ml-auto" style={{ color: TT.goodInk }}>✓ {t('trainerPlans.macrosFit', 'Macros fit')}</span>
                        )}
                      </div>

                      {/* Meal cards */}
                      <div className="space-y-2.5 pb-4">
                        {(generatedMeals[mealPreviewDay].meals || []).map((meal, mi) => {
                          // Match the slot row by the meal's own tag (set at
                          // generation/swap) — index only as a fallback.
                          const slot = MEAL_SLOTS.find(s => s.type === meal.slotType) || MEAL_SLOTS[mi] || MEAL_SLOTS[3];
                          const mealLabel = slot.label;
                          const mealColor = slot.color;
                          const mealTitle = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                          return (
                            <div key={mi} className="rounded-xl p-3 flex gap-3" style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                              {/* Meal image */}
                              {foodImageUrl(meal.image) ? (
                                <img src={foodImageUrl(meal.image)} alt={mealTitle} className="w-16 h-16 rounded-xl object-cover shrink-0" style={{ backgroundColor: TT.surface2 }} loading="lazy" />
                              ) : (
                                <div className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center" style={{ backgroundColor: TT.surface2 }}>
                                  <UtensilsCrossed size={20} style={{ color: TT.textMute }} />
                                </div>
                              )}
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: mealColor }}>{mealLabel}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => swapMeal(mealPreviewDay, mi)}
                                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg transition-colors"
                                      style={{ backgroundColor: TT.surface2, color: TT.textMute }}
                                      title={t('trainerPlans.swapMeal', 'Swap meal')}>
                                      <RefreshCw size={11} />
                                    </button>
                                    <button onClick={() => { setMealPickerSlot({ dayIdx: mealPreviewDay, mealIdx: mi }); setMealSearch(''); }}
                                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg transition-colors"
                                      style={{ backgroundColor: TT.accentSoft, color: TT.accent }}
                                      title={t('trainerPlans.chooseMeal', 'Choose meal')}>
                                      <Pencil size={11} />
                                    </button>
                                  </div>
                                </div>
                                <p className="text-[13px] font-semibold truncate mb-1" style={{ color: TT.text }}>{mealTitle}</p>
                                <div className="flex items-center gap-2.5 text-[10px]">
                                  <span style={{ color: TT.accent }}>{meal.calories} {t('common:cal', 'cal')}</span>
                                  <span style={{ color: '#60A5FA' }}>{meal.protein}g {t('trainerClientDetail.macros.gramsProtein', 'P')}</span>
                                  <span style={{ color: '#34D399' }}>{meal.carbs}g {t('trainerClientDetail.macros.gramsCarbs', 'C')}</span>
                                  <span style={{ color: '#F472B6' }}>{meal.fat}g {t('trainerClientDetail.macros.gramsFat', 'F')}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* ── Meal Picker Overlay ── */}
                      {mealPickerSlot && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setMealPickerSlot(null)}>
                          <div className="rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col" style={{ backgroundColor: TT.surface, border: `1px solid ${TT.borderSolid}` }} onClick={e => e.stopPropagation()}>
                            <div className="p-4 shrink-0" style={{ borderBottom: `1px solid ${TT.border}` }}>
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[15px] font-bold" style={{ color: TT.text }}>
                                  {t('trainerPlans.chooseMeal', 'Choose Meal')}
                                </h3>
                                <button onClick={() => setMealPickerSlot(null)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" style={{ color: TT.textMute }}>
                                  <X size={16} />
                                </button>
                              </div>
                              <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: TT.textMute }} />
                                <input value={mealSearch} onChange={e => setMealSearch(e.target.value)}
                                  placeholder={t('trainerPlans.searchMeals', 'Search meals...')}
                                  autoFocus
                                  className="w-full rounded-xl pl-10 pr-4 py-2.5 text-[16px] sm:text-[14px] outline-none"
                                  style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
                              </div>
                              {/* Add your own meal → saved to the trainer's private custom-meal library */}
                              <button type="button" onClick={() => setShowAddMeal(s => !s)}
                                className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12.5px] font-bold"
                                style={{ background: TT.accentSoft, color: TT.accentInk, border: `1px dashed ${TT.accent}` }}>
                                <Plus size={14} /> {t('trainerPlans.addCustomMeal', 'Add your own meal')}
                              </button>
                              {showAddMeal && (
                                <div className="mt-2 rounded-xl p-3 space-y-2" style={{ background: TT.surface2, border: `1px solid ${TT.border}` }}>
                                  <input value={newMeal.name} onChange={e => setNewMeal(n => ({ ...n, name: e.target.value }))}
                                    placeholder={t('trainerPlans.mealName', 'Meal name')}
                                    className="w-full rounded-lg px-3 py-2 text-[16px] sm:text-[14px] outline-none"
                                    style={{ background: TT.surface, border: `1px solid ${TT.border}`, color: TT.text }} />
                                  <div className="grid grid-cols-4 gap-2">
                                    {[['calories', t('trainerNotes.nutrition.cal', 'Cal')], ['protein', t('trainerClientDetail.macros.gramsProtein', 'P')], ['carbs', t('trainerClientDetail.macros.gramsCarbs', 'C')], ['fat', t('trainerClientDetail.macros.gramsFat', 'F')]].map(([k, lab]) => (
                                      <input key={k} type="number" inputMode="numeric" min="0" value={newMeal[k]} onChange={e => setNewMeal(n => ({ ...n, [k]: e.target.value }))}
                                        placeholder={lab}
                                        className="w-full rounded-lg px-2 py-2 text-[14px] text-center outline-none"
                                        style={{ background: TT.surface, border: `1px solid ${TT.border}`, color: TT.text }} />
                                    ))}
                                  </div>
                                  <button type="button" onClick={addCustomMeal} disabled={!newMeal.name.trim() || savingNewMeal}
                                    className="w-full py-2 rounded-lg text-[13px] font-bold disabled:opacity-40 flex items-center justify-center gap-1.5"
                                    style={{ background: TT.accent, color: '#06363B' }}>
                                    {savingNewMeal ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                    {t('trainerPlans.saveAndUseMeal', 'Save & use')}
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 overflow-y-auto p-2">
                              {filteredMeals.map(meal => {
                                const title = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                                return (
                                  <button key={meal.id} onClick={() => pickMeal(meal)}
                                    className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl transition-colors active:scale-[0.98]"
                                    style={{ color: TT.text }}>
                                    {foodImageUrl(meal.image) ? (
                                      <img src={foodImageUrl(meal.image)} alt={title} className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ backgroundColor: TT.surface2 }} loading="lazy" />
                                    ) : (
                                      <div className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center" style={{ backgroundColor: TT.surface2 }}>
                                        <UtensilsCrossed size={16} style={{ color: TT.textMute }} />
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[13px] font-semibold truncate flex items-center gap-1.5">
                                        <span className="truncate">{title}</span>
                                        {meal.custom && (
                                          <span className="shrink-0 text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: TT.accentSoft, color: TT.accentInk }}>
                                            {t('trainerPlans.customTag', 'Custom')}
                                          </span>
                                        )}
                                      </p>
                                      <div className="flex items-center gap-2.5 mt-0.5 text-[10px]">
                                        <span style={{ color: TT.accent }}>{meal.calories} {t('common:cal', 'cal')}</span>
                                        <span style={{ color: '#60A5FA' }}>{meal.protein}g {t('trainerClientDetail.macros.gramsProtein', 'P')}</span>
                                        <span style={{ color: '#34D399' }}>{meal.carbs}g {t('trainerClientDetail.macros.gramsCarbs', 'C')}</span>
                                        <span style={{ color: '#F472B6' }}>{meal.fat}g {t('trainerClientDetail.macros.gramsFat', 'F')}</span>
                                      </div>
                                      <span className="text-[9px] font-medium capitalize mt-0.5 block" style={{ color: TT.textMute }}>
                                        {meal.category ? t(`trainerClientDetail.mealCategories.${meal.category}`, meal.category.replace(/_/g, ' ')) : ''}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                              {filteredMeals.length === 0 && (
                                <p className="text-center py-8 text-[13px]" style={{ color: TT.textMute }}>{t('trainerPlans.noMealsFound', 'No meals found')}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer — Step 2 */}
                <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderTop: `1px solid ${TT.border}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                  <button onClick={() => { if (mealsDirty) { setConfirmRegen(true); } else { handleGenerateMeals(); } }} disabled={generatingMeals}
                    className="py-3 sm:py-2.5 px-4 rounded-xl text-[13px] font-semibold min-h-[44px] flex items-center gap-1.5"
                    style={{ backgroundColor: TT.surface2, color: TT.textSub }}>
                    {generatingMeals ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {t('trainerPlans.regenerate', 'Regenerate')}
                  </button>
                  <button onClick={saveMealPlan} disabled={mealSaving}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-bold min-h-[44px] transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: TT.accent, color: '#06363B' }}>
                    {mealSaving ? <Loader2 size={16} className="animate-spin" /> : <UtensilsCrossed size={16} />}
                    {mealSaving ? t('trainerPlans.saving', 'Saving...') : t('trainerPlans.assignMealPlan', 'Assign Meal Plan')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Delete confirmation modal */}
      {confirmDeletePlan && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeletePlan(null)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
              {t('trainerPlans.confirmDelete', 'Delete "{{name}}"?', { name: confirmDeletePlan.name })}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.confirmDeleteDescription', 'This action cannot be undone. The plan will be permanently removed.')}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setConfirmDeletePlan(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}
              >
                {t('trainerPlans.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => deletePlan(confirmDeletePlan)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                style={{ background: TT.hotSoft, color: TT.hot }}
              >
                {t('trainerPlans.deleteConfirm', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved meal-plan detail viewer ── */}
      {mealDetail && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setMealDetail(null)}>
          <div className="rounded-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col" style={{ backgroundColor: TT.surface, border: `1px solid ${TT.borderSolid}` }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-4 shrink-0" style={{ borderBottom: `1px solid ${TT.border}` }}>
              <div className="min-w-0">
                <h2 className="text-[16px] font-bold truncate" style={{ color: TT.text }}>{mealDetail.name}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <TPill tone={mealDetail.is_active ? 'good' : 'neutral'} size="s">
                    {mealDetail.is_active ? t('trainerPlans.active', 'Active') : t('trainerPlans.past', 'Past')}
                  </TPill>
                  {mealDetail.profiles?.full_name && (
                    <span className="text-[11px]" style={{ color: TT.textMute }}>
                      {t('trainerPlans.assignedTo', 'Assigned to {{name}}', { name: mealDetail.profiles.full_name })}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setMealDetail(null)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg shrink-0" style={{ color: TT.textMute }}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {mealDetail.description && (
                <p className="text-[12px] px-4 pt-3" style={{ color: TT.textSub }}>{mealDetail.description}</p>
              )}

              {/* Macro targets */}
              {(mealDetail.target_calories || mealDetail.target_protein_g || mealDetail.target_carbs_g || mealDetail.target_fat_g) ? (
                <div className="px-4 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.macroTargets', 'Macro Targets')}</p>
                  <div className="flex items-center gap-3 text-[11px] flex-wrap">
                    {mealDetail.target_calories ? <span style={{ color: TT.accent }} className="font-bold">{mealDetail.target_calories} {t('common:cal', 'cal')}</span> : null}
                    {mealDetail.target_protein_g ? <span style={{ color: '#60A5FA' }} className="font-semibold">{mealDetail.target_protein_g}g {t('trainerClientDetail.macros.gramsProtein', 'P')}</span> : null}
                    {mealDetail.target_carbs_g ? <span style={{ color: '#34D399' }} className="font-semibold">{mealDetail.target_carbs_g}g {t('trainerClientDetail.macros.gramsCarbs', 'C')}</span> : null}
                    {mealDetail.target_fat_g ? <span style={{ color: '#F472B6' }} className="font-semibold">{mealDetail.target_fat_g}g {t('trainerClientDetail.macros.gramsFat', 'F')}</span> : null}
                  </div>
                </div>
              ) : null}

              {Array.isArray(mealDetail.meals) && mealDetail.meals.length > 0 ? (
                <>
                  {/* Day selector — Atelier filter chips */}
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-3" style={{ borderBottom: `1px solid ${TT.border}` }}>
                    {mealDetail.meals.map((day, i) => (
                      <button key={i} onClick={() => setMealDetailDay(i)}
                        className="shrink-0 tt-tap"
                        style={{
                          padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                          whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                          ...(mealDetailDay === i
                            ? { background: TT.text, color: TT.onInverse }
                            : { background: TT.surface, color: TT.textSub, boxShadow: 'inset 0 0 0 1px var(--tt-border)' }),
                        }}>
                        {DAY_LABELS[i] || `${t('trainerPlans.day', 'Day')} ${day.day || i + 1}`}
                      </button>
                    ))}
                  </div>

                  {(() => {
                    const day = mealDetail.meals[Math.min(mealDetailDay, mealDetail.meals.length - 1)];
                    if (!day) return null;
                    return (
                      <div className="px-4 pt-3">
                        {day.totals && (
                          <div className="flex items-center gap-3 mb-3 text-[11px]">
                            <span style={{ color: TT.accent }} className="font-bold">{day.totals.calories || 0} {t('common:cal', 'cal')}</span>
                            <span style={{ color: '#60A5FA' }} className="font-semibold">{day.totals.protein || 0}g {t('trainerClientDetail.macros.gramsProtein', 'P')}</span>
                            <span style={{ color: '#34D399' }} className="font-semibold">{day.totals.carbs || 0}g {t('trainerClientDetail.macros.gramsCarbs', 'C')}</span>
                            <span style={{ color: '#F472B6' }} className="font-semibold">{day.totals.fat || 0}g {t('trainerClientDetail.macros.gramsFat', 'F')}</span>
                          </div>
                        )}
                        <div className="space-y-2.5 pb-4">
                          {(day.meals || []).map((meal, mi) => {
                            const slot = MEAL_SLOTS.find(s => s.type === (meal.slotType || meal.slot)) || MEAL_SLOTS[mi] || MEAL_SLOTS[3];
                            const full = mealById.get(meal.id);
                            const mealTitle = i18n.language === 'es' && (meal.title_es || full?.title_es)
                              ? (meal.title_es || full?.title_es)
                              : (meal.title || full?.title);
                            const img = foodImageUrl(full?.image);
                            return (
                              <div key={mi} className="rounded-xl p-3 flex gap-3" style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                                {img ? (
                                  <img src={img} alt={mealTitle} className="w-16 h-16 rounded-xl object-cover shrink-0" loading="lazy" />
                                ) : (
                                  <div className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center" style={{ backgroundColor: TT.surface }}>
                                    <UtensilsCrossed size={20} style={{ color: TT.textMute }} />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: slot.color }}>{slot.label}</span>
                                  <p className="text-[13px] font-semibold truncate mb-1" style={{ color: TT.text }}>{mealTitle}</p>
                                  <div className="flex items-center gap-2.5 text-[10px]">
                                    <span style={{ color: TT.accent }}>{meal.calories} {t('common:cal', 'cal')}</span>
                                    <span style={{ color: '#60A5FA' }}>{meal.protein}g {t('trainerClientDetail.macros.gramsProtein', 'P')}</span>
                                    <span style={{ color: '#34D399' }}>{meal.carbs}g {t('trainerClientDetail.macros.gramsCarbs', 'C')}</span>
                                    <span style={{ color: '#F472B6' }}>{meal.fat}g {t('trainerClientDetail.macros.gramsFat', 'F')}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="text-center py-12 px-4">
                  <UtensilsCrossed size={28} className="mx-auto mb-2" style={{ color: TT.textMute }} />
                  <p className="text-[13px]" style={{ color: TT.textMute }}>
                    {t('trainerPlans.noMealsInPlan', 'This plan only has macro targets — no generated meals were saved.')}
                  </p>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderTop: `1px solid ${TT.border}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
              <button onClick={() => toggleMealPlanActive(mealDetail)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px] tt-tap"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {mealDetail.is_active ? t('trainerPlans.deactivate', 'Deactivate') : t('trainerPlans.activate', 'Activate')}
              </button>
              <button onClick={() => setConfirmDeleteMealPlan(mealDetail)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px] tt-tap"
                style={{ background: TT.hotSoft, color: TT.hot }}>
                {t('trainerPlans.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate plan → "which client?" picker */}
      {duplicateTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDuplicateTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
              {t('trainerPlans.duplicateForTitle', 'Duplicate "{{name}}"', { name: duplicateTarget.name })}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.duplicateForBody', 'Who is the copy for?')}
            </p>
            <select
              value={duplicateClientId}
              onChange={e => setDuplicateClientId(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
              style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }}
            >
              <option value="">{t('trainerPlans.selectClient', 'Select client...')}</option>
              {/* Original client first (even if deactivated) so "same client" stays possible */}
              {duplicateTarget.client_id && !clients.some(c => c.id === duplicateTarget.client_id) && (
                <option value={duplicateTarget.client_id}>
                  {(duplicateTarget.profiles?.full_name || t('trainerPlans.formerClient', 'Former client'))}{` ${t('trainerPlans.clientInactiveSuffix', '(inactive)')}`}
                </option>
              )}
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setDuplicateTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {t('trainerPlans.cancel', 'Cancel')}
              </button>
              <button onClick={confirmDuplicatePlan} disabled={!duplicateClientId || duplicating}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold min-h-[44px] disabled:opacity-40 flex items-center justify-center gap-1.5"
                style={{ background: TT.accent, color: '#06363B' }}>
                {duplicating ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                {t('trainerPlans.duplicate', 'Duplicate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate confirmation (manual picks/swaps would be discarded) */}
      {confirmRegen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmRegen(false)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
              {t('trainerPlans.regenConfirmTitle', 'Regenerate the whole week?')}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.regenConfirmBody', 'You swapped or hand-picked some meals. Regenerating replaces everything with a fresh plan.')}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setConfirmRegen(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {t('trainerPlans.cancel', 'Cancel')}
              </button>
              <button onClick={() => { setConfirmRegen(false); handleGenerateMeals(); }}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px]"
                style={{ background: TT.hotSoft, color: TT.hot }}>
                {t('trainerPlans.regenConfirmAction', 'Regenerate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meal-plan delete confirmation */}
      {confirmDeleteMealPlan && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteMealPlan(null)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
              {t('trainerPlans.confirmDelete', 'Delete "{{name}}"?', { name: confirmDeleteMealPlan.name })}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.confirmDeleteDescription', 'This action cannot be undone. The plan will be permanently removed.')}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setConfirmDeleteMealPlan(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {t('trainerPlans.cancel', 'Cancel')}
              </button>
              <button onClick={() => deleteMealPlan(confirmDeleteMealPlan)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px]"
                style={{ background: TT.hotSoft, color: TT.hot }}>
                {t('trainerPlans.deleteConfirm', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, Dumbbell,
  ClipboardList, Search, ToggleLeft, ToggleRight, ArrowLeft, StickyNote,
  ChevronUp, FileText, Calendar, Zap, Loader2, RefreshCw, Pencil,
  Activity, Target, MoreHorizontal, Minus, GripVertical, Link2, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useScrollLock } from '../../hooks/useScrollLock';
import { readTrainerCache, writeTrainerCache } from '../../lib/trainerCache';
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
import { validateImageFile } from '../../lib/validateImage';

// Resolve a meal image: full URLs (uploaded custom-meal photos) pass through;
// catalog paths go through the food-images resolver.
const mealImgSrc = (img) => (img ? (/^https?:\/\//.test(img) ? img : foodImageUrl(img)) : null);
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

// Transient per-row id — stable identity for drag-reorder + React keys within
// a session. NOT persisted (stripped in buildWeeksPayload). `ss` IS persisted:
// it's the superset-group token (null | 'A' | 'B' …) shared by consecutive
// exercises that should run as a superset.
let _uidSeq = 0;
const newUid = () => `x${(_uidSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const normalizeExercise = (ex) => {
  if (typeof ex === 'string') return { _uid: newUid(), id: ex, sets: DEFAULT_SETS, reps: DEFAULT_REPS, rest_seconds: DEFAULT_REST, notes: '', ss: null };
  return {
    _uid: ex._uid || newUid(),
    id: ex.id,
    sets: ex.sets ?? DEFAULT_SETS,
    reps: ex.reps ?? DEFAULT_REPS,
    rest_seconds: ex.rest_seconds ?? DEFAULT_REST,
    notes: ex.notes ?? '',
    ss: ex.ss ?? null,
  };
};

// Next free superset-group letter within a day's exercise list.
const nextSS = (items) => {
  const used = new Set(items.map(x => x.ss).filter(Boolean));
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.has(c)) return c; }
  return 'Z' + items.length;
};

// Group consecutive items sharing a non-null `ss` into superset runs (≥2).
const groupExercises = (items) => {
  const out = []; let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.ss) {
      const run = [it]; let j = i + 1;
      while (j < items.length && items[j].ss === it.ss) { run.push(items[j]); j++; }
      if (run.length > 1) { out.push({ type: 'ss', ss: it.ss, items: run }); i = j; continue; }
    }
    out.push({ type: 'single', items: [it] }); i++;
  }
  return out;
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

// ── Tap-to-type number stepper (keeps +/−, but the value itself is editable) ──
const Stepper = ({ value, onChange, suffix = '', min = 0, max = 999, step = 1, w = 42, accent = false }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  const commit = () => {
    let n = parseInt(draft, 10);
    if (isNaN(n)) n = value;
    n = Math.max(min, Math.min(max, n));
    onChange(n); setEditing(false);
  };
  const bump = (dir) => onChange(Math.max(min, Math.min(max, value + dir * step)));
  const btn = (dir) => (
    <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => bump(dir)}
      className="flex items-center justify-center rounded-lg active:scale-90 transition-transform flex-shrink-0"
      style={{ width: 30, height: 30, background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
      {dir < 0 ? <Minus size={14} /> : <Plus size={14} />}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-1.5">
      {btn(-1)}
      <div onPointerDown={e => e.stopPropagation()} onClick={() => { setDraft(String(value)); setEditing(true); }}
        className="flex items-center justify-center cursor-text"
        style={{
          minWidth: w, height: 30, padding: '0 6px', borderRadius: 9,
          background: editing ? TT.surface : (accent ? TT.accentSoft : 'transparent'),
          border: `1.5px solid ${editing ? TT.accent : 'transparent'}`,
          boxShadow: editing ? `0 0 0 3px ${TT.accentSoft}` : 'none',
        }}>
        {editing ? (
          <input ref={inputRef} value={draft} inputMode="numeric"
            onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}
            className="bg-transparent text-center outline-none p-0"
            style={{ width: w - 8, fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text }} />
        ) : (
          <span style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: accent ? TT.accentInk : TT.text, fontVariantNumeric: 'tabular-nums' }}>{value}{suffix}</span>
        )}
      </div>
      {btn(1)}
    </div>
  );
};

// ── Free-text mini field for rep ranges ("8-12"), tap-to-type ──
const TextStepField = ({ value, onChange, w = 64, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const commit = () => { onChange((draft ?? '').toString().trim() || value); setEditing(false); };
  return (
    <div onPointerDown={e => e.stopPropagation()} onClick={() => { setDraft(value); setEditing(true); }}
      className="flex items-center justify-center cursor-text"
      style={{
        minWidth: w, height: 30, padding: '0 10px', borderRadius: 9,
        background: editing ? TT.surface : TT.accentSoft,
        border: `1.5px solid ${editing ? TT.accent : 'transparent'}`,
        boxShadow: editing ? `0 0 0 3px ${TT.accentSoft}` : 'none',
      }}>
      {editing ? (
        <input ref={ref} value={draft} placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          className="bg-transparent text-center outline-none p-0"
          style={{ width: w - 8, fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text }} />
      ) : (
        <span style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.accentInk }}>{value}</span>
      )}
    </div>
  );
};

// ── Pointer drag-to-reorder (replaces the up/down arrows). The grabbed card
//    LIFTS and tracks the finger (translateY) while the list live-reorders by
//    midpoint crossing underneath; the follow offset is compensated for each
//    reorder shift so the card stays glued to the pointer. Stable handlers read
//    the latest ids/onReorder from a ref so window listeners attach/detach
//    cleanly. ──
const DRAG_GAP = 8; // matches the `space-y-2` (0.5rem) gap between cards
function useDragSort(ids, onReorder) {
  const [drag, setDrag] = useState(null); // { id, startY, y, from, h }
  const latest = useRef({ ids, onReorder });
  latest.current.ids = ids;
  latest.current.onReorder = onReorder;
  const st = useRef({});
  const h = useRef(null);
  if (!h.current) {
    const move = (e) => {
      const s = st.current;
      if (!s.id) return;
      setDrag(d => (d ? { ...d, y: e.clientY } : d));
      let idx = 0;
      for (let i = 0; i < s.rects.length; i++) {
        const mid = s.rects[i].rect.top + s.rects[i].rect.height / 2;
        if (e.clientY > mid) idx = i + 1;
      }
      const cur = s.order.indexOf(s.id);
      idx = Math.max(0, Math.min(s.order.length - 1, idx > cur ? idx - 1 : idx));
      if (idx !== s.lastIndex) {
        const next = s.order.filter(x => x !== s.id);
        next.splice(idx, 0, s.id);
        s.order = next; s.lastIndex = idx;
        latest.current.onReorder(next.slice());
      }
    };
    const end = () => {
      st.current = {};
      setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    const start = (id, e, rowEl) => {
      e.preventDefault(); e.stopPropagation();
      const root = rowEl?.closest('[data-dragroot]');
      if (!root) return;
      const rows = Array.from(root.querySelectorAll('[data-dragitem]'));
      const rects = rows.map(r => ({ id: r.getAttribute('data-dragitem'), rect: r.getBoundingClientRect() }));
      const from = latest.current.ids.indexOf(id);
      const cardH = rects[from]?.rect.height || 0;
      st.current = { id, order: latest.current.ids.slice(), rects, lastIndex: from };
      setDrag({ id, startY: e.clientY, y: e.clientY, from, h: cardH });
      try { rowEl.setPointerCapture(e.pointerId); } catch (_) { /* capture optional */ }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    };
    h.current = { start, end };
  }
  useEffect(() => () => h.current?.end?.(), []);
  // translateY for the grabbed card: follow the finger, minus the flow shift
  // already applied by live reordering, so it stays under the pointer.
  const draggedTranslate = () => {
    if (!drag) return 0;
    const curIndex = latest.current.ids.indexOf(drag.id);
    return (drag.y - drag.startY) - (curIndex - drag.from) * (drag.h + DRAG_GAP);
  };
  return { dragId: drag?.id ?? null, draggedTranslate, start: h.current.start };
}

// ── Custom-weeks input — holds a draft string so the field can be CLEARED and
//    retyped. A plain controlled number input bound to durationWeeks snapped
//    back to the current value on empty, so you couldn't erase "4" to type "5"
//    (it became "45"). Commits live when 1–52; clamps/reverts on blur. ──
const CustomWeeksInput = ({ value, onCommit, color, ariaLabel }) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <input type="number" inputMode="numeric" min={1} max={52}
      value={draft}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const v = parseInt(raw, 10);
        if (!isNaN(v) && v >= 1 && v <= 52) onCommit(v);
      }}
      onBlur={() => {
        const v = parseInt(draft, 10);
        if (isNaN(v) || v < 1) { setDraft(String(value)); }
        else { const c = Math.min(52, v); onCommit(c); setDraft(String(c)); }
      }}
      aria-label={ariaLabel}
      className="w-9 bg-transparent text-center text-[12px] font-semibold outline-none"
      style={{ color }} />
  );
};

// ── Exercise picker — member-style live search, muscle + equipment filter
//    chips, tap-to-toggle multi-select, running-count footer. Rendered inside
//    a bottom sheet by PlanBuilder (replaces the old per-day inline panel). ──
const ExercisePicker = ({ exercises, onAddMany, onClose, exLabel, muscleLabelFor, t }) => {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('all');
  const [equipment, setEquipment] = useState('all');
  const [sel, setSel] = useState({}); // id -> ex
  const equipmentLabelFor = useCallback((eq) => (eq ? t(`equipment.${eq}`, eq) : ''), [t]);

  const muscles = useMemo(() => {
    const present = new Set(exercises.map(e => e.muscle_group).filter(Boolean));
    return ['all', ...[...present].sort()];
  }, [exercises]);
  const equipmentList = useMemo(() => {
    const present = new Set(exercises.map(e => e.equipment).filter(Boolean));
    return ['all', ...[...present].sort()];
  }, [exercises]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return exercises.filter(e => {
      if (muscle !== 'all' && e.muscle_group !== muscle) return false;
      if (equipment !== 'all' && e.equipment !== equipment) return false;
      if (!query) return true;
      return e.name?.toLowerCase().includes(query) ||
        e.name_es?.toLowerCase().includes(query) ||
        e.muscle_group?.toLowerCase().includes(query) ||
        muscleLabelFor(e.muscle_group)?.toLowerCase().includes(query) ||
        e.equipment?.toLowerCase().includes(query) ||
        equipmentLabelFor(e.equipment)?.toLowerCase().includes(query);
    });
  }, [exercises, q, muscle, equipment, muscleLabelFor, equipmentLabelFor]);

  const selCount = Object.keys(sel).length;
  const toggle = (ex) => setSel(s => { const n = { ...s }; if (n[ex.id]) delete n[ex.id]; else n[ex.id] = ex; return n; });

  const chip = (active) => ({
    flexShrink: 0, height: 34, padding: '0 13px', borderRadius: 999, cursor: 'pointer',
    fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
    border: `1.5px solid ${active ? TT.accent : TT.border}`,
    background: active ? TT.accent : TT.surface,
    color: active ? '#fff' : TT.textSub,
    boxShadow: active ? TT.shadow : 'none',
  });

  return (
    <div className="flex flex-col h-full relative" style={{ background: TT.bg }}>
      {/* grabber */}
      <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
        <div style={{ width: 40, height: 5, borderRadius: 999, background: TT.borderStrong }} />
      </div>
      {/* header + search */}
      <div className="px-4 pt-1 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[19px] font-extrabold" style={{ fontFamily: TFont.display, color: TT.text, letterSpacing: -0.4 }}>
            {t('trainerPlans.addExercises', 'Add exercises')}
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: TT.surface2, color: TT.textSub }}>
            <X size={17} />
          </button>
        </div>
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: TT.textMute }} />
          <input value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder={t('trainerPlans.searchExercisesFull', 'Search by name, muscle or equipment…')}
            className="w-full rounded-2xl pl-11 pr-10 outline-none"
            style={{ height: 50, fontSize: 16, fontWeight: 500, background: TT.surface, border: `1.5px solid ${TT.border}`, color: TT.text }}
            onFocus={e => { e.target.style.borderColor = TT.accent; }}
            onBlur={e => { e.target.style.borderColor = TT.border; }} />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: TT.surface2, color: TT.textSub }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {/* filter chips */}
      <div className="flex-shrink-0 space-y-2 pb-2">
        <div className="flex gap-1.5 overflow-x-auto px-4 scrollbar-hide" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          <button onClick={() => setMuscle('all')} style={chip(muscle === 'all')}>{t('trainerPlans.allMuscles', 'All')}</button>
          {muscles.filter(m => m !== 'all').map(m => (
            <button key={m} onClick={() => setMuscle(muscle === m ? 'all' : m)} style={chip(muscle === m)}>{muscleLabelFor(m)}</button>
          ))}
        </div>
        {equipmentList.length > 2 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 scrollbar-hide" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            <button onClick={() => setEquipment('all')} style={chip(equipment === 'all')}>{t('trainerPlans.allEquipment', 'All equipment')}</button>
            {equipmentList.filter(e => e !== 'all').map(eq => (
              <button key={eq} onClick={() => setEquipment(equipment === eq ? 'all' : eq)} style={chip(equipment === eq)}>{equipmentLabelFor(eq)}</button>
            ))}
          </div>
        )}
      </div>
      {/* results */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-1" style={{ paddingBottom: selCount ? 100 : 24, WebkitOverflowScrolling: 'touch' }}>
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: TT.textMute }}>{q ? t('trainerPlans.results', 'Results') : t('trainerPlans.exercisesLabel', 'Exercises')}</span>
          <span className="text-[11px] font-bold" style={{ color: TT.textMute }}>{results.length}</span>
        </div>
        {results.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[14px] font-bold" style={{ color: TT.textSub }}>{t('trainerPlans.noExercisesFound', 'No exercises found')}</p>
            <p className="text-[12px] mt-1" style={{ color: TT.textMute }}>{t('trainerPlans.tryAnother', 'Try another name or clear the filters.')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {results.map(ex => {
              const selected = !!sel[ex.id];
              const mc = getMuscleColor(ex.muscle_group);
              return (
                <button key={ex.id} onClick={() => toggle(ex)}
                  className="w-full flex items-center gap-3 text-left rounded-2xl px-3 py-2.5 active:scale-[0.99] transition-transform"
                  style={{ background: selected ? TT.accentSoft : TT.surface, border: `1.5px solid ${selected ? TT.accent : TT.border}` }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: mc.bg, color: mc.text }}>
                    <Dumbbell size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold truncate" style={{ fontFamily: TFont.display, color: TT.text }}>{exLabel(ex)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {ex.muscle_group && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: mc.bg, color: mc.text }}>{muscleLabelFor(ex.muscle_group)}</span>}
                      {ex.equipment && <span className="text-[11px] truncate" style={{ color: TT.textMute }}>{equipmentLabelFor(ex.equipment)}</span>}
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: selected ? TT.accent : TT.surface2, border: selected ? 'none' : `1.5px solid ${TT.border}` }}>
                    {selected ? <Check size={16} color="#fff" /> : <Plus size={16} style={{ color: TT.textSub }} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* footer */}
      {selCount > 0 && (
        <div className="absolute left-0 right-0 bottom-0 px-4 pt-4" style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', background: `linear-gradient(to top, ${TT.bg} 72%, transparent)` }}>
          <button onClick={() => onAddMany(Object.values(sel))}
            className="w-full flex items-center justify-center gap-2.5 rounded-2xl active:scale-[0.99] transition-transform"
            style={{ height: 54, background: TT.accent, color: '#fff', fontFamily: TFont.display, fontSize: 16, fontWeight: 800, boxShadow: '0 8px 22px rgba(30,156,142,0.34)' }}>
            <span className="flex items-center justify-center rounded-full" style={{ width: 26, height: 26, background: 'rgba(255,255,255,0.22)', fontSize: 14, fontWeight: 800 }}>{selCount}</span>
            {selCount === 1 ? t('trainerPlans.addOneExercise', 'Add exercise') : t('trainerPlans.addManyExercises', 'Add {{n}} exercises', { n: selCount })}
          </button>
        </div>
      )}
    </div>
  );
};

// ── Day Card (Direction A — drag-grip reorder, tap-to-type, supersets) ──
const DayCard = ({ day, di, wk, exMuscle, exName, muscleLabelFor, updateDayName, removeDay, onAddExercise, removeExercise, updateExercise, duplicateExercise, reorderExercises, linkExercise, unlinkSuperset, copyDayMenu, setCopyDayMenu, setCopyWeekMenu, allDayTargets, copyDayTo, t }) => {
  const dayTime = calcDaySeconds(day);
  const showCopyDay = copyDayMenu?.wk === wk && copyDayMenu?.di === di;
  const dayTargets = allDayTargets(wk, di);
  const [expanded, setExpanded] = useState(true);
  const [expandedNotes, setExpandedNotes] = useState({});
  const toggleNote = (key) => setExpandedNotes(prev => ({ ...prev, [key]: !prev[key] }));

  const items = day.exercises;
  const orderIds = items.map(e => e._uid);
  const { dragId, draggedTranslate, start } = useDragSort(orderIds, (ids) => reorderExercises(wk, di, ids));
  const groups = groupExercises(items);

  // One white exercise card. `ei` is its live index (for the index-based
  // update/remove/duplicate handlers); drag identity is the stable `_uid`.
  const exerciseCard = (ex) => {
    const ei = items.findIndex(x => x._uid === ex._uid);
    const mg = exMuscle(ex.id);
    const mc = getMuscleColor(mg);
    const dragging = dragId === ex._uid;
    const ty = dragging ? draggedTranslate() : 0;
    const noteOpen = expandedNotes[ex._uid] || ex.notes;
    const labelCol = { fontSize: 12, fontWeight: 600, color: TT.textSub };
    return (
      <div key={ex._uid} data-dragitem={ex._uid}
        className="rounded-2xl px-3 pt-3 pb-3.5"
        style={{
          background: TT.surface,
          border: `1.5px solid ${dragging ? TT.accent : TT.border}`,
          boxShadow: dragging ? TT.shadowLg : '0 1px 2px rgba(0,0,0,0.04)',
          transform: dragging ? `translateY(${ty}px) scale(1.03)` : 'none',
          opacity: dragging ? 0.97 : 1,
          position: 'relative', zIndex: dragging ? 30 : 1,
          // grabbed card tracks the finger 1:1 (no transition); on drop it
          // settles into its new slot with a short ease.
          transition: dragging ? 'none' : 'transform 170ms cubic-bezier(0.2,0.9,0.3,1), box-shadow 140ms',
          willChange: dragging ? 'transform' : undefined,
        }}>
        {/* row 1: grip + name/muscle + duplicate + delete */}
        <div className="flex items-center gap-2">
          <div onPointerDown={(e) => start(ex._uid, e, e.currentTarget.closest('[data-dragitem]'))}
            className="flex items-center justify-center flex-shrink-0 -ml-1"
            style={{ width: 28, height: 36, cursor: 'grab', touchAction: 'none', color: TT.textMute }}>
            <GripVertical size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold truncate" style={{ fontFamily: TFont.display, color: TT.text }}>{exName(ex.id)}</p>
            {mg && <span className="inline-block mt-1 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: mc.bg, color: mc.text }}>{muscleLabelFor(mg)}</span>}
          </div>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => duplicateExercise(wk, di, ei)}
            aria-label={t('trainerPlans.duplicate', 'Duplicate')}
            className="w-8 h-9 flex items-center justify-center flex-shrink-0" style={{ color: TT.textMute }}>
            <Copy size={15} />
          </button>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => removeExercise(wk, di, ei)}
            aria-label={t('trainerPlans.remove', 'Remove')}
            className="w-8 h-9 flex items-center justify-center flex-shrink-0 -mr-1" style={{ color: TT.textMute }}
            onMouseEnter={e => { e.currentTarget.style.color = TT.hot; }}
            onMouseLeave={e => { e.currentTarget.style.color = TT.textMute; }}>
            <Trash2 size={15} />
          </button>
        </div>
        {/* row 2: series + reps */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-2.5 mt-3 pl-6">
          <div className="flex items-center gap-2">
            <span style={labelCol}>{t('trainerPlans.sets', 'Sets')}</span>
            <Stepper value={ex.sets ?? DEFAULT_SETS} onChange={v => updateExercise(wk, di, ei, 'sets', v)} min={1} max={12} w={40} accent />
          </div>
          <div className="flex items-center gap-2">
            <span style={labelCol}>{t('trainerPlans.reps', 'Reps')}</span>
            <TextStepField value={ex.reps ?? DEFAULT_REPS} onChange={v => updateExercise(wk, di, ei, 'reps', v)} placeholder={t('trainerPlans.repsPlaceholder', '8-12')} />
          </div>
        </div>
        {/* row 3: rest + note toggle */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-2.5 mt-2.5 pl-6">
          <div className="flex items-center gap-2">
            <span style={labelCol}>{t('trainerPlans.rest', 'Rest')}</span>
            <Stepper value={ex.rest_seconds ?? DEFAULT_REST} onChange={v => updateExercise(wk, di, ei, 'rest_seconds', v)} suffix="s" min={0} max={600} step={15} w={54} />
          </div>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => toggleNote(ex._uid)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
            style={{ color: noteOpen ? TT.accentInk : TT.textMute }}>
            <StickyNote size={14} /> {ex.notes ? t('trainerPlans.noteAdded', 'Note added') : t('trainerPlans.addNote', 'Add note')}
          </button>
        </div>
        {/* note textarea — pinned mounted until blurred empty */}
        {noteOpen ? (
          <textarea value={ex.notes || ''} onPointerDown={e => e.stopPropagation()}
            onChange={e => updateExercise(wk, di, ei, 'notes', e.target.value)}
            onFocus={() => setExpandedNotes(prev => ({ ...prev, [ex._uid]: true }))}
            onBlur={e => { if (!e.target.value.trim()) setExpandedNotes(prev => ({ ...prev, [ex._uid]: false })); }}
            maxLength={500} rows={2}
            placeholder={t('trainerPlans.trainerNotesPlaceholder', 'e.g., Tempo 3-1-2, pause at bottom')}
            className="mt-2.5 ml-6 rounded-xl px-3 py-2 text-[16px] sm:text-[13px] outline-none resize-none"
            style={{ width: 'calc(100% - 1.5rem)', background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.textSub }} />
        ) : null}
      </div>
    );
  };

  return (
    <div className="rounded-2xl overflow-visible" style={{ border: `1px solid ${TT.border}`, background: TT.surface2 }}>
      {/* Day header - whole header tappable for expand/collapse */}
      <div
        className="flex items-center gap-1 md:gap-2 px-3 md:px-4 py-3 rounded-t-2xl cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown size={16} className={`transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} style={{ color: TT.textMute }} />
        <input value={day.name} onChange={e => updateDayName(wk, di, e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder={t('trainerPlans.dayPrefix', 'Day {{num}}', { num: di + 1 })}
          className="flex-1 bg-transparent text-[15px] font-extrabold outline-none min-w-0" style={{ fontFamily: TFont.display, color: TT.text }} />
        <span className="text-[11px] flex-shrink-0 flex items-center gap-1.5" style={{ color: TT.textMute }}>
          <span>{items.length} {t('trainerPlans.ex', 'ex')}</span>
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
                  onMouseEnter={e => { e.currentTarget.style.background = TT.surface; }}
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
        <div className="px-3 md:px-4 pb-4 pt-2">
          {/* Empty state */}
          {items.length === 0 && (
            <div className="py-8 text-center">
              <Dumbbell size={24} className="mx-auto mb-2" style={{ color: TT.textMute }} />
              <p className="text-[12px]" style={{ color: TT.textMute }}>{t('trainerPlans.noExercisesYet', 'No exercises yet')}</p>
              <p className="text-[10px] mt-0.5" style={{ color: TT.textMute }}>{t('trainerPlans.addExercisesHint', 'Add exercises or auto-generate')}</p>
            </div>
          )}

          {items.length > 0 && (
            <div data-dragroot className="space-y-2">
              {groups.map((g) => {
                if (g.type === 'ss') {
                  return (
                    <div key={g.ss} className="rounded-2xl p-2" style={{ background: TT.accentSoft, border: `1.5px solid color-mix(in srgb, ${TT.accent} 28%, transparent)` }}>
                      <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2">
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider" style={{ color: TT.accentInk }}>
                          <Link2 size={13} /> {t('trainerPlans.superset', 'Superset')} {g.ss}
                        </span>
                        <button onClick={() => unlinkSuperset(wk, di, g.ss)} className="text-[11px] font-bold" style={{ color: TT.textMute }}>
                          {t('trainerPlans.separate', 'Separate')}
                        </button>
                      </div>
                      <div className="space-y-2">{g.items.map(it => exerciseCard(it))}</div>
                    </div>
                  );
                }
                const it = g.items[0];
                const gi = items.findIndex(x => x._uid === it._uid);
                return (
                  <div key={it._uid}>
                    {gi > 0 && dragId == null && (
                      <div className="flex justify-center py-0.5 -my-0.5">
                        <button onClick={() => linkExercise(wk, di, gi)} onPointerDown={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-colors"
                          style={{ background: TT.surface, border: `1.5px dashed ${TT.borderStrong}`, color: TT.textSub }}>
                          <Link2 size={12} /> {t('trainerPlans.superset', 'Superset')}
                        </button>
                      </div>
                    )}
                    {exerciseCard(it)}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add exercise — opens the multi-select picker sheet */}
          <button onClick={onAddExercise}
            className="w-full mt-2 py-3.5 rounded-2xl border-2 border-dashed transition-colors flex items-center justify-center gap-2 min-h-[44px] active:scale-[0.99]"
            style={{ borderColor: TT.borderStrong, color: TT.accentInk }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = TT.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = TT.borderStrong; }}>
            <Plus size={17} />
            <span className="text-[13.5px] font-bold" style={{ fontFamily: TFont.display }}>{t('trainerPlans.addExercise', 'Add Exercise')}</span>
          </button>
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
  const [pickerTarget, setPickerTarget] = useState(null); // { wk, di } for the add-exercise sheet
  useScrollLock(!!confirmPrune || confirmDiscard || !!pickerTarget); // lock page behind builder dialogs/sheets
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
  // `_uid` is a transient per-row drag id (regenerated each load) — exclude it
  // from the signature so a freshly-opened plan never reads as already-edited.
  const planSig = (o) => JSON.stringify(o, (k, v) => (k === '_uid' ? undefined : v));
  const initialSnapshot = useRef(null);
  if (initialSnapshot.current === null) {
    initialSnapshot.current = planSig({
      clientId: init.client_id || '',
      name: init.name ?? '',
      description: init.description ?? '',
      durationWeeks: init.duration_weeks ?? 4,
      weeks: normalizeWeeks(init.weeks, t),
    });
  }
  const isDirty = () => initialSnapshot.current !== planSig({ clientId, name, description, durationWeeks, weeks });
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

      setWeeks(normalizeWeeks(newWeeks, t)); // ensure _uid + ss on generated rows
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

  const exById = useMemo(() => new Map(exercises.map(e => [e.id, e])), [exercises]);
  const exName = (id) => {
    const ex = exById.get(id);
    return ex ? exLabel(ex) : id;
  };
  const exMuscle = (id) => exById.get(id)?.muscle_group || null;

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
  // Multi-add from the picker sheet (a list of library exercise rows).
  const addExercises = (wk, di, list) => {
    if (!list?.length) return;
    setWeeks(prev => ({
      ...prev,
      [wk]: prev[wk].map((d, i) => i === di
        ? { ...d, exercises: [...d.exercises, ...list.map(ex => ({ _uid: newUid(), id: ex.id, sets: DEFAULT_SETS, reps: DEFAULT_REPS, rest_seconds: DEFAULT_REST, notes: '', ss: null }))] }
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
  const duplicateExercise = (wk, di, ei) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => {
      if (i !== di) return d;
      const exs = d.exercises.slice();
      const src = exs[ei];
      if (!src) return d;
      exs.splice(ei + 1, 0, { ...src, _uid: newUid(), ss: null });
      return { ...d, exercises: exs };
    }),
  }));
  // Reorder a day's exercises to a new order of stable `_uid`s (from drag-sort).
  const reorderExercises = (wk, di, orderedUids) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => {
      if (i !== di) return d;
      const byUid = new Map(d.exercises.map(e => [e._uid, e]));
      const next = orderedUids.map(u => byUid.get(u)).filter(Boolean);
      return next.length === d.exercises.length ? { ...d, exercises: next } : d;
    }),
  }));
  // Superset: link the exercise at `ei` with the one above it (shared token).
  const linkExercise = (wk, di, ei) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => {
      if (i !== di || ei <= 0) return d;
      const exs = d.exercises.slice();
      const ss = exs[ei - 1].ss || nextSS(exs);
      exs[ei - 1] = { ...exs[ei - 1], ss };
      exs[ei] = { ...exs[ei], ss };
      return { ...d, exercises: exs };
    }),
  }));
  const unlinkSuperset = (wk, di, ss) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.map(ex => ex.ss === ss ? { ...ex, ss: null } : ex) }
      : d
    ),
  }));

  // Save. Weeks beyond the chosen duration are PRUNED from the JSON (an
  // 8→4-week shrink used to keep orphan keys 5-8, corrupting counts/chips).
  // If pruned weeks contain exercises we confirm first.
  const buildWeeksPayload = () => {
    const kept = {};
    Object.entries(weeks).forEach(([wk, days]) => {
      if (Number(wk) <= durationWeeks) {
        kept[wk] = (days || []).map(d => ({
          ...d,
          // strip transient drag id; keep `ss` (superset group) — it persists.
          exercises: (d.exercises || []).map(({ _uid, ...ex }) => ex),
        }));
      }
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
                <CustomWeeksInput value={durationWeeks} onCommit={setDuration}
                  ariaLabel={t('trainerPlans.customWeeks', 'Custom weeks')}
                  color={isCustomDuration ? '#06363B' : TT.text} />
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
                  <CustomWeeksInput value={durationWeeks} onCommit={setDuration}
                    ariaLabel={t('trainerPlans.customWeeks', 'Custom weeks')}
                    color={isCustomDuration ? TT.accentInk : TT.text} />
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
                exMuscle={exMuscle}
                exName={exName}
                muscleLabelFor={muscleLabelFor}
                updateDayName={updateDayName}
                removeDay={removeDay}
                onAddExercise={() => setPickerTarget({ wk: selectedWeek, di })}
                removeExercise={removeExercise}
                updateExercise={updateExercise}
                duplicateExercise={duplicateExercise}
                reorderExercises={reorderExercises}
                linkExercise={linkExercise}
                unlinkSuperset={unlinkSuperset}
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

      {/* ── Add-exercise picker (bottom sheet, multi-select) ── */}
      {pickerTarget && createPortal(
        <div className="fixed inset-0 z-[95] flex flex-col justify-end">
          <div className="absolute inset-0" style={{ background: 'rgba(8,10,12,0.5)' }} onClick={() => setPickerTarget(null)} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="relative w-full mx-auto max-w-[480px] overflow-hidden"
            style={{ height: '88vh', background: TT.bg, borderRadius: '24px 24px 0 0', boxShadow: TT.shadowLg }}>
            <ExercisePicker
              exercises={exercises}
              exLabel={exLabel}
              muscleLabelFor={muscleLabelFor}
              t={t}
              onClose={() => setPickerTarget(null)}
              onAddMany={(list) => { addExercises(pickerTarget.wk, pickerTarget.di, list); setPickerTarget(null); }}
            />
          </motion.div>
        </div>,
        document.body,
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
  const [plans, setPlans]       = useState(() => readTrainerCache(`tplans:workout:${profile?.id}`) || []);
  const [clients, setClients]   = useState(() => readTrainerCache(`tplans:clients:${profile?.id}`) || []);
  const [loading, setLoading]   = useState(() => !readTrainerCache(`tplans:workout:${profile?.id}`));
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
  const [mealPlans, setMealPlans] = useState(() => readTrainerCache(`tplans:meals:${profile?.id}`) || []);
  const [mealPlansLoading, setMealPlansLoading] = useState(() => !readTrainerCache(`tplans:meals:${profile?.id}`));
  const [mealFilterStatus, setMealFilterStatus] = useState('active');
  const [showMealModal, setShowMealModal] = useState(false);
  const [mealForm, setMealForm] = useState({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '', duration_weeks: 4, start_date: '' });
  const [mealSaving, setMealSaving] = useState(false);
  const [mealPrefs, setMealPrefs] = useState({ allergies: [], restrictions: [] }); // client's food prefs, editable for this plan
  const [mealClientProfile, setMealClientProfile] = useState(null);
  const [mealGoalOverride, setMealGoalOverride] = useState(null);
  // Saved meal-plan detail viewer (tap a card → day-by-day meals)
  const [mealDetail, setMealDetail] = useState(null);
  const [mealDetailDay, setMealDetailDay] = useState(0);
  const [mealDetailWeek, setMealDetailWeek] = useState(0);
  const [confirmDeleteMealPlan, setConfirmDeleteMealPlan] = useState(null);
  const GOAL_OPTIONS = ['fat_loss', 'muscle_gain', 'strength', 'endurance', 'general_fitness'];
  const COMMON_ALLERGENS = ['nuts', 'shellfish', 'dairy', 'eggs', 'soy', 'wheat', 'fish'];
  const COMMON_DIETS = ['vegan', 'vegetarian', 'pescatarian', 'keto', 'gluten_free', 'dairy_free', 'halal'];
  const prefLabel = (x) => t(`trainerPlans.pref.${x}`, x.replace(/_/g, ' '));
  const togglePref = (group, val) => setMealPrefs(p => ({
    ...p, [group]: p[group].includes(val) ? p[group].filter(v => v !== val) : [...p[group], val],
  }));

  // Fetch client data when meal form client changes
  useEffect(() => {
    const cid = mealForm.client_id;
    if (!cid) { setMealClientProfile(null); setMealGoalOverride(null); setMealPrefs({ allergies: [], restrictions: [] }); return; }
    (async () => {
      const [obRes, weightRes] = await Promise.all([
        supabase.from('member_onboarding')
          .select('fitness_level, primary_goal, training_days_per_week, height_cm, height_inches, weight_kg, age, gender, sex, dietary_restrictions, food_allergies')
          .eq('profile_id', cid).maybeSingle(),
        supabase.from('body_weight_logs')
          .select('weight_lbs').eq('profile_id', cid).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setMealClientProfile({ onboarding: obRes.data, latestWeight: weightRes.data?.weight_lbs });
      // Seed editable preferences from the client's saved allergies/diet so the
      // trainer sees them and the generator respects them.
      setMealPrefs({
        allergies: Array.isArray(obRes.data?.food_allergies) ? obRes.data.food_allergies : [],
        restrictions: Array.isArray(obRes.data?.dietary_restrictions) ? obRes.data.dietary_restrictions : [],
      });
    })();
  }, [mealForm.client_id]);

  const [mealStep, setMealStep] = useState('settings'); // 'settings' | 'meals'
  const [generatedMeals, setGeneratedMeals] = useState(null); // 7-day plan
  const [generatingMeals, setGeneratingMeals] = useState(false);
  const [mealPreviewDay, setMealPreviewDay] = useState(0);
  const [mealPreviewWeek, setMealPreviewWeek] = useState(0);
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

  // Date range for a given week index of a saved plan (start_date + N weeks).
  const planWeekDates = (plan, weekIdx) => {
    if (!plan?.start_date) return null;
    const start = new Date(`${plan.start_date}T00:00:00`);
    if (isNaN(start.getTime())) return null;
    const ws = new Date(start.getTime() + weekIdx * 7 * 86400000);
    const we = new Date(ws.getTime() + 6 * 86400000);
    return { ws, we };
  };

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
          allergies: mealPrefs.allergies,
          restrictions: mealPrefs.restrictions,
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
        setMealPreviewWeek(0);
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
  const [newMeal, setNewMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', imageUrl: '' });
  const [savingNewMeal, setSavingNewMeal] = useState(false);
  const [uploadingMealPhoto, setUploadingMealPhoto] = useState(false);
  const customMealToMeal = (r) => ({
    id: `custom_${r.id}`,
    title: r.name, title_es: r.name_es || r.name,
    calories: Number(r.calories) || 0, protein: Number(r.protein_g) || 0,
    carbs: Number(r.carbs_g) || 0, fat: Number(r.fat_g) || 0,
    category: r.category || 'custom', custom: true, image: r.image_url || null,
  });
  // Optional meal photo → user-writable meal-photos bucket (own folder).
  const uploadMealPhoto = async (file) => {
    if (!file || !profile?.id) return;
    const check = await validateImageFile(file);
    if (!check?.valid) { showToast(check?.error || t('trainerPlans.photoUploadFailed', 'Could not upload photo'), 'error'); return; }
    setUploadingMealPhoto(true);
    try {
      const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('meal-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('meal-photos').getPublicUrl(path);
      setNewMeal(n => ({ ...n, imageUrl: urlData?.publicUrl || '' }));
    } catch (err) {
      logger.error('uploadMealPhoto failed:', err);
      showToast(t('trainerPlans.photoUploadFailed', 'Could not upload photo'), 'error');
    } finally {
      setUploadingMealPhoto(false);
    }
  };
  useEffect(() => {
    if (!showMealModal || !profile?.id) return;
    let alive = true;
    supabase.from('custom_meals').select('*').eq('created_by', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setCustomMeals((data || []).map(customMealToMeal)); });
    return () => { alive = false; };
  }, [showMealModal, profile?.id]);

  // Close the meal-plan modal AND clear all of its working state, so reopening
  // starts fresh instead of showing the previous plan's data.
  const closeMealModal = () => {
    setShowMealModal(false);
    setMealStep('settings');
    setGeneratedMeals(null);
    setMealForm({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '', duration_weeks: 4, start_date: '' });
    setNewMeal({ name: '', calories: '', protein: '', carbs: '', fat: '', imageUrl: '' });
    setShowAddMeal(false);
    setMealPickerSlot(null);
    setMealSearch('');
    setMealsDirty(false);
    setMealGoalOverride(null);
  };
  const addCustomMeal = async () => {
    if (!newMeal.name.trim() || savingNewMeal) return;
    setSavingNewMeal(true);
    const { data, error } = await supabase.from('custom_meals').insert({
      created_by: profile.id, gym_id: profile.gym_id || null,
      name: newMeal.name.trim(),
      calories: Number(newMeal.calories) || 0, protein_g: Number(newMeal.protein) || 0,
      carbs_g: Number(newMeal.carbs) || 0, fat_g: Number(newMeal.fat) || 0,
      category: 'custom', image_url: newMeal.imageUrl || null,
    }).select('*').single();
    setSavingNewMeal(false);
    if (error) { showToast(t('trainerPlans.addMealFailed', 'Could not add meal'), 'error'); return; }
    const meal = customMealToMeal(data);
    setCustomMeals(prev => [meal, ...prev]);
    setNewMeal({ name: '', calories: '', protein: '', carbs: '', fat: '', imageUrl: '' });
    setShowAddMeal(false);
    pickMeal(meal); // use the new meal immediately in the open slot
  };
  // True once the trainer swapped/hand-picked a meal — Regenerate confirms
  // before throwing that work away.
  const [mealsDirty, setMealsDirty] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  // Lock the page behind any of this view's modals.
  useScrollLock(showMealModal || !!mealPickerSlot || !!confirmDeletePlan || !!mealDetail || !!duplicateTarget || confirmRegen || !!confirmDeleteMealPlan);
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

  // ── Manual meal editing in the builder (add / remove / per-meal fields) ──
  const recomputeTotals = (meals) => ({
    calories: meals.reduce((s, m) => s + (m.calories || 0), 0),
    protein: meals.reduce((s, m) => s + (m.protein || 0), 0),
    carbs: meals.reduce((s, m) => s + (m.carbs || 0), 0),
    fat: meals.reduce((s, m) => s + (m.fat || 0), 0),
  });
  const removeMeal = (dayIdx, mealIdx) => {
    setMealsDirty(true);
    const targets = dayTargets();
    setGeneratedMeals(prev => prev.map((d, di) => {
      if (di !== dayIdx) return d;
      const newMeals = d.meals.filter((_, mi) => mi !== mealIdx);
      const totals = recomputeTotals(newMeals);
      return { ...d, meals: newMeals, totals, fits: computeDayFits(totals, targets) };
    }));
  };
  // Append a blank meal to a day, then open the picker on it. The slot type
  // cycles through breakfast/lunch/snack/dinner so labels stay sensible.
  const addMealToDay = (dayIdx) => {
    setMealsDirty(true);
    const day = generatedMeals[dayIdx];
    const newIdx = day?.meals?.length || 0;
    const slotType = (MEAL_SLOTS[newIdx]?.type) || 'snack';
    setGeneratedMeals(prev => prev.map((d, di) => {
      if (di !== dayIdx) return d;
      const placeholder = { id: `new_${dayIdx}_${newIdx}_${(d.meals?.length || 0)}`, title: t('trainerPlans.newMeal', 'New meal'), title_es: t('trainerPlans.newMeal', 'New meal'), slotType, calories: 0, protein: 0, carbs: 0, fat: 0 };
      return { ...d, meals: [...(d.meals || []), placeholder] };
    }));
    setMealPickerSlot({ dayIdx, mealIdx: newIdx });
    setMealSearch('');
  };
  const updateMealField = (dayIdx, mealIdx, field, value) => {
    setMealsDirty(true);
    setGeneratedMeals(prev => prev.map((d, di) => di !== dayIdx ? d : {
      ...d,
      meals: d.meals.map((m, mi) => mi !== mealIdx ? m : { ...m, [field]: value }),
    }));
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
    // Only show the spinner on a true cold load. With cache present we keep the
    // hydrated list on screen and revalidate silently, so navigating back is
    // instant instead of flashing a spinner over good data.
    if (!readTrainerCache(`tplans:workout:${profile.id}`)) setLoading(true);
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
    const loadedClients = (clientsRes.data || []).map(tc => tc.profiles).filter(Boolean);
    setPlans(loadedPlans);
    setClients(loadedClients);
    // Write through to cache so a revisit renders instantly (skip on error so a
    // failed fetch never overwrites good cached data with empties).
    if (!plansRes.error) writeTrainerCache(`tplans:workout:${profile.id}`, loadedPlans);
    if (!clientsRes.error) writeTrainerCache(`tplans:clients:${profile.id}`, loadedClients);
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
    // Same as loadData: spinner only on cold load, otherwise revalidate silently.
    if (!readTrainerCache(`tplans:meals:${profile.id}`)) setMealPlansLoading(true);
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
        if (!error) writeTrainerCache(`tplans:meals:${profile.id}`, data || []);
        setMealPlans(data || []);
        setMealPlansLoading(false);
      });
  };

  const saveMealPlan = async () => {
    // Client is OPTIONAL — a plan with no client is a general/reusable plan
    // (mirrors the workout builder). Only the name is required.
    if (!mealForm.name.trim()) return;
    setMealSaving(true);
    // Single-active invariant (P2-2) applies PER CLIENT: ClientDetail reads the
    // active plan with .maybeSingle(), so retire this client's currently-active
    // plans first. General (client-less) plans can coexist, so skip when none.
    if (mealForm.client_id) {
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
    }
    // Serialize generated meals into compact JSONB
    const mealsJson = generatedMeals ? generatedMeals.map((day, di) => ({
      day: di + 1,
      meals: (day.meals || []).map(m => ({ id: m.id, slotType: m.slotType || m.slot, title: m.title, title_es: m.title_es, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, category: m.category, prepTime: m.prepTime, time: m.time || null, notes: m.notes || null, image: m.image || null })),
      totals: day.totals,
    })) : [];
    // Plan length → duration_weeks + an end_date the member view counts against.
    const durWeeks = Math.max(1, Math.min(52, parseInt(mealForm.duration_weeks, 10) || 1));
    // Optional trainer-set start date (so the plan isn't generic); default today.
    const startDate = mealForm.start_date ? new Date(`${mealForm.start_date}T00:00:00`) : new Date();
    const endDate = new Date(startDate.getTime() + durWeeks * 7 * 86400000);
    const toISODate = (d) => d.toISOString().split('T')[0];
    const { error } = await supabase.from('trainer_meal_plans').insert({
      gym_id: profile.gym_id,
      trainer_id: profile.id,
      client_id: mealForm.client_id || null,
      name: mealForm.name.trim(),
      description: mealForm.description.trim() || null,
      target_calories: mealForm.target_calories ? parseInt(mealForm.target_calories) : null,
      target_protein_g: mealForm.target_protein_g ? parseInt(mealForm.target_protein_g) : null,
      target_carbs_g: mealForm.target_carbs_g ? parseInt(mealForm.target_carbs_g) : null,
      target_fat_g: mealForm.target_fat_g ? parseInt(mealForm.target_fat_g) : null,
      duration_weeks: durWeeks,
      start_date: toISODate(startDate),
      end_date: toISODate(endDate),
      meals: mealsJson,
    });
    if (error) {
      setMealSaving(false);
      showToast(t('trainerPlans.errorSavingMealPlan', 'Failed to save meal plan'), 'error');
      return;
    }
    posthog?.capture('trainer_meal_plan_created');
    setMealSaving(false);
    setShowMealModal(false);
    setMealForm({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '', duration_weeks: 4, start_date: '' });
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
    // .select() so a silently-blocked delete (RLS → 0 rows, no error) surfaces
    // instead of looking like a no-op.
    const { data, error } = await supabase.from('trainer_meal_plans').delete().eq('id', plan.id).select('id');
    if (error || !data?.length) {
      logger.error('deleteMealPlan failed:', error || 'no rows deleted');
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
    posthog?.capture('trainer_plan_duplicated');
    setDuplicateTarget(null);
    setDuplicateClientId('');
    loadData();
  };

  const deletePlan = async (plan) => {
    const { data, error } = await supabase.from('trainer_workout_plans').delete().eq('id', plan.id).select('id');
    if (error || !data?.length) {
      logger.error('deletePlan failed:', error || 'no rows deleted');
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
            {t('trainerPlans.newPlan', 'New plan')}
          </TPrimaryButton>
        </div>

        {/* Section tabs (Training / Nutrition) — underline tab bar */}
        <div style={{ display: 'flex', marginBottom: 16, borderBottom: `1px solid ${TT.border}` }}>
          {SECTION_TABS.map((tab, i) => {
            const on = sectionIndex === i;
            return (
              <button
                key={tab.key}
                onClick={() => setSectionIndex(i)}
                style={{
                  flex: 1, padding: '10px 4px 11px', background: 'transparent',
                  border: 'none', borderBottom: `2px solid ${on ? TT.accent : 'transparent'}`,
                  marginBottom: -1, cursor: 'pointer',
                  fontFamily: TFont.display, fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                  color: on ? TT.accent : TT.textMute,
                }}
              >
                {tab.label}
              </button>
            );
          })}
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
                              : `${assignedCount} ${assignedCount === 1 ? t('trainerPlans.clientWord', 'client') : t('trainerPlans.clientsWord', 'clients')}`}
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
                  onClick={() => { setMealDetail(plan); setMealDetailDay(0); setMealDetailWeek(0); }}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={closeMealModal}>
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
              <button onClick={closeMealModal} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg" style={{ color: TT.textMute }}>
                <X size={18} />
              </button>
            </div>

            {/* ── STEP 1: Settings ── */}
            {mealStep === 'settings' && (
              <>
                <div className="p-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
                  {/* Client */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: TT.textSub }}>{t('trainerPlans.client', 'Client')}</label>
                    <select value={mealForm.client_id} onChange={e => { setMealForm(f => ({ ...f, client_id: e.target.value })); setMealGoalOverride(null); setGeneratedMeals(null); }}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
                      style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }}>
                      <option value="">{t('trainerPlans.noClientGeneral', 'No client (general plan)')}</option>
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

                  {/* Client food preferences (allergies + diet) — seeded from the
                      client's saved prefs, editable here, fed to meal generation. */}
                  {mealClientProfile?.onboarding && (
                    <div className="rounded-xl p-3" style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-1" style={{ color: TT.accent }}>{t('trainerPlans.preferences', 'Client preferences')}</p>
                      <p className="text-[10px] mb-2" style={{ color: TT.textMute }}>{t('trainerPlans.prefsHint', 'Used to filter the generated meals')}</p>
                      <p className="text-[10px] font-medium mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.allergiesLabel', 'Allergies')}</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {[...new Set([...COMMON_ALLERGENS, ...mealPrefs.allergies])].map(a => {
                          const on = mealPrefs.allergies.includes(a);
                          return (
                            <button key={a} type="button" onClick={() => togglePref('allergies', a)}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors capitalize"
                              style={on ? { background: TT.hot, color: '#fff' } : { background: TT.surface, color: TT.textMute, border: `1px solid ${TT.border}` }}>
                              {prefLabel(a)}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] font-medium mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.dietLabel', 'Diet')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {[...new Set([...COMMON_DIETS, ...mealPrefs.restrictions])].map(d => {
                          const on = mealPrefs.restrictions.includes(d);
                          return (
                            <button key={d} type="button" onClick={() => togglePref('restrictions', d)}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors capitalize"
                              style={on ? { background: TT.accent, color: '#06363B' } : { background: TT.surface, color: TT.textMute, border: `1px solid ${TT.border}` }}>
                              {prefLabel(d)}
                            </button>
                          );
                        })}
                      </div>
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

                  {/* Start date (optional) — set so the plan isn't generic */}
                  <div>
                    <label className="text-[12px] font-medium mb-1 block" style={{ color: TT.textSub }}>{t('trainerPlans.startDate', 'Start date (optional)')}</label>
                    <input type="date" value={mealForm.start_date} onChange={e => setMealForm(f => ({ ...f, start_date: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2.5 text-[16px] sm:text-[14px] outline-none min-h-[44px]"
                      style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
                  </div>
                </div>

                {/* Footer — Step 1 */}
                <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderTop: `1px solid ${TT.border}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                  <button onClick={closeMealModal}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl text-[14px] font-medium min-h-[44px]"
                    style={{ backgroundColor: TT.surface2, color: TT.textSub }}>
                    {t('trainerPlans.cancel', 'Cancel')}
                  </button>
                  <button onClick={handleGenerateMeals}
                    disabled={generatingMeals || !mealForm.target_calories || !mealForm.target_protein_g || !mealForm.name.trim()}
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
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {/* Week selector — the same 7-day plan repeats for N weeks.
                      Dates derive from the chosen start date (or today). */}
                  {(() => {
                    const dw = Math.max(1, Number(mealForm.duration_weeks) || 1);
                    const previewStart = mealForm.start_date
                      ? new Date(`${mealForm.start_date}T00:00:00`)
                      : new Date();
                    const dayDate = (i) => new Date(previewStart.getTime() + (mealPreviewWeek * 7 + i) * 86400000);
                    return (
                      <>
                        {dw > 1 && (
                          <div className="px-4 pt-3">
                            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                              {Array.from({ length: dw }, (_, w) => (
                                <button key={w} onClick={() => setMealPreviewWeek(w)} className="shrink-0 tt-tap"
                                  style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer',
                                    ...(mealPreviewWeek === w ? { background: TT.accent, color: '#06363B' } : { background: TT.surface, color: TT.textSub, boxShadow: 'inset 0 0 0 1px var(--tt-border)' }) }}>
                                  {t('trainerPlans.weekN', 'Week {{n}}', { n: w + 1 })}
                                </button>
                              ))}
                            </div>
                            <p className="text-[10px] mt-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.weeklyRotationNote', 'The same weekly plan repeats each week.')}</p>
                          </div>
                        )}
                        {/* Day selector — Atelier filter chips, with date numbers */}
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
                              {label} {dayDate(i).getDate()}
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}

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
                              {mealImgSrc(meal.image) ? (
                                <img src={mealImgSrc(meal.image)} alt={mealTitle} className="w-16 h-16 rounded-xl object-cover shrink-0" style={{ backgroundColor: TT.surface2 }} loading="lazy" />
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
                                    <button onClick={() => removeMeal(mealPreviewDay, mi)}
                                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg transition-colors"
                                      style={{ backgroundColor: TT.hotSoft, color: TT.hot }}
                                      title={t('trainerPlans.removeMeal', 'Remove meal')}>
                                      <Trash2 size={11} />
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
                                {/* Optional eating time + notes (some diets are time-dependent) */}
                                <div className="flex items-center gap-2 mt-2">
                                  <div className="flex items-center gap-1 rounded-lg px-2 py-1" style={{ backgroundColor: TT.surface, border: `1px solid ${TT.border}` }}>
                                    <Clock size={11} style={{ color: TT.textMute }} />
                                    <input type="time" value={meal.time || ''} onChange={e => updateMealField(mealPreviewDay, mi, 'time', e.target.value)}
                                      aria-label={t('trainerPlans.mealTime', 'Meal time')}
                                      className="bg-transparent text-[11px] outline-none" style={{ color: TT.text, width: 64 }} />
                                  </div>
                                  <input type="text" value={meal.notes || ''} onChange={e => updateMealField(mealPreviewDay, mi, 'notes', e.target.value)}
                                    placeholder={t('trainerPlans.mealNotes', 'Notes (optional)')}
                                    className="flex-1 min-w-0 rounded-lg px-2 py-1 text-[11px] outline-none" style={{ backgroundColor: TT.surface, border: `1px solid ${TT.border}`, color: TT.text }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {/* Add another meal to this day */}
                        <button type="button" onClick={() => addMealToDay(mealPreviewDay)}
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12.5px] font-bold"
                          style={{ background: TT.accentSoft, color: TT.accentInk, border: `1px dashed ${TT.accent}` }}>
                          <Plus size={14} /> {t('trainerPlans.addMeal', 'Add meal')}
                        </button>
                      </div>

                      {/* ── Meal Picker Overlay ── */}
                      {mealPickerSlot && (
                        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={() => setMealPickerSlot(null)}>
                          <div className="rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" style={{ backgroundColor: TT.surface, border: `1px solid ${TT.borderSolid}` }} onClick={e => e.stopPropagation()}>
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
                                  {/* Optional photo */}
                                  <div className="flex items-center gap-2">
                                    {newMeal.imageUrl ? (
                                      <img src={newMeal.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                                    ) : (
                                      <div className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center" style={{ background: TT.surface, border: `1px solid ${TT.border}` }}>
                                        <UtensilsCrossed size={16} style={{ color: TT.textMute }} />
                                      </div>
                                    )}
                                    <label className="flex-1 cursor-pointer rounded-lg py-2 px-3 text-[12px] font-semibold text-center" style={{ background: TT.surface, border: `1px dashed ${TT.border}`, color: TT.textSub, opacity: uploadingMealPhoto ? 0.6 : 1 }}>
                                      {uploadingMealPhoto ? t('trainerPlans.uploading', 'Uploading…') : newMeal.imageUrl ? t('trainerPlans.changePhoto', 'Change photo') : t('trainerPlans.addPhoto', 'Add photo (optional)')}
                                      <input type="file" accept="image/*" className="hidden" disabled={uploadingMealPhoto}
                                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadMealPhoto(f); e.target.value = ''; }} />
                                    </label>
                                    {newMeal.imageUrl && (
                                      <button type="button" onClick={() => setNewMeal(n => ({ ...n, imageUrl: '' }))}
                                        className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg" style={{ background: TT.hotSoft, color: TT.hot }}>
                                        <X size={14} />
                                      </button>
                                    )}
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
                            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                              {filteredMeals.map(meal => {
                                const title = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                                return (
                                  <button key={meal.id} onClick={() => pickMeal(meal)}
                                    className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl transition-colors active:scale-[0.98]"
                                    style={{ color: TT.text }}>
                                    {mealImgSrc(meal.image) ? (
                                      <img src={mealImgSrc(meal.image)} alt={title} className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ backgroundColor: TT.surface2 }} loading="lazy" />
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

            <div className="flex-1 min-h-0 overflow-y-auto">
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
                  {/* Time frame + week selector — the weekly plan repeats for N weeks */}
                  {(Number(mealDetail.duration_weeks) > 1 || mealDetail.start_date) && (() => {
                    const dw = Math.max(1, Number(mealDetail.duration_weeks) || 1);
                    const dr = planWeekDates(mealDetail, mealDetailWeek);
                    return (
                      <div className="px-4 pt-3">
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TT.textMute }}>{t('trainerPlans.timeframe', 'Time frame')}</p>
                          <span className="text-[11px] font-semibold text-right" style={{ color: TT.textSub }}>
                            {dw} {dw === 1 ? t('trainerPlans.week', 'week') : t('trainerPlans.weeks', 'weeks')}{dr ? ` · ${format(dr.ws, 'd MMM', { locale: dateFnsLocale })} – ${format(dr.we, 'd MMM', { locale: dateFnsLocale })}` : ''}
                          </span>
                        </div>
                        {dw > 1 && (
                          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                            {Array.from({ length: dw }, (_, w) => (
                              <button key={w} onClick={() => setMealDetailWeek(w)} className="shrink-0 tt-tap"
                                style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', border: 'none',
                                  ...(mealDetailWeek === w ? { background: TT.accent, color: '#06363B' } : { background: TT.surface, color: TT.textSub, boxShadow: 'inset 0 0 0 1px var(--tt-border)' }) }}>
                                {t('trainerPlans.weekN', 'Week {{n}}', { n: w + 1 })}
                              </button>
                            ))}
                          </div>
                        )}
                        {dw > 1 && <p className="text-[10px] mt-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.weeklyRotationNote', 'The same weekly plan repeats each week.')}</p>}
                      </div>
                    );
                  })()}

                  {/* Day selector — Atelier filter chips, with date numbers.
                      Week start = chosen start date for the selected week, else
                      the plan's creation date. */}
                  {(() => {
                    const ws = planWeekDates(mealDetail, mealDetailWeek)?.ws
                      || (mealDetail.created_at ? new Date(mealDetail.created_at) : null);
                    const dayDate = (i) => (ws ? new Date(ws.getTime() + i * 86400000) : null);
                    return (
                      <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-3" style={{ borderBottom: `1px solid ${TT.border}` }}>
                        {mealDetail.meals.map((day, i) => {
                          const dd = dayDate(i);
                          return (
                            <button key={i} onClick={() => setMealDetailDay(i)}
                              className="shrink-0 tt-tap"
                              style={{
                                padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                                whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                                ...(mealDetailDay === i
                                  ? { background: TT.text, color: TT.onInverse }
                                  : { background: TT.surface, color: TT.textSub, boxShadow: 'inset 0 0 0 1px var(--tt-border)' }),
                              }}>
                              {DAY_LABELS[i] || `${t('trainerPlans.day', 'Day')} ${day.day || i + 1}`}{dd ? ` ${dd.getDate()}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

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

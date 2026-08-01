import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { isSchemaMiss } from '../../lib/schemaMiss';
import { createPortal } from 'react-dom';
import {
  Plus, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, Dumbbell,
  ClipboardList, Search, ToggleLeft, ToggleRight, ArrowLeft, StickyNote,
  ChevronUp, FileText, Calendar, Zap, Loader2, RefreshCw, Pencil,
  Activity, Target, MoreHorizontal, Minus, GripVertical, Link2, Check, Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useScrollLock } from '../../hooks/useScrollLock';
import { readTrainerCache, writeTrainerCache } from '../../lib/trainerCache';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { selectAllRows, selectInBatches, selectAllInBatches } from '../../lib/churn/batchedSelect';
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
import { getMeals } from '../../lib/mealStore';
import { getExerciseById } from '../../lib/exerciseStore';
const MEALS = getMeals();
import { foodImageUrl } from '../../lib/imageUrl';
import { validateImageFile } from '../../lib/validateImage';

// Resolve a meal image: full URLs (uploaded custom-meal photos) pass through;
// catalog paths go through the food-images resolver.
const mealImgSrc = (img) => (img ? (/^https?:\/\//.test(img) ? img : foodImageUrl(img)) : null);
// Recipe ingredients are stored as snake_case keys (`bean_sprouts`, `soy_sauce`).
// Showing them raw looks like leaked database rows.
const humanizeIngredient = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Meal-picker thumbnail that shimmers while the photo loads (see .tt-media-loading).
function MealThumb({ src, alt }) {
  const [ready, setReady] = useState(false);
  return (
    <img src={src} alt={alt} loading="lazy" onLoad={() => setReady(true)} onError={() => setReady(true)}
      className={`w-14 h-14 rounded-xl object-cover shrink-0${ready ? '' : ' tt-media-loading'}`}
      style={{ backgroundColor: ready ? TT.surface2 : undefined }} />
  );
}
import { motion } from 'framer-motion';
import SwipeableTabView from '../../components/SwipeableTabView';
import { UtensilsCrossed } from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import TrainerEmptyState from './components/TrainerEmptyState';
import { TT, TFont } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TPrimaryButton, TTabPill, TSectionHeader, TPill, TAvatar } from './components/designPrimitives';
// ── "Warmth (B)" meal-plan design system (Claude Design handoff-12) ──
import { MK, soft, inkOf, mpShade, MacroRing, MacroCells, MacroReadout, MkPill, MkTag, MkBtn, MkIconBtn, MkChipStrip, WeekPicker as MkWeekPicker, SheetHead as MkSheetHead, SectionHead as MkSectionHead, Card as MkCard, FoodTile, Sec as MkSec, Note as MkNote } from './components/mealPlanKit';
// meal-slot accent for the Warmth cards (Breakfast·Lunch·Snack·Dinner)
const MK_SLOT_C = { breakfast: MK.hot, lunch: MK.amber, snack: MK.good, dinner: MK.coach, meal: MK.teal };
import ExerciseVideoThumb from '../../components/ExerciseVideoThumb';
import LazyVideoTile from '../../components/LazyVideoTile';
import MealMacroCard from '../../components/nutrition/MealMacroCard';
import { LayoutGrid, List, ArrowLeftRight, ChevronLeft, SlidersHorizontal, User, UserPlus, Gauge, Leaf, Bookmark } from 'lucide-react';

// Resolve an exercise video path → full URL for grid tiles (mirrors the video store).
const EXV_BASE = 'https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/';
const exVideoSrc = (raw) => (!raw ? null : (/^(https?:|blob:|data:)/.test(raw) ? raw : `${EXV_BASE}${raw}`));

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
  // Teal StepBtn look, matching the per-client editor (ClientProgramEditor).
  const btn = (dir) => (
    <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => bump(dir)}
      className="tt-press tt-tap flex items-center justify-center flex-shrink-0"
      style={{ width: 30, height: 30, borderRadius: 9, background: TT.accentSoft, color: TT.accentInk, border: `1px solid ${TT.accent}44` }}>
      {dir < 0 ? <Minus size={14} strokeWidth={2.6} /> : <Plus size={14} strokeWidth={2.6} />}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-1.5">
      {btn(-1)}
      {/* Mono teal glyph PILL — same field the editor uses for reps/rest. */}
      <div onPointerDown={e => e.stopPropagation()} onClick={() => { setDraft(String(value)); setEditing(true); }}
        className="flex items-center justify-center cursor-text"
        style={{
          minWidth: Math.max(w, 46), height: 30, padding: '0 8px', borderRadius: 10,
          background: TT.surface2,
          boxShadow: editing ? `0 0 0 2px ${TT.accent}` : `inset 0 0 0 1px ${TT.accent}44`,
        }}>
        {editing ? (
          <input ref={inputRef} value={draft} inputMode="numeric"
            onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}
            className="bg-transparent text-center outline-none p-0"
            style={{ width: w - 6, fontFamily: TFont.mono, fontSize: 14, fontWeight: 700, color: TT.accentInk }} />
        ) : (
          <span style={{ fontFamily: TFont.mono, fontSize: 14, fontWeight: 700, color: TT.accentInk, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums' }}>{value}{suffix}</span>
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
        minWidth: w, height: 30, padding: '0 10px', borderRadius: 10,
        background: TT.surface2,
        boxShadow: editing ? `0 0 0 2px ${TT.accent}` : `inset 0 0 0 1px ${TT.accent}44`,
      }}>
      {editing ? (
        <input ref={ref} value={draft} placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          className="bg-transparent text-center outline-none p-0"
          style={{ width: w - 8, fontFamily: TFont.mono, fontSize: 14, fontWeight: 700, color: TT.accentInk }} />
      ) : (
        <span style={{ fontFamily: TFont.mono, fontSize: 14, fontWeight: 700, color: TT.accentInk, letterSpacing: -0.2 }}>{value}</span>
      )}
    </div>
  );
};

// ── Editor-style stat controls — mirror ClientProgramEditor's EditorDay so the
//    standalone builder's exercise cards read identically (teal StepBtn +
//    mono glyph PILL, boxed 3-col Sets/Reps/Rest grid). ──
function DragDots() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,3px)', gap: 3.5, flexShrink: 0 }} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ width: 3, height: 3, borderRadius: 2, background: TT.textMute }} />)}
    </div>
  );
}
const ED_PILL = { minWidth: 52, padding: '7px 10px', borderRadius: 10, background: TT.surface2, boxShadow: `inset 0 0 0 1px ${TT.accent}44`, color: TT.accentInk, fontSize: 14, fontWeight: 700, textAlign: 'center', letterSpacing: -0.2, fontFamily: TFont.mono, outline: 'none', border: 'none' };
function EdStepBtn({ children, onClick, ariaLabel, disabled = false }) {
  return (
    <button type="button" onPointerDown={e => e.stopPropagation()} onClick={onClick} disabled={disabled} aria-label={ariaLabel} className="tt-press tt-tap"
      style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, cursor: disabled ? 'default' : 'pointer', border: `1px solid ${TT.accent}44`, background: TT.accentSoft, color: TT.accentInk, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 800, lineHeight: 1, opacity: disabled ? 0.4 : 1 }}>
      {children}
    </button>
  );
}
const ED_REST_OPTS = [30, 45, 60, 90, 120, 180];

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
const ExercisePicker = ({ exercises, onAddMany, onReplace, replaceMode = false, onClose, exLabel, muscleLabelFor, t }) => {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('all');
  const [equipment, setEquipment] = useState('all');
  const [sel, setSel] = useState({}); // id -> ex
  const [view, setView] = useState('list'); // 'list' | 'grid'
  const [showFilters, setShowFilters] = useState(false); // filter chips hidden by default (too many packed otherwise)
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
  const activeFilters = (muscle !== 'all' ? 1 : 0) + (equipment !== 'all' ? 1 : 0);
  // Cap what we render — the catalog is hundreds of exercises; never lay them all out.
  const capped = results.slice(0, 80);

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
          <h3 className="text-[16px]" style={{ fontFamily: TFont.display, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
            {replaceMode ? t('trainerPlans.swapExercise', 'Swap exercise') : t('trainerPlans.addExercises', 'Add exercises')}
          </h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowFilters(s => !s)} aria-label={t('trainerPlans.filters', 'Filters')}
              style={{ position: 'relative', width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', cursor: 'pointer', border: `1px solid ${(showFilters || activeFilters) ? TT.accent : TT.border}`, background: (showFilters || activeFilters) ? TT.accentSoft : TT.surface2, color: (showFilters || activeFilters) ? TT.accentInk : TT.textSub }}>
              <SlidersHorizontal size={15} />
              {activeFilters > 0 && <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 999, background: TT.accent, color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{activeFilters}</span>}
            </button>
            <div style={{ display: 'flex', background: TT.surface2, borderRadius: 10, padding: 3, border: `1px solid ${TT.border}` }}>
              {[['list', List], ['grid', LayoutGrid]].map(([v, Ico]) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-label={v} style={{ width: 32, height: 28, borderRadius: 7, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', background: view === v ? TT.text : 'transparent', color: view === v ? TT.onInverse : TT.textMute }}><Ico size={15} /></button>
              ))}
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: TT.surface2, color: TT.textSub }}>
              <X size={17} />
            </button>
          </div>
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
      {/* filter chips — hidden until the Filters button is tapped (kept the row clean) */}
      {showFilters && (
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
      )}
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
        ) : view === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {capped.map(ex => {
              const selected = !replaceMode && !!sel[ex.id];
              const vsrc = exVideoSrc(ex.video_url);
              return (
                <button key={ex.id} onClick={() => (replaceMode ? onReplace(ex) : toggle(ex))}
                  className="active:scale-[0.98] transition-transform"
                  style={{ position: 'relative', aspectRatio: '4 / 5', borderRadius: 14, overflow: 'hidden', textAlign: 'left', background: '#000', border: selected ? `2px solid ${TT.accent}` : `1px solid ${TT.border}`, cursor: 'pointer' }}>
                  {vsrc ? <LazyVideoTile src={vsrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${TT.accent}22, transparent)`, display: 'grid', placeItems: 'center' }}><Dumbbell size={26} style={{ color: 'rgba(255,255,255,0.5)' }} /></div>}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
                  {selected && <span style={{ position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center', background: TT.accent, color: '#fff' }}><Check size={15} strokeWidth={3} /></span>}
                  {replaceMode && <span style={{ position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff' }}><ArrowLeftRight size={13} strokeWidth={2.6} /></span>}
                  <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                    <p style={{ fontSize: 11.5, fontWeight: 900, lineHeight: 1.1, textShadow: '0 1px 4px rgba(0,0,0,0.5)', margin: 0 }}>{exLabel(ex)}</p>
                    {ex.muscle_group && <p style={{ fontSize: 10, fontWeight: 700, marginTop: 2, opacity: 0.85, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{muscleLabelFor(ex.muscle_group)}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {capped.map(ex => {
              const selected = !replaceMode && !!sel[ex.id];
              const mc = getMuscleColor(ex.muscle_group);
              return (
                <button key={ex.id} onClick={() => (replaceMode ? onReplace(ex) : toggle(ex))}
                  className="w-full flex items-center gap-3 text-left rounded-2xl px-3 py-2.5 active:scale-[0.99] transition-transform"
                  style={{ background: selected ? TT.accentSoft : TT.surface, border: `1.5px solid ${selected ? TT.accent : TT.border}` }}>
                  <ExerciseVideoThumb exercise={{ videoUrl: ex.video_url, muscle: ex.muscle_group }} size={46} radius={12} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold truncate" style={{ fontFamily: TFont.display, color: TT.text }}>{exLabel(ex)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {ex.muscle_group && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: mc.bg, color: mc.text }}>{muscleLabelFor(ex.muscle_group)}</span>}
                      {ex.equipment && <span className="text-[11px] truncate" style={{ color: TT.textMute }}>{equipmentLabelFor(ex.equipment)}</span>}
                    </div>
                  </div>
                  {replaceMode ? (
                    <ArrowLeftRight size={17} style={{ color: TT.accent, flexShrink: 0 }} />
                  ) : (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: selected ? TT.accent : TT.surface2, border: selected ? 'none' : `1.5px solid ${TT.border}` }}>
                      {selected ? <Check size={16} color="#fff" /> : <Plus size={16} style={{ color: TT.textSub }} />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {results.length > capped.length && (
          <p className="text-center py-3 text-[11px]" style={{ color: TT.textMute }}>
            {t('trainerPlans.showingNofMEx', 'Showing {{n}} of {{total}} — search or filter to narrow', { n: capped.length, total: results.length })}
          </p>
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
const DayCard = ({ day, di, wk, exMuscle, exName, muscleLabelFor, updateDayName, removeDay, onAddExercise, removeExercise, updateExercise, duplicateExercise, onSwapExercise, reorderExercises, linkExercise, unlinkSuperset, copyDayMenu, setCopyDayMenu, setCopyWeekMenu, allDayTargets, copyDayTo, t }) => {
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
    const cellLabel = { fontFamily: TFont.display, fontSize: 9.5, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 1 };
    // Always include the current rest value so a legacy non-standard rest (e.g. 75s) stays selectable.
    const restOpts = Array.from(new Set([...ED_REST_OPTS, Number(ex.rest_seconds) || DEFAULT_REST])).sort((a, b) => a - b);
    return (
      <div key={ex._uid} data-dragitem={ex._uid}
        style={{
          background: TT.surface,
          border: `1px solid ${TT.border}`,
          borderLeft: ex.group_id ? `3px solid ${TT.coach}` : `1px solid ${TT.border}`,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: dragging ? TT.shadowLg : 'none',
          transform: dragging ? `translateY(${ty}px) scale(1.02)` : 'none',
          opacity: dragging ? 0.97 : 1,
          position: 'relative', zIndex: dragging ? 30 : 1,
          transition: dragging ? 'none' : 'transform 170ms cubic-bezier(0.2,0.9,0.3,1), box-shadow 140ms',
          willChange: dragging ? 'transform' : undefined,
        }}>
        {/* row: grip + name/muscle + duplicate + delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
          <button type="button" onPointerDown={(e) => start(ex._uid, e, e.currentTarget.closest('[data-dragitem]'))}
            aria-label={t('workoutBuilder.ariaDragReorder', 'Drag to reorder')}
            style={{ width: 18, height: 32, marginLeft: -2, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'grab', touchAction: 'none' }}>
            <DragDots />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: TFont.display, fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>{exName(ex.id)}</p>
            {mg && <span style={{ display: 'inline-block', marginTop: 3, fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, padding: '1px 7px', borderRadius: 999, background: mc.bg, color: mc.text }}>{muscleLabelFor(mg)}</span>}
          </div>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onSwapExercise(wk, di, ei)}
            aria-label={t('trainerPlans.swap', 'Swap')}
            style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textMute }}>
            <ArrowLeftRight size={15} />
          </button>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => duplicateExercise(wk, di, ei)}
            aria-label={t('trainerPlans.duplicate', 'Duplicate')}
            style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textMute }}>
            <Copy size={15} />
          </button>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => removeExercise(wk, di, ei)}
            aria-label={t('trainerPlans.remove', 'Remove')}
            style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.hot }}>
            <Trash2 size={15} />
          </button>
        </div>
        {/* boxed 3-col Sets / Reps / Rest grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', margin: '0 10px 10px', background: TT.surface2, borderRadius: 12, boxShadow: `inset 0 0 0 1px ${TT.border}`, overflow: 'hidden' }}>
          <div style={{ padding: '10px 6px 11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span style={cellLabel}>{t('trainerPlans.sets', 'Sets')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <EdStepBtn ariaLabel={t('common:decrease', 'Decrease')} onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (Number(ex.sets) || DEFAULT_SETS) - 1))}>−</EdStepBtn>
              <span style={{ fontFamily: TFont.mono, fontWeight: 700, fontSize: 16, color: TT.text, minWidth: 14, textAlign: 'center' }}>{ex.sets ?? DEFAULT_SETS}</span>
              <EdStepBtn ariaLabel={t('common:increase', 'Increase')} onClick={() => updateExercise(wk, di, ei, 'sets', Math.min(12, (Number(ex.sets) || DEFAULT_SETS) + 1))}>+</EdStepBtn>
            </div>
          </div>
          <div style={{ padding: '10px 6px 11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderLeft: `1px solid ${TT.border}`, borderRight: `1px solid ${TT.border}` }}>
            <span style={cellLabel}>{t('trainerPlans.reps', 'Reps')}</span>
            <input type="text" inputMode="numeric" value={ex.reps ?? DEFAULT_REPS} onPointerDown={e => e.stopPropagation()}
              onChange={e => updateExercise(wk, di, ei, 'reps', e.target.value.slice(0, 7))} style={{ ...ED_PILL, width: 56 }} />
          </div>
          <div style={{ padding: '10px 6px 11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span style={cellLabel}>{t('trainerPlans.rest', 'Rest')}</span>
            <select value={ex.rest_seconds ?? DEFAULT_REST} onPointerDown={e => e.stopPropagation()}
              onChange={e => updateExercise(wk, di, ei, 'rest_seconds', Number(e.target.value))} style={{ ...ED_PILL, appearance: 'none', cursor: 'pointer' }}>
              {restOpts.map(r => <option key={r} value={r}>{r < 60 ? `${r}s` : `${r / 60}m`}</option>)}
            </select>
          </div>
        </div>
        {/* note toggle + textarea (kept feature) */}
        <div style={{ padding: '0 12px 10px' }}>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => toggleNote(ex._uid)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', color: noteOpen ? TT.accentInk : TT.textMute, padding: 0 }}>
            <StickyNote size={13} /> {ex.notes ? t('trainerPlans.noteAdded', 'Note added') : t('trainerPlans.addNote', 'Add note')}
          </button>
          {noteOpen && (
            <textarea value={ex.notes || ''} onPointerDown={e => e.stopPropagation()}
              onChange={e => updateExercise(wk, di, ei, 'notes', e.target.value)}
              onFocus={() => setExpandedNotes(prev => ({ ...prev, [ex._uid]: true }))}
              onBlur={e => { if (!e.target.value.trim()) setExpandedNotes(prev => ({ ...prev, [ex._uid]: false })); }}
              maxLength={500} rows={2}
              placeholder={t('trainerPlans.trainerNotesPlaceholder', 'e.g., Tempo 3-1-2, pause at bottom')}
              style={{ width: '100%', marginTop: 8, borderRadius: 10, padding: '8px 11px', fontSize: 13, outline: 'none', resize: 'none', background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.textSub }} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: expanded ? TT.bg : TT.surface, border: `1px solid ${expanded ? `${TT.accent}44` : TT.border}`, borderRadius: 16, padding: expanded ? 10 : 0, marginBottom: 10, overflow: 'visible' }}>
      {/* Day header — chevron toggles; the day name is a full-width pill (matches ClientProgramEditor) */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: expanded ? '2px 2px 10px' : '10px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <button type="button" onClick={e => { e.stopPropagation(); setExpanded(!expanded); }} aria-label={expanded ? t('common:collapse', 'Collapse') : t('common:expand', 'Expand')}
          style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: TT.textSub }}>
          <ChevronRight size={19} strokeWidth={2.2} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        <input value={day.name} onChange={e => updateDayName(wk, di, e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder={t('trainerPlans.dayPrefix', 'Day {{num}}', { num: di + 1 })}
          style={{ flex: 1, minWidth: 0, height: 38, background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 10, padding: '0 13px', fontFamily: TFont.display, fontWeight: 800, fontSize: 15, color: TT.text, letterSpacing: -0.2, outline: 'none' }} />
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: TT.textMute, fontFamily: TFont.mono, whiteSpace: 'nowrap' }}>
          {items.length} {t('trainerPlans.ex', 'ex')}{dayTime > 0 ? ` · ~${fmtTime(dayTime, t)}` : ''}
        </span>
        <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk, di }); setCopyWeekMenu(null); }}
            style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: TT.textMute }} title={t('trainerPlans.copyDay', 'Copy day')}>
            <Copy size={14} />
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
          style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: TT.hot }}>
          <Trash2 size={15} />
        </button>
      </div>

      {/* Exercises */}
      {expanded && (
        <div style={{ paddingTop: 4 }}>
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
          <button type="button" onClick={onAddExercise} className="tt-tap"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', height: 44, marginTop: 10, borderRadius: 12, background: 'transparent', color: TT.accentInk, border: `1.5px dashed ${TT.accent}55`, fontFamily: TFont.display, fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
            <Plus size={17} strokeWidth={2.4} /> {t('trainerPlans.addExercise', 'Add Exercise')}
          </button>
        </div>
      )}
    </div>
  );
};

// ── Client picker list (in-modal) ────────────────────────
// A contained radio/checkbox list, NOT a native <select>. Native select popups
// mis-render / overflow the screen when opened inside a backdrop-blurred
// modal (WebView bug), so the assign/duplicate/multi sheets use this instead.
// Single-select: pass value + onChange(id). Multi-select: pass multi + values
// (array) + onToggle(id). `extra` prepends rows like a "No client" option.
function ClientPickList({ value, onChange, clients, extra, multi, values, onToggle, maxHeight = 220 }) {
  const rows = [...(extra || []), ...clients.map(c => ({ id: c.id, name: c.full_name }))];
  const selected = (id) => (multi ? (values || []).includes(id) : value === id);
  return (
    <div className="rounded-xl" style={{ border: `1px solid ${TT.border}`, maxHeight, overflowY: 'auto', overflowX: 'hidden' }}>
      {rows.map((opt, i) => {
        const on = selected(opt.id);
        return (
          <button
            key={opt.id || `_none_${i}`}
            type="button"
            onClick={() => (multi ? onToggle(opt.id) : onChange(opt.id))}
            className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left tt-tap"
            style={{ background: on ? TT.accentSoft : TT.surface, borderTop: i > 0 ? `1px solid ${TT.border}` : 'none' }}
          >
            <span className="flex items-center justify-center flex-shrink-0" style={{ width: 20, height: 20, borderRadius: multi ? 6 : 999, border: `1.5px solid ${on ? TT.accent : TT.borderSolid}`, background: on ? TT.accent : 'transparent' }}>
              {on && <Check size={13} color="#06363B" strokeWidth={3} />}
            </span>
            <span className="truncate text-[15px] sm:text-[14px] font-medium" style={{ color: on ? TT.accentInk : TT.text }}>{opt.name}</span>
          </button>
        );
      })}
    </div>
  );
}

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
  // Assignment is multi-member — a plan can be SHARED with many clients (0644).
  // assignedIds is the source of truth; clientId is the "primary" (first)
  // assignee that fills the legacy client_id column and drives the personalized
  // profile + auto-generate (only meaningful when exactly one member).
  const [assignedIds, setAssignedIds] = useState(init.client_id ? [init.client_id] : []);
  const clientId = assignedIds[0] || '';
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const toggleAssigned = (id) => setAssignedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const [name, setName]             = useState(init.name ?? '');
  const [description, setDesc]      = useState(init.description ?? '');
  // duration_weeks === 0 is the "single session" sentinel — one workout, no
  // multi-week scaffolding. Internally we still render 1 week so the day editor
  // works; only the SAVED value is 0 (see doSave).
  const [durationWeeks, setDuration]= useState(init.duration_weeks === 0 ? 1 : (init.duration_weeks ?? 4));
  const [planKind, setPlanKind] = useState(init.duration_weeks === 0 ? 'session' : 'program'); // 'program' | 'session'
  const switchPlanKind = (k) => {
    setPlanKind(k);
    if (k === 'session') { setDuration(1); setSelectedWeek(1); }
    else if (durationWeeks < 4) { setDuration(4); }
  };
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
  const [swapTarget, setSwapTarget] = useState(null); // { wk, di, ei } for replace-in-place swap
  useScrollLock(!!confirmPrune || confirmDiscard || !!pickerTarget || !!swapTarget || showAssignPicker); // lock page behind builder dialogs/sheets
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
  const snapAssigned = (ids) => [...ids].sort().join(',');
  if (initialSnapshot.current === null) {
    initialSnapshot.current = planSig({
      assigned: snapAssigned(init.client_id ? [init.client_id] : []),
      name: init.name ?? '',
      description: init.description ?? '',
      durationWeeks: init.duration_weeks === 0 ? 1 : (init.duration_weeks ?? 4),
      // planKind is what decides duration_weeks 0-vs-N on save, so it has to be
      // part of the signature: Session→Program at durationWeeks 4 leaves every
      // other tracked field identical and used to read as "no changes", so the
      // back arrow discarded the switch without warning.
      planKind: init.duration_weeks === 0 ? 'session' : 'program',
      weeks: normalizeWeeks(init.weeks, t),
    });
  }
  const isDirty = () => initialSnapshot.current !== planSig({ assigned: snapAssigned(assignedIds), name, description, durationWeeks, planKind, weeks });
  const handleBack = () => {
    if (isDirty()) { setConfirmDiscard(true); return; }
    onClose();
  };

  useEffect(() => {
    // Opening the builder is a view-swap within the Plans page, NOT a route
    // change — so the global ScrollToTop never fires and the builder inherits
    // wherever the list was scrolled. Reset the trainer scroll region on open.
    const reset = () => {
      document.querySelector('.trainer-scroll-region')?.scrollTo(0, 0);
      document.getElementById('main-content')?.scrollTo(0, 0);
      window.scrollTo(0, 0);
    };
    reset();
    const id = setTimeout(reset, 60); // after the builder lays out
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    // exercises table can exceed 1000 rows — paginate to get all of them
    selectAllRows((from, to) =>
      supabase.from('exercises').select('id, name, name_es, muscle_group, equipment, video_url').order('name').range(from, to),
    ).then(({ data, error }) => {
      if (error) console.error('[TrainerPlans] Failed to load exercises:', error);
      setExercises(data || []);
    }).catch(err => console.error('[TrainerPlans] Failed to load exercises:', err));
  }, []);

  // Shrinking the duration leaves the selected week out of range — clamp it.
  useEffect(() => {
    if (selectedWeek > durationWeeks) setSelectedWeek(durationWeeks);
  }, [durationWeeks, selectedWeek]);

  // Load the full set of shared members (0644 junction) when editing, and fold
  // in the legacy client_id. Rebaseline the dirty-snapshot afterwards so this
  // async hydrate never makes a freshly-opened plan read as edited.
  useEffect(() => {
    if (!isEdit || !plan?.id) return;
    let cancelled = false;
    supabase.from('trainer_plan_members').select('member_id').eq('plan_id', plan.id)
      .then(({ data, error }) => {
        if (cancelled || error) return; // table missing pre-migration → keep client_id only
        const merged = Array.from(new Set([
          ...(init.client_id ? [init.client_id] : []),
          ...(data || []).map(r => r.member_id).filter(Boolean),
        ]));
        if (merged.length <= (init.client_id ? 1 : 0)) return; // nothing extra
        setAssignedIds(merged);
        initialSnapshot.current = planSig({
          assigned: snapAssigned(merged),
          name: init.name ?? '',
          description: init.description ?? '',
          durationWeeks: init.duration_weeks === 0 ? 1 : (init.duration_weeks ?? 4),
          planKind: init.duration_weeks === 0 ? 'session' : 'program',
          weeks: normalizeWeeks(init.weeks, t),
        });
      });
    return () => { cancelled = true; };
  }, [isEdit, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // The `exercises` table fetch is async, so for its first few hundred ms every
  // row here rendered its raw primary key ("ex_abwh") before flipping to the
  // real name. Fall back to the bundled catalog (synchronous, always present),
  // and only if THAT misses do we show something derived from the id — never
  // the id itself.
  const exName = (id) => {
    const ex = exById.get(id) || getExerciseById(id);
    if (ex) return exLabel(ex) || ex.name || '';
    return String(id || '').replace(/^ex[_-]/, '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

  // Reconcile trainer_plan_members (0644) to exactly assignedIds: drop members
  // no longer assigned, add new ones (ON CONFLICT DO NOTHING → the assign-notify
  // trigger only fires for genuinely new members). Best-effort: a failure here
  // (e.g. junction table not yet migrated) must not fail the whole save.
  const syncPlanMembers = async (planId) => {
    try {
      const keep = assignedIds.filter(Boolean);
      const NONE = '00000000-0000-0000-0000-000000000000';
      await supabase.from('trainer_plan_members').delete()
        .eq('plan_id', planId)
        .not('member_id', 'in', `(${keep.length ? keep.join(',') : NONE})`);
      if (keep.length) {
        await supabase.from('trainer_plan_members').upsert(
          keep.map(mid => ({ plan_id: planId, member_id: mid, assigned_by: trainerId })),
          { onConflict: 'plan_id,member_id', ignoreDuplicates: true },
        );
      }
    } catch (e) {
      logger.error('TrainerPlans: syncPlanMembers failed (non-fatal):', e);
    }
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
        duration_weeks: planKind === 'session' ? 0 : durationWeeks,
        weeks: buildWeeksPayload(),
        is_draft: draft,
        // A draft is never an active assignment; published plans keep their state.
        is_active: draft ? false : (plan?.is_active ?? true),
        updated_at: new Date().toISOString(),
      };
      let planId = isEdit ? plan.id : null;
      if (isEdit) {
        const { error: err } = await supabase.from('trainer_workout_plans').update(payload).eq('id', plan.id);
        if (err) { setError(err.message); setSaving(false); return; }
      } else {
        const { data: ins, error: err } = await supabase.from('trainer_workout_plans').insert(payload).select('id').single();
        if (err) { setError(err.message); setSaving(false); return; }
        planId = ins?.id;
        posthog?.capture('trainer_plan_created');
      }
      // Sync the shared-members junction (0644) to match assignedIds. Never
      // blocks the save — the plan row is already persisted (client_id holds
      // the primary assignee for backward-compat).
      if (planId) await syncPlanMembers(planId);
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
      {/* ── Sticky top header ──
          The offset is NOT decorative. `.trainer-scroll-region` is padded
          52px+safe-area to clear the app's fixed top bar, but a sticky element
          pins to the SCROLLPORT (the padding box), i.e. underneath that bar —
          so with `top-0` the name + Program/Session rows were covered and the
          builder looked like it had opened halfway down the page. Pin below the
          bar instead. Desktop has no fixed bar (md:pt-0), so top-0 there. */}
      <div className="sticky top-[calc(52px+env(safe-area-inset-top))] md:top-0 z-30 backdrop-blur-2xl" style={{ background: 'color-mix(in srgb, var(--tt-bg) 92%, transparent)', borderBottom: `1px solid ${TT.border}` }}>
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

        {/* Row 2: Program/Session (full-width segmented) + status. A single
            deliberate control instead of two half-width blobs stacked. */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pb-2 flex items-center gap-2">
          <div className="flex flex-1 rounded-xl p-[3px] gap-[3px]" style={{ background: TT.surface2, border: `1px solid ${TT.border}` }}>
            {[['program', t('trainerPlans.kindProgram', 'Program'), Calendar], ['session', t('trainerPlans.kindSession', 'Session'), Dumbbell]].map(([k, lab, Icon]) => {
              const on = planKind === k;
              return (
                <button key={k} type="button" onClick={() => switchPlanKind(k)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-[9px] min-h-[36px] text-[13px] font-bold transition-all"
                  style={on
                    ? { background: TT.accent, color: '#06363B', boxShadow: '0 2px 7px -3px rgba(0,0,0,0.4)' }
                    : { background: 'transparent', color: TT.textMute }}>
                  <Icon size={14} strokeWidth={2.4} /> {lab}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
            style={isDraftSave
              ? { background: TT.warnSoft, color: TT.warnInk }
              : (plan?.is_active ?? true)
                ? { background: TT.goodSoft, color: TT.goodInk }
                : { background: TT.surface2, color: TT.textMute }}>
            {isDraftSave ? t('trainerPlans.draft', 'Draft') : (plan?.is_active ?? true) ? t('trainerPlans.active', 'Active') : t('trainerPlans.inactive', 'Inactive')}
          </span>
        </div>

        {/* Row 3: Assignment (multi-member) + auto-generate. A plan can be
            SHARED with many members; auto-generate only applies to a single
            personalized assignee. */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 md:px-6 pb-2.5 flex items-center gap-2">
          <button type="button" onClick={() => setShowAssignPicker(true)}
            aria-label={t('trainerPlans.assignClientAria', 'Assign to members')}
            className="flex items-center gap-2 rounded-lg pl-2.5 pr-2.5 tt-tap flex-1 min-w-0"
            style={{ background: assignedIds.length ? TT.accentSoft : TT.surface2, border: `1px solid ${assignedIds.length ? TT.accent : TT.border}`, minHeight: 40 }}>
            <UserPlus size={15} strokeWidth={2.3} style={{ flexShrink: 0, color: assignedIds.length ? TT.accentInk : TT.textMute }} />
            <span className="text-[13px] font-semibold truncate flex-1 text-left" style={{ color: assignedIds.length ? TT.accentInk : TT.textSub }}>
              {assignedIds.length === 0
                ? t('trainerPlans.assignMembers', 'Assign members')
                : assignedIds.length === 1
                  ? (clients.find(c => c.id === assignedIds[0])?.full_name || assignedClientName || t('trainerPlans.oneMember', '1 member'))
                  : t('trainerPlans.nMembers', '{{n}} members', { n: assignedIds.length })}
            </span>
            <ChevronDown size={15} style={{ flexShrink: 0, color: assignedIds.length ? TT.accentInk : TT.textMute }} />
          </button>
          {assignedIds.length === 1 && clientProfile?.onboarding && planKind !== 'session' && (
            <button onClick={handleAutoGenerate} disabled={generating}
              className="flex items-center gap-1.5 px-3 rounded-lg font-bold text-[12px] transition-colors whitespace-nowrap disabled:opacity-40 flex-shrink-0"
              style={{ backgroundColor: TT.accentSoft, color: TT.accentInk, minHeight: 40 }}>
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              {generating ? t('trainerPlans.generating', 'Generating…') : t('trainerPlans.autoGenerate', 'Auto-Generate')}
            </button>
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
        {/* Plan notes — a LABELED section in the body. It used to be a bare
            textarea wedged into the sticky header, toggled by a tiny "Add notes"
            link buried inside the client card: unlabeled, so it read as a
            mystery field, and completely unreachable on a shared plan (that card
            only renders for a single assignee). The row doubles as the preview
            when collapsed. */}
        <div className="mb-4 rounded-2xl overflow-hidden" style={{ background: TT.surface, border: `1px solid ${TT.border}` }}>
          <button type="button" onClick={() => setShowDetails(v => !v)} aria-expanded={showDetails}
            className="w-full flex items-center gap-2.5 px-4 py-3 tt-tap text-left"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <span style={{ width: 30, height: 30, borderRadius: 10, background: TT.accentSoft, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <FileText size={15} style={{ color: TT.accentInk }} />
            </span>
            <span className="flex-1 min-w-0">
              <span style={{ display: 'block', fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>
                {t('trainerPlans.notesTitle', 'Plan notes')}
              </span>
              <span className="truncate" style={{ display: 'block', fontSize: 11.5, color: description?.trim() ? TT.textSub : TT.textMute, marginTop: 1 }}>
                {description?.trim() || t('trainerPlans.notesHint', 'Goals, approach, anything the member should know')}
              </span>
            </span>
            <ChevronDown size={17} style={{ color: TT.textMute, flexShrink: 0, transform: showDetails ? 'none' : 'rotate(-90deg)', transition: 'transform .18s' }} />
          </button>
          {showDetails && (
            <div className="px-4 pb-4">
              <textarea value={description} onChange={e => setDesc(e.target.value)} rows={3}
                placeholder={t('trainerPlans.descPlaceholder', 'Goals and approach for this plan...')}
                className="w-full rounded-xl px-3.5 py-2.5 text-[16px] sm:text-[13px] outline-none resize-none"
                style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
            </div>
          )}
        </div>

        {/* Client context + Generation overrides */}
        {/* Shared with many members = a template. No per-client personalization
            (whose profile would we show?) — build it manually. */}
        {assignedIds.length > 1 && (
          <div className="mb-4 rounded-2xl p-4" style={{ background: `linear-gradient(160deg, ${TT.accentSoft}, ${TT.surface} 68%)`, border: `1px solid ${TT.accent}` }}>
            <div className="flex items-center gap-3">
              <div style={{ width: 46, height: 46, borderRadius: 14, background: TT.surface, display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: TT.shadow }}>
                <Users size={22} color={TT.accent} />
              </div>
              <div className="min-w-0 flex-1">
                <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 900, letterSpacing: -0.4, color: TT.text }}>
                  {t('trainerPlans.sharedWithN', 'Shared with {{n}} members', { n: assignedIds.length })}
                </div>
                <div className="text-[12.5px]" style={{ color: TT.textSub, marginTop: 2 }}>
                  {t('trainerPlans.sharedTemplateHint', 'One plan, edited once for everyone.')}
                </div>
              </div>
              <button type="button" onClick={() => setShowAssignPicker(true)} className="tt-tap flex-shrink-0"
                style={{ padding: '9px 13px', borderRadius: 11, background: TT.surface, border: `1px solid ${TT.accent}`, color: TT.accentInk, fontWeight: 800, fontSize: 12, fontFamily: TFont.display }}>
                {t('trainerPlans.manage', 'Manage')}
              </button>
            </div>
          </div>
        )}

        {/* Single personalized member — Identity-style profile + generation settings */}
        {assignedIds.length === 1 && clientProfile?.onboarding && (
          <div className="mb-4 rounded-2xl p-4" style={{ background: `linear-gradient(160deg, ${TT.accentSoft}, ${TT.surface} 62%)`, border: `1px solid ${TT.accent}` }}>
            {/* Identity row — avatar + name + level/goal */}
            <div className="flex items-center gap-3">
              <TAvatar name={(clients.find(c => c.id === clientId)?.full_name || assignedClientName || '?')} size={46} />
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 900, letterSpacing: -0.4, color: TT.text, lineHeight: 1.1 }}>
                  {clients.find(c => c.id === clientId)?.full_name || assignedClientName || t('trainerPlans.aClient', 'Client')}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[12px]">
                  <span style={{ color: TT.textSub }}>{t('trainerPlans.level', 'Level')}: <span className="font-semibold capitalize" style={{ color: TT.text }}>{clientProfile.onboarding.fitness_level || '—'}</span></span>
                  <span style={{ color: TT.textSub }}>{t('trainerPlans.goal', 'Goal')}: <span className="font-semibold capitalize" style={{ color: TT.text }}>{clientProfile.onboarding.primary_goal ? t(`trainerNotes.goals.${clientProfile.onboarding.primary_goal}`, clientProfile.onboarding.primary_goal.replace(/_/g, ' ')) : '—'}</span></span>
                </div>
              </div>
            </div>
            {/* Injuries banner */}
            {clientProfile.onboarding.injuries_notes && (
              <div className="mt-3 text-[12px] rounded-lg px-2.5 py-1.5" style={{ background: TT.hotSoft, color: TT.hot }}>
                <span className="font-bold uppercase tracking-wide text-[9px] mr-1.5">{t('trainerPlans.injuries', 'Injuries')}</span>
                <span className="font-semibold">{clientProfile.onboarding.injuries_notes}</span>
              </div>
            )}
            {/* Equipment + goals chips */}
            <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
              {clientProfile.onboarding.available_equipment?.map(eq => (
                <span key={eq} className="px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ backgroundColor: TT.surface, color: TT.textSub, border: `1px solid ${TT.border}` }}>{eq}</span>
              ))}
              {clientProfile.goals.map((g, i) => (
                <span key={`g${i}`} className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: TT.accent, color: '#06363B' }}>
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

        {/* Duration + Week selector (mobile) — hidden for single sessions */}
        <div className={planKind === 'session' ? 'hidden' : 'md:hidden mb-4'}>
          {/* Duration — label on top so the preset pills + custom box align on one row */}
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: TT.textMute }}>{t('trainerPlans.duration', 'Duration')}</p>
          <div className="flex gap-1.5 flex-wrap items-center">
            {PRESET_DURATIONS.map(w => (
              <button key={w} onClick={() => setDuration(w)}
                className="rounded-lg text-[12.5px] font-bold transition-colors"
                style={{ height: 44, minWidth: 48, padding: '0 12px', ...(durationWeeks === w
                  ? { backgroundColor: TT.accent, color: '#06363B' }
                  : { backgroundColor: TT.surface2, color: TT.textMute, border: `1px solid ${TT.border}` }) }}>
                {w}{t('trainerPlans.wSuffix', 'w')}
              </button>
            ))}
            {/* Custom weeks — same height as the presets, sits inline */}
            <div className="flex items-center gap-1 rounded-lg"
              style={{ height: 44, padding: '0 10px', ...(isCustomDuration ? { backgroundColor: TT.accent } : { backgroundColor: TT.surface2, border: `1px solid ${TT.border}` }) }}>
              <CustomWeeksInput value={durationWeeks} onCommit={setDuration}
                ariaLabel={t('trainerPlans.customWeeks', 'Custom weeks')}
                color={isCustomDuration ? '#06363B' : TT.text} />
              <span className="text-[11px] font-semibold" style={{ color: isCustomDuration ? '#06363B' : TT.textMute }}>{t('trainerPlans.wSuffix', 'w')}</span>
            </div>
          </div>
          {/* Week nav — centered arrows + "Week X of Y" (matches the client program editor) */}
          {allWeekNums.length > 1 && (() => {
            const wkIdx = allWeekNums.indexOf(selectedWeek);
            const total = allWeekNums.length;
            const stats = weekStats(selectedWeek);
            const arrow = (dir, on, act) => (
              <button type="button" onClick={act} disabled={!on} aria-label={dir === 'next' ? t('common:next', 'Next') : t('common:prev', 'Previous')}
                style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, cursor: on ? 'pointer' : 'default',
                  background: dir === 'next' ? TT.surface2 : 'transparent', border: dir === 'next' ? `1px solid ${TT.border}` : 'none',
                  display: 'grid', placeItems: 'center', opacity: on ? 1 : 0.32, color: TT.text }}>
                {dir === 'next' ? <ChevronRight size={19} strokeWidth={2.2} /> : <ChevronLeft size={19} strokeWidth={2.2} />}
              </button>
            );
            return (
              <div className="flex items-center justify-between" style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${TT.border}` }}>
                {arrow('prev', wkIdx > 0, () => setSelectedWeek(allWeekNums[wkIdx - 1]))}
                <div style={{ textAlign: 'center', minWidth: 0 }}>
                  <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
                    {t('trainerPlans.weekLabel', 'Week')} {selectedWeek} <span style={{ color: TT.textMute, fontWeight: 700 }}>{t('trainerPlans.ofN', 'of {{n}}', { n: total })}</span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: TT.textMute, fontFamily: TFont.mono, marginTop: 1 }}>
                    {stats.dayCount}{t('trainerPlans.dShort', 'd')} · {stats.exCount}{t('trainerPlans.exShort', 'ex')}
                  </div>
                </div>
                {arrow('next', wkIdx < total - 1, () => setSelectedWeek(allWeekNums[wkIdx + 1]))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Main content: 2 col desktop, 1 col mobile ── */}
      <div className="max-w-[480px] mx-auto md:max-w-5xl md:flex md:min-h-[calc(100vh-140px)] pb-24 md:pb-0">
        {/* ── Left rail (desktop only) — hidden for single sessions, same as the
            mobile duration/week block above. A session is one workout: its
            Duration presets could push durationWeeks to 4+ while planKind
            stayed 'session', and the save then wrote duration_weeks 0 with 4
            weeks of JSON (reopens as a 1-week session that wants to prune). ── */}
        <div className={planKind === 'session' ? 'hidden' : 'hidden md:block w-64 flex-shrink-0 sticky top-[140px] self-start max-h-[calc(100vh-140px)] overflow-y-auto'} style={{ borderRight: `1px solid ${TT.border}`, background: TT.surface2 }}>
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
                {/* Same gate as the header button: auto-generate is only
                    meaningful for ONE assignee with onboarding data, and it
                    produces a 4-week program — incoherent for a single session
                    (it also desyncs planKind from durationWeeks). */}
                {assignedIds.length === 1 && clientProfile?.onboarding && planKind !== 'session' && (
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
                onSwapExercise={(w, d, ei) => setSwapTarget({ wk: w, di: d, ei })}
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
              {t('trainerPlans.unsavedTitle', 'Save your changes?')}
            </h3>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {t('trainerPlans.unsavedBody', 'You have unsaved changes in this plan. Save them before leaving, or discard.')}
            </p>
            <div className="space-y-2.5 pt-2">
              <button
                onClick={() => { setConfirmDiscard(false); handleSave({ draft: isEdit ? (plan?.is_draft ?? false) : true }); }}
                disabled={saving || !name?.trim()}
                className="w-full py-2.5 rounded-xl text-[13px] font-bold transition-colors min-h-[44px]"
                style={{ background: TT.accent, color: '#06363B', opacity: (saving || !name?.trim()) ? 0.5 : 1 }}>
                {saving ? t('trainerPlans.saving', 'Saving…') : t('trainerPlans.saveAndLeave', 'Save changes')}
              </button>
              <div className="flex items-center gap-3">
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
        </div>
      )}

      {/* ── Assign-to-members picker (multi-select) ── */}
      {showAssignPicker && (
        <div className="fixed inset-0 z-[92] flex items-center justify-center px-4" onClick={e => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAssignPicker(false)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <div className="flex items-center gap-2.5">
              <div style={{ width: 38, height: 38, borderRadius: 11, background: TT.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <UserPlus size={19} color={TT.accent} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-bold leading-tight" style={{ color: TT.text }}>{t('trainerPlans.assignToMembers', 'Assign to members')}</h3>
                <p className="text-[12px]" style={{ color: TT.textSub }}>{t('trainerPlans.assignMultiHint', 'Share this plan with one or more clients.')}</p>
              </div>
            </div>
            {clients.length === 0 ? (
              <p className="text-[13px] py-3 text-center" style={{ color: TT.textMute }}>{t('trainerPlans.noClientsAvailable', 'No active clients to assign.')}</p>
            ) : (
              <ClientPickList multi values={assignedIds} onToggle={toggleAssigned} clients={clients} maxHeight={280} />
            )}
            {assignedIds.length > 0 && (
              <p className="text-[12px]" style={{ color: TT.textMute }}>
                {t('trainerPlans.membersSelected', '{{n}} selected', { n: assignedIds.length })}{' · '}
                <button type="button" onClick={() => setAssignedIds([])} style={{ color: TT.hot, fontWeight: 700 }}>{t('trainerPlans.clearAll', 'Clear')}</button>
              </p>
            )}
            <button onClick={() => setShowAssignPicker(false)}
              className="w-full py-2.5 rounded-xl text-[13px] font-bold min-h-[44px]"
              style={{ background: TT.accent, color: '#06363B' }}>
              {t('trainerPlans.done', 'Done')}
            </button>
          </div>
        </div>
      )}

      {/* ── Add-exercise picker (bottom sheet, multi-select) ── */}
      {(pickerTarget || swapTarget) && createPortal(
        <div className="fixed inset-0 z-[95] flex flex-col justify-end">
          <div className="absolute inset-0" style={{ background: 'rgba(8,10,12,0.5)' }} onClick={() => { setPickerTarget(null); setSwapTarget(null); }} />
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
              replaceMode={!!swapTarget}
              onClose={() => { setPickerTarget(null); setSwapTarget(null); }}
              onAddMany={(list) => { if (pickerTarget) addExercises(pickerTarget.wk, pickerTarget.di, list); setPickerTarget(null); }}
              onReplace={(ex) => { if (swapTarget) updateExercise(swapTarget.wk, swapTarget.di, swapTarget.ei, 'id', ex.id); setSwapTarget(null); }}
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
  const [filterType, setFilterType] = useState('all'); // 'all' | 'program' | 'session'
  // Per-card collapse overrides (id → bool). Default: first card open, rest hidden.
  const [planOverrides, setPlanOverrides] = useState({});
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(null);
  // Duplicate-for-client picker (a straight duplicate locked the copy to the
  // original client, making duplicate-for-another-client impossible)
  const [duplicateTarget, setDuplicateTarget] = useState(null); // plan being duplicated
  const [duplicateClientId, setDuplicateClientId] = useState('');
  const [duplicating, setDuplicating] = useState(false);
  // Assign-to-client picker — the ONLY way to (re)assign an existing plan. The
  // builder select is edit-locked for existing plans, so without this a plan
  // created without a client (or a single session) could never reach anyone.
  const [assignTarget, setAssignTarget] = useState(null); // plan being assigned
  const [assignIds, setAssignIds] = useState([]); // members it's shared with (0644)
  const toggleAssignId = (id) => setAssignIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const [assigning, setAssigning] = useState(false);
  // Plan whose `weeks` blob is being fetched before the builder opens (the list
  // query doesn't carry it any more) — drives the spinner on that card's Edit.
  const [openingPlanId, setOpeningPlanId] = useState(null);

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
  // Which step the modal OPENED at. Editing an existing plan with meals jumps
  // straight to 'meals', and back-arrowing from there used to drop the trainer
  // on the settings step — a page they never visited, so "back" moved them
  // FORWARD into the creation wizard. When we entered at 'meals', back closes.
  const [mealEntryStep, setMealEntryStep] = useState('settings');
  const [generatedMeals, setGeneratedMeals] = useState(null); // 7-day plan
  const [editingMealPlanId, setEditingMealPlanId] = useState(null); // null = create; id = edit in place
  // Shared meal plans (0645): ADDITIONAL members beyond the primary (mealForm.client_id).
  const [mealShareIds, setMealShareIds] = useState([]);
  const [showMealSharePicker, setShowMealSharePicker] = useState(false);
  const toggleMealShare = (id) => setMealShareIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const [generatingMeals, setGeneratingMeals] = useState(false);
  const [mealPreviewDay, setMealPreviewDay] = useState(0);
  const [mealPreviewWeek, setMealPreviewWeek] = useState(0);
  const DAY_LABELS = [
    t('trainerPlans.daySun', 'Sun'), t('trainerPlans.dayMon', 'Mon'), t('trainerPlans.dayTue', 'Tue'),
    t('trainerPlans.dayWed', 'Wed'), t('trainerPlans.dayThu', 'Thu'), t('trainerPlans.dayFri', 'Fri'), t('trainerPlans.daySat', 'Sat'),
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

  // Macro targets EXACTLY as the trainer typed them — "none set" is a real
  // state (a "Build it myself" plan can be name-only) and must stay
  // representable as 0. These used to fall back to an invented
  // 2000/150/200/60, which made `calories` permanently truthy: the "no
  // targets" early-outs in computeDayFits + mealCompatibility could never
  // fire, so every meal got a "N% fit" badge and days got a green "Macros
  // fit" tag measured against numbers nobody entered.
  const dayTargets = () => ({
    calories: parseInt(mealForm.target_calories) || 0,
    protein: parseInt(mealForm.target_protein_g) || 0,
    carbs: parseInt(mealForm.target_carbs_g) || 0,
    fat: parseInt(mealForm.target_fat_g) || 0,
  });
  // Budget used to GENERATE a meal (the planner needs a non-zero target to
  // pick against), so it keeps the old fallbacks. Never used for scoring or
  // for any badge — only as an input to generateDayPlan.
  const genBudgetTargets = () => {
    const tg = dayTargets();
    return {
      calories: tg.calories || 2000,
      protein: tg.protein || 150,
      carbs: tg.carbs || 200,
      fat: tg.fat || 60,
    };
  };

  // "Build it myself" — skip AI generation and start from an empty week the
  // trainer fills slot-by-slot via the Choose-Meal picker.
  const handleBuildMyself = () => {
    if (!mealForm.name.trim()) { showToast(t('trainerPlans.nameYourPlanFirst', 'Name your plan first'), 'error'); return; }
    const empty = Array.from({ length: 7 }, (_, di) => ({
      meals: MEAL_SLOTS.map((s, mi) => ({
        id: `new_${di}_${mi}`, title: t('trainerPlans.newMeal', 'New meal'), title_es: t('trainerPlans.newMeal', 'New meal'),
        slotType: s.type, calories: 0, protein: 0, carbs: 0, fat: 0,
      })),
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      fits: false,
    }));
    setGeneratedMeals(empty);
    setMealsDirty(true);
    setMealStep('meals');
    setMealPreviewDay(0);
    setMealPreviewWeek(0);
  };

  // Per-meal fit vs the client's target for that slot → a 0-100 compatibility %.
  // Uses the slot's share of the daily target (breakfast 28% … dinner 38%).
  const mealCompatibility = (meal, slotType) => {
    const tgt = dayTargets();
    if (!tgt.calories) return null;
    const share = MEAL_SLOT_SHARE[slotType] ?? 0.25;
    const st = { calories: tgt.calories * share, protein: tgt.protein * share, carbs: tgt.carbs * share, fat: tgt.fat * share };
    const err = (a, b) => (b > 0 ? Math.min(1, Math.abs((a || 0) - b) / b) : ((a || 0) > 0 ? 1 : 0));
    // Calories weighted highest, then protein, then carbs/fat.
    const score = 1 - (err(meal.calories, st.calories) * 0.4 + err(meal.protein, st.protein) * 0.3 + err(meal.carbs, st.carbs) * 0.15 + err(meal.fat, st.fat) * 0.15);
    return Math.max(0, Math.min(100, Math.round(score * 100)));
  };

  const swapMeal = (dayIdx, mealIdx) => {
    const day = generatedMeals[dayIdx];
    if (!day) return;
    const slotType = day.meals[mealIdx]?.slotType || 'lunch';
    const targets = dayTargets();
    // Budget the slot with the generator's realistic meal-time shares
    // (breakfast 28% / lunch 34% / dinner 38% / snack 14%, normalized over
    // the day's slots) instead of a flat 1/n split that over-fed snacks.
    const share = slotShareOf(slotType, day.meals);
    // Generation needs a budget even when the trainer set no targets — that's
    // what genBudgetTargets is for. `targets` (possibly all zeros) is only
    // used below for the honest fits check.
    const budget = genBudgetTargets();
    const slotBudget = {
      calories: Math.round(budget.calories * share),
      protein: Math.round(budget.protein * share),
      carbs: Math.round(budget.carbs * share),
      fat: Math.round(budget.fat * share),
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
  const [mealCat, setMealCat] = useState('all');           // category filter chip
  const [pickerPreview, setPickerPreview] = useState(null); // meal previewed before selecting
  const [recipeTab, setRecipeTab] = useState('ingredients'); // preview: ingredients | instructions
  // Trainer's private custom meals (custom_meals table) — usable in plans and
  // visible only to the trainer (+ super-admin). Map DB rows to the meal shape.
  const [customMeals, setCustomMeals] = useState([]);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [newMeal, setNewMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', imageUrl: '', ingredients: '', instructions: '' });
  const [savingNewMeal, setSavingNewMeal] = useState(false);
  const [uploadingMealPhoto, setUploadingMealPhoto] = useState(false);
  // Picker filters (behind a Filters button) + pagination (replaces the hard 60 cap).
  const [showMealFilters, setShowMealFilters] = useState(false);
  const [mealCalBand, setMealCalBand] = useState('all');       // 'all'|'lt300'|'300_500'|'500_700'|'gt700'
  const [mealMacroFilter, setMealMacroFilter] = useState('all'); // 'all'|'high_protein'|'low_carb'|'low_fat'
  const [mealFitsOnly, setMealFitsOnly] = useState(false);     // only meals that fit this slot's macro share
  const [mealMine, setMealMine] = useState(false);             // only the trainer's own custom meals
  const [mealVisible, setMealVisible] = useState(40);          // how many rows rendered (Show more adds 40)
  // Saved/bookmarked meals — mirrors the member side (localStorage set).
  const [savedMealIds, setSavedMealIds] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('trainer_saved_meals') || '[]')); } catch { return new Set(); } });
  const toggleSaveMeal = (id) => setSavedMealIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id);
    try { localStorage.setItem('trainer_saved_meals', JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  const [editingCustomMealId, setEditingCustomMealId] = useState(null); // db id when editing a custom meal (null = create)
  const customMealToMeal = (r) => ({
    id: `custom_${r.id}`,
    title: r.name, title_es: r.name_es || r.name,
    calories: Number(r.calories) || 0, protein: Number(r.protein_g) || 0,
    carbs: Number(r.carbs_g) || 0, fat: Number(r.fat_g) || 0,
    category: r.category || 'custom', custom: true, image: r.image_url || null,
    // items (0632) → ingredient names; steps (0643) → instructions — so the
    // preview shows a custom meal's composition, not just frozen macros.
    ingredients: Array.isArray(r.items) ? r.items.map(it => it?.name).filter(Boolean) : [],
    ingredientAmounts: Array.isArray(r.items) ? r.items.map(it => (it?.servings != null ? String(it.servings) : '')) : [],
    steps: Array.isArray(r.steps) ? r.steps : [],
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
      const { error: upErr } = await supabase.storage.from('meal-photos').upload(path, file, { cacheControl: '31536000', contentType: file.type || 'image/jpeg', upsert: false });
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

  // Editing a meal plan → load its extra shared members (0645 junction), minus
  // the primary (client_id, already the main select). Non-fatal pre-migration.
  useEffect(() => {
    if (!editingMealPlanId) { return; }
    let cancelled = false;
    supabase.from('trainer_meal_plan_members').select('member_id').eq('plan_id', editingMealPlanId)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const primary = mealForm.client_id;
        setMealShareIds((data || []).map(r => r.member_id).filter(id => id && id !== primary));
      });
    return () => { cancelled = true; };
  }, [editingMealPlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the meal-plan modal AND clear all of its working state, so reopening
  // starts fresh instead of showing the previous plan's data.
  const closeMealModal = () => {
    setShowMealModal(false);
    // Clear the regenerate confirm too — it is a CHILD of this modal, so leaving
    // it set stranded an orphan dialog floating over the plans list.
    setConfirmRegen(false);
    setMealStep('settings');
    setMealEntryStep('settings');
    setEditingMealPlanId(null);
    setGeneratedMeals(null);
    setMealForm({ client_id: '', name: '', description: '', target_calories: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '', duration_weeks: 4, start_date: '' });
    setMealShareIds([]);
    setNewMeal({ name: '', calories: '', protein: '', carbs: '', fat: '', imageUrl: '', ingredients: '', instructions: '' });
    setShowAddMeal(false);
    setMealPickerSlot(null);
    setMealSearch('');
    setMealsDirty(false);
    setMealGoalOverride(null);
  };
  const addCustomMeal = async () => {
    if (!newMeal.name.trim() || savingNewMeal) return;
    setSavingNewMeal(true);
    // One ingredient / one instruction per line.
    const ingLines = (newMeal.ingredients || '').split('\n').map(s => s.trim()).filter(Boolean);
    const stepLines = (newMeal.instructions || '').split('\n').map(s => s.trim()).filter(Boolean);
    const payload = {
      created_by: profile.id, gym_id: profile.gym_id || null,
      name: newMeal.name.trim(),
      calories: Number(newMeal.calories) || 0, protein_g: Number(newMeal.protein) || 0,
      carbs_g: Number(newMeal.carbs) || 0, fat_g: Number(newMeal.fat) || 0,
      category: 'custom', image_url: newMeal.imageUrl || null,
    };
    // items (0632) / steps (0643) only when provided — keeps a plain macro-only
    // add working even before those migrations are applied.
    if (ingLines.length) payload.items = ingLines.map(name => ({ name }));
    if (stepLines.length) payload.steps = stepLines;
    let data, error;
    if (editingCustomMealId) {
      // Editing an existing custom meal — don't rewrite ownership columns.
      const { created_by, gym_id, ...upd } = payload;
      ({ data, error } = await supabase.from('custom_meals').update(upd).eq('id', editingCustomMealId).select('*').single());
    } else {
      ({ data, error } = await supabase.from('custom_meals').insert(payload).select('*').single());
    }
    setSavingNewMeal(false);
    if (error) { showToast(t('trainerPlans.addMealFailed', 'Could not add meal'), 'error'); return; }
    const meal = customMealToMeal(data);
    setCustomMeals(prev => editingCustomMealId ? prev.map(m => (m.id === meal.id ? meal : m)) : [meal, ...prev]);
    const wasEdit = !!editingCustomMealId;
    setEditingCustomMealId(null);
    setNewMeal({ name: '', calories: '', protein: '', carbs: '', fat: '', imageUrl: '', ingredients: '', instructions: '' });
    setShowAddMeal(false);
    if (wasEdit) showToast(t('trainerPlans.mealUpdated', 'Meal updated'), 'success');
    else pickMeal(meal); // new meal → drop it straight into the open slot
  };

  // Open the add-meal panel prefilled to EDIT one of the trainer's own meals.
  const openEditCustomMeal = (meal) => {
    setEditingCustomMealId(meal.id.startsWith('custom_') ? meal.id.slice(7) : meal.id);
    setNewMeal({
      name: meal.title || '',
      calories: String(meal.calories ?? ''), protein: String(meal.protein ?? ''),
      carbs: String(meal.carbs ?? ''), fat: String(meal.fat ?? ''),
      imageUrl: meal.image || '',
      ingredients: Array.isArray(meal.ingredients) ? meal.ingredients.join('\n') : '',
      instructions: Array.isArray(meal.steps) ? meal.steps.join('\n') : '',
    });
    setPickerPreview(null);
    setShowAddMeal(true);
  };
  // True once the trainer swapped/hand-picked a meal — Regenerate confirms
  // before throwing that work away.
  const [mealsDirty, setMealsDirty] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  // Lock the page behind any of this view's modals.
  useScrollLock(showMealModal || !!mealPickerSlot || !!confirmDeletePlan || !!mealDetail || !!duplicateTarget || !!assignTarget || showMealSharePicker || confirmRegen || !!confirmDeleteMealPlan);
  // Trainer's custom meals first, then the shared catalog.
  // The slot being filled → drives the per-meal "fits this slot" compatibility %.
  const pickerSlotType = mealPickerSlot
    ? (generatedMeals?.[mealPickerSlot.dayIdx]?.meals?.[mealPickerSlot.mealIdx]?.slotType || 'meal')
    : 'meal';
  const pickableMeals = [...customMeals, ...MEALS];
  const pickerCategories = [...new Set(pickableMeals.map(m => m.category).filter(Boolean))];
  const activeMealFilters = (mealCat !== 'all' ? 1 : 0) + (mealCalBand !== 'all' ? 1 : 0) + (mealMacroFilter !== 'all' ? 1 : 0) + (mealFitsOnly ? 1 : 0) + (mealMine ? 1 : 0);
  // Filter (category · calories · macro · ingredients · mine · fits) then score
  // each by how well it fits the client's macros for this slot, best first.
  const mealMatches = (() => {
    const q = mealSearch.trim().toLowerCase();
    let list = pickableMeals;
    if (mealMine) list = list.filter(m => m.custom);
    if (mealCat !== 'all') list = list.filter(m => m.category === mealCat);
    if (mealCalBand !== 'all') list = list.filter(m => {
      const c = Number(m.calories) || 0;
      return mealCalBand === 'lt300' ? c < 300 : mealCalBand === '300_500' ? (c >= 300 && c <= 500) : mealCalBand === '500_700' ? (c > 500 && c <= 700) : c > 700;
    });
    if (mealMacroFilter !== 'all') list = list.filter(m => {
      const cal = Number(m.calories) || 1;
      if (mealMacroFilter === 'high_protein') return (Number(m.protein) || 0) * 4 / cal >= 0.30;
      if (mealMacroFilter === 'low_carb') return (Number(m.carbs) || 0) * 4 / cal <= 0.25;
      if (mealMacroFilter === 'low_fat') return (Number(m.fat) || 0) * 9 / cal <= 0.25;
      return true;
    });
    if (q) list = list.filter(m =>
      m.title?.toLowerCase().includes(q) || m.title_es?.toLowerCase().includes(q) ||
      (Array.isArray(m.ingredients) && m.ingredients.some(ing => String(ing).toLowerCase().includes(q))));
    let scored = list.map(m => ({ m, score: mealCompatibility(m, pickerSlotType) }));
    if (mealFitsOnly) scored = scored.filter(x => x.score != null && x.score >= 70);
    if (scored.some(x => x.score != null)) scored = [...scored].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return scored;
  })();
  const filteredMeals = mealMatches.slice(0, mealVisible); // [{ m, score }]
  // Reset the picker's filters + preview + add-meal panel whenever it closes.
  useEffect(() => { if (!mealPickerSlot) { setPickerPreview(null); setMealCat('all'); setShowAddMeal(false); setShowMealFilters(false); setMealCalBand('all'); setMealMacroFilter('all'); setMealFitsOnly(false); setMealMine(false); setMealVisible(40); setEditingCustomMealId(null); } }, [mealPickerSlot]);
  // Restart pagination whenever the query/filters change.
  useEffect(() => { setMealVisible(40); }, [mealSearch, mealCat, mealCalBand, mealMacroFilter, mealFitsOnly, mealMine]);

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
    let [plansRes, clientsRes] = await Promise.all([
      supabase
        .from('trainer_workout_plans')
        // Explicit columns — `weeks` is deliberately absent. It's the whole
        // program JSONB (~45 KB for a 12-week plan), and `select('*')` pulled it
        // for EVERY plan on EVERY visit just to render card titles: ~4.5 MB at
        // 100 plans, ~22 MB at the .limit(500) ceiling. It then got
        // JSON.stringify'd into sessionStorage, which throws past the ~5 MB
        // quota — and writeTrainerCache swallows that error, so the page's whole
        // stale-while-revalidate design silently stopped caching and re-paid the
        // download on every navigation. Card day/exercise counts now come from
        // the tiny per-plan stats cache below; the blob is fetched on demand
        // when a plan is actually opened (openBuilder / confirmDuplicatePlan).
        .select('id, gym_id, trainer_id, client_id, name, description, duration_weeks, is_active, is_draft, created_at, updated_at, profiles!trainer_workout_plans_client_id_fkey(full_name)')
        .eq('trainer_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(500), // a trainer won't realistically have >500 plans
      supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true)
        // Accepted clients only (0657/0660). A pending client must not be
        // offered here: the trainer would build a whole plan and only find out
        // at save time, when RLS rejects the write. Better to not offer it.
        .eq('status', 'active'),
    ]);
    if (plansRes.error) logger.error('TrainerPlans: failed to load plans:', plansRes.error);
    // 0657 not applied yet → no `status` column, and PostgREST fails the whole
    // query. Retry without it so the picker isn't empty on an older schema.
    if (isSchemaMiss(clientsRes.error)) {
      clientsRes = await supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
    }
    if (clientsRes.error) logger.error('TrainerPlans: failed to load clients:', clientsRes.error);
    if (plansRes.error || clientsRes.error) {
      showToast(t('trainerPlans.loadFailed', 'Could not load your plans. Try again.'), 'error');
    }
    const loadedPlans = plansRes.data || [];
    // Shared assignees (0644): fold the junction members into each plan (∪ the
    // legacy client_id) so cards show the true member count. Non-fatal + skips
    // cleanly when the table isn't migrated yet.
    try {
      const ids = loadedPlans.map(p => p.id);
      if (ids.length) {
        // Chunked + paged: a raw `.in()` over the 500-plan ceiling is a ~19 KB
        // querystring (breaks past ~390 uuids), and 500 plans shared with a few
        // members each blows past PostgREST's 1000-row response cap — which
        // would have silently under-reported "shared with N members" on the
        // cards that need it most.
        const { data: jm, error: jmErr } = await selectAllInBatches(
          (chunk, from, to) => supabase
            .from('trainer_plan_members').select('plan_id, member_id')
            .in('plan_id', chunk).order('plan_id', { ascending: true }).range(from, to),
          ids,
        );
        if (!jmErr) {
          const byPlan = new Map();
          (jm || []).forEach(r => {
            if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, new Set());
            byPlan.get(r.plan_id).add(r.member_id);
          });
          loadedPlans.forEach(p => {
            const set = byPlan.get(p.id) || new Set();
            if (p.client_id) set.add(p.client_id);
            p._memberIds = p.client_id ? [p.client_id, ...[...set].filter(id => id !== p.client_id)] : [...set];
          });
        }
      }
    } catch (e) { logger.error('TrainerPlans: member-count load failed (non-fatal):', e); }

    // ── Card stats (days / exercises) without carrying the weeks blob ──────
    // Both numbers can only be derived from `weeks`, and there's no server-side
    // aggregate for them, so they're computed ONCE per plan VERSION and kept in
    // a few-bytes-per-plan cache keyed on updated_at. The blob is re-downloaded
    // only for plans that are new or edited since the last visit — the steady
    // state (open Plans, navigate away, come back, background revalidate) now
    // costs zero JSONB instead of re-pulling the whole library every time. The
    // rendered numbers are identical: same expression, same complete data.
    try {
      const statsCK = `tplans:planstats:${profile.id}`;
      const stats = readTrainerCache(statsCK) || {};
      const staleIds = loadedPlans.filter(p => stats[p.id]?.u !== p.updated_at).map(p => p.id);
      if (staleIds.length) {
        const { data: blobs, error: blobErr } = await selectInBatches(
          (chunk) => supabase.from('trainer_workout_plans')
            .select('id, updated_at, weeks').in('id', chunk),
          staleIds,
        );
        // A failed blob read only costs us the NEW plans' counts — fall through
        // and still apply every stat we already had cached rather than zeroing
        // the whole library.
        if (blobErr) logger.error('TrainerPlans: plan stats fetch failed (non-fatal):', blobErr);
        (blobs || []).forEach(b => {
          const days = Object.values(b.weeks || {}).flat();
          stats[b.id] = {
            u: b.updated_at,
            d: days.length,
            e: days.reduce((sum, day) => sum + (day.exercises?.length || 0), 0),
          };
        });
        // Drop entries for deleted plans so the cache can't grow unbounded.
        const live = new Set(loadedPlans.map(p => p.id));
        Object.keys(stats).forEach(id => { if (!live.has(id)) delete stats[id]; });
        writeTrainerCache(statsCK, stats);
      }
      loadedPlans.forEach(p => {
        p._dayCount = stats[p.id]?.d ?? 0;
        p._exerciseCount = stats[p.id]?.e ?? 0;
      });
    } catch (e) { logger.error('TrainerPlans: plan stats load failed (non-fatal):', e); }

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
      // Explicit columns — `meals` omitted. It's the full week-by-week meal
      // JSONB, and the cards below render only name / macros / client / date;
      // `select('*')` pulled every plan's meals on every visit and then
      // JSON.stringify'd them into sessionStorage, blowing the quota (the write
      // fails silently, killing this page's whole cache). openMealDetail
      // fetches the blob for the one plan the trainer actually opens.
      .select('id, gym_id, trainer_id, client_id, name, description, target_calories, target_protein_g, target_carbs_g, target_fat_g, duration_weeks, is_active, start_date, end_date, created_at, updated_at, profiles!trainer_meal_plans_client_id_fkey(full_name)')
      .eq('trainer_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(async ({ data, error }) => {
        if (error) {
          logger.error('TrainerPlans: failed to load meal plans:', error);
          showToast(t('trainerPlans.loadMealPlansFailed', 'Could not load meal plans. Try again.'), 'error');
        }
        const loaded = data || [];
        // Fold shared members (0645) into each plan's _memberIds (∪ client_id).
        try {
          const ids = loaded.map(p => p.id);
          if (ids.length) {
            // Paged for the same reason as trainer_plan_members above: 100 meal
            // plans shared with ~10 members each already crosses PostgREST's
            // 1000-row cap and would under-report the member count.
            const { data: jm, error: jmErr } = await selectAllInBatches(
              (chunk, from, to) => supabase
                .from('trainer_meal_plan_members').select('plan_id, member_id')
                .in('plan_id', chunk).order('plan_id', { ascending: true }).range(from, to),
              ids,
            );
            if (!jmErr) {
              const byPlan = new Map();
              (jm || []).forEach(r => { if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, new Set()); byPlan.get(r.plan_id).add(r.member_id); });
              loaded.forEach(p => { const set = byPlan.get(p.id) || new Set(); if (p.client_id) set.add(p.client_id); p._memberIds = p.client_id ? [p.client_id, ...[...set].filter(id => id !== p.client_id)] : [...set]; });
            }
          }
        } catch (e) { logger.error('TrainerPlans: meal member-count load failed (non-fatal):', e); }
        if (!error) writeTrainerCache(`tplans:meals:${profile.id}`, loaded);
        setMealPlans(loaded);
        setMealPlansLoading(false);
      });
  };

  // Open the saved-plan detail sheet. The list rows carry no `meals` (see
  // loadMealPlans), so fetch that one plan's blob here — the detail sheet and
  // the editor it hands off to are the only things that read it. The sheet
  // opens immediately on the row we already have and the day strip fills in
  // when the blob lands, so this never blocks the tap.
  const openMealDetail = async (plan) => {
    setMealDetail(plan);
    setMealDetailDay(0);
    setMealDetailWeek(0);
    if (Array.isArray(plan.meals)) return; // already hydrated this session
    const { data, error } = await supabase
      .from('trainer_meal_plans').select('meals').eq('id', plan.id).maybeSingle();
    if (error) {
      // Leaving `meals` undefined is deliberate: the sheet keys "can I edit
      // this?" off Array.isArray(meals), and saveMealPlan writes `meals: []`
      // when the editor has nothing loaded — so opening the editor on a failed
      // read would WIPE the plan's meals. Blocked + told, not silently unsafe.
      logger.error('TrainerPlans: failed to load plan meals:', error);
      showToast(t('trainerPlans.loadMealPlansFailed', 'Could not load meal plans. Try again.'), 'error');
      return;
    }
    const meals = Array.isArray(data?.meals) ? data.meals : [];
    // Keep the loaded blob on the list row too, so reopening (or Edit) is free.
    setMealPlans(prev => prev.map(p => (p.id === plan.id ? { ...p, meals } : p)));
    setMealDetail(d => (d && d.id === plan.id ? { ...d, meals } : d));
  };

  // Open the meal builder to EDIT an existing plan in place: prefill settings +
  // hydrate the saved meals into the editable step-2 grid, jump straight to it.
  const openMealEditor = (plan) => {
    if (!plan) return;
    setEditingMealPlanId(plan.id);
    setMealForm({
      client_id: plan.client_id || '',
      name: plan.name || '',
      description: plan.description || '',
      target_calories: plan.target_calories != null ? String(plan.target_calories) : '',
      target_protein_g: plan.target_protein_g != null ? String(plan.target_protein_g) : '',
      target_carbs_g: plan.target_carbs_g != null ? String(plan.target_carbs_g) : '',
      target_fat_g: plan.target_fat_g != null ? String(plan.target_fat_g) : '',
      duration_weeks: plan.duration_weeks || 4,
      start_date: plan.start_date || '',
    });
    const meals = Array.isArray(plan.meals) ? plan.meals : [];
    if (meals.length) {
      setGeneratedMeals(meals.map(d => ({
        meals: (d.meals || []).map(m => ({ ...m, slotType: m.slotType || m.slot })),
        totals: d.totals || null,
      })));
      setMealStep('meals');
      setMealEntryStep('meals');
    } else {
      setGeneratedMeals(null);
      setMealStep('settings');
      setMealEntryStep('settings');
    }
    setMealsDirty(false);
    setMealPreviewDay(0);
    setMealPreviewWeek(0);
    setShowMealModal(true);
  };

  const saveMealPlan = async () => {
    // Client is OPTIONAL — a plan with no client is a general/reusable plan
    // (mirrors the workout builder). Only the name is required.
    if (!mealForm.name.trim()) return;
    setMealSaving(true);
    // Single-active invariant (P2-2) applies PER CLIENT: ClientDetail reads the
    // active plan with .maybeSingle(), so retire this client's currently-active
    // plans first. General (client-less) plans can coexist, so skip when none.
    if (!editingMealPlanId && mealForm.client_id) {
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
    const fields = {
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
    };
    // Edit in place when a plan is loaded; else create a new one.
    let mealPlanId = editingMealPlanId;
    if (editingMealPlanId) {
      const { error } = await supabase.from('trainer_meal_plans').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', editingMealPlanId);
      if (error) { setMealSaving(false); showToast(t('trainerPlans.errorSavingMealPlan', 'Failed to save meal plan'), 'error'); return; }
    } else {
      const { data: ins, error } = await supabase.from('trainer_meal_plans').insert({ gym_id: profile.gym_id, trainer_id: profile.id, ...fields }).select('id').single();
      if (error) { setMealSaving(false); showToast(t('trainerPlans.errorSavingMealPlan', 'Failed to save meal plan'), 'error'); return; }
      mealPlanId = ins?.id;
    }
    // Sync the shared-members junction (0645) to primary ∪ extra share ids. Best-effort.
    if (mealPlanId) {
      const memberSet = [...new Set([fields.client_id, ...mealShareIds].filter(Boolean))];
      try {
        const NONE = '00000000-0000-0000-0000-000000000000';
        await supabase.from('trainer_meal_plan_members').delete()
          .eq('plan_id', mealPlanId).not('member_id', 'in', `(${memberSet.length ? memberSet.join(',') : NONE})`);
        if (memberSet.length) {
          await supabase.from('trainer_meal_plan_members').upsert(
            memberSet.map(mid => ({ plan_id: mealPlanId, member_id: mid, assigned_by: profile.id })),
            { onConflict: 'plan_id,member_id', ignoreDuplicates: true },
          );
        }
      } catch (e) { logger.error('TrainerPlans: meal junction sync failed (non-fatal):', e); }
    }
    posthog?.capture(editingMealPlanId ? 'trainer_meal_plan_edited' : 'trainer_meal_plan_created');
    setMealSaving(false);
    // Reuse the single teardown instead of hand-rolling a partial one. The
    // hand-rolled version forgot mealShareIds / mealEntryStep / mealsDirty, so
    // after saving a plan shared with 2 members the NEXT "New plan" opened
    // already reading "Also shared with 2" — and saving it wrote those members
    // into the new plan's junction rows.
    closeMealModal();
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

  // The list no longer carries `weeks`, so fetch it for the ONE plan being
  // opened. Only saved plans need it: a null plan (new) and the in-memory
  // template objects from `tmpl.makePlan()` already carry their own weeks.
  // PlanBuilder reads init.weeks in a useState initializer, so the blob has to
  // land BEFORE it mounts — hence the await instead of a loading prop.
  const openBuilder = async (plan = null) => {
    if (plan?.id && plan.weeks === undefined) {
      setOpeningPlanId(plan.id);
      const { data, error } = await supabase
        .from('trainer_workout_plans').select('weeks').eq('id', plan.id).maybeSingle();
      setOpeningPlanId(null);
      if (error) {
        logger.error('TrainerPlans: failed to load plan weeks:', error);
        showToast(t('trainerPlans.loadFailed', 'Could not load your plans. Try again.'), 'error');
        return;
      }
      setEditing({ ...plan, weeks: data?.weeks || {} });
      setView('builder');
      return;
    }
    setEditing(plan);
    setView('builder');
  };

  const closeBuilder = () => {
    setView('list');
    setEditing(null);
  };

  const toggleActive = async (plan) => {
    // A plan is "live" only when active AND not a draft. Activating publishes
    // a draft (clears is_draft) — otherwise it stayed a draft and nothing
    // visibly changed. Deactivating just flips is_active off.
    const isLive = plan.is_active && !plan.is_draft;
    const patch = isLive
      ? { is_active: false, updated_at: new Date().toISOString() }
      : { is_active: true, is_draft: false, updated_at: new Date().toISOString() };
    // Optimistic — the row reflects the new state instantly.
    setPlans(prev => prev.map(p => (p.id === plan.id ? { ...p, ...patch } : p)));
    const { error } = await supabase.from('trainer_workout_plans')
      .update(patch).eq('id', plan.id);
    if (error) {
      showToast(t('trainerPlans.errorToggleActive', 'Failed to update plan status'), 'error');
      loadData(); // revert to server truth
      return;
    }
    showToast(
      isLive ? t('trainerPlans.planDeactivated', 'Plan deactivated')
             : t('trainerPlans.planActivated', 'Plan activated'),
      'success',
    );
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
    // The list row no longer carries `weeks`, so read the blob for this one plan
    // — without it the "copy" would be an empty program.
    const { data: src, error: srcErr } = await supabase
      .from('trainer_workout_plans').select('weeks').eq('id', plan.id).maybeSingle();
    if (srcErr) {
      setDuplicating(false);
      logger.error('TrainerPlans: failed to read plan for duplicate:', srcErr);
      showToast(t('trainerPlans.errorDuplicatePlan', 'Failed to duplicate plan'), 'error');
      return;
    }
    // Explicit payload rather than `...rest`. The spread also carried the
    // client-side `_memberIds` field this page attaches to every plan (0644
    // shared assignees), and PostgREST rejects an insert naming a column that
    // doesn't exist — so a spread-based duplicate fails outright once the
    // junction table is populated.
    const { error } = await supabase.from('trainer_workout_plans').insert({
      gym_id: plan.gym_id,
      trainer_id: plan.trainer_id,
      client_id: duplicateClientId,
      name: `${plan.name} ${t('trainerPlans.copySuffix', '(Copy)')}`,
      description: plan.description,
      duration_weeks: plan.duration_weeks,
      weeks: src?.weeks || {},
      is_active: plan.is_active,
      is_draft: plan.is_draft,
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

  const openAssign = (plan) => {
    setAssignTarget(plan);
    setAssignIds(plan._memberIds?.length ? plan._memberIds : (plan.client_id ? [plan.client_id] : []));
  };

  const confirmAssign = async () => {
    const plan = assignTarget;
    if (!plan) return;
    setAssigning(true);
    const ids = assignIds.filter(Boolean);
    const newClientId = ids[0] || null; // legacy primary assignee
    // A draft / inactive plan never appears on a member's list — publish it when
    // handing it to real members, else "assign isn't working" (they see nothing).
    const goLive = ids.length > 0 && (plan.is_draft || !plan.is_active);
    const patch = {
      client_id: newClientId,
      updated_at: new Date().toISOString(),
      ...(goLive ? { is_active: true, is_draft: false } : {}),
    };
    // Optimistic
    setPlans(prev => prev.map(p => (p.id === plan.id ? { ...p, ...patch, _memberIds: ids } : p)));
    const { error } = await supabase.from('trainer_workout_plans').update(patch).eq('id', plan.id);
    if (error) {
      setAssigning(false);
      logger.error('TrainerPlans: failed to assign plan:', error);
      showToast(t('trainerPlans.errorAssign', 'Failed to assign plan'), 'error');
      loadData(); // revert to server truth
      return;
    }
    // Sync the shared-members junction (0644) — best-effort, matching syncPlanMembers.
    try {
      const NONE = '00000000-0000-0000-0000-000000000000';
      await supabase.from('trainer_plan_members').delete()
        .eq('plan_id', plan.id).not('member_id', 'in', `(${ids.length ? ids.join(',') : NONE})`);
      if (ids.length) {
        await supabase.from('trainer_plan_members').upsert(
          ids.map(mid => ({ plan_id: plan.id, member_id: mid, assigned_by: profile.id })),
          { onConflict: 'plan_id,member_id', ignoreDuplicates: true },
        );
      }
    } catch (e) { logger.error('TrainerPlans: assign junction sync failed (non-fatal):', e); }
    setAssigning(false);
    posthog?.capture('trainer_plan_assigned', { count: ids.length, went_live: goLive, unassigned: ids.length === 0 });
    const primaryName = clients.find(c => c.id === newClientId)?.full_name
      || (newClientId === plan.client_id ? plan.profiles?.full_name : '')
      || t('trainerPlans.aClient', 'a client');
    showToast(
      ids.length === 0 ? t('trainerPlans.planUnassigned', 'Plan unassigned')
        : ids.length > 1 ? t('trainerPlans.planAssignedN', 'Shared with {{n}} members', { n: ids.length })
          : goLive ? t('trainerPlans.planAssignedActive', 'Assigned to {{name}} · now active', { name: primaryName })
            : t('trainerPlans.planAssigned', 'Assigned to {{name}}', { name: primaryName }),
      'success',
    );
    setAssignTarget(null);
    setAssignIds([]);
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
    // Type filter — single sessions are duration_weeks === 0, programs are the rest.
    if (filterType === 'session') result = result.filter(p => p.duration_weeks === 0);
    else if (filterType === 'program') result = result.filter(p => p.duration_weeks !== 0);
    // Client filter — a plan can be SHARED with several members (0644
    // junction, folded into _memberIds), so match the primary assignee OR any
    // shared one. Matching client_id alone made a plan shared with member X
    // vanish from X's filter whenever the primary assignee was someone else —
    // even though the card counts X and the assign sheet lists X.
    if (filterClient !== 'all') {
      result = result.filter(p => p.client_id === filterClient || (p._memberIds || []).includes(filterClient));
    }
    return result;
  }, [plans, filterClient, filterStatus, filterType]);

  // Only surface the Programs/Sessions type filter once at least one single
  // session exists (nothing to filter otherwise). Keep it visible while a type
  // filter is active so you can't get stuck on an empty "Sessions" view.
  const hasSessions = useMemo(() => plans.some(p => p.duration_weeks === 0), [plans]);

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

  // Card stats read the precomputed counts (loadData) instead of walking a
  // `weeks` blob the list query no longer downloads. `weeks` is still honoured
  // when it IS present — a template plan built in memory by openBuilder() has
  // weeks and no cached stats.
  const countDaysOf = (plan) => (
    plan.weeks ? Object.values(plan.weeks).flat().length : (plan._dayCount || 0)
  );
  const countExercises = (plan) => {
    if (!plan.weeks) return plan._exerciseCount || 0;
    const allDays = Object.values(plan.weeks).flat();
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
    const days = countDaysOf(plan);
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
        {/* Header — title gets its OWN full-width line, actions sit on a row
            beneath it. Inline (space-between) they squeezed the heading into
            two ragged lines and still pushed "New plan" off the right edge on a
            phone. Back to side-by-side from md up, where there's room. */}
        <div style={{ marginBottom: 14 }}>
          <TEyebrow color={TT.accent}>{t('trainerPlans.heroLabel', 'Library')}</TEyebrow>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <TPageTitle style={{ fontSize: 30 }}>
              {section === 'training'
                ? t('trainerPlans.titleTraining', 'Training Plans')
                : t('trainerPlans.titleNutrition', 'Nutrition Plans')}
            </TPageTitle>
            {section === 'training' ? (
              <div className="flex gap-2 md:flex-shrink-0">
                {/* One-off reusable session — starts the builder already in session
                    mode. Accent-outlined so it clearly reads as a button (strong
                    secondary next to the solid teal "New plan"). */}
                <button
                  onClick={() => openBuilder({ duration_weeks: 0 })}
                  aria-label={t('trainerPlans.newSession', 'New single session')}
                  className="tt-tap tt-press"
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, padding: '0 14px', borderRadius: 12, background: TT.accentSoft, color: TT.accentInk, border: `1.5px solid ${TT.accent}`, fontFamily: TFont.display, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  <Dumbbell size={15} strokeWidth={2.4} /> {t('trainerPlans.sessionShort', 'Session')}
                </button>
                <TPrimaryButton
                  onClick={() => openBuilder()}
                  aria-label={t('trainerPlans.createPlan', 'New plan')}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                  <Plus size={15} strokeWidth={2.4} />
                  {t('trainerPlans.newPlan', 'New plan')}
                </TPrimaryButton>
              </div>
            ) : (
              <TPrimaryButton
                onClick={() => setShowMealModal(true)}
                aria-label={t('trainerPlans.createMealPlan', 'New meal plan')}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap' }}
              >
                <Plus size={15} strokeWidth={2.4} />
                {t('trainerPlans.newPlan', 'New plan')}
              </TPrimaryButton>
            )}
          </div>
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

        {/* No swipe here: this page is full of horizontally-scrolling rails
            (template cards, status chips, the client filter) and a page-level
            drag competed with every one of them. Tabs still switch on tap. */}
        <SwipeableTabView activeIndex={sectionIndex} onChangeIndex={setSectionIndex} tabKeys={['training', 'nutrition']} swipeDisabled>
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

            {/* Status + client filter strip (small, above plans).
                WRAPS instead of scrolling horizontally: four status pills plus a
                three-way segmented control plus a client select never fit one
                phone-width row, so the type filter was permanently cut off at
                the right edge with nothing to suggest it was scrollable. */}
            {plans.length > 0 && (
              <div style={{ display: 'flex', gap: 6, rowGap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }} className="scrollbar-hide">
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
                {/* Type filter — Programs vs single Sessions. Distinct segmented
                    control (not another pill) so the two filter axes read apart. */}
                {(hasSessions || filterType !== 'all') && (
                  <>
                    <div style={{ width: 1, height: 22, background: TT.border, flexShrink: 0, margin: '0 3px' }} />
                    <div className="flex flex-shrink-0 rounded-full p-[3px] gap-[2px]" style={{ background: TT.surface2, border: `1px solid ${TT.border}` }}>
                      {[
                        { key: 'all',     label: t('trainerPlans.typeAll', 'All'), Icon: null },
                        { key: 'program', label: t('trainerPlans.typePrograms', 'Programs'), Icon: Calendar },
                        { key: 'session', label: t('trainerPlans.typeSessions', 'Sessions'), Icon: Dumbbell },
                      ].map(({ key, label, Icon }) => {
                        const on = filterType === key;
                        return (
                          <button key={key} type="button" onClick={() => setFilterType(key)}
                            className="flex items-center gap-1 rounded-full px-2.5 min-h-[28px] text-[11.5px] font-bold transition-all whitespace-nowrap tt-tap"
                            style={on ? { background: TT.accent, color: '#06363B' } : { background: 'transparent', color: TT.textMute }}>
                            {Icon && <Icon size={12} strokeWidth={2.4} />}{label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5" style={{ alignItems: 'start' }}>
                {filtered.map((plan, idx) => {
                  const { tone, type } = planTone(plan);
                  const totalDays = countDaysOf(plan);
                  const totalEx = countExercises(plan);
                  const clientName = plan.profiles?.full_name;
                  // Shared plans (0644): the true assignee count is the junction ∪ client_id.
                  const assignedCount = plan._memberIds?.length ?? (plan.client_id ? 1 : 0);
                  const isSession = plan.duration_weeks === 0; // single reusable session (sentinel)
                  const kindLabel = isSession ? t('trainerPlans.singleSession', 'Single session') : type;
                  // First card open, the rest collapsed — user can toggle any.
                  const open = planOverrides[plan.id] ?? (idx === 0);
                  // "Live" = published + active. Draft or archived → the CTA offers Activate.
                  const isLive = plan.is_active && !plan.is_draft;
                  const status = plan.is_draft
                    ? { c: MK.amber, label: t('trainerPlans.draftBadge', 'DRAFT') }
                    : plan.is_active
                      ? { c: MK.teal, label: t('trainerPlans.active', 'Active') }
                      : { c: MK.ink3, label: t('trainerPlans.inactive', 'Inactive') };
                  const STATS = isSession
                    ? [
                        { c: MK.coach, v: totalDays || 1, l: t('trainerPlans.daysAbbrev', 'days') },
                        { c: MK.amber, v: totalEx, l: t('trainerPlans.exercisesShort', 'exercises') },
                      ]
                    : [
                        { c: MK.teal, v: plan.duration_weeks || 0, l: t('trainerPlans.weeks', 'weeks') },
                        { c: MK.coach, v: totalDays, l: t('trainerPlans.daysAbbrev', 'days') },
                        { c: MK.amber, v: totalEx, l: t('trainerPlans.exercisesShort', 'exercises') },
                      ];
                  const assignLabel = assignedCount > 0
                    ? `${assignedCount} ${assignedCount === 1 ? t('trainerPlans.clientWord', 'client') : t('trainerPlans.clientsWord', 'clients')}`
                    : t('trainerPlans.unassigned', 'Unassigned');
                  return (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: Math.min(idx * 0.03, 0.3) }}
                      style={{ background: MK.surface, borderRadius: 24, boxShadow: MK.shadow, overflow: 'hidden' }}
                    >
                      {/* tone-gradient header — tap toggles the card open/closed */}
                      <div
                        className="tt-tap"
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={() => setPlanOverrides(o => ({ ...o, [plan.id]: !open }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlanOverrides(o => ({ ...o, [plan.id]: !open })); } }}
                        style={{ background: `linear-gradient(135deg, ${soft(tone, 18)}, ${soft(tone, 7)})`, padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                      >
                        <div style={{ width: 46, height: 46, borderRadius: 14, background: MK.surface, boxShadow: MK.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <ClipboardList size={23} color={tone} strokeWidth={2} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="truncate" style={{ fontFamily: MK.disp, fontSize: 19, fontWeight: 900, color: MK.ink, letterSpacing: -0.6 }}>{plan.name}</div>
                          <div className="truncate" style={{ fontSize: 12.5, color: inkOf(tone), marginTop: 2, fontWeight: 600 }}>
                            {kindLabel} · {assignLabel}
                          </div>
                        </div>
                        <MkTag c={status.c} dot size="s">{status.label}</MkTag>
                        <ChevronDown size={20} color={inkOf(tone)} style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }} />
                      </div>
                      {/* body — hidden when collapsed */}
                      {open && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} style={{ padding: 18 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STATS.length},1fr)`, gap: 9, marginBottom: 14 }}>
                            {STATS.map((s, i) => (
                              <div key={i} style={{ background: soft(s.c, 15), borderRadius: 15, padding: '12px 9px', textAlign: 'center' }}>
                                <div style={{ fontFamily: MK.disp, fontSize: 22, fontWeight: 900, color: s.c, letterSpacing: -0.8, lineHeight: 1 }}>{s.v}</div>
                                <div style={{ fontFamily: MK.disp, fontSize: 10.5, fontWeight: 800, color: inkOf(s.c), textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{s.l}</div>
                              </div>
                            ))}
                          </div>
                          {/* who it's assigned to — the Assign/Change button is the
                              primary way to hand a plan to a client (builder select
                              is edit-locked). Unassigned → loud teal "Assign". */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                            <div style={{ width: 30, height: 30, borderRadius: 9, background: soft(assignedCount > 0 ? MK.coach : MK.teal, 14), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Users size={15} color={assignedCount > 0 ? MK.coach : MK.teal} />
                            </div>
                            <span className="truncate" style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: MK.ink2 }}>
                              {assignedCount > 1
                                ? t('trainerPlans.sharedWithN', 'Shared with {{n}} members', { n: assignedCount })
                                : assignedCount === 1
                                  ? t('trainerPlans.assignedTo', 'Assigned to {{name}}', { name: clientName || t('trainerPlans.aClient', 'a client') })
                                  : t('trainerPlans.noClientsAssigned', 'Not assigned to any client')}
                            </span>
                            <MkBtn
                              size="s"
                              variant={assignedCount > 0 ? 'secondary' : 'soft'}
                              accent={MK.teal}
                              icon={<UserPlus size={14} />}
                              onClick={() => openAssign(plan)}
                              style={{ flexShrink: 0 }}
                            >
                              {assignedCount > 0 ? t('trainerPlans.change', 'Change') : t('trainerPlans.assign', 'Assign')}
                            </MkBtn>
                          </div>
                          {plan.description && <p className="line-clamp-2" style={{ fontSize: 12.5, color: MK.ink2, marginBottom: 14 }}>{plan.description}</p>}
                          {/* actions — Edit + Activate/Deactivate (flips) + duplicate + delete */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 14, borderTop: `1px solid ${MK.line}` }}>
                            <MkBtn size="s" disabled={openingPlanId === plan.id}
                              icon={openingPlanId === plan.id
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Pencil size={14} />}
                              onClick={() => openBuilder(plan)} style={{ flex: '1 1 auto' }}>
                              {t('trainerPlans.edit', 'Edit')}
                            </MkBtn>
                            <MkBtn size="s" variant="soft" accent={isLive ? MK.coral : MK.teal}
                              onClick={() => toggleActive(plan)} style={{ flex: '1 1 auto' }}>
                              {isLive ? t('trainerPlans.deactivate', 'Deactivate') : t('trainerPlans.activate', 'Activate')}
                            </MkBtn>
                            <MkIconBtn size={40} onClick={() => duplicatePlan(plan)}>
                              <Copy size={17} color={MK.ink2} />
                            </MkIconBtn>
                            <MkIconBtn size={40} soft={soft(MK.coral, 15)} onClick={() => setConfirmDeletePlan(plan)}>
                              <Trash2 size={17} color={inkOf(MK.coral)} />
                            </MkIconBtn>
                          </div>
                          <div style={{ fontSize: 11, color: MK.ink3, marginTop: 12 }}>
                            {t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy', { locale: dateFnsLocale })}
                            {plan.updated_at !== plan.created_at && ` · ${t('trainerPlans.updated', 'Updated')} ${format(new Date(plan.updated_at), 'MMM d, yyyy', { locale: dateFnsLocale })}`}
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
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
              {filteredMealPlans.map(plan => {
                const macros = { protein: plan.target_protein_g || 0, carbs: plan.target_carbs_g || 0, fat: plan.target_fat_g || 0 };
                const hasMacros = plan.target_calories || macros.protein || macros.carbs || macros.fat;
                return (
                  <div key={plan.id} className="tt-tap" role="button" tabIndex={0}
                    onClick={() => openMealDetail(plan)}
                    onKeyDown={(e) => { if (e.key === 'Enter') openMealDetail(plan); }}
                    style={{ background: MK.surface, borderRadius: 24, boxShadow: MK.shadow, overflow: 'hidden', cursor: 'pointer' }}>
                    {/* teal-gradient header */}
                    <div style={{ background: `linear-gradient(135deg, ${soft(MK.teal, 16)}, ${soft(MK.teal, 7)})`, padding: '17px 18px', display: 'flex', alignItems: 'center', gap: 13 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 15, background: MK.surface, boxShadow: MK.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <UtensilsCrossed size={24} color={MK.tealDark} strokeWidth={2} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ fontFamily: MK.disp, fontSize: 20, fontWeight: 900, color: MK.ink, letterSpacing: -0.6 }}>{plan.name}</div>
                        <div style={{ fontSize: 12.5, color: inkOf(MK.teal), marginTop: 2, fontWeight: 600 }}>
                          {(plan._memberIds?.length ?? (plan.client_id ? 1 : 0)) > 1
                            ? t('trainerPlans.sharedWithN', 'Shared with {{n}} members', { n: plan._memberIds.length })
                            : plan.profiles?.full_name
                              ? t('trainerPlans.assignedTo', 'Assigned to {{name}}', { name: plan.profiles.full_name })
                              : t('trainerPlans.noClientShort', 'General plan')}
                        </div>
                      </div>
                      <MkTag c={plan.is_active ? MK.teal : MK.ink3} dot size="s">{plan.is_active ? t('trainerPlans.active', 'Active') : t('trainerPlans.past', 'Past')}</MkTag>
                    </div>
                    {/* body */}
                    <div style={{ padding: 18 }}>
                      {hasMacros ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                          <MacroRing kcal={plan.target_calories || 0} size={70} stroke={8} value={1} />
                          <div style={{ flex: 1 }}><MacroCells macros={macros} /></div>
                        </div>
                      ) : null}
                      {plan.description && <p className="line-clamp-2" style={{ fontSize: 12.5, color: MK.ink2, marginBottom: 14 }}>{plan.description}</p>}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: `1px solid ${MK.line}` }}>
                        <span style={{ fontSize: 11.5, color: MK.ink3 }}>{t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy', { locale: dateFnsLocale })}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MK.disp, fontSize: 12.5, fontWeight: 800, color: MK.tealDark }}>{t('trainerPlans.openPlan', 'Open plan')}<ChevronRight size={15} color={MK.tealDark} strokeWidth={2.4} /></span>
                      </div>
                    </div>
                  </div>
                );
              })}
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
          <div className="w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col" style={{ position: 'relative', borderRadius: 26, background: MK.bg, boxShadow: MK.shadowLg }} onClick={e => e.stopPropagation()}>

            {/* ── STEP 1: EDIT (settings) — "Warmth (B)" ── */}
            {mealStep === 'settings' && (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide" style={{ padding: '22px 20px 18px' }}>
                  <MkSheetHead title={editingMealPlanId ? t('trainerPlans.editMealPlan', 'Edit meal plan') : t('trainerPlans.createMealPlan', 'Create meal plan')} onClose={closeMealModal} />

                  {/* Client */}
                  <MkSec style={{ marginTop: 22 }}><MkSectionHead icon={<User size={17} strokeWidth={2.1} />} tint={MK.coach}>{t('trainerPlans.client', 'Client')}</MkSectionHead>
                    <div style={{ position: 'relative', height: 56, borderRadius: 18, background: MK.surface, boxShadow: MK.shadow, display: 'flex', alignItems: 'center', gap: 12, padding: '0 15px' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 999, flexShrink: 0, background: `linear-gradient(145deg, ${MK.coach}, ${mpShade(MK.coach, -16)})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MK.disp, fontWeight: 800, fontSize: 16 }}>
                        {mealForm.client_id ? ((clients.find(c => c.id === mealForm.client_id)?.full_name || '?').trim().charAt(0).toUpperCase()) : <User size={18} />}
                      </div>
                      <div className="truncate" style={{ flex: 1, minWidth: 0, fontFamily: MK.disp, fontSize: 16, fontWeight: 800, color: mealForm.client_id ? MK.ink : MK.ink3 }}>
                        {mealForm.client_id ? (clients.find(c => c.id === mealForm.client_id)?.full_name || '—') : t('trainerPlans.noClientGeneral', 'No client (general plan)')}
                      </div>
                      <ChevronDown size={20} color={MK.ink3} />
                      {/* Full-row invisible select so tapping anywhere (incl. the chevron) opens the native picker */}
                      <select value={mealForm.client_id} onChange={e => { setMealForm(f => ({ ...f, client_id: e.target.value })); setMealGoalOverride(null); setGeneratedMeals(null); }}
                        aria-label={t('trainerPlans.client', 'Client')}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, padding: 0, opacity: 0, border: 'none', outline: 'none', cursor: 'pointer', WebkitAppearance: 'none', appearance: 'none' }}>
                        <option value="">{t('trainerPlans.noClientGeneral', 'No client (general plan)')}</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                      </select>
                    </div>
                    {/* Share the SAME plan with additional members (0645) */}
                    <button type="button" onClick={() => setShowMealSharePicker(true)}
                      className="tt-tap" style={{ width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', gap: 11, minHeight: 48, borderRadius: 14, background: mealShareIds.length ? soft(MK.teal, 14) : MK.surface, boxShadow: mealShareIds.length ? 'none' : MK.shadow, padding: '0 14px', border: mealShareIds.length ? `1px solid ${MK.teal}` : 'none', cursor: 'pointer' }}>
                      <Users size={17} color={MK.teal} style={{ flexShrink: 0 }} />
                      <span className="truncate" style={{ flex: 1, minWidth: 0, textAlign: 'left', fontFamily: MK.disp, fontSize: 14, fontWeight: 800, color: mealShareIds.length ? inkOf(MK.teal) : MK.ink3 }}>
                        {mealShareIds.length === 0 ? t('trainerPlans.shareWithMore', 'Share with more members') : t('trainerPlans.alsoSharedN', 'Also shared with {{n}}', { n: mealShareIds.length })}
                      </span>
                      <Plus size={17} color={mealShareIds.length ? inkOf(MK.teal) : MK.ink3} />
                    </button>
                  </MkSec>

                  {/* Plan details — FIRST after the client. Naming the plan is
                      the one thing you always do here, and it used to sit below
                      the profile card + goal pills + auto-calc button, so you
                      had to scroll past everything to type a name. */}
                  <MkSec><MkSectionHead icon={<Pencil size={16} strokeWidth={2.1} />} tint={MK.amber}>{t('trainerPlans.planDetails', 'Plan details')}</MkSectionHead>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div>
                        <div style={{ fontFamily: MK.disp, fontSize: 11.5, fontWeight: 800, color: MK.ink2, marginBottom: 8 }}>{t('trainerPlans.planName', 'Plan name')}</div>
                        <input value={mealForm.name} onChange={e => setMealForm(f => ({ ...f, name: e.target.value }))} placeholder={t('trainerPlans.mealPlanNamePlaceholder', 'e.g. Cutting Phase, Bulking Plan')}
                          style={{ width: '100%', height: 48, borderRadius: 14, background: MK.inset, boxShadow: `inset 0 0 0 1.5px ${MK.border}`, padding: '0 15px', fontFamily: MK.disp, fontSize: 15.5, fontWeight: 700, color: MK.ink, outline: 'none' }} />
                      </div>
                      <div>
                        <div style={{ fontFamily: MK.disp, fontSize: 11.5, fontWeight: 800, color: MK.ink2, marginBottom: 8 }}>{t('trainerPlans.description', 'Description')}</div>
                        <textarea value={mealForm.description} onChange={e => setMealForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder={t('trainerPlans.mealDescPlaceholder', 'Optional notes about the plan…')}
                          style={{ width: '100%', minHeight: 76, borderRadius: 14, background: MK.inset, boxShadow: `inset 0 0 0 1.5px ${MK.border}`, padding: '13px 15px', fontSize: 14.5, color: MK.ink, outline: 'none', resize: 'none', fontFamily: MK.disp }} />
                      </div>
                    </div>
                  </MkSec>

                  {/* Client profile + goal + auto-calc */}
                  {mealClientProfile?.onboarding && (
                    <MkSec><MkSectionHead icon={<Gauge size={17} strokeWidth={2.1} />}>{t('trainerPlans.clientProfile', 'Client profile')}</MkSectionHead>
                      <MkCard pad={16}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 9 }}>
                          {[[t('trainerPlans.level', 'Level'), mealClientProfile.onboarding.fitness_level || '—'],
                            [t('trainerPlans.goal', 'Goal'), mealClientProfile.onboarding.primary_goal ? t(`trainerNotes.goals.${mealClientProfile.onboarding.primary_goal}`, mealClientProfile.onboarding.primary_goal.replace(/_/g, ' ')) : '—'],
                            [t('trainerPlans.daysWeek', 'Days / wk'), mealClientProfile.onboarding.training_days_per_week || '—'],
                            [t('trainerPlans.weight', 'Weight'), mealClientProfile.latestWeight ? `${Math.round(mealClientProfile.latestWeight)} ${t('common:lbs', 'lbs')}` : '—']].map((s, i) => (
                            <div key={i} style={{ background: MK.inset, borderRadius: 13, padding: '11px 14px' }}>
                              <div style={{ fontFamily: MK.disp, fontSize: 10.5, fontWeight: 700, color: MK.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s[0]}</div>
                              <div className="capitalize" style={{ fontFamily: MK.disp, fontSize: 15, fontWeight: 900, color: MK.ink, marginTop: 2 }}>{s[1]}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontFamily: MK.disp, fontSize: 12, fontWeight: 800, color: MK.ink2, textTransform: 'uppercase', letterSpacing: 0.7, margin: '18px 0 11px' }}>{t('trainerPlans.nutritionGoal', 'Nutrition goal')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {GOAL_OPTIONS.map(g => { const cg = mealClientProfile.onboarding.primary_goal; const on = mealGoalOverride ? mealGoalOverride === g : cg === g;
                            return <MkPill key={g} on={on} c={MK.teal} size="s" onClick={() => setMealGoalOverride(g === cg ? null : g)}>{t(`trainerNotes.goals.${g}`, g.replace(/_/g, ' '))}</MkPill>; })}
                        </div>
                        <div style={{ marginTop: 16 }}><MkBtn variant="soft" block icon={<Zap size={17} color={inkOf(MK.teal)} />} onClick={handleAutoCalculateMacros}>{t('trainerPlans.autoCalculateMacros', 'Auto-calculate macros')}</MkBtn></div>
                      </MkCard>
                    </MkSec>
                  )}

                  {/* Macro targets — editable colored cards */}
                  <MkSec><MkSectionHead icon={<Target size={17} strokeWidth={2.1} />} action={t('trainerPlans.autoCalcShort', 'Auto-calc')} onAction={handleAutoCalculateMacros}>{t('trainerPlans.macroTargets', 'Macro targets')}</MkSectionHead>
                    <div style={{ display: 'flex', gap: 7 }}>
                      {[{ key: 'target_calories', label: t('trainerNotes.nutrition.cal', 'Cal'), c: MK.cal }, { key: 'target_protein_g', label: t('trainerNotes.nutrition.protein', 'Protein'), c: MK.pro }, { key: 'target_carbs_g', label: t('trainerNotes.nutrition.carbs', 'Carbs'), c: MK.carb }, { key: 'target_fat_g', label: t('trainerNotes.nutrition.fat', 'Fat'), c: MK.fat }].map(({ key, label, c }) => (
                        <div key={key} style={{ flex: 1, minWidth: 0, background: soft(c, 13), borderRadius: 14, padding: '11px 4px 12px', textAlign: 'center', overflow: 'hidden' }}>
                          <div style={{ fontFamily: MK.disp, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: inkOf(c) }}>{label}</div>
                          <input type="number" inputMode="numeric" value={mealForm[key]} onChange={e => setMealForm(f => ({ ...f, [key]: e.target.value }))} placeholder="0"
                            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', fontFamily: MK.disp, fontSize: 19, fontWeight: 900, color: MK.ink, letterSpacing: -0.5, marginTop: 4 }} />
                        </div>
                      ))}
                    </div>
                  </MkSec>

                  {/* Plan length */}
                  <MkSec><MkSectionHead icon={<Calendar size={17} strokeWidth={2.1} />} tint={MK.coach}>{t('trainerPlans.planLength', 'Plan length')}</MkSectionHead>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
                      {[1, 2, 4, 6, 8, 12].map(w => <MkPill key={w} on={Number(mealForm.duration_weeks) === w} c={MK.coach} onClick={() => setMealForm(f => ({ ...f, duration_weeks: w }))}>{w}{t('trainerPlans.wSuffix', 'w')}</MkPill>)}
                      {(() => { const custom = ![1, 2, 4, 6, 8, 12].includes(Number(mealForm.duration_weeks)); return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 40, padding: '0 13px', borderRadius: 999, ...(custom ? { background: MK.coach } : { background: soft(MK.coach, 13), boxShadow: `inset 0 0 0 1.5px ${MK.border}` }) }}>
                          <input type="number" inputMode="numeric" min={1} max={52} value={mealForm.duration_weeks}
                            onChange={e => { const v = parseInt(e.target.value, 10); setMealForm(f => ({ ...f, duration_weeks: isNaN(v) ? '' : Math.max(1, Math.min(52, v)) })); }}
                            aria-label={t('trainerPlans.customWeeks', 'Custom weeks')} style={{ width: 26, background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', fontFamily: MK.disp, fontSize: 13.5, fontWeight: 800, color: custom ? '#fff' : inkOf(MK.coach) }} />
                          <span style={{ fontFamily: MK.disp, fontSize: 12, fontWeight: 800, color: custom ? '#fff' : inkOf(MK.coach) }}>{t('trainerPlans.wSuffix', 'w')}</span>
                        </div>
                      ); })()}
                    </div>
                    <div style={{ fontFamily: MK.disp, fontSize: 11.5, fontWeight: 800, color: MK.ink2, marginBottom: 8 }}>{t('trainerPlans.startDate', 'Start date (optional)')}</div>
                    <div style={{ height: 48, borderRadius: 14, background: MK.inset, boxShadow: `inset 0 0 0 1.5px ${MK.border}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 15px' }}>
                      <Calendar size={17} color={MK.teal} strokeWidth={2} />
                      <input type="date" value={mealForm.start_date} onChange={e => setMealForm(f => ({ ...f, start_date: e.target.value }))}
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: MK.mono, fontSize: 15, fontWeight: 700, color: MK.ink }} />
                    </div>
                  </MkSec>

                  {/* Preferences */}
                  {mealClientProfile?.onboarding && (
                    <MkSec><MkSectionHead icon={<Leaf size={17} strokeWidth={2.1} />} tint={MK.good}>{t('trainerPlans.preferences', 'Preferences')}</MkSectionHead>
                      <MkCard pad={16}>
                        <div style={{ fontSize: 12.5, color: MK.ink2, marginBottom: 14 }}>{t('trainerPlans.prefsHint', 'Used to filter the generated meals')}</div>
                        <div style={{ fontFamily: MK.disp, fontSize: 11, fontWeight: 800, color: MK.ink3, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10 }}>{t('trainerPlans.allergiesLabel', 'Allergies')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {[...new Set([...COMMON_ALLERGENS, ...mealPrefs.allergies])].map(a => <MkPill key={a} on={mealPrefs.allergies.includes(a)} c={MK.coral} size="s" onClick={() => togglePref('allergies', a)}>{prefLabel(a)}</MkPill>)}
                        </div>
                        <div style={{ fontFamily: MK.disp, fontSize: 11, fontWeight: 800, color: MK.ink3, textTransform: 'uppercase', letterSpacing: 0.7, margin: '18px 0 10px' }}>{t('trainerPlans.dietLabel', 'Diet')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {[...new Set([...COMMON_DIETS, ...mealPrefs.restrictions])].map(d => <MkPill key={d} on={mealPrefs.restrictions.includes(d)} c={MK.good} size="s" onClick={() => togglePref('restrictions', d)}>{prefLabel(d)}</MkPill>)}
                        </div>
                      </MkCard>
                    </MkSec>
                  )}
                </div>

                {/* Footer — Step 1 */}
                <div style={{ flexShrink: 0, background: MK.bgElev, boxShadow: `0 -1px 0 ${MK.line}`, padding: '14px 20px 30px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* When meals already exist (came back, or editing) — regenerating is opt-in, not forced. */}
                  {generatedMeals && (
                    <MkBtn variant="ghost" block disabled={generatingMeals || !mealForm.target_calories || !mealForm.target_protein_g}
                      icon={generatingMeals ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={15} />}
                      onClick={() => { if (mealsDirty) setConfirmRegen(true); else handleGenerateMeals(); }}>
                      {generatingMeals ? t('trainerPlans.generating', 'Generating…') : t('trainerPlans.regenerateFromSettings', 'Regenerate from these settings')}
                    </MkBtn>
                  )}
                  {/* Fresh create — two paths: let the trainer build it themselves, or generate with AI */}
                  {!generatedMeals && (
                    <MkBtn variant="soft" block icon={<Pencil size={16} color={inkOf(MK.teal)} />} disabled={generatingMeals || !mealForm.name.trim()} onClick={handleBuildMyself}>
                      {t('trainerPlans.buildItMyself', 'Build it myself')}
                    </MkBtn>
                  )}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <MkBtn variant="secondary" block onClick={closeMealModal}>{t('trainerPlans.cancel', 'Cancel')}</MkBtn>
                    {generatedMeals ? (
                      <MkBtn variant="primary" block icon={<ChevronRight size={17} color="#fff" />} onClick={() => setMealStep('meals')}>
                        {t('trainerPlans.continueToMeals', 'Continue to meals')}
                      </MkBtn>
                    ) : (
                      <MkBtn variant="primary" block disabled={generatingMeals || !mealForm.target_calories || !mealForm.target_protein_g || !mealForm.name.trim()}
                        icon={generatingMeals ? <Loader2 size={17} color="#fff" className="animate-spin" /> : <Zap size={17} color="#fff" />} onClick={handleGenerateMeals}>
                        {generatingMeals ? t('trainerPlans.generating', 'Generating…') : t('trainerPlans.generateWithAI', 'Generate with AI')}
                      </MkBtn>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── STEP 2: Meal Preview ── */}
            {mealStep === 'meals' && generatedMeals && (
              <>
                {/* Generous bottom padding so the last card / "Add meal" clears
                    the fixed Regenerate+Save footer instead of sitting flush
                    under its edge. */}
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide" style={{ padding: '22px 20px 36px' }}>
                  {/* Back exits when the modal opened here (editing an existing
                      plan). Settings is still reachable via the right action, so
                      nothing is lost — it just stops pretending to be "back". */}
                  <MkSheetHead
                    title={t('trainerPlans.weeklyMeals', 'Weekly meals')}
                    back={mealEntryStep === 'meals' ? closeMealModal : () => setMealStep('settings')}
                    onClose={closeMealModal}
                    right={mealEntryStep === 'meals' ? (
                      <button type="button" onClick={() => setMealStep('settings')}
                        aria-label={t('trainerPlans.planSettings', 'Plan settings')}
                        className="tt-tap"
                        style={{ width: 38, height: 38, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', background: MK.surface, boxShadow: `inset 0 0 0 1.5px ${MK.border}`, border: 'none', cursor: 'pointer' }}>
                        <SlidersHorizontal size={17} color={MK.ink2} />
                      </button>
                    ) : undefined}
                  />
                  {(() => {
                    const dw = Math.max(1, Number(mealForm.duration_weeks) || 1);
                    const previewStart = mealForm.start_date ? new Date(`${mealForm.start_date}T00:00:00`) : new Date();
                    const dayDate = (i) => new Date(previewStart.getTime() + (mealPreviewWeek * 7 + i) * 86400000);
                    return (
                      <MkSec style={{ marginTop: 20 }}>
                        {dw > 1 && <MkWeekPicker idx={mealPreviewWeek} total={dw} onPrev={() => setMealPreviewWeek(w => Math.max(0, w - 1))} onNext={() => setMealPreviewWeek(w => Math.min(dw - 1, w + 1))} />}
                        {dw > 1 && <MkNote>{t('trainerPlans.weeklyRotationNote', 'The same weekly plan repeats each week.')}</MkNote>}
                        <div style={{ marginTop: dw > 1 ? 14 : 0 }}>
                          {/* Label comes from the DATE, not the slot index: the
                              chip shows a real calendar day number, so pairing it
                              with DAY_LABELS[i] read "Sun 23" on a Thursday
                              whenever start_date wasn't a Sunday. */}
                          <MkChipStrip dark value={mealPreviewDay} options={DAY_LABELS.map((_, i) => { const dd = dayDate(i); return { v: i, l: `${DAY_LABELS[dd.getDay()]} ${dd.getDate()}` }; })} onChange={setMealPreviewDay} />
                        </div>
                      </MkSec>
                    );
                  })()}

                  {generatedMeals[mealPreviewDay] && (
                    <div>
                      {/* day totals bar */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '20px 0 16px', background: MK.surface, borderRadius: 16, boxShadow: MK.shadow, padding: '13px 15px' }}>
                        <MacroReadout kcal={generatedMeals[mealPreviewDay].totals?.calories} macros={{ protein: generatedMeals[mealPreviewDay].totals?.protein, carbs: generatedMeals[mealPreviewDay].totals?.carbs, fat: generatedMeals[mealPreviewDay].totals?.fat }} size={13} />
                        {generatedMeals[mealPreviewDay].fits && <MkTag c={MK.good} size="s"><Check size={13} color={inkOf(MK.good)} strokeWidth={2.6} style={{ display: 'inline', marginRight: 2 }} />{t('trainerPlans.macrosFit', 'Macros fit')}</MkTag>}
                      </div>

                      {/* Meal cards */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                        {(generatedMeals[mealPreviewDay].meals || []).map((meal, mi) => {
                          const slot = MEAL_SLOTS.find(s => s.type === meal.slotType) || MEAL_SLOTS[mi] || MEAL_SLOTS[3];
                          const slotC = MK_SLOT_C[slot.type] || MK.teal;
                          const mealTitle = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                          return (
                            <div key={mi} style={{ background: MK.surface, borderRadius: 20, boxShadow: MK.shadow, overflow: 'hidden' }}>
                              <div style={{ height: 5, background: slotC }} />
                              <div style={{ padding: 15 }}>
                                <div style={{ display: 'flex', gap: 13 }}>
                                  <FoodTile src={mealImgSrc(meal.image) || null} label={mealTitle} size={64} r={16} tint={slotC} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                      <MkTag c={slotC} size="s">{slot.label}</MkTag>
                                      <div style={{ display: 'flex', gap: 6 }}>
                                        <MkIconBtn size={31} r={10} onClick={() => swapMeal(mealPreviewDay, mi)}><RefreshCw size={15} color={MK.ink2} /></MkIconBtn>
                                        <MkIconBtn size={31} r={10} soft={soft(MK.teal, 15)} onClick={() => { setMealPickerSlot({ dayIdx: mealPreviewDay, mealIdx: mi }); setMealSearch(''); }}><Pencil size={15} color={inkOf(MK.teal)} /></MkIconBtn>
                                        <MkIconBtn size={31} r={10} soft={soft(MK.coral, 15)} onClick={() => removeMeal(mealPreviewDay, mi)}><Trash2 size={15} color={inkOf(MK.coral)} /></MkIconBtn>
                                      </div>
                                    </div>
                                    <div className="truncate" style={{ fontFamily: MK.disp, fontSize: 15.5, fontWeight: 800, color: MK.ink, letterSpacing: -0.3, lineHeight: 1.15, margin: '8px 0 7px' }}>{mealTitle}</div>
                                    <MacroReadout kcal={meal.calories} macros={{ protein: meal.protein, carbs: meal.carbs, fat: meal.fat }} size={11.5} gap={8} />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 9, marginTop: 13 }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 14px', borderRadius: 999, background: MK.inset }}>
                                    <Clock size={15} color={MK.ink3} />
                                    <input type="time" value={meal.time || ''} onChange={e => updateMealField(mealPreviewDay, mi, 'time', e.target.value)} aria-label={t('trainerPlans.mealTime', 'Meal time')}
                                      style={{ background: 'transparent', border: 'none', outline: 'none', fontFamily: MK.mono, fontSize: 13, fontWeight: 700, color: MK.ink, width: 66 }} />
                                  </div>
                                  <input type="text" value={meal.notes || ''} onChange={e => updateMealField(mealPreviewDay, mi, 'notes', e.target.value)} placeholder={t('trainerPlans.mealNotes', 'Notes (optional)')}
                                    style={{ flex: 1, minWidth: 0, height: 40, padding: '0 15px', borderRadius: 999, background: MK.inset, border: 'none', outline: 'none', fontSize: 13, color: MK.ink }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {/* Add another meal to this day */}
                        <button type="button" className="tt-tap" onClick={() => addMealToDay(mealPreviewDay)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 48, borderRadius: 15, background: soft(MK.teal, 13), color: inkOf(MK.teal), border: `1.5px dashed ${MK.teal}55`, fontFamily: MK.disp, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                          <Plus size={16} strokeWidth={2.4} /> {t('trainerPlans.addMeal', 'Add meal')}
                        </button>
                      </div>

                      {/* ── Meal Picker Overlay ──
                          PORTALED to body on purpose. It used to render inline
                          here, and although it is `fixed z-[110]`, it sat inside
                          the builder's own stacking context — so the builder's
                          Regenerate / Save footer painted OVER it, covering the
                          "Use this meal" button and still swallowing taps (which
                          saved the plan and threw you off the page). A portal
                          escapes every ancestor stacking context. */}
                      {mealPickerSlot && createPortal(
                        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={() => setMealPickerSlot(null)}>
                          <div className="rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" style={{ position: 'relative', backgroundColor: TT.surface, border: `1px solid ${TT.borderSolid}` }} onClick={e => e.stopPropagation()}>
                            {/* Tap-a-meal PREVIEW — see the dish, macros, ingredients + steps before using it */}
                            {pickerPreview && (() => {
                              const m = pickerPreview;
                              const pTitle = i18n.language === 'es' && m.title_es ? m.title_es : m.title;
                              const ings = Array.isArray(m.ingredients) ? m.ingredients : [];
                              const amts = Array.isArray(m.ingredientAmounts) ? m.ingredientAmounts : [];
                              const steps = (i18n.language === 'es' && Array.isArray(m.steps_es) && m.steps_es.length ? m.steps_es : (Array.isArray(m.steps) ? m.steps : []));
                              return (
                                <div className="absolute inset-0 z-10 flex flex-col" style={{ background: TT.surface, borderRadius: 16, overflow: 'hidden' }}>
                                  <div className="flex items-center gap-2 p-4 shrink-0" style={{ borderBottom: `1px solid ${TT.border}` }}>
                                    <button onClick={() => setPickerPreview(null)} aria-label={t('common:back', 'Back')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: TT.surface2, border: 'none', cursor: 'pointer', color: TT.text }}><ArrowLeft size={17} /></button>
                                    <h3 className="text-[15px] font-bold flex-1 truncate" style={{ color: TT.text, fontFamily: TFont.display }}>{pTitle}</h3>
                                    <button onClick={() => toggleSaveMeal(m.id)} aria-label={t('trainerPlans.save', 'Save')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: TT.surface2, border: 'none', cursor: 'pointer' }}><Bookmark size={16} style={{ color: savedMealIds.has(m.id) ? '#D4AF37' : TT.textMute, fill: savedMealIds.has(m.id) ? '#D4AF37' : 'none' }} /></button>
                                    <button onClick={() => setMealPickerSlot(null)} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: TT.textMute }}><X size={16} /></button>
                                  </div>
                                  <div className="flex-1 min-h-0 overflow-y-auto p-4">
                                    {mealImgSrc(m.image) ? (
                                      <img src={mealImgSrc(m.image)} alt={pTitle} className="w-full h-52 rounded-2xl object-cover" style={{ backgroundColor: TT.surface2 }} loading="lazy" />
                                    ) : (
                                      <div className="w-full h-52 rounded-2xl flex items-center justify-center" style={{ backgroundColor: TT.surface2 }}><UtensilsCrossed size={34} style={{ color: TT.textMute }} /></div>
                                    )}
                                    {/* Tag chip (accent pill + green dot) · prep · custom — member style */}
                                    <div className="flex items-center gap-1.5 mt-3.5 flex-wrap">
                                      {m.category && (
                                        <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: TT.accentInk, background: TT.accentSoft, padding: '4px 10px', borderRadius: 999 }}>
                                          <span style={{ width: 6, height: 6, borderRadius: 999, background: '#2ECC71' }} />
                                          {t(`trainerClientDetail.mealCategories.${m.category}`, m.category.replace(/_/g, ' '))}
                                        </span>
                                      )}
                                      {m.prepTime ? <span style={{ fontSize: 11, fontWeight: 700, color: TT.textSub, background: TT.surface2, padding: '4px 10px', borderRadius: 999 }}>{m.prepTime} {t('trainerPlans.min', 'min')}</span> : null}
                                      {m.custom && <span style={{ fontSize: 11, fontWeight: 700, color: TT.accentInk, background: TT.accentSoft, padding: '4px 10px', borderRadius: 999 }}>{t('trainerPlans.customTag', 'Custom')}</span>}
                                    </div>
                                    {/* Title + slot-fit line */}
                                    <h2 style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, letterSpacing: -0.8, lineHeight: 1.12, marginTop: 12 }}>{pTitle}</h2>
                                    {(() => { const sc = mealCompatibility(m, pickerSlotType); return sc != null ? (
                                      <p style={{ fontSize: 12.5, color: TT.textSub, marginTop: 4, fontWeight: 600 }}>{t('trainerPlans.fitsSlot', '{{n}}% fit for this slot', { n: sc })}</p>
                                    ) : null; })()}
                                    {/* Macro card — the member's MealMacroCard, verbatim */}
                                    <div className="mt-3.5">
                                      <MealMacroCard calories={m.calories} protein={m.protein} carbs={m.carbs} fat={m.fat} background={TT.surface2} />
                                    </div>
                                    {/* Recipe — Ingredients | Instructions as TABS (member-side
                                        pattern). Stacked, they made one long scroll where the
                                        steps were buried under the ingredient list. */}
                                    {(ings.length > 0 || steps.length > 0) && (
                                      <div className="mt-4">
                                        <div className="flex rounded-xl p-[3px] gap-[3px] mb-3" style={{ background: TT.surface2, border: `1px solid ${TT.border}` }}>
                                          {[['ingredients', t('trainerPlans.ingredients', 'Ingredients'), ings.length],
                                            ['instructions', t('trainerPlans.instructions', 'Instructions'), steps.length]].map(([key, lab, n]) => {
                                            const on = recipeTab === key;
                                            return (
                                              <button key={key} type="button" onClick={() => setRecipeTab(key)}
                                                className="flex flex-1 items-center justify-center gap-1.5 rounded-[9px] min-h-[34px] text-[12.5px] font-bold transition-all"
                                                style={on
                                                  ? { background: TT.accent, color: '#06363B', border: 'none' }
                                                  : { background: 'transparent', color: TT.textMute, border: 'none' }}>
                                                {lab}
                                                {n > 0 && <span style={{ fontSize: 10.5, opacity: 0.75 }}>{n}</span>}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        {recipeTab === 'ingredients' ? (
                                          ings.length > 0 ? (
                                            <div className="rounded-[22px] overflow-hidden" style={{ background: TT.surface2 }}>
                                              {ings.map((ing, i) => (
                                                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: i > 0 ? `1px solid ${TT.border}` : 'none' }}>
                                                  <span className="text-[14px] font-medium" style={{ color: TT.text }}>{humanizeIngredient(ing)}</span>
                                                  {amts[i] ? <span className="text-[12.5px] font-semibold tabular-nums shrink-0" style={{ color: TT.textMute }}>{amts[i]}</span> : null}
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="text-[12.5px] py-6 text-center" style={{ color: TT.textMute }}>{t('trainerPlans.noIngredients', 'No ingredients listed')}</p>
                                          )
                                        ) : (
                                          steps.length > 0 ? (
                                            <div className="rounded-[22px] px-4 py-4 flex flex-col gap-4" style={{ background: TT.surface2 }}>
                                              {steps.map((s, i) => (
                                                <div key={i} className="flex gap-3 text-[13px]">
                                                  <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 8, background: TT.accentSoft, color: TT.accentInk, fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                                                  <span style={{ color: TT.text, lineHeight: 1.65 }}>{s}</span>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="text-[12.5px] py-6 text-center" style={{ color: TT.textMute }}>{t('trainerPlans.noInstructions', 'No instructions listed')}</p>
                                          )
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="p-4 shrink-0" style={{ borderTop: `1px solid ${TT.border}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                                    <button onClick={() => pickMeal(m)} className="w-full py-3 rounded-xl text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: TT.accent, color: '#06363B' }}>
                                      <Check size={16} strokeWidth={2.6} /> {t('trainerPlans.useThisMeal', 'Use this meal')}
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                            {/* Add-your-own-meal — full panel (name, photo, macros, ingredients, instructions) */}
                            {showAddMeal && (
                              <div className="absolute inset-0 z-20 flex flex-col" style={{ background: TT.surface, borderRadius: 16, overflow: 'hidden' }}>
                                <div className="flex items-center gap-2 p-4 shrink-0" style={{ borderBottom: `1px solid ${TT.border}` }}>
                                  <button onClick={() => { setShowAddMeal(false); setEditingCustomMealId(null); }} aria-label={t('common:back', 'Back')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: TT.surface2, border: 'none', cursor: 'pointer', color: TT.text }}><ArrowLeft size={17} /></button>
                                  <h3 className="text-[15px] font-bold flex-1" style={{ color: TT.text, fontFamily: TFont.display }}>{editingCustomMealId ? t('trainerPlans.editMealTitle', 'Edit meal') : t('trainerPlans.newMealTitle', 'New meal')}</h3>
                                  <button onClick={() => setMealPickerSlot(null)} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: TT.textMute }}><X size={16} /></button>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                                  <input value={newMeal.name} onChange={e => setNewMeal(n => ({ ...n, name: e.target.value }))}
                                    placeholder={t('trainerPlans.mealName', 'Meal name')} className="w-full outline-none"
                                    style={{ background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 12, padding: '12px 13px', color: TT.text, fontFamily: TFont.display, fontSize: 15, fontWeight: 700 }} />
                                  <div className="flex items-center gap-2">
                                    {newMeal.imageUrl ? (
                                      <img src={newMeal.imageUrl} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
                                    ) : (
                                      <div className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center" style={{ background: TT.surface2, border: `1px solid ${TT.border}` }}>
                                        <UtensilsCrossed size={18} style={{ color: TT.textMute }} />
                                      </div>
                                    )}
                                    <label className="flex-1 cursor-pointer rounded-xl py-2.5 px-3 text-[12.5px] font-semibold text-center" style={{ background: TT.surface2, border: `1px dashed ${TT.border}`, color: TT.textSub, opacity: uploadingMealPhoto ? 0.6 : 1 }}>
                                      {uploadingMealPhoto ? t('trainerPlans.uploading', 'Uploading…') : newMeal.imageUrl ? t('trainerPlans.changePhoto', 'Change photo') : t('trainerPlans.addPhoto', 'Add photo (optional)')}
                                      <input type="file" accept="image/*" className="hidden" disabled={uploadingMealPhoto}
                                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadMealPhoto(f); e.target.value = ''; }} />
                                    </label>
                                    {newMeal.imageUrl && (
                                      <button type="button" onClick={() => setNewMeal(n => ({ ...n, imageUrl: '' }))} className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl" style={{ background: TT.hotSoft, color: TT.hot }}><X size={14} /></button>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.macrosPerServing', 'Macros (per serving)')}</p>
                                    <div className="grid grid-cols-4 gap-2">
                                      {[['calories', t('trainerNotes.nutrition.cal', 'Cal'), TT.accent], ['protein', t('trainerNotes.nutrition.protein', 'Protein'), '#60A5FA'], ['carbs', t('trainerNotes.nutrition.carbs', 'Carbs'), '#34D399'], ['fat', t('trainerNotes.nutrition.fat', 'Fat'), '#F472B6']].map(([k, lab, color]) => (
                                        <div key={k}>
                                          <p className="text-[10px] font-bold text-center mb-1" style={{ color }}>{lab}</p>
                                          <input type="number" inputMode="numeric" min="0" value={newMeal[k]} onChange={e => setNewMeal(n => ({ ...n, [k]: e.target.value }))}
                                            placeholder="0" className="w-full outline-none"
                                            style={{ background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 10, padding: '10px 6px', color: TT.text, textAlign: 'center', fontFamily: TFont.display, fontWeight: 800, fontSize: 15 }} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.ingredients', 'Ingredients')} <span className="normal-case font-medium" style={{ color: TT.textFaint }}>· {t('trainerPlans.onePerLine', 'one per line')}</span></p>
                                    <textarea value={newMeal.ingredients} onChange={e => setNewMeal(n => ({ ...n, ingredients: e.target.value }))} rows={4}
                                      placeholder={t('trainerPlans.ingredientsPh', '2 eggs\n1 cup oats\n1 scoop whey')}
                                      className="w-full outline-none resize-none" style={{ background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 12, padding: '11px 12px', color: TT.text, fontSize: 13.5, lineHeight: 1.6 }} />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: TT.textMute }}>{t('trainerPlans.instructions', 'Instructions')} <span className="normal-case font-medium" style={{ color: TT.textFaint }}>· {t('trainerPlans.oneStepPerLine', 'one step per line')}</span></p>
                                    <textarea value={newMeal.instructions} onChange={e => setNewMeal(n => ({ ...n, instructions: e.target.value }))} rows={4}
                                      placeholder={t('trainerPlans.instructionsPh', 'Whisk the eggs\nCook on medium heat\nTop with berries')}
                                      className="w-full outline-none resize-none" style={{ background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 12, padding: '11px 12px', color: TT.text, fontSize: 13.5, lineHeight: 1.6 }} />
                                  </div>
                                </div>
                                <div className="p-4 shrink-0" style={{ borderTop: `1px solid ${TT.border}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                                  <button type="button" onClick={addCustomMeal} disabled={!newMeal.name.trim() || savingNewMeal}
                                    className="w-full py-3 rounded-xl text-[14px] font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                                    style={{ background: TT.accent, color: '#06363B' }}>
                                    {savingNewMeal ? <Loader2 size={16} className="animate-spin" /> : (editingCustomMealId ? <Check size={16} /> : <Plus size={16} />)}
                                    {editingCustomMealId ? t('trainerPlans.saveMealChangesShort', 'Save changes') : t('trainerPlans.saveAndUseMeal', 'Save & use')}
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="p-4 shrink-0" style={{ borderBottom: `1px solid ${TT.border}` }}>
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[15px] font-bold" style={{ color: TT.text, fontFamily: TFont.display }}>
                                  {t('trainerPlans.chooseMeal', 'Choose Meal')}
                                </h3>
                                <button onClick={() => setMealPickerSlot(null)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg" style={{ color: TT.textMute }}>
                                  <X size={16} />
                                </button>
                              </div>
                              {/* Search (name + ingredients) + Filters button */}
                              <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: TT.textMute }} />
                                  <input value={mealSearch} onChange={e => setMealSearch(e.target.value)}
                                    placeholder={t('trainerPlans.searchMealsIng', 'Search meals or ingredients…')}
                                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-[16px] sm:text-[14px] outline-none"
                                    style={{ backgroundColor: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text }} />
                                </div>
                                <button type="button" onClick={() => setShowMealFilters(s => !s)} aria-label={t('trainerPlans.filters', 'Filters')}
                                  style={{ position: 'relative', width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
                                    border: `1px solid ${(showMealFilters || activeMealFilters) ? TT.accent : TT.border}`, background: (showMealFilters || activeMealFilters) ? TT.accentSoft : TT.surface2, color: (showMealFilters || activeMealFilters) ? TT.accentInk : TT.textSub }}>
                                  <SlidersHorizontal size={16} />
                                  {activeMealFilters > 0 && <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 999, background: TT.accent, color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{activeMealFilters}</span>}
                                </button>
                              </div>
                              {/* Add your own meal → saved to the trainer's private custom-meal library */}
                              <button type="button" onClick={() => setShowAddMeal(true)}
                                className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12.5px] font-bold"
                                style={{ background: TT.accentSoft, color: TT.accentInk, border: `1px dashed ${TT.accent}` }}>
                                <Plus size={14} /> {t('trainerPlans.addCustomMeal', 'Add your own meal')}
                              </button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
                              {filteredMeals.map(({ m: meal, score }) => {
                                const title = i18n.language === 'es' && meal.title_es ? meal.title_es : meal.title;
                                const saved = savedMealIds.has(meal.id);
                                const p = Number(meal.protein) || 0, c = Number(meal.carbs) || 0, f = Number(meal.fat) || 0;
                                const tot = p + c + f || 1;
                                const cc = score == null ? TT.textMute : score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : TT.textMute;
                                return (
                                  <div key={meal.id} className="w-full flex items-center gap-3 p-2.5 rounded-2xl" style={{ color: TT.text, background: TT.surface, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)', marginBottom: 8 }}>
                                    <button onClick={() => { setRecipeTab('ingredients'); setPickerPreview(meal); }} className="flex-1 min-w-0 flex items-center gap-3 text-left active:scale-[0.99]" style={{ color: TT.text }}>
                                      {mealImgSrc(meal.image) ? (
                                        // Shimmer until the photo decodes — an
                                        // un-loaded <img> is a flat grey square,
                                        // which reads as broken on a slow link.
                                        <MealThumb src={mealImgSrc(meal.image)} alt={title} />
                                      ) : (
                                        <div className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center" style={{ backgroundColor: TT.surface2 }}>
                                          <UtensilsCrossed size={18} style={{ color: TT.textMute }} />
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-[13.5px] font-bold truncate" style={{ fontFamily: TFont.display }}>{title}</p>
                                          {meal.custom && (
                                            <span className="shrink-0 text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: TT.accentSoft, color: TT.accentInk }}>{t('trainerPlans.customTag', 'Custom')}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <span style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.4 }}>{meal.calories}<span className="text-[10px] font-semibold" style={{ color: TT.textMute }}> kcal</span></span>
                                          {score != null && <span style={{ fontSize: 10, fontWeight: 800, color: cc, background: `${cc}1A`, padding: '1px 6px', borderRadius: 999 }}>{score}% {t('trainerPlans.fit', 'fit')}</span>}
                                        </div>
                                        <div className="flex mt-1.5 rounded-full overflow-hidden" style={{ height: 4, background: TT.surface2, gap: 1.5 }}>
                                          <div style={{ flex: p / tot, background: '#2EC4C4' }} />
                                          <div style={{ flex: c / tot, background: '#FF7A3D' }} />
                                          <div style={{ flex: f / tot, background: '#FFC24A' }} />
                                        </div>
                                        <div className="flex justify-between mt-1 text-[10px] font-semibold">
                                          <span style={{ color: '#2EC4C4' }}>{p}P</span>
                                          <span style={{ color: '#FF7A3D' }}>{c}C</span>
                                          <span style={{ color: '#FFC24A' }}>{f}F</span>
                                        </div>
                                      </div>
                                    </button>
                                    {meal.custom && (
                                      <button onClick={(e) => { e.stopPropagation(); openEditCustomMeal(meal); }} aria-label={t('trainerPlans.editMeal', 'Edit meal')}
                                        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: TT.surface2 }}>
                                        <Pencil size={14} style={{ color: TT.textSub }} />
                                      </button>
                                    )}
                                    <button onClick={(e) => { e.stopPropagation(); toggleSaveMeal(meal.id); }} aria-label={t('trainerPlans.save', 'Save')}
                                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: TT.surface2 }}>
                                      <Bookmark size={15} style={{ color: saved ? '#D4AF37' : TT.textMute, fill: saved ? '#D4AF37' : 'none' }} />
                                    </button>
                                  </div>
                                );
                              })}
                              {mealMatches.length > filteredMeals.length && (
                                <button type="button" onClick={() => setMealVisible(v => v + 40)} className="w-full py-3 text-[12.5px] font-bold tt-tap" style={{ color: TT.accentInk }}>
                                  {t('trainerPlans.showMoreMeals', 'Show more ({{n}} left)', { n: mealMatches.length - filteredMeals.length })}
                                </button>
                              )}
                              {filteredMeals.length === 0 && (
                                <p className="text-center py-8 text-[13px]" style={{ color: TT.textMute }}>{t('trainerPlans.noMealsFound', 'No meals found')}</p>
                              )}
                            </div>
                          </div>

                          {/* Filters — their OWN sheet. Expanded inline they shoved
                              the meal list off screen and read as a panel dumped
                              mid-page. A sheet also gives the pill rows room to
                              scroll properly instead of clipping at both edges. */}
                          {showMealFilters && !showAddMeal && (() => {
                            const chip = (on) => ({ padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', ...(on ? { background: TT.accent, color: '#06363B' } : { background: TT.surface2, color: TT.textSub, boxShadow: `inset 0 0 0 1px ${TT.border}` }) });
                            const label = (s) => <div className="text-[10.5px] font-bold uppercase tracking-wide mt-4 mb-2" style={{ color: TT.textMute }}>{s}</div>;
                            // A real element, not padding: mobile WebKit collapses
                            // trailing padding on a horizontal-scroll flex row.
                            const tail = <span aria-hidden className="shrink-0 w-3" />;
                            const resetAll = () => { setMealCat('all'); setMealCalBand('all'); setMealMacroFilter('all'); setMealFitsOnly(false); setMealMine(false); };
                            return (
                              // stopPropagation is load-bearing: this sheet is a
                              // SIBLING of the picker card, so it sits directly
                              // under the portal root whose onClick closes the
                              // whole Choose-Meal modal. Without it, tapping
                              // outside the filters dismissed the picker too and
                              // left the meal slot unfilled.
                              <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={(e) => { e.stopPropagation(); setShowMealFilters(false); }}>
                                <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} />
                                <div onClick={e => e.stopPropagation()} className="relative rounded-t-[22px] flex flex-col"
                                  style={{ background: TT.surface, borderTop: `1px solid ${TT.borderSolid}`, maxHeight: '86%' }}>
                                  <div className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0">
                                    <h3 className="text-[16px] font-bold flex-1" style={{ color: TT.text, fontFamily: TFont.display }}>{t('trainerPlans.filters', 'Filters')}</h3>
                                    {activeMealFilters > 0 && (
                                      <button type="button" onClick={resetAll} className="text-[12.5px] font-bold tt-tap" style={{ color: TT.hot }}>
                                        {t('trainerPlans.resetFilters', 'Reset')}
                                      </button>
                                    )}
                                    <button type="button" onClick={() => setShowMealFilters(false)} aria-label={t('common:close', 'Close')}
                                      style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: TT.surface2, border: 'none', cursor: 'pointer', color: TT.textMute }}>
                                      <X size={16} />
                                    </button>
                                  </div>
                                  <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 -mx-0">
                                    <div className="flex gap-2 flex-wrap">
                                      {mealForm.target_calories && <button type="button" onClick={() => setMealFitsOnly(v => !v)} style={chip(mealFitsOnly)}>{t('trainerPlans.fitsClient', 'Fits client')}</button>}
                                      <button type="button" onClick={() => setMealMine(v => !v)} style={chip(mealMine)}>{t('trainerPlans.myMeals', 'My meals')}</button>
                                    </div>
                                    {label(t('trainerPlans.caloriesLabel', 'Calories'))}
                                    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
                                      {[['all', t('trainerPlans.allCat', 'All')], ['lt300', '< 300'], ['300_500', '300–500'], ['500_700', '500–700'], ['gt700', '700+']].map(([v, d]) => (
                                        <button key={v} type="button" onClick={() => setMealCalBand(v)} className="shrink-0" style={chip(mealCalBand === v)}>{d}</button>
                                      ))}
                                      {tail}
                                    </div>
                                    {label(t('trainerPlans.macros', 'Macros'))}
                                    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
                                      {[['all', t('trainerPlans.allCat', 'All')], ['high_protein', t('trainerPlans.highProtein', 'High protein')], ['low_carb', t('trainerPlans.lowCarb', 'Low carb')], ['low_fat', t('trainerPlans.lowFat', 'Low fat')]].map(([v, d]) => (
                                        <button key={v} type="button" onClick={() => setMealMacroFilter(v)} className="shrink-0" style={chip(mealMacroFilter === v)}>{d}</button>
                                      ))}
                                      {tail}
                                    </div>
                                    {pickerCategories.length > 1 && (<>
                                      {label(t('trainerPlans.category', 'Category'))}
                                      <div className="flex gap-2 flex-wrap pb-1">
                                        {['all', ...pickerCategories].map(cat => (
                                          <button key={cat} type="button" onClick={() => setMealCat(cat)} style={chip(mealCat === cat)}>
                                            {cat === 'all' ? t('trainerPlans.allCat', 'All') : t(`trainerClientDetail.mealCategories.${cat}`, cat.replace(/_/g, ' '))}
                                          </button>
                                        ))}
                                      </div>
                                    </>)}
                                  </div>
                                  <div className="px-4 pt-2 shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                                    <button type="button" onClick={() => setShowMealFilters(false)}
                                      className="w-full py-3 rounded-xl text-[14px] font-bold"
                                      style={{ background: TT.accent, color: '#06363B', border: 'none' }}>
                                      {t('trainerPlans.showNMeals', 'Show {{n}} meals', { n: mealMatches.length })}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>,
                        document.body,
                      )}
                    </div>
                  )}
                </div>

                {/* Footer — Step 2 */}
                <div style={{ flexShrink: 0, background: MK.bgElev, boxShadow: `0 -1px 0 ${MK.line}`, padding: '14px 20px 30px', display: 'flex', gap: 12 }}>
                  <MkBtn variant="secondary" block disabled={generatingMeals} onClick={() => { if (mealsDirty) { setConfirmRegen(true); } else { handleGenerateMeals(); } }}
                    icon={generatingMeals ? <Loader2 size={16} color={MK.ink} className="animate-spin" /> : <RefreshCw size={16} color={MK.ink} strokeWidth={2} />}>
                    {t('trainerPlans.regenerate', 'Regenerate')}
                  </MkBtn>
                  <MkBtn variant="primary" block disabled={mealSaving} onClick={saveMealPlan}
                    icon={mealSaving ? <Loader2 size={17} color="#fff" className="animate-spin" /> : <UtensilsCrossed size={17} color="#fff" strokeWidth={2.1} />}>
                    {mealSaving ? t('trainerPlans.saving', 'Saving...') : (editingMealPlanId ? t('trainerPlans.saveMealChanges', 'Save changes') : t('trainerPlans.assignMealPlan', 'Save'))}
                  </MkBtn>
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

      {/* ── Saved meal-plan detail viewer — "Warmth (B)" ── */}
      {mealDetail && (() => {
        const dw = Math.max(1, Number(mealDetail.duration_weeks) || 1);
        const dr = planWeekDates(mealDetail, mealDetailWeek);
        const hasMacros = mealDetail.target_calories || mealDetail.target_protein_g || mealDetail.target_carbs_g || mealDetail.target_fat_g;
        const targetMac = { protein: mealDetail.target_protein_g || 0, carbs: mealDetail.target_carbs_g || 0, fat: mealDetail.target_fat_g || 0 };
        // `meals` arrives a beat after the sheet opens (openMealDetail fetches
        // the blob on demand). Until it's a real array we must NOT let the
        // trainer into the editor: saveMealPlan writes `meals: []` whenever the
        // editor has none loaded, so editing mid-fetch would silently delete
        // every meal in the plan.
        const mealsReady = Array.isArray(mealDetail.meals);
        const hasMeals = mealsReady && mealDetail.meals.length > 0;
        const openEdit = () => { if (!mealsReady) return; const p = mealDetail; setMealDetail(null); openMealEditor(p); };
        const day = hasMeals ? mealDetail.meals[Math.min(mealDetailDay, mealDetail.meals.length - 1)] : null;
        const ws = planWeekDates(mealDetail, mealDetailWeek)?.ws || (mealDetail.created_at ? new Date(mealDetail.created_at) : null);
        return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setMealDetail(null)}>
          <div className="w-full max-w-md overflow-hidden max-h-[88vh] flex flex-col" style={{ borderRadius: 26, background: MK.bg, boxShadow: MK.shadowLg }} onClick={e => e.stopPropagation()}>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide" style={{ padding: '22px 20px 18px' }}>
              <MkSheetHead title={mealDetail.name} onClose={() => setMealDetail(null)}
                sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <MkTag c={mealDetail.is_active ? MK.teal : MK.ink3} dot size="s">{mealDetail.is_active ? t('trainerPlans.active', 'Active') : t('trainerPlans.past', 'Past')}</MkTag>
                  {mealDetail.profiles?.full_name && <span style={{ color: MK.ink2 }}>{t('trainerPlans.assignedTo', 'Assigned to {{name}}', { name: mealDetail.profiles.full_name })}</span>}
                </span>}
                right={<MkBtn variant="soft" size="s" disabled={!mealsReady}
                  icon={mealsReady
                    ? <Pencil size={15} color={inkOf(MK.teal)} strokeWidth={2.2} />
                    : <Loader2 size={15} className="animate-spin" color={inkOf(MK.teal)} />}
                  onClick={openEdit}>{t('trainerPlans.edit', 'Edit')}</MkBtn>} />

              {hasMacros && (
                <MkSec><MkSectionHead icon={<Target size={17} strokeWidth={2.1} />}>{t('trainerPlans.macroTargets', 'Macro Targets')}</MkSectionHead>
                  <MkCard pad={0} style={{ overflow: 'hidden' }}>
                    <div style={{ background: `linear-gradient(160deg, ${soft(MK.teal, 10)}, ${MK.surface})`, padding: '20px 18px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
                      <MacroRing kcal={mealDetail.target_calories || 0} size={100} stroke={11} value={1} />
                      <div>
                        <div style={{ fontFamily: MK.disp, fontSize: 13, fontWeight: 800, color: inkOf(MK.teal), textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('trainerPlans.dailyTarget', 'Daily target')}</div>
                        <div style={{ fontSize: 13, color: MK.ink2, marginTop: 6, lineHeight: 1.4, maxWidth: 150 }}>{t('trainerPlans.dailyTargetSub', 'Calories & macro split for every day of the plan.')}</div>
                      </div>
                    </div>
                    <div style={{ padding: '16px 18px 18px' }}><MacroCells big macros={targetMac} /></div>
                  </MkCard>
                </MkSec>
              )}

              <MkSec><MkSectionHead icon={<Calendar size={17} strokeWidth={2.1} />} tint={MK.coach}>{t('trainerPlans.timeframe', 'Time frame')}</MkSectionHead>
                <MkCard pad={16}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: dw > 1 ? 14 : 0, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: MK.disp, fontSize: 17, fontWeight: 900, color: MK.ink }}>{dw} {dw === 1 ? t('trainerPlans.week', 'week') : t('trainerPlans.weeks', 'weeks')}</span>
                    {dr && <span style={{ fontSize: 12.5, color: MK.ink3 }}>· {format(dr.ws, 'd MMM', { locale: dateFnsLocale })} – {format(dr.we, 'd MMM', { locale: dateFnsLocale })}</span>}
                  </div>
                  {dw > 1 && <MkWeekPicker idx={mealDetailWeek} total={dw} onPrev={() => setMealDetailWeek(w => Math.max(0, w - 1))} onNext={() => setMealDetailWeek(w => Math.min(dw - 1, w + 1))} />}
                  {dw > 1 && <MkNote>{t('trainerPlans.weeklyRotationNote', 'The same weekly plan repeats each week.')}</MkNote>}
                </MkCard>
              </MkSec>

              {hasMeals ? (
                <MkSec><MkSectionHead icon={<UtensilsCrossed size={17} strokeWidth={2.1} />} tint={MK.hot} action={t('trainerPlans.weeklyMeals', 'Weekly')} onAction={openEdit}>{t('trainerPlans.mealsLabel', 'Meals')}</MkSectionHead>
                  {/* Same rule as the builder: when we know the real date, the
                      weekday label must come from THAT date, not the slot index. */}
                  <div style={{ marginBottom: 14 }}>
                    <MkChipStrip dark value={mealDetailDay}
                      options={mealDetail.meals.map((d, i) => { const dd = ws ? new Date(ws.getTime() + i * 86400000) : null; const lab = dd ? DAY_LABELS[dd.getDay()] : (DAY_LABELS[i] || `${t('trainerPlans.day', 'Day')} ${d.day || i + 1}`); return { v: i, l: `${lab}${dd ? ` ${dd.getDate()}` : ''}` }; })}
                      onChange={setMealDetailDay} />
                  </div>
                  {day?.totals && <div style={{ marginBottom: 14, paddingLeft: 2 }}><MacroReadout kcal={day.totals.calories} macros={{ protein: day.totals.protein, carbs: day.totals.carbs, fat: day.totals.fat }} size={13} /></div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(day?.meals || []).map((meal, mi) => {
                      const slot = MEAL_SLOTS.find(s => s.type === (meal.slotType || meal.slot)) || MEAL_SLOTS[mi] || MEAL_SLOTS[3];
                      const slotC = MK_SLOT_C[slot.type] || MK.teal;
                      const full = mealById.get(meal.id);
                      const mealTitle = i18n.language === 'es' && (meal.title_es || full?.title_es) ? (meal.title_es || full?.title_es) : (meal.title || full?.title);
                      return (
                        <div key={mi} className="tt-tap" onClick={openEdit} style={{ background: MK.surface, borderRadius: 20, boxShadow: MK.shadow, overflow: 'hidden', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', gap: 13, padding: 13, alignItems: 'center' }}>
                            {/* Prefer the image PERSISTED on the plan row —
                                saveMealPlan writes meal.image, and a custom
                                meal (custom_<uuid>) isn't in the MEALS catalog
                                at all, so resolving via `full` alone turned an
                                uploaded photo into a placeholder after save.
                                Catalog image is the fallback for older rows
                                saved before meal.image was persisted. */}
                            <FoodTile src={mealImgSrc(meal.image) || mealImgSrc(full?.image) || null} label={mealTitle} size={62} r={16} tint={slotC} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <MkTag c={slotC} size="s" style={{ marginBottom: 6 }}>{slot.label}</MkTag>
                              <div className="truncate" style={{ fontFamily: MK.disp, fontSize: 15, fontWeight: 800, color: MK.ink, letterSpacing: -0.3, lineHeight: 1.15, marginBottom: 7 }}>{mealTitle}</div>
                              <MacroReadout kcal={meal.calories} macros={{ protein: meal.protein, carbs: meal.carbs, fat: meal.fat }} size={11.5} gap={8} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </MkSec>
              ) : !mealsReady ? (
                /* Blob still in flight — a spinner, not the "no meals" copy,
                   which would read as a factual (and wrong) statement about
                   the plan for the ~150 ms the fetch takes. */
                <MkSec style={{ textAlign: 'center', padding: '32px 0' }}>
                  <Loader2 size={24} className="animate-spin" color={MK.ink3} style={{ margin: '0 auto' }} />
                </MkSec>
              ) : (
                <MkSec style={{ textAlign: 'center', padding: '32px 0' }}>
                  <UtensilsCrossed size={28} color={MK.ink3} style={{ margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 13, color: MK.ink3 }}>{t('trainerPlans.noMealsInPlan', 'This plan only has macro targets — no generated meals were saved.')}</p>
                </MkSec>
              )}
            </div>

            <div style={{ flexShrink: 0, background: MK.bgElev, boxShadow: `0 -1px 0 ${MK.line}`, padding: '14px 20px 30px', display: 'flex', gap: 12 }}>
              <MkBtn variant="secondary" block onClick={() => toggleMealPlanActive(mealDetail)}>{mealDetail.is_active ? t('trainerPlans.deactivate', 'Deactivate') : t('trainerPlans.activate', 'Activate')}</MkBtn>
              <MkBtn variant="danger" block icon={<Trash2 size={17} color={inkOf(MK.coral)} strokeWidth={2.1} />} onClick={() => setConfirmDeleteMealPlan(mealDetail)}>{t('trainerPlans.delete', 'Delete')}</MkBtn>
            </div>
          </div>
        </div>
        );
      })()}

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
            <ClientPickList
              value={duplicateClientId}
              onChange={setDuplicateClientId}
              clients={clients}
              extra={
                // Original client first (even if deactivated) so "same client" stays possible
                duplicateTarget.client_id && !clients.some(c => c.id === duplicateTarget.client_id)
                  ? [{ id: duplicateTarget.client_id, name: `${duplicateTarget.profiles?.full_name || t('trainerPlans.formerClient', 'Former client')} ${t('trainerPlans.clientInactiveSuffix', '(inactive)')}` }]
                  : []
              }
            />
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

      {/* Assign-to-client sheet — the primary way to (re)assign an existing plan */}
      {assignTarget && (() => {
        const current = assignTarget._memberIds?.length ? assignTarget._memberIds : (assignTarget.client_id ? [assignTarget.client_id] : []);
        const dirty = [...assignIds].sort().join(',') !== [...current].sort().join(',');
        const willGoLive = assignIds.length > 0 && (assignTarget.is_draft || !assignTarget.is_active);
        // Assigned-but-deactivated members → show as toggleable rows so they can be kept or removed.
        const inactiveRows = assignIds.filter(id => !clients.some(c => c.id === id)).map(id => ({
          id, name: `${(id === assignTarget.client_id ? assignTarget.profiles?.full_name : '') || t('trainerPlans.formerClient', 'Former client')} ${t('trainerPlans.clientInactiveSuffix', '(inactive)')}`,
        }));
        return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAssignTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <div className="flex items-center gap-2.5">
              <div style={{ width: 38, height: 38, borderRadius: 11, background: TT.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <UserPlus size={19} color={TT.accent} />
              </div>
              <h3 className="text-[16px] font-bold leading-tight" style={{ color: TT.text }}>
                {t('trainerPlans.assignTitle', 'Assign "{{name}}"', { name: assignTarget.name })}
              </h3>
            </div>
            <p className="text-[13px]" style={{ color: TT.textSub }}>
              {assignTarget.duration_weeks === 0
                ? t('trainerPlans.assignBodySessionMulti', 'Share this session with one or more clients.')
                : t('trainerPlans.assignBodyMulti', 'Share this plan with one or more clients.')}
            </p>
            {clients.length === 0 && inactiveRows.length === 0 ? (
              <p className="text-[13px] py-3 text-center" style={{ color: TT.textMute }}>{t('trainerPlans.noClientsAvailable', 'No active clients to assign.')}</p>
            ) : (
              <ClientPickList multi values={assignIds} onToggle={toggleAssignId} clients={clients} extra={inactiveRows} />
            )}
            {willGoLive && (
              <p className="text-[12px] rounded-lg px-3 py-2 flex items-start gap-1.5" style={{ color: TT.accentInk, background: TT.accentSoft }}>
                <Check size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                {t('trainerPlans.assignWillActivate', 'This will activate the plan so they can see it in their app.')}
              </p>
            )}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setAssignTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold min-h-[44px]"
                style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}>
                {t('trainerPlans.cancel', 'Cancel')}
              </button>
              <button onClick={confirmAssign} disabled={assigning || !dirty}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold min-h-[44px] disabled:opacity-40 flex items-center justify-center gap-1.5"
                style={{ background: TT.accent, color: '#06363B' }}>
                {assigning ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                {assignIds.length === 0 ? t('trainerPlans.unassign', 'Unassign') : assignIds.length > 1 ? t('trainerPlans.assignN', 'Assign {{n}}', { n: assignIds.length }) : t('trainerPlans.assign', 'Assign')}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Meal-plan: share with additional members (0645) */}
      {showMealSharePicker && (() => {
        const pickable = clients.filter(c => c.id !== mealForm.client_id); // primary is the main select
        return (
        // z MUST beat the Create Meal Plan modal (z-100) that opens it — at
        // z-95 this rendered BEHIND that modal, so tapping "Share with more
        // members" looked like a dead button.
        <div className="fixed inset-0 z-[135] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMealSharePicker(false)} />
          <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
            <div className="flex items-center gap-2.5">
              <div style={{ width: 38, height: 38, borderRadius: 11, background: TT.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Users size={19} color={TT.accent} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-bold leading-tight" style={{ color: TT.text }}>{t('trainerPlans.shareWithMore', 'Share with more members')}</h3>
                <p className="text-[12px]" style={{ color: TT.textSub }}>{t('trainerPlans.mealShareHint', 'Everyone gets the same plan; edit it once for all.')}</p>
              </div>
            </div>
            {pickable.length === 0 ? (
              <div className="py-6 text-center">
                <Users size={26} style={{ color: TT.textMute, margin: '0 auto 8px' }} />
                <p className="text-[13.5px] font-bold" style={{ color: TT.text }}>{t('trainerPlans.noOtherClients', 'No other clients to share with.')}</p>
                <p className="text-[12px] mt-1" style={{ color: TT.textMute }}>
                  {t('trainerPlans.noOtherClientsHint', 'Add more clients and they’ll show up here.')}
                </p>
              </div>
            ) : (
              <ClientPickList multi values={mealShareIds} onToggle={toggleMealShare} clients={pickable} maxHeight={280} />
            )}
            {mealShareIds.length > 0 && (
              <p className="text-[12px]" style={{ color: TT.textMute }}>
                {t('trainerPlans.membersSelected', '{{n}} selected', { n: mealShareIds.length })}{' · '}
                <button type="button" onClick={() => setMealShareIds([])} style={{ color: TT.hot, fontWeight: 700 }}>{t('trainerPlans.clearAll', 'Clear')}</button>
              </p>
            )}
            <button onClick={() => setShowMealSharePicker(false)}
              className="w-full py-2.5 rounded-xl text-[13px] font-bold min-h-[44px]"
              style={{ background: TT.accent, color: '#06363B' }}>
              {t('trainerPlans.done', 'Done')}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Regenerate confirmation (manual picks/swaps would be discarded).
          z MUST beat the meal modal that opens it. At an equal z-[100] the
          modal — being portaled to body, i.e. a LATER sibling of #root — painted
          over this dialog: the confirm was visible through the translucent
          backdrop but untappable, and taps fell through to the modal's own
          backdrop, which ran closeMealModal and threw away the whole
          in-progress plan. */}
      {confirmRegen && (
        <div className="fixed inset-0 z-[135] flex items-center justify-center px-4">
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

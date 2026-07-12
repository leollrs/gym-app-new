import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, X, ChevronDown, ChevronLeft, ChevronRight, Dumbbell, Plus, Bookmark, Check, Users, SlidersHorizontal, ArrowUpDown, Star, Pencil, Edit3, Sparkles, Play, Minus, Heart, MoreHorizontal, Trophy, Flame } from 'lucide-react';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT, CATEGORIES } from '../data/exercises';
import BodyMusclePicker from '../components/BodyMusclePicker';
import MuscleExercisesSheet from '../components/MuscleExercisesSheet';
import AllExercisesModal from '../components/AllExercisesModal';
import ExerciseMuscleHighlight from '../components/ExerciseMuscleHighlight';
import MuscleGroupPicker from '../components/MuscleGroupPicker';
import { MUSCLE_BUCKET_BY_ID, bucketGroup } from '../lib/muscleBuckets';
import { goalAdjustedDefaults, formatRest } from '../lib/goalAdjustedDefaults';
import { LayoutList, User, AlignJustify } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { useTranslation } from 'react-i18next';
import { exName, exInstructions } from '../lib/exerciseName';
import { usePostHog } from '@posthog/react';
import { useScrollLock } from '../hooks/useScrollLock';

/* ── Resolve a video path to a full public URL ──────────────────────────────── */
const resolveVideoUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('/') || path.startsWith('http')) return path;
  const { data } = supabase.storage.from('exercise-videos').getPublicUrl(path);
  return data?.publicUrl || null;
};

/* ── Muscle icon tints (muted, premium palette) ─────────────────────────────── */
const MUSCLE_TINTS = {
  Chest:       '#E8927C',
  Back:        '#7CA8E8',
  Shoulders:   '#C9A84C',
  Biceps:      '#C9A84C',
  Triceps:     '#E8A87C',
  Legs:        '#6BC4A6',
  Glutes:      '#E8A87C',
  Core:        '#7CB8E8',
  Calves:      '#6BC4A6',
  Forearms:    '#C9A84C',
  Traps:       '#7CA8E8',
  'Full Body': '#8B95A5',
};

const getMuscleColor = (muscle) => MUSCLE_TINTS[muscle] || '#C9A84C';

/* ── Sort options ───────────────────────────────────────────────────────────── */
const SORT_OPTIONS = [
  { key: 'name-asc',   i18nKey: 'name_asc' },
  { key: 'name-desc',  i18nKey: 'name_desc' },
  { key: 'muscle',     i18nKey: 'muscle' },
  { key: 'equipment',  i18nKey: 'equipment' },
];

/* ── Stat Pill ──────────────────────────────────────────────────────────────── */
const StatPill = ({ label, value }) => (
  <div className="flex flex-col items-center px-4 py-2">
    <span className="text-[15px] font-bold tracking-[-0.01em]" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
    <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
  </div>
);

/* ── Warm-paper shared design tokens ────────────────────────────────────────── */
const WARM_SHADOW = '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)';
const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const ACCENT_SOFT = 'color-mix(in srgb, var(--color-accent) 16%, transparent)';
const HOT = '#FF5A2E';

/* ── Mini kebab-case stat block (3-up strip) ────────────────────────────────── */
const MiniStat = ({ k, v, sub, tone }) => (
  <div className="flex-1 min-w-0">
    <div
      className="font-extrabold tracking-[-0.03em] truncate"
      style={{
        fontFamily: DISPLAY_FONT,
        fontSize: 22,
        color: tone === 'gold' ? '#8a6a1d' : 'var(--color-text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >{v}</div>
    <div className="text-[10px] font-extrabold uppercase tracking-[0.08em]" style={{ color: 'var(--color-text-muted)' }}>{k}</div>
    {sub && <div className="text-[10px] mt-[1px]" style={{ color: 'var(--color-text-subtle)' }}>{sub}</div>}
  </div>
);

/* ── Filter chip (capsule) ──────────────────────────────────────────────────── */
const FilterChip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1 px-3 py-[7px] rounded-full transition-all active:scale-95"
    style={{
      background: active ? 'var(--color-text-primary)' : 'var(--color-bg-card)',
      color: active ? 'var(--color-bg-primary)' : 'var(--color-text-subtle)',
      border: `1px solid ${active ? 'var(--color-text-primary)' : 'var(--color-border-subtle)'}`,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: '-0.1px',
    }}
  >
    {children}
  </button>
);

/* ── Exercise list row (warm-paper card) ────────────────────────────────────── */
const ExerciseRow = ({ exercise, onClick, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const tint = getMuscleColor(exercise.muscle);
  // Goal-adjusted defaults so the row's sets/reps match what the detail
  // modal and Workout Builder will actually use.
  const adj = goalAdjustedDefaults(exercise, profile?.primary_goal || 'general_fitness');
  const sets = adj.sets;
  const reps = adj.reps;
  const name = lang === 'es' && exercise.name_es ? exercise.name_es : exercise.name;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className="rounded-[18px] p-[14px] cursor-pointer flex items-center gap-3 active:scale-[0.995] transition-all"
      style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW }}
    >
      <div
        className="w-[46px] h-[46px] rounded-[13px] flex items-center justify-center flex-shrink-0"
        style={{ background: `${tint}14`, border: `1px solid ${tint}22` }}
      >
        <Dumbbell size={20} strokeWidth={2.2} style={{ color: tint }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div
            className="truncate"
            style={{ fontFamily: DISPLAY_FONT, fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--color-text-primary)' }}
          >{name}</div>
          {exercise.isMine && (
            <span
              className="flex-shrink-0 px-1.5 py-[2px] rounded-[5px] text-[8px] font-extrabold uppercase tracking-[0.06em]"
              style={{ background: ACCENT_SOFT, color: 'var(--color-accent)' }}
            >{t('exerciseLibrary.yours', 'Mine')}</span>
          )}
          {exercise.pr && (
            <span
              className="flex-shrink-0 px-1.5 py-[2px] rounded-[5px] text-[8px] font-extrabold uppercase tracking-[0.06em]"
              style={{ background: '#fef2c7', color: '#8a6a1d' }}
            >PR {exercise.pr}</span>
          )}
        </div>
        <div className="mt-[3px] flex items-center gap-1.5 text-[12px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>·</span>
          <span>{t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}</span>
          {/* Static `category` removed — sets/reps now reflect the user's
              primary_goal, and the detail card's goal badge owns that info. */}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {sets != null && (
            <span className="inline-flex items-baseline gap-1 px-2 py-[3px] rounded-md text-[10.5px] font-semibold"
              style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}>
              <span className="font-extrabold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{sets}</span>
              <span className="uppercase tracking-[0.05em] text-[9px]">{t('exerciseLibrary.sets', 'sets')}</span>
            </span>
          )}
          {reps && (
            <span className="inline-flex items-baseline gap-1 px-2 py-[3px] rounded-md text-[10.5px] font-semibold"
              style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}>
              <span className="font-extrabold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{reps}</span>
              <span className="uppercase tracking-[0.05em] text-[9px]">{t('exerciseLibrary.reps', 'reps')}</span>
            </span>
          )}
          {exercise.usedLabel && (
            <span className="ml-1 inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--color-accent)' }} />
              {exercise.usedLabel}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
    </div>
  );
};

/* ── Muscle group label → BodyDiagram region IDs (public/muscles/ images) ──── */
// "Back" intentionally includes traps + mid_back so the whole back lights up
// when an exercise targets the back muscle group — without this, exercises
// whose primaryRegions only list one slice (e.g. deadlift = ['lower_back'])
// rendered as just the lower back wedge, which read as "broken" to users.
const MUSCLE_LABEL_TO_REGIONS = {
  Chest:      ['mid_chest', 'upper_chest', 'lower_chest'],
  Back:       ['upper_back', 'mid_back', 'lats', 'lower_back', 'traps'],
  Lats:       ['lats'],
  Traps:      ['traps'],
  Shoulders:  ['front_delts', 'side_delts', 'rear_delts'],
  Biceps:     ['biceps'],
  Triceps:    ['triceps'],
  Forearms:   ['forearms'],
  Core:       ['upper_abs', 'mid_abs', 'lower_abs', 'obliques'],
  Abs:        ['upper_abs', 'mid_abs', 'lower_abs'],
  Quads:      ['quads'],
  Hamstrings: ['hamstrings'],
  Glutes:     ['glutes', 'glute_med'],
  Calves:     ['calves'],
  Legs:       ['quads', 'hamstrings', 'glutes', 'calves'],
  'Full Body': ['mid_chest', 'upper_back', 'lats', 'lower_back', 'quads', 'glutes', 'hamstrings', 'mid_abs'],
};
const muscleLabelToRegions = (label) => MUSCLE_LABEL_TO_REGIONS[label] || [];

/* ── Chip → anatomical region map ──────────────────────────────────────────── */
// Muscle-based chips (push/pull/legs/core) light up the trainer figure AND
// open a multi-muscle exercise sheet. Other chips (recent/mobility/hiit)
// route to the AllExercisesModal pre-filtered instead.
const CHIP_REGIONS = {
  push:  ['front_delts', 'side_delts', 'upper_chest', 'mid_chest', 'lower_chest', 'triceps'],
  pull:  ['upper_back', 'mid_back', 'lats', 'lower_back', 'traps', 'biceps', 'rear_delts'],
  chest: ['upper_chest', 'mid_chest', 'lower_chest'],
  back:  ['upper_back', 'mid_back', 'lats', 'lower_back', 'traps'],
  arms:  ['biceps', 'triceps', 'forearms', 'front_delts', 'side_delts', 'rear_delts'],
  legs:  ['quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'glute_med', 'calves', 'tibialis', 'soleus'],
  core:  ['upper_abs', 'mid_abs', 'lower_abs', 'abs', 'obliques', 'serratus'],
};

/**
 * Build the regions to highlight for an exercise card. The muscle group's
 * full region set is the baseline (so "Back" always lights up the whole back),
 * unioned with whatever specific regions the exercise data lists. Extras like
 * hamstrings on a deadlift carry through. Secondary regions stay separate.
 */
const buildExerciseRegions = (exercise) => {
  const fromGroup = muscleLabelToRegions(exercise?.muscle);
  const explicit  = Array.isArray(exercise?.primaryRegions) ? exercise.primaryRegions : [];
  const merged    = Array.from(new Set([...fromGroup, ...explicit]));
  return {
    primary:   merged,
    secondary: Array.isArray(exercise?.secondaryRegions) ? exercise.secondaryRegions : [],
  };
};

/* ── Equipment picker tiles (3×2) ───────────────────────────────────────────── */
const EQUIP_ICONS = {
  Barbell: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="10" width="2" height="4"/><rect x="5" y="7" width="2.5" height="10"/>
      <line x1="7.5" y1="12" x2="16.5" y2="12"/>
      <rect x="16.5" y="7" width="2.5" height="10"/><rect x="20" y="10" width="2" height="4"/>
    </svg>
  ),
  Dumbbell: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="9" width="3" height="6"/><rect x="5" y="7" width="3" height="10"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
      <rect x="16" y="7" width="3" height="10"/><rect x="19" y="9" width="3" height="6"/>
    </svg>
  ),
  Machine: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 18v3M16 18v3M3 10h18"/>
    </svg>
  ),
  Cable: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16M12 4v8"/><path d="M8 12a4 4 0 0 0 8 0"/><rect x="10" y="18" width="4" height="3" rx="0.5"/>
    </svg>
  ),
  Bodyweight: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2"/><path d="M12 7v6M8 21l4-8 4 8M8 11h8"/>
    </svg>
  ),
  Kettlebell: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5a3 3 0 0 1 6 0v2"/><path d="M7 9c-2 2-3 6-2 9h14c1-3 0-7-2-9z"/>
    </svg>
  ),
  Bands: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12c4-6 16-6 20 0"/><path d="M2 12c4 6 16 6 20 0"/>
    </svg>
  ),
  Cardio: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h3l2-5 4 10 2-5h7"/>
    </svg>
  ),
};

const EquipmentTile = ({ label, selected, onClick, icon }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex flex-col items-center justify-center gap-1.5 rounded-[14px] transition-all active:scale-[0.97]"
    style={{
      padding: '14px 8px',
      background: selected ? 'var(--color-text-primary)' : 'var(--color-bg-card)',
      color: selected ? 'var(--color-bg-primary)' : 'var(--color-text-primary)',
      border: `1.5px solid ${selected ? 'var(--color-text-primary)' : 'var(--color-border-subtle)'}`,
      boxShadow: selected ? 'none' : '0 1px 2px rgba(15,20,25,0.03)',
    }}
  >
    <div style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}>{icon}</div>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px' }}>{label}</div>
  </button>
);

/* ── Stepper (− VALUE +) ────────────────────────────────────────────────────── */
const Stepper = ({ value, onChange, min = 1, max = 99 }) => {
  const { t } = useTranslation('pages');
  return (
  <div
    className="rounded-[14px] flex items-center p-1.5"
    style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(15,20,25,0.03)' }}
  >
    <button
      type="button"
      onClick={() => onChange(Math.max(min, value - 1))}
      aria-label={t('exerciseLibrary.ariaDecrease', 'Decrease')}
      className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
    >
      <Minus size={16} strokeWidth={2.4} />
    </button>
    <div className="flex-1 text-center">
      <span
        className="tabular-nums"
        style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--color-text-primary)' }}
      >{value}</span>
    </div>
    <button
      type="button"
      onClick={() => onChange(Math.min(max, value + 1))}
      aria-label={t('exerciseLibrary.ariaIncrease', 'Increase')}
      className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
    >
      <Plus size={16} strokeWidth={2.4} />
    </button>
  </div>
  );
};

/* ── Rep range (dual input, center bar) ─────────────────────────────────────── */
const RepRange = ({ low, high, onChange }) => {
  const { t } = useTranslation('pages');
  return (
    <div
      className="rounded-[14px] flex items-center gap-2.5 px-3.5"
      style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(15,20,25,0.03)', padding: '10px 14px' }}
    >
      <input
        inputMode="numeric"
        value={low}
        onChange={(e) => onChange(e.target.value, high)}
        className="text-center tabular-nums bg-transparent border-0 outline-none"
        style={{ width: 28, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--color-text-primary)' }}
      />
      <div className="flex-1 relative h-[2px] rounded-[1px]" style={{ background: 'var(--color-border-subtle)' }}>
        <div className="absolute left-[20%] right-[25%] -top-[1px] h-1 rounded-[2px]" style={{ background: 'var(--color-accent)' }} />
      </div>
      <input
        inputMode="numeric"
        value={high}
        onChange={(e) => onChange(low, e.target.value)}
        className="text-center tabular-nums bg-transparent border-0 outline-none"
        style={{ width: 34, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--color-text-primary)' }}
      />
      <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--color-text-subtle)' }}>{t('exerciseLibrary.reps', 'reps')}</span>
    </div>
  );
};

/* ── Difficulty segmented ───────────────────────────────────────────────────── */
const DifficultyPicker = ({ value, onChange, labels }) => (
  <div
    className="flex rounded-[12px] gap-1"
    style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', padding: 4 }}
  >
    {labels.map(({ key, label }) => {
      const sel = key === value;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className="flex-1 rounded-[9px] transition-all"
          style={{
            padding: '9px 8px',
            background: sel ? 'var(--color-bg-card)' : 'transparent',
            color: sel ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
            fontSize: 12,
            fontWeight: sel ? 800 : 600,
            letterSpacing: '-0.1px',
            boxShadow: sel ? '0 1px 2px rgba(15,20,25,0.05)' : 'none',
            border: 'none',
          }}
        >
          {label}
        </button>
      );
    })}
  </div>
);

/* ── Eyebrow label (uppercase, bold) ────────────────────────────────────────── */
const SectionLabel = ({ children, required, optional, right }) => (
  <div className="flex items-baseline gap-1.5 mb-2">
    <span className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--color-text-primary)' }}>{children}</span>
    {required && <span className="text-[11px] font-extrabold" style={{ color: HOT }}>*</span>}
    {optional && <span className="text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--color-text-muted)' }}>Optional</span>}
    {right && <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{right}</span>}
  </div>
);

/* ── Warm Detail: 4-column numbers strip ────────────────────────────────────── */
const NumbersStrip = ({ items }) => (
  <div
    className="flex items-stretch rounded-[16px] px-3 py-[10px]"
    style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW, border: '1px solid var(--color-border-subtle)' }}
  >
    {items.map((s, i) => (
      <React.Fragment key={s.k}>
        <div className="flex-1 text-center min-w-0">
          <div
            className="truncate"
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: s.gold ? '#8a6a1d' : 'var(--color-text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {s.v}
          </div>
          <div
            className="mt-[1px]"
            style={{ fontSize: 9, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}
          >
            {s.k}
          </div>
        </div>
        {i < items.length - 1 && (
          <div className="w-px" style={{ background: 'var(--color-border-subtle)' }} />
        )}
      </React.Fragment>
    ))}
  </div>
);

/* ── Warm Detail: numbered form cues ────────────────────────────────────────── */
const CuesList = ({ title, cues }) => (
  <div
    className="rounded-[16px] p-3"
    style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW, border: '1px solid var(--color-border-subtle)' }}
  >
    <div
      className="mb-2"
      style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
    >
      {title}
    </div>
    <div className="flex flex-col gap-[6px]">
      {cues.map((c, i) => (
        <div key={i} className="flex gap-[10px] items-start">
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: ACCENT_SOFT,
              color: 'var(--color-accent)',
              fontFamily: DISPLAY_FONT,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {i + 1}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.005em',
              lineHeight: 1.45,
            }}
          >
            {c}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/* ── Warm Detail: sparkline of last sessions ────────────────────────────────── */
const HistorySpark = ({ sessions, emptyLabel, emptySub }) => {
  if (!sessions || sessions.length === 0) {
    return (
      <div
        className="rounded-[18px] p-5 text-center"
        style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW, border: '1px solid var(--color-border-subtle)' }}
      >
        <div
          style={{ fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}
        >
          {emptyLabel}
        </div>
        <div className="mt-1" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{emptySub}</div>
      </div>
    );
  }
  const max = Math.max(...sessions.map(s => s.load || 0), 1);
  return (
    <div
      className="rounded-[18px] p-4"
      style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW, border: '1px solid var(--color-border-subtle)' }}
    >
      <div className="flex justify-between items-baseline mb-3">
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
            LAST {sessions.length} SESSIONS
          </div>
        </div>
        {sessions.some(s => s.pr) && (
          <div
            className="px-2 py-[3px] rounded-full flex items-center gap-1"
            style={{ background: '#F6ECB6', color: '#8a6a1d', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}
          >
            <Trophy size={10} strokeWidth={2.5} /> NEW PR
          </div>
        )}
      </div>
      <div
        className="grid items-end pb-1"
        style={{ gridTemplateColumns: `repeat(${sessions.length}, 1fr)`, height: 70, borderBottom: '1px dashed var(--color-border-subtle)' }}
      >
        {sessions.map((s, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full gap-[6px]">
            <div
              style={{
                width: 10,
                height: `${Math.max(14, (s.load / max) * 60)}px`,
                borderRadius: 3,
                background: s.pr ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                boxShadow: s.pr ? '0 0 0 4px color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'none',
              }}
            />
          </div>
        ))}
      </div>
      <div className="grid mt-[6px]" style={{ gridTemplateColumns: `repeat(${sessions.length}, 1fr)` }}>
        {sessions.map((s, i) => (
          <div key={i} className="text-center" style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-subtle)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {s.day}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Premium Exercise Card ──────────────────────────────────────────────────── */
const ExerciseCard = React.memo(({ exercise, onSelect, selectable, isFavorite, onToggleFavorite, onEdit, onDelete, onSave, onUnsave, isMine, isSaved, modalOnly = false, initiallyOpen = false, onExternalClose }) => {
  const { t } = useTranslation('pages');
  const posthog = usePostHog();
  const { profile } = useAuth();
  // Re-cast the static defaultSets/Reps/restSeconds into the rep range /
  // rest window the user's primary_goal actually trains in. Surfaces in
  // the numbers strip (and is what the Workout Builder will inherit when
  // an exercise is added to a custom routine).
  const userGoal = profile?.primary_goal || 'general_fitness';
  const goalAdjusted = React.useMemo(
    () => goalAdjustedDefaults(exercise, userGoal),
    [exercise, userGoal]
  );
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [detailTab, setDetailTab] = useState('overview');
  const [showFullDescription, setShowFullDescription] = useState(false);
  // Carousel container for the three tab panels. Native horizontal scroll
  // with CSS scroll-snap delivers the "feel like scrolling, not page
  // changing" UX — the panel physically slides under the finger.
  const tabScrollRef = useRef(null);
  const TAB_ORDER = ['overview', 'muscles', 'history'];
  const scrollToTab = (key) => {
    const el = tabScrollRef.current;
    if (!el) return;
    const idx = TAB_ORDER.indexOf(key);
    if (idx < 0) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  };
  const handleTabsScroll = (e) => {
    const w = e.currentTarget.clientWidth;
    if (w <= 0) return;
    const idx = Math.round(e.currentTarget.scrollLeft / w);
    const next = TAB_ORDER[idx];
    if (next && next !== detailTab) setDetailTab(next);
  };
  const tint = getMuscleColor(exercise.muscle);

  const hasVideo = !!exercise.videoUrl;
  // Merge the exercise's explicit primary regions with its muscle-group baseline
  // so the diagram always lights up the whole muscle group (e.g. "Back" shades
  // the full back, not just lower_back from the exercise's primary array).
  const { primary: cardPrimaryRegions, secondary: cardSecondaryRegions } = buildExerciseRegions(exercise);
  const hasMuscles = cardPrimaryRegions.length > 0;
  const instrText = exInstructions(exercise);
  const longDescription = (instrText?.length ?? 0) > 100;

  // Split instructions into numbered cues when newline-separated, else use as single cue / sentences.
  // Use the locale-aware instrText FIRST so Spanish users see Spanish steps; fall back to the raw
  // English `instructions` only when no localized copy exists. (Previously inverted, which caused
  // every numbered cue to render in English regardless of app language.)
  const instructionCues = React.useMemo(() => {
    const raw = (instrText || exercise.instructions || '').trim();
    if (!raw) return [];
    if (raw.includes('\n')) return raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
    // Fallback: split by sentence-enders for a better numbered list
    const parts = raw.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [raw];
  }, [exercise.instructions, instrText]);

  // PR formatting — knownPR is { weight, reps } when present
  const prValue = exercise.knownPR
    ? `${exercise.knownPR.weight}×${exercise.knownPR.reps}`
    : null;

  const handleStartNow = (e) => {
    e.stopPropagation();
    if (typeof onSelect !== 'function') return;
    posthog?.capture('exercise_start_now_clicked', { exercise_name: exName(exercise), muscle_group: exercise.muscle });
    onSelect(exercise);
  };

  // Body scroll lock while modal is open
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);

  const closeModal = () => {
    setExpanded(false);
    onExternalClose?.();
  };
  const openModal = () => {
    posthog?.capture('exercise_viewed', { exercise_name: exName(exercise), muscle_group: exercise.muscle });
    setDetailTab('overview');
    setShowFullDescription(false);
    setExpanded(true);
  };

  return (
    <>
    {!modalOnly && (
    <div
      className="group rounded-[18px] overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--color-bg-card)',
        boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
      }}
    >
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${exName(exercise)} - ${exercise.muscle}, ${exercise.equipment}`}
        className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer active:bg-white/[0.02] transition-colors"
        onClick={openModal}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); } }}
      >
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tint}12`, border: `1px solid ${tint}18` }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: tint }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug tracking-[-0.01em] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {exName(exercise)}
          </p>
          <p className="text-[12.5px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>
            {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
            <span className="mx-1.5 text-[var(--color-text-muted)]">&middot;</span>
            {t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}
          </p>
        </div>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(exercise.id); }}
            aria-label={isFavorite ? t('exerciseLibrary.ariaRemoveFavorite', 'Remove from favorites') : t('exerciseLibrary.ariaAddFavorite', 'Add to favorites')}
            className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
          >
            <Star size={15} className={isFavorite ? 'text-[#2EC4C4] fill-[#2EC4C4]' : 'text-[var(--color-text-muted)]'} />
          </button>
        )}

        {selectable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
            aria-label={`Add ${exName(exercise)}`}
            className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)' }}
          >
            <Plus size={14} strokeWidth={2.5} style={{ color: 'var(--color-accent)' }} />
          </button>
        )}

        <ChevronRight
          size={16}
          className="flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
        />
      </div>
    </div>
    )}

    {/* ── Detail modal (portaled, scroll-locked, warm-paper aesthetic).
        Uses z-[10000] so it lands ABOVE MuscleExercisesSheet (z-9999) when
        opened from a tapped video box in the body picker flow. */}
    {expanded && createPortal(
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center px-4 animate-fade-in"
        style={{
          background: 'rgba(10,13,16,0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          // Respect device safe areas so the modal never lands under the
          // iOS Dynamic Island/notch or under the Android nav bar.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        }}
        onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        role="dialog"
        aria-modal="true"
        aria-label={exName(exercise)}
      >
        <div
          className="relative w-full max-w-[460px] animate-fade-in flex flex-col"
          style={{
            background: 'var(--color-bg-card)',
            // Subtract safe-area insets so the card never exceeds the
            // usable viewport regardless of device chrome.
            maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)',
            overflow: 'hidden',
            borderRadius: 24,
            boxShadow: '0 24px 60px rgba(10,13,16,0.35)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top close bar */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 pt-3 pb-2" style={{ background: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <button
              type="button"
              onClick={closeModal}
              aria-label={t('exerciseLibrary.ariaClose', 'Close')}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
            >
              <X size={16} strokeWidth={2.4} style={{ color: 'var(--color-text-primary)' }} />
            </button>
            <div
              className="truncate"
              style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
            >
              {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
            </div>
            <div style={{ width: 36 }} />
          </div>

          <div
          className="flex-1 flex flex-col"
          style={{
            background: 'var(--color-surface-hover)',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Hero: big display title + star + meta line */}
          <div className="px-4 pt-3 pb-2.5 flex-shrink-0">
            {exercise.loggedToday && (
              <span
                className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full mb-2"
                style={{ background: '#F6ECB6', color: '#8a6a1d', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}
              >
                <Flame size={9} strokeWidth={2.5} /> {t('exerciseLibrary.loggedToday', 'Logged today')}
              </span>
            )}
            <div className="flex items-start gap-3">
              <h3
                className="flex-1 min-w-0"
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: 22,
                  fontWeight: 800,
                  color: 'var(--color-text-primary)',
                  letterSpacing: '-0.025em',
                  lineHeight: 1.1,
                }}
              >
                {exName(exercise)}
              </h3>
              {onToggleFavorite && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(exercise.id); }}
                  aria-label={isFavorite ? t('exerciseLibrary.ariaRemoveFavorite', 'Remove from favorites') : t('exerciseLibrary.ariaAddFavorite', 'Add to favorites')}
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 mt-0.5"
                  style={{
                    background: isFavorite ? ACCENT_SOFT : 'var(--color-bg-card)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <Star
                    size={17}
                    strokeWidth={2}
                    style={{ color: isFavorite ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                    fill={isFavorite ? 'var(--color-accent)' : 'none'}
                  />
                </button>
              )}
            </div>
            <div
              className="mt-2 flex items-center gap-1.5 flex-wrap"
              style={{ fontSize: 12.5, color: 'var(--color-text-subtle)' }}
            >
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>·</span>
              <span>{t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}</span>
              {/* The exercise's hardcoded `category` (Strength/Hypertrophy/...) used
                  to live here, but it doesn't reflect the user's training goal —
                  the goal badge below the numbers strip now owns that info, and
                  the stats themselves auto-adjust to the user's primary_goal. */}
            </div>
          </div>

          {/* Numbers strip — adapted to the user's primary_goal. The
              `Para tu meta` badge tells the user these aren't generic
              defaults; they're tailored to hypertrophy / strength / etc. */}
          <div className="px-4 pb-2.5 flex-shrink-0">
            {goalAdjusted.adjusted && (
              <div className="mb-2 flex items-center gap-1.5">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                    color: 'var(--color-accent)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t(`exerciseLibrary.goalLabels.${userGoal}`, { defaultValue: t('exerciseLibrary.forYourGoal', 'For your goal') })}
                </span>
              </div>
            )}
            <NumbersStrip
              items={[
                { k: t('exerciseLibrary.sets', 'SETS').toUpperCase(), v: goalAdjusted.sets ?? '—' },
                { k: t('exerciseLibrary.reps', 'REPS').toUpperCase(), v: goalAdjusted.reps ?? '—' },
                { k: t('exerciseLibrary.rest', 'REST').toUpperCase(), v: formatRest(goalAdjusted.rest) },
                ...(prValue ? [{ k: t('exerciseLibrary.pr', 'PR').toUpperCase(), v: prValue, gold: true }] : []),
              ]}
            />
          </div>

          {/* Tab underline row — equal 33/33/33 split */}
          <div className="px-4 flex-shrink-0">
            <div className="flex" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
              {[
                { key: 'overview', label: t('exerciseLibrary.tabs.overview', 'Overview') },
                { key: 'muscles', label: t('exerciseLibrary.tabs.muscles', 'Muscles') },
                { key: 'history', label: t('exerciseLibrary.tabs.history', 'History') },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={(e) => { e.stopPropagation(); setDetailTab(tab.key); scrollToTab(tab.key); }}
                  className="relative pb-2.5 pt-1 transition-colors text-center"
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    fontSize: 13,
                    fontWeight: 700,
                    color: detailTab === tab.key ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                  }}
                >
                  {tab.label}
                  {detailTab === tab.key && (
                    <span
                      className="absolute bottom-[-1px] left-3 right-3 h-[2px] rounded-full"
                      style={{ background: 'var(--color-accent)' }}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content — horizontal scroll-snap carousel. All three panels
              render side-by-side; user can swipe between them with a native-
              feeling scroll. Vertical scroll inside each panel is independent. */}
          <style>{`
            .ex-tab-carousel::-webkit-scrollbar { display: none; }
          `}</style>
          <div
            ref={tabScrollRef}
            className="ex-tab-carousel flex flex-1"
            onScroll={handleTabsScroll}
            style={{
              minHeight: 0,
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollSnapType: 'x mandatory',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {/* OVERVIEW panel */}
            <div
              className="flex flex-col gap-2.5 px-4 pt-3 pb-3"
              style={{
                flex: '0 0 100%',
                minWidth: '100%',
                overflowY: 'auto',
                scrollSnapAlign: 'start',
                scrollSnapStop: 'always',
              }}
            >
              {hasVideo ? (
                <div
                  className="rounded-[18px] overflow-hidden"
                  style={{
                    aspectRatio: '12/9',
                    background: 'var(--color-bg-primary)',
                    boxShadow: WARM_SHADOW,
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <video
                    src={resolveVideoUrl(exercise.videoUrl)}
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-label={`${exName(exercise)} demonstration`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className="rounded-[18px] flex items-center justify-center"
                  style={{
                    aspectRatio: '12/9',
                    background: 'var(--color-bg-card)',
                    boxShadow: WARM_SHADOW,
                    border: '1px dashed var(--color-border-subtle)',
                  }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Play size={22} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {t('exerciseLibrary.videoComingSoon', 'Video coming soon')}
                    </span>
                  </div>
                </div>
              )}
              {instructionCues.length > 0 && (
                <CuesList
                  title={t('exerciseLibrary.formCues', 'Form Cues')}
                  cues={showFullDescription || instructionCues.length <= 4 ? instructionCues : instructionCues.slice(0, 4)}
                />
              )}
              {instructionCues.length > 4 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowFullDescription(s => !s); }}
                  className="self-start px-3 py-1.5 rounded-full transition-colors"
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', background: ACCENT_SOFT }}
                >
                  {showFullDescription ? t('exerciseLibrary.showLess') : t('exerciseLibrary.readMore')}
                </button>
              )}
            </div>

            {/* MUSCLES panel */}
            <div
              className="flex flex-col gap-2.5 px-4 pt-3 pb-3"
              style={{
                flex: '0 0 100%',
                minWidth: '100%',
                overflowY: 'auto',
                scrollSnapAlign: 'start',
                scrollSnapStop: 'always',
              }}
            >
              {hasMuscles ? (
                <div
                  className="rounded-[18px] p-4"
                  style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW, border: '1px solid var(--color-border-subtle)' }}
                >
                  <ExerciseMuscleHighlight
                    primaryRegions={cardPrimaryRegions}
                    secondaryRegions={cardSecondaryRegions}
                    title={t('exerciseLibrary.musclesWorked')}
                  />
                </div>
              ) : (
                <div className="text-center py-10 px-4 rounded-[18px]"
                     style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}>
                  <p className="text-[12px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                    {t('exerciseLibrary.noMuscleData', { defaultValue: 'No muscle data for this exercise' })}
                  </p>
                </div>
              )}
            </div>

            {/* HISTORY panel */}
            <div
              className="flex flex-col gap-2.5 px-4 pt-3 pb-3"
              style={{
                flex: '0 0 100%',
                minWidth: '100%',
                overflowY: 'auto',
                scrollSnapAlign: 'start',
                scrollSnapStop: 'always',
              }}
            >
              <HistorySpark
                sessions={exercise.recentSessions || []}
                emptyLabel={t('exerciseLibrary.noHistoryYet', 'No history yet')}
                emptySub={t('exerciseLibrary.startFirstSet', 'Log your first set to see progress here')}
              />
            </div>
          </div>

          {/* Bottom action row — fixed at bottom of modal */}
          <div
            className="flex items-center gap-2 px-4 pt-3 pb-4 flex-shrink-0"
            style={{ borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
          >
            {isMine && onEdit ? (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); closeModal(); onEdit(exercise); }}
                  className="flex-1 h-11 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: '1.5px solid var(--color-border-subtle)',
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--color-text-primary)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  <Pencil size={14} strokeWidth={2.4} />
                  {t('exerciseLibrary.edit', 'Edit')}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); closeModal(); onDelete(exercise.id); }}
                    className="flex-1 h-11 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                    style={{
                      background: 'color-mix(in srgb, #ef4444 12%, transparent)',
                      border: '1.5px solid color-mix(in srgb, #ef4444 35%, transparent)',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#ef4444',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    <X size={15} strokeWidth={2.6} />
                    {t('exerciseLibrary.delete', 'Delete')}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (selectable && onSelect) onSelect(exercise); }}
                className="flex-1 h-11 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                style={{
                  background: 'var(--color-bg-card)',
                  border: '1.5px solid var(--color-border-subtle)',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--color-text-primary)',
                  letterSpacing: '-0.01em',
                }}
              >
                <Plus size={15} strokeWidth={2.4} />
                {t('exerciseLibrary.addToWorkout', 'Add to workout')}
              </button>
            )}
            {!isMine && onSave && !isSaved && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onSave(); }}
                className="flex-1 h-11 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                style={{
                  background: ACCENT_SOFT,
                  border: `1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)`,
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--color-accent)',
                  letterSpacing: '-0.01em',
                }}
              >
                <Bookmark size={14} strokeWidth={2.4} />
                {t('exerciseLibrary.save', 'Save')}
              </button>
            )}
            {!isMine && onUnsave && isSaved && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUnsave(); }}
                className="flex-1 h-11 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                style={{
                  background: 'var(--color-bg-card)',
                  border: '1.5px solid var(--color-border-subtle)',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '-0.01em',
                }}
              >
                <X size={14} strokeWidth={2.4} />
                {t('exerciseLibrary.removeFromSaved', 'Remove from saved')}
              </button>
            )}
            {typeof onSelect === 'function' && !isMine && (
              <button
                type="button"
                onClick={handleStartNow}
                className="flex-[1.4] h-11 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-on-accent, #fff)',
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: '-0.005em',
                  boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent) 30%, transparent)',
                }}
              >
                <Play size={14} strokeWidth={2.6} fill="var(--color-text-on-accent, #fff)" />
                {t('exerciseLibrary.startNow', 'Start now')}
              </button>
            )}
          </div>
        </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
});

/* ── Exercise Library (browseable list with search + filters) ────────────────── */
const ExerciseLibrary = ({ onSelect, selectable = false, selectedIds = [], extraExercises = [], favoriteIds = new Set(), onToggleFavorite }) => {
  const { t } = useTranslation('pages');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeMuscle, setActiveMuscle] = useState('All');
  const [activeEquipment, setActiveEquipment] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  // ── Body-picker mode ──
  // Persist the user's last choice between sessions so power users who
  // prefer the list aren't fighting the toggle every visit.
  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('exerciseLibrary.viewMode');
      return (saved === 'body' || saved === 'compact') ? saved : 'list';
    } catch { return 'list'; }
  });
  useEffect(() => {
    try { localStorage.setItem('exerciseLibrary.viewMode', viewMode); } catch {}
  }, [viewMode]);
  const [pickedBucket, setPickedBucket] = useState(null);
  // Compact (names-only) view: tapping a name opens the same detail modal the
  // card view uses (ExerciseCard in modalOnly mode).
  const [compactDetailEx, setCompactDetailEx] = useState(null);
  const [expandToGroup, setExpandToGroup] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Scroll locking for advanced filters modal
  useEffect(() => {
    if (showAdvancedFilters) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showAdvancedFilters]);

  const [sortBy, setSortBy] = useState('name-asc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortRef = useRef(null);

  const allExercises = useMemo(() => {
    const localById = Object.fromEntries(localExercises.map(e => [e.id, e]));
    const dbIds = new Set(extraExercises.map(e => e.id));
    const uniqueLocal = localExercises.filter(e => !dbIds.has(e.id));
    // For DB exercises missing video_url, fall back to the local video path
    const dbWithFallback = extraExercises.map(e =>
      (!e.videoUrl && localById[e.id]?.videoUrl)
        ? { ...e, videoUrl: localById[e.id].videoUrl }
        : e
    );
    return [...uniqueLocal, ...dbWithFallback];
  }, [extraExercises]);

  // Close sort menu on outside click
  useEffect(() => {
    const fn = (e) => { if (sortRef.current && !sortRef.current.contains(e.target)) setShowSortMenu(false); };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, []);

  const filtered = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    return allExercises.filter(e => {
      const matchesQuery = !q ||
        e.name.toLowerCase().includes(q) ||
        (e.name_es && e.name_es.toLowerCase().includes(q)) ||
        e.muscle.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q);
      const matchesMuscle    = activeMuscle    === 'All' || e.muscle    === activeMuscle;
      const matchesEquipment = activeEquipment === 'All' || e.equipment === activeEquipment;
      const matchesCategory  = activeCategory  === 'All' || e.category  === activeCategory;
      return matchesQuery && matchesMuscle && matchesEquipment && matchesCategory;
    });
  }, [debouncedQuery, activeMuscle, activeEquipment, activeCategory, allExercises]);

  // Same filter set as `filtered` but WITHOUT the muscle-pill filter. In
  // body view, the tapped polygon supplies muscle selection, so the
  // high-level muscle pill would only narrow results in confusing ways
  // ("tap quads but Chest filter active = no exercises").
  const bodyModeExercises = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    return allExercises.filter(e => {
      const matchesQuery = !q ||
        e.name.toLowerCase().includes(q) ||
        (e.name_es && e.name_es.toLowerCase().includes(q)) ||
        e.muscle.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q);
      const matchesEquipment = activeEquipment === 'All' || e.equipment === activeEquipment;
      const matchesCategory  = activeCategory  === 'All' || e.category  === activeCategory;
      return matchesQuery && matchesEquipment && matchesCategory;
    });
  }, [debouncedQuery, activeEquipment, activeCategory, allExercises]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'name-asc':  return arr.sort((a, b) => exName(a).localeCompare(exName(b)));
      case 'name-desc': return arr.sort((a, b) => exName(b).localeCompare(exName(a)));
      case 'muscle':    return arr.sort((a, b) => a.muscle.localeCompare(b.muscle) || exName(a).localeCompare(exName(b)));
      case 'equipment': return arr.sort((a, b) => a.equipment.localeCompare(b.equipment) || exName(a).localeCompare(exName(b)));
      default:          return arr;
    }
  }, [filtered, sortBy]);

  const activeFilterCount = [activeMuscle !== 'All', activeEquipment !== 'All', activeCategory !== 'All'].filter(Boolean).length;

  return (
    <div className="animate-fade-in">
      {/* Search bar with filter toggle */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder={t('exerciseLibrary.searchPlaceholder')}
          aria-label={t('exerciseLibrary.searchPlaceholder')}
          maxLength={100}
          className="w-full rounded-[14px] pl-10 pr-12 py-3 text-[14px] focus:outline-none transition-all"
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setDebouncedQuery(''); }}
              aria-label={t('exerciseLibrary.ariaClearSearch', 'Clear search')}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setShowAdvancedFilters(true)}
            aria-label={t('exerciseLibrary.ariaOpenFilters', 'Open filters')}
            className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-all active:scale-95 focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
            style={{
              background: activeFilterCount > 0 ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
              color: activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-subtle)',
            }}
          >
            <SlidersHorizontal size={16} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[var(--color-text-on-accent,#000)] text-[9px] font-bold flex items-center justify-center" style={{ background: 'var(--color-accent, #2EC4C4)' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Results + Sort row */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <p className="text-[12.5px] font-medium text-[var(--color-text-muted)] min-w-0 truncate">
          {t('exerciseLibrary.resultCount', { count: sorted.length })}
          {debouncedQuery && <span style={{ color: 'var(--color-text-muted)' }}> {t('exerciseLibrary.forQuery', { query: debouncedQuery })}</span>}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Lista | Cuerpo view toggle */}
          <div
            className="inline-flex items-center rounded-lg p-[3px]"
            style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
          >
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label={t('exerciseLibrary.viewList', 'List view')}
              aria-pressed={viewMode === 'list'}
              className="px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors"
              style={{
                background: viewMode === 'list' ? 'var(--color-bg-card)' : 'transparent',
                color: viewMode === 'list' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <LayoutList size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              aria-label={t('exerciseLibrary.viewCompact', 'Names list')}
              aria-pressed={viewMode === 'compact'}
              className="px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors"
              style={{
                background: viewMode === 'compact' ? 'var(--color-bg-card)' : 'transparent',
                color: viewMode === 'compact' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <AlignJustify size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('body')}
              aria-label={t('exerciseLibrary.viewBody', 'Body view')}
              aria-pressed={viewMode === 'body'}
              className="px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors"
              style={{
                background: viewMode === 'body' ? 'var(--color-bg-card)' : 'transparent',
                color: viewMode === 'body' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <User size={13} />
            </button>
          </div>
          <div ref={sortRef} className="relative">
          <button
            onClick={() => setShowSortMenu(s => !s)}
            aria-label={t('exerciseLibrary.sort')}
            className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors active:scale-95"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ArrowUpDown size={13} />
            {t('exerciseLibrary.sort')}
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-40 rounded-xl border border-[var(--color-border-subtle)] overflow-hidden z-20"
                 style={{ background: 'var(--color-bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setSortBy(opt.key); setShowSortMenu(false); }}
                  className="w-full px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                  style={{ color: sortBy === opt.key ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                >
                  {t(`exerciseLibrary.sortOptions.${opt.i18nKey}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Body picker mode — tap a muscle, slide-up sheet shows the
          exercises that target it. Honors active search + filter chips. */}
      {viewMode === 'body' && (
        <div className="mb-4">
          <BodyMusclePicker
            selected={pickedBucket}
            onSelect={(bucketId) => {
              setExpandToGroup(false);
              setPickedBucket(bucketId);
            }}
            maxWidth={420}
          />
        </div>
      )}

      {/* List view — preserved as-is when viewMode === 'list'. */}
      {viewMode === 'list' && (
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 xl:grid-cols-3">
        {sorted.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            selectable={selectable && !selectedIds.includes(ex.id)}
            onSelect={onSelect}
            isFavorite={favoriteIds.has(ex.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}

        {sorted.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
              <Dumbbell size={28} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-[15px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('exerciseLibrary.noExercisesFound')}</p>
            <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.tryDifferentSearch')}</p>
          </div>
        )}
      </div>
      )}

      {/* Compact names-only view — dense tappable rows, no video/cards. Tapping a
          name opens the same detail modal the card view uses (or selects it in
          routine-builder pick mode). */}
      {viewMode === 'compact' && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border-subtle)' }}>
          {sorted.map((ex, i) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => { if (selectable) onSelect?.(ex); else setCompactDetailEx(ex); }}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors active:opacity-70"
              style={{
                background: 'var(--color-bg-card)',
                borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none',
              }}
            >
              <span className="text-[14px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                {exName(ex)}
              </span>
              <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: getMuscleColor(ex.muscle) }}>
                {t(`muscleGroups.${ex.muscle}`, ex.muscle)}
              </span>
            </button>
          ))}

          {sorted.length === 0 && (
            <div className="text-center py-20" style={{ background: 'var(--color-bg-card)' }}>
              <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                   style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
                <Dumbbell size={28} className="text-[var(--color-text-muted)]" />
              </div>
              <p className="text-[15px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('exerciseLibrary.noExercisesFound')}</p>
              <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.tryDifferentSearch')}</p>
            </div>
          )}
        </div>
      )}

      {/* Detail modal for a tapped name in compact view (reuses ExerciseCard). */}
      {compactDetailEx && (
        <ExerciseCard
          key={compactDetailEx.id}
          exercise={compactDetailEx}
          modalOnly
          initiallyOpen
          onExternalClose={() => setCompactDetailEx(null)}
          isFavorite={favoriteIds.has(compactDetailEx.id)}
          onToggleFavorite={onToggleFavorite}
        />
      )}

      {/* Body-mode: muscle-region sheet (opens when picker selection is set).
          Source list intentionally ignores the muscle-pill filter — the
          body itself is the muscle selector here. */}
      <MuscleExercisesSheet
        open={!!pickedBucket && viewMode === 'body'}
        bucketId={pickedBucket}
        expandToGroup={expandToGroup}
        exercises={bodyModeExercises}
        onClose={() => { setPickedBucket(null); setExpandToGroup(false); }}
        onToggleExpand={setExpandToGroup}
        onExerciseTap={(ex) => {
          // Reuse the same selection behavior as the list view: if the
          // library is in "select-multiple" mode (picker for routine
          // builder), add to selection. Otherwise just bubble up so the
          // detail page opens.
          if (selectable) {
            onSelect?.(ex);
          } else {
            // Fallback — same flow ExerciseCard click triggers.
            try { posthog?.capture('exercise_viewed', { exercise_name: exName(ex), muscle_group: ex.muscle, source: 'body_picker' }); } catch {}
          }
        }}
      />

      {/* Advanced Filters Bottom Sheet */}
      {showAdvancedFilters && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowAdvancedFilters(false)}
          role="dialog"
          aria-labelledby="filters-dialog-title"
        >
          <div
            className="w-full max-w-[520px] rounded-[24px] pb-8 pt-3 animate-fade-in"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
          >


            <div className="px-6">
              <div className="flex items-center justify-between mb-6">
                <h3 id="filters-dialog-title" className="text-[18px] truncate" style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text-primary)' }}>{t('exerciseLibrary.filters')}</h3>
                <button
                  onClick={() => {
                    setActiveMuscle('All');
                    setActiveEquipment('All');
                    setActiveCategory('All');
                  }}
                  aria-label={t('exerciseLibrary.reset')}
                  className="text-[13px] font-medium active:opacity-70"
                  style={{ color: 'var(--color-accent, #2EC4C4)' }}
                >
                  {t('exerciseLibrary.reset')}
                </button>
              </div>

              {/* Muscle Group */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[var(--color-text-muted)]">{t('exerciseLibrary.muscleGroup')}</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...MUSCLE_GROUPS].map(m => {
                    const active = activeMuscle === m;
                    return (
                      <button
                        key={m}
                        onClick={() => setActiveMuscle(m)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-full transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`muscleGroups.${m}`, m)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[var(--color-text-muted)]">{t('exerciseLibrary.equipment')}</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...EQUIPMENT].map(eq => {
                    const active = activeEquipment === eq;
                    return (
                      <button
                        key={eq}
                        onClick={() => setActiveEquipment(eq)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-full transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`exerciseLibrary.equipmentNames.${eq}`, eq)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div className="mb-8">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[var(--color-text-muted)]">{t('exerciseLibrary.category')}</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...CATEGORIES].map(cat => {
                    const active = activeCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-full transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`exerciseLibrary.categoryNames.${cat}`, cat)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => setShowAdvancedFilters(false)}
                className="w-full py-3.5 rounded-full font-bold text-[14px] active:scale-[0.98] transition-all text-[var(--color-text-on-accent,#fff)]"
                style={{ background: 'var(--color-accent, #2EC4C4)' }}
              >
                {t('exerciseLibrary.showExercises', { count: filtered.length })}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

/* ── Custom Exercise Card (Mine / Friends tabs) ─────────────────────────────── */
const CustomExerciseCard = ({ exercise, isMine, isSaved, onSave, onDelete, onUnsave, onEdit, isFavorite, onToggleFavorite }) => {
  const { t } = useTranslation('pages');
  const [expanded, setExpanded] = useState(false);
  const tint = getMuscleColor(exercise.muscle);

  return (
    <div
      className="rounded-[18px] overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--color-bg-card)',
        boxShadow: expanded
          ? '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.08)'
          : '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${exName(exercise)} - ${exercise.muscle}, ${exercise.equipment}`}
        className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer active:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
      >
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tint}12`, border: `1px solid ${tint}18` }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: tint }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug tracking-[-0.01em] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {exName(exercise)}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 truncate">
            <span className="text-[12.5px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
              {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
              <span className="mx-1.5 text-[var(--color-text-muted)]">&middot;</span>
              {t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}
            </span>
            {!isMine && exercise.createdByName && (
              <span className="text-[11px] ml-1" style={{ color: 'var(--color-text-muted)' }}>
                by @{exercise.createdByUsername ?? exercise.createdByName}
              </span>
            )}
            {isMine && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md ml-1"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', color: 'var(--color-accent)' }}>
                {t('exerciseLibrary.yours')}
              </span>
            )}
          </div>
        </div>

        {/* Action icons — grouped tight */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onToggleFavorite(exercise.id); }}
              aria-label={isFavorite ? t('exerciseLibrary.ariaRemoveFavorite', 'Remove from favorites') : t('exerciseLibrary.ariaAddFavorite', 'Add to favorites')}
              className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center active:scale-90 transition-all focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
            >
              <Star size={15} className={isFavorite ? 'text-[#2EC4C4] fill-[#2EC4C4]' : 'text-[var(--color-text-muted)]'} />
            </button>
          )}

          {!isMine && !isSaved && onSave && (
            <button
              onClick={e => { e.stopPropagation(); onSave(); }}
              aria-label={t('exerciseLibrary.ariaSaveExercise', 'Save exercise')}
              className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center active:scale-90 transition-all focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
            >
              <Bookmark size={14} style={{ color: 'var(--color-accent)' }} />
            </button>
          )}
          {isSaved && !isMine && onUnsave && (
            <button
              onClick={e => { e.stopPropagation(); onUnsave(); }}
              aria-label={t('exerciseLibrary.ariaUnsaveExercise', 'Unsave exercise')}
              className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center active:scale-90 bg-[#10B981]/10 hover:bg-red-500/10 transition-colors focus:ring-2 focus:ring-[#2EC4C4] focus:outline-none"
            >
              <Bookmark size={14} className="text-[#10B981] fill-[#10B981]" />
            </button>
          )}

          <ChevronRight
            size={16}
            className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {/* Stats row */}
          <div
            className="flex items-center justify-center rounded-[12px] mb-3.5 divide-x"
            style={{ background: 'var(--color-surface-hover)', '--tw-divide-opacity': '0.05', '--tw-divide-color': 'var(--color-border-subtle)' }}
          >
            <StatPill label={t('exerciseLibrary.sets')} value={exercise.defaultSets} />
            <StatPill label={t('exerciseLibrary.reps')} value={exercise.defaultReps} />
          </div>
          {exInstructions(exercise) && (
            <p className="text-[13px] leading-[1.65] text-[var(--color-text-subtle)] mb-3">
              {exInstructions(exercise)}
            </p>
          )}

          {/* Actions for own exercises */}
          {isMine && (
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
              {onEdit && (
                <button
                  onClick={() => onEdit(exercise)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium hover:bg-white/[0.06] transition-colors"
                  style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                >
                  <Pencil size={11} /> {t('exerciseLibrary.edit')}
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(exercise.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
                >
                  <X size={11} /> {t('exerciseLibrary.delete')}
                </button>
              )}
            </div>
          )}

          {/* Unsave for friend exercises */}
          {!isMine && isSaved && onUnsave && (
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
              <button
                onClick={() => onUnsave()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
              >
                <X size={11} /> {t('exerciseLibrary.removeFromSaved')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Normalize a DB exercise row to frontend format ─────────────────────────── */
const normalizeDbExercise = (row) => {
  return {
    id:               row.id,
    name:             row.name,
    name_es:          row.name_es || null,
    muscle:           row.muscle_group,
    equipment:        row.equipment,
    category:         row.category,
    defaultSets:      row.default_sets,
    defaultReps:      row.default_reps,
    restSeconds:      row.rest_seconds,
    instructions:     row.instructions ?? '',
    instructions_es:  row.instructions_es || null,
    primaryRegions:   row.primary_regions   ?? [],
    secondaryRegions: row.secondary_regions ?? [],
    videoUrl:         row.video_url || null,
    createdBy:        row.created_by,
    createdByName:    row.profiles?.full_name,
    createdByUsername: row.profiles?.username,
    isCustom:         true,
  };
};

/* ── Custom dropdown for Add Exercise modal ─────────────────────────────────── */
const DropdownSelect = ({ value, options, onChange, placeholder, label, renderOption }) => {
  const display = renderOption || ((v) => v);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, []);
  return (
    <div ref={ref} className="relative">
      <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-3 text-left text-[14px] flex items-center justify-between min-h-[44px] focus:outline-none focus:border-[#2EC4C4]/40 transition-all"
        style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
      >
        <span>{value ? display(value) : placeholder}</span>
        <ChevronDown size={15} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10 max-h-[200px] overflow-y-auto border border-[var(--color-border-subtle)] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          style={{ background: 'var(--color-bg-primary)' }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full px-3.5 py-2.5 text-left text-[13px] hover:bg-[var(--color-surface-hover)] transition-colors"
              style={{ color: value === opt ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
            >
              {display(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Add Exercise Modal ─────────────────────────────────────────────────────── */

const AddExerciseModal = ({ onSave, onClose }) => {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: '', primaryBuckets: ['chest-mid'], secondaryBuckets: [], equipment: EQUIPMENT[0],
    category: CATEGORIES[0], defaultSets: 3, defaultReps: '8-12',
    repLow: 8, repHigh: 12, rest: 90, difficulty: 'Intermediate',
    instructions: '', shareWithFriends: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const togglePrimaryBucket = (bucketId) => {
    setForm(f => {
      // Toggle in primary; if it was a secondary, remove from there too.
      const inPrimary = f.primaryBuckets.includes(bucketId);
      return {
        ...f,
        primaryBuckets: inPrimary
          ? f.primaryBuckets.filter(b => b !== bucketId)
          : [...f.primaryBuckets, bucketId],
        secondaryBuckets: inPrimary ? f.secondaryBuckets : f.secondaryBuckets.filter(b => b !== bucketId),
      };
    });
  };

  const toggleSecondaryBucket = (bucketId) => {
    setForm(f => ({
      ...f,
      secondaryBuckets: f.secondaryBuckets.includes(bucketId)
        ? f.secondaryBuckets.filter(b => b !== bucketId)
        : [...f.secondaryBuckets, bucketId],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError(t('exerciseLibrary.nameRequired')); return; }
    if (form.primaryBuckets.length === 0) { setError(t('exerciseLibrary.primaryRequired', 'Selecciona al menos un músculo principal')); return; }
    setSaving(true);
    setError('');
    const reps = `${form.repLow}-${form.repHigh}`;
    // Resolve bucket selections back to muscle_group enum + region arrays.
    // muscle_group enum can only hold one value — we use the FIRST primary
    // bucket's parent group. The granular primary_regions array preserves
    // every selected primary bucket, so filtering by sub-region still works.
    const primaryGroups = Array.from(new Set(
      form.primaryBuckets.map((b) => bucketGroup(b)).filter(Boolean)
    ));
    const muscleGroup = primaryGroups[0] || MUSCLE_GROUPS[0];
    const primaryRegions = Array.from(new Set(
      form.primaryBuckets.flatMap((b) => MUSCLE_BUCKET_BY_ID.get(b)?.regionIds || [])
    ));
    const secondaryRegions = Array.from(new Set(
      form.secondaryBuckets.flatMap((b) => MUSCLE_BUCKET_BY_ID.get(b)?.regionIds || [])
    ));
    // try/finally: if anything in the save path throws, the button MUST
    // come back from "Saving…" — an un-guarded rejection here left it
    // spinning forever.
    try {
      const result = await onSave({
        ...form,
        muscle:          muscleGroup,
        secondaryMuscles: Array.from(new Set(form.secondaryBuckets.map((b) => bucketGroup(b)).filter(Boolean))),
        primaryRegions,
        secondaryRegions,
        name:        form.name.trim(),
        defaultSets: parseInt(form.defaultSets) || 3,
        defaultReps: reps,
        instructions: form.instructions?.trim() || '',
      });
      if (result?.error) setError(result.error);
    } catch (err) {
      setError(err?.message || t('common:somethingWentWrong', 'Something went wrong'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const mm = String(Math.floor(form.rest / 60));
  const ss = String(form.rest % 60).padStart(2, '0');
  const canSave = !!form.name.trim() && !saving;

  const difficultyLabels = [
    { key: 'Beginner',     label: t('exerciseLibrary.beginner', 'Beginner') },
    { key: 'Intermediate', label: t('exerciseLibrary.intermediate', 'Intermediate') },
    { key: 'Advanced',     label: t('exerciseLibrary.advanced', 'Advanced') },
  ];

  // Map the backend equipment list to tiles the user sees — fall back to real EQUIPMENT when user picks.
  const equipTiles = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell'];

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center px-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-exercise-title"
    >
      <div
        className="w-full max-w-[520px] rounded-[22px] overflow-hidden flex flex-col animate-fade-in"
        style={{
          background: 'var(--color-bg-primary)',
          maxHeight: 'calc(100vh - 24px)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 1px 2px rgba(15,20,25,0.06)',
        }}
      >
        {/* Sticky top bar */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-3.5 py-2.5"
          style={{
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-primary)',
            paddingTop: 'max(0.625rem, var(--safe-area-top, env(safe-area-inset-top)))',
          }}
        >
          <button
            onClick={onClose}
            aria-label={t('exerciseLibrary.ariaClose', 'Close')}
            className="w-[38px] h-[38px] rounded-full flex items-center justify-center active:scale-95 transition-all"
            style={{ background: 'var(--color-surface-hover)' }}
          >
            <X size={18} strokeWidth={2.2} style={{ color: 'var(--color-text-primary)' }} />
          </button>
          <h2
            id="new-exercise-title"
            className="truncate"
            style={{ fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--color-text-primary)' }}
          >{t('exerciseLibrary.newExercise')}</h2>
          <div style={{ width: 38 }} />
        </header>

        <div className="flex-1 overflow-y-auto pb-[calc(100px+var(--safe-area-bottom,env(safe-area-inset-bottom)))]">
          {/* Hero */}
          <div className="px-5 pt-4 pb-1">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--color-accent)' }}>
              {t('exerciseLibrary.createCustomMovement', 'CREATE · CUSTOM MOVEMENT')}
            </div>
            <div
              className="mt-1.5"
              style={{ fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 900, letterSpacing: '-1px', lineHeight: 1.02, color: 'var(--color-text-primary)' }}
            >
              {t('exerciseLibrary.newExerciseHeadline', 'Build an exercise the gym will remember.')}
            </div>
          </div>

          {/* Exercise name */}
          <div className="px-4 pt-5">
            <SectionLabel required>{t('exerciseLibrary.exerciseNameLabel')}</SectionLabel>
            <div
              className="rounded-[14px] flex items-center gap-2.5"
              style={{
                background: 'var(--color-bg-card)',
                border: '1.5px solid var(--color-border-subtle)',
                boxShadow: '0 1px 2px rgba(15,20,25,0.03)',
                padding: '14px',
              }}
            >
              <div
                className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
                style={{ background: ACCENT_SOFT }}
              >
                <Edit3 size={16} strokeWidth={2} style={{ color: 'var(--color-accent)' }} />
              </div>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={40}
                placeholder={t('exerciseLibrary.exerciseNamePlaceholder', 'e.g. Bulgarian Split Squat')}
                className="flex-1 bg-transparent border-0 outline-none"
                style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}
              />
              {form.name.length > 0 && (
                <div
                  className="text-[10px] font-bold uppercase tracking-[0.04em]"
                  style={{ color: 'var(--color-text-muted)' }}
                >{form.name.length}/40</div>
              )}
            </div>
          </div>

          {/* Equipment tile grid */}
          <div className="px-4 pt-6">
            <SectionLabel>{t('exerciseLibrary.equipmentLabel')}</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {equipTiles.map((eq) => (
                <EquipmentTile
                  key={eq}
                  label={t(`exerciseLibrary.equipmentNames.${eq}`, eq)}
                  selected={form.equipment === eq}
                  onClick={() => set('equipment', eq)}
                  icon={EQUIP_ICONS[eq]}
                />
              ))}
            </div>
          </div>

          {/* Muscles worked card — tap the trainer figure to set primary
              (deep red) and add secondaries (light red). Mode pill under
              the figure controls which slot the next tap targets. */}
          <div className="px-4 pt-6">
            <SectionLabel required>{t('exerciseLibrary.musclesWorked', 'Muscles worked')}</SectionLabel>
            <div
              className="rounded-[20px] p-4"
              style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW }}
            >
              <MuscleGroupPicker
                primaryBuckets={form.primaryBuckets}
                secondaryBuckets={form.secondaryBuckets}
                onPrimaryToggle={(b) => togglePrimaryBucket(b)}
                onSecondaryToggle={(b) => toggleSecondaryBucket(b)}
                maxWidth={300}
              />

              {/* Selection summary — lists every selected bucket so a
                  compound lift can be tagged with multiple primary
                  movers (e.g. bench → upper + mid chest). */}
              <div className="mt-3.5 pt-3.5 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('exerciseLibrary.primaryMuscleLabel', 'Primary')} · {form.primaryBuckets.length}
                </div>
                {form.primaryBuckets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => set('primaryBuckets', [])}
                    className="text-[10px] font-bold uppercase tracking-[0.06em] active:opacity-70 flex-shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  >{t('exerciseLibrary.clear', 'CLEAR')}</button>
                )}
              </div>
              {form.primaryBuckets.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.primaryBuckets.map((b) => (
                    <span
                      key={b}
                      className="text-[11px] font-bold px-2 py-1 rounded-full"
                      style={{
                        background: 'color-mix(in srgb, #DC2626 18%, transparent)',
                        color: '#DC2626',
                        border: '1px solid #DC2626',
                      }}
                    >
                      {t(`readinessModal.buckets.${b}`, {
                        defaultValue: MUSCLE_BUCKET_BY_ID.get(b)?.label || b,
                      })}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('exerciseLibrary.tapToSetPrimary', 'Toca un músculo en el modo Primario para empezar.')}
                </p>
              )}

              {form.secondaryBuckets.length > 0 && (
                <>
                  <div className="mt-3.5 pt-3.5 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('exerciseLibrary.secondaryMusclesLabel', 'Secondary')} · {form.secondaryBuckets.length}
                    </div>
                    <button
                      type="button"
                      onClick={() => set('secondaryBuckets', [])}
                      className="text-[10px] font-bold uppercase tracking-[0.06em] active:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--color-text-muted)' }}
                    >{t('exerciseLibrary.clear', 'CLEAR')}</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {form.secondaryBuckets.map((b) => (
                      <span
                        key={b}
                        className="text-[11px] font-bold px-2 py-1 rounded-full"
                        style={{
                          background: 'color-mix(in srgb, #FCA5A5 22%, transparent)',
                          color: '#DC2626',
                          border: '1px solid color-mix(in srgb, #FCA5A5 50%, transparent)',
                        }}
                      >
                        {t(`readinessModal.buckets.${b}`, {
                          defaultValue: MUSCLE_BUCKET_BY_ID.get(b)?.label || b,
                        })}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Defaults */}
          <div className="px-4 pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--color-text-primary)' }}>
                {t('exerciseLibrary.defaults', 'Defaults')}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('exerciseLibrary.defaultsHint', 'Pre-fills when added to a routine')}
              </span>
            </div>

            <div className="grid gap-2.5" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] mb-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('exerciseLibrary.defaultSetsLabel', 'Sets')}
                </div>
                <Stepper value={form.defaultSets} onChange={(v) => set('defaultSets', v)} min={1} max={10} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] mb-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('exerciseLibrary.defaultRepsLabel', 'Rep range')}
                </div>
                <RepRange
                  low={form.repLow}
                  high={form.repHigh}
                  onChange={(l, h) => setForm(f => ({ ...f, repLow: l, repHigh: h }))}
                />
              </div>
            </div>

            {/* Rest */}
            <div className="mt-2.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] mb-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                {t('exerciseLibrary.restBetweenSets', 'Rest between sets')}
              </div>
              <div
                className="rounded-[14px] px-4 py-3.5"
                style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(15,20,25,0.03)' }}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className="tabular-nums"
                    style={{ fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 800, letterSpacing: '-0.8px', color: 'var(--color-text-primary)' }}
                  >{mm}:{ss}</span>
                  <div className="flex gap-1.5">
                    {[60, 90, 120, 180].map((r) => {
                      const sel = form.rest === r;
                      const label = r < 60 ? `${r}s` : r % 60 === 0 ? `${r / 60}m` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => set('rest', r)}
                          className="rounded-full active:scale-95 transition-all"
                          style={{
                            padding: '5px 9px',
                            border: `1px solid ${sel ? 'transparent' : 'var(--color-border-subtle)'}`,
                            background: sel ? ACCENT_SOFT : 'transparent',
                            color: sel ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.2px',
                          }}
                        >{label}</button>
                      );
                    })}
                  </div>
                </div>
                <div className="relative mt-3 h-5">
                  <div className="absolute left-0 right-0 top-[9px] h-[2px] rounded-[1px]" style={{ background: 'var(--color-border-subtle)' }} />
                  <div
                    className="absolute left-0 top-[9px] h-[2px] rounded-[1px]"
                    style={{ width: `${((form.rest - 30) / 210) * 100}%`, background: 'var(--color-accent)' }}
                  />
                  <div
                    className="absolute top-[1px] w-[18px] h-[18px] rounded-full"
                    style={{
                      left: `calc(${((form.rest - 30) / 210) * 100}% - 9px)`,
                      background: 'var(--color-accent)',
                      border: '3px solid var(--color-bg-card)',
                      boxShadow: '0 1px 4px color-mix(in srgb, var(--color-accent) 45%, transparent)',
                    }}
                  />
                  <input
                    type="range"
                    min="30"
                    max="240"
                    step="15"
                    value={form.rest}
                    onChange={(e) => set('rest', parseInt(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    aria-label={t('exerciseLibrary.ariaRestSeconds', 'Rest seconds')}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Difficulty */}
          <div className="px-4 pt-6">
            <SectionLabel>{t('exerciseLibrary.difficulty', 'Difficulty')}</SectionLabel>
            <DifficultyPicker value={form.difficulty} onChange={(v) => set('difficulty', v)} labels={difficultyLabels} />
          </div>

          {/* Form cues & notes */}
          <div className="px-4 pt-6">
            <SectionLabel optional>{t('exerciseLibrary.formCuesNotes', 'Form cues & notes')}</SectionLabel>
            <div
              className="rounded-[14px]"
              style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(15,20,25,0.03)' }}
            >
              <textarea
                value={form.instructions}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder={t('exerciseLibrary.formCuesPlaceholder', '• Knee tracks over middle toe\n• Brace core before descent\n• Drive through the heel…')}
                rows={4}
                maxLength={400}
                className="w-full bg-transparent border-0 outline-none resize-none p-3.5"
                style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.5, letterSpacing: '-0.1px' }}
              />
              <div className="flex items-center px-3.5 pb-3 text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                <span className="ml-auto">{(form.instructions || '').length}/400</span>
              </div>
            </div>
          </div>

          {/* Share with friends */}
          <div className="px-4 pt-6">
            <div
              className="rounded-[18px] p-4 flex items-center gap-3.5"
              style={{ background: 'var(--color-bg-card)', boxShadow: WARM_SHADOW }}
            >
              <div
                className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0"
                style={{ background: form.shareWithFriends ? ACCENT_SOFT : 'var(--color-surface-hover)' }}
              >
                <Users size={20} strokeWidth={2} style={{ color: form.shareWithFriends ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}>
                  {t('exerciseLibrary.shareWithFriends')}
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {form.shareWithFriends
                    ? t('exerciseLibrary.shareFriendsCanSee', 'Friends can see and use this exercise')
                    : t('exerciseLibrary.shareOnlyYou', 'Only you can see this exercise')}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.shareWithFriends}
                aria-label={t('exerciseLibrary.shareWithFriends')}
                onClick={() => set('shareWithFriends', !form.shareWithFriends)}
                className="relative w-12 h-7 rounded-full transition-colors flex-shrink-0"
                style={{ background: form.shareWithFriends ? 'var(--color-accent)' : 'var(--color-border-subtle)' }}
              >
                <span
                  className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all"
                  style={{ left: form.shareWithFriends ? 22 : 2, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
                />
              </button>
            </div>
          </div>

          {error && <p className="text-[12px] px-4 pt-3 text-red-500">{error}</p>}
        </div>

        {/* Sticky save bar */}
        <div
          className="absolute left-0 right-0 bottom-0 flex gap-2.5 items-center px-4 pt-3"
          style={{
            paddingBottom: 'calc(1.25rem + var(--safe-area-bottom, env(safe-area-inset-bottom)))',
            background: 'linear-gradient(180deg, transparent 0%, var(--color-bg-primary) 40%)',
          }}
        >
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 rounded-full active:scale-[0.98] transition-all"
            style={{
              padding: '16px 18px',
              background: canSave ? 'var(--color-accent)' : 'var(--color-surface-hover)',
              color: canSave ? 'var(--color-text-on-accent, #001512)' : 'var(--color-text-muted)',
              fontFamily: DISPLAY_FONT,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '-0.2px',
              boxShadow: canSave ? '0 8px 20px color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'none',
              border: 'none',
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            <Check size={18} strokeWidth={2.6} />
            {saving ? t('exerciseLibrary.saving') : t('exerciseLibrary.saveExercise')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Edit Exercise Form (used inside the edit modal) ─────────────────────────── */
const EditExerciseForm = ({ exercise, onSave, onCancel }) => {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: exercise.name || '',
    muscle: exercise.muscle || MUSCLE_GROUPS[0],
    equipment: exercise.equipment || EQUIPMENT[0],
    category: exercise.category || CATEGORIES[0],
    defaultSets: String(exercise.defaultSets || 3),
    defaultReps: String(exercise.defaultReps || '8-12'),
    rest: Number.isFinite(exercise.restSeconds) ? exercise.restSeconds : 90,
    difficulty: exercise.difficulty || 'Intermediate',
    instructions: exercise.instructions || '',
    shareWithFriends: !!exercise.shareWithFriends,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mm = String(Math.floor(form.rest / 60));
  const ss = String(form.rest % 60).padStart(2, '0');

  const difficultyLabels = [
    { key: 'Beginner',     label: t('exerciseLibrary.beginner', 'Beginner') },
    { key: 'Intermediate', label: t('exerciseLibrary.intermediate', 'Intermediate') },
    { key: 'Advanced',     label: t('exerciseLibrary.advanced', 'Advanced') },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-[calc(2rem+var(--safe-area-bottom,env(safe-area-inset-bottom)))]">
      <div className="flex flex-col gap-5">
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.exerciseNameLabel')}</label>
          <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('exerciseLibrary.exerciseNamePlaceholder')}
            className="w-full border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-2.5 text-[14px] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[#2EC4C4]/40 transition-all"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DropdownSelect label={t('exerciseLibrary.primaryMuscleLabel')} value={form.muscle} options={MUSCLE_GROUPS} onChange={v => set('muscle', v)} renderOption={(v) => t(`muscleGroups.${v}`, v)} />
          <DropdownSelect label={t('exerciseLibrary.equipmentLabel')} value={form.equipment} options={EQUIPMENT} onChange={v => set('equipment', v)} renderOption={(v) => t(`exerciseLibrary.equipmentNames.${v}`, v)} />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <DropdownSelect label={t('exerciseLibrary.category', 'Category')} value={form.category} options={CATEGORIES} onChange={v => set('category', v)} renderOption={(v) => t(`exerciseLibrary.categoryNames.${v}`, v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.defaultSetsLabel')}</label>
            <input type="number" min="1" max="10" value={form.defaultSets} onChange={e => set('defaultSets', e.target.value)}
              className="w-full border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[#2EC4C4]/40 transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.defaultRepsLabel')}</label>
            <input inputMode="numeric" value={form.defaultReps} onChange={e => set('defaultReps', e.target.value)} placeholder="8-12"
              className="w-full border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-2.5 text-[13px] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[#2EC4C4]/40 transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
          </div>
        </div>

        {/* Rest between sets */}
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('exerciseLibrary.restBetweenSets', 'Rest between sets')}
          </label>
          <div
            className="rounded-[14px] px-4 py-3.5"
            style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)' }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="tabular-nums"
                style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: 'var(--color-text-primary)' }}
              >{mm}:{ss}</span>
              <div className="flex gap-1.5">
                {[60, 90, 120, 180].map((r) => {
                  const sel = form.rest === r;
                  const label = r % 60 === 0 ? `${r / 60}m` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => set('rest', r)}
                      className="rounded-full active:scale-95 transition-all"
                      style={{
                        padding: '5px 9px',
                        border: `1px solid ${sel ? 'transparent' : 'var(--color-border-subtle)'}`,
                        background: sel ? ACCENT_SOFT : 'transparent',
                        color: sel ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >{label}</button>
                  );
                })}
              </div>
            </div>
            <input
              type="range"
              min="30"
              max="240"
              step="15"
              value={form.rest}
              onChange={(e) => set('rest', parseInt(e.target.value))}
              className="w-full mt-3"
              aria-label={t('exerciseLibrary.ariaRestSeconds', 'Rest seconds')}
            />
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('exerciseLibrary.difficulty', 'Difficulty')}
          </label>
          <div className="flex gap-2">
            {difficultyLabels.map(d => {
              const active = form.difficulty === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => set('difficulty', d.key)}
                  className="flex-1 py-2.5 rounded-xl text-[12.5px] transition-all active:scale-[0.98]"
                  style={{
                    background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
                    color: active ? 'var(--color-text-on-accent, #001512)' : 'var(--color-text-subtle)',
                    border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                    fontWeight: active ? 800 : 500,
                  }}
                >{d.label}</button>
              );
            })}
          </div>
        </div>

        {/* Form cues / instructions */}
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('exerciseLibrary.formCuesNotes', 'Form cues & notes')} <span className="normal-case" style={{ color: 'var(--color-text-muted)' }}>({t('exerciseLibrary.optional')})</span>
          </label>
          <textarea
            value={form.instructions}
            onChange={e => set('instructions', e.target.value)}
            placeholder={t('exerciseLibrary.formCuesPlaceholder')}
            rows={4}
            maxLength={400}
            className="w-full border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-2.5 text-[13px] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[#2EC4C4]/40 resize-none transition-all"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
          />
        </div>

        {/* Share with friends toggle */}
        <div
          className="rounded-[16px] p-3.5 flex items-center gap-3"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
        >
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
            style={{ background: form.shareWithFriends ? ACCENT_SOFT : 'var(--color-surface-hover)' }}
          >
            <Users size={18} strokeWidth={2} style={{ color: form.shareWithFriends ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {t('exerciseLibrary.shareWithFriends')}
            </div>
            <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {form.shareWithFriends
                ? t('exerciseLibrary.shareFriendsCanSee', 'Friends can see and use this exercise')
                : t('exerciseLibrary.shareOnlyYou', 'Only you can see this exercise')}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.shareWithFriends}
            aria-label={t('exerciseLibrary.shareWithFriends')}
            onClick={() => set('shareWithFriends', !form.shareWithFriends)}
            className="relative w-11 h-[26px] rounded-full transition-colors flex-shrink-0"
            style={{ background: form.shareWithFriends ? 'var(--color-accent)' : 'var(--color-border-subtle)' }}
          >
            <span
              className="absolute top-0.5 w-[22px] h-[22px] rounded-full bg-white transition-all"
              style={{ left: form.shareWithFriends ? 21 : 2, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
            />
          </button>
        </div>

        {error && <p className="text-[12px] text-red-400">{error}</p>}
        <button
          onClick={async () => {
            if (!form.name.trim()) { setError(t('exerciseLibrary.nameRequired')); return; }
            setSaving(true); setError('');
            try {
              const result = await onSave(exercise, form);
              if (result?.error) setError(result.error);
            } catch (err) {
              setError(err?.message || t('common:somethingWentWrong', 'Something went wrong'));
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || !form.name.trim()}
          className="w-full py-3.5 rounded-full font-bold text-[14px] text-[var(--color-text-on-accent,#fff)] disabled:opacity-50 active:scale-[0.98] transition-all mt-2"
            style={{ background: 'var(--color-accent, #2EC4C4)' }}
        >
          {saving ? t('exerciseLibrary.saving') : t('exerciseLibrary.saveChanges')}
        </button>
      </div>
    </div>
  );
};

/* ── Full-page wrapper ──────────────────────────────────────────────────────── */
export const ExerciseLibraryPage = () => {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const posthog = usePostHog();
  const [tab, setTab]               = useState('all');
  const [customExercises, setCustom] = useState([]);
  const [globalDbExercises, setGlobalDb] = useState([]);
  const [savedIds, setSavedIds]      = useState(new Set());
  const [friendIds, setFriendIds]    = useState(new Set());
  const [loading, setLoading]        = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [editingExercise, setEditingExercise] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeChip, setActiveChip] = useState('all');
  const [draft, setDraft] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterMuscle, setFilterMuscle] = useState('All');
  const [filterEquipment, setFilterEquipment] = useState('All');
  const [sortBy, setSortBy] = useState('name-asc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [recentExerciseIds, setRecentExerciseIds] = useState(new Set());
  const sortMenuRef = useRef(null);
  // Exercise tapped from the muscle sheet — opens the same detail modal
  // ExerciseCard uses, via a phantom card in modalOnly mode.
  const [sheetExercise, setSheetExercise] = useState(null);
  const [pickedBucket, setPickedBucket] = useState(null);
  const [expandToGroup, setExpandToGroup] = useState(false);
  // Set when a muscle-based chip (push/pull/legs/core) opens the sheet
  // with a custom region set; null otherwise.
  const [chipSheet, setChipSheet] = useState(null); // { regions, label }
  // Fullscreen "browse all" modal opened by tapping the search bar.
  const [showAllExercises, setShowAllExercises] = useState(false);

  // Close sort menu on outside click
  useEffect(() => {
    if (!showSortMenu) return;
    const fn = (e) => { if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) setShowSortMenu(false); };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, [showSortMenu]);

  // Lock body scroll when filter modal is open
  useEffect(() => {
    if (!showFilters) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showFilters]);

  // Lock background scroll for the full-screen Edit Exercise modal (its own
  // form doesn't lock, unlike Add). Filter modal is handled above; the Add
  // modal + ExerciseCard detail modal lock themselves.
  useScrollLock(!!editingExercise);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Pick up draft banner — reads exercise_draft from localStorage if present
  useEffect(() => {
    try {
      const raw = localStorage.getItem('exercise_draft');
      if (raw) setDraft(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [showAddModal]);

  useEffect(() => { document.title = `${t('exerciseLibrary.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const load = useCallback(async () => {
    if (!user || !profile) return;
    setLoading(true);

    try {
      // Fetch global exercises
      const [globalsRes, customsRes, savedRes, fshipsRes, favsRes] = await Promise.all([
        supabase.from('exercises').select('id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, created_by').is('gym_id', null).eq('is_active', true),
        profile.gym_id
          ? supabase.from('exercises').select('id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, created_by').eq('gym_id', profile.gym_id).eq('is_active', true)
          : Promise.resolve({ data: [] }),
        supabase.from('user_saved_exercises').select('exercise_id').eq('user_id', user.id),
        // SECURITY: user.id comes from supabase.auth context, not user input.
        // Validate UUID format as a defense-in-depth measure before interpolating into .or() filter.
        (/^[0-9a-f-]{36}$/i.test(user.id)
          ? supabase.from('friendships')
              .select('requester_id, addressee_id, status')
              .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
              .eq('status', 'accepted')
          : Promise.resolve({ data: [] })),
        supabase.from('exercise_favorites').select('exercise_id').eq('user_id', user.id),
      ]);

      const globals = globalsRes.data ?? [];
      const customs = customsRes.data ?? [];
      const saved   = savedRes.data ?? [];
      const fships  = fshipsRes.data ?? [];
      const favs    = favsRes.data ?? [];

      const fIds = new Set(fships.map(f =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      ));
      setFavoriteIds(new Set(favs.map(f => f.exercise_id)));

      // Separately fetch profile names for custom exercises that have a created_by
      const creatorIds = [...new Set(customs.map(e => e.created_by).filter(Boolean))];
      let profileMap = {};
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('gym_member_profiles_safe')
          .select('id, full_name, username')
          .in('id', creatorIds);
        profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));
      }

      const customNormalized = customs.map(row => ({
        ...normalizeDbExercise(row),
        createdByName: profileMap[row.created_by]?.full_name,
        createdByUsername: profileMap[row.created_by]?.username,
      }));
      const globalNormalized = globals.map(normalizeDbExercise);

      setCustom(customNormalized);
      setGlobalDb(globalNormalized);
      setSavedIds(new Set(saved.map(s => s.exercise_id)));
      setFriendIds(fIds);
    } catch (err) {
      logger.error('ExerciseLibrary load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, profile]);

  useEffect(() => { load(); }, [load]);

  // Load exercises the user has logged in the last 30 days (powers the "Recent" chip).
  // Falls back to favorites + saved exercises so the chip still surfaces something
  // useful for new users that haven't completed any sessions yet.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      // Prefer the server-side distinct-id RPC (one small result set) over
      // pulling 30d of sessions WITH nested session_exercises→session_sets
      // just to flatten to a Set of ids.
      const { data, error } = await supabase.rpc('get_recent_exercise_ids', { p_profile_id: user.id, p_days: 30 });
      if (!error) {
        if (!cancelled) setRecentExerciseIds(new Set((data || []).map(r => r.exercise_id).filter(Boolean)));
        return;
      }
      // Fallback (e.g. RPC not deployed yet): the original nested pull. Same
      // predicate as the RPC (is_completed is NOT NULL, so !== false == true).
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: fb, error: fbErr } = await supabase
        .from('workout_sessions')
        .select('id, completed_at, session_exercises(exercise_id, session_sets(is_completed))')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .gte('completed_at', since);
      const ids = new Set();
      if (fbErr) {
        logger.error('Recent sessions load error:', fbErr);
      } else {
        (fb || []).forEach(s => {
          (s.session_exercises || []).forEach(se => {
            const completedAny = (se.session_sets || []).some(set => set?.is_completed !== false);
            if (se?.exercise_id && completedAny) ids.add(se.exercise_id);
          });
        });
      }
      if (!cancelled) setRecentExerciseIds(ids);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Hung-write guard: WKWebView fetches can pend FOREVER on a zombie socket
  // after an app resume — neither resolving nor rejecting (the auth boot path
  // already has watchdogs for exactly this). Without a timeout the save
  // button spins "Saving…" indefinitely. Abort after 20s so the user gets a
  // visible, retryable error instead.
  const SAVE_TIMEOUT_MS = 20000;
  const saveTimeoutGuard = () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
    return { signal: ctrl.signal, done: () => clearTimeout(timer) };
  };
  const timeoutMessage = () =>
    t('exerciseLibrary.saveTimeout', "The server didn't respond. Check your connection and try again.");

  const handleCreateExercise = async (form) => {
    if (!user?.id || !profile?.gym_id) {
      return { error: t('exerciseLibrary.notReady', 'Profile not ready, try again in a moment.') };
    }

    // The Postgres enums for muscle_group / equipment / category don't include
    // every option the local JS list exposes (Cardio category, Cardio Machine
    // equipment, etc.). Map / drop the front-end-only values to the closest
    // valid enum so the INSERT doesn't fail with an opaque "Load failed".
    const VALID_MUSCLES = new Set(['Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core','Calves','Forearms','Traps','Full Body','Warm-Up']);
    const VALID_EQUIPMENT = new Set(['Barbell','Dumbbell','Cable','Machine','Bodyweight','Kettlebell','Resistance Band','Smith Machine','EZ Bar']);
    const VALID_CATEGORY = new Set(['Strength','Hypertrophy','Power','Endurance','Mobility']);

    const muscle    = VALID_MUSCLES.has(form.muscle) ? form.muscle : 'Full Body';
    const equipment = VALID_EQUIPMENT.has(form.equipment) ? form.equipment : 'Bodyweight';
    const category  = VALID_CATEGORY.has(form.category) ? form.category : 'Strength';

    const restSeconds = Number.isFinite(parseInt(form.rest, 10)) ? parseInt(form.rest, 10) : 90;
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let error;
    const guard = saveTimeoutGuard();
    try {
      ({ error } = await supabase
        .from('exercises')
        .insert({
          id,
          gym_id:       profile.gym_id,
          created_by:   user.id,
          name:         form.name,
          muscle_group: muscle,
          equipment,
          category,
          default_sets: form.defaultSets,
          default_reps: form.defaultReps,
          rest_seconds: restSeconds,
          instructions: form.instructions || null,
          primary_regions:   Array.isArray(form.primaryRegions)   ? form.primaryRegions   : null,
          secondary_regions: Array.isArray(form.secondaryRegions) ? form.secondaryRegions : null,
          is_active:    true,
        })
        .abortSignal(guard.signal));
    } catch (err) {
      // iOS WebKit surfaces network-layer fetch failures as TypeError "Load
      // failed"; our 20s watchdog surfaces hung sockets as AbortError.
      logger.error('Create exercise threw:', err);
      const aborted = err?.name === 'AbortError' || /abort/i.test(String(err?.message || ''));
      return { error: aborted ? timeoutMessage() : (err?.message || 'Network error — please try again.') };
    } finally {
      guard.done();
    }

    if (error) {
      logger.error('Create exercise error:', error);
      const aborted = String(error.code || '') === '20' || /abort/i.test(String(error.message || ''));
      if (aborted) return { error: timeoutMessage() };
      // Include the PG code — when a member screenshots the error we can
      // identify the exact server rejection (RLS vs enum vs constraint).
      const base = error.message || error.hint || 'Failed to save exercise';
      return { error: error.code ? `${base} (${error.code})` : base };
    }

    posthog?.capture('custom_exercise_created');
    // Don't block on the bookmark write — the exercise itself is already saved.
    supabase.from('user_saved_exercises').insert({ user_id: user.id, exercise_id: id })
      .then(({ error: saveErr }) => { if (saveErr) logger.error('Save bookmark failed:', saveErr); });

    const normalized = {
      id,
      name:              form.name,
      muscle,
      equipment,
      category,
      defaultSets:       form.defaultSets,
      defaultReps:       form.defaultReps,
      restSeconds,
      instructions:      form.instructions ?? '',
      primaryRegions:    Array.isArray(form.primaryRegions)   ? form.primaryRegions   : [],
      secondaryRegions:  Array.isArray(form.secondaryRegions) ? form.secondaryRegions : [],
      createdBy:         user.id,
      createdByName:     profile.full_name,
      createdByUsername:  profile.username,
      isCustom:          true,
    };

    setCustom(prev => [...prev, normalized]);
    setSavedIds(prev => new Set([...prev, id]));
    setShowAddModal(false);
    return {};
  };

  const handleSave = async (exerciseId) => {
    setSavedIds(prev => new Set([...prev, exerciseId]));
    await supabase.from('user_saved_exercises').insert({ user_id: user.id, exercise_id: exerciseId });
  };

  const handleUnsave = async (exerciseId) => {
    setSavedIds(prev => { const s = new Set(prev); s.delete(exerciseId); return s; });
    await supabase.from('user_saved_exercises').delete().eq('user_id', user.id).eq('exercise_id', exerciseId);
  };

  const handleDeleteExercise = async (exerciseId) => {
    if (!confirm(t('exerciseLibrary.deleteConfirm'))) return;
    const { error } = await supabase
      .from('exercises')
      .update({ is_active: false })
      .eq('id', exerciseId)
      .eq('created_by', user.id);
    if (error) {
      alert(t('exerciseLibrary.deleteError', 'Failed to delete exercise. Please try again.'));
      return;
    }
    setCustom(prev => prev.filter(e => e.id !== exerciseId));
    setSavedIds(prev => { const s = new Set(prev); s.delete(exerciseId); return s; });
  };

  const handleToggleFavorite = async (exerciseId) => {
    if (favoriteIds.has(exerciseId)) {
      setFavoriteIds(prev => { const s = new Set(prev); s.delete(exerciseId); return s; });
      await supabase.from('exercise_favorites').delete().eq('user_id', user.id).eq('exercise_id', exerciseId);
    } else {
      setFavoriteIds(prev => new Set([...prev, exerciseId]));
      await supabase.from('exercise_favorites').insert({ user_id: user.id, exercise_id: exerciseId });
    }
  };

  const handleEditExercise = async (exercise, updates) => {
    const restSeconds = Number.isFinite(parseInt(updates.rest, 10)) ? parseInt(updates.rest, 10) : 90;
    // Postgres enums for category are stricter than the local JS list — drop
    // unsupported values to the closest valid enum so the UPDATE doesn't fail.
    const VALID_CATEGORY = new Set(['Strength', 'Hypertrophy', 'Power', 'Endurance', 'Mobility']);
    const category = VALID_CATEGORY.has(updates.category) ? updates.category : (exercise.category || 'Strength');
    let error;
    const guard = saveTimeoutGuard();
    try {
      ({ error } = await supabase.from('exercises').update({
        name: updates.name,
        muscle_group: updates.muscle,
        equipment: updates.equipment,
        category,
        default_sets: parseInt(updates.defaultSets) || 3,
        default_reps: updates.defaultReps,
        rest_seconds: restSeconds,
        instructions: updates.instructions || null,
      }).eq('id', exercise.id).abortSignal(guard.signal));
    } catch (err) {
      logger.error('Edit exercise threw:', err);
      const aborted = err?.name === 'AbortError' || /abort/i.test(String(err?.message || ''));
      return { error: aborted ? timeoutMessage() : (err?.message || 'Network error — please try again.') };
    } finally {
      guard.done();
    }
    if (error) { logger.error('Edit exercise error:', error); return { error: error.code ? `${error.message} (${error.code})` : error.message }; }
    setCustom(prev => prev.map(e => e.id === exercise.id ? {
      ...e,
      name: updates.name,
      muscle: updates.muscle,
      equipment: updates.equipment,
      category,
      defaultSets: parseInt(updates.defaultSets) || 3,
      defaultReps: updates.defaultReps,
      restSeconds,
      difficulty: updates.difficulty,
      instructions: updates.instructions || '',
      shareWithFriends: !!updates.shareWithFriends,
    } : e));
    setEditingExercise(null);
    return {};
  };

  const mineExercises   = useMemo(() => customExercises.filter(e => e.createdBy === user?.id || savedIds.has(e.id)), [customExercises, user?.id, savedIds]);
  const friendExercises = useMemo(() => customExercises.filter(e => friendIds.has(e.createdBy) && !savedIds.has(e.id)), [customExercises, friendIds, savedIds]);
  const extraForAll     = useMemo(() => [...globalDbExercises, ...customExercises], [globalDbExercises, customExercises]);

  // Deduplicated count: locals not in DB + all DB exercises
  const { dbIds, totalCount } = useMemo(() => {
    const ids = new Set([...globalDbExercises, ...customExercises].map(e => e.id));
    return { dbIds: ids, totalCount: localExercises.filter(e => !ids.has(e.id)).length + ids.size };
  }, [globalDbExercises, customExercises]);

  const tabs = [
    { key: 'all',     label: t('exerciseLibrary.tabAll'),     count: totalCount },
    { key: 'mine',    label: t('exerciseLibrary.tabMine'),    count: mineExercises.length || null },
    { key: 'friends', label: t('exerciseLibrary.tabFriends'), count: friendExercises.length || null },
  ];

  // Chip filters map to muscle category + custom keys. On the main page
  // we only show the chips that visually do something — i.e. the ones
  // that paint a region on the body picker. Recent / Mobility / HIIT
  // only filter the list, so they're stashed into the search-modal-only
  // set (rendered inside AllExercisesModal).
  const chipDefs = [
    { id: 'all',   label: t('exerciseLibrary.filterAll', 'All') },
    { id: 'push',  label: `↑ ${t('exerciseLibrary.filterPush', 'Push')}` },
    { id: 'pull',  label: `↓ ${t('exerciseLibrary.filterPull', 'Pull')}` },
    { id: 'chest', label: t('muscleGroups.Chest', 'Chest') },
    { id: 'back',  label: t('muscleGroups.Back', 'Back') },
    { id: 'arms',  label: t('exerciseLibrary.filterArms', 'Arms') },
    { id: 'legs',  label: t('muscleGroups.Legs', 'Legs') },
    { id: 'core',  label: t('muscleGroups.Core', 'Core') },
  ];
  // Extended set used only inside the AllExercisesModal search page —
  // adds the list-only filters (Recent / Mobility / HIIT) that have no
  // visual representation on the trainer figure.
  const modalChipDefs = [
    ...chipDefs,
    { id: 'recent',   label: t('exerciseLibrary.filterRecent', 'Recent') },
    { id: 'mobility', label: t('exerciseLibrary.filterMobility', 'Mobility') },
    { id: 'hiit',     label: t('exerciseLibrary.filterHIIT', 'HIIT') },
  ];

  const lang = (typeof window !== 'undefined' && (window.localStorage.getItem('i18nextLng') || '')).startsWith('es') ? 'es' : 'en';

  // Flattened list for the current tab
  const activeList = useMemo(() => {
    if (tab === 'mine') return mineExercises.map(e => ({ ...e, isMine: e.createdBy === user?.id }));
    if (tab === 'friends') return friendExercises;
    // all — combine local + global + custom. When a DB row shadows a local
    // exercise, merge non-empty local fields back in: the local catalog is
    // the authoritative source for muscleScores / primaryRegions / video,
    // which the DB rows don't carry.
    const localById = Object.fromEntries(localExercises.map(e => [e.id, e]));
    const uniqueLocal = localExercises.filter(e => !dbIds.has(e.id));
    const dbFallback = [...globalDbExercises, ...customExercises].map((e) => {
      const local = localById[e.id];
      if (!local) return e;
      const dbPrim = Array.isArray(e.primaryRegions)   ? e.primaryRegions   : [];
      const dbSec  = Array.isArray(e.secondaryRegions) ? e.secondaryRegions : [];
      return {
        ...e,
        videoUrl:        e.videoUrl        || local.videoUrl,
        muscleScores:    e.muscleScores    || local.muscleScores,
        primaryRegions:   dbPrim.length > 0 ? dbPrim : (local.primaryRegions   || []),
        secondaryRegions: dbSec.length  > 0 ? dbSec  : (local.secondaryRegions || []),
      };
    });
    return [...uniqueLocal, ...dbFallback];
  }, [tab, mineExercises, friendExercises, globalDbExercises, customExercises, dbIds, user?.id]);

  // Apply search + chip + advanced filters + sort
  const filteredRows = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    const filtered = activeList.filter((e) => {
      if (q) {
        const hay = `${e.name} ${e.name_es || ''} ${e.muscle} ${e.equipment}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterMuscle !== 'All' && e.muscle !== filterMuscle) return false;
      if (filterEquipment !== 'All' && e.equipment !== filterEquipment) return false;
      if (activeChip === 'all') return true;
      if (activeChip === 'recent') {
        // Fall back to favorites when no recent session data exists yet so the
        // chip still renders meaningful results (and doesn't appear "broken").
        if (recentExerciseIds.size > 0) return recentExerciseIds.has(e.id);
        return favoriteIds.has(e.id);
      }
      const m = (e.muscle || '').toLowerCase();
      const cat = (e.category || '').toLowerCase();
      if (activeChip === 'legs')     return m === 'legs' || m === 'quads' || m === 'hamstrings' || m === 'glutes' || m === 'calves';
      if (activeChip === 'core')     return m === 'core' || m === 'abs';
      if (activeChip === 'push')     return m === 'chest' || m === 'shoulders' || m === 'triceps';
      if (activeChip === 'pull')     return m === 'back' || m === 'lats' || m === 'biceps' || m === 'traps';
      if (activeChip === 'chest')    return m === 'chest';
      if (activeChip === 'back')     return m === 'back' || m === 'lats' || m === 'traps';
      if (activeChip === 'arms')     return m === 'biceps' || m === 'triceps' || m === 'forearms';
      if (activeChip === 'mobility') return cat.includes('mobility') || cat.includes('stretch');
      if (activeChip === 'hiit')     return cat.includes('hiit') || cat.includes('cardio');
      return true;
    });
    const arr = [...filtered];
    switch (sortBy) {
      case 'name-asc':  return arr.sort((a, b) => exName(a).localeCompare(exName(b)));
      case 'name-desc': return arr.sort((a, b) => exName(b).localeCompare(exName(a)));
      case 'muscle':    return arr.sort((a, b) => (a.muscle || '').localeCompare(b.muscle || '') || exName(a).localeCompare(exName(b)));
      case 'equipment': return arr.sort((a, b) => (a.equipment || '').localeCompare(b.equipment || '') || exName(a).localeCompare(exName(b)));
      default:          return arr;
    }
  }, [activeList, debouncedQuery, activeChip, filterMuscle, filterEquipment, sortBy, recentExerciseIds, favoriteIds]);

  const activeFilterCount = (filterMuscle !== 'All' ? 1 : 0) + (filterEquipment !== 'All' ? 1 : 0);

  // Chip click router: muscle-based chips only paint the body picker —
  // the user opens the grouped sheet manually via the "See N exercises"
  // CTA underneath. Non-muscle chips (recent/mobility/hiit) open the All
  // Exercises modal pre-filtered to that chip.
  const handleChipTap = useCallback((chipId) => {
    setActiveChip(chipId);
    setChipSheet(null);
    if (chipId === 'all') {
      setShowAllExercises(false);
      return;
    }
    if (CHIP_REGIONS[chipId]) {
      // Muscle chip → just paint, do not auto-open the sheet.
      return;
    }
    // recent / mobility / hiit → open all-exercises modal with this chip active
    setShowAllExercises(true);
  }, []);

  // Opens the grouped multi-muscle sheet for the currently-active chip.
  // Used by the CTA under the body picker.
  const openChipSheet = useCallback(() => {
    if (!CHIP_REGIONS[activeChip]) return;
    setChipSheet({
      regions: CHIP_REGIONS[activeChip],
      label: chipDefs.find((c) => c.id === activeChip)?.label || activeChip,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChip]);

  // Regions currently painted on the body picker. Chip overrides any
  // bucket selection so the user sees what category they're filtering.
  const paintedRegions = useMemo(() => {
    if (CHIP_REGIONS[activeChip]) return CHIP_REGIONS[activeChip];
    return null;
  }, [activeChip]);

  // Body-mode source list: same `activeList` (respects current tab —
  // All / Mine / Friends) and search + equipment, but ignores the
  // chip + muscle pill. In body view, the polygon IS the muscle selector.
  const bodyModeExercises = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    return activeList.filter((e) => {
      if (q) {
        const hay = `${e.name} ${e.name_es || ''} ${e.muscle} ${e.equipment}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterEquipment !== 'All' && e.equipment !== filterEquipment) return false;
      return true;
    });
  }, [activeList, debouncedQuery, filterEquipment]);

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 md:px-8 pt-5 md:pt-10 pb-28 md:pb-12 animate-fade-in">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {/* Tour anchor sits on the header (not the page wrapper) so the
          spotlight rect is a small, top-of-page region instead of the entire
          viewport — that was making the tooltip fall back to an off-screen
          position above the header. */}
      <header className="mb-3.5" data-tour="tour-exercise-library">
        <button
          onClick={() => navigate('/workouts')}
          className="flex items-center gap-1 -ml-1 mb-2 min-h-[40px] text-[14px] font-bold active:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label={t('exerciseLibrary.backToWorkouts', 'Back to Entrenos')}
        >
          <ChevronLeft size={20} />
          {t('workouts.title', 'Entrenos')}
        </button>
        <div className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--color-accent)' }}>
          {t('exerciseLibrary.yourArsenal', 'YOUR ARSENAL')} · {totalCount} {t('exerciseLibrary.moves', 'MOVES')}
        </div>
        <div className="mt-1.5 flex items-end justify-between gap-3">
          <h1
            className="truncate"
            style={{ fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 900, letterSpacing: '-1.1px', lineHeight: 1.02, color: 'var(--color-text-primary)' }}
          >
            {t('exerciseLibrary.title')}
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1 px-3.5 py-2.5 rounded-full active:scale-95 transition-all whitespace-nowrap"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-on-accent, #fff)',
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: '-0.1px',
                boxShadow: '0 6px 16px color-mix(in srgb, var(--color-accent) 28%, transparent)',
                border: 'none',
              }}
            >
              <Plus size={15} strokeWidth={2.6} /> {t('exerciseLibrary.new', 'New')}
            </button>
          </div>
        </div>

      </header>

      {/* ── Tab Segmented ───────────────────────────────────────────────────── */}
      <div
        className="flex gap-0.5 mb-3 rounded-[12px] p-1"
        style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
      >
        {tabs.map((x) => {
          const active = tab === x.key;
          return (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className="flex-1 py-2 rounded-[9px] transition-all inline-flex items-center justify-center gap-1.5"
              style={{
                background: active ? 'var(--color-bg-card)' : 'transparent',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                fontSize: 12,
                fontWeight: active ? 800 : 600,
                letterSpacing: '-0.1px',
                boxShadow: active ? '0 1px 2px rgba(15,20,25,0.05)' : 'none',
                border: 'none',
              }}
            >
              {x.label}
              {x.count != null && (
                <span
                  className="text-[9px] font-extrabold"
                  style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)', letterSpacing: '0.3px' }}
                >{x.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Search bar — tappable trigger that opens the fullscreen
          AllExercisesModal. The actual input lives inside the modal. */}
      <button
        type="button"
        onClick={() => setShowAllExercises(true)}
        className="mb-3 w-full flex items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-left active:scale-[0.99] transition-transform"
        style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(15,20,25,0.03)' }}
      >
        <Search size={16} strokeWidth={2} style={{ color: 'var(--color-text-subtle)' }} />
        <span
          className="flex-1 truncate"
          style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-muted)', letterSpacing: '-0.2px' }}
        >
          {t('exerciseLibrary.searchPlaceholder', 'Search exercises, muscles, gear…')}
        </span>
      </button>

      {/* ── Filter chips (scrollable) — tap to highlight muscles + open sheet,
          or open the All Exercises modal for non-muscle chips. */}
      <div className="mb-3 -mx-4 px-4 overflow-x-auto no-scrollbar">
        <div className="flex gap-1.5 whitespace-nowrap">
          {chipDefs.map((c) => (
            <FilterChip key={c.id} active={c.id === activeChip} onClick={() => handleChipTap(c.id)}>
              {c.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* ── Draft banner ────────────────────────────────────────────────────── */}
      {draft && (
        <div className="mb-3">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-2" style={{ color: 'var(--color-text-subtle)' }}>
            {t('exerciseLibrary.pickUpWhereLeftOff', 'PICK UP WHERE YOU LEFT OFF')}
          </div>
          <div
            className="rounded-[18px] p-3.5 flex items-center gap-3 cursor-pointer"
            style={{
              background: `linear-gradient(135deg, ${ACCENT_SOFT} 0%, color-mix(in srgb, var(--color-accent) 4%, transparent) 100%)`,
              border: '1.5px dashed var(--color-accent)',
            }}
            onClick={() => setShowAddModal(true)}
          >
            <div
              className="w-[46px] h-[46px] rounded-[12px] flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-bg-card)', border: '1.5px dashed var(--color-accent)' }}
            >
              <Edit3 size={18} strokeWidth={2.2} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--color-accent)' }}>
                {t('exerciseLibrary.draftUnfinished', 'DRAFT · UNFINISHED')}
              </div>
              <div
                className="mt-0.5 truncate"
                style={{ fontFamily: DISPLAY_FONT, fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--color-text-primary)' }}
              >{draft.name || t('exerciseLibrary.untitledDraft', 'Untitled exercise')}</div>
              <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                {draft.primary || draft.muscle || '—'}{draft.saved ? ` · ${t('exerciseLibrary.saved', 'saved')} ${draft.saved}` : ''}
              </div>
            </div>
            <button
              className="px-3 py-2 rounded-full text-[11px] font-extrabold active:scale-95 transition-all"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)', letterSpacing: '-0.1px', border: 'none' }}
            >
              {t('exerciseLibrary.resume', 'Resume')}
            </button>
          </div>
        </div>
      )}

      {/* ── Section label + sort ────────────────────────────────────────────── */}
      <div className="mt-4 mb-2.5 flex items-center justify-between gap-3">
        {tab === 'all' && CHIP_REGIONS[activeChip] ? (
          <button
            type="button"
            onClick={openChipSheet}
            className="text-[11px] font-extrabold uppercase tracking-[0.08em] min-w-0 truncate inline-flex items-center gap-1.5 active:opacity-70"
            style={{ color: 'var(--color-accent)' }}
          >
            {t('exerciseLibrary.seeAllInFilter', {
              filter: chipDefs.find((c) => c.id === activeChip)?.label || activeChip,
              defaultValue: `Ver todo ${chipDefs.find((c) => c.id === activeChip)?.label || activeChip}`,
            })}
            <ChevronRight size={12} strokeWidth={2.4} />
          </button>
        ) : (
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] min-w-0 truncate" style={{ color: 'var(--color-text-subtle)' }}>
            {tab === 'all'
              ? t('exerciseLibrary.tapMuscle', { defaultValue: 'Toca un músculo' }).toUpperCase()
              : t('exerciseLibrary.exerciseCount', { count: filteredRows.length, defaultValue: '{{count}} exercises' })}
          </span>
        )}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div ref={sortMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setShowSortMenu(s => !s)}
            aria-label={t('exerciseLibrary.sort', 'Sort')}
            className="inline-flex items-center gap-1 bg-transparent active:scale-95 transition-all"
            style={{ color: 'var(--color-text-subtle)', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', border: 'none' }}
          >
            <ArrowUpDown size={11} strokeWidth={2.2} />
            {t(`exerciseLibrary.sortLabels.${sortBy}`, 'SORT').toUpperCase()}
          </button>
          {showSortMenu && (
            <div
              className="absolute right-0 top-full mt-1.5 w-44 rounded-xl overflow-hidden z-30"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
              }}
            >
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => { setSortBy(opt.key); setShowSortMenu(false); }}
                  className="w-full px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                  style={{ color: sortBy === opt.key ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                >
                  {t(`exerciseLibrary.sortOptions.${opt.i18nKey}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Tab Content — All tab is body-only now (list view removed). */}
      {tab === 'all' && (
        <div className="mb-4">
          <BodyMusclePicker
            selected={pickedBucket}
            onSelect={(bucketId) => { setExpandToGroup(false); setPickedBucket(bucketId); }}
            maxWidth={420}
            highlightedRegions={paintedRegions}
          />
        </div>
      )}

      {/* Single-muscle sheet (tapping a polygon) */}
      <MuscleExercisesSheet
        open={tab === 'all' && !!pickedBucket}
        bucketId={pickedBucket}
        expandToGroup={expandToGroup}
        exercises={bodyModeExercises}
        onClose={() => { setPickedBucket(null); setExpandToGroup(false); }}
        onToggleExpand={setExpandToGroup}
        onExerciseTap={(ex) => setSheetExercise(ex)}
      />

      {/* Chip-driven multi-muscle sheet (Push/Pull/Legs/Core) */}
      <MuscleExercisesSheet
        open={tab === 'all' && !!chipSheet}
        customRegions={chipSheet?.regions}
        customLabel={chipSheet?.label}
        exercises={bodyModeExercises}
        onClose={() => setChipSheet(null)}
        onExerciseTap={(ex) => setSheetExercise(ex)}
      />

      {/* Full "Browse All" modal — opened by tapping the search bar or
          a non-muscle chip (Recent / Mobility / HIIT). */}
      <AllExercisesModal
        open={showAllExercises}
        onClose={() => setShowAllExercises(false)}
        exercises={bodyModeExercises}
        onExerciseTap={(ex) => setSheetExercise(ex)}
        initialSearch=""
        initialChip={activeChip}
        chipDefs={modalChipDefs}
        filterByChip={(ex, chipId) => {
          const m = (ex.muscle || '').toLowerCase();
          const cat = (ex.category || '').toLowerCase();
          if (chipId === 'recent') {
            if (recentExerciseIds.size > 0) return recentExerciseIds.has(ex.id);
            return favoriteIds.has(ex.id);
          }
          if (chipId === 'legs')     return m === 'legs' || m === 'quads' || m === 'hamstrings' || m === 'glutes' || m === 'calves';
          if (chipId === 'core')     return m === 'core' || m === 'abs';
          if (chipId === 'push')     return m === 'chest' || m === 'shoulders' || m === 'triceps';
          if (chipId === 'pull')     return m === 'back' || m === 'lats' || m === 'biceps' || m === 'traps';
          if (chipId === 'chest')    return m === 'chest';
          if (chipId === 'back')     return m === 'back' || m === 'lats' || m === 'traps';
          if (chipId === 'arms')     return m === 'biceps' || m === 'triceps' || m === 'forearms';
          if (chipId === 'mobility') return cat.includes('mobility') || cat.includes('stretch');
          if (chipId === 'hiit')     return cat.includes('hiit') || cat.includes('cardio');
          return true;
        }}
      />

      {/* Phantom ExerciseCard rendered in modal-only mode — surfaces the
          exact same detail card the list view uses when a user taps a
          video-bg tile inside the muscle sheet. */}
      {sheetExercise && (
        <ExerciseCard
          exercise={sheetExercise}
          modalOnly
          initiallyOpen
          isFavorite={favoriteIds.has(sheetExercise.id)}
          onToggleFavorite={handleToggleFavorite}
          onExternalClose={() => setSheetExercise(null)}
        />
      )}

      {/* Mine tab */}
      {tab === 'mine' && !loading && (
        mineExercises.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
              <Dumbbell size={28} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="font-semibold text-[16px] text-[var(--color-text-primary)]">{t('exerciseLibrary.noCustomYet')}</p>
            <p className="text-[13px] mt-1.5 text-[var(--color-text-muted)]">
              {t('exerciseLibrary.noCustomHint')}
            </p>
            <button onClick={() => setShowAddModal(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-bold active:scale-95 transition-all text-[var(--color-text-on-accent,#fff)]"
              style={{ background: 'var(--color-accent, #2EC4C4)' }}>
              <Plus size={14} /> {t('exerciseLibrary.newExercise')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {mineExercises.map(ex => {
              const ownedByMe = ex.createdBy === user?.id;
              return (
                <ExerciseCard
                  key={ex.id}
                  exercise={ex}
                  selectable={false}
                  isFavorite={favoriteIds.has(ex.id)}
                  onToggleFavorite={handleToggleFavorite}
                  isMine={ownedByMe}
                  isSaved={!ownedByMe}
                  onEdit={ownedByMe ? (e) => setEditingExercise(e) : undefined}
                  onDelete={ownedByMe ? handleDeleteExercise : undefined}
                  onUnsave={!ownedByMe ? () => handleUnsave(ex.id) : undefined}
                />
              );
            })}
          </div>
        )
      )}

      {/* Friends tab */}
      {tab === 'friends' && !loading && (
        friendExercises.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
              <Users size={28} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="font-semibold text-[16px] text-[var(--color-text-primary)]">{t('exerciseLibrary.noFriendExercises')}</p>
            <p className="text-[13px] mt-1.5 text-[var(--color-text-muted)]">
              {t('exerciseLibrary.noFriendExercisesHint')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {friendExercises.map(ex => (
              <ExerciseCard
                key={ex.id}
                exercise={ex}
                selectable={false}
                isFavorite={favoriteIds.has(ex.id)}
                onToggleFavorite={handleToggleFavorite}
                isMine={false}
                isSaved={savedIds.has(ex.id)}
                onSave={() => handleSave(ex.id)}
                onUnsave={() => handleUnsave(ex.id)}
              />
            ))}
          </div>
        )
      )}

      {showAddModal && createPortal(
        <AddExerciseModal onSave={handleCreateExercise} onClose={() => setShowAddModal(false)} />,
        document.body
      )}

      {/* Edit Exercise Modal */}
      {editingExercise && createPortal(
        <div className="fixed inset-0 z-[110] flex flex-col animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>
          <header className="flex-shrink-0 px-5 pb-3 border-b border-[var(--color-border-subtle)] flex items-center gap-3" style={{ paddingTop: 'max(0.875rem, var(--safe-area-top, env(safe-area-inset-top)))', background: 'var(--color-bg-primary)' }}>
            <button onClick={() => setEditingExercise(null)} aria-label={t('exerciseLibrary.ariaClose', 'Close')} className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors" style={{ background: 'var(--color-surface-hover)' }}>
              <X size={18} style={{ color: 'var(--color-text-muted)' }} />
            </button>
            <h2 className="text-[18px] truncate" style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text-primary)' }}>{t('exerciseLibrary.editExercise')}</h2>
          </header>
          <EditExerciseForm exercise={editingExercise} onSave={handleEditExercise} onCancel={() => setEditingExercise(null)} />
        </div>,
        document.body
      )}

      {/* Advanced Filters Modal */}
      {showFilters && createPortal(
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowFilters(false)}
          role="dialog"
          aria-labelledby="page-filters-dialog-title"
        >
          <div
            className="w-full max-w-[520px] rounded-[24px] pb-8 pt-3 animate-fade-in"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
          >
            <div className="px-6">
              <div className="flex items-center justify-between mb-6">
                <h3 id="page-filters-dialog-title" className="text-[18px] truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text-primary)' }}>
                  {t('exerciseLibrary.filters')}
                </h3>
                <button
                  type="button"
                  onClick={() => { setFilterMuscle('All'); setFilterEquipment('All'); }}
                  aria-label={t('exerciseLibrary.reset')}
                  className="text-[13px] font-medium active:opacity-70"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {t('exerciseLibrary.reset')}
                </button>
              </div>

              {/* Muscle Group */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--color-text-muted)' }}>
                  {t('exerciseLibrary.muscleGroup')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...MUSCLE_GROUPS].map(m => {
                    const active = filterMuscle === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setFilterMuscle(m)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-full transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`muscleGroups.${m}`, m)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment */}
              <div className="mb-8">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--color-text-muted)' }}>
                  {t('exerciseLibrary.equipment')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...EQUIPMENT].map(eq => {
                    const active = filterEquipment === eq;
                    return (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => setFilterEquipment(eq)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-full transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`exerciseLibrary.equipmentNames.${eq}`, eq)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="w-full py-3.5 rounded-full font-bold text-[14px] active:scale-[0.98] transition-all text-[var(--color-text-on-accent,#fff)]"
                style={{ background: 'var(--color-accent)' }}
              >
                {t('exerciseLibrary.showExercises', { count: filteredRows.length })}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ExerciseLibrary;

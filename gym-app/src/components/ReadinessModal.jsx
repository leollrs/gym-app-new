// ReadinessModal.jsx
// -----------------------------------------------------------------------------
// Bottom-sheet modal showing per-muscle recovery, matching the app's warm-paper
// aesthetic (Archivo + Familjen Grotesk, --color-bg-card, 28px top radius).
//
// Real data: pulls last 14 days of completed sessions+sets, runs the readiness
// engine to produce a per-region map, then aggregates regions into 14 visual
// "buckets" (one per marker on the body).
//
// Filter chips (sore / recovering / fresh) are clickable: tapping one filters
// the markers on the figure to that state. Tap again or tap "All" to reset.
//
// Photos: /readiness/male_trainer_front.jpeg (823×1024 native, 578×720 served)
//         /readiness/male_trainer_back.jpeg  (791×992  native, 574×720 served)
// SVG viewBox uses native pixel coords; preserveAspectRatio="xMidYMid meet"
// keeps markers locked to body parts at any modal size.
// -----------------------------------------------------------------------------

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X, Flame, Zap, Leaf, Moon, AlertTriangle, ChevronRight, ChevronDown, Heart, Activity, Dumbbell, Plus, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useRecentSessionsWithSets } from '../hooks/useSupabaseQuery';
import { supabase } from '../lib/supabase';
import WellnessCheckinModal from './WellnessCheckinModal';
import { FRONT_POLYGONS, BACK_POLYGONS, FRONT_DIM, BACK_DIM } from '../lib/musclePolygons';
import {
  computeReadiness,
  overallReadiness,
  aggregateRegions,
  bucketCounts,
  computeRecoveryScore,
  computeDashboardReadiness,
  loadCachedRecoveryMetrics,
  saveCachedRecoveryMetrics,
} from '../lib/readinessEngine';
import {
  getRecoveryMetrics,
  isAvailable as healthIsAvailable,
  requestPermissions as requestHealthPermissions,
} from '../lib/healthSync';
import { useToast } from '../contexts/ToastContext';
import { rankExercisesForRegions } from '../lib/untrainedSuggestions';
import AppendToRoutineModal from './AppendToRoutineModal';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

const FRONT_PHOTO = '/readiness/male_trainer_front.jpeg';
const BACK_PHOTO = '/readiness/male_trainer_back.jpeg';
const FRONT_VB = `0 0 ${FRONT_DIM.w} ${FRONT_DIM.h}`;
const BACK_VB = `0 0 ${BACK_DIM.w} ${BACK_DIM.h}`;

// State colors — softer than the prototype's neon, tuned for warm-paper bg.
const STATE_HEX = {
  fatigued: '#E26B5C',
  moderate: '#E0A042',
  fresh: '#3DAD7C',
  rest: '#9CA3AB',
};
const STATE_LABEL = {
  fatigued: 'Sore',
  moderate: 'Recovering',
  fresh: 'Fresh',
  rest: 'Untrained',
};

// ── Visual buckets ──────────────────────────────────────────────────────────
// Each polygon on the body maps to a bucket. The bucket's `regionIds` are the
// engine-side anatomical region keys (see readinessEngine.js) so aggregation
// against logged exercises stays accurate.
const READINESS_BUCKETS = [
  // ── Front ──────────────────────────────────────────────────────────────
  { id: 'chest-upper',       label: 'Upper Chest',         regionIds: ['upper_chest'] },
  { id: 'chest-mid',         label: 'Mid Chest',           regionIds: ['mid_chest'] },
  { id: 'chest-lower',       label: 'Lower Chest',         regionIds: ['lower_chest'] },
  { id: 'serratus',          label: 'Serratus',            regionIds: ['serratus'] },
  { id: 'front-delts',       label: 'Front Delts',         regionIds: ['front_delts'] },
  { id: 'side-delts',        label: 'Side Delts',          regionIds: ['side_delts'] },
  { id: 'biceps',            label: 'Biceps',              regionIds: ['biceps'] },
  { id: 'brachialis',        label: 'Brachialis',          regionIds: ['brachialis'] },
  { id: 'forearm-flex',      label: 'Forearm Flexors',     regionIds: ['forearms'] },
  { id: 'forearm-ext',       label: 'Forearm Extensors',   regionIds: ['forearms'] },
  { id: 'abs',               label: 'Abs',                 regionIds: ['upper_abs', 'mid_abs', 'lower_abs', 'abs'] },
  // Granular abs buckets — match the polygon bucketIds in musclePolygons.js
  // (`upper-abs / mid-abs / lower-abs`) so tapping a core polygon resolves
  // to a known bucket and the DetailSheet actually opens.
  { id: 'upper-abs',         label: 'Upper Abs',           regionIds: ['upper_abs', 'abs'] },
  { id: 'mid-abs',           label: 'Mid Abs',             regionIds: ['mid_abs', 'abs'] },
  { id: 'lower-abs',         label: 'Lower Abs',           regionIds: ['lower_abs', 'abs'] },
  { id: 'obliques',          label: 'Obliques',            regionIds: ['obliques'] },
  { id: 'quads',             label: 'Quads',               regionIds: ['quads', 'hip_flexors'] },
  { id: 'adductors',         label: 'Inner Thigh',         regionIds: ['adductors'] },
  { id: 'tibialis',          label: 'Shin',                regionIds: ['tibialis'] },
  { id: 'calves-front',      label: 'Calves (front)',      regionIds: ['calves', 'soleus'] },

  // ── Back ───────────────────────────────────────────────────────────────
  { id: 'traps',             label: 'Traps',               regionIds: ['traps'] },
  { id: 'upper-back',        label: 'Upper Back',          regionIds: ['upper_back', 'mid_back'] },
  { id: 'lats',              label: 'Lats',                regionIds: ['lats'] },
  { id: 'rear-delts',        label: 'Rear Delts',          regionIds: ['rear_delts'] },
  { id: 'triceps',           label: 'Triceps',             regionIds: ['triceps'] },
  { id: 'lower-back',        label: 'Lower Back',          regionIds: ['lower_back'] },
  { id: 'side-waist',        label: 'Side Waist',          regionIds: ['obliques', 'lower_back'] },
  { id: 'glutes',            label: 'Glutes',              regionIds: ['glutes'] },
  { id: 'abductors',         label: 'Abductors',           regionIds: ['abductors', 'glute_med'] },
  { id: 'hamstrings',        label: 'Hamstrings',          regionIds: ['hamstrings'] },
  { id: 'calves',            label: 'Calves',              regionIds: ['calves', 'soleus'] },
  { id: 'forearm-back-ext',  label: 'Forearm Ext. (back)', regionIds: ['forearms'] },
  { id: 'forearm-back-flex', label: 'Forearm Flex. (back)',regionIds: ['forearms'] },
];
const BUCKET_BY_ID = new Map(READINESS_BUCKETS.map(b => [b.id, b]));

// Translated bucket display name. The `bucket.label` field stays in English
// because coachLine() matches on push/pull/leg keywords (chest, delts, etc).
function bucketLabel(bucket, t) {
  if (!bucket) return '';
  if (typeof t !== 'function') return bucket.label;
  return t(`readinessModal.buckets.${bucket.id}`, { defaultValue: bucket.label });
}

// Marker geometry is now sourced from src/data/muscleRegions.json — user-
// traced polygons grouped into the 14 visual buckets above. The two
// constants below stay for the polygon-side render path.

// ── Swipe gesture helpers ───────────────────────────────────────────────────

/**
 * Horizontal-swipe detector. Returns onPointer* handlers to spread on the
 * target element. Fires onLeft / onRight when the user drags >threshold px
 * horizontally with mostly-horizontal motion (rejects diagonal scrolls).
 */
function useHorizontalSwipe({ onLeft, onRight, threshold = 50 }) {
  const start = useRef(null);

  const onPointerDown = useCallback((e) => {
    // Only respond to primary touch / left mouse
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);

  const onPointerUp = useCallback((e) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    const dt = Date.now() - start.current.t;
    start.current = null;

    // Must be mostly horizontal AND past threshold AND fast-ish
    if (Math.abs(dx) < threshold) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.7) return;
    if (dt > 600) return; // too slow → ignore

    if (dx < 0) onLeft?.();
    else onRight?.();
  }, [onLeft, onRight, threshold]);

  const onPointerCancel = useCallback(() => { start.current = null; }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}

/**
 * Vertical drag-to-dismiss for bottom sheets. Translates the sheet downward
 * during drag, snaps back if released early, calls onDismiss past threshold.
 *
 * Returns:
 *   bind: handlers to spread on the drag-handle element (the grip area)
 *   translateY: current px offset to apply via CSS transform
 *   isDragging: bool, freeze transitions while true
 */
function useDragToDismiss({ onDismiss, threshold = 120 }) {
  const start = useRef(null);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { y: e.clientY };
    setIsDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!start.current) return;
    const dy = Math.max(0, e.clientY - start.current.y); // only allow downward
    setTranslateY(dy);
  }, []);

  const finish = useCallback(() => {
    if (!start.current) return;
    const dy = translateY;
    start.current = null;
    setIsDragging(false);
    if (dy > threshold) {
      // Snap closed: animate the rest of the way then fire callback
      setTranslateY(window.innerHeight);
      setTimeout(() => {
        onDismiss?.();
        setTranslateY(0);
      }, 180);
    } else {
      setTranslateY(0); // snap back
    }
  }, [translateY, threshold, onDismiss]);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      style: { touchAction: 'none' },
    },
    translateY,
    isDragging,
  };
}

// ── Coach line copy generator ───────────────────────────────────────────────
function coachLine(buckets, readiness, t) {
  const fatigued = [];
  const fresh = [];
  for (const b of buckets) {
    const agg = aggregateRegions(readiness, b.regionIds);
    if (agg.state === 'fatigued') fatigued.push(b.label.toLowerCase());
    if (agg.state === 'fresh' && agg.sets > 0) fresh.push(b.label.toLowerCase());
  }
  // Group push/pull/legs heuristics
  const isPush = (l) => /chest|delts|tricep/.test(l);
  const isPull = (l) => /back|bicep|trap|lat/.test(l);
  const isLeg = (l) => /quad|hamstring|glute|calf|calves/.test(l);

  const pushFatigued = fatigued.some(isPush);
  const pullFatigued = fatigued.some(isPull);
  const legsFresh = fresh.some(isLeg);

  const tx = t || ((_k, opts) => (opts && opts.defaultValue) || _k);

  if (pushFatigued && legsFresh) {
    return {
      left: tx('readinessModal.coachPushIs', { defaultValue: 'Push is' }),
      leftStrong: tx('readinessModal.coachCooked', { defaultValue: 'cooked.' }),
      right: tx('readinessModal.coachLegsAre', { defaultValue: 'Legs are' }),
      rightStrong: tx('readinessModal.coachPrimed', { defaultValue: 'primed.' }),
    };
  }
  if (pullFatigued && legsFresh) {
    return {
      left: tx('readinessModal.coachPullIs', { defaultValue: 'Pull is' }),
      leftStrong: tx('readinessModal.coachCooked', { defaultValue: 'cooked.' }),
      right: tx('readinessModal.coachLegsAre', { defaultValue: 'Legs are' }),
      rightStrong: tx('readinessModal.coachPrimed', { defaultValue: 'primed.' }),
    };
  }
  if (fatigued.length > fresh.length) {
    return {
      left: tx('readinessModal.coachMuscleGroups', {
        count: fatigued.length,
        defaultValue: `${fatigued.length} muscle group${fatigued.length === 1 ? '' : 's'}`,
      }),
      leftStrong: tx('readinessModal.coachNeedRest', { defaultValue: 'need rest.' }),
      right: '',
      rightStrong: '',
    };
  }
  if (fresh.length > 0) {
    return {
      left: tx('readinessModal.coachYoure', { defaultValue: "You're" }),
      leftStrong: tx('readinessModal.coachReadyToTrain', { defaultValue: 'ready to train.' }),
      right: '',
      rightStrong: '',
    };
  }
  return {
    left: tx('readinessModal.coachLightWeek', { defaultValue: 'Light week.' }),
    leftStrong: '',
    right: tx('readinessModal.coachTimeToLift', { defaultValue: 'Time to lift.' }),
    rightStrong: '',
  };
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ViewToggle({ view, setView, t }) {
  const labels = {
    front: t ? t('readinessModal.viewFront', { defaultValue: 'Front' }) : 'Front',
    back: t ? t('readinessModal.viewBack', { defaultValue: 'Back' }) : 'Back',
  };
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 3,
        borderRadius: 999,
        background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
      }}
    >
      {['front', 'back'].map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            style={{
              border: 'none',
              background: active ? 'var(--color-text-primary, #0F1419)' : 'transparent',
              color: active ? 'var(--color-bg-card, #FAFAF7)' : 'var(--color-text-muted, #6B7280)',
              fontFamily: FONT_BODY,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1,
              padding: '6px 14px',
              borderRadius: 999,
              cursor: 'pointer',
              textTransform: 'uppercase',
              transition: 'background 160ms, color 160ms',
            }}
          >
            {labels[v]}
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({ icon: Icon, count, label, color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '12px 6px',
        borderRadius: 16,
        background: active
          ? `color-mix(in srgb, ${color} 14%, var(--color-bg-card))`
          : 'var(--color-surface-hover, rgba(15,20,25,0.04))',
        border: `1px solid ${
          active
            ? `color-mix(in srgb, ${color} 50%, transparent)`
            : 'var(--color-border-subtle, rgba(15,20,25,0.08))'
        }`,
        cursor: 'pointer',
        fontFamily: FONT_BODY,
        transition: 'background 160ms, border-color 160ms, transform 80ms',
        transform: active ? 'scale(1)' : 'scale(1)',
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.98)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <Icon size={14} strokeWidth={2.6} style={{ color, flexShrink: 0 }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 18,
            fontWeight: 900,
            color: 'var(--color-text-primary)',
            letterSpacing: -0.5,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {count}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--color-text-muted)',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {label}
        </span>
      </div>
    </button>
  );
}

function Figure({ view, setView, selected, onSelect, readiness, filterState, t }) {
  const isFront = view === 'front';
  const photo = isFront ? FRONT_PHOTO : BACK_PHOTO;
  const polygons = isFront ? FRONT_POLYGONS : BACK_POLYGONS;
  const vb = isFront ? FRONT_VB : BACK_VB;
  const aspect = isFront ? `${FRONT_DIM.w} / ${FRONT_DIM.h}` : `${BACK_DIM.w} / ${BACK_DIM.h}`;

  // Track flip direction so we can run a directional slide animation.
  const [flipDir, setFlipDir] = useState(null); // 'left' | 'right' | null
  const swipe = useHorizontalSwipe({
    onLeft: () => {
      if (view === 'front') {
        setFlipDir('left');
        setView('back');
      }
    },
    onRight: () => {
      if (view === 'back') {
        setFlipDir('right');
        setView('front');
      }
    },
  });

  // Reset flipDir after the animation runs, so the next render is static.
  useEffect(() => {
    if (!flipDir) return;
    const t = setTimeout(() => setFlipDir(null), 300);
    return () => clearTimeout(t);
  }, [flipDir, view]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Toggle pill — sits above the figure card */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <ViewToggle view={view} setView={setView} t={t} />
      </div>

      {/* Figure card — light, warm. Pointer handlers detect horizontal swipes
          to flip front↔back. */}
      <div
        {...swipe}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 420,
          margin: '0 auto',
          borderRadius: 22,
          background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
          border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
          padding: 10,
          overflow: 'hidden',
          touchAction: 'pan-y', // let vertical scroll work, claim horizontal
        }}
      >
        {/* Photo + marker overlay — both share the same aspect-ratio box, so
            coordinates stay locked at any container width. The `key` resets on
            view change so the slide-in animation re-runs. */}
        <div
          key={view}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: aspect,
            animation: flipDir
              ? `rd-flip-${flipDir} 280ms cubic-bezier(0.2,0.8,0.2,1)`
              : undefined,
          }}
        >
          <img
            src={photo}
            alt={view}
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              userSelect: 'none',
              WebkitUserDrag: 'none',
              pointerEvents: 'none',
              filter: 'saturate(0.95) contrast(1.02)',
            }}
          />
          <svg
            viewBox={vb}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {polygons.map((poly) => {
              const bucket = BUCKET_BY_ID.get(poly.bucketId);
              const agg = bucket
                ? aggregateRegions(readiness, bucket.regionIds)
                : { state: 'fresh' };
              const c = STATE_HEX[agg.state];
              const isSel = selected === poly.bucketId;
              const isHot = agg.state === 'fatigued';
              const dimmed = filterState && agg.state !== filterState;

              return (
                <polygon
                  key={poly.id}
                  points={poly.points}
                  onClick={() => onSelect(poly.bucketId)}
                  fill={c}
                  fillOpacity={dimmed ? 0.08 : isSel ? 0.85 : 0.55}
                  stroke={isSel ? '#3B82F6' : 'rgba(0,0,0,0.7)'}
                  strokeWidth={isSel ? 3 : 1.4}
                  strokeLinejoin="round"
                  style={{
                    cursor: 'pointer',
                    transition: 'fill-opacity 200ms, stroke 200ms, stroke-width 200ms',
                    animation: (isHot && !dimmed)
                      ? 'rd-hot 2.4s ease-in-out infinite'
                      : undefined,
                    filter: isSel ? 'drop-shadow(0 0 6px rgba(59,130,246,0.65))' : undefined,
                  }}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function RecoveryRing({ pct, color }) {
  const r = 26;
  const CIRC = 2 * Math.PI * r;
  const off = CIRC * (1 - pct / 100);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--color-border-subtle, rgba(15,20,25,0.1))"
        strokeWidth="5"
      />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={CIRC}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
      />
      <text
        x="32"
        y="35"
        textAnchor="middle"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          fontWeight: 900,
          fill: 'var(--color-text-primary)',
          letterSpacing: '-0.5px',
        }}
      >
        {pct}
      </text>
      <text
        x="32"
        y="46"
        textAnchor="middle"
        style={{
          fontFamily: FONT_BODY,
          fontSize: 7,
          fontWeight: 800,
          fill: 'var(--color-text-muted)',
          letterSpacing: '1px',
        }}
      >
        READY
      </text>
    </svg>
  );
}

function SubBar({ sub, color }) {
  // % of this week's weekly-volume target hit for this region. The target
  // (sub.targetSets) is "weighted sets" — exercise's contribution × set
  // count — so the percentage cleanly answers "how trained is this muscle
  // relative to a healthy week" without exposing the math.
  const max = sub.targetSets || 12;
  const pct = max > 0 ? Math.min(100, Math.round((sub.sets / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 5,
        }}
      >
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            letterSpacing: -0.1,
          }}
        >
          {sub.label}
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 13,
            fontWeight: 800,
            color: 'var(--color-text-primary)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: 0.2,
          }}
        >
          {pct}%
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          height: 6,
          borderRadius: 3,
          background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: pct === 0 ? 'var(--color-border-subtle)' : color,
            borderRadius: 3,
            transition: 'width 400ms cubic-bezier(0.2,0.8,0.2,1)',
          }}
        />
      </div>
    </div>
  );
}

function DetailSheet({ bucketId, readiness, onClose, regionLabels, t, i18n, onAppend }) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  // Per-sub-region collapse state. Keyed by region id so each muscle
  // (e.g. calves, soleus) tracks its own expanded/collapsed state.
  const [expandedSubs, setExpandedSubs] = useState({});
  if (!bucketId) return null;
  const bucket = BUCKET_BY_ID.get(bucketId);
  if (!bucket) return null;

  const agg = aggregateRegions(readiness, bucket.regionIds);
  const color = STATE_HEX[agg.state];
  const stateLabel = t
    ? t(`readinessModal.states.${agg.state}`, { defaultValue: STATE_LABEL[agg.state] })
    : STATE_LABEL[agg.state];

  const lastTrainedText = (() => {
    if (!agg.lastTrained) {
      return t ? t('readinessModal.notTrainedThisWeek', { defaultValue: 'Not trained this week' }) : 'Not trained this week';
    }
    const d = agg.daysSince;
    if (d < 0.5) return t ? t('readinessModal.trainedToday', { defaultValue: 'Trained today' }) : 'Trained today';
    if (d < 1.5) return t ? t('readinessModal.trainedYesterday', { defaultValue: 'Trained yesterday' }) : 'Trained yesterday';
    return t
      ? t('readinessModal.trainedDaysAgo', { count: Math.round(d), defaultValue: `Trained ${Math.round(d)} days ago` })
      : `Trained ${Math.round(d)} days ago`;
  })();

  return (
    <div
      style={{
        margin: '4px 22px 14px',
        background: 'var(--color-bg-card, #FAFAF7)',
        borderRadius: 18,
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
        boxShadow: '0 4px 18px rgba(15,20,25,0.06)',
        animation: 'rd-zoomIn 220ms cubic-bezier(0.2,0.8,0.2,1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 18px 10px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        <RecoveryRing pct={agg.recovery} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: color,
              }}
            />
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1.4,
                color,
                textTransform: 'uppercase',
              }}
            >
              {stateLabel}
            </div>
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              fontWeight: 900,
              letterSpacing: -0.6,
              color: 'var(--color-text-primary)',
              marginTop: 2,
              lineHeight: 1.1,
            }}
          >
            {bucketLabel(bucket, t)}
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 12,
              color: 'var(--color-text-muted)',
              marginTop: 3,
              lineHeight: 1.35,
            }}
          >
            {lastTrainedText} · {t
              ? t('readinessModal.weightedSetsThisWeek', { count: Number(agg.sets.toFixed(1)), defaultValue: `${agg.sets.toFixed(1)} weighted sets this week` })
              : `${agg.sets.toFixed(1)} weighted sets this week`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t ? t('readinessModal.closeDetail', { defaultValue: 'Close detail' }) : 'Close detail'}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            border: 'none',
            flexShrink: 0,
            background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.4,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
            }}
          >
            {t ? t('readinessModal.breakdownThisWeek', { defaultValue: 'Breakdown · This week' }) : 'Breakdown · This week'}
          </div>
        </div>
        {agg.subs.map((sub) => {
          const subLabel = regionLabels.get(sub.id) || sub.id;
          const subSuggestions = rankExercisesForRegions([sub.id], { topN: 6 });
          const isExpanded = !!expandedSubs[sub.id];
          return (
            <div key={sub.id} style={{ marginBottom: 14 }}>
              <SubBar
                sub={{
                  id: sub.id,
                  label: subLabel,
                  sets: sub.sets,
                  targetSets: 10,
                }}
                color={color}
              />
              {subSuggestions.length === 0 && (
                <p
                  style={{
                    marginTop: 4,
                    fontFamily: FONT_BODY,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.6,
                    color: 'var(--color-text-subtle)',
                    textTransform: 'uppercase',
                  }}
                >
                  {t ? t('readinessModal.noExercisesForRegion', { defaultValue: 'No exercises tagged for this region yet' }) : 'No exercises tagged for this region yet'}
                </p>
              )}
              {subSuggestions.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedSubs((prev) => ({ ...prev, [sub.id]: !prev[sub.id] }))}
                    aria-expanded={isExpanded}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                      border: '1px solid var(--color-border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontFamily: FONT_BODY,
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: 1.1,
                        color: 'var(--color-text-primary)',
                        textTransform: 'uppercase',
                      }}
                    >
                      <Sparkles size={11} style={{ color: STATE_HEX.fresh }} />
                      {t ? t('readinessModal.suggestExercisesFor', { muscle: subLabel, defaultValue: `Exercises for ${subLabel}` }) : `Exercises for ${subLabel}`}
                    </span>
                    <ChevronDown
                      size={13}
                      style={{
                        color: 'var(--color-text-muted)',
                        transition: 'transform 180ms',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                      }}
                    />
                  </button>

                  {isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {subSuggestions.map((ex) => {
                        const label = i18n?.language === 'es' && ex.name_es ? ex.name_es : ex.name;
                        const pct = typeof ex._regionMatch === 'number' ? Math.round(ex._regionMatch) : null;
                        return (
                          <button
                            key={ex.id}
                            type="button"
                            onClick={() => onAppend?.(ex)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              padding: '8px 10px',
                              borderRadius: 10,
                              background: 'var(--color-bg-card)',
                              border: '1px solid var(--color-border-subtle)',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                            aria-label={t ? t('readinessModal.addToRoutine', { defaultValue: 'Add to routine' }) : 'Add to routine'}
                          >
                            <span
                              style={{
                                fontFamily: FONT_BODY,
                                fontSize: 13,
                                fontWeight: 700,
                                color: 'var(--color-text-primary)',
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {label}
                            </span>
                            {pct != null && (
                              <span
                                style={{
                                  fontFamily: FONT_BODY,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: 0.4,
                                  color: STATE_HEX.fresh,
                                  fontVariantNumeric: 'tabular-nums',
                                  padding: '2px 6px',
                                  borderRadius: 6,
                                  background: `color-mix(in srgb, ${STATE_HEX.fresh} 14%, transparent)`,
                                  border: `1px solid color-mix(in srgb, ${STATE_HEX.fresh} 28%, transparent)`,
                                }}
                                aria-label={t ? t('readinessModal.effectivenessAria', { pct, defaultValue: `${pct}% effective` }) : `${pct}% effective`}
                              >
                                {pct}%
                              </span>
                            )}
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: `color-mix(in srgb, ${STATE_HEX.fresh} 18%, transparent)`,
                                color: STATE_HEX.fresh,
                                flexShrink: 0,
                              }}
                            >
                              <Plus size={12} strokeWidth={2.6} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Recovery factor cards ───────────────────────────────────────────────────
// Reusable mini-card that mirrors the dashboard's "rounded-2xl, ring + value"
// pattern (see WorkoutHeroCard, GymPulse). Color-coded ring follows the spec:
// emerald-400 ≥70, amber-400 40-69, rose-400 <40.

const RING_GREEN = '#34D399';   // emerald-400
const RING_AMBER = '#FBBF24';   // amber-400
const RING_ROSE = '#FB7185';    // rose-400
const RING_MUTED = 'var(--color-border-subtle, rgba(15,20,25,0.16))';

function _factorColor(score) {
  if (typeof score !== 'number') return RING_MUTED;
  if (score >= 70) return RING_GREEN;
  if (score >= 40) return RING_AMBER;
  return RING_ROSE;
}

function FactorRing({ score, color, size = 56 }) {
  const r = (size - 8) / 2;
  const CIRC = 2 * Math.PI * r;
  const pct = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;
  const off = CIRC * (1 - pct / 100);
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={RING_MUTED} strokeWidth="4" />
      <circle
        cx={cx} cy={cx} r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={CIRC}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dashoffset 400ms ease' }}
      />
      <text
        x={cx} y={cx + 4}
        textAnchor="middle"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          fontWeight: 900,
          fill: 'var(--color-text-primary)',
          letterSpacing: '-0.5px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {typeof score === 'number' ? score : '–'}
      </text>
    </svg>
  );
}

function FactorCard(props) {
  const { label, score, sublabel, ariaLabel, delay = 0 } = props;
  const IconComp = props.Icon;
  const color = _factorColor(score);
  return (
    <div
      role="group"
      aria-label={ariaLabel || label}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '14px 10px',
        borderRadius: 16,
        background: 'var(--color-surface-1, var(--color-bg-card, #FAFAF7))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
        animation: `rd-fadeIn 320ms cubic-bezier(0.2,0.8,0.2,1) ${delay}ms both`,
      }}
    >
      <FactorRing score={typeof score === 'number' ? score : null} color={color} />
      <div style={{ width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          {IconComp ? <IconComp size={12} strokeWidth={2.4} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden="true" /> : null}
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.1,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              lineHeight: 1.2,
              wordBreak: 'break-word',
            }}
          >
            {label}
          </div>
        </div>
        {sublabel && (
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2,
              wordBreak: 'break-word',
            }}
          >
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
}

function HowCalculated({ t }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '12px 22px 0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('readinessModal.howCalculated', 'How is this calculated?')}
        style={{
          width: '100%',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderRadius: 14,
          border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
          background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
          cursor: 'pointer',
          fontFamily: FONT_BODY,
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          letterSpacing: 0.2,
        }}
      >
        <span>{t('readinessModal.howCalculated', 'How is this calculated?')}</span>
        <ChevronDown
          size={16}
          strokeWidth={2.4}
          style={{ transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            padding: '12px 14px',
            borderRadius: 14,
            border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            background: 'var(--color-bg-card, #FAFAF7)',
            fontFamily: FONT_BODY,
            fontSize: 12,
            color: 'var(--color-text-muted)',
            lineHeight: 1.55,
            animation: 'rd-fadeIn 220ms ease',
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {t('readinessModal.sleep', 'Sleep')}.{' '}
            </strong>
            {t('readinessModal.explainSleep')}
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {t('readinessModal.wellness', 'Wellness')}.{' '}
            </strong>
            {t('readinessModal.explainWellness')}
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {t('readinessModal.trainingLoad', 'Training Load')}.{' '}
            </strong>
            {t('readinessModal.explainTrainingLoad')}
          </p>
          <p style={{ margin: 0 }}>{t('readinessModal.explainBlend')}</p>
        </div>
      )}
    </div>
  );
}

function ConnectHealthCard({ t, onConnect }) {
  return (
    <div
      style={{
        margin: '12px 22px 0',
        padding: 14,
        borderRadius: 18,
        background: `color-mix(in srgb, var(--color-accent, #2EC4C4) 8%, var(--color-bg-card))`,
        border: `1px solid color-mix(in srgb, var(--color-accent, #2EC4C4) 22%, transparent)`,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `color-mix(in srgb, var(--color-accent, #2EC4C4) 18%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Heart size={18} strokeWidth={2.4} style={{ color: 'var(--color-accent, #2EC4C4)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 14,
            fontWeight: 800,
            color: 'var(--color-text-primary)',
            letterSpacing: -0.2,
            marginTop: 2,
            lineHeight: 1.3,
          }}
        >
          {t('readinessModal.connectHealthTitle')}
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 12,
            color: 'var(--color-text-muted)',
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          {t('readinessModal.connectHealthBody')}
        </div>
        <button
          type="button"
          onClick={onConnect}
          aria-label={t('readinessModal.connectHealthCta', 'Connect')}
          style={{
            marginTop: 10,
            minHeight: 36,
            padding: '8px 14px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--color-accent, #2EC4C4)',
            color: '#001512',
            fontFamily: FONT_BODY,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0.4,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {t('readinessModal.connectHealthCta', 'Connect')}
        </button>
      </div>
    </div>
  );
}

function LowRecoveryBanner({ t, onApplyDeload, onDismiss, score }) {
  return (
    <div
      style={{
        margin: '12px 22px 0',
        padding: 14,
        borderRadius: 18,
        background: `color-mix(in srgb, ${RING_ROSE} 8%, var(--color-bg-card))`,
        border: `1px solid color-mix(in srgb, ${RING_ROSE} 26%, transparent)`,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: `color-mix(in srgb, ${RING_ROSE} 18%, transparent)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={18} strokeWidth={2.4} style={{ color: RING_ROSE }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: 1.4,
              color: RING_ROSE,
              textTransform: 'uppercase',
            }}
          >
            {t('readinessModal.lowReadinessTitle')} · {score}
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 12,
              color: 'var(--color-text-muted)',
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            {t('readinessModal.lowReadinessBody')}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={onApplyDeload}
          aria-label={t('readinessModal.lowReadinessCta')}
          style={{
            flex: 1,
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 12,
            border: 'none',
            background: RING_ROSE,
            color: '#fff',
            fontFamily: FONT_BODY,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0.4,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {t('readinessModal.lowReadinessCta')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('readinessModal.lowReadinessSkip')}
          style={{
            flex: 1,
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.16))',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            fontFamily: FONT_BODY,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.3,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {t('readinessModal.lowReadinessSkip')}
        </button>
      </div>
    </div>
  );
}

// ── Main modal component ────────────────────────────────────────────────────

export default function ReadinessModal({ open, onClose }) {
  const { t, i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const userId = user?.id;
  // Canonical "Apple Health connected" state owned by the Settings page
  // (HealthSync.jsx). The Recovery modal must defer to it — otherwise we
  // pester users who already opted in just because the platform hasn't
  // surfaced any HRV/sleep data yet (typical day-1).
  const healthConnected = (profile?.health_sync_enabled === true)
    || (typeof window !== 'undefined' && window.localStorage?.getItem('tugympr_health_connected') === 'true');
  const { data: sessions = [] } = useRecentSessionsWithSets(userId, 14);

  const [view, setView] = useState('front');
  const [selected, setSelected] = useState(null);
  const [filterState, setFilterState] = useState(null); // 'fatigued' | 'moderate' | 'fresh' | null

  // Recovery (sleep / HRV / RHR) state — fetched from health bridge.
  // Hydrate synchronously from cache so the cards render instantly on open.
  const [recoveryMetrics, setRecoveryMetrics] = useState(() => loadCachedRecoveryMetrics());
  const [healthAvailable, setHealthAvailable] = useState(true); // assume true until proven otherwise
  const [healthDenied, setHealthDenied] = useState(false);
  const [deloadDismissed, setDeloadDismissed] = useState(false);
  // Today's subjective soreness check-in (1-10). Independent from the health
  // bridge — works for every user including those without an Apple Watch.
  const [todayWellness, setTodayWellness] = useState(null);
  const [showWellnessCheckin, setShowWellnessCheckin] = useState(false);

  // Region-id → translated label lookup for breakdown display.
  // English defaults match the prior inline list so missing es keys still
  // render readable text instead of the raw region id.
  const regionLabels = useMemo(() => {
    const m = new Map();
    const defs = [
      ['upper_chest', 'Upper Chest'], ['mid_chest', 'Mid Chest'], ['lower_chest', 'Lower Chest'],
      ['front_delts', 'Front Delts'], ['side_delts', 'Side Delts'], ['rear_delts', 'Rear Delts'],
      ['biceps', 'Biceps'], ['triceps', 'Triceps'], ['forearms', 'Forearms'], ['brachialis', 'Brachialis'],
      ['upper_abs', 'Upper Abs'], ['mid_abs', 'Mid Abs'], ['lower_abs', 'Lower Abs'],
      ['obliques', 'Obliques'], ['serratus', 'Serratus'], ['abs', 'Abs'],
      ['traps', 'Traps'], ['upper_back', 'Upper Back'], ['mid_back', 'Mid Back'],
      ['lats', 'Lats'], ['lower_back', 'Lower Back'],
      ['glutes', 'Glutes'], ['glute_med', 'Glute Med'],
      ['quads', 'Quads'], ['hamstrings', 'Hamstrings'], ['adductors', 'Adductors'],
      ['abductors', 'Abductors'], ['hip_flexors', 'Hip Flexors'],
      ['calves', 'Calves'], ['soleus', 'Soleus'], ['tibialis', 'Tibialis'],
    ];
    for (const [k, v] of defs) {
      m.set(k, t(`readinessModal.regions.${k}`, { defaultValue: v }));
    }
    return m;
  }, [t]);

  const readiness = useMemo(
    () => computeReadiness(sessions || [], { windowDays: 7 }),
    [sessions]
  );
  const trainingLoadScore = useMemo(() => overallReadiness(readiness), [readiness]);

  // Recovery score = sleep + subjective soreness (+ HRV/RHR if a Watch is
  // paired, but those aren't surfaced in the UI). The wellness check-in is
  // the primary "autonomic" signal — works for every user.
  const recovery = useMemo(
    () => computeRecoveryScore({
      ...(recoveryMetrics || {}),
      soreness: typeof todayWellness?.soreness === 'number' ? todayWellness.soreness : null,
    }),
    [recoveryMetrics, todayWellness]
  );

  // Final composite shown in the header chip. Routed through the shared
  // computeDashboardReadiness so the modal's number and the dashboard
  // chip can't disagree on the same inputs.
  const score = useMemo(
    () => computeDashboardReadiness({
      sessions: sessions || [],
      recoveryMetrics,
      soreness: typeof todayWellness?.soreness === 'number' ? todayWellness.soreness : null,
    }),
    [sessions, recoveryMetrics, todayWellness]
  );
  const counts = useMemo(
    () => bucketCounts(readiness, READINESS_BUCKETS),
    [readiness]
  );
  const coach = useMemo(
    () => coachLine(READINESS_BUCKETS, readiness, t),
    [readiness, t]
  );

  // The most fatigued bucket — drives the "Watch out" callout
  const mostFatigued = useMemo(() => {
    let worst = null;
    for (const b of READINESS_BUCKETS) {
      const agg = aggregateRegions(readiness, b.regionIds);
      if (agg.state !== 'fatigued') continue;
      if (!worst || agg.recovery < worst.agg.recovery) worst = { bucket: b, agg };
    }
    return worst;
  }, [readiness]);

  // When the user taps an exercise inside the per-muscle suggestion dropdown
  // (rendered inside DetailSheet, scoped to the selected bucket's regions),
  // we open the AppendToRoutineModal so they can pick a destination routine.
  const [suggestionForAppend, setSuggestionForAppend] = useState(null);

  // Reset when reopened
  useEffect(() => {
    if (open) {
      setView('front');
      setSelected(null);
      setFilterState(null);
      setDeloadDismissed(false);
    }
  }, [open]);

  // Fetch today's wellness check-in whenever the modal opens. One row per
  // user per local calendar date, primary-keyed by (profile_id, checkin_date).
  // Falls back to localStorage if the DB read fails or returns nothing — the
  // WellnessCheckinModal mirrors saves to localStorage so offline check-ins
  // still appear here and stop the auto-prompt loop.
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    const d = new Date();
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Hydrate from localStorage immediately so the card paints with the
    // local value even before the DB roundtrip.
    try {
      const raw = localStorage.getItem('tugympr_wellness_last_checkin');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === dateKey && typeof parsed.soreness === 'number') {
          setTodayWellness({ soreness: parsed.soreness, checkin_date: dateKey });
        }
      }
    } catch {}
    (async () => {
      const { data } = await supabase
        .from('wellness_checkins')
        .select('soreness, checkin_date, notes')
        .eq('profile_id', userId)
        .eq('checkin_date', dateKey)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setTodayWellness(data);
        // Mirror DB value into localStorage so the Dashboard hero card —
        // which only reads localStorage — uses the same soreness value
        // we just used to compute the modal's score. Without this the
        // two surfaces drift whenever the check-in was done on another
        // device or after localStorage was cleared.
        try {
          localStorage.setItem('tugympr_wellness_last_checkin', JSON.stringify({
            date: dateKey,
            soreness: data.soreness,
            notes: data.notes ?? null,
          }));
        } catch { /* ignore quota / disabled storage */ }
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  // Fetch recovery metrics on open. Uses 4h cache to avoid hammering the
  // health bridge; refreshes when stale. Sets `healthAvailable` based on the
  // platform check so the connect-CTA only appears when the device can
  // actually provide health data and we currently have no metrics.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const available = await healthIsAvailable();
        if (cancelled) return;
        setHealthAvailable(!!available);
        if (!available) {
          // Web / unsupported device — leave metrics null, show CTA only on
          // platforms where health data could be provided.
          return;
        }
        const cached = loadCachedRecoveryMetrics();
        // Only short-circuit on a cache that has at least one real reading.
        // An "all-null" cache means the previous fetch was made before the
        // user granted Health — we must refetch, otherwise they're stuck
        // with a blank UI for the full TTL even after granting.
        const cacheHasData = cached && (
          cached.sleepHours != null
          || cached.hrv != null
          || cached.restingHR != null
        );
        if (cacheHasData) {
          setRecoveryMetrics(cached);
          return;
        }
        const fresh = await getRecoveryMetrics();
        if (cancelled) return;
        setRecoveryMetrics(fresh);
        saveCachedRecoveryMetrics(fresh);
        // If everything came back null on a native device, treat as denied
        // so the connect CTA is offered.
        if (!fresh.sleepHours && !fresh.hrv && !fresh.restingHR) {
          setHealthDenied(true);
        }
      } catch {
        // Swallow — UI gracefully falls back to training-load-only readiness.
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const handleConnectHealth = useCallback(async () => {
    // Try the inline permission request first — on iOS the system sheet
    // *can* present from a modal as long as the call is in response to a
    // user gesture, so we attempt it directly. If the device isn't a
    // native platform (web preview), or the call throws, we fall back to
    // routing the user to the dedicated /health-sync page so they always
    // have a path forward.
    try {
      const native = await healthIsAvailable();
      if (!native) {
        // Web / unsupported device — route to the page that explains the
        // requirement instead of silently doing nothing.
        showToast(
          t('readinessModal.connectHealthUnavailable', 'Health sync requires the iOS or Android app'),
          'info',
        );
        onClose?.();
        navigate('/health-sync');
        return;
      }
      const { granted } = await requestHealthPermissions();
      // Whether the user granted or not, attempt to read metrics — on iOS
      // we can't tell denial vs grant without trying a query. If the read
      // succeeds we treat it as connected; otherwise we surface the page
      // for manual setup.
      const fresh = await getRecoveryMetrics();
      setRecoveryMetrics(fresh);
      saveCachedRecoveryMetrics(fresh);
      const gotAny = !!(fresh?.sleepHours || fresh?.hrv || fresh?.restingHR);
      setHealthDenied(!gotAny);
      // If the OS reported granted (or any data flowed), persist the
      // connected flag the same way Settings → Health does. This is what
      // gates the Recovery modal's connect CTA next time.
      if (granted || gotAny) {
        try { window.localStorage?.setItem('tugympr_health_connected', 'true'); } catch {}
        if (user?.id) {
          // Best-effort; the column is the canonical signal Settings reads.
          import('../lib/supabase').then(({ supabase }) => {
            supabase.from('profiles').update({ health_sync_enabled: true }).eq('id', user.id).then(() => {});
          }).catch(() => {});
        }
      }
      if (gotAny) {
        showToast(
          t('readinessModal.connectHealthSuccess', 'Apple Health connected'),
          'success',
        );
      } else if (granted) {
        // Permission flow ran but no recovery data is available yet —
        // typical on a fresh install or watchOS that hasn't synced sleep/HRV.
        showToast(
          t('readinessModal.connectHealthNoData', 'Permissions granted — no recovery data yet'),
          'info',
        );
      } else {
        showToast(
          t('readinessModal.connectHealthDenied', 'Health permissions not granted'),
          'error',
        );
        onClose?.();
        navigate('/health-sync');
      }
    } catch {
      // Native call blew up — fall back to the dedicated page so the user
      // can troubleshoot from a stable surface.
      onClose?.();
      navigate('/health-sync');
    }
  }, [navigate, onClose, showToast, t]);

  const handleApplyDeload = useCallback(() => {
    try {
      localStorage.setItem(
        'recovery_deload_pending_v1',
        JSON.stringify({ factor: 0.9, setAt: Date.now(), reason: 'low_recovery' })
      );
    } catch { /* ignore storage errors */ }
    setDeloadDismissed(true);
  }, []);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (selected) setSelected(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, selected]);

  // Drag-to-dismiss for the main sheet (anchored to the grip area).
  // MUST be called before any conditional return — otherwise the hook count
  // changes between renders depending on `open` and React errors with
  // "Rendered more hooks than during the previous render".
  const sheetDrag = useDragToDismiss({ onDismiss: onClose, threshold: 120 });

  if (!open) return null;

  const today = new Date().toLocaleDateString(
    i18n.language === 'es' ? 'es-ES' : 'en-US',
    {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    },
  );

  // Toggle filter chip
  const handleFilterChip = (state) => {
    setFilterState((prev) => (prev === state ? null : state));
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('readinessModal.dialogLabel', { defaultValue: 'Recovery readiness' })}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(10,13,16,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        animation: 'rd-fadeIn 200ms ease',
      }}
    >
      <style>{`
        @keyframes rd-fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rd-slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes rd-flip-left {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes rd-flip-right {
          from { transform: translateX(-40px); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        @keyframes rd-hot {
          0%, 100% { fill-opacity: 0.55; }
          50%      { fill-opacity: 0.85; }
        }
        @keyframes rd-zoomIn {
          from { transform: scale(0.96) translateY(-4px); opacity: 0; }
          to   { transform: scale(1) translateY(0);       opacity: 1; }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '92vh',
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--color-bg-card, #FAFAF7)',
          color: 'var(--color-text-primary)',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          fontFamily: FONT_BODY,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          // Skip the slideUp entry animation if user is mid-drag, else CSS
          // animation steals the transform.
          animation: sheetDrag.isDragging || sheetDrag.translateY > 0
            ? undefined
            : 'rd-slideUp 320ms cubic-bezier(0.2,0.8,0.2,1)',
          transform: `translateY(${sheetDrag.translateY}px)`,
          transition: sheetDrag.isDragging
            ? undefined
            : 'transform 200ms cubic-bezier(0.2,0.8,0.2,1)',
          boxShadow: '0 -12px 44px rgba(15,20,25,0.18), 0 -2px 8px rgba(15,20,25,0.08)',
          display: 'flex',
          flexDirection: 'column',
          willChange: 'transform',
        }}
      >
        {/* Grip — drag handle for swipe-to-dismiss. Bigger hit zone than the
            visual bar (24px tall) so it's easy to grab on mobile. */}
        <div
          {...sheetDrag.bind}
          style={{
            ...sheetDrag.bind.style,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 24,
            paddingTop: 10,
            cursor: 'grab',
          }}
        >
          <div
            style={{
              width: 44,
              height: 4,
              borderRadius: 2,
              background: 'var(--color-border-subtle, rgba(15,20,25,0.12))',
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '14px 22px 14px',
            borderBottom: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1.4,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
              }}
            >
              {today}
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 26,
                fontWeight: 900,
                letterSpacing: -0.6,
                color: 'var(--color-text-primary)',
                lineHeight: 1.05,
                marginTop: 2,
              }}
            >
              {t('readinessModal.title', { defaultValue: 'Recovery' })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 4,
                padding: '7px 12px',
                borderRadius: 999,
                background: 'var(--color-surface-hover, rgba(15,20,25,0.05))',
                border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
              }}
            >
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  fontWeight: 900,
                  color: 'var(--color-accent, #2EC4C4)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: -0.4,
                }}
              >
                {score}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: 'var(--color-text-muted)',
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                {t('readinessModal.ready', { defaultValue: 'ready' })}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('readinessModal.close', { defaultValue: 'Close' })}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                border: 'none',
                background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={17} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {/* Scrolling body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingBottom: 24,
          }}
        >
          {/* Coach line */}
          <div style={{ padding: '12px 22px 4px' }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: -0.5,
                lineHeight: 1.2,
                color: 'var(--color-text-primary)',
              }}
            >
              {coach.left}{' '}
              <span style={{ color: STATE_HEX.fatigued }}>{coach.leftStrong}</span>
              {coach.right && (
                <>
                  <br />
                  {coach.right}{' '}
                  <span style={{ color: STATE_HEX.fresh }}>{coach.rightStrong}</span>
                </>
              )}
            </div>
          </div>

          {/* Figure */}
          <div style={{ padding: '12px 22px 8px' }}>
            <Figure
              view={view}
              setView={setView}
              selected={selected}
              onSelect={setSelected}
              readiness={readiness}
              filterState={filterState}
              t={t}
            />
          </div>

          {/* Inline detail card for the selected muscle — sits directly
              below the figure so the tapped polygon and its breakdown are
              visible at the same time. */}
          {selected && (
            <DetailSheet
              bucketId={selected}
              readiness={readiness}
              onClose={() => setSelected(null)}
              regionLabels={regionLabels}
              t={t}
              i18n={i18n}
              onAppend={(ex) => setSuggestionForAppend(ex)}
            />
          )}

          {/* Filter chips — clickable */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '4px 22px 8px',
            }}
          >
            <FilterChip
              icon={Flame}
              count={counts.fatigued}
              label={t('readinessModal.filterSore', { defaultValue: 'sore' })}
              color={STATE_HEX.fatigued}
              active={filterState === 'fatigued'}
              onClick={() => handleFilterChip('fatigued')}
            />
            <FilterChip
              icon={Zap}
              count={counts.moderate}
              label={t('readinessModal.filterRecovering', { defaultValue: 'recovering' })}
              color={STATE_HEX.moderate}
              active={filterState === 'moderate'}
              onClick={() => handleFilterChip('moderate')}
            />
            <FilterChip
              icon={Leaf}
              count={counts.fresh}
              label={t('readinessModal.filterFresh', { defaultValue: 'fresh' })}
              color={STATE_HEX.fresh}
              active={filterState === 'fresh'}
              onClick={() => handleFilterChip('fresh')}
            />
          </div>

          {filterState && (
            <div style={{ padding: '0 22px 8px' }}>
              <button
                type="button"
                onClick={() => setFilterState(null)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 12,
                  border: '1px dashed var(--color-border-subtle)',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  fontFamily: FONT_BODY,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {t('readinessModal.showAllMuscles', { defaultValue: 'Show all muscles' })}
              </button>
            </div>
          )}

          {/* Watch-out callout */}
          {mostFatigued && (
            <div
              style={{
                margin: '12px 22px 0',
                padding: 14,
                borderRadius: 18,
                background: `color-mix(in srgb, ${STATE_HEX.fatigued} 8%, var(--color-bg-card))`,
                border: `1px solid color-mix(in srgb, ${STATE_HEX.fatigued} 22%, transparent)`,
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `color-mix(in srgb, ${STATE_HEX.fatigued} 18%, transparent)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={18} strokeWidth={2.4} style={{ color: STATE_HEX.fatigued }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: 1.4,
                    color: STATE_HEX.fatigued,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('readinessModal.watchOut', { defaultValue: 'Watch out' })}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 14,
                    fontWeight: 800,
                    color: 'var(--color-text-primary)',
                    letterSpacing: -0.2,
                    marginTop: 2,
                    lineHeight: 1.3,
                  }}
                >
                  {t('readinessModal.needRecoveryTime', { muscle: bucketLabel(mostFatigued.bucket, t), defaultValue: `${bucketLabel(mostFatigued.bucket, t)} need recovery time` })}
                </div>
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    marginTop: 4,
                    lineHeight: 1.45,
                  }}
                >
                  {t('readinessModal.recoveryHint', {
                    pct: mostFatigued.agg.recovery,
                    sets: mostFatigued.agg.sets.toFixed(1),
                    defaultValue: `${mostFatigued.agg.recovery}% recovered · ${mostFatigued.agg.sets.toFixed(1)} sets this week. Skip targeted work today and let it bounce back.`,
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Recovery factor cards — Sleep, HRV/RHR, Training Load */}
          {(recovery || healthAvailable === false || healthDenied) && (
            <div style={{ padding: '12px 22px 0' }}>
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 1.4,
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {t('readinessModal.factorsTitle', 'Recovery breakdown')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Sleep */}
                <FactorCard
                  Icon={Moon}
                  label={t('readinessModal.sleep', 'Sleep')}
                  score={recovery?.factors?.sleep ?? null}
                  sublabel={
                    typeof recoveryMetrics?.sleepHours === 'number'
                      ? recoveryMetrics?.sleepIsAverage
                        ? `${recoveryMetrics.sleepHours.toFixed(1)}${t('readinessModal.hours', 'h')} · ${t('readinessModal.sleepAvgLabel', '7d avg')}`
                        : `${recoveryMetrics.sleepHours.toFixed(1)}${t('readinessModal.hours', 'h')}`
                      : t('readinessModal.noSleepLastNight', 'No data last night')
                  }
                  delay={0}
                />
                {/* Wellness check-in (subjective soreness 1-10). Replaces
                    the Apple-Watch-only HRV/RHR card so every user gets a
                    real recovery signal. Tap → open the check-in modal. */}
                <button
                  type="button"
                  onClick={() => setShowWellnessCheckin(true)}
                  aria-label={t('readinessModal.wellnessTap', 'Log today\'s soreness')}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <FactorCard
                    Icon={Heart}
                    label={t('readinessModal.wellness', 'Wellness')}
                    score={recovery?.factors?.wellness ?? null}
                    sublabel={
                      typeof todayWellness?.soreness === 'number'
                        ? t('readinessModal.sorenessVal', { value: todayWellness.soreness, defaultValue: 'Soreness {{value}}/10' })
                        : t('readinessModal.tapToLog', 'Tap to log')
                    }
                    delay={50}
                  />
                </button>
                {/* Training load */}
                <FactorCard
                  Icon={Dumbbell}
                  label={t('readinessModal.trainingLoad', 'Training Load')}
                  score={trainingLoadScore}
                  sublabel={`${trainingLoadScore} / 100`}
                  delay={100}
                />
              </div>
            </div>
          )}

          {/* How is this calculated? */}
          {(recovery || healthAvailable === false || healthDenied) && (
            <HowCalculated t={t} />
          )}

          {/* Connect Apple Health / Google Fit CTA — only show when the user
              has NOT already connected via Settings → Health. Once connected,
              we trust the Settings page's state and avoid prompting again
              even if no recovery data has flowed yet. */}
          {!healthConnected && (healthDenied || (healthAvailable && !recovery)) && (
            <ConnectHealthCard t={t} onConnect={handleConnectHealth} />
          )}

          {/* Low-recovery deload prompt (score < 40) */}
          {!deloadDismissed && typeof score === 'number' && score < 40 && (
            <LowRecoveryBanner
              t={t}
              score={score}
              onApplyDeload={handleApplyDeload}
              onDismiss={() => setDeloadDismissed(true)}
            />
          )}

          {/* Empty state */}
          {sessions.length === 0 && (
            <div
              style={{
                margin: '12px 22px 0',
                padding: 16,
                borderRadius: 18,
                background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                border: '1px dashed var(--color-border-subtle, rgba(15,20,25,0.12))',
                textAlign: 'center',
              }}
            >
              <Moon size={20} strokeWidth={2} style={{ color: 'var(--color-text-muted)', marginBottom: 6 }} />
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  fontWeight: 800,
                  color: 'var(--color-text-primary)',
                  letterSpacing: -0.2,
                }}
              >
                {t('readinessModal.noWorkoutsTitle', { defaultValue: 'No workouts in the last 2 weeks' })}
              </div>
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  marginTop: 4,
                  lineHeight: 1.4,
                }}
              >
                {t('readinessModal.noWorkoutsBody', { defaultValue: 'All muscles are fully recovered. Time to lift.' })}
              </div>
            </div>
          )}
        </div>

      </div>
      <WellnessCheckinModal
        open={showWellnessCheckin}
        onClose={() => setShowWellnessCheckin(false)}
        onSaved={(row) => {
          // Optimistic update so the Wellness card reflects the new value
          // immediately, before any re-fetch.
          setTodayWellness({ soreness: row.soreness, checkin_date: row.checkin_date, notes: row.notes ?? null });
        }}
      />
      <AppendToRoutineModal
        open={!!suggestionForAppend}
        exercise={suggestionForAppend}
        onClose={() => setSuggestionForAppend(null)}
      />
    </div>,
    document.body
  );
}

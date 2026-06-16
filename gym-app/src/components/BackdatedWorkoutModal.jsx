// BackdatedWorkoutModal.jsx
// -----------------------------------------------------------------------------
// "Log a past workout" — pick a routine OR add a blank session, pick a past
// date, briefly fill sets. Calls log_backdated_workout RPC which:
//   • inserts the session + exercises + sets at the chosen date
//   • does NOT touch streak_cache (anti-cheat)
//   • does NOT award XP/points
// The check-in safety net still works — if the user actually checked in that
// day, their streak was already maintained by the check-in trigger.
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown, Calendar, Save, Plus, Minus, Trash2, Check, Search, Pencil } from 'lucide-react';
import posthogClient from 'posthog-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useExerciseLibrary } from '../hooks/useSupabaseQuery';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

function nDaysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const emptyExerciseRow = () => ({
  key: Math.random().toString(36).slice(2),
  // exerciseId is set when the user picks from the library; null + isCustom
  // means they're typing a custom name that we'll save to their library on submit.
  exerciseId: null,
  name: '',
  isCustom: false,
  sets: [{ weight: '', reps: '' }],
});

// Generate an ID that fits the same convention used elsewhere in the app
// (custom_<timestamp>_<rand>). Use crypto.randomUUID when available so two
// inserts in the same millisecond can't collide on the random suffix.
function generateCustomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `custom_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    }
  } catch { /* fall through */ }
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function BackdatedWorkoutModal({ open, onClose, onSaved, routines = [], editingSession = null }) {
  // editingSession = a previously-completed workout being re-opened for edit.
  // Shape matches WorkoutLog's query: { id, name, routine_id, completed_at,
  // session_exercises: [{ exercise_id, snapshot_name, position,
  // session_sets: [{ set_number, weight_lbs, reps, is_completed }] }] }.
  // When provided, the modal hydrates state from it, swaps copy to "Edit
  // workout", and saves via soft-delete + re-log (24h backup for safety).
  const isEditing = !!editingSession;
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { data: exerciseLibrary = [] } = useExerciseLibrary();

  const [mode, setMode] = useState('routine'); // 'routine' | 'empty'
  const [routineId, setRoutineId] = useState('');
  // Routine mode rows share the empty-mode shape so users can add/remove and
  // even substitute "Other" custom exercises into a routine-based session.
  const [routineExercises, setRoutineExercises] = useState([]);
  const [date, setDate] = useState(nDaysAgoISO(1));
  const [emptyName, setEmptyName] = useState('');
  const [emptyExercises, setEmptyExercises] = useState([]); // [{ key, name, sets: [{w,r}] }]
  const [submitting, setSubmitting] = useState(false);
  const [routineMenuOpen, setRoutineMenuOpen] = useState(false);
  const routineMenuRef = useRef(null);

  const minDate = nDaysAgoISO(90);
  // Allow today as the upper bound when editing — covers sessions that were
  // logged today and re-opened for correction. The "yesterday" cap is only
  // about discouraging "logging today's workout via backfill" for new entries.
  const maxDate = isEditing ? new Date().toISOString().slice(0, 10) : nDaysAgoISO(1);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset transient state when the modal is reopened. In edit mode hydrate
  // from the source session instead of clearing — covers both routine-based
  // and one-off ("empty") sessions.
  useEffect(() => {
    if (!open) return;
    setRoutineMenuOpen(false);
    if (editingSession) {
      const isRoutine = !!editingSession.routine_id;
      const rows = (editingSession.session_exercises || [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((ex) => ({
          key: Math.random().toString(36).slice(2),
          exerciseId: ex.exercise_id || null,
          name: ex.snapshot_name || '',
          isCustom: !ex.exercise_id,
          sets: ((ex.session_sets || [])
            .filter((s) => s.is_completed)
            .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
            .map((s) => ({
              weight: s.weight_lbs != null ? String(s.weight_lbs) : '',
              reps: s.reps != null ? String(s.reps) : '',
            }))) || [{ weight: '', reps: '' }],
        }));
      setMode(isRoutine ? 'routine' : 'empty');
      setRoutineId(isRoutine ? editingSession.routine_id : '');
      if (isRoutine) {
        setRoutineExercises(rows.length ? rows : []);
        setEmptyExercises([emptyExerciseRow()]);
        setEmptyName('');
      } else {
        setEmptyExercises(rows.length ? rows : [emptyExerciseRow()]);
        setRoutineExercises([]);
        setEmptyName(editingSession.name || '');
      }
      const iso = (editingSession.completed_at || editingSession.started_at || '').slice(0, 10);
      setDate(iso || nDaysAgoISO(1));
      return;
    }
    setMode('routine');
    setRoutineId('');
    setRoutineExercises([]);
    setEmptyName('');
    setEmptyExercises([emptyExerciseRow()]);
    setDate(nDaysAgoISO(1));
  }, [open, editingSession]);

  // Close routine menu when clicking outside it
  useEffect(() => {
    if (!routineMenuOpen) return;
    const onClick = (e) => {
      if (routineMenuRef.current && !routineMenuRef.current.contains(e.target)) {
        setRoutineMenuOpen(false);
      }
    };
    // mousedown beats the picker button's onClick race
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
    };
  }, [routineMenuOpen]);

  // When routine changes, hydrate routineExercises into the unified row shape
  // (same as empty-mode rows: { key, exerciseId, name, isCustom, sets }).
  // This lets the user freely add/remove exercises in routine mode too.
  // In edit mode the session's actual logged sets are already hydrated by the
  // open-effect above, so this template-load is skipped to preserve them.
  useEffect(() => {
    if (mode !== 'routine' || !routineId) {
      if (!editingSession) setRoutineExercises([]);
      return;
    }
    if (editingSession && editingSession.routine_id === routineId) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name))')
        .eq('id', routineId)
        .maybeSingle();
      if (!alive) return;
      const exs = (data?.routine_exercises || [])
        .sort((a, b) => (a.position || 0) - (b.position || 0));
      const rows = exs.map((re) => {
        const target = Math.max(1, Number(re.target_sets) || 3);
        return {
          key: Math.random().toString(36).slice(2),
          exerciseId: re.exercise_id,
          name: re.exercises?.name || re.exercise_id,
          isCustom: false,
          sets: Array.from({ length: target }, () => ({ weight: '', reps: re.target_reps || '' })),
        };
      });
      setRoutineExercises(rows);
    })();
    return () => { alive = false; };
  }, [routineId, mode]);

  // ── Routine-mode editors ────────────────────────────────────────────────
  // Mirrors the empty-mode helpers but operates on `routineExercises`. Both
  // arrays share the same row shape so ExerciseCard works for both.
  const updateRoutineSet = (key, idx, field, val) => {
    setRoutineExercises(prev => prev.map(ex => {
      if (ex.key !== key) return ex;
      const arr = ex.sets.slice();
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...ex, sets: arr };
    }));
  };
  const addRoutineSet = (key) => setRoutineExercises(prev => prev.map(ex =>
    ex.key === key ? { ...ex, sets: [...ex.sets, { weight: '', reps: '' }] } : ex));
  const removeRoutineSet = (key) => setRoutineExercises(prev => prev.map(ex =>
    ex.key === key && ex.sets.length > 1 ? { ...ex, sets: ex.sets.slice(0, -1) } : ex));
  const removeRoutineExercise = (key) => setRoutineExercises(prev => prev.filter(ex => ex.key !== key));
  const updateRoutineName = (key, val) => setRoutineExercises(prev =>
    prev.map(ex => ex.key === key ? { ...ex, name: val } : ex));
  const pickRoutineExercise = (key, libraryExercise) => setRoutineExercises(prev =>
    prev.map(ex => ex.key === key
      ? { ...ex, exerciseId: libraryExercise.id, name: libraryExercise.name, isCustom: false }
      : ex));
  const pickRoutineOther = (key) => setRoutineExercises(prev =>
    prev.map(ex => ex.key === key ? { ...ex, exerciseId: null, name: '', isCustom: true } : ex));
  const clearRoutinePick = (key) => setRoutineExercises(prev =>
    prev.map(ex => ex.key === key ? { ...ex, exerciseId: null, name: '', isCustom: false } : ex));
  const addRoutineExerciseRow = () => setRoutineExercises(prev => [...prev, {
    key: Math.random().toString(36).slice(2),
    exerciseId: null,
    name: '',
    isCustom: false,
    sets: [{ weight: '', reps: '' }],
  }]);

  // ── Empty-mode editors ──────────────────────────────────────────────────
  const updateEmptyName = (key, val) => {
    setEmptyExercises(prev => prev.map(ex => ex.key === key ? { ...ex, name: val } : ex));
  };
  // Pick an exercise from the library: lock id + name, clear custom flag
  const pickEmptyExercise = (key, libraryExercise) => {
    setEmptyExercises(prev => prev.map(ex => ex.key === key ? {
      ...ex,
      exerciseId: libraryExercise.id,
      name: libraryExercise.name,
      isCustom: false,
    } : ex));
  };
  // Switch the row into custom-name mode (will be saved as a new exercise on submit)
  const pickEmptyOther = (key) => {
    setEmptyExercises(prev => prev.map(ex => ex.key === key ? {
      ...ex,
      exerciseId: null,
      name: '',
      isCustom: true,
    } : ex));
  };
  // Reset back to "no exercise picked" — used by the swap button
  const clearEmptyExercise = (key) => {
    setEmptyExercises(prev => prev.map(ex => ex.key === key ? {
      ...ex,
      exerciseId: null,
      name: '',
      isCustom: false,
    } : ex));
  };
  const updateEmptySet = (key, idx, field, val) => {
    setEmptyExercises(prev => prev.map(ex => {
      if (ex.key !== key) return ex;
      const sArr = ex.sets.slice();
      sArr[idx] = { ...sArr[idx], [field]: val };
      return { ...ex, sets: sArr };
    }));
  };
  const addEmptySet = (key) => {
    setEmptyExercises(prev => prev.map(ex => ex.key === key ? { ...ex, sets: [...ex.sets, { weight: '', reps: '' }] } : ex));
  };
  const removeEmptySet = (key) => {
    setEmptyExercises(prev => prev.map(ex => ex.key === key && ex.sets.length > 1 ? { ...ex, sets: ex.sets.slice(0, -1) } : ex));
  };
  const addEmptyExercise = () => setEmptyExercises(prev => [...prev, emptyExerciseRow()]);
  const removeEmptyExercise = (key) => setEmptyExercises(prev => prev.filter(ex => ex.key !== key));

  // ── Totals ──────────────────────────────────────────────────────────────
  // Both modes now share the same row shape ({ sets: [{ weight, reps }] }).
  const { totalSets, totalVolume } = useMemo(() => {
    const rows = mode === 'routine' ? routineExercises : emptyExercises;
    let s = 0, v = 0;
    for (const ex of rows) {
      for (const set of ex.sets || []) {
        const w = parseFloat(set.weight) || 0;
        const r = parseInt(set.reps, 10) || 0;
        if (w > 0 || r > 0) s++;
        v += w * r;
      }
    }
    return { totalSets: s, totalVolume: v };
  }, [mode, routineExercises, emptyExercises]);

  // Every row that has logged sets must also have an identified exercise
  // (picked from library or a non-empty custom name). Applies to both modes
  // since they now share the same row shape.
  const rowsAreValid = useMemo(() => {
    const rows = mode === 'routine' ? routineExercises : emptyExercises;
    return rows.every(ex => {
      const hasSets = ex.sets.some(s =>
        (parseFloat(s.weight) || 0) > 0 || (parseInt(s.reps, 10) || 0) > 0
      );
      if (!hasSets) return true; // empty rows are ignored at save time
      return !!ex.exerciseId || (ex.isCustom && ex.name.trim().length > 0);
    });
  }, [mode, routineExercises, emptyExercises]);

  const canSave = !submitting
    && !!date
    && totalSets > 0
    && rowsAreValid
    && (mode === 'empty' || !!routineId);

  // Insert custom rows into the user's exercise library, returning a
  // key → new-id map so we can rewrite the payload with real exercise IDs.
  async function persistCustomRows(rows) {
    const customRows = rows.filter(ex => ex.isCustom && !ex.exerciseId);
    if (customRows.length === 0) return new Map();
    const inserts = await Promise.all(customRows.map(async (ex) => {
      const newId = generateCustomId();
      const { error: insertErr } = await supabase.from('exercises').insert({
        id: newId,
        gym_id: profile?.gym_id,        // RLS: must equal current_gym_id()
        created_by: user?.id,            // RLS: must equal auth.uid()
        name: ex.name.trim(),
        muscle_group: 'Full Body',
        equipment: 'Bodyweight',
        category: 'Strength',
        is_active: true,
      });
      if (insertErr) throw insertErr;
      return { key: ex.key, newId };
    }));
    return new Map(inserts.map(c => [c.key, c.newId]));
  }

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    try {
      const startedAt = new Date(date + 'T18:00:00');
      const completedAt = new Date(date + 'T19:00:00');

      // Both modes share the same row shape now — same filter + persist
      // dance for either path.
      const sourceRows = mode === 'routine' ? routineExercises : emptyExercises;
      const validRows = sourceRows
        .filter(ex => ex.sets.some(s => (parseFloat(s.weight) || 0) > 0 || (parseInt(s.reps, 10) || 0) > 0))
        .filter(ex => !!ex.exerciseId || (ex.isCustom && ex.name.trim().length > 0));

      const customIdByKey = await persistCustomRows(validRows);

      const exercisesPayload = validRows.map((ex, idx) => ({
        exercise_id: ex.exerciseId || customIdByKey.get(ex.key) || null,
        name: ex.name.trim(),
        position: idx,
        sets: ex.sets
          .filter(s => (parseFloat(s.weight) || 0) > 0 || (parseInt(s.reps, 10) || 0) > 0)
          .map(s => ({ weight: parseFloat(s.weight) || 0, reps: parseInt(s.reps, 10) || 0 })),
      }));

      let payload;
      if (mode === 'routine') {
        const routine = routines.find(r => r.id === routineId);
        payload = {
          routine_id: routineId,
          routine_name: routine?.name || `${t('backdatedWorkout.workoutWord', 'Workout')} · ${
            startedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          }`,
          started_at: startedAt.toISOString(),
          completed_at: completedAt.toISOString(),
          duration_seconds: 3600,
          total_volume_lbs: totalVolume,
          completed_sets: totalSets,
          exercises: exercisesPayload,
        };
      } else {
        // Default name is "Workout · <Apr 27>"-style when the user leaves
        // the field blank — gives backfilled sessions a more useful label
        // than "Free workout" in history lists.
        const defaultName = `${t('backdatedWorkout.workoutWord', 'Workout')} · ${
          startedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        }`;
        payload = {
          routine_id: null,
          routine_name: emptyName.trim() || defaultName,
          started_at: startedAt.toISOString(),
          completed_at: completedAt.toISOString(),
          duration_seconds: 3600,
          total_volume_lbs: totalVolume,
          completed_sets: totalSets,
          exercises: exercisesPayload,
        };
      }

      // Edit mode: soft-delete the original (creates a 24h backup) before
      // re-logging the new state. The user can still restore the previous
      // version from the "Recently deleted" modal if they need to undo.
      if (isEditing && editingSession?.id) {
        const { error: delErr } = await supabase.rpc('soft_delete_workout_session', {
          p_session_id: editingSession.id,
        });
        if (delErr) throw delErr;
      }

      const { data, error } = await supabase.rpc('log_backdated_workout', { p_payload: payload });
      if (error) throw error;
      try {
        posthogClient?.capture('workout_logged_backdated', {
          is_edit: isEditing,
          sets: totalSets,
          exercises: exercisesPayload.length,
        });
      } catch { /* noop */ }
      onSaved?.(data);
      try { window.dispatchEvent(new CustomEvent('tugympr:workouts-changed')); } catch { /* noop */ }
      onClose?.();
    } catch (err) {
      // Never render raw DB errors to members — log for diagnosis, show a
      // human message. Server rejections carry a PG/PostgREST code; anything
      // else is network-ish ("TypeError: Load failed").
      console.error('[backdated workout] save failed:', err);
      const code = String(err?.code || '').trim();
      const isServerReject = /^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code);
      // eslint-disable-next-line no-alert
      alert(isServerReject
        ? t('backdatedWorkout.saveFailed', { defaultValue: 'Failed to save' })
        : t('progress.body.connectionError', 'No connection — try again when you’re back online.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // ── Reusable styles ──────────────────────────────────────────────────────
  // Tokens align with MyPlanModal / ReadinessModal / dashboard surfaces — all
  // light, warm-paper aesthetic. Previous version mixed dark-theme fallbacks
  // (rgba(255,255,255,…), rgba(0,0,0,0.18)) which clashed against the cream bg.
  const labelStyle = {
    fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase',
    color: 'var(--color-text-muted)', display: 'block', marginBottom: 6,
  };
  const inputBase = {
    width: '100%', padding: '11px 12px', borderRadius: 12,
    fontSize: 15, fontWeight: 700,
    background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
    border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
    color: 'var(--color-text-primary)', outline: 'none',
    fontFamily: FONT_DISPLAY,
    boxSizing: 'border-box',
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(10,13,16,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        fontFamily: FONT_BODY,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--color-bg-card, #FAFAF7)',
          borderRadius: 28,
          overflow: 'hidden',
          border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
          boxShadow: '0 30px 80px rgba(15,20,25,0.18), 0 8px 24px rgba(15,20,25,0.06)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: '18px 20px 14px',
            borderBottom: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--color-accent)', textTransform: 'uppercase' }}>
              {isEditing
                ? t('backdatedWorkout.eyebrowEdit', 'Edit workout')
                : t('backdatedWorkout.eyebrow', 'Log past workout')}
            </p>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: 'var(--color-text-primary)', marginTop: 4, lineHeight: 1.1 }}>
              {isEditing
                ? t('backdatedWorkout.titleEdit', 'Edit this session')
                : t('backdatedWorkout.title', 'Backfill a session')}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {t('backdatedWorkout.streakDisclaimer', 'Past entries don\u2019t add to your streak — just your stats.')}
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label={t('backdatedWorkout.close', { defaultValue: 'Close' })}
            style={{
              width: 36, height: 36, borderRadius: 18,
              background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
              border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
              color: 'var(--color-text-primary)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginLeft: 8, cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 16, WebkitOverflowScrolling: 'touch', minWidth: 0 }}>
          {/* Mode toggle */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
              padding: 4, borderRadius: 14,
              background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
              border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
              marginBottom: 16,
            }}
          >
            {[
              { id: 'routine', label: t('backdatedWorkout.modeRoutine', 'From a routine') },
              { id: 'empty', label: t('backdatedWorkout.modeEmpty', 'Empty session') },
            ].map(opt => {
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  style={{
                    padding: '10px 8px', borderRadius: 10,
                    background: active ? 'var(--color-bg-card, #FAFAF7)' : 'transparent',
                    border: active ? '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))' : '1px solid transparent',
                    color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: 0.2,
                    boxShadow: active ? '0 1px 2px rgba(15,20,25,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Date */}
          <label style={labelStyle}>{t('backdatedWorkout.dateLabel', 'Date')}</label>
          <div style={{ position: 'relative', marginBottom: 14, minWidth: 0 }}>
            <Calendar size={14} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--color-accent)', pointerEvents: 'none', zIndex: 1 }} />
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              // iOS Safari gives <input type="date"> an intrinsic min-width
              // (the placeholder "MM/DD/YYYY" hint area) that pushes the field
              // wider than the parent. Force min-width:0 + display:block so it
              // respects the 100% width from inputBase.
              style={{
                ...inputBase,
                paddingLeft: 34,
                minWidth: 0,
                maxWidth: '100%',
                display: 'block',
                WebkitAppearance: 'none',
                appearance: 'none',
              }}
            />
          </div>

          {mode === 'routine' ? (
            <>
              {/* Routine picker — custom dropdown so the options list is
                  bounded by max-height + scroll instead of relying on the
                  browser's native <select> popover (which on iOS/Android can
                  balloon off-screen with many routines). */}
              <label style={labelStyle}>{t('backdatedWorkout.routineLabel', 'Routine')}</label>
              {(() => {
                const selectedRoutine = routines.find(r => r.id === routineId);
                const placeholder = t('backdatedWorkout.selectRoutine', 'Select a routine\u2026');
                const cleanName = (n) => (n || '').replace(/^Auto: /, '');
                return (
                  <div ref={routineMenuRef} style={{ position: 'relative', marginBottom: 14 }}>
                    <button
                      type="button"
                      onClick={() => setRoutineMenuOpen(o => !o)}
                      aria-haspopup="listbox"
                      aria-expanded={routineMenuOpen}
                      style={{
                        ...inputBase,
                        paddingRight: 34,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: selectedRoutine
                          ? 'var(--color-text-primary)'
                          : 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {selectedRoutine ? cleanName(selectedRoutine.name) : placeholder}
                    </button>
                    <ChevronDown
                      size={16}
                      style={{
                        position: 'absolute', right: 12, top: 14,
                        color: 'var(--color-text-muted)',
                        pointerEvents: 'none',
                        transition: 'transform 160ms',
                        transform: routineMenuOpen ? 'rotate(180deg)' : 'rotate(0)',
                      }}
                    />
                    {routineMenuOpen && (
                      <div
                        role="listbox"
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 6px)',
                          left: 0,
                          right: 0,
                          maxHeight: 240,
                          overflowY: 'auto',
                          background: 'var(--color-bg-card, #FAFAF7)',
                          border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))',
                          borderRadius: 14,
                          boxShadow: '0 12px 36px rgba(15,20,25,0.14), 0 2px 8px rgba(15,20,25,0.06)',
                          padding: 4,
                          zIndex: 5,
                        }}
                      >
                        {routines.length === 0 ? (
                          <div
                            style={{
                              padding: '12px 14px',
                              fontSize: 13, fontWeight: 600,
                              color: 'var(--color-text-muted)',
                              textAlign: 'center',
                            }}
                          >
                            {t('backdatedWorkout.noRoutines', 'No routines yet')}
                          </div>
                        ) : (
                          routines.map(r => {
                            const active = r.id === routineId;
                            return (
                              <button
                                key={r.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                  setRoutineId(r.id);
                                  setRoutineMenuOpen(false);
                                }}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  borderRadius: 10,
                                  border: 'none',
                                  background: active
                                    ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                                    : 'transparent',
                                  color: active
                                    ? 'var(--color-accent)'
                                    : 'var(--color-text-primary)',
                                  fontFamily: FONT_DISPLAY,
                                  fontSize: 14,
                                  fontWeight: active ? 800 : 600,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  transition: 'background 120ms',
                                }}
                                onMouseEnter={(e) => {
                                  if (!active) e.currentTarget.style.background =
                                    'var(--color-surface-hover, rgba(15,20,25,0.05))';
                                }}
                                onMouseLeave={(e) => {
                                  if (!active) e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {cleanName(r.name)}
                                </span>
                                {active && (
                                  <Check size={14} strokeWidth={2.6} style={{ flexShrink: 0 }} />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Routine exercises — editable list. User can swap, delete,
                  or add exercises (including custom ones via "Other"). */}
              {routineExercises.length > 0 && (
                <>
                  <label style={labelStyle}>{t('backdatedWorkout.setsLabel', 'Sets')}</label>
                  {routineExercises.map((re) => (
                    <ExerciseCard
                      key={re.key}
                      exerciseRow={re}
                      exerciseLibrary={exerciseLibrary}
                      onPickFromLibrary={(libEx) => pickRoutineExercise(re.key, libEx)}
                      onPickOther={() => pickRoutineOther(re.key)}
                      onClearPick={() => clearRoutinePick(re.key)}
                      onTitleChange={(val) => updateRoutineName(re.key, val)}
                      onDelete={() => removeRoutineExercise(re.key)}
                      sets={re.sets}
                      onUpdate={(idx, field, val) => updateRoutineSet(re.key, idx, field, val)}
                      onAdd={() => addRoutineSet(re.key)}
                      onRemove={() => removeRoutineSet(re.key)}
                      canRemove={re.sets.length > 1}
                      t={t}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={addRoutineExerciseRow}
                    style={{
                      width: '100%', padding: '11px 10px', borderRadius: 12,
                      background: 'transparent',
                      border: '1px dashed var(--color-border-subtle, rgba(15,20,25,0.18))',
                      color: 'var(--color-text-muted)',
                      fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: 0.4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      marginTop: 4, cursor: 'pointer',
                    }}
                  >
                    <Plus size={13} /> {t('backdatedWorkout.addExercise', 'Add exercise')}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {/* Empty: name + custom exercises */}
              <label style={labelStyle}>{t('backdatedWorkout.workoutNameLabel', 'Workout name (optional)')}</label>
              <input
                type="text"
                value={emptyName}
                onChange={(e) => setEmptyName(e.target.value)}
                placeholder={t('backdatedWorkout.workoutNamePlaceholder', 'e.g. Quick lift, Cardio + abs\u2026')}
                maxLength={60}
                style={{ ...inputBase, marginBottom: 14 }}
              />

              <label style={labelStyle}>{t('backdatedWorkout.exercisesLabel', 'Exercises')}</label>
              {emptyExercises.map((ex) => (
                <ExerciseCard
                  key={ex.key}
                  exerciseRow={ex}
                  exerciseLibrary={exerciseLibrary}
                  onPickFromLibrary={(libEx) => pickEmptyExercise(ex.key, libEx)}
                  onPickOther={() => pickEmptyOther(ex.key)}
                  onClearPick={() => clearEmptyExercise(ex.key)}
                  onTitleChange={(val) => updateEmptyName(ex.key, val)}
                  onDelete={emptyExercises.length > 1 ? () => removeEmptyExercise(ex.key) : null}
                  sets={ex.sets}
                  onUpdate={(idx, field, val) => updateEmptySet(ex.key, idx, field, val)}
                  onAdd={() => addEmptySet(ex.key)}
                  onRemove={() => removeEmptySet(ex.key)}
                  canRemove={ex.sets.length > 1}
                  t={t}
                />
              ))}
              <button
                type="button"
                onClick={addEmptyExercise}
                style={{
                  width: '100%', padding: '11px 10px', borderRadius: 12,
                  background: 'transparent',
                  border: '1px dashed var(--color-border-subtle, rgba(15,20,25,0.18))',
                  color: 'var(--color-text-muted)',
                  fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: 0.4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  marginTop: 4, cursor: 'pointer',
                }}
              >
                <Plus size={13} /> {t('backdatedWorkout.addExercise', 'Add exercise')}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: 14,
            borderTop: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            background: 'var(--color-bg-card, #FAFAF7)',
            flexShrink: 0,
            paddingBottom: `calc(14px + env(safe-area-inset-bottom, 0px))`,
          }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            style={{
              width: '100%', padding: '14px',
              borderRadius: 999, border: 'none',
              background: 'var(--color-accent)',
              color: 'var(--color-text-on-accent, #001512)',
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 14, letterSpacing: 0.4,
              opacity: !canSave ? 0.45 : 1,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent) 35%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              cursor: !canSave ? 'not-allowed' : 'pointer',
            }}
          >
            <Save size={15} />
            {submitting
              ? t('backdatedWorkout.saving', 'Saving\u2026')
              : isEditing
              ? t('backdatedWorkout.saveEdit', 'Save changes')
              : t('backdatedWorkout.save', { count: totalSets, defaultValue: `Log ${totalSets} ${totalSets === 1 ? 'set' : 'sets'}` })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Reusable per-exercise card ────────────────────────────────────────────
//
// Two modes:
//
// 1. Routine mode — passes `title` (string). Title is read-only.
//
// 2. Empty mode — passes `exerciseRow` + `exerciseLibrary` + picker callbacks.
//    The card shows an exercise *picker* trigger; on tap it opens an inline
//    popover with a search input, the matching library exercises, and an
//    "Other" option. "Other" flips the title slot into a free-text input
//    (the parent will save that as a new custom exercise on submit).
function ExerciseCard({
  // routine mode
  title,
  // empty mode
  exerciseRow, exerciseLibrary,
  onPickFromLibrary, onPickOther, onClearPick,
  // shared
  titlePlaceholder, onTitleChange, onDelete,
  sets, onUpdate, onAdd, onRemove, canRemove, t,
}) {
  const isEmptyMode = !!exerciseRow;
  const titleText = isEmptyMode ? exerciseRow.name : title;
  const showCustomInput = isEmptyMode && exerciseRow.isCustom && !exerciseRow.exerciseId;
  const hasPickedFromLibrary = isEmptyMode && !!exerciseRow.exerciseId;
  // Set-input field — solid surface against the surrounding tile, with a
  // subtle border. The previous version used rgba(0,0,0,0.18) which read as a
  // dark hole on the cream card.
  const setInputStyle = {
    flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 10,
    background: 'var(--color-bg-card, #FAFAF7)',
    border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))',
    color: 'var(--color-text-primary)', fontSize: 15, fontWeight: 700,
    outline: 'none', textAlign: 'center', boxSizing: 'border-box',
  };
  return (
    <div
      style={{
        background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
        borderRadius: 14, padding: 12, marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {isEmptyMode ? (
          showCustomInput ? (
            // "Other" was picked — render text input + a small custom badge
            // and a "swap" button to revert to the picker.
            <>
              <input
                type="text"
                value={titleText}
                onChange={(e) => onTitleChange?.(e.target.value)}
                placeholder={titlePlaceholder || t('backdatedWorkout.exerciseNamePlaceholder', 'Exercise name')}
                maxLength={60}
                autoFocus
                style={{
                  flex: 1, minWidth: 0, padding: '6px 0',
                  background: 'transparent', border: 'none', outline: 'none',
                  fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                  color: 'var(--color-text-primary)',
                  borderBottom: '1px solid var(--color-accent)',
                }}
              />
              <span
                style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.8,
                  padding: '3px 7px', borderRadius: 999,
                  background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                  color: 'var(--color-accent)',
                  textTransform: 'uppercase', flexShrink: 0,
                }}
              >
                {t('backdatedWorkout.customBadge', 'New')}
              </span>
              <button
                type="button"
                onClick={onClearPick}
                aria-label={t('backdatedWorkout.chooseDifferent', { defaultValue: 'Choose different exercise' })}
                style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: 'transparent',
                  border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))',
                  color: 'var(--color-text-muted)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <ChevronDown size={12} />
              </button>
            </>
          ) : (
            <ExercisePickerTrigger
              currentName={hasPickedFromLibrary ? titleText : ''}
              exerciseLibrary={exerciseLibrary || []}
              onPick={onPickFromLibrary}
              onPickOther={onPickOther}
              onClearPick={onClearPick}
              hasPicked={hasPickedFromLibrary}
              t={t}
            />
          )
        ) : (
          <p style={{
            flex: 1, minWidth: 0,
            fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
            color: 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </p>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('backdatedWorkout.removeExercise', { defaultValue: 'Remove exercise' })}
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))',
              color: 'var(--color-text-muted)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {sets.map((s, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 18, fontWeight: 800 }}>
            {idx + 1}
          </span>
          <input
            type="number" inputMode="decimal" step="0.5"
            placeholder={t('backdatedWorkout.lb', 'lb')}
            value={s.weight}
            onChange={(e) => onUpdate(idx, 'weight', e.target.value)}
            style={setInputStyle}
          />
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 800, fontSize: 11 }}>×</span>
          <input
            type="number" inputMode="numeric"
            placeholder={t('backdatedWorkout.reps', 'reps')}
            value={s.reps}
            onChange={(e) => onUpdate(idx, 'reps', e.target.value)}
            style={setInputStyle}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          type="button" onClick={onAdd}
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 10,
            background: 'transparent',
            border: '1px dashed var(--color-border-subtle, rgba(15,20,25,0.16))',
            color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            cursor: 'pointer',
          }}
        >
          <Plus size={11} /> {t('backdatedWorkout.addSet', 'Add set')}
        </button>
        {canRemove && (
          <button
            type="button" onClick={onRemove}
            aria-label={t('backdatedWorkout.removeLastSet', { defaultValue: 'Remove last set' })}
            style={{
              padding: '6px 10px', borderRadius: 10,
              background: 'transparent',
              border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))',
              color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Minus size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── ExercisePickerTrigger ─────────────────────────────────────────────────
// Inline button + popover. Tapping the button toggles a list with a search
// input + scrollable matches + "Other" option. Filters globally + by gym
// (visible exercises are already scoped via RLS in the parent's hook). Custom
// names get persisted to the user's library by the parent at save time.
function ExercisePickerTrigger({
  currentName, exerciseLibrary, onPick, onPickOther, onClearPick, hasPicked, t,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
    };
  }, [open]);

  // Auto-focus the search input when the popover opens
  useEffect(() => {
    if (open) {
      // Defer one tick so the input is mounted
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    setQuery('');
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (exerciseLibrary || []).filter(e => e.is_active !== false);
    if (!q) return list.slice(0, 80); // cap unfiltered list — keeps DOM lean
    return list.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.name_es || '').toLowerCase().includes(q) ||
      (e.muscle_group || '').toLowerCase().includes(q)
    ).slice(0, 80);
  }, [exerciseLibrary, query]);

  return (
    <div ref={wrapRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 0',
          background: 'transparent', border: 'none', outline: 'none',
          fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
          color: hasPicked ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          borderBottom: '1px solid var(--color-border-subtle, rgba(15,20,25,0.12))',
          textAlign: 'left', cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasPicked ? currentName : t('backdatedWorkout.pickExercise', 'Pick an exercise\u2026')}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--color-text-muted)',
            transition: 'transform 160ms',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            flexShrink: 0,
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0, right: 0,
            background: 'var(--color-bg-card, #FAFAF7)',
            border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.10))',
            borderRadius: 14,
            boxShadow: '0 12px 36px rgba(15,20,25,0.14), 0 2px 8px rgba(15,20,25,0.06)',
            padding: 4,
            zIndex: 5,
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 10px',
              background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
              border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
              borderRadius: 10,
              marginBottom: 4,
            }}
          >
            <Search size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('backdatedWorkout.searchExercise', 'Search exercises\u2026')}
              style={{
                flex: 1, minWidth: 0,
                background: 'transparent', border: 'none', outline: 'none',
                fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: '12px 12px',
                  fontSize: 12, fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  textAlign: 'center',
                }}
              >
                {t('backdatedWorkout.noMatches', 'No matches')}
              </div>
            ) : (
              filtered.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  role="option"
                  onClick={() => { onPick(ex); setOpen(false); }}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-primary)',
                    fontFamily: FONT_DISPLAY,
                    fontSize: 13, fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover, rgba(15,20,25,0.05))'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ex.name}
                  </span>
                  {ex.muscle_group && (
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      flexShrink: 0,
                    }}>
                      {ex.muscle_group}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* "Other" — pinned at the bottom */}
          <button
            type="button"
            onClick={() => { onPickOther(); setOpen(false); }}
            style={{
              width: '100%',
              padding: '10px 10px',
              borderRadius: 10,
              border: '1px dashed var(--color-border-subtle, rgba(15,20,25,0.16))',
              background: 'transparent',
              color: 'var(--color-accent)',
              fontFamily: FONT_DISPLAY,
              fontSize: 12, fontWeight: 800, letterSpacing: 0.4,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginTop: 4,
            }}
          >
            <Pencil size={12} />
            {t('backdatedWorkout.otherExercise', 'Other (custom name)')}
          </button>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, GripVertical, Dumbbell, Search, Calendar, Loader2, ChevronLeft, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getExercises } from '../lib/exerciseStore';
const ALL_EXERCISES = getExercises();
import { exName } from '../lib/exerciseName';
import ExerciseVideoThumb from './ExerciseVideoThumb';
// Tapping an exercise thumbnail opens its full info card — lazy so the large
// ExerciseLibrary module isn't bundled into the builder chunk until needed.
const ExerciseInfoCard = lazy(() => import('../pages/ExerciseLibrary').then(m => ({ default: m.ExerciseCard })));

// ── Member Program Builder ───────────────────────────────────────────────────
// "Crear programa" — build your own multi-day program WITHOUT auto-generation,
// or edit an auto-generated one. Trainer-builder editing UX (day cards, grip
// drag-to-reorder, inline picker) in the member palette. Saves into the existing
// member model: routines (named "Auto: …" so getRoutinesForWeek picks them up) +
// routine_exercises + workout_schedule + a uniform generated_programs.schedule_map
// so it schedules + launches exactly like an auto-generated program.

let _seq = 0;
const uid = (p = 'id') => `${p}-${++_seq}`;
const REST_OPTS = [30, 45, 60, 90, 120, 180];
const DURATIONS = [4, 6, 8, 12];
// DB day_of_week: Sunday=0 … Saturday=6
const DOW_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Clear 3-letter day labels (common.json days.mon = "Mon"/"Lun") — the lone
// weekdaysShort initials (M/T/W…, L/M/X…) are ambiguous, so use these instead.
const DOW_SHORT_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Pointer drag-to-reorder (same hook the trainer plan builder + routine editor use).
const DRAG_GAP = 10;
function useDragSort(ids, onReorder) {
  const [drag, setDrag] = useState(null);
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
      try { rowEl.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    };
    h.current = { start, end };
  }
  useEffect(() => () => h.current?.end?.(), []);
  const draggedTranslate = () => {
    if (!drag) return 0;
    const curIndex = latest.current.ids.indexOf(drag.id);
    return (drag.y - drag.startY) - (curIndex - drag.from) * (drag.h + DRAG_GAP);
  };
  return { dragId: drag?.id ?? null, draggedTranslate, start: h.current.start };
}

// ── Inline exercise picker (bottom sheet, live search, tap to add) ──
function ExercisePicker({ onAdd, onClose, t, lang }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ALL_EXERCISES
      .filter(ex => !needle || exName(ex).toLowerCase().includes(needle) || (ex.muscle || '').toLowerCase().includes(needle))
      .slice(0, 80);
  }, [q]);
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl flex flex-col"
        style={{ maxHeight: '82vh', background: 'var(--color-bg-card)', borderTopLeftRadius: 22, borderTopRightRadius: 22, border: '1px solid var(--color-border-subtle)' }}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--color-surface-hover)' }}>
            <Search size={16} style={{ color: 'var(--color-text-subtle)' }} />
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('programBuilder.searchExercises', 'Search exercises…')}
              className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
          <button onClick={onClose} aria-label={t('common:close', 'Close')} className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-3 flex flex-col gap-2">
          {list.map(ex => (
            <button
              key={ex.id} onClick={() => onAdd(ex)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
              style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
                <Dumbbell size={15} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{exName(ex)}</p>
                <p className="text-[11.5px] truncate" style={{ color: 'var(--color-text-subtle)' }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)}</p>
              </div>
              <Plus size={18} style={{ color: 'var(--color-accent)' }} />
            </button>
          ))}
          {list.length === 0 && (
            <p className="text-center text-[13px] py-10" style={{ color: 'var(--color-text-subtle)' }}>{t('programBuilder.noMatches', 'No exercises found')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One exercise row inside a day (grip + name + sets/reps/rest + remove) ──
function ExRow({ item, onChange, onRemove, onGripDown, isDragging, draggedTranslate, t, onShowInfo }) {
  const ex = useMemo(() => ALL_EXERCISES.find(e => e.id === item.id), [item.id]);
  return (
    <div
      data-dragitem={item._uid}
      className="rounded-xl"
      style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)',
        ...(isDragging ? { transform: `translateY(${draggedTranslate()}px)`, zIndex: 30, position: 'relative', boxShadow: '0 14px 30px rgba(0,0,0,0.3)' } : {}),
      }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          type="button" aria-label={t('workoutBuilder.ariaDragReorder', 'Drag to reorder')}
          onPointerDown={onGripDown}
          className="w-6 h-10 -ml-1 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing"
          style={{ color: 'var(--color-text-subtle)', touchAction: 'none' }}
        >
          <GripVertical size={17} />
        </button>
        <button type="button" onClick={() => ex && onShowInfo?.(ex)} disabled={!ex}
          aria-label={t('exerciseLibrary.viewInfo', 'View exercise info')}
          className="shrink-0 active:scale-95 transition-transform"
          style={{ background: 'none', border: 'none', padding: 0, display: 'flex', borderRadius: 10 }}>
          <ExerciseVideoThumb exercise={{ videoUrl: ex?.videoUrl, muscle: ex?.muscle }} size={38} radius={10} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{ex ? exName(ex) : item.id}</p>
          {ex?.muscle && (
            <p className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {t(`muscleGroups.${ex.muscle}`, ex.muscle)}{ex.equipment ? ` · ${t(`exerciseLibrary.equipmentNames.${ex.equipment}`, ex.equipment)}` : ''}
            </p>
          )}
        </div>
        <button type="button" onClick={onRemove} aria-label={t('workoutBuilder.ariaRemove', 'Remove')} className="w-9 h-9 flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className="grid grid-cols-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
        <label className="flex items-center justify-center gap-1.5 py-2 text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
          {t('workoutBuilder.sets', 'Sets')}
          <input type="number" inputMode="numeric" min={1} max={10} value={item.sets}
            onChange={(e) => onChange('sets', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
            className="w-9 rounded-md px-1 py-1 text-center text-[13px] font-bold outline-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-text-primary)' }} />
        </label>
        <label className="flex items-center justify-center gap-1.5 py-2 text-[12px]" style={{ color: 'var(--color-text-subtle)', borderLeft: '1px solid var(--color-border-subtle)', borderRight: '1px solid var(--color-border-subtle)' }}>
          {t('workoutBuilder.reps', 'Reps')}
          <input type="text" inputMode="numeric" value={item.reps}
            onChange={(e) => onChange('reps', e.target.value.slice(0, 7))}
            className="w-12 rounded-md px-1 py-1 text-center text-[13px] font-bold outline-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-text-primary)' }} />
        </label>
        <label className="flex items-center justify-center gap-1.5 py-2 text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
          {t('workoutBuilder.rest', 'Rest')}
          <select value={item.restSeconds} onChange={(e) => onChange('restSeconds', Number(e.target.value))}
            className="rounded-md px-1 py-1 text-center text-[13px] font-bold outline-none appearance-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-text-primary)' }}>
            {REST_OPTS.map(s => <option key={s} value={s}>{s < 60 ? `${s}s` : `${s / 60}m`}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

// ── A day card (name + day-of-week + exercises with drag) ──
function DayCard({ day, index, total, onName, onDow, onRemove, onAddExercise, onChangeEx, onRemoveEx, reorderEx, usedDows, t, lang, onShowInfo }) {
  const { dragId, draggedTranslate, start } = useDragSort(day.exercises.map(e => e._uid), reorderEx);
  const [open, setOpen] = useState(false); // collapsible day — default closed
  const dowLabel = t(`days.${DOW_SHORT_KEYS[day.dow]}`, { ns: 'common' });
  // Estimated minutes for the day — same model as the routine sheet
  // (sets × (rest + ~45s work) / 60).
  const dayMinutes = day.exercises.length
    ? Math.max(1, Math.round(day.exercises.reduce((s, ex) => s + ((Number(ex.sets) || 0) * ((Number(ex.restSeconds) || 60) + 45)), 0) / 60))
    : 0;
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')} className="w-8 h-8 -ml-1 flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
          <ChevronDown size={18} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .18s ease' }} />
        </button>
        <input
          value={day.name} onChange={(e) => onName(e.target.value)}
          placeholder={t('programBuilder.dayNamePlaceholder', { n: index + 1, defaultValue: `Day ${index + 1}` })}
          className="flex-1 min-w-0 bg-transparent outline-none text-[16px] font-bold"
          style={{ color: 'var(--color-text-primary)', fontFamily: "'Familjen Grotesk','Archivo',system-ui" }}
        />
        {total > 1 && (
          <button type="button" onClick={onRemove} aria-label={t('programBuilder.removeDay', 'Remove day')} className="w-9 h-9 flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {/* Collapsed summary — tap to expand */}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="w-full text-left mt-1.5 pl-7 text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
          {t('programBuilder.exercisesShort', { count: day.exercises.length, defaultValue: `${day.exercises.length} exercises` })}
          {dayMinutes ? ` · ~${dayMinutes} ${t('dashboard.min', 'min')}` : ''}
          {dowLabel ? ` · ${dowLabel}` : ''}
        </button>
      )}
      {open && (<>
      {/* Day of week selector */}
      <div className="flex gap-1.5 mb-3 mt-3 flex-wrap">
        {DOW_KEYS.map((key, dow) => {
          const selected = day.dow === dow;
          const taken = !selected && usedDows.has(dow);
          return (
            <button
              key={dow} type="button" disabled={taken} onClick={() => onDow(dow)}
              className="h-9 px-2.5 min-w-[2.75rem] rounded-lg text-[11.5px] font-bold disabled:opacity-30 transition-colors"
              style={selected
                ? { background: 'var(--color-accent)', color: 'var(--color-text-on-accent,#fff)' }
                : { background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
            >
              {t(`days.${DOW_SHORT_KEYS[dow]}`, { ns: 'common' })}
            </button>
          );
        })}
      </div>
      {/* Exercises (drag-reorder) */}
      <div className="flex flex-col gap-2.5" data-dragroot>
        {day.exercises.map((item) => (
          <ExRow
            key={item._uid} item={item}
            onChange={(field, val) => onChangeEx(item._uid, field, val)}
            onRemove={() => onRemoveEx(item._uid)}
            onGripDown={(e) => start(item._uid, e, e.currentTarget.closest('[data-dragitem]'))}
            isDragging={dragId === item._uid}
            draggedTranslate={draggedTranslate}
            t={t}
            onShowInfo={onShowInfo}
          />
        ))}
      </div>
      <button
        type="button" onClick={onAddExercise}
        className="w-full mt-2.5 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', border: '1px dashed color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-accent)' }}
      >
        <Plus size={16} /> {t('programBuilder.addExercise', 'Add exercise')}
      </button>
      </>)}
    </div>
  );
}

export default function MemberProgramBuilder({ onClose, onSaved, editProgram = null }) {
  const { t, i18n } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const lang = i18n.language;

  const [name, setName] = useState('');
  const [weeks, setWeeks] = useState(6);
  const [days, setDays] = useState(() => [{ _uid: uid('day'), name: '', dow: 1, exercises: [] }]);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editProgram);
  const [pickerDayUid, setPickerDayUid] = useState(null);
  const [error, setError] = useState('');
  // Shown when the user shortens an in-progress program on edit: choose whether
  // to shorten the current run (keep its start + progress) or start fresh.
  const [lowerPrompt, setLowerPrompt] = useState(false);
  const [infoExercise, setInfoExercise] = useState(null); // tapped thumbnail → exercise info card

  // Edit context: is this an ACTIVE program (in progress), how long was it, and
  // which week is the user currently on. Used to guard shortening the duration.
  const isEditingActive = !!editProgram && new Date(editProgram.expires_at) > new Date();
  const originalWeeks = editProgram ? (editProgram.duration_weeks || editProgram.schedule_map?.total_calendar_weeks || 6) : 0;
  const elapsedWeeks = isEditingActive
    ? Math.max(1, Math.min(originalWeeks, Math.floor((Date.now() - new Date(editProgram.program_start).getTime()) / (7 * 86400000)) + 1))
    : 0;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Edit mode: reconstruct the days from the program's routines + exercises ──
  useEffect(() => {
    if (!editProgram?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const sm = editProgram.schedule_map || {};
        const ids = Array.isArray(sm.routine_ids) && sm.routine_ids.length
          ? sm.routine_ids
          : (sm.routine_ids_a || []);
        const dayMap = {};
        (sm.routine_day_map || []).forEach((e) => { dayMap[e.routine_index] = e.day_of_week; });
        const [{ data: routs }, { data: exRows }] = await Promise.all([
          supabase.from('routines').select('id, name').in('id', ids.length ? ids : ['']),
          supabase.from('routine_exercises').select('routine_id, exercise_id, position, target_sets, target_reps, rest_seconds').in('routine_id', ids.length ? ids : ['']),
        ]);
        const byRoutine = {};
        (exRows || []).forEach((r) => { (byRoutine[r.routine_id] ||= []).push(r); });
        const loadedDays = ids.map((rid, i) => {
          const r = (routs || []).find(x => x.id === rid);
          if (!r) return null; // routine deleted (a newer program cleared it) — skip, don't show an empty day
          const exs = (byRoutine[rid] || []).sort((a, b) => a.position - b.position).map((re) => ({
            _uid: uid('ex'), id: re.exercise_id, sets: re.target_sets || 3, reps: String(re.target_reps || '8-12'), restSeconds: re.rest_seconds || 90,
          }));
          return { _uid: uid('day'), name: (r.name || '').replace(/^Auto:\s*/, ''), dow: dayMap[i] ?? ((i + 1) % 7), exercises: exs };
        }).filter(Boolean);
        if (!cancelled) {
          if (loadedDays.length) {
            setName(sm.display_name || editProgram.name || '');
            setWeeks(editProgram.duration_weeks || sm.total_calendar_weeks || 6);
            setDays(loadedDays);
          } else {
            // Every routine was cleared when a newer program started — nothing to
            // reconstruct, so surface it instead of an all-empty builder.
            showToast(t('programBuilder.editUnavailable', "This program's workouts are no longer available to edit. Resume it or start a new one."), 'error');
            onClose?.();
          }
        }
      } catch { /* fall back to a blank builder */ }
      finally { if (!cancelled) setLoadingEdit(false); }
    })();
    return () => { cancelled = true; };
  }, [editProgram]);

  const usedDows = useMemo(() => new Set(days.map(d => d.dow)), [days]);

  const addDay = () => {
    const free = [1, 3, 5, 2, 4, 6, 0].find(d => !usedDows.has(d)) ?? 1;
    setDays(prev => [...prev, { _uid: uid('day'), name: '', dow: free, exercises: [] }]);
  };
  const removeDay = (dUid) => setDays(prev => prev.filter(d => d._uid !== dUid));
  const setDayField = (dUid, field, val) => setDays(prev => prev.map(d => d._uid === dUid ? { ...d, [field]: val } : d));
  const addExerciseToDay = (dUid, ex) => setDays(prev => prev.map(d => d._uid === dUid
    ? { ...d, exercises: [...d.exercises, { _uid: uid('ex'), id: ex.id, sets: ex.defaultSets || 3, reps: String(ex.defaultReps || '8-12'), restSeconds: ex.restSeconds || 90 }] }
    : d));
  const changeEx = (dUid, exUid, field, val) => setDays(prev => prev.map(d => d._uid === dUid
    ? { ...d, exercises: d.exercises.map(e => e._uid === exUid ? { ...e, [field]: val } : e) } : d));
  const removeEx = (dUid, exUid) => setDays(prev => prev.map(d => d._uid === dUid ? { ...d, exercises: d.exercises.filter(e => e._uid !== exUid) } : d));
  const reorderEx = (dUid, orderedUids) => setDays(prev => prev.map(d => {
    if (d._uid !== dUid) return d;
    const byUid = new Map(d.exercises.map(e => [e._uid, e]));
    return { ...d, exercises: orderedUids.map(u => byUid.get(u)).filter(Boolean) };
  }));

  const handleSave = async (modeArg) => {
    if (!user?.id || !profile?.gym_id) return;
    if (!name.trim()) { setError(t('programBuilder.errName', 'Name your program')); return; }
    const validDays = days.filter(d => d.exercises.length > 0);
    if (validDays.length === 0) { setError(t('programBuilder.errEmpty', 'Add at least one exercise to a day')); return; }
    // Shortening an in-progress program: block going below the week already
    // reached, and otherwise ask whether to shorten the current run (keep its
    // start + progress) or start a fresh program from today.
    const lowering = isEditingActive && weeks < originalWeeks;
    if (lowering && weeks < elapsedWeeks) {
      setError(t('programBuilder.errWeeksBelowElapsed', { week: elapsedWeeks, defaultValue: `You're on week ${elapsedWeeks} — the program can't be shorter than that.` }));
      return;
    }
    if (lowering && modeArg !== 'current' && modeArg !== 'new') { setLowerPrompt(true); return; }
    // Editing an in-progress program updates it in place (keeps its start date and
    // progress). Only an explicit "start new" from the shorten prompt, a brand-new
    // program, or editing a past/expired one writes a fresh row starting today.
    const editInPlace = isEditingActive && modeArg !== 'new';
    setError('');
    setLowerPrompt(false);
    setSaving(true);
    try {
      const sorted = [...validDays].sort((a, b) => a.dow - b.dow);
      // Snapshot old Auto: routines (the previous active program) for cleanup AFTER.
      const { data: oldAuto } = await supabase.from('routines').select('id').eq('created_by', user.id).like('name', 'Auto:%');
      const oldIds = (oldAuto || []).map(r => r.id);
      // Expire any currently-active program so this becomes the active one. When
      // shortening the current program in place, keep it active (expire others).
      {
        let expireQ = supabase.from('generated_programs')
          .update({ expires_at: new Date().toISOString() })
          .eq('profile_id', user.id)
          .gt('expires_at', new Date().toISOString());
        if (editInPlace) expireQ = expireQ.neq('id', editProgram.id);
        await expireQ;
      }

      const startDate = new Date(); startDate.setHours(0, 0, 0, 0);
      const routineIds = [];
      for (const day of sorted) {
        const dayLabel = day.name.trim() || t('programBuilder.dayNamePlaceholder', { n: sorted.indexOf(day) + 1, defaultValue: `Day ${sorted.indexOf(day) + 1}` });
        const { data: r, error: rErr } = await supabase.from('routines')
          .insert({ name: `Auto: ${dayLabel}`, created_by: user.id, gym_id: profile.gym_id })
          .select('id').single();
        if (rErr || !r?.id) continue;
        routineIds.push(r.id);
        const rows = day.exercises.map((ex, i) => ({
          routine_id: r.id, exercise_id: ex.id, position: i + 1,
          target_sets: Number(ex.sets) || 3, target_reps: String(ex.reps || '8-12'),
          rest_seconds: Number(ex.restSeconds) || 90, group_id: null, group_type: null,
        }));
        if (rows.length) await supabase.from('routine_exercises').insert(rows);
        await supabase.from('workout_schedule').upsert({
          profile_id: user.id, gym_id: profile.gym_id, day_of_week: day.dow, routine_id: r.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,day_of_week' });
      }
      if (routineIds.length === 0) throw new Error('no routines created');

      const dows = sorted.map(d => d.dow);
      const scheduleMap = {
        routine_day_map: dows.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
        week1_map: dows.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
        last_week_map: [],
        start_dow: startDate.getDay(),
        week1_dows: dows,
        wrapped_dows: [],
        normal_dows: dows,
        routine_ids: routineIds,
        routine_ids_a: routineIds,
        routine_ids_b: routineIds,
        total_calendar_weeks: weeks,
        display_name: name.trim(),
      };
      if (editInPlace) {
        // Shorten the current run: keep the original start date + progress, just
        // swap in the rebuilt routines and pull the end date back to the new length.
        const origStart = new Date(editProgram.program_start);
        const expiresAt = new Date(origStart); expiresAt.setDate(expiresAt.getDate() + weeks * 7);
        scheduleMap.start_dow = origStart.getDay();
        const { error: gpErr } = await supabase.from('generated_programs').update({
          routines_a_count: sorted.length, duration_weeks: weeks, schedule_map: scheduleMap, expires_at: expiresAt.toISOString(),
        }).eq('id', editProgram.id);
        if (gpErr) throw gpErr;
      } else {
        const expiresAt = new Date(startDate); expiresAt.setDate(expiresAt.getDate() + weeks * 7);
        const { error: gpErr } = await supabase.from('generated_programs').insert({
          profile_id: user.id, gym_id: profile.gym_id, split_type: 'custom',
          program_start: startDate.toISOString(), expires_at: expiresAt.toISOString(),
          routines_a_count: sorted.length, duration_weeks: weeks, schedule_map: scheduleMap,
        });
        if (gpErr) throw gpErr;
      }

      // Clean up the previous program's Auto: routines now that the new ones exist.
      const newSet = new Set(routineIds);
      const toDelete = oldIds.filter(id => !newSet.has(id));
      if (toDelete.length) {
        await supabase.from('routine_exercises').delete().in('routine_id', toDelete);
        await supabase.from('workout_schedule').delete().in('routine_id', toDelete).then(() => {}, () => {});
        await supabase.from('routines').delete().in('id', toDelete);
      }

      try { window.dispatchEvent(new CustomEvent('tugympr:programs-changed')); } catch { /* ignore */ }
      showToast(editInPlace ? t('programBuilder.updated', 'Program updated') : t('programBuilder.saved', 'Program created'), 'success');
      onSaved?.();
    } catch (e) {
      console.error('[program builder] save failed:', e);
      showToast(t('programBuilder.saveFailed', 'Could not save program'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 flex-shrink-0" style={{ paddingTop: 'calc(12px + env(safe-area-inset-top,0px))', paddingBottom: 12, borderBottom: '1px solid var(--color-border-subtle)' }}>
        <button onClick={onClose} aria-label={t('common:back', 'Back')} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}>
          <ChevronLeft size={20} />
        </button>
        <h1 className="flex-1 text-[18px] font-extrabold truncate" style={{ color: 'var(--color-text-primary)', fontFamily: "'Familjen Grotesk','Archivo',system-ui", letterSpacing: -0.4 }}>
          {editProgram ? t('programBuilder.editTitle', 'Edit program') : t('programBuilder.title', 'Create program')}
        </h1>
        <button
          onClick={() => handleSave()} disabled={saving}
          className="px-4 h-10 rounded-xl text-[14px] font-bold disabled:opacity-50 flex items-center gap-2"
          style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent,#fff)' }}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          {t('programBuilder.save', 'Save')}
        </button>
      </div>

      {loadingEdit ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} /></div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom,0px))' }}>
          {/* Name */}
          <input
            value={name} onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder={t('programBuilder.namePlaceholder', 'Program name')}
            className="w-full rounded-xl px-4 py-3 text-[16px] font-bold outline-none mb-4"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)', fontFamily: "'Familjen Grotesk','Archivo',system-ui" }}
          />
          {/* Duration */}
          <div className="mb-4">
            <p className="text-[12px] uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('programBuilder.duration', 'Duration')}</p>
            <div className="flex gap-2 items-stretch flex-wrap">
              {DURATIONS.map(w => (
                <button key={w} onClick={() => setWeeks(w)}
                  className="flex-1 min-w-[52px] py-2.5 rounded-xl text-[13px] font-bold transition-colors"
                  style={weeks === w
                    ? { background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)', color: 'var(--color-accent)' }
                    : { background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                  {w}
                </button>
              ))}
              {/* Custom week count — type any 1–52 */}
              <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl"
                style={!DURATIONS.includes(weeks)
                  ? { background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)' }
                  : { background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
                <input
                  type="number" inputMode="numeric" min={1} max={52} value={weeks}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setWeeks(Math.max(1, Math.min(52, v))); }}
                  aria-label={t('programBuilder.customWeeks', 'Custom weeks')}
                  className="w-9 bg-transparent text-center text-[13px] font-bold outline-none"
                  style={{ color: !DURATIONS.includes(weeks) ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                />
                <span className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('programBuilder.weeksUnit', 'weeks')}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-xl px-4 py-3 text-[13px] font-medium" style={{ background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)', color: 'var(--color-danger)' }}>{error}</div>
          )}

          {/* Days */}
          <div className="flex flex-col gap-3">
            {days.map((day, i) => (
              <DayCard
                key={day._uid} day={day} index={i} total={days.length}
                onName={(v) => setDayField(day._uid, 'name', v)}
                onDow={(v) => setDayField(day._uid, 'dow', v)}
                onRemove={() => removeDay(day._uid)}
                onAddExercise={() => setPickerDayUid(day._uid)}
                onChangeEx={(exUid, field, val) => changeEx(day._uid, exUid, field, val)}
                onRemoveEx={(exUid) => removeEx(day._uid, exUid)}
                reorderEx={(orderedUids) => reorderEx(day._uid, orderedUids)}
                usedDows={usedDows}
                t={t} lang={lang}
                onShowInfo={setInfoExercise}
              />
            ))}
          </div>

          <button
            onClick={addDay}
            className="w-full mt-3 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[14px] font-bold"
            style={{ background: 'var(--color-bg-card)', border: '1px dashed var(--color-border-default)', color: 'var(--color-text-muted)' }}
          >
            <Calendar size={16} /> {t('programBuilder.addDay', 'Add a day')}
          </button>
        </div>
      )}

      {pickerDayUid && (
        <ExercisePicker
          t={t} lang={lang}
          onAdd={(ex) => { addExerciseToDay(pickerDayUid, ex); }}
          onClose={() => setPickerDayUid(null)}
        />
      )}

      {/* Tapped an exercise thumbnail → open its full info card (video, muscles, cues). */}
      {infoExercise && (
        <Suspense fallback={null}>
          <ExerciseInfoCard exercise={infoExercise} modalOnly initiallyOpen onExternalClose={() => setInfoExercise(null)} />
        </Suspense>
      )}

      {/* Shorten-in-progress choice — shortening the current run keeps its start
          date and progress; starting new resets the clock from today. */}
      {lowerPrompt && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="button" tabIndex={0} aria-label={t('cancel', { ns: 'common' })} onClick={() => setLowerPrompt(false)} onKeyDown={(e) => { if (e.key === 'Escape') setLowerPrompt(false); }}>
          <div className="rounded-[20px] w-full max-w-sm p-6" role="dialog" aria-modal="true" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[17px] font-extrabold mb-1.5" style={{ color: 'var(--color-text-primary)', fontFamily: "'Familjen Grotesk','Archivo',system-ui" }}>{t('programBuilder.shortenTitle', 'Shorten this program?')}</h3>
            <p className="text-[13px] mb-5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{t('programBuilder.shortenDesc', { weeks, defaultValue: `You set the length to ${weeks} weeks. Keep your current program and just end it sooner, or start a fresh ${weeks}-week program from today?` })}</p>
            <div className="flex flex-col gap-2.5">
              <button onClick={() => handleSave('current')} disabled={saving} className="w-full py-3 rounded-xl text-[14px] font-bold disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent,#fff)' }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : null}{t('programBuilder.shortenCurrent', 'Shorten current program')}
              </button>
              <button onClick={() => handleSave('new')} disabled={saving} className="w-full py-3 rounded-xl text-[14px] font-bold disabled:opacity-50" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}>
                {t('programBuilder.shortenNew', 'Start a new program')}
              </button>
              <button onClick={() => setLowerPrompt(false)} className="w-full py-2.5 text-[13px] font-semibold" style={{ color: 'var(--color-text-subtle)' }}>
                {t('cancel', { ns: 'common' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

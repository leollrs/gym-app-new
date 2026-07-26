// Per-client program editor (Phase 2). Edits a CLIENT-SPECIFIC copy
// (trainer_client_programs, migration 0640) — never the shared gym template.
// Per day (collapsed by default, tap the header to open): editable name box,
// estimated duration, add exercises, DRAG-reorder, exercise SWAP (member-style
// video grid / list + search, pick anything), superset/circuit grouping via
// always-on checkboxes, sets/reps/rest. Saves `weeks` JSON to the copy.

import { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown, Search, Dumbbell, Save, Loader2, GripVertical, ArrowLeftRight, LayoutGrid, List } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { getExercises } from '../../../lib/exerciseStore';
import { exName } from '../../../lib/exerciseName';
import { getSwapMatchScore, filterByReason } from '../../../lib/swapMatchScore';
import { saveClientProgram, getClientProgramProgress } from '../../../lib/clientProgramService';
import { estimateMinutes, estimateCalories } from '../../../lib/workoutEstimate';
import ExerciseVideoThumb from '../../../components/ExerciseVideoThumb';
import LazyVideoTile from '../../../components/LazyVideoTile';
import { TT, TFont } from './designTokens';

const ExerciseCard = lazy(() => import('../../ExerciseLibrary').then((m) => ({ default: m.ExerciseCard })));

const CATALOG = getExercises();
const CAT_BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
const REST_OPTS = [30, 45, 60, 90, 120, 180];
const DRAG_GAP = 10;
const VIDEO_BASE = 'https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/';
const toVideoSrc = (ex) => {
  const raw = ex?.videoUrl || ex?.video_url || ex?.video;
  if (!raw) return null;
  return /^(https?:|blob:|data:)/.test(raw) ? raw : `${VIDEO_BASE}${raw}`;
};
let _uidN = 0;
const uid = () => `ed${++_uidN}`;

// ── Mockup primitives (Program View & Edit handoff), TT-themed ────────────────
// A soft-teal glyph field (reps / rest) — same look for the editable input + select.
const PILL = { minWidth: 52, padding: '7px 10px', borderRadius: 10, background: TT.surface2, boxShadow: `inset 0 0 0 1px ${TT.accent}44`, color: TT.accentInk, fontSize: 14, fontWeight: 700, textAlign: 'center', letterSpacing: -0.2, fontFamily: TFont.mono, outline: 'none', border: 'none' };
function DragDots() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,3px)', gap: 3.5, flexShrink: 0 }} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ width: 3, height: 3, borderRadius: 2, background: TT.textMute }} />)}
    </div>
  );
}
function StepBtn({ children, onClick, ariaLabel, disabled = false }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} className="tt-press tt-tap" style={{
      width: 30, height: 30, borderRadius: 9, flexShrink: 0, cursor: disabled ? 'default' : 'pointer', border: `1px solid ${TT.accent}44`,
      background: TT.accentSoft, color: TT.accentInk, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 800, lineHeight: 1, opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  );
}
function EditSwitch({ on, onToggle, ariaLabel }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={ariaLabel} onClick={onToggle} className="tt-tap" style={{
      width: 52, height: 31, borderRadius: 99, flexShrink: 0, cursor: 'pointer', border: 'none', position: 'relative',
      background: on ? TT.accent : TT.surface2, boxShadow: on ? `inset 0 0 0 1px ${TT.accent}` : `inset 0 0 0 1px ${TT.border}`, transition: 'background .18s',
    }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 24 : 3, width: 25, height: 25, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,.4)', transition: 'left .18s' }} />
    </button>
  );
}
function WeekNavBar({ week, weeks, onPrev, onNext, t }) {
  const arrow = (dir, on, act) => (
    <button type="button" className="tt-tap" onClick={act} disabled={!on} aria-label={dir === 'next' ? t('common:next', 'Next') : t('common:prev', 'Previous')} style={{
      width: 44, height: 44, borderRadius: 13, flexShrink: 0, cursor: on ? 'pointer' : 'default',
      background: dir === 'next' ? TT.surface2 : 'transparent', border: dir === 'next' ? `1px solid ${TT.border}` : 'none',
      display: 'grid', placeItems: 'center', opacity: on ? 1 : 0.32, color: TT.text,
    }}>{dir === 'next' ? <ChevronRight size={19} strokeWidth={2.2} /> : <ChevronLeft size={19} strokeWidth={2.2} />}</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
      {arrow('prev', week > 1, onPrev)}
      <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
        {t('trainerClientDetail.weekN', 'Week {{w}}', { w: week })} <span style={{ color: TT.textMute, fontWeight: 700 }}>{t('trainerClientDetail.ofN', 'of {{n}}', { n: weeks })}</span>
      </div>
      {arrow('next', week < weeks, onNext)}
    </div>
  );
}

// ── drag-sort hook (mirrors MemberProgramBuilder / WorkoutBuilder) ───────────
function useDragSort(ids, onReorder) {
  const [drag, setDrag] = useState(null);
  const latest = useRef({ ids, onReorder });
  latest.current.ids = ids; latest.current.onReorder = onReorder;
  const st = useRef({});
  const h = useRef(null);
  if (!h.current) {
    const move = (e) => {
      const s = st.current; if (!s.id) return;
      setDrag((d) => (d ? { ...d, y: e.clientY } : d));
      let idx = 0;
      for (let i = 0; i < s.rects.length; i++) {
        const mid = s.rects[i].rect.top + s.rects[i].rect.height / 2;
        if (e.clientY > mid) idx = i + 1;
      }
      const cur = s.order.indexOf(s.id);
      idx = Math.max(0, Math.min(s.order.length - 1, idx > cur ? idx - 1 : idx));
      if (idx !== s.lastIndex) {
        const next = s.order.filter((x) => x !== s.id);
        next.splice(idx, 0, s.id);
        s.order = next; s.lastIndex = idx;
        latest.current.onReorder(next.slice());
      }
    };
    const end = () => {
      st.current = {}; setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    const start = (id, e, rowEl) => {
      e.preventDefault(); e.stopPropagation();
      const root = rowEl?.closest('[data-dragroot]'); if (!root) return;
      const rows = Array.from(root.querySelectorAll('[data-dragitem]'));
      const rects = rows.map((r) => ({ id: r.getAttribute('data-dragitem'), rect: r.getBoundingClientRect() }));
      const from = latest.current.ids.indexOf(id);
      st.current = { id, order: latest.current.ids.slice(), rects, lastIndex: from };
      setDrag({ id, startY: e.clientY, y: e.clientY, from, h: rects[from]?.rect.height || 0 });
      try { rowEl.setPointerCapture(e.pointerId); } catch { /* optional */ }
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

function normWeeks(w) {
  const src = w || {};
  const entries = Array.isArray(src) ? src.map((days, i) => [String(i + 1), days]) : Object.entries(src);
  const obj = {};
  entries.forEach(([k, days]) => {
    obj[String(k)] = (days || []).map((d) => ({
      name: d.name || '',
      exercises: (d.exercises || []).map((e) => ({
        _uid: uid(), id: e.id || e.exercise_id,
        sets: e.sets ?? 3, reps: e.reps ?? '8-12', rest_seconds: e.rest_seconds ?? 60,
        group_id: e.group_id || null, group_type: e.group_type || null,
      })),
    }));
  });
  return Object.keys(obj).length ? obj : { 1: [] };
}
function serialize(weeks) {
  const out = {};
  Object.entries(weeks).forEach(([k, days]) => {
    out[k] = (days || []).map((d) => ({
      name: d.name || '',
      exercises: (d.exercises || []).map((e) => ({
        id: e.id, sets: Number(e.sets) || 1, reps: String(e.reps ?? '').trim() || '8-12', rest_seconds: Number(e.rest_seconds) || 60,
        ...(e.group_id ? { group_id: e.group_id, group_type: e.group_type } : {}),
      })),
    }));
  });
  return out;
}

// ── Exercise picker (bottom sheet, live search + video thumbs) ───────────────
function ExercisePicker({ onPick, onClose, t }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOG.filter((ex) => !needle || exName(ex).toLowerCase().includes(needle) || (ex.muscle || '').toLowerCase().includes(needle)).slice(0, 60);
  }, [q]);
  return createPortal(
    <div className="fixed inset-0 z-[135] flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: TT.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTop: `1px solid ${TT.borderSolid}`, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${TT.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{t('trainerClientDetail.editor.addExercise', 'Add exercise')}</span>
            <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}><X size={16} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TT.textMute }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t('trainerClientDetail.editor.searchExercises', 'Search exercises…')}
              style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.borderSolid}`, color: TT.text, fontSize: 14, outline: 'none' }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: 8 }}>
          {results.map((ex) => (
            <button key={ex.id} type="button" onClick={() => onPick(ex)} className="tt-tap" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', borderRadius: 12, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <ExerciseVideoThumb exercise={{ videoUrl: ex.videoUrl, muscle: ex.muscle }} size={38} radius={10} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exName(ex)}</span>
                {ex.muscle && <span style={{ display: 'block', fontSize: 11.5, color: TT.textSub }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)}</span>}
              </span>
            </button>
          ))}
          {results.length === 0 && <p style={{ textAlign: 'center', color: TT.textMute, fontSize: 13, padding: '24px 0' }}>{t('trainerClientDetail.editor.noMatches', 'No matches')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Swap sheet — member-style: search + grid/list + reason chips + rank ──────
function SwapSheet({ currentEx, excludeIds, onPick, onClose, t }) {
  const [reason, setReason] = useState(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState('grid');
  const targetMuscle = currentEx?.muscle || '';
  const decorate = (list) => filterByReason(list, reason, currentEx).map((ex) => ({ ...ex, _m: getSwapMatchScore(currentEx, ex) })).sort((a, b) => (b._m || 0) - (a._m || 0));
  const needle = q.trim().toLowerCase();
  const { searchResults, sameMuscle, otherMuscles } = useMemo(() => {
    if (needle) {
      const matched = CATALOG.filter((ex) => !excludeIds.has(ex.id) && (exName(ex).toLowerCase().includes(needle) || (ex.muscle || '').toLowerCase().includes(needle)));
      return { searchResults: decorate(matched).slice(0, 60), sameMuscle: [], otherMuscles: [] };
    }
    const sameRaw = [], otherRaw = [];
    for (const ex of CATALOG) {
      if (excludeIds.has(ex.id)) continue;
      if (targetMuscle && ex.muscle === targetMuscle) sameRaw.push(ex); else otherRaw.push(ex);
      if (sameRaw.length + otherRaw.length >= 140) break;
    }
    return { searchResults: null, sameMuscle: decorate(sameRaw).slice(0, 40), otherMuscles: decorate(otherRaw).slice(0, 25) };
  }, [needle, reason, currentEx, excludeIds]);

  const tile = (ex, accent) => {
    const vsrc = toVideoSrc(ex);
    return (
      <button key={ex.id} type="button" onClick={() => onPick(ex.id)} className="tt-tap"
        style={{ position: 'relative', aspectRatio: '4 / 5', borderRadius: 12, overflow: 'hidden', textAlign: 'left', background: '#000', border: accent ? `1px solid ${TT.accent}55` : `1px solid ${TT.border}`, cursor: 'pointer' }}>
        {vsrc ? <LazyVideoTile src={vsrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${TT.accent}22, transparent)` }} />}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
        <span style={{ position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center', background: accent ? TT.accent : 'rgba(0,0,0,0.55)', color: '#fff' }}><ArrowLeftRight size={13} strokeWidth={2.6} /></span>
        {typeof ex._m === 'number' && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4, padding: '2px 6px', borderRadius: 5, background: accent ? TT.accent : 'rgba(0,0,0,0.55)', color: '#fff' }}>{ex._m}%</span>}
        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
          <p style={{ fontSize: 11, fontWeight: 900, lineHeight: 1.1, textShadow: '0 1px 4px rgba(0,0,0,0.5)', margin: 0 }}>{exName(ex) || ex.name}</p>
          <p style={{ fontSize: 10, fontWeight: 700, marginTop: 2, opacity: 0.85, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)}</p>
        </div>
      </button>
    );
  };
  const listRow = (ex, accent) => (
    <button key={ex.id} type="button" onClick={() => onPick(ex.id)} className="tt-tap"
      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', borderRadius: 12, background: TT.surface2, border: `1px solid ${accent ? `${TT.accent}44` : TT.border}`, cursor: 'pointer' }}>
      <ExerciseVideoThumb exercise={{ videoUrl: ex.videoUrl, muscle: ex.muscle }} size={38} radius={10} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exName(ex) || ex.name}</span>
        {ex.muscle && <span style={{ display: 'block', fontSize: 11.5, color: TT.textSub }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)}</span>}
      </span>
      {typeof ex._m === 'number' && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, fontFamily: TFont.mono, color: accent ? TT.accentInk : TT.textMute }}>{ex._m}%</span>}
    </button>
  );
  const section = (list, accent) => (view === 'grid'
    ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{list.map((ex) => tile(ex, accent))}</div>
    : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{list.map((ex) => listRow(ex, accent))}</div>);

  const empty = searchResults ? searchResults.length === 0 : (sameMuscle.length === 0 && otherMuscles.length === 0);

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: TT.bg, borderRadius: 22, border: `1px solid ${TT.borderSolid}`, width: '100%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${TT.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{t('trainerClientDetail.editor.swapTitle', 'Swap exercise')}</div>
              <div style={{ fontSize: 12, color: TT.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exName(currentEx) || ''}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'flex', background: TT.surface2, borderRadius: 10, padding: 3, border: `1px solid ${TT.border}` }}>
                {[['grid', LayoutGrid], ['list', List]].map(([v, Ico]) => (
                  <button key={v} type="button" onClick={() => setView(v)} aria-label={v} style={{ width: 30, height: 28, borderRadius: 7, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', background: view === v ? TT.text : 'transparent', color: view === v ? TT.onInverse : TT.textMute }}><Ico size={14} /></button>
                ))}
              </div>
              <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}><X size={16} /></button>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TT.textMute }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('trainerClientDetail.editor.searchAny', 'Search any exercise…')}
              style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.borderSolid}`, color: TT.text, fontSize: 14, outline: 'none' }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[{ key: 'equipment_busy', label: t('activeSession.swapReasonEquipment', 'Equipment busy') }, { key: 'injury', label: t('activeSession.swapReasonInjury', 'Injury') }, { key: 'preference', label: t('activeSession.swapReasonPreference', 'Preference') }].map((r) => {
              const active = reason === r.key;
              return <button key={r.key} type="button" onClick={() => setReason(active ? null : r.key)} className="tt-tap" style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: active ? TT.accent : TT.surface2, color: active ? '#fff' : TT.textSub, border: `1px solid ${active ? TT.accent : TT.border}`, cursor: 'pointer' }}>{r.label}</button>;
            })}
          </div>
          {searchResults ? section(searchResults, false) : (
            <>
              {sameMuscle.length > 0 && targetMuscle && <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4, color: TT.textSub, paddingBottom: 8 }}>{t('activeSession.swapSameMuscle', { defaultValue: '{{muscle}} alternatives', muscle: t(`muscleGroups.${targetMuscle}`, targetMuscle) })}</p>}
              {sameMuscle.length > 0 && <div style={{ marginBottom: 18 }}>{section(sameMuscle, true)}</div>}
              {otherMuscles.length > 0 && <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4, color: TT.textSub, paddingBottom: 8 }}>{t('activeSession.swapOtherMuscles', 'Other muscles')}</p>}
              {otherMuscles.length > 0 && section(otherMuscles, false)}
            </>
          )}
          {empty && <p style={{ textAlign: 'center', color: TT.textMute, fontSize: 13, padding: '32px 0' }}>{t('activeSession.swapNoResults', 'No alternatives found')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── One day (collapsed by default; owns drag + grouping) ─────────────────────
function EditorDay({ day, index, onChange, onRemove, onAddExercise, onSwap, onInfo, t }) {
  const { dragId, draggedTranslate, start } = useDragSort(
    day.exercises.map((e) => e._uid),
    (order) => onChange((d) => ({ ...d, exercises: order.map((u) => d.exercises.find((e) => e._uid === u)).filter(Boolean) })),
  );
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const toggleSel = (u) => setSel((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  const stop = (e) => e.stopPropagation();

  const groupSelected = (type) => {
    if (sel.size < 2) return;
    const gid = `g${uid()}`;
    onChange((d) => {
      const stamped = []; let inserted = false;
      for (const e of d.exercises) {
        if (sel.has(e._uid)) { if (!inserted) { d.exercises.filter((x) => sel.has(x._uid)).forEach((x) => stamped.push({ ...x, group_id: gid, group_type: type })); inserted = true; } }
        else stamped.push(e);
      }
      return { ...d, exercises: stamped };
    });
    setSel(new Set());
  };
  const ungroup = (gid) => onChange((d) => ({ ...d, exercises: d.exercises.map((e) => (e.group_id === gid ? { ...e, group_id: null, group_type: null } : e)) }));
  const setEx = (u, patch) => onChange((d) => ({ ...d, exercises: d.exercises.map((e) => (e._uid === u ? { ...e, ...patch } : e)) }));
  const removeEx = (u) => onChange((d) => ({ ...d, exercises: d.exercises.filter((e) => e._uid !== u) }));

  const cellInput = { background: `color-mix(in srgb, ${TT.accent} 16%, transparent)`, border: `1px solid ${TT.accent}44`, borderRadius: 8, color: TT.text, fontSize: 13, fontWeight: 700, outline: 'none', fontFamily: TFont.mono };
  const stepBtn = { width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: `color-mix(in srgb, ${TT.accent} 22%, transparent)`, border: 'none', color: TT.text, fontSize: 16, fontWeight: 800, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center' };
  const mins = estimateMinutes(day.exercises);
  const cals = estimateCalories(day.exercises);

  return (
    <div style={{ background: open ? TT.bg : TT.surface, border: `1px solid ${open ? `${TT.accent}44` : TT.border}`, borderRadius: 16, padding: open ? 10 : 0, marginBottom: 10, overflow: 'hidden' }}>
      {/* Header (mockup) — chevron toggles; the day name is a full-width pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: open ? '2px 2px 10px' : '10px 12px' }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? t('common:collapse', 'Collapse') : t('common:expand', 'Expand')} className="tt-tap"
          style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: TT.textSub }}>
          <ChevronRight size={19} strokeWidth={2.2} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        <input value={day.name} onChange={(e) => onChange((d) => ({ ...d, name: e.target.value }))} placeholder={t('trainerClientDetail.dayN', 'Day {{n}}', { n: index + 1 })}
          style={{ flex: 1, minWidth: 0, height: 38, background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 10, padding: '0 13px', fontFamily: TFont.display, fontWeight: 800, fontSize: 15, color: TT.text, letterSpacing: -0.2, outline: 'none' }} />
        <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: TT.textMute, fontFamily: TFont.mono, whiteSpace: 'nowrap' }}>
          {!open && `${day.exercises.length}· `}~{mins}m · {cals}cal
        </span>
        <button type="button" onClick={onRemove} aria-label={t('common:remove', 'Remove')} className="tt-tap" style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.hot }}><Trash2 size={16} /></button>
      </div>

      {open && (
        <>
          <div data-dragroot style={{ display: 'flex', flexDirection: 'column', gap: DRAG_GAP, marginTop: 10 }}>
            {day.exercises.map((e) => {
              const isDrag = dragId === e._uid;
              const lib = CAT_BY_ID.get(e.id);
              const nm = exName(lib) || t('trainerNotes.overview.unknownExercise', 'Exercise');
              const pos = day.exercises.indexOf(e);
              const prev = day.exercises[pos - 1];
              const groupStart = e.group_id && (!prev || prev.group_id !== e.group_id);
              const checked = sel.has(e._uid);
              return (
                <div key={e._uid} data-dragitem={e._uid}
                  style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderLeft: e.group_id ? `3px solid ${TT.coach}` : `1px solid ${TT.border}`, borderRadius: 12, overflow: 'hidden', ...(isDrag ? { transform: `translateY(${draggedTranslate()}px)`, zIndex: 30, position: 'relative', boxShadow: '0 14px 30px rgba(0,0,0,0.3)' } : {}) }}>
                  {groupStart && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 11px 0' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: TT.coach, textTransform: 'uppercase', letterSpacing: 0.5 }}>{e.group_type === 'circuit' ? t('trainerClientDetail.program.circuit', 'Circuit') : t('trainerClientDetail.program.superset', 'Superset')}</span>
                      <button type="button" onClick={() => ungroup(e.group_id)} className="tt-tap" style={{ fontSize: 10, fontWeight: 700, color: TT.textMute, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t('trainerClientDetail.editor.ungroup', 'Ungroup')}</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                    <button type="button" onPointerDown={(ev) => start(e._uid, ev, ev.currentTarget.closest('[data-dragitem]'))} aria-label={t('workoutBuilder.ariaDragReorder', 'Drag to reorder')}
                      style={{ width: 18, height: 32, marginLeft: -2, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'grab', touchAction: 'none' }}><DragDots /></button>
                    <button type="button" onClick={() => toggleSel(e._uid)} aria-label="select" style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, border: `2px solid ${checked ? TT.accent : `${TT.accent}88`}`, background: checked ? TT.accent : `${TT.accent}1F`, color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>{checked && <span style={{ fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}</button>
                    <button type="button" onClick={() => lib && onInfo(lib)} disabled={!lib} aria-label={t('exerciseLibrary.viewInfo', 'View exercise info')} style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, display: 'flex', borderRadius: 10, cursor: lib ? 'pointer' : 'default' }}>
                      <ExerciseVideoThumb exercise={{ videoUrl: lib?.videoUrl, muscle: lib?.muscle }} size={38} radius={10} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>{nm}</p>
                      {lib?.muscle && <p style={{ fontSize: 11, color: TT.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '1px 0 0' }}>{t(`muscleGroups.${lib.muscle}`, lib.muscle)}</p>}
                    </div>
                    <button type="button" onClick={() => onSwap(e._uid)} aria-label={t('workoutBuilder.ariaSwap', 'Swap exercise')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textMute }}><ArrowLeftRight size={15} /></button>
                    <button type="button" onClick={() => removeEx(e._uid)} aria-label={t('common:remove', 'Remove')} style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.hot }}><Trash2 size={15} /></button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', margin: '0 10px 10px', background: TT.surface2, borderRadius: 12, boxShadow: `inset 0 0 0 1px ${TT.border}`, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 6px 11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: TFont.display, fontSize: 9.5, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 1 }}>{t('trainerClientDetail.editor.setsShort', 'Sets')}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StepBtn ariaLabel={t('common:decrease', 'Decrease')} onClick={() => setEx(e._uid, { sets: Math.max(1, (Number(e.sets) || 1) - 1) })}>−</StepBtn>
                        <span style={{ fontFamily: TFont.mono, fontWeight: 700, fontSize: 16, color: TT.text, minWidth: 14, textAlign: 'center' }}>{e.sets}</span>
                        <StepBtn ariaLabel={t('common:increase', 'Increase')} onClick={() => setEx(e._uid, { sets: Math.min(10, (Number(e.sets) || 1) + 1) })}>+</StepBtn>
                      </div>
                    </div>
                    <div style={{ padding: '10px 6px 11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderLeft: `1px solid ${TT.border}`, borderRight: `1px solid ${TT.border}` }}>
                      <span style={{ fontFamily: TFont.display, fontSize: 9.5, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 1 }}>{t('trainerClientDetail.editor.repsShort', 'Reps')}</span>
                      <input type="text" inputMode="numeric" value={e.reps} onChange={(ev) => setEx(e._uid, { reps: ev.target.value.slice(0, 7) })} style={{ ...PILL, width: 56 }} />
                    </div>
                    <div style={{ padding: '10px 6px 11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: TFont.display, fontSize: 9.5, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 1 }}>{t('trainerClientDetail.editor.restShort', 'Rest')}</span>
                      <select value={e.rest_seconds} onChange={(ev) => setEx(e._uid, { rest_seconds: Number(ev.target.value) })} style={{ ...PILL, appearance: 'none', cursor: 'pointer' }}>
                        {REST_OPTS.map((r) => <option key={r} value={r}>{r < 60 ? `${r}s` : `${r / 60}m`}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {sel.size >= 2 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: TT.textSub }}>{sel.size} {t('workoutBuilder.selectToGroup', 'selected — group as:')}</span>
              <button type="button" onClick={() => groupSelected('superset')} className="tt-tap" style={{ padding: '6px 12px', borderRadius: 9, background: TT.coach, border: 'none', color: '#fff', fontWeight: 800, fontSize: 11.5, cursor: 'pointer' }}>{t('trainerClientDetail.program.superset', 'Superset')}</button>
              <button type="button" onClick={() => groupSelected('circuit')} className="tt-tap" style={{ padding: '6px 12px', borderRadius: 9, background: TT.coach, border: 'none', color: '#fff', fontWeight: 800, fontSize: 11.5, cursor: 'pointer' }}>{t('trainerClientDetail.program.circuit', 'Circuit')}</button>
            </div>
          )}

          <button type="button" onClick={onAddExercise} className="tt-tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', height: 42, marginTop: 10, borderRadius: 12, background: 'transparent', color: TT.accentInk, border: `1.5px dashed ${TT.accent}55`, fontFamily: TFont.display, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            <Plus size={16} strokeWidth={2.4} /> {t('trainerClientDetail.editor.addExercise', 'Add exercise')}
          </button>
        </>
      )}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────
export default function ClientProgramEditor({ copyId, program, onClose, onSaved, t }) {
  const { showToast } = useToast();
  useScrollLock(true);
  const [name, setName] = useState(program?.name || '');
  const [weeks, setWeeks] = useState(() => normWeeks(program?.weeks));
  const [weekIdx, setWeekIdx] = useState(0);
  const [pickerDay, setPickerDay] = useState(null);
  const [swap, setSwap] = useState(null); // { di, uid }
  const [infoEx, setInfoEx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [allowClientEdit, setAllowClientEdit] = useState(!!program?.allow_client_edit);
  const [clientWeek, setClientWeek] = useState(0); // client's current elapsed week (0 = not started → no shorten-block)

  useEffect(() => {
    let cancelled = false;
    getClientProgramProgress(program?.client_id, program?.source_program_id)
      .then((p) => { if (!cancelled) setClientWeek(p?.elapsedWeeks || 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [program?.client_id, program?.source_program_id]);

  const weekKeys = useMemo(() => Object.keys(weeks).sort((a, b) => Number(a) - Number(b)), [weeks]);
  const idx = Math.min(Math.max(weekIdx, 0), Math.max(weekKeys.length - 1, 0));
  const activeKey = weekKeys[idx];
  const days = weeks[activeKey] || [];

  const setDay = (di, updater) => setWeeks((w) => ({ ...w, [activeKey]: (w[activeKey] || []).map((d, i) => (i === di ? updater(d) : d)) }));
  const removeDay = (di) => setWeeks((w) => ({ ...w, [activeKey]: (w[activeKey] || []).filter((_, i) => i !== di) }));
  const addDay = () => setWeeks((w) => ({ ...w, [activeKey]: [...(w[activeKey] || []), { name: '', exercises: [] }] }));
  // Program length — add a week (cloning the last week's structure so the split
  // carries forward) or drop the last week.
  const addWeek = () => setWeeks((w) => {
    const keys = Object.keys(w).map(Number).sort((a, b) => a - b);
    const lastKey = String(keys[keys.length - 1] ?? 1);
    const next = String((keys[keys.length - 1] ?? 0) + 1);
    const cloned = (w[lastKey] || []).map((d) => ({ name: d.name, exercises: d.exercises.map((e) => ({ ...e, _uid: uid() })) }));
    return { ...w, [next]: cloned };
  });
  const removeWeek = () => {
    if (weekKeys.length <= 1) return;
    // Completion gate (mirrors the member builder): never shorten the client's
    // program below the week they've already reached.
    if (clientWeek > 0 && weekKeys.length <= clientWeek) {
      showToast(t('trainerClientDetail.editor.cantShortenBelowWeek', { defaultValue: "Client is on week {{w}} — can't make the program shorter than that.", w: clientWeek }), 'error');
      return;
    }
    setWeeks((w) => {
      const keys = Object.keys(w).map(Number).sort((a, b) => a - b);
      if (keys.length <= 1) return w;
      const rest = { ...w }; delete rest[String(keys[keys.length - 1])];
      return rest;
    });
  };
  const addExercise = (ex) => {
    setWeeks((w) => ({ ...w, [activeKey]: (w[activeKey] || []).map((d, i) => (i === pickerDay ? { ...d, exercises: [...d.exercises, { _uid: uid(), id: ex.id, sets: 3, reps: '8-12', rest_seconds: 60, group_id: null, group_type: null }] } : d)) }));
    setPickerDay(null);
  };
  const doSwap = (newId) => {
    if (!swap) return;
    setWeeks((w) => ({ ...w, [activeKey]: (w[activeKey] || []).map((d, i) => (i === swap.di ? { ...d, exercises: d.exercises.map((e) => (e._uid === swap.uid ? { ...e, id: newId } : e)) } : d)) }));
    setSwap(null);
  };

  const swapCurrent = swap ? CAT_BY_ID.get((days[swap.di]?.exercises.find((e) => e._uid === swap.uid) || {}).id) : null;
  const swapExclude = useMemo(() => new Set((swap ? (days[swap.di]?.exercises || []) : []).map((e) => e.id)), [swap, days]);

  const onSave = async () => {
    if (saving) return; setSaving(true);
    try {
      await saveClientProgram(copyId, { weeks: serialize(weeks), name: name.trim() || program?.name || '', duration_weeks: weekKeys.length, allow_client_edit: allowClientEdit });
      showToast(t('trainerClientDetail.editor.saved', 'Program saved for this client'), 'success');
      onSaved();
    } catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[125] flex flex-col" style={{ background: TT.bg }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${TT.border}` }}>
        <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')} style={{ width: 38, height: 38, borderRadius: 11, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.text, flexShrink: 0 }}><X size={18} /></button>
        <div style={{ flex: 1, fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, letterSpacing: -0.4 }}>{t('trainerClientDetail.editor.title', 'Edit program')}</div>
        <button type="button" onClick={onSave} disabled={saving} className="tt-tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 12, background: TT.accent, border: 'none', color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} strokeWidth={2.4} />} {t('trainerClientDetail.editor.save', 'Save')}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div className="md:max-w-[640px] md:mx-auto">
          {/* Name (mockup pill) */}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('trainerClientDetail.editor.namePlaceholder', 'Program name')}
            style={{ width: '100%', height: 52, padding: '0 16px', borderRadius: 14, background: TT.surface, border: `1px solid ${TT.border}`, color: TT.text, fontFamily: TFont.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, outline: 'none', marginBottom: 12 }} />

          {/* Settings card (mockup) — program length stepper + let-client-edit switch */}
          <div style={{ marginBottom: 14, borderRadius: 16, background: TT.surface, border: `1px solid ${TT.border}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
              <span style={{ flex: 1, fontFamily: TFont.display, fontSize: 14.5, fontWeight: 700, color: TT.text }}>{t('trainerClientDetail.editor.programLength', 'Program length')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <StepBtn ariaLabel={t('trainerClientDetail.editor.removeWeek', 'Remove week')} disabled={weekKeys.length <= Math.max(1, clientWeek)} onClick={removeWeek}>−</StepBtn>
                <span style={{ fontFamily: TFont.mono, fontWeight: 700, fontSize: 14.5, color: TT.text, minWidth: 58, textAlign: 'center' }}>{weekKeys.length} {t('trainerNotes.program.weeks', 'weeks')}</span>
                <StepBtn ariaLabel={t('trainerClientDetail.editor.addWeek', 'Add week')} onClick={addWeek}>+</StepBtn>
              </div>
            </div>
            {clientWeek > 0 && (
              <div style={{ padding: '0 16px 10px', fontSize: 10.5, color: TT.textMute }}>
                {t('trainerClientDetail.editor.clientOnWeek', { defaultValue: "Client is on week {{w}} — can't shorten below that.", w: clientWeek })}
              </div>
            )}
            <div style={{ height: 1, background: TT.border, margin: '0 16px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: TFont.display, fontSize: 14.5, fontWeight: 700, color: TT.text }}>{t('trainerClientDetail.editor.allowClientEdit', 'Let client edit this program')}</div>
                <div style={{ fontSize: 11.5, color: TT.textMute, marginTop: 2 }}>{t('trainerClientDetail.editor.allowClientEditHint', 'Off = only you can change it')}</div>
              </div>
              <EditSwitch on={allowClientEdit} onToggle={() => setAllowClientEdit((v) => !v)} ariaLabel={t('trainerClientDetail.editor.allowClientEdit', 'Let client edit this program')} />
            </div>
          </div>

          {/* Week navigator (mockup) */}
          <div style={{ marginBottom: 12 }}>
            <WeekNavBar week={idx + 1} weeks={weekKeys.length} onPrev={() => setWeekIdx(idx - 1)} onNext={() => setWeekIdx(idx + 1)} t={t} />
          </div>

          {days.map((d, di) => (
            <EditorDay key={di} day={d} index={di}
              onChange={(upd) => setDay(di, upd)} onRemove={() => removeDay(di)} onAddExercise={() => setPickerDay(di)}
              onSwap={(u) => setSwap({ di, uid: u })} onInfo={(ex) => setInfoEx(ex)} t={t} />
          ))}

          <button type="button" onClick={addDay} className="tt-tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 52, borderRadius: 14, background: 'transparent', color: TT.textSub, border: `1.5px dashed ${TT.borderSolid}`, fontFamily: TFont.display, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            <Plus size={18} strokeWidth={2.2} /> {t('trainerClientDetail.editor.addDay', 'Add day')}
          </button>
        </div>
      </div>

      {pickerDay !== null && <ExercisePicker onPick={addExercise} onClose={() => setPickerDay(null)} t={t} />}
      {swap && <SwapSheet currentEx={swapCurrent} excludeIds={swapExclude} onPick={doSwap} onClose={() => setSwap(null)} t={t} />}
      {infoEx && <Suspense fallback={null}><ExerciseCard exercise={infoEx} modalOnly initiallyOpen onExternalClose={() => setInfoEx(null)} /></Suspense>}
    </div>,
    document.body,
  );
}

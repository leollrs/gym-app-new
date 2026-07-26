// Per-client meal-plan editor + read-only week view. Edits the client's ACTIVE
// trainer_meal_plans row IN PLACE (never spawns a new one) and supports DISTINCT
// meals per week — parity with the workout program editor. The member reads the
// plan live (TrainerMealPlanSection), so saved edits reach them immediately.

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown, Search, Save, Loader2, ArrowLeftRight, Sparkles, UtensilsCrossed, GripVertical, Calculator, Clock } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { supabase } from '../../../lib/supabase';
import { getMeals, mealImageById } from '../../../lib/mealStore';
import { foodImageUrl, handleMealImgError } from '../../../lib/imageUrl';
import { generateWeekPlan } from '../../../lib/mealPlanner';
import { mealPlanWeeks, currentMealWeekKey, serializeMealWeeks, dayTotals } from '../../../lib/mealPlanWeeks';
import { TT, TFont } from './designTokens';
import { MK, soft, inkOf, MacroReadout, MacroCells, MkTag, MkIconBtn, FoodTile } from './mealPlanKit';

const CATALOG = getMeals();
const CAT_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));
const MEAL_SLOTS = [
  { type: 'breakfast', time: '07:00' },
  { type: 'lunch', time: '12:00' },
  { type: 'snack', time: '15:30' },
  { type: 'dinner', time: '19:00' },
];
// Same slot hues the standalone /plans builder uses, so a coach sees ONE meal
// card design whichever door they came through.
const SLOT_COLOR = { breakfast: MK.hot, lunch: MK.amber, snack: MK.good, dinner: MK.coach, meal: MK.teal };
const DRAG_GAP = 10;
const slotLabel = (t, s) => t(`nutrition.meals.${s}`, s === 'meal' ? t('trainerNotes.nutrition.meal', 'Meal') : s);

// Re-slot a meal to its position `i` in the day: the slot label (Breakfast/
// Lunch/…) always follows drag order so a day can't read "Lunch before
// Breakfast". The time snaps to the slot's default ONLY if it was never
// custom-edited (i.e. still equals its previous slot's default), so a trainer's
// hand-set times survive a reorder. A 5th+ meal falls back to the generic slot.
const reslotMeal = (m, i) => {
  const next = MEAL_SLOTS[i];
  if (!next) return { ...m, slotType: 'meal' };
  const prevDefault = MEAL_SLOTS.find((s) => s.type === m.slotType)?.time || null;
  const timeUnedited = !m.time || m.time === prevDefault;
  return { ...m, slotType: next.type, time: timeUnedited ? next.time : m.time };
};
const dayLabelsOf = (t) => [
  t('trainerPlans.daySun', 'Sun'), t('trainerPlans.dayMon', 'Mon'), t('trainerPlans.dayTue', 'Tue'),
  t('trainerPlans.dayWed', 'Wed'), t('trainerPlans.dayThu', 'Thu'), t('trainerPlans.dayFri', 'Fri'), t('trainerPlans.daySat', 'Sat'),
];

// FoodTile with a broken-image fallback: meal photos 404 often enough that
// losing handleMealImgError would leave torn images in the card.
function MealTile({ src, label, size = 62, r = 16, tint }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <FoodTile src={null} label={label} size={size} r={r} tint={tint} />;
  return (
    <img src={src} alt={label || ''} loading="lazy" onError={() => setBroken(true)}
      style={{ width: size, height: size, borderRadius: r, flexShrink: 0, objectFit: 'cover', background: MK.surface2, boxShadow: `inset 0 0 0 1px ${MK.line}` }} />
  );
}

let _uidN = 0;
const uid = () => `mp${++_uidN}`;
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const mealImg = (m) => (m?.image
  ? (/^https?:\/\//.test(m.image) ? m.image : foodImageUrl(m.image))
  : foodImageUrl(mealImageById(m?.id)));

const toEditorMeal = (m, slotType, time) => ({
  _uid: uid(), id: m.id ?? null,
  title: m.title || '', title_es: m.title_es || null,
  calories: Number(m.calories) || 0, protein: Number(m.protein) || 0, carbs: Number(m.carbs) || 0, fat: Number(m.fat) || 0,
  category: m.category || null, prepTime: m.prepTime ?? m.prep_time ?? null,
  image: m.image || mealImageById(m.id) || null,
  slotType: slotType || m.slot || 'meal', time: time ?? m.time ?? null, notes: m.notes || null,
});

// Hydrate the stored plan → editor working state (recover image/title from catalog).
function toEditorWeeks(plan) {
  const { weeks, weekKeys } = mealPlanWeeks(plan);
  const out = {};
  weekKeys.forEach((k) => {
    out[k] = (weeks[k] || []).map((d) => ({
      meals: (d.meals || []).map((m) => {
        const full = m.id != null ? CAT_BY_ID.get(m.id) : null;
        return {
          _uid: uid(), id: m.id ?? null,
          title: m.title || full?.title || '', title_es: m.title_es || full?.title_es || null,
          calories: Number(m.calories) || 0, protein: Number(m.protein) || 0, carbs: Number(m.carbs) || 0, fat: Number(m.fat) || 0,
          category: m.category || full?.category || null, prepTime: m.prepTime ?? full?.prepTime ?? null,
          image: m.image || full?.image || mealImageById(m.id) || null,
          slotType: m.slotType || m.slot || 'meal', time: m.time || null, notes: m.notes || null,
        };
      }),
    }));
  });
  return Object.keys(out).length ? out : { 1: [] };
}

// ── drag-sort hook (mirrors the program editor) ─────────────────────────────
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

// ── Meal picker — centered mid-page modal: search catalog + grid, pick anything ─
function MealPicker({ onPick, onClose, t, isEs }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOG.filter((m) => !needle
      || (m.title || '').toLowerCase().includes(needle)
      || (m.title_es || '').toLowerCase().includes(needle)
      || (m.category || '').toLowerCase().includes(needle)).slice(0, 60);
  }, [q]);
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: TT.bg, borderRadius: 22, border: `1px solid ${TT.borderSolid}`, width: '100%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${TT.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{t('trainerClientDetail.mealEditor.pickMeal', 'Choose a meal')}</span>
            <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}><X size={16} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TT.textMute }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t('trainerClientDetail.mealEditor.searchMeals', 'Search meals…')}
              style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.borderSolid}`, color: TT.text, fontSize: 14, outline: 'none' }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {results.map((m) => {
              const img = mealImg(m);
              const title = isEs && m.title_es ? m.title_es : m.title;
              return (
                <button key={m.id} type="button" onClick={() => onPick(m)} className="tt-tap"
                  style={{ position: 'relative', aspectRatio: '4 / 5', borderRadius: 12, overflow: 'hidden', textAlign: 'left', background: '#000', border: `1px solid ${TT.border}`, cursor: 'pointer' }}>
                  {img
                    ? <img src={img} alt={title} loading="lazy" onError={handleMealImgError} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${TT.accent}22, transparent)` }}><UtensilsCrossed size={22} color={TT.textMute} /></div>}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.1) 55%, rgba(0,0,0,0) 100%)' }} />
                  <span style={{ position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff' }}><Plus size={14} strokeWidth={2.8} /></span>
                  <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                    <p style={{ fontSize: 11, fontWeight: 900, lineHeight: 1.12, textShadow: '0 1px 4px rgba(0,0,0,0.6)', margin: 0 }}>{title}</p>
                    <p style={{ fontSize: 10, fontWeight: 700, marginTop: 2, opacity: 0.9, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{Math.round(m.calories) || 0} {t('trainerMealPlan.cal', 'cal')} · {Math.round(m.protein) || 0}g P</p>
                  </div>
                </button>
              );
            })}
          </div>
          {results.length === 0 && <p style={{ textAlign: 'center', color: TT.textMute, fontSize: 13, padding: '28px 0' }}>{t('trainerClientDetail.editor.noMatches', 'No matches')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── One day (collapsed accordion; drag-reorder meals + editable times) ───────
function EditorDay({ day, index, label, open, onToggle, onChangeDay, onAddMeal, onSwapMeal, onRemoveDay, t, isEs }) {
  const { dragId, draggedTranslate, start } = useDragSort(
    day.meals.map((m) => m._uid),
    (order) => onChangeDay((d) => ({ ...d, meals: order.map((u) => d.meals.find((m) => m._uid === u)).filter(Boolean).map(reslotMeal) })),
  );
  const totals = dayTotals(day.meals);
  const setTime = (mi, time) => onChangeDay((d) => ({ ...d, meals: d.meals.map((m, i) => (i === mi ? { ...m, time } : m)) }));
  const removeMeal = (mi) => onChangeDay((d) => ({ ...d, meals: d.meals.filter((_, i) => i !== mi).map(reslotMeal) }));
  return (
    <div style={{ background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 16, padding: 12, marginBottom: 10 }}>
      <div onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <ChevronDown size={18} style={{ flexShrink: 0, color: TT.textSub, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .18s' }} />
        <span style={{ flex: 1, minWidth: 0, fontFamily: TFont.display, fontWeight: 800, fontSize: 14, color: TT.text }}>{label}</span>
        <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: TT.textMute, fontFamily: TFont.mono, whiteSpace: 'nowrap' }}>
          {day.meals.length}· {Math.round(totals.calories)} {t('trainerMealPlan.cal', 'cal')}
        </span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveDay(); }} aria-label={t('common:remove', 'Remove')} className="tt-tap" style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: 'transparent', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.hot }}><Trash2 size={15} /></button>
      </div>

      {open && (
        <>
          <div data-dragroot style={{ display: 'flex', flexDirection: 'column', gap: DRAG_GAP, marginTop: 10 }}>
            {day.meals.map((m, mi) => {
              const isDrag = dragId === m._uid;
              const color = SLOT_COLOR[m.slotType] || SLOT_COLOR.meal;
              const img = mealImg(m);
              const title = isEs && m.title_es ? m.title_es : m.title;
              return (
                <div key={m._uid} data-dragitem={m._uid}
                  style={{ background: MK.surface, borderRadius: 20, boxShadow: MK.shadow, overflow: 'hidden', ...(isDrag ? { transform: `translateY(${draggedTranslate()}px)`, zIndex: 30, position: 'relative', boxShadow: '0 14px 30px rgba(0,0,0,0.3)' } : {}) }}>
                  <div style={{ height: 5, background: color }} />
                  <div style={{ padding: 13 }}>
                    <div style={{ display: 'flex', gap: 11 }}>
                      <button type="button" onPointerDown={(ev) => start(m._uid, ev, ev.currentTarget.closest('[data-dragitem]'))} aria-label={t('workoutBuilder.ariaDragReorder', 'Drag to reorder')}
                        style={{ width: 16, marginLeft: -3, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', color: MK.ink3, cursor: 'grab', touchAction: 'none' }}><GripVertical size={15} /></button>
                      <MealTile src={img} label={title} size={62} r={16} tint={color} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <MkTag c={color} size="s">{slotLabel(t, m.slotType)}</MkTag>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <MkIconBtn size={31} r={10} onClick={() => onSwapMeal(mi)}><ArrowLeftRight size={15} color={MK.ink2} /></MkIconBtn>
                            <MkIconBtn size={31} r={10} soft={soft(MK.coral, 15)} onClick={() => removeMeal(mi)}><Trash2 size={15} color={inkOf(MK.coral)} /></MkIconBtn>
                          </div>
                        </div>
                        <div className="truncate" style={{ fontFamily: MK.disp, fontSize: 15, fontWeight: 800, color: MK.ink, letterSpacing: -0.3, lineHeight: 1.15, margin: '8px 0 7px' }}>
                          {title || t('trainerNotes.nutrition.meal', 'Meal')}
                        </div>
                        <MacroReadout kcal={Math.round(m.calories)} macros={{ protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) }} size={11.5} gap={8} />
                      </div>
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 13px', marginTop: 12, borderRadius: 999, background: MK.inset }}>
                      <Clock size={14} color={MK.ink3} />
                      <input type="time" value={m.time || ''} onChange={(e) => setTime(mi, e.target.value)} aria-label={t('trainerClientDetail.mealEditor.time', 'Time')}
                        style={{ background: 'transparent', border: 'none', outline: 'none', fontFamily: MK.mono, fontSize: 13, fontWeight: 700, color: MK.ink, width: 66 }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {day.meals.length === 0 && <p style={{ fontSize: 12, color: TT.textMute, textAlign: 'center', padding: '8px 0' }}>{t('trainerClientDetail.mealEditor.noMeals', 'No meals yet — add some.')}</p>}
          </div>
          <button type="button" onClick={onAddMeal} className="tt-tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '7px 12px', borderRadius: 10, background: TT.accentSoft, color: TT.accent, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={14} strokeWidth={2.4} /> {t('trainerClientDetail.mealEditor.addMeal', 'Add meal')}
          </button>
        </>
      )}
    </div>
  );
}

// ── Meal detail — what's actually IN the meal ────────────────────────────────
// A saved plan row only carries macros, so recover ingredients/steps/prep from
// the catalog by id. Without this a coach could see a meal's name and calories
// but had no way to answer "what's in it?" for the client asking.
function MealDetailModal({ meal, onClose, t, isEs }) {
  useScrollLock(true);
  const full = meal?.id != null ? CAT_BY_ID.get(meal.id) : null;
  const title = (isEs && (meal.title_es || full?.title_es)) || meal.title || full?.title || t('trainerNotes.nutrition.meal', 'Meal');
  const color = SLOT_COLOR[meal.slotType] || SLOT_COLOR.meal;
  const img = mealImg(meal);
  const ingredients = full?.ingredients || [];
  const steps = full?.steps || [];
  const prep = meal.prepTime ?? full?.prepTime;
  const label = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: MK.bg, borderRadius: 22, border: `1px solid ${TT.borderSolid}`, width: '100%', maxWidth: 440, maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
        {/* Hero */}
        <div style={{ position: 'relative', height: 148, flexShrink: 0, background: MK.surface2 }}>
          {img
            ? <img src={img} alt={title} onError={handleMealImgError} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: `repeating-linear-gradient(135deg, ${soft(color, 16)} 0 8px, ${soft(color, 8)} 8px 16px)` }}><UtensilsCrossed size={30} color={inkOf(color)} /></div>}
          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.1) 60%, transparent 100%)' }} />
          <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')}
            style={{ position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <X size={16} />
          </button>
          <div style={{ position: 'absolute', left: 14, right: 14, bottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <MkTag c={color} size="s">{slotLabel(t, meal.slotType)}</MkTag>
              {meal.time && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MK.mono, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
                  <Clock size={11} /> {meal.time}
                </span>
              )}
            </div>
            <div style={{ fontFamily: MK.disp, fontSize: 21, fontWeight: 900, color: '#fff', letterSpacing: -0.5, lineHeight: 1.1, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>{title}</div>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: 16 }}>
          {/* Calories + macros */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 11 }}>
            <span style={{ fontFamily: MK.disp, fontSize: 27, fontWeight: 900, color: MK.cal, letterSpacing: -1 }}>{Math.round(meal.calories) || 0}</span>
            <span style={{ fontFamily: MK.disp, fontSize: 12, fontWeight: 800, color: MK.ink3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('trainerMealPlan.cal', 'cal')}</span>
          </div>
          <MacroCells macros={{ protein: Math.round(meal.protein) || 0, carbs: Math.round(meal.carbs) || 0, fat: Math.round(meal.fat) || 0 }} />

          {/* Meta chips */}
          {(prep || full?.serves || full?.difficulty) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 13 }}>
              {prep ? <MkTag c={MK.ink3} size="s">{t('trainerMealPlan.prepMin', '{{n}} min', { n: prep })}</MkTag> : null}
              {full?.serves ? <MkTag c={MK.ink3} size="s">{t('trainerMealPlan.serves', 'Serves {{n}}', { n: full.serves })}</MkTag> : null}
              {full?.difficulty ? <MkTag c={MK.ink3} size="s">{isEs && full.difficulty_es ? full.difficulty_es : full.difficulty}</MkTag> : null}
            </div>
          )}

          {ingredients.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <p style={{ fontFamily: MK.disp, fontSize: 13, fontWeight: 900, color: MK.ink, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                {t('nutrition.ingredients', 'Ingredients')}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ingredients.map((ing, i) => (
                  <span key={i} style={{ padding: '6px 11px', borderRadius: 999, background: MK.surface2, color: MK.ink2, fontSize: 12.5, fontWeight: 600 }}>
                    {label(ing)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {steps.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <p style={{ fontFamily: MK.disp, fontSize: 13, fontWeight: 900, color: MK.ink, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                {t('nutrition.instructions', 'Instructions')}
              </p>
              <ol style={{ display: 'flex', flexDirection: 'column', gap: 9, margin: 0, padding: 0, listStyle: 'none' }}>
                {steps.map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10 }}>
                    <span style={{ width: 21, height: 21, flexShrink: 0, borderRadius: 999, background: soft(MK.teal, 16), color: inkOf(MK.teal), fontFamily: MK.disp, fontSize: 11, fontWeight: 900, display: 'grid', placeItems: 'center', marginTop: 1 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, color: MK.ink2, lineHeight: 1.5 }}>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {meal.notes && (
            <div style={{ marginTop: 18, padding: 12, borderRadius: 14, background: soft(MK.amber, 12) }}>
              <p style={{ fontSize: 10, fontWeight: 900, color: inkOf(MK.amber), textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>{t('trainerPlans.mealNotes', 'Notes')}</p>
              <p style={{ fontSize: 13, color: MK.ink2, lineHeight: 1.5 }}>{meal.notes}</p>
            </div>
          )}

          {!ingredients.length && !steps.length && (
            <p style={{ marginTop: 16, fontSize: 12.5, color: MK.ink3, lineHeight: 1.5 }}>
              {t('trainerClientDetail.mealEditor.noRecipeDetail', 'No recipe details saved for this meal — macros only.')}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────
export default function ClientMealPlanEditor({ plan, clientId, gymId, trainerId, prefs, computeMacros, onClose, onSaved }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const { showToast } = useToast();
  useScrollLock(true);
  const dayLabels = dayLabelsOf(t);

  const [name, setName] = useState(plan?.name || '');
  const [description, setDescription] = useState(plan?.description || '');
  const [targets, setTargets] = useState({
    calories: plan?.target_calories ? String(plan.target_calories) : '',
    protein: plan?.target_protein_g ? String(plan.target_protein_g) : '',
    carbs: plan?.target_carbs_g ? String(plan.target_carbs_g) : '',
    fat: plan?.target_fat_g ? String(plan.target_fat_g) : '',
  });
  const [weeks, setWeeks] = useState(() => toEditorWeeks(plan));
  const [weekIdx, setWeekIdx] = useState(() => {
    const { weekKeys } = mealPlanWeeks(plan);
    const cur = currentMealWeekKey(plan, weekKeys);
    return Math.max(0, weekKeys.indexOf(cur));
  });
  const [openDay, setOpenDay] = useState(0);
  const [picker, setPicker] = useState(null); // { mode:'add'|'swap', di, mi }
  const [saving, setSaving] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);

  const weekKeys = useMemo(() => Object.keys(weeks).sort((a, b) => Number(a) - Number(b)), [weeks]);
  const idx = Math.min(Math.max(weekIdx, 0), Math.max(weekKeys.length - 1, 0));
  const activeKey = weekKeys[idx];
  const days = weeks[activeKey] || [];

  const setDaysOf = (updater) => setWeeks((w) => ({ ...w, [activeKey]: updater(w[activeKey] || []) }));
  const addDay = () => { setDaysOf((ds) => [...ds, { meals: [] }]); setOpenDay(days.length); };
  const removeDay = (di) => setDaysOf((ds) => ds.filter((_, i) => i !== di));
  const setDay = (di, updater) => setDaysOf((ds) => ds.map((d, i) => (i === di ? updater(d) : d)));

  // A new week starts BLANK (distinct meals per week) — matching the last week's
  // day count so the structure is ready to fill, but NOT copying its meals (the
  // old clone made every added week a duplicate of week 1). Jump to it to edit.
  const addWeek = () => {
    setWeeks((w) => {
      const keys = Object.keys(w).map(Number).sort((a, b) => a - b);
      const lastKey = String(keys[keys.length - 1] ?? 1);
      const next = String((keys[keys.length - 1] ?? 0) + 1);
      const dayCount = Math.max(1, (w[lastKey] || []).length);
      const blank = Array.from({ length: dayCount }, () => ({ meals: [] }));
      return { ...w, [next]: blank };
    });
    setWeekIdx(weekKeys.length);
    setOpenDay(0);
  };
  const removeWeek = () => setWeeks((w) => {
    const keys = Object.keys(w).map(Number).sort((a, b) => a - b);
    if (keys.length <= 1) return w;
    const rest = { ...w }; delete rest[String(keys[keys.length - 1])];
    return rest;
  });

  const autoFillWeek = () => {
    if (autoFilling) return;
    setAutoFilling(true);
    setTimeout(() => {
      try {
        const tg = {
          calories: Number(targets.calories) || 2000, protein: Number(targets.protein) || 150,
          carbs: Number(targets.carbs) || 200, fat: Number(targets.fat) || 60,
        };
        const gen = generateWeekPlan({ targets: tg, slots: 4, allergies: prefs?.allergies || [], restrictions: prefs?.restrictions || [], lang: i18n.language || 'en' });
        const filled = gen.map((day) => ({ meals: (day.meals || []).map((m, mi) => toEditorMeal(m, m.slot || MEAL_SLOTS[mi]?.type || 'snack', MEAL_SLOTS[mi]?.time)) }));
        setWeeks((w) => ({ ...w, [activeKey]: filled }));
        setOpenDay(0);
      } catch (e) {
        showToast(t('trainerPlans.generateMealsFailed', 'Could not generate the meal plan. Try again.'), 'error');
      } finally { setAutoFilling(false); }
    }, 40);
  };

  const doPick = (m) => {
    if (!picker) return;
    const { mode, di, mi } = picker;
    setDaysOf((ds) => ds.map((d, i) => {
      if (i !== di) return d;
      if (mode === 'swap') {
        const cur = d.meals[mi];
        return { ...d, meals: d.meals.map((x, xi) => (xi === mi ? toEditorMeal(m, cur?.slotType || 'meal', cur?.time) : x)) };
      }
      const slot = MEAL_SLOTS[d.meals.length] || MEAL_SLOTS[MEAL_SLOTS.length - 1];
      return { ...d, meals: [...d.meals, toEditorMeal(m, slot.type, slot.time)] };
    }));
    setPicker(null);
  };

  const onSave = async () => {
    if (saving) return; setSaving(true);
    try {
      const patch = {
        name: name.trim() || plan?.name || t('trainerNotes.nutrition.customPlan', 'Custom Plan'),
        description: description.trim() || null,
        target_calories: intOrNull(targets.calories), target_protein_g: intOrNull(targets.protein),
        target_carbs_g: intOrNull(targets.carbs), target_fat_g: intOrNull(targets.fat),
        duration_weeks: weekKeys.length,
        meals: serializeMealWeeks(weeks),
        updated_at: new Date().toISOString(),
      };
      let saved;
      if (plan?.id) {
        const { error } = await supabase.from('trainer_meal_plans').update(patch).eq('id', plan.id);
        if (error) throw error;
        saved = { ...plan, ...patch };
      } else {
        const { error: deErr } = await supabase.from('trainer_meal_plans')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('client_id', clientId).eq('is_active', true);
        if (deErr) throw deErr;
        const start = new Date();
        const end = new Date(start.getTime() + weekKeys.length * 7 * 86400000);
        const { data, error } = await supabase.from('trainer_meal_plans').insert({
          gym_id: gymId, trainer_id: trainerId, client_id: clientId, ...patch, is_active: true,
          start_date: start.toISOString().split('T')[0], end_date: end.toISOString().split('T')[0],
        }).select().single();
        if (error) throw error;
        saved = data;
      }
      showToast(t('trainerClientDetail.mealEditor.saved', 'Meal plan saved for this client'), 'success');
      onSaved(saved);
    } catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
    finally { setSaving(false); }
  };

  const cellInput = { width: '100%', background: TT.surface2, borderRadius: 10, padding: '9px 8px', fontSize: 14, color: TT.text, textAlign: 'center', border: `1px solid ${TT.border}`, outline: 'none' };

  return createPortal(
    <div className="fixed inset-0 z-[125] flex flex-col" style={{ background: TT.bg }}>
      {/* paddingTop clears the notch/status bar — without it the X and title are
          drawn underneath the clock and battery on a real phone. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))', borderBottom: `1px solid ${TT.border}` }}>
        <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')} style={{ width: 38, height: 38, borderRadius: 11, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.text, flexShrink: 0 }}><X size={18} /></button>
        <div style={{ flex: 1, fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>{t('trainerClientDetail.mealEditor.title', 'Edit meal plan')}</div>
        <button type="button" onClick={onSave} disabled={saving} className="tt-tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 12, background: TT.accent, border: 'none', color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} strokeWidth={2.4} />} {t('trainerClientDetail.editor.save', 'Save')}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div className="md:max-w-[640px] md:mx-auto">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('trainerNotes.nutrition.planNamePlaceholder', 'e.g. Cutting Phase, Lean Bulk')}
            style={{ width: '100%', padding: '11px 12px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text, fontFamily: TFont.display, fontSize: 15, fontWeight: 700, outline: 'none', marginBottom: 10 }} />

          {/* Description — rendered on BOTH the coach's plan card and the member's
              "My Plan" section, so it needs an author here (there was state but
              no input, which forced every newly created plan to description:null). */}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder={t('trainerNotes.nutrition.descPlaceholder', 'Optional notes for the client…')}
            aria-label={t('trainerNotes.nutrition.description', 'Description')}
            style={{ width: '100%', padding: '11px 12px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.text, fontSize: 13.5, lineHeight: 1.45, resize: 'none', outline: 'none', marginBottom: 12, fontFamily: 'inherit' }} />

          {/* Daily macro targets */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <p style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{t('trainerNotes.nutrition.macroTargets', 'Daily Macro Targets')}</p>
            {computeMacros && (
              <button type="button" onClick={() => { const r = computeMacros(); if (r) setTargets({ calories: String(r.calories), protein: String(r.protein), carbs: String(r.carbs), fat: String(r.fat) }); else showToast(t('trainerClientDetail.mealEditor.noBodyData', "Add the client's weight first to calculate"), 'error'); }}
                className="tt-tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, color: TT.accent, padding: 0 }}>
                <Calculator size={13} /> {t('trainerClientDetail.mealEditor.calcFromData', 'From measurements')}
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            {[['calories', t('trainerNotes.nutrition.cal', 'Cal'), '2200'], ['protein', t('trainerNotes.nutrition.protein', 'Protein'), '160'], ['carbs', t('trainerNotes.nutrition.carbs', 'Carbs'), '250'], ['fat', t('trainerNotes.nutrition.fat', 'Fat'), '60']].map(([k, label, ph]) => (
              <div key={k}>
                <p style={{ fontSize: 10, color: TT.textMute, textAlign: 'center', marginBottom: 4 }}>{label}</p>
                <input type="number" inputMode="numeric" value={targets[k]} onChange={(e) => setTargets((s) => ({ ...s, [k]: e.target.value }))} placeholder={ph} style={cellInput} />
              </div>
            ))}
          </div>

          {/* Program length */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, padding: '8px 8px 8px 12px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.textSub }}>{t('trainerClientDetail.editor.programLength', 'Program length')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" onClick={removeWeek} disabled={weekKeys.length <= 1} aria-label={t('trainerClientDetail.editor.removeWeek', 'Remove week')} style={{ width: 30, height: 30, borderRadius: 9, background: TT.surface, border: `1px solid ${TT.border}`, color: TT.text, fontSize: 17, fontWeight: 800, cursor: weekKeys.length <= 1 ? 'default' : 'pointer', opacity: weekKeys.length <= 1 ? 0.4 : 1, display: 'grid', placeItems: 'center' }}>−</button>
              <span style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 14, color: TT.text, minWidth: 66, textAlign: 'center' }}>{weekKeys.length} {t('trainerNotes.program.weeks', 'weeks')}</span>
              <button type="button" onClick={addWeek} aria-label={t('trainerClientDetail.editor.addWeek', 'Add week')} style={{ width: 30, height: 30, borderRadius: 9, background: TT.surface, border: `1px solid ${TT.border}`, color: TT.text, fontSize: 17, fontWeight: 800, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>+</button>
            </div>
          </div>

          {/* Week pager + auto-fill */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            {weekKeys.length > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" onClick={() => setWeekIdx(idx - 1)} disabled={idx <= 0} style={{ width: 36, height: 36, borderRadius: 11, border: 'none', cursor: idx > 0 ? 'pointer' : 'default', background: idx > 0 ? TT.surface2 : 'transparent', color: idx > 0 ? TT.text : TT.textMute, opacity: idx > 0 ? 1 : 0.4, display: 'grid', placeItems: 'center' }}><ChevronLeft size={17} /></button>
                <div style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 14, color: TT.text, minWidth: 96, textAlign: 'center' }}>{t('trainerClientDetail.weekN', 'Week {{w}}', { w: activeKey })}<span style={{ color: TT.textMute, fontWeight: 600 }}> {t('trainerClientDetail.ofN', 'of {{n}}', { n: weekKeys.length })}</span></div>
                <button type="button" onClick={() => setWeekIdx(idx + 1)} disabled={idx >= weekKeys.length - 1} style={{ width: 36, height: 36, borderRadius: 11, border: 'none', cursor: idx < weekKeys.length - 1 ? 'pointer' : 'default', background: idx < weekKeys.length - 1 ? TT.surface2 : 'transparent', color: idx < weekKeys.length - 1 ? TT.text : TT.textMute, opacity: idx < weekKeys.length - 1 ? 1 : 0.4, display: 'grid', placeItems: 'center' }}><ChevronRight size={17} /></button>
              </div>
            ) : <span style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 14, color: TT.text }}>{t('trainerClientDetail.mealEditor.week1', 'Week 1')}</span>}
            <button type="button" onClick={autoFillWeek} disabled={autoFilling} className="tt-tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: TT.accentSoft, color: TT.accent, border: 'none', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: autoFilling ? 0.5 : 1, flexShrink: 0 }}>
              {autoFilling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t('trainerClientDetail.mealEditor.autoFill', 'Auto-fill week')}
            </button>
          </div>

          {days.map((d, di) => (
            <EditorDay key={di} day={d} index={di} label={dayLabels[di] || t('trainerMealPlan.dayN', 'Day {{n}}', { n: di + 1 })}
              open={openDay === di} onToggle={() => setOpenDay((o) => (o === di ? -1 : di))}
              onAddMeal={() => setPicker({ mode: 'add', di })} onSwapMeal={(mi) => setPicker({ mode: 'swap', di, mi })}
              onChangeDay={(upd) => setDay(di, upd)} onRemoveDay={() => removeDay(di)} t={t} isEs={isEs} />
          ))}

          <button type="button" onClick={addDay} className="tt-tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '11px', borderRadius: 12, background: 'transparent', color: TT.textSub, border: `1px dashed ${TT.border}`, fontFamily: TFont.display, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            <Plus size={15} strokeWidth={2.4} /> {t('trainerClientDetail.mealEditor.addDay', 'Add day')}
          </button>
        </div>
      </div>

      {picker && <MealPicker onPick={doPick} onClose={() => setPicker(null)} t={t} isEs={isEs} />}
    </div>,
    document.body,
  );
}

// ── Read-only week-paged view (for the Nutrition tab) ─────────────────────────
export function MealPlanWeekView({ plan }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dayLabels = dayLabelsOf(t);
  const { weeks, weekKeys } = useMemo(() => mealPlanWeeks(plan), [plan]);
  const [weekIdx, setWeekIdx] = useState(() => Math.max(0, weekKeys.indexOf(currentMealWeekKey(plan, weekKeys))));
  const [dayIdx, setDayIdx] = useState(0);
  const [detail, setDetail] = useState(null); // tapped meal → full recipe
  const idx = Math.min(Math.max(weekIdx, 0), Math.max(weekKeys.length - 1, 0));
  const activeKey = weekKeys[idx];
  const days = weeks[activeKey] || [];
  const day = days[Math.min(dayIdx, Math.max(days.length - 1, 0))];
  const totalMeals = days.reduce((n, d) => n + (d.meals?.length || 0), 0);
  if (totalMeals === 0) {
    return <p style={{ fontSize: 12.5, color: TT.textMute, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>{t('trainerClientDetail.mealEditor.targetsOnly', 'Targets only — no meals set. Tap Edit plan to build the week.')}</p>;
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
      {weekKeys.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <select value={idx} onChange={(e) => setWeekIdx(Number(e.target.value))} aria-label={t('trainerClientDetail.mealEditor.selectWeek', 'Select week')}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontFamily: TFont.display, fontSize: 13.5, fontWeight: 800, outline: 'none', cursor: 'pointer' }}>
            {weekKeys.map((k, i) => (
              <option key={k} value={i}>
                {t('trainerClientDetail.weekN', 'Week {{w}}', { w: k })} {t('trainerClientDetail.ofN', 'of {{n}}', { n: weekKeys.length })}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
        {days.map((d, i) => {
          const active = i === Math.min(dayIdx, days.length - 1);
          return (
            <button key={i} type="button" onClick={() => setDayIdx(i)} className="tt-tap"
              style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${active ? TT.accent : TT.border}`, background: active ? TT.accent : TT.surface2, color: active ? '#fff' : TT.textSub }}>
              {dayLabels[i] || t('trainerMealPlan.dayN', 'Day {{n}}', { n: i + 1 })}
            </button>
          );
        })}
      </div>
      {day?.meals?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
          {day.meals.map((m, mi) => {
            const color = SLOT_COLOR[m.slotType] || SLOT_COLOR.meal;
            const img = mealImg(m);
            const title = isEs && m.title_es ? m.title_es : m.title;
            return (
              <button key={mi} type="button" onClick={() => setDetail(m)} className="tt-tap text-left"
                aria-label={t('trainerClientDetail.mealEditor.viewMeal', 'View meal details')}
                style={{ background: MK.surface, borderRadius: 18, boxShadow: MK.shadow, overflow: 'hidden', border: 'none', padding: 0, width: '100%', cursor: 'pointer' }}>
                <div style={{ height: 4, background: color }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 12 }}>
                  <MealTile src={img} label={title} size={54} r={14} tint={color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <MkTag c={color} size="s">{slotLabel(t, m.slotType)}</MkTag>
                      {m.time && <span style={{ fontFamily: MK.mono, fontSize: 10.5, fontWeight: 700, color: MK.ink3 }}>{m.time}</span>}
                    </div>
                    <div className="truncate" style={{ fontFamily: MK.disp, fontSize: 14.5, fontWeight: 800, color: MK.ink, letterSpacing: -0.3, lineHeight: 1.15, margin: '7px 0 6px' }}>
                      {title || t('trainerNotes.nutrition.meal', 'Meal')}
                    </div>
                    <MacroReadout kcal={Math.round(m.calories)} macros={{ protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) }} size={11} gap={7} />
                  </div>
                  <ChevronRight size={17} style={{ color: MK.ink3, flexShrink: 0 }} />
                </div>
              </button>
            );
          })}
        </div>
      ) : <p style={{ fontSize: 12, color: TT.textMute, textAlign: 'center', padding: '12px 0' }}>{t('trainerClientDetail.mealEditor.noMeals', 'No meals yet — add some.')}</p>}

      {detail && <MealDetailModal meal={detail} onClose={() => setDetail(null)} t={t} isEs={isEs} />}
    </div>
  );
}

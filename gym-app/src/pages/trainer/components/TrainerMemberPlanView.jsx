// Trainer-facing, read-only view of a CLIENT's OWN weekly meal plan — the plan
// the member builds/adopts in the app's planner, now that it persists server-side
// (generated_meal_plans; readable by the coach via generated_meal_plans_trainer_read
// RLS = is_trainer_of). Distinct from the coach-ASSIGNED plan (trainer_meal_plans).
// Handles both stored shapes: the planner's native { date: { slot: meal } } (tagged
// planner_v1) and the legacy flat 7-day array from "Add to My Plan".

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, UtensilsCrossed, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { mealImageById } from '../../../lib/mealStore';
import { foodImageUrl, handleMealImgError } from '../../../lib/imageUrl';
import { TT, TFont } from './designTokens';

const SLOT_COLOR = { breakfast: '#F97316', lunch: '#EAB308', snack: '#34D399', snack1: '#34D399', snack2: '#34D399', dinner: '#8B5CF6', meal: TT.accent };

const normMeal = (m) => ({
  id: m.id ?? null,
  title: m.title || m.name || '',
  title_es: m.title_es || m.name_es || null,
  calories: Number(m.calories) || 0, protein: Number(m.protein) || 0, carbs: Number(m.carbs) || 0, fat: Number(m.fat) || 0,
  image: m.image || (m.id != null ? mealImageById(m.id) : null),
  slot: m.slot || m.slotType || 'meal', time: m.time || null,
});

function planDataToDays(planData) {
  if (!planData) return [];
  if (planData.format === 'planner_v1' && planData.days && typeof planData.days === 'object') {
    return Object.keys(planData.days).sort().map((date) => {
      const slots = planData.days[date] || {};
      const meals = Object.keys(slots).map((k) => slots[k]).filter(Boolean).map(normMeal);
      return { date, meals };
    }).filter((d) => d.meals.length);
  }
  if (Array.isArray(planData)) {
    return planData.map((d, i) => ({ date: null, dayN: i + 1, meals: (Array.isArray(d?.meals) ? d.meals : []).map(normMeal) })).filter((d) => d.meals.length);
  }
  return [];
}

export default function TrainerMemberPlanView({ clientId }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const loc = isEs ? 'es' : 'en';
  const [weeks, setWeeks] = useState(null); // null = loading
  const [wi, setWi] = useState(0);
  const [di, setDi] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase.from('generated_meal_plans')
      .select('week_start, plan_data')
      .eq('profile_id', clientId)
      .order('week_start', { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setWeeks([]); return; }
        setWeeks((data || []).map((r) => ({ week_start: r.week_start, days: planDataToDays(r.plan_data) })).filter((w) => w.days.length));
      });
    return () => { cancelled = true; };
  }, [clientId]);

  if (weeks === null) return null;

  const header = (
    <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <User size={16} color={TT.accent} strokeWidth={2.2} />
      {t('trainerClientDetail.memberPlan.title', "Member's own plan")}
    </div>
  );

  if (weeks.length === 0) {
    return (
      <>
        {header}
        <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 18, boxShadow: TT.shadow, padding: 18, marginBottom: 22, textAlign: 'center' }}>
          <UtensilsCrossed size={26} color={TT.textMute} strokeWidth={1.6} style={{ margin: '0 auto 6px', opacity: 0.4 }} />
          <p style={{ fontSize: 12.5, color: TT.textMute }}>{t('trainerClientDetail.memberPlan.none', "This client hasn't built their own weekly plan yet.")}</p>
        </div>
      </>
    );
  }

  const wIdx = Math.min(wi, weeks.length - 1);
  const w = weeks[wIdx];
  const dIdx = Math.min(di, w.days.length - 1);
  const day = w.days[dIdx];
  const wl = w.week_start ? new Date(`${w.week_start}T00:00:00`) : null;
  const chipLabel = (d, i) => (d.date ? new Date(`${d.date}T00:00:00`).toLocaleDateString(loc, { weekday: 'short' }) : t('trainerMealPlan.dayN', 'Day {{n}}', { n: d.dayN || i + 1 }));
  const dayTotals = (meals) => (meals || []).reduce((a, m) => ({ calories: a.calories + m.calories, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const totals = dayTotals(day?.meals);

  return (
    <>
      {header}
      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 18, boxShadow: TT.shadow, padding: 14, marginBottom: 22 }}>
        {/* Week pager (rows are newest-first) */}
        {weeks.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
            <button type="button" onClick={() => { setWi((x) => Math.min(weeks.length - 1, x + 1)); setDi(0); }} disabled={wIdx >= weeks.length - 1} aria-label={t('common:previous', 'Previous')}
              style={{ width: 32, height: 32, borderRadius: 9, border: 'none', cursor: wIdx < weeks.length - 1 ? 'pointer' : 'default', background: wIdx < weeks.length - 1 ? TT.surface2 : 'transparent', color: wIdx < weeks.length - 1 ? TT.text : TT.textMute, opacity: wIdx < weeks.length - 1 ? 1 : 0.4, display: 'grid', placeItems: 'center' }}><ChevronLeft size={16} /></button>
            <span style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 13, color: TT.text }}>
              {wl ? t('trainerClientDetail.memberPlan.weekOf', { defaultValue: 'Week of {{date}}', date: wl.toLocaleDateString(loc, { month: 'short', day: 'numeric' }) }) : t('trainerClientDetail.weekN', 'Week {{w}}', { w: wIdx + 1 })}
            </span>
            <button type="button" onClick={() => { setWi((x) => Math.max(0, x - 1)); setDi(0); }} disabled={wIdx <= 0} aria-label={t('common:next', 'Next')}
              style={{ width: 32, height: 32, borderRadius: 9, border: 'none', cursor: wIdx > 0 ? 'pointer' : 'default', background: wIdx > 0 ? TT.surface2 : 'transparent', color: wIdx > 0 ? TT.text : TT.textMute, opacity: wIdx > 0 ? 1 : 0.4, display: 'grid', placeItems: 'center' }}><ChevronRight size={16} /></button>
          </div>
        )}

        {/* Day chips */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
          {w.days.map((d, i) => {
            const on = i === dIdx;
            return (
              <button key={i} type="button" onClick={() => setDi(i)} className="tt-tap"
                style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? TT.accent : TT.border}`, background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub, textTransform: 'capitalize' }}>
                {chipLabel(d, i)}
              </button>
            );
          })}
        </div>

        {/* Day totals */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px 2px', fontSize: 11, fontWeight: 700, fontFamily: TFont.mono }}>
          <span style={{ color: TT.accent }}>{Math.round(totals.calories)} {t('trainerMealPlan.cal', 'cal')}</span>
          <span style={{ color: '#6D5FDB' }}>{Math.round(totals.protein)}g P</span>
          <span style={{ color: TT.warnInk }}>{Math.round(totals.carbs)}g C</span>
          <span style={{ color: '#FF5A2E' }}>{Math.round(totals.fat)}g F</span>
        </div>

        {/* Meals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 6 }}>
          {(day?.meals || []).map((m, mi) => {
            const color = SLOT_COLOR[m.slot] || SLOT_COLOR.meal;
            const img = m.image ? (/^https?:\/\//.test(m.image) ? m.image : foodImageUrl(m.image)) : null;
            const title = isEs && m.title_es ? m.title_es : m.title;
            return (
              <div key={mi} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: TT.surface2, border: `1px solid ${TT.border}`, borderRadius: 12 }}>
                {img
                  ? <img src={img} alt={title} loading="lazy" onError={handleMealImgError} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: TT.surface }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: TT.surface }}><UtensilsCrossed size={15} color={TT.textMute} /></div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color }}>{t(`nutrition.meals.${m.slot}`, m.slot === 'meal' ? t('trainerNotes.nutrition.meal', 'Meal') : m.slot)}{m.time ? ` · ${m.time}` : ''}</span>
                  <p style={{ fontSize: 13, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '1px 0 0' }}>{title || t('trainerNotes.nutrition.meal', 'Meal')}</p>
                  <p style={{ fontSize: 10.5, color: TT.textSub, fontFamily: TFont.mono, marginTop: 1 }}>{Math.round(m.calories)} {t('trainerMealPlan.cal', 'cal')} · {Math.round(m.protein)}P · {Math.round(m.carbs)}C · {Math.round(m.fat)}F</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

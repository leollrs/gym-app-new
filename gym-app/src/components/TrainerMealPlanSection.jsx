import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UtensilsCrossed, ChevronDown, CalendarPlus, ShoppingCart, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getMeals } from '../lib/mealStore';
const MEALS = getMeals();
import { foodImageUrl } from '../lib/imageUrl';
import logger from '../lib/logger';

// ── Member-side surface for trainer-assigned meal plans (P0-2) ────────────
// trainer_meal_plans is client-readable via RLS (0193
// trainer_meal_plans_client_select); 0537 re-asserts it defensively and adds
// the assignment notification + nutrition_targets sync. Pre-0537 (or on any
// read failure) this renders nothing — Nutrition home is unaffected.
// Mounted in Nutrition's HomeView; shows the most recent ACTIVE plan with
// daily targets and the day-by-day meals saved by the trainer.

const SLOT_META = {
  breakfast: { labelKey: 'nutrition.meals.breakfast', color: '#F97316' },
  lunch:     { labelKey: 'nutrition.meals.lunch',     color: 'var(--color-warning, #EAB308)' },
  snack:     { labelKey: 'nutrition.meals.snack',     color: 'var(--color-success, #34D399)' },
  dinner:    { labelKey: 'nutrition.meals.dinner',    color: '#8B5CF6' },
};

export default function TrainerMealPlanSection({ userId, groceryList = [], onAddGroceryItems }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const { user } = useAuth();
  const uid = userId || user?.id;
  const [plan, setPlan] = useState(null);
  // Expanded by default: collapsed-by-default hid the day-by-day meals behind
  // an unobvious tap and read as "the plan shows no items".
  const [expanded, setExpanded] = useState(true);
  const [dayIdx, setDayIdx] = useState(0);
  const [addPlanState, setAddPlanState] = useState('idle'); // idle | saving | done | error

  // Compact meal JSON in the plan omits images — recover from the catalog.
  const mealById = useMemo(() => new Map(MEALS.map(m => [m.id, m])), []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    supabase
      .from('trainer_meal_plans')
      .select('id, name, description, target_calories, target_protein_g, target_carbs_g, target_fat_g, meals, is_active, created_at, start_date, duration_weeks, trainer:profiles!trainer_meal_plans_trainer_id_fkey(full_name)')
      .eq('client_id', uid)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Missing RLS pre-0537 / transient failure → hide quietly
          logger.error('TrainerMealPlanSection: failed to load meal plan:', error);
          setPlan(null);
          return;
        }
        setPlan(data || null);
      })
      .catch(err => {
        if (!cancelled) { logger.error('TrainerMealPlanSection: failed to load meal plan:', err); setPlan(null); }
      });
    return () => { cancelled = true; };
  }, [uid]);

  if (!plan) return null;

  // Robust to both stored shapes: the canonical day-nested
  // [{day, meals:[...], totals}] (TrainerPlans), and a legacy/defensive flat
  // meal array [{id, title, ...}] which we treat as a single day.
  const rawDays = Array.isArray(plan.meals) ? plan.meals : [];
  const days = rawDays.length > 0 && !Array.isArray(rawDays[0]?.meals) && (rawDays[0]?.id || rawDays[0]?.title)
    ? [{ day: 1, meals: rawDays }]
    : rawDays;
  const day = days[Math.min(dayIdx, Math.max(days.length - 1, 0))];
  const dayLabels = [
    t('trainerPlans.dayMon', 'Mon'), t('trainerPlans.dayTue', 'Tue'), t('trainerPlans.dayWed', 'Wed'),
    t('trainerPlans.dayThu', 'Thu'), t('trainerPlans.dayFri', 'Fri'), t('trainerPlans.daySat', 'Sat'),
    t('trainerPlans.daySun', 'Sun'),
  ];

  const targets = [
    plan.target_calories ? { v: `${plan.target_calories} ${t('trainerMealPlan.cal', 'cal')}`, c: 'var(--color-accent)' } : null,
    plan.target_protein_g ? { v: `${plan.target_protein_g}g P`, c: '#60A5FA' } : null,
    plan.target_carbs_g ? { v: `${plan.target_carbs_g}g C`, c: '#34D399' } : null,
    plan.target_fat_g ? { v: `${plan.target_fat_g}g F`, c: '#F472B6' } : null,
  ].filter(Boolean);

  // ── "Add to grocery list" ──────────────────────────────────────────────
  // The MEALS catalog has no per-ingredient data, so the shoppable unit is
  // the meal itself: one grocery line per UNIQUE meal across the plan,
  // grouped under the plan's name. Item ids carry a `_tp_<planId>` suffix so
  // "already added" can be derived from the live grocery list — delete the
  // items there and this button re-arms (per request: added-state persists
  // unless removed from groceries).
  const grocerySuffix = `_tp_${plan.id}`;
  const groceryAddedForPlan = (groceryList || []).some(i => typeof i?.id === 'string' && i.id.endsWith(grocerySuffix));
  const handleAddPlanToGroceries = () => {
    if (!onAddGroceryItems || groceryAddedForPlan) return;
    const seen = new Set();
    const items = [];
    for (const d of days) {
      for (const meal of (d?.meals || [])) {
        const full = meal.id != null ? mealById.get(meal.id) : null;
        const title = isEs && (meal.title_es || full?.title_es)
          ? (meal.title_es || full?.title_es)
          : (meal.title || full?.title);
        if (!title) continue;
        const key = `meal_${meal.id ?? title}`;
        if (seen.has(key)) continue; // dedup repeated meals across days
        seen.add(key);
        items.push({
          id: `${key}${grocerySuffix}`,
          label: title,
          category: plan.name || t('trainerMealPlan.sectionTitle', 'Meal plan from your coach'),
          fromRecipe: plan.name,
          checked: false,
        });
      }
    }
    if (items.length) onAddGroceryItems(items);
  };

  // ── "Add to My Plan" ───────────────────────────────────────────────────
  // Writes the coach's days into generated_meal_plans using the EXACT shape
  // the weekly planner reads ({meals:[{id,name,name_es,...,eaten:false}],
  // totals} ×7, Monday-first, onConflict profile_id+week_start — mirrors the
  // regenerate-week writer in Nutrition.jsx). Fewer than 7 coach days cycle.
  const handleAddToMyPlan = async () => {
    if (!uid || addPlanState === 'saving' || days.length === 0) return;
    const confirmMsg = t('trainerMealPlan.replacePlanConfirm', "This replaces this week's My Plan with your coach's plan. Continue?");
    if (!window.confirm(confirmMsg)) return;
    setAddPlanState('saving');
    try {
      const nextPlan = Array.from({ length: 7 }, (_, i) => {
        const src = days[i % days.length] || { meals: [] };
        const newMeals = (src.meals || []).map(m => {
          const full = m.id != null ? mealById.get(m.id) : null;
          return {
            id: m.id ?? null,
            name: m.title || full?.title || '',
            name_es: m.title_es || full?.title_es || null,
            calories: m.calories || 0, protein: m.protein || 0,
            carbs: m.carbs || 0, fat: m.fat || 0,
            eaten: false,
          };
        }).filter(m => m.name);
        const totals = src.totals || newMeals.reduce((a, m) => ({
          calories: a.calories + m.calories, protein: a.protein + m.protein,
          carbs: a.carbs + m.carbs, fat: a.fat + m.fat,
        }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
        return { meals: newMeals, totals };
      });
      const macroTargets = {
        calories: plan.target_calories || 2400,
        protein: plan.target_protein_g || 150,
        carbs: plan.target_carbs_g || 250,
        fat: plan.target_fat_g || 80,
      };
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const weekStartStr = startOfWeek.toISOString().split('T')[0];
      const { error } = await supabase
        .from('generated_meal_plans')
        .upsert({
          profile_id: uid,
          week_start: weekStartStr,
          plan_data: nextPlan,
          macro_targets: macroTargets,
          is_active: true,
        }, { onConflict: 'profile_id,week_start' });
      if (error) throw error;
      setAddPlanState('done');
    } catch (err) {
      logger.error('TrainerMealPlanSection: add to My Plan failed:', err);
      setAddPlanState('error');
      setTimeout(() => setAddPlanState('idle'), 3000);
    }
  };

  return (
    <div className="px-4 pb-4">
      <div
        className="rounded-[18px] overflow-hidden"
        style={{
          background: 'color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-card))',
          border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
        }}
      >
        {/* Header row — always visible, toggles the day view */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
          aria-expanded={expanded}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
            <UtensilsCrossed size={16} style={{ color: 'var(--color-accent)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--color-accent)' }}>
              {t('trainerMealPlan.sectionTitle', 'Meal plan from your coach')}
            </p>
            <p className="text-[14px] font-bold truncate mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{plan.name}</p>
            {(() => {
              const dw = Number(plan.duration_weeks) || 1;
              if (dw <= 1) return null;
              // Which week the member is on, from the plan's start (or created) date.
              const start = plan.start_date ? new Date(plan.start_date + 'T00:00:00') : (plan.created_at ? new Date(plan.created_at) : null);
              let curWeek = null;
              if (start) {
                const wk = Math.floor((Date.now() - start.getTime()) / (7 * 86400000)) + 1;
                if (wk >= 1 && wk <= dw) curWeek = wk;
              }
              return (
                <p className="text-[11px] mt-0.5 font-semibold truncate" style={{ color: 'var(--color-accent)' }}>
                  {curWeek
                    ? t('trainerMealPlan.weekOf', 'Week {{w}} of {{n}}', { w: curWeek, n: dw })
                    : t('trainerMealPlan.weekPlan', '{{n}}-week plan', { n: dw })}
                </p>
              );
            })()}
            {plan.trainer?.full_name && (
              <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerMealPlan.byCoach', 'From {{name}}', { name: plan.trainer.full_name })}
              </p>
            )}
          </div>
          <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
        </button>

        {/* Daily targets strip */}
        {targets.length > 0 && (
          <div className="flex items-center gap-3 px-4 pb-3 -mt-1 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
              {t('trainerMealPlan.dailyTargets', 'Daily targets')}:
            </span>
            {targets.map((tg, i) => (
              <span key={i} className="text-[11.5px] font-bold tabular-nums" style={{ color: tg.c }}>{tg.v}</span>
            ))}
          </div>
        )}

        {expanded && (
          <div style={{ borderTop: '1px solid color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
            {plan.description && (
              <p className="text-[12px] leading-relaxed px-4 pt-3" style={{ color: 'var(--color-text-muted)' }}>{plan.description}</p>
            )}

            {days.length === 0 ? (
              <p className="text-[12px] px-4 py-4" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerMealPlan.targetsOnly', 'Your coach set daily targets for you — no fixed meals. Log whatever fits them.')}
              </p>
            ) : (
              <>
                {/* Day chips */}
                <div className="flex gap-1.5 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: 'none' }}>
                  {days.map((d, i) => {
                    const active = dayIdx === i;
                    return (
                      <button
                        key={i}
                        onClick={() => setDayIdx(i)}
                        className="shrink-0 px-3 py-1.5 rounded-full text-[11.5px] font-bold min-h-[34px] transition-colors"
                        style={active
                          ? { background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }
                          : { background: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
                      >
                        {dayLabels[i] || t('trainerMealPlan.dayN', 'Day {{n}}', { n: d.day || i + 1 })}
                      </button>
                    );
                  })}
                </div>

                {/* Day totals */}
                {day?.totals && (
                  <div className="flex items-center gap-3 px-4 pb-2 text-[11px] font-semibold tabular-nums">
                    <span style={{ color: 'var(--color-accent)' }}>{day.totals.calories || 0} {t('trainerMealPlan.cal', 'cal')}</span>
                    <span style={{ color: '#60A5FA' }}>{day.totals.protein || 0}g P</span>
                    <span style={{ color: '#34D399' }}>{day.totals.carbs || 0}g C</span>
                    <span style={{ color: '#F472B6' }}>{day.totals.fat || 0}g F</span>
                  </div>
                )}

                {/* Plan actions */}
                <div className="px-3 pb-1 pt-1 flex flex-col gap-2">
                  <button
                    onClick={handleAddToMyPlan}
                    disabled={addPlanState === 'saving' || addPlanState === 'done'}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] text-[12.5px] font-bold active:scale-[0.98] transition-all"
                    style={addPlanState === 'done'
                      ? { background: 'rgba(16,185,129,0.12)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.25)' }
                      : { background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)', opacity: addPlanState === 'saving' ? 0.6 : 1 }}
                  >
                    {addPlanState === 'done'
                      ? <><Check size={14} /> {t('trainerMealPlan.addedToMyPlan', 'Added to My Plan')}</>
                      : addPlanState === 'error'
                        ? t('trainerMealPlan.addToMyPlanFailed', "Couldn't add — try again")
                        : <><CalendarPlus size={14} /> {addPlanState === 'saving' ? t('trainerMealPlan.adding', 'Adding…') : t('trainerMealPlan.addToMyPlan', 'Add to My Plan')}</>}
                  </button>
                  {onAddGroceryItems && (
                    <button
                      onClick={handleAddPlanToGroceries}
                      disabled={groceryAddedForPlan}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] text-[12.5px] font-bold active:scale-[0.98] transition-all"
                      style={groceryAddedForPlan
                        ? { background: 'rgba(16,185,129,0.12)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.25)' }
                        : { background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}
                    >
                      {groceryAddedForPlan
                        ? <><Check size={14} /> {t('trainerMealPlan.addedToGroceries', 'In your grocery list')}</>
                        : <><ShoppingCart size={14} /> {t('trainerMealPlan.addToGroceries', 'Add to grocery list')}</>}
                    </button>
                  )}
                </div>

                {/* Meals for the selected day */}
                <div className="px-3 pb-3 space-y-2">
                  {(day?.meals || []).map((meal, mi) => {
                    const slot = SLOT_META[meal.slotType || meal.slot] || SLOT_META.lunch;
                    const full = mealById.get(meal.id);
                    const title = isEs && (meal.title_es || full?.title_es)
                      ? (meal.title_es || full?.title_es)
                      : (meal.title || full?.title);
                    // Custom-meal photos save a full URL on meal.image; catalog
                    // meals resolve their path via the food-images bucket.
                    const img = meal.image
                      ? (/^https?:\/\//.test(meal.image) ? meal.image : foodImageUrl(meal.image))
                      : foodImageUrl(full?.image);
                    return (
                      <div key={mi} className="rounded-xl p-2.5 flex gap-3 items-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                        {img ? (
                          <img src={img} alt={title} className="w-14 h-14 rounded-lg object-cover shrink-0" loading="lazy" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }} />
                        ) : (
                          <div className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                            <UtensilsCrossed size={16} style={{ color: 'var(--color-text-subtle)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: slot.color }}>
                            {t(slot.labelKey, meal.slotType || 'Meal')}{meal.time ? ` · ${meal.time}` : ''}
                          </span>
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
                          <div className="flex items-center gap-2.5 mt-0.5 text-[10.5px] tabular-nums">
                            <span style={{ color: 'var(--color-accent)' }}>{meal.calories} {t('trainerMealPlan.cal', 'cal')}</span>
                            <span style={{ color: '#60A5FA' }}>{meal.protein}g P</span>
                            <span style={{ color: '#34D399' }}>{meal.carbs}g C</span>
                            <span style={{ color: '#F472B6' }}>{meal.fat}g F</span>
                          </div>
                          {meal.notes && (
                            <p className="text-[11px] mt-1 italic" style={{ color: 'var(--color-text-muted)' }}>{meal.notes}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

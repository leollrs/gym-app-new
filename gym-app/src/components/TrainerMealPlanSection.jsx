import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UtensilsCrossed, ChevronDown, ChevronLeft, ChevronRight, CalendarPlus, ShoppingCart, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getMeals } from '../lib/mealStore';
const MEALS = getMeals();
import { foodImageUrl } from '../lib/imageUrl';
import { mealPlanWeeks, currentMealWeekKey } from '../lib/mealPlanWeeks';
import {
  loadMealSchedule, saveMealSchedule, plannerSlotKeys,
  MEAL_SLOT_MIN, MEAL_SLOT_MAX,
} from '../lib/mealNotifications';
import logger from '../lib/logger';

// ── Member-side surface for trainer-assigned meal plans (P0-2) ────────────
// trainer_meal_plans is client-readable via RLS (0193
// trainer_meal_plans_client_select); 0537 re-asserts it defensively and adds
// the assignment notification + nutrition_targets sync. Pre-0537 (or on any
// read failure) this renders nothing — Nutrition home is unaffected.
// Mounted in Nutrition's HomeView; shows the most recent ACTIVE plan with
// daily targets and the day-by-day meals saved by the trainer.

// Sunday-first local week key — must match the planner's getWeekStartDate();
// toISOString() is UTC and lands on the wrong week in negative offsets.
const weekStartKey = (d = new Date()) => {
  const s = new Date(d);
  s.setDate(s.getDate() - s.getDay());
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
};

const SLOT_META = {
  breakfast: { labelKey: 'nutrition.meals.breakfast', color: '#F97316' },
  lunch:     { labelKey: 'nutrition.meals.lunch',     color: 'var(--color-warning, #EAB308)' },
  snack:     { labelKey: 'nutrition.meals.snack',     color: 'var(--color-success, #34D399)' },
  dinner:    { labelKey: 'nutrition.meals.dinner',    color: '#8B5CF6' },
};

export default function TrainerMealPlanSection({ userId, groceryList = [], onAddGroceryItems, onOpenRecipe }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const { user, profile } = useAuth();
  const uid = userId || user?.id;
  const [plan, setPlan] = useState(null);
  // Expanded by default: collapsed-by-default hid the day-by-day meals behind
  // an unobvious tap and read as "the plan shows no items".
  const [expanded, setExpanded] = useState(true);
  const [dayIdx, setDayIdx] = useState(0);
  const [viewWeek, setViewWeek] = useState(null);
  const [addPlanState, setAddPlanState] = useState('idle'); // idle | saving | done | error

  // DERIVED, not remembered. Read the member's actual week and check it still
  // carries this plan's stamp with meals in it. Deleting the week — or the
  // coach editing the plan — re-arms the button by itself, because the thing
  // being checked is the thing that changed.
  useEffect(() => {
    if (!uid || !plan?.id) return undefined;
    let cancelled = false;
    const check = async () => {
      const { data, error } = await supabase
        .from('generated_meal_plans')
        .select('plan_data')
        .eq('profile_id', uid)
        .eq('week_start', weekStartKey())
        .maybeSingle();
      if (cancelled || error) return;
      const rows = Array.isArray(data?.plan_data) ? data.plan_data : [];
      const stillThere = rows.some(d =>
        d?.from_plan === plan.id
        && String(d?.from_v ?? '') === String(plan.updated_at || '')
        && (d.meals || []).length > 0);
      setAddPlanState(prev => (prev === 'saving' ? prev : (stillThere ? 'done' : 'idle')));
    };
    check();
    // writePlanWeek mirrors to generated_meal_plans FIRE-AND-FORGET and the
    // event is dispatched immediately after, so a single read here can beat
    // the write. Re-check once the round-trip has had time to land.
    let t2 = null;
    const onChanged = () => {
      check();
      if (t2) clearTimeout(t2);
      t2 = setTimeout(check, 1200);
    };
    window.addEventListener('tugympr:meal-plan-changed', onChanged);
    return () => {
      cancelled = true;
      if (t2) clearTimeout(t2);
      window.removeEventListener('tugympr:meal-plan-changed', onChanged);
    };
  }, [uid, plan?.id, plan?.updated_at]);

  // Compact meal JSON in the plan omits images — recover from the catalog.
  const mealById = useMemo(() => new Map(MEALS.map(m => [m.id, m])), []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        // A meal plan reaches this member as the legacy client_id OR shared via
        // trainer_meal_plan_members (0645). Take the most-recent active one.
        let junctionIds = [];
        const { data: jm, error: jmErr } = await supabase
          .from('trainer_meal_plan_members')
          .select('plan_id')
          .eq('member_id', uid);
        if (!jmErr) junctionIds = (jm || []).map(r => r.plan_id).filter(Boolean);

        let q = supabase
          .from('trainer_meal_plans')
          .select('id, name, description, target_calories, target_protein_g, target_carbs_g, target_fat_g, meals, is_active, created_at, updated_at, start_date, duration_weeks, trainer:profiles!trainer_meal_plans_trainer_id_fkey(full_name)')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1);
        q = junctionIds.length
          ? q.or(`client_id.eq.${uid},id.in.(${junctionIds.join(',')})`)
          : q.eq('client_id', uid);

        const { data, error } = await q.maybeSingle();
        if (cancelled) return;
        if (error) {
          // Missing RLS pre-0537 / transient failure → hide quietly
          logger.error('TrainerMealPlanSection: failed to load meal plan:', error);
          setPlan(null);
          return;
        }
        setPlan(data || null);
      } catch (err) {
        if (!cancelled) { logger.error('TrainerMealPlanSection: failed to load meal plan:', err); setPlan(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  if (!plan) return null;

  // Week-aware: a plan can now hold DISTINCT meals per week (week-keyed object),
  // so show the week the member is currently on. mealPlanWeeks() also normalizes
  // the legacy flat [{day, meals}] / bare-meal-array shapes into a single week.
  const { weeks: planWeeks, weekKeys: planWeekKeys } = mealPlanWeeks(plan);
  // Browsable: a multi-week plan was pinned to the current week with no way to
  // look ahead. `viewWeek === null` means "follow the member's actual week".
  const liveWeekKey = currentMealWeekKey(plan, planWeekKeys);
  const shownWeekKey = viewWeek ?? liveWeekKey;
  const weekIdx = planWeekKeys.indexOf(shownWeekKey);
  const days = planWeeks[shownWeekKey] || [];
  const day = days[Math.min(dayIdx, Math.max(days.length - 1, 0))];
  const dayLabels = [
    t('trainerPlans.daySun', 'Sun'), t('trainerPlans.dayMon', 'Mon'), t('trainerPlans.dayTue', 'Tue'),
    t('trainerPlans.dayWed', 'Wed'), t('trainerPlans.dayThu', 'Thu'), t('trainerPlans.dayFri', 'Fri'),
    t('trainerPlans.daySat', 'Sat'),
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
  // totals} ×7, SUNDAY-first, onConflict profile_id+week_start — mirrors the
  // regenerate-week writer in Nutrition.jsx). Fewer than 7 coach days cycle.
  // (The old "Monday-first" note here was stale: slot 0 has always been Sunday,
  // which is why the day labels now read Sun→Sat.)
  const handleAddToMyPlan = async () => {
    // Guard on the whole plan, not the week on screen — adding now writes
    // every authored week.
    if (!uid || addPlanState === 'saving') return;
    if (!planWeekKeys.some(wk => (planWeeks[wk] || []).some(d => (d.meals || []).length > 0))) return;
    const confirmMsg = t('trainerMealPlan.replacePlanConfirmAll', 'This replaces {{n}} week(s) of My Plan with your coach\u2019s plan, starting this week. Continue?', { n: planWeekKeys.length });
    if (!window.confirm(confirmMsg)) return;
    setAddPlanState('saving');
    try {
      // How many slots the coach's day needs. Counting meals alone was wrong
      // twice over: it floored at 2, and plannerSlotKeys(2) is ['lunch',
      // 'dinner'] — so a breakfast+lunch plan came out relabelled as lunch+
      // dinner. If any meal is a breakfast we need at least the 3-slot layout.
      const allDays = planWeekKeys.flatMap(wk => planWeeks[wk] || []);
      const coachSlotTypes = allDays.flatMap(d => (d.meals || []).map(m => m.slotType || m.slot || null));
      const coachMax = Math.max(1, ...allDays.map(d => (d.meals || []).length));
      const needsBreakfast = coachSlotTypes.some(s => s === 'breakfast');
      const wanted = Math.max(coachMax, needsBreakfast ? 3 : MEAL_SLOT_MIN);
      const prevSchedule = loadMealSchedule(uid);
      // WIDEN only. Narrowing was permanent and global — it dropped the
      // member's extra slots and their saved times for EVERY future week, not
      // just the adopted one.
      const nextCount = Math.min(MEAL_SLOT_MAX, Math.max(wanted, prevSchedule.count));
      const nextKeys = plannerSlotKeys(nextCount);
      // Resolve each coach meal to a real slot key ONCE, here, and store it on
      // the meal. The reader then honours it instead of guessing by position —
      // position broke whenever a meal was dropped (every later meal shifted a
      // slot) and whenever the member had dragged their slots into a different
      // order from the canonical one this is written in.
      const slotFor = (m, idx) => {
        const raw = m.slotType || m.slot || null;
        if (raw && nextKeys.includes(raw)) return raw;
        if (raw === 'snack') return nextKeys.find(k => k.startsWith('snack')) || nextKeys[idx] || nextKeys[nextKeys.length - 1];
        return nextKeys[idx] || nextKeys[nextKeys.length - 1];
      };

      const buildWeek = (srcDays) => Array.from({ length: 7 }, (_, i) => {
        // Positional by DAY, so a blank authored day stays blank on that day.
        // Only a plan authored with FEWER than 7 days cycles.
        const src = (srcDays.length >= 7 ? srcDays[i] : srcDays[i % srcDays.length]) || { meals: [] };
        const used = new Set();
        const newMeals = (src.meals || []).map((m, mi) => {
          const full = m.id != null ? mealById.get(m.id) : null;
          let slot = slotFor(m, mi);
          // Two coach meals resolving to the same slot would overwrite each
          // other on read — push the second to the first free key.
          if (used.has(slot)) slot = nextKeys.find(k => !used.has(k)) || slot;
          used.add(slot);
          return {
            id: m.id ?? null,
            name: m.title || full?.title || '',
            name_es: m.title_es || full?.title_es || null,
            calories: m.calories || 0, protein: m.protein || 0,
            carbs: m.carbs || 0, fat: m.fat || 0,
            slot,
            time: m.time || m.at || null,
            eaten: false,
          };
        }).filter(m => m.name);
        const totals = src.totals || newMeals.reduce((a, m) => ({
          calories: a.calories + m.calories, protein: a.protein + m.protein,
          carbs: a.carbs + m.carbs, fat: a.fat + m.fat,
        }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
        // Provenance stamped INTO the week itself. "Already added" is then
        // DERIVED from the plan that actually exists, the way the grocery
        // button below already does it — a separate flag claimed the plan was
        // added and kept claiming it after the member deleted the week.
        return { meals: newMeals, totals, from_plan: plan.id, from_v: plan.updated_at || '' };
      });
      const macroTargets = {
        calories: plan.target_calories || 2400,
        protein: plan.target_protein_g || 150,
        carbs: plan.target_carbs_g || 250,
        fat: plan.target_fat_g || 80,
      };
      // EVERY authored week, not just the one on screen. generated_meal_plans is
      // keyed by (profile_id, week_start), so a 50-week plan becomes 50 rows on
      // 50 consecutive weeks starting from this one — it was writing a single
      // week and calling that "added".
      // Start from the week the member is ACTUALLY on, not week 1. The card
      // renders "Week 3 of 12" directly above this button; writing authored
      // week 1 into the current calendar week restarted a mid-plan member.
      const liveIdx = Math.max(0, planWeekKeys.indexOf(liveWeekKey));
      const base = new Date();
      base.setDate(base.getDate() - base.getDay());
      const rows = planWeekKeys.slice(liveIdx).map((wk, i) => {
        // Keep blank days in place. Filtering them out and then indexing the
        // FILTERED array positionally shifted the whole week: a coach leaving
        // Sunday empty put Monday's meals on Sunday. The preview doesn't
        // filter either, so preview and write now agree.
        const srcDays = planWeeks[wk] || [];
        if (!srcDays.some(d => (d.meals || []).length > 0)) return null;
        const ws = new Date(base);
        ws.setDate(ws.getDate() + i * 7);
        return {
          profile_id: uid,
          gym_id: profile?.gym_id,   // NOT NULL — omitting it silently failed the write
          week_start: weekStartKey(ws),
          plan_data: buildWeek(srcDays),
          macro_targets: macroTargets,
          is_active: true,
        };
      }).filter(Boolean);
      if (!rows.length) throw new Error('plan has no weeks with meals');

      const weekStartStr = rows[0].week_start;
      const { error } = await supabase
        .from('generated_meal_plans')
        .upsert(rows, { onConflict: 'profile_id,week_start' });
      if (error) throw error;
      // Widen (or narrow) My Plan's meals/day to fit the coach's day before the
      // planner re-reads. The planner renders exactly `mealSchedule.count`
      // slots and drops anything past them: a member on 3 meals/day who
      // adopted a 4-meal coach plan simply never saw the 4th — it was written
      // to the server and then thrown away at render.
      // Times ride the SLOT each meal resolved to above, not its position —
      // meals and times were being mapped through two different orders, so a
      // row could read "Breakfast · 8:00" over the coach's lunch.
      const nextTimes = { ...prevSchedule.times };
      (rows[0]?.plan_data?.[0]?.meals || []).forEach((m) => {
        if (m.time && m.slot) nextTimes[m.slot] = m.time;
      });
      saveMealSchedule(uid, { ...prevSchedule, count: nextCount, times: nextTimes });

      // The live planner reads generated_meal_plans; drop this week's local cache
      // so it re-hydrates from the server copy we just wrote (adopt = replace).
      try {
        rows.forEach(r => localStorage.removeItem(`meal_plan_${uid}_${r.week_start}`));
        // …and the LEGACY un-suffixed key writePlanWeek also maintains for the
        // current week. Clearing only the suffixed one left the planner's
        // synchronous loader falling through to the legacy copy, repainting
        // the PRE-adoption week after the UI said "Added to My Plan".
        localStorage.removeItem(`meal_plan_${uid}`);
      } catch { /* ignore */ }
      // …and TELL it to re-read. Clearing the cache alone changed nothing on
      // screen: My Plan holds the week in React state, so it kept rendering the
      // old plan until the page remounted — the coach's plan "appeared" in this
      // card but never actually replaced anything. Every other writer of
      // generated_meal_plans (Nutrition.jsx persistPlan, the add-to-plan sheet)
      // fires this same event; this one was the only one that didn't.
      try {
        window.dispatchEvent(new CustomEvent('tugympr:meal-schedule-changed'));
        window.dispatchEvent(new CustomEvent('tugympr:meal-plan-changed', {
          detail: { weekStart: weekStartStr },
        }));
      } catch { /* no-op */ }
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

            {/* Week pager — the plan was pinned to the current week with no way
                to look ahead at what the coach programmed. */}
            {planWeekKeys.length > 1 && (
              <div className="flex items-center justify-between px-4 pt-3">
                <button
                  type="button"
                  onClick={() => { setViewWeek(planWeekKeys[Math.max(0, weekIdx - 1)]); setDayIdx(0); }}
                  disabled={weekIdx <= 0}
                  aria-label={t('trainerPlanViewer.prevWeek', 'Previous week')}
                  className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-25"
                  style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('trainerPlanViewer.weekXOfY', 'Week {{current}} of {{total}}', {
                    current: weekIdx + 1, total: planWeekKeys.length,
                  })}
                  {shownWeekKey !== liveWeekKey && (
                    <span className="ml-2 text-[10.5px] font-bold uppercase" style={{ color: 'var(--color-accent)' }}>
                      {t('trainerMealPlan.preview', 'Preview')}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => { setViewWeek(planWeekKeys[Math.min(planWeekKeys.length - 1, weekIdx + 1)]); setDayIdx(0); }}
                  disabled={weekIdx >= planWeekKeys.length - 1}
                  aria-label={t('trainerPlanViewer.nextWeek', 'Next week')}
                  className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-25"
                  style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
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
                      // Same card the member's own My Plan uses — white surface,
                      // 18px radius, 56px thumb, SLOT · time in the slot colour,
                      // macros with coloured suffixes. Tapping opens the recipe,
                      // exactly as it does everywhere else in Nutrition.
                      <button
                        key={mi}
                        type="button"
                        onClick={() => onOpenRecipe?.(full || meal)}
                        disabled={!onOpenRecipe}
                        className="w-full text-left rounded-[18px] p-3 flex gap-3 items-center active:scale-[0.99] transition-transform"
                        style={{
                          background: 'var(--color-bg-card)',
                          boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 6px 18px rgba(15,20,25,0.05)',
                        }}
                      >
                        {img ? (
                          <img src={img} alt={title} className="w-14 h-14 rounded-[14px] object-cover shrink-0" loading="lazy" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }} />
                        ) : (
                          <div className="w-14 h-14 rounded-[14px] shrink-0 flex items-center justify-center" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                            <UtensilsCrossed size={18} style={{ color: 'var(--color-text-subtle)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ color: slot.color }}>
                            {t(slot.labelKey, meal.slotType || 'Meal')}{meal.time ? ` · ${meal.time}` : ''}
                          </span>
                          <p className="text-[15px] font-bold truncate mt-0.5" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{title}</p>
                          <div className="flex items-center gap-2.5 mt-1 text-[12px] font-bold tabular-nums">
                            <span style={{ color: 'var(--color-text-primary)' }}>
                              {meal.calories} <span className="font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t('trainerMealPlan.cal', 'cal')}</span>
                            </span>
                            <span style={{ color: '#22D3EE' }}>{meal.protein}P</span>
                            <span style={{ color: '#F97316' }}>{meal.carbs}C</span>
                            <span style={{ color: '#EAB308' }}>{meal.fat}F</span>
                          </div>
                          {meal.notes && (
                            <p className="text-[11.5px] mt-1 italic" style={{ color: 'var(--color-text-muted)' }}>{meal.notes}</p>
                          )}
                        </div>
                      </button>
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

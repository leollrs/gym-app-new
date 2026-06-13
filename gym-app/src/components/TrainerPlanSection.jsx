import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, ChevronRight, ChevronDown, ChevronLeft, Clock, Dumbbell,
  Play, Loader2, X, StickyNote,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import logger from '../lib/logger';

// ── Member-side viewer for trainer-assigned workout plans (P0-2) ──────────
// trainer_workout_plans rows are readable by the client via RLS
// (0036 trainer_plans_client_select). Until this section existed, an
// 8-week plan built in TrainerPlans produced NOTHING in the member's app.
// Mounted at the top of Workouts' hub view; renders nothing when the member
// has no active trainer plan (or the read fails), so it costs nothing for
// the 95% of members without a coach.

const TU_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

// weeks JSONB: { "1": [{ name, exercises: [{ id, sets, reps, rest_seconds, notes }] }] }
// Legacy shape (very early plans): { "1": ["ex_bp", ...] } — normalize both.
const normalizeDay = (day, fallbackName) => {
  if (Array.isArray(day)) return { name: fallbackName, exercises: day.map(e => (typeof e === 'string' ? { id: e } : e)) };
  return { ...day, exercises: (day?.exercises || []).map(e => (typeof e === 'string' ? { id: e } : e)) };
};
const daysOfWeek = (plan, weekNum, fallbackLabel) => {
  const raw = plan?.weeks?.[String(weekNum)];
  if (!Array.isArray(raw)) return [];
  if (raw.length > 0 && typeof raw[0] === 'string') {
    return [normalizeDay(raw, fallbackLabel)];
  }
  return raw.map((d, i) => normalizeDay(d, `${fallbackLabel} ${i + 1}`));
};

const TrainerPlanViewer = ({ plan, onClose }) => {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [expandedDay, setExpandedDay] = useState(0);
  const [exMap, setExMap] = useState({}); // id → { name, name_es }
  const [starting, setStarting] = useState(null); // day index being materialized

  const weekNums = useMemo(() => {
    const fromJson = Object.keys(plan?.weeks || {}).map(Number).filter(n => n > 0);
    const max = Math.max(plan?.duration_weeks || 1, ...(fromJson.length ? fromJson : [1]));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [plan]);

  // Lock background scroll while the viewer is open (same pattern the
  // member overlays in Workouts use).
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Localized names for every exercise referenced by the plan.
  useEffect(() => {
    const ids = new Set();
    Object.values(plan?.weeks || {}).forEach(days => {
      (Array.isArray(days) ? days : []).forEach(d => {
        const exs = Array.isArray(d) ? d : (d?.exercises || []);
        exs.forEach(e => { const id = typeof e === 'string' ? e : e?.id; if (id) ids.add(id); });
      });
    });
    if (ids.size === 0) return;
    const all = [...ids];
    (async () => {
      const map = {};
      try {
        // .in() with a few hundred ids is fine; chunk defensively anyway.
        for (let i = 0; i < all.length; i += 200) {
          const { data, error } = await supabase
            .from('exercises')
            .select('id, name, name_es')
            .in('id', all.slice(i, i + 200));
          if (error) { logger.error('TrainerPlanSection: exercises lookup failed:', error); break; }
          (data || []).forEach(ex => { map[ex.id] = ex; });
        }
      } catch (err) {
        logger.error('TrainerPlanSection: exercises lookup failed:', err);
      }
      setExMap(map);
    })();
  }, [plan]);

  const exName = useCallback((id) => {
    const ex = exMap[id];
    if (!ex) return id;
    return isEs && ex.name_es ? ex.name_es : ex.name;
  }, [exMap, isEs]);

  const dayFallback = t('trainerPlanViewer.dayFallback', 'Day');
  const days = daysOfWeek(plan, selectedWeek, dayFallback);

  // "Entrenar este día" — materialize the day as a real member routine and
  // hand it to the existing ActiveSession flow (/session/:routineId), the
  // same path QuickStart and "create routine" already use. Re-tapping the
  // same day reuses (and refreshes) the routine instead of stacking copies.
  const startDay = async (day, di) => {
    if (starting !== null) return;
    setStarting(di);
    try {
      const exs = (day.exercises || [])
        .map(e => ({ ...e, id: typeof e === 'string' ? e : e.id }))
        .filter(e => e.id && exMap[e.id]); // only ids that still exist in the catalog
      if (exs.length === 0) {
        showToast(t('trainerPlanViewer.noKnownExercises', "This day's exercises aren't available right now."), 'error');
        return;
      }
      const routineName = `${plan.name} · ${day.name || `${dayFallback} ${di + 1}`}`.slice(0, 90);
      // Reuse an identically-named routine of mine (created by a previous tap)
      const { data: existing, error: findErr } = await supabase
        .from('routines')
        .select('id')
        .eq('created_by', user.id)
        .eq('name', routineName)
        .limit(1)
        .maybeSingle();
      if (findErr) throw findErr;
      let routineId = existing?.id;
      if (routineId) {
        // Refresh contents so trainer edits since the last tap are reflected
        const { error: delErr } = await supabase.from('routine_exercises').delete().eq('routine_id', routineId);
        if (delErr) throw delErr;
      } else {
        const { data: created, error: insErr } = await supabase
          .from('routines')
          .insert({ name: routineName, gym_id: profile.gym_id, created_by: user.id })
          .select('id')
          .single();
        if (insErr) throw insErr;
        routineId = created.id;
      }
      const rows = exs.map((ex, i) => ({
        routine_id: routineId,
        exercise_id: ex.id,
        position: i + 1,
        target_sets: Number(ex.sets) || 3,
        target_reps: String(ex.reps || '8-12'),
        rest_seconds: Number.isFinite(Number(ex.rest_seconds)) ? Number(ex.rest_seconds) : 60,
      }));
      const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
      if (exErr) throw exErr;
      navigate(`/session/${routineId}`);
    } catch (err) {
      logger.error('TrainerPlanSection: failed to start day:', err);
      showToast(t('trainerPlanViewer.startFailed', "Couldn't start the workout. Try again."), 'error');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto" style={{ background: 'var(--color-bg-primary)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="mx-auto w-full max-w-[480px] md:max-w-4xl px-4 pb-28 md:pb-12">
        {/* Header */}
        <div className="sticky top-0 z-10 -mx-4 px-4 pt-3 pb-2" style={{ background: 'var(--color-bg-primary)' }}>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label={t('trainerPlanViewer.back', 'Back')}
              className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center rounded-full"
              style={{ color: 'var(--color-text-primary)' }}
            >
              <ChevronLeft size={22} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--color-accent)' }}>
                {t('trainerPlanViewer.sectionTitle', 'Your coach\'s plan')}
              </p>
              <h1 className="truncate" style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1.15 }}>
                {plan.name}
              </h1>
            </div>
            <button
              onClick={onClose}
              aria-label={t('trainerPlanViewer.close', 'Close')}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              <X size={18} />
            </button>
          </div>
          {plan.profiles?.full_name && (
            <p className="text-[12px] mt-0.5 ml-9" style={{ color: 'var(--color-text-muted)' }}>
              {t('trainerPlanViewer.byCoach', 'From {{name}}', { name: plan.profiles.full_name })}
            </p>
          )}
        </div>

        {plan.description && (
          <p className="text-[13px] leading-relaxed mt-2 mb-1" style={{ color: 'var(--color-text-muted)' }}>
            {plan.description}
          </p>
        )}

        {/* Week selector */}
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 py-3" style={{ scrollbarWidth: 'none' }}>
          {weekNums.map(wk => {
            const active = selectedWeek === wk;
            return (
              <button
                key={wk}
                onClick={() => { setSelectedWeek(wk); setExpandedDay(0); }}
                className="shrink-0 px-4 py-2 rounded-full text-[12.5px] font-bold min-h-[40px] transition-colors"
                style={active
                  ? { background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }
                  : { background: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
              >
                {t('trainerPlanViewer.weekN', 'Week {{n}}', { n: wk })}
              </button>
            );
          })}
        </div>

        {/* Day list */}
        {days.length === 0 ? (
          <div className="text-center py-14 rounded-2xl" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <Dumbbell size={26} className="mx-auto mb-2" style={{ color: 'var(--color-text-subtle)' }} />
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('trainerPlanViewer.emptyWeek', 'Nothing scheduled this week')}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {days.map((day, di) => {
              const isOpen = expandedDay === di;
              const exCount = (day.exercises || []).length;
              return (
                <div key={di} className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                  <button
                    onClick={() => setExpandedDay(isOpen ? null : di)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                      <Dumbbell size={15} style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {day.name || `${dayFallback} ${di + 1}`}
                      </p>
                      <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                        {t('trainerPlanViewer.exerciseCount', '{{count}} exercises', { count: exCount })}
                      </p>
                    </div>
                    <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4">
                      {exCount === 0 ? (
                        <p className="text-[12px] py-2" style={{ color: 'var(--color-text-subtle)' }}>
                          {t('trainerPlanViewer.emptyDay', 'No exercises this day — rest up')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {(day.exercises || []).map((ex, ei) => {
                            const id = typeof ex === 'string' ? ex : ex.id;
                            return (
                              <div key={ei} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[13px] font-semibold min-w-0 truncate" style={{ color: 'var(--color-text-primary)' }}>
                                    <span className="mr-1.5" style={{ color: 'var(--color-text-subtle)' }}>{ei + 1}.</span>
                                    {exName(id)}
                                  </p>
                                  <p className="text-[12px] flex-shrink-0 font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                                    {ex.sets || 3} × {ex.reps || '8-12'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-subtle)' }}>
                                    <Clock size={10} /> {t('trainerPlanViewer.restSeconds', '{{s}}s rest', { s: ex.rest_seconds ?? 60 })}
                                  </span>
                                </div>
                                {ex.notes && (
                                  <p className="text-[11.5px] mt-1.5 flex items-start gap-1.5 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                                    <StickyNote size={11} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
                                    {ex.notes}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {exCount > 0 && (
                        <button
                          onClick={() => startDay(day, di)}
                          disabled={starting !== null}
                          className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl text-[13.5px] font-bold min-h-[48px] active:scale-[0.98] transition-all disabled:opacity-50"
                          style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }}
                        >
                          {starting === di ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />}
                          {starting === di
                            ? t('trainerPlanViewer.starting', 'Setting up...')
                            : t('trainerPlanViewer.trainDay', 'Train this day')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
};

export default function TrainerPlanSection() {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [openPlan, setOpenPlan] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from('trainer_workout_plans')
      .select('id, name, description, duration_weeks, weeks, is_active, updated_at, trainer_id, profiles!trainer_workout_plans_trainer_id_fkey(full_name)')
      .eq('client_id', user.id)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // RLS/read failure → quietly hide the section, never block Workouts
          logger.error('TrainerPlanSection: failed to load trainer plans:', error);
          setPlans([]);
          return;
        }
        setPlans(data || []);
      })
      .catch(err => {
        if (!cancelled) { logger.error('TrainerPlanSection: failed to load trainer plans:', err); setPlans([]); }
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (plans.length === 0) return null;

  return (
    <section className="mb-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-subtle)' }}>
        {t('trainerPlanViewer.sectionTitle', 'Your coach\'s plan')}
      </p>
      <div className="space-y-2">
        {plans.map(plan => {
          const totalDays = Object.values(plan.weeks || {}).reduce((s, days) => s + (Array.isArray(days) ? days.length : 0), 0);
          return (
            <button
              key={plan.id}
              onClick={() => setOpenPlan(plan)}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left active:scale-[0.99] transition-all"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-card))',
                border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
              }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                <ClipboardList size={17} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{plan.name}</p>
                <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {plan.profiles?.full_name
                    ? `${t('trainerPlanViewer.byCoach', 'From {{name}}', { name: plan.profiles.full_name })} · `
                    : ''}
                  {t('trainerPlanViewer.planMeta', '{{weeks}} wk · {{days}} days', { weeks: plan.duration_weeks || Object.keys(plan.weeks || {}).length, days: totalDays })}
                </p>
              </div>
              <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
            </button>
          );
        })}
      </div>

      {openPlan && <TrainerPlanViewer plan={openPlan} onClose={() => setOpenPlan(null)} />}
    </section>
  );
}

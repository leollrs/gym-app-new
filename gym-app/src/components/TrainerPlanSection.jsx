import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useScrollLock } from '../hooks/useScrollLock';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, ChevronRight, ChevronLeft, Activity, Calendar,
  Play, Loader2, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import logger from '../lib/logger';
import { adoptTrainerPlan, announceProgramChange } from '../lib/trainerPlanAdoption';
import ProgramDetailModal from './ProgramDetailModal';

// ── Member-side viewer for trainer-assigned workout plans (P0-2) ──────────
// trainer_workout_plans rows are readable by the client via RLS
// (0036 trainer_plans_client_select). Until this section existed, an
// 8-week plan built in TrainerPlans produced NOTHING in the member's app.
// Mounted at the top of Workouts' hub view; renders nothing when the member
// has no active trainer plan (or the read fails), so it costs nothing for
// the 95% of members without a coach.

const TU_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';


// The member's plan viewer is components/ProgramDetailModal — the same one
// the trainer opens, so both sides see one screen.


export default function TrainerPlanSection() {
  // 'pages' stays the default namespace (unprefixed keys resolve there);
  // 'common' is loaded for the confirm dialog's Cancel.
  const { t } = useTranslation(['pages', 'common']);
  const { user, profile, patchProfile } = useAuth();
  const { showToast } = useToast();
  const [plans, setPlans] = useState([]);
  const [openPlan, setOpenPlan] = useState(null);
  const [switching, setSwitching] = useState(false);
  // Adopting swaps out whatever program the member is on — worth a beat.
  // Stepping BACK isn't confirmed: it's the undo.
  const [confirmPlan, setConfirmPlan] = useState(null);

  // Same keep-alive hazard as Workouts: this renders inside /workouts, and the
  // viewer portals to document.body.
  useScrollLock(!!confirmPlan);
  const secLocation = useLocation();
  useEffect(() => {
    if (secLocation.pathname === '/workouts') return;
    setOpenPlan(null);
    setConfirmPlan(null);
  }, [secLocation.pathname]);

  // 0666. NULL = the member is on their own generated program.
  // What the member is ACTUALLY on. Read from the materialized program's
  // provenance, not from profiles.active_trainer_plan_id: that column is a FK
  // to trainer_workout_plans, so an adopted GYM program can never be recorded
  // there — relying on it left the gym program as the hero and still listed
  // below it as "Use as my program".
  const [adoptedId, setAdoptedId] = useState(null);
  const [adoptedProgram, setAdoptedProgram] = useState(null);
  // The PROGRAM is the source of truth, not the profile marker. Every other
  // program-creation path (regenerate, the builder, gym enrolment) replaces the
  // program without touching the marker, so trusting the marker meant a stale
  // one could hide the coach's plan permanently with no way to release it.
  const activePlanId = adoptedId;

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // Let RLS do the filtering. trainer_workout_plans has exactly four
        // SELECT policies — trainer (owns it), client (client_id = me), member
        // (junction, 0644) and admin — so for a member this already returns
        // their plans AND NOTHING ELSE.
        //
        // An earlier version pre-fetched trainer_plan_members to build an id
        // list and, whenever that pre-read came back empty for ANY reason, fell
        // back to `client_id = me`. Junction-assigned plans have client_id
        // NULL, so that fallback matched nothing and the coach's plan silently
        // vanished. `trainer_id != me` keeps a member who is also a trainer
        // from seeing their own drafts here.
        const { data, error } = await supabase
          .from('trainer_workout_plans')
          .select('id, name, description, duration_weeks, weeks, is_active, is_draft, updated_at, trainer_id')
          .eq('is_active', true)
          .neq('trainer_id', user.id)
          .order('updated_at', { ascending: false });
        if (cancelled) return;
        if (error) {
          logger.error('TrainerPlanSection: failed to load trainer plans:', error);
          setPlans([]);
          return;
        }
        // Drafts are work in progress — a member should never be offered one,
        // and 0666's guard rejects adopting one anyway (is_active defaults TRUE
        // and is independent of is_draft, so filtering on is_active alone let
        // them through). TrainerClientDetail already filters this way.
        const rows = (data || []).filter(r => !r.is_draft);

        // Coach names come from gym_member_profiles_safe, not a `profiles`
        // embed: profiles_select has no "a member may read their trainer"
        // branch, so the embed resolved to null for every member.
        const coachIds = [...new Set(rows.map(r => r.trainer_id).filter(Boolean))];
        let names = {};
        if (coachIds.length) {
          const { data: coaches } = await supabase
            .from('gym_member_profiles_safe')
            .select('id, full_name')
            .in('id', coachIds);
          names = Object.fromEntries((coaches || []).map(c => [c.id, c.full_name]));
        }
        if (cancelled) return;
        const offers = rows.map(r => ({ ...r, coachName: names[r.trainer_id] || null, kind: 'trainer' }));

        // A gym program the TRAINER assigned is just as much "your coach's
        // plan" — and until now it reached the member as nothing at all:
        // assigning wrote profiles.assigned_program_id plus an enrollment, and
        // no member surface reads either. profiles.assigned_program_id is the
        // trainer-assigned marker (self-enrolling from Browse only writes an
        // enrollment row), so it's what distinguishes the two.
        const { data: me } = await supabase
          .from('profiles').select('assigned_program_id').eq('id', user.id).maybeSingle();
        const assignedGymId = me?.assigned_program_id || null;
        if (assignedGymId) {
          const { data: gp } = await supabase
            .from('gym_programs')
            .select('id, name, weeks, duration_weeks')
            .eq('id', assignedGymId)
            .maybeSingle();
          if (gp?.weeks) offers.unshift({ ...gp, coachName: null, kind: 'gym' });
        }
        if (cancelled) return;
        setPlans(offers);
      } catch (err) {
        if (!cancelled) {
          logger.error('TrainerPlanSection: failed to load trainer plans:', err);
          setPlans([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Which plan (if any) the live program was materialized from.
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    const read = async () => {
      const { data, error } = await supabase
        .from('generated_programs')
        .select('id, schedule_map')
        .eq('profile_id', user.id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) { logger.error('TrainerPlanSection: active program read failed:', error); return; }
      setAdoptedId(data?.schedule_map?.trainer_plan_id || null);
      setAdoptedProgram(data?.schedule_map?.trainer_plan_id ? data : null);
    };
    read();
    window.addEventListener('tugympr:programs-changed', read);
    return () => { cancelled = true; window.removeEventListener('tugympr:programs-changed', read); };
  }, [user?.id]);

  // The coach edits, the member's program follows. The trainer is the one who
  // knows — so a plan edit reaches the member without them doing anything.
  //
  // Rebuilds on the member's device rather than in a trigger because
  // materializing creates routines OWNED BY THE MEMBER (routines RLS requires
  // created_by = auth.uid()); the server can't write those as the trainer.
  // Runs once per version, and never while an adopt is already in flight.
  const rebuildingRef = useRef(null);
  useEffect(() => {
    if (!user?.id || !profile?.gym_id || switching) return;
    if (!adoptedProgram || !adoptedId) return;
    let cancelled = false;

    (async () => {
      try {
        // Fetch the adopted plan BY ID rather than looking it up in `plans`.
        // That list carries `.neq('trainer_id', user.id)` — it hides a
        // trainer's own plans from their member view — so for anyone who is
        // both trainer and client of their own gym the plan was absent from
        // the list and the rebuild never even evaluated.
        const { data: live, error } = await supabase
          .from('trainer_workout_plans')
          .select('id, name, description, duration_weeks, weeks, is_active, is_draft, updated_at, trainer_id')
          .eq('id', adoptedId)
          .maybeSingle();
        if (cancelled || error || !live || !live.is_active || live.is_draft) return;

        const builtV = adoptedProgram.schedule_map?.trainer_plan_v ?? null;
        const currentV = live.updated_at || null;
        // No stamp = adopted before versions existed. Rebuild ONCE: it can't be
        // told apart from stale, the rebuild is non-destructive (trained
        // routines survive, the restore list carries forward), and it leaves
        // the stamp behind so this only ever happens once per adoption.
        if (builtV !== null && builtV === currentV) return;
        const key = `${adoptedId}:${currentV}`;
        if (rebuildingRef.current === key) return;
        rebuildingRef.current = key;

        const res = await adoptTrainerPlan({
          plan: { ...live, coachName: adoptedProgram.schedule_map?.trainer_plan_coach || null },
          userId: user.id,
          gymId: profile.gym_id,
          dayLabel: dayFallbackLabel,
          replacesAdopted: adoptedProgram,
        });
        // Re-check after the await: the effect can be torn down mid-rebuild
        // (route change, or sign-out and back in as someone else), and firing
        // the announce + toast then belongs to nobody.
        if (cancelled || !res.ok) return;
        announceProgramChange();
        showToast(t('trainerPlanViewer.autoUpdated', 'Your coach updated this plan — your program is up to date'), 'info');
      } catch (err) {
        // Leave the member on the working build; retry on the next open.
        logger.error('TrainerPlanSection: auto-rebuild failed:', err);
        rebuildingRef.current = null;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptedId, adoptedProgram, user?.id, profile?.gym_id, switching]);

  const dayFallbackLabel = t('trainerPlanViewer.dayFallback', 'Day');

  const adopt = async (plan, startToday = true) => {
    if (!user?.id || !profile?.gym_id || switching) return;
    setSwitching(true);
    try {
      const res = await adoptTrainerPlan({
        plan, userId: user.id, gymId: profile.gym_id, dayLabel: dayFallbackLabel, startToday,
      });
      if (!res.ok) {
        showToast(t('trainerPlanViewer.planEmpty', 'This plan has no exercises yet.'), 'error');
        return;
      }
      if (res.marked) patchProfile({ active_trainer_plan_id: plan.id });
      setOpenPlan(null);
      announceProgramChange();
      showToast(t('trainerPlanViewer.adopted', 'This is now your program'), 'success');
    } catch (err) {
      logger.error('TrainerPlanSection: adopt failed:', err);
      showToast(t('trainerPlanViewer.adoptFailed', "Couldn't switch programs. Try again."), 'error');
    } finally {
      setSwitching(false);
    }
  };

  // The adopted plan is NOT listed here — it IS the Current Program hero, which
  // carries its own "from your coach" mark and its own way back. Listing it
  // again put two Current Program cards on one screen.
  const offered = plans.filter(p => p.id !== activePlanId);
  if (offered.length === 0) return null;

  return (
    <section className="mb-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-subtle)' }}>
        {t('trainerPlanViewer.sectionTitle', 'Your coach\'s plan')}
      </p>
      <div className="space-y-2">
        {offered.map(plan => {
          const totalDays = Object.values(plan.weeks || {}).reduce((s, days) => s + (Array.isArray(days) ? days.length : 0), 0);
          return (
            <div
              key={plan.id}
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-card))',
                border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
              }}
            >
              <button
                onClick={() => setOpenPlan(plan)}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left active:scale-[0.99] transition-all"
                style={{ background: 'transparent' }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                  <ClipboardList size={17} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{plan.name}</p>
                  <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {plan.coachName
                      ? `${t('trainerPlanViewer.byCoach', 'From {{name}}', { name: plan.coachName })} · `
                      : ''}
                    {plan.duration_weeks === 0
                      ? t('trainerPlanViewer.singleSession', 'Single session')
                      : t('trainerPlanViewer.planMeta', '{{weeks}} wk · {{days}} days', { weeks: plan.duration_weeks || Object.keys(plan.weeks || {}).length, days: totalDays })}
                  </p>
                </div>
                <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
              </button>
              <button
                type="button"
                disabled={switching}
                onClick={() => setConfirmPlan(plan)}
                className="w-full px-4 py-2.5 text-[12.5px] font-bold active:scale-[0.99] transition-all disabled:opacity-50"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                  color: 'var(--color-accent)',
                  borderTop: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
                }}
              >
                {t('trainerPlanViewer.useAsProgram', 'Use as my program')}
              </button>
            </div>
          );
        })}
      </div>

      {/* The SAME modal the trainer opens on the plan — one screen, not a
          member-only imitation of it. */}
      {openPlan && (
        <ProgramDetailModal
          program={openPlan}
          onClose={() => setOpenPlan(null)}
          eyebrow={openPlan.coachName
            ? t('trainerPlanViewer.byCoach', 'From {{name}}', { name: openPlan.coachName })
            : t('trainerPlanViewer.sectionTitle', "Your coach's plan")}
          footer={(
            <button
              type="button"
              disabled={switching}
              onClick={() => { const p = openPlan; setOpenPlan(null); setConfirmPlan(p); }}
              className="w-full py-3.5 rounded-2xl font-bold text-[14.5px] active:scale-[0.98] transition-all disabled:opacity-50"
              style={{ background: '#10B981', color: 'var(--color-text-on-secondary, #fff)' }}
            >
              {t('trainerPlanViewer.useAsProgram', 'Use as my program')}
            </button>
          )}
        />
      )}

      {confirmPlan && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            role="button"
            tabIndex={0}
            aria-label={t('common:cancel', 'Cancel')}
            onClick={() => setConfirmPlan(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setConfirmPlan(null); }}
          />
          <div className="relative w-full max-w-sm rounded-[24px] p-5" style={{ background: 'var(--color-bg-secondary)' }}>
            <h3 className="text-[17px] font-extrabold" style={{ color: 'var(--color-text-primary)', fontFamily: TU_DISPLAY, letterSpacing: -0.3 }}>
              {t('trainerPlanViewer.confirmTitle', 'Switch to this plan?')}
            </h3>
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {t(
                'trainerPlanViewer.confirmBody',
                '“{{plan}}” becomes your current program. Your own program is kept — you can switch back any time.',
                { plan: confirmPlan.name },
              )}
            </p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirmPlan(null)}
                className="flex-1 py-3 rounded-[14px] text-[13.5px] font-bold min-h-[48px]"
                style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={switching}
                onClick={() => { const p = confirmPlan; setConfirmPlan(null); adopt(p, true); }}
                className="flex-1 py-3 rounded-[14px] text-[13.5px] font-bold min-h-[48px] disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }}
              >
                {t('trainerPlanViewer.startToday', 'Start today')}
              </button>
            </div>
            {/* Starting today means week 1 only covers the days LEFT in this
                calendar week; the rest move to a compensating final week.
                Starting Monday keeps week 1 whole. Adopting on a Saturday used
                to bury most of week 1 in days that had already passed. */}
            <button
              type="button"
              disabled={switching}
              onClick={() => { const p = confirmPlan; setConfirmPlan(null); adopt(p, false); }}
              className="w-full mt-2 py-2.5 text-[12.5px] font-bold disabled:opacity-50"
              style={{ background: 'transparent', color: 'var(--color-text-muted)' }}
            >
              {t('trainerPlanViewer.startMonday', 'Start Monday instead — keep week 1 whole')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

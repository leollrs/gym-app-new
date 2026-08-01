/**
 * ONE assignment per member, enforced in ONE place.
 *
 * A member trains one thing at a time. Three surfaces can change what that is —
 * /plans (bulk assign a plan to members), the client page's "My plans", and the
 * client page's "Gym programs" — and each of them used to clear only its own
 * kind. Assign a plan from /plans and the gym program stayed ASSIGNED; unassign
 * from the client page and /plans still showed the plan attached, because
 * /plans writes trainer_workout_plans.client_id as well as the junction row and
 * only one of the two was ever cleared.
 *
 * So: whenever anything becomes the member's assignment, everything else for
 * that member is cleared here, by this function, whoever called it.
 *
 * The three stores that have to agree:
 *   trainer_plan_members            — the junction the member actually reads
 *   trainer_workout_plans.client_id — legacy primary assignee, also read by RLS
 *                                     (trainer_plans_client_select)
 *   profiles.assigned_program_id    — the gym-program assignment (+ its
 *                                     gym_program_enrollments row)
 */
import { supabase } from './supabase';
import logger from './logger';

/**
 * Clear every assignment this member has, EXCEPT the one being kept.
 *
 * @param {object}  o
 * @param {string}  o.memberId
 * @param {string}  o.trainerId          only this trainer's plans are touched
 * @param {string?} o.keepPlanId         plan that is becoming the assignment
 * @param {boolean} o.keepGymProgram     true when a gym program is becoming it
 * @param {string?} o.currentGymProgramId member's current profiles.assigned_program_id
 */
export async function clearOtherAssignments({
  memberId, trainerId, keepPlanId = null, keepGymProgram = false, currentGymProgramId = null,
}) {
  if (!memberId || !trainerId) return;

  // Every plan of this trainer's the member is attached to, by EITHER store.
  //
  // The errors are CHECKED and THROWN. Discarding them made this a silent
  // no-op on any read failure: `attached` came back empty, nothing was
  // cleared, and the member ended up on two things — the exact outcome this
  // whole file exists to prevent. Failing loudly lets the caller report it.
  const [jr, or_] = await Promise.all([
    supabase.from('trainer_plan_members').select('plan_id').eq('member_id', memberId),
    supabase.from('trainer_workout_plans').select('id')
      .eq('trainer_id', trainerId).eq('client_id', memberId),
  ]);
  if (jr.error) throw jr.error;
  if (or_.error) throw or_.error;
  const junctionRows = jr.data;
  const ownedRows = or_.data;

  const attached = new Set([
    ...(junctionRows || []).map(r => r.plan_id),
    ...(ownedRows || []).map(r => r.id),
  ].filter(Boolean));
  attached.delete(keepPlanId);

  if (attached.size) {
    const ids = [...attached];
    const { error: jErr } = await supabase.from('trainer_plan_members')
      .delete().eq('member_id', memberId).in('plan_id', ids);
    if (jErr) logger.error('clearOtherAssignments: junction cleanup failed:', jErr);
    const { error: cErr } = await supabase.from('trainer_workout_plans')
      .update({ client_id: null }).in('id', ids).eq('client_id', memberId);
    if (cErr) logger.error('clearOtherAssignments: client_id cleanup failed:', cErr);
  }

  if (!keepGymProgram && currentGymProgramId) {
    const { error: rpcErr } = await supabase
      .rpc('trainer_assign_program', { p_member_id: memberId, p_program_id: null });
    if (rpcErr) logger.error('clearOtherAssignments: could not clear gym program:', rpcErr);
    // Not `.then(()=>{},()=>{})`: a Supabase builder RESOLVES with { error },
    // so the rejection handler never fired and the error went to a no-op body.
    const { error: enrErr } = await supabase.from('gym_program_enrollments')
      .delete().eq('profile_id', memberId).eq('program_id', currentGymProgramId);
    if (enrErr) logger.error('clearOtherAssignments: enrollment cleanup failed:', enrErr);
  }
}

/** Current gym-program assignment for a set of members, keyed by member id. */
export async function gymProgramAssignments(memberIds) {
  const ids = (memberIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('profiles').select('id, assigned_program_id').in('id', ids);
  if (error) {
    logger.error('gymProgramAssignments: lookup failed:', error);
    return {};
  }
  return Object.fromEntries((data || []).map(r => [r.id, r.assigned_program_id || null]));
}

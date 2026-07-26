// Per-client program COPY (copy-on-write) — data layer for Phase 2.
//
// A trainer editing a client's assigned program forks a client-specific copy in
// `trainer_client_programs` (migration 0640) so the shared gym_programs template
// is never mutated. The resolver prefers the copy over the template. Security is
// enforced by RLS (_can_manage_client), so these queries stay simple.

import { supabase } from './supabase';

/**
 * The client's assigned program, preferring the per-client COPY (trainer edits)
 * over the shared gym template. Returns { id, name, name_es, weeks,
 * duration_weeks, _isCopy, source_program_id? } or null.
 */
export async function getAssignedProgram(clientId) {
  if (!clientId) return null;
  const { data: prof, error } = await supabase
    .from('profiles')
    .select('assigned_program_id, assigned_client_program_id')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;

  if (prof?.assigned_client_program_id) {
    const { data } = await supabase
      .from('trainer_client_programs')
      .select('id, name, name_es, weeks, duration_weeks, source_program_id')
      .eq('id', prof.assigned_client_program_id)
      .maybeSingle();
    if (data) return { ...data, _isCopy: true };
  }
  if (prof?.assigned_program_id) {
    const { data } = await supabase
      .from('gym_programs')
      .select('id, name, name_es, weeks, duration_weeks')
      .eq('id', prof.assigned_program_id)
      .maybeSingle();
    if (data) return { ...data, _isCopy: false };
  }
  return null;
}

/**
 * Fork-on-edit: ensure a per-client copy exists (idempotent) and return its id.
 * `sourceProgramId` null → the RPC uses the client's currently-assigned template.
 */
export async function forkClientProgram(clientId, sourceProgramId = null) {
  const { data, error } = await supabase.rpc('trainer_fork_client_program', {
    p_client_id: clientId,
    p_source_program_id: sourceProgramId,
  });
  if (error) throw error;
  return data; // the copy's id
}

/** The full copy row (for the editor). */
export async function getClientProgramCopy(copyId) {
  if (!copyId) return null;
  const { data, error } = await supabase
    .from('trainer_client_programs')
    .select('*')
    .eq('id', copyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Save edits (weeks / name / duration) to the copy. */
export async function saveClientProgram(copyId, patch) {
  const { error } = await supabase
    .from('trainer_client_programs')
    .update(patch)
    .eq('id', copyId);
  if (error) throw error;
}

/** Discard the copy — the client falls back to the shared gym template. */
export async function resetClientProgram(clientId) {
  const { error } = await supabase.rpc('trainer_reset_client_program', { p_client_id: clientId });
  if (error) throw error;
}

/**
 * How far the client has progressed on their ACTIVE materialized program for this
 * source template — so the editor can stop a trainer shortening the program below
 * the week the client is currently on (mirrors MemberProgramBuilder's elapsed-week
 * guard, but read against the CLIENT's row). Returns { elapsedWeeks, durationWeeks }
 * with elapsedWeeks = 0 when the client hasn't started (→ no block). Best-effort.
 */
export async function getClientProgramProgress(clientId, sourceProgramId) {
  if (!clientId || !sourceProgramId) return { elapsedWeeks: 0, durationWeeks: 0 };
  try {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from('generated_programs')
      .select('program_start, duration_weeks, expires_at')
      .eq('profile_id', clientId)
      .eq('template_id', `gym_${sourceProgramId}`)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.program_start) return { elapsedWeeks: 0, durationWeeks: 0 };
    const dur = Number(data.duration_weeks) || 0;
    const elapsed = Math.max(1, Math.floor((Date.now() - new Date(data.program_start).getTime()) / (7 * 86400000)) + 1);
    return { elapsedWeeks: dur ? Math.min(dur, elapsed) : elapsed, durationWeeks: dur };
  } catch {
    return { elapsedWeeks: 0, durationWeeks: 0 };
  }
}

/**
 * Apply the copy's current weeks to the client's ACTIVE materialized program
 * (generated_programs.template_weeks), so a member who already started the
 * program gets the edits without re-starting. Best-effort — returns rows updated.
 */
export async function pushClientProgram(clientId) {
  const { data, error } = await supabase.rpc('trainer_push_client_program', { p_client_id: clientId });
  if (error) throw error;
  return data;
}

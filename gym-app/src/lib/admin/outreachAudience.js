import { supabase } from '../supabase';
import { fetchMembersWithChurnScores } from '../churnScore';
import { applySegmentFilters } from './segmentFilters';

/**
 * Resolves an Outreach audience selection into the concrete list of recipients
 * we need to send to. Returned shape: `[{ id, full_name, email, phone }]`.
 *
 * NOTE: `profiles` does not store `email` (lives on auth.users) and stores the
 * SMS-capable phone as `phone_number` (not `phone`). We project `phone_number`
 * to `phone` here so downstream senders can treat the shape uniformly. The
 * email channel is wired to look up auth.users at send time (or the sender's
 * skipped.noEmail tally absorbs recipients with no addressable email).
 *
 * Selectors supported (mirrors what the composer's UI offers):
 *  - { type: 'all' } — every member in the gym
 *  - { type: 'tier', tier: 'critical' | 'high' | 'medium' | 'low' } — by churn
 *  - { type: 'segment', segmentId } — by gym_segments membership
 *  - { type: 'members', ids: [...] } — explicit multi-select
 *  - { type: 'unonboarded' } — members who haven't completed onboarding
 *  - { type: 'birthdays' } — members with a birthday this week
 */
const PROFILE_FIELDS = 'id, full_name, phone_number';

function normalize(rows) {
  return (rows || []).map(r => ({
    id: r.id,
    full_name: r.full_name,
    email: null,                 // resolved per-channel at send time
    phone: r.phone_number || null,
  }));
}

export async function resolveOutreachAudience(gymId, selector) {
  if (!gymId || !selector?.type) return [];

  if (selector.type === 'all') {
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('gym_id', gymId)
      .eq('role', 'member');
    return normalize(data);
  }

  if (selector.type === 'tier') {
    const scored = await fetchMembersWithChurnScores(gymId, supabase).catch(() => []);
    const matchingIds = scored
      .filter(s => (s.riskTier?.tier ?? 'low') === selector.tier)
      .map(s => s.id);
    if (!matchingIds.length) return [];
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .in('id', matchingIds);
    return normalize(data);
  }

  if (selector.type === 'segment' && selector.segmentId) {
    // member_segments stores the filter spec in `filters` JSONB; we
    // resolve membership by replaying that filter through the shared
    // applySegmentFilters helper, then hydrate the contact columns the
    // helper doesn't return.
    const { data: seg } = await supabase
      .from('member_segments')
      .select('filters')
      .eq('id', selector.segmentId)
      .eq('gym_id', gymId)
      .single();
    if (!seg?.filters) return [];
    const matched = await applySegmentFilters(gymId, seg.filters);
    const ids = (matched || []).map(m => m.id);
    if (!ids.length) return [];
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .in('id', ids);
    return normalize(data);
  }

  if (selector.type === 'members' && Array.isArray(selector.ids) && selector.ids.length) {
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .in('id', selector.ids)
      .eq('gym_id', gymId);
    return normalize(data);
  }

  if (selector.type === 'unonboarded') {
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .eq('is_onboarded', false);
    return normalize(data);
  }

  if (selector.type === 'birthdays') {
    // Postgres-side filter via RPC would be cleaner; client-side filter is
    // fine for typical gym sizes (< few thousand members). Column is
    // `date_of_birth` (per 0001_initial_schema), not `birth_date`.
    const { data } = await supabase
      .from('profiles')
      .select(`${PROFILE_FIELDS}, date_of_birth`)
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .not('date_of_birth', 'is', null);
    if (!data) return [];
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    return normalize(data.filter(p => {
      if (!p.date_of_birth) return false;
      const d = new Date(p.date_of_birth);
      const thisYearBday = new Date(now.getFullYear(), d.getMonth(), d.getDate());
      return thisYearBday >= now && thisYearBday <= weekFromNow;
    }));
  }

  return [];
}

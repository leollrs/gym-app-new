-- 0520_resync_profile_lookup.sql
-- Backfill / re-sync public.profile_lookup from public.profiles.
--
-- profile_lookup is a denormalized (id, gym_id, role, additional_roles) mirror
-- of profiles, maintained by trg_sync_profile_lookup and read by the RLS
-- helpers current_gym_id() / current_user_role() (kept separate to avoid RLS
-- recursion on profiles).
--
-- If a lookup row drifts out of sync — e.g. a multi-role account whose gym_id
-- was set through a path the trigger didn't cover — current_gym_id() returns
-- the wrong value (or NULL). The member feed still loads (get_friend_feed is
-- SECURITY DEFINER and reads profiles.gym_id directly), but the
-- `feed_insert_own` policy:
--
--     WITH CHECK (actor_id = auth.uid() AND gym_id = public.current_gym_id())
--
-- then rejects every post the member tries to publish — the exact "can load
-- the feed but cannot post" symptom.
--
-- This statement rewrites every lookup row to match the source-of-truth
-- profiles row. It is idempotent and safe to run repeatedly.

INSERT INTO public.profile_lookup (id, gym_id, role, additional_roles)
SELECT id, gym_id, role, COALESCE(additional_roles, '{}')
FROM public.profiles
ON CONFLICT (id) DO UPDATE
  SET gym_id           = EXCLUDED.gym_id,
      role             = EXCLUDED.role,
      additional_roles = EXCLUDED.additional_roles;

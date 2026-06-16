-- ============================================================================
-- 0585 — Platform super-admin RLS: consistency + idempotent restore
-- ============================================================================
-- 1. error_logs SELECT still used a PRIMARY-role-only check (role='super_admin',
--    from 0278) while its UPDATE policy (0543) and the rest of the platform use
--    the additional_roles-aware public.is_super_admin() (0465). A founder who
--    holds super_admin via additional_roles got an EMPTY ErrorLogs + a blind
--    Operations incident feed, yet could still resolve rows. Align SELECT with
--    is_super_admin().                                    (audit: support-reliability-1)
--
-- 2. Idempotently (re-)assert every platform super_admin TABLE policy. These
--    currently live only across 0541–0551; mirroring them here means a fresh DB
--    or a partial/out-of-order apply can never silently 403 the operator on
--    branding / invites / print-cards / presence / config / snapshots. Mirrors
--    how 0576 restores RPC EXECUTE grants.                          (audit: perm-1)
--
-- 3. Let super_admin manage any gym's reward catalog and moderate (delete)
--    user-submitted custom meals cross-gym — the per-gym admin policies bind to
--    the caller's OWN gym_id, so a cross-gym write/delete was RLS-rejected.
--                                              (audit: completeness-5 / completeness-11)
--
-- All policies use public.is_super_admin(). Idempotent (DROP IF EXISTS + CREATE);
-- safe to run on an already-up-to-date production database.
-- ============================================================================

-- ── 1 + 2(error_logs): SELECT/UPDATE both via is_super_admin() ──────────────
DROP POLICY IF EXISTS "super_admin_read_errors" ON public.error_logs;
CREATE POLICY "super_admin_read_errors" ON public.error_logs
  FOR SELECT USING (public.is_super_admin());

DROP POLICY IF EXISTS super_admin_update_errors ON public.error_logs;
CREATE POLICY super_admin_update_errors ON public.error_logs
  FOR UPDATE USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ── 2: restore / re-assert platform super_admin table policies ──────────────

-- gym_branding — FOR ALL (platform branding editor writes any gym) [0551]
DROP POLICY IF EXISTS gym_branding_super_admin_all ON public.gym_branding;
CREATE POLICY gym_branding_super_admin_all ON public.gym_branding
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- gym_invites — FOR ALL (create/revoke invites for any gym) [0542]
DROP POLICY IF EXISTS "super_admin manage all gym_invites" ON public.gym_invites;
CREATE POLICY "super_admin manage all gym_invites" ON public.gym_invites
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- member_invites — SELECT (cross-gym support lookups) [0543]
DROP POLICY IF EXISTS member_invites_select_super_admin ON public.member_invites;
CREATE POLICY member_invites_select_super_admin ON public.member_invites
  FOR SELECT USING (public.is_super_admin());

-- print_cards — read + update (the platform card queue) [0551]
DROP POLICY IF EXISTS print_cards_super_admin_read ON public.print_cards;
CREATE POLICY print_cards_super_admin_read ON public.print_cards
  FOR SELECT USING (public.is_super_admin());
DROP POLICY IF EXISTS print_cards_super_admin_update ON public.print_cards;
CREATE POLICY print_cards_super_admin_update ON public.print_cards
  FOR UPDATE USING (public.is_super_admin());

-- admin_presence — cross-gym read (GymHealth / FeatureAdoption) [0541]
DROP POLICY IF EXISTS admin_presence_super_admin_select ON public.admin_presence;
CREATE POLICY admin_presence_super_admin_select ON public.admin_presence
  FOR SELECT USING (public.is_super_admin());

-- streak_cache — cross-gym read (Wellness / Diagnostic) [0541]
DROP POLICY IF EXISTS streak_cache_super_admin_select ON public.streak_cache;
CREATE POLICY streak_cache_super_admin_select ON public.streak_cache
  FOR SELECT USING (public.is_super_admin());

-- program_templates — FOR ALL (platform program library editor) [0545]
DROP POLICY IF EXISTS "program_templates_super_admin_all" ON public.program_templates;
CREATE POLICY "program_templates_super_admin_all" ON public.program_templates
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- platform_snapshots — read (PlatformAnalytics trends) [0545]
DROP POLICY IF EXISTS "platform_snapshots_super_admin_select" ON public.platform_snapshots;
CREATE POLICY "platform_snapshots_super_admin_select" ON public.platform_snapshots
  FOR SELECT USING (public.is_super_admin());

-- platform_config — read + all (kill switches / maintenance) [0551]
DROP POLICY IF EXISTS "super_admin_select_platform_config" ON public.platform_config;
DROP POLICY IF EXISTS "super_admin_all_platform_config" ON public.platform_config;
CREATE POLICY "super_admin_select_platform_config" ON public.platform_config
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY "super_admin_all_platform_config" ON public.platform_config
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ── 3: cross-gym content management ─────────────────────────────────────────

-- gym_rewards — super_admin manages ANY gym's reward catalog (Content → Rewards
-- editor). Replaces the SELECT-only super_admin policy from 0542 with FOR ALL.
-- The per-gym admin policy (gym_rewards_admin_all, 0266) is left intact.
DROP POLICY IF EXISTS gym_rewards_super_admin_select ON public.gym_rewards;
DROP POLICY IF EXISTS gym_rewards_super_admin_all ON public.gym_rewards;
CREATE POLICY gym_rewards_super_admin_all ON public.gym_rewards
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- custom_meals — super_admin can DELETE (moderate) any user-submitted meal.
-- 0574 only granted super_admin SELECT; the owner policy is created_by-bound.
DROP POLICY IF EXISTS custom_meals_super_admin_delete ON public.custom_meals;
CREATE POLICY custom_meals_super_admin_delete ON public.custom_meals
  FOR DELETE USING (public.is_super_admin());

NOTIFY pgrst, 'reload schema';

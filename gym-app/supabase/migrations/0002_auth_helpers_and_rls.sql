-- =============================================================
-- AUTH HELPER FUNCTIONS + RLS POLICIES
-- Migration: 0002_auth_helpers_and_rls.sql
-- Run AFTER 0001_initial_schema.sql
-- =============================================================
-- NOTE: Custom functions must live in the PUBLIC schema in
-- Supabase. The auth schema is managed by Supabase and is
-- not writable. auth.uid() and auth.jwt() are Supabase
-- built-ins and still work fine — we just cannot CREATE new
-- functions inside that schema.
-- =============================================================

-- ============================================================
-- HELPER FUNCTIONS (in public schema)
-- ============================================================

-- public.current_gym_id()
-- Returns the gym_id of the currently authenticated user.
-- SECURITY DEFINER lets it bypass RLS on the profiles table itself
-- so the policy lookup doesn't cause infinite recursion.
CREATE OR REPLACE FUNCTION public.current_gym_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gym_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- public.current_user_role()
-- Returns the role of the currently authenticated user.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- public.is_admin()
-- Returns TRUE if the current user is admin or super_admin.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin')
     FROM public.profiles
     WHERE id = auth.uid()
     LIMIT 1),
    FALSE
  );
$$;

-- public.is_trainer_of(client_id UUID)
-- Returns TRUE if the current user is an active trainer for the given client.
CREATE OR REPLACE FUNCTION public.is_trainer_of(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trainer_clients
    WHERE trainer_id = auth.uid()
      AND client_id = p_client_id
      AND is_active = TRUE
  );
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- ------------------------------------------------------------
-- gyms
-- ------------------------------------------------------------
CREATE POLICY "gyms_select" ON gyms
  FOR SELECT USING (
    id = public.current_gym_id()
    OR public.current_user_role() = 'super_admin'
  );

CREATE POLICY "gyms_manage_super_admin" ON gyms
  FOR ALL USING (public.current_user_role() = 'super_admin');

-- ------------------------------------------------------------
-- gym_branding
-- ------------------------------------------------------------
CREATE POLICY "gym_branding_select" ON gym_branding
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "gym_branding_update" ON gym_branding
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "profiles_update_admin" ON profiles
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- member_onboarding
-- ------------------------------------------------------------
CREATE POLICY "onboarding_own" ON member_onboarding
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "onboarding_trainer_read" ON member_onboarding
  FOR SELECT USING (public.is_trainer_of(profile_id));

CREATE POLICY "onboarding_admin_read" ON member_onboarding
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- nutrition_targets / nutrition_checkins
-- ------------------------------------------------------------
CREATE POLICY "nutrition_targets_own" ON nutrition_targets
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "nutrition_checkins_own" ON nutrition_checkins
  FOR ALL USING (profile_id = auth.uid());

-- ------------------------------------------------------------
-- trainer_clients
-- ------------------------------------------------------------
CREATE POLICY "trainer_clients_trainer" ON trainer_clients
  FOR ALL USING (
    trainer_id = auth.uid()
    OR client_id = auth.uid()
  );

CREATE POLICY "trainer_clients_admin" ON trainer_clients
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- exercises
-- ------------------------------------------------------------
CREATE POLICY "exercises_select" ON exercises
  FOR SELECT USING (
    gym_id IS NULL
    OR gym_id = public.current_gym_id()
  );

CREATE POLICY "exercises_insert_admin" ON exercises
  FOR INSERT WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.current_user_role() IN ('admin', 'trainer', 'super_admin')
  );

-- ------------------------------------------------------------
-- exercise_substitutions
-- ------------------------------------------------------------
CREATE POLICY "substitutions_select" ON exercise_substitutions
  FOR SELECT USING (TRUE);

-- ------------------------------------------------------------
-- routines
-- ------------------------------------------------------------
CREATE POLICY "routines_select_own" ON routines
  FOR SELECT USING (
    created_by = auth.uid()
    OR (gym_id = public.current_gym_id() AND is_public = TRUE)
  );

CREATE POLICY "routines_insert_own" ON routines
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "routines_update_own" ON routines
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "routines_delete_own" ON routines
  FOR DELETE USING (created_by = auth.uid());

CREATE POLICY "routines_admin" ON routines
  FOR ALL USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- routine_exercises
-- ------------------------------------------------------------
CREATE POLICY "routine_exercises_access" ON routine_exercises
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM routines r
      WHERE r.id = routine_id
        AND (r.created_by = auth.uid() OR (r.gym_id = public.current_gym_id() AND r.is_public))
    )
  );

-- ------------------------------------------------------------
-- program_templates / program_weeks / program_week_days
-- ------------------------------------------------------------
CREATE POLICY "program_templates_select" ON program_templates
  FOR SELECT USING (
    gym_id IS NULL
    OR gym_id = public.current_gym_id()
  );

CREATE POLICY "program_templates_manage_admin" ON program_templates
  FOR ALL USING (
    gym_id = public.current_gym_id()
    AND public.current_user_role() IN ('admin', 'trainer', 'super_admin')
  );

CREATE POLICY "program_weeks_select" ON program_weeks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM program_templates pt
      WHERE pt.id = program_id
        AND (pt.gym_id IS NULL OR pt.gym_id = public.current_gym_id())
    )
  );

CREATE POLICY "program_week_days_select" ON program_week_days
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM program_weeks pw
      JOIN program_templates pt ON pt.id = pw.program_id
      WHERE pw.id = week_id
        AND (pt.gym_id IS NULL OR pt.gym_id = public.current_gym_id())
    )
  );

-- ------------------------------------------------------------
-- user_enrolled_programs
-- ------------------------------------------------------------
CREATE POLICY "enrolled_programs_own" ON user_enrolled_programs
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "enrolled_programs_trainer" ON user_enrolled_programs
  FOR SELECT USING (public.is_trainer_of(profile_id));

CREATE POLICY "enrolled_programs_admin" ON user_enrolled_programs
  FOR ALL USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- workout_sessions
-- ------------------------------------------------------------
CREATE POLICY "sessions_select_own" ON workout_sessions
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "sessions_select_trainer" ON workout_sessions
  FOR SELECT USING (public.is_trainer_of(profile_id));

CREATE POLICY "sessions_select_admin" ON workout_sessions
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

CREATE POLICY "sessions_insert_own" ON workout_sessions
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "sessions_update_own" ON workout_sessions
  FOR UPDATE USING (profile_id = auth.uid());

-- ------------------------------------------------------------
-- session_exercises / session_sets
-- ------------------------------------------------------------
CREATE POLICY "session_exercises_access" ON session_exercises
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM workout_sessions ws
      WHERE ws.id = session_id
        AND (
          ws.profile_id = auth.uid()
          OR public.is_trainer_of(ws.profile_id)
          OR public.is_admin()
        )
    )
  );

CREATE POLICY "session_sets_access" ON session_sets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM session_exercises se
      JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = session_exercise_id
        AND (
          ws.profile_id = auth.uid()
          OR public.is_trainer_of(ws.profile_id)
          OR public.is_admin()
        )
    )
  );

-- ------------------------------------------------------------
-- overload_suggestions
-- ------------------------------------------------------------
CREATE POLICY "overload_own" ON overload_suggestions
  FOR SELECT USING (profile_id = auth.uid());

-- ------------------------------------------------------------
-- personal_records / pr_history
-- ------------------------------------------------------------
CREATE POLICY "pr_select_own" ON personal_records
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "pr_select_public" ON personal_records
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = profile_id AND p.privacy_public = TRUE
    )
  );

CREATE POLICY "pr_history_own" ON pr_history
  FOR SELECT USING (profile_id = auth.uid());

-- ------------------------------------------------------------
-- body_weight_logs / body_measurements / progress_photos
-- ------------------------------------------------------------
CREATE POLICY "body_weight_own" ON body_weight_logs
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "body_weight_trainer" ON body_weight_logs
  FOR SELECT USING (public.is_trainer_of(profile_id));

CREATE POLICY "body_measurements_own" ON body_measurements
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "body_measurements_trainer" ON body_measurements
  FOR SELECT USING (public.is_trainer_of(profile_id));

CREATE POLICY "progress_photos_own" ON progress_photos
  FOR ALL USING (profile_id = auth.uid());

-- ------------------------------------------------------------
-- check_ins
-- ------------------------------------------------------------
CREATE POLICY "checkins_own" ON check_ins
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "checkins_admin" ON check_ins
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- streak_cache
-- ------------------------------------------------------------
CREATE POLICY "streak_cache_select" ON streak_cache
  FOR SELECT USING (gym_id = public.current_gym_id());

-- ------------------------------------------------------------
-- friendships
-- ------------------------------------------------------------
CREATE POLICY "friendships_access" ON friendships
  FOR ALL USING (
    gym_id = public.current_gym_id()
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  );

-- ------------------------------------------------------------
-- activity_feed_items / feed_likes / feed_comments
-- ------------------------------------------------------------
CREATE POLICY "feed_select" ON activity_feed_items
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND (
      is_public = TRUE
      OR actor_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.gym_id = public.current_gym_id()
          AND f.status = 'accepted'
          AND (
            (f.requester_id = auth.uid() AND f.addressee_id = actor_id) OR
            (f.addressee_id = auth.uid() AND f.requester_id = actor_id)
          )
      )
    )
  );

CREATE POLICY "feed_insert_own" ON activity_feed_items
  FOR INSERT WITH CHECK (
    actor_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "feed_likes_gym" ON feed_likes
  FOR ALL USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM activity_feed_items f
      WHERE f.id = feed_item_id AND f.gym_id = public.current_gym_id()
    )
  );

CREATE POLICY "feed_comments_select" ON feed_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM activity_feed_items f
      WHERE f.id = feed_item_id AND f.gym_id = public.current_gym_id()
    )
  );

CREATE POLICY "feed_comments_insert_own" ON feed_comments
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "feed_comments_update_own" ON feed_comments
  FOR UPDATE USING (profile_id = auth.uid());

-- ------------------------------------------------------------
-- challenges
-- ------------------------------------------------------------
CREATE POLICY "challenges_select" ON challenges
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "challenges_manage_admin" ON challenges
  FOR ALL USING (
    gym_id = public.current_gym_id()
    AND public.current_user_role() IN ('admin', 'trainer', 'super_admin')
  );

-- ------------------------------------------------------------
-- challenge_teams / challenge_participants / challenge_score_events
-- ------------------------------------------------------------
CREATE POLICY "challenge_teams_select" ON challenge_teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_id AND c.gym_id = public.current_gym_id()
    )
  );

CREATE POLICY "challenge_participants_select" ON challenge_participants
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "challenge_participants_insert_own" ON challenge_participants
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "challenge_score_events_select" ON challenge_score_events
  FOR SELECT USING (gym_id = public.current_gym_id());

-- ------------------------------------------------------------
-- leaderboard_snapshots / gym_leaderboard_config
-- ------------------------------------------------------------
CREATE POLICY "leaderboards_select" ON leaderboard_snapshots
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "leaderboard_config_select" ON gym_leaderboard_config
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "leaderboard_config_admin" ON gym_leaderboard_config
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- achievement_definitions / user_achievements
-- ------------------------------------------------------------
CREATE POLICY "achievement_defs_select" ON achievement_definitions
  FOR SELECT USING (
    gym_id IS NULL
    OR gym_id = public.current_gym_id()
  );

CREATE POLICY "user_achievements_select" ON user_achievements
  FOR SELECT USING (gym_id = public.current_gym_id());

-- ------------------------------------------------------------
-- announcements
-- ------------------------------------------------------------
CREATE POLICY "announcements_select" ON announcements
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND (published_at IS NULL OR published_at <= NOW())
    AND (expires_at IS NULL OR expires_at > NOW())
  );

CREATE POLICY "announcements_manage_admin" ON announcements
  FOR ALL USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- churn_risk_scores
-- ------------------------------------------------------------
CREATE POLICY "churn_admin_only" ON churn_risk_scores
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- ------------------------------------------------------------
-- notifications
-- ------------------------------------------------------------
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (profile_id = auth.uid());

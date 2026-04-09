-- =============================================================
-- DRIP CAMPAIGN EXECUTOR — automated daily follow-up engine
-- Migration: 0263_drip_campaign_executor.sql
--
-- Runs via pg_cron daily at 9 AM UTC. For each gym with
-- churn follow-up enabled, finds at-risk members who are
-- due for the next drip step and creates notifications +
-- win_back_attempts rows.
-- =============================================================

-- 1. Add channel column to drip_campaign_steps (which channels to deliver on)
ALTER TABLE drip_campaign_steps
  ADD COLUMN IF NOT EXISTS channel TEXT[] NOT NULL DEFAULT '{in_app}';

-- 2. Make admin_id nullable on win_back_attempts (automated campaigns have no admin)
ALTER TABLE win_back_attempts
  ALTER COLUMN admin_id DROP NOT NULL;

-- 3. The executor function
CREATE OR REPLACE FUNCTION execute_drip_campaigns()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym RECORD;
  v_member RECORD;
  v_next_step RECORD;
  v_last_step_number SMALLINT;
  v_last_attempt_at TIMESTAMPTZ;
  v_dedup TEXT;
  v_total INT := 0;
BEGIN
  -- Loop through each gym with drip campaigns enabled
  FOR v_gym IN
    SELECT
      cfs.gym_id,
      cfs.threshold,
      cfs.cooldown_days
    FROM churn_followup_settings cfs
    WHERE cfs.enabled = TRUE
  LOOP
    -- For each at-risk member in this gym (latest score >= threshold)
    FOR v_member IN
      SELECT DISTINCT ON (crs.profile_id)
        crs.profile_id,
        crs.score
      FROM churn_risk_scores crs
      WHERE crs.gym_id = v_gym.gym_id
        AND crs.score >= v_gym.threshold
      ORDER BY crs.profile_id, crs.computed_at DESC
    LOOP
      -- Find the highest step_number this member already received
      SELECT
        COALESCE(MAX(wba.step_number), 0),
        MAX(wba.created_at)
      INTO v_last_step_number, v_last_attempt_at
      FROM win_back_attempts wba
      WHERE wba.user_id = v_member.profile_id
        AND wba.gym_id = v_gym.gym_id;

      -- Check cooldown: skip if any attempt was sent within cooldown_days
      IF v_last_attempt_at IS NOT NULL
         AND v_last_attempt_at > NOW() - (v_gym.cooldown_days || ' days')::INTERVAL
      THEN
        CONTINUE;
      END IF;

      -- Get the next active drip step for this gym
      SELECT *
      INTO v_next_step
      FROM drip_campaign_steps dcs
      WHERE dcs.gym_id = v_gym.gym_id
        AND dcs.step_number = v_last_step_number + 1
        AND dcs.is_active = TRUE;

      -- No next step configured — skip this member
      IF v_next_step IS NULL THEN
        CONTINUE;
      END IF;

      -- Check delay_days: enough time must have passed since last attempt
      -- For step 1 (no prior attempt), delay_days is from when they became at-risk — skip delay
      IF v_last_step_number > 0
         AND v_last_attempt_at IS NOT NULL
         AND v_last_attempt_at > NOW() - (v_next_step.delay_days || ' days')::INTERVAL
      THEN
        CONTINUE;
      END IF;

      -- Build dedup key for today
      v_dedup := 'drip_' || v_gym.gym_id || '_' || v_member.profile_id
                 || '_step' || v_next_step.step_number || '_' || CURRENT_DATE;

      -- Insert in-app notification (skip if dedup key already exists)
      INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
      VALUES (
        v_member.profile_id,
        v_gym.gym_id,
        'churn_followup',
        'We miss you!',
        v_next_step.message_template,
        jsonb_build_object(
          'drip_step', v_next_step.step_number,
          'channels', v_next_step.channel,
          'churn_score', v_member.score
        ),
        v_dedup
      )
      ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
      DO NOTHING;

      -- Only insert win_back_attempt if notification was actually created (not a duplicate)
      IF FOUND THEN
        INSERT INTO win_back_attempts (user_id, gym_id, step_number, message, outcome, variant)
        VALUES (
          v_member.profile_id,
          v_gym.gym_id,
          v_next_step.step_number,
          v_next_step.message_template,
          'pending',
          'drip_auto'
        );

        v_total := v_total + 1;
      END IF;

    END LOOP; -- members

    -- Update last_run tracking on the settings row
    UPDATE churn_followup_settings
    SET last_run_at = NOW(),
        last_run_count = v_total
    WHERE gym_id = v_gym.gym_id;

  END LOOP; -- gyms

  RETURN v_total;
END;
$$;

-- 4. Schedule via pg_cron: daily at 9 AM UTC
SELECT cron.schedule(
  'execute-drip-campaigns',
  '0 9 * * *',
  $$SELECT execute_drip_campaigns()$$
);

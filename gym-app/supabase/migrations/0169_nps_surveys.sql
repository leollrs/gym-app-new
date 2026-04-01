-- ============================================================
-- 0169: NPS Surveys & Member Feedback
-- Allows admins to send NPS surveys and collect feedback
-- ============================================================

CREATE TABLE IF NOT EXISTS nps_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL DEFAULT 'How likely are you to recommend our gym?',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES nps_surveys(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score >= 0 AND score <= 10),
  feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(survey_id, profile_id)
);

CREATE INDEX idx_nps_responses_gym ON nps_responses(gym_id, created_at DESC);
CREATE INDEX idx_nps_responses_survey ON nps_responses(survey_id);
CREATE INDEX idx_nps_surveys_gym ON nps_surveys(gym_id);

-- RLS
ALTER TABLE nps_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage surveys for their gym"
  ON nps_surveys FOR ALL
  USING (gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Members can read active surveys for their gym"
  ON nps_surveys FOR SELECT
  USING (
    is_active = true
    AND gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Members can insert their own response"
  ON nps_responses FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Admins can read all responses for their gym"
  ON nps_responses FOR SELECT
  USING (gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid()));

-- RPC to get NPS stats
CREATE OR REPLACE FUNCTION public.get_nps_stats(p_gym_id UUID, p_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result JSON;
BEGIN
  -- Verify caller is admin of this gym
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_responses', COUNT(*),
    'promoters', COUNT(*) FILTER (WHERE score >= 9),
    'passives', COUNT(*) FILTER (WHERE score >= 7 AND score < 9),
    'detractors', COUNT(*) FILTER (WHERE score < 7),
    'nps_score', CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
        (COUNT(*) FILTER (WHERE score >= 9)::NUMERIC / COUNT(*)::NUMERIC * 100)
        - (COUNT(*) FILTER (WHERE score < 7)::NUMERIC / COUNT(*)::NUMERIC * 100)
      )
    END,
    'avg_score', ROUND(AVG(score)::NUMERIC, 1),
    'response_rate', (
      SELECT CASE
        WHEN member_count = 0 THEN 0
        ELSE ROUND(response_count::NUMERIC / member_count::NUMERIC * 100)
      END
      FROM (
        SELECT
          COUNT(DISTINCT nr.profile_id) AS response_count,
          (SELECT COUNT(*) FROM profiles WHERE gym_id = p_gym_id AND role = 'member') AS member_count
        FROM nps_responses nr
        WHERE nr.gym_id = p_gym_id
          AND nr.created_at >= now() - (p_days || ' days')::INTERVAL
      ) sub
    )
  )
  INTO _result
  FROM nps_responses
  WHERE gym_id = p_gym_id
    AND created_at >= now() - (p_days || ' days')::INTERVAL;

  RETURN _result;
END;
$$;

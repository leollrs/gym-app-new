-- ============================================================
-- 0373 — Realign NPS to the 1-5 scale the member app actually uses
-- ============================================================
-- The member-facing NPSSurveyModal asks members to rate 1-5, but
-- get_nps_stats (from 0169) was written for the canonical 0-10 NPS
-- scale: promoters >= 9, passives 7-8, detractors < 7. With members
-- only able to submit 1-5, every response was being classified as a
-- detractor, NPS was always -100 (or close to it), and the admin
-- "Member feedback" page showed nonsense.
--
-- Fix: rewrite get_nps_stats to bucket scores against the 1-5 scale:
--   promoters  : 4 or 5
--   passives   : 3
--   detractors : 1 or 2
-- (score = -1 is reserved for dismissals — exclude from all counts.)
-- ============================================================

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
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_responses', COUNT(*),
    'promoters',  COUNT(*) FILTER (WHERE score >= 4),
    'passives',   COUNT(*) FILTER (WHERE score = 3),
    'detractors', COUNT(*) FILTER (WHERE score >= 1 AND score <= 2),
    'nps_score', CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
        (COUNT(*) FILTER (WHERE score >= 4)::NUMERIC / COUNT(*)::NUMERIC * 100)
        - (COUNT(*) FILTER (WHERE score >= 1 AND score <= 2)::NUMERIC / COUNT(*)::NUMERIC * 100)
      )
    END,
    'avg_score', ROUND(AVG(score)::NUMERIC, 1),
    -- 5-bucket distribution: indices 0..4 → scores 1..5.
    'distribution', json_build_array(
      COUNT(*) FILTER (WHERE score = 1),
      COUNT(*) FILTER (WHERE score = 2),
      COUNT(*) FILTER (WHERE score = 3),
      COUNT(*) FILTER (WHERE score = 4),
      COUNT(*) FILTER (WHERE score = 5)
    ),
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
          AND nr.score >= 1   -- exclude dismissals
      ) sub
    )
  )
  INTO _result
  FROM nps_responses
  WHERE gym_id = p_gym_id
    AND created_at >= now() - (p_days || ' days')::INTERVAL
    AND score >= 1;            -- exclude dismissals (score = -1)

  RETURN _result;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Allow score = -1 to track survey dismissals
ALTER TABLE nps_responses DROP CONSTRAINT IF EXISTS nps_responses_score_check;
ALTER TABLE nps_responses ADD CONSTRAINT nps_responses_score_check CHECK (score >= -1 AND score <= 10);

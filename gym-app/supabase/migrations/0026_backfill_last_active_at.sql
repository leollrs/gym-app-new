-- Backfill last_active_at from most recent completed workout session
-- for members who have sessions but never had last_active_at written
UPDATE profiles p
SET last_active_at = (
  SELECT MAX(started_at)
  FROM workout_sessions ws
  WHERE ws.profile_id = p.id
    AND ws.status = 'completed'
)
WHERE last_active_at IS NULL
  AND EXISTS (
    SELECT 1 FROM workout_sessions ws
    WHERE ws.profile_id = p.id
      AND ws.status = 'completed'
  );

-- Also backfill from check_ins for members with no sessions but check-in history
UPDATE profiles p
SET last_active_at = (
  SELECT MAX(checked_in_at)
  FROM check_ins ci
  WHERE ci.profile_id = p.id
)
WHERE last_active_at IS NULL
  AND EXISTS (
    SELECT 1 FROM check_ins ci
    WHERE ci.profile_id = p.id
  );

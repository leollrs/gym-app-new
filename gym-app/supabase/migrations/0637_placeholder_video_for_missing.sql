-- ============================================================
-- 0637 — "Video coming soon" placeholder for exercises without a demo
-- ============================================================
-- Points every global library exercise that still has no demo video at the
-- branded placeholder clip (global/coming-soon.mp4), so the app shows a premium
-- "Video Coming Soon" loop instead of an empty gray square.
--
-- When a real demo is added later, its wiring migration simply overwrites
-- video_url with the real path. To find exercises still on the placeholder:
--   SELECT id, name FROM exercises WHERE video_url = 'global/coming-soon.mp4';
--
-- Idempotent (re-running only affects rows that are still NULL/empty).
-- ============================================================

UPDATE exercises
SET    video_url = 'global/coming-soon.mp4'
WHERE  gym_id IS NULL
  AND  (video_url IS NULL OR video_url = '');

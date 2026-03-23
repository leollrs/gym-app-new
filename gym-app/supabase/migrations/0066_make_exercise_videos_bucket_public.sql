-- Make exercise-videos bucket public so getPublicUrl() works for all users
-- Storage RLS policies still control writes (super_admin only)
UPDATE storage.buckets
SET public = true
WHERE id = 'exercise-videos';

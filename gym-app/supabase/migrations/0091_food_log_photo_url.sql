-- Add photo_url to food_logs for AI-scanned meal photos
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Add image_url column to food_items for food photos
ALTER TABLE food_items ADD COLUMN IF NOT EXISTS image_url TEXT;

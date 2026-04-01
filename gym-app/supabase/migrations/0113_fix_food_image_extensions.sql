-- Fix food_items.image_url extensions: .png → .jpg
-- All food/meal images were re-exported as compressed JPGs
UPDATE food_items
   SET image_url = regexp_replace(image_url, '\.png$', '.jpg')
 WHERE image_url LIKE '%.png';

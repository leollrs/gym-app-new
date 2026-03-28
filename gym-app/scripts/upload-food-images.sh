#!/bin/bash
# Upload all food and meal images to Supabase storage bucket "food-images"
# Usage: SUPABASE_SERVICE_ROLE_KEY=your_key_here bash scripts/upload-food-images.sh

set -e

SB_URL="https://erdhnixjnjullhjzmvpm.supabase.co"
SB_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Please set SUPABASE_SERVICE_ROLE_KEY}"
BUCKET="food-images"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Supabase Food Image Uploader ==="
echo "URL: $SB_URL"
echo "Bucket: $BUCKET"
echo ""

# Step 1: Create bucket if it doesn't exist
echo "Creating bucket '$BUCKET' (if needed)..."
curl -s -X POST "$SB_URL/storage/v1/bucket" \
  -H "apikey: $SB_KEY" \
  -H "Authorization: Bearer $SB_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":true}" \
  -o /dev/null -w "  Bucket create: HTTP %{http_code}\n"

# Step 2: Upload food images
echo ""
echo "=== Uploading food images ==="
FOOD_DIR="$SCRIPT_DIR/public/foods"
food_count=0
food_skip=0
food_fail=0

for f in "$FOOD_DIR"/*; do
  [ -f "$f" ] || continue
  filename=$(basename "$f")
  remote_path="foods/$filename"

  # Determine content type
  case "$filename" in
    *.jpg|*.jpeg) ctype="image/jpeg" ;;
    *.png) ctype="image/png" ;;
    *.webp) ctype="image/webp" ;;
    *) ctype="application/octet-stream" ;;
  esac

  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$SB_URL/storage/v1/object/$BUCKET/$remote_path" \
    -H "apikey: $SB_KEY" \
    -H "Authorization: Bearer $SB_KEY" \
    -H "Content-Type: $ctype" \
    -H "x-upsert: true" \
    --data-binary "@$f")

  if [ "$code" = "200" ]; then
    food_count=$((food_count+1))
  elif [ "$code" = "409" ]; then
    food_skip=$((food_skip+1))
  else
    food_fail=$((food_fail+1))
    echo "  FAIL ($code): $remote_path"
  fi

  # Progress every 50
  total=$((food_count+food_skip+food_fail))
  if [ $((total % 50)) -eq 0 ]; then
    echo "  Progress: $total files processed..."
  fi
done
echo "  Foods done: $food_count uploaded, $food_skip skipped, $food_fail failed"

# Step 3: Upload meal images
echo ""
echo "=== Uploading meal images ==="
MEAL_DIR="$SCRIPT_DIR/public/meals"
meal_count=0
meal_skip=0
meal_fail=0

for f in "$MEAL_DIR"/*; do
  [ -f "$f" ] || continue
  filename=$(basename "$f")
  remote_path="meals/$filename"

  case "$filename" in
    *.jpg|*.jpeg) ctype="image/jpeg" ;;
    *.png) ctype="image/png" ;;
    *.webp) ctype="image/webp" ;;
    *) ctype="application/octet-stream" ;;
  esac

  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$SB_URL/storage/v1/object/$BUCKET/$remote_path" \
    -H "apikey: $SB_KEY" \
    -H "Authorization: Bearer $SB_KEY" \
    -H "Content-Type: $ctype" \
    -H "x-upsert: true" \
    --data-binary "@$f")

  if [ "$code" = "200" ]; then
    meal_count=$((meal_count+1))
  elif [ "$code" = "409" ]; then
    meal_skip=$((meal_skip+1))
  else
    meal_fail=$((meal_fail+1))
    echo "  FAIL ($code): $remote_path"
  fi

  total=$((meal_count+meal_skip+meal_fail))
  if [ $((total % 50)) -eq 0 ]; then
    echo "  Progress: $total files processed..."
  fi
done
echo "  Meals done: $meal_count uploaded, $meal_skip skipped, $meal_fail failed"

# Summary
echo ""
echo "=== DONE ==="
echo "Foods: $food_count uploaded, $food_skip already existed, $food_fail failed"
echo "Meals: $meal_count uploaded, $meal_skip already existed, $meal_fail failed"
echo "Total: $((food_count+meal_count)) uploaded"
echo ""
echo "Public URL pattern:"
echo "  $SB_URL/storage/v1/object/public/$BUCKET/foods/chicken_breast.jpg"
echo "  $SB_URL/storage/v1/object/public/$BUCKET/meals/salmon_bowl.jpg"

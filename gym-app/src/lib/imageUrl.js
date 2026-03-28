// Resolves local food/meal image paths to Supabase Storage public URLs.
// Bucket: food-images
// Structure: foods/chicken_breast.jpg, meals/salmon_bowl.jpg

const STORAGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/food-images`;

/**
 * Convert a local image path (e.g. "/foods/chicken_breast.jpg") to its
 * Supabase Storage public URL. Already-absolute URLs are returned as-is.
 */
export function foodImageUrl(path) {
  if (!path) return null;
  // Already a full URL — leave untouched
  if (path.startsWith('http')) return path;
  // Local path like /foods/xxx.jpg or /meals/xxx.jpg → Supabase URL
  return `${STORAGE_BASE}${path}`;
}

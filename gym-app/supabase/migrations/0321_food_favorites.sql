-- ═══════════════════════════════════════════════════════════
-- SCANNED FOOD FAVORITES
-- Name-keyed favorites for AI-scanned and barcode-scanned foods
-- that don't have a food_items.id. Complements the existing
-- favorite_foods table (which is keyed on food_item_id).
-- ═══════════════════════════════════════════════════════════

create table if not exists food_favorites (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid references profiles(id) on delete cascade,
  food_name       text not null,
  food_image_url  text,
  brand_name      text,
  calories        numeric,
  protein_g       numeric,
  carbs_g         numeric,
  fat_g           numeric,
  serving_size    text,
  nutri_score     integer,
  created_at      timestamptz default now(),
  unique(profile_id, food_name)
);

create index if not exists idx_food_favorites_profile on food_favorites(profile_id, created_at desc);

alter table food_favorites enable row level security;

drop policy if exists "own favorites" on food_favorites;
create policy "own favorites" on food_favorites for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

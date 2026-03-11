-- Add a key/slug column to achievement_definitions for stable frontend lookups.
-- Then seed the 6 global achievements with fixed UUIDs so the frontend can
-- reference them without a round-trip fetch.

ALTER TABLE achievement_definitions ADD COLUMN IF NOT EXISTS key TEXT UNIQUE;

INSERT INTO achievement_definitions
  (id, name, description, icon, category, criteria, is_global, sort_order, key)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'First Workout',  'Log your first session',        'dumbbell',  'milestone', '{"sessions": 1}',            TRUE, 1, 'first_workout'),
  ('a1000000-0000-0000-0000-000000000002', '7-Day Streak',   'Train 7 days in a row',         'flame',     'milestone', '{"streak": 7}',              TRUE, 2, 'streak_7'),
  ('a1000000-0000-0000-0000-000000000003', '30-Day Streak',  'Train 30 days in a row',        'flame',     'milestone', '{"streak": 30}',             TRUE, 3, 'streak_30'),
  ('a1000000-0000-0000-0000-000000000004', 'Century Club',   '100 workouts completed',        'trophy',    'milestone', '{"sessions": 100}',          TRUE, 4, 'century_club'),
  ('a1000000-0000-0000-0000-000000000005', 'Volume King',    '1 million lbs total volume',    'bar_chart', 'milestone', '{"totalVolume": 1000000}',   TRUE, 5, 'volume_king'),
  ('a1000000-0000-0000-0000-000000000006', 'PR Machine',     'Set 10 personal records',       'star',      'milestone', '{"prCount": 10}',            TRUE, 6, 'pr_machine')
ON CONFLICT (id) DO NOTHING;

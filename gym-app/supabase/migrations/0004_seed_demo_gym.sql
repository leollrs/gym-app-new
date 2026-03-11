-- =============================================================
-- SEED: DEMO GYM
-- Migration: 0004_seed_demo_gym.sql
-- =============================================================
-- Creates the first gym tenant used for development.
-- Gym code (slug) = 'demo' — users enter this during signup.
-- Uses a fixed UUID so it can be referenced in other seeds.
-- =============================================================

INSERT INTO gyms (id, name, slug, timezone, is_active, subscription_tier)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'IronForge Gym',
  'demo',
  'America/New_York',
  TRUE,
  'pro'
);

INSERT INTO gym_branding (gym_id, primary_color, secondary_color, accent_color, custom_app_name, welcome_message)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '#D4AF37',
  '#0F172A',
  '#10B981',
  'IronForge',
  'Welcome to IronForge. Train hard, track everything.'
);

INSERT INTO gym_leaderboard_config (gym_id, metric, period, display_count)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'volume',
  'weekly',
  10
);

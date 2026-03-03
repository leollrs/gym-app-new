-- =============================================================
-- GYM APP — INITIAL SCHEMA
-- Migration: 0001_initial_schema.sql
-- =============================================================
-- Run in Supabase SQL editor or via `supabase db push`.
-- All tables are scoped to gym_id for multi-tenancy.
-- Row-Level Security (RLS) is enabled on every table.
-- =============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search on exercise names
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- composite GIN indexes

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role          AS ENUM ('member', 'trainer', 'admin', 'super_admin');
CREATE TYPE fitness_level      AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE fitness_goal       AS ENUM ('muscle_gain', 'fat_loss', 'strength', 'endurance', 'general_fitness');
CREATE TYPE equipment_type     AS ENUM ('Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Kettlebell', 'Resistance Band', 'Smith Machine');
CREATE TYPE exercise_category  AS ENUM ('Strength', 'Hypertrophy', 'Power', 'Endurance', 'Mobility');
CREATE TYPE muscle_group       AS ENUM ('Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Calves', 'Full Body');
CREATE TYPE session_status     AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE checkin_method     AS ENUM ('qr', 'gps', 'manual');
CREATE TYPE friendship_status  AS ENUM ('pending', 'accepted', 'blocked');
CREATE TYPE challenge_type     AS ENUM ('consistency', 'volume', 'pr_count', 'team', 'specific_lift');
CREATE TYPE challenge_status   AS ENUM ('draft', 'active', 'completed', 'archived');
CREATE TYPE feed_item_type     AS ENUM ('workout_completed', 'pr_hit', 'challenge_joined', 'challenge_won', 'achievement_unlocked', 'check_in', 'program_started');
CREATE TYPE achievement_category AS ENUM ('milestone', 'challenge', 'strength_standard', 'streak', 'social');
CREATE TYPE notification_type  AS ENUM ('workout_reminder', 'streak_warning', 'challenge_update', 'friend_activity', 'overload_suggestion', 'announcement', 'pr_beaten', 'trainer_message', 'churn_followup');
CREATE TYPE overload_strategy  AS ENUM ('double_progression', 'percentage_periodization', 'linear');
CREATE TYPE leaderboard_metric AS ENUM ('volume', 'streak', 'pr_count', 'challenge_score', 'check_ins');
CREATE TYPE leaderboard_period AS ENUM ('weekly', 'monthly', 'all_time');
CREATE TYPE program_visibility AS ENUM ('public', 'gym_only', 'assigned_only');
CREATE TYPE announcement_type  AS ENUM ('news', 'event', 'challenge', 'maintenance');

-- ============================================================
-- SECTION 1: GYMS (Tenant Root)
-- ============================================================

-- gyms: the tenant root. Every member record points back here via gym_id.
CREATE TABLE gyms (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL UNIQUE,    -- e.g. "ironforge-barbell" → subdomain routing
    owner_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    country           TEXT,
    timezone          TEXT NOT NULL DEFAULT 'UTC',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    subscription_tier TEXT NOT NULL DEFAULT 'starter',  -- starter | pro | enterprise
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_gyms_slug ON gyms(slug);

-- gym_branding: white-label config per gym (colors, logo, name).
CREATE TABLE gym_branding (
    gym_id            UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
    logo_url          TEXT,
    primary_color     TEXT NOT NULL DEFAULT '#D4AF37',
    secondary_color   TEXT NOT NULL DEFAULT '#0F172A',
    accent_color      TEXT NOT NULL DEFAULT '#10B981',
    welcome_message   TEXT,
    custom_app_name   TEXT,        -- overrides platform name in the UI
    favicon_url       TEXT,
    tv_background_url TEXT,        -- custom background for TV leaderboard display
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SECTION 2: USERS & PROFILES
-- ============================================================

-- profiles: extends auth.users. One row per user per gym.
-- A trainer at two gyms has two profile rows with different gym_id.
CREATE TABLE profiles (
    id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    role              user_role NOT NULL DEFAULT 'member',
    username          TEXT NOT NULL,
    full_name         TEXT NOT NULL,
    avatar_url        TEXT,
    bio               TEXT,
    date_of_birth     DATE,
    gender            TEXT,                    -- used for strength standard comparisons
    bodyweight_lbs    NUMERIC(6,2),            -- latest known value (denormalized for speed)
    privacy_public    BOOLEAN NOT NULL DEFAULT FALSE,  -- show stats to all gym members
    is_onboarded      BOOLEAN NOT NULL DEFAULT FALSE,
    last_active_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT profiles_username_gym_unique UNIQUE (gym_id, username)
);

CREATE INDEX idx_profiles_gym_id      ON profiles(gym_id);
CREATE INDEX idx_profiles_role        ON profiles(gym_id, role);
CREATE INDEX idx_profiles_last_active ON profiles(gym_id, last_active_at DESC);

-- member_onboarding: fitness profile captured during onboarding.
-- Seeds the progressive overload engine and program recommendations.
CREATE TABLE member_onboarding (
    profile_id              UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                  UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    fitness_level           fitness_level,
    primary_goal            fitness_goal,
    target_date             DATE,
    training_days_per_week  INT CHECK (training_days_per_week BETWEEN 1 AND 7),
    available_equipment     equipment_type[],
    injuries_notes          TEXT,              -- "bad left knee, avoid deep squats"
    excluded_exercise_ids   TEXT[],            -- exercise IDs to skip or substitute
    initial_weight_lbs      NUMERIC(6,2),
    initial_body_fat_pct    NUMERIC(5,2),
    completed_at            TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_gym ON member_onboarding(gym_id);

-- nutrition_targets: daily macro targets derived from goal + body metrics.
CREATE TABLE nutrition_targets (
    profile_id          UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id              UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    daily_calories      INT,
    daily_protein_g     INT,
    daily_carbs_g       INT,
    daily_fat_g         INT,
    calculation_method  TEXT DEFAULT 'mifflin_st_jeor',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- nutrition_checkins: daily "did you hit nutrition?" log.
CREATE TABLE nutrition_checkins (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    checkin_date    DATE NOT NULL,
    hit_calories    BOOLEAN,
    hit_protein     BOOLEAN,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT nutrition_checkins_unique_day UNIQUE (profile_id, checkin_date)
);

CREATE INDEX idx_nutrition_checkins_profile ON nutrition_checkins(profile_id, checkin_date DESC);

-- ============================================================
-- SECTION 3: TRAINER-CLIENT RELATIONSHIPS
-- ============================================================

-- trainer_clients: maps trainers to their clients within a gym.
CREATE TABLE trainer_clients (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    trainer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notes       TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT trainer_clients_unique UNIQUE (trainer_id, client_id)
);

CREATE INDEX idx_trainer_clients_trainer ON trainer_clients(trainer_id) WHERE is_active = TRUE;
CREATE INDEX idx_trainer_clients_client  ON trainer_clients(client_id)  WHERE is_active = TRUE;

-- ============================================================
-- SECTION 4: EXERCISE LIBRARY
-- ============================================================

-- exercises: canonical exercise catalog.
-- gym_id IS NULL = global/platform exercise.
-- gym_id SET = custom exercise added by that gym.
-- TEXT primary key matches existing frontend IDs ('ex_bp', 'ex_sq', etc.)
CREATE TABLE exercises (
    id                  TEXT PRIMARY KEY,
    gym_id              UUID REFERENCES gyms(id) ON DELETE CASCADE,  -- NULL = global
    name                TEXT NOT NULL,
    muscle_group        muscle_group NOT NULL,
    equipment           equipment_type NOT NULL,
    category            exercise_category NOT NULL,
    default_sets        INT NOT NULL DEFAULT 3,
    default_reps        TEXT NOT NULL DEFAULT '8-12',  -- text supports "5", "8-10", "60s", "12 each"
    rest_seconds        INT NOT NULL DEFAULT 90,
    instructions        TEXT,
    primary_regions     TEXT[],
    secondary_regions   TEXT[],
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exercises_muscle    ON exercises(muscle_group)  WHERE is_active = TRUE;
CREATE INDEX idx_exercises_equipment ON exercises(equipment)     WHERE is_active = TRUE;
CREATE INDEX idx_exercises_gym       ON exercises(gym_id)        WHERE is_active = TRUE;
CREATE INDEX idx_exercises_name_gin  ON exercises USING GIN (name gin_trgm_ops);

-- exercise_substitutions: exercises that can substitute each other.
-- Used by the overload engine to auto-swap injury-excluded exercises.
CREATE TABLE exercise_substitutions (
    exercise_id      TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    substitute_id    TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    similarity_score NUMERIC(3,2) DEFAULT 1.0,  -- 0.0–1.0
    PRIMARY KEY (exercise_id, substitute_id),
    CHECK (exercise_id <> substitute_id)
);

CREATE INDEX idx_substitutions_sub ON exercise_substitutions(substitute_id);

-- ============================================================
-- SECTION 5: ROUTINES
-- ============================================================

-- routines: a single named workout (e.g. "Push Day Hypertrophy").
-- is_template = TRUE → appears in the "Gym Programs" tab.
CREATE TABLE routines (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id                  UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    created_by              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    description             TEXT,
    is_template             BOOLEAN NOT NULL DEFAULT FALSE,
    is_public               BOOLEAN NOT NULL DEFAULT FALSE,
    estimated_duration_min  INT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_routines_gym        ON routines(gym_id);
CREATE INDEX idx_routines_created_by ON routines(created_by);
CREATE INDEX idx_routines_templates  ON routines(gym_id) WHERE is_template = TRUE;

-- routine_exercises: ordered exercise list within a routine.
CREATE TABLE routine_exercises (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    routine_id  UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    position    INT NOT NULL,
    target_sets INT NOT NULL DEFAULT 3,
    target_reps TEXT NOT NULL DEFAULT '8-12',
    rest_seconds INT NOT NULL DEFAULT 90,
    notes       TEXT,

    CONSTRAINT routine_exercises_position_unique UNIQUE (routine_id, position)
);

CREATE INDEX idx_routine_exercises_routine ON routine_exercises(routine_id, position);

-- ============================================================
-- SECTION 6: PROGRAM TEMPLATES (multi-week plans)
-- ============================================================

-- program_templates: named multi-week training plans.
-- gym_id NULL = platform-level. gym_id SET = gym-branded program.
CREATE TABLE program_templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id          UUID REFERENCES gyms(id) ON DELETE CASCADE,     -- NULL = global
    created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    level           fitness_level,
    goal            fitness_goal,
    duration_weeks  INT NOT NULL,
    days_per_week   INT NOT NULL CHECK (days_per_week BETWEEN 1 AND 7),
    visibility      program_visibility NOT NULL DEFAULT 'gym_only',
    thumbnail_url   TEXT,
    enrolled_count  INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_program_templates_gym    ON program_templates(gym_id)   WHERE is_active = TRUE;
CREATE INDEX idx_program_templates_global ON program_templates(id) WHERE gym_id IS NULL AND is_active = TRUE;

-- program_weeks: one row per week in a program.
CREATE TABLE program_weeks (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id   UUID NOT NULL REFERENCES program_templates(id) ON DELETE CASCADE,
    week_number  INT NOT NULL CHECK (week_number >= 1),
    label        TEXT,        -- e.g. "Accumulation", "Deload"
    is_deload    BOOLEAN NOT NULL DEFAULT FALSE,
    notes        TEXT,

    CONSTRAINT program_weeks_unique UNIQUE (program_id, week_number)
);

CREATE INDEX idx_program_weeks_program ON program_weeks(program_id, week_number);

-- program_week_days: maps a day slot to a routine (NULL = rest day).
CREATE TABLE program_week_days (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    week_id     UUID NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
    day_number  INT NOT NULL CHECK (day_number BETWEEN 1 AND 7),
    routine_id  UUID REFERENCES routines(id) ON DELETE SET NULL,  -- NULL = rest day
    label       TEXT,        -- e.g. "Push", "Rest", "Cardio"

    CONSTRAINT program_week_days_unique UNIQUE (week_id, day_number)
);

CREATE INDEX idx_program_week_days_week    ON program_week_days(week_id);
CREATE INDEX idx_program_week_days_routine ON program_week_days(routine_id);

-- user_enrolled_programs: tracks member enrollment and progress in a program.
CREATE TABLE user_enrolled_programs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    program_id    UUID NOT NULL REFERENCES program_templates(id) ON DELETE CASCADE,
    assigned_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- trainer or admin
    current_week  INT NOT NULL DEFAULT 1,
    current_day   INT NOT NULL DEFAULT 1,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT enrolled_programs_active_unique UNIQUE (profile_id, program_id, is_active)
);

CREATE INDEX idx_enrolled_programs_profile ON user_enrolled_programs(profile_id) WHERE is_active = TRUE;
CREATE INDEX idx_enrolled_programs_gym     ON user_enrolled_programs(gym_id);

-- ============================================================
-- SECTION 7: WORKOUT SESSIONS (live logging)
-- ============================================================

-- workout_sessions: parent record per session. Status tracks progress.
CREATE TABLE workout_sessions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                  UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    routine_id              UUID REFERENCES routines(id) ON DELETE SET NULL,
    program_enrollment_id   UUID REFERENCES user_enrolled_programs(id) ON DELETE SET NULL,
    name                    TEXT NOT NULL,
    status                  session_status NOT NULL DEFAULT 'in_progress',
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    duration_seconds        INT,
    total_volume_lbs        NUMERIC(12,2),     -- denormalized sum for leaderboard queries
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_profile    ON workout_sessions(profile_id, started_at DESC);
CREATE INDEX idx_sessions_gym_date   ON workout_sessions(gym_id, started_at DESC)     WHERE status = 'completed';
CREATE INDEX idx_sessions_gym_volume ON workout_sessions(gym_id, total_volume_lbs DESC) WHERE status = 'completed';

-- session_exercises: exercises performed during a session.
CREATE TABLE session_exercises (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id    UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id   TEXT NOT NULL REFERENCES exercises(id),
    snapshot_name TEXT NOT NULL,   -- denormalized: preserves name even if exercise changes
    position      INT NOT NULL,
    notes         TEXT
);

CREATE INDEX idx_session_exercises_session ON session_exercises(session_id, position);

-- session_sets: leaf-level log — one row per set performed.
-- suggested_* columns are pre-filled from overload_suggestions at session start.
CREATE TABLE session_sets (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_exercise_id   UUID NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
    set_number            INT NOT NULL,
    weight_lbs            NUMERIC(7,2),
    reps                  INT,
    duration_seconds      INT,         -- for timed sets (planks, etc.)
    rpe                   NUMERIC(3,1),  -- rate of perceived exertion 1–10
    is_warmup             BOOLEAN NOT NULL DEFAULT FALSE,
    is_completed          BOOLEAN NOT NULL DEFAULT FALSE,
    is_pr                 BOOLEAN NOT NULL DEFAULT FALSE,  -- set by detect-pr edge function
    estimated_1rm         NUMERIC(7,2),  -- Epley formula, stored on log
    suggested_weight_lbs  NUMERIC(7,2),  -- from overload engine at session start
    suggested_reps        INT,
    logged_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_session_sets_exercise ON session_sets(session_exercise_id, set_number);
CREATE INDEX idx_session_sets_pr       ON session_sets(session_exercise_id) WHERE is_pr = TRUE;

-- ============================================================
-- SECTION 8: PROGRESSIVE OVERLOAD ENGINE
-- ============================================================

-- overload_suggestions: one row per user per exercise (upserted after each session).
-- The active session reads from here — suggestions are never computed inline.
CREATE TABLE overload_suggestions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    exercise_id           TEXT NOT NULL REFERENCES exercises(id),
    suggested_weight_lbs  NUMERIC(7,2),
    suggested_reps        INT,
    suggested_sets        INT,
    strategy              overload_strategy NOT NULL DEFAULT 'double_progression',
    confidence            NUMERIC(3,2),   -- 0.0–1.0, lower if few data points
    deload_flagged        BOOLEAN NOT NULL DEFAULT FALSE,
    notes                 TEXT,           -- human-readable engine reasoning
    based_on_session_id   UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT overload_suggestions_unique UNIQUE (profile_id, exercise_id)
);

CREATE INDEX idx_overload_profile  ON overload_suggestions(profile_id);
CREATE INDEX idx_overload_exercise ON overload_suggestions(exercise_id, profile_id);

-- ============================================================
-- SECTION 9: PERSONAL RECORDS
-- ============================================================

-- personal_records: best estimated 1RM per user per exercise (current best only).
CREATE TABLE personal_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    exercise_id     TEXT NOT NULL REFERENCES exercises(id),
    weight_lbs      NUMERIC(7,2) NOT NULL,
    reps            INT NOT NULL,
    estimated_1rm   NUMERIC(7,2) NOT NULL,
    achieved_at     TIMESTAMPTZ NOT NULL,
    session_id      UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT personal_records_unique UNIQUE (profile_id, exercise_id)
);

CREATE INDEX idx_pr_profile   ON personal_records(profile_id);
CREATE INDEX idx_pr_exercise  ON personal_records(exercise_id, estimated_1rm DESC);
CREATE INDEX idx_pr_gym       ON personal_records(gym_id, exercise_id, estimated_1rm DESC);

-- pr_history: every PR set over time (time series). personal_records holds only the best.
CREATE TABLE pr_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    exercise_id     TEXT NOT NULL REFERENCES exercises(id),
    weight_lbs      NUMERIC(7,2) NOT NULL,
    reps            INT NOT NULL,
    estimated_1rm   NUMERIC(7,2) NOT NULL,
    achieved_at     TIMESTAMPTZ NOT NULL,
    session_id      UUID REFERENCES workout_sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_pr_history_profile  ON pr_history(profile_id, exercise_id, achieved_at DESC);
CREATE INDEX idx_pr_history_gym_date ON pr_history(gym_id, achieved_at DESC);

-- ============================================================
-- SECTION 10: BODY METRICS
-- ============================================================

-- body_weight_logs: weight tracking over time.
CREATE TABLE body_weight_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id       UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    weight_lbs   NUMERIC(6,2) NOT NULL,
    notes        TEXT,
    logged_at    DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT body_weight_logs_unique_day UNIQUE (profile_id, logged_at)
);

CREATE INDEX idx_weight_logs_profile ON body_weight_logs(profile_id, logged_at DESC);

-- body_measurements: circumference measurements over time.
CREATE TABLE body_measurements (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    body_fat_pct      NUMERIC(5,2),
    chest_cm          NUMERIC(6,2),
    waist_cm          NUMERIC(6,2),
    hips_cm           NUMERIC(6,2),
    left_arm_cm       NUMERIC(6,2),
    right_arm_cm      NUMERIC(6,2),
    left_thigh_cm     NUMERIC(6,2),
    right_thigh_cm    NUMERIC(6,2),
    notes             TEXT,
    measured_at       DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_measurements_profile ON body_measurements(profile_id, measured_at DESC);

-- progress_photos: progress photo metadata (file stored in Supabase Storage).
CREATE TABLE progress_photos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    storage_path    TEXT NOT NULL,    -- Supabase Storage path
    view_angle      TEXT,             -- 'front' | 'side' | 'back'
    is_private      BOOLEAN NOT NULL DEFAULT TRUE,
    taken_at        DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_photos_profile ON progress_photos(profile_id, taken_at DESC);

-- ============================================================
-- SECTION 11: ATTENDANCE / CHECK-IN
-- ============================================================

-- check_ins: gym attendance records. Feeds churn prediction.
CREATE TABLE check_ins (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method          checkin_method NOT NULL DEFAULT 'manual',
    session_id      UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
    latitude        NUMERIC(10,7),   -- for GPS check-in validation
    longitude       NUMERIC(10,7)
);

CREATE INDEX idx_checkins_profile ON check_ins(profile_id, checked_in_at DESC);
CREATE INDEX idx_checkins_gym     ON check_ins(gym_id, checked_in_at DESC);

-- ============================================================
-- SECTION 12: STREAKS
-- ============================================================

-- streak_cache: denormalized streak data, updated by edge function after each session/checkin.
CREATE TABLE streak_cache (
    profile_id              UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                  UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    current_streak_days     INT NOT NULL DEFAULT 0,
    longest_streak_days     INT NOT NULL DEFAULT 0,
    last_activity_date      DATE,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streak_cache_gym ON streak_cache(gym_id, current_streak_days DESC);

-- ============================================================
-- SECTION 13: SOCIAL
-- ============================================================

-- friendships: within-gym friend connections.
CREATE TABLE friendships (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    requester_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    addressee_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status        friendship_status NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT friendships_unique UNIQUE (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

CREATE INDEX idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX idx_friendships_gym       ON friendships(gym_id);

-- activity_feed_items: social activity events (workouts, PRs, achievements, etc.)
CREATE TABLE activity_feed_items (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    actor_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type        feed_item_type NOT NULL,
    data        JSONB NOT NULL DEFAULT '{}',   -- flexible payload per type
    is_public   BOOLEAN NOT NULL DEFAULT TRUE, -- false = friends-only
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_gym    ON activity_feed_items(gym_id, created_at DESC);
CREATE INDEX idx_feed_actor  ON activity_feed_items(actor_id, created_at DESC);
CREATE INDEX idx_feed_public ON activity_feed_items(gym_id, is_public, created_at DESC);

-- feed_likes: likes on feed items.
CREATE TABLE feed_likes (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_item_id UUID NOT NULL REFERENCES activity_feed_items(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT feed_likes_unique UNIQUE (feed_item_id, profile_id)
);

CREATE INDEX idx_feed_likes_item ON feed_likes(feed_item_id);

-- feed_comments: comments on feed items.
CREATE TABLE feed_comments (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_item_id UUID NOT NULL REFERENCES activity_feed_items(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content      TEXT NOT NULL,
    is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_comments_item ON feed_comments(feed_item_id, created_at);

-- ============================================================
-- SECTION 14: CHALLENGES
-- ============================================================

-- challenges: gym-hosted competitions.
CREATE TABLE challenges (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id              UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    created_by          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    type                challenge_type NOT NULL,
    exercise_id         TEXT REFERENCES exercises(id),  -- for 'specific_lift' type
    status              challenge_status NOT NULL DEFAULT 'draft',
    scoring_normalized  BOOLEAN NOT NULL DEFAULT FALSE,  -- normalize by bodyweight/level
    start_date          TIMESTAMPTZ NOT NULL,
    end_date            TIMESTAMPTZ NOT NULL,
    reward_description  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_challenges_gym    ON challenges(gym_id, status);
CREATE INDEX idx_challenges_active ON challenges(gym_id, start_date, end_date) WHERE status = 'active';

-- challenge_teams: for team-type challenges.
CREATE TABLE challenge_teams (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    score        NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_challenge_teams_challenge ON challenge_teams(challenge_id);

-- challenge_participants: members enrolled in a challenge.
CREATE TABLE challenge_participants (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id       UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    team_id      UUID REFERENCES challenge_teams(id) ON DELETE SET NULL,
    score        NUMERIC(14,2) NOT NULL DEFAULT 0,
    rank         INT,           -- updated by scoring edge function
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT challenge_participants_unique UNIQUE (challenge_id, profile_id)
);

CREATE INDEX idx_challenge_participants_challenge ON challenge_participants(challenge_id, score DESC);
CREATE INDEX idx_challenge_participants_profile   ON challenge_participants(profile_id);

-- challenge_score_events: individual scoring events (audit trail + basis for re-scoring).
CREATE TABLE challenge_score_events (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id       UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    score_delta  NUMERIC(14,2) NOT NULL,
    source_type  TEXT NOT NULL,  -- 'session', 'checkin', 'pr'
    source_id    UUID,           -- ID of the triggering record
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_score_events_challenge ON challenge_score_events(challenge_id, occurred_at DESC);
CREATE INDEX idx_score_events_profile   ON challenge_score_events(profile_id, challenge_id);

-- ============================================================
-- SECTION 15: LEADERBOARDS
-- ============================================================

-- leaderboard_snapshots: materialized cache refreshed nightly by cron.
-- Avoids expensive aggregation on every leaderboard page load.
CREATE TABLE leaderboard_snapshots (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    metric      leaderboard_metric NOT NULL,
    period      leaderboard_period NOT NULL,
    period_key  TEXT NOT NULL,     -- e.g. '2025-W03', '2025-03', 'all_time'
    profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    score       NUMERIC(14,2) NOT NULL,
    rank        INT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leaderboard_gym     ON leaderboard_snapshots(gym_id, metric, period, period_key, rank);
CREATE INDEX idx_leaderboard_profile ON leaderboard_snapshots(profile_id, metric, period);

-- gym_leaderboard_config: what the TV display shows.
CREATE TABLE gym_leaderboard_config (
    gym_id        UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
    metric        leaderboard_metric NOT NULL DEFAULT 'volume',
    period        leaderboard_period NOT NULL DEFAULT 'weekly',
    display_count INT NOT NULL DEFAULT 10,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SECTION 16: ACHIEVEMENTS
-- ============================================================

-- achievement_definitions: the catalog of possible achievements.
-- is_global = TRUE → same across all gyms. gym_id SET → gym-specific badge.
CREATE TABLE achievement_definitions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id          UUID REFERENCES gyms(id) ON DELETE CASCADE,  -- NULL = global
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    icon            TEXT NOT NULL,      -- emoji or asset key
    category        achievement_category NOT NULL,
    criteria        JSONB NOT NULL DEFAULT '{}',  -- machine-readable unlock condition
    is_global       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_achievement_defs_gym ON achievement_definitions(gym_id);

-- user_achievements: awarded achievement instances.
CREATE TABLE user_achievements (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    achievement_id        UUID NOT NULL REFERENCES achievement_definitions(id) ON DELETE CASCADE,
    unlocked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_session_id     UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
    source_challenge_id   UUID REFERENCES challenges(id) ON DELETE SET NULL,

    CONSTRAINT user_achievements_unique UNIQUE (profile_id, achievement_id)
);

CREATE INDEX idx_user_achievements_profile ON user_achievements(profile_id, unlocked_at DESC);
CREATE INDEX idx_user_achievements_gym     ON user_achievements(gym_id, achievement_id);

-- ============================================================
-- SECTION 17: ANNOUNCEMENTS
-- ============================================================

-- announcements: gym admin broadcasts to all members.
CREATE TABLE announcements (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gym_id       UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    message      TEXT NOT NULL,
    type         announcement_type NOT NULL DEFAULT 'news',
    published_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_announcements_gym ON announcements(gym_id, published_at DESC);

-- ============================================================
-- SECTION 18: CHURN PREDICTION
-- ============================================================

-- churn_risk_scores: one row per member, refreshed nightly by edge function.
CREATE TABLE churn_risk_scores (
    profile_id                UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                    UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    risk_score                NUMERIC(4,3) NOT NULL DEFAULT 0,  -- 0.000–1.000
    is_flagged                BOOLEAN NOT NULL DEFAULT FALSE,
    days_since_last_session   INT,
    days_since_last_checkin   INT,
    sessions_last_30_days     INT,
    streak_broken_at          DATE,
    followup_sent_at          TIMESTAMPTZ,
    followup_outcome          TEXT,   -- 'resumed' | 'churned' | null
    computed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_churn_risk_gym      ON churn_risk_scores(gym_id, risk_score DESC) WHERE is_flagged = TRUE;
CREATE INDEX idx_churn_risk_profile  ON churn_risk_scores(profile_id);

-- ============================================================
-- SECTION 19: NOTIFICATIONS
-- ============================================================

-- notifications: per-user notification inbox.
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    type        notification_type NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    data        JSONB DEFAULT '{}',   -- deep link params, related IDs, etc.
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_profile ON notifications(profile_id, created_at DESC);
CREATE INDEX idx_notifications_unread  ON notifications(profile_id) WHERE read_at IS NULL;

-- ============================================================
-- SECTION 20: USEFUL VIEWS
-- ============================================================

-- v_member_summary: denormalized card for admin dashboard member list.
CREATE VIEW v_member_summary AS
SELECT
    p.id,
    p.gym_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.role,
    p.last_active_at,
    p.is_onboarded,
    sc.current_streak_days,
    sc.longest_streak_days,
    crs.risk_score    AS churn_risk_score,
    crs.is_flagged    AS is_churn_flagged,
    (SELECT COUNT(*) FROM workout_sessions ws
     WHERE ws.profile_id = p.id AND ws.status = 'completed') AS total_workouts
FROM profiles p
LEFT JOIN streak_cache sc      ON sc.profile_id = p.id
LEFT JOIN churn_risk_scores crs ON crs.profile_id = p.id;

-- v_active_members_this_month: admin dashboard KPI.
CREATE VIEW v_active_members_this_month AS
SELECT
    gym_id,
    COUNT(DISTINCT profile_id) AS active_member_count,
    DATE_TRUNC('month', NOW()) AS period_start
FROM workout_sessions
WHERE status = 'completed'
  AND started_at >= DATE_TRUNC('month', NOW())
GROUP BY gym_id;

-- v_gym_feed: activity feed with like/comment counts.
CREATE VIEW v_gym_feed AS
SELECT
    f.*,
    p.username        AS actor_username,
    p.avatar_url      AS actor_avatar_url,
    (SELECT COUNT(*) FROM feed_likes fl WHERE fl.feed_item_id = f.id)                          AS like_count,
    (SELECT COUNT(*) FROM feed_comments fc WHERE fc.feed_item_id = f.id AND NOT fc.is_deleted) AS comment_count
FROM activity_feed_items f
JOIN profiles p ON p.id = f.actor_id;

-- ============================================================
-- SECTION 21: ROW-LEVEL SECURITY
-- ============================================================
-- Enable RLS on every table. Policies enforce the 4-tier access model:
--   member   → own rows + friends' public rows + global exercises
--   trainer  → own rows + assigned client rows
--   admin    → all rows within their gym_id
--   super_admin → all rows across all gyms

ALTER TABLE gyms                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_branding             ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_onboarding        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_targets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_checkins       ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises                ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_substitutions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_exercises        ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_weeks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_week_days        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_enrolled_programs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_exercises        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_sets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE overload_suggestions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_history               ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_weight_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_measurements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_photos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins                ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_cache             ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships              ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feed_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges               ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_score_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_leaderboard_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_definitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE churn_risk_scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;

-- NOTE: Detailed RLS policies should be added after auth helper functions
-- (auth.current_gym_id(), auth.current_user_role()) are created.
-- These functions read from the JWT claims set during sign-in.

-- ============================================================
-- EDGE FUNCTIONS NEEDED (not SQL — documented here for reference)
-- ============================================================
-- compute-overload    → runs after workout_sessions completed → updates overload_suggestions
-- detect-pr           → runs after session_sets insert → updates personal_records, pr_history, activity_feed_items
-- update-streak       → runs after workout_sessions or check_ins → updates streak_cache
-- score-challenge     → runs after sessions/checkins/prs → updates challenge_participants.score
-- refresh-leaderboards → nightly cron → refreshes leaderboard_snapshots
-- compute-churn       → nightly cron → refreshes churn_risk_scores
-- award-achievements  → runs after key events → inserts user_achievements, notifications
-- send-notifications  → runs after notifications insert → pushes via Expo/FCM/APNs

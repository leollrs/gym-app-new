-- ============================================================
-- Push notification device tokens
-- Stores FCM/APNs tokens per device so the backend can send
-- native push notifications to gym members.
-- ============================================================

CREATE TABLE push_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT push_tokens_unique UNIQUE (profile_id, token)
);

CREATE INDEX idx_push_tokens_profile ON push_tokens(profile_id);
CREATE INDEX idx_push_tokens_gym     ON push_tokens(gym_id);

-- RLS ─────────────────────────────────────────────────────────
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Members can insert/update/delete their own tokens
CREATE POLICY push_tokens_own_insert ON push_tokens
    FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY push_tokens_own_update ON push_tokens
    FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY push_tokens_own_delete ON push_tokens
    FOR DELETE USING (auth.uid() = profile_id);

-- Service role (edge functions) can read all tokens for a gym
-- (no SELECT policy for members — they don't need to read tokens)
CREATE POLICY push_tokens_service_select ON push_tokens
    FOR SELECT USING (
        auth.uid() = profile_id
        OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'trainer')
    );

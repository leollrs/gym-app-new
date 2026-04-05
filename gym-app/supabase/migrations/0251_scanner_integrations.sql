-- ============================================================
-- 0251 — Physical scanner integration framework
--        Per-gym external system config, retry queue, audit log
-- ============================================================

-- ── 1. gym_integrations ─────────────────────────────────
-- Stores the external software integration config per gym.
-- provider: 'webhook' (generic), 'mindbody', 'clubready', 'abc_fitness', 'none'
CREATE TABLE IF NOT EXISTS gym_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'none',
  config          JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT false,
  actions_enabled TEXT[] NOT NULL DEFAULT ARRAY['checkin','purchase','reward','referral','voucher'],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gym_id, provider)
);

ALTER TABLE gym_integrations ENABLE ROW LEVEL SECURITY;

-- Admins can manage their gym's integrations
CREATE POLICY "admin_manage_integrations" ON gym_integrations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.gym_id = gym_integrations.gym_id
        AND profiles.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.gym_id = gym_integrations.gym_id
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- ── 2. integration_queue ────────────────────────────────
-- Retry queue for failed external system writes.
CREATE TABLE IF NOT EXISTS integration_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  integration_id  UUID NOT NULL REFERENCES gym_integrations(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 5,
  last_error      TEXT,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_integration_queue_pending
  ON integration_queue(gym_id, status, next_retry_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE integration_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_view_queue" ON integration_queue
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.gym_id = integration_queue.gym_id
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- ── 3. integration_log ──────────────────────────────────
-- Audit trail for all integration calls (success + failure).
CREATE TABLE IF NOT EXISTS integration_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL,
  integration_id  UUID NOT NULL,
  action          TEXT NOT NULL,
  payload         JSONB,
  response_status INT,
  response_body   TEXT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_log_gym
  ON integration_log(gym_id, created_at DESC);

ALTER TABLE integration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_view_log" ON integration_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.gym_id = integration_log.gym_id
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

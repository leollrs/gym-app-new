-- 0491_tv_code_bruteforce_hardening.sql
--
-- The public TV display (/tv) is code-gated: tv_authenticate(code) resolves a
-- 6-char code → gym, and returns that gym's leaderboards (member full names +
-- volume/PR/check-in stats for leaderboard_visible members). Two problems:
--
--   1. NO rate limiting on tv_authenticate — an anon caller could brute-force
--      codes in a tight loop at network speed.
--   2. The code space is GLOBAL+UNIQUE across all gyms, so an attacker isn't
--      guessing one gym's code — ANY hit on ANY gym's code wins, and the odds
--      improve as the platform adds gyms ("collision" attack). 6 chars over a
--      30-char alphabet = ~7.3e8 combos; with rate-limiting absent and the
--      collision effect, that's not enough.
--
-- Blast radius is read-only PII (names + gym attendance patterns), not writes,
-- and code rotation is a kill switch — but a name/attendance leak is still a
-- real confidentiality problem. Two-part fix:
--
--   A. IP rate-limit tv_authenticate. The caller IP is read server-side from
--      the x-forwarded-for request header (same pattern as 0142) — NOT a
--      client-supplied param, so it can't be trivially spoofed by varying a
--      body field. Only FAILED attempts count, so a gym entering its correct
--      code — even many TVs behind one NAT IP — is NEVER locked out; only
--      wrong-code hammering is. 15 failures / 15 min / IP → 'rate_limited'.
--   B. New codes are 8 chars (30^8 ≈ 6.6e11, ~900x bigger). Only affects
--      newly minted/rotated codes; existing 6-char codes keep working until an
--      admin rotates (the frontend accepts 6 OR 8). To upgrade a gym now, just
--      rotate its code in /admin/tv-setup.
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor. Reproduces tv_authenticate from
--    0427 verbatim with only the rate-limit guard added at the top + failure
--    recording on the invalid-code path.

-- ── A1. Attempt-tracking table (IP only; no PII) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.tv_auth_attempts (
  id           BIGSERIAL PRIMARY KEY,
  ip_address   TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tv_auth_attempts_ip_time
  ON public.tv_auth_attempts (ip_address, attempted_at DESC);

ALTER TABLE public.tv_auth_attempts ENABLE ROW LEVEL SECURITY;
-- No policies — only the SECURITY DEFINER tv_authenticate touches this table.

-- ── A2. tv_authenticate v3 — adds IP rate limiting ──────────────────────────
-- Body is 0427's verbatim, plus: (1) a failure-count gate at the top, and
-- (2) recording a failure row when the code is invalid.
CREATE OR REPLACE FUNCTION public.tv_authenticate(
  p_code       TEXT,
  p_session_id TEXT,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings   RECORD;
  v_gym        RECORD;
  v_accent     TEXT;
  v_primary    TEXT;
  v_logo_url   TEXT;
  v_ip         TEXT;
  v_fail_count INT;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_required');
  END IF;
  IF p_session_id IS NULL OR length(trim(p_session_id)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_id_required');
  END IF;

  -- ── Rate-limit gate (per IP, failed attempts only) ──
  -- Read the caller IP server-side from the x-forwarded-for request header.
  -- This is set by PostgREST/Supabase from the real connection, NOT from the
  -- RPC body, so the client can't override it by varying a param.
  --
  -- ⚠️ The codebase uses TWO different GUC spellings for request headers:
  --   - request.headers (plural) → a JSON blob: ...::json ->> 'header-name'
  --     (canonical PostgREST form; used in 0149)
  --   - request.header.<name> (singular) → the bare value (used in 0142)
  -- Rather than bet on one and risk the gate silently NO-OPing (a fail-OPEN if
  -- the read returns NULL), try the canonical JSON form first, then fall back
  -- to the singular form. Take the first hop (real client), cap length.
  v_ip := nullif(left(trim(split_part(
    coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      current_setting('request.header.x-forwarded-for', true),
      ''
    ), ',', 1)), 45), '');
  IF v_ip IS NOT NULL THEN
    SELECT COUNT(*) INTO v_fail_count
    FROM tv_auth_attempts
    WHERE ip_address = v_ip
      AND attempted_at > now() - interval '15 minutes';
    IF v_fail_count >= 15 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
    END IF;
    -- Opportunistic bloat control: ~1% of calls prune rows older than a day.
    IF random() < 0.01 THEN
      DELETE FROM tv_auth_attempts WHERE attempted_at < now() - interval '1 day';
    END IF;
  END IF;

  SELECT * INTO v_settings FROM gym_tv_settings
  WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    -- Record the failure for the rate-limiter. A correct code never lands here,
    -- so legitimate operators never accrue toward the limit.
    IF v_ip IS NOT NULL THEN
      INSERT INTO tv_auth_attempts (ip_address) VALUES (v_ip);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  SELECT id, name, slug, is_active, timezone INTO v_gym
  FROM gyms WHERE id = v_settings.gym_id;
  IF NOT v_gym.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'gym_inactive');
  END IF;

  SELECT accent_color, primary_color, logo_url
    INTO v_accent, v_primary, v_logo_url
  FROM gym_branding WHERE gym_id = v_gym.id;

  INSERT INTO gym_tv_sessions (gym_id, session_id, user_agent)
  VALUES (v_gym.id, p_session_id, p_user_agent)
  ON CONFLICT (gym_id, session_id) DO UPDATE
    SET last_heartbeat_at = now(),
        user_agent = COALESCE(EXCLUDED.user_agent, gym_tv_sessions.user_agent);

  RETURN jsonb_build_object(
    'success',       true,
    'gym_id',        v_gym.id,
    'gym_name',      v_gym.name,
    'gym_slug',      v_gym.slug,
    'gym_timezone',  v_gym.timezone,
    'accent_color',  v_accent,
    'primary_color', v_primary,
    'logo_url',      v_logo_url,
    'tv_style',      v_settings.tv_style
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO anon;

-- ── B. Widen newly generated codes to 8 chars ───────────────────────────────
-- Same unambiguous alphabet as 0423; only the length changes. Existing stored
-- 6-char codes are untouched and keep working; rotating mints an 8-char one.
CREATE OR REPLACE FUNCTION public.generate_tv_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars  TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i      INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';

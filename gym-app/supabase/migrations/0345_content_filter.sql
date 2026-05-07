-- ============================================================
-- 0345 — Pre-publication content filter (App Store 1.2(a) / Google Play UGC)
-- ============================================================
-- Apple Guideline 1.2(a) and Google Play UGC policy require that we filter
-- objectionable user-generated content BEFORE it is published. This migration
-- adds a server-side wordlist (`moderation_terms`), a checker function, two
-- BEFORE-INSERT triggers (one each for activity_feed_items and feed_comments),
-- and a SECURITY DEFINER RPC for client-side DM pre-flight checks (since DMs
-- are encrypted at rest and cannot be scanned by the database).
--
-- Strategy:
--   - severity = 1 → soft flag: row goes through, an auto-report is filed in
--                    `content_reports` with reason = 'auto_flagged'. Admins
--                    see the row in the moderation queue with a badge.
--   - severity = 2 → hard block: insert is rejected via RAISE EXCEPTION.
--
-- Conservative wordlist — slurs, hate speech, threats. Vulgar profanity
-- ("fuck", "shit", etc.) is NOT included; Apple does not consider general
-- profanity "objectionable" — only hate speech, threats, and slurs.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) Wordlist table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.moderation_terms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  term        TEXT NOT NULL UNIQUE,
  severity    INT  NOT NULL DEFAULT 1 CHECK (severity IN (1, 2)),
  language    TEXT NOT NULL DEFAULT 'en',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_terms_severity
  ON public.moderation_terms(severity);

ALTER TABLE public.moderation_terms ENABLE ROW LEVEL SECURITY;

-- Authenticated clients may READ the list (used by client-side mirror for
-- fast UX). Only service_role may mutate.
DROP POLICY IF EXISTS "moderation_terms_select_authenticated" ON public.moderation_terms;
CREATE POLICY "moderation_terms_select_authenticated"
  ON public.moderation_terms
  FOR SELECT
  TO authenticated
  USING (true);

-- ────────────────────────────────────────────────────────────
-- 2) Seed list — conservative, focused on hate speech / slurs
--    Mix of English + Spanish. ~35 terms.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.moderation_terms (term, severity, language) VALUES
  -- English racial / ethnic slurs (severity 2 = hard block)
  ('nigger',       2, 'en'),
  ('nigga',        2, 'en'),
  ('chink',        2, 'en'),
  ('gook',         2, 'en'),
  ('spic',         2, 'en'),
  ('wetback',      2, 'en'),
  ('kike',         2, 'en'),
  ('beaner',       2, 'en'),
  ('coon',         2, 'en'),
  ('jigaboo',      2, 'en'),
  ('towelhead',    2, 'en'),
  ('raghead',      2, 'en'),
  -- English homophobic / transphobic slurs
  ('faggot',       2, 'en'),
  ('fag',          2, 'en'),
  ('dyke',         2, 'en'),
  ('tranny',       2, 'en'),
  ('shemale',      2, 'en'),
  -- Hate-group references / threats
  ('heil hitler',  2, 'en'),
  ('white power',  2, 'en'),
  ('kill yourself',2, 'en'),
  ('kys',          1, 'en'),
  ('lynch',        1, 'en'),
  -- Ableist slurs (soft flag — context dependent)
  ('retard',       1, 'en'),
  ('retarded',     1, 'en'),
  -- Spanish slurs / hate speech
  ('maricón',      2, 'es'),
  ('maricon',      2, 'es'),
  -- 'marica' and 'joto' are dialect/colloquial in some Spanish-speaking
  -- regions (used as filler in PR/MX gym banter, similar to "dude/bro").
  -- Severity 1 = soft-flag for admin review; the harder slurs (`maricón`,
  -- `negrata`) above remain severity 2.
  ('marica',       1, 'es'),
  ('joto',         1, 'es'),
  ('puto',         1, 'es'),
  ('negrata',      2, 'es'),
  ('sudaca',       2, 'es'),
  ('panchito',     2, 'es'),
  ('moro',         1, 'es'),
  ('retrasado',    1, 'es'),
  ('mongólico',    1, 'es'),
  ('mongolico',    1, 'es')
ON CONFLICT (term) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3) Checker function
--    Returns matched terms + the highest severity hit.
--    Word-boundary tokenization via regex; multi-word terms matched as substring.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_content_for_moderation(p_text TEXT)
RETURNS TABLE (matched_terms TEXT[], severity INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lower   TEXT;
  v_matched TEXT[] := ARRAY[]::TEXT[];
  v_max     INT    := 0;
  r         RECORD;
BEGIN
  IF p_text IS NULL OR length(p_text) = 0 THEN
    matched_terms := ARRAY[]::TEXT[];
    severity      := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  v_lower := lower(p_text);

  FOR r IN SELECT t.term, t.severity FROM public.moderation_terms t LOOP
    -- Multi-word terms: substring match. Single-word terms: word-boundary match.
    IF position(' ' IN r.term) > 0 THEN
      IF v_lower LIKE '%' || r.term || '%' THEN
        v_matched := array_append(v_matched, r.term);
        IF r.severity > v_max THEN v_max := r.severity; END IF;
      END IF;
    ELSE
      IF v_lower ~ ('(^|[^a-záéíóúñ])' || r.term || '([^a-záéíóúñ]|$)') THEN
        v_matched := array_append(v_matched, r.term);
        IF r.severity > v_max THEN v_max := r.severity; END IF;
      END IF;
    END IF;
  END LOOP;

  matched_terms := v_matched;
  severity      := v_max;
  RETURN NEXT;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4) Public RPC for DM pre-flight check (called by client BEFORE encrypt)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.moderation_check_dm(p_plaintext TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched TEXT[];
  v_sev     INT;
BEGIN
  SELECT matched_terms, severity
    INTO v_matched, v_sev
    FROM public.check_content_for_moderation(p_plaintext);

  RETURN jsonb_build_object(
    'allowed', (v_sev < 2),
    'severity', v_sev,
    'matched', COALESCE(to_jsonb(v_matched), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.moderation_check_dm(TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 5) content_reports prep — allow auto_flagged + nullable reporter_id
-- ────────────────────────────────────────────────────────────

-- 5a) reporter_id was NOT NULL in the original schema (0038). System-generated
--     auto-reports have no human reporter, so relax the constraint.
ALTER TABLE public.content_reports
  ALTER COLUMN reporter_id DROP NOT NULL;

-- 5b) Extend the reason CHECK constraint to allow 'auto_flagged'.
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reason_check;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reason_check
  CHECK (reason IN (
    'spam',
    'inappropriate',
    'harassment',
    'hate_speech',
    'nudity',
    'violence',
    'dangerous',
    'other',
    'auto_flagged'
  ));

-- ────────────────────────────────────────────────────────────
-- 6) auto_flagged columns on the two UGC tables
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.activity_feed_items
  ADD COLUMN IF NOT EXISTS auto_flagged BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.feed_comments
  ADD COLUMN IF NOT EXISTS auto_flagged BOOLEAN NOT NULL DEFAULT FALSE;

-- ────────────────────────────────────────────────────────────
-- 7) Trigger function — applies to both activity_feed_items and feed_comments
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_moderate_feed_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text     TEXT;
  v_matched  TEXT[];
  v_sev      INT;
  v_ct       TEXT;
  v_gym_id   UUID;
  v_content  UUID;
  v_details  TEXT;
BEGIN
  -- Resolve the text to scan + the canonical fields used by content_reports.
  IF TG_TABLE_NAME = 'activity_feed_items' THEN
    -- Posts: text lives in `body`. Auto-feed events (workout_completed, etc.)
    -- have NULL body — skip them.
    IF NEW.body IS NULL OR length(trim(NEW.body)) = 0 THEN
      RETURN NEW;
    END IF;
    v_text   := NEW.body;
    v_ct     := 'activity';
    v_gym_id := NEW.gym_id;
    v_content := NEW.id;
  ELSIF TG_TABLE_NAME = 'feed_comments' THEN
    IF NEW.content IS NULL OR length(trim(NEW.content)) = 0 THEN
      RETURN NEW;
    END IF;
    v_text   := NEW.content;
    v_ct     := 'comment';
    -- feed_comments has no gym_id; resolve via the parent activity_feed_item.
    SELECT gym_id INTO v_gym_id
      FROM public.activity_feed_items
      WHERE id = NEW.feed_item_id;
    v_content := NEW.id;
  ELSE
    RETURN NEW;
  END IF;

  SELECT matched_terms, severity
    INTO v_matched, v_sev
    FROM public.check_content_for_moderation(v_text);

  IF v_sev = 2 THEN
    RAISE EXCEPTION 'Content violates community guidelines'
      USING ERRCODE = 'check_violation';
  ELSIF v_sev = 1 THEN
    NEW.auto_flagged := TRUE;
    v_details := 'Auto-flagged by content filter: ' || array_to_string(v_matched, ', ');
    -- File a system report. reporter_id is NULL (system-generated).
    BEGIN
      INSERT INTO public.content_reports (
        reporter_id,
        feed_item_id,
        content_type,
        content_id,
        reason,
        details,
        gym_id,
        status
      ) VALUES (
        NULL,
        CASE WHEN v_ct = 'activity' THEN v_content ELSE NULL END,
        v_ct,
        v_content,
        'auto_flagged',
        v_details,
        v_gym_id,
        'pending'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Don't block the user's post if the report insert fails (e.g. the
      -- unique-per-user index conflicts on a re-edit). Silent fail is
      -- acceptable here — the auto_flagged column is still set.
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 8) Triggers (BEFORE INSERT)
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_moderate_activity_feed_items ON public.activity_feed_items;
CREATE TRIGGER trg_moderate_activity_feed_items
  BEFORE INSERT ON public.activity_feed_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_moderate_feed_content();

DROP TRIGGER IF EXISTS trg_moderate_feed_comments ON public.feed_comments;
CREATE TRIGGER trg_moderate_feed_comments
  BEFORE INSERT ON public.feed_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_moderate_feed_content();

NOTIFY pgrst, 'reload schema';

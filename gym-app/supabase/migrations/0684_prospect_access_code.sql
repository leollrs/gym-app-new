-- =============================================================
-- 0684 — prospects: an access code that both verifies and identifies
-- =============================================================
--
-- WHY
--
-- A walk-in can write any phone number on the pad and nobody finds out until
-- the follow-up silently goes nowhere. The fix isn't a separate verification
-- step — it's to make the FIRST message do the verifying:
--
--   The prospect gets a short access code, sent to the number they gave.
--   If it arrives, the number is real. If it doesn't, they're unreachable and
--   the gym stops spending follow-up on them.
--
-- And then the code keeps earning:
--
--   • They come back for a second free class → the desk enters the code and
--     the visit is recorded. A prospect who has come three times and still
--     hasn't joined is the hottest lead the gym has, and today nothing
--     anywhere captures that.
--   • They convert → the same code becomes their invite code, so the string
--     they've been carrying since day one is the one they sign up with.
--
-- ALSO HERE: contact collision detection. Typing a number that already belongs
-- to a member means this isn't a prospect at all, and typing one that belongs
-- to an existing prospect means they've been here before — which is the return
-- visit, found without the code. Both were silently creating duplicate rows.
--
-- Idempotent. Additive only — no policy DDL, nothing live takes an exclusive
-- lock beyond the brief ALTER TABLE.
-- =============================================================

-- ── 1. Columns ───────────────────────────────────────────────
ALTER TABLE public.gym_prospects
  ADD COLUMN IF NOT EXISTS access_code   TEXT,
  ADD COLUMN IF NOT EXISTS code_sent_at  TIMESTAMPTZ,
  -- How the code actually went out. 'whatsapp' is the day-one channel (a
  -- deep link the desk taps — no backend, no SMS spend); 'sms' once the
  -- send-sms edge function is deployed with prospect support.
  ADD COLUMN IF NOT EXISTS code_channel  TEXT
    CHECK (code_channel IS NULL OR code_channel IN ('whatsapp','sms','manual')),
  -- A prospect exists because they walked in, so the first visit is already
  -- on the clock — default 1, not 0.
  ADD COLUMN IF NOT EXISTS visit_count   INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ,
  -- Set when a send fails. The follow-up tiers in the client skip these so the
  -- desk isn't told to chase a number that doesn't ring.
  ADD COLUMN IF NOT EXISTS unreachable_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unreachable_reason TEXT;

UPDATE public.gym_prospects SET last_visit_at = visited_at WHERE last_visit_at IS NULL;

-- Per-gym rather than global: every lookup below is already scoped to the
-- caller's gym, so two gyms may hold the same 6 characters without ambiguity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_prospects_code
  ON public.gym_prospects (gym_id, access_code)
  WHERE access_code IS NOT NULL;

-- ── 2. Code generator ────────────────────────────────────────
-- Same charset as the invite codes (no I/O/0/1) because this gets read off a
-- phone screen and dictated across a counter.
CREATE OR REPLACE FUNCTION public.generate_prospect_code(p_gym_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  TEXT;
  v_try   INT := 0;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM gym_prospects WHERE gym_id = p_gym_id AND access_code = v_code
    );
    v_try := v_try + 1;
    IF v_try > 20 THEN RAISE EXCEPTION 'Could not allocate a prospect code'; END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_prospect_code(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_prospect_code(UUID) TO authenticated;

-- Assign on insert. A trigger rather than a column DEFAULT because the code has
-- to be unique *within the row's own gym*, which a DEFAULT expression can't see.
CREATE OR REPLACE FUNCTION public.gym_prospects_assign_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.access_code IS NULL THEN
    NEW.access_code := public.generate_prospect_code(NEW.gym_id);
  END IF;
  IF NEW.last_visit_at IS NULL THEN
    NEW.last_visit_at := COALESCE(NEW.visited_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_prospects_assign_code ON public.gym_prospects;
CREATE TRIGGER trg_gym_prospects_assign_code
  BEFORE INSERT ON public.gym_prospects
  FOR EACH ROW EXECUTE FUNCTION public.gym_prospects_assign_code();

-- Backfill anything created between 0681 and now.
UPDATE public.gym_prospects
   SET access_code = public.generate_prospect_code(gym_id)
 WHERE access_code IS NULL;

-- ── 3. Find a returning prospect by their code ───────────────
CREATE OR REPLACE FUNCTION public.lookup_prospect_by_code(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_extra user_role[];
  v_gym   UUID;
  v_row   gym_prospects%ROWTYPE;
BEGIN
  SELECT role::text, additional_roles, gym_id INTO v_role, v_extra, v_gym
    FROM profiles WHERE id = auth.uid();

  IF NOT (v_role IN ('admin','super_admin','trainer')
          OR 'admin'::user_role       = ANY(COALESCE(v_extra, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}'))
          OR 'trainer'::user_role     = ANY(COALESCE(v_extra, '{}'))) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_row FROM gym_prospects
   WHERE gym_id = v_gym AND upper(access_code) = upper(trim(p_code));

  IF v_row.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'success', true, 'id', v_row.id, 'full_name', v_row.full_name,
    'status', v_row.status, 'visit_count', v_row.visit_count,
    'last_visit_at', v_row.last_visit_at, 'phone', v_row.phone
  );
END;
$$;

-- ── 4. Record a return visit ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_prospect_visit(p_prospect_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_extra user_role[];
  v_gym   UUID;
  v_row   gym_prospects%ROWTYPE;
BEGIN
  SELECT role::text, additional_roles, gym_id INTO v_role, v_extra, v_gym
    FROM profiles WHERE id = auth.uid();

  IF NOT (v_role IN ('admin','super_admin','trainer')
          OR 'admin'::user_role       = ANY(COALESCE(v_extra, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}'))
          OR 'trainer'::user_role     = ANY(COALESCE(v_extra, '{}'))) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_row FROM gym_prospects WHERE id = p_prospect_id;
  IF v_row.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'NOT_FOUND'); END IF;
  IF v_row.gym_id IS DISTINCT FROM v_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  -- Guard against the same walk-in being scanned twice at the counter. Six
  -- hours, not 24: a genuine second visit the same evening is possible, a
  -- double-tap thirty seconds later is not.
  IF v_row.last_visit_at IS NOT NULL AND v_row.last_visit_at > NOW() - INTERVAL '6 hours' THEN
    RETURN json_build_object(
      'success', true, 'duplicate', true,
      'visit_count', v_row.visit_count, 'full_name', v_row.full_name
    );
  END IF;

  UPDATE gym_prospects
     SET visit_count   = visit_count + 1,
         last_visit_at = NOW(),
         -- Coming back in person is the strongest possible proof the contact
         -- details reached a real human. Clear any unreachable flag.
         unreachable_at = NULL,
         unreachable_reason = NULL,
         -- A returning prospect is by definition still open.
         status = CASE WHEN status = 'lost' THEN 'contacted' ELSE status END
   WHERE id = p_prospect_id
   RETURNING * INTO v_row;

  BEGIN
    PERFORM public.log_admin_action(
      'prospect_visit', 'prospect', p_prospect_id,
      jsonb_build_object('visit_count', v_row.visit_count), v_row.gym_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN json_build_object(
    'success', true, 'duplicate', false,
    'visit_count', v_row.visit_count, 'full_name', v_row.full_name
  );
END;
$$;

-- ── 5. Contact collision check ───────────────────────────────
-- Typed at the desk BEFORE saving. Two different answers, both useful:
--   member_match   → this isn't a prospect, they already joined
--   prospect_match → they've been here before; this is a return visit
--
-- SECURITY DEFINER because it reads profiles.phone_number across the gym, which
-- the caller can already see through the members roster — no new exposure, but
-- it must stay hard-scoped to the caller's own gym.
CREATE OR REPLACE FUNCTION public.check_prospect_contact(
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_exclude_prospect UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role   TEXT;
  v_extra  user_role[];
  v_gym    UUID;
  v_digits TEXT;
  v_email  TEXT := lower(nullif(trim(COALESCE(p_email, '')), ''));
  v_member RECORD;
  v_prosp  RECORD;
BEGIN
  SELECT role::text, additional_roles, gym_id INTO v_role, v_extra, v_gym
    FROM profiles WHERE id = auth.uid();

  IF NOT (v_role IN ('admin','super_admin','trainer')
          OR 'admin'::user_role       = ANY(COALESCE(v_extra, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}'))
          OR 'trainer'::user_role     = ANY(COALESCE(v_extra, '{}'))) THEN
    RETURN json_build_object('error', 'FORBIDDEN');
  END IF;
  IF v_gym IS NULL THEN RETURN json_build_object('member', NULL, 'prospect', NULL); END IF;

  -- Compare on digits only: the desk types "(787) 414-4239" and the member row
  -- holds "+17874144239". Last 10 digits is the stable common denominator.
  v_digits := NULLIF(right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10), '');

  IF v_digits IS NOT NULL THEN
    SELECT p.id, p.full_name INTO v_member
      FROM profiles p
     WHERE p.gym_id = v_gym AND p.role = 'member'
       AND right(regexp_replace(COALESCE(p.phone_number, ''), '\D', '', 'g'), 10) = v_digits
     LIMIT 1;
  END IF;

  -- Deliberately no email→member match: `profiles` has no email column (it
  -- lives on auth.users), and admin-created members hold a placeholder
  -- `invite-<uuid>@invite.tugympr.invalid` there anyway, so an email lookup
  -- would miss exactly the members most likely to be duplicated. Phone is the
  -- reliable key for members; email still matches prospect-to-prospect below.

  IF v_digits IS NOT NULL OR v_email IS NOT NULL THEN
    SELECT gp.id, gp.full_name, gp.access_code, gp.visit_count, gp.status
      INTO v_prosp
      FROM gym_prospects gp
     WHERE gp.gym_id = v_gym
       AND (p_exclude_prospect IS NULL OR gp.id <> p_exclude_prospect)
       AND (
         (v_digits IS NOT NULL
           AND right(regexp_replace(COALESCE(gp.phone, ''), '\D', '', 'g'), 10) = v_digits)
         OR (v_email IS NOT NULL AND lower(gp.email) = v_email)
       )
     ORDER BY gp.visited_at DESC
     LIMIT 1;
  END IF;

  RETURN json_build_object(
    'member', CASE WHEN v_member.id IS NULL THEN NULL
                   ELSE json_build_object('id', v_member.id, 'full_name', v_member.full_name) END,
    'prospect', CASE WHEN v_prosp.id IS NULL THEN NULL
                     ELSE json_build_object('id', v_prosp.id, 'full_name', v_prosp.full_name,
                                            'access_code', v_prosp.access_code,
                                            'visit_count', v_prosp.visit_count,
                                            'status', v_prosp.status) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_prospect_by_code(TEXT)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_prospect_visit(UUID)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_prospect_contact(TEXT, TEXT, UUID)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lookup_prospect_by_code(TEXT)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_prospect_visit(UUID)                FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_prospect_contact(TEXT, TEXT, UUID)   FROM anon;
GRANT  EXECUTE ON FUNCTION public.lookup_prospect_by_code(TEXT)              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.record_prospect_visit(UUID)                TO authenticated;
GRANT  EXECUTE ON FUNCTION public.check_prospect_contact(TEXT, TEXT, UUID)   TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verify:
--   SELECT access_code, visit_count, last_visit_at FROM gym_prospects;
--   SELECT lookup_prospect_by_code('ABC234');
--   SELECT record_prospect_visit('<id>');     -- again within 6h → duplicate:true
--   SELECT check_prospect_contact('787-414-4239', NULL, NULL);
-- =============================================================

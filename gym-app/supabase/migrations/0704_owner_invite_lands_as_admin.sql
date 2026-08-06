-- ============================================================
-- 0704 — El dueño de un gimnasio entra como ADMIN, no como miembro
-- ============================================================
-- TRES SÍNTOMAS, UNA CAUSA
--
-- Al dar de alta un gimnasio, el dueño recibía una invitación creada así
-- (`platform_create_gym`, 0542:134):
--
--   VALUES (..., 'Owner', 'member', ...)
--
-- Con lo cual el dueño:
--   1. se comía los TRECE pasos del onboarding de miembro — nivel de forma,
--      objetivo, equipo disponible, lesiones, métricas corporales, programa y
--      nutrición: datos para el generador de entrenamiento de alguien que no va
--      a registrar una sola serie;
--   2. veía la casilla de código de referido, que solo existe en ese flujo; y
--   3. se encontraba el nombre autorrellenado como «Owner», porque eso es
--      literalmente lo que iba en `member_name`.
--
-- No son tres fallos. Es que el dueño se creaba como MIEMBRO y entraba por la
-- puerta de los miembros.
--
-- POR QUÉ NO BASTABA CON CAMBIAR EL 'member' POR 'admin'
--
-- Había TRES cerrojos, y saltarse uno solo habría dado un cambio que parece
-- aplicado y no hace nada:
--
--   a) `gym_invites.role` lleva CHECK (role IN ('member','trainer')) desde la
--      0022 — el INSERT ni siquiera pasaría.
--   b) `claim_imported_invite` (0551:347) copia el rol tras una lista blanca
--      que también es member/trainer: cualquier otra cosa cae a 'member' EN
--      SILENCIO, sin error.
--   c) `platform_create_gym` escribe 'member' a pelo.
--
-- LO QUE SE ABRE, Y LO QUE SIGUE CERRADO
--
-- La lista blanca de 0198/0551 existe para que un código de invitación que
-- acabe en el buzón equivocado no pueda fabricar un administrador. Eso NO se
-- toca. Lo que se añade es una condición más estrecha:
--
--   'admin' se concede SOLO si quien creó la invitación es super_admin.
--
-- O sea, solo el flujo de «crear gimnasio» de la plataforma. Un admin de
-- gimnasio sigue sin poder invitar a otro admin —su CreateInviteModal no puede
-- ni escribir ese rol, porque el CHECK nuevo lo sigue impidiendo para todos
-- salvo... nada: el CHECK admite el valor, pero la RPC exige el super_admin, y
-- la RLS de INSERT decide quién puede escribir la fila. Tres capas, y la
-- concesión necesita las tres.
--
-- El caso peligroso —código robado del buzón del dueño— tampoco escala: quien
-- lo use se lleva el admin de ESE gimnasio, que es exactamente lo que ya pasaba
-- cuando el founder promovía a mano tras el claim. La ventana no se ensancha;
-- se ahorra el paso manual.
-- ============================================================

-- ── 1. La tabla admite el rol ───────────────────────────────
--
-- El CHECK va por nombre buscado, no adivinado: en 0022 se declaró en línea, así
-- que Postgres le puso un nombre generado y escribirlo a mano aquí sería una
-- apuesta. Si la búsqueda no encuentra nada, se avisa en vez de seguir como si
-- tal cosa — un DROP que no encuentra su objetivo es cómo una migración termina
-- «bien» sin haber hecho nada (nos pasó con la 0697).
DO $role_check$
DECLARE
  v_name TEXT;
BEGIN
  SELECT con.conname INTO v_name
    FROM pg_constraint con
   WHERE con.conrelid = 'public.gym_invites'::regclass
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%role%member%trainer%';

  IF v_name IS NULL THEN
    RAISE NOTICE '[0704] No se encontró el CHECK member/trainer de gym_invites.role. ¿Ya se relajó? Comprueba a mano antes de dar esto por bueno.';
  ELSE
    EXECUTE format('ALTER TABLE public.gym_invites DROP CONSTRAINT %I', v_name);
    RAISE NOTICE '[0704] CHECK "%" retirado.', v_name;
  END IF;

  ALTER TABLE public.gym_invites
    ADD CONSTRAINT gym_invites_role_ck CHECK (role IN ('member', 'trainer', 'admin'));
END $role_check$;

COMMENT ON COLUMN public.gym_invites.role IS
  'member | trainer | admin. Que la tabla admita "admin" NO significa que se '
  'conceda: claim_imported_invite solo lo copia si created_by es super_admin. '
  'La columna es lo que se puede pedir; la RPC es lo que se concede.';

-- ── 2. El claim concede admin, y solo en un caso ────────────
CREATE OR REPLACE FUNCTION public.invite_grants_admin(p_invite_role TEXT, p_created_by UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Una función y no un CASE embebido: así la regla vive en UN sitio y se puede
  -- probar sola con un SELECT. Repetirla dentro del UPDATE es cómo acaban
  -- divergiendo la rama del shell y la del claim normal.
  SELECT p_invite_role = 'admin'
     AND p_created_by IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = p_created_by
          AND (p.role = 'super_admin'::user_role
               OR 'super_admin'::user_role = ANY(p.additional_roles))
     );
$$;

REVOKE ALL ON FUNCTION public.invite_grants_admin(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_grants_admin(TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.invite_grants_admin(TEXT, UUID) IS
  'TRUE solo si la invitación pide admin Y la creó un super_admin. Es el único '
  'hueco por el que se concede admin al reclamar; todo lo demás sigue cayendo a '
  'member como desde 0198.';

NOTIFY pgrst, 'reload schema';

-- ── 3. El claim usa ese hueco ───────────────────────────────
--
-- La función se reproduce ENTERA (es lo que exige CREATE OR REPLACE), extraída
-- de la 0551 y parcheada en una sola sentencia — verificado por diff, no a ojo.
-- Copiar 150 líneas a mano es como se pierde en silencio una comprobación de
-- expiración o el claim atómico.
--
-- La rama del "shell" NO concede admin y así se queda: esa vía es para fusionar
-- fichas importadas de MIEMBROS, y una invitación de dueño nunca pasa por ahí
-- (no lleva teléfono, que es lo que engancha el shell).
CREATE OR REPLACE FUNCTION public.claim_imported_invite(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean         TEXT;
  v_uid           UUID := auth.uid();
  v_invite        RECORD;
  v_shell         RECORD;
  v_shell_found   BOOLEAN := false;
  v_already_real  BOOLEAN;
  v_claimed       INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  v_clean := upper(regexp_replace(p_code, '[\s\-]', '', 'g'));

  SELECT * INTO v_invite
  FROM gym_invites
  WHERE upper(invite_code) = v_clean;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code not found');
  END IF;

  -- NEW (0551): the signup UI filters expired codes via
  -- lookup_gym_invite_by_code, but the claim itself never checked.
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code has expired');
  END IF;

  IF v_invite.used_by IS NOT NULL THEN
    -- A placeholder-email shadow (admin/import pre-create) does NOT count
    -- as a real claim — only a real account at used_by does.
    SELECT EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = v_invite.used_by
        AND email NOT LIKE '%@%.invalid'
    ) INTO v_already_real;

    IF v_already_real THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
    END IF;
  END IF;

  -- NEW (0551): claim FIRST, atomically. Two concurrent claimers both
  -- snapshot the same used_by; only one passes this guarded update.
  UPDATE gym_invites
  SET used_by = v_uid, used_at = now()
  WHERE id = v_invite.id
    AND used_by IS NOT DISTINCT FROM v_invite.used_by;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
  END IF;

  -- Shell discovery — from the SNAPSHOT (v_invite.used_by still holds
  -- the shadow pointer; the row itself now points at the claimer).
  IF v_invite.used_by IS NOT NULL THEN
    SELECT * INTO v_shell FROM profiles WHERE id = v_invite.used_by;
    v_shell_found := FOUND;
  END IF;

  -- Bulk-import path leaves used_by NULL: find the shell by phone_number.
  IF NOT v_shell_found THEN
    SELECT * INTO v_shell
    FROM profiles
    WHERE gym_id = v_invite.gym_id
      AND role = 'member'
      AND import_batch_id IS NOT NULL
      AND imported_archived = false
      AND id <> v_uid
      AND v_invite.phone IS NOT NULL
      AND phone_number = v_invite.phone
    ORDER BY created_at ASC
    LIMIT 1;
    v_shell_found := FOUND;
  END IF;

  IF v_shell_found THEN
    -- Re-home the shell's onboarding seed (incl. age/sex/height_inches,
    -- which live on member_onboarding — NOT profiles) to the real user
    -- BEFORE the shell + its cascade is removed. The member's own
    -- onboarding, if already present, wins (DO NOTHING).
    INSERT INTO member_onboarding (
      profile_id, gym_id, fitness_level, primary_goal,
      training_days_per_week, initial_weight_lbs, initial_body_fat_pct,
      available_equipment, injuries_notes, excluded_exercise_ids,
      age, sex, height_inches
    )
    SELECT v_uid, gym_id, fitness_level, primary_goal,
           training_days_per_week, initial_weight_lbs, initial_body_fat_pct,
           available_equipment, injuries_notes, excluded_exercise_ids,
           age, sex, height_inches
    FROM member_onboarding WHERE profile_id = v_shell.id
    ON CONFLICT (profile_id) DO NOTHING;

    -- Merge shell → auth profile. Only real profiles columns here.
    UPDATE profiles AS auth_p
    SET
      gym_id                   = v_shell.gym_id,
      full_name                = COALESCE(NULLIF(auth_p.full_name, ''), v_shell.full_name),
      phone_number             = COALESCE(NULLIF(auth_p.phone_number, ''), v_shell.phone_number),
      role                     = 'member',
      membership_status        = 'active',
      membership_started_at    = COALESCE(auth_p.membership_started_at, v_shell.membership_started_at),
      date_of_birth            = COALESCE(auth_p.date_of_birth,         v_shell.date_of_birth),
      qr_external_id           = COALESCE(auth_p.qr_external_id,        v_shell.qr_external_id),
      admin_note               = COALESCE(auth_p.admin_note,            v_shell.admin_note),
      import_batch_id          = COALESCE(v_shell.import_batch_id,      auth_p.import_batch_id)
    WHERE auth_p.id = v_uid;

    -- Remove the shell + its shadow auth user (CASCADE wipes the shell
    -- profile). Best-effort: some deployments restrict auth.users deletes.
    BEGIN
      DELETE FROM auth.users WHERE id = v_shell.id;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        DELETE FROM profiles WHERE id = v_shell.id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  ELSE
    -- No shell — standard claim. NEW (0551): whitelist the role copy.
    -- The 0022 CHECK already caps invites at member/trainer; this makes
    -- the cap local so a future CHECK relaxation can't escalate here.
    UPDATE profiles
    SET gym_id            = v_invite.gym_id,
        full_name         = COALESCE(NULLIF(full_name, ''), v_invite.member_name),
        phone_number      = COALESCE(NULLIF(phone_number, ''), v_invite.phone),
        -- 0704: un hueco MÁS ESTRECHO, no la lista blanca abierta. 'admin' solo
        -- si la invitación la creó un super_admin (invite_grants_admin). Todo
        -- lo demás sigue cayendo a 'member' exactamente como desde 0198.
        role              = (CASE
                               WHEN public.invite_grants_admin(v_invite.role, v_invite.created_by) THEN 'admin'
                               WHEN v_invite.role IN ('member', 'trainer') THEN v_invite.role
                               ELSE 'member'
                             END)::user_role,
        membership_status = 'active'
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'gym_id',       v_invite.gym_id,
    'role',         v_invite.role,
    'member_name',  v_invite.member_name,
    'merged_shell', v_shell_found
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_imported_invite(TEXT) TO authenticated;

-- ── 4. El alta de gimnasio pide el rol correcto ─────────────
--
-- Igual: extraída de la 0542 y parcheada en UNA línea (verificado por diff).
-- Cambian dos cosas en esa línea:
--   'Owner' → NULL      el nombre deja de autorrellenarse. `member_name` es
--                       para importaciones donde SE SABE el nombre; aquí no se
--                       sabe, y poner un cargo en el hueco del nombre hacía que
--                       el dueño se llamara «Owner» hasta que lo corrigiera.
--   'member' → 'admin'  lo que el hueco de arriba concede.
CREATE OR REPLACE FUNCTION public.platform_create_gym(
  p_name        text,
  p_slug        text,
  p_owner_email text DEFAULT NULL,
  p_plan_type   text DEFAULT 'starter'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name       text;
  v_slug       text;
  v_plan       text;
  v_email      text;
  v_gym_id     uuid;
  v_code       text;
  v_invite_id  uuid;
  v_attempts   int := 0;
  v_defaults   jsonb := '{}'::jsonb;
  v_raw        jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  v_name := NULLIF(trim(p_name), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Gym name is required';
  END IF;

  -- Normalize slug (derive from name when blank): lowercase, hyphens only.
  v_slug := lower(COALESCE(NULLIF(trim(p_slug), ''), v_name));
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
  IF v_slug = '' THEN
    RAISE EXCEPTION 'Could not derive a valid slug from "%"', p_name;
  END IF;
  IF EXISTS (SELECT 1 FROM gyms WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Slug "%" is already taken', v_slug;
  END IF;

  -- Canonical tier set (0043 + lifetime/enterprise badges used by the UI).
  v_plan := lower(COALESCE(NULLIF(trim(p_plan_type), ''), 'starter'));
  IF v_plan NOT IN ('free', 'starter', 'pro', 'lifetime', 'enterprise') THEN
    v_plan := 'starter';
  END IF;

  v_email := lower(NULLIF(trim(p_owner_email), ''));
  IF v_email IS NOT NULL AND v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Invalid owner email "%"', v_email;
  END IF;

  -- Consult platform_config gym_defaults (tolerates both jsonb-object and
  -- json-encoded-string storage; PlatformSettings writes the latter).
  SELECT value INTO v_raw FROM platform_config WHERE key = 'gym_defaults';
  IF v_raw IS NOT NULL THEN
    BEGIN
      IF jsonb_typeof(v_raw) = 'string' THEN
        v_defaults := (v_raw #>> '{}')::jsonb;
      ELSIF jsonb_typeof(v_raw) = 'object' THEN
        v_defaults := v_raw;
      END IF;
    EXCEPTION WHEN others THEN
      v_defaults := '{}'::jsonb;  -- malformed config must not block creation
    END;
  END IF;

  -- Create the gym. plan_type canonical, subscription_tier mirrored (0043).
  -- timezone/country honoured from gym_defaults when present (gyms has no
  -- language/calories/days columns — those defaults are returned to the
  -- caller instead of being dropped on the floor).
  INSERT INTO gyms (name, slug, plan_type, subscription_tier, is_active, timezone, country)
  VALUES (
    v_name,
    v_slug,
    v_plan,
    v_plan,
    TRUE,
    COALESCE(NULLIF(trim(v_defaults->>'timezone'), ''), 'UTC'),
    NULLIF(trim(v_defaults->>'country'), '')
  )
  RETURNING id INTO v_gym_id;

  -- Owner invite (optional). Same shape admin_create_invite_code (0305)
  -- produces: human invite_code + auto token, 30-day expiry, role 'member'
  -- (claim flow forces member anyway per 0198; founder promotes after claim).
  IF v_email IS NOT NULL THEN
    LOOP
      v_code := public.generate_invite_code();
      v_attempts := v_attempts + 1;
      BEGIN
        INSERT INTO gym_invites (gym_id, created_by, email, invite_code, member_name, role, expires_at)
        VALUES (v_gym_id, auth.uid(), v_email, v_code, NULL, 'admin', now() + interval '30 days')
        RETURNING id INTO v_invite_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempts >= 10 THEN
          RAISE EXCEPTION 'Failed to generate a unique invite code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'gym_id',      v_gym_id,
    'slug',        v_slug,
    'plan_type',   v_plan,
    'invite_code', v_code,          -- null when no owner email given
    'invite_id',   v_invite_id,
    'defaults',    v_defaults       -- echo so the caller knows what applied
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificar:
--
--   -- 1. La regla, aislada:
--   SELECT invite_grants_admin('admin',   '<super_admin>');  -- true
--   SELECT invite_grants_admin('admin',   '<admin normal>'); -- false  ← el que importa
--   SELECT invite_grants_admin('trainer', '<super_admin>');  -- false
--
--   -- 2. La tabla admite el valor:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'gym_invites_role_ck';
--
--   -- 3. De punta a punta: crea un gimnasio con correo de dueño y mira la fila.
--   SELECT role, member_name FROM gym_invites ORDER BY created_at DESC LIMIT 1;
--   -- → admin, NULL   (antes: member, 'Owner')
--
--   -- 4. Y tras reclamarlo, el perfil:
--   SELECT role FROM profiles WHERE id = '<el que reclamó>';   -- admin
-- ============================================================

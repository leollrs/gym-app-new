-- =============================================================
-- 0689 — Pérdida de datos, RPC que revientan, y aislamiento
-- =============================================================
--
-- Tanda 2+3 de la auditoría del 08-03. Siete arreglos:
--
--   1. admin_attribute_referral revienta con un 500 opaco y REVIERTE la
--      atribución siempre que las dos personas ya tengan una amistad
--      pendiente — o sea, exactamente la población de "un socio trajo a su
--      pana", que es el caso de uso entero.
--   2. platform_swag_stock() revienta con "column reference item_id is
--      ambiguous" en cada llamada. La página de inventario nunca cargó.
--   3. Volver a suscribirse borraba supresiones de REBOTE y de QUEJA, no solo
--      la de baja voluntaria.
--   4. Los entrenadores pueden llamar los tres RPC de prospectos pero no
--      pueden leer la tabla — ven la lista vacía en el mostrador.
--   5. sms_log.member_id es NOT NULL, así que CADA SMS a un prospecto falla
--      al registrarse. El mensaje sale, Twilio cobra, y no queda rastro.
--   6. Las tarjetas de los miembros importados-archivados vuelven a encolarse
--      cada noche — el síntoma que 0680 vino a matar.
--   7. "Desmarcar contactado" borra el historial de contacto COMPLETO del
--      miembro. Hace falta un RPC que borre solo la última entrada, porque
--      PostgREST no sabe hacer DELETE ... ORDER BY ... LIMIT 1.
-- =============================================================

-- ── 1. admin_attribute_referral — la amistad ya no puede tumbar la
--       atribución, y respeta la lista de bloqueos ──
--
-- trg_guard_friendship_accept (0028:58) es BEFORE UPDATE sobre friendships y
-- exige auth.uid() = OLD.addressee_id. Nunca se dropeó en 688 migraciones. Los
-- triggers NO los salta SECURITY DEFINER y auth.uid() sigue siendo el admin,
-- que no es ninguna de las dos partes — así que tanto el ON CONFLICT DO UPDATE
-- como el UPDATE inverso lo pisan. Caían FUERA del bloque EXCEPTION (que solo
-- envolvía el INSERT a referrals), así que abortaban la transacción entera y la
-- fila de referrals se revertía.
--
-- Además: escribir friendships desde un DEFINER salta la policy que aplica el
-- bloqueo (0342:69), así que un admin podía re-enlazar a dos personas que se
-- habían bloqueado. Se añade el guard explícito en las dos direcciones.
--
-- Reconstruida entera desde la definición de 0681: solo cambia el bloque final.

CREATE OR REPLACE FUNCTION public.admin_attribute_referral(
  p_referred_id UUID,
  p_referrer_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_admin     BOOLEAN;
  v_referred_gym UUID;
  v_referrer_gym UUID;
  v_referrer_nm  TEXT;
  v_code_id      UUID;
  v_referral_id  UUID;
  v_existing_ref UUID;
  v_existing_by  UUID;
  v_existing_nm  TEXT;
BEGIN
  -- ── Authz — copied from admin_create_member (0467:67-83). Honours
  -- additional_roles; `is_admin()` and safe_complete_referral's raw
  -- profiles.role read both miss multi-role admins.
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_super := COALESCE(v_caller_role = 'super_admin', FALSE)
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'));
  v_is_admin := COALESCE(v_caller_role = 'admin', FALSE)
                 OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  -- `v_caller_gym IS NULL` cierra el fallo-abierto: sin fila en profiles (JWT
  -- válido a mitad de alta, o perfil borrado antes que el usuario de auth),
  -- v_caller_role queda NULL, la comparación da NULL, `NOT NULL` da NULL, y
  -- plpgsql trata un IF NULL como falso — así que la rama FORBIDDEN se
  -- SALTABA. Lógica de tres valores: el COALESCE de arriba y este guard.
  IF v_caller_gym IS NULL OR NOT (v_is_admin OR v_is_super) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_referred_id IS NULL OR p_referrer_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'MISSING_ARGS');
  END IF;

  IF p_referred_id = p_referrer_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_REFERRAL');
  END IF;

  SELECT gym_id INTO v_referred_gym FROM profiles WHERE id = p_referred_id;
  SELECT gym_id, full_name INTO v_referrer_gym, v_referrer_nm
    FROM profiles WHERE id = p_referrer_id;

  IF v_referred_gym IS NULL OR v_referrer_gym IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NO_GYM');
  END IF;

  IF v_referred_gym IS DISTINCT FROM v_referrer_gym THEN
    RETURN json_build_object('success', false, 'error', 'CROSS_GYM');
  END IF;

  -- A non-super admin can only act inside their own gym.
  IF NOT v_is_super AND v_referred_gym IS DISTINCT FROM v_caller_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  -- UNIQUE(referred_id, gym_id) makes attribution permanent and there is no
  -- re-attribution path. Surface the collision by NAME instead of swallowing
  -- it the way register_referral's ON CONFLICT DO NOTHING does — the front
  -- desk needs to learn "already credited to someone else", not get a
  -- success toast that did nothing.
  SELECT id, referrer_id INTO v_existing_ref, v_existing_by
    FROM referrals WHERE referred_id = p_referred_id AND gym_id = v_referred_gym;
  IF v_existing_ref IS NOT NULL THEN
    SELECT full_name INTO v_existing_nm FROM profiles WHERE id = v_existing_by;
    RETURN json_build_object(
      'success', false, 'error', 'ALREADY_ATTRIBUTED',
      'referral_id', v_existing_ref,
      'referrer_name', COALESCE(v_existing_nm, 'Member')
    );
  END IF;

  -- The referrer's own code, when they have one. Nullable: a member who has
  -- never opened the Referrals page has no code row yet, and that must not
  -- block a walk-in attribution.
  SELECT id INTO v_code_id
    FROM referral_codes
    WHERE profile_id = p_referrer_id AND gym_id = v_referred_gym
    LIMIT 1;

  BEGIN
    INSERT INTO referrals (referrer_id, referred_id, gym_id, referral_code_id, status)
    VALUES (p_referrer_id, p_referred_id, v_referred_gym, v_code_id, 'pending')
    RETURNING id INTO v_referral_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Raced with another admin between the SELECT above and here.
      RETURN json_build_object('success', false, 'error', 'ALREADY_ATTRIBUTED');
    WHEN OTHERS THEN
      -- trg_referral_rate_limit (0117:243) RAISEs rather than returning:
      -- >3 rows for the same referred_id in 24h, or referrer not in gym_id.
      -- Without this it surfaces as an opaque 500 in the admin UI.
      RETURN json_build_object('success', false, 'error', 'REJECTED', 'detail', SQLERRM);
  END;

  -- ── La amistad es un extra; la atribución es el producto ──
  --
  -- Bloque propio con su propio EXCEPTION: trg_guard_friendship_accept RAISEa
  -- cuando el que actualiza no es el destinatario, y el admin nunca lo es. Sin
  -- este BEGIN, ese RAISE abortaba la transacción y se llevaba por delante la
  -- fila de referrals que acabamos de escribir.
  --
  -- Y solo si nadie bloqueó a nadie: escribir friendships desde un DEFINER
  -- salta la policy de 0342:69, que es donde vive el bloqueo. Sin este guard un
  -- admin puede reabrir DM y feed entre dos personas que se bloquearon.
  BEGIN
    IF NOT public.is_blocked(p_referrer_id, p_referred_id)
       AND NOT public.is_blocked(p_referred_id, p_referrer_id) THEN

      INSERT INTO friendships (gym_id, requester_id, addressee_id, status)
      VALUES (v_referred_gym, p_referrer_id, p_referred_id, 'accepted')
      ON CONFLICT (requester_id, addressee_id) DO UPDATE
        SET status = 'accepted', updated_at = NOW();

      UPDATE friendships
      SET status = 'accepted', updated_at = NOW()
      WHERE requester_id = p_referred_id
        AND addressee_id = p_referrer_id
        AND status <> 'accepted';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'admin_attribute_referral: friendship link skipped for % → %: %',
      p_referrer_id, p_referred_id, SQLERRM;
  END;

  RETURN json_build_object(
    'success', true,
    'referral_id', v_referral_id,
    'referrer_id', p_referrer_id,
    'referrer_name', COALESCE(v_referrer_nm, 'Member'),
    'status', 'pending'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_attribute_referral(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_attribute_referral(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_attribute_referral(UUID, UUID) TO authenticated;

-- ── 2. platform_swag_stock — item_id ambiguo ──
--
-- item_id es parámetro OUT del RETURNS TABLE y por tanto variable plpgsql en
-- ámbito; el item_id sin calificar del subquery resuelve por los dos lados y
-- con plpgsql.variable_conflict = error (el default) es error duro. Misma clase
-- exacta que 0438:9-14, donde platform_gym_attention y platform_gym_stats
-- fallaron igual. Aquí se califica en vez de usar #variable_conflict, que es
-- más explícito sobre qué se quiso decir.

CREATE OR REPLACE FUNCTION public.platform_swag_stock()
RETURNS TABLE (
  item_id UUID, name TEXT, name_es TEXT, emoji TEXT,
  unit_cost_cents INT, is_active BOOLEAN,
  purchased INT, shipped_out INT, on_hand INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  SELECT
    i.id, i.name, i.name_es, i.emoji, i.unit_cost_cents, i.is_active,
    COALESCE(pur.qty, 0)::INT  AS purchased,
    COALESCE(shp.qty, 0)::INT  AS shipped_out,
    (COALESCE(pur.qty, 0) - COALESCE(shp.qty, 0))::INT AS on_hand
  FROM swag_items i
  LEFT JOIN (
    SELECT sp.item_id AS pur_item, SUM(sp.qty)::INT AS qty
    FROM swag_purchases sp GROUP BY sp.item_id
  ) pur ON pur.pur_item = i.id
  LEFT JOIN (
    SELECT bi.item_id AS shp_item, SUM(bi.qty)::INT AS qty
    FROM swag_box_items bi
    JOIN swag_boxes b ON b.id = bi.box_id
    WHERE b.status = 'shipped'
    GROUP BY bi.item_id
  ) shp ON shp.shp_item = i.id
  ORDER BY i.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_swag_stock() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_swag_stock() FROM anon;
GRANT  EXECUTE ON FUNCTION public.platform_swag_stock() TO authenticated;

-- ── 3. Resuscribirse ya no borra rebotes ni quejas ──
--
-- El DELETE era incondicional. Una dirección marcada `bounced` volvía a la
-- lista de envío y rebotaba otra vez; una `complained` se borraba del todo.
-- Sobre un remitente compartido por toda la plataforma, eso es exactamente el
-- riesgo de entregabilidad que 0685 existe para evitar.
--
-- Reconstruida desde la definición de 0685; solo cambia el DELETE.

CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(
  p_token UUID,
  p_scope TEXT DEFAULT 'all',
  p_on    BOOLEAN DEFAULT FALSE
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_p     RECORD;
  v_email TEXT;
BEGIN
  IF p_token IS NULL THEN RETURN json_build_object('success', false, 'error', 'NOT_FOUND'); END IF;
  IF p_scope NOT IN ('all','lifecycle','classes','winback') THEN
    RETURN json_build_object('success', false, 'error', 'BAD_SCOPE');
  END IF;

  SELECT id, gym_id INTO v_p FROM profiles WHERE email_unsub_token = p_token;
  IF v_p.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'NOT_FOUND'); END IF;

  UPDATE profiles SET
    notif_email_enabled   = CASE WHEN p_scope = 'all'       THEN p_on ELSE notif_email_enabled   END,
    notif_email_lifecycle = CASE WHEN p_scope = 'lifecycle' THEN p_on ELSE notif_email_lifecycle END,
    notif_email_classes   = CASE WHEN p_scope = 'classes'   THEN p_on ELSE notif_email_classes   END,
    notif_email_winback   = CASE WHEN p_scope = 'winback'   THEN p_on ELSE notif_email_winback   END
  WHERE id = v_p.id;

  IF p_scope = 'all' THEN
    -- profiles has no email column — the real address is on auth.users, and for
    -- admin-created members it may still be the invite-<uuid>@…invalid shadow,
    -- with the real one in raw_user_meta_data.pending_email (0603).
    SELECT COALESCE(
             NULLIF(u.raw_user_meta_data ->> 'pending_email', ''),
             CASE WHEN u.email LIKE '%@%.invalid' THEN NULL ELSE u.email END
           )
      INTO v_email
      FROM auth.users u WHERE u.id = v_p.id;

    IF p_on THEN
      -- SOLO la baja voluntaria. Un rebote duro o una queja de spam no los
      -- puede levantar el propio destinatario: son señales del proveedor, no
      -- preferencias del miembro.
      DELETE FROM email_suppressions
       WHERE lower(email) = lower(v_email) AND reason = 'unsubscribed';
    ELSIF v_email IS NOT NULL THEN
      INSERT INTO email_suppressions (email, gym_id, profile_id, reason)
      VALUES (lower(v_email), v_p.gym_id, v_p.id, 'unsubscribed')
      ON CONFLICT (lower(email)) DO NOTHING;
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'scope', p_scope, 'subscribed', p_on);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID, TEXT, BOOLEAN) TO anon;
GRANT  EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID, TEXT, BOOLEAN) TO service_role;

-- ── 4. Los entrenadores atienden el mostrador ──
--
-- Los tres RPC de 0684 (lookup_prospect_by_code, record_prospect_visit,
-- check_prospect_contact) admiten `trainer` explícitamente, y 0683:167 lo dice:
-- "Trainers included: they run the desk too". Pero la única policy de 0681:135
-- exige is_admin(), que solo matchea admin/super_admin. El entrenador ve la
-- lista vacía y no puede ver la fila que record_prospect_visit acaba de tocar.

-- FOR SELECT, no FOR ALL. La justificación de esta policy es de LECTURA — que
-- el entrenador no vea la lista vacía en el mostrador. Con FOR ALL, y dado que
-- 0681:145 ya concede DELETE a `authenticated`, cualquier entrenador podía
-- BORRAR fichas de prospectos: las mismas que llevan consent_contact_at, que
-- 0690 existe para preservar como prueba de consentimiento, y cuya retención
-- gobierna purge_stale_prospects. Escribir sigue siendo cosa de los RPC.
DROP POLICY IF EXISTS "gym_prospects_trainer_all" ON public.gym_prospects;
DROP POLICY IF EXISTS "gym_prospects_trainer_read" ON public.gym_prospects;
CREATE POLICY "gym_prospects_trainer_read"
  ON public.gym_prospects FOR SELECT TO authenticated
  USING (
    gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'trainer'
             OR 'trainer'::user_role = ANY(COALESCE(p.additional_roles, '{}')))
    )
  );

-- ── 5. sms_log admite prospectos ──
--
-- member_id es NOT NULL REFERENCES profiles(id) (0257:62) y un prospecto no
-- tiene fila en profiles. send-sms escribía member_id: null confiando en que la
-- columna era nullable — el razonamiento del FK era correcto, el de nulabilidad
-- no. Cada SMS a un prospecto fallaba con 23502, y como un insert de Supabase
-- resuelve en vez de lanzar, el try/catch no lo veía: el mensaje salía, Twilio
-- cobraba, y no quedaba fila. phone_number tiene el mismo problema.

ALTER TABLE public.sms_log
  ALTER COLUMN member_id    DROP NOT NULL,
  ALTER COLUMN phone_number DROP NOT NULL;

ALTER TABLE public.sms_log
  ADD COLUMN IF NOT EXISTS prospect_id UUID
    REFERENCES public.gym_prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_log_prospect
  ON public.sms_log (prospect_id) WHERE prospect_id IS NOT NULL;

-- Un log sin destinatario no sirve para nada.
ALTER TABLE public.sms_log DROP CONSTRAINT IF EXISTS sms_log_has_recipient;
ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_has_recipient
  CHECK (member_id IS NOT NULL OR prospect_id IS NOT NULL);

COMMENT ON COLUMN public.sms_log.prospect_id IS
  'Destinatario cuando el SMS fue a un prospecto (gym_prospects), que no tiene '
  'fila en profiles. Exactamente uno de member_id/prospect_id va lleno.';

-- ── 6. Las tarjetas de los importados-archivados no vuelven ──
--
-- 0680 sacó a imported_archived del CTE active_members, así que ya NUNCA se
-- re-segmentan — se quedan congelados con el `critical` que les escribió la
-- lógica vieja. Pero el paso que inserta tarjetas lee member_outreach_state
-- directo, sin volver a filtrar, y la limpieza puntual de 0680:449-455 les puso
-- next_due_at = NULL, o sea vencidos ya. La corrida de las 09:00 los vuelve a
-- encolar cada noche.
--
-- No hace falta tocar run_retention_orchestrator: como active_members ya no los
-- incluye, borrar sus filas de estado es definitivo. Si algún día se
-- des-archiva a alguien, vuelve a entrar por la puerta normal y se re-segmenta.

DELETE FROM public.owner_queue_items q
WHERE q.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = q.profile_id
      AND (p.imported_archived = TRUE OR p.gym_id IS NULL OR p.role <> 'member')
  );

DELETE FROM public.member_outreach_state ms
WHERE EXISTS (
  SELECT 1 FROM profiles p
  WHERE p.id = ms.profile_id
    AND (p.imported_archived = TRUE OR p.gym_id IS NULL OR p.role <> 'member')
);

-- ── 7. Desmarcar contactado borra UNA entrada, no el historial ──
--
-- AdminChurn.jsx:561, MorningQueuePanel.jsx:424 y AdminTrainers.jsx:421 hacen
-- .delete().eq('member_id',…).eq('gym_id',…) — todas las filas. Y lo dispara un
-- toggle etiquetado solo "Contactado", sin confirmación, en el mismo panel que
-- muestra ese historial (ContactPanel.jsx:691-700). Un toque accidental destruye
-- el registro de gestión completo de esa persona.
--
-- PostgREST no sabe hacer DELETE ... ORDER BY ... LIMIT 1, así que hace falta
-- un RPC.

CREATE OR REPLACE FUNCTION public.admin_unmark_contacted(p_member_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_staff     BOOLEAN;
  v_member_gym   UUID;
  v_deleted      UUID;
BEGIN
  -- Mismo patrón multi-rol que admin_create_member (0467:67-83).
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_staff := COALESCE(v_caller_role IN ('admin','super_admin','trainer'), FALSE)
                 OR 'admin'::user_role       = ANY(COALESCE(v_caller_extra, '{}'))
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'))
                 OR 'trainer'::user_role     = ANY(COALESCE(v_caller_extra, '{}'));

  -- Mismo cierre de tres valores que arriba: sin fila en profiles, v_is_staff
  -- daba NULL y el DELETE se ejecutaba contra cualquier miembro de cualquier
  -- gimnasio, porque la comprobación WRONG_GYM de más abajo también daba NULL.
  IF v_caller_gym IS NULL OR NOT v_is_staff THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT gym_id INTO v_member_gym FROM profiles WHERE id = p_member_id;
  IF v_member_gym IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_caller_role <> 'super_admin'
     AND NOT ('super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')))
     AND v_member_gym IS DISTINCT FROM v_caller_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  -- Solo la más reciente. Deshacer un toque no debe borrar meses de gestión.
  DELETE FROM admin_contact_log
   WHERE id = (
     SELECT id FROM admin_contact_log
      WHERE member_id = p_member_id AND gym_id = v_member_gym
      ORDER BY created_at DESC
      LIMIT 1
   )
  RETURNING id INTO v_deleted;

  RETURN json_build_object('success', true, 'deleted_id', v_deleted);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_unmark_contacted(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_unmark_contacted(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_unmark_contacted(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- 1. El inventario carga (antes: "column reference item_id is ambiguous"):
--   SELECT * FROM platform_swag_stock();
--
--   -- 2. Ya no quedan estados huérfanos de importados-archivados:
--   SELECT COUNT(*) FROM member_outreach_state ms
--     JOIN profiles p ON p.id = ms.profile_id
--    WHERE p.imported_archived;                    -- esperado: 0
--
--   -- 3. sms_log acepta un prospecto:
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name = 'sms_log' AND column_name IN ('member_id','prospect_id');
--
--   -- 4. Desmarcar borra una sola fila: contar antes y después.
--   SELECT COUNT(*) FROM admin_contact_log WHERE member_id = '<uuid>';
--   SELECT admin_unmark_contacted('<uuid>');
--   SELECT COUNT(*) FROM admin_contact_log WHERE member_id = '<uuid>';  -- -1
-- =============================================================

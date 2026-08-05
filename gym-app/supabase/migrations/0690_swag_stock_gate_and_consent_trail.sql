-- =============================================================
-- 0690 — Cierres finales de la auditoría del 08-03
-- =============================================================
--
--   1. El trabajo nocturno de merch encola regalos de stock que el gimnasio
--      nunca recibió. admin_grant_swag SÍ lo comprueba y refusa con
--      NOT_STOCKED, explicando por qué: "sin esto un gimnasio podría repartir
--      stock que nadie le envió y dejar su on_hand en negativo". El trabajo
--      nocturno no lo comprobaba, así que producía exactamente eso — y
--      platform_gym_swag_stock no lo puede delatar, porque su CTE conductor es
--      lo RECIBIDO: un gimnasio sin caja sencillamente no aparece en el informe.
--
--   2. Desmarcar el consentimiento de un prospecto escribía NULL sobre
--      consent_contact_at, destruyendo CUÁNDO aceptó. La cabecera de
--      ProspectModal.jsx lo dice: ese sello "es la única pregunta que importa
--      si alguien pregunta algún día". Revocar es un hecho nuevo, no un
--      borrado del anterior.
--
--   3. Dos barridos nocturnos hacen seq-scan sobre tablas diseñadas para
--      crecer, porque sus índices arrancan por gym_id y ellos no filtran por
--      gimnasio.
-- =============================================================

-- ── 1. El trabajo nocturno respeta el stock enviado ──
--
-- Reconstruido desde 0683. Solo cambia el NOT EXISTS nuevo.

CREATE OR REPLACE FUNCTION public.generate_swag_grants_daily()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INTEGER;
BEGIN
  -- Caducar ANTES de espejar. Liberar el hueco pendiente de (profile_id,
  -- occasion) es lo que permite que un miembro que vuelve a ganar la misma
  -- ocasión la reciba de verdad (0683:83-89).
  --
  -- Esta es la ÚNICA sentencia en todo el árbol que pone un regalo en
  -- 'expired'. La primera versión de esta migración la borró al "reconstruir"
  -- la función desde 0683 — y encima añadió abajo un índice para servir el
  -- barrido que acababa de eliminar. Sin ella, `expires_at` es decorativo y el
  -- guard NOT EXISTS de más abajo bloquea el re-regalo para siempre.
  UPDATE swag_grants
     SET status = 'expired'
   WHERE status = 'pending'
     AND expires_at IS NOT NULL
     AND expires_at <= NOW();

  INSERT INTO swag_grants (
    gym_id, profile_id, item_id, item_name, item_name_es, item_emoji,
    occasion, source_card_id
  )
  SELECT pc.gym_id, pc.profile_id, r.item_id, i.name, i.name_es, i.emoji,
         pc.occasion, pc.id
  FROM print_cards pc
  JOIN gym_swag_rules r
    ON r.gym_id = pc.gym_id AND r.occasion = pc.occasion AND r.is_active
  JOIN swag_items i ON i.id = r.item_id AND i.is_active
  WHERE pc.created_at >= NOW() - INTERVAL '24 hours'
    AND pc.status <> 'dismissed'
    AND NOT EXISTS (
      SELECT 1 FROM swag_grants sg
      WHERE sg.profile_id = pc.profile_id
        AND sg.occasion   = pc.occasion
        AND sg.status     = 'pending'
    )
    -- Mismo guard que admin_grant_swag (0683:216-224): el gimnasio tiene que
    -- haber RECIBIDO ese artículo en una caja enviada. Sin esto, un gimnasio
    -- con una regla activa pero sin caja recibía todas las noches tarjetas de
    -- "entrégale una mochila" que no podía cumplir.
    AND EXISTS (
      SELECT 1 FROM swag_box_items bi
      JOIN swag_boxes b ON b.id = bi.box_id
      WHERE b.gym_id = pc.gym_id AND b.status = 'shipped' AND bi.item_id = r.item_id
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_swag_grants_daily() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_swag_grants_daily() TO service_role;

-- ── 2. Revocar el consentimiento no borra cuándo se dio ──

ALTER TABLE public.gym_prospects
  ADD COLUMN IF NOT EXISTS consent_revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.gym_prospects.consent_revoked_at IS
  'Cuándo el prospecto retiró el consentimiento de contacto. consent_contact_at '
  'se CONSERVA: el consentimiento vigente es (consent_contact_at IS NOT NULL '
  'AND consent_revoked_at IS NULL). Sobrescribir el sello original con NULL '
  'destruía la única prueba de cuándo aceptó.';

-- ── 3. Índices para los barridos nocturnos ──
--
-- purge_stale_prospects (0681:156-158) y el barrido de caducidad de regalos
-- (0683:85-89) filtran por status + fecha SIN gym_id, y los índices existentes
-- arrancan por gym_id — así que ninguno servía y ambos recorrían la tabla
-- entera cada noche.

CREATE INDEX IF NOT EXISTS idx_swag_grants_expiry_sweep
  ON public.swag_grants (status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_gym_prospects_purge_sweep
  ON public.gym_prospects (status, visited_at);

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- 1. Ningún regalo pendiente de un artículo que ese gimnasio no recibió:
--   SELECT g.gym_id, g.item_name, COUNT(*)
--     FROM swag_grants g
--    WHERE g.status = 'pending'
--      AND NOT EXISTS (
--        SELECT 1 FROM swag_box_items bi JOIN swag_boxes b ON b.id = bi.box_id
--         WHERE b.gym_id = g.gym_id AND b.status = 'shipped' AND bi.item_id = g.item_id)
--    GROUP BY 1, 2;
--   -- Las filas que salgan son de ANTES de esta migración: decidir a mano si
--   -- se cancelan o si toca enviar una caja.
--
--   -- 2. Los dos barridos usan índice ahora:
--   EXPLAIN SELECT 1 FROM swag_grants WHERE status = 'pending' AND expires_at < NOW();
-- =============================================================

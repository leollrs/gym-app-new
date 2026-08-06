-- =============================================================
-- 0693_log_admin_action_target_gym_gate.sql
--
-- ESCRITURA ENTRE INQUILINOS EN log_admin_action
--
-- 0543 añadió `p_target_gym_id` para que las acciones de soporte de
-- plataforma sobre OTRO gimnasio se archivaran bajo ese gimnasio y no bajo
-- el del actor. 0556 puso una reja de rol (`is_admin()`), que cerró el
-- agujero de "cualquier miembro escribe en el log". Lo que ninguna de las
-- dos comprobó nunca es el propio `p_target_gym_id`:
--
--   eff_gym := COALESCE(p_target_gym_id, my_gym);
--
-- La función es SECURITY DEFINER, así que ese INSERT no pasa por RLS. El
-- resultado es que el admin del gimnasio A puede, desde la consola del
-- navegador y con una sola llamada, escribir filas de auditoría FALSAS en
-- el `admin_audit_log` del gimnasio B:
--
--   supabase.rpc('log_admin_action', {
--     p_action: 'delete_member', p_entity_type: 'member',
--     p_target_gym_id: '<gym-B>' })
--
-- El admin de B abre su registro de auditoría — la pantalla cuyo propósito
-- entero es ser la versión creíble de lo que pasó — y ve una acción que no
-- ocurrió. `actor_id` sí es honesto (se fuerza a auth.uid()), así que no hay
-- suplantación; pero un `actor_id` de alguien que no es de su gimnasio es
-- justo lo que nadie mira cuando la fila ya "está" en su tabla.
--
-- ARREGLO
--
-- `p_target_gym_id` solo lo puede usar quien es super_admin. Para un admin
-- de gimnasio se IGNORA y se cae a su propio gimnasio, en vez de fallar: la
-- auditoría nunca debe romper la acción que la está registrando (esa regla
-- ya está en los BEGIN…EXCEPTION de abajo y se respeta).
--
-- El único llamador legítimo con gimnasio ajeno es
-- admin_move_member_to_gym (0591), que es una acción de plataforma. Si algún
-- día la ejecuta un admin normal, su fila cae bajo su propio gimnasio — que
-- es estrictamente más seguro y sigue quedando registrada.
--
-- SEGUNDA PARTE: el backfill de 0692
--
-- 0692 rescata propuestas de clase leyendo `admin_audit_log` donde
-- action = 'class_proposal'. Con el agujero de arriba abierto, esas filas no
-- eran de fiar: un admin podía sembrar propuestas en el gimnasio ajeno y el
-- backfill las materializaba como propuestas reales, firmadas por alguien
-- que ni siquiera pertenece a ese gimnasio. Se limpian aquí.
--
-- El orden es siempre 0692 (siembra) → 0693 (limpia), porque las migraciones
-- se aplican en orden numérico. El `to_regclass` de abajo no está para cubrir
-- el caso contrario —que no existe— sino para que esta migración se pueda
-- reaplicar sola contra una base donde 0692 nunca llegó a correr.
-- =============================================================

-- ── 1. La reja ───────────────────────────────────────────────
-- Verbatim de 0556 salvo el bloque `eff_gym`.

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT '{}',
  p_target_gym_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  eff_gym UUID;
BEGIN
  uid := auth.uid();
  -- Role gate (0556): silently no-op for non-admins.
  IF uid IS NULL OR NOT public.is_admin() THEN RETURN; END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  -- Reja del gimnasio destino. Un admin de gimnasio solo archiva bajo SU
  -- gimnasio; pasar otro no es un error, simplemente no se le hace caso.
  -- COALESCE alrededor de is_super_admin() porque un NULL haría que el IF
  -- fuera NULL y plpgsql lo trataría como falso — aquí eso cae del lado
  -- seguro, pero se deja explícito para no depender de ello.
  IF COALESCE(public.is_super_admin(), FALSE) THEN
    eff_gym := COALESCE(p_target_gym_id, my_gym);
  ELSE
    eff_gym := my_gym;
  END IF;

  -- Write to admin_audit_log (gym-scoped, read by gym admins).
  -- gym_id is NOT NULL there, so skip when no gym can be attributed.
  IF eff_gym IS NOT NULL THEN
    BEGIN
      INSERT INTO admin_audit_log (gym_id, actor_id, action, entity_type, entity_id, details)
      VALUES (eff_gym, uid, p_action, p_entity_type, p_entity_id, p_details);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- audit logging must never break the calling action
    END;
  END IF;

  -- Also write to audit_log (platform-scoped, read by super admins).
  -- gym_id is nullable here (0040), so platform-level actions with no
  -- attributable gym are still recorded.
  BEGIN
    INSERT INTO audit_log (gym_id, actor_id, action, target_type, target_id, metadata)
    VALUES (eff_gym, uid, p_action, p_entity_type, p_entity_id, p_details);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, JSONB, UUID) TO authenticated;

-- ── 2. Saneo de las propuestas de clase ──────────────────────
--
-- ESTE BORRADO ESTABA DEMASIADO ABIERTO Y PERDÍA DATOS BUENOS.
--
-- La versión anterior borraba TODA propuesta cuyo entrenador no estuviera hoy
-- en el gimnasio de la propuesta. Pero `admin_move_member_to_gym` (0591:178)
-- reescribe `profiles.gym_id` y NO toca las propuestas, así que cualquier
-- entrenador trasladado alguna vez perdía todas sus propuestas legítimas —
-- borradas sin respaldo y sin forma de recuperarlas.
--
-- Y EL INTENTO DE ACOTARLO TAMPOCO VALÍA. Lo dejo escrito porque es el fallo
-- interesante: añadí `status='pending' AND decided_by IS NULL AND created_at >=
-- 90 días` diciendo que así solo caían las filas sembradas por el backfill de
-- 0692. No es verdad — esos tres predicados los cumple IGUAL cualquier
-- propuesta legítima reciente. 0692 no deja ninguna marca de origen, así que no
-- existe forma de distinguir una fila del backfill de una que escribió
-- `submit_class_proposal`. Un entrenador trasladado en los últimos 90 días con
-- una propuesta pendiente seguía perdiéndola, solo que en una ventana más corta.
--
-- Así que NO SE BORRA NADA. Se listan las candidatas y decide una persona.
-- Borrar filas que no sabes identificar es peor que dejarlas: lo que sobra se
-- puede tirar mañana, lo que se borró de más no vuelve. Y el trabajo de esta
-- migración es la reja de `log_admin_action`; la limpieza era un extra que
-- resulta que no se puede hacer a ciegas.

DO $$
DECLARE
  v_row   RECORD;
  v_count INT := 0;
BEGIN
  IF to_regclass('public.class_proposals') IS NOT NULL THEN
    FOR v_row IN
      SELECT cp.id, cp.trainer_id, cp.gym_id AS proposal_gym, p.gym_id AS trainer_gym, cp.created_at
        FROM public.class_proposals cp
        JOIN public.profiles p ON p.id = cp.trainer_id
       WHERE (p.gym_id IS NULL OR p.gym_id <> cp.gym_id)
         AND cp.status = 'pending'
         AND cp.decided_by IS NULL
       ORDER BY cp.created_at DESC
    LOOP
      v_count := v_count + 1;
      RAISE NOTICE '[0693] propuesta a revisar: id=% entrenador=% gimnasio_propuesta=% gimnasio_entrenador=% creada=%',
        v_row.id, v_row.trainer_id, v_row.proposal_gym, v_row.trainer_gym, v_row.created_at;
    END LOOP;
    IF v_count = 0 THEN
      RAISE NOTICE '[0693] no hay propuestas con el gimnasio descuadrado.';
    ELSE
      RAISE NOTICE '[0693] % propuestas con el gimnasio descuadrado. NO se ha borrado ninguna: revísalas a mano.', v_count;
    END IF;
  END IF;
END $$;

-- Las filas de auditoría FALSAS siguen ahí, y son el daño que esta migración
-- describe: el admin del gimnasio B abre su registro y ve acciones que no
-- ocurrieron. No se borran automáticamente porque un DELETE sobre
-- `admin_audit_log` es exactamente el tipo de barrido que no se puede
-- deshacer, y distinguir "sembrada" de "legítima" a posteriori no es fiable:
-- `actor_id` es honesto en las dos.
--
-- Para revisarlas a mano — el actor no pertenece al gimnasio bajo el que se
-- archivó la acción:
--
--   SELECT a.id, a.gym_id, a.actor_id, a.action, a.created_at
--     FROM admin_audit_log a
--     JOIN profiles p ON p.id = a.actor_id
--    WHERE p.gym_id IS DISTINCT FROM a.gym_id
--    ORDER BY a.created_at DESC;
--
-- Ojo al leerlo: un super_admin actuando sobre otro gimnasio sale también, y
-- eso es legítimo (admin_move_member_to_gym). Filtra por `p.role`.

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- Como admin NO super de un gimnasio, esto debe archivar bajo el PROPIO
--   -- gimnasio, no bajo el que se pide:
--   SELECT public.log_admin_action('test_gate', 'test', NULL, '{}'::jsonb,
--                                  '<uuid-de-otro-gimnasio>');
--   SELECT gym_id FROM admin_audit_log WHERE action = 'test_gate';
--   -- → debe ser el gym_id del actor.
--
--   -- Ninguna propuesta debe quedar con el entrenador fuera de su gimnasio:
--   SELECT COUNT(*) FROM class_proposals cp JOIN profiles p ON p.id = cp.trainer_id
--   WHERE p.gym_id IS DISTINCT FROM cp.gym_id;   -- → 0
-- =============================================================

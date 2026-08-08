-- ============================================================================
-- 0713 — Apuntarse a un reto: solo a los de TU gimnasio, y a un equipo suyo
-- ============================================================================
--
-- EL AGUJERO. `challenge_participants_insert_own` (0002:471) solo comprueba dos
-- cosas: que la fila sea tuya y que el `gym_id` que TÚ escribes sea el tuyo.
--
--     WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id())
--
-- No mira ni el `challenge_id` ni el `team_id`. O sea: se puede uno apuntar a
-- un reto de OTRO gimnasio poniendo el propio `gym_id` en la fila. Con el
-- reparto automático de la 0707 eso deja de ser teórico, y con el enlace de
-- equipo (`?team=<uuid>`, que se manda por WhatsApp) deja de hacer falta ni
-- siquiera un intento deliberado: basta reenviar el enlace a un conocido de
-- otro gimnasio y aparece en su marcador con nombre y foto.
--
-- El tope de plazas del equipo también vivía solo en el navegador, así que un
-- equipo de 2 podía acabar con treinta.
--
-- Nota de operación: el DDL de políticas toma ACCESS EXCLUSIVE sobre la tabla.
-- Va con `lock_timeout` para que, si hay tráfico, falle rápido en vez de dejar
-- la app colgada esperando el lock.
-- ============================================================================

SET lock_timeout = '5s';

DROP POLICY IF EXISTS "challenge_participants_insert_own" ON public.challenge_participants;

CREATE POLICY "challenge_participants_insert_own" ON public.challenge_participants
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
    -- El reto tiene que ser de tu gimnasio. Esto es lo que faltaba.
    AND EXISTS (
      SELECT 1 FROM public.challenges c
      WHERE c.id = challenge_participants.challenge_id
        AND c.gym_id = public.current_gym_id()
    )
    -- Y si vienes con equipo, el equipo tiene que ser DE ESE reto y tener sitio.
    -- El aforo se comprobaba solo en el cliente: con el enlace en circulación,
    -- eso es un tope que no existe.
    AND (
      team_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.challenge_teams t
        JOIN public.challenges c2 ON c2.id = t.challenge_id
        WHERE t.id = challenge_participants.team_id
          AND t.challenge_id = challenge_participants.challenge_id
          AND c2.gym_id = public.current_gym_id()
          AND (
            SELECT COUNT(*) FROM public.challenge_participants m WHERE m.team_id = t.id
          ) < COALESCE(c2.team_size, 2)
      )
    )
  );

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

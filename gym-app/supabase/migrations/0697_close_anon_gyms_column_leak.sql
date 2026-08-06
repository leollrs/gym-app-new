-- ============================================================
-- 0697 — Cerrar la lectura anónima de TODAS las columnas de `gyms`
-- ============================================================
-- CUALQUIERA, SIN CUENTA, PUEDE LEER HOY LO QUE CADA GIMNASIO NOS PAGA.
--
-- La política `gyms_select_anon_active` (0110:48) permite a `anon` leer toda
-- fila de todo gimnasio activo. La RLS de Postgres es por FILA, no por columna,
-- así que "leer la fila" es leer la fila entera:
--
--   monthly_price      (0041)  ← lo que ese gimnasio nos paga al mes
--   plan_type          (0043)  ← su plan
--   subscription_tier  (0001)
--   is_founding                ← si tiene trato de fundador
--   max_admin_seats, multi_admin_enabled, has_number_bundle
--   setup_completed, setup_step, referral_config
--
-- Un `SELECT name, monthly_price FROM gyms` con la clave anónima devuelve la
-- lista de precios de TODA la cartera. Son nuestras condiciones comerciales con
-- cada cliente, y las puede leer el gimnasio de al lado.
--
-- La propia 0110 lo dejó dicho ("This still exposes all columns to anon, which
-- is why we also provide the restricted view… The frontend should be migrated
-- to use gyms_public"), y la 0653:36-39 lo volvió a avisar al añadir una
-- columna. La migración del frontend YA SE HIZO — Signup lee `gyms_public`, las
-- landings usan RPC y `middleware.js` llama a `get_share_preview`. Lo único que
-- quedó vivo fue la política.
--
-- POR QUÉ NO BASTA CON BORRARLA
--
-- `gyms_public` se creó con `security_invoker = on` (0653:121), o sea que corre
-- con los permisos de QUIEN LLAMA — y para `anon` el único permiso que le deja
-- leer `gyms` es justamente esta política. Borrarla sin más deja la vista sin
-- filas y ROMPE EL REGISTRO: el usuario mete el código de su gimnasio y le dice
-- que no existe.
--
-- Así que el orden importa: primero la vista deja de depender de la política,
-- y solo entonces se quita.
-- ============================================================

-- ── 1. La vista deja de depender de la RLS de la tabla ──────
--
-- `ALTER VIEW … SET` y no `CREATE OR REPLACE VIEW`: así no se toca la lista de
-- columnas. Reescribirla entera es cómo se pierde una columna añadida después
-- —`website_url` entró en 0653— si uno reconstruye desde una definición vieja.
--
-- Con `security_invoker = false` la vista corre como su dueño y se salta la RLS
-- de `gyms`. La reja pasa a ser la lista de columnas de la propia vista, que es
-- exactamente lo que 0110 decía que debía ser: "this view is the proper way to
-- restrict which columns anonymous users can access".
ALTER VIEW public.gyms_public SET (security_invoker = false);

-- `security_barrier` se mantiene: impide que el planificador empuje una función
-- del usuario por debajo del filtro `is_active` y lea filas que la vista oculta.
ALTER VIEW public.gyms_public SET (security_barrier = true);

-- ── 2. Fuera la política ────────────────────────────────────
--
-- Comprobado antes de tocarla, no supuesto: no queda ni un consumidor anónimo
-- de la tabla cruda.
--
--   • Signup.jsx        → `gyms_public` (y su propio comentario dice por qué)
--   • ReferralLanding   → rpc get_share_preview
--   • AppDownloadLanding → rpc get_trainer_public_profile
--   • middleware.js     → rpc get_share_preview
--   • Todo lo demás corre con sesión, y para eso está
--     `gyms_select_active_authenticated` (0110:36), que no se toca.
-- DOS COSAS SALIERON MAL AQUÍ, Y LAS DOS MERECEN QUEDAR ESCRITAS.
--
-- 1. Esto era un `DROP POLICY IF EXISTS` a secas. `IF EXISTS` CALLA cuando no
--    encuentra nada, así que la migración terminaba «bien» tanto si borraba la
--    política como si no tocaba absolutamente nada. Se aplicó, no dio error, y
--    la fuga siguió abierta un día entero. Un fallo disfrazado de éxito es peor
--    que un fallo.
--
-- 2. La política que de verdad filtraba NO ESTABA EN NINGUNA MIGRACIÓN. Se
--    llama `anyone can read active gyms` —con espacios— y eso delata su origen:
--    la creó alguien a mano desde el panel de Supabase. Buscar por el nombre
--    que uno escribió en su propio SQL nunca la habría encontrado.
--
-- Y una tentación que hay que resistir: barrer «cualquier política que no
-- mencione auth.uid()». Suena robusto y se lleva por delante
-- `gyms_manage_super_admin`, cuya condición es `current_user_role() =
-- 'super_admin'` — comprueba la sesión, pero DENTRO de una función, así que
-- ningún filtro de texto lo ve. Eso deja al super admin sin acceso a los
-- gimnasios y no se nota hasta que alguien intenta entrar.
--
-- Así que: se quitan por NOMBRE las que sabemos malas, diciendo de cada una si
-- existía o no; y luego se AVISA de cualquier otra que pueda alcanzar a anon,
-- sin tocarla. Actuar sobre lo conocido, delatar lo demás.
DO $anon_policy$
DECLARE
  v_name  TEXT;
  v_pol   RECORD;
  v_gone  INTEGER := 0;
  v_warn  INTEGER := 0;
BEGIN
  SET LOCAL lock_timeout = '5s';

  FOREACH v_name IN ARRAY ARRAY[
    'gyms_select_anon_active',      -- la de 0110:48
    'anyone can read active gyms'   -- la creada a mano en el panel
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = 'public.gyms'::regclass AND polname = v_name
    ) THEN
      EXECUTE format('DROP POLICY %I ON public.gyms', v_name);
      v_gone := v_gone + 1;
      RAISE NOTICE '[0697] QUITADA la política "%".', v_name;
    ELSE
      RAISE NOTICE '[0697] "%" no existía (ya estaba quitada, o nunca estuvo).', v_name;
    END IF;
  END LOOP;

  -- El barrido delator. No borra: enseña.
  FOR v_pol IN
    SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) AS qual
      FROM pg_policy p
     WHERE p.polrelid = 'public.gyms'::regclass
       AND p.polcmd IN ('r', '*')                                    -- SELECT o ALL
       -- polroles vacío = TO PUBLIC, que INCLUYE a anon. Así se creó todo lo
       -- de esta tabla, y es lo que se escapa si uno mira solo roles nombrados.
       AND (p.polroles = '{0}'::oid[] OR 'anon'::regrole::oid = ANY(p.polroles))
       -- Las que piden sesión explícitamente sí quedan descartadas: sin sesión
       -- `auth.uid() IS NOT NULL` es falso. Son gyms_select_own y
       -- gyms_select_active_authenticated, que hacen funcionar la app.
       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%uid() IS NOT NULL%'
  LOOP
    v_warn := v_warn + 1;
    RAISE WARNING '[0697] REVISAR A MANO: la política "%" alcanza a anon y no comprueba la sesión de forma visible. USING (%). Si es de super_admin déjala; si no, quítala.',
      v_pol.polname, v_pol.qual;
  END LOOP;

  RAISE NOTICE '[0697] Quitadas: %. Pendientes de revisar a mano: %.', v_gone, v_warn;
  RAISE NOTICE '[0697] COMPRUEBA AHORA con la clave anónima: gyms?select=name,monthly_price debe salir VACÍO, y gyms_public?select=id,name,slug debe seguir devolviendo gimnasios (si no, el registro está roto).';
END $anon_policy$;

-- ── 3. Dejarlo dicho en el esquema ──────────────────────────
COMMENT ON VIEW public.gyms_public IS
  'La ÚNICA lectura anónima de gyms. Corre como definer a propósito: la reja es '
  'esta lista de columnas, no la RLS. Antes de añadir una columna aquí, mírala '
  'dos veces — lo que entre lo puede leer cualquiera sin cuenta.';

COMMENT ON COLUMN public.gyms.monthly_price IS
  'Lo que el gimnasio nos paga. NUNCA debe salir por una vista o RPC pública.';
COMMENT ON COLUMN public.gyms.plan_type IS
  'Plan comercial del gimnasio con nosotros. NUNCA público.';

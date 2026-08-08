-- =============================================================
-- 0706 — Atar el premio regalado al envío que lo regaló
-- =============================================================
--
-- EL EMBUDO QUE FALTABA
--
-- `win_back_attempts` ya cierra medio embudo solo: la fila nace al enviar y
-- `autoDetectReturns` la marca 'returned' cuando el socio vuelve de verdad
-- (sesión o check-in posterior al envío). Enviados vs Recuperados sale de ahí
-- sin que nadie apunte nada a mano.
--
-- La otra mitad — «de los que recibieron premio, ¿cuántos lo canjearon?» — NO
-- se podía calcular, y no por falta de datos. `admin_gift_reward` crea una
-- `reward_redemptions` en 'pending' y devuelve su id; el escaneo del QR en el
-- gimnasio la pasa a 'claimed' (reward-qr). Las dos puntas existen y son
-- automáticas. Lo que no existía era el hilo entre ellas: WinBackModal
-- calculaba el `redemption_id` y luego guardaba en el intento el NOMBRE del
-- premio como texto (`offer: 'Batido gratis'`).
--
-- Con el nombre no se puede unir. Dos socios con el mismo premio dan dos
-- cadenas idénticas y no hay forma de saber qué canje pertenece a qué envío,
-- así que el canje quedaba fuera del reporte aunque estuviera registrado.
--
-- Esto añade la columna y nada más. `offer` se queda como está: es el texto que
-- se PINTA en el historial, y hay filas viejas que solo tienen eso.
-- =============================================================

ALTER TABLE win_back_attempts
  ADD COLUMN IF NOT EXISTS redemption_id UUID
    REFERENCES reward_redemptions(id) ON DELETE SET NULL;

-- Parcial: la inmensa mayoría de envíos van sin premio y no deben pesar en el
-- índice. Sirve al join «intentos de esta campaña -> ¿canjeados?».
CREATE INDEX IF NOT EXISTS idx_win_back_redemption
  ON win_back_attempts(redemption_id)
  WHERE redemption_id IS NOT NULL;

COMMENT ON COLUMN win_back_attempts.redemption_id IS
  'Canje creado por admin_gift_reward al enviar este win-back. NULL = envío sin premio. Une con reward_redemptions.status para medir canjeados vs regalados.';

-- =============================================================
-- VERIFICACIÓN (correr a mano tras aplicar)
-- =============================================================
--
--   -- 1. La columna existe y apunta a donde debe
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'win_back_attempts' AND column_name = 'redemption_id';
--   -- espera: 1 fila, uuid
--
--   -- 2. El embudo completo, que es el punto de todo esto
--   SELECT
--     COUNT(*)                                        AS enviados,
--     COUNT(*) FILTER (WHERE outcome = 'returned')    AS recuperados,
--     COUNT(redemption_id)                            AS con_premio,
--     COUNT(*) FILTER (WHERE r.status = 'claimed')    AS canjeados
--   FROM win_back_attempts w
--   LEFT JOIN reward_redemptions r ON r.id = w.redemption_id
--   WHERE w.gym_id = '<gym_id>';
--   -- ojo: con_premio y canjeados salen 0 para todo lo enviado ANTES de esta
--   -- migración. No es un fallo; esas filas nunca guardaron el vínculo y no se
--   -- puede reconstruir hacia atrás desde el nombre del premio.

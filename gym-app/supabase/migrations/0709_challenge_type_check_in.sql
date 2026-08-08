-- ============================================================================
-- 0709 — Nuevo tipo de reto: asistencia
-- ============================================================================
--
-- POR QUÉ HACE FALTA. Toda la puntuación de retos vive hoy en el cliente, en
-- `SessionSummary.jsx`, y solo dispara cuando alguien TERMINA UN ENTRENO DENTRO
-- DE LA APP. El socio que viene al gimnasio y no registra nada no suma en
-- ningún reto — y ese es exactamente el grupo del que menos sabemos y el que
-- más se va. La métrica que de verdad predice la baja es venir, no el volumen.
--
-- `check_ins` está lleno de datos desde el primer día y ningún tipo de reto lo
-- miraba. Había hasta claves de traducción huérfanas (`admin.challengeTypes.
-- checkin`) de una idea que se quedó a medias.
--
-- ESTE FICHERO SOLO AÑADE EL VALOR AL ENUM, A PROPÓSITO. Un valor nuevo de un
-- enum no se puede USAR en la misma transacción que lo crea (Postgres:
-- «unsafe use of new value»). El trigger que lo consume va en la 0710.
-- ============================================================================

ALTER TYPE challenge_type ADD VALUE IF NOT EXISTS 'check_in';

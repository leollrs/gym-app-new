-- ============================================================
-- LIVE SCHEMA INTROSPECTION — run in Supabase Dashboard → SQL Editor
-- ============================================================
-- All queries are READ-ONLY (system catalogs only). They never touch
-- your data and change nothing. Run each block, click the single result
-- cell, copy it, and paste into the matching file under
-- supabase/_schema_audit/ (filenames listed above each query).
--
-- Each query returns ONE row / ONE column of JSON so it's a single copy.
-- If a result looks truncated in the grid, use the cell's expand/copy
-- button — Supabase copies the full value even when the preview clips.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1of7 — TABLES + COLUMNS   → paste into 01_columns.json
-- Every public table with its columns, types, nullability, defaults.
-- This is the core "what columns actually exist" ground truth.
-- ════════════════════════════════════════════════════════════
SELECT json_agg(t ORDER BY t.table_name) AS result
FROM (
  SELECT
    c.table_name,
    json_agg(
      json_build_object(
        'column',   c.column_name,
        'type',     c.data_type,
        'udt',      c.udt_name,
        'nullable', c.is_nullable,
        'default',  c.column_default
      ) ORDER BY c.ordinal_position
    ) AS columns
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND tb.table_type = 'BASE TABLE'
  GROUP BY c.table_name
) t;


-- ════════════════════════════════════════════════════════════
-- 2of7 — FUNCTIONS / RPCs   → paste into 02_functions.json
-- Every public function: args, return type, language, and whether
-- it's SECURITY DEFINER. Lets us spot multi-role-gating gaps + the
-- security-definer surface.
-- ════════════════════════════════════════════════════════════
SELECT json_agg(f ORDER BY f.name) AS result
FROM (
  SELECT
    p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_function_result(p.oid)             AS returns,
    l.lanname                                 AS language,
    p.prosecdef                               AS security_definer,
    p.provolatile                             AS volatility
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language  l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
) f;


-- ════════════════════════════════════════════════════════════
-- 3of7 — RLS POLICIES   → paste into 03_policies.json
-- Every policy: table, name, command, roles, USING + WITH CHECK.
-- This is where we hunt USING(true) leaks and bare-role gates that
-- ignore additional_roles.
-- ════════════════════════════════════════════════════════════
SELECT json_agg(pol ORDER BY pol.tablename, pol.policyname) AS result
FROM (
  SELECT
    tablename,
    policyname,
    cmd,
    roles,
    qual           AS using_expr,
    with_check     AS check_expr
  FROM pg_policies
  WHERE schemaname = 'public'
) pol;


-- ════════════════════════════════════════════════════════════
-- 4of7 — RLS STATUS PER TABLE   → paste into 04_rls_status.json
-- Which tables have RLS enabled/forced, and how many policies each
-- has. A table with rls_enabled=false OR policy_count=0 is a
-- potential exposure (or an intentional no-RLS mirror like
-- profile_lookup — we'll judge case by case).
-- ════════════════════════════════════════════════════════════
SELECT json_agg(r ORDER BY r.table_name) AS result
FROM (
  SELECT
    c.relname AS table_name,
    c.relrowsecurity  AS rls_enabled,
    c.relforcerowsecurity AS rls_forced,
    (SELECT count(*) FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
) r;


-- ════════════════════════════════════════════════════════════
-- 5of7 — ENUMS   → paste into 05_enums.json
-- Every enum type and its values, in order. Lets us verify code that
-- inserts enum literals matches the real allowed set.
-- ════════════════════════════════════════════════════════════
SELECT json_agg(e ORDER BY e.enum_name) AS result
FROM (
  SELECT
    t.typname AS enum_name,
    json_agg(en.enumlabel ORDER BY en.enumsortorder) AS values
  FROM pg_type t
  JOIN pg_enum en ON en.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname
) e;


-- ════════════════════════════════════════════════════════════
-- 6of7 — FUNCTION/TABLE GRANTS TO anon   → paste into 06_anon_grants.json
-- Anything anon can EXECUTE or SELECT. The anon-leak bug class
-- (cf. migrations 0222 / 0360 / 0367) lives here.
-- ════════════════════════════════════════════════════════════
SELECT json_build_object(
  'function_execute_anon', (
    SELECT json_agg(p.proname ORDER BY p.proname)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'table_privileges_anon', (
    SELECT json_agg(json_build_object('table', table_name, 'priv', privilege_type)
                    ORDER BY table_name, privilege_type)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'anon'
  )
) AS result;


-- ════════════════════════════════════════════════════════════
-- 7of7 — TRIGGERS   → paste into 07_triggers.json
-- Every trigger on public tables (name, table, timing, events,
-- function). Useful for confirming sync triggers (e.g.
-- sync_profile_lookup) fire on the right columns.
-- ════════════════════════════════════════════════════════════
SELECT json_agg(tg ORDER BY tg.table_name, tg.trigger_name) AS result
FROM (
  SELECT
    c.relname AS table_name,
    t.tgname  AS trigger_name,
    pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
) tg;

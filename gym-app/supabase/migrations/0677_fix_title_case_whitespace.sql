-- 0677_fix_title_case_whitespace.sql
--
-- Fixes 0674, which is ALREADY APPLIED and corrupted rows.
--
-- 0674 assumed `btrim(x)` behaves like JS `.trim()`. It does not: with one
-- argument it strips SPACES ONLY — not tab, newline, CR, VT or FF. So a name
-- carrying a stray control character (a paste from Sheets/Excel, a CSV import,
-- a form autofill) survived the guard, reached
-- `regexp_split_to_array(…, '\s+')` still holding it, and Postgres emitted an
-- EMPTY element for the delimiter sitting at the string edge. That empty word
-- walked the loop producing nothing, but the `idx > 1` separator was still
-- prepended:
--
--     title_case_name(E'\tjose')  →  ' Jose'   (leading space, stored)
--     title_case_name(E'jose\n')  →  'Jose '   (trailing space, stored)
--     title_case_name(E'\n')      →  ' '       (a name that is now one space)
--
-- Those are also NOT fixed points, so 0674 was not safely re-runnable.
--
-- Second, subtler defect: Postgres `\s` is the ctype space class, which under
-- en_US.UTF-8 EXCLUDES U+00A0 (NBSP), U+202F and U+2007. JS `\s` includes them.
-- NBSP is exactly what pasting from Word/Excel/Sheets produces. So
-- 'maria<NBSP>rivera' is ONE word to Postgres — lowercase, not a particle, so
-- only its first letter is capitalized:
--
--     DB  → 'Maria<NBSP>rivera'      (surname left lowercase)
--     App → 'Maria Rivera'           (AuthContext cases on read)
--
-- which is precisely the app/DB disagreement 0674's header claims cannot
-- happen — and the DB copy is the one middleware.js renders into the public
-- share card.
--
-- Fix: normalize every one of those characters to a plain space with
-- `translate` BEFORE splitting. translate is char-for-char, so it sidesteps the
-- locale-dependent regex class entirely. Then drop empty words, and return ''
-- for blank input to match src/lib/nameCase.js instead of echoing `raw`.

BEGIN;

CREATE OR REPLACE FUNCTION public.title_case_name(raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  particles CONSTANT TEXT[] := ARRAY[
    'de','del','la','las','lo','los','y','e','da','das','do','dos',
    'van','von','der','den','di','du','el'
  ];
  -- tab, LF, CR, VT, FF, NBSP, narrow NBSP, figure space → plain space.
  -- Kept as chr() calls so the intent survives copy/paste through editors that
  -- would silently normalize a literal NBSP back to a space.
  ws_from CONSTANT TEXT := chr(9)||chr(10)||chr(13)||chr(11)||chr(12)||chr(160)||chr(8239)||chr(8199);
  ws_to   CONSTANT TEXT := '        ';   -- exactly 8 spaces, one per source char
  norm    TEXT;
  words   TEXT[];
  w       TEXT;
  lower_w TEXT;
  built   TEXT;
  acc     TEXT := '';
  idx     INT  := 0;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;

  norm := btrim(translate(raw, ws_from, ws_to));
  IF norm = '' THEN
    RETURN '';                       -- matches nameCase.js, which returns ''
  END IF;

  -- Only plain spaces remain after translate, so a simple split is enough and
  -- cannot produce edge empties. The filter is belt-and-braces for runs.
  words := ARRAY(SELECT x FROM unnest(string_to_array(norm, ' ')) AS x WHERE x <> '');

  FOREACH w IN ARRAY words LOOP
    idx := idx + 1;
    lower_w := lower(w);

    IF w <> lower_w AND w <> upper(w) THEN
      acc := acc || CASE WHEN idx > 1 THEN ' ' ELSE '' END || w;
      CONTINUE;
    END IF;

    IF idx > 1 AND lower_w = ANY (particles) THEN
      acc := acc || ' ' || lower_w;
      CONTINUE;
    END IF;

    built := '';
    DECLARE
      i INT := 1;
      ch TEXT;
      cap_next BOOLEAN := TRUE;
    BEGIN
      WHILE i <= length(lower_w) LOOP
        ch := substr(lower_w, i, 1);
        IF ch IN ('-', '''', '’') THEN
          built := built || ch;
          cap_next := TRUE;
        ELSIF cap_next THEN
          built := built || upper(ch);
          cap_next := FALSE;
        ELSE
          built := built || ch;
        END IF;
        i := i + 1;
      END LOOP;
    END;

    IF built ~ '^Mc[[:alpha:]]' THEN
      built := 'Mc' || upper(substr(built, 3, 1)) || substr(built, 4);
    END IF;

    acc := acc || CASE WHEN idx > 1 THEN ' ' ELSE '' END || built;
  END LOOP;

  RETURN acc;
END;
$$;

-- Repair what 0674 wrote. Deliberately NOT filtered to "rows 0674 touched" —
-- the point is to reach every row whose stored value differs from what the
-- corrected function produces, including the leading/trailing spaces 0674
-- introduced and the NBSP names it half-cased.
--
-- The guard keeps a genuinely blank result from blanking a name: if the
-- corrected output is empty, the row is left alone for a human to look at.
UPDATE profiles
   SET full_name = public.title_case_name(full_name)
 WHERE full_name IS NOT NULL
   AND full_name <> public.title_case_name(full_name)
   AND public.title_case_name(full_name) <> '';

COMMIT;

-- Verify — all three should return 0 rows.
--
-- 1) Fixed point (this is the check 0674 could not pass):
--   SELECT id, full_name FROM profiles
--    WHERE full_name IS NOT NULL AND btrim(full_name) <> ''
--      AND full_name <> public.title_case_name(full_name);
--
-- 2) No stray edge whitespace left behind by 0674:
--   SELECT id, full_name FROM profiles
--    WHERE full_name <> btrim(full_name, E' \t\n\r\v\f');
--
-- 3) No name still carrying a non-breaking space:
--   SELECT id, full_name FROM profiles
--    WHERE full_name LIKE '%' || chr(160) || '%';
--
-- Anything 0674 blanked to a single space is caught by (1) and repaired to ''
-- by neither statement — inspect those by hand:
--   SELECT id FROM profiles WHERE btrim(full_name) = '' AND full_name <> '';
--
-- NOTE, still open after this migration: nothing keeps the column clean going
-- forward. Only the JS signup path cases names. The server-side member
-- creators — 0466 (gym CSV bulk import, invite claim) and 0469
-- (admin_create_live_member) — insert full_name verbatim, so every member who
-- arrives by gym import lands raw. A BEFORE INSERT/UPDATE trigger calling this
-- function is the real fix; it is deliberately NOT added here so this migration
-- stays a pure repair.

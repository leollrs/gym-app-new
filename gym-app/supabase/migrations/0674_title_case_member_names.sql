-- 0674_title_case_member_names.sql
--
-- Normalize profiles.full_name to title case.
--
-- WHY THIS HAS TO BE IN THE DATABASE and not in the app: the name is rendered
-- by servers the client never touches. `middleware.js` runs on Vercel's edge
-- and builds the Open Graph card for every shared link straight from this
-- column — "test te quiere agregar en TuGymPR" (line 235) and "Entrena con
-- {name}" for trainers (line 221). Those previews are what a prospect sees
-- before they ever install the app. Casing in React fixes the app and nothing
-- else; casing here fixes the app, the share cards, the feed, friend lists and
-- the trainer's client roster at once.
--
-- The rules mirror src/lib/nameCase.js exactly, so the app's write path and
-- this backfill can never disagree:
--   · only a word that is ENTIRELY one case is touched — "Carlos DeLeon" and
--     "MacKay" are left exactly as the member typed them
--   · Spanish/Portuguese connectives stay lowercase INSIDE a name but are
--     capitalized when they start it: "maria de los angeles" → "Maria de los
--     Angeles", but "del valle" → "Del Valle"
--   · hyphens and apostrophes carry their own capital: o'brien → O'Brien
--   · Mc takes a second capital: mcdonald → McDonald (no Mac rule — see below)
--   · accents are preserved — they are part of the name, not noise
--
-- Idempotent: re-running changes nothing, because the output of the function is
-- a fixed point. `username` is deliberately untouched — a handle is not a name
-- and @test20 is correct in lowercase.

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
  words   TEXT[];
  w       TEXT;
  lower_w TEXT;
  built   TEXT;
  acc     TEXT := '';
  idx     INT  := 0;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN raw;
  END IF;

  -- Collapse whitespace runs, same as the JS split(/\s+/).
  words := regexp_split_to_array(btrim(raw), '\s+');

  FOREACH w IN ARRAY words LOOP
    idx := idx + 1;
    lower_w := lower(w);

    -- Member cased it themselves (has an internal capital) → leave verbatim.
    IF w <> lower_w AND w <> upper(w) THEN
      acc := acc || CASE WHEN idx > 1 THEN ' ' ELSE '' END || w;
      CONTINUE;
    END IF;

    -- Connective inside the name stays lowercase. Position wins at the start.
    IF idx > 1 AND lower_w = ANY (particles) THEN
      acc := acc || ' ' || lower_w;
      CONTINUE;
    END IF;

    -- Capitalize the first letter and every letter that follows a hyphen or
    -- apostrophe: jean-luc → Jean-Luc, o'brien → O'Brien. Walked character by
    -- character rather than split-and-rejoin so the separators keep their exact
    -- positions (and a name ending in one survives).
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

    -- Mc takes a second capital: mcdonald → McDonald. There is NO Mac rule on
    -- purpose: it would turn machado → MacHado and macario → MacArio, and in
    -- this market those are far commoner than MacKay. A member who wants
    -- MacKay types the K themselves, and the self-cased check above keeps it.
    IF built ~ '^Mc[[:alpha:]]' THEN
      built := 'Mc' || upper(substr(built, 3, 1)) || substr(built, 4);
    END IF;

    acc := acc || CASE WHEN idx > 1 THEN ' ' ELSE '' END || built;
  END LOOP;

  RETURN acc;
END;
$$;

COMMENT ON FUNCTION public.title_case_name(TEXT) IS
  'Title-cases a person name, mirroring src/lib/nameCase.js. Leaves self-cased words untouched; keeps Spanish connectives lowercase inside the name.';

-- Backfill. Only rows the function would actually change are written, so the
-- statement is cheap to re-run and leaves updated_at alone for everyone else.
UPDATE profiles
   SET full_name = public.title_case_name(full_name)
 WHERE full_name IS NOT NULL
   AND btrim(full_name) <> ''
   AND full_name <> public.title_case_name(full_name);

COMMIT;

-- Verify — expect 0 rows. Anything returned is a name the function would still
-- change, which would mean it is not a fixed point and the backfill is unsafe
-- to re-run.
--   SELECT id, full_name, public.title_case_name(full_name) AS would_become
--     FROM profiles
--    WHERE full_name IS NOT NULL AND btrim(full_name) <> ''
--      AND full_name <> public.title_case_name(full_name);
--
-- Spot-check the rules before trusting the backfill:
--   SELECT public.title_case_name('test 20')                    AS a,  -- Test 20
--          public.title_case_name('maria de los angeles rivera') AS b,  -- Maria de los Angeles Rivera
--          public.title_case_name('del valle')                   AS c,  -- Del Valle
--          public.title_case_name('o''brien')                    AS d,  -- O'Brien
--          public.title_case_name('mcdonald')                    AS e,  -- McDonald
--          public.title_case_name('machado')                     AS g,  -- Machado (NOT MacHado)
--          public.title_case_name('Carlos DeLeon')               AS f;  -- Carlos DeLeon (untouched)

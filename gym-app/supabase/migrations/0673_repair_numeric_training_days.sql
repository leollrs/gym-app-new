-- 0673_repair_numeric_training_days.sql
--
-- REPAIR. adoptTrainerPlan() wrote workout_schedule's INT day_of_week values
-- straight into profiles.preferred_training_days, which is TEXT[] of English
-- day names (0059). Postgres accepted {'1','2','3'} silently, so nothing ever
-- errored, but every SQL reader maps the column with a literal
--
--     CASE day WHEN 'Sunday' THEN 0 WHEN 'Monday' THEN 1 ... END
--
-- with no ELSE. A numeric element matches no branch and yields NULL, so the
-- array became {NULL,NULL,NULL}. Then in complete_workout (0297) and the
-- nightly streak cron (0242):
--
--     ELSIF array_length(v_training_dow,1) > 0
--           AND NOT (v_gap_dow = ANY(v_training_dow)) THEN  -- skip: rest day
--
-- `v_gap_dow = ANY('{NULL,NULL,NULL}')` is NULL, not FALSE; NOT NULL is NULL;
-- plpgsql treats a NULL branch condition as false. So the rest-day skip never
-- fired and every rest day was charged as a MISSED training day: it consumed
-- the member's two monthly streak freezes and then broke the streak outright.
-- Exactly the failure the alignment was written to prevent.
--
-- The writer is fixed in src/lib/trainerPlanAdoption.js. This repairs rows
-- already corrupted, which the code fix alone cannot reach — an affected member
-- keeps losing their streak until their profile is rewritten.
--
-- Safe to re-run: it only touches rows holding an element that is not a valid
-- day name, and maps by value rather than assuming a particular set of days.

BEGIN;

UPDATE profiles p
   SET preferred_training_days = repaired.days
  FROM (
    SELECT id,
           ARRAY(
             SELECT CASE elem
                      WHEN '0' THEN 'Sunday'    WHEN '1' THEN 'Monday'
                      WHEN '2' THEN 'Tuesday'   WHEN '3' THEN 'Wednesday'
                      WHEN '4' THEN 'Thursday'  WHEN '5' THEN 'Friday'
                      WHEN '6' THEN 'Saturday'
                    END
               FROM unnest(preferred_training_days) AS elem
              -- Drop anything that is neither a name nor a 0-6 int rather than
              -- writing another NULL and recreating the same bug.
              WHERE elem IN ('0','1','2','3','4','5','6')
              ORDER BY elem::INT
           ) AS days
      FROM profiles
     WHERE preferred_training_days IS NOT NULL
       AND array_length(preferred_training_days, 1) > 0
       -- Only rows with at least one element that is NOT a valid day name.
       AND EXISTS (
             SELECT 1 FROM unnest(preferred_training_days) AS elem
              WHERE elem NOT IN ('Sunday','Monday','Tuesday','Wednesday',
                                 'Thursday','Friday','Saturday')
           )
  ) AS repaired
 WHERE p.id = repaired.id
   -- Never blank out a member's schedule. If nothing mapped, the data is some
   -- other shape entirely and wants eyes on it, not an empty array.
   AND array_length(repaired.days, 1) > 0;

COMMIT;

-- Rows left untouched because nothing mapped — expect 0. Anything here has a
-- third format and must be inspected by hand.
--   SELECT id, preferred_training_days FROM profiles
--    WHERE preferred_training_days IS NOT NULL
--      AND EXISTS (SELECT 1 FROM unnest(preferred_training_days) AS e
--                   WHERE e NOT IN ('Sunday','Monday','Tuesday','Wednesday',
--                                   'Thursday','Friday','Saturday'));

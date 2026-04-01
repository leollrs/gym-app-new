-- Add notes column to session_sets (rpe already exists as NUMERIC(3,1) from initial schema)
ALTER TABLE session_sets ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add CHECK constraint on rpe if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'session_sets_rpe_range'
  ) THEN
    ALTER TABLE session_sets ADD CONSTRAINT session_sets_rpe_range CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10));
  END IF;
END $$;

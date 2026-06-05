-- 0519_gym_address.sql
-- Adds a free-text street address to gyms.
--
-- Shown on the member "My Gym" page (location card) and editable from
-- admin Settings → Gym Info. Nullable; existing rows default to NULL and
-- the member page simply omits the address row when it is empty.
--
-- No RLS / grant changes are required: the column inherits the existing
-- gyms policies, and admins already hold UPDATE on their own gym row
-- (used today to rename the gym from the same settings page).

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN gyms.address IS
  'Free-text street address shown on the member My Gym page (set in admin Settings → Gym Info).';

-- Per-day gym hours + holidays table
CREATE TABLE IF NOT EXISTS gym_hours (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time  TEXT NOT NULL DEFAULT '06:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  is_closed  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(gym_id, day_of_week)
);

-- Seed default rows from existing gym data
INSERT INTO gym_hours (gym_id, day_of_week, open_time, close_time, is_closed)
SELECT g.id, d.dow, g.open_time, g.close_time,
       NOT (g.open_days @> ARRAY[d.dow])
FROM gyms g
CROSS JOIN generate_series(0, 6) AS d(dow)
ON CONFLICT (gym_id, day_of_week) DO NOTHING;

-- Holidays / special closures
CREATE TABLE IF NOT EXISTS gym_holidays (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  label      TEXT NOT NULL DEFAULT 'Holiday',
  is_closed  BOOLEAN NOT NULL DEFAULT TRUE,
  open_time  TEXT,
  close_time TEXT,
  UNIQUE(gym_id, date)
);

CREATE INDEX idx_gym_hours_gym ON gym_hours(gym_id);
CREATE INDEX idx_gym_holidays_gym ON gym_holidays(gym_id, date);

-- RLS
ALTER TABLE gym_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_holidays ENABLE ROW LEVEL SECURITY;

-- Members can read their gym's hours
CREATE POLICY "gym_hours_read" ON gym_hours FOR SELECT
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid()));

-- Admins can manage hours
CREATE POLICY "gym_hours_admin" ON gym_hours FOR ALL
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

-- Members can read holidays
CREATE POLICY "gym_holidays_read" ON gym_holidays FOR SELECT
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid()));

-- Admins can manage holidays
CREATE POLICY "gym_holidays_admin" ON gym_holidays FOR ALL
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

-- Change channel from single TEXT to TEXT[] to support multiple delivery channels per event.
-- Drop default first, convert, then set new array default.

ALTER TABLE admin_notification_prefs
  ALTER COLUMN channel DROP DEFAULT;

ALTER TABLE admin_notification_prefs
  ALTER COLUMN channel TYPE TEXT[] USING ARRAY[channel];

ALTER TABLE admin_notification_prefs
  ALTER COLUMN channel SET DEFAULT '{in_app}';

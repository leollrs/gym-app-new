-- Twilio "from" phone number assigned to each gym for sending SMS
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS sms_phone_number TEXT DEFAULT NULL;

ALTER TABLE gyms
  ADD CONSTRAINT gyms_sms_phone_e164_us
  CHECK (sms_phone_number ~ '^\+1\d{10}$');

COMMENT ON COLUMN gyms.sms_phone_number
  IS 'Twilio phone number (E.164 US format) used as the "from" number for SMS. NULL means SMS is not enabled for this gym.';

CREATE TABLE IF NOT EXISTS admin_notification_prefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    channel TEXT DEFAULT 'in_app',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(profile_id, event_type)
);

ALTER TABLE admin_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prefs_select_own" ON admin_notification_prefs FOR SELECT
  USING (profile_id = auth.uid());
CREATE POLICY "prefs_insert_own" ON admin_notification_prefs FOR INSERT
  WITH CHECK (profile_id = auth.uid());
CREATE POLICY "prefs_update_own" ON admin_notification_prefs FOR UPDATE
  USING (profile_id = auth.uid());

-- Seed default prefs for admin on first access (via RPC)
CREATE OR REPLACE FUNCTION public.get_admin_notification_prefs()
RETURNS SETOF admin_notification_prefs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  v_count INTEGER;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  SELECT COUNT(*) INTO v_count FROM admin_notification_prefs WHERE profile_id = uid;

  IF v_count = 0 THEN
    INSERT INTO admin_notification_prefs (profile_id, gym_id, event_type, enabled) VALUES
      (uid, my_gym, 'new_member', true),
      (uid, my_gym, 'member_churned', true),
      (uid, my_gym, 'churn_score_spike', true),
      (uid, my_gym, 'challenge_completed', true),
      (uid, my_gym, 'milestone_reached', false),
      (uid, my_gym, 'password_reset_request', true),
      (uid, my_gym, 'content_report', true),
      (uid, my_gym, 'class_full', false),
      (uid, my_gym, 'low_attendance', true),
      (uid, my_gym, 'new_referral', false),
      (uid, my_gym, 'store_redemption', false),
      (uid, my_gym, 'trainer_note', false);
  END IF;

  RETURN QUERY SELECT * FROM admin_notification_prefs WHERE profile_id = uid ORDER BY event_type;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_notification_prefs() TO authenticated;

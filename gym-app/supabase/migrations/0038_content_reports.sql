-- Content reporting for UGC compliance (Google Play requirement)

CREATE TABLE IF NOT EXISTS public.content_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feed_item_id uuid NOT NULL REFERENCES public.activity_feed_items(id) ON DELETE CASCADE,
  gym_id      uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  reason      text NOT NULL DEFAULT 'inappropriate',
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

-- Index for admin moderation queries
CREATE INDEX idx_content_reports_gym_status ON public.content_reports(gym_id, status);
CREATE INDEX idx_content_reports_feed_item ON public.content_reports(feed_item_id);

-- RLS
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Members can insert reports for their own gym
CREATE POLICY "Members can report content"
  ON public.content_reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

-- Members can see their own reports
CREATE POLICY "Members can view own reports"
  ON public.content_reports FOR SELECT
  USING (reporter_id = auth.uid());

-- Admins can view all reports for their gym
CREATE POLICY "Admins can view gym reports"
  ON public.content_reports FOR SELECT
  USING (
    gym_id IN (
      SELECT gym_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update report status
CREATE POLICY "Admins can update reports"
  ON public.content_reports FOR UPDATE
  USING (
    gym_id IN (
      SELECT gym_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

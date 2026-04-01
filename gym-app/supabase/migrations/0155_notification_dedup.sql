-- Add dedup key for preventing duplicate notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Unique constraint: only one notification per dedup_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup_key
  ON public.notifications(dedup_key)
  WHERE dedup_key IS NOT NULL;

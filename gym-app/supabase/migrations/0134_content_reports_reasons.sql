-- Extend content_reports: add reason options, support comment reports, prevent duplicates

-- Add check constraint on reason column for allowed values
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reason_check
  CHECK (reason IN ('spam', 'inappropriate', 'harassment', 'other'));

-- Add optional details column for "other" reason
ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS details TEXT;

-- Add content_type and content_id so we can report comments too (not just feed items)
ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'activity'
  CHECK (content_type IN ('activity', 'comment'));

ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS content_id UUID;

-- Backfill content_id from feed_item_id for existing rows
UPDATE public.content_reports SET content_id = feed_item_id WHERE content_id IS NULL;

-- Prevent duplicate reports from the same user on the same content
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_unique_per_user
  ON public.content_reports(reporter_id, COALESCE(content_id, feed_item_id));

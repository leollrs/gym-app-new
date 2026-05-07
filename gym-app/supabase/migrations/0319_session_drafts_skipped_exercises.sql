-- Add skipped_exercise_ids column to session_drafts so mid-session skips
-- persist across app kills / WebView reloads and the Live Activity set
-- totals can recompute correctly on resume.
alter table session_drafts
  add column if not exists skipped_exercise_ids text[] default '{}';

notify pgrst, 'reload schema';

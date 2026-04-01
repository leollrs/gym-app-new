-- Allow members to delete (unflag) their own content reports
CREATE POLICY "members_delete_own_reports" ON content_reports
  FOR DELETE USING (reporter_id = auth.uid());

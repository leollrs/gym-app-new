-- Batch fetch member emails for admin member list
CREATE OR REPLACE FUNCTION public.admin_get_member_emails(p_member_ids UUID[])
RETURNS TABLE (member_id UUID, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  RETURN QUERY
  SELECT u.id AS member_id, u.email
  FROM auth.users u
  INNER JOIN profiles p ON p.id = u.id
  WHERE u.id = ANY(p_member_ids)
    AND p.gym_id = public.current_gym_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_member_emails(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

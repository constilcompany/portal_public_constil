CREATE OR REPLACE FUNCTION mark_item_approved(item_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE review_queue SET status = 'approved' WHERE id = item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_item_approved(UUID) TO anon, authenticated;

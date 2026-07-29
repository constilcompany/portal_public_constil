CREATE OR REPLACE FUNCTION reject_review_queue_item(p_review_queue_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE review_queue SET status = 'rejected' WHERE id = p_review_queue_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_review_queue_item(UUID) TO anon, authenticated;

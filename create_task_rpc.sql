CREATE OR REPLACE FUNCTION toggle_task_status(task_id UUID, new_status TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Cast the text status to the custom task_status enum type
  EXECUTE format('UPDATE tasks SET status = %L::task_status WHERE id = %L', new_status, task_id);
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_task_status(UUID, TEXT) TO anon, authenticated;

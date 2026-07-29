CREATE OR REPLACE FUNCTION approve_review_queue_item(
  p_review_queue_id UUID,
  p_extracted_id UUID,
  p_classification_id UUID,
  p_category TEXT,
  p_project_name TEXT,
  p_due_date TEXT,
  p_scope_description TEXT,
  p_dollar_amount TEXT,
  p_email_id UUID,
  p_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_fields JSONB;
BEGIN
  -- 1. Mark review queue as approved
  UPDATE review_queue SET status = 'approved' WHERE id = p_review_queue_id;

  -- 2. Update email classification
  IF p_classification_id IS NOT NULL THEN
    UPDATE email_classifications SET category = p_category WHERE id = p_classification_id;
  END IF;

  -- 3. Update extracted fields
  IF p_extracted_id IS NOT NULL THEN
    SELECT fields INTO v_current_fields FROM extracted_fields WHERE id = p_extracted_id;
    
    IF v_current_fields IS NULL THEN
      v_current_fields := '{}'::jsonb;
    END IF;

    -- Update JSON fields
    v_current_fields := jsonb_set(v_current_fields, '{project_name}', to_jsonb(p_project_name));
    v_current_fields := jsonb_set(v_current_fields, '{due_date}', to_jsonb(p_due_date));
    v_current_fields := jsonb_set(v_current_fields, '{scope_description}', to_jsonb(p_scope_description));
    v_current_fields := jsonb_set(v_current_fields, '{dollar_amount}', to_jsonb(p_dollar_amount));

    UPDATE extracted_fields SET fields = v_current_fields WHERE id = p_extracted_id;
  END IF;

  -- 4. Create Task
  IF p_email_id IS NOT NULL THEN
    INSERT INTO tasks (
      user_id,
      related_email_id,
      title,
      description,
      due_date,
      status,
      priority
    ) VALUES (
      p_user_id,
      p_email_id,
      'Respond to ' || COALESCE(p_category, '') || ': ' || COALESCE(p_project_name, 'Project'),
      COALESCE(p_scope_description, 'No description provided.'),
      NULLIF(p_due_date, '')::timestamp,
      'pending',
      'urgent'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_review_queue_item(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO anon, authenticated;

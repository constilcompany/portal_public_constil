DO $$
DECLARE
  target_user_id UUID;
  new_email_id UUID;
  new_classification_id UUID;
BEGIN
  FOR target_user_id IN 
    SELECT id FROM auth.users WHERE email ILIKE '%Mateus%' OR raw_user_meta_data->>'full_name' ILIKE '%Mateus%'
  LOOP
    -- 1. Insert into raw_emails
    INSERT INTO public.raw_emails (user_id, nylas_message_id, subject, sender, body, recipients, status, received_at)
    VALUES (
      target_user_id,
      'msg_mock_' || floor(random() * 1000000)::text,
      'Invitation to Bid - Walmart Retail Renovation #4092',
      'bids@walmart-construction.com',
      'Hello,

Please see the attached scope of work for the Walmart Retail Renovation project (#4092) located at 123 Main St, Springfield. We are requesting pricing for flooring, drywall, and painting.

Bids are due by next Friday, August 15th, 2026. The estimated budget is roughly $150,000.

Thanks,
Walmart Construction Team',
      '["estimating@constil.com"]'::jsonb,
      'classified',
      NOW()
    )
    RETURNING id INTO new_email_id;

    -- 2. Insert into email_classifications
    INSERT INTO public.email_classifications (email_id, category, confidence_score)
    VALUES (
      new_email_id,
      'Bid Request',
      98.50
    )
    RETURNING id INTO new_classification_id;

    -- 3. Insert into extracted_fields
    INSERT INTO public.extracted_fields (email_id, fields)
    VALUES (
      new_email_id,
      '{
        "project_name": "Walmart Retail Renovation #4092",
        "project_number": "4092",
        "due_date": "2026-08-15T17:00:00Z",
        "company_sender": "Walmart Construction",
        "address": "123 Main St, Springfield",
        "scope_description": "Flooring, drywall, and painting.",
        "dollar_amount": 150000
      }'::jsonb
    );

    -- 4. Insert into review_queue
    INSERT INTO public.review_queue (email_id, classification_id, status)
    VALUES (
      new_email_id,
      new_classification_id,
      'pending'
    );
  END LOOP;
END $$;

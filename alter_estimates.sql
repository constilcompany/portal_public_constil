ALTER TABLE estimates ADD COLUMN nylas_grant_id TEXT;

CREATE OR REPLACE FUNCTION handle_estimate_sent_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_client_email TEXT;
BEGIN
    -- Only trigger when status changes to 'sent'
    IF NEW.status = 'sent' AND (OLD.status IS NULL OR OLD.status != 'sent') THEN
        
        -- Get client email
        SELECT email INTO v_client_email FROM clients WHERE id = NEW.client_id;
        
        IF v_client_email IS NOT NULL THEN
            -- Insert into estimate_followups
            INSERT INTO estimate_followups (
                user_id,
                estimate_id,
                client_email,
                status,
                day_2_scheduled_at,
                day_7_scheduled_at,
                nylas_grant_id
            ) VALUES (
                NEW.user_id,
                NEW.id,
                v_client_email,
                'pending',
                NOW() + INTERVAL '2 days',
                NOW() + INTERVAL '7 days',
                NEW.nylas_grant_id
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS estimate_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    estimate_id UUID REFERENCES estimates(id) ON DELETE CASCADE,
    client_email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'day_2_sent', 'day_7_sent', 'replied', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    day_2_scheduled_at TIMESTAMP WITH TIME ZONE,
    day_7_scheduled_at TIMESTAMP WITH TIME ZONE,
    last_client_message_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE estimate_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated users" 
ON estimate_followups FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Enable select and update for anon" 
ON estimate_followups FOR ALL 
TO anon 
USING (true) 
WITH CHECK (true);

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
                day_7_scheduled_at
            ) VALUES (
                NEW.user_id,
                NEW.id,
                v_client_email,
                'pending',
                NOW() + INTERVAL '2 days',
                NOW() + INTERVAL '7 days'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_estimate_sent_followup ON estimates;
CREATE TRIGGER trigger_estimate_sent_followup
    AFTER UPDATE OF status ON estimates
    FOR EACH ROW
    EXECUTE FUNCTION handle_estimate_sent_followup();


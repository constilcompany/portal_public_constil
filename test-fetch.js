import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://avppbvsxayehguepyjkb.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzM5NjIsImV4cCI6MjA5MjYwOTk2Mn0.9deO5EvQLpilKfIWdAFqfoWkKx5wOwRbdnX7o0N1Yek', { auth: { persistSession: false }});

async function run() {
  const { data } = await supabase.from('review_queue').select(`
        id, status,
        raw_emails!inner ( 
          id, subject, body, sender, received_at, user_id,
          extracted_fields ( id, fields )
        ),
        email_classifications!inner ( id, category, confidence_score )
      `).limit(1);
  console.log(JSON.stringify(data[0], null, 2));
}
run();

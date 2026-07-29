import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avppbvsxayehguepyjkb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTk4NTI1NzksImV4cCI6MjAzNTQyODU3OX0.kCqH8oA1A2r9O0Xw0rJ8X_U-60g0xV7G_5jP5K90z4c'; // (Extracted from .env)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testUpdate() {
  const { data, error } = await supabase
    .from('review_queue')
    .update({ status: 'approved' })
    .eq('id', '97780663-713f-47d2-95b1-e4ee5fc64b65') // One of the IDs from DB
    .select();

  console.log("Data:", data);
  console.log("Error:", error);
}

testUpdate();

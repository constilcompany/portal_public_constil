import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avppbvsxayehguepyjkb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzM5NjIsImV4cCI6MjA5MjYwOTk2Mn0.9deO5EvQLpilKfIWdAFqfoWkKx5wOwRbdnX7o0N1Yek';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testUpdate() {
  const { data, error } = await supabase
    .from('review_queue')
    .update({ status: 'approved' })
    .eq('id', '3e4b3ecd-500e-4085-8367-44cc1c5c206b')
    .select();
  console.log("Data:", data);
  console.log("Error:", error);
}

testUpdate();

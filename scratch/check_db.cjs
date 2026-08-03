const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://avppbvsxayehguepyjkb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzM5NjIsImV4cCI6MjA5MjYwOTk2Mn0.9deO5EvQLpilKfIWdAFqfoWkKx5wOwRbdnX7o0N1Yek';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  const { data: tasks } = await supabase.from('tasks').select('*').limit(3);
  console.log("Tasks:", JSON.stringify(tasks, null, 2));
  
  // also get tables
  const { data: profiles } = await supabase.from('profiles').select('*').limit(3);
  console.log("Profiles:", JSON.stringify(profiles, null, 2));
}

check();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.log("No supabase credentials found.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data: tasks, error } = await supabase.from('tasks').select('*').limit(5);
  if (error) console.error("Error fetching tasks:", error);
  else console.log("Tasks sample:", JSON.stringify(tasks, null, 2));
  
  // Also check if there's a profiles or users table we can use for the Y-axis
  const { data: profiles, error: pError } = await supabase.from('profiles').select('*').limit(2);
  if (pError) {
    console.error("Error fetching profiles:", pError.message);
  } else {
    console.log("Profiles sample:", JSON.stringify(profiles, null, 2));
  }
}

run();

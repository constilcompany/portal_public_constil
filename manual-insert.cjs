const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

// We need to use the service role key to insert without RLS
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Missing Supabase URL or Service Role Key in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Inserting Metro Hospital email into raw_emails...");
  
  const emailData = {
    nylas_message_id: 'manual-metro-hospital-' + Date.now(),
    subject: 'Bid Request - HVAC & Mechanical Retrofit #8821 - Metro Hospital',
    sender: JSON.stringify([{ name: 'Ayan Khan', email: 'ayan.1424.ad@iqra.edu.pk' }]),
    recipients: JSON.stringify([{ name: 'Team', email: 'team@constil.com' }]),
    body: `Hello Team,\n\nApex Commercial Builders is requesting proposals for the mechanical and HVAC upgrade at Metro Health Hospital (Building B).\n\nProject Details:\n- Project Name: Metro Hospital HVAC & Mechanical Retrofit #8821\n- Project Location: 450 Medical Parkway, Chicago, IL\n- General Contractor: Apex Commercial Builders LLC\n- Estimated Budget / Scope Value: $210,000.00\n- Proposal Due Date: August 25, 2026 by 2:00 PM CST\n\nScope Description:\nIncludes removal of existing rooftop chillers, installation of 4 new commercial air handling units, and complete ductwork modification per mechanical engineering specs.\n\nPlease review and send your intention to bid.\n\nBest regards,\nDavid Ross\nEstimating Lead\nApex Commercial Builders LLC\nd.ross@apex-builders-example.com`,
    status: 'pending_ai',
    received_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('raw_emails')
    .insert(emailData)
    .select('id')
    .single();

  if (error) {
    console.error("Failed to insert:", error);
    return;
  }
  
  console.log("Inserted with ID:", data.id);
  
  console.log("Triggering process-email-ai edge function...");
  const aiFuncUrl = `${SUPABASE_URL}/functions/v1/process-email-ai`;
  
  try {
    const res = await fetch(aiFuncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ email_id: data.id })
    });
    
    const responseText = await res.text();
    console.log("AI Edge Function Response:", responseText);
  } catch (err) {
    console.error("Failed to trigger edge function:", err);
  }
}

run();

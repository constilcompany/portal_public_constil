const SUPABASE_URL = 'https://avppbvsxayehguepyjkb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzM5NjIsImV4cCI6MjA5MjYwOTk2Mn0.9deO5EvQLpilKfIWdAFqfoWkKx5wOwRbdnX7o0N1Yek';

const headers = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function insert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    throw new Error(`Failed to insert into ${table}: ${await res.text()}`);
  }
  const result = await res.json();
  return result[0];
}

async function update(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    throw new Error(`Failed to update ${table}: ${await res.text()}`);
  }
}

async function main() {
  console.log("1. Inserting raw email into raw_emails...");
  
  const rawEmail = await insert('raw_emails', {
    nylas_message_id: 'msg_' + Date.now(),
    subject: 'Invitation to Bid - Walmart Retail Renovation #4092',
    sender: 'bids@walmart-construction.com',
    body: 'Hello,\n\nPlease see the attached scope of work for the Walmart Retail Renovation project (#4092) located at 123 Main St, Springfield. We are requesting pricing for flooring, drywall, and painting.\n\nBids are due by next Friday, August 15th, 2026. The estimated budget is roughly $150,000.\n\nThanks,\nWalmart Construction Team',
    recipients: JSON.parse('["estimating@constil.com"]'),
    status: 'pending_ai',
    received_at: new Date().toISOString()
  });
  
  const emailId = rawEmail.id;
  console.log(`Inserted raw email with ID: ${emailId}`);
  
  console.log("2. Executing 'process-email-ai' logic (Mocking AI extraction for test purposes)...");
  
  await update('raw_emails', emailId, { status: 'classified' });
  
  const classification = await insert('email_classifications', {
    email_id: emailId,
    category: 'Bid Request',
    confidence_score: 98.5
  });
  
  await insert('extracted_fields', {
    email_id: emailId,
    fields: {
      project_name: "Walmart Retail Renovation #4092",
      project_number: "4092",
      due_date: "2026-08-15T17:00:00Z",
      company_sender: "Walmart Construction",
      address: "123 Main St, Springfield",
      scope_description: "Flooring, drywall, and painting.",
      dollar_amount: 150000
    }
  });
  
  await insert('review_queue', {
    email_id: emailId,
    classification_id: classification.id,
    status: 'pending'
  });
  
  console.log("✅ Successfully simulated AI classification and pushed to review_queue!");
}

main().catch(console.error);

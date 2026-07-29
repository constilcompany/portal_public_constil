import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Reusable AI helper using Fireworks AI
const callAI = async (systemPrompt: string, userPrompt: string, fireworksApiKey: string, model = "accounts/fireworks/models/gpt-oss-120b") => {
  const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fireworksApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || "AI Request Failed")
  return data.choices[0].message.content
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const fireworksApiKey = Deno.env.get('FIREWORKS_API_KEY')

    if (!supabaseUrl || !supabaseKey || !fireworksApiKey) {
      throw new Error("Missing environment variables.");
    }

    // Using service role to bypass RLS since this is a backend process
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json().catch(() => ({}));
    const { email_id } = body;

    // Fetch pending emails
    let query = supabase.from('raw_emails').select('*').eq('status', 'pending_ai');
    if (email_id) {
      query = query.eq('id', email_id);
    }
    const { data: emails, error: fetchError } = await query.limit(10);

    if (fetchError) throw fetchError;
    if (!emails || emails.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No pending emails to process.' }), { headers: corsHeaders })
    }

    const systemPrompt = `You are an expert construction email classifier and data extractor.
You will be given the SUBJECT, SENDER, and BODY of an email.

TASK 1: CLASSIFICATION
Categorize the email into EXACTLY ONE of these categories: 'Bid Request', 'RFI', 'Change Order', 'Submittal', 'Invoice', 'General'.

TASK 2: EXTRACTION
Extract the following structured fields:
- project_name (string or null)
- project_number (string or null)
- due_date (ISO date string or null)
- company_sender (string or null)
- address (string or null)
- scope_description (short string summary or null)
- dollar_amount (numeric value or null)

OUTPUT FORMAT:
You MUST return ONLY raw valid JSON (no markdown formatting, no backticks, no extra text).
{
  "category": "Bid Request",
  "confidence_score": 95,
  "fields": {
    "project_name": null,
    "project_number": null,
    "due_date": null,
    "company_sender": null,
    "address": null,
    "scope_description": null,
    "dollar_amount": null
  }
}`

    const results = [];

    for (const email of emails) {
      const userPrompt = `SUBJECT: ${email.subject}\nSENDER: ${email.sender}\nBODY:\n${email.body}`;
      
      try {
        const aiResponseRaw = await callAI(systemPrompt, userPrompt, fireworksApiKey);
        
        let aiResponse;
        try {
           aiResponse = JSON.parse(aiResponseRaw.replace(/```json|```/g, '').trim());
        } catch (e) {
           console.error("Failed to parse AI JSON:", aiResponseRaw);
           throw new Error("Invalid AI JSON format");
        }

        // Insert Classification
        const { data: classification, error: classError } = await supabase
          .from('email_classifications')
          .insert({
            email_id: email.id,
            category: aiResponse.category,
            confidence_score: aiResponse.confidence_score
          })
          .select('id')
          .single();

        if (classError) throw classError;

        // Insert Extracted Fields
        const { error: fieldsError } = await supabase
          .from('extracted_fields')
          .insert({
            email_id: email.id,
            fields: aiResponse.fields
          });
          
        if (fieldsError) throw fieldsError;

        // Insert Review Queue
        const { error: reviewError } = await supabase
          .from('review_queue')
          .insert({
            email_id: email.id,
            classification_id: classification.id,
            status: 'pending'
          });

        if (reviewError) throw reviewError;

        // Update raw_email status
        await supabase.from('raw_emails').update({ status: 'classified' }).eq('id', email.id);

        results.push({ email_id: email.id, status: 'success' });
      } catch (err) {
        console.error(`Failed to process email ${email.id}:`, err);
        await supabase.from('raw_emails').update({ status: 'failed' }).eq('id', email.id);
        results.push({ email_id: email.id, status: 'failed', error: err.message });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("AI processing error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

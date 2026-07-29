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
      temperature: 0.3, // Slightly higher temp for more natural email language
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const fireworksApiKey = Deno.env.get('FIREWORKS_API_KEY')
    const nylasApiKey = Deno.env.get('NYLAS_API_KEY')

    if (!supabaseUrl || !supabaseKey || !fireworksApiKey || !nylasApiKey) {
      throw new Error("Missing environment variables.");
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Fetch pending follow-ups (Day 2)
    const { data: day2Followups, error: day2Error } = await supabase
      .from('estimate_followups')
      .select('*, estimates(*)')
      .eq('status', 'pending')
      .lte('day_2_scheduled_at', new Date().toISOString())
      .not('nylas_grant_id', 'is', null)
      .limit(10);

    // 2. Fetch Day 7 follow-ups
    const { data: day7Followups, error: day7Error } = await supabase
      .from('estimate_followups')
      .select('*, estimates(*)')
      .eq('status', 'day_2_sent')
      .lte('day_7_scheduled_at', new Date().toISOString())
      .not('nylas_grant_id', 'is', null)
      .limit(10);

    if (day2Error) console.error("Error fetching Day 2 followups:", day2Error);
    if (day7Error) console.error("Error fetching Day 7 followups:", day7Error);

    const allFollowups = [
      ...(day2Followups?.map(f => ({ ...f, stage: 'day_2' })) || []),
      ...(day7Followups?.map(f => ({ ...f, stage: 'day_7' })) || [])
    ];

    if (allFollowups.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No pending follow-ups to process.' }), { headers: corsHeaders })
    }

    const results = [];

    for (const followup of allFollowups) {
      try {
        const estimate = followup.estimates;
        const grantId = followup.nylas_grant_id;

        // Generate AI Prompt
        let systemPrompt = "";
        let subject = "";

        if (followup.stage === 'day_2') {
          systemPrompt = `You are a professional construction contractor following up on an estimate you sent 2 days ago.
Write a polite, short, professional check-in asking if the client had a chance to review the estimate and if they have any questions.
The estimate number is ${estimate.estimate_number || 'attached'}. The total amount was $${estimate.total_amount}.
Output ONLY the email body. Do not include subject line or greetings like [Client Name] if you don't know it. Keep it very concise (2-3 sentences).`;
          subject = `Checking in: Estimate ${estimate.estimate_number || ''}`;
        } else {
          systemPrompt = `You are a professional construction contractor following up on an estimate you sent a week ago.
Write a final gentle check-in asking if they have made a decision regarding the project timeline or if they decided to go another direction.
The estimate number is ${estimate.estimate_number || 'attached'}. The total amount was $${estimate.total_amount}.
Output ONLY the email body. Keep it very professional and concise (2-3 sentences).`;
          subject = `Following up: Estimate ${estimate.estimate_number || ''}`;
        }

        const userPrompt = "Generate the follow-up email body.";
        let emailBody = await callAI(systemPrompt, userPrompt, fireworksApiKey);
        
        // Clean up any potential markdown from AI
        emailBody = emailBody.replace(/```text|```/g, '').trim();

        // Send via Nylas API
        const nylasRes = await fetch(`https://api.us.nylas.com/v3/grants/${grantId}/messages/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${nylasApiKey}`
            },
            body: JSON.stringify({
              subject: subject,
              body: emailBody,
              to: [{ email: followup.client_email.trim() }]
            })
        });

        if (!nylasRes.ok) {
            const errText = await nylasRes.text();
            throw new Error(`Nylas API Error: ${errText}`);
        }

        // Update Database Status
        const newStatus = followup.stage === 'day_2' ? 'day_2_sent' : 'day_7_sent';
        await supabase
            .from('estimate_followups')
            .update({ status: newStatus })
            .eq('id', followup.id);

        results.push({ id: followup.id, status: 'success', stage: followup.stage });
      } catch (err) {
        console.error(`Failed to process followup ${followup.id}:`, err);
        results.push({ id: followup.id, status: 'failed', error: err.message });
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

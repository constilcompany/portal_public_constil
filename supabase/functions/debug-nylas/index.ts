import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const nylasApiKey = Deno.env.get('NYLAS_API_KEY');
  const nylasGrantId = "4b4a3a60-dfa0-4ff6-8c45-2079361665e8"; // Assuming from webhook payload

  if (!nylasApiKey) {
    return new Response(JSON.stringify({ error: "Missing NYLAS_API_KEY" }), { status: 500, headers: corsHeaders });
  }

  try {
    const url = `https://api.us.nylas.com/v3/grants/${nylasGrantId}/messages?limit=5`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nylasApiKey}`
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Nylas API failed", status: response.status, body: await response.text() }), { status: 500, headers: corsHeaders });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

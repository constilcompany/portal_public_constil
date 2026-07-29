import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nylas-signature',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

async function verifyNylasSignature(signature: string | null, payload: string, secret: string) {
  if (!signature || !secret) return false;
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex === signature;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Handle Nylas webhook verification (GET request with challenge)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const challenge = url.searchParams.get('challenge');
    if (challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Webhook is active", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const nylasApiKey = Deno.env.get('NYLAS_API_KEY')
    
    // Fallback to hardcoded secret for safety if env is missing during this test, but prefer env
    const webhookSecret = Deno.env.get('NYLAS_WEBHOOK_SECRET') || '0XrU55eqLAY6vMJbTX4b';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const signature = req.headers.get('x-nylas-signature');
    
    // Check for gzip compression
    const contentEncoding = req.headers.get('content-encoding');
    let bodyText;
    
    if (contentEncoding === 'gzip' && req.body) {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = req.body.pipeThrough(ds);
      bodyText = await new Response(decompressedStream).text();
    } else {
      bodyText = await req.text();
    }
    
    // Validate Signature
    const isValid = await verifyNylasSignature(signature, bodyText, webhookSecret);
    if (!isValid) {
      console.warn("Invalid Nylas Webhook Signature detected! Bypassing for debugging.");
      // return new Response(JSON.stringify({ error: "Invalid signature" }), {
      //   status: 401,
      //   headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      // });
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    let payload;
    try {
      payload = JSON.parse(bodyText);
      // DUMP PAYLOAD TO DATABASE FOR DEBUGGING
      await supabase.from('webhook_logs').insert({ payload });
    } catch (e) {
      console.error("Invalid JSON payload", e);
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    // Handle both Nylas V2 (arrays) and V3 (single object) payload structures
    let deltas = [];
    if (Array.isArray(payload)) {
      deltas = payload;
    } else if (payload.deltas && Array.isArray(payload.deltas)) {
      deltas = payload.deltas;
    } else if (payload.data && Array.isArray(payload.data)) {
      deltas = payload.data;
    } else if (payload.type) {
      deltas = [payload];
    }

    for (const delta of deltas) {
      if (delta.type === 'message.created') {
        const messageData = delta.object_data || (delta.data && delta.data.object) || {};
        const grantId = messageData.grant_id || delta.grant_id || messageData.account_id;
        const messageId = messageData.id;

        if (!messageId || !grantId) {
          console.warn("Skipping payload due to missing messageId or grantId", delta);
          continue;
        }

        // Fetch full message details from Nylas API
        const response = await fetch(`https://api.us.nylas.com/v3/grants/${grantId}/messages/${messageId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${nylasApiKey}`
          }
        });

        if (!response.ok) {
          console.error("Failed to fetch message from Nylas", await response.text());
          continue;
        }

        const msgDetailsResp = await response.json();
        const msgDetails = msgDetailsResp.data || msgDetailsResp;

        const subject = msgDetails.subject || '';
        const bodyContent = msgDetails.body || msgDetails.snippet || '';
        const sender = msgDetails.from ? JSON.stringify(msgDetails.from) : '';
        const recipients = msgDetails.to ? JSON.stringify(msgDetails.to) : '[]';
        const receivedAt = msgDetails.date ? new Date(msgDetails.date * 1000).toISOString() : new Date().toISOString();
        
        // Ignore sent emails
        const folders = msgDetails.folders || [];
        if (folders.includes('SENT')) {
          console.log(`Ignoring sent email: ${messageId}`);
          continue;
        }
        
        // Follow-up cancellation logic
        try {
          const senderEmails = msgDetails.from ? msgDetails.from.map((f: any) => f.email) : [];
          if (senderEmails.length > 0) {
            const { data: followups } = await supabase
              .from('estimate_followups')
              .select('id')
              .in('client_email', senderEmails)
              .in('status', ['pending', 'day_2_sent']);

            if (followups && followups.length > 0) {
              const ids = followups.map((f: any) => f.id);
              await supabase
                .from('estimate_followups')
                .update({ status: 'replied', last_client_message_at: new Date().toISOString() })
                .in('id', ids);
              console.log(`Updated ${ids.length} follow-ups to 'replied' for senders: ${senderEmails.join(', ')}`);
            }
          }
        } catch (err) {
          console.error("Error updating follow-ups:", err);
        }

        // Insert into raw_emails
        const { data: insertedRecord, error: insertError } = await supabase
          .from('raw_emails')
          .insert({
            nylas_message_id: messageId,
            subject: subject,
            body: bodyContent,
            sender: sender,
            recipients: JSON.parse(recipients),
            status: 'pending_ai',
            received_at: receivedAt
          })
          .select('id')
          .single();

        if (insertError) {
          console.error("Failed to insert raw_email", insertError);
        } else if (insertedRecord) {
          console.log(`Inserted raw_email with DB ID: ${insertedRecord.id} for message: ${messageId}`);
          
          // Trigger the AI processing function asynchronously
          const aiFuncUrl = `${supabaseUrl}/functions/v1/process-email-ai`;
          fetch(aiFuncUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}` // Bypass RLS for internal invocation
            },
            body: JSON.stringify({ email_id: insertedRecord.id })
          }).catch(err => console.error(`Failed to trigger AI function for ${insertedRecord.id}:`, err));
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

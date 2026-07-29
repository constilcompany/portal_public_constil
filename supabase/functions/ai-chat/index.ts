import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 200)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const fireworksApiKey = Deno.env.get('FIREWORKS_API_KEY')

    const supabase = createClient(supabaseUrl!, supabaseKey!)

    // Auth check
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 200)

    const body = await req.json()
    const { action, estimate_page_id } = body
    
    // Only fetch page data for chat-related actions
    let pageData = null;
    if (['chat', 'apply', 'history'].includes(action)) {
      if (!estimate_page_id) return json({ error: 'estimate_page_id is required for this action' }, 200)

      // Get current estimate data
      const { data, error: pageError } = await supabase
        .from('ai_estimate_results')
        .select('*, ai_estimates(*)')
        .eq('id', estimate_page_id)
        .single()

      if (pageError || !data) return json({ error: 'Estimate page not found' }, 200)
      pageData = data;
    }

    // --- Helper: Call Fireworks (matches your Construction_agent.py setup) ---
    const callAI = async (systemPrompt: string, userPrompt: string, model = "accounts/fireworks/models/gpt-oss-120b") => {
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

    // --- Action: CHAT (Mirrors create_Chat in Django) ---
    if (action === 'chat') {
      const { query } = body
      if (!query) return json({ error: 'query is required' }, 200)

      const qa_system_prompt = `You are a helpful, data-bound Construction Cost Estimation Assistant.
      You are provided with a single source of truth called **ESTIMATE DATA** (in Markdown format).
      
      ESTIMATE DATA:
      ${pageData.output_markdown}

      CORE RULES:
      1. For questions asking about quantities, costs, or other details of the estimate, answer ONLY using information explicitly present in the ESTIMATE DATA. Use exact wording, quantities, and costs.
      2. If the user is asking to modify, change, update, increase, decrease, adjust, or edit any value (like wastage, quantity, cost, unit price, labor, material, etc.) for a specific item:
         a. Check if the item (matching by name or description, e.g., 'Ceiling Paint (2 Coats)') is present in the ESTIMATE DATA.
         b. If the item is present, acknowledge the request, state what change you will make, and instruct the user to click the "Apply to Sheet" button at the top to apply the change. For example: "I will update the wastage for 'Ceiling Paint (2 Coats)' from 5% to 6%. Please click 'Apply to Sheet' to save these changes."
         c. If the item is NOT present in the ESTIMATE DATA, respond with: "The provided estimate doesn't contain information about this."
      3. If info is missing for a general question, respond with: "The provided estimate doesn't contain information about this."`

      const responseText = await callAI(qa_system_prompt, query)

      // Save to history (Mirrors Django model save)
      const { data: chatRecord, error: insertError } = await supabase
        .from('ai_estimate_chatbot')
        .insert({
          estimate_page_id,
          user_id: user.id,
          query,
          response: { text: responseText }
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Return exact format expected by frontend
      return json({
        status: true,
        data: chatRecord
      })
    }

    // --- Action: APPLY (Mirrors construct_chat in Django) ---
    if (action === 'apply') {
      const { conversation_history, query: user_query } = body
      console.log("[APPLY] Request body:", JSON.stringify(body));

      // Extract last user message as fallback user_query
      let finalQuery = user_query;
      if (!finalQuery && conversation_history?.messages && conversation_history.messages.length > 0) {
        const lastMsg = conversation_history.messages[conversation_history.messages.length - 1];
        finalQuery = lastMsg.human;
      }
      console.log("[APPLY] Final Query to apply:", finalQuery);
      
      const modifierPrompt = `You are an expert construction estimator. Your task is to apply specific modifications to a construction estimate based on a user's request.
      
      USER REQUEST: ${finalQuery || 'Apply changes from history'}
      HISTORY: ${JSON.stringify(conversation_history)}
      CURRENT ESTIMATE DATA (JSON): ${JSON.stringify(pageData.output_json)}
      CURRENT ESTIMATE TEXT (MARKDOWN): ${pageData.output_markdown}
      
      INSTRUCTIONS:
      1. Analyze the request and identify which items, quantities, or costs need to change.
      2. Modify the "CURRENT ESTIMATE DATA (JSON)" to reflect these changes.
      3. CRITICAL: KEEP ALL OTHER DATA INTACT. Do not remove tables or rows that weren't mentioned.
      4. Update the "updated_markdown" text to match the new JSON data.
      5. If no changes are needed, set "requires_changes" to false.
      6. Return ONLY the result in this JSON format:
      {
        "requires_changes": true,
        "final_output": { "tables": [...] },
        "updated_markdown": "..."
      }`;

      console.log("[APPLY] Calling AI with modifierPrompt...");
      const aiResponse = await callAI("You are a JSON generator. Return only raw JSON.", modifierPrompt)
      console.log("[APPLY] Raw AI Response:", aiResponse);

      let result;
      try {
        result = JSON.parse(aiResponse.replace(/```json|```/g, '').trim())
        console.log("[APPLY] Parsed JSON result:", JSON.stringify(result));
      } catch (parseErr) {
        console.error("[APPLY] JSON Parse Error:", parseErr.message);
        throw new Error(`Failed to parse AI response: ${parseErr.message}`);
      }

      if (result.requires_changes && result.final_output) {
        console.log("[APPLY] Applying changes to database...");
        const { data: updatedPage, error: updateError } = await supabase
          .from('ai_estimate_results')
          .update({
            output_json: result.final_output,
            output_markdown: result.updated_markdown
          })
          .eq('id', estimate_page_id)
          .select()
          .single()

        if (updateError) {
          console.error("[APPLY] Database Update Error:", JSON.stringify(updateError));
          throw updateError;
        }

        console.log("[APPLY] Database updated successfully.");
        return json({
          status: true,
          massage: "updated", // Matching the typo in your Django response!
          ai_response: updatedPage
        })
      }

      console.log("[APPLY] No changes required according to AI result.");
      return json({
        status: true,
        action: "chat",
        message: "No changes were made to the estimate.",
        ai_response: null
      }, 402) // Matching your Django status code 402
    }

    // --- Action: HISTORY ---
    if (action === 'history') {
      const { data } = await supabase
        .from('ai_estimate_chatbot')
        .select('*')
        .eq('estimate_page_id', estimate_page_id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
      return json({ status: true, data })
    }

    // --- Action: SUMMARIZE-EMAIL ---
    if (action === 'summarize-email') {
      const { emailBody, attachmentsInfo } = body;
      const systemPrompt = `You are a concise email summarizer. Summarize the following email clearly and briefly in 2-4 sentences. If there are attachments listed in 'Attachments Info', explicitly mention what they are at the end of your summary. Do not output anything other than the summary.`;
      const userPrompt = `Email Content:\n${emailBody}\n\nAttachments Info: ${attachmentsInfo || 'None'}`;
      
      const summary = await callAI(systemPrompt, userPrompt);
      return json({ status: true, summary });
    }

    // --- Action: SEND-EMAIL ---
    if (action === 'send-email') {
      const { email, subject, pdfBase64, projectId } = body
      if (!email) return json({ error: 'email is required' }, 200)
      if (!pdfBase64) return json({ error: 'pdfBase64 is required' }, 200)

      const sendGridApiKey = Deno.env.get('SENDGRID_API_KEY')
      if (!sendGridApiKey) {
        return json({ error: 'SENDGRID_API_KEY secret is not set in Supabase Edge Function environment.' }, 200)
      }

      console.log(`[SEND-EMAIL] Sending email to ${email} for project ${projectId}...`);

      const sendGridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sendGridApiKey}`
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: email.trim() }],
              subject: subject || `Construction Proposal & Budget Estimate - Project #${projectId || 'Estimate'}`
            }
          ],
          from: {
            email: 'support@constil.com',
            name: 'CONSTIL Estimating Portal'
          },
          content: [
            {
              type: 'text/html',
              value: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background-color: #ffffff;">
                  <h2 style="color: #448AFF; margin-top: 0; font-size: 20px; border-bottom: 2px solid #edf2f7; padding-bottom: 12px;">Construction Proposal & Budget Estimate</h2>
                  <p>Hello,</p>
                  <p>We are pleased to submit our construction proposal and budget estimate for project <strong>#${projectId || 'Estimate'}</strong>.</p>
                  <p>A detailed professional PDF copy has been generated and attached to this email for your review and sign-off.</p>
                  <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 20px 0;" />
                  <p style="font-size: 11px; color: #718096; text-align: center;">Sent securely via CONSTIL Estimating Portal.</p>
                </div>
              `
            }
          ],
          attachments: [
            {
              content: pdfBase64,
              filename: `Proposal_${projectId || 'Estimate'}.pdf`,
              type: 'application/pdf',
              disposition: 'attachment'
            }
          ]
        })
      })

      if (!sendGridResponse.ok) {
        const errText = await sendGridResponse.text()
        console.error("[SENDGRID ERROR] Response:", errText)
        return json({ error: `SendGrid API error: ${sendGridResponse.status} - ${errText}` }, 200)
      }

      return json({ status: true, message: 'Email sent successfully via SendGrid' })
    }

    // --- Action: NYLAS-EXCHANGE-CODE ---
    if (action === 'nylas-exchange-code') {
      const { code, clientId, redirectUri } = body
      if (!code || !clientId || !redirectUri) return json({ error: 'Missing required parameters for Nylas Auth' }, 200)

      const nylasApiKey = Deno.env.get('NYLAS_API_KEY')
      if (!nylasApiKey) return json({ error: 'NYLAS_API_KEY secret is not set.' }, 200)

      const response = await fetch('https://api.us.nylas.com/v3/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: nylasApiKey,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error("[NYLAS ERROR] Token Exchange:", errText)
        return json({ error: `Nylas API error: ${response.status} - ${errText}` }, 200)
      }

      const data = await response.json()
      return json({ status: true, grant_id: data.grant_id })
    }

    // --- Action: NYLAS-SEND-EMAIL ---
    if (action === 'nylas-send-email') {
      const { grantId, toEmail, subject, bodyText, pdfBase64, fileName, attachments } = body
      if (!grantId || !toEmail) return json({ error: 'Missing required parameters for sending email' }, 200)

      const nylasApiKey = Deno.env.get('NYLAS_API_KEY')
      if (!nylasApiKey) return json({ error: 'NYLAS_API_KEY secret is not set.' }, 200)

      let finalAttachments = attachments || []
      if (pdfBase64 && fileName) {
        finalAttachments.push({
          filename: fileName,
          content: pdfBase64,
          content_type: 'application/pdf'
        })
      }

      const response = await fetch(`https://api.us.nylas.com/v3/grants/${grantId}/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${nylasApiKey}`
        },
        body: JSON.stringify({
          subject: subject || 'Construction Proposal & Estimate',
          body: bodyText || 'Please find your estimate attached.',
          to: [{ email: toEmail.trim() }],
          attachments: finalAttachments.length > 0 ? finalAttachments : undefined
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error("[NYLAS ERROR] Send Email:", errText)
        return json({ error: `Nylas API error: ${response.status} - ${errText}` }, 200)
      }

      const data = await response.json()
      return json({ status: true, message: 'Email sent successfully via Nylas', data })
    }

    // --- Action: NYLAS-GET-EMAILS ---
    if (action === 'nylas-get-emails') {
      const { grantId, folder = 'INBOX', limit = 20 } = body
      if (!grantId) return json({ error: 'Missing required parameters for getting emails' }, 200)

      const nylasApiKey = Deno.env.get('NYLAS_API_KEY')
      if (!nylasApiKey) return json({ error: 'NYLAS_API_KEY secret is not set.' }, 200)

      const url = new URL(`https://api.us.nylas.com/v3/grants/${grantId}/messages`)
      url.searchParams.append('limit', limit.toString())
      if (folder) {
        url.searchParams.append('in', folder)
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${nylasApiKey}`
        }
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error("[NYLAS ERROR] Get Emails:", errText)
        return json({ error: `Nylas API error: ${response.status} - ${errText}` }, 200)
      }

      const data = await response.json()
      
      const CRITICAL_CONSTRUCTION_KEYWORDS = [
        'quote', 'quotation', 'estimate', 'estimated cost', 'cost estimate', 'pricing', 'price', 'price request', 'pricing request', 'cost', 'budget', 'proposal', 'request for proposal', 'rfp', 'rfq', 'request for quotation', 'request for quote', 'bid', 'bidding', 'tender', 'invitation to bid', 'itb', 'scope of work', 'sow', 'work request', 'project inquiry', 'new project', 'project request', 'cost breakdown', 'pricing sheet', 'competitive quote',
        'invoice', 'tax invoice', 'proforma invoice', 'bill', 'billing', 'payment', 'payment request', 'payment due', 'past due', 'balance due', 'statement', 'receipt', 'paid', 'payment confirmation', 'deposit', 'advance payment', 'final payment', 'progress payment', 'milestone payment', 'remittance', 'remittance advice', 'wire transfer', 'ach', 'bank transfer', 'purchase', 'purchase order', 'po', 'po number', 'credit memo', 'debit memo',
        'construction', 'renovation', 'remodel', 'remodelling', 'remodeling', 'extension', 'addition', 'new build', 'custom home', 'commercial project', 'residential project', 'tenant improvement', 'fit out', 'fit-out', 'civil works', 'site work', 'excavation', 'foundation', 'roofing', 'framing', 'drywall', 'flooring', 'painting', 'electrical', 'plumbing', 'hvac', 'concrete', 'masonry', 'landscaping', 'demolition', 'structural', 'engineering', 'architect', 'architectural', 'blueprint', 'drawing', 'plans', 'permit', 'inspection', 'building permit', 'site visit', 'walkthrough', 'consultation',
        'schedule', 'site visit', 'inspection', 'meeting', 'appointment', 'availability', 'start date', 'completion date', 'timeline', 'eta', 'kickoff', 'mobilization', 'project start', 'construction schedule', 'site meeting', 'progress meeting', 'follow up', 'follow-up',
        'looking for', 'need a contractor', 'need estimate', 'need quote', 'interested', 'interested in', 'can you quote', 'can you estimate', 'please quote', 'please estimate', 'price this', 'pricing for', 'cost for', 'looking to build', 'looking to renovate', 'project details', 'job request', 'service request', 'work required', 'need pricing',
        'material order', 'supplier', 'vendor', 'subcontractor', 'procurement', 'equipment', 'materials', 'delivery', 'shipment', 'backorder', 'inventory', 'stock',
        'contract', 'agreement', 'signed', 'signature', 'execute', 'terms', 'conditions', 'change order', 'variation', 'work order', 'service agreement', 'contractor agreement',
        'drawing', 'blueprint', 'cad', 'autocad', 'pdf plans', 'site plan', 'elevation', 'floor plan', 'permit', 'engineering drawings', 'architectural drawings', 'structural drawings', 'specifications', 'specs', 'boq', 'bill of quantities', 'takeoff', 'material list',
        'budget', 'financing', 'loan', 'cost analysis', 'cash flow', 'expense', 'expense report', 'pricing approval', 'budget approval', 'approval', 'approved',
        'progress', 'update', 'project update', 'status update', 'inspection passed', 'inspection failed', 'completed', 'completion', 'substantial completion', 'handover', 'punch list', 'snag list', 'delay', 'change request', 'variation request',
        'estimate.pdf', 'quote.pdf', 'quotation.pdf', 'proposal.pdf', 'invoice.pdf', 'drawing.pdf', 'blueprint.pdf', 'plans.pdf', 'contract.pdf', 'agreement.pdf', 'boq.xlsx', 'takeoff.xlsx', 'pricing.xlsx', 'scope.pdf',
        'can you provide a quote', 'can you send a quote', 'need an estimate', 'need pricing', 'can you bid', 'request for quotation', 'request for estimate', 'please review attached plans', 'please quote', 'need contractor', 'looking for contractor', 'please provide proposal', 'can you price this project', 'can you estimate this project', 'need cost breakdown',
        'general contractor', 'gc', 'subcontractor', 'roofing', 'electrical', 'plumbing', 'hvac', 'painting', 'drywall', 'flooring', 'cabinet', 'concrete', 'foundation', 'excavation', 'framing', 'steel', 'landscaping', 'tiling', 'insulation', 'windows', 'doors', 'solar', 'fencing', 'paving', 'asphalt', 'masonry'
      ];

      const escapeRegExp = (string: string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      };

      const filteredMessages = (data.data || []).filter((msg: any) => {
        const subject = (msg.subject || '').toLowerCase();
        const rawBody = msg.body || msg.snippet || '';
        
        // 1. Strip HTML tags from the body so we don't accidentally match attributes like class="quote"
        const noHtmlBody = rawBody.replace(/<[^>]*>?/gm, ' ');

        // 2. Truncate email reply history (extract only the latest active message)
        const splitRegex = /_|<hr>|---Original Message---|From:|On\s+.*?\s+wrote:/i;
        const activeBody = noHtmlBody.split(splitRegex)[0].toLowerCase();
        
        // 2. Strict whole-word boundary matching
        return CRITICAL_CONSTRUCTION_KEYWORDS.some(kw => {
          const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
          return regex.test(subject) || regex.test(activeBody);
        });
      });

      return json({ status: true, messages: filteredMessages })
    }

    // --- Action: NYLAS-REPLY-EMAIL ---
    if (action === 'nylas-reply-email') {
      const { grantId, messageId, toEmail, subject, bodyText, attachments } = body
      if (!grantId || !messageId || !toEmail || !bodyText) return json({ error: 'Missing required parameters for replying' }, 200)

      const nylasApiKey = Deno.env.get('NYLAS_API_KEY')
      if (!nylasApiKey) return json({ error: 'NYLAS_API_KEY secret is not set.' }, 200)

      const payload: any = {
        subject: subject || 'Re:',
        body: bodyText,
        to: [{ email: toEmail.trim() }],
        reply_to_message_id: messageId
      }
      if (attachments && attachments.length > 0) {
        payload.attachments = attachments;
      }

      const response = await fetch(`https://api.us.nylas.com/v3/grants/${grantId}/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${nylasApiKey}`
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error("[NYLAS ERROR] Reply Email:", errText)
        return json({ error: `Nylas API error: ${response.status} - ${errText}` }, 200)
      }

      const data = await response.json()
      return json({ status: true, message: 'Reply sent successfully via Nylas', data })
    }

    // --- Action: NYLAS-DOWNLOAD-ATTACHMENT ---
    if (action === 'nylas-download-attachment') {
      const { grantId, attachmentId, messageId } = body
      if (!grantId || !attachmentId) return json({ error: 'Missing required parameters for downloading attachment' }, 200)

      const nylasApiKey = Deno.env.get('NYLAS_API_KEY')
      if (!nylasApiKey) return json({ error: 'NYLAS_API_KEY secret is not set.' }, 200)

      let url = `https://api.us.nylas.com/v3/grants/${grantId}/attachments/${attachmentId}/download`
      if (messageId) url += `?message_id=${messageId}`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${nylasApiKey}`
        }
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error("[NYLAS ERROR] Download Attachment:", errText)
        return json({ error: `Nylas API error: ${response.status} - ${errText}` }, 200)
      }

      const arrayBuffer = await response.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const chunks = []
      for (let i = 0; i < uint8Array.length; i += 8192) {
        chunks.push(String.fromCharCode.apply(null, Array.from(uint8Array.subarray(i, i + 8192))))
      }
      const base64Data = btoa(chunks.join(''))

      return json({ status: true, data: base64Data, contentType: response.headers.get('content-type') })
    }

    return json({ error: 'Invalid action' }, 200)
  } catch (error) {
    return json({ status: false, error: error.message }, 200)
  }
})

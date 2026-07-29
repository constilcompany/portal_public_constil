import axios from 'axios';

const supabaseUrl = "https://avppbvsxayehguepyjkb.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAzMzk2MiwiZXhwIjoyMDkyNjA5OTYyfQ.IjIDpaxklgfczNpmHlrKAThnGzlECeMwtv9QodFPwZk";
const googleApiKey = "AIzaSyD4roU6eWDW3bPu5VtsakigssjVCZEDwYI";

async function testApply() {
  try {
    // 1. Fetch estimate data
    const pageResponse = await axios.get(`${supabaseUrl}/rest/v1/ai_estimate_results?id=eq.66cd566c-6cc4-4c65-8982-26e8702eb56c`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    const pageData = pageResponse.data[0];
    if (!pageData) {
      console.error("Could not find estimate page");
      return;
    }

    const testHistories = [
      {
        name: "Old History (Rejected by Bot)",
        history: {
          messages: [
            {
              human: "Ceiling Paint (2 Coats)\nchange the Wastage 5% to 6%",
              ai: "The provided estimate doesn't contain information about this."
            }
          ]
        }
      },
      {
        name: "New History (Confirmed by Bot)",
        history: {
          messages: [
            {
              human: "Ceiling Paint (2 Coats)\nchange the Wastage 5% to 6%",
              ai: "I will update the wastage for 'Ceiling Paint (2 Coats)' from 5% to 6%. Please click 'Apply to Sheet' to save these changes."
            }
          ]
        }
      }
    ];

    for (const item of testHistories) {
      console.log(`\n===========================================`);
      console.log(`Testing with: ${item.name}`);
      console.log(`===========================================`);

      const modifierPrompt = `You are an expert construction estimator. Your task is to apply specific modifications to a construction estimate based on a user's request.
      
      USER REQUEST: Apply changes from history
      HISTORY: ${JSON.stringify(item.history)}
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

      const body = {
        contents: [
          {
            role: "user",
            parts: [
              { text: `${modifierPrompt}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.0
        }
      };

      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${googleApiKey}`;
      const res = await axios.post(geminiUrl, body);
      
      if (res.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const text = res.data.candidates[0].content.parts[0].text.trim();
        try {
          const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
          console.log("requires_changes:", parsed.requires_changes);
          if (parsed.requires_changes) {
            console.log("Update success! Ceiling Paint row after change:");
            const paintingTable = parsed.final_output.tables.find(t => t.table_name.includes('PAINTING'));
            console.log(paintingTable?.rows?.find(r => r.Description.includes('Ceiling Paint')));
          }
        } catch (e) {
          console.log("Raw LLM response:", text);
        }
      } else {
        console.log("No response text:", JSON.stringify(res.data));
      }
    }

  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Response:", JSON.stringify(error.response.data));
    }
  }
}

testApply();

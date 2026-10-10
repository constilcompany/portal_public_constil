import json
import time
import anthropic
from typing import Dict, Any
from config import settings 

def generate_proposal_from_invoice(invoice_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Takes raw invoice/estimate JSON and generates a professional sales proposal JSON.
    Returns keys: project_summary, scope_of_work, timeline, warranty, pricing.
    """
    
    system_prompt = """You are an expert construction sales professional and proposal writer. 
Your goal is to convert raw construction estimate data into a highly persuasive, professional client-facing proposal.
Write in a confident, clear, and reassuring tone that builds trust with the homeowner/client."""

    user_prompt = f"""
Here is the raw invoice/estimate JSON data for a project:
{json.dumps(invoice_json, indent=2)}

Please generate a professional proposal based on this data. 
Return ONLY a valid JSON object with the following exact keys. Do not include markdown formatting outside the JSON block.

Required JSON Structure:
{{
  "project_summary": "Write a 2-3 paragraph professional overview of the project, acknowledging the client's property and the overall goal of the work.",
  "scope_of_work": "Write a detailed, bulleted narrative of the work to be performed. Translate technical estimate line items into easy-to-understand client benefits.",
  "timeline": "Provide an estimated project timeline (e.g., 'Project will commence within X weeks of signing and take approximately Y days to complete'). Infer reasonable times based on the scope.",
  "warranty": "Provide a standard professional contractor warranty statement (e.g., 1-year workmanship warranty, manufacturer warranties on materials).",
  "pricing": "Provide a clean, high-level summary of the pricing. You can group items logically so the client isn't overwhelmed by granular line items, and state the final total amount."
}}
"""

    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            print(f"📝 Generating proposal... (Attempt {attempt+1}/{max_retries})")

            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            message = client.messages.create(
                model=settings.anthropic_model,
                max_tokens=16000,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": user_prompt}
                ],
            )
            
            response_text = "".join(b.text for b in message.content if hasattr(b, "text")).strip()
            
            # Clean up markdown code blocks if the model adds them
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1]).strip()
                if response_text.startswith("json"):
                    response_text = response_text[4:].strip()

            # Parse JSON
            proposal_data = json.loads(response_text)
            
            # Validate keys
            required_keys = ["project_summary", "scope_of_work", "timeline", "warranty", "pricing"]
            if all(key in proposal_data for key in required_keys):
                print("✅ Proposal successfully generated!")
                return {
                    "status": "success",
                    "data": proposal_data
                }
            else:
                raise ValueError("Missing required keys in generated JSON.")

        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parsing/validation error on attempt {attempt+1}: {e}")
            time.sleep(2)
            
    return {
        "status": "error",
        "message": "Failed to generate valid proposal JSON after 3 attempts."
    }


# if __name__ == "__main__":
#     with open("claude-opus-4-8_response.json", "r") as f:
#         invoice_json = json.load(f)
#     proposal = generate_proposal_from_invoice(invoice_json, client)
#     with open("test_proposal.json", "w") as f:
#         json.dump(proposal, f, indent=2)
// src/services/nluExtract.js

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function extractFields({ businessName, services, userText }) {
  const serviceNames = (services || []).map(s => s.name);

  const schema = {
    type: "object",
    properties: {
      intent: { 
        type: "string", 
        enum: ["book", "ask_services", "price", "cancel", "other"],
        description: "User's intent"
      },
      service: { 
        type: ["string", "null"],
        description: "Service name if mentioned"
      },
      date: { 
        type: ["string", "null"], 
        description: "YYYY-MM-DD if known" 
      },
      time: { 
        type: ["string", "null"], 
        description: "HH:mm (24h) if known" 
      },
      timezone: { 
        type: ["string", "null"] 
      },
      name: { 
        type: ["string", "null"] 
      },
      email: { 
        type: ["string", "null"] 
      },
      phone: { 
        type: ["string", "null"] 
      },
      confirmation: { 
        type: ["boolean", "null"] 
      }
    },
    required: ["intent", "service", "date", "time", "timezone", "name", "email", "phone", "confirmation"],
    additionalProperties: false
  };

  const sys = `
You extract structured fields from phone speech for ${businessName}.
Services are: ${serviceNames.join(", ") || "none"}.
Rules:
- If user says "intro", map to "30-minute intro call" if present.
- If user says "1 on 1" or "personal training", map to the training service if present.
- If user says something like "330 minute intro call", interpret as "30 minute intro call".
- If user asks "what services", intent=ask_services.
- If user asks "how much", intent=price.
Return ONLY JSON that matches the schema.
`.trim();

  const model = process.env.BOOK8_NLU_MODEL || "gpt-4o-mini";
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userText }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "nlu_extract",
            schema: schema
          }
        },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[nluExtract] OpenAI API error:', error);
      throw new Error('Failed to extract fields');
    }

    const data = await response.json();
    const outputText = data.choices[0].message.content;
    
    // Parse the JSON response
    const result = JSON.parse(outputText);
    
    // Attach usage data if available
    if (data.usage) {
      result._usage = data.usage;
    }
    
    return result;
  } catch (error) {
    console.error('[nluExtract] Error:', error);
    // Return default structure on error
    return {
      intent: "other",
      service: null,
      date: null,
      time: null,
      timezone: null,
      name: null,
      email: null,
      phone: null,
      confirmation: null
    };
  }
}


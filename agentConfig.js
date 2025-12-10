// 1) Import business profiles from JSON file
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const businesses = JSON.parse(
  readFileSync(join(__dirname, 'businesses.json'), 'utf-8')
);

// Normalize and export business profiles
// Convert duration to durationMinutes for backward compatibility if needed
export const businessProfiles = Object.fromEntries(
  Object.entries(businesses).map(([key, business]) => [
    key,
    {
      ...business,
      services: business.services.map((service) => ({
        ...service,
        durationMinutes: service.durationMinutes || service.duration || 30,
      })),
    },
  ])
);

// Helper to get profile safely
export function getBusinessProfile(businessId) {
  return businessProfiles[businessId] || businessProfiles["waismofit"];
}

// 2) Build system prompt from a businessId
export function buildSystemPrompt(businessId = "waismofit") {
  const business = businessProfiles[businessId] ?? businessProfiles["waismofit"];

  // Handle both 'name' and 'businessName' fields for compatibility
  const businessName = business.name || business.businessName || "this business";
  
  // Handle both 'duration' and 'durationMinutes' fields for compatibility
  const servicesText = business.services
    .map((s) => {
      const duration = s.duration || s.durationMinutes || 30;
      return `${s.name} (${duration} min)`;
    })
    .join(", ");

  return `
You are the AI receptionist for ${businessName}.
You are talking to callers on the phone in real time.

Rules:
- Speak in short, natural sentences.
- Sound warm, calm, and confident.
- Never use lists, bullets, or markdown.
- Always confirm the key details of any booking (service, date, time, name, phone, email).
- Keep answers to 1–2 sentences.
- Adapt your tone to the business type:
  - For fitness: energetic and motivating.
  - For barbershops: casual and friendly.
  - For spas: calm and soothing.

Business context:
- Timezone: ${business.timezone}
- Services: ${servicesText}
`;
}


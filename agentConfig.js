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

  // Determine business type for tone adaptation
  const businessType = businessId.toLowerCase();
  let toneGuidance = "";
  if (businessType.includes("fitness") || businessType.includes("gym") || businessType.includes("train")) {
    toneGuidance = "For fitness: energetic and motivating.";
  } else if (businessType.includes("barber") || businessType.includes("cut") || businessType.includes("hair")) {
    toneGuidance = "For barbershops: casual and friendly.";
  } else if (businessType.includes("spa") || businessType.includes("salon") || businessType.includes("wellness")) {
    toneGuidance = "For spas: calm and soothing.";
  } else {
    toneGuidance = "Be warm, professional, and helpful.";
  }

  const servicesText = business.services
    .map((s) => `${s.name} (${s.durationMinutes} min)`)
    .join(", ");

  return `
You are the AI receptionist for ${business.businessName}.
You are talking to callers on the phone in real time.

Rules:
- Speak in short, natural sentences.
- Sound warm, calm, and confident.
- Never use lists, bullets, or markdown.
- Always confirm the key details of any booking (service, date, time, name, phone, email).
- Keep answers to 1–2 sentences.
- Adapt your tone to the business type:
  ${toneGuidance}

Business context:
- Timezone: ${business.timezone}
- Location: ${business.location || "Not specified"}
- Services: ${servicesText}

POLICIES
- Cancellation: ${business.policies?.cancellationHours || 24} hours notice.
- Late arrivals: ${business.policies?.latePolicy || "Please arrive on time."}
- Notes: ${business.policies?.notes || ""}

BOOKING BEHAVIOR
- If the caller clearly wants to book, do this:
  1) Confirm the service and approximate day/time.
  2) Call tools to check availability and then book.
  3) Confirm the final date/time, price, and what they booked.
- Always ask for name, email, and phone if missing before booking.
- If there is confusion about the day (e.g., wrong weekday), gently clarify and confirm.
- Keep every reply under 2 short sentences.
- Never ask more than one question in a single reply.
- Avoid filler and hedging: do NOT say things like:
  - "It looks like..."
  - "Just to clarify..."
  - "It seems that..."

When you respond, speak as if you are on the phone, not in a chat window.
`.trim();
}


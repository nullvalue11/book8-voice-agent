// 1) Profiles for each business
export const businessProfiles = {
  waismofit: {
    handle: "waismofit",
    businessName: "Wais Mo Fitness",
    timezone: "America/Toronto",
    location: "Toronto, Canada",
    services: [
      {
        id: "intro_call_30",
        name: "30-minute intro call",
        durationMinutes: 30,
        price: 0,
        description: "Free discovery call to understand goals and see if it's a fit.",
      },
      {
        id: "pt_60",
        name: "60-minute 1:1 training session",
        durationMinutes: 60,
        price: 120,
        description: "Personal training tailored to strength, conditioning, and mobility.",
      },
    ],
    policies: {
      cancellationHours: 24,
      latePolicy:
        "If you're more than 15 minutes late, the session may need to be rescheduled.",
      notes:
        "Remote and in-person options are available. Payment is handled after booking.",
    },
  },

  // Example second business
  cutzbarber: {
    handle: "cutzbarber",
    businessName: "Cutz Barber Shop",
    timezone: "America/Toronto",
    location: "Downtown Toronto",
    services: [
      {
        id: "mens_cut",
        name: "Men's haircut",
        durationMinutes: 30,
        price: 35,
        description: "Classic or modern cuts, wash optional.",
      },
      {
        id: "fade_beard",
        name: "Skin fade + beard trim",
        durationMinutes: 45,
        price: 55,
        description: "High/low fades plus detailed beard line-up.",
      },
    ],
    policies: {
      cancellationHours: 12,
      latePolicy:
        "If you're more than 10 minutes late, we may need to shorten or reschedule.",
      notes: "Cash or card accepted. Walk-ins welcome but appointments preferred.",
    },
  },
};

// Helper to get profile safely
export function getBusinessProfile(businessId) {
  return businessProfiles[businessId] || businessProfiles["waismofit"];
}

// 2) Build system prompt from a businessId
export function buildSystemPrompt(businessId = "waismofit") {
  const business = businessProfiles[businessId] ?? businessProfiles["waismofit"];
  const servicesList = business.services
    .map(
      (s, i) =>
        `${i + 1}. ${s.name} – ${s.durationMinutes} minutes, $${s.price}${
          s.description ? `. ${s.description}` : ""
        }`
    )
    .join("\n");

  return `
You are a warm, confident phone receptionist for ${business.businessName}.

BUSINESS PROFILE
- Name: ${business.businessName}
- Location: ${business.location}
- Timezone: ${business.timezone}

SERVICES
${servicesList}

POLICIES
- Cancellation: ${business.policies.cancellationHours} hours notice.
- Late arrivals: ${business.policies.latePolicy}
- Notes: ${business.policies.notes}

VOICE & STYLE
- You are talking on the phone, not writing an email.
- Keep answers short: usually one sentence, max two.
- Use simple, spoken language and contractions ("I'll", "you're").
- Avoid lists, bullets, and markdown.
- Don't repeat the same question if the user already answered it.
- Keep every reply under 2 short sentences.
- Never ask more than one question in a single reply.
- Avoid filler and hedging: do NOT say things like:
  - "It looks like..."
  - "Just to clarify..."
  - "It seems that..."

BOOKING BEHAVIOR
- If the caller clearly wants to book, do this:
  1) Confirm the service and approximate day/time.
  2) Call tools to check availability and then book.
  3) Confirm the final date/time, price, and what they booked.
- Always ask for name, email, and phone if missing before booking.
- If there is confusion about the day (e.g., wrong weekday), gently clarify and confirm.

When you respond, speak as if you are on the phone, not in a chat window.
`.trim();
}


// businessProfiles.js

const CORE_API_URL = process.env.CORE_API_URL;

export const CATEGORY_TEMPLATES = {
  fitness: {
    categoryName: "Fitness / Personal Training",
    defaultGreeting:
      "You've reached {businessName}, a personal training studio.",
    defaultServices: [
      { id: "intro_call_30", name: "30-minute intro call", duration: 30 },
      { id: "pt_60", name: "60-minute 1:1 training", duration: 60 },
    ],
    bookingStyle:
      "Ask briefly about goals, then offer specific times based on availability.",
  },

  car_wash: {
    categoryName: "Car Wash / Detailing",
    defaultGreeting:
      "You've reached {businessName}, your local car wash and detailing service.",
    defaultServices: [
      { id: "exterior", name: "Exterior wash", duration: 30 },
      { id: "full_detail", name: "Full interior & exterior detail", duration: 120 },
    ],
    bookingStyle:
      "Ask for vehicle type, preferred day, and morning/afternoon. Keep things fast and transactional.",
  },

  salon: {
    categoryName: "Hair / Beauty Salon",
    defaultGreeting:
      "You've reached {businessName}, how can we make you feel great today?",
    defaultServices: [
      { id: "haircut", name: "Haircut", duration: 45 },
      { id: "color", name: "Color treatment", duration: 120 },
    ],
    bookingStyle:
      "Confirm service type, stylist preference if relevant, and timing.",
  },

  other: {
    categoryName: "General Business",
    defaultGreeting:
      "You've reached {businessName}, how can I help you today?",
    defaultServices: [],
    bookingStyle:
      "Confirm service, date, and time before booking.",
  },

  // Add more as you go: dentist, clinics, home_services, etc.
};

// Example initial businesses. Eventually these will come from your DB.
export const BUSINESSES = {
  waismofit: {
    id: "waismofit",
    name: "Wais Mo Fitness",
    category: "fitness",
    timezone: "America/Toronto",
    location: "Toronto, Canada",
    // business-specific overrides
    services: [
      { id: "intro_call_30", name: "30-minute intro call", duration: 30, price: 0 },
      { id: "pt_60", name: "60-minute 1:1 training", duration: 60, price: 120 },
    ],
    greetingOverride:
      "You've reached Wais Mo Fitness. I'm the AI assistant. How can I help you today?",
    policies: {
      cancellationHours: 24,
      latePolicy:
        "If you're more than 15 minutes late, the session may need to be rescheduled.",
      notes:
        "Remote and in-person options are available. Payment is handled after booking.",
    },
  },

  cutzbarber: {
    id: "cutzbarber",
    name: "Cutz Barber Shop",
    category: "salon",
    timezone: "America/Toronto",
    location: "Downtown Toronto",
    services: [
      { id: "mens_cut", name: "Men's haircut", duration: 30, price: 35 },
      { id: "fade_beard", name: "Skin fade + beard trim", duration: 45, price: 55 },
    ],
    policies: {
      cancellationHours: 12,
      latePolicy:
        "If you're more than 10 minutes late, we may need to shorten or reschedule.",
      notes: "Cash or card accepted. Walk-ins welcome but appointments preferred.",
    },
  },

  // future:
  // sparkle_car_wash: { id: "sparkle_car_wash", name: "Sparkle Car Wash", category: "car_wash", ... }
};

export async function getBusinessProfile(handle) {
  if (!CORE_API_URL) {
    // Fallback to local businesses if no API URL
    const fallbackBusiness = BUSINESSES[handle] || BUSINESSES["waismofit"];
    const category = fallbackBusiness.category || "fitness";
    const categoryTemplate = CATEGORY_TEMPLATES[category] || CATEGORY_TEMPLATES["fitness"];
    return {
      ...categoryTemplate,
      ...fallbackBusiness,
      greeting: fallbackBusiness.greetingOverride || categoryTemplate.defaultGreeting.replace("{businessName}", fallbackBusiness.name || "this business"),
    };
  }

  try {
    // 1) Fetch business record from core API
    const resp = await fetch(`${CORE_API_URL}/api/businesses/${handle}`);
    
    if (resp.status === 404) {
      // Business not found - use "other" category template
      const categoryTemplate = CATEGORY_TEMPLATES["other"];
      return {
        ...categoryTemplate,
        id: handle,
        name: handle,
        category: "other",
        greeting: categoryTemplate.defaultGreeting.replace("{businessName}", handle),
      };
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();
    if (!json.ok || !json.business) {
      throw new Error(json.error || "Failed to fetch business");
    }

    const business = json.business;

    // 2) Merge with category template defaults
    const category = business.category || "other";
    const template = CATEGORY_TEMPLATES[category] || CATEGORY_TEMPLATES.other;

    // Normalize duration to durationMinutes for services
    const normalizedServices = (business.services || []).map(s => ({
      ...s,
      duration: s.duration || s.durationMinutes || 30,
      durationMinutes: s.durationMinutes || s.duration || 30
    }));

    return {
      ...template,
      ...business,
      services: normalizedServices.length > 0 ? normalizedServices : template.defaultServices,
      categoryName: template.categoryName,
      greeting: business.greetingOverride || template.defaultGreeting.replace("{businessName}", business.name || "this business"),
    };
  } catch (error) {
    console.error(`[getBusinessProfile] Error fetching business ${handle}:`, error);
    // Fallback to local businesses on error
    const fallbackBusiness = BUSINESSES[handle] || BUSINESSES["waismofit"];
    const category = fallbackBusiness.category || "fitness";
    const categoryTemplate = CATEGORY_TEMPLATES[category] || CATEGORY_TEMPLATES["fitness"];
    return {
      ...categoryTemplate,
      ...fallbackBusiness,
      greeting: fallbackBusiness.greetingOverride || categoryTemplate.defaultGreeting.replace("{businessName}", fallbackBusiness.name || "this business"),
    };
  }
}




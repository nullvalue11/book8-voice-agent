// businessProfiles.js

const BOOK8_CORE_API_URL = process.env.BOOK8_CORE_API_URL;

export async function fetchBusinessById(id) {
  if (!BOOK8_CORE_API_URL) return null;
  try {
    const r = await fetch(`${BOOK8_CORE_API_URL}/api/businesses/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const json = await r.json();
    const business = json?.business || null;
    
    // Debug logging to prove DB is being used
    if (business) {
      const servicesCount = business.services?.length || 0;
      console.log(`[agent] business=${business.id || id} name="${business.name || 'N/A'}" category=${business.category || 'N/A'} services=${servicesCount}`);
    }
    
    return business;
  } catch (error) {
    console.error(`Error fetching business ${id}:`, error);
    return null;
  }
}

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
  // Try to fetch from Core API first
  let business = await fetchBusinessById(handle);
  
  // If API fetch fails, fallback to local BUSINESSES
  if (!business) {
    business = BUSINESSES[handle] || BUSINESSES["waismofit"];
  }
  
  // Get category template (use business.category or default to fitness)
  const category = business.category || "fitness";
  const categoryTemplate =
    CATEGORY_TEMPLATES[category] || CATEGORY_TEMPLATES["fitness"];

  // Merge category template with business data
  const merged = {
    ...categoryTemplate,
    ...business,
    // resolved greeting with {businessName}
    greeting:
      business.greetingOverride ||
      categoryTemplate.defaultGreeting.replace("{businessName}", business.name || "this business"),
  };

  return merged;
}




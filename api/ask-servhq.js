import OpenAI from "openai";
import nodemailer from "nodemailer";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const LEAD_TO_EMAIL = process.env.LEAD_TO_EMAIL || "info@servhq.com.au";

const ALLOWED_ORIGINS = new Set([
  "https://servhq.com.au",
  "https://www.servhq.com.au",
  "https://servhq.myshopify.com",
]);

const SUPPORTED_SERVICES = [
  "cleaning",
  "lawn_mowing",
  "car_detailing",
  "pressure_washing",
  "pest_control",
  "plumbing",
  "electrical",
  "fencing",
  "carpentry",
  "painting",
  "landscaping",
  "handyman",
];

const SERVICE_SYNONYMS = {
  cleaning: [
    "clean",
    "cleaner",
    "cleaning",
    "house clean",
    "bond clean",
    "vacate clean",
    "end of lease clean",
    "office clean",
    "airbnb clean",
    "home cleaned",
    "fortnightly clean",
    "every 2 weeks",
    "every two weeks",
  ],
  lawn_mowing: [
    "lawn",
    "mow",
    "mowing",
    "grass",
    "yard",
    "yard tidy",
    "whipper snip",
    "hedge trimming",
    "garden maintenance",
  ],
  car_detailing: [
    "car detail",
    "detail",
    "detailing",
    "cut and polish",
    "cut & polish",
    "interior detail",
    "paint correction",
    "car cleaning",
  ],
  pressure_washing: [
    "pressure wash",
    "pressure washing",
    "gurney",
    "gurni",
    "water blast",
    "high pressure clean",
    "driveway clean",
    "soft wash",
  ],
  pest_control: [
    "pest",
    "pest control",
    "ants",
    "cockroaches",
    "spiders",
    "termites",
    "rodents",
    "mice",
    "rats",
  ],
  plumbing: [
    "plumber",
    "plumbing",
    "blocked drain",
    "burst pipe",
    "leak",
    "leaking tap",
    "toilet issue",
    "hot water",
    "hot water system",
    "drain issue",
  ],
  electrical: [
    "electrician",
    "electrical",
    "power point",
    "powerpoint",
    "switchboard",
    "lighting",
    "lights",
    "ceiling fan",
    "fan install",
    "smoke alarm",
    "rewiring",
    "sparkie",
  ],
  fencing: [
    "fence",
    "fencing",
    "colorbond",
    "timber fence",
    "gate",
    "boundary fence",
    "pool fence",
  ],
  carpentry: [
    "carpenter",
    "carpentry",
    "deck",
    "framing",
    "skirting",
    "architrave",
    "door repair",
    "shelving",
    "cabinet",
    "pergola",
  ],
  painting: [
    "painter",
    "painting",
    "paint",
    "repaint",
    "interior painting",
    "exterior painting",
    "ceiling paint",
    "wall paint",
  ],
  landscaping: [
    "landscaping",
    "landscape",
    "turf",
    "retaining wall",
    "garden makeover",
    "garden design",
    "mulch",
    "paving",
    "irrigation",
  ],
  handyman: [
    "handyman",
    "odd jobs",
    "small jobs",
    "repairs around the house",
    "bits and pieces",
    "maintenance jobs",
    "fix a few things",
  ],
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeJsonParse(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_) {
    const cleaned = String(value)
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        } catch (_) {
          return null;
        }
      }

      return null;
    }
  }
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: String(m.content || ""),
    }));
}

function historyForModel(history) {
  return history.filter(
    (m) => !String(m.content || "").startsWith("[LEAD_SUBMITTED]")
  );
}

function buildConversationText(history, latestUserMessage = "") {
  const lines = [];

  for (const msg of history) {
    if (String(msg.content || "").startsWith("[LEAD_SUBMITTED]")) continue;
    lines.push(`${msg.role.toUpperCase()}: ${msg.content}`);
  }

  if (latestUserMessage) {
    lines.push(`USER: ${latestUserMessage}`);
  }

  return lines.join("\n");
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "Not provided";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildEmailHtml(lead, transcript) {
  const commonFields = [
    ["Service", lead.service],
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Address", lead.address],
  ];

  const serviceFields = [
    ["Job type", lead.job_type],
    ["Job details", lead.job_details],
    ["Preferred date/time", lead.preferred_datetime],
    ["Estimated price range", lead.quote_range || ""],
  ];

  const rows = [...commonFields, ...serviceFields]
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:10px 12px;border:1px solid #ddd;font-weight:600;background:#f7f7f7;">${escapeHtml(
            label
          )}</td>
          <td style="padding:10px 12px;border:1px solid #ddd;">${escapeHtml(
            formatValue(value)
          )}</td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;">
      <h2 style="margin:0 0 16px;">New ServHQ Lead</h2>

      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">
        ${rows}
      </table>

      <h3 style="margin:0 0 10px;">Conversation transcript</h3>
      <div style="white-space:pre-wrap;border:1px solid #ddd;padding:14px;border-radius:8px;background:#fafafa;">${escapeHtml(
        transcript
      )}</div>
    </div>
  `;
}

function buildEmailText(lead, transcript) {
  const lines = [
    "New ServHQ Lead",
    "",
    `Service: ${formatValue(lead.service)}`,
    `Name: ${formatValue(lead.name)}`,
    `Phone: ${formatValue(lead.phone)}`,
    `Email: ${formatValue(lead.email)}`,
    `Address: ${formatValue(lead.address)}`,
    `Job type: ${formatValue(lead.job_type)}`,
    `Job details: ${formatValue(lead.job_details)}`,
    `Preferred date/time: ${formatValue(lead.preferred_datetime)}`,
    `Estimated price range: ${formatValue(lead.quote_range)}`,
    "",
    "Conversation transcript:",
    transcript,
  ];

  return lines.join("\n");
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function validateSmtpConfig() {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}

async function sendLeadEmail(lead, transcript) {
  const smtpCheck = validateSmtpConfig();

  if (!smtpCheck.valid) {
    throw new Error(`Missing SMTP env vars: ${smtpCheck.missing.join(", ")}`);
  }

  const transporter = getTransporter();
  const subjectService = lead.service
    ? lead.service.replace(/_/g, " ")
    : "service request";

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: LEAD_TO_EMAIL,
    replyTo: lead.email || undefined,
    subject: `New ServHQ ${subjectService} lead - ${lead.name || "No name"}`,
    text: buildEmailText(lead, transcript),
    html: buildEmailHtml(lead, transcript),
  });
}

function emptyLead() {
  return {
    service: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    job_type: "",
    job_details: "",
    preferred_datetime: "",
    quote_range: "",
  };
}

function toLower(value) {
  return String(value || "").toLowerCase();
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  if (digits.length === 11 && digits.startsWith("61")) return `0${digits.slice(2)}`;
  return digits;
}

function normalizeEmail(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  let cleaned = raw
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "");

  cleaned = cleaned.replace(/,+/g, ".").replace(/;+?/g, ".");

  const emailMatch = cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return emailMatch ? emailMatch[0].toLowerCase() : cleaned;
}

function isLikelyValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function findBedroomCount(text) {
  const match = String(text || "").match(/(\d+)\s*(bed|beds|bedroom|bedrooms)\b/i);
  return match ? Number(match[1]) : null;
}

function detectServiceFromText(text) {
  const normalized = normalizeSpaces(text).toLowerCase();
  if (!normalized) return "unknown";

  for (const [service, keywords] of Object.entries(SERVICE_SYNONYMS)) {
    if (keywords.some((kw) => normalized.includes(kw))) {
      return service;
    }
  }

  return "unknown";
}

function serviceLabel(service) {
  return String(service || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (s) => s.toUpperCase());
}

function hasRegularCleaningIntent(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  return (
    combined.includes("regular") ||
    combined.includes("ongoing") ||
    combined.includes("weekly") ||
    combined.includes("fortnight") ||
    combined.includes("fortnightly") ||
    combined.includes("every 2 weeks") ||
    combined.includes("every two weeks") ||
    combined.includes("every fortnight")
  );
}

function hasDeepCleaningIntent(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  return (
    combined.includes("deep clean") ||
    combined.includes("deep") ||
    combined.includes("start off with a deep clean") ||
    combined.includes("initial deep clean") ||
    combined.includes("first clean deep") ||
    combined.includes("move in") ||
    combined.includes("move out") ||
    combined.includes("move-out") ||
    combined.includes("vacate") ||
    combined.includes("bond clean") ||
    combined.includes("once off") ||
    combined.includes("one off") ||
    combined.includes("one-off")
  );
}

function detectCleaningTier(lead) {
  const hasRegular = hasRegularCleaningIntent(lead);
  const hasDeep = hasDeepCleaningIntent(lead);

  if (hasRegular) return "regular";
  if (hasDeep) return "one_off";

  return null;
}

function detectLawnSize(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (
    combined.includes("tiny") ||
    combined.includes("small") ||
    combined.includes("small yard") ||
    combined.includes("small lawn") ||
    combined.includes("little yard") ||
    combined.includes("little lawn") ||
    combined.includes("just the front") ||
    combined.includes("front lawn only") ||
    combined.includes("front yard only")
  ) {
    return "small";
  }

  if (
    combined.includes("large") ||
    combined.includes("big") ||
    combined.includes("huge") ||
    combined.includes("acre") ||
    combined.includes("acreage") ||
    combined.includes("big yard") ||
    combined.includes("big lawn") ||
    combined.includes("large yard") ||
    combined.includes("large lawn") ||
    combined.includes("very overgrown")
  ) {
    return "large";
  }

  if (
    combined.includes("medium") ||
    combined.includes("average") ||
    combined.includes("standard size") ||
    combined.includes("standard-sized") ||
    combined.includes("front and back") ||
    combined.includes("front & back") ||
    combined.includes("both front and back")
  ) {
    return "medium";
  }

  return null;
}

function detectVehicleType(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (combined.includes("sedan") || combined.includes("hatch")) return "sedan";
  if (combined.includes("suv")) return "suv";
  if (
    combined.includes("4wd") ||
    combined.includes("4 wd") ||
    combined.includes("four wheel drive") ||
    combined.includes("dual cab")
  ) {
    return "4wd";
  }

  return null;
}

function detectDetailPackage(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (combined.includes("cut and polish") || combined.includes("cut & polish")) {
    return "interior_exterior_cut_polish";
  }

  if (
    combined.includes("interior and exterior") ||
    combined.includes("interior & exterior") ||
    combined.includes("full detail") ||
    combined.includes("interior detail") ||
    combined.includes("exterior detail")
  ) {
    return "interior_exterior";
  }

  return null;
}

function detectPestSize(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (combined.includes("small")) return "small";
  if (combined.includes("medium")) return "medium";
  if (combined.includes("large")) return "large";

  return null;
}

function detectPressureWashingType(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (
    combined.includes("driveway") ||
    combined.includes("concrete") ||
    combined.includes("path") ||
    combined.includes("pathway") ||
    combined.includes("footpath") ||
    combined.includes("walkway") ||
    combined.includes("side path") ||
    combined.includes("outside home") ||
    combined.includes("around the house")
  ) {
    return "concrete driveway / paths";
  }

  if (
    combined.includes("house") ||
    combined.includes("house exterior") ||
    combined.includes("outside walls") ||
    combined.includes("external walls") ||
    combined.includes("exterior walls") ||
    combined.includes("weatherboard") ||
    combined.includes("render")
  ) {
    return "house exterior";
  }

  if (
    combined.includes("patio") ||
    combined.includes("alfresco") ||
    combined.includes("courtyard") ||
    combined.includes("entertainment area") ||
    combined.includes("verandah") ||
    combined.includes("veranda")
  ) {
    return "patio / outdoor area";
  }

  if (
    combined.includes("deck") ||
    combined.includes("timber deck") ||
    combined.includes("wood deck")
  ) {
    return "deck";
  }

  if (
    combined.includes("fence") ||
    combined.includes("retaining wall") ||
    combined.includes("wall")
  ) {
    return "fence / wall";
  }

  if (
    combined.includes("roof") ||
    combined.includes("gutter") ||
    combined.includes("gutters")
  ) {
    return "roof / gutters";
  }

  if (
    combined.includes("pool area") ||
    combined.includes("pool surround") ||
    combined.includes("poolside")
  ) {
    return "pool area";
  }

  return null;
}

function detectPressureWashSize(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (
    combined.includes("small") ||
    combined.includes("single driveway") ||
    combined.includes("front path") ||
    combined.includes("small area") ||
    combined.includes("just the driveway") ||
    combined.includes("just the path")
  ) {
    return "small";
  }

  if (
    combined.includes("large") ||
    combined.includes("big") ||
    combined.includes("double driveway") ||
    combined.includes("whole house") ||
    combined.includes("multiple areas") ||
    combined.includes("large area")
  ) {
    return "large";
  }

  if (
    combined.includes("medium") ||
    combined.includes("average") ||
    combined.includes("standard")
  ) {
    return "medium";
  }

  return null;
}

function isGenericLawnResponse(value) {
  const normalized = normalizeSpaces(value).toLowerCase();
  return (
    !normalized ||
    normalized === "all good" ||
    normalized === "nothing else" ||
    normalized === "no extras" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "na"
  );
}

function isGenericPressureWashResponse(value) {
  const normalized = normalizeSpaces(value).toLowerCase();
  return (
    !normalized ||
    normalized === "all good" ||
    normalized === "nothing else" ||
    normalized === "no extras" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "na"
  );
}

function inferTradeJobType(service, lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();

  if (service === "plumbing") {
    if (combined.includes("blocked")) return "blocked drain / blockage";
    if (combined.includes("hot water")) return "hot water system issue";
    if (combined.includes("toilet")) return "toilet issue";
    if (combined.includes("tap")) return "tap / fixture issue";
    if (combined.includes("leak") || combined.includes("burst")) return "leak / pipe issue";
    return "";
  }

  if (service === "electrical") {
    if (combined.includes("power point") || combined.includes("powerpoint")) return "power point work";
    if (combined.includes("light")) return "lighting work";
    if (combined.includes("fan")) return "ceiling fan work";
    if (combined.includes("switchboard")) return "switchboard work";
    if (combined.includes("smoke alarm")) return "smoke alarm work";
    return "";
  }

  if (service === "fencing") {
    if (combined.includes("repair")) return "fence repair";
    if (combined.includes("replace")) return "fence replacement";
    if (combined.includes("gate")) return "gate install / repair";
    if (combined.includes("new fence")) return "new fence";
    return "";
  }

  if (service === "carpentry") {
    if (combined.includes("deck")) return "deck work";
    if (combined.includes("door")) return "door repair / install";
    if (combined.includes("framing")) return "framing";
    if (combined.includes("shelf")) return "shelving / storage";
    if (combined.includes("skirting")) return "skirting / trim work";
    return "";
  }

  if (service === "painting") {
    if (combined.includes("interior")) return "interior painting";
    if (combined.includes("exterior")) return "exterior painting";
    if (combined.includes("ceiling")) return "ceiling painting";
    if (combined.includes("fence")) return "fence painting";
    return "";
  }

  if (service === "landscaping") {
    if (combined.includes("turf")) return "turf installation";
    if (combined.includes("retaining wall")) return "retaining wall";
    if (combined.includes("garden clean")) return "garden clean-up";
    if (combined.includes("garden design")) return "garden design";
    if (combined.includes("paving")) return "paving / hardscaping";
    return "";
  }

  if (service === "handyman") {
    return "handyman / general repairs";
  }

  return "";
}

function inferMissingLeadFields(lead) {
  const next = {
    ...emptyLead(),
    ...lead,
  };

  next.service = SUPPORTED_SERVICES.includes(next.service)
    ? next.service
    : detectServiceFromText(`${next.service} ${next.job_type} ${next.job_details}`);

  if (next.service === "unknown") next.service = "";

  next.phone = normalizePhone(next.phone);
  next.email = normalizeEmail(next.email);

  if (next.service === "lawn_mowing") {
    const combined = `${next.job_type || ""} ${next.job_details || ""}`.toLowerCase();

    if (!next.job_type) {
      if (
        combined.includes("hedge") ||
        combined.includes("yard clean") ||
        combined.includes("yard cleanup") ||
        combined.includes("yard clean-up")
      ) {
        if (combined.includes("hedge")) {
          next.job_type = "lawn mowing with hedge trimming";
        } else if (combined.includes("yard")) {
          next.job_type = "yard clean-up";
        }
      } else {
        next.job_type = "regular lawn mow";
      }
    }

    if (!next.job_details && next.job_type) {
      next.job_details = next.job_type;
    }

    if (isGenericLawnResponse(next.job_details)) {
      next.job_details = "medium lawn";
    }
  }

  if (next.service === "cleaning" && !next.job_type) {
    const tier = detectCleaningTier(next);
    if (tier === "regular") next.job_type = "regular clean";
    if (tier === "one_off") next.job_type = "one-off clean";
  }

  if (next.service === "pressure_washing") {
    const inferredType = detectPressureWashingType(next);

    if (!next.job_type && inferredType) {
      next.job_type = inferredType;
    }

    if (!next.job_details && next.job_type) {
      next.job_details = next.job_type;
    }

    if (isGenericPressureWashResponse(next.job_details) && next.job_type) {
      next.job_details = next.job_type;
    }
  }

  if (
    ["plumbing", "electrical", "fencing", "carpentry", "painting", "landscaping", "handyman"].includes(next.service)
  ) {
    if (!next.job_type) {
      next.job_type = inferTradeJobType(next.service, next);
    }

    if (!next.job_details && next.job_type) {
      next.job_details = next.job_type;
    }
  }

  return next;
}

function getMissingFieldsFromLead(lead, options = {}) {
  const missing = [];
  const requireContact = options.requireContact !== false;
  const requireAddress = options.requireAddress !== false;

  if (!lead.service || lead.service === "unknown") missing.push("service");
  if (requireContact && !lead.name) missing.push("name");
  if (requireContact && !lead.phone) missing.push("phone");
  if (requireContact && (!lead.email || !isLikelyValidEmail(lead.email))) missing.push("email");
  if (requireAddress && !lead.address) missing.push("address");
  if (!lead.job_type) missing.push("job_type");
  if (!lead.job_details) missing.push("job_details");
  if (!lead.preferred_datetime) missing.push("preferred_datetime");

  return missing;
}

function getQuoteRange(lead) {
  const service = toLower(lead.service);

  if (service === "cleaning") {
    const tier = detectCleaningTier(lead);
    const beds = findBedroomCount(lead.job_details);

    if (!tier || !beds) return null;

    if (tier === "regular") {
      if (beds === 2) return { min: 85, max: 100 };
      if (beds === 3) return { min: 100, max: 130 };
      if (beds >= 4) return { min: 130, max: 150 };
    }

    if (tier === "one_off") {
      if (beds === 2) return { min: 100, max: 130 };
      if (beds === 3) return { min: 130, max: 160 };
      if (beds >= 4) return { min: 160, max: 190 };
    }

    return null;
  }

  if (service === "lawn_mowing") {
    let size = detectLawnSize(lead);
    if (!size) size = "medium";

    if (size === "small") return { min: 80, max: 100 };
    if (size === "medium") return { min: 100, max: 120 };
    if (size === "large") return { min: 120, max: 150 };

    return null;
  }

  if (service === "car_detailing") {
    const pkg = detectDetailPackage(lead);
    const vehicle = detectVehicleType(lead);

    if (!pkg || !vehicle) return null;

    if (pkg === "interior_exterior") {
      if (vehicle === "sedan") return { min: 300, max: 350 };
      if (vehicle === "suv") return { min: 380, max: 400 };
      if (vehicle === "4wd") return { min: 400, max: 450 };
    }

    if (pkg === "interior_exterior_cut_polish") {
      if (vehicle === "sedan") return { min: 900, max: 1000 };
      if (vehicle === "suv") return { min: 1000, max: 1100 };
      if (vehicle === "4wd") return { min: 1100, max: 1300 };
    }

    return null;
  }

  if (service === "pest_control") {
    const size = detectPestSize(lead);
    if (!size) return null;

    if (size === "small") return { min: 250, max: 350 };
    if (size === "medium") return { min: 350, max: 400 };
    if (size === "large") return { min: 400, max: 750 };

    return null;
  }

  if (service === "pressure_washing") {
    const type = detectPressureWashingType(lead);
    let size = detectPressureWashSize(lead);

    if (!type) return null;
    if (!size) size = "medium";

    if (type === "concrete driveway / paths") {
      if (size === "small") return { min: 120, max: 180 };
      if (size === "medium") return { min: 180, max: 280 };
      if (size === "large") return { min: 280, max: 450 };
    }

    if (type === "house exterior") {
      if (size === "small") return { min: 220, max: 320 };
      if (size === "medium") return { min: 320, max: 480 };
      if (size === "large") return { min: 480, max: 700 };
    }

    if (type === "patio / outdoor area") {
      if (size === "small") return { min: 120, max: 200 };
      if (size === "medium") return { min: 200, max: 320 };
      if (size === "large") return { min: 320, max: 500 };
    }

    if (type === "deck") {
      if (size === "small") return { min: 150, max: 220 };
      if (size === "medium") return { min: 220, max: 350 };
      if (size === "large") return { min: 350, max: 550 };
    }

    if (type === "fence / wall") {
      if (size === "small") return { min: 150, max: 250 };
      if (size === "medium") return { min: 250, max: 400 };
      if (size === "large") return { min: 400, max: 650 };
    }

    if (type === "roof / gutters") {
      if (size === "small") return { min: 250, max: 380 };
      if (size === "medium") return { min: 380, max: 600 };
      if (size === "large") return { min: 600, max: 900 };
    }

    if (type === "pool area") {
      if (size === "small") return { min: 150, max: 250 };
      if (size === "medium") return { min: 250, max: 400 };
      if (size === "large") return { min: 400, max: 650 };
    }

    return null;
  }

  return null;
}

function formatCurrency(amount) {
  return `$${Number(amount).toLocaleString("en-AU")}`;
}

function hasExtraWork(lead) {
  const combined = `${lead.job_type || ""} ${lead.job_details || ""}`.toLowerCase();
  const service = toLower(lead.service);

  if (service === "cleaning") {
    return (
      combined.includes("deep clean") ||
      combined.includes("deep") ||
      combined.includes("start off with a deep clean") ||
      combined.includes("initial deep clean") ||
      combined.includes("move in") ||
      combined.includes("move out") ||
      combined.includes("vacate") ||
      combined.includes("bond clean") ||
      combined.includes("oven") ||
      combined.includes("walls") ||
      combined.includes("extra work") ||
      combined.includes("pets") ||
      combined.includes("pet hair")
    );
  }

  if (service === "lawn_mowing") {
    return (
      combined.includes("overgrown") ||
      combined.includes("clippings removed") ||
      combined.includes("clippings taken away") ||
      combined.includes("take away") ||
      combined.includes("edging") ||
      combined.includes("hedge") ||
      combined.includes("whipper snip") ||
      combined.includes("yard clean") ||
      combined.includes("cleanup") ||
      combined.includes("clean-up") ||
      combined.includes("extra work")
    );
  }

  if (service === "car_detailing") {
    return (
      combined.includes("pet hair") ||
      combined.includes("stains") ||
      combined.includes("mould") ||
      combined.includes("mold") ||
      combined.includes("heavily soiled") ||
      combined.includes("excessively dirty") ||
      combined.includes("engine bay") ||
      combined.includes("extra work")
    );
  }

  if (service === "pressure_washing") {
    return (
      combined.includes("heavy staining") ||
      combined.includes("oil") ||
      combined.includes("mould") ||
      combined.includes("mold") ||
      combined.includes("multi area") ||
      combined.includes("multiple areas") ||
      combined.includes("extra work")
    );
  }

  if (service === "pest_control") {
    return (
      combined.includes("severe") ||
      combined.includes("multiple areas") ||
      combined.includes("roof void") ||
      combined.includes("large infestation") ||
      combined.includes("extra work")
    );
  }

  return false;
}

function isDiagnosticTrade(service) {
  return [
    "plumbing",
    "electrical",
    "fencing",
    "carpentry",
    "painting",
    "landscaping",
    "handyman",
  ].includes(service);
}

function buildQuoteReply(lead) {
  const service = toLower(lead.service);

  if (isDiagnosticTrade(service)) {
    return "We can definitely help with that. I’ve got enough to pass this onto a qualified tradesman. Would you like me to organise this for you now?";
  }

  const range = getQuoteRange(lead);

  if (!range) {
    return "We can definitely take care of that. Our team will contact you with a more accurate quote. Would you like me to organise this for you now?";
  }

  const extras = hasExtraWork(lead);

  if (service === "lawn_mowing") {
    if (extras) {
      return `We can definitely take care of that. For a lawn like yours, the regular price usually ranges from ${formatCurrency(
        range.min
      )} to ${formatCurrency(
        range.max
      )} depending on the condition. For the extra work, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
    }

    return `We can definitely take care of that. For a lawn like yours, the price usually ranges from ${formatCurrency(
      range.min
    )} to ${formatCurrency(
      range.max
    )} depending on the condition. Would you like me to organise this for you now?`;
  }

  if (service === "cleaning") {
    if (extras) {
      if (hasRegularCleaningIntent(lead) && hasDeepCleaningIntent(lead)) {
        return `We can definitely take care of that. For your home, the regular cleaning price usually ranges from ${formatCurrency(
          range.min
        )} to ${formatCurrency(
          range.max
        )} depending on the condition. For the deep clean, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
      }

      return `We can definitely take care of that. For a home like yours, the regular cleaning price usually ranges from ${formatCurrency(
        range.min
      )} to ${formatCurrency(
        range.max
      )} depending on the condition. For the deep clean or extra work, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
    }

    return `We can definitely take care of that. For a home like yours, the price usually ranges from ${formatCurrency(
      range.min
    )} to ${formatCurrency(
      range.max
    )} depending on the condition. Would you like me to organise this for you now?`;
  }

  if (service === "car_detailing") {
    if (extras) {
      return `We can definitely take care of that. For a vehicle like yours, the base price usually ranges from ${formatCurrency(
        range.min
      )} to ${formatCurrency(
        range.max
      )} depending on the condition. For the extra work, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
    }

    return `We can definitely take care of that. For a vehicle like yours, the price usually ranges from ${formatCurrency(
      range.min
    )} to ${formatCurrency(
      range.max
    )} depending on the condition. Would you like me to organise this for you now?`;
  }

  if (service === "pest_control") {
    if (extras) {
      return `We can definitely take care of that. For a property like yours, the standard price usually ranges from ${formatCurrency(
        range.min
      )} to ${formatCurrency(
        range.max
      )} depending on the condition. For the additional work, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
    }

    return `We can definitely take care of that. For a property like yours, the price usually ranges from ${formatCurrency(
      range.min
    )} to ${formatCurrency(
      range.max
    )} depending on the condition. Would you like me to organise this for you now?`;
  }

  if (service === "pressure_washing") {
    if (extras) {
      return `We can definitely take care of that. For an area like yours, the standard price usually ranges from ${formatCurrency(
        range.min
      )} to ${formatCurrency(
        range.max
      )} depending on the condition. For the extra work, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
    }

    return `We can definitely take care of that. For an area like yours, the price usually ranges from ${formatCurrency(
      range.min
    )} to ${formatCurrency(
      range.max
    )} depending on the condition. Would you like me to organise this for you now?`;
  }

  return "We can definitely take care of that. Would you like me to organise this for you now?";
}

function shouldReuseCustomerDetails(history) {
  return hasSubmittedMarker(history);
}

function getReuseContextFromExtracted(extracted) {
  const lead = extracted?.lead || {};
  return {
    hasName: Boolean(lead.name),
    hasPhone: Boolean(lead.phone),
    hasEmail: Boolean(lead.email && isLikelyValidEmail(lead.email)),
    hasAddress: Boolean(lead.address),
  };
}

function getMissingFieldsConsideringReuse(lead, history) {
  const reuse = shouldReuseCustomerDetails(history);

  return getMissingFieldsFromLead(lead, {
    requireContact: !reuse,
    requireAddress: !reuse ? true : !lead.address,
  });
}

function applyReplyOverrides(rawReply, extracted, history = []) {
  const lead = extracted?.lead || {};
  const missing = getMissingFieldsConsideringReuse(lead, history);
  const nextField = missing[0];
  const reuse = shouldReuseCustomerDetails(history);

  if (!nextField) {
    return buildQuoteReply(lead);
  }

  if (nextField === "service") {
    return "No worries — what service do you need help with?";
  }

  if (nextField === "name") {
    if (lead.service && lead.service !== "unknown") {
      return `Got it — ${String(lead.service).replace(/_/g, " ")}. What is your name please?`;
    }
    return "What is your name please?";
  }

  if (nextField === "phone") {
    return "What’s the best phone number to reach you? We won’t call you yet — it’s just so our team can reach out when they have a quote ready.";
  }

  if (nextField === "email") {
    return "What’s the best email address for the quote?";
  }

  if (nextField === "address") {
    if (reuse) {
      return "Is this for the same address as before, or a different one?";
    }
    return "What’s the full address for the job, including postcode?";
  }

  if (nextField === "job_type") {
    if (lead.service === "cleaning") {
      return "Is this a regular clean, deep clean, or vacate clean?";
    }

    if (lead.service === "lawn_mowing") {
      return "Is this just a regular lawn mow, a yard clean-up, or hedge trimming as well?";
    }

    if (lead.service === "car_detailing") {
      return "Are you after an interior and exterior detail, or interior and exterior plus cut and polish?";
    }

    if (lead.service === "pressure_washing") {
      return "What needs pressure washing? For example driveway, paths, patio, house exterior or something else.";
    }

    if (lead.service === "pest_control") {
      return "What kind of pest issue are you dealing with?";
    }

    if (lead.service === "plumbing") {
      return "What plumbing issue do you need help with? For example a blocked drain, hot water issue, leak or toilet problem.";
    }

    if (lead.service === "electrical") {
      return "What electrical work needs to be done? For example lights, power points, fans or switchboard work.";
    }

    if (lead.service === "fencing") {
      return "What fencing work do you need done? For example a new fence, repair, replacement or gate install.";
    }

    if (lead.service === "carpentry") {
      return "What carpentry work needs to be done? For example deck work, framing, shelving, skirting or a door repair.";
    }

    if (lead.service === "painting") {
      return "What needs painting? For example interior walls, ceilings, exterior house or a fence.";
    }

    if (lead.service === "landscaping") {
      return "What landscaping work are you after? For example turf, garden clean-up, retaining wall or a full garden makeover.";
    }

    if (lead.service === "handyman") {
      return "What jobs need to be done?";
    }

    return "What type of job is it?";
  }

  if (nextField === "job_details") {
    if (lead.service === "cleaning") {
      return "Can you briefly describe the job — number of bedrooms and bathrooms, plus anything specific you want looked after?";
    }

    if (lead.service === "lawn_mowing") {
      return "Can you tell me roughly how big the lawn is — small, medium or large — and whether it’s overgrown or needs anything extra like clippings removed or edging?";
    }

    if (lead.service === "car_detailing") {
      return "Can you briefly describe the vehicle — sedan, SUV or 4WD — and overall condition?";
    }

    if (lead.service === "pressure_washing") {
      return "Can you briefly describe the area and condition — for example small driveway, patio with mould, or concrete around the house?";
    }

    if (lead.service === "pest_control") {
      return "Can you briefly describe the property size — small, medium or large — and where the issue is?";
    }

    if (lead.service === "plumbing") {
      return "Can you briefly describe where the issue is and whether it’s urgent, leaking or causing flooding?";
    }

    if (lead.service === "electrical") {
      return "Can you briefly describe how many items are involved and whether it’s a repair or new installation?";
    }

    if (lead.service === "fencing") {
      return "Can you briefly describe the fence length, material if known, and whether the old fence needs removing?";
    }

    if (lead.service === "carpentry") {
      return "Can you briefly describe the size of the job and whether materials need to be supplied?";
    }

    if (lead.service === "painting") {
      return "Can you briefly describe how many rooms or areas need painting, the approximate size, and whether any prep or repairs are needed first?";
    }

    if (lead.service === "landscaping") {
      return "Can you briefly describe the size of the area, whether it’s a new project or existing garden, and anything specific you want included?";
    }

    if (lead.service === "handyman") {
      return "Can you briefly describe the tasks, roughly how many there are, and whether any materials need to be supplied?";
    }

    return "Can you briefly describe the job so we can quote it properly?";
  }

  if (nextField === "preferred_datetime") {
    if (lead.service === "cleaning") {
      return "What’s your preferred date and time for the clean?\nIf we can’t find a provider available at that exact date and time, we’ll get as close as possible and let you know.";
    }

    if (lead.service === "lawn_mowing") {
      return "What’s your preferred date and time for the lawn mowing?\nIf we can’t find a provider available at that exact date and time, we’ll get as close as possible and let you know.";
    }

    if (lead.service === "car_detailing") {
      return "What’s your preferred date and time for the detail?\nIf we can’t find a provider available at that exact date and time, we’ll get as close as possible and let you know.";
    }

    if (lead.service === "pressure_washing") {
      return "What’s your preferred date and time for the pressure washing?\nIf we can’t find a provider available at that exact date and time, we’ll get as close as possible and let you know.";
    }

    return "What’s your preferred date and time?\nIf we can’t find a provider available at that exact date and time, we’ll get as close as possible and let you know.";
  }

  return rawReply;
}

function shouldExtractNow(reply) {
  if (!reply) return false;

  const normalized = String(reply).toLowerCase();

  return (
    normalized.includes("i’ve got everything i need") ||
    normalized.includes("i've got everything i need") ||
    normalized.includes("thats everything i need") ||
    normalized.includes("that's everything i need") ||
    normalized.includes("i have everything i need") ||
    normalized.includes("ive got everything i need") ||
    normalized.includes("i've got all i need") ||
    normalized.includes("i have all i need")
  );
}

function looksLikeNoMoreServices(message) {
  const normalized = String(message || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

  const exactMatches = new Set([
    "no",
    "no thanks",
    "nah",
    "nah thanks",
    "nope",
    "thats all",
    "that's all",
    "all good",
    "nothing else",
    "thats it",
    "that's it",
    "no thats all",
    "no that's all",
  ]);

  return exactMatches.has(normalized);
}

function looksLikeQuoteDecline(message) {
  const normalized = normalizeSpaces(message)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const exactDeclines = new Set([
    "no",
    "no thanks",
    "nah",
    "nah thanks",
    "nope",
    "not right now",
    "not now",
    "ill pass",
    "i ll pass",
    "pass",
    "no thank you",
    "dont worry",
    "don't worry",
    "not today",
    "maybe later",
    "just looking",
    "just browsing",
    "just pricing",
    "just after a price",
    "just after pricing",
    "just getting a quote",
    "just getting quotes",
    "just seeing the price",
    "just seeing prices",
    "pricing only",
    "quote only",
    "just wanted a quote",
    "just wanted pricing",
    "leave it for now",
    "i'll leave it",
    "ill leave it",
    "leave it",
    "not this time",
    "maybe another time",
  ]);

  if (exactDeclines.has(normalized)) return true;

  const partialSignals = [
    "just looking",
    "just browsing",
    "just pricing",
    "just after a price",
    "just after pricing",
    "just getting a quote",
    "just getting quotes",
    "just wanted a quote",
    "just wanted pricing",
    "maybe later",
    "not today",
    "not right now",
    "not now",
    "leave it",
    "leave it for now",
    "i'll leave it",
    "ill leave it",
    "not this time",
    "maybe another time",
    "just seeing the price",
    "just seeing prices",
  ];

  return partialSignals.some((signal) => normalized.includes(signal));
}

function looksLikeQuoteConfirmation(message) {
  const original = normalizeSpaces(message).toLowerCase();
  const normalized = original.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  const exactConfirmations = [
    "yes",
    "yes please",
    "please do",
    "do it",
    "book it",
    "organise it",
    "organize it",
    "go ahead",
    "yep",
    "yep please",
    "yeah",
    "yeah please",
    "sure",
    "sounds good",
    "that works",
    "lets do it",
    "let's do it",
    "please organise it",
    "please organize it",
    "lets go ahead",
    "let's go ahead",
    "go for it",
    "okay go ahead",
    "ok go ahead",
    "organise this",
    "organize this",
    "yes lets do it",
    "yes let's do it",
  ];

  if (exactConfirmations.includes(normalized)) return true;

  const positiveSignals = [
    "yes",
    "yeah",
    "yep",
    "lets do it",
    "let's do it",
    "go ahead",
    "do it",
    "book it",
    "organise it",
    "organize it",
    "go for it",
    "sounds good",
    "that works",
    "all good",
  ];

  const correctionSignals = [
    "no sorry",
    "sorry",
    "i meant",
    "meant to say",
    "ignore that",
    "wrong word",
    "wrong message",
    "mistake",
    "typo",
    "voice typo",
  ];

  const hasPositive = positiveSignals.some((s) => normalized.includes(s));
  const hasCorrection = correctionSignals.some((s) => normalized.includes(s));

  if (hasPositive) return true;
  if (hasCorrection && hasPositive) return true;

  return false;
}

function hasSubmittedMarker(history) {
  return history.some((m) =>
    String(m.content || "").startsWith("[LEAD_SUBMITTED]")
  );
}

function getLastAssistantMessage(history) {
  const assistants = [...history].reverse().filter((m) => m.role === "assistant");
  return assistants.length ? String(assistants[0].content || "") : "";
}

function isQuotePromptMessage(content) {
  const normalized = String(content || "").toLowerCase();
  return (
    normalized.includes("the price ranges from") ||
    normalized.includes("the price usually ranges from") ||
    normalized.includes("the regular price usually ranges from") ||
    normalized.includes("the regular cleaning price usually ranges from") ||
    normalized.includes("the base price usually ranges from") ||
    normalized.includes("the standard price usually ranges from") ||
    normalized.includes("our team will contact you with a more accurate quote") ||
    normalized.includes("i’ve got enough to pass this onto a qualified tradesman") ||
    normalized.includes("i've got enough to pass this onto a qualified tradesman") ||
    normalized.includes("would you like me to go ahead and organise your quote now") ||
    normalized.includes("would you like me to organise this for you now") ||
    normalized.includes("did you want me to organise a quote")
  );
}

function conversationContainsQuotePrompt(history) {
  return history.some(
    (m) => m.role === "assistant" && isQuotePromptMessage(m.content)
  );
}

function looksLikeNoiseOrCorrection(message) {
  const normalized = normalizeSpaces(message).toLowerCase();
  if (!normalized) return false;

  const shortNoise = ["yellowstone", "hello", "test", "oops", "sorry", "ignore that"];
  if (shortNoise.includes(normalized)) return true;

  return (
    normalized.includes("ignore that") ||
    normalized.includes("wrong word") ||
    normalized.includes("wrong message") ||
    normalized.includes("meant to say") ||
    normalized.includes("voice typo")
  );
}

function looksLikeSameAddressConfirmation(message) {
  const normalized = normalizeSpaces(message)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const positives = [
    "same address",
    "same place",
    "same one",
    "same as before",
    "same house",
    "same property",
    "yes same address",
    "yep same address",
    "yeah same address",
    "same",
  ];

  return positives.includes(normalized);
}

function looksLikeNewServiceRequest(message) {
  return detectServiceFromText(message) !== "unknown";
}

async function extractLeadFromTranscript(transcript) {
  const extractionResponse = await client.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 420,
    input: [
      {
        role: "system",
        content: EXTRACTION_PROMPT,
      },
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const parsed = safeJsonParse(extractionResponse.output_text) || {};
  const extracted = {
    service: parsed.service || "unknown",
    is_complete: Boolean(parsed.is_complete),
    missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
    lead: parsed.lead && typeof parsed.lead === "object" ? parsed.lead : emptyLead(),
    known_customer: parsed.known_customer && typeof parsed.known_customer === "object"
      ? parsed.known_customer
      : emptyLead(),
  };

  let lead = {
    ...(extracted.lead || {}),
    service: extracted.service || extracted.lead?.service || "unknown",
  };

  let knownCustomer = {
    ...emptyLead(),
    ...(extracted.known_customer || {}),
  };

  knownCustomer = inferMissingLeadFields(knownCustomer);
  lead = inferMissingLeadFields(lead);

  if (!knownCustomer.service) knownCustomer.service = "";
  if (!lead.service || lead.service === "unknown") {
    lead.service = detectServiceFromText(transcript);
  }

  if (!lead.name && knownCustomer.name) lead.name = knownCustomer.name;
  if (!lead.phone && knownCustomer.phone) lead.phone = knownCustomer.phone;
  if (!lead.email && knownCustomer.email) lead.email = knownCustomer.email;
  if (!lead.address && knownCustomer.address) lead.address = knownCustomer.address;

  const missing_fields = getMissingFieldsFromLead(lead);
  const is_complete = missing_fields.length === 0;

  const range = getQuoteRange(lead);
  if (range) {
    lead.quote_range = `${formatCurrency(range.min)} to ${formatCurrency(
      range.max
    )}`;
  }

  return {
    ...extracted,
    known_customer: knownCustomer,
    lead,
    service: lead.service || "unknown",
    missing_fields,
    is_complete,
  };
}

async function submitConfirmedLead({ history, message }) {
  const transcript = buildConversationText(history, message);
  const extracted = await extractLeadFromTranscript(transcript);
  const lead = {
    ...(extracted.lead || {}),
    service: extracted.service || extracted.lead?.service || "unknown",
    quote_range: extracted.lead?.quote_range || "",
  };

  if (!extracted.is_complete) {
    return {
      ok: false,
      extracted,
      lead,
      reply: applyReplyOverrides("Perfect — I’ve got everything I need.", extracted, history),
      submitted: false,
      submissionError: null,
    };
  }

  let submitted = false;
  let submissionError = null;

  const confirmationReply =
    "Perfect — I’ve got that organised. Is there any other services you are trying to get taken care of while you’re here?";

  try {
    console.log("Attempting to send confirmed quote lead email...");
    await sendLeadEmail(
      lead,
      `${transcript}\nASSISTANT: ${confirmationReply}\nASSISTANT: [LEAD_SUBMITTED]`
    );
    submitted = true;
    console.log("Confirmed quote lead email sent successfully.");
  } catch (emailError) {
    submissionError = emailError;
    console.error("Confirmed quote lead email failed:", emailError);
  }

  return {
    ok: true,
    extracted,
    lead,
    reply: confirmationReply,
    submitted,
    submissionError,
  };
}

const ASSISTANT_PROMPT = `
You are ServHQ, a human-sounding concierge assistant for organising local services.

Supported services:
- cleaning
- lawn mowing
- car detailing
- pressure washing
- pest control
- plumbing
- electrical
- fencing
- carpentry
- painting
- landscaping
- handyman

Goal:
Collect only the core details needed for a free quote:
1. service
2. full name
3. phone
4. email
5. full address
6. job type
7. basic job details
8. preferred date and time

Critical behavior:
- If the customer has already submitted one quote and asks for a second service, reuse their existing name, phone, email, and address unless they say those details are different.
- Do not ask for name, phone, or email again if they were already given earlier in the conversation.
- If a previous address exists and the user asks for another quote, ask whether it is for the same address only if needed.
- Treat "we went through this", "same as before", and similar replies as a sign to reuse existing details.

Rules:
- Ask one question at a time.
- Keep replies very short.
- Sound natural.
- Do not repeat details already given.
- Do not give pricing, availability, or provider names unless the flow later adds a rough price automatically.
- If the service is obvious, do not ask for it again.
- If the job type is obvious, do not ask for it again.
- Be tolerant of typos, slang, half-sentences, voice-to-text mistakes, shorthand, and messy wording.
- If the user says random filler, acknowledges, or sends a correction, do not restart the flow.
- Treat casual phrases as valid intent, for example:
  "my toilet is stuffed", "need a sparkie", "fence is falling over", "need my yard sorted", "need a painter", "need someone to fix bits around the house".
- For lawn mowing, if the user clearly wants a standard mow and already gave yard details, do not ask again if it is a regular mow.
- For lawn mowing, when asking for job details, ask specifically for lawn size and any extras so a rough price can be given.
- For pressure washing, treat answers like driveway, concrete, paths, patio, house exterior, deck, fence, roof, gutters, pool area, or concrete outside home as valid job types.
- For pressure washing, if the user says something like "concrete outside home", "driveway", or "paths around the house", do not ask "What needs pressure washing?" again.
- For plumbing, electrical, fencing, carpentry, painting, landscaping, and handyman, you do not need a technical diagnosis.
- For those trade services, only collect enough simple info to pass the lead to a qualified tradesman.
- When asking for name, say exactly:
"What is your name please?"
- When asking for phone, say exactly:
"What’s the best phone number to reach you? We won’t call you yet — it’s just so our team can reach out when they have a quote ready."
- Once all required fields are collected, say exactly:
"Perfect — I’ve got everything I need."
`;

const EXTRACTION_PROMPT = `
Extract the lead information from the conversation and return JSON only.

Return exactly this shape:
{
  "service": "cleaning | lawn_mowing | car_detailing | pressure_washing | pest_control | plumbing | electrical | fencing | carpentry | painting | landscaping | handyman | unknown",
  "is_complete": true,
  "missing_fields": [],
  "known_customer": {
    "name": "",
    "phone": "",
    "email": "",
    "address": ""
  },
  "lead": {
    "service": "",
    "name": "",
    "phone": "",
    "email": "",
    "address": "",
    "job_type": "",
    "job_details": "",
    "preferred_datetime": ""
  }
}

Rules:
- Use empty strings for unknown values.
- If an email is spoken with spaces, reconstruct it into normal email format.
- If a phone number contains spaces, reconstruct it into normal format.
- If the user's wording is messy, slang, incomplete, or voice-to-text style, still extract the best meaning.
- Ignore filler, corrections, accidental messages, and unrelated noise where possible.
- "known_customer" should capture the latest reliable customer identity/contact details from anywhere in the conversation.
- If a second service is discussed later in the conversation, reuse previously collected customer details in the "lead" if the user has not changed them.
- For lawn mowing, if the conversation clearly indicates a standard mow and includes yard details, infer job_type as "regular lawn mow" if needed.
- For lawn mowing, if the user gives generic job details like "all good", "none", or "no extras", keep the lead complete and allow pricing to default to a medium lawn if size is still unknown.
- For pressure washing, map common user answers into a usable job_type when obvious:
  - driveway / concrete driveway / concrete outside home / paths / pathways / footpath / concrete around house -> "concrete driveway / paths"
  - patio / alfresco / courtyard / verandah -> "patio / outdoor area"
  - house / house exterior / exterior walls / outside walls -> "house exterior"
  - deck -> "deck"
  - fence / wall -> "fence / wall"
  - roof / gutters -> "roof / gutters"
  - pool area / pool surround -> "pool area"
- For plumbing, map obvious issues when possible:
  - blocked drain / blocked sink / blocked toilet -> "blocked drain / blockage"
  - hot water / no hot water -> "hot water system issue"
  - leaking tap / leaking shower / burst pipe / leak -> "leak / pipe issue"
  - toilet not flushing / toilet issue -> "toilet issue"
- For electrical, map obvious issues when possible:
  - lights / downlights / light install -> "lighting work"
  - power point / powerpoint -> "power point work"
  - fan / ceiling fan -> "ceiling fan work"
  - switchboard -> "switchboard work"
- For fencing, map obvious issues when possible:
  - new fence -> "new fence"
  - repair fence / broken fence -> "fence repair"
  - replace fence -> "fence replacement"
  - gate -> "gate install / repair"
- For carpentry, map obvious issues when possible:
  - deck -> "deck work"
  - framing -> "framing"
  - shelf / shelving -> "shelving / storage"
  - door -> "door repair / install"
  - skirting / trim -> "skirting / trim work"
- For painting, map obvious issues when possible:
  - interior -> "interior painting"
  - exterior -> "exterior painting"
  - ceiling -> "ceiling painting"
  - fence -> "fence painting"
- For landscaping, map obvious issues when possible:
  - turf -> "turf installation"
  - retaining wall -> "retaining wall"
  - garden clean up / garden cleanup -> "garden clean-up"
  - paving -> "paving / hardscaping"
  - garden design -> "garden design"
- For handyman, if obvious but broad, use "handyman / general repairs".
- "service" must be one of:
  cleaning, lawn_mowing, car_detailing, pressure_washing, pest_control, plumbing, electrical, fencing, carpentry, painting, landscaping, handyman, unknown
- "is_complete" must only be true when all of these fields are present:
  service, name, phone, email, address, job_type, job_details, preferred_datetime
- "missing_fields" should contain machine-friendly field names only.
- Return valid JSON only. No markdown. No explanation.
`;

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "ServHQ API is live",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = String(body.message || "").trim();
    const history = normalizeHistory(body.history);
    const modelHistory = historyForModel(history);

    if (!message) {
      return res.status(400).json({
        reply: "Please send a message.",
      });
    }

    const lastAssistantMessage = getLastAssistantMessage(history);
    const transcriptWithCurrentMessage = buildConversationText(history, message);

    if (looksLikeNoMoreServices(message) && hasSubmittedMarker(history)) {
      return res.status(200).json({
        reply: "Perfect — you’re all set. Our team will now work on the quote request and be in touch.",
        voiceReply: "Perfect — you’re all set. Our team will now work on the quote request and be in touch.",
        submitted: false,
        leadComplete: false,
        service: "unknown",
        missingFields: [],
        submissionError: null,
      });
    }

    const quoteConfirmationIntent = looksLikeQuoteConfirmation(message);
    const quoteDeclineIntent = looksLikeQuoteDecline(message);
    const quotePromptSeen =
      isQuotePromptMessage(lastAssistantMessage) ||
      conversationContainsQuotePrompt(history);

    if (quotePromptSeen && quoteDeclineIntent) {
      return res.status(200).json({
        reply: "No worries at all, is there another service you would like to discuss?",
        voiceReply: "No worries at all, is there another service you would like to discuss?",
        submitted: false,
        leadComplete: false,
        service: "unknown",
        missingFields: [],
        submissionError: null,
      });
    }

    if (quotePromptSeen && quoteConfirmationIntent) {
      const result = await submitConfirmedLead({ history, message });

      return res.status(200).json({
        reply: result.reply,
        voiceReply: result.reply,
        submitted: result.submitted,
        leadComplete: Boolean(result.extracted?.is_complete),
        service: result.lead?.service || "unknown",
        missingFields: result.extracted?.missing_fields || [],
        submissionError: result.submissionError
          ? String(result.submissionError.message || result.submissionError)
          : null,
      });
    }

    if (quotePromptSeen && looksLikeNoiseOrCorrection(message)) {
      return res.status(200).json({
        reply: "No worries — would you like me to organise this for you now?",
        voiceReply: "No worries — would you like me to organise this for you now?",
        submitted: false,
        leadComplete: false,
        service: "unknown",
        missingFields: [],
        submissionError: null,
      });
    }

    const preExtracted = await extractLeadFromTranscript(transcriptWithCurrentMessage);
    const reuseContext = getReuseContextFromExtracted(preExtracted);
    const preMissing = getMissingFieldsConsideringReuse(preExtracted.lead || emptyLead(), history);

    if (
      hasSubmittedMarker(history) &&
      looksLikeNewServiceRequest(message) &&
      preMissing.length > 0
    ) {
      const reply = applyReplyOverrides("Perfect — I’ve got everything I need.", preExtracted, history);

      return res.status(200).json({
        reply,
        voiceReply: reply,
        submitted: false,
        leadComplete: false,
        service: preExtracted.lead?.service || "unknown",
        missingFields: preMissing,
        submissionError: null,
        reusedCustomerDetails: reuseContext,
      });
    }

    if (
      hasSubmittedMarker(history) &&
      looksLikeSameAddressConfirmation(message) &&
      preExtracted.known_customer?.address &&
      !preExtracted.lead?.address
    ) {
      preExtracted.lead.address = preExtracted.known_customer.address;
      preExtracted.missing_fields = getMissingFieldsConsideringReuse(preExtracted.lead, history);

      const reply = applyReplyOverrides("Perfect — I’ve got everything I need.", preExtracted, history);

      return res.status(200).json({
        reply,
        voiceReply: reply,
        submitted: false,
        leadComplete: false,
        service: preExtracted.lead?.service || "unknown",
        missingFields: preExtracted.missing_fields || [],
        submissionError: null,
      });
    }

    console.log("Incoming ServHQ message:", message);
    console.log("Normalized history length:", history.length);

    const reuseInstruction = hasSubmittedMarker(history)
      ? `Known customer details already collected earlier in this conversation:
Name: ${preExtracted.known_customer?.name || ""}
Phone: ${preExtracted.known_customer?.phone || ""}
Email: ${preExtracted.known_customer?.email || ""}
Address: ${preExtracted.known_customer?.address || ""}

If the customer is asking for another service, reuse these details and do not ask again unless the customer changes them.
`
      : "";

    const assistantInput = [
      {
        role: "system",
        content: ASSISTANT_PROMPT,
      },
      ...(reuseInstruction
        ? [
            {
              role: "system",
              content: reuseInstruction,
            },
          ]
        : []),
      ...modelHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: "user",
        content: message,
      },
    ];

    const assistantResponse = await client.responses.create({
      model: "gpt-4o-mini",
      max_output_tokens: 140,
      input: assistantInput,
    });

    const rawReply =
      assistantResponse.output_text ||
      "Sorry — ServHQ had trouble responding.";

    let reply = rawReply;
    let submitted = false;
    let submissionError = null;
    let extracted = preExtracted;
    let lead = extracted.lead || emptyLead();

    const calculatedMissing = getMissingFieldsConsideringReuse(lead, history);

    if (hasSubmittedMarker(history) && calculatedMissing.length > 0) {
      const accidentalRepeat =
        rawReply.includes("What is your name please?") ||
        rawReply.includes("What’s the best phone number to reach you?") ||
        rawReply.includes("What's the best phone number to reach you?") ||
        rawReply.includes("What’s your email") ||
        rawReply.includes("What is your email");

      if (accidentalRepeat) {
        reply = applyReplyOverrides(rawReply, extracted, history);
      }
    }

    if (shouldExtractNow(rawReply)) {
      extracted = await extractLeadFromTranscript(transcriptWithCurrentMessage);
      lead = extracted.lead || emptyLead();

      const missingWithReuse = getMissingFieldsConsideringReuse(lead, history);

      console.log("Extracted lead:", JSON.stringify(lead, null, 2));
      console.log("Missing fields (reuse-aware):", missingWithReuse || []);

      if (missingWithReuse.length === 0) {
        reply = buildQuoteReply(lead);
      } else {
        reply = applyReplyOverrides(rawReply, extracted, history);
      }
    }

    if (!shouldExtractNow(rawReply) && hasSubmittedMarker(history)) {
      const missingWithReuse = getMissingFieldsConsideringReuse(lead, history);

      if (missingWithReuse.length > 0) {
        reply = applyReplyOverrides(rawReply, extracted, history);
      }
    }

    if (looksLikeQuoteConfirmation(message)) {
      const fallbackExtracted =
        extracted || (await extractLeadFromTranscript(transcriptWithCurrentMessage));
      const fallbackLead = fallbackExtracted.lead || emptyLead();
      const fallbackQuotePromptSeen =
        quotePromptSeen || isQuotePromptMessage(reply);

      const fallbackMissing = getMissingFieldsConsideringReuse(fallbackLead, history);

      if (fallbackMissing.length === 0 && fallbackQuotePromptSeen) {
        const result = await submitConfirmedLead({ history, message });

        return res.status(200).json({
          reply: result.reply,
          voiceReply: result.reply,
          submitted: result.submitted,
          leadComplete: Boolean(result.extracted?.is_complete),
          service: result.lead?.service || "unknown",
          missingFields: result.extracted?.missing_fields || [],
          submissionError: result.submissionError
            ? String(result.submissionError.message || result.submissionError)
            : null,
        });
      }

      lead = fallbackLead;
      extracted = fallbackExtracted;
    }

    return res.status(200).json({
      reply,
      voiceReply: reply,
      submitted,
      leadComplete:
        getMissingFieldsConsideringReuse(extracted?.lead || emptyLead(), history).length === 0,
      service: lead.service || "unknown",
      missingFields: getMissingFieldsConsideringReuse(extracted?.lead || emptyLead(), history),
      submissionError: submissionError
        ? String(submissionError.message || submissionError)
        : null,
      reusedCustomerDetails: reuseContext,
    });
  } catch (error) {
    console.error("ServHQ fatal error:", error);

    return res.status(500).json({
      reply: "Sorry — ServHQ had trouble responding.",
      voiceReply: "Sorry — ServHQ had trouble responding.",
    });
  }
}

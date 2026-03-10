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

  if (combined.includes("sedan")) return "sedan";
  if (combined.includes("suv")) return "suv";
  if (
    combined.includes("4wd") ||
    combined.includes("4 wd") ||
    combined.includes("four wheel drive")
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

function inferMissingLeadFields(lead) {
  const next = {
    ...emptyLead(),
    ...lead,
  };

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

  return next;
}

function getMissingFieldsFromLead(lead) {
  const missing = [];

  if (!lead.service || lead.service === "unknown") missing.push("service");
  if (!lead.name) missing.push("name");
  if (!lead.phone) missing.push("phone");
  if (!lead.email || !isLikelyValidEmail(lead.email)) missing.push("email");
  if (!lead.address) missing.push("address");
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

function buildQuoteReply(lead) {
  const range = getQuoteRange(lead);

  if (!range) {
    return "We can definitely take care of that. Our team will contact you with a more accurate quote. Would you like me to organise this for you now?";
  }

  const service = toLower(lead.service);
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

  if (extras) {
    return `We can definitely take care of that. The standard price usually ranges from ${formatCurrency(
      range.min
    )} to ${formatCurrency(
      range.max
    )}. For the extra work, our team will discuss that when they provide the quote. Would you like me to organise this for you now?`;
  }

  return `We can definitely take care of that. The price usually ranges from ${formatCurrency(
    range.min
  )} to ${formatCurrency(
    range.max
  )}. Would you like me to organise this for you now?`;
}

function applyReplyOverrides(rawReply, extracted) {
  const missing = extracted?.missing_fields || [];
  const lead = extracted?.lead || {};
  const nextField = missing[0];

  if (!nextField) {
    return buildQuoteReply(lead);
  }

  if (nextField === "service") {
    return "No worries — what service do you need help with?";
  }

  if (nextField === "name") {
    if (lead.service && lead.service !== "unknown") {
      const serviceLabel = String(lead.service).replace(/_/g, " ");
      return `Got it — ${serviceLabel}. What is your name please?`;
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
      return "What needs pressure washing?";
    }

    if (lead.service === "pest_control") {
      return "What kind of pest issue are you dealing with?";
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
      return "Can you briefly describe the area and condition so we can quote it properly?";
    }

    if (lead.service === "pest_control") {
      return "Can you briefly describe the property size — small, medium or large — and where the issue is?";
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

async function extractLeadFromTranscript(transcript) {
  const extractionResponse = await client.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 220,
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

  const extracted = safeJsonParse(extractionResponse.output_text) || {
    service: "unknown",
    is_complete: false,
    missing_fields: [],
    lead: emptyLead(),
  };

  let lead = {
    ...(extracted.lead || {}),
    service: extracted.service || extracted.lead?.service || "unknown",
  };

  lead = inferMissingLeadFields(lead);

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
    lead,
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
      reply: applyReplyOverrides("Perfect — I’ve got everything I need.", extracted),
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

Rules:
- Ask one question at a time.
- Keep replies very short.
- Sound natural.
- Do not repeat details already given.
- Do not give pricing, availability, or provider names.
- If the service is obvious, do not ask for it again.
- If the job type is obvious, do not ask for it again.
- For lawn mowing, if the user clearly wants a standard mow and already gave yard details, do not ask again if it is a regular mow.
- For lawn mowing, when asking for job details, ask specifically for lawn size and any extras so a rough price can be given.
- If the user makes a typo, speech mistake, or irrelevant interruption near quote stage, do not restart discovery.
- If the user confirms after a quote prompt, do not restart discovery.
- Reuse contact details and address for another service unless the user changes them.
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
  "service": "cleaning | lawn_mowing | car_detailing | pressure_washing | pest_control | unknown",
  "is_complete": true,
  "missing_fields": [],
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
- For lawn mowing, if the conversation clearly indicates a standard mow and includes yard details, infer job_type as "regular lawn mow" if needed.
- For lawn mowing, if the user gives generic job details like "all good", "none", or "no extras", keep the lead complete and allow pricing to default to a medium lawn if size is still unknown.
- "service" must be one of:
  cleaning, lawn_mowing, car_detailing, pressure_washing, pest_control, unknown
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

    console.log("Incoming ServHQ message:", message);
    console.log("Normalized history length:", history.length);

    const assistantInput = [
      {
        role: "system",
        content: ASSISTANT_PROMPT,
      },
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
      max_output_tokens: 120,
      input: assistantInput,
    });

    const rawReply =
      assistantResponse.output_text ||
      "Sorry — ServHQ had trouble responding.";

    let reply = rawReply;
    let submitted = false;
    let submissionError = null;
    let extracted = null;
    let lead = emptyLead();

    if (shouldExtractNow(rawReply)) {
      extracted = await extractLeadFromTranscript(transcriptWithCurrentMessage);
      lead = extracted.lead || emptyLead();

      console.log("Extracted lead:", JSON.stringify(lead, null, 2));
      console.log("Is complete:", extracted.is_complete);
      console.log("Missing fields:", extracted.missing_fields || []);

      if (extracted.is_complete) {
        reply = buildQuoteReply(lead);
      } else {
        reply = applyReplyOverrides(rawReply, extracted);
      }
    }

    if (looksLikeQuoteConfirmation(message)) {
      const fallbackExtracted =
        extracted || (await extractLeadFromTranscript(transcriptWithCurrentMessage));
      const fallbackLead = fallbackExtracted.lead || emptyLead();
      const fallbackQuotePromptSeen =
        quotePromptSeen || isQuotePromptMessage(reply);

      if (fallbackExtracted.is_complete && fallbackQuotePromptSeen) {
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
      leadComplete: Boolean(extracted?.is_complete),
      service: lead.service || "unknown",
      missingFields: extracted?.missing_fields || [],
      submissionError: submissionError
        ? String(submissionError.message || submissionError)
        : null,
    });
  } catch (error) {
    console.error("ServHQ fatal error:", error);

    return res.status(500).json({
      reply: "Sorry — ServHQ had trouble responding.",
      voiceReply: "Sorry — ServHQ had trouble responding.",
    });
  }
}

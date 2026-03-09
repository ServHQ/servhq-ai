import OpenAI from "openai";
import nodemailer from "nodemailer";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const LEAD_TO_EMAIL = process.env.LEAD_TO_EMAIL || "info@servhq.com.au";

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

function buildConversationText(history, latestUserMessage) {
  const lines = [];

  for (const msg of history) {
    if (msg.content === "[LEAD_SUBMITTED]") continue;
    lines.push(`${msg.role.toUpperCase()}: ${msg.content}`);
  }

  lines.push(`USER: ${latestUserMessage}`);
  return lines.join("\n");
}

function hasAlreadySubmitted(history) {
  return history.some((m) => m.content === "[LEAD_SUBMITTED]");
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "Not provided";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function buildEmailHtml(lead, transcript) {
  const commonFields = [
    ["Service", lead.service],
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Address", lead.address],
  ];

  let serviceFields = [];

  if (lead.service === "cleaning") {
    serviceFields = [
      ["Property type", lead.property_type],
      ["Bedrooms", lead.bedrooms],
      ["Bathrooms", lead.bathrooms],
      ["Main areas", lead.main_areas],
      ["Main concerns", lead.main_concerns],
      ["Pets", lead.pets],
      ["Clean type", lead.clean_type],
      ["Preferred date/time", lead.preferred_datetime],
      ["Frequency", lead.frequency],
    ];
  }

  if (lead.service === "lawn_mowing") {
    serviceFields = [
      ["Last mowed", lead.last_mowed],
      ["Front/back/both", lead.yard_areas],
      ["Yard size", lead.yard_size],
      ["Overgrown", lead.overgrown],
      ["Extras", lead.extras],
      ["Access issues / gates", lead.access_issues],
      ["Preferred date/time", lead.preferred_datetime],
      ["Once-off or ongoing", lead.frequency],
    ];
  }

  if (lead.service === "car_detailing") {
    serviceFields = [
      ["Vehicle make/model", lead.vehicle_make_model],
      ["Service type", lead.service_type],
      ["Vehicle condition", lead.vehicle_condition],
      ["Main concerns", lead.main_concerns],
      ["Heavily soiled", lead.heavily_soiled],
      ["Suburb / location", lead.suburb_location],
      ["Preferred date/time", lead.preferred_datetime],
      ["Can send photos", lead.photos_available],
    ];
  }

  if (lead.service === "pressure_washing") {
    serviceFields = [
      ["What needs washing", lead.area_types],
      ["Approximate size", lead.area_size],
      ["Heavy dirt / mould / moss / staining", lead.dirt_condition],
      ["Easy access", lead.access],
      ["Water access issues", lead.water_access_issues],
      ["Preferred date/time", lead.preferred_datetime],
      ["Once-off or ongoing", lead.frequency],
    ];
  }

  if (lead.service === "pest_control") {
    serviceFields = [
      ["Property type", lead.property_type],
      ["Pest issue", lead.pest_issue],
      ["Severity", lead.severity],
      ["Inside / outside / both", lead.inside_outside],
      ["Property size", lead.property_size],
      ["Pets or children on site", lead.pets_or_children],
      ["Preferred date/time", lead.preferred_datetime],
      ["One-off or ongoing", lead.frequency],
    ];
  }

  const rows = [...commonFields, ...serviceFields]
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:10px 12px;border:1px solid #ddd;font-weight:600;background:#f7f7f7;">${label}</td>
          <td style="padding:10px 12px;border:1px solid #ddd;">${formatValue(value)}</td>
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
      <div style="white-space:pre-wrap;border:1px solid #ddd;padding:14px;border-radius:8px;background:#fafafa;">${transcript}</div>
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
    "",
  ];

  if (lead.service === "cleaning") {
    lines.push(
      `Property type: ${formatValue(lead.property_type)}`,
      `Bedrooms: ${formatValue(lead.bedrooms)}`,
      `Bathrooms: ${formatValue(lead.bathrooms)}`,
      `Main areas: ${formatValue(lead.main_areas)}`,
      `Main concerns: ${formatValue(lead.main_concerns)}`,
      `Pets: ${formatValue(lead.pets)}`,
      `Clean type: ${formatValue(lead.clean_type)}`,
      `Preferred date/time: ${formatValue(lead.preferred_datetime)}`,
      `Frequency: ${formatValue(lead.frequency)}`
    );
  }

  if (lead.service === "lawn_mowing") {
    lines.push(
      `Last mowed: ${formatValue(lead.last_mowed)}`,
      `Front/back/both: ${formatValue(lead.yard_areas)}`,
      `Yard size: ${formatValue(lead.yard_size)}`,
      `Overgrown: ${formatValue(lead.overgrown)}`,
      `Extras: ${formatValue(lead.extras)}`,
      `Access issues: ${formatValue(lead.access_issues)}`,
      `Preferred date/time: ${formatValue(lead.preferred_datetime)}`,
      `Frequency: ${formatValue(lead.frequency)}`
    );
  }

  if (lead.service === "car_detailing") {
    lines.push(
      `Vehicle make/model: ${formatValue(lead.vehicle_make_model)}`,
      `Service type: ${formatValue(lead.service_type)}`,
      `Vehicle condition: ${formatValue(lead.vehicle_condition)}`,
      `Main concerns: ${formatValue(lead.main_concerns)}`,
      `Heavily soiled: ${formatValue(lead.heavily_soiled)}`,
      `Suburb/location: ${formatValue(lead.suburb_location)}`,
      `Preferred date/time: ${formatValue(lead.preferred_datetime)}`,
      `Can send photos: ${formatValue(lead.photos_available)}`
    );
  }

  if (lead.service === "pressure_washing") {
    lines.push(
      `What needs washing: ${formatValue(lead.area_types)}`,
      `Approximate size: ${formatValue(lead.area_size)}`,
      `Heavy dirt / mould / moss / staining: ${formatValue(lead.dirt_condition)}`,
      `Easy access: ${formatValue(lead.access)}`,
      `Water access issues: ${formatValue(lead.water_access_issues)}`,
      `Preferred date/time: ${formatValue(lead.preferred_datetime)}`,
      `Frequency: ${formatValue(lead.frequency)}`
    );
  }

  if (lead.service === "pest_control") {
    lines.push(
      `Property type: ${formatValue(lead.property_type)}`,
      `Pest issue: ${formatValue(lead.pest_issue)}`,
      `Severity: ${formatValue(lead.severity)}`,
      `Inside/outside: ${formatValue(lead.inside_outside)}`,
      `Property size: ${formatValue(lead.property_size)}`,
      `Pets or children: ${formatValue(lead.pets_or_children)}`,
      `Preferred date/time: ${formatValue(lead.preferred_datetime)}`,
      `Frequency: ${formatValue(lead.frequency)}`
    );
  }

  lines.push("", "Conversation transcript:", transcript);
  return lines.join("\n");
}

async function sendLeadEmail(lead, transcript) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const subjectService = lead.service ? lead.service.replace(/_/g, " ") : "service request";

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: LEAD_TO_EMAIL,
    replyTo: lead.email || undefined,
    subject: `New ServHQ ${subjectService} lead - ${lead.name || "No name"}`,
    text: buildEmailText(lead, transcript),
    html: buildEmailHtml(lead, transcript),
  });
}

const ASSISTANT_PROMPT = `
You are Ask ServHQ, a concierge assistant for organising local services.

Your job is to collect a complete quote request and then stop asking questions.

Supported services:
- cleaning
- lawn mowing
- car detailing
- pressure washing
- pest control

Rules:
- Ask only ONE question at a time.
- Keep replies short, helpful, and professional.
- Never invent providers, prices, availability, or confirmed bookings.
- For every lead, collect these common fields:
  1. full name
  2. phone number
  3. email
  4. full address

Service-specific fields:

Cleaning:
- type of property
- number of bedrooms
- number of bathrooms
- main areas needing attention
- main concerns
- any pets
- regular clean, deep clean, vacate clean, or one-off
- preferred date and time
- how often

Lawn mowing:
- when the lawn was last mowed
- front yard, backyard, or both
- approximate yard size
- whether the grass is overgrown
- extras needed (edging, weeding, hedge trimming, green waste removal)
- access issues or gates
- preferred date and time
- once-off or ongoing

Car detailing:
- make and model
- type of service needed
- condition of vehicle
- main concerns
- whether heavily soiled
- suburb / location
- preferred date and time
- whether photos can be sent if needed

Pressure washing:
- full address
- what needs to be pressure washed
- approximate size
- heavy dirt, mould, moss, or staining
- easy access
- any water access issues
- preferred date and time
- once-off or ongoing

Pest control:
- type of property
- pest issue
- severity
- inside, outside, or both
- approximate property size
- pets or children on site
- preferred date and time
- one-off or ongoing prevention

Conversation behaviour:
- If the service is unclear, ask what service they need.
- If multiple pieces of information are missing, ask for the single most important next item.
- Prioritize service type first, then common contact details, then service-specific details.
- Once everything required is collected, reply with a short confirmation such as:
  "Perfect — I’ve got everything I need. I’ll now pass this through to ServHQ so the right partnered business can be matched to your job."
- Do not ask any more questions after everything required is collected.
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

    "property_type": "",
    "bedrooms": "",
    "bathrooms": "",
    "main_areas": "",
    "main_concerns": "",
    "pets": "",
    "clean_type": "",

    "last_mowed": "",
    "yard_areas": "",
    "yard_size": "",
    "overgrown": "",
    "extras": "",
    "access_issues": "",

    "vehicle_make_model": "",
    "service_type": "",
    "vehicle_condition": "",
    "heavily_soiled": "",
    "suburb_location": "",
    "photos_available": "",

    "area_types": "",
    "area_size": "",
    "dirt_condition": "",
    "access": "",
    "water_access_issues": "",

    "pest_issue": "",
    "severity": "",
    "inside_outside": "",
    "property_size": "",
    "pets_or_children": "",

    "preferred_datetime": "",
    "frequency": ""
  }
}

Rules:
- Use empty strings for unknown values.
- "service" must be one of:
  cleaning, lawn_mowing, car_detailing, pressure_washing, pest_control, unknown
- "is_complete" must only be true when all common fields are present:
  service, name, phone, email, address
  and all required service-specific fields are present.
- "missing_fields" should contain machine-friendly field names only.
- Return valid JSON only. No markdown. No explanation.
`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://servhq.com.au");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "Ask ServHQ API is live",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = String(body.message || "").trim();
    const history = normalizeHistory(body.history);

    if (!message) {
      return res.status(400).json({
        reply: "Please send a message.",
      });
    }

    const assistantInput = [
      {
        role: "system",
        content: [{ type: "input_text", text: ASSISTANT_PROMPT }],
      },
      ...history.map((m) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }],
      })),
      {
        role: "user",
        content: [{ type: "input_text", text: message }],
      },
    ];

    const assistantResponse = await client.responses.create({
      model: "gpt-5-mini",
      input: assistantInput,
    });

    const reply =
      assistantResponse.output_text ||
      "Sorry — Ask ServHQ had trouble responding.";

    const transcript = buildConversationText(history, message);

    const extractionResponse = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: EXTRACTION_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: transcript }],
        },
      ],
    });

    const extracted = safeJsonParse(extractionResponse.output_text) || {
      service: "unknown",
      is_complete: false,
      missing_fields: [],
      lead: {
        service: "",
        name: "",
        phone: "",
        email: "",
        address: "",
      },
    };

    const lead = {
      ...(extracted.lead || {}),
      service: extracted.service || extracted.lead?.service || "unknown",
    };

    let submitted = false;

    if (extracted.is_complete && !hasAlreadySubmitted(history)) {
      await sendLeadEmail(lead, `${transcript}\nASSISTANT: ${reply}`);
      submitted = true;
    }

    return res.status(200).json({
      reply,
      submitted,
      leadComplete: Boolean(extracted.is_complete),
      service: lead.service || "unknown",
      missingFields: extracted.missing_fields || [],
    });
  } catch (error) {
    console.error("Ask ServHQ error:", error);

    return res.status(500).json({
      reply: "Sorry — Ask ServHQ had trouble responding.",
    });
  }
}

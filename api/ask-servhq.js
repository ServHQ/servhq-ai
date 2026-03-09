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
  ];

  const rows = [...commonFields, ...serviceFields]
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:10px 12px;border:1px solid #ddd;font-weight:600;background:#f7f7f7;">${escapeHtml(label)}</td>
          <td style="padding:10px 12px;border:1px solid #ddd;">${escapeHtml(formatValue(value))}</td>
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
      <div style="white-space:pre-wrap;border:1px solid #ddd;padding:14px;border-radius:8px;background:#fafafa;">${escapeHtml(transcript)}</div>
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

Your job is to collect a simple quote request with only the core details needed, then stop asking questions.

Supported services:
- cleaning
- lawn mowing
- car detailing
- pressure washing
- pest control

Collect only these required fields:
1. service
2. full name
3. phone number
4. email
5. full address
6. job type
7. basic job details
8. preferred date and time

How to interpret the fields:
- "job type" = the main type of work needed for that service
  Examples:
  - cleaning: regular clean, deep clean, vacate clean
  - lawn mowing: lawn mow, yard clean-up, hedge trim
  - car detailing: interior detail, full detail, cut and polish
  - pressure washing: driveway, house exterior, paths, patio
  - pest control: ants, cockroaches, spiders, termites
- "basic job details" = a short description that helps us understand the job without asking too many questions
  Examples:
  - cleaning: bedrooms/bathrooms + any main concern
  - lawn mowing: last mowed / overgrown / any extras
  - car detailing: vehicle make/model + condition
  - pressure washing: what areas + rough size/condition
  - pest control: pest issue + where the problem is

Rules:
- Ask only ONE question at a time.
- Keep replies short, helpful, and professional.
- Never invent providers, prices, availability, or confirmed bookings.
- Do not ask long checklists.
- Do not ask unnecessary follow-up questions once you have enough for a lead.
- If the service is unclear, ask what service they need first.
- Prioritize in this order:
  1. service
  2. name
  3. phone
  4. email
  5. address
  6. job type
  7. job details
  8. preferred date/time
- If the user already gave multiple answers in one message, do not ask for them again.
- Once everything required is collected, reply with:
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
    "job_type": "",
    "job_details": "",
    "preferred_datetime": ""
  }
}

Rules:
- Use empty strings for unknown values.
- "service" must be one of:
  cleaning, lawn_mowing, car_detailing, pressure_washing, pest_control, unknown
- "is_complete" must only be true when all of these fields are present:
  service, name, phone, email, address, job_type, job_details, preferred_datetime
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

    console.log("Incoming Ask ServHQ message:", message);
    console.log("Normalized history length:", history.length);

    const assistantInput = [
      {
        role: "system",
        content: ASSISTANT_PROMPT,
      },
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: "user",
        content: message,
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
      lead: {
        service: "",
        name: "",
        phone: "",
        email: "",
        address: "",
        job_type: "",
        job_details: "",
        preferred_datetime: "",
      },
    };

    const lead = {
      ...(extracted.lead || {}),
      service: extracted.service || extracted.lead?.service || "unknown",
    };

    console.log("Extracted lead:", JSON.stringify(lead, null, 2));
    console.log("Is complete:", extracted.is_complete);
    console.log("Missing fields:", extracted.missing_fields || []);

    let submitted = false;
    let submissionError = null;

    if (extracted.is_complete && !hasAlreadySubmitted(history)) {
      try {
        console.log("Attempting to send lead email...");
        await sendLeadEmail(lead, `${transcript}\nASSISTANT: ${reply}`);
        submitted = true;
        console.log("Lead email sent successfully.");
      } catch (emailError) {
        submissionError = emailError;
        console.error("Lead email failed:", emailError);
      }
    }

    return res.status(200).json({
      reply,
      submitted,
      leadComplete: Boolean(extracted.is_complete),
      service: lead.service || "unknown",
      missingFields: extracted.missing_fields || [],
      submissionError: submissionError ? String(submissionError.message || submissionError) : null,
    });
  } catch (error) {
    console.error("Ask ServHQ fatal error:", error);

    return res.status(500).json({
      reply: "Sorry — Ask ServHQ had trouble responding.",
    });
  }
}

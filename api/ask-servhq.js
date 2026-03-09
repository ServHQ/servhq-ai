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

function historyForModel(history) {
  return history.filter((m) => !String(m.content || "").startsWith("[LEAD_SUBMITTED]"));
}

function buildConversationText(history, latestUserMessage) {
  const lines = [];

  for (const msg of history) {
    if (String(msg.content || "").startsWith("[LEAD_SUBMITTED]")) continue;
    lines.push(`${msg.role.toUpperCase()}: ${msg.content}`);
  }

  lines.push(`USER: ${latestUserMessage}`);
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
  };
}

function applyReplyOverrides(rawReply, extracted) {
  const missing = extracted?.missing_fields || [];
  const lead = extracted?.lead || {};
  const nextField = missing[0];

  if (!nextField) {
    return "Perfect — I’ve got everything I need for that. Is there any other services you are trying to get taken care of while your here?";
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
      return "Are you after an interior detail, full detail, or cut and polish?";
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
      return "Can you briefly describe the yard — front, back, approximate size, and whether it’s overgrown?";
    }

    if (lead.service === "car_detailing") {
      return "Can you briefly describe the vehicle — make/model and overall condition?";
    }

    if (lead.service === "pressure_washing") {
      return "Can you briefly describe the area and condition so we can quote it properly?";
    }

    if (lead.service === "pest_control") {
      return "Can you briefly describe where the issue is and how bad it is?";
    }

    return "Can you briefly describe the job so we can quote it properly?";
  }

  if (nextField === "preferred_datetime") {
    if (lead.service === "cleaning") {
      return "What’s your preferred date and time for the clean?";
    }

    if (lead.service === "lawn_mowing") {
      return "What’s your preferred date and time for the lawn mowing?";
    }

    if (lead.service === "car_detailing") {
      return "What’s your preferred date and time for the detail?";
    }

    return "What’s your preferred date and time?";
  }

  return rawReply;
}

function shouldExtractNow(reply) {
  if (!reply) return false;

  const normalized = String(reply).toLowerCase();

  return (
    normalized.includes("i’ve got everything i need") ||
    normalized.includes("i've got everything i need") ||
    normalized.includes("pass this through to servhq")
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

function hasSubmittedMarker(history) {
  return history.some((m) => String(m.content || "").startsWith("[LEAD_SUBMITTED]"));
}

async function extractLeadFromTranscript(transcript) {
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

  return (
    safeJsonParse(extractionResponse.output_text) || {
      service: "unknown",
      is_complete: false,
      missing_fields: [],
      lead: emptyLead(),
    }
  );
}

const ASSISTANT_PROMPT = `
You are ServHQ, a helpful human-sounding concierge assistant for organising local services.

Your goal is to collect only the core details needed to organise a free quote, while making the conversation feel natural and easy.

Supported services:
- cleaning
- lawn mowing
- car detailing
- pressure washing
- pest control

Required fields:
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

Behavior rules:
- Sound like a real assistant, not a form.
- Ask only one question at a time.
- Keep replies short, clear, and natural.
- Do not repeatedly restate the user's details back to them.
- Do not recap their name, phone, email, or address unless they asked you to confirm it or they corrected something.
- Avoid repeated "thanks", "perfect", and long summaries after every answer.
- If the user already gave a detail, do not ask for it again.
- If the service is obvious from the user's message, do not ask what service they need.
- If the job type is obvious from the user's message, do not ask for it again.
- If the user asks for another service after one has already been completed, reuse their existing contact details and address unless they change them.
- Briefly acknowledge what the user has already told you before asking the next question, but keep it concise.
- Never invent pricing, availability, providers, or confirmed bookings.
- When asking for the customer's name, say exactly:
  "What is your name please?"
- When asking for the customer's phone number, say exactly:
  "What’s the best phone number to reach you? We won’t call you yet — it’s just so our team can reach out when they have a quote ready."
- Once all required fields are collected, say exactly:
  "Perfect — I’ve got everything I need for that. Is there any other services you are trying to get taken care of while your here?"
- Do not ask any more questions after everything required is collected unless the user wants another service.
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

    if (looksLikeNoMoreServices(message) && hasSubmittedMarker(history)) {
      return res.status(200).json({
        reply: "Perfect — you’re all set. Our team will now work on the quote request and be in touch.",
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
      model: "gpt-5-mini",
      input: assistantInput,
    });

    const rawReply =
      assistantResponse.output_text ||
      "Sorry — ServHQ had trouble responding.";

    const transcript = buildConversationText(history, message);

    let reply = rawReply;
    let submitted = false;
    let submissionError = null;
    let extracted = null;
    let lead = emptyLead();

    if (shouldExtractNow(rawReply)) {
      extracted = await extractLeadFromTranscript(transcript);

      lead = {
        ...(extracted.lead || {}),
        service: extracted.service || extracted.lead?.service || "unknown",
      };

      console.log("Extracted lead:", JSON.stringify(lead, null, 2));
      console.log("Is complete:", extracted.is_complete);
      console.log("Missing fields:", extracted.missing_fields || []);

      if (extracted.is_complete) {
        reply = "Perfect — I’ve got everything I need for that. Is there any other services you are trying to get taken care of while your here?";

        try {
          console.log("Attempting to send lead email...");
          await sendLeadEmail(lead, `${transcript}\nASSISTANT: ${reply}`);
          submitted = true;
          console.log("Lead email sent successfully.");
        } catch (emailError) {
          submissionError = emailError;
          console.error("Lead email failed:", emailError);
        }
      } else {
        reply = applyReplyOverrides(rawReply, extracted);
      }
    }

    return res.status(200).json({
      reply,
      submitted,
      leadComplete: Boolean(extracted?.is_complete),
      service: lead.service || "unknown",
      missingFields: extracted?.missing_fields || [],
      submissionError: submissionError ? String(submissionError.message || submissionError) : null,
    });
  } catch (error) {
    console.error("ServHQ fatal error:", error);

    return res.status(500).json({
      reply: "Sorry — ServHQ had trouble responding.",
    });
  }
}

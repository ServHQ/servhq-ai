import OpenAI from "openai";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // handle preflight requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({
      reply: "Method not allowed",
    });
  }

  try {
    const { message, history = [] } = req.body || {};

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const SYSTEM_PROMPT = `
You are Ask ServHQ, a concierge assistant for organising local services.

Your job is to:
- identify what service the customer needs
- ask only the next missing question
- ask one question at a time
- keep replies short, helpful, and professional
- never invent providers, pricing, or confirmed bookings

Supported services:
- cleaning
- lawn mowing
- car detailing
- pressure washing
- pest control

If the request is unclear, ask what service they need.
`;

    const input = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      ...history.map((m) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }],
      })),
      {
        role: "user",
        content: [{ type: "input_text", text: message || "" }],
      },
    ];

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input,
    });

    const reply =
      response.output_text ||
      "Sorry — Ask ServHQ had trouble responding.";

    return res.status(200).json({ reply });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      reply: "Sorry — Ask ServHQ had trouble responding.",
    });
  }
}

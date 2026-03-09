import express from "express";
import OpenAI from "openai";

const app = express();

app.use(express.json());

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

app.get("/", (_req, res) => {
  res.send("ServHQ AI backend live");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/ask-servhq", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const input = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }],
      })),
      {
        role: "user",
        content: [{ type: "input_text", text: message }],
      },
    ];

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input,
    });

    res.json({
      reply: response.output_text || "Sorry — Ask ServHQ had trouble responding.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      reply: "Sorry — Ask ServHQ had trouble responding.",
    });
  }
});

export default app;

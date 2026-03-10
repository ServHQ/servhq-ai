import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ALLOWED_ORIGINS = new Set([
  "https://servhq.com.au",
  "https://www.servhq.com.au",
  "https://servhq.myshopify.com"
]);

function setCors(req: any, res: any) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "Speech API is live",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text } = req.body || {};

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }

    const speech = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "sage",
      input: text,
      response_format: "mp3",
    });

    const arrayBuffer = await speech.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("OpenAI speech error:", error);
    return res.status(500).json({ error: "Speech generation failed" });
  }
}

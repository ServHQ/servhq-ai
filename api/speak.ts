import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: any, res: any) {
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
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("OpenAI speech error:", error);
    return res.status(500).json({ error: "Speech generation failed" });
  }
}

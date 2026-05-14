import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { notes } = req.body;
  if (!notes || notes.trim().length < 10)
    return res.status(400).json({ error: "Please provide more content to work with." });

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: `You are an expert study assistant. Based on the following notes or topic, create comprehensive study materials.

Input:
${notes}

Respond in this EXACT format with these three clearly labeled sections:

## STUDY GUIDE
Write a structured summary with key concepts and important points using clear headings and bullet points.

## FLASHCARDS
Create exactly 8 flashcard pairs in this format:
Q: [question]
A: [answer]

## PRACTICE QUESTIONS
Create 5 multiple choice questions (A/B/C/D) with the correct answer marked at the end of each.`,
        },
      ],
    });

    return res.status(200).json({ result: message.content[0].text });
  } catch (error) {
    console.error("Claude API error:", error);
    return res.status(500).json({ error: "Failed to generate study materials. Please try again." });
  }
}

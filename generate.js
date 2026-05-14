import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Rate limiter (in-memory, best-effort across warm instances) ──────────────
const rateMap = new Map();
const RATE_LIMIT   = 5;                  // max requests per IP
const RATE_WINDOW  = 60 * 60 * 1000;    // per 1 hour
const MAX_CHARS    = 4000;               // max input length

function checkRate(ip) {
  const now = Date.now();
  let rec   = rateMap.get(ip);

  if (!rec || now - rec.start > RATE_WINDOW) {
    rateMap.set(ip, { count: 1, start: now });
    return { ok: true, remaining: RATE_LIMIT - 1 };
  }
  if (rec.count >= RATE_LIMIT) {
    const mins = Math.ceil((rec.start + RATE_WINDOW - now) / 60_000);
    return { ok: false, mins };
  }
  rec.count++;
  return { ok: true, remaining: RATE_LIMIT - rec.count };
}

// Clean up old entries every ~100 requests to avoid memory bloat
let cleanupCounter = 0;
function maybeCleanup() {
  if (++cleanupCounter % 100 !== 0) return;
  const cutoff = Date.now() - RATE_WINDOW;
  for (const [ip, rec] of rateMap) {
    if (rec.start < cutoff) rateMap.delete(ip);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed." });

  // ── Rate limit ─────────────────────────────────────────────────────────────
  const ip = (req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
             || req.socket?.remoteAddress
             || "unknown";
  maybeCleanup();
  const rate = checkRate(ip);
  if (!rate.ok)
    return res.status(429).json({
      error: `You've reached the limit of ${RATE_LIMIT} generations per hour. Try again in ${rate.mins} minute(s).`,
    });

  // ── Input validation ───────────────────────────────────────────────────────
  const { notes } = req.body ?? {};
  if (!notes || typeof notes !== "string")
    return res.status(400).json({ error: "Please provide some notes or a topic." });

  const trimmed = notes.trim();
  if (trimmed.length < 10)
    return res.status(400).json({ error: "Please enter at least a sentence or a topic." });
  if (trimmed.length > MAX_CHARS)
    return res.status(400).json({
      error: `Input is too long (${trimmed.length} chars). Please keep it under ${MAX_CHARS.toLocaleString()} characters.`,
    });

  // ── Call Claude ────────────────────────────────────────────────────────────
  try {
    const message = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2500,
      messages: [{
        role: "user",
        content: `You are an expert study assistant. Based on the following notes or topic, create comprehensive study materials.

Input:
${trimmed}

Respond using EXACTLY these three section headers (keep them verbatim):

## STUDY GUIDE
A structured summary with key concepts and important points, using headings and bullet points.

## FLASHCARDS
Exactly 8 flashcard pairs, each on its own line pair:
Q: [question]
A: [answer]

## PRACTICE QUESTIONS
5 multiple-choice questions (A / B / C / D). Mark the correct answer at the end of each question like: Correct answer: B`,
      }],
    });

    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    return res.status(200).json({ result: message.content[0].text });

  } catch (err) {
    console.error("Claude API error:", err);
    if (err.status === 529 || err.message?.includes("overload"))
      return res.status(503).json({ error: "Claude is temporarily busy — please try again in a moment." });
    if (err.status === 401)
      return res.status(500).json({ error: "API key error. Please contact support." });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

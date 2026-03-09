import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { decryptAPIKeys } from "../services/encryption.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

const router = Router();

const TTS_MODEL = "tts-1";
const TTS_VOICE = "nova";
const CHAT_MODEL = "gpt-4o";

const BRIEFING_SYSTEM_PROMPT = `You are Cohi, an executive-intelligent AI analyst for the Coheus Executive Intelligence Platform.

Write a concise spoken briefing script (~90 seconds when read aloud) for a mortgage executive.
Rules:
- Speak naturally as if delivering a live briefing. No stage directions, no brackets, no music cues.
- Lead with the most critical finding, then cover 3-5 key insights.
- Read financial figures in full: "$1.2M" → "one point two million dollars".
- Be fact-first: state what the data shows. Never recommend actions.
- End with a brief forward-looking observation.
- Output ONLY the spoken script text, nothing else.`;

const QUESTION_SYSTEM_PROMPT = `You are Cohi, an executive AI analyst on the Coheus platform.
The user just listened to a daily briefing and has a follow-up question.
Answer concisely and factually based on the briefing context and your domain expertise.
Rules:
- Speak naturally, as if answering live. No brackets or stage directions.
- Read financial figures in full.
- Be direct and factual.
- Keep your answer under 60 seconds when read aloud.`;

async function getOpenAIKey(tenantId?: string): Promise<string> {
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'rag_settings'
        ) as exists
      `);
      if (tableCheck.rows[0]?.exists) {
        const result = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        if (result.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({
            openai_api_key: result.rows[0].openai_api_key,
          });
          if (decrypted.openai_api_key) return decrypted.openai_api_key;
        }
      }
    } catch (err: any) {
      console.error("[Podcast] Error fetching tenant API key:", err.message);
    }
  }

  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) {
    if (envKey.startsWith("{")) {
      try {
        const parsed = JSON.parse(envKey) as {
          api_key?: string;
          apiKey?: string;
          OPENAI_API_KEY?: string;
        };
        const fromJson =
          parsed.api_key || parsed.apiKey || parsed.OPENAI_API_KEY || "";
        if (fromJson.trim()) return fromJson.trim();
      } catch {
        // keep raw
      }
    }
    return envKey;
  }

  throw new Error("OpenAI API key not configured");
}

async function fetchInsightsForBriefing(
  tenantId: string
): Promise<{ insights: any[]; summary: string }> {
  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const result = await tenantPool.query(`
      SELECT headline, understory, bucket, severity_score, impact, evidence, priority
      FROM aletheia_insights
      WHERE for_podcast = true
      ORDER BY severity_score DESC NULLS LAST, generated_at DESC
      LIMIT 10
    `);
    const insights = result.rows;
    const summary = insights
      .map(
        (i: any) =>
          `[${i.bucket || "General"}] ${i.headline}: ${i.understory || ""}`
      )
      .join("\n");
    return { insights, summary };
  } catch (err: any) {
    console.warn("[Podcast] Could not fetch insights:", err.message);
    return { insights: [], summary: "" };
  }
}

async function generateBriefingScript(
  apiKey: string,
  insightsSummary: string
): Promise<string> {
  const userPrompt = insightsSummary
    ? `Here are today's key insights for the executive briefing:\n\n${insightsSummary}\n\nDeliver the spoken briefing.`
    : `No specific insights are available today. Deliver a brief general mortgage market update based on your knowledge.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: BRIEFING_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      `OpenAI chat error: ${err.error?.message || response.statusText}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || "Briefing unavailable.";
}

async function streamTTSToSSE(
  res: Response,
  apiKey: string,
  text: string
): Promise<void> {
  const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      voice: TTS_VOICE,
      response_format: "pcm",
    }),
  });

  if (!ttsResponse.ok || !ttsResponse.body) {
    const errBody = await ttsResponse.text().catch(() => "unknown");
    throw new Error(`OpenAI TTS error (${ttsResponse.status}): ${errBody}`);
  }

  const reader = (ttsResponse.body as any).getReader();
  const CHUNK_SIZE = 4800; // ~100ms of 24kHz 16-bit mono PCM
  let leftover = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const combined = new Uint8Array(leftover.length + value.length);
    combined.set(leftover);
    combined.set(value, leftover.length);

    let offset = 0;
    while (offset + CHUNK_SIZE <= combined.length) {
      const chunk = combined.slice(offset, offset + CHUNK_SIZE);
      const base64 = Buffer.from(chunk).toString("base64");
      res.write(`data: ${JSON.stringify({ type: "audio", data: base64 })}\n\n`);
      offset += CHUNK_SIZE;
    }
    leftover = combined.slice(offset);
  }

  if (leftover.length > 0) {
    const base64 = Buffer.from(leftover).toString("base64");
    res.write(`data: ${JSON.stringify({ type: "audio", data: base64 })}\n\n`);
  }
}

// GET /api/podcast/cohi/briefing — prefetch briefing script
router.get(
  "/briefing",
  apiLimiter,
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantId = tenantContext?.tenantId || req.tenantId;
      const apiKey = await getOpenAIKey(tenantId);

      const { insights, summary } = await fetchInsightsForBriefing(
        tenantId || ""
      );
      const script = await generateBriefingScript(apiKey, summary);

      res.json({
        success: true,
        briefing: {
          script,
          metrics: insights.map((i: any) => ({
            bucket: i.bucket,
            headline: i.headline,
            severity: i.severity_score,
          })),
        },
      });
    } catch (error: any) {
      console.error("[Podcast] Briefing error:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/podcast/cohi/stream — stream TTS audio for the briefing
router.post(
  "/stream",
  apiLimiter,
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const tenantContext = getTenantContext(req);
      const tenantId = tenantContext?.tenantId || req.tenantId;
      const apiKey = await getOpenAIKey(tenantId);

      const { insights, summary } = await fetchInsightsForBriefing(
        tenantId || ""
      );
      const script = await generateBriefingScript(apiKey, summary);

      res.write(
        `data: ${JSON.stringify({ type: "script", data: script })}\n\n`
      );

      await streamTTSToSSE(res, apiKey, script);

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("[Podcast] Stream error:", error.message);
      res.write(
        `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`
      );
      res.end();
    }
  }
);

// POST /api/podcast/cohi/ask — follow-up question with TTS response
router.post(
  "/ask",
  apiLimiter,
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const tenantContext = getTenantContext(req);
      const tenantId = tenantContext?.tenantId || req.tenantId;
      const apiKey = await getOpenAIKey(tenantId);

      let questionText = req.body?.question || "";

      // If audio was sent, transcribe it first
      if (req.body?.audio && !questionText) {
        const audioBuffer = Buffer.from(req.body.audio, "base64");
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([audioBuffer], { type: "audio/webm" }),
          "audio.webm"
        );
        formData.append("model", "whisper-1");

        const whisperRes = await fetch(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
          }
        );

        if (!whisperRes.ok) {
          throw new Error("Failed to transcribe audio");
        }

        const whisperData = (await whisperRes.json()) as { text?: string };
        questionText = whisperData.text || "";

        res.write(
          `data: ${JSON.stringify({ type: "user_question", data: questionText })}\n\n`
        );
      }

      if (!questionText.trim()) {
        res.write(
          `data: ${JSON.stringify({ type: "error", error: "No question provided" })}\n\n`
        );
        res.end();
        return;
      }

      // Generate answer
      const chatRes = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: CHAT_MODEL,
            messages: [
              { role: "system", content: QUESTION_SYSTEM_PROMPT },
              { role: "user", content: questionText },
            ],
            temperature: 0.5,
            max_tokens: 1000,
          }),
        }
      );

      if (!chatRes.ok) {
        throw new Error("Failed to generate answer");
      }

      const chatData = (await chatRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const answer =
        chatData.choices?.[0]?.message?.content || "I couldn't generate an answer.";

      res.write(
        `data: ${JSON.stringify({ type: "transcript", data: answer })}\n\n`
      );

      await streamTTSToSSE(res, apiKey, answer);

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("[Podcast] Ask error:", error.message);
      res.write(
        `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`
      );
      res.end();
    }
  }
);

export default router;

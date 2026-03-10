import { Router, Response } from "express";
import { WebSocket } from "ws";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
} from "../middleware/tenantContext.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { decryptAPIKeys } from "../services/encryption.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { startSSEHeartbeat } from "../utils/sseUtils.js";
import { getPlatformSetting } from "../services/platformSettingsService.js";
import {
  hasPersistedAletheiaAsset,
  loadPersistedAletheiaAsset,
  persistAletheiaAsset,
} from "../services/aletheiaAssetStore.js";
import { enqueueAletheiaPrefetchJob } from "../services/aletheiaPrefetchWorker.js";

const router = Router();

const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_VOICE = "cedar";
const CHAT_MODEL = "gpt-4o";
const GEMINI_DEFAULT_MODEL = "models/gemini-2.5-flash-native-audio-latest";
const GEMINI_DEFAULT_VOICE = "Aoede";
const GEMINI_VALID_VOICES = new Set([
  "Aoede", "Charon", "Fenrir", "Kore", "Leda", "Orus", "Puck", "Zephyr",
]);
const GEMINI_MODEL_FALLBACKS = [
  "models/gemini-2.5-flash-native-audio-latest",
  "models/gemini-2.5-flash-native-audio-preview-12-2025",
  "models/gemini-2.5-flash-native-audio-preview-09-2025",
];

const TTS_INSTRUCTIONS = `Voice: calm, even-paced, professional newsreader. Maintain a steady, clear tone throughout the entire reading. Do not speed up, trail off, or lose clarity at any point. Consistent volume and articulation from start to finish.`;

const BRIEFING_SYSTEM_PROMPT = `You are Cohi, a neutral data analyst for the Coheus Executive Intelligence Platform.

Write a spoken briefing script (~90 seconds when read aloud) for a mortgage executive.

TONE — STRICTLY NEUTRAL & OBJECTIVE:
- You are a data reporter, not an advisor. Report facts. Do not editorialize.
- BANNED WORDS — never use any of these: significant, critical, pressing, extreme, massive, dramatic, alarming, staggering, unprecedented, explosive, crucial, urgent, remarkable, notable, concerning, troubling, worrisome, key, vital, important, major. This list is non-exhaustive — avoid ALL adjectives that imply urgency, severity, or prioritization.
- Do NOT prioritize or rank findings for the listener. Present each data point objectively and let the executive decide what matters.
- Do NOT frame anything as "good news" or "bad news". Just state the numbers.
- Use plain, factual phrasing: "Revenue was one point two million dollars, down twelve percent from last month." Not: "Revenue saw a significant decline."

FORMAT:
- Speak naturally. No stage directions, brackets, or music cues.
- Cover 3-5 data points from the insights provided.
- Read financial figures in full: "$1.2M" → "one point two million dollars".
- Do not recommend actions or suggest what the executive should focus on.
- Close with one factual forward-looking data point if available.
- Output ONLY the spoken script text.`;

const QUESTION_SYSTEM_PROMPT = `You are Cohi, a neutral data analyst on the Coheus platform.
The user has a follow-up question after their briefing.
Rules:
- Answer with facts only. Do not editorialize or prioritize.
- Never use dramatic adjectives (significant, critical, pressing, extreme, massive, etc.).
- Do not tell the user what they should focus on or what matters most. Just answer the question.
- Read financial figures in full.
- Keep your answer under 60 seconds when read aloud.
- No brackets, stage directions, or filler.`;

const ALETHEIA_BRIEFING_PROMPT = `You are Cohi, a neutral, objective data analyst for the Coheus Executive Intelligence Platform.

Write a spoken executive briefing script that runs about two to three minutes when read aloud for a mortgage industry executive.

TONE — STRICTLY NEUTRAL & OBJECTIVE:
- You are a data reporter, not an advisor. Report facts. Do not editorialize.
- BANNED WORDS — never use any of these: significant, critical, pressing, extreme, massive, dramatic, alarming, staggering, unprecedented, explosive, crucial, urgent, remarkable, notable, concerning, troubling, worrisome, key, vital, important, major. Avoid ALL adjectives that imply urgency, severity, or prioritization.
- Do NOT prioritize or rank findings for the listener. Present each data point objectively.
- Do NOT frame anything as "good news" or "bad news". Just state the numbers.
- Use plain, factual phrasing: "Revenue was one point two million dollars, down twelve percent from last month."

FORMAT:
- Begin with a time-appropriate greeting (the user prompt will specify).
- Speak naturally. No stage directions, brackets, or music cues.
- Cover all provided data points in a logical order.
- Read financial figures in full: "$1.2M" → "one point two million dollars".
- Do not recommend actions or suggest what the executive should focus on.
- Use "here's the latest" for business insights. Reserve "headlines" for actual news items.
- Include any industry news context provided, relating it factually to the business data.
- Start by stating how many insights are being covered in this briefing.
- If you are approaching the length limit, explicitly state how many insights were covered and how many remain.
- Close with one factual forward-looking data point if available.
- Output ONLY the spoken script text.`;

const ALETHEIA_QUESTION_PROMPT = `${QUESTION_SYSTEM_PROMPT}
- Keep responses concise and complete.
- If you must stop due to length, end with a partial coverage note.`;
const ALETHEIA_GEMINI_TTS_PROMPT = `You are voicing a prewritten script.
- Read the script naturally and clearly.
- Preserve wording exactly. Do not add, remove, summarize, or paraphrase.
- Keep tone calm, objective, and professional.
- Do not include stage directions or extra commentary.`;

const ALETHEIA_PREFETCH_TTL_MS = 24 * 60 * 60 * 1000;
type AletheiaPrefetchEntry = {
  script: string;
  createdAt: number;
  contextHash: string;
  audioBase64?: string;
  sampleRate?: number;
  mimeType?: string;
  segmentsCount?: number;
  model?: string;
  voiceName?: string;
};
const aletheiaPrefetchCache = new Map<string, AletheiaPrefetchEntry>();

function isAletheiaAsyncPrefetchEnabled(): boolean {
  return process.env.ALETHEIA_PREFETCH_ASYNC === "true";
}

function parseSampleRateFromMimeType(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? parseInt(match[1], 10) : 24000;
}

async function writeSSE(res: Response, payload: object): Promise<void> {
  const chunk = `data: ${JSON.stringify(payload)}\n\n`;
  const canContinue = res.write(chunk);
  if (!canContinue) {
    await new Promise<void>((resolve) => {
      res.once("drain", () => resolve());
    });
  }
}

async function streamPcmBufferToSSE(
  res: Response,
  pcmBuffer: Buffer,
  meta: {
    mimeType: string;
    sampleRate: number;
    voiceName: string;
    model: string;
    segmentsCount?: number;
  }
): Promise<void> {
  await writeSSE(res, {
    type: "meta",
    mimeType: meta.mimeType,
    sampleRate: meta.sampleRate,
    voiceName: meta.voiceName,
    model: meta.model,
    segmentsCount: meta.segmentsCount || 1,
  });

  const CHUNK_SIZE = 4800; // 100ms @ 24k mono PCM16
  for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK_SIZE) {
    const chunk = pcmBuffer.subarray(offset, Math.min(offset + CHUNK_SIZE, pcmBuffer.length));
    await writeSSE(res, {
      type: "audio",
      data: chunk.toString("base64"),
    });
  }
}

function getAletheiaCacheKey(tenantId?: string): string {
  return tenantId || "global";
}

export function hashBriefingContext(briefingContext: unknown): string {
  try {
    return JSON.stringify(briefingContext ?? {});
  } catch {
    return String(Date.now());
  }
}

export async function buildDefaultAletheiaBriefingContext(tenantId: string): Promise<{
  dialogues: Array<{ message: string; type: string; priority: string }>;
  greeting: string;
}> {
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  const dialogues: Array<{ message: string; type: string; priority: string }> = [];

  try {
    const result = await tenantPool.query(
      `SELECT headline, understory, insight_type, priority
       FROM public.generated_insights
       WHERE COALESCE(for_podcast, true) = true
       ORDER BY generated_at DESC
       LIMIT 18`
    );

    for (const row of result.rows) {
      const headline = String(row.headline || "").trim();
      const understory = String(row.understory || "").trim();
      const message = [headline, understory].filter(Boolean).join(". ");
      if (!message) continue;
      dialogues.push({
        message,
        type: String(row.insight_type || "info"),
        priority: String(row.priority || "GRAY"),
      });
    }
  } catch (error: any) {
    // Older tenants may not have generated_insights yet.
    if (error?.code !== "42P01") {
      console.warn(
        `[Aletheia] Failed to build default briefing context for tenant ${tenantId}:`,
        error?.message || error
      );
    }
  }

  return {
    dialogues,
    greeting: "Good morning",
  };
}

async function getOpenAIKey(tenantId?: string): Promise<string> {
  // 1. Platform key takes priority (consistent across all tenants)
  const platformKey = await getPlatformSetting("openai_api_key");
  if (platformKey?.trim()) {
    console.log("[Podcast] Using OpenAI key from platform_settings");
    return platformKey.trim();
  }

  // 2. Tenant-specific key from rag_settings
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
          if (decrypted.openai_api_key) {
            console.log("[Podcast] Using OpenAI key from tenant rag_settings");
            return decrypted.openai_api_key;
          }
        }
      }
    } catch (err: any) {
      console.error("[Podcast] Error fetching tenant API key:", err.message);
    }
  }

  // 3. Environment variable fallback
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
        if (fromJson.trim()) {
          console.log("[Podcast] Using OpenAI key from env (JSON)");
          return fromJson.trim();
        }
      } catch {
        // keep raw
      }
    }
    console.log("[Podcast] Using OpenAI key from env");
    return envKey;
  }

  throw new Error("OpenAI API key not configured");
}

async function getGeminiVoiceConfig(
  tenantId?: string,
  ignoreTenantKey = false
): Promise<{
  apiKey: string;
  model: string;
  voiceName: string;
  keySource: "tenant" | "platform" | "env";
}> {
  const sanitizeKey = (input?: string): string => {
    const trimmed = String(input || "").trim();
    // Accept keys accidentally wrapped in quotes from copy/paste.
    return trimmed.replace(/^['"]+|['"]+$/g, "").trim();
  };

  let geminiApiKey = "";
  let voiceModel = "";
  let voiceName = "";

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
          `SELECT gemini_api_key, voice_model, voice_name FROM public.rag_settings LIMIT 1`
        );
        if (result.rows[0]) {
          const decrypted = await decryptAPIKeys({
            gemini_api_key: result.rows[0].gemini_api_key,
          });
          geminiApiKey = sanitizeKey(decrypted.gemini_api_key || "");
          voiceModel = result.rows[0].voice_model || "";
          voiceName = result.rows[0].voice_name || "";
        }
      }
    } catch (err: any) {
      console.error("[Aletheia] Error fetching Gemini tenant settings:", err.message);
    }
  }

  const platformGeminiKey = sanitizeKey(
    (await getPlatformSetting("gemini_api_key")) || ""
  );
  const envGeminiKey = sanitizeKey(process.env.GEMINI_API_KEY?.trim() || "");
  const selectedKey =
    // Platform key is the primary key for all tenants in Aletheia podcast flows.
    platformGeminiKey
      ? { apiKey: platformGeminiKey, keySource: "platform" as const }
      : !ignoreTenantKey && geminiApiKey
        ? // Tenant key remains a fallback for backwards compatibility only.
          { apiKey: geminiApiKey, keySource: "tenant" as const }
        : envGeminiKey
          ? { apiKey: envGeminiKey, keySource: "env" as const }
          : null;

  if (!selectedKey) {
    throw new Error("Gemini API key not configured");
  }
  const { apiKey, keySource } = selectedKey;
  console.log(
    `[Aletheia] Gemini key resolved: source=${keySource}, length=${apiKey.length}, prefix=${apiKey.slice(0, 8)}...`
  );

  const normalizedModel = (() => {
    const raw = (voiceModel || "").trim();
    if (!raw) return GEMINI_DEFAULT_MODEL;
    const candidate = raw.startsWith("models/") ? raw : `models/${raw}`;
    // Guard against stale/non-Gemini model values stored in rag_settings.
    if (!candidate.toLowerCase().includes("gemini")) {
      console.warn(
        `[Aletheia] Ignoring non-Gemini voice_model "${raw}", using ${GEMINI_DEFAULT_MODEL}`
      );
      return GEMINI_DEFAULT_MODEL;
    }
    return candidate;
  })();

  const resolvedVoice = (() => {
    const candidate = (voiceName || "").trim();
    if (!candidate) return GEMINI_DEFAULT_VOICE;
    if (GEMINI_VALID_VOICES.has(candidate)) return candidate;
    console.warn(
      `[Aletheia] Ignoring invalid voice_name "${candidate}" (not in ${[...GEMINI_VALID_VOICES].join(", ")}), using ${GEMINI_DEFAULT_VOICE}`
    );
    return GEMINI_DEFAULT_VOICE;
  })();

  return {
    apiKey,
    model: normalizedModel,
    voiceName: resolvedVoice,
    keySource,
  };
}

async function streamGeminiToSSE(
  res: Response,
  config: { apiKey: string; model: string; voiceName: string },
  prompt: string,
  systemInstruction = ALETHEIA_BRIEFING_PROMPT,
  abortSignal?: AbortSignal
): Promise<void> {
  const modelCandidates = [config.model, ...GEMINI_MODEL_FALLBACKS].filter(
    (model, idx, arr) => !!model && arr.indexOf(model) === idx
  );
  let lastError: Error | null = null;

  for (const model of modelCandidates) {
    try {
      await streamGeminiToSSEOnce(
        res,
        { ...config, model },
        prompt,
        systemInstruction,
        abortSignal
      );
      return;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = String(lastError.message || "");
      const isModelUnsupported =
        msg.includes("1008") &&
        (msg.includes("is not found") || msg.includes("not supported"));
      if (!isModelUnsupported || abortSignal?.aborted) {
        throw lastError;
      }
      console.warn(
        `[Aletheia] Gemini model ${model} unsupported, retrying fallback...`
      );
    }
  }

  throw lastError || new Error("No supported Gemini model available");
}

async function streamGeminiToSSEOnce(
  res: Response,
  config: { apiKey: string; model: string; voiceName: string },
  prompt: string,
  systemInstruction = ALETHEIA_BRIEFING_PROMPT,
  abortSignal?: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.apiKey}`;
    const socket = new WebSocket(geminiUrl);
    let settled = false;
    let setupSentPrompt = false;
    let turnCompleteTimer: NodeJS.Timeout | null = null;
    let metaSent = false;
    let lastAudioAtMs = 0;

    const safeResolve = () => {
      if (settled) return;
      settled = true;
      if (turnCompleteTimer) {
        clearTimeout(turnCompleteTimer);
        turnCompleteTimer = null;
      }
      try {
        socket.close(1000, "done");
      } catch {
        // ignore
      }
      resolve();
    };

    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (turnCompleteTimer) {
        clearTimeout(turnCompleteTimer);
        turnCompleteTimer = null;
      }
      try {
        socket.close(1011, "error");
      } catch {
        // ignore
      }
      reject(err);
    };

    const onAbort = () => {
      safeResolve();
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    socket.on("open", () => {
      const setupMsg = {
        setup: {
          model: config.model,
          generation_config: {
            response_modalities: ["AUDIO"],
            max_output_tokens: 4096,
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: config.voiceName,
                },
              },
            },
          },
          system_instruction: {
            parts: [{ text: systemInstruction }],
          },
        },
      };
      socket.send(JSON.stringify(setupMsg));
    });

    socket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.error) {
          safeReject(new Error(msg.error?.message || "Gemini stream error"));
          return;
        }

        if (msg.setupComplete && !setupSentPrompt) {
          setupSentPrompt = true;
          socket.send(
            JSON.stringify({
              client_content: {
                turns: [{ role: "user", parts: [{ text: prompt }] }],
                turn_complete: true,
              },
            })
          );
          return;
        }

        const parts =
          msg.serverContent?.modelTurn?.parts ||
          msg.server_content?.model_turn?.parts ||
          [];
        let sawAudioThisMessage = false;

        for (const part of parts) {
          const inlineData = part.inlineData || part.inline_data;
          if (!inlineData?.data) continue;
          const mimeType = inlineData.mimeType || inlineData.mime_type || "";
          if (mimeType.startsWith("audio/pcm")) {
            sawAudioThisMessage = true;
            lastAudioAtMs = Date.now();
            if (turnCompleteTimer) {
              clearTimeout(turnCompleteTimer);
              turnCompleteTimer = null;
            }
            if (!metaSent) {
              metaSent = true;
              await writeSSE(res, {
                type: "meta",
                mimeType,
                sampleRate: parseSampleRateFromMimeType(mimeType),
                voiceName: config.voiceName,
                model: config.model,
              });
            }
            await writeSSE(res, { type: "audio", data: inlineData.data });
          }
        }

        const turnComplete =
          msg.serverContent?.turnComplete || msg.server_content?.turn_complete;
        if (turnComplete) {
          // Give Gemini a larger grace window for trailing packets and
          // avoid closing if audio was just received.
          if (turnCompleteTimer) {
            clearTimeout(turnCompleteTimer);
          }
          turnCompleteTimer = setTimeout(() => {
            const msSinceAudio = Date.now() - lastAudioAtMs;
            if (sawAudioThisMessage || msSinceAudio < 900) {
              turnCompleteTimer = setTimeout(() => safeResolve(), 700);
              return;
            }
            safeResolve();
          }, 1200);
        }
      } catch (err: any) {
        safeReject(new Error(`Gemini parse error: ${err.message}`));
      }
    });

    socket.on("error", (err: any) => {
      safeReject(new Error(`Gemini socket error: ${err.message || "unknown"}`));
    });

    socket.on("close", (code, reason) => {
      if (!settled && code !== 1000) {
        safeReject(new Error(`Gemini socket closed ${code}: ${String(reason)}`));
      }
      abortSignal?.removeEventListener("abort", onAbort);
    });
  });
}

async function synthesizeGeminiSegmentToPCM(
  config: { apiKey: string; model: string; voiceName: string },
  prompt: string,
  systemInstruction: string,
  abortSignal?: AbortSignal
): Promise<{ pcm: Buffer; mimeType: string; sampleRate: number }> {
  const modelCandidates = [config.model, ...GEMINI_MODEL_FALLBACKS].filter(
    (model, idx, arr) => !!model && arr.indexOf(model) === idx
  );
  let lastError: Error | null = null;

  for (const model of modelCandidates) {
    try {
      const result = await synthesizeGeminiSegmentToPCMOnce(
        { ...config, model },
        prompt,
        systemInstruction,
        abortSignal
      );
      return { ...result, sampleRate: result.sampleRate || 24000 };
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = String(lastError.message || "");
      const isModelUnsupported =
        msg.includes("1008") &&
        (msg.includes("is not found") || msg.includes("not supported"));
      if (!isModelUnsupported || abortSignal?.aborted) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error("No supported Gemini model available");
}

async function synthesizeGeminiSegmentToPCMOnce(
  config: { apiKey: string; model: string; voiceName: string },
  prompt: string,
  systemInstruction: string,
  abortSignal?: AbortSignal
): Promise<{ pcm: Buffer; mimeType: string; sampleRate: number }> {
  return await new Promise((resolve, reject) => {
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.apiKey}`;
    const socket = new WebSocket(geminiUrl);
    let settled = false;
    let setupSentPrompt = false;
    let turnCompleteTimer: NodeJS.Timeout | null = null;
    let mimeType = "audio/pcm;rate=24000";
    const chunks: Buffer[] = [];

    const safeResolve = () => {
      if (settled) return;
      settled = true;
      if (turnCompleteTimer) {
        clearTimeout(turnCompleteTimer);
        turnCompleteTimer = null;
      }
      try {
        socket.close(1000, "done");
      } catch {
        // ignore
      }
      const pcm = Buffer.concat(chunks);
      resolve({
        pcm,
        mimeType,
        sampleRate: parseSampleRateFromMimeType(mimeType),
      });
    };

    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (turnCompleteTimer) {
        clearTimeout(turnCompleteTimer);
        turnCompleteTimer = null;
      }
      try {
        socket.close(1011, "error");
      } catch {
        // ignore
      }
      reject(err);
    };

    const onAbort = () => safeResolve();
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          setup: {
            model: config.model,
            generation_config: {
              response_modalities: ["AUDIO"],
              max_output_tokens: 4096,
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: config.voiceName,
                  },
                },
              },
            },
            system_instruction: { parts: [{ text: systemInstruction }] },
          },
        })
      );
    });

    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.error) {
          safeReject(new Error(msg.error?.message || "Gemini stream error"));
          return;
        }

        if (msg.setupComplete && !setupSentPrompt) {
          setupSentPrompt = true;
          socket.send(
            JSON.stringify({
              client_content: {
                turns: [{ role: "user", parts: [{ text: prompt }] }],
                turn_complete: true,
              },
            })
          );
          return;
        }

        const parts =
          msg.serverContent?.modelTurn?.parts ||
          msg.server_content?.model_turn?.parts ||
          [];

        for (const part of parts) {
          const inlineData = part.inlineData || part.inline_data;
          if (!inlineData?.data) continue;
          const mt = inlineData.mimeType || inlineData.mime_type || "";
          if (mt.startsWith("audio/pcm")) {
            mimeType = mt;
            chunks.push(Buffer.from(inlineData.data, "base64"));
          }
        }

        const turnComplete =
          msg.serverContent?.turnComplete || msg.server_content?.turn_complete;
        if (turnComplete) {
          if (turnCompleteTimer) clearTimeout(turnCompleteTimer);
          turnCompleteTimer = setTimeout(() => safeResolve(), 800);
        }
      } catch (err: any) {
        safeReject(new Error(`Gemini parse error: ${err.message}`));
      }
    });

    socket.on("error", (err: any) => {
      safeReject(new Error(`Gemini socket error: ${err.message || "unknown"}`));
    });

    socket.on("close", (code, reason) => {
      if (!settled && code !== 1000) {
        safeReject(new Error(`Gemini socket closed ${code}: ${String(reason)}`));
      }
      abortSignal?.removeEventListener("abort", onAbort);
    });
  });
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

function splitIntoSegments(text: string): string[] {
  // Split on sentence-ending punctuation. The regex handles:
  //   - Standard sentences ending with . ! ?
  //   - Sentences ending with quotes like ."  !'  ?"
  //   - Ellipses ...
  // Fallback: split on newlines or commas if no sentence boundaries found.
  let sentences: string[] =
    text.match(/[^.!?\n]+(?:[.!?]+["'\s]*|\.{3}["'\s]*)/g) || [];

  if (sentences.length <= 1) {
    sentences = text.split(/\n+/).filter((s) => s.trim().length > 0);
  }
  if (sentences.length <= 1) {
    sentences = text
      .split(/(?<=[,;])\s+/)
      .filter((s) => s.trim().length > 0);
  }
  if (sentences.length === 0) {
    sentences = [text];
  }

  const segments: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const combined = current + (current ? " " : "") + sentence;
    if (current.length > 0 && combined.length > 250) {
      segments.push(current.trim());
      current = sentence;
    } else {
      current = combined;
    }
  }
  if (current.trim()) {
    segments.push(current.trim());
  }

  const result = segments.length > 0 ? segments : [text];
  console.log(
    `[Podcast] Split ${text.length} chars into ${result.length} TTS segments: [${result.map((s) => s.length + " chars").join(", ")}]`
  );
  return result;
}

async function streamSingleTTSChunk(
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
      instructions: TTS_INSTRUCTIONS,
      response_format: "pcm",
    }),
  });

  if (!ttsResponse.ok || !ttsResponse.body) {
    const errBody = await ttsResponse.text().catch(() => "unknown");
    throw new Error(`OpenAI TTS error (${ttsResponse.status}): ${errBody}`);
  }

  const reader = (ttsResponse.body as any).getReader();
  const CHUNK_SIZE = 4800; // 2400 samples = 100ms at 24kHz 16-bit mono
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

  // Flush remaining bytes, aligned to 2-byte PCM16 boundary
  if (leftover.length > 1) {
    const aligned =
      leftover.length % 2 === 0
        ? leftover
        : leftover.slice(0, leftover.length - 1);
    if (aligned.length > 0) {
      const base64 = Buffer.from(aligned).toString("base64");
      res.write(
        `data: ${JSON.stringify({ type: "audio", data: base64 })}\n\n`
      );
    }
  }
}

async function streamTTSToSSE(
  res: Response,
  apiKey: string,
  text: string
): Promise<void> {
  const segments = splitIntoSegments(text);
  for (const segment of segments) {
    await streamSingleTTSChunk(res, apiKey, segment);
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
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
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
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
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
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
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

// ── Aletheia Insights Briefing (same TTS pipeline, different context) ──

function buildAletheiaBriefingPrompt(
  briefingContext: {
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: {
      conversionRates: any;
      falloutData: any;
      lostRevenue: any;
    };
    userName?: string;
    greeting?: string;
    timezone?: string;
  }
): string {
  const dialogues = briefingContext.dialogues || [];
  const totalInsights = dialogues.length;
  const maxInsightsInPrompt = 18;
  const promptInsights = dialogues.slice(0, maxInsightsInPrompt);
  const omittedFromPrompt = Math.max(0, totalInsights - promptInsights.length);
  const dialoguesText =
    promptInsights.map((d, idx) => `${idx + 1}. ${d.message}`).join("\n") ||
    "No specific insights available.";

  const funnelText = briefingContext.funnelStory
    ? `\nLoan Funnel Analysis:\n- Overall Conversion Rate: ${briefingContext.funnelStory.conversionRates?.overall || "N/A"}%\n- Pull-Through Rate: ${briefingContext.funnelStory.conversionRates?.pullThrough || "N/A"}%\n- Total Fallout: ${briefingContext.funnelStory.falloutData?.total || "N/A"}\n- Lost Revenue Opportunity: ${briefingContext.funnelStory.lostRevenue?.total || "N/A"}`
    : "";

  const greeting = briefingContext.greeting || "Good morning";
  const nameInstruction = briefingContext.userName
    ? `Address the executive as ${briefingContext.userName} at the beginning, right after the "${greeting}" greeting.`
    : `Start with "${greeting}" as your opening greeting.`;

  const userPrompt = `Provide an executive briefing based on the following data.

GREETING: Begin with "${greeting}". ${nameInstruction}

Insight coverage requirements:
- Total insights available right now: ${totalInsights}.
- Start by stating the total count you are covering in this briefing.
- If you cannot cover all insights within the two-to-three-minute limit, explicitly say how many were covered and how many were not covered.
- Avoid abrupt endings. If you are at length limit, end with a complete closing sentence.

Business insights (introduce as "here's the latest"):
${dialoguesText}
${omittedFromPrompt > 0 ? `\nNote: ${omittedFromPrompt} additional insights exist beyond the detailed list above. Mention this if needed for completeness.` : ""}

${funnelText ? `Loan Funnel data:\n${funnelText}` : ""}

Include a relevant current mortgage industry trend or headline if applicable (label it "Today's Industry Headlines"). Relate it factually to the business data above.

Deliver the spoken briefing now.`;

  return userPrompt;
}

async function generateAletheiaScriptText(
  openAIKey: string,
  briefingContext: {
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: {
      conversionRates: any;
      falloutData: any;
      lostRevenue: any;
    };
    userName?: string;
    greeting?: string;
    timezone?: string;
  }
): Promise<string> {
  const userPrompt = buildAletheiaBriefingPrompt(briefingContext);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAIKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: ALETHEIA_BRIEFING_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 2400,
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

async function generateAletheiaAnswerText(
  openAIKey: string,
  questionText: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAIKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: ALETHEIA_QUESTION_PROMPT },
        { role: "user", content: questionText },
      ],
      temperature: 0.5,
      max_tokens: 1200,
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
  return data.choices?.[0]?.message?.content || "I couldn't generate an answer.";
}

async function streamGeminiScriptInSegments(
  res: Response,
  geminiConfig: { apiKey: string; model: string; voiceName: string },
  scriptText: string,
  abortSignal?: AbortSignal
): Promise<void> {
  const segments = splitIntoSegments(scriptText);
  const segmentBuffers: Buffer[] = [];
  let mimeType = "audio/pcm;rate=24000";
  let sampleRate = 24000;

  for (const segment of segments) {
    if (abortSignal?.aborted) break;
    const clip = await synthesizeGeminiSegmentToPCM(
      geminiConfig,
      segment,
      ALETHEIA_GEMINI_TTS_PROMPT,
      abortSignal
    );
    mimeType = clip.mimeType || mimeType;
    sampleRate = clip.sampleRate || sampleRate;
    segmentBuffers.push(clip.pcm);
  }

  const combined = Buffer.concat(segmentBuffers);
  await streamPcmBufferToSSE(res, combined, {
    mimeType,
    sampleRate,
    voiceName: geminiConfig.voiceName,
    model: geminiConfig.model,
    segmentsCount: segments.length,
  });
}

export async function prefetchAletheiaBriefing(
  tenantId: string | undefined,
  briefingContext: unknown
): Promise<{
  script: string;
  combined: Buffer;
  sampleRate: number;
  mimeType: string;
  segmentsCount: number;
  model: string;
  voiceName: string;
  contextHash: string;
}> {
  const isInvalidGeminiKeyError = (error: unknown): boolean => {
    const msg = String((error as any)?.message || error || "").toLowerCase();
    return (
      msg.includes("api key not valid") ||
      (msg.includes("1007") && msg.includes("api key"))
    );
  };

  const synthesizeWithConfig = async (geminiConfig: {
    apiKey: string;
    model: string;
    voiceName: string;
    keySource: "tenant" | "platform" | "env";
  }) => {
    const segments = splitIntoSegments(script);
    const segmentBuffers: Buffer[] = [];
    let mimeType = "audio/pcm;rate=24000";
    let sampleRate = 24000;
    for (const segment of segments) {
      const clip = await synthesizeGeminiSegmentToPCM(
        geminiConfig,
        segment,
        ALETHEIA_GEMINI_TTS_PROMPT
      );
      mimeType = clip.mimeType || mimeType;
      sampleRate = clip.sampleRate || sampleRate;
      segmentBuffers.push(clip.pcm);
    }
    return {
      combined: Buffer.concat(segmentBuffers),
      mimeType,
      sampleRate,
      segmentsCount: segments.length,
      model: geminiConfig.model,
      voiceName: geminiConfig.voiceName,
    };
  };

  const safeTenantId = tenantId || "";
  const openAIKey = await getOpenAIKey(tenantId);
  let geminiConfig = await getGeminiVoiceConfig(tenantId);
  const script = await generateAletheiaScriptText(openAIKey, briefingContext as any);
  let synthesis = await synthesizeWithConfig(geminiConfig).catch(async (error) => {
    if (
      tenantId &&
      geminiConfig.keySource === "tenant" &&
      isInvalidGeminiKeyError(error)
    ) {
      const fallbackConfig = await getGeminiVoiceConfig(tenantId, true);
      if (fallbackConfig.apiKey !== geminiConfig.apiKey) {
        console.warn(
          `[Aletheia] Tenant Gemini key invalid for ${tenantId}; retrying with ${fallbackConfig.keySource} key`
        );
        geminiConfig = fallbackConfig;
        return synthesizeWithConfig(geminiConfig);
      }
    }
    throw error;
  });

  const combined = synthesis.combined;
  const contextHash = hashBriefingContext(briefingContext);
  const cacheKey = getAletheiaCacheKey(tenantId);

  aletheiaPrefetchCache.set(cacheKey, {
    script,
    createdAt: Date.now(),
    contextHash,
    audioBase64: combined.toString("base64"),
    sampleRate: synthesis.sampleRate,
    mimeType: synthesis.mimeType,
    segmentsCount: synthesis.segmentsCount,
    model: synthesis.model,
    voiceName: synthesis.voiceName,
  });

  if (safeTenantId) {
    await persistAletheiaAsset({
      tenantId: safeTenantId,
      contextHash,
      script,
      pcm: combined,
      sampleRate: synthesis.sampleRate,
      mimeType: synthesis.mimeType,
      segmentsCount: synthesis.segmentsCount,
      model: synthesis.model,
      voiceName: synthesis.voiceName,
      ttlMs: ALETHEIA_PREFETCH_TTL_MS,
    });
  }

  return {
    script,
    combined,
    sampleRate: synthesis.sampleRate,
    mimeType: synthesis.mimeType,
    segmentsCount: synthesis.segmentsCount,
    model: synthesis.model,
    voiceName: synthesis.voiceName,
    contextHash,
  };
}

// GET /api/podcast/cohi/aletheia/status — check if a pre-generated podcast exists
router.get(
  "/aletheia/status",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const tenantId =
        (req.query.tenantId as string) ||
        (req as any).tenantContext?.tenantId ||
        req.headers["x-tenant-id"] as string ||
        "";

      if (!tenantId) {
        return res.json({ available: false });
      }

      const cacheKey = getAletheiaCacheKey(tenantId);
      const cached = aletheiaPrefetchCache.get(cacheKey);
      if (cached) {
        return res.json({
          available: true,
          createdAt: new Date(cached.createdAt).toISOString(),
          source: "cache",
        });
      }

      const result = await hasPersistedAletheiaAsset(tenantId);
      return res.json(result);
    } catch (error: any) {
      console.error("[Aletheia] Status check failed:", error.message);
      return res.json({ available: false });
    }
  }
);

// POST /api/podcast/cohi/aletheia/stream — Aletheia Insights via Gemini audio over SSE
router.post(
  "/aletheia/stream",
  apiLimiter,
  authenticateToken,
  async (req: AuthRequest, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const stopHeartbeat = startSSEHeartbeat(res);
    const abortController = new AbortController();
    const abortStream = () => {
      abortController.abort();
      stopHeartbeat();
    };
    req.on("aborted", abortStream);
    req.on("close", abortStream);
    res.on("close", abortStream);

    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const geminiConfig = await getGeminiVoiceConfig(tenantId);

      const briefingContext = req.body?.briefingContext || {};
      const contextHash = hashBriefingContext(briefingContext);
      const cacheKey = getAletheiaCacheKey(tenantId);
      let cached = aletheiaPrefetchCache.get(cacheKey);

      console.log(
        `[Aletheia] Starting Gemini SSE briefing for tenant ${tenantId || "env"} (model: ${geminiConfig.model}, voice: ${geminiConfig.voiceName})`
      );
      let script = "";
      let prefetchedAudio: Buffer | null = null;
      let prefetchedMime = "audio/pcm;rate=24000";
      let prefetchedRate = 24000;
      let prefetchedSegments = 0;
      if (
        cached &&
        cached.contextHash === contextHash &&
        Date.now() - cached.createdAt < ALETHEIA_PREFETCH_TTL_MS
      ) {
        script = cached.script;
        console.log(`[Aletheia] Using prefetched script for ${cacheKey}`);
        if (cached.audioBase64) {
          prefetchedAudio = Buffer.from(cached.audioBase64, "base64");
          prefetchedMime = cached.mimeType || prefetchedMime;
          prefetchedRate = cached.sampleRate || prefetchedRate;
          prefetchedSegments = cached.segmentsCount || 0;
        }
      } else {
        cached = undefined;
        if (tenantId) {
          const persisted = await loadPersistedAletheiaAsset(tenantId, contextHash);
          if (persisted) {
            script = persisted.script;
            prefetchedAudio = persisted.pcm;
            prefetchedMime = persisted.mimeType || prefetchedMime;
            prefetchedRate = persisted.sampleRate || prefetchedRate;
            prefetchedSegments = persisted.segmentsCount || 1;
            aletheiaPrefetchCache.set(cacheKey, {
              script: persisted.script,
              createdAt: persisted.createdAt,
              contextHash,
              audioBase64: persisted.pcm.toString("base64"),
              sampleRate: persisted.sampleRate,
              mimeType: persisted.mimeType,
              segmentsCount: persisted.segmentsCount,
              model: persisted.model,
              voiceName: persisted.voiceName,
            });
            cached = aletheiaPrefetchCache.get(cacheKey);
          }
        }

        if (!script) {
          const generated = await prefetchAletheiaBriefing(tenantId, briefingContext);
          script = generated.script;
          prefetchedAudio = generated.combined;
          prefetchedMime = generated.mimeType;
          prefetchedRate = generated.sampleRate;
          prefetchedSegments = generated.segmentsCount;
          cached = aletheiaPrefetchCache.get(cacheKey);
        }
      }

      await writeSSE(res, { type: "script", data: script });

      if (prefetchedAudio && prefetchedAudio.length > 0) {
        await streamPcmBufferToSSE(res, prefetchedAudio, {
          mimeType: prefetchedMime,
          sampleRate: prefetchedRate,
          voiceName: cached?.voiceName || geminiConfig.voiceName,
          model: cached?.model || geminiConfig.model,
          segmentsCount: prefetchedSegments || 1,
        });
      } else if (!abortController.signal.aborted) {
        const generated = await prefetchAletheiaBriefing(tenantId, briefingContext);
        await streamPcmBufferToSSE(res, generated.combined, {
          mimeType: generated.mimeType,
          sampleRate: generated.sampleRate,
          voiceName: generated.voiceName,
          model: generated.model,
          segmentsCount: generated.segmentsCount,
        });
      }

      await writeSSE(res, { type: "done" });
      res.end();
    } catch (error: any) {
      console.error("[Aletheia] Stream error:", error.message);
      if (!abortController.signal.aborted) {
        await writeSSE(res, { type: "error", error: error.message });
      }
      res.end();
    } finally {
      stopHeartbeat();
      req.off("aborted", abortStream);
      req.off("close", abortStream);
      res.off("close", abortStream);
    }
  }
);

// POST /api/podcast/cohi/aletheia/ask — follow-up question via Gemini audio over SSE
router.post(
  "/aletheia/prefetch",
  apiLimiter,
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const briefingContext = req.body?.briefingContext || {};
      const contextHash = hashBriefingContext(briefingContext);

      if (isAletheiaAsyncPrefetchEnabled()) {
        if (!tenantId) {
          return res.status(400).json({
            error:
              "A tenant must be selected before enqueuing async podcast prefetch.",
          });
        }
        const requestedBy = req.userEmail || req.userId || null;
        const jobId = await enqueueAletheiaPrefetchJob({
          tenantId,
          contextHash,
          briefingContext,
          requestedBy: requestedBy || undefined,
        });
        return res.status(202).json({
          success: true,
          enqueued: true,
          jobId,
          contextHash,
          queuedAt: new Date().toISOString(),
        });
      }

      const generated = await prefetchAletheiaBriefing(tenantId, briefingContext);

      res.json({
        success: true,
        prefetchedAt: new Date().toISOString(),
        scriptLength: generated.script.length,
        audioBytes: generated.combined.length,
        segmentsCount: generated.segmentsCount,
        sampleRate: generated.sampleRate,
        model: generated.model,
        voiceName: generated.voiceName,
      });
    } catch (error: any) {
      console.error("[Aletheia] Prefetch error:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  "/aletheia/ask",
  apiLimiter,
  authenticateToken,
  async (req: AuthRequest, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const stopHeartbeat = startSSEHeartbeat(res);
    const abortController = new AbortController();
    const abortStream = () => {
      abortController.abort();
      stopHeartbeat();
    };
    req.on("aborted", abortStream);
    req.on("close", abortStream);
    res.on("close", abortStream);

    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const geminiConfig = await getGeminiVoiceConfig(tenantId);
      const openAIKey = await getOpenAIKey(tenantId);

      let questionText = req.body?.question || "";

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
            headers: { Authorization: `Bearer ${openAIKey}` },
            body: formData,
          }
        );

        if (!whisperRes.ok) {
          throw new Error("Failed to transcribe audio");
        }

        const whisperData = (await whisperRes.json()) as { text?: string };
        questionText = whisperData.text || "";

        await writeSSE(res, { type: "user_question", data: questionText });
      }

      if (!questionText.trim()) {
        await writeSSE(res, { type: "error", error: "No question provided" });
        res.end();
        return;
      }

      const answerText = await generateAletheiaAnswerText(openAIKey, questionText);

      await writeSSE(res, { type: "transcript", data: answerText });

      await streamGeminiScriptInSegments(
        res,
        geminiConfig,
        answerText,
        abortController.signal
      );

      await writeSSE(res, { type: "done" });
      res.end();
    } catch (error: any) {
      console.error("[Aletheia] Ask error:", error.message);
      if (!abortController.signal.aborted) {
        await writeSSE(res, { type: "error", error: error.message });
      }
      res.end();
    } finally {
      stopHeartbeat();
      req.off("aborted", abortStream);
      req.off("close", abortStream);
      res.off("close", abortStream);
    }
  }
);

export default router;

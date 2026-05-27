/**
 * Presentation export intent — prefilter + LLM classifier (unified chat NL PPT).
 */

import { getOpenAIKey } from "../research/tools.js";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";

const CLASSIFIER_MODEL =
  process.env.COHI_PRESENTATION_INTENT_MODEL ||
  process.env.COHI_CHAT_MODEL ||
  "gpt-4.1-mini";

const CONFIDENCE_THRESHOLD = 0.7;

const PHRASES = ["slide show", "slide deck", "power point"] as const;

const SINGLE_TOKENS = [
  "slideshow",
  "slides",
  "slide",
  "deck",
  "keynote",
  "ppt",
  "pptx",
  "powerpoint",
  "presentation",
  "report",
] as const;

export function normalizePresentationExportText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function presentationExportPrefilter(message: string): boolean {
  const normalized = normalizePresentationExportText(message);
  if (!normalized) return false;

  for (const phrase of PHRASES) {
    if (normalized.includes(phrase)) return true;
  }

  for (const token of SINGLE_TOKENS) {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(normalized)) return true;
  }

  if (/\bpower\s*point\b/.test(normalized)) return true;

  return false;
}

export type PresentationExportMode = "create" | "convert";

export type PresentationExportAction =
  | "export_viz"
  | "export_research_report"
  | "open_workbench_editor"
  | "none";

export type PresentationExportClassification = {
  wantsPresentationExport: boolean;
  mode: PresentationExportMode;
  confidence: number;
  rationale?: string;
  /** Substantive research subject when the user combines analysis + slides in one message. */
  researchTopic?: string;
};

export type PresentationExportMetadata = {
  prefilterHit: boolean;
  wantsPresentationExport: boolean;
  mode: PresentationExportMode;
  action: PresentationExportAction;
  confidence: number;
  /** Research not complete yet — run pipeline first, then offer PPT in chat. */
  deferred?: boolean;
  researchTopic?: string;
};

function actionForChatType(
  chatType: UnifiedConversationChatType,
  wants: boolean,
): PresentationExportAction {
  if (!wants) return "none";
  if (chatType === "research") return "export_research_report";
  if (chatType === "workbench") return "open_workbench_editor";
  return "export_viz";
}

export function resolvePresentationExportAction(
  chatType: UnifiedConversationChatType,
  classification: PresentationExportClassification,
): PresentationExportMetadata {
  const wants =
    classification.wantsPresentationExport &&
    classification.confidence >= CONFIDENCE_THRESHOLD;

  return {
    prefilterHit: true,
    wantsPresentationExport: wants,
    mode: classification.mode,
    action: actionForChatType(chatType, wants),
    confidence: classification.confidence,
  };
}

export async function classifyPresentationExportIntent(args: {
  message: string;
  history?: { role: string; content: string }[];
  tenantId?: string;
}): Promise<PresentationExportClassification> {
  const historySnippet = (args.history ?? [])
    .slice(-4)
    .map((h) => `${h.role}: ${h.content.slice(0, 300)}`)
    .join("\n");

  const system = `You classify whether the user wants to export or create a **slide deck / presentation file** (PowerPoint-style: .pptx, slides, deck for a meeting).

Return JSON only:
{
  "wantsPresentationExport": boolean,
  "mode": "create" | "convert",
  "confidence": number,
  "rationale": string,
  "researchTopic": string | null
}

Rules:
- wantsPresentationExport=true for: powerpoint, ppt, slides, slideshow, slide deck, deck, keynote, presentation export, "board pack", "something to present", "put that into slides", etc.
- mode=convert when they refer to prior answer ("that", "this result", "above", "put it in slides") without asking a new data question.
- mode=create when they ask for new deck content or combine request with new analysis.
- wantsPresentationExport=false for: site navigation ("go to reports page"), written PDF/report only (not slides), general data questions with no export intent, defining words.
- "report" alone is ambiguous: true only if context clearly means presentation/slide deck, not navigation to Reports.
- researchTopic: when the user asks for BOTH new research/analysis AND a presentation in the same message (mode=create), set this to the core business question/topic WITHOUT export/slide wording (e.g. "overall pipeline health and conversion performance"). Otherwise null.`;

  const user = historySnippet
    ? `Recent conversation:\n${historySnippet}\n\nLatest user message:\n${args.message}`
    : args.message;

  const tenantId = args.tenantId ?? "";
  let apiKey: string;
  try {
    apiKey = await getOpenAIKey(tenantId);
  } catch {
    return {
      wantsPresentationExport: false,
      mode: "create",
      confidence: 0,
      rationale: "no_api_key",
    };
  }

  const prefersCompletionTokens = /^(gpt-5|o3|o4)/i.test(CLASSIFIER_MODEL);
  const body: Record<string, unknown> = {
    model: CLASSIFIER_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    ...(prefersCompletionTokens
      ? { max_completion_tokens: 400 }
      : { max_tokens: 400 }),
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn("[presentationExportIntent] OpenAI error:", await res.text());
      return {
        wantsPresentationExport: false,
        mode: "create",
        confidence: 0,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return {
        wantsPresentationExport: false,
        mode: "create",
        confidence: 0,
      };
    }

    const parsed = JSON.parse(text) as Partial<PresentationExportClassification>;
    const researchTopic =
      typeof parsed.researchTopic === "string"
        ? parsed.researchTopic.trim()
        : "";
    return {
      wantsPresentationExport: !!parsed.wantsPresentationExport,
      mode: parsed.mode === "convert" ? "convert" : "create",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
      rationale:
        typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      researchTopic: researchTopic || undefined,
    };
  } catch (err) {
    console.warn("[presentationExportIntent] classify failed:", err);
    return {
      wantsPresentationExport: false,
      mode: "create",
      confidence: 0,
    };
  }
}

export async function detectPresentationExportIntent(args: {
  message: string;
  chatType: UnifiedConversationChatType;
  history?: { role: string; content: string }[];
  tenantId?: string;
}): Promise<PresentationExportMetadata | null> {
  if (!presentationExportPrefilter(args.message)) {
    return null;
  }

  const classification = await classifyPresentationExportIntent({
    message: args.message,
    history: args.history,
    tenantId: args.tenantId,
  });

  const meta = resolvePresentationExportAction(args.chatType, classification);
  if (
    classification.researchTopic &&
    args.chatType === "research" &&
    meta.wantsPresentationExport
  ) {
    meta.researchTopic = classification.researchTopic;
  }
  return meta;
}

/** Fallback when classifier omits researchTopic on a combined research+PPT ask. */
export function fallbackResearchTopicFromMessage(message: string): string {
  let t = message.trim();
  t = t.replace(/^(can you|could you|please|i need|i want|would you)\s+/i, "");
  t = t.replace(
    /\b(make|create|build|generate|export|turn|put)\b[^.?]*\b(powerpoint|power point|pptx?|presentation|slideshow|slide deck|deck|slides?|keynote)\b[^.?]*\b(on|about|for|regarding|covering)\b/gi,
    "",
  );
  t = t.replace(
    /\b(powerpoint|power point|pptx?|presentation|slideshow|slide deck|deck|slides?|keynote)\b[^.?]*/gi,
    "",
  );
  t = t.replace(/\s+/g, " ").trim();
  return t.length >= 12 ? t : message.trim();
}

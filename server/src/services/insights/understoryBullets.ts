import { callLLM, getOpenAIKey, type LLMMessage } from "../research/tools.js";

export interface UnderstoryBulletsOptions {
  tenantId?: string;
  headline?: string;
  minBullets?: number;
  sourceLabel?: "understory" | "summary";
}

interface FallbackValidation {
  numeric_parity_ok?: boolean;
  source_alignment_ok?: boolean;
}

interface FallbackResponse {
  bullets?: unknown;
  validation?: FallbackValidation;
}

const AGENT_FALLBACK_ENABLED =
  String(process.env.INSIGHTS_UNDERSTORY_AGENT_FALLBACK_ENABLED || "").toLowerCase() === "true";

const UNDERSTORY_CACHE = new Map<string, string[]>();

function cacheKey(headline: string, understory: string): string {
  return `${headline}||${understory}`.toLowerCase();
}

function tokenizeNumeric(text: string): string[] {
  return (text.match(/\$?\d[\d,.]*(?:\.\d+)?%?/g) || []).map((x) => x.trim());
}

function normalizeFactText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.]+$/, "").toLowerCase();
}

export function understoryToBullets(
  understory: string,
  opts?: { minBullets?: number }
): string[] {
  const minBullets = opts?.minBullets ?? 1;
  if (!understory || !understory.trim()) return [];

  let text = understory.replace(/\s+/g, " ").trim();
  const protectedTokens: Array<{ token: string; value: string }> = [];
  let idx = 0;

  const protect = (value: string) => {
    const token = `__P${idx++}__`;
    protectedTokens.push({ token, value });
    return token;
  };

  text = text.replace(/\b\d+\.\d+\b/g, (m) => protect(m));
  const abbreviations = [
    "e.g.", "i.e.", "vs.", "U.S.", "Mr.", "Mrs.", "Ms.", "Dr.",
    "Sr.", "Jr.", "Inc.", "Ltd.", "Co.", "No.", "St.", "Mt.",
  ];
  for (const abbr of abbreviations) {
    const re = new RegExp(abbr.replace(".", "\\."), "g");
    text = text.replace(re, (m) => protect(m));
  }

  let sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$_])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const unprotect = (s: string) => {
    let out = s;
    for (const p of protectedTokens) out = out.replaceAll(p.token, p.value);
    return out;
  };
  sentences = sentences.map(unprotect);

  if (sentences.length <= 1) {
    sentences = understory
      .split(/\s*;\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const seen = new Set<string>();
  let bullets = sentences
    .map((s) => s.replace(/\s+/g, " ").trim())
    .map((s) => s.replace(/[.]+$/, ""))
    .filter((s) => s.length > 0)
    .filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (bullets.length < minBullets) {
    bullets = [understory.replace(/\s+/g, " ").trim()];
  }
  return bullets;
}

function assessBulletQuality(understory: string, bullets: string[]): string | null {
  if (!understory.trim()) return "empty_understory";
  if (bullets.length === 0) return "empty_bullets";

  const normalized = bullets.map(normalizeFactText).filter(Boolean);
  if (normalized.length === 0) return "blank_bullets";
  if (new Set(normalized).size <= 1 && normalized.length > 1) return "near_identical";

  const punctCount = (understory.match(/[.!?]/g) || []).length;
  if (punctCount >= 2 && bullets.length === 1) return "split_failed";

  if (bullets.some((b) => b.length > 280)) return "long_bullet";
  return null;
}

const FALLBACK_SYSTEM_PROMPT = `You are an executive writing formatter for mortgage analytics insights.
Return ONLY JSON.

You are given:
1) source_text: source-of-truth paragraph.
2) formatter_bullets: deterministic baseline bullets.
3) quality_issue: optional deterministic issue label (may be null).

Task:
- ALWAYS review bullets for fidelity against source_text.
- Fix obvious formatting issues when present.
- Paraphrase only when necessary.

"Necessary" means:
- bullets are blank/degenerate/duplicates,
- sentence split failed (merged points that should be separate),
- bullets are too long to scan,
- wording is materially unclear OR drifts from source_text facts.
- If none apply, keep baseline bullets unchanged.

Hard constraints:
- Do NOT add, remove, or alter any facts.
- Preserve all numeric values exactly (counts, currency, percentages, date/range tokens, basis points).
- Preserve all names/entities exactly.
- No speculation, no recommendations, no new conclusions.
- Use formatter_bullets as a preservation scaffold.
- Any paraphrase must remain semantically equivalent to source_text.

Output schema:
{
  "bullets": ["..."],
  "validation": {
    "numeric_parity_ok": true,
    "source_alignment_ok": true
  }
}`;

async function formatUnderstoryWithAgent(args: {
  headline: string;
  sourceText: string;
  formatterBullets: string[];
  qualityIssue: string | null;
  sourceLabel?: "understory" | "summary";
  tenantId?: string;
}): Promise<string[] | null> {
  try {
    const apiKey = await getOpenAIKey(args.tenantId);
    const messages: LLMMessage[] = [
      { role: "system", content: FALLBACK_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify(
          {
            headline: args.headline,
            source_text: args.sourceText,
            source_label: args.sourceLabel || "understory",
            formatter_bullets: args.formatterBullets,
            quality_issue: args.qualityIssue,
          },
          null,
          2
        ),
      },
    ];
    const raw = await callLLM(messages, apiKey, {
      model: process.env.INSIGHTS_UNDERSTORY_MODEL || "gpt-5.4",
      temperature: 0,
      maxTokens: 1200,
      jsonMode: true,
      tag: "insights.understory_bullets_fallback",
    });
    const parsed = JSON.parse(raw) as FallbackResponse;
    const candidate = Array.isArray(parsed?.bullets)
      ? parsed.bullets.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    if (candidate.length === 0) return null;

    const validation = parsed.validation || {};
    if (!validation.numeric_parity_ok || !validation.source_alignment_ok) return null;

    const sourceNums = tokenizeNumeric(args.sourceText);
    const outputNums = tokenizeNumeric(candidate.join(" "));
    const numericParity = sourceNums.every((n) => outputNums.includes(n));
    if (!numericParity) return null;

    return candidate.map((x) => x.replace(/\s+/g, " ").trim());
  } catch {
    return null;
  }
}

export async function buildUnderstoryBullets(
  sourceText: string,
  options: UnderstoryBulletsOptions = {}
): Promise<string[]> {
  const normalized = String(sourceText || "").trim();
  if (!normalized) return [];
  const headline = String(options.headline || "");
  const sourceLabel = options.sourceLabel || "understory";
  const key = cacheKey(`${sourceLabel}:${headline}`, normalized);
  const cached = UNDERSTORY_CACHE.get(key);
  if (cached) return cached;

  const formatterBullets = understoryToBullets(normalized, { minBullets: options.minBullets ?? 1 });
  const qualityFailure = assessBulletQuality(normalized, formatterBullets);

  if (!AGENT_FALLBACK_ENABLED) {
    UNDERSTORY_CACHE.set(key, formatterBullets);
    return formatterBullets;
  }

  const agentBullets = await formatUnderstoryWithAgent({
    headline,
    sourceText: normalized,
    formatterBullets,
    qualityIssue: qualityFailure,
    sourceLabel,
    tenantId: options.tenantId,
  });
  const finalBullets = agentBullets && agentBullets.length > 0 ? agentBullets : formatterBullets;
  UNDERSTORY_CACHE.set(key, finalBullets);
  return finalBullets;
}


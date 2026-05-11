/**
 * One batched LLM pass: connect each behavior insight to the user's interest profile text.
 */

import { callLLM, type LLMMessage } from "../../research/tools.js";
import { logWarn } from "../../logger.js";

const MAX_PROFILE_CHARS = 6000;

const SYSTEM = `You personalize mortgage analytics for executives.
You receive the user's "interest profile" (how they use the product: pages, research, workbench, chat themes, feedback, etc.) and a numbered list of insight headlines already chosen for them.

For EACH insight, write ONE short sentence explaining why that insight matters to THIS user. Ground it in concrete themes from the profile when possible (e.g. a research topic, a page they use, their role). Do not restate the headline verbatim. If the profile is thin, say briefly why an operations leader would still care.

Return JSON only, shape: { "rationales": ["...", "..."] }
Rules:
- rationales.length MUST equal the number of insights (same order as given).
- Each string: max 240 characters, plain English, no markdown.`;

export async function buildProfileRelevanceRationales(
  apiKey: string,
  profileText: string,
  items: { headline: string; source?: string; bucket?: string }[]
): Promise<string[]> {
  if (items.length === 0) return [];

  const trimmed =
    profileText.length > MAX_PROFILE_CHARS
      ? `${profileText.slice(0, MAX_PROFILE_CHARS)}\n… (truncated)`
      : profileText;

  const lines = items.map(
    (it, i) =>
      `${i + 1}. [${it.bucket || "—"}] ${it.headline}${it.source ? ` — ${it.source}` : ""}`
  );

  const userContent = `USER INTEREST PROFILE:\n${trimmed || "(empty — use generic executive relevance)"}\n\nINSIGHTS (same order as output):\n${lines.join("\n")}`;

  try {
    const messages: LLMMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ];
    const raw = await callLLM(messages, apiKey, {
      temperature: 0.25,
      maxTokens: 2500,
      jsonMode: true,
      tag: "my_insights_profile_relevance",
    });
    const p = JSON.parse(raw) as { rationales?: unknown };
    const arr = Array.isArray(p.rationales) ? p.rationales : [];
    const out: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const s = typeof arr[i] === "string" ? arr[i].trim() : "";
      out.push(s);
    }
    return out;
  } catch (e: any) {
    logWarn(`[ProfileRelevance] LLM failed: ${e?.message}`);
    return items.map(() => "");
  }
}

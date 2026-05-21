/**
 * Parse workbench LLM JSON responses (jsonMode, fences, duplicated objects).
 */

export type WorkbenchLlmPayload = {
  message?: string;
  actions?: unknown[];
  teachingNotes?: string;
  suggestedQuestions?: string[];
};

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Extract the first balanced `{...}` object from a string. */
export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function parseWorkbenchLlmJson(raw: string): WorkbenchLlmPayload | null {
  const candidates: string[] = [];
  const stripped = stripCodeFences(raw);
  candidates.push(stripped);
  const first = extractFirstJsonObject(stripped);
  if (first && first !== stripped) candidates.push(first);
  const fromRaw = extractFirstJsonObject(raw);
  if (fromRaw && !candidates.includes(fromRaw)) candidates.push(fromRaw);

  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text) as WorkbenchLlmPayload;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

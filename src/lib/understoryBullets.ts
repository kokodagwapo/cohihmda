export interface SummaryBulletPresentation {
  bullets: string[];
  renderMode: "paragraph" | "list";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseExplicitBullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  let normalized = normalizeWhitespace(text);
  const protectedTokens: Array<{ token: string; value: string }> = [];
  let idx = 0;
  const protect = (value: string) => {
    const token = `__P${idx++}__`;
    protectedTokens.push({ token, value });
    return token;
  };

  normalized = normalized.replace(/\b\d+\.\d+\b/g, (m) => protect(m));
  const abbreviations = [
    "e.g.", "i.e.", "vs.", "U.S.", "Mr.", "Mrs.", "Ms.", "Dr.",
    "Sr.", "Jr.", "Inc.", "Ltd.", "Co.", "No.", "St.", "Mt.",
  ];
  for (const abbr of abbreviations) {
    const re = new RegExp(abbr.replace(".", "\\."), "g");
    normalized = normalized.replace(re, (m) => protect(m));
  }

  const unprotect = (value: string) => {
    let out = value;
    for (const token of protectedTokens) out = out.replaceAll(token.token, token.value);
    return out;
  };

  let chunks = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$_])/)
    .map((s) => normalizeWhitespace(unprotect(s)))
    .filter(Boolean);

  if (chunks.length <= 1) {
    chunks = normalized
      .split(/\s*;\s*/)
      .map((s) => normalizeWhitespace(unprotect(s)))
      .filter(Boolean);
  }

  return chunks.map((s) => s.replace(/[.]+$/, "")).filter(Boolean);
}

function dedupeStable(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildSummaryBulletPresentation(
  text: string,
  opts?: { preferredBullets?: string[] }
): SummaryBulletPresentation {
  const raw = String(text || "");
  const normalized = normalizeWhitespace(raw);
  if (!normalized) return { bullets: [], renderMode: "paragraph" };

  const preferred = Array.isArray(opts?.preferredBullets)
    ? opts!.preferredBullets.map((b) => normalizeWhitespace(String(b || ""))).filter(Boolean)
    : [];
  if (preferred.length > 1) {
    return { bullets: dedupeStable(preferred), renderMode: "list" };
  }

  const hasExplicitBullets = /(^|\n)\s*(?:[-*•]|\d+[.)])\s+/.test(raw);
  if (hasExplicitBullets) {
    const parsed = dedupeStable(parseExplicitBullets(raw));
    if (parsed.length > 1) return { bullets: parsed, renderMode: "list" };
  }

  const sentenceBullets = dedupeStable(splitSentences(normalized));
  const isSingleShortSentence = sentenceBullets.length <= 1 && normalized.length <= 140;
  if (isSingleShortSentence) {
    return { bullets: [normalized], renderMode: "paragraph" };
  }

  if (sentenceBullets.length > 1) {
    return { bullets: sentenceBullets, renderMode: "list" };
  }

  return { bullets: [normalized], renderMode: "paragraph" };
}

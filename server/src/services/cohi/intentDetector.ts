/**
 * COHI Intent Detector – classifies user question and extracts params.
 */

import type { IntentResult, IntentType } from "./types.js";

const LOWER = (s: string) => s.toLowerCase();

export function intentDetector(question: string): IntentResult {
  const q = question.trim();
  const lower = LOWER(q);

  // Top performers
  if (
    /\b(top|best|leading)\s*(performers?|los?|branches?|officers?|teams?)\b/i.test(lower) ||
    /\bwho\s+are\s+the\s+top\b/i.test(lower) ||
    /\btop\s+10\b/i.test(lower)
  ) {
    const actor = /\b(loan\s*officer|lo)s?\b/i.test(lower) ? "loan_officer" : "branch";
    return { intent: "toptiering_top", params: { actor, ...parseDateRange(lower) } };
  }

  // Bottom performers
  if (
    /\b(bottom|worst|lowest|develop)\s*(performers?|los?|branches?|officers?)\b/i.test(lower) ||
    /\bbottom\s+10\b/i.test(lower) ||
    /\bpull[- ]?through\b.*\b(bottom|worst)\b/i.test(lower)
  ) {
    const actor = /\b(loan\s*officer|lo)s?\b/i.test(lower) ? "loan_officer" : "branch";
    return { intent: "toptiering_bottom", params: { actor, ...parseDateRange(lower) } };
  }

  // Mid-tier trend
  if (
    /\bmid(dle)?[- ]?tier\b/i.test(lower) ||
    /\bsecond\s*tier\b/i.test(lower)
  ) {
    const actor = /\b(loan\s*officer|lo)s?\b/i.test(lower) ? "loan_officer" : "branch";
    return { intent: "toptiering_mid_trend", params: { actor, tier: "mid", ...parseDateRange(lower) } };
  }

  // Compare tiers
  if (
    /\bcompare\b.*\b(mid|top|bottom)\b.*\b(mid|top|bottom)\b/i.test(lower) ||
    /\b(mid|top|bottom)\s*tier\s*vs\s*(mid|top|bottom)/i.test(lower)
  ) {
    return { intent: "toptiering_compare", params: parseDateRange(lower) };
  }

  // Executive summary / what do I need to know
  if (
    /\bwhat\s+do\s+I\s+need\s+to\s+know\b/i.test(lower) ||
    /\bexec(utive)?\s*summary\b/i.test(lower) ||
    /\bbrief(ing)?\s*(today|this\s*week)?\b/i.test(lower) ||
    /\bneed\s+to\s+know\s+today\b/i.test(lower)
  ) {
    return { intent: "exec_summary", params: parseDateRange(lower) };
  }

  // Upload / CSV ranking
  if (
    /\bupload(ed)?\s*(csv|file|excel)\b/i.test(lower) ||
    /\bthis\s*(csv|file|upload)\b/i.test(lower) ||
    /\btop\s*10\s*(branches?|from)\s*(this\s*)?(csv|file|upload)/i.test(lower)
  ) {
    return { intent: "upload_ranking", params: {} };
  }

  return { intent: "generic_data", params: parseDateRange(lower) };
}

function parseDateRange(lower: string): { startDate?: string; endDate?: string } {
  const now = new Date();
  let startDate: string | undefined;
  let endDate: string | undefined;

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  if (/\blast\s*90\s*days?\b|\b90\s*days?\b/i.test(lower)) {
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    startDate = fmt(start);
    endDate = fmt(now);
  } else if (/\bthis\s*month\b|\blast\s*month\b/i.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate = fmt(start);
    endDate = fmt(now);
  } else if (/\bthis\s*quarter\b|\blast\s*quarter\b/i.test(lower)) {
    const q = Math.floor(now.getMonth() / 3) + 1;
    const start = new Date(now.getFullYear(), (q - 1) * 3, 1);
    startDate = fmt(start);
    endDate = fmt(now);
  } else if (/\bthis\s*year\b|\bytd\b/i.test(lower)) {
    startDate = `${now.getFullYear()}-01-01`;
    endDate = fmt(now);
  }

  return startDate && endDate ? { startDate, endDate } : {};
}

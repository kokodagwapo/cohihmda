/**
 * Deterministic ranking intent detection and SQL guardrails for regular chat.
 */

export interface RankingIntent {
  kind: "top" | "bottom";
  limit: number;
  isRanking: boolean;
}

export const RANKING_CHART_MAX = 25;
export const RANKING_DEFAULT_LIMIT = 10;

const TOP_PATTERN = /\b(?:top|best|highest|leading)\s+(\d{1,2})\b/i;
const BOTTOM_PATTERN = /\b(?:bottom|worst|lowest)\s+(\d{1,2})\b/i;

export function detectRankingIntent(question: string): RankingIntent | null {
  const q = question.toLowerCase();
  const topMatch = q.match(TOP_PATTERN);
  if (topMatch) {
    const n = parseInt(topMatch[1], 10);
    return {
      kind: "top",
      limit: clampLimit(n),
      isRanking: true,
    };
  }
  const bottomMatch = q.match(BOTTOM_PATTERN);
  if (bottomMatch) {
    const n = parseInt(bottomMatch[1], 10);
    return {
      kind: "bottom",
      limit: clampLimit(n),
      isRanking: true,
    };
  }
  if (/\b(leaderboard|ranking|rank)\b/.test(q) && /\b(loan officers?|los?|branches?)\b/.test(q)) {
    return { kind: "top", limit: RANKING_DEFAULT_LIMIT, isRanking: true };
  }
  if (/\btop\b/.test(q) && /\b(loan officers?|los?|branches?|officers?)\b/.test(q)) {
    return { kind: "top", limit: RANKING_DEFAULT_LIMIT, isRanking: true };
  }
  if (/\bbottom\b/.test(q) && /\b(loan officers?|los?|branches?|officers?)\b/.test(q)) {
    return { kind: "bottom", limit: RANKING_DEFAULT_LIMIT, isRanking: true };
  }
  return null;
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n < 1) return RANKING_DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), RANKING_CHART_MAX);
}

export function isRankingGuardEnabled(): boolean {
  return process.env.UNIFIED_CHAT_RANKING_GUARDS !== "false";
}

/** Enforce LIMIT on ranking SQL when missing or too large. */
export function applyRankingSqlGuard(
  sql: string,
  intent: RankingIntent,
): string {
  let out = sql.trim().replace(/;+\s*$/, "");
  const upper = out.toUpperCase();
  const limitMatch = upper.match(/\bLIMIT\s+(\d+)/i);
  const desired = Math.min(intent.limit, RANKING_CHART_MAX);

  if (!limitMatch) {
    if (!/\bORDER\s+BY\b/i.test(out)) {
      // Cannot safely add ORDER BY without knowing columns — caller may fallback
      return out;
    }
    return `${out} LIMIT ${desired}`;
  }

  const current = parseInt(limitMatch[1], 10);
  if (current > desired) {
    out = out.replace(/\bLIMIT\s+\d+/i, `LIMIT ${desired}`);
  }
  return out;
}

export function logRankingGuardTrace(
  question: string,
  intent: RankingIntent | null,
  sql: string | undefined,
  rowCount: number | undefined,
): void {
  if (process.env.UNIFIED_CHAT_RANKING_GUARD_TRACE !== "true") return;
  console.log("[RankingGuard]", {
    question: question.slice(0, 120),
    intent,
    sqlLimit: sql?.match(/\bLIMIT\s+(\d+)/i)?.[1],
    rowCount,
  });
}

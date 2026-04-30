/**
 * Decides whether a Research Lab SQL widget may opt into Workbench filter injection.
 *
 * Mirrors server-side assumptions in:
 * - `server/src/routes/cohiChat.ts` (final SELECT body + column visibility)
 * - `server/src/routes/cohiWorkbench.ts` (EXPLAIN validation injects `l.<dateColumn>`)
 */

/** Date columns we allow for RL → Workbench injection (exclude created_at / updated_at). */
export const RESEARCH_INJECTABLE_DATE_COLUMNS = [
  "application_date",
  "funding_date",
  "lock_date",
  "started_date",
  "closing_date",
] as const;

export type ResearchInjectableDateColumn = (typeof RESEARCH_INJECTABLE_DATE_COLUMNS)[number];

export interface ResearchSqlFilterInjectionEligibility {
  eligible: boolean;
  /** When eligible, the date column to use for filter injection / validation. */
  dateColumn: ResearchInjectableDateColumn | null;
  /** Short machine reason for logging / tests (not shown to users). */
  reason: string;
}

/**
 * Same algorithm as `findFinalSelectOffset` in `server/src/routes/cohiChat.ts`.
 */
export function findFinalSelectOffset(sql: string): number {
  if (!/^\s*WITH\b/i.test(sql)) return 0;
  let depth = 0;
  let lastSelectAtZero = 0;
  const upper = sql.toUpperCase();
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") {
      depth++;
      continue;
    }
    if (sql[i] === ")") {
      depth--;
      continue;
    }
    if (
      depth === 0 &&
      upper.startsWith("SELECT", i) &&
      (i === 0 || /[\s\n),]/.test(sql[i - 1])) &&
      (i + 6 >= sql.length || /[\s\n]/.test(sql[i + 6]))
    ) {
      lastSelectAtZero = i;
    }
  }
  return lastSelectAtZero;
}

/**
 * Whether `column` appears in the final SELECT body (CTE-safe), matching
 * `cohiChat` execute-sql visibility checks.
 */
export function columnReferencedInFinalSelectBody(sql: string, column: string): boolean {
  const trimmed = sql.trimEnd().replace(/;+\s*$/u, "").trimEnd();
  const offset = findFinalSelectOffset(trimmed);
  const finalBody = trimmed.substring(offset);
  const colEscaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:[a-zA-Z_][a-zA-Z0-9_]*\\.)?${colEscaped}\\b`, "i").test(finalBody);
}

/**
 * Workbench EXPLAIN validation injects `l.<dateColumn>` — require a `loans l` (or `public.loans l`) alias.
 */
export function hasStandardLoansAliasL(sql: string): boolean {
  return /\b(?:public\.)?loans\s+l\b/i.test(sql);
}

export function isSingleStatementSql(sql: string): boolean {
  const t = sql.trimEnd().replace(/;+\s*$/u, "").trimEnd();
  return !/;/u.test(t);
}

/**
 * Conservative: no pull-through / segmented pull-through widgets (Workbench has extra guardrails).
 */
export function looksLikePullThroughSql(sql: string, title?: string, explanation?: string): boolean {
  const hay = `${title || ""} ${explanation || ""} ${sql || ""}`.toLowerCase();
  return (
    hay.includes("pull-through") ||
    hay.includes("pull through") ||
    hay.includes("pullthrough") ||
    hay.includes("pull_through")
  );
}

export function computeResearchSqlFilterInjectionEligibility(
  sql: string,
  opts?: { title?: string; explanation?: string },
): ResearchSqlFilterInjectionEligibility {
  const s = (sql || "").trim();
  if (!s) {
    return { eligible: false, dateColumn: null, reason: "empty_sql" };
  }
  if (!isSingleStatementSql(s)) {
    return { eligible: false, dateColumn: null, reason: "multi_statement" };
  }
  const upper = s.toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    return { eligible: false, dateColumn: null, reason: "not_select" };
  }
  if (looksLikePullThroughSql(s, opts?.title, opts?.explanation)) {
    return { eligible: false, dateColumn: null, reason: "pull_through" };
  }
  if (!hasStandardLoansAliasL(s)) {
    return { eligible: false, dateColumn: null, reason: "missing_loans_l_alias" };
  }

  for (const col of RESEARCH_INJECTABLE_DATE_COLUMNS) {
    if (columnReferencedInFinalSelectBody(s, col)) {
      return { eligible: true, dateColumn: col, reason: `ok_${col}` };
    }
  }
  return { eligible: false, dateColumn: null, reason: "no_injectable_date_column_in_final_select" };
}

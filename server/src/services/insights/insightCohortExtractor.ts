import type { InsightFinding } from "./agents/insightInvestigatorAgent.js";
import { CANONICAL_COHORT_FILTERS, type CanonicalCohortKey } from "../dataQuality/canonicalCohorts.js";

export interface ExtractedInsightCohort {
  cohortSql: string | null;
  cohortSource: "headlineMetricSignature" | "metricSignature" | "fallback" | "none";
  diagnostics: string[];
}

function sqlMentionsLoanId(sql: string): boolean {
  return /\bloan_id\b/i.test(sql);
}

function extractBranchHint(text: string): string | undefined {
  const m = text.match(/\bbranch\s+([a-z0-9_-]{2,30})\b/i);
  return m?.[1];
}

function extractCanonicalCohortHint(text: string): CanonicalCohortKey | undefined {
  const t = text.toLowerCase();
  if (/\bactive\b/.test(t)) return "active";
  if (/\boriginated\b|\bfunded\b|\bpurchased\b/.test(t)) return "originated";
  return undefined;
}

function makeWrappedLoanIdCohort(sql: string): string {
  return `WITH insight_base AS (${sql}) SELECT DISTINCT loan_id FROM insight_base WHERE loan_id IS NOT NULL`;
}

export function extractInsightCohortSql(finding?: InsightFinding): ExtractedInsightCohort {
  if (!finding) {
    return { cohortSql: null, cohortSource: "none", diagnostics: ["missing_finding"] };
  }

  const diagnostics: string[] = [];
  const headlineSql = finding.headlineMetricSignature?.sql;
  if (headlineSql && sqlMentionsLoanId(headlineSql)) {
    return {
      cohortSql: makeWrappedLoanIdCohort(headlineSql),
      cohortSource: "headlineMetricSignature",
      diagnostics,
    };
  }
  if (headlineSql && !sqlMentionsLoanId(headlineSql)) diagnostics.push("headline_no_loan_id");

  const metricSql = finding.metricSignature?.sql;
  if (metricSql && sqlMentionsLoanId(metricSql)) {
    return {
      cohortSql: makeWrappedLoanIdCohort(metricSql),
      cohortSource: "metricSignature",
      diagnostics,
    };
  }
  if (metricSql && !sqlMentionsLoanId(metricSql)) diagnostics.push("metric_no_loan_id");

  const text = `${finding.title} ${finding.summary}`.trim();
  const cohortHint = extractCanonicalCohortHint(text);
  if (!cohortHint) {
    diagnostics.push("fallback_missing_cohort_hint");
    return { cohortSql: null, cohortSource: "none", diagnostics };
  }

  const branchHint = extractBranchHint(text);
  const branchClause = branchHint ? ` AND branch = '${branchHint.replace(/'/g, "''")}'` : "";
  return {
    cohortSql: `SELECT loan_id FROM public.loans WHERE ${CANONICAL_COHORT_FILTERS[cohortHint]}${branchClause}`,
    cohortSource: "fallback",
    diagnostics,
  };
}

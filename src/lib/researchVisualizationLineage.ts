/**
 * COHI-365 / COHI-366: infer a canonical dashboard for SQL research evidence (fallback links
 * and lineage suppression when registry widgets are embedded).
 *
 * Lightweight heuristics — prefer no link over a wrong link when ambiguous.
 */

import type { ResearchVisualizationSource } from "@/types/researchWorkbench";

function normalizeDashboardPath(p: string): string {
  return (p || "").replace(/\/+$/g, "").toLowerCase();
}

/**
 * When SQL lineage resolves to a dashboard that is already represented by an embedded
 * registry widget on the same finding, suppress the duplicate COHI-365 link.
 */
export function shouldShowResearchSqlLineageLink(input: {
  resolvedLineage: ResearchVisualizationSource | null;
  registryDashboardPaths: string[];
}): boolean {
  if (!input.resolvedLineage) return false;
  if (!input.registryDashboardPaths.length) return true;
  const target = normalizeDashboardPath(input.resolvedLineage.dashboardPath);
  const overlaps = input.registryDashboardPaths.some((p) => normalizeDashboardPath(p) === target);
  return !overlaps;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveResearchVisualizationLineage(input: {
  sql: string;
  explanation: string;
  findingTitle?: string;
}): ResearchVisualizationSource | null {
  const hay = normalize(`${input.findingTitle ?? ""} ${input.explanation ?? ""} ${input.sql ?? ""}`);
  if (!hay) return null;

  const loSignals =
    /\blo\b|\blo's\b|loan officer|loan_officer|tts|tier distribution|top tier|second tier|bottom tier|sales scorecard/i.test(
      hay,
    );
  const opsSignals =
    /\bprocessor\b|\bunderwriter\b|\bcloser\b|operations scorecard|uw cycle|underwriting cycle|ops scorecard/i.test(hay);

  if (loSignals && !opsSignals) {
    return {
      kind: "dashboard",
      dashboardPath: "/sales-scorecard",
      dashboardLabel: "Sales Scorecard",
      sectionId: "salesScorecard",
      matchConfidence: "medium",
    };
  }
  if (opsSignals && !loSignals) {
    return {
      kind: "dashboard",
      dashboardPath: "/performance/operation-scorecard",
      dashboardLabel: "Operations Scorecard",
      sectionId: "operationsScorecard",
      matchConfidence: "medium",
    };
  }
  if (/\bbranch\b|\bchannel\b|company scorecard|portfolio/i.test(hay) && !loSignals && !opsSignals) {
    return {
      kind: "dashboard",
      dashboardPath: "/company-scorecard",
      dashboardLabel: "Company Scorecard",
      sectionId: "companyScorecard",
      matchConfidence: "low",
    };
  }
  if (/\bactor\b|\bmixed\b.*(processor|underwriter|loan officer)/i.test(hay)) {
    return {
      kind: "dashboard",
      dashboardPath: "/actors",
      dashboardLabel: "Actors",
      sectionId: "actors",
      matchConfidence: "low",
    };
  }
  return null;
}

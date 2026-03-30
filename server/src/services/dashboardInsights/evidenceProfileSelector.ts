import type { DashboardInsight } from "./types.js";
import type { EvidenceIntent, EvidenceSelectionInput } from "./evidenceProfiles.js";

/**
 * Generic default selector. Page-specific selectors can override this behavior.
 */
export function selectDefaultEvidenceIntent(input: EvidenceSelectionInput): EvidenceIntent {
  const { insight } = input;
  const primary = insight.evidence_refs?.find((r) => r.role === "primary") ?? insight.evidence_refs?.[0];
  return {
    profile: "aggregate_context",
    widgetId: primary?.widgetId,
    targetType: primary?.target?.type,
    targetLabel: primary?.target?.label,
    applicationType:
      typeof insight.filter_context?.applicationType === "string"
        ? String(insight.filter_context.applicationType)
        : undefined,
    datePeriod:
      typeof insight.filter_context?.datePeriod === "string"
        ? String(insight.filter_context.datePeriod)
        : undefined,
    loanMixDimension:
      typeof insight.filter_context?.loanMixDimension === "string"
        ? String(insight.filter_context.loanMixDimension)
        : undefined,
  };
}

export interface PageEvidenceSelector {
  select: (input: EvidenceSelectionInput) => EvidenceIntent;
}

export function selectEvidenceIntent(
  pageId: string,
  insight: DashboardInsight,
  selectors?: Record<string, PageEvidenceSelector>
): EvidenceIntent {
  const pageSelector = selectors?.[pageId];
  if (pageSelector) {
    return pageSelector.select({ pageId, insight });
  }
  return selectDefaultEvidenceIntent({ pageId, insight });
}

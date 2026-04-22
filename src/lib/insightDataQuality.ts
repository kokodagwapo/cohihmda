import type { WarningGroup } from "@/components/data-quality/types";

const ALL_WARNING_GROUPS: readonly WarningGroup[] = [
  "Status Tests",
  "Application Tests",
  "Credit Tests",
  "UW Tests",
  "Mortgage Tests",
  "Personnel Tests",
  "Date Tests",
];

function isWarningGroup(s: string): s is WarningGroup {
  return (ALL_WARNING_GROUPS as readonly string[]).includes(s);
}

/** Mirrors server `InsightDataQualityMeta` persisted in `detail_data.data_quality`. */
export interface InsightDataQualityMeta {
  flagged: boolean;
  issue_summary?: string;
  trust_impact?: "low" | "medium" | "high";
  affected_loan_count?: number | null;
  reference_loan_count?: number | null;
  counts_confidence?: "exact" | "estimated" | "unknown";
  /** Same ids as the Data Quality dashboard automated checks. */
  review_test_ids?: string[];
  /** Groups derived from those tests (matches dashboard warning groups). */
  review_groups?: WarningGroup[];
  dq_samples_by_test_id?: Record<
    string,
    Array<{ loan_id: string; loan_number: string | null; [key: string]: unknown }>
  >;
  dq_sample_columns_by_test_id?: Record<string, string[]>;
}

export function getInsightDataQuality(detailData: unknown): InsightDataQualityMeta | undefined {
  if (!detailData || typeof detailData !== "object") return undefined;
  const dq = (detailData as Record<string, unknown>).data_quality;
  if (!dq || typeof dq !== "object") return undefined;
  const o = dq as Record<string, unknown>;
  if (o.flagged !== true) return undefined;
  const groupsRaw = o.review_groups;
  const review_groups = Array.isArray(groupsRaw)
    ? groupsRaw.filter((g): g is WarningGroup => typeof g === "string" && isWarningGroup(g))
    : undefined;

  const idsRaw = o.review_test_ids;
  const review_test_ids = Array.isArray(idsRaw)
    ? idsRaw.filter((x): x is string => typeof x === "string" && x.length > 0)
    : undefined;

  const samplesRaw = o.dq_samples_by_test_id;
  const dq_samples_by_test_id =
    samplesRaw && typeof samplesRaw === "object"
      ? Object.fromEntries(
          Object.entries(samplesRaw as Record<string, unknown>)
            .filter(([k, v]) => typeof k === "string" && Array.isArray(v))
            .map(([k, v]) => [
              k,
              (v as unknown[]).slice(0, 20).map((row) => {
                const r = (row || {}) as Record<string, unknown>;
                return {
                  loan_id:
                    typeof r.loan_id === "string"
                      ? r.loan_id
                      : String(r.loan_id ?? ""),
                  loan_number:
                    typeof r.loan_number === "string" || r.loan_number === null
                      ? (r.loan_number as string | null)
                      : null,
                  ...Object.fromEntries(
                    Object.entries(r).filter(([k]) => k !== "loan_id" && k !== "loan_number")
                  ),
                };
              }),
            ])
        )
      : undefined;

  const sampleColumnsRaw = o.dq_sample_columns_by_test_id;
  const dq_sample_columns_by_test_id =
    sampleColumnsRaw && typeof sampleColumnsRaw === "object"
      ? Object.fromEntries(
          Object.entries(sampleColumnsRaw as Record<string, unknown>)
            .filter(([k, v]) => typeof k === "string" && Array.isArray(v))
            .map(([k, v]) => [
              k,
              (v as unknown[]).filter((c): c is string => typeof c === "string" && c.length > 0),
            ])
        )
      : undefined;

  return {
    flagged: true,
    issue_summary: typeof o.issue_summary === "string" ? o.issue_summary : undefined,
    trust_impact:
      o.trust_impact === "low" || o.trust_impact === "high" || o.trust_impact === "medium"
        ? o.trust_impact
        : "medium",
    affected_loan_count: typeof o.affected_loan_count === "number" ? o.affected_loan_count : o.affected_loan_count === null ? null : undefined,
    reference_loan_count: typeof o.reference_loan_count === "number" ? o.reference_loan_count : o.reference_loan_count === null ? null : undefined,
    counts_confidence:
      o.counts_confidence === "exact" || o.counts_confidence === "estimated" || o.counts_confidence === "unknown"
        ? o.counts_confidence
        : "unknown",
    ...(review_test_ids?.length ? { review_test_ids } : {}),
    ...(review_groups?.length ? { review_groups } : {}),
    ...(dq_samples_by_test_id &&
    Object.keys(dq_samples_by_test_id).length > 0
      ? { dq_samples_by_test_id }
      : {}),
    ...(dq_sample_columns_by_test_id &&
    Object.keys(dq_sample_columns_by_test_id).length > 0
      ? { dq_sample_columns_by_test_id }
      : {}),
  };
}

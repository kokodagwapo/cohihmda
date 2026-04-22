import type { InsightDataQualityMeta } from "@/lib/insightDataQuality";
import { Link } from "react-router-dom";

function trustCopy(level?: string): string {
  switch (level) {
    case "high":
      return "Treat as directional only until underlying data is remediated.";
    case "low":
      return "Minor limitation — insight is still largely actionable.";
    case "medium":
    default:
      return "Interpret with care and validate key numbers before major decisions.";
  }
}

function columnLabel(col: string): string {
  if (col === "loan_number") return "Loan #";
  if (col === "loan_id") return "Loan ID";
  return col.replace(/_/g, " ");
}

export function DataQualityImpactBlock({
  dq,
  className = "",
}: {
  dq: InsightDataQualityMeta;
  className?: string;
}) {
  if (!dq.flagged) return null;

  const aff = dq.affected_loan_count;
  const ref = dq.reference_loan_count;
  const countsUnknown = aff == null || ref == null;
  const countsLine = countsUnknown
    ? "Exact loan coverage could not be computed from the evidence attached to this insight."
    : `${aff} of ${ref} loans in this insight’s scope are affected by the stated data issue.`;
  const deepLinkIssueId = dq.review_test_ids?.[0];
  const dataQualityHref = deepLinkIssueId
    ? `/data-quality?tab=warnings&warning=${encodeURIComponent(deepLinkIssueId)}`
    : "/data-quality?tab=warnings";
  const sampleTestIds = dq.review_test_ids?.filter(
    (id) => (dq.dq_samples_by_test_id?.[id]?.length || 0) > 0
  ) || [];

  return (
    <div
      className={`rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-amber-50/90 dark:bg-amber-950/25 px-4 py-3 space-y-2 ${className}`}
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        Data quality impact
      </h4>
      <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
        {dq.issue_summary || "A data quality concern affects how this insight should be interpreted."}
      </p>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-300">Trust: </span>
        {trustCopy(dq.trust_impact)}
      </p>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-300">Coverage: </span>
        {countsLine}
        {dq.counts_confidence === "estimated" && !countsUnknown ? " (Estimated counts.)" : null}
      </p>
      {(dq.review_groups?.length || dq.review_test_ids?.length) ? (
        <div className="pt-1 space-y-1.5">
          {dq.review_groups?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {dq.review_groups.map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center rounded-md border border-amber-300/70 dark:border-amber-800/60 bg-white/80 dark:bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-amber-950 dark:text-amber-100"
                >
                  {g}
                </span>
              ))}
            </div>
          ) : null}
          {dq.review_test_ids?.length ? (
            <p className="text-[11px] text-slate-600 dark:text-slate-400 font-mono leading-relaxed break-all">
              <span className="font-sans font-medium text-slate-700 dark:text-slate-300">Data Quality checks: </span>
              {dq.review_test_ids.join(", ")}
            </p>
          ) : null}
          {sampleTestIds.length > 0 ? (
            <div className="pt-1 space-y-2">
              {sampleTestIds.map((testId) => {
                const rows = dq.dq_samples_by_test_id?.[testId] || [];
                if (rows.length === 0) return null;
                const sampleCols = dq.dq_sample_columns_by_test_id?.[testId];
                const columns = (sampleCols?.length
                  ? sampleCols
                  : Object.keys(rows[0] || {})).filter(Boolean);
                return (
                  <div key={testId} className="rounded-lg border border-amber-200/80 dark:border-amber-800/50 overflow-hidden">
                    <div className="px-2.5 py-1.5 text-[11px] font-medium bg-amber-100/70 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100">
                      {`Sample loans for ${testId} (${rows.length} shown)`}
                    </div>
                    <div className="max-h-44 overflow-auto">
                      <table className="w-full text-[11px]">
                        <thead className="bg-white/80 dark:bg-slate-900/80">
                          <tr>
                            {columns.map((col) => (
                              <th key={`${testId}-col-${col}`} className="text-left px-2.5 py-1.5 font-medium text-slate-700 dark:text-slate-300">
                                {columnLabel(col)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, 20).map((row, i) => (
                            <tr key={`${testId}-${row.loan_id}-${i}`} className="border-t border-amber-100/70 dark:border-amber-900/40">
                              {columns.map((col) => (
                                <td
                                  key={`${testId}-${row.loan_id}-${i}-${col}`}
                                  className={`px-2.5 py-1.5 ${col === "loan_id" ? "font-mono text-slate-600 dark:text-slate-400" : "text-slate-700 dark:text-slate-300"}`}
                                >
                                  {String((row as Record<string, unknown>)[col] ?? "NULL")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div>
            <Link
              to={dataQualityHref}
              className="text-xs font-medium text-amber-900 dark:text-amber-200 underline underline-offset-2 hover:opacity-80"
            >
              Open this issue in Data Quality
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

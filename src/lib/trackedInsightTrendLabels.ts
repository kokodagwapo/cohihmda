/**
 * Labels for dual trend: vs immediately prior snapshot vs original (first) snapshot.
 * Keep in sync with server `formatDualTrendSummary` in trackedInsightEvaluator.ts.
 */

/**
 * Single pill trend: prefer any non-stable signal. If either vs-last or vs-baseline is
 * worsening/improving, show that (worsening wins over improving when both differ).
 */
export function effectiveTrendForBadge(
  trendSinceLast: string | null | undefined,
  trendVsBaseline: string | null | undefined
): "improving" | "worsening" | "stable" | "new" {
  const last = trendSinceLast ?? "stable";
  const base = trendVsBaseline ?? "stable";

  if (last === "new") return "new";

  if (last === "worsening" || base === "worsening") return "worsening";
  if (last === "improving" || base === "improving") return "improving";
  return "stable";
}

export function formatDualTrendSummary(
  sinceLast: "improving" | "worsening" | "stable" | "new" | null | undefined,
  sinceBaseline: "improving" | "worsening" | "stable" | "new" | null | undefined
): string {
  const label = (t: string) =>
    t === "improving"
      ? "Improving"
      : t === "worsening"
        ? "Worsening"
        : t === "new"
          ? "New baseline"
          : "Stable";
  if (sinceLast === "new" || sinceLast == null) {
    return "New baseline — first evaluation (no prior snapshot).";
  }
  if (sinceBaseline == null || sinceBaseline === undefined) {
    return `${label(sinceLast)} since last evaluation`;
  }
  if (sinceLast === sinceBaseline) {
    return `${label(sinceLast)} since last evaluation and since original evaluation`;
  }
  return `${label(sinceLast)} since last evaluation, ${label(sinceBaseline)} since original evaluation`;
}

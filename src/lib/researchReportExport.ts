import type { ResearchReport } from "@/hooks/useResearchSession";
import type { ExportData } from "@/utils/exportUtils";

/** Builds structured Excel export payload for a deep research synthesis report. */
export function buildResearchReportExportData(
  report: ResearchReport,
  title: string,
): ExportData {
  return {
    title,
    tables: [
      {
        name: "Executive Summary",
        headers: ["Section", "Content"],
        rows: [["Summary", report.executiveSummary || ""]],
      },
      ...(report.rankedInsights?.length
        ? [
            {
              name: "Insights",
              headers: ["Rank", "Headline", "Detail", "Impact"],
              rows: report.rankedInsights.map((insight) => [
                insight.rank,
                insight.headline || "",
                insight.detail || "",
                insight.impact || "",
              ]),
            },
          ]
        : []),
    ],
  };
}

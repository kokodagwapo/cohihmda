/**
 * Off-screen chart/widget targets for research report PowerPoint capture.
 * Renders each finding once (avoids duplicating evidence across ranked insights).
 */

import type { Finding } from "@/hooks/useResearchSession";
import { isSqlEvidence, isRegistryWidgetEvidence } from "@/hooks/useResearchSession";
import { canExportChart } from "@/lib/researchChartConfig";
import {
  findingExportKeyPrefix,
  sortFindingsForExport,
} from "@/lib/researchReportPptExport";
import { AutoChart } from "@/components/research/FindingDrillDown";
import { RegistryWidgetEmbed } from "@/components/research/RegistryWidgetEmbed";

type ResearchPptCaptureHostProps = {
  findings: Finding[];
  sessionId?: string | null;
};

export function ResearchPptCaptureHost({
  findings,
  sessionId,
}: ResearchPptCaptureHostProps) {
  const sorted = sortFindingsForExport(findings);

  return (
    <div
      className="fixed -left-[12000px] top-0 z-[-1] w-[560px] pointer-events-none opacity-[0.01]"
      aria-hidden
      data-research-ppt-capture-host
    >
      {sorted.map((finding) => {
        const keyPrefix = findingExportKeyPrefix(finding);
        const saveTitle = finding.title;
        return (finding.evidence ?? []).map((ev, index) => {
          if (isRegistryWidgetEvidence(ev)) {
            return (
              <div key={`${keyPrefix}-widget-${ev.definitionId}`} className="mb-4">
                <RegistryWidgetEmbed
                  evidence={ev}
                  captureKey={`${keyPrefix}-widget-${ev.definitionId}`}
                />
              </div>
            );
          }
          if (!isSqlEvidence(ev) || !canExportChart(ev)) return null;
          return (
            <div key={`${keyPrefix}-sql-${index}`} className="mb-4 h-[220px]">
              <AutoChart
                evidence={ev}
                saveTitle={saveTitle}
                sessionId={sessionId}
                captureKey={`${keyPrefix}-sql-${index}`}
              />
            </div>
          );
        });
      })}
    </div>
  );
}

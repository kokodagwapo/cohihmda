import type { EvidenceItem, Finding, ResearchReport } from "@/hooks/useResearchSession";
import {
  isRegistryWidgetEvidence,
  isSqlEvidence,
} from "@/hooks/useResearchSession";
import {
  sqlEvidenceToTableRows,
  stripMarkdownPlain,
} from "@/lib/researchEvidenceExport";
import { canExportChart } from "@/lib/researchChartConfig";
import type { FieldFormat } from "@/config/insightFieldRegistry";

export type ResearchPptSlide =
  | {
      kind: "intro";
      title: string;
      understory?: string;
      sections?: Array<{ heading: string; body: string }>;
    }
  | {
      kind: "findingIntro";
      findingLabel: string;
      headline: string;
      understory: string;
    }
  | {
      kind: "insightCapture";
      captureKey: string;
    }
  | {
      kind: "table";
      title: string;
      headers: string[];
      rows: string[][];
    }
  | {
      kind: "image";
      title: string;
      captureKey: string;
    };

export type BuildResearchReportPptInput = {
  title: string;
  understory?: string;
  report: ResearchReport | null;
  findings: Finding[];
  /** Quick mode: finding shown on the report tab (latest when omitted). */
  primaryFinding?: Finding | null;
};

export function sortFindingsForExport(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => a.questionId - b.questionId);
}

export function findingExportKeyPrefix(finding: Finding): string {
  return `finding-${finding.questionId}`;
}

/** 1-based display index (Findings tab order), not internal questionId. */
export function findingOrdinalLabel(ordinal: number): string {
  return `Finding ${ordinal}`;
}

export function insightCardCaptureKey(rank: number): string {
  return `insight-card-${rank}`;
}

export function collectImageCaptureKeys(slides: ResearchPptSlide[]): string[] {
  return slides.flatMap((s) =>
    s.kind === "image" || s.kind === "insightCapture" ? [s.captureKey] : [],
  );
}

/** Allow extra time when insight cards and charts mount for capture. */
export function researchCaptureTimeoutMs(captureKeys: string[]): number {
  const insightCards = captureKeys.filter((k) => k.startsWith("insight-card-")).length;
  const charts = captureKeys.length - insightCards;
  return Math.min(24_000, 5_000 + insightCards * 2_500 + charts * 400);
}

function appendInsightScreenshotSlides(
  slides: ResearchPptSlide[],
  report: ResearchReport,
): void {
  const insights = [...(report.rankedInsights ?? [])].sort(
    (a, b) => a.rank - b.rank,
  );
  for (const insight of insights) {
    slides.push({
      kind: "insightCapture",
      captureKey: insightCardCaptureKey(insight.rank),
    });
  }
}

function appendEvidenceSlides(
  slides: ResearchPptSlide[],
  slideTitleBase: string,
  evidenceList: EvidenceItem[],
  keyPrefix: string,
): void {
  evidenceList.forEach((ev, index) => {
    if (isSqlEvidence(ev) && ev.rows.length > 0) {
      const { headers, rows } = sqlEvidenceToTableRows(
        ev,
        (ev.columnFormats || {}) as Record<string, FieldFormat>,
      );
      const base =
        evidenceList.length > 1 && ev.explanation
          ? `${slideTitleBase} — ${ev.explanation}`
          : slideTitleBase;
      slides.push({
        kind: "table",
        title: base,
        headers,
        rows,
      });
      if (canExportChart(ev)) {
        slides.push({
          kind: "image",
          title: slideTitleBase,
          captureKey: `${keyPrefix}-sql-${index}`,
        });
      }
    } else if (isRegistryWidgetEvidence(ev)) {
      slides.push({
        kind: "image",
        title: `${slideTitleBase} — ${ev.definitionName}`,
        captureKey: `${keyPrefix}-widget-${ev.definitionId}`,
      });
    }
  });
}

function appendDeepReportFindingSlides(
  slides: ResearchPptSlide[],
  findings: Finding[],
): void {
  sortFindingsForExport(findings).forEach((finding, index) => {
    const ordinal = index + 1;
    const findingLabel = findingOrdinalLabel(ordinal);
    const hasExportableEvidence = (finding.evidence ?? []).some(
      (e) =>
        isRegistryWidgetEvidence(e) ||
        (isSqlEvidence(e) && e.rows?.length > 0),
    );
    if (!finding.title?.trim() && !finding.summary?.trim() && !hasExportableEvidence) {
      return;
    }

    slides.push({
      kind: "findingIntro",
      findingLabel,
      headline: finding.title || findingLabel,
      understory: stripMarkdownPlain(finding.summary || ""),
    });

    if (finding.evidence?.length) {
      appendEvidenceSlides(
        slides,
        finding.title || findingLabel,
        finding.evidence,
        findingExportKeyPrefix(finding),
      );
    }
  });
}

export function buildResearchReportPptModel(
  input: BuildResearchReportPptInput,
): ResearchPptSlide[] {
  const { title, report, findings } = input;
  const understory =
    input.understory?.trim() ||
    findings[findings.length - 1]?.summary?.trim() ||
    undefined;

  const slides: ResearchPptSlide[] = [];

  if (report) {
    const sections: Array<{ heading: string; body: string }> = [];
    if (report.directAnswer?.trim()) {
      sections.push({
        heading: "Answer",
        body: stripMarkdownPlain(report.directAnswer),
      });
    }
    if (report.executiveSummary?.trim()) {
      sections.push({
        heading: "Executive Summary",
        body: stripMarkdownPlain(report.executiveSummary),
      });
    }
    slides.push({
      kind: "intro",
      title,
      understory: understory ? stripMarkdownPlain(understory) : undefined,
      sections: sections.length ? sections : undefined,
    });

    appendInsightScreenshotSlides(slides, report);
    appendDeepReportFindingSlides(slides, findings);
    return slides;
  }

  // Quick / non-deep: title + understory, then primary finding evidence
  const primary =
    input.primaryFinding ??
    (findings.length ? sortFindingsForExport(findings).at(-1) : null);

  slides.push({
    kind: "intro",
    title,
    understory: primary?.summary
      ? stripMarkdownPlain(primary.summary)
      : understory
        ? stripMarkdownPlain(understory)
        : undefined,
  });

  if (primary?.evidence?.length) {
    appendEvidenceSlides(
      slides,
      primary.title,
      primary.evidence,
      findingExportKeyPrefix(primary),
    );
  }

  return slides;
}

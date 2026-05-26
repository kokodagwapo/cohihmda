import { describe, expect, it } from "vitest";
import {
  buildResearchReportPptModel,
  collectImageCaptureKeys,
} from "@/lib/researchReportPptExport";
import type { Finding, ResearchReport } from "@/hooks/useResearchSession";

const sampleReport: ResearchReport = {
  directAnswer: "Direct answer text.",
  executiveSummary: "Executive summary text.",
  themes: [],
  rankedInsights: [
    {
      rank: 1,
      headline: "Insight One",
      detail: "Detail",
      impact: "high",
      supportingFindingIds: [1, 2],
    },
  ],
  furtherInvestigation: [],
  generatedAt: new Date().toISOString(),
};

const sampleFinding: Finding = {
  questionId: 1,
  title: "Finding title",
  summary: "Finding summary narrative.",
  confidence: "high",
  evidence: [
    {
      sql: "SELECT 1",
      explanation: "Table A",
      rows: Array.from({ length: 25 }, (_, i) => ({
        category: `Segment ${i + 1}`,
        val: i * 10,
      })),
      rowCount: 25,
      fields: ["category", "val"],
    },
  ],
  keyMetrics: {},
};

const secondFinding: Finding = {
  questionId: 900,
  title: "Second finding",
  summary: "Second summary.",
  confidence: "medium",
  evidence: [],
  keyMetrics: {},
};

describe("buildResearchReportPptModel", () => {
  it("deep mode includes answer and executive summary on intro", () => {
    const slides = buildResearchReportPptModel({
      title: "Research Report - Test",
      understory: "User question",
      report: sampleReport,
      findings: [sampleFinding],
    });
    expect(slides[0]).toMatchObject({ kind: "intro", title: "Research Report - Test" });
    const intro = slides[0];
    if (intro.kind !== "intro") throw new Error("expected intro");
    expect(intro.sections?.map((s) => s.heading)).toEqual([
      "Answer",
      "Executive Summary",
    ]);
  });

  it("deep mode inserts insight screenshot slides after intro and before findings", () => {
    const slides = buildResearchReportPptModel({
      title: "Research Report - Test",
      report: sampleReport,
      findings: [sampleFinding, secondFinding],
    });
    expect(slides[0].kind).toBe("intro");
    expect(slides[1]).toMatchObject({
      kind: "insightCapture",
      captureKey: "insight-card-1",
    });
    expect(slides.findIndex((s) => s.kind === "findingIntro")).toBeGreaterThan(1);
  });

  it("deep mode emits finding intro slides instead of insight evidence tables", () => {
    const slides = buildResearchReportPptModel({
      title: "Research Report - Test",
      report: sampleReport,
      findings: [sampleFinding, secondFinding],
    });
    const findingIntros = slides.filter((s) => s.kind === "findingIntro");
    expect(findingIntros).toHaveLength(2);
    expect(findingIntros[0]).toMatchObject({
      kind: "findingIntro",
      findingLabel: "Finding 1",
      headline: "Finding title",
    });
    expect(findingIntros[1]).toMatchObject({
      kind: "findingIntro",
      findingLabel: "Finding 2",
      headline: "Second finding",
    });
    expect(slides.some((s) => s.kind === "table")).toBe(true);
    expect(slides.some((s) => s.kind === "image")).toBe(true);
    expect(
      slides.some(
        (s) => s.kind === "image" && s.captureKey.startsWith("insight-"),
      ),
    ).toBe(false);
  });

  it("quick mode has title + understory only, then tables and chart", () => {
    const slides = buildResearchReportPptModel({
      title: "Research Report - Quick",
      report: null,
      findings: [sampleFinding],
      primaryFinding: sampleFinding,
    });
    expect(slides[0]).toMatchObject({
      kind: "intro",
      title: "Research Report - Quick",
    });
    const intro = slides[0];
    if (intro.kind !== "intro") throw new Error("expected intro");
    expect(intro.sections).toBeUndefined();
    expect(slides.some((s) => s.kind === "table")).toBe(true);
    expect(slides.some((s) => s.kind === "image")).toBe(true);
    expect(slides.some((s) => s.kind === "findingIntro")).toBe(false);
  });

  it("emits one table slide with all rows for renderer pagination", () => {
    const slides = buildResearchReportPptModel({
      title: "T",
      report: null,
      findings: [sampleFinding],
      primaryFinding: sampleFinding,
    });
    const table = slides.find((s) => s.kind === "table");
    expect(table && table.kind === "table" && table.rows.length).toBe(25);
  });

  it("collectImageCaptureKeys includes insight cards and finding charts", () => {
    const slides = buildResearchReportPptModel({
      title: "T",
      report: sampleReport,
      findings: [sampleFinding],
    });
    const keys = collectImageCaptureKeys(slides);
    expect(keys).toContain("insight-card-1");
    expect(keys).toContain("finding-1-sql-0");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

import { describe, expect, it } from "vitest";
import { buildCarryOverContext } from "@/lib/carryOverContext";
import type { ResearchReport } from "@/hooks/useResearchSession";

describe("carryOverContext", () => {
  it("summarizes basic dialogue", () => {
    expect(buildCarryOverContext([])).toBe("");
    expect(
      buildCarryOverContext([
        { role: "user", content: "Build MTD dashboard" },
        { role: "assistant", content: "Here is your dashboard." },
      ]),
    ).toContain("Build MTD dashboard");
  });

  it("includes insight builder draft when fromChatType is insight_builder", () => {
    const summary = buildCarryOverContext(
      [
        { role: "user", content: "Track pipeline" },
        {
          role: "assistant",
          content: "Here is a preview.",
          insightBuilderDraft: {
            title: "Weekly pipeline",
            prompt_text: "Count loans by status",
            schedule: "batch",
            specifiers: { status: "active" },
          },
          insightBuilderPhase: "preview",
        },
      ],
      { fromChatType: "insight_builder" },
    );
    expect(summary).toContain("Weekly pipeline");
    expect(summary).toContain("Count loans by status");
  });

  it("includes workbench create_widget titles", () => {
    const summary = buildCarryOverContext(
      [
        {
          role: "assistant",
          content: "Added widgets.",
          workbenchActions: [
            {
              type: "create_widget",
              title: "MTD Volume",
              explanation: "Monthly funded volume",
              sql: "SELECT 1",
              config: { type: "bar" } as any,
            },
          ],
        },
      ],
      { fromChatType: "workbench" },
    );
    expect(summary).toContain("MTD Volume");
    expect(summary).toContain("Workbench widgets created");
  });

  it("includes research report executive summary", () => {
    const report: ResearchReport = {
      executiveSummary: "Pull-through declined in Q1.",
      themes: [],
      rankedInsights: [
        {
          rank: 1,
          headline: "Channel mix shift",
          keyTakeaway: "Retail underperformed",
          detail: "Detail",
          impact: "high",
          supportingFindingIds: [1],
        },
      ],
      furtherInvestigation: [],
      generatedAt: new Date().toISOString(),
      directAnswer: "Yes, pull-through fell 12%.",
    };
    const summary = buildCarryOverContext(
      [{ role: "user", content: "Why did pull-through drop?" }],
      { fromChatType: "research", researchReport: report },
    );
    expect(summary).toContain("Pull-through declined");
    expect(summary).toContain("Channel mix shift");
    expect(summary).toContain("12%");
  });

  it("respects maxChars", () => {
    const long = buildCarryOverContext(
      [{ role: "user", content: "x".repeat(2000) }],
      { maxChars: 100 },
    );
    expect(long.length).toBeLessThanOrEqual(100);
  });
});

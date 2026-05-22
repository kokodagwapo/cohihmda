import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResearchReportTabContent } from "./ResearchReportTabContent";

vi.mock("@/components/research/ResearchReport", () => ({
  ResearchReport: ({ report }: { report: { executiveSummary: string } }) => (
    <div data-testid="research-report">{report.executiveSummary}</div>
  ),
  QuickAnswerView: () => <div data-testid="quick-answer" />,
}));

vi.mock("@/utils/renderMarkdown", () => ({
  renderMarkdownText: (text: string) => text,
}));

describe("ResearchReportTabContent", () => {
  it("renders session report when transcript is empty (backfilled legacy)", () => {
    render(
      <ResearchReportTabContent
        messages={[]}
        chatLoading={false}
        findings={[
          {
            questionId: 1,
            title: "Stale pipeline",
            summary: "Summary text",
            confidence: "high",
            evidence: [],
            keyMetrics: {},
          },
        ]}
        report={{
          executiveSummary: "Executive summary for backfilled session",
          themes: [],
          rankedInsights: [],
          furtherInvestigation: [],
          generatedAt: new Date().toISOString(),
        }}
        phase="complete"
        researchSessionId="session-1"
        sessionIsOwner
      />,
    );

    expect(screen.getByTestId("research-report")).toHaveTextContent(
      "Executive summary for backfilled session",
    );
    expect(
      screen.queryByText(/Your question and Cohi's answer will appear here/i),
    ).not.toBeInTheDocument();
  });

  it("shows placeholder only when there is no transcript and no session content", () => {
    render(
      <ResearchReportTabContent
        messages={[]}
        chatLoading={false}
        findings={[]}
        report={null}
        phase="idle"
        researchSessionId="session-2"
        sessionIsOwner
      />,
    );

    expect(
      screen.getByText(/Your question and Cohi's answer will appear here/i),
    ).toBeInTheDocument();
  });
});

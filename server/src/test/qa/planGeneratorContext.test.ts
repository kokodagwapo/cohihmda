import { describe, it, expect, vi } from "vitest";
import { generatePlan } from "../../../scripts/qa/ai/planGenerator.js";
import type { LlmClient } from "../../../scripts/qa/ai/llm/openAiClient.js";
import type { ACStatement, TestPlan } from "../../../scripts/qa/ai/types.js";

function validPlan(issueKey: string): TestPlan {
  return {
    planVersion: 1,
    issueKey,
    modelName: "gpt-5.4",
    modelTemperature: 0,
    generatedAt: new Date().toISOString(),
    steps: [
      {
        id: "ac1-open-seeded-canvas",
        kind: "goto",
        // Individual canvas editor lives at `/my-dashboard/:canvasId`, not
        // `/workbench/:canvasId`. Keep this URL shape in sync with
        // `acValidator` so regressions show up in unit tests first.
        url: "/my-dashboard/abc-123",
        expect: {},
      },
    ],
  } as TestPlan;
}

const canvasStatement: ACStatement = {
  index: 1,
  category: "UI",
  statement: "The workbench canvas title input is visible",
  raw: "1. [UI] The workbench canvas title input is visible",
};

const routeStatement: ACStatement = {
  index: 1,
  category: "ROUTE",
  statement: "The workbench hub loads",
  raw: "1. [ROUTE] The workbench hub loads",
};

describe("planGenerator testContext plumbing", () => {
  it("injects seededCanvasUrl into the system prompt when provided", async () => {
    const mockClient: LlmClient = {
      generatePlan: vi.fn(async ({ systemPrompt }) => {
        expect(systemPrompt).toContain("Runtime test context for this plan:");
        expect(systemPrompt).toContain('"/my-dashboard/abc-123"');
        expect(systemPrompt).toContain("seededCanvasUrl");
        return {
          plan: validPlan("COHI-77"),
          rawResponse: "{}",
          tokensIn: 100,
          tokensOut: 50,
          modelName: "gpt-5.4",
          fallbackUsed: false,
        };
      }),
    } as unknown as LlmClient;

    const result = await generatePlan({
      issueKey: "COHI-77",
      issueSummary: "Workbench canvas",
      environment: "dev",
      statements: [canvasStatement],
      llmClient: mockClient,
      testContext: { seededCanvasUrl: "/my-dashboard/abc-123" },
    });

    expect(result.plan.issueKey).toBe("COHI-77");
    expect(mockClient.generatePlan).toHaveBeenCalledTimes(1);
  });

  it("does not inject test-context section when no testContext is provided", async () => {
    const mockClient: LlmClient = {
      generatePlan: vi.fn(async ({ systemPrompt }) => {
        expect(systemPrompt).not.toContain("Runtime test context for this plan:");
        return {
          plan: validPlan("COHI-77"),
          rawResponse: "{}",
          tokensIn: 50,
          tokensOut: 25,
          modelName: "gpt-5.4",
          fallbackUsed: false,
        };
      }),
    } as unknown as LlmClient;

    await generatePlan({
      issueKey: "COHI-77",
      issueSummary: "Workbench canvas",
      environment: "dev",
      statements: [routeStatement],
      llmClient: mockClient,
    });

    expect(mockClient.generatePlan).toHaveBeenCalledTimes(1);
  });
});

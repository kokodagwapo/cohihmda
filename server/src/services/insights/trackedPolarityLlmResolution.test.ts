import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../research/tools.js", () => ({
  callLLM: vi.fn(),
  getOpenAIKey: vi.fn().mockResolvedValue("test-key"),
}));

import { callLLM } from "../research/tools.js";
import { runTrackedPolarityLlmInference } from "./trackedPolarityLlmResolution.js";

describe("runTrackedPolarityLlmInference", () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
  });

  it("returns null when no compared keys are neutral", async () => {
    const r = await runTrackedPolarityLlmInference({
      tenantId: "t1",
      trackedInsightId: "id1",
      headline: "h",
      understory: "u",
      sourceType: "agent",
      displayMetadata: null,
      metricValues: { revenue: 1 },
      comparedKeys: ["revenue"],
      existingPolarities: { revenue: "higher_better" },
      apiKey: "k",
    });
    expect(r).toBeNull();
  });

  it("merges higher_better when confidence is 70", async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        decisions: [
          {
            metric_key: "obscure_metric",
            polarity: "higher_better",
            confidence: 70,
            rationale: "text says more is better",
          },
        ],
      })
    );

    const r = await runTrackedPolarityLlmInference({
      tenantId: "t1",
      trackedInsightId: "id1",
      headline: "Growth",
      understory: "",
      sourceType: "agent",
      displayMetadata: null,
      metricValues: { obscure_metric: 42 },
      comparedKeys: ["obscure_metric"],
      existingPolarities: {},
      apiKey: "k",
    });

    expect(r).not.toBeNull();
    expect(r!.polaritiesToMerge.obscure_metric).toBe("higher_better");
  });

  it("does not merge when confidence is 69", async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        decisions: [
          {
            metric_key: "obscure_metric",
            polarity: "lower_better",
            confidence: 69,
            rationale: "unsure",
          },
        ],
      })
    );

    const r = await runTrackedPolarityLlmInference({
      tenantId: "t1",
      trackedInsightId: "id1",
      headline: "x",
      understory: "",
      sourceType: "agent",
      displayMetadata: null,
      metricValues: { obscure_metric: 1 },
      comparedKeys: ["obscure_metric"],
      existingPolarities: {},
      apiKey: "k",
    });

    expect(r).not.toBeNull();
    expect(r!.polaritiesToMerge.obscure_metric).toBeUndefined();
  });
});
